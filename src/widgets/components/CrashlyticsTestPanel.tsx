import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { ENV } from '../../config/env';
import { resolveCrashEnvironment } from '../../utils/crash-environment';
import { forceTestCrash, sendTestNonFatal } from '../../services/crashReporting';

/**
 * Lets QA confirm Crashlytics end to end on a device. Rendered ONLY against a non-production backend (see
 * `utils/crash-environment.ts`), so a production build never shows - or can trigger - a deliberate crash.
 */
export const CrashlyticsTestPanel = () => {
  const { environment, host } = resolveCrashEnvironment(ENV.API_URL);
  if (environment === 'production') return null;

  const onNonFatal = () => {
    sendTestNonFatal();
    Alert.alert('Sent', 'Non-fatal test error recorded. It uploads on the next app launch or within a few minutes; it appears under "Non-fatals" in Firebase.');
  };

  const onCrash = () =>
    Alert.alert(
      'Force a test crash?',
      __DEV__
        ? 'This is a debug build: Crashlytics collection is off, so the report will NOT be sent. Use a release build.'
        : 'The app will close immediately. Reopen it to upload the report.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Crash now', style: 'destructive', onPress: forceTestCrash },
      ]
    );

  return (
    <View style={{ marginHorizontal: 20, marginTop: 24, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#F59E0B' }}>
      <Text style={{ fontWeight: '800', fontSize: 12, letterSpacing: 1 }}>CRASHLYTICS TEST (NON-PRODUCTION ONLY)</Text>
      <Text style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>{`environment: ${environment} · ${host}`}</Text>
      <TouchableOpacity onPress={onNonFatal} style={{ marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#0E2A1C', alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Send test non-fatal error</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCrash} style={{ marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#B91C1C', alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Force test crash</Text>
      </TouchableOpacity>
    </View>
  );
};
