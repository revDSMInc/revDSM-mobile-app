/**
 * PendingLeadsBanner — the leads that are queued on the device and not yet on the server.
 *
 * ⚠️ This exists because a queued lead that is INVISIBLE is worse than one that failed loudly. This
 * repo has already shipped that exact failure once with offline photos — see
 * `utils/pending-inspection-photos.ts`: *"The photos were never lost; they were queued and
 * invisible, which is worse, because a rep who cannot see them will shoot them again."* A rep who
 * cannot see a queued lead re-knocks the door, or assumes the app ate it.
 *
 * Rendered as the Leads list header, so it sits exactly where the rep looks for the lead they just
 * created and disappears the moment the queue is empty.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  activeWork,
  uploadProgress,
  type OfflineLeadWork,
  type WorkStatus,
} from '../../utils/offline-lead-work';
import {
  getOfflineWork,
  removeOfflineWork,
  retryOfflineWork,
  subscribeOfflineWork,
} from '../../services/offlineLeadStore';

interface Props {
  colors: any;
  isDark: boolean;
}

/** Copy per status. The `needs-review` line is the one that has to tell the rep what to DO. */
const STATUS_TEXT: Record<WorkStatus, { label: string; tone: string; detail?: string }> = {
  draft: { label: 'Waiting for signal', tone: '#64748B' },
  uploading: { label: 'Uploading…', tone: '#2563EB' },
  uploaded: { label: 'Uploaded', tone: '#16A34A' },
  failed: { label: "Couldn't be uploaded", tone: '#DC2626' },
  'needs-review': {
    label: 'Needs your check',
    tone: '#D97706',
    // Deliberately explicit: we genuinely do not know, and the rep is the only one who can look.
    detail:
      'This may already be on the server. Check the list below first — only retry if it is missing.',
  },
};

export const PendingLeadsBanner: React.FC<Props> = ({ colors, isDark }) => {
  const [items, setItems] = useState<OfflineLeadWork[]>(() => activeWork(getOfflineWork()));
  const [expanded, setExpanded] = useState(false);

  useEffect(
    () => subscribeOfflineWork(() => setItems(activeWork(getOfflineWork()))),
    [],
  );

  if (items.length === 0) return null;

  const attention = items.filter((i) => i.status === 'needs-review' || i.status === 'failed').length;
  const waiting = items.length - attention;

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: attention > 0 ? '#FCD34D' : isDark ? colors.border : '#E2E8F0',
        backgroundColor: attention > 0 ? (isDark ? '#3B2F0B' : '#FFFBEB') : isDark ? colors.surface : '#F8FAFC',
        overflow: 'hidden',
      }}
    >
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}
        accessibilityRole="button"
      >
        <Ionicons
          name={attention > 0 ? 'alert-circle-outline' : 'cloud-upload-outline'}
          size={18}
          color={attention > 0 ? '#D97706' : colors.textSecondary}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>
            {items.length} {items.length === 1 ? 'lead' : 'leads'} not yet on the server
          </Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            {attention > 0
              ? `${attention} need${attention === 1 ? 's' : ''} your check${waiting ? ` · ${waiting} waiting to sync` : ''}`
              : 'They will be created automatically when you have signal.'}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {expanded &&
        items.map((item) => {
          const meta = STATUS_TEXT[item.status] || STATUS_TEXT.draft;
          // A whole lead uploads in several steps, so show it advancing rather than sitting on one
          // word for the length of six requests.
          const progress = uploadProgress(item);
          const needsAction = item.status === 'needs-review' || item.status === 'failed';
          return (
            <View
              key={item.clientId}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: isDark ? colors.border : '#E2E8F0',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {item.status === 'uploading' ? (
                  <ActivityIndicator size="small" color={meta.tone} />
                ) : (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: meta.tone }} />
                )}
                <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.text }}>
                  {item.label}
                </Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: meta.tone }}>{meta.label}</Text>
              </View>

              {progress.done > 0 && progress.done < progress.total && (
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4 }}>
                  {`${progress.done} of ${progress.total} uploaded`}
                </Text>
              )}

              {!!meta.detail && (
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 6, lineHeight: 15 }}>
                  {meta.detail}
                </Text>
              )}
              {!!item.lastError && item.status === 'failed' && (
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 6, lineHeight: 15 }}>
                  {item.lastError}
                </Text>
              )}

              {needsAction && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    onPress={() => retryOfflineWork(item.clientId)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 7,
                      borderRadius: 8,
                      backgroundColor: '#4CBB17',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>Try again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => removeOfflineWork(item.clientId)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 7,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: isDark ? colors.border : '#CBD5E1',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>
                      Remove
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
    </View>
  );
};

export default PendingLeadsBanner;
