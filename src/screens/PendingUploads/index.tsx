import React, { useCallback } from 'react';
import { describeQueueError } from '../../utils/calculator-title-conflict';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsOnline } from '../../hooks/useIsOnline';
import { usePendingUploads } from '../../hooks/usePendingUploads';
import {
  createdAtTheDoor,
  uploadProgress,
  type OfflineLeadWork,
} from '../../utils/offline-lead-work';
import { removeOfflineWork, retryOfflineWork, runUpload } from '../../services/offlineLeadStore';
import { uploadQueueManager, type UploadQueueItem } from '../../utils/uploadQueue';
import {
  discardInstallerUpload,
  processUploadQueue,
  retryInstallerUpload,
  type OfflineUploadItem,
} from '../../services/api/offlineUploadManager';

const AMBER = '#D97706';
const RED = '#DC2626';
const GREEN = '#16A34A';

const confirm = (title: string, message: string, action: string, onConfirm: () => void) =>
  Alert.alert(title, message, [
    { text: 'Keep it', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);

const workStatus = (w: OfflineLeadWork, online: boolean) => {
  switch (w.status) {
    case 'needs-review':
      return {
        label: 'Needs your check',
        tone: AMBER,
        detail:
          'This may already be on the server. Check your leads first, and only retry if it is missing.',
      };
    case 'failed':
      return { label: "Couldn't be uploaded", tone: RED, detail: describeQueueError(w.lastError) };
    case 'uploading':
      return { label: 'Uploading…', tone: '#2563EB', detail: undefined };
    default:
      return {
        label: !online ? 'Waiting for signal' : w.attempts > 0 ? 'Retrying…' : 'Waiting to send',
        tone: '#64748B',
        detail: undefined,
      };
  }
};

const Btn = ({ label, onPress, tone }: { label: string; onPress: () => void; tone?: string }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.btn, { borderColor: tone || colors.border }]}
      accessibilityRole="button"
    >
      <Text style={[styles.btnText, { color: tone || colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const Row = ({
  title,
  subtitle,
  tone,
  detail,
  children,
}: {
  title: string;
  subtitle: string;
  tone: string;
  detail?: string;
  children?: React.ReactNode;
}) => {
  const { colors, isDark } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: isDark ? colors.surface : colors.card, borderColor: colors.border },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.rowSub, { color: tone }]}>{subtitle}</Text>
        {!!detail && (
          <Text style={[styles.rowDetail, { color: colors.textSecondary }]} numberOfLines={3}>
            {detail}
          </Text>
        )}
      </View>
      <View style={styles.actions}>{children}</View>
    </View>
  );
};

