import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import Feather from 'react-native-vector-icons/Feather';
import Ionicon from 'react-native-vector-icons/Ionicons';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import Clipboard from '@react-native-clipboard/clipboard';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { getRawPhoneNumber } from '../../utils/phone-util';
import { FlashMessage } from '../../config/message';
import { useInstallProgress } from '../../hooks/useInstallProgress';
import {
  useSubmitInstallerResult,
  useReportDiscrepancy,
  installerKeys,
} from '../../hooks/useInstallerJobs';
import { useInstallerActivityLog } from '../../hooks/useInstallerActivityLog';
import { useInstallerPhotoUpload } from '../../hooks/useInstallerPhotoUpload';
import { useAuth } from '../../hooks/useAuth';
import { persistActiveInstallerJob } from '../../utils/activity-log/installer-log';
import { InstallerService } from '../../services/api/installer';
import {
  buildCocStepData,
  buildPecStepData,
  buildPickupStepData,
  buildPostInstallStepData,
  buildPreInstallStepData,
  buildReturnStepData,
  buildScopeStepData,
  buildResetPatch,
  indexPhotosById,
  isEmptyPatch,
} from '../../utils/installer-step-data';
import { ConfirmActionModal } from '../../widgets/modals/installer/ConfirmActionModal';
import { InstallTimeline } from '../../widgets/components/installer/InstallTimeline';
import { JobReferenceCards } from '../../widgets/components/installer/JobReferenceCards';
import { ResultJobModal } from '../../widgets/modals/installer/ResultJobModal';
import { MapSelectionModal } from '../../widgets/common/modal/MapSelectionModal';
import { PdfPreviewModal } from '../../widgets/modals/PdfPreviewModal';
import { resolvePacketUrl } from '../../utils/installer-packet';
import { MaterialPhotoStep } from './steps/MaterialPhotoStep';
import { PECStep } from './steps/PECStep';
import { PhotoMatchStep } from './steps/PhotoMatchStep';
import { VerifyScopeStep } from './steps/VerifyScopeStep';
import { CoCStep } from './steps/CoCStep';
import {
  INSTALLER_RESULT_TYPES,
  INSTALLER_RESULT_REASONS,
  RESULT_COLORS,
  PHOTO_SECTIONS,
} from '../../constants/installer';
import { requiredTagIdsFromSections } from '../../utils/installer-photo-sections';
import { useRepPhotoSections } from '../../hooks/useRepPhotoSections';
import type { JobPhotoRef } from '../../widgets/modals/installer/DiscrepancyModal';
import type {
  CapturedPhoto,
  InstallerJob,
  InstallerJobPatch,
  InstallStepKey,
  InstallerResultType,
  PECArea,
  PhotoPhase,
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
    progressRef,
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
    patchPhoto,
    reset: resetProgress,
  } = useInstallProgress(job?._id ?? 'unknown', productIds, requiredPhotoTagIds);

  const submitResult = useSubmitInstallerResult();
  const reportDiscrepancy = useReportDiscrepancy(job?._id ?? '');
  const log = useInstallerActivityLog();
  const { user } = useAuth();
  const userId = user?._id || user?.id;
  const upload = useInstallerPhotoUpload(job?._id, patchPhoto);
  const queryClient = useQueryClient();

  const [openStep, setOpenStep] = useState<InstallStepKey | null>(null);
  const [resultType, setResultType] = useState<InstallerResultType | null>(null);
  const [showPhoneOptions, setShowPhoneOptions] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  /** Signed URL for the submission PDF — set only once the viewer should open. */
  const [packetUri, setPacketUri] = useState<string | null>(null);
  const [resolvingPacket, setResolvingPacket] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [completingJob, setCompletingJob] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resettingJob, setResettingJob] = useState(false);
  /** Set once the sign-off succeeds, so the button stays inert without a refetch. */
  const [justCompleted, setJustCompleted] = useState(false);

  // "Job opened" once per screen mount. The job is re-bound to the log context here
  // too, so a deep link or a back-navigation that skipped the dashboard still gives
  // the step screens their jobId / leadId.
  const openLogged = useRef(false);
  useEffect(() => {
    if (!job?._id || openLogged.current) return;
    openLogged.current = true;
    persistActiveInstallerJob(job);
    log.jobOpened(job, {
      readOnly: !!job.resulted,
      completedSteps: completedCount,
      totalSteps,
    });
  }, [job, completedCount, totalSteps, log]);

  /** Back to the schedule. The job isn't finished, so the session is paused. */
  const handleLeave = useCallback(() => {
    if (job?._id) log.jobPaused(job, { completedSteps: completedCount, totalSteps });
    navigation.goBack();
  }, [job, completedCount, totalSteps, log, navigation]);

  /** Opening a timeline step. Its status tells the portal whether it was a re-visit. */
  const handleOpenStep = useCallback(
    (step: InstallStepKey) => {
      log.stepOpened(step, stepStatus[step]);
      setOpenStep(step);
    },
    [log, stepStatus]
  );

  // ── Capture → S3 ──────────────────────────────────────────────────────────
  // Each capture lands in local progress first (so the tile appears instantly) and
  // is then uploaded to `installer/v1/{jobId}/images`. The upload writes its s3url
  // back onto the same photo, which is what the step-data PATCH below references.

  const handleMaterialPhoto = useCallback(
    (mode: 'pickup' | 'return', photo: CapturedPhoto) => {
      const index = progressRef.current[mode].photos.length + 1;
      addMaterialPhoto(mode, photo);
      upload.uploadMaterial(mode, photo, index);
    },
    [addMaterialPhoto, upload, progressRef]
  );

  const handlePecPhoto = useCallback(
    (area: PECArea, photo: CapturedPhoto) => upload.uploadPreExisting(area.label, photo),
    [upload]
  );

  const handleMatchPhoto = useCallback(
    (phase: PhotoPhase, tagId: string, photo: CapturedPhoto) => {
      // Read before the mutation: a tag that already holds a shot makes this a
      // retake, which logs `update` rather than `add`.
      const field = phase === 'pre' ? 'preMatched' : 'postMatched';
      const replacing = !!progressRef.current[field][tagId];

      matchPhoto(phase, tagId, photo);
      // The tag carries `repPhotoId` + `categoryLabel`, which become `salesPhotoId`
      // and `category` — the pairing the portal renders the before/after from.
      const tag = photoSections.flatMap((s) => s.tags).find((t) => t.id === tagId);
      if (tag) upload.uploadMatched(phase, tag, photo, replacing);
    },
    [matchPhoto, photoSections, upload, progressRef]
  );

  const handleExtraPhoto = useCallback(
    (phase: PhotoPhase, sectionId: string, photo: CapturedPhoto) => {
      addExtraPhoto(phase, sectionId, photo);
      const section = photoSections.find((s) => s.id === sectionId);
      if (section) upload.uploadExtra(phase, section, photo);
    },
    [addExtraPhoto, photoSections, upload]
  );

  // ── Step data → PATCH installer/v1/{jobId} ────────────────────────────────

  /** tagId → the rep photo it ghosts, so pre/post refs carry their `salesPhotoId`. */
  const repPhotoIdByTag = useMemo(() => {
    const map = new Map<string, string>();
    photoSections.forEach((s) =>
      s.tags.forEach((t) => {
        if (t.repPhotoId) map.set(t.id, t.repPhotoId);
      })
    );
    return map;
  }, [photoSections]);

  /**
   * Builds this step's slice of the patch body from the *current* progress.
   *
   * Reads `progressRef` rather than `progress` because completion handlers run in
   * the same tick as the mutation that satisfied the step (skipping the return,
   * confirming the last product), before React has re-rendered with it.
   */
  const buildStepData = useCallback(
    (step: InstallStepKey): InstallerJobPatch | null => {
      const current = progressRef.current;
      switch (step) {
        case 'pickup':
          return buildPickupStepData(current);
        case 'pec':
          return buildPecStepData(current, userId);
        case 'pre':
          return buildPreInstallStepData(current, repPhotoIdByTag);
        case 'measure':
          return buildScopeStepData(
            job?.products ?? [],
            current,
            indexPhotosById(current),
            userId
          );
        case 'post':
          return buildPostInstallStepData(current, repPhotoIdByTag);
        case 'coc':
          return buildCocStepData();
        case 'return':
          return buildReturnStepData(current);
        default:
          return null;
      }
    },
    [progressRef, job, userId, repPhotoIdByTag]
  );

  /**
   * Sends one step's data. In-flight uploads are drained first so a photo the PATCH
   * references always has its s3url. A step with nothing to send (Pickup, CoC — no
   * patchable field) resolves without a request.
   *
   * The body is flat — the server rejects a `stepData` wrapper — and `status` never
   * travels here; that is `updateJobStatus`'s job.
   */
  const sendStepData = useCallback(
    async (step: InstallStepKey) => {
      if (!job?._id) return;
      await upload.waitForUploads();

      const body = buildStepData(step);
      if (isEmptyPatch(body)) return;

      try {
        await InstallerService.updateJob(job._id, body!);
      } catch (err) {
        console.warn(`[InstallerJob] Failed to save "${step}" step data:`, err);
        FlashMessage.error(
          "Couldn't save this step",
          'Your work is stored on this device — reopen the step once you have signal.'
        );
      }
    },
    [job, upload, buildStepData]
  );

  /** Marks the step done locally, logs it, then pushes its data to the server. */
  const finishStep = useCallback(
    (step: InstallStepKey, logMeta: Record<string, any> = {}) => {
      completeStep(step);
      log.stepCompleted(step, logMeta);
      void sendStepData(step);
    },
    [completeStep, log, sendStepData]
  );

  // ── Job completion ────────────────────────────────────────────────────────

  const allStepsDone = completedCount === totalSteps;

  /**
   * Whether this job is already signed off — either it arrived that way (reopened
   * from the schedule, where resulted jobs open read-only) or it was completed on
   * this screen. Completing is a one-way transition, so the button reflects that
   * rather than offering a second, meaningless PATCH.
   */
  const isJobComplete =
    justCompleted ||
    !!job?.resulted ||
    String(job?.status ?? '').toLowerCase() === 'completed';

  /**
   * The installer's explicit sign-off: drains uploads, syncs the last of the step
   * data, then moves the job to `completed` via the status endpoint.
   *
   * Stays on the screen afterwards rather than navigating back, so the installer
   * sees the button go inert and knows the sign-off landed.
   */
  const handleConfirmComplete = useCallback(async () => {
    if (!job?._id || completingJob) return;
    setCompletingJob(true);
    try {
      await upload.waitForUploads();
      await InstallerService.completeJob(job._id, buildStepData('return') ?? undefined);
      log.jobCompleted(job, { completedSteps: completedCount, totalSteps });
      setJustCompleted(true);
      setShowCompleteConfirm(false);
      // Drop the cached schedule so the dashboard can't paint this job as live.
      // `completeJob` calls the service directly rather than through
      // `useUpdateJobStatus`, so nothing invalidates on its behalf.
      queryClient.invalidateQueries({ queryKey: installerKeys.all });
      FlashMessage.success('Job completed', 'Sent back to the Install Manager.');
    } catch (err) {
      console.warn('[InstallerJob] Failed to complete job:', err);
      FlashMessage.error(
        "Couldn't complete this job",
        'Check your connection and try again.'
      );
    } finally {
      setCompletingJob(false);
    }
  }, [
    job,
    completingJob,
    upload,
    buildStepData,
    log,
    completedCount,
    totalSteps,
    queryClient,
  ]);

  /**
   * Clears everything this visit recorded — every capture, note and selection —
   * locally and, as far as the allow-list permits, on the server.
   *
   * Used by the "Reset" result: the crew is coming back and starting over, so the
   * work from this visit must not carry into the next one. Never rejects; a failed
   * server wipe is reported but doesn't undo the local one.
   */
  const wipeJobData = useCallback(async () => {
    if (!job?._id) return;
    try {
      // Let any in-flight upload land first — otherwise it would resolve after the
      // wipe and re-attach an s3url to a photo that no longer exists.
      await upload.waitForUploads();
      resetProgress();
      await InstallerService.updateJob(job._id, buildResetPatch(job.products ?? [], userId));
      log.jobReset(job);
    } catch (err) {
      console.warn('[InstallerJob] Failed to clear job data:', err);
      // The local wipe already happened, so say so rather than implying nothing did.
      FlashMessage.error(
        'Reset saved on this device only',
        "The server copy couldn't be cleared — try again once you have signal."
      );
    }
  }, [job, upload, resetProgress, userId, log]);

  /**
   * Reset — clears the lead result so the job can be re-entered.
   *
   * Posts `{ status: 'Reset', reason }` like the other two results (the API requires
   * a reason on all three), then wipes the visit's work. The reason comes from the
   * picker inside the confirmation dialog, so there is no second popup.
   */
  const handleConfirmReset = useCallback(
    async (reason?: string) => {
      if (!job?._id || resettingJob || !reason) return;
      setResettingJob(true);
      try {
        await InstallerService.updateJobStatus(job._id, 'Reset', reason);
        log.resultSubmitted('Reset', reason);
        await wipeJobData();
        queryClient.invalidateQueries({ queryKey: installerKeys.all });
        setShowResetConfirm(false);
        FlashMessage.success('Lead result reset', 'The job can be re-entered.');
        navigation.goBack();
      } catch (err) {
        console.warn('[InstallerJob] Failed to reset lead result:', err);
        log.resultFailed('Reset', reason);
        FlashMessage.error('Could not reset this lead', 'Please try again.');
      } finally {
        setResettingJob(false);
      }
    },
    [job, resettingJob, wipeJobData, log, queryClient, navigation]
  );

  const handleCloseStep = useCallback(() => {
    if (openStep) log.stepClosed(openStep);
    // Pickup and Return self-satisfy on their first photo — there is no explicit
    // "done" action — so leaving the sub-screen is when their data is pushed.
    if (openStep === 'pickup' || openStep === 'return') void sendStepData(openStep);
    setOpenStep(null);
  }, [openStep, log, sendStepData]);

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

  /**
   * Sends the chosen result: `{ status, reason }` to `update-job-status`, where the
   * status is the transition the button maps to — `cancel` for Can't Do Work,
   * `pending` for Not Hit. Reset goes through `handleConfirmReset` instead.
   */
  const handleSubmitResult = (reason: string) => {
    const result = resultType!;

    submitResult.mutate(
      // The status IS the button label — `"Can't Do Work"` / `"Not Hit"` — and the
      // reason the installer picked is required alongside it.
      { jobId: job._id, result, status: result, reason },
      {
        onSuccess: () => {
          log.resultSubmitted(result, reason);
          FlashMessage.success('Job resulted', `${result} — ${reason}`);
          setResultType(null);
          navigation.goBack();
        },
        onError: () => {
          log.resultFailed(result, reason);
          FlashMessage.error('Could not result job', 'Please try again.');
        },
      }
    );
  };

  /**
   * Opens the rep's job submission PDF.
   *
   * The URL is only exchanged for a signed one on tap, not on every job open — most
   * installers never open the packet, and a signed URL expires in an hour anyway.
   */
  const handleViewPacket = async () => {
    if (resolvingPacket) return;
    log.packetViewed(job.packet?.fileName);
    setResolvingPacket(true);
    try {
      const url = await resolvePacketUrl(job.packet);
      if (url) setPacketUri(url);
      else FlashMessage.info('No packet yet', 'This job has no submission PDF attached.');
    } catch (err) {
      console.warn('[InstallerJob] Failed to resolve packet URL:', err);
      FlashMessage.error("Couldn't open the packet", 'Check your connection and try again.');
    } finally {
      setResolvingPacket(false);
    }
  };

  const handleOpenResult = (type: InstallerResultType) => {
    log.resultOpened(type);
    // Reset has nothing to explain, so it takes a plain confirmation rather than the
    // reason picker the other two results use.
    if (type === 'Reset') setShowResetConfirm(true);
    else setResultType(type);
  };

  const phone = job.customerDetails?.phone;

  const handleCall = () => {
    if (phone) {
      log.customerContact('call');
      Linking.openURL(`tel:${getRawPhoneNumber(phone)}`);
    }
    setShowPhoneOptions(false);
  };

  const handleTextMessage = () => {
    if (phone) {
      log.customerContact('text');
      Linking.openURL(`sms:${getRawPhoneNumber(phone)}`);
    }
    setShowPhoneOptions(false);
  };

  const handleCopyPhone = () => {
    if (phone) {
      log.customerContact('copy_number');
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
            onPress={handleLeave}
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
          {/* Photos are uploaded in the background — say so, so the installer knows
              there is still work in flight before they leave the job. */}
          {upload.uploadingCount > 0 && (
            <View className="flex-row items-center ml-auto">
              <ActivityIndicator size="small" color={colors.primary.main} />
              <Text
                className="ml-1.5 text-[11px] font-bold"
                style={{ color: colors.textSecondary }}
              >
                Uploading {upload.uploadingCount}
              </Text>
            </View>
          )}
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

            {/* Tapping the address offers Google / Apple Maps — same handoff the
                sales Lead Center uses, so a rep and an installer navigate the same way. */}
            <TouchableOpacity
              disabled={!job.fullAddress}
              onPress={() => {
                log.addressOpened(job.fullAddress);
                setShowMapModal(true);
              }}
              className="flex-row items-start mb-3"
            >
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
            </TouchableOpacity>
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
            onOpen={handleOpenStep}
          />

          {/* Sign-off — only once every step on the rail is satisfied. Goes inert
              (not hidden) after completion, so the state stays legible. */}
          {allStepsDone && (
            <TouchableOpacity
              disabled={isJobComplete || completingJob}
              onPress={() => setShowCompleteConfirm(true)}
              className="h-12 rounded-xl items-center justify-center flex-row mb-4"
              style={{
                backgroundColor: isJobComplete
                  ? colors.textSecondary + '33'
                  : colors.success.main,
              }}
            >
              <MaterialIcon
                name="check-decagram"
                size={18}
                color={isJobComplete ? colors.textSecondary : '#fff'}
              />
              <Text
                className="ml-2 text-base font-black tracking-wide"
                style={{ color: isJobComplete ? colors.textSecondary : '#fff' }}
              >
                Job Completed
              </Text>
            </TouchableOpacity>
          )}

          {/* Read-only reference */}
          <JobReferenceCards
            packet={job.packet}
            contract={job.contract}
            products={job.products}
            onViewPacket={handleViewPacket}
            packetLoading={resolvingPacket}
          />

          {/* Result actions */}
          <View className="flex-row mb-2.5" style={{ gap: 8 }}>
            {INSTALLER_RESULT_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => handleOpenResult(t)}
                className="flex-1 h-12 rounded-xl items-center justify-center"
                style={{ backgroundColor: RESULT_COLORS[t] }}
              >
                <Text className="text-white text-[13px] font-bold text-center">{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            onPress={() => {
              log.opsChatOpened();
              FlashMessage.info('Ops chat', 'Wire to the existing chat module when available.');
            }}
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
        onAddPhoto={(p) => handleMaterialPhoto('pickup', p)}
        onRemovePhoto={(id) => removeMaterialPhoto('pickup', id)}
        onSkip={() => {
          skipMaterial('pickup');
          handleCloseStep();
        }}
        onBack={handleCloseStep}
      />

      <MaterialPhotoStep
        visible={openStep === 'return'}
        mode="return"
        state={progress.return}
        onAddPhoto={(p) => handleMaterialPhoto('return', p)}
        onRemovePhoto={(id) => removeMaterialPhoto('return', id)}
        onSkip={() => {
          skipMaterial('return');
          handleCloseStep();
        }}
        onBack={handleCloseStep}
      />

      <PECStep
        visible={openStep === 'pec'}
        hasConditions={progress.pecHasConditions}
        entries={progress.pecEntries}
        onSetHasConditions={setPecHasConditions}
        onSetEntry={setPecEntry}
        onPhotoCaptured={handlePecPhoto}
        onComplete={() =>
          finishStep('pec', {
            areaCount: Object.keys(progress.pecEntries).length,
            hasConditions: progress.pecHasConditions,
          })
        }
        onBack={handleCloseStep}
      />

      <PhotoMatchStep
        visible={openStep === 'pre'}
        phase="pre"
        sections={photoSections}
        matched={progress.preMatched}
        extras={progress.preExtras}
        onMatch={(tagId, photo) => handleMatchPhoto('pre', tagId, photo)}
        onAddExtra={(sid, photo) => handleExtraPhoto('pre', sid, photo)}
        onComplete={() => finishStep('pre', { matched: requiredPhotoTagIds.length })}
        onBack={handleCloseStep}
      />

      <PhotoMatchStep
        visible={openStep === 'post'}
        phase="post"
        sections={photoSections}
        matched={progress.postMatched}
        extras={progress.postExtras}
        preMatched={progress.preMatched}
        onMatch={(tagId, photo) => handleMatchPhoto('post', tagId, photo)}
        onAddExtra={(sid, photo) => handleExtraPhoto('post', sid, photo)}
        onComplete={() => finishStep('post', { matched: requiredPhotoTagIds.length })}
        onBack={handleCloseStep}
      />

      <VerifyScopeStep
        visible={openStep === 'measure'}
        products={job.products ?? []}
        scope={progress.scope}
        jobPhotos={jobPhotos}
        onSetStatus={setScopeStatus}
        onReportDiscrepancy={(productId, issue, note, attachments) => {
          reportDiscrepancy.mutate({ productId, issue, note, attachments });
          // A flagged product leaves the step un-completable, so this is the only
          // chance to record `DISCREPANCY_FOUND`. Safe to fire here even though the
          // caller marks the product pending immediately after: `sendStepData`
          // awaits before reading progress, so that synchronous update lands first.
          void sendStepData('measure');
        }}
        onComplete={() => finishStep('measure', { productCount: productIds.length })}
        onBack={handleCloseStep}
      />

      <CoCStep
        visible={openStep === 'coc'}
        pages={progress.cocPages}
        onAddPage={addCocPage}
        onRemovePage={removeCocPage}
        onBack={handleCloseStep}
      />

      {/* Job submission PDF — reuses the app-wide viewer (download, zoom, retry). */}
      {!!packetUri && (
        <PdfPreviewModal
          visible={!!packetUri}
          uri={packetUri}
          title={job.packet?.fileName || 'Job Packet'}
          onClose={() => setPacketUri(null)}
        />
      )}

      {showMapModal && (
        <MapSelectionModal
          visible={showMapModal}
          address={job.fullAddress || ''}
          onClose={() => setShowMapModal(false)}
        />
      )}

      <ConfirmActionModal
        visible={showCompleteConfirm}
        icon="check-decagram"
        title="Job Completed?"
        description={
          "All 7 install steps are done. This marks the job complete and hands it back " +
          "to the Install Manager — you won't be able to change it from here."
        }
        submitting={completingJob}
        onCancel={() => setShowCompleteConfirm(false)}
        onConfirm={handleConfirmComplete}
      />

      <ConfirmActionModal
        visible={showResetConfirm}
        icon="alert"
        tone="danger"
        title="Reset Lead Result?"
        description={
          'Are you sure you want to reset this lead result? This will clear the ' +
          'current result and allow you to re-enter the lead.'
        }
        // The API requires a reason on every result, Reset included, so the picker
        // lives in this dialog rather than behind a second popup.
        reasons={INSTALLER_RESULT_REASONS.Reset}
        confirmLabel="Reset"
        submitting={resettingJob}
        onCancel={() => setShowResetConfirm(false)}
        onConfirm={handleConfirmReset}
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
