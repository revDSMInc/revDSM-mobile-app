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
  useReportDiscrepancy,
  installerKeys,
} from '../../hooks/useInstallerJobs';
import { useInstallerActivityLog } from '../../hooks/useInstallerActivityLog';
import { useInstallerPhotoUpload } from '../../hooks/useInstallerPhotoUpload';
import { useAuth } from '../../hooks/useAuth';
import { persistActiveInstallerJob } from '../../utils/activity-log/installer-log';
import { InstallerService } from '../../services/api/installer';
import ChatService from '../../services/api/ChatService';
import { LeadService } from '../../services/api/leads';
import { ENV } from '../../config/env';
import {
  mergeServerProgress,
  normalizeKey,
  storedPhotoAssets,
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
import {
  INSTALL_STEPS,
  INSTALLER_RESULT_TYPES,
  INSTALLER_RESULT_REASONS,
  RESULT_COLORS,
  RESULT_LABEL_KEY,
  RESULT_STATUS_CODE,
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
  InstallerJobPatch,
  InstallStepKey,
  InstallerResultType,
  PECArea,
  PhotoPhase,
  StatusReasonImage,
  StatusReasonPayload,
} from '../../config/types/installer';

/**
 * Fingerprint of a step body, used to skip a save that would repeat the last one.
 *
 * `checkedAt` / `reportedAt` are excluded: the builders stamp them fresh on every
 * call, so leaving them in would make every body look different and the guard would
 * never fire.
 */
const signatureOf = (body: InstallerJobPatch): string =>
  JSON.stringify(body, (key, value) =>
    key === 'checkedAt' || key === 'reportedAt' ? undefined : value
  );

/**
 * How long "Wait for uploads" holds the installer before handing the decision back.
 *
 * Long enough to cover a slow photo plus a retry; short enough that a crew walking away
 * from a dead cell is never left watching a spinner they cannot dismiss.
 */
const UPLOAD_WAIT_CAP_MS = 30000;

/**
 * Installer job detail — lead context, the install timeline, and read-only job
 * reference. Every timeline step opens as a full-screen sub-flow over this screen.
 */
export default function InstallerJobDetail() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const job: InstallerJob = route.params?.job;
  const productIds = useMemo(() => (job?.products ?? []).map((p) => p.id), [job]);

  // Pre-install tagger sections come from the rep's real capture set (rep photos
  // resolved to signed S3 URLs); the static mock is only a fallback for jobs that
  // carry no `preInstallPhotos`.
  const repSections = useRepPhotoSections(job?.preInstallPhotos);
  const hasRepPhotoSet = repSections.length > 0;
  const photoSections = hasRepPhotoSet ? repSections : PHOTO_SECTIONS;

  // A job whose `preInstallPhotos.products` is empty has no rep capture set, so the
  // tagger runs on the static stand-in and NO tag can ever show a reference shot.
  // Worth saying out loud — it reads on-device as "the images are broken".
  useEffect(() => {
    if (!__DEV__ || !job?._id || hasRepPhotoSet) return;
    console.warn(
      `[InstallerJob] Job ${job._id} returned no pre-install rep photos ` +
        `(preInstallPhotos.totalPhotos=${job.preInstallPhotos?.totalPhotos ?? 0}). ` +
        'Falling back to the static PHOTO_SECTIONS stand-in — reference shots will be ' +
        'empty and the photo steps run free-form.'
    );
  }, [job, hasRepPhotoSet]);

  /**
   * The shots the installer MUST match — and deliberately **empty when the job shipped
   * no rep photos**.
   *
   * It used to be derived from `photoSections`, which falls back to the static
   * `PHOTO_SECTIONS` stand-in. That stand-in claims `hasRep: true` on all 16 of its
   * placeholder tags, so a job with no rep capture set demanded 16 ghost-matches against
   * 16 references that do not exist — unsatisfiable busywork, and the reason the tagger
   * read "1/16 MATCHED" with nothing to match. With no rep set there is no defensible
   * required list, so the photo steps go free-form and one shot is enough
   * (`useInstallProgress` → `photoPhaseDone`).
   */
  const requiredPhotoTagIds = useMemo(
    () => (hasRepPhotoSet ? requiredTagIdsFromSections(photoSections) : []),
    [hasRepPhotoSet, photoSections]
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
    addResultPhoto,
    removeResultPhoto,
    clearResultPhotos,
    completeStep,
    patchPhoto,
    hydrate,
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
  /**
   * True from the moment Submit is tapped until the photo uploads have drained.
   *
   * `submitResult.isPending` only covers the request itself, which starts AFTER the
   * drain — so on a slow connection the sheet sat inert for the whole upload with no
   * spinner and no message, looking like the tap had been missed.
   */
  const [drainingUploads, setDrainingUploads] = useState(false);
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

  /**
   * Check-out — closes the work session the dashboard opened on check-in
   * (`PUT installer/v1/{id}/work` with `{ workStartedBy: null }`).
   *
   * Hangs off unmount rather than the back button so every way out of the job counts:
   * the header back, the hardware back, the swipe gesture, and the `goBack()` that
   * follows a result or a reset. Read-only opens — upcoming previews and resulted
   * jobs — never check in, so they must not check out either; the dashboard says which
   * is which via `checkedIn`. Mirrors the sales side's work / end-work pair in
   * `useLeadCenterData`.
   */
  const checkedIn = route.params?.checkedIn === true;
  useEffect(() => {
    const jobId = job?._id;
    if (!checkedIn || !jobId) return;
    return () => {
      InstallerService.endWork(jobId).catch((err) =>
        console.warn('[InstallerJob] Check-out failed:', err)
      );
    };
  }, [checkedIn, job?._id]);

  /**
   * Pulls what the server already holds for this job into the local timeline.
   *
   * The timeline is device-local, so without this a job worked from another phone —
   * or reopened after a reinstall — renders empty while its photos sit in the database.
   * Check-in returns the whole record on `job.stored`; the photos in it are bucket keys,
   * so they are exchanged for signed URLs first, in one batch.
   *
   * Safe to re-run: the merge adds only photos this device doesn't have and fills only
   * the answers it hasn't got, so nothing the installer entered is overwritten. It runs
   * again when `photoSections` resolves, which is what lets matched pre/post shots find
   * their slot (they key off the rep photo, which those sections carry).
   */
  const tagIdBySalesPhotoId = useMemo(() => {
    const map = new Map<string, string>();
    photoSections.forEach((section) =>
      section.tags.forEach((tag) => {
        if (tag.repPhotoId) map.set(tag.repPhotoId, tag.id);
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
            // Indexed by what the row echoes back AND by the key asked for at that
            // position — the endpoint is dependable positionally, and a mismatch in
            // either one still resolves.
            [row.filePath, row.s3url, assets[i]?.filePath].forEach((candidate) => {
              const key = normalizeKey(candidate);
              if (key) urls[key] = row.secureUrl;
            });
          });
        } catch (err) {
          // Non-photo state (conditions, scope, the return flag) still merges — a
          // failed URL exchange must not cost the whole hydrate.
          console.warn('[InstallerJob] Could not resolve stored photo URLs:', err);
        }
      }
      if (cancelled) return;
      hydrate((previous) =>
        mergeServerProgress(previous, stored, urls, { tagIdBySalesPhotoId })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [stored, hydrate, tagIdBySalesPhotoId]);

  // ── Leaving with uploads in flight ────────────────────────────────────────
  //
  // Leaving mid-upload LOSES the photo, even when the bytes reach S3.
  //
  // `patchPhoto` writes the returned `s3url` through `useInstallProgress.commit`, whose
  // `setProgress` is a no-op once this screen has unmounted — so the persist effect
  // never runs, MMKV keeps the shot as `uploadStatus: 'uploading'` for good, and the
  // step-data PATCH has no key to reference. The image sits in S3 attached to nothing.
  //
  // So the exits the installer drives are held until the queue drains. Programmatic
  // `goBack()`s are deliberately NOT intercepted (the result and reset flows own their
  // own exit and already drain first) — blocking those would strand a submitted result
  // on this screen.

  /** Open while the installer is being asked to wait for in-flight uploads. */
  const [showUploadGuard, setShowUploadGuard] = useState(false);
  const [waitingForUploads, setWaitingForUploads] = useState(false);

  /** Back to the schedule. The job isn't finished, so the session is paused. */
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

  /**
   * Waits the queue out, then leaves.
   *
   * **Capped at `UPLOAD_WAIT_CAP_MS`, and that cap is the point.** `waitForUploads`
   * does settle on its own — a photo either lands or exhausts its retries — but on a
   * dead cell that is three attempts against a 120 s request timeout, so the honest
   * worst case is minutes. `ConfirmActionModal` disables its cancel button while
   * `submitting`, so an uncapped wait would lock a crew who are packing up onto this
   * screen with no way out. On expiry the dialog simply returns to its idle state, with
   * "Leave anyway" live again and the choice back where it belongs.
   */
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
      // Still going. The uploads carry on in the background either way — this only
      // hands the decision back rather than holding them any longer.
      FlashMessage.info(
        'Still uploading',
        'This connection is slow. Keep waiting, or leave and retake the photos later.'
      );
      return;
    }

    setShowUploadGuard(false);
    leave();
  }, [upload, leave]);

  /**
   * The Android hardware back button — the same guard as the header arrow.
   *
   * `useFocusEffect` rather than a plain `useEffect`: the handler must be detached
   * while a step sheet or the packet viewer is on top, or this screen would answer a
   * back press meant for them.
   */
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

  /**
   * The iOS swipe-back gesture, which no button handler can intercept — it is turned
   * off outright while photos are in flight (the screen is registered with
   * `gestureEnabled: true` in `navigation/index.tsx`) and restored the moment the queue
   * drains. Without this, the one exit that skips both guards above is also the easiest
   * one to trigger by accident on a phone held in a work glove.
   */
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: uploadingCount === 0 });
  }, [navigation, uploadingCount]);

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

  /**
   * A scanned CoC page. Same shape as a material photo — into state first so the
   * thumbnail appears, then up to S3.
   *
   * The scanner emits several pages in one pass and calls this once per page, so the
   * index is read from `progressRef` (updated synchronously by `commit`) rather than
   * from `progress`, which would still be pre-render and number every page "1".
   */
  const handleCocPage = useCallback(
    (page: CapturedPhoto) => {
      const index = progressRef.current.cocPages.length + 1;
      addCocPage(page);
      upload.uploadCoc(page, index);
    },
    [addCocPage, upload, progressRef]
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

  // ── Step data → PATCH installer/v1/update/{jobId} ─────────────────────────

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

  /**
   * The last body each step successfully saved, so a step that closes right after it
   * completed doesn't PATCH the same thing twice. Only set on success — a failed save
   * stays "unsent" and is retried the next time the step is left.
   */
  const lastSentRef = useRef<Partial<Record<InstallStepKey, string>>>({});

  /**
   * Sends one step's data. In-flight uploads are drained first so a photo the PATCH
   * references always has its s3url. A step with nothing to send (Pickup, CoC — no
   * patchable field) resolves without a request.
   *
   * The builders return the inner `stepData` object — `InstallerService.updateJob`
   * wraps it — and `status` never travels on a step save; only the final sign-off and
   * the result actions set it.
   */
  const sendStepData = useCallback(
    async (step: InstallStepKey, options: StepDataOptions = {}) => {
      if (!job?._id) return;
      await upload.waitForUploads();

      const body = buildStepData(step, options);
      if (isEmptyPatch(body)) {
        // Never silent: "I left the step and nothing was sent" is otherwise
        // indistinguishable from a request that failed. The usual cause is a photo
        // whose upload hasn't produced an s3url, so there is nothing to reference yet.
        console.log(`[InstallerJob] "${step}" has nothing to save — request skipped`);
        return;
      }

      const signature = signatureOf(body!);
      if (lastSentRef.current[step] === signature) {
        console.log(`[InstallerJob] "${step}" unchanged since its last save — skipped`);
        return;
      }

      try {
        await InstallerService.updateJob(job._id, body!);
        lastSentRef.current[step] = signature;
      } catch (err: any) {
        // The body is logged alongside the error: when the server objects to the shape
        // rather than the connection, the payload is the only thing that explains why.
        console.warn(`[InstallerJob] Failed to save "${step}" step data:`, err, body);
        FlashMessage.error(
          "Couldn't save this step",
          err?.message ||
            'Your work is stored on this device — reopen the step once you have signal.'
        );
      }
    },
    [job, upload, buildStepData]
  );

  /**
   * Every step's data in one body, for the final sign-off.
   *
   * The steps were each saved as they were left, but the completion PATCH restates
   * all of them together — the installer's whole visit in one request — so the record
   * can't be left half-written by a step whose save was dropped on a bad connection.
   * The builders own disjoint keys, so merging them cannot clobber.
   */
  const buildAllStepsData = useCallback(
    (): InstallerJobPatch =>
      INSTALL_STEPS.reduce<InstallerJobPatch>((all, { key }) => {
        const data = buildStepData(key);
        return data ? { ...all, ...data } : all;
      }, {}),
    [buildStepData]
  );

  /**
   * Drops photos from the server — `DELETE installer/v1/{jobId}/images`.
   *
   * Only shots that actually reached S3 have anything to delete, so anything without an
   * `s3url` is filtered out (the service skips an empty list without a request).
   *
   * Never throws: the photo is already gone from the installer's screen, so a failed
   * delete must not surface as an error they cannot act on. The cost of a miss is an
   * orphaned S3 object, which is a cleanup problem, not a field problem.
   */
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

  /**
   * Removing a photo does two things on the server, in this order:
   *   1. `DELETE …/images` with its `s3url` — drops the stored object;
   *   2. the step-data PATCH, restating the set that is LEFT — drops the reference.
   * `includeEmptyPhotos` covers removing the last one: an empty array has to travel, or
   * the server would keep the photo the installer just deleted.
   *
   * Neither waits for the step to close: a deletion the installer can see happen should
   * be a deletion on the server before they walk away from signal.
   */
  const handleRemoveMaterialPhoto = useCallback(
    async (mode: 'pickup' | 'return', photoId: string) => {
      // An upload still in flight has no `s3url` yet, and dropping the photo from
      // state first would leave the upload's `patchPhoto` nothing to write it onto —
      // the object would land in S3 with nothing left pointing at it. So drain first
      // and read the s3url afterwards; the confirm dialog's spinner covers the wait.
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

  /**
   * Removing a pre-existing-condition photo.
   *
   * Unlike the material step, the whole ENTRY is the unit of state here, so the photo
   * is filtered out of its area's entry rather than dropped from a flat array. The area
   * stays flagged with its note intact — removing the shot is not un-flagging the
   * condition, and removing the last one correctly re-blocks Confirm until another is
   * taken.
   *
   * `buildPecStepData` restates every condition with its surviving photos nested, so
   * the PATCH needs no `includeEmptyPhotos` equivalent — an emptied area travels as an
   * empty `photos` array on its own.
   */
  const handleRemovePecPhoto = useCallback(
    async (area: PECArea, photo: CapturedPhoto) => {
      // Same reason as the material step: an in-flight upload has no s3url yet, and
      // it writes onto the copy in progress — not onto the snapshot PECStep handed us.
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

  /**
   * A result-evidence shot.
   *
   * Uploaded to S3 via the `result` phase so the s3url is available by the time
   * the installer submits the result. The s3url + bucketName travel inside the
   * `statusReason.images[]` payload.
   */
  const handleResultPhoto = useCallback(
    (reason: string, photo: CapturedPhoto) => {
      addResultPhoto(photo);
      upload.uploadResult(reason, photo);
    },
    [addResultPhoto, upload]
  );

  /**
   * Removing a result photo. Drains in-flight uploads first so the s3url can be
   * read for the server-side DELETE, then drops the local copy.
   */
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

  /**
   * Throws away result evidence that was never submitted.
   *
   * Shots taken under one result are not evidence for another, so switching from
   * Can't Do Work to Not Hit must not carry them over. Anything already in S3 is
   * deleted there too — it is referenced by no `statusReason`, so leaving it would
   * orphan the object. Photos belonging to a result the server ACCEPTED never reach
   * here: those are cleared locally on success, without a delete, because the job now
   * points at them.
   */
  const discardResultPhotos = useCallback(async () => {
    const pending = progressRef.current.resultPhotos ?? [];
    if (!pending.length) return;

    // Drain first, or an upload resolving after the wipe would put an s3url back on a
    // photo that no longer exists — and that object would never be deleted.
    await upload.waitForUploads();
    const uploaded = (progressRef.current.resultPhotos ?? []).filter((p) => !!p.s3url);
    clearResultPhotos();
    if (uploaded.length) await deleteStoredImages('result', uploaded);
  }, [progressRef, upload, clearResultPhotos, deleteStoredImages]);

  /** Removing a CoC page — identical to the material path now that pages are stored. */
  const handleRemoveCocPage = useCallback(
    async (pageId: string) => {
      const uploading =
        progressRef.current.cocPages.find((p) => p.id === pageId)?.uploadStatus ===
        'uploading';
      if (uploading) await upload.waitForUploads();

      const page = progressRef.current.cocPages.find((p) => p.id === pageId);
      removeCocPage(pageId);

      await deleteStoredImages('coc', [page]);
      await sendStepData('coc', { includeEmptyPhotos: true });
    },
    [progressRef, removeCocPage, upload, deleteStoredImages, sendStepData]
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
   * The sign-off button breathes while it is waiting to be pressed.
   *
   * It appears at the bottom of a long screen, in the middle of a stack of other
   * full-width buttons (the two result actions, Msg Ops), only after the seventh step
   * closes — a moment the installer's attention is on the step sheet they just
   * dismissed, not on the rail below it. The pulse is what says the last thing is now
   * available.
   *
   * Deliberately the SAME motion the sales LeadCard uses for its live card — a 1.03
   * scale over a 1 s in / 1 s out loop (`widgets/components/LeadCard.tsx`) — so the two
   * screens read as one app rather than inventing a second idea of "press this".
   *
   * It runs only while the button can actually be pressed: not once the job is signed
   * off (it goes inert and grey — animating it would promise an action that no longer
   * exists) and not mid-PATCH.
   */
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

    // Stopped on cleanup, not just when the flag flips: this screen unmounts straight
    // into the schedule on a result, and a loop left running holds the driver.
    return () => {
      loop.stop();
      completePulse.setValue(1);
    };
  }, [canCompleteJob, completePulse]);

  /**
   * The installer's explicit sign-off ("Yes" on the completion dialog): drains
   * uploads, PATCHes ALL 7 steps' data in one body, then moves the job to `completed`
   * via the status endpoint.
   *
   * Stays on the screen afterwards rather than navigating back, so the installer
   * sees the button go inert and knows the sign-off landed.
   */
  const handleConfirmComplete = useCallback(async () => {
    if (!job?._id || completingJob) return;
    setCompletingJob(true);
    try {
      await upload.waitForUploads();
      // Everything the visit recorded — all 7 steps merged — not just the last one.
      await InstallerService.completeJob(job._id, buildAllStepsData());
      log.jobCompleted(job, { completedSteps: completedCount, totalSteps });
      setJustCompleted(true);
      setShowCompleteConfirm(false);
      // Drop the cached schedule so the dashboard can't paint this job as live.
      // `completeJob` calls the service directly rather than through
      // `useUpdateJobStatus`, so nothing invalidates on its behalf.
      queryClient.invalidateQueries({ queryKey: installerKeys.all });
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
      // Forget what each step last sent — after a wipe, the next save must go out even
      // if the rebuilt body happens to match one from before the reset.
      lastSentRef.current = {};
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
   * Reset — clears this visit so the job can be re-entered.
   *
   * **Two routes, decided by the job's own state** (see `RESET_IN_PROGRESS_STATUS`):
   *
   *  - **completed / resulted** → `PUT installer/v1/{id}/reset` with `{ statusReason }`.
   *    There is a result to undo, and that endpoint is what reopens a closed job.
   *  - **still in progress** → the SAME path Can't Do Work and Not Hit take,
   *    `PUT installer/v1/update/{id}` with `{ status: 'reset', statusReason }`.
   *    Nothing has closed the job, so there is no result to reopen — asking the reset
   *    endpoint to undo one that was never recorded is what this fixes.
   *
   * The visit's work is wiped only AFTER the server accepts, so a failed reset leaves
   * the recorded work alone. The reason comes from the picker inside the confirmation.
   *
   * Images are optional for Reset — if result photos exist in progress (captured prior
   * to the reset), they are uploaded and included in `statusReason.images`.
   */
  const handleConfirmReset = useCallback(
    async (reason?: string) => {
      if (!job?._id || resettingJob || !reason) return;
      setResettingJob(true);

      // Drain any uploads and collect images if result photos exist.
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
          // A result exists — reopen it through the dedicated endpoint.
          await InstallerService.resetJob(job._id, statusReason);
        } else {
          // Nothing to reopen. Same mutation as the other two results, so it shares
          // their query invalidation and their error shape.
          await submitResult.mutateAsync({
            jobId: job._id,
            result: 'Reset',
            status: RESET_IN_PROGRESS_STATUS,
            reason: statusReason,
          });
        }

        log.resultSubmitted('Reset', reason);
        await wipeJobData();
        queryClient.invalidateQueries({ queryKey: installerKeys.all });
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

  /**
   * Leaving a step is a save point — whatever the installer entered is PATCHed on the
   * way out, for every one of the 7 steps, not only the ones with an explicit "done"
   * action. So a step backed out of half-finished still reaches the database.
   *
   * `sendStepData` skips a body identical to that step's last successful save, so a
   * step completed and then closed sends one request, not two.
   */
  const handleCloseStep = useCallback(() => {
    if (openStep) {
      log.stepClosed(openStep);
      void sendStepData(openStep);
    }
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

    /**
     * `required` is the phase's own denominator — the rep's set for pre, the pre pass's
     * own shots for post. Empty means free-form.
     */
    const matchNote = (
      required: string[],
      m: Record<string, unknown>,
      x: Record<string, unknown[]>
    ) => {
      // Free-form: no denominator to count against, so the rail reports what was taken
      // rather than a fraction of a demand that isn't being made. Extras count here for
      // the same reason they satisfy the step.
      if (!required.length) {
        const n =
          Object.keys(m).length +
          Object.values(x).reduce((sum, list) => sum + (list?.length ?? 0), 0);
        return n > 0 ? `${n} photo${n > 1 ? 's' : ''} taken` : null;
      }
      const n = required.filter((id) => m[id]).length;
      return n > 0 ? `${n}/${required.length} shots matched` : null;
    };

    const settled = productIds.filter((id) => progress.scope[id]?.state !== 'pending' && progress.scope[id]);
    const scopeNote = settled.length > 0 ? `${settled.length}/${productIds.length} settled` : null;

    return {
      pickup: materialNote('pickup'),
      return: materialNote('return'),
      pec: pecNote,
      pre: matchNote(requiredPhotoTagIds, progress.preMatched, progress.preExtras),
      // Post is measured against the pre pass — see `isStepDone('post')`.
      post: matchNote(
        Object.keys(progress.preMatched),
        progress.postMatched,
        progress.postExtras
      ),
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
   * Sends the chosen result — `PUT installer/v1/update/{id}` with
   * `{ status, statusReason }`.
   *
   * The status is the wire CODE, not the button label the installer read
   * (`RESULT_STATUS_CODE`). Reset never reaches here; it has its own endpoint, via
   * `handleConfirmReset`.
   *
   * Drains in-flight photo uploads first, collects every uploaded photo's s3url
   * into `statusReason.images`, then fires the status transition — so evidence is on
   * the job before it closes. A failed evidence upload does NOT block the result: the
   * installer needs to move on even if the network drops their last shot.
   */
  const handleSubmitResult = async (reason: string) => {
    const result = resultType!;
    const status = RESULT_STATUS_CODE[result as Exclude<InstallerResultType, 'Reset'>];
    if (!status) return;
    if (drainingUploads || submitResult.isPending) return;

    // Drain uploads so every photo that has started uploading has its s3url. The flag
    // is what puts the sheet's button into its loading state for the duration — this
    // is the slow half on a bad connection, not the request below.
    setDrainingUploads(true);
    try {
      await upload.waitForUploads();
    } finally {
      setDrainingUploads(false);
    }

    // Collect images that have an s3url (uploaded successfully).
    const images: StatusReasonImage[] = progressRef.current.resultPhotos
      .filter((p) => !!p.s3url)
      .map((p) => ({ s3url: p.s3url!, bucketName: p.bucketName }));

    // Every attached photo failed to reach S3. Submitting now would file a Can't Do
    // Work with no evidence behind it — the thing the modal makes mandatory — so say so
    // and let the installer retake rather than silently dropping the requirement.
    if (progressRef.current.resultPhotos.length > 0 && images.length === 0) {
      FlashMessage.error(
        "Photos didn't upload",
        'Remove and retake them once you have signal, then submit.'
      );
      return;
    }

    const statusReason: StatusReasonPayload = {
      reason,
      ...(images.length > 0 ? { images } : {}),
    };

    submitResult.mutate(
      { jobId: job._id, result, status, reason: statusReason },
      {
        onSuccess: () => {
          log.resultSubmitted(result, reason);
          // The s3urls are on the job's `statusReason` now, so the server holds the
          // record and these local copies are duplicates. Cleared WITHOUT a server
          // delete — the result references them. Leaving them behind is what made
          // Can't Do Work's photos reappear under Not Hit on the next open.
          clearResultPhotos();
          FlashMessage.success('Job resulted', `${result} — ${reason}`);
          setResultType(null);
          navigation.goBack();
        },
        onError: (err: any) => {
          log.resultFailed(result, reason);
          FlashMessage.error(
            'Could not result job',
            err?.message || 'Please try again.'
          );
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

  /**
   * Opens the job's chat — the shared LEAD thread, not an installer-only one.
   *
   * There is exactly one chat per lead and everybody is in it: the sales rep, ops and
   * installer managers, the lead installer and the crew. That is the point — the crew
   * can ask the rep a question and the office sees it. So this keys on **`job.leadId`,
   * never `job._id`** (CHAT-MOBILE-API.md §0); opening by job id would mint a second
   * thread for a lead that already has one.
   *
   * `chatId: ''` is the app's established "open by lead" form (LeadCenter and DealDetail
   * both use it) — `useChatSession` resolves the id from `leadId`, creating the chat if
   * the lead has none. Navigation is therefore instant rather than sitting behind a
   * round trip.
   *
   * The participant check runs in the BACKGROUND, after navigating: it costs two
   * requests and only affects badges and push, so making the installer watch a spinner
   * for it would be the wrong trade.
   */
  // A plain function, not a `useCallback`: everything from here down sits after the
  // `if (!job)` early return, so a hook here would be called conditionally.
  const handleOpenChat = () => {
    log.opsChatOpened();

    if (!job.leadId) {
      // A job with no lead behind it has no thread, and creating one would have nothing
      // to key on.
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

    // Reset has nothing to explain, so it takes a plain confirmation rather than the
    // reason picker the other two results use.
    if (type === 'Reset') {
      // Deliberately NOT discarded here: Reset has no camera of its own, and
      // `handleConfirmReset` documents that photos taken before the decision to reset
      // travel with it as `statusReason.images`. Whatever it takes, `wipeJobData`
      // clears straight afterwards.
      setShowResetConfirm(true);
      return;
    }

    // Evidence never crosses between the two capturing results: opening Not Hit with
    // shots taken for Can't Do Work still on hand would offer them as justification for
    // a result they have nothing to do with. Fire-and-forget — the modal opens now, and
    // the S3 cleanup behind it has nothing the installer needs to wait for.
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
          {/* Lead summary */}
          <View className="mb-2">
            <Text className="text-[15px] mb-2">
              <Text className="font-bold" style={{ color: colors.primary.main }}>
                {t('installer.leadId')}:{' '}
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
                <Ionicon name="call" size={15} color={colors.primary.main} />
                <Text className="ml-2 text-sm font-bold" style={{ color: colors.primary.main }}>
                  {phone || 'N/A'}
                </Text>
              </TouchableOpacity>
              <View className="flex-row items-center flex-1">
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
            // The scale lives on a wrapper rather than on the button itself: the margin
            // has to stay OUTSIDE the transform, or the gap to the next card would
            // breathe along with it.
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
                  // On a completed job Reset drops its in-flow amber for error red: it
                  // no longer nudges a live job along, it undoes a signed-off result.
                  // Nothing to clash with either — Can't Do Work is gone by then.
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
        onAddPage={handleCocPage}
        onRemovePage={handleRemoveCocPage}
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
        // A job still IN PROGRESS resets from a bottom sheet: the crew is mid-work, the
        // reason list is the substance of it, and a sheet keeps the job behind it in
        // view. A job already COMPLETED keeps the centred dialog — undoing a signed-off
        // result is the heavier decision and should interrupt.
        presentation={isJobComplete ? 'dialog' : 'sheet'}
        title="Reset Lead Result?"
        // The completed-job dialog spells out what Reset costs — it is wiping a result
        // that has already been signed off, and the title alone doesn't say that the
        // lead comes back for a re-run. The in-progress SHEET stays blurb-free: there
        // is no result to clear yet, and the copy would only push the reason list
        // further down the sheet.
        description={
          isJobComplete
            ? 'Are you sure you want to reset this lead result? This will clear the ' +
              'current result and allow you to re-enter the lead.'
            : undefined
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
        // Covers BOTH waits — the photo drain and the result request — so the button
        // never falls back to "Submit Result" in the gap between them.
        submitting={drainingUploads || submitResult.isPending}
        photos={progress.resultPhotos ?? []}
        uploadingCount={upload.uploadingCount}
        onPhotoCaptured={handleResultPhoto}
        onRemovePhoto={handleRemoveResultPhoto}
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