export default function PendingUploadsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const online = useIsOnline();
  const snap = usePendingUploads();

  const card = {
    backgroundColor: isDark ? colors.surface : colors.card,
    borderColor: colors.border,
  };

  const syncNow = useCallback(() => {
    runUpload();
    void uploadQueueManager.processQueue();
    void processUploadQueue();
  }, []);

  const discardWork = (w: OfflineLeadWork) =>
    confirm(
      'Discard this item?',
      createdAtTheDoor(w)
        ? 'It was never created on the server, so the lead and its queued photos will be lost.'
        : 'Changes that have not reached the server yet will be lost.',
      'Discard',
      () => {
        if (createdAtTheDoor(w)) uploadQueueManager.dropLead(w.clientId);
        removeOfflineWork(w.clientId);
      }
    );

  const discardPhoto = (p: UploadQueueItem) =>
    confirm('Discard this photo?', 'It has not been uploaded and cannot be recovered.', 'Discard', () => {
      uploadQueueManager.dropQueuedItem(p.id);
    });

  const discardInstaller = (i: OfflineUploadItem) =>
    confirm('Discard these images?', 'They have not been uploaded and cannot be recovered.', 'Discard', () => {
      void discardInstallerUpload(i.id);
    });

  const attentionWork = snap.work.filter((w) => w.status === 'failed' || w.status === 'needs-review');
  const waitingWork = snap.work.filter((w) => w.status !== 'failed' && w.status !== 'needs-review');
  const waitingPhotos = snap.photos.length - snap.parkedPhotos.length;
  const waitingInstaller = snap.installer.length - snap.parkedInstaller.length;
  const waitingTotal = waitingWork.length + waitingPhotos + waitingInstaller + snap.activityLogs;

  return (
    <View style={[styles.root, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Pending uploads</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <View style={[styles.summary, card]}>
          <Icon
            name={online ? 'cloud-upload-outline' : 'cloud-off-outline'}
            size={22}
            color={online ? GREEN : AMBER}
          />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>
              {snap.total === 0
                ? 'Everything is uploaded'
                : `${snap.total} ${snap.total === 1 ? 'item' : 'items'} on this device`}
            </Text>
            <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
              {online
                ? 'Items send automatically. Use Send now if one looks stuck.'
                : 'No signal. Everything sends by itself when you are back online.'}
            </Text>
          </View>
          {online && snap.total > 0 && <Btn label="Send now" onPress={syncNow} tone={GREEN} />}
        </View>

        {snap.attention > 0 && (
          <>
            <Text style={[styles.section, { color: AMBER }]}>NEEDS YOUR ATTENTION</Text>

            {attentionWork.map((w) => {
              const s = workStatus(w, online);
              const p = uploadProgress(w);
              return (
                <Row
                  key={w.clientId}
                  title={w.label || 'Untitled'}
                  subtitle={`${s.label} · ${p.done}/${p.total} steps`}
                  tone={s.tone}
                  detail={s.detail}
                >
                  <Btn label="Retry" onPress={() => retryOfflineWork(w.clientId)} />
                  <Btn label="Discard" onPress={() => discardWork(w)} tone={RED} />
                </Row>
              );
            })}

            {snap.parkedPhotos.length > 0 && (
              <View style={styles.groupHead}>
                <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>
                  Photos that failed {snap.parkedPhotos.length === 1 ? '' : `(${snap.parkedPhotos.length})`}
                </Text>
                <Btn label="Retry all" onPress={() => uploadQueueManager.retryParked()} />
              </View>
            )}
            {snap.parkedPhotos.map((p) => (
              <Row
                key={p.id}
                title={p.subcategory || p.categoryName || 'Photo'}
                subtitle="Kept on this device · upload failed"
                tone={RED}
                detail={describeQueueError(p.lastError)}
              >
                <Btn label="Retry" onPress={() => uploadQueueManager.retryParked(p.id)} />
                <Btn label="Discard" onPress={() => discardPhoto(p)} tone={RED} />
              </Row>
            ))}

            {snap.parkedInstaller.map((i) => (
              <Row
                key={i.id}
                title={`Job ${i.jobNumber} · ${i.type === 'before' ? 'before' : 'after'} images`}
                subtitle="Kept on this device · upload failed"
                tone={RED}
                detail={describeQueueError(i.lastError)}
              >
                <Btn label="Retry" onPress={() => retryInstallerUpload(i.id)} />
                <Btn label="Discard" onPress={() => discardInstaller(i)} tone={RED} />
              </Row>
            ))}
          </>
        )}

        {waitingTotal > 0 && (
          <>
            <Text style={[styles.section, { color: colors.textSecondary }]}>WAITING TO SEND</Text>
            {waitingWork.map((w) => {
              const s = workStatus(w, online);
              const p = uploadProgress(w);
              return (
                <Row
                  key={w.clientId}
                  title={w.label || 'Untitled'}
                  subtitle={`${s.label} · ${p.done}/${p.total} steps`}
                  tone={s.tone}
                  detail={describeQueueError(w.lastError)}
                />
              );
            })}
            {waitingPhotos > 0 && (
              <Row
                title={`${waitingPhotos} ${waitingPhotos === 1 ? 'photo' : 'photos'}`}
                subtitle={online ? 'Uploading in order' : 'Waiting for signal'}
                tone="#64748B"
              />
            )}
            {waitingInstaller > 0 && (
              <Row
                title={`${waitingInstaller} installer ${waitingInstaller === 1 ? 'upload' : 'uploads'}`}
                subtitle={online ? 'Uploading in order' : 'Waiting for signal'}
                tone="#64748B"
              />
            )}
            {snap.activityLogs > 0 && (
              <Row
                title={`${snap.activityLogs} activity ${snap.activityLogs === 1 ? 'record' : 'records'}`}
                subtitle="Check-ins and similar, sent in the background"
                tone="#64748B"
              />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18, fontWeight: '800' },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  section: { fontSize: 11, fontWeight: '900', letterSpacing: 1, marginTop: 22, marginBottom: 8 },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 8,
  },
  groupTitle: { fontSize: 12, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    gap: 10,
  },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  rowSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  rowDetail: { fontSize: 11, marginTop: 4 },
  actions: { gap: 6, alignItems: 'flex-end' },
  btn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  btnText: { fontSize: 12, fontWeight: '800' },
});
