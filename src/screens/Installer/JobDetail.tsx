import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking, Modal, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Feather from 'react-native-vector-icons/Feather';
import Ionicon from 'react-native-vector-icons/Ionicons';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import Clipboard from '@react-native-clipboard/clipboard';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { getRawPhoneNumber } from '../../utils/phone-util';
import { FlashMessage } from '../../config/message';
import { useInstallProgress } from '../../hooks/useInstallProgress';
import { useSubmitInstallerResult, useReportDiscrepancy } from '../../hooks/useInstallerJobs';
import { InstallTimeline } from '../../widgets/components/installer/InstallTimeline';
import { JobReferenceCards } from '../../widgets/components/installer/JobReferenceCards';
import { ResultJobModal } from '../../widgets/modals/installer/ResultJobModal';
import { MaterialPhotoStep } from './steps/MaterialPhotoStep';
import { PECStep } from './steps/PECStep';
import { PhotoMatchStep } from './steps/PhotoMatchStep';
import { VerifyScopeStep } from './steps/VerifyScopeStep';
import { CoCStep } from './steps/CoCStep';
import { INSTALLER_RESULT_TYPES, RESULT_COLORS, PHOTO_SECTIONS } from '../../constants/installer';
import { requiredTagIdsFromSections } from '../../utils/installer-photo-sections';
import { useRepPhotoSections } from '../../hooks/useRepPhotoSections';
import type { JobPhotoRef } from '../../widgets/modals/installer/DiscrepancyModal';
import type {
  InstallerJob,
  InstallStepKey,
  InstallerResultType,
} from '../../config/types/installer';

/**
 * Installer job detail — lead context, the install timeline, and read-only job
 * reference. Every timeline step opens as a full-screen sub-flow over this screen.
 */
