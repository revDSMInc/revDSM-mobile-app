import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useIsOnline';
import { recheckNetworkNow } from '../../services/connectivity';
import {
  HEALTH_URL,
  getClockSkewMs,
  getLastHealthDurationMs,
  getLastHealthSuccessAt,
} from '../../services/health-probe';
import { pendingUploadCount } from '../../services/background/uploadCoordinator';
import {
  diagnosticLines,
  diagnosticSummary,
  type ConnectionDiagnostics,
} from '../../utils/connection-diagnostics';

/**
 * What the app currently believes about the connection, in words a rep can read out.
 *
 * ⚠️ WHY. Reps report "it said offline" and there is no way to tell which of several very
 * different things happened - the API was down, one probe packet was lost on a weak cell, the
 * queue was stuck, or the app never asked. None of those reproduce on office WiFi. This turns an
 * unanswerable report into a fact, and shows WHICH url reachability is testing, which is the
 * single most misleading thing about NetInfo's defaults.
 */
export const ConnectionDiagnosticsCard: React.FC = () => {
  const { colors, isDark } = useTheme();
  const status = useNetworkStatus();
  const [net, setNet] = useState<{ type: string; gen?: string | null; reachable?: boolean | null }>({
    type: 'unknown',
  });
  const [checking, setChecking] = useState(false);
  const [, setTick] = useState(0);

  const readNetInfo = useCallback(() => {
    NetInfo.fetch()
      .then((s: any) =>
        setNet({
          type: s?.type ?? 'unknown',
          gen: s?.details?.cellularGeneration ?? null,
          reachable: s?.isInternetReachable,
        })
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    readNetInfo();
    const off = NetInfo.addEventListener((s: any) =>
      setNet({
        type: s?.type ?? 'unknown',
        gen: s?.details?.cellularGeneration ?? null,
        reachable: s?.isInternetReachable,
      })
    );
    return () => off();
  }, [readNetInfo]);

  const lastOk = getLastHealthSuccessAt();
  const data: ConnectionDiagnostics = {
    status,
    connectionType: net.type,
    cellularGeneration: net.gen,
    isInternetReachable: net.reachable,
    reachabilityUrl: HEALTH_URL,
    pendingCount: pendingUploadCount(),
    lastOkAgoMs: lastOk ? Date.now() - lastOk : null,
    lastProbeMs: getLastHealthDurationMs(),
    clockSkewMs: getClockSkewMs(),
  };

  const handleCheck = async () => {
    setChecking(true);
    try {
      await recheckNetworkNow();
      readNetInfo();
      setTick((t) => t + 1);
    } finally {
      setChecking(false);
    }
  };

  return (
    <View
      className="p-6 rounded-[32px] border mt-6"
      style={{ backgroundColor: isDark ? colors.surface : colors.card, borderColor: colors.border }}
    >
      <View className="flex-row items-center mb-1">
        <Icon name="wifi-cog" size={18} color={colors.textSecondary} />
        <Text
          className="font-black tracking-widest text-[11px] ml-2"
          style={{ color: colors.textSecondary }}
        >
          CONNECTION
        </Text>
      </View>

      <Text className="text-[11px] font-bold mt-2 mb-3" style={{ color: colors.textSecondary }}>
        Share this with support if the app says you are offline when you are not.
      </Text>

      {diagnosticLines(data).map((line) => (
        <View key={line.label} className="flex-row justify-between py-1.5">
          <Text className="text-[12px] font-bold" style={{ color: colors.textSecondary }}>
            {line.label}
          </Text>
          <Text
            className="text-[12px] font-bold flex-shrink ml-3 text-right"
            style={{ color: colors.text }}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {line.value}
          </Text>
        </View>
      ))}

      <View className="flex-row mt-4" style={{ gap: 10 }}>
        <TouchableOpacity
          onPress={handleCheck}
          disabled={checking}
          className="flex-1 py-3.5 rounded-xl items-center border"
          style={{ borderColor: colors.border, opacity: checking ? 0.5 : 1 }}
        >
          {checking ? (
            <ActivityIndicator color={colors.textSecondary} />
          ) : (
            <Text
              className="font-black text-[11px] tracking-widest"
              style={{ color: colors.textSecondary }}
            >
              CHECK NOW
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            // Plain text, so it can go in a chat message or an email to support.
            Share.share({ message: diagnosticSummary(data) }).catch(() => undefined);
          }}
          className="flex-1 py-3.5 rounded-xl items-center border"
          style={{ borderColor: colors.border }}
        >
          <Text
            className="font-black text-[11px] tracking-widest"
            style={{ color: colors.textSecondary }}
          >
            SHARE
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
