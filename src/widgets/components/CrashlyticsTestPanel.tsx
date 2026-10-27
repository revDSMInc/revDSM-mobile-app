import React, { useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { ENV } from '../../config/env';
import { resolveCrashEnvironment } from '../../utils/crash-environment';
import { forceTestCrash, getCrashlyticsStatus, isDebugReportingOn, sendTestNonFatal, setDebugReporting } from '../../services/crashReporting';

/**
 * Lets QA confirm Crashlytics end to end on a device. Rendered ONLY against a non-production backend (see
 * `utils/crash-environment.ts`), so a production build never shows - or can trigger - a deliberate crash.
 */
export const CrashlyticsTestPanel = () => {
  const { environment, host } = resolveCrashEnvironment(ENV.API_URL);
  const [debugOn, setDebugOn] = useState(isDebugReportingOn);
  if (environment === 'production') return null;

  const status = getCrashlyticsStatus();
  const notInstalled = () =>
    Alert.alert(
      'Crashlytics is not in this build',
      `The native module did not load, so nothing can be reported. Rebuild the app natively (pod install + Release build) - a JS reload is not enough.\n\n${status.error ?? ''}`
    );

  const onNonFatal = () => {
    if (!sendTestNonFatal()) return notInstalled();
    Alert.alert('Sent', 'Non-fatal test error recorded. It uploads on the next app launch or within a few minutes; it appears under "Non-fatals" in Firebase.');
  };

  const onCrash = () =>
    Alert.alert(
      'Force a test crash?',
      __DEV__ && !debugOn
        ? 'This is a debug build: Crashlytics collection is off, so the report will NOT be sent. Turn on "Report from debug build" below, or use a release build.'
        : 'The app will close immediately. Reopen it to upload the report.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Crash now', style: 'destructive', onPress: () => { if (!forceTestCrash()) notInstalled(); } },
      ]
    );

  return (
    <View style={{ marginHorizontal: 20, marginTop: 24, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#F59E0B' }}>
      <Text style={{ fontWeight: '800', fontSize: 12, letterSpacing: 1 }}>CRASHLYTICS TEST (NON-PRODUCTION ONLY)</Text>
      <Text style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>{`environment: ${environment} · ${host}`}</Text>
      <Text style={{ fontSize: 12, marginTop: 2, fontWeight: '700', color: status.available ? '#15803D' : '#B91C1C' }}>
        {status.available ? `Native module: loaded · ${__DEV__ ? (debugOn ? 'DEBUG build (reporting ON)' : 'DEBUG build (reports NOT sent)') : 'release build'}` : 'Native module: NOT loaded - rebuild natively'}
      </Text>
      {__DEV__ ? (
        <TouchableOpacity
          onPress={() => {
            setDebugReporting(!debugOn);
            setDebugOn(!debugOn);
          }}
          style={{ marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#F59E0B', alignItems: 'center' }}
        >
          <Text style={{ fontWeight: '700' }}>{debugOn ? 'Report from debug build: ON (tap to turn off)' : 'Report from debug build: OFF (tap to turn on)'}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity onPress={onNonFatal} style={{ marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#0E2A1C', alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Send test non-fatal error</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCrash} style={{ marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#B91C1C', alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Force test crash</Text>
      </TouchableOpacity>
    </View>
  );
};
