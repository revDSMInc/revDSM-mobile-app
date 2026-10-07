import { useEffect, useCallback } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { Platform, PermissionsAndroid } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import Geolocation from 'react-native-geolocation-service';
import { Storage } from '../utils/storage';
import { migrateAsyncStorageToMMKV } from '../utils/migrate-storage';
import { AuthService } from '../services/api/auth';
import { setSessionHeader } from '../services/api';
import { endStaleInstallerWorkSession } from '../utils/installer-work-session';
import { endStaleLeadWorkSession } from '../utils/lead-work-session';
import { setInitial } from '../redux/reducer/auth.reducer';
import SocketManager from '../services/SocketManager';
import PushNotificationService from '../services/PushNotificationService';
import { startOfflineSyncTimer, stopOfflineSyncTimer } from '../services/api/offlineUploadManager';
import { startOfflineWorkSync } from '../services/offlineLeadStore';
import { startMapFilterSync } from '../services/offlineMapFilters';
import { adoptSessionOwner } from '../services/sessionScope';
import { startPhotoQueueSync } from '../utils/uploadQueue';
import { startActivityLogSync } from '../services/offlineActivityLog';
import { startBackgroundUploadService } from '../services/background/backgroundUploadService';
import { startCalculatorSettingsSync } from '../services/offlineSettings';
import {
  startConnectivityMonitor,
  stopConnectivityMonitor,
  refreshConnectivity,
  subscribeWifiStatus,
} from '../services/connectivity';
import { offlineMapManager } from '../services/offlineMapManager';
import { readMapLeadsCache } from '../utils/offline-map-leads-cache';
import { FlashMessage } from '../config/message';
import {
  NO_MOBILE_ACCESS_MESSAGE,
  resolveMobileDashboard,
} from '../utils/auth/dashboard-access';
import { isNetworkError } from '../utils/network-error';
import { flushPendingLogs } from '../services/api/LoggerService';

