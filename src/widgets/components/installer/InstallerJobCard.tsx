import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { format } from 'date-fns';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import {
  installStatusPhrase,
  JOB_CARD_COLORS,
  resolveJobCardState,
} from '../../../utils/installer-card-state';
import { MapSelectionModal } from '../../common/modal/MapSelectionModal';
import type { InstallerJob } from '../../../config/types/installer';

interface Props {
  job: InstallerJob;
  isUpcoming?: boolean;
  loading?: boolean;
  disabled?: boolean;
  offSite?: boolean;
  now?: Date;
  onPress: () => void;
}

export function InstallerJobCard({
  job,
  isUpcoming = false,
  loading = false,
  disabled = false,
  offSite = false,
  now,
  onPress,
}: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const resulted = !!job.resulted;
  const inert = loading || disabled;
  const state = resolveJobCardState(job, { isUpcoming, loading, offSite, now });

  const workflowPhrase = installStatusPhrase(job);

  const showPhraseOnAction = !!workflowPhrase && !loading;

  const accent = showPhraseOnAction ? JOB_CARD_COLORS.RESULTED : state.color;

  const actionLabel = state.actionLabel ?? t(state.actionLabelKey);

  const buttonLabel = showPhraseOnAction ? (workflowPhrase as string) : actionLabel;

  const isPreview = state.key === 'UPCOMING';

  const solidAction = !isPreview || showPhraseOnAction;
  const actionBg = solidAction ? accent : accent + '33';
  const actionFg = solidAction ? '#fff' : accent;

  const showActionIcon = !loading && !resulted && !showPhraseOnAction;

  const name =
    job.customerName ||
    [job.customerDetails?.firstName, job.customerDetails?.lastName].filter(Boolean).join(' ');

  const displayId = job.leadDisplayId || job.jobNumber || job.leadId;

  const date = job.leadDate ? new Date(job.leadDate) : null;
  const dateLabel = date && !isNaN(date.getTime()) ? format(date, 'MM/dd/yyyy') : 'N/A';

  const [showMapModal, setShowMapModal] = useState(false);

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        disabled={inert}
        className="mb-4 rounded-2xl overflow-hidden border-2"
        style={{
          backgroundColor: resulted ? (isDark ? colors.surface : '#F4F6F8') : accent + '1A',
          borderColor: accent,
          opacity: disabled && !loading ? 0.6 : resulted ? 0.85 : 1,
        }}
      >
        {/*
          Web draws this as `boxShadow: '-6px 0 0 0 color'` on the two live states.
          RN has no offset-only shadow, so it's a real 6 px edge — same result.
        */}
        {state.accentBar && (
          <View
            className="absolute left-0 top-0 bottom-0"
            style={{ width: 6, backgroundColor: accent }}
          />
        )}

        <View className="p-4">
          {/* Arrival window + resulted chip */}
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center flex-1">
              <Ionicon name="time-outline" size={16} color={accent} />
              <Text className="ml-1.5 text-base font-bold" style={{ color: accent }} numberOfLines={1}>
                {job.leadTime || 'N/A'}
              </Text>
            </View>
            {resulted && (
              <View className="px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#9ca3af' }}>
                <Text className="text-[11px] font-black text-white tracking-widest">
                  {t('installer.resulted')}
                </Text>
              </View>
            )}
          </View>

          {/* Customer + date */}
          <View className="mb-4">
            <Text className="text-base mb-1" style={{ color: colors.textSecondary }}>
              {t('installer.leadId')}: {displayId || 'N/A'}
            </Text>
            <View className="flex-row justify-between items-center">
              <View className="flex-row items-center flex-1">
                <FontAwesome name="user" size={14} color="#637381" />
                <Text className="ml-2 text-base font-bold" style={{ color: colors.text }}>
                  {name || t('installer.customer')}
                </Text>
              </View>
              <View className="flex-row items-center">
                <Ionicon name="calendar-clear" size={14} color="#637381" />
                <Text className="ml-1.5 text-base font-semibold" style={{ color: colors.textSecondary }}>
                  {dateLabel}
                </Text>
              </View>
            </View>
          </View>

          {/* Address — opens the same Apple/Google Maps chooser the sales LeadCard does.

              ⚠️ Nested inside the card's own TouchableOpacity ON PURPOSE. The inner
              view claims the touch, so tapping the address opens directions while
              tapping anywhere else still opens the job — the same arrangement
              `LeadCard` uses, where the card navigates and the address does not.

              ⚠️ NOT gated on `inert`. A preview-only or already-started card still has
              to get the crew to the door; only the ACTION is unavailable, not the
              address. */}
          <TouchableOpacity
            onPress={() => setShowMapModal(true)}
            className="flex-row items-start mb-5"
          >
            <Ionicon name="location-sharp" size={18} color={accent} style={{ marginTop: 2 }} />
            <Text
              className="flex-1 ml-1.5 text-base font-bold leading-5"
              style={{ color: colors.text }}
              numberOfLines={2}
            >
              {job.fullAddress || t('installer.addressPending')}
            </Text>
          </TouchableOpacity>

          {/* Action.

              A resulted card drops the location pin and matches the sales LeadCard's
              resulted bar — centred bold text on its own. The pin belongs to an action
              that takes the installer somewhere; an outcome report doesn't go anywhere,
              and the icon only crowded a label that is already as long as the API's two
              status fields make it. */}
          <TouchableOpacity
            onPress={onPress}
            disabled={inert}
            className="h-12 rounded-xl items-center justify-center flex-row"
            style={{ backgroundColor: actionBg }}
          >
            {loading ? (
              <ActivityIndicator size="small" color={actionFg} />
            ) : (
              showActionIcon && <Ionicon name="location-sharp" size={20} color={actionFg} />
            )}
            {/* `font-medium`, not bold: at 16 px on a filled button, a bold weight reads
                as a heavy slab rather than a label. One line — an outcome label is as
                long as the API's status makes it.

                The margin belongs to whatever precedes the text, so it is keyed on the
                spinner/pin actually being there rather than on `resulted`: a status
                phrase drops the pin too, and an inherited `ml-2` would push it off
                centre. */}
            <Text
              className={`text-base font-medium ${
                loading || showActionIcon ? 'ml-2' : 'tracking-tight'
              }`}
              style={{ color: actionFg }}
              numberOfLines={1}
            >
              {buttonLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Outside the card, so the chooser is not a child of a pressable. */}
      <MapSelectionModal
        visible={showMapModal}
        address={job.fullAddress || ''}
        onClose={() => setShowMapModal(false)}
      />
    </>
  );
}