export default function InstallerJobDetail() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const job: InstallerJob = route.params?.job;
  const productIds = useMemo(() => (job?.products ?? []).map((p) => p.id), [job]);

  // Pre-install tagger sections come from the rep's real capture set (rep photos
  // resolved to signed S3 URLs); the static mock is only a fallback for jobs that
  // carry no `preInstallPhotos`.
  const repSections = useRepPhotoSections(job?.preInstallPhotos);
  const photoSections = repSections.length ? repSections : PHOTO_SECTIONS;
  const requiredPhotoTagIds = useMemo(
    () => requiredTagIdsFromSections(photoSections),
    [photoSections]
  );

  const {
    progress,
    stepStatus,
    completedCount,
    totalSteps,
    addMaterialPhoto,
    removeMaterialPhoto,
    skipMaterial,
    setPecHasConditions,
    setPecEntry,
    matchPhoto,
    addExtraPhoto,
    setScopeStatus,
    addCocPage,
    removeCocPage,
    completeStep,
  } = useInstallProgress(job?._id ?? 'unknown', productIds, requiredPhotoTagIds);

  const submitResult = useSubmitInstallerResult();
  const reportDiscrepancy = useReportDiscrepancy(job?._id ?? '');

  const [openStep, setOpenStep] = useState<InstallStepKey | null>(null);
  const [resultType, setResultType] = useState<InstallerResultType | null>(null);
  const [showPhoneOptions, setShowPhoneOptions] = useState(false);

  // Shots captured so far, offered as evidence when reporting a discrepancy.
  const jobPhotos: JobPhotoRef[] = useMemo(() => {
    const pickup = progress.pickup.photos.map((p, i) => ({
      id: p.id,
      label: `Pickup #${i + 1}`,
      uri: p.uri,
    }));
    const repTags = photoSections.flatMap((s) => s.tags.filter((t) => t.hasRep));
    const pre = repTags
      .filter((t) => progress.preMatched[t.id])
      .map((t) => ({
        id: progress.preMatched[t.id].id,
        label: t.label,
        uri: progress.preMatched[t.id].uri,
      }));
    return [...pickup, ...pre];
  }, [progress.pickup.photos, progress.preMatched, photoSections]);

  // Per-step summary lines shown in place of the default description.
  const stepNotes = useMemo(() => {
    const materialNote = (k: 'pickup' | 'return') => {
      const s = progress[k];
      if (s.skipped) return k === 'pickup' ? 'Had material on truck' : 'Used all material';
      if (s.photos.length > 0)
        return `${s.photos.length} photo${s.photos.length > 1 ? 's' : ''} • ${
          k === 'pickup' ? 'Picked up' : 'Returned'
        }`;
      return null;
    };

    const flagged = Object.keys(progress.pecEntries);
    const pecNote =
      progress.pecHasConditions === false
        ? 'None reported'
        : flagged.length > 0
        ? `${flagged.length} area${flagged.length > 1 ? 's' : ''} flagged`
        : null;

    const matchNote = (m: Record<string, unknown>) => {
      const n = requiredPhotoTagIds.filter((id) => m[id]).length;
      return n > 0 ? `${n}/${requiredPhotoTagIds.length} shots matched` : null;
    };

    const settled = productIds.filter((id) => progress.scope[id]?.state !== 'pending' && progress.scope[id]);
    const scopeNote = settled.length > 0 ? `${settled.length}/${productIds.length} settled` : null;

    return {
      pickup: materialNote('pickup'),
      return: materialNote('return'),
      pec: pecNote,
      pre: matchNote(progress.preMatched),
      post: matchNote(progress.postMatched),
      measure: scopeNote,
      coc: progress.cocPages.length
        ? `${progress.cocPages.length} page${progress.cocPages.length > 1 ? 's' : ''} scanned`
        : null,
    };
  }, [progress, productIds, requiredPhotoTagIds]);

  // Guard sits below every hook so hook order stays identical across renders.
  if (!job) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-base text-center" style={{ color: colors.textSecondary }}>
            This job could not be loaded.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const name =
    job.customerName ||
    [job.customerDetails?.firstName, job.customerDetails?.lastName].filter(Boolean).join(' ');

  const handleSubmitResult = (reason: string) => {
    submitResult.mutate(
      { jobId: job._id, result: resultType!, reason },
      {
        onSuccess: () => {
          FlashMessage.success('Job resulted', `${resultType} — ${reason}`);
          setResultType(null);
          navigation.goBack();
        },
        onError: () => FlashMessage.error('Could not result job', 'Please try again.'),
      }
    );
  };

  const phone = job.customerDetails?.phone;

  const handleCall = () => {
    if (phone) Linking.openURL(`tel:${getRawPhoneNumber(phone)}`);
    setShowPhoneOptions(false);
  };

  const handleTextMessage = () => {
    if (phone) Linking.openURL(`sms:${getRawPhoneNumber(phone)}`);
    setShowPhoneOptions(false);
  };

  const handleCopyPhone = () => {
    if (phone) {
      Clipboard.setString(phone);
      FlashMessage.success('Copied', 'Phone number copied to clipboard');
    }
    setShowPhoneOptions(false);
  };

  return (
    <>
      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
        edges={['bottom', 'left', 'right']}
      >
        {/* Local header */}
        <View className="px-4 pb-3 pt-6 flex-row items-center">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="mr-3 p-1 items-center justify-center border border-border rounded-lg"
            style={{ width: 32, height: 32 }}
          >
            <Feather
              name="arrow-left"
              size={14}
              color={isDark ? colors.text : colors.textSecondary}
            />
          </TouchableOpacity>
          <Text className="text-lg font-black" style={{ color: colors.text }}>
            Lead Center
          </Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        >
          {/* Lead summary */}
          <View className="mb-2">
            <Text className="text-[15px] mb-2">
              <Text className="font-bold" style={{ color: colors.primary.main }}>
                Lead ID:{' '}
              </Text>
              <Text className="font-black" style={{ color: colors.text }}>
                {job.leadDisplayId || job.jobNumber || job.leadId || 'N/A'}
              </Text>
            </Text>

            <View className="flex-row items-center mb-2">
              <Ionicon name="person" size={15} color={colors.primary.main} />
              <Text className="ml-2 text-base font-black" style={{ color: colors.text }}>
                {name || 'Customer'}
              </Text>
            </View>

            <View className="flex-row items-center justify-between mb-2">
              <TouchableOpacity
                className="flex-row items-center flex-1"
                disabled={!phone}
                onPress={() => setShowPhoneOptions(true)}
              >
                <Ionicon name="call" size={15} color={colors.primary.main} />
                <Text className="ml-2 text-sm font-bold" style={{ color: colors.primary.main }}>
                  {phone || 'N/A'}
                </Text>
              </TouchableOpacity>
              <View className="flex-row items-center flex-1 justify-end">
                <Ionicon name="mail" size={15} color={colors.primary.main} />
                <Text
                  numberOfLines={1}
                  className="ml-2 text-sm font-bold"
                  style={{ color: colors.primary.main }}
                >
                  {job.customerDetails?.email || 'N/A'}
                </Text>
              </View>
            </View>

            <View className="flex-row items-center mb-2" style={{ gap: 24 }}>
              <View className="flex-row items-center">
                <Ionicon name="calendar-clear" size={14} color={colors.primary.main} />
                <Text className="ml-2 text-sm font-black" style={{ color: colors.text }}>
                  {job.leadDate ? format(new Date(job.leadDate), 'MM/dd/yyyy') : 'N/A'}
                </Text>
              </View>
              <View className="flex-row items-center flex-1">
                <Ionicon name="time-outline" size={14} color={colors.primary.main} />
                <Text
                  numberOfLines={1}
                  className="ml-2 text-sm font-black"
                  style={{ color: colors.text }}
                >
                  {job.leadTime || 'N/A'}
                </Text>
              </View>
            </View>

            <View className="flex-row items-start mb-3">
              <Ionicon
                name="location-sharp"
                size={16}
                color={colors.primary.main}
                style={{ marginTop: 2 }}
              />
              <Text
                className="flex-1 ml-1.5 text-sm font-bold leading-5"
                style={{ color: colors.primary.main }}
              >
                {job.fullAddress || 'Address Pending'}
              </Text>
            </View>
          </View>

          {/* Notes — rep build note + pinned IM updates on one surface */}
          {!!job.notes?.length && (
            <View
              className="rounded-2xl p-3 mb-3 border"
              style={{
                backgroundColor: colors.warning.main + '14',
                borderColor: colors.warning.main,
              }}
            >
              <Text
                className="text-[13px] font-black tracking-wide mb-2"
                style={{ color: colors.warning.dark }}
              >
                NOTES
              </Text>
              {job.notes.map((note) =>
                note.pinned ? (
                  <View
                    key={note.id}
                    className="rounded-xl p-2.5 border"
                    style={{ backgroundColor: colors.background, borderColor: colors.warning.main }}
                  >
                    <View className="flex-row items-center mb-1">
                      <View
                        className="rounded px-1.5 py-0.5 mr-1.5"
                        style={{ backgroundColor: colors.warning.main }}
                      >
                        <Text className="text-white text-[8px] font-black tracking-widest">
                          PINNED
                        </Text>
                      </View>
                      <Text
                        className="text-[10px] font-bold"
                        style={{ color: colors.warning.dark }}
                      >
                        {note.author} · {note.at}
                      </Text>
                    </View>
                    <Text
                      className="text-[13px] font-semibold leading-5"
                      style={{ color: colors.text }}
                    >
                      {note.body}
                    </Text>
                  </View>
                ) : (
                  <View key={note.id} className="mb-2">
                    <Text
                      className="text-[10px] font-bold mb-0.5"
                      style={{ color: colors.warning.dark }}
                    >
                      {note.author} · {note.at}
                    </Text>
                    <Text
                      className="text-[13px] font-semibold leading-5"
                      style={{ color: colors.text }}
                    >
                      {note.body}
                    </Text>
                  </View>
                )
              )}
            </View>
          )}

          {/* Timeline */}
          <InstallTimeline
            status={stepStatus}
            notes={stepNotes}
            completedCount={completedCount}
            totalSteps={totalSteps}
            onOpen={setOpenStep}
          />

          {/* Read-only reference */}
          <JobReferenceCards
            packet={job.packet}
            contract={job.contract}
            products={job.products}
            onViewPacket={() =>
              FlashMessage.info('Packet preview', 'Wire to PdfPreviewModal once the URL is served.')
            }
          />

          {/* Result actions */}
          <View className="flex-row mb-2.5" style={{ gap: 8 }}>
            {INSTALLER_RESULT_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setResultType(t)}
                className="flex-1 h-12 rounded-xl items-center justify-center"
                style={{ backgroundColor: RESULT_COLORS[t] }}
              >
                <Text className="text-white text-[13px] font-bold text-center">{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            onPress={() =>
              FlashMessage.info('Ops chat', 'Wire to the existing chat module when available.')
            }
            className="h-12 rounded-xl items-center justify-center flex-row"
            style={{ backgroundColor: colors.info.main }}
          >
            <MaterialIcon name="message-text" size={16} color="#fff" />
            <Text className="text-white ml-2 text-base font-black tracking-wide">Msg Ops/IM</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

      {/* ── Timeline sub-flows ─────────────────────────────────────────────── */}

      <MaterialPhotoStep
        visible={openStep === 'pickup'}
        mode="pickup"
        state={progress.pickup}
        onAddPhoto={(p) => addMaterialPhoto('pickup', p)}
        onRemovePhoto={(id) => removeMaterialPhoto('pickup', id)}
        onSkip={() => {
          skipMaterial('pickup');
          setOpenStep(null);
        }}
        onBack={() => setOpenStep(null)}
      />

      <MaterialPhotoStep
        visible={openStep === 'return'}
        mode="return"
        state={progress.return}
        onAddPhoto={(p) => addMaterialPhoto('return', p)}
        onRemovePhoto={(id) => removeMaterialPhoto('return', id)}
        onSkip={() => {
          skipMaterial('return');
          setOpenStep(null);
        }}
        onBack={() => setOpenStep(null)}
      />

      <PECStep
        visible={openStep === 'pec'}
        hasConditions={progress.pecHasConditions}
        entries={progress.pecEntries}
        onSetHasConditions={setPecHasConditions}
        onSetEntry={setPecEntry}
        onComplete={() => completeStep('pec')}
        onBack={() => setOpenStep(null)}
      />

      <PhotoMatchStep
        visible={openStep === 'pre'}
        phase="pre"
        sections={photoSections}
        matched={progress.preMatched}
        extras={progress.preExtras}
        onMatch={(tagId, photo) => matchPhoto('pre', tagId, photo)}
        onAddExtra={(sid, photo) => addExtraPhoto('pre', sid, photo)}
        onComplete={() => completeStep('pre')}
        onBack={() => setOpenStep(null)}
      />

      <PhotoMatchStep
        visible={openStep === 'post'}
        phase="post"
        sections={photoSections}
        matched={progress.postMatched}
        extras={progress.postExtras}
        preMatched={progress.preMatched}
        onMatch={(tagId, photo) => matchPhoto('post', tagId, photo)}
        onAddExtra={(sid, photo) => addExtraPhoto('post', sid, photo)}
        onComplete={() => completeStep('post')}
        onBack={() => setOpenStep(null)}
      />

      <VerifyScopeStep
        visible={openStep === 'measure'}
        products={job.products ?? []}
        scope={progress.scope}
        jobPhotos={jobPhotos}
        onSetStatus={setScopeStatus}
        onReportDiscrepancy={(productId, issue, note, attachments) =>
          reportDiscrepancy.mutate({ productId, issue, note, attachments })
        }
        onComplete={() => completeStep('measure')}
        onBack={() => setOpenStep(null)}
      />

      <CoCStep
        visible={openStep === 'coc'}
        pages={progress.cocPages}
        onAddPage={addCocPage}
        onRemovePage={removeCocPage}
        onBack={() => setOpenStep(null)}
      />

      <ResultJobModal
        visible={!!resultType}
        result={resultType}
        submitting={submitResult.isPending}
        onClose={() => setResultType(null)}
        onConfirm={handleSubmitResult}
      />

      {/* Phone actions — Call / Text / Copy */}
      <Modal
        visible={showPhoneOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhoneOptions(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setShowPhoneOptions(false)}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: insets.bottom + 16,
            }}
          >
            <View
              style={{
                width: 40,
                height: 4,
                backgroundColor: colors.textSecondary,
                borderRadius: 2,
                alignSelf: 'center',
                marginBottom: 20,
                opacity: 0.3,
              }}
            />
            <TouchableOpacity onPress={handleCall} className="flex-row items-center py-4">
              <Feather name="phone-call" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>
                Call
              </Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.5 }} />
            <TouchableOpacity onPress={handleTextMessage} className="flex-row items-center py-4">
              <Feather name="message-square" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>
                Text Message
              </Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.5 }} />
            <TouchableOpacity onPress={handleCopyPhone} className="flex-row items-center py-4">
              <Feather name="copy" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>
                Copy Number
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