export function useAppInitialization() {
  const dispatch = useDispatch();
  const store = useStore();

  const initialize = useCallback(async () => {
    try {
      // Run one-time migration from AsyncStorage → MMKV on first boot
      await migrateAsyncStorageToMMKV();

      // Request Permissions (Location, Camera, and Photo)
      try {
        if (Platform.OS === 'android') {
          const hasLocation = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          );
          if (!hasLocation) {
            await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
            );
          }
        } else {
          await Geolocation.requestAuthorization('whenInUse');
        }
      } catch (err) {
        console.log('Error requesting location permission on init:', err);
      }

      try {
        const cameraPermission = await Camera.getCameraPermissionStatus();
        if (cameraPermission !== 'granted') {
          await Camera.requestCameraPermission();
        }
      } catch (err) {
        console.log('Error requesting camera permission on init:', err);
      }

      try {
        if (Platform.OS === 'android') {
          // Android 13+ (API 33+) uses the system photo picker for selecting media and
          // MediaStore for saving downloads — neither needs READ_MEDIA_* permissions, and
          // requesting them violates Google Play's Photo & Video Permissions policy.
          // Only the legacy (<=32) storage model still needs a runtime request.
          if (Number(Platform.Version) < 33) {
            const hasWrite = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
            const hasRead = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
            if (!hasWrite || !hasRead) {
              await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
                PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
              ]);
            }
          }
        } else if (Platform.OS === 'ios') {
          try {
            const cameraRollModule = require('@react-native-camera-roll/camera-roll');
            if (cameraRollModule && cameraRollModule.iosReadGalleryPermission) {
              const status = await cameraRollModule.iosReadGalleryPermission('readWrite');
              if (status !== 'granted' && status !== 'limited') {
                if (cameraRollModule.iosRequestReadWriteGalleryPermission) {
                  await cameraRollModule.iosRequestReadWriteGalleryPermission();
                } else if (cameraRollModule.iosRequestAddOnlyGalleryPermission) {
                  await cameraRollModule.iosRequestAddOnlyGalleryPermission();
                }
              }
            }
          } catch (e) {
            console.log('CameraRoll helper not available or failed:', e);
          }
        }
      } catch (err) {
        console.log('Error requesting gallery permission on init:', err);
      }

      const accessToken = Storage.getItem('accessToken');
      if (accessToken) {
        setSessionHeader(accessToken);

        // Restore the socket immediately — user is still logged in from a
        // previous session, so the socket should be live before they navigate.
        SocketManager.connect(accessToken);

        // ⚠️ Offline fast path — do NOT wait for `getMe()` to fail.
        //
        // The catch below already restores a persisted profile on a transport failure, but it
        // only runs once the request gives up, and `axiosInstance.timeout` is **120 s**. On
        // airplane mode the socket is refused immediately so that is quick; on the case the
        // ticket actually names — spotty service, a wifi captive portal, a dead cell edge — the
        // request HANGS, and the rep watches a splash screen for up to two minutes before the
        // fallback they were always going to get. Asking first costs one native call.
        //
        // ⚠️ `refreshConnectivity()`, not `isOnline()`. The monitor is started immediately before
        // `initialize()` and seeds itself from an ASYNC `NetInfo.fetch()`, so the cached value may
        // still be the optimistic default at this point in the boot.
        const online = await refreshConnectivity();
        if (!online) {
          const cachedUser = (store.getState() as any)?.auth?.user;
          // Same gate as the catch: an offline launch may only restore a profile that was
          // already entitled to one of the two mobile dashboards.
          if (cachedUser && resolveMobileDashboard(cachedUser)) {
            // Normally a no-op — the owner was recorded when they signed in — but it is what
            // repairs a device whose last session ended without any cleanup, and it must run
            // before the offline stores are read.
            adoptSessionOwner(cachedUser?._id || cachedUser?.id);
            dispatch(setInitial({ user: cachedUser }));
            FlashMessage.warning(
              'Offline',
              'Could not reach revDSM. Showing your last synced data.'
            );
            return;
          }
          // No usable cached profile — fall through and let the request fail properly rather
          // than signing out here. A first launch after an update has an empty store, and the
          // network may come back before the request gives up.
        }

        const res = await AuthService.getMe();
        const userData = res.data?.data;

        // The dashboard permission is re-checked on every launch rather than trusted
        // from persisted Redux: a permission revoked on the backend (or a session left
        // over from a build that predates this gate) must not survive into the app.
        if (userData && !resolveMobileDashboard(userData)) {
          SocketManager.disconnect();
          setSessionHeader(null);
          dispatch(setInitial({ user: null }));
          FlashMessage.error('Access Denied', NO_MOBILE_ACCESS_MESSAGE);
          return;
        }

        // Anything the logger held while the token was still being restored can go up
        // now — this is the cold-start equivalent of the flush after sign-in.
        // Same claim as the sign-in path. A cold start is the other moment the device can find
        // itself holding data that belongs to somebody else — the previous session may have ended
        // in a crash, an OS kill, or an install over a build that had no notion of an owner.
        adoptSessionOwner(userData?._id || userData?.id);

        flushPendingLogs(userData);
        dispatch(setInitial({ user: userData }));

        // Bind the push token. Placed AFTER setSessionHeader + setInitial because
        // the POST is authenticated and needs the user's own id.
        //
        // ⚠️ Runs on EVERY cold start, not only after login — the contract requires
        // it. An FCM token can rotate at any time, and a rotated token that is never
        // re-bound silently stops delivery: the server logs 'has no bound devices'
        // and returns { devices: 0 }, and nothing surfaces to the client.
        void PushNotificationService.bind(userData?._id || userData?.id);

        // An installer work session the last run never closed — the app was killed
        // rather than backgrounded, so no cleanup ran and the office is still showing
        // that crew on the job. Closed here, after the token is restored, because a
        // tokenless check-out is dropped.
        void endStaleInstallerWorkSession();

        // The sales-side twin: a lead the rep was working when the app was killed. Same
        // reasoning, same placement — after the token, because a tokenless release is
        // skipped and a tokenless log is only held.
        void endStaleLeadWorkSession();
      } else {
        setSessionHeader(null);
        dispatch(setInitial({ user: null }));
      }
    } catch (err: any) {
      // A launch with no connectivity is not a rejected session. Signing the user out
      // here would strand a rep in the field behind a login screen they cannot pass,
      // so a persisted profile is kept (the token is still valid) and the failure is
      // reported instead. Anything the server actually rejected still signs out.
      const persistedUser = (store.getState() as any)?.auth?.user;
      // Still gated: an offline launch may only restore a profile that was already
      // entitled to one of the two mobile dashboards.
      if (isNetworkError(err) && persistedUser && resolveMobileDashboard(persistedUser)) {
        // The offline fast path's twin — same claim, same reason.
        adoptSessionOwner(persistedUser?._id || persistedUser?.id);
        dispatch(setInitial({ user: persistedUser }));
        FlashMessage.warning(
          'Offline',
          'Could not reach revDSM. Showing your last synced data.'
        );
        return;
      }

      setSessionHeader(null);
      dispatch(setInitial({ user: null }));
    }
  }, [dispatch, store]);

  useEffect(() => {
    // ⚠️ FIRST, before `initialize()`. The bootstrap's own offline fallback (the `catch` above)
    // and React Query's `onlineManager` both read this monitor, so starting it after the first
    // request would leave that request classified against a default rather than the truth.
    startConnectivityMonitor();

    initialize();

    // Start background sync for offline image uploads. Now reconnect-driven — see
    // `offlineUploadManager.startOfflineSyncTimer`.
    startOfflineSyncTimer();

    // Replay leads created with no signal. Also reconnect-driven, and idempotent — calling it a
    // second time is a no-op, so a remount cannot double-subscribe the drain.
    startOfflineWorkSync();

    // Send inspection photos taken with no signal. Same shape, different queue: photos are
    // binaries and live in `uploadQueueManager` rather than the lead store. Before this, nothing
    // started that queue at launch — only a Lead Center mount did — so photos shot offline stayed
    // on the device, unsent and unmentioned, until the rep happened to open a lead again.
    startPhotoQueueSync();

    // Replay the arrival events the office reads — check in / resume / review / pause — that were
    // fired at a door with no signal. Same reconnect-driven, idempotent shape as the two above.
    startActivityLogSync();

    // Replay a map filter the rep applied or RESET with no signal. The PATCH is full-state, so
    // a replay lands exactly what they chose; without it the server kept the previous set and
    // put it back on the next read.
    startMapFilterSync();

    // Keep draining all four queues after the app leaves the screen: an iOS grace period, or the
    // Android foreground service. Subscribes to app-state only — the engines above own the
    // foreground triggers, and every drain is single-flight, so the two cannot collide.
    startBackgroundUploadService();
    // ⚠️ The local user is patched BEFORE the pending record clears. The other order drops the
    // override while redux still holds the older server value, and the rep's toggle flips back.
    startCalculatorSettingsSync((applied) => {
      const current = (store.getState() as any)?.auth?.user;
      if (current) dispatch(setInitial({ user: { ...current, ...applied } }));
    });
    return () => {
      stopOfflineSyncTimer();
      stopConnectivityMonitor();
    };
    // `dispatch` and `store` are stable react-redux references, so naming them cannot re-run this.
  }, [initialize, dispatch, store]);



  // On Wi-Fi — at launch as well as on every reconnect — resume interrupted map packs, queue the
  // Florida base map, and queue street detail for the cached leads' areas. One download runs at a
  // time (see `services/offlineMapManager.ts`).
  // ⚠️ `subscribeWifiStatus`, not `onWifiReconnect`: the latter only fires on the non-Wi-Fi -> Wi-Fi
  // EDGE, so an app launched already on Wi-Fi never downloaded anything.
  useEffect(() => {
    const unsubWifi = subscribeWifiStatus(async (onWifi) => {
      if (!onWifi) return;
      try {
        await offlineMapManager.resumeAllPaused();
        offlineMapManager.ensureBaseMap();
        const userId = (store.getState() as any)?.auth?.user?.id
          || (store.getState() as any)?.auth?.user?._id;
        if (userId) {
          const snapshot = readMapLeadsCache(userId);
          if (snapshot?.leads?.length) {
            const typed = snapshot.leads as Array<{ _id: string; location?: { coordinates: [number, number] } }>;
            void offlineMapManager.syncLeads(typed);
          } else {
            void offlineMapManager.syncLeads([]);
          }
        } else {
          void offlineMapManager.syncLeads([]);
        }
      } catch (e) {
        // Non-fatal — next connectivity event will retry.
      }
    });
    return unsubWifi;
  }, [store]);

  return { initialize };
}
