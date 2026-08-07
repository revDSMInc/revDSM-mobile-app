import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { INSTALL_STEPS } from '../../../constants/installer';
import type { InstallStepKey, InstallStepStatus } from '../../../config/types/installer';

interface Props {
  status: Record<InstallStepKey, InstallStepStatus>;
  /** Per-step summary line replacing the default description once work exists. */
  notes?: Partial<Record<InstallStepKey, string | null>>;
  completedCount: number;
  totalSteps: number;
  onOpen: (key: InstallStepKey) => void;
}

/**
 * Vertical step rail for the install flow.
 *
 * Locked steps are non-interactive — gating is computed in `useInstallProgress`
 * from each step's dependencies, so the rail only renders what it's told.
 */
export function InstallTimeline({
  status,
  notes = {},
  completedCount,
  totalSteps,
  onOpen,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const green = colors.primary.main;

  return (
    <View className="mb-2">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-lg font-black" style={{ color: colors.text }}>
          {t('installer.timeline')}
        </Text>
        <Text className="text-xs font-bold" style={{ color: colors.textSecondary }}>
          {t('installer.stepsDone', { done: completedCount, total: totalSteps })}
        </Text>
      </View>

      {/* Progress bar */}
      <View
        className="h-1.5 rounded-full mb-4 overflow-hidden"
        style={{ backgroundColor: colors.border }}
      >
        <View
          className="h-1.5 rounded-full"
          style={{
            width: `${(completedCount / totalSteps) * 100}%`,
            backgroundColor: completedCount === totalSteps ? colors.success.main : green,
          }}
        />
      </View>

      {INSTALL_STEPS.map((step, i) => {
        const st = status[step.key];
        const isLast = i === INSTALL_STEPS.length - 1;
        const done = st === 'done';
        const active = st === 'active';
        const locked = st === 'locked';

        return (
          <View key={step.key} className="flex-row" style={{ gap: 12 }}>
            {/* Rail */}
            <View className="items-center">
              <View
                className="items-center justify-center"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  borderWidth: 3,
                  backgroundColor: done ? green : active ? colors.background : '#F4F6F8',
                  borderColor: done || active ? green : colors.border,
                }}
              >
                {done ? (
                  <Icon name="check" size={16} color="#fff" />
                ) : (
                  <Text
                    className="text-xs font-black"
                    style={{ color: active ? green : colors.textSecondary }}
                  >
                    {step.n}
                  </Text>
                )}
              </View>
              {!isLast && (
                <View
                  className="my-1"
                  style={{
                    width: 3,
                    flex: 1,
                    minHeight: 14,
                    backgroundColor: done ? green : colors.border,
                  }}
                />
              )}
            </View>

            {/* Card */}
            <TouchableOpacity
              disabled={locked}
              onPress={() => onOpen(step.key)}
              activeOpacity={0.85}
              className="flex-1 rounded-2xl mb-2.5 p-3 border-2"
              style={{
                backgroundColor: active ? green + '10' : colors.background,
                borderColor: active ? green : colors.border,
                opacity: locked ? 0.55 : 1,
              }}
            >
              <View className="flex-row justify-between items-center">
                <View className="flex-row items-center flex-1">
                  <Icon
                    name={step.icon}
                    size={16}
                    color={done || active ? green : colors.textSecondary}
                  />
                  <Text
                    className="ml-2 text-base font-bold flex-1"
                    style={{ color: colors.text }}
                    numberOfLines={1}
                  >
                    {t(step.titleKey)}
                  </Text>
                </View>
                {active && (
                  <Text className="text-[11px] font-black ml-2" style={{ color: green }}>
                    {t('installer.badgeStart')}
                  </Text>
                )}
                {done && (
                  <Text className="text-[11px] font-black ml-2" style={{ color: green }}>
                    {t('installer.badgeDone')}
                  </Text>
                )}
                {locked && (
                  <Icon name="lock-outline" size={14} color={colors.textSecondary} />
                )}
              </View>
              <Text
                className="text-xs font-semibold mt-1"
                style={{ color: colors.textSecondary }}
              >
                {notes[step.key] || t(step.descKey)}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}
