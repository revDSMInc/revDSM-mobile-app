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
  Animated,
  BackHandler,
  AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import Feather from 'react-native-vector-icons/Feather';
import Ionicon from 'react-native-vector-icons/Ionicons';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import Clipboard from '@react-native-clipboard/clipboard';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../i18n/LanguageProvider';
import { getRawPhoneNumber } from '../../utils/phone-util';
import { FlashMessage } from '../../config/message';
import { useInstallProgress } from '../../hooks/useInstallProgress';
import {
  useSubmitInstallerResult,
  useSubmitStatusRequest,
  useReportDiscrepancy,
  staleInstallerJobs,
} from '../../hooks/useInstallerJobs';
import { useInstallerActivityLog } from '../../hooks/useInstallerActivityLog';
import { useInstallerPhotoUpload } from '../../hooks/useInstallerPhotoUpload';
import { useAuth } from '../../hooks/useAuth';
import { persistActiveInstallerJob } from '../../utils/activity-log/installer-log';
import { InstallerService } from '../../services/api/installer';
import {
  beginInstallerWorkSession,
  endInstallerWorkSession,
  getActiveInstallerWorkJobId,
} from '../../utils/installer-work-session';
import ChatService from '../../services/api/ChatService';
import { LeadService } from '../../services/api/leads';
import { ENV } from '../../config/env';
import {
  mergeServerProgress,
  normalizeKey,
  storedPhotoAssets,
  subcategoryKey,
  type SecureUrlMap,
} from '../../utils/installer-hydrate';
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
  type StepDataOptions,
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
import type { CoCFormData } from '../../widgets/modals/installer/CoCFormModal';
import {
  INSTALL_STEPS,
  INSTALLER_RESULT_TYPES,
  INSTALLER_RESULT_REASONS,
  RESULT_COLORS,
  RESULT_LABEL_KEY,
  RESULT_STATUS_REQUEST_TYPE,
  RESET_IN_PROGRESS_STATUS,
  PHOTO_SECTIONS,
} from '../../constants/installer';
import { requiredTagIdsFromSections } from '../../utils/installer-photo-sections';
import { useRepPhotoSections } from '../../hooks/useRepPhotoSections';
import type { JobPhotoRef } from '../../widgets/modals/installer/DiscrepancyModal';
import type {
  CapturedPhoto,
  InstallerDeletePhase,
  InstallerJob,
  CocSignatureRef,
  CocSignOff,
  InstallerJobPatch,
  InstallStepKey,
  InstallerResultType,
  PECArea,
  PhotoPhase,
  StatusReasonImage,
  StatusReasonPayload,
  StatusRequestImage,
  ProposedSchedulePayload,
} from '../../config/types/installer';

const signatureOf = (body: InstallerJobPatch): string =>
  JSON.stringify(body, (key, value) =>
    key === 'checkedAt' || key === 'reportedAt' ? undefined : value
  );

const UPLOAD_WAIT_CAP_MS = 30000;

const LEAD_SUMMARY_ACCENT = '#72BD00';

