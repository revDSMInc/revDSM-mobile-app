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
      await migrateAsyncStorageToMMKV();

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

        SocketManager.connect(accessToken);

        const online = await refreshConnectivity();
        if (!online) {
          const cachedUser = (store.getState() as any)?.auth?.user;
          if (cachedUser && resolveMobileDashboard(cachedUser)) {
            adoptSessionOwner(cachedUser?._id || cachedUser?.id);
            dispatch(setInitial({ user: cachedUser }));
            FlashMessage.warning(
              'Offline',
              'Could not reach revDSM. Showing your last synced data.'
            );
            return;
          }
        }

        const res = await AuthService.getMe();
        const userData = res.data?.data;

        if (userData && !resolveMobileDashboard(userData)) {
          SocketManager.disconnect();
          setSessionHeader(null);
          dispatch(setInitial({ user: null }));
          FlashMessage.error('Access Denied', NO_MOBILE_ACCESS_MESSAGE);
          return;
        }

        adoptSessionOwner(userData?._id || userData?.id);

        flushPendingLogs(userData);
        dispatch(setInitial({ user: userData }));

        void PushNotificationService.bind(userData?._id || userData?.id);

        void endStaleInstallerWorkSession();

        void endStaleLeadWorkSession();
      } else {
        setSessionHeader(null);
        dispatch(setInitial({ user: null }));
      }
    } catch (err: any) {
      const persistedUser = (store.getState() as any)?.auth?.user;
      if (isNetworkError(err) && persistedUser && resolveMobileDashboard(persistedUser)) {
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
    startConnectivityMonitor();

    initialize();

    startOfflineSyncTimer();

    startOfflineWorkSync();

    startPhotoQueueSync();

    startActivityLogSync();

    startMapFilterSync();

    startBackgroundUploadService();
    startCalculatorSettingsSync((applied) => {
      const current = (store.getState() as any)?.auth?.user;
      if (current) dispatch(setInitial({ user: { ...current, ...applied } }));
    });
    return () => {
      stopOfflineSyncTimer();
      stopConnectivityMonitor();
    };
  }, [initialize, dispatch, store]);



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
      }
    });
    return unsubWifi;
  }, [store]);

  return { initialize };
}
