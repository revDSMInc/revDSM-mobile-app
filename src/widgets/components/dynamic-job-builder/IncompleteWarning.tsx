import React from 'react';
import { Text } from 'react-native';

/**
 * Required-field warning shown ABOVE an incomplete field — a port of the web
 * `incomplete-warning.js`, which renders a `warning.main` caption reading
 * "⚠️ {message}" (fontWeight 600, caption size).
 *
 * Web returns null in deal-edit mode; the mobile dynamic builder renders a
 * LockedField for the read-only path before ever reaching a required check, so
 * no extra gating is needed here.
 */
export function IncompleteWarning({ message }: { message: string }) {
  return (
    <Text className="text-[11px] font-semibold mb-1.5" style={{ color: '#FFAB00' }}>
      ⚠️ {message}
    </Text>
  );
}