export default function InstallerJobDetail() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const job: InstallerJob = route.params?.job;
  const productIds = useMemo(() => (job?.products ?? []).map((p) => p.id), [job]);

  const repSections = useRepPhotoSections(job?.preInstallPhotos);
  const hasRepPhotoSet = repSections.length > 0;
  const photoSections = hasRepPhotoSet ? repSections : PHOTO_SECTIONS;

  useEffect(() => {
    if (!__DEV__ || !job?._id || hasRepPhotoSet) return;
    console.warn(
      `[InstallerJob] Job ${job._id} returned no pre-install rep photos ` +
        `(preInstallPhotos.totalPhotos=${job.preInstallPhotos?.totalPhotos ?? 0}). ` +
        'Falling back to the static PHOTO_SECTIONS stand-in — reference shots will be ' +
        'empty and the photo steps run free-form.'
    );
  }, [job, hasRepPhotoSet]);

  const requiredPhotoTagIds = useMemo(
    () => (hasRepPhotoSet ? requiredTagIdsFromSections(photoSections) : []),
    [hasRepPhotoSet, photoSections]
  );

  const {
    progress,
    progressRef,
    stepStatus,
    stepHasWork,
    isStepDone,
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
    rememberCocSignature,
    setCocSignOff,
    addResultPhoto,
    removeResultPhoto,
    clearResultPhotos,
    completeStep,
    patchPhoto,
    hydrate,
    reset: resetProgress,
  } = useInstallProgress(job?._id ?? 'unknown', productIds, requiredPhotoTagIds);

  const submitResult = useSubmitInstallerResult();
  const statusRequest = useSubmitStatusRequest();
  const reportDiscrepancy = useReportDiscrepancy(job?._id ?? '');
  const log = useInstallerActivityLog();
  const { user } = useAuth();
  const userId = user?._id || user?.id;
  const upload = useInstallerPhotoUpload(job?._id, patchPhoto);
  const queryClient = useQueryClient();

  const cocSignatureRefs = useRef<{
    installer?: CocSignatureRef;
    customer?: CocSignatureRef;
  }>({});
  const cocSignatureTasks = useRef<Promise<unknown>[]>([]);

  const [openStep, setOpenStep] = useState<InstallStepKey | null>(null);
  const [resultType, setResultType] = useState<InstallerResultType | null>(null);
  const [showPhoneOptions, setShowPhoneOptions] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [packetUri, setPacketUri] = useState<string | null>(null);
  const [resolvingPacket, setResolvingPacket] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [completingJob, setCompletingJob] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resettingJob, setResettingJob] = useState(false);
  const [drainingUploads, setDrainingUploads] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);

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

  const checkedIn = route.params?.checkedIn === true;
  useEffect(() => {
    const jobId = job?._id;
    if (!checkedIn || !jobId) return;
    return () => {
      void endInstallerWorkSession('left_job', jobId);
    };
  }, [checkedIn, job?._id]);

  useEffect(() => {
    const jobId = job?._id;
    if (!checkedIn || !jobId) return;

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        void endInstallerWorkSession('app_background', jobId);
        return;
      }
      if (state === 'active' && !getActiveInstallerWorkJobId()) {
        InstallerService.startWork(jobId)
          .then(() => beginInstallerWorkSession(jobId))
          .catch((err) => console.warn('[InstallerJob] Re-check-in failed:', err));
      }
    });
    return () => sub.remove();
  }, [checkedIn, job?._id]);

  const tagIdBySalesPhotoId = useMemo(() => {
    const map = new Map<string, string>();
    photoSections.forEach((section) =>
      section.tags.forEach((tag) => {
        if (tag.repPhotoId) map.set(tag.repPhotoId, tag.id);
      })
    );
    return map;
  }, [photoSections]);

  const tagIdBySubcategory = useMemo(() => {
    const map = new Map<string, string>();
    const ambiguous = new Set<string>();
    photoSections.forEach((section) =>
      section.tags.forEach((tag) => {
        [tag.id, tag.label].forEach((candidate) => {
          const key = subcategoryKey(candidate);
          if (!key || ambiguous.has(key)) return;
          const claimed = map.get(key);
          if (claimed && claimed !== tag.id) {
            map.delete(key);
            ambiguous.add(key);
            return;
          }
          map.set(key, tag.id);
        });
      })
    );
    return map;
  }, [photoSections]);

  const stored = job?.stored;
  useEffect(() => {
    if (!stored) return;
    const assets = storedPhotoAssets(stored, ENV.S3_BUCKET);

    let cancelled = false;
    (async () => {
      let urls: SecureUrlMap = {};
      if (assets.length > 0) {
        try {
          const res = await LeadService.getSecureUrls(assets);
          const rows: any[] = res.data?.data || res.data || [];
          (Array.isArray(rows) ? rows : []).forEach((row, i) => {
            if (!row?.secureUrl) return;
            [row.filePath, row.s3url, assets[i]?.filePath].forEach((candidate) => {
              const key = normalizeKey(candidate);
              if (key) urls[key] = row.secureUrl;
            });
          });
        } catch (err) {
          console.warn('[InstallerJob] Could not resolve stored photo URLs:', err);
        }
      }
      if (cancelled) return;
      hydrate((previous) =>
        mergeServerProgress(previous, stored, urls, {
          tagIdBySalesPhotoId,
          tagIdBySubcategory,
        })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [stored, hydrate, tagIdBySalesPhotoId, tagIdBySubcategory]);

  const [showUploadGuard, setShowUploadGuard] = useState(false);
  const [waitingForUploads, setWaitingForUploads] = useState(false);

  const leave = useCallback(() => {
    if (job?._id) log.jobPaused(job, { completedSteps: completedCount, totalSteps });
    navigation.goBack();
  }, [job, completedCount, totalSteps, log, navigation]);

  const handleLeave = useCallback(() => {
    if (upload.uploadingCount > 0) {
      setShowUploadGuard(true);
      return;
    }
    leave();
  }, [upload.uploadingCount, leave]);

  const handleWaitForUploads = useCallback(async () => {
    setWaitingForUploads(true);
    const timedOut = await Promise.race([
      upload.waitForUploads().then(() => false),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(true), UPLOAD_WAIT_CAP_MS)
      ),
    ]);
    setWaitingForUploads(false);

    if (timedOut) {
      FlashMessage.info(
        'Still uploading',
        'This connection is slow. Keep waiting, or leave and retake the photos later.'
      );
      return;
    }

    setShowUploadGuard(false);
    leave();
  }, [upload, leave]);

  const uploadingCount = upload.uploadingCount;
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (uploadingCount === 0) return false; // let the default back run
        setShowUploadGuard(true);
        return true;
      });
      return () => subscription.remove();
    }, [uploadingCount])
  );

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: uploadingCount === 0 });
  }, [navigation, uploadingCount]);

  const stepCompletionMeta = useCallback(
    (step: InstallStepKey): Record<string, any> => {
      const p = progressRef.current;
      switch (step) {
        case 'pickup':
          return { photos: p.pickup.photos.length, skipped: p.pickup.skipped };
        case 'return':
          return { photos: p.return.photos.length, skipped: p.return.skipped };
        case 'coc':
          return { pages: p.cocPages.length, signedOnDevice: !!p.cocSignOff };
        default:
          return {};
      }
    },
    [progressRef]
  );

  const handleOpenStep = useCallback(
    (step: InstallStepKey) => {
      log.stepOpened(step, stepStatus[step]);
      setOpenStep(step);
    },
    [log, stepStatus]
  );

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

  const handleCocPage = useCallback(
    (page: CapturedPhoto) => {
      const index = progressRef.current.cocPages.length + 1;
      addCocPage(page);
      return upload.uploadCoc(page, index).then((result) => result?.scan ?? null);
    },
    [addCocPage, upload, progressRef]
  );

  const handleCocSignature = useCallback(
    (photo: CapturedPhoto, who: 'installer' | 'customer') => {
      const task = upload.uploadCocSignature(photo, who).then((result) => {
        const patch = result?.patch;
        if (patch?.s3url) {
          cocSignatureRefs.current[who] = {
            s3url: patch.s3url,
            bucketName: patch.bucketName,
          };
          rememberCocSignature(patch.s3url);
        }
      });
      cocSignatureTasks.current.push(task);
    },
    [upload, rememberCocSignature]
  );


  const handleMatchPhoto = useCallback(
    (phase: PhotoPhase, tagId: string, photo: CapturedPhoto) => {
      const field = phase === 'pre' ? 'preMatched' : 'postMatched';
      const replacing = !!progressRef.current[field][tagId];

      matchPhoto(phase, tagId, photo);
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

  const repPhotoIdByTag = useMemo(() => {
    const map = new Map<string, string>();
    photoSections.forEach((s) =>
      s.tags.forEach((t) => {
        if (t.repPhotoId) map.set(t.id, t.repPhotoId);
      })
    );
    return map;
  }, [photoSections]);

  const buildStepData = useCallback(
    (step: InstallStepKey, options: StepDataOptions = {}): InstallerJobPatch | null => {
      const current = progressRef.current;
      switch (step) {
        case 'pickup':
          return buildPickupStepData(current, options);
        case 'pec':
          return buildPecStepData(current, userId);
        case 'pre':
          return buildPreInstallStepData(current, repPhotoIdByTag, options);
        case 'measure':
          return buildScopeStepData(
            job?.products ?? [],
            current,
            indexPhotosById(current),
            userId
          );
        case 'post':
          return buildPostInstallStepData(current, repPhotoIdByTag, options);
        case 'coc':
          return buildCocStepData(current, options);
        case 'return':
          return buildReturnStepData(current, options);
        default:
          return null;
      }
    },
    [progressRef, job, userId, repPhotoIdByTag]
  );

  const lastSentRef = useRef<Partial<Record<InstallStepKey, string>>>({});

  const sendStepData = useCallback(
    async (
      step: InstallStepKey,
      options: StepDataOptions = {}
    ): Promise<InstallerJob | null> => {
      if (!job?._id) return null;
      await upload.waitForUploads();

      const body = buildStepData(step, options);
      if (isEmptyPatch(body)) {
        console.log(`[InstallerJob] "${step}" has nothing to save — request skipped`);
        return null;
      }

      const signature = signatureOf(body!);
      if (lastSentRef.current[step] === signature) {
        console.log(`[InstallerJob] "${step}" unchanged since its last save — skipped`);
        return null;
      }

      try {
        const updated = await InstallerService.updateJob(job._id, body!);
        lastSentRef.current[step] = signature;
        return updated;
      } catch (err: any) {
        console.warn(`[InstallerJob] Failed to save "${step}" step data:`, err, body);
        FlashMessage.error(
          "Couldn't save this step",
          err?.message ||
            'Your work is stored on this device — reopen the step once you have signal.'
        );
      }
      return null;
    },
    [job, upload, buildStepData]
  );

  const buildAllStepsData = useCallback(
    (): InstallerJobPatch =>
      INSTALL_STEPS.reduce<InstallerJobPatch>((all, { key }) => {
        const data = buildStepData(key);
        return data ? { ...all, ...data } : all;
      }, {}),
    [buildStepData]
  );

  const handleCocSignOff = useCallback(
    async (data: CoCFormData) => {
      await Promise.all(cocSignatureTasks.current);
      cocSignatureTasks.current = [];

      const signOff: CocSignOff = {
        confirmations: {
          is18OrOlder: data.isAdult,
          isHomeownerOrAuthorized: data.isAuthorizedSigner,
          installationCompletedAsPerContract: data.installedPerContract,
        },
        customer: {
          relationshipType: data.relationship,
          otherRelationship: data.relationshipOther || null,
        },
        installerSignature:
          cocSignatureRefs.current.installer ??
          progressRef.current.cocSignOff?.installerSignature,
        customerSignature:
          cocSignatureRefs.current.customer ??
          progressRef.current.cocSignOff?.customerSignature,
        jobNumber: data.jobNumber,
        date: data.date,
        signedAt: data.signedAt,
        installerSignaturePaths: data.installerSignaturePaths,
        customerSignaturePaths: data.customerSignaturePaths,
        signatureSize: data.signatureSize,
      };
      setCocSignOff(signOff);

      const updated = await sendStepData('coc');
      if (updated?.cocPacket) setCocSignOff({ ...signOff, document: updated.cocPacket });
    },
    [sendStepData, setCocSignOff, progressRef]
  );

  const deleteStoredImages = useCallback(
    async (phase: InstallerDeletePhase, photos: (CapturedPhoto | undefined)[]) => {
      if (!job?._id) return;
      const s3urls = photos
        .map((photo) => photo?.s3url)
        .filter((url): url is string => !!url);
      if (s3urls.length === 0) return;

      try {
        await InstallerService.deleteImages(job._id, phase, s3urls);
      } catch (err) {
        console.warn(`[InstallerJob] Couldn't delete ${phase} image(s):`, err, s3urls);
      }
    },
    [job]
  );

  const handleRemoveMaterialPhoto = useCallback(
    async (mode: 'pickup' | 'return', photoId: string) => {
      const uploading =
        progressRef.current[mode].photos.find((p) => p.id === photoId)?.uploadStatus ===
        'uploading';
      if (uploading) await upload.waitForUploads();

      const photo = progressRef.current[mode].photos.find((p) => p.id === photoId);
      removeMaterialPhoto(mode, photoId);

      await deleteStoredImages(mode, [photo]);
      await sendStepData(mode, { includeEmptyPhotos: true });
    },
    [progressRef, removeMaterialPhoto, upload, deleteStoredImages, sendStepData]
  );

  const handleRemovePecPhoto = useCallback(
    async (area: PECArea, photo: CapturedPhoto) => {
      if (photo.uploadStatus === 'uploading') await upload.waitForUploads();

      const entry = progressRef.current.pecEntries[area.id];
      if (!entry) return;
      const stored = entry.photos.find((p) => p.id === photo.id) ?? photo;

      setPecEntry(area.id, {
        ...entry,
        photos: entry.photos.filter((p) => p.id !== photo.id),
      });

      await deleteStoredImages('preExisting', [stored]);
      await sendStepData('pec');
    },
    [progressRef, setPecEntry, upload, deleteStoredImages, sendStepData]
  );

  const handleResultPhoto = useCallback(
    (reason: string, photo: CapturedPhoto) => {
      addResultPhoto(photo);
      upload.uploadResult(reason, photo);
    },
    [addResultPhoto, upload]
  );

  const handleRemoveResultPhoto = useCallback(
    async (photo: CapturedPhoto) => {
      if (photo.uploadStatus === 'uploading') await upload.waitForUploads();
      const stored = progressRef.current.resultPhotos.find((p) => p.id === photo.id) ?? photo;
      removeResultPhoto(photo.id);
      if (stored.s3url) {
        await deleteStoredImages('result', [stored]);
      }
    },
    [removeResultPhoto, upload, progressRef, deleteStoredImages]
  );

  const discardResultPhotos = useCallback(async () => {
    const pending = progressRef.current.resultPhotos ?? [];
    if (!pending.length) return;

    await upload.waitForUploads();
    const uploaded = (progressRef.current.resultPhotos ?? []).filter((p) => !!p.s3url);
    clearResultPhotos();
    if (uploaded.length) await deleteStoredImages('result', uploaded);
  }, [progressRef, upload, clearResultPhotos, deleteStoredImages]);

  const completionLogged = useRef<Partial<Record<InstallStepKey, boolean>>>({});

  const finishStep = useCallback(
    (step: InstallStepKey, logMeta: Record<string, any> = {}) => {
      completeStep(step);
      log.stepCompleted(step, logMeta);
      completionLogged.current[step] = true;
      void sendStepData(step);
    },
    [completeStep, log, sendStepData]
  );

  const allStepsDone = completedCount === totalSteps;

  const isJobComplete =
    justCompleted ||
    !!job?.resulted ||
    String(job?.status ?? '').toLowerCase() === 'completed';

  const completePulse = useRef(new Animated.Value(1)).current;
  const canCompleteJob = allStepsDone && !isJobComplete && !completingJob;

  useEffect(() => {
    if (!canCompleteJob) {
      completePulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(completePulse, {
          toValue: 1.03,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(completePulse, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
      completePulse.setValue(1);
    };
  }, [canCompleteJob, completePulse]);

  const handleConfirmComplete = useCallback(async () => {
    if (!job?._id || completingJob) return;
    setCompletingJob(true);
    try {
      await upload.waitForUploads();
      await InstallerService.completeJob(job._id, buildAllStepsData());
      log.jobCompleted(job, { completedSteps: completedCount, totalSteps });
      setJustCompleted(true);
      setShowCompleteConfirm(false);
      staleInstallerJobs(queryClient);
      FlashMessage.success('Job completed', 'Sent back to the Install Manager.');
    } catch (err: any) {
      console.warn('[InstallerJob] Failed to complete job:', err);
      FlashMessage.error(
        "Couldn't complete this job",
        err?.message || 'Check your connection and try again.'
      );
    } finally {
      setCompletingJob(false);
    }
  }, [
    job,
    completingJob,
    upload,
    buildAllStepsData,
    log,
    completedCount,
    totalSteps,
    queryClient,
  ]);

  const wipeJobData = useCallback(async () => {
    if (!job?._id) return;
    try {
      await upload.waitForUploads();
      resetProgress();
      lastSentRef.current = {};
      await InstallerService.updateJob(job._id, buildResetPatch(job.products ?? [], userId));
      log.jobReset(job);
    } catch (err) {
      console.warn('[InstallerJob] Failed to clear job data:', err);
      FlashMessage.error(
        'Reset saved on this device only',
        "The server copy couldn't be cleared — try again once you have signal."
      );
    }
  }, [job, upload, resetProgress, userId, log]);

  const handleConfirmReset = useCallback(
    async (reason?: string) => {
      if (!job?._id || resettingJob || !reason) return;
      setResettingJob(true);

      await upload.waitForUploads();
      const images: StatusReasonImage[] = progressRef.current.resultPhotos
        .filter((p) => !!p.s3url)
        .map((p) => ({ s3url: p.s3url!, bucketName: p.bucketName }));

      const statusReason: StatusReasonPayload = {
        reason,
        ...(images.length > 0 ? { images } : {}),
      };

      try {
        if (isJobComplete) {
          await InstallerService.resetJob(job._id, statusReason);
        } else {
          await submitResult.mutateAsync({
            jobId: job._id,
            result: 'Reset',
            status: RESET_IN_PROGRESS_STATUS,
            reason: statusReason,
          });
        }

        log.resultSubmitted('Reset', reason);
        await wipeJobData();
        staleInstallerJobs(queryClient);
        setShowResetConfirm(false);
        FlashMessage.success('Lead result reset', 'The job can be re-entered.');
        navigation.goBack();
      } catch (err: any) {
        console.warn('[InstallerJob] Failed to reset lead result:', err);
        log.resultFailed('Reset', reason);
        FlashMessage.error(
          'Could not reset this lead',
          err?.message || 'Please try again.'
        );
      } finally {
        setResettingJob(false);
      }
    },
    [
      job,
      resettingJob,
      isJobComplete,
      submitResult,
      upload,
      progressRef,
      wipeJobData,
      log,
      queryClient,
      navigation,
    ]
  );

  const handleCloseStep = useCallback(() => {
    if (openStep) {
      if (!completionLogged.current[openStep] && isStepDone(openStep)) {
        log.stepCompleted(openStep, stepCompletionMeta(openStep));
        completionLogged.current[openStep] = true;
      }
      log.stepClosed(openStep);
      void sendStepData(openStep);
    }
    setOpenStep(null);
  }, [openStep, log, sendStepData, isStepDone, stepCompletionMeta]);

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

    const matchNote = (
      required: string[],
      m: Record<string, unknown>,
      x: Record<string, unknown[]>
    ) => {
      if (!required.length) {
        const n =
          Object.keys(m).length +
          Object.values(x).reduce((sum, list) => sum + (list?.length ?? 0), 0);
        return n > 0 ? `${n} photo${n > 1 ? 's' : ''} taken` : null;
      }
      const ids = Array.from(new Set([...required, ...Object.keys(m)]));
      const n = ids.filter((id) => m[id]).length;
      return n > 0 ? `${n}/${ids.length} shots matched` : null;
    };

    const settled = productIds.filter((id) => progress.scope[id]?.state !== 'pending' && progress.scope[id]);
    const scopeNote = settled.length > 0 ? `${settled.length}/${productIds.length} settled` : null;

    return {
      pickup: materialNote('pickup'),
      return: materialNote('return'),
      pec: pecNote,
      pre: matchNote(requiredPhotoTagIds, progress.preMatched, progress.preExtras),
      post: matchNote(
        Object.keys(progress.preMatched),
        progress.postMatched,
        progress.postExtras
      ),
      measure: scopeNote,
      coc: progress.cocSignOff
        ? 'Submitted'
        : progress.cocPages.length
        ? `${progress.cocPages.length} page${progress.cocPages.length > 1 ? 's' : ''} scanned`
        : null,
    };
  }, [progress, productIds, requiredPhotoTagIds]);

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

  const handleSubmitResult = async (
    reason: string,
    proposedSchedule?: ProposedSchedulePayload
  ) => {
    const result = resultType!;
    const requestType = RESULT_STATUS_REQUEST_TYPE[result];
    if (!requestType) return;
    if (drainingUploads || submitResult.isPending || statusRequest.isPending) return;

    const needsSchedule = result === 'Not Hit' || result === 'Reset';
    if (needsSchedule && !proposedSchedule?.date) return;

    const isStatusRequest = true;

    setDrainingUploads(true);
    try {
      await upload.waitForUploads();
    } finally {
      setDrainingUploads(false);
    }

    const uploaded = progressRef.current.resultPhotos.filter((p) => !!p.s3url);
    const images: StatusReasonImage[] = uploaded.map((p) => ({
      s3url: p.s3url!,
      bucketName: p.bucketName,
    }));
    const requestImages: StatusRequestImage[] = uploaded.map((p) => ({
      s3url: p.s3url!,
      bucketName: p.bucketName,
      timestampTaken: p.takenAt,
      coordinates: p.coordinates ?? null,
    }));

    if (progressRef.current.resultPhotos.length > 0 && images.length === 0) {
      FlashMessage.error(
        "Photos didn't upload",
        'Remove and retake them once you have signal, then submit.'
      );
      return;
    }

    const finish = (title: string, body: string) => {
      log.resultSubmitted(result, reason);
      clearResultPhotos();
      FlashMessage.success(title, body);
      setResultType(null);
      navigation.goBack();
    };

    const fail = (title: string) => (err: any) => {
      log.resultFailed(result, reason);
      FlashMessage.error(title, err?.message || 'Please try again.');
    };

    if (isStatusRequest) {
      statusRequest.mutate(
        {
          jobId: job._id,
          request: {
            reason,
            requestType,
            ...(needsSchedule && proposedSchedule ? { proposedSchedule } : {}),
            ...(requestImages.length > 0 ? { images: requestImages } : {}),
          },
        },
        {
          onSuccess: () =>
            finish('Request sent', `${reason} — the office will review it.`),
          onError: fail("Couldn't send request"),
        }
      );
    }
  };

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

  const handleOpenChat = () => {
    log.opsChatOpened();

    if (!job.leadId) {
      FlashMessage.info(
        'No chat for this job',
        "This job isn't linked to a lead yet, so there's no conversation to open. Call your Install Manager instead."
      );
      return;
    }

    navigation.navigate('ChatDetail', {
      leadId: job.leadId,
      chatId: '',
      customerName:
        [job.customerName, job.leadDisplayId && `Lead ${job.leadDisplayId}`]
          .filter(Boolean)
          .join(' · ') || 'Job Chat',
      chatType: 'lead',
    });

    if (userId) void ChatService.ensureParticipant(job.leadId, userId);
  };

  const handleOpenResult = (type: InstallerResultType) => {
    log.resultOpened(type);

    if (type === 'Reset' && isJobComplete) {
      setShowResetConfirm(true);
      return;
    }

    void discardResultPhotos();
    setResultType(type);
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
            {t('installer.leadCenter')}
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
          {/* Lead summary — typography is the SALES Lead Center's, deliberately.
              Font size (`text-base` / 16), family+weight (`font-semibold` → PublicSans-SemiBold)
              and colour (`LEAD_SUMMARY_ACCENT` on the labels/contact rows, `colors.text` on the
              values) are copied from `screens/LeadCenter/index.tsx`, so a rep and an installer
              read the same lead in the same type.
              ⚠️ The values here used to be `font-normal`, which resolves to NO fontFamily in this
              tailwind config — so half the block rendered in the SYSTEM font while sales rendered in
              Public Sans. Every line must sit on a named weight class. */}
          <View className="mb-2">
            <Text className="text-base font-semibold mb-2" style={{ color: LEAD_SUMMARY_ACCENT }}>
              {t('installer.leadId')}:{' '}
              <Text className="font-semibold" style={{ color: colors.text }}>
                {job.leadDisplayId || job.jobNumber || job.leadId || 'N/A'}
              </Text>
            </Text>

            <View className="flex-row items-center mb-2">
              <Ionicon name="person" size={14} color={LEAD_SUMMARY_ACCENT} />
              <Text className="ml-1 shrink text-base font-semibold" style={{ color: colors.text }}>
                {name || 'Customer'}
              </Text>
            </View>

            {/* Phone + email.
                Both halves are left-aligned columns with the same gap as the date/time
                row below, so all four icons line up down the card. The email used to be
                `justify-end`, which pinned it to the right edge — with a short value like
                "N/A" that left it floating in its own place, lining up with nothing. */}
            <View className="flex-row items-center mb-2" style={{ gap: 24 }}>
              <TouchableOpacity
                className="flex-row items-center"
                disabled={!phone}
                onPress={() => setShowPhoneOptions(true)}
              >
                <Ionicon name="call" size={14} color={LEAD_SUMMARY_ACCENT} />
                <Text
                  className="ml-1 text-base font-semibold"
                  style={{ color: LEAD_SUMMARY_ACCENT }}
                >
                  {phone || 'N/A'}
                </Text>
              </TouchableOpacity>
              <View className="flex-row items-center flex-1">
                <Ionicon name="mail" size={14} color={LEAD_SUMMARY_ACCENT} />
                <Text
                  numberOfLines={1}
                  className="ml-1 text-base font-semibold"
                  style={{ color: LEAD_SUMMARY_ACCENT }}
                >
                  {job.customerDetails?.email || 'N/A'}
                </Text>
              </View>
            </View>

            <View className="flex-row items-center mb-2" style={{ gap: 24 }}>
              <View className="flex-row items-center">
                <Ionicon name="calendar-clear" size={14} color={LEAD_SUMMARY_ACCENT} />
                <Text className="ml-1 text-base font-semibold" style={{ color: colors.text }}>
                  {job.leadDate ? format(new Date(job.leadDate), 'MM/dd/yyyy') : 'N/A'}
                </Text>
              </View>
              <View className="flex-row items-center flex-1">
                {/* Sales uses MaterialCommunityIcons `clock` here, not Ionicons `time-outline` —
                    the outline glyph reads lighter beside the filled calendar next to it. */}
                <MaterialIcon name="clock" size={14} color={LEAD_SUMMARY_ACCENT} />
                <Text
                  numberOfLines={1}
                  className="ml-1 text-base font-semibold"
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
                size={14}
                color={LEAD_SUMMARY_ACCENT}
                style={{ marginTop: 3 }}
              />
              <Text
                className="flex-1 ml-1 text-base font-semibold leading-6"
                style={{ color: LEAD_SUMMARY_ACCENT }}
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
            inProgress={stepHasWork}
            notes={stepNotes}
            completedCount={completedCount}
            totalSteps={totalSteps}
            onOpen={handleOpenStep}
          />

          {/* Sign-off — only once every step on the rail is satisfied. Goes inert
              (not hidden) after completion, so the state stays legible. */}
          {allStepsDone && (
            <Animated.View
              className="mb-4"
              style={{ transform: [{ scale: completePulse }] }}
            >
              <TouchableOpacity
                disabled={isJobComplete || completingJob}
                onPress={() => setShowCompleteConfirm(true)}
                className="h-12 rounded-xl items-center justify-center flex-row"
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
                  className="ml-2 text-base font-black tracking-wide text-center"
                  style={{ color: isJobComplete ? colors.textSecondary : '#fff' }}
                >
                  {t('installer.jobCompleted')}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Read-only reference */}
          <JobReferenceCards
            packet={job.packet}
            contract={job.contract}
            products={job.products}
            onViewPacket={handleViewPacket}
            packetLoading={resolvingPacket}
          />

          {/* Result actions.
              Once the job is done, Can't Do Work and Not Hit are gone — they would result
              a job that already carries a result. Only Reset survives, and it takes the
              full width. Nothing above this is touched: packet, contract, sold products
              and the timeline all stay readable. */}
          <View className="flex-row mb-2.5" style={{ gap: 8 }}>
            {(isJobComplete
              ? INSTALLER_RESULT_TYPES.filter((t) => t === 'Reset')
              : INSTALLER_RESULT_TYPES
            ).map((result) => (
              <TouchableOpacity
                key={result}
                onPress={() => handleOpenResult(result)}
                className="flex-1 h-12 rounded-xl items-center justify-center"
                style={{
                  backgroundColor:
                    isJobComplete && result === 'Reset'
                      ? colors.error.main
                      : RESULT_COLORS[result],
                }}
              >
                <Text className="text-white text-[13px] font-bold text-center">
                  {t(RESULT_LABEL_KEY[result])}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            onPress={handleOpenChat}
            className="h-12 rounded-xl items-center justify-center flex-row"
            style={{ backgroundColor: colors.info.main }}
          >
            <MaterialIcon name="message-text" size={16} color="#fff" />
            <Text className="text-white ml-2 text-base font-black tracking-wide text-center">
              {t('installer.msgOps')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

      {/* ── Timeline sub-flows ─────────────────────────────────────────────── */}

      <MaterialPhotoStep
        visible={openStep === 'pickup'}
        mode="pickup"
        state={progress.pickup}
        onAddPhoto={(p) => handleMaterialPhoto('pickup', p)}
        onRemovePhoto={(id) => handleRemoveMaterialPhoto('pickup', id)}
        onSkip={() => {
          skipMaterial('pickup');
          handleCloseStep();
        }}
        onDone={handleCloseStep}
        onBack={handleCloseStep}
      />

      <MaterialPhotoStep
        visible={openStep === 'return'}
        mode="return"
        state={progress.return}
        onAddPhoto={(p) => handleMaterialPhoto('return', p)}
        onRemovePhoto={(id) => handleRemoveMaterialPhoto('return', id)}
        onSkip={() => {
          skipMaterial('return');
          handleCloseStep();
        }}
        onDone={handleCloseStep}
        onBack={handleCloseStep}
      />

      <PECStep
        visible={openStep === 'pec'}
        hasConditions={progress.pecHasConditions}
        entries={progress.pecEntries}
        onSetHasConditions={setPecHasConditions}
        onSetEntry={setPecEntry}
        onPhotoCaptured={handlePecPhoto}
        onRemovePhoto={handleRemovePecPhoto}
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
        freeform={!hasRepPhotoSet}
        matched={progress.preMatched}
        extras={progress.preExtras}
        onMatch={(tagId, photo) => handleMatchPhoto('pre', tagId, photo)}
        onAddExtra={(sid, photo) => handleExtraPhoto('pre', sid, photo)}
        onComplete={() =>
          finishStep('pre', { matched: Object.keys(progress.preMatched).length })
        }
        onBack={handleCloseStep}
      />

      <PhotoMatchStep
        visible={openStep === 'post'}
        phase="post"
        sections={photoSections}
        freeform={!hasRepPhotoSet}
        matched={progress.postMatched}
        extras={progress.postExtras}
        preMatched={progress.preMatched}
        onMatch={(tagId, photo) => handleMatchPhoto('post', tagId, photo)}
        onAddExtra={(sid, photo) => handleExtraPhoto('post', sid, photo)}
        onComplete={() =>
          finishStep('post', { matched: Object.keys(progress.postMatched).length })
        }
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
          void sendStepData('measure');
        }}
        onComplete={() => finishStep('measure', { productCount: productIds.length })}
        onBack={handleCloseStep}
      />

      <CoCStep
        visible={openStep === 'coc'}
        job={job}
        pages={progress.cocPages}
        document={progress.cocSignOff?.document ?? job.cocPacket}
        onAddPage={handleCocPage}
        onSignature={handleCocSignature}
        onSignOff={handleCocSignOff}
        signOff={progress.cocSignOff}
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

      {/* The leave guard. Presented as a dialog, not a sheet: it interrupts an exit the
          installer has already asked for, so it has to sit in the middle of the screen
          with nowhere to tap but its two buttons.

          "Leave anyway" is deliberately still offered. The wait is bounded, but a crew
          packing up on a dead cell must never be held on a screen by an upload that
          cannot succeed — the description says plainly what leaving costs. */}
      <ConfirmActionModal
        visible={showUploadGuard}
        icon="cloud-upload-outline"
        title={
          uploadingCount === 1
            ? '1 photo is still uploading'
            : `${uploadingCount} photos are still uploading`
        }
        description={
          'Leave now and they lose their link to this job — the shots stay on the ' +
          'phone but never attach to the install record. It only takes a moment.'
        }
        confirmLabel="Wait for uploads"
        cancelLabel="Leave anyway"
        submitting={waitingForUploads}
        onCancel={() => {
          setShowUploadGuard(false);
          leave();
        }}
        onConfirm={handleWaitForUploads}
      />

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
        presentation={isJobComplete ? 'dialog' : 'sheet'}
        title="Reset Lead Result?"
        description={
          isJobComplete
            ? 'Are you sure you want to reset this lead result? This will clear the ' +
              'current result and allow you to re-enter the lead.'
            : undefined
        }
        reasons={INSTALLER_RESULT_REASONS.Reset}
        confirmLabel="Reset"
        submitting={resettingJob}
        onCancel={() => setShowResetConfirm(false)}
        onConfirm={handleConfirmReset}
      />

      <ResultJobModal
        visible={!!resultType}
        result={resultType}
        submitting={drainingUploads || submitResult.isPending || statusRequest.isPending}
        photos={progress.resultPhotos ?? []}
        uploadingCount={upload.uploadingCount}
        onPhotoCaptured={handleResultPhoto}
        onRemovePhoto={handleRemoveResultPhoto}
        customerName={job.customerName || ''}
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
