import { useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { Platform, PermissionsAndroid } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import Geolocation from 'react-native-geolocation-service';
import { Storage } from '../utils/storage';
import { migrateAsyncStorageToMMKV } from '../utils/migrate-storage';
import { AuthService } from '../services/api/auth';
import { setSessionHeader } from '../services/api';
import { setInitial } from '../redux/reducer/auth.reducer';
import SocketManager from '../services/SocketManager';
import { startOfflineSyncTimer, stopOfflineSyncTimer } from '../services/api/offlineUploadManager';

export function useAppInitialization() {
  const dispatch = useDispatch();

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

        const res = await AuthService.getMe();
        dispatch(setInitial({ user: res.data?.data }));
      } else {
        setSessionHeader(null);
        dispatch(setInitial({ user: null }));
      }
    } catch {
      setSessionHeader(null);
      dispatch(setInitial({ user: null }));
    }
  }, [dispatch]);

  useEffect(() => {
    initialize();

    // Start background sync timer for offline image uploads
    startOfflineSyncTimer();
    return () => {
      stopOfflineSyncTimer();
    };
  }, [initialize]);



  return { initialize };
}
