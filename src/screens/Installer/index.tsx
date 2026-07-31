import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MaterialDesignIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../i18n/LanguageProvider';
import { FlashMessage } from '../../config/message';
import { useInstallerJobs, useUpdateJobStatus } from '../../hooks/useInstallerJobs';
import { useAuth } from '../../hooks/useAuth';
import { useUserRole } from '../../hooks/useUserRole';
import { useInstallerActivityLog } from '../../hooks/useInstallerActivityLog';
import { persistActiveInstallerJob } from '../../utils/activity-log/installer-log';
import { InstallerJobCard } from '../../widgets/components/installer/InstallerJobCard';
import {
  InstallerService,
  mergeInstallerJob,
  type JobPeriod,
} from '../../services/api/installer';
import {
  CHECK_IN_RADIUS_METERS,
  resolveCheckInEligibility,
} from '../../utils/installer-geofence';
import { isFutureDatedJob } from '../../utils/installer-schedule';
import type {
  InstallerCheckInPayload,
  InstallerJob,
} from '../../config/types/installer';

/** Shown when the session belongs to someone else and the server sent no wording. */
const HELD_BY_OTHER_MESSAGE =
  'This job is already checked in by another crew member. You can check in once they check out.';

/**
 * True when `PUT installer/v1/{id}/work` was refused because ANOTHER crew member
 * holds the job's open work session:
 *
 *   { code: 409, message: "…already checked in by another crew member…",
 *     data: { alreadyCheckedIn: true, workStartedBy: "<userId>" } }
 *
 * `workStartedBy` has to be someone else. The same endpoint 409s when OUR OWN session
 * is still open — the app was killed, or signal dropped before the check-out landed —
 * and treating that as a lock would strand an installer outside their own job with no
 * way back in.
 */
const isHeldByAnotherCrew = (err: any, userId?: string): boolean => {
  const heldBy = err?.data?.workStartedBy;
  const conflict =
    err?.code === 409 || err?.httpStatus === 409 || err?.data?.alreadyCheckedIn === true;
  return !!(conflict && heldBy && heldBy !== userId);
};

/**
 * Installer dashboard — the signed-in installer's schedule.
 *
 * Landing screen for users holding the `installer_dashboard` permission
 * (see `useUserRole` + the role-aware initial route in `src/navigation`).
 */
export default function InstallerDashboard() {
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { installerCompanyName } = useUserRole();
  const { user } = useAuth();
  const userId = user?._id || user?.id;
  const [period, setPeriod] = useState<JobPeriod>('all');
  const [startingId, setStartingId] = useState<string | null>(null);
  const { jobs, summaryCounts, loading, isError, refreshing, refresh } =
    useInstallerJobs(period);
  const updateStatus = useUpdateJobStatus();
  const log = useInstallerActivityLog();

  // Header count prefers the API's own total (paginated lists can be shorter).
  const jobCount = summaryCounts?.total ?? jobs.length;
  // The API stamps the company on each job; the profile field is the fallback.
  const companyName = installerCompanyName || jobs[0]?.companyName;

  // One "schedule viewed" per period, once its jobs have actually landed — logging
  // during the loading pass would report a count of 0 for every open.
  const viewedPeriods = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (loading || viewedPeriods.current[period]) return;
    viewedPeriods.current[period] = true;
    log.dashboardViewed({ period, jobCount, companyName });
  }, [loading, period, jobCount, companyName, log]);

  /**
   * Re-fetch the schedule every time the installer comes back to it.
   *
   * A job's status changes while they are inside it — started, resulted, completed —
   * and `my-jobs` is the only thing that knows the new state, so returning has to hit
   * the endpoint again rather than render the five-minute-stale cache. The first
   * focus is skipped: the query is already fetching on mount, and refetching there
   * would just double the request.
   */
  const hasFocused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocused.current) {
        hasFocused.current = true;
        return;
      }
      refresh();
    }, [refresh])
  );

  const handlePeriodChange = (next: JobPeriod) => {
    if (next === period) return;
    log.periodChanged(next);
    setPeriod(next);
  };

  const handleRefresh = () => {
    log.jobsRefreshed(period);
    refresh();
  };

  /**
   * Opens a job. Today's live jobs are *started* first — the API flips them to
   * `inProgress` and answers with the working payload (contract + the rep's
   * pre-install photos), which exists nowhere else, so the card holds a spinner
   * until it lands and the detail screen opens with real data.
   *
   * Two gates, and they answer different questions:
   *
   *  - **WHEN** (`utils/installer-schedule.ts`) — today or any earlier date opens; a
   *    future-dated job does not, it only says when the crew is due. Decided by the job's
   *    OWN date, not by which tab it was tapped in, so an upcoming job is refused even if
   *    "All" happens to list it.
   *  - **WHERE** (`utils/installer-geofence.ts`) — within `CHECK_IN_RADIUS_METERS` of the
   *    address or of a company office. Runs before anything is sent, so a refusal costs no
   *    request and never flips the job to `inProgress`.
   *
   * An already-resulted job skips both: the visit is over, so it opens read-only for
   * review with no status change and no geofence — nobody is claiming to be on site. It is
   * still FETCHED, through the same `PUT installer/v1/{id}/work` (it is what answers with
   * the full payload), because nothing on this screen is served from local storage.
   */
  const openJob = async (job: InstallerJob) => {
    // Bind the job to the log context first so every downstream installer event —
    // including the start call below — carries its jobId / leadId / customer.
    // The "opened" event itself is logged by the detail screen, as a check-in or a
    // resume; logging the tap here too would double it.
    persistActiveInstallerJob(job);

    // Review comes first: a resulted job is readable whatever its date.
    const readOnly = !!job.resulted;

    // ── WHEN ──────────────────────────────────────────────────────────────────
    // Not due yet. Refused outright rather than opened read-only: there is nothing to
    // review on a visit that hasn't happened, and the message says when to come back.
    if (!readOnly && isFutureDatedJob(job)) {
      const scheduled = job.leadDate ? new Date(job.leadDate) : null;
      const dateLabel =
        scheduled && !Number.isNaN(scheduled.getTime())
          ? format(scheduled, 'MM/dd/yyyy')
          : null;

      log.jobStartFailed(job, new Error('Job is scheduled for a future date'));
      FlashMessage.info(
        t('installer.notYetTitle'),
        dateLabel
          ? t('installer.notYetBody', { date: dateLabel })
          : t('installer.notYetBodyNoDate')
      );
      return;
    }

    if (readOnly) {
      if (startingId) return;
      // Read-only still has to LOAD. The list row carries no contract, no sold products,
      // no packet and no install record, and nothing on this screen is served from local
      // storage — so a review that skipped the request would open empty.
      //
      // `{jobId}/work` is what answers with all of it. No geofence payload goes with it:
      // this is a review, not a claim to be standing at the job, and the server should
      // not be asked to validate a position nobody is reporting. The session it opens is
      // closed again on the way out — `checkedIn` is what tells the detail screen to.
      setStartingId(job._id);
      try {
        const full = await InstallerService.startWork(job._id);
        const merged = full ? mergeInstallerJob(job, full) : job;
        persistActiveInstallerJob(merged);
        navigation.navigate('InstallerJobDetail', { job: merged, checkedIn: true });
      } catch (err: any) {
        // Held by another crew member — refused here exactly as a live check-in is.
        // A review opens a real work session on the server (that is what this call
        // does), so letting it through would put two people in one job's session and
        // the second one's exit would check the first one out.
        if (isHeldByAnotherCrew(err, userId)) {
          log.jobStartFailed(job, err);
          FlashMessage.error('Already checked in', err?.message || HELD_BY_OTHER_MESSAGE);
          return;
        }

        // Anything else (offline, 5xx) still opens on the thin list row — being unable
        // to read a finished job over a dropped connection would be the worse outcome.
        console.warn('[InstallerJob] Could not load the resulted job:', err);
        FlashMessage.error(
          "Couldn't load this job",
          err?.message || 'Check your connection and try again.'
        );
        navigation.navigate('InstallerJobDetail', { job });
      } finally {
        setStartingId(null);
      }
      return;
    }
    if (startingId) return;

    setStartingId(job._id);

    // ── Geofence ───────────────────────────────────────────────────────────────
    // Waiting on a GPS fix is why the card spinner starts before this rather than
    // after: on a cold fix this is the slowest part of opening a job.
    let eligibility;
    try {
      eligibility = await resolveCheckInEligibility(job, user);
    } catch (err) {
      // A crash in the gate must not become a lockout — the backend re-checks the
      // same radius from the payload below, so failing open here is recoverable
      // while failing closed leaves a crew stuck on site with no way in.
      console.warn('[InstallerJob] Geofence check failed, allowing check-in:', err);
      eligibility = null;
    }

    if (eligibility && !eligibility.allowed) {
      // An Error, not a plain object: the logger only reads `.message` off an Error
      // instance, so anything else would record the refusal with no reason attached.
      log.jobStartFailed(job, new Error(eligibility.reason));
      // The heading comes from the gate: location switched off is not "too far".
      FlashMessage.error(eligibility.title || 'Cannot check in', eligibility.reason);
      setStartingId(null);
      return;
    }

    // Where the tap happened, for the server's own check. Omitted when the gate let
    // this through without a fix (job with no coordinates and no locatable office).
    const checkInPayload: InstallerCheckInPayload | undefined = eligibility?.coords
      ? {
          address: job.fullAddress,
          location: {
            type: 'Point',
            coordinates: [eligibility.coords.longitude, eligibility.coords.latitude],
          },
          radius: CHECK_IN_RADIUS_METERS,
        }
      : undefined;

    // Check in FIRST — this tap is the check-in, so `PUT installer/v1/{id}/work`
    // goes out before anything that can fail on its own. It answers with the
    // full working job (contract, sold products, rep photos, packet), which is what the
    // detail screen renders.
    let checkedIn = true;
    let checkInJob: InstallerJob | null = null;
    try {
      checkInJob = await InstallerService.startWork(job._id, checkInPayload);
    } catch (err: any) {
      // 409 — the job already holds an open work session:
      //   { code: 409, message: "…already checked in by another crew member…",
      //     data: { alreadyCheckedIn: true, workStartedBy: "<userId>" } }
      const alreadyOpen =
        err?.code === 409 || err?.httpStatus === 409 || err?.data?.alreadyCheckedIn === true;

      if (isHeldByAnotherCrew(err, userId)) {
        // Someone else is on this job. Hard stop — two crews must not work one job,
        // and the job must NOT be flipped to inProgress on their behalf. The server's
        // own wording is shown, since it names the condition better than we can.
        log.jobStartFailed(job, err);
        FlashMessage.error('Already checked in', err?.message || HELD_BY_OTHER_MESSAGE);
        setStartingId(null);
        return;
      }

      // 403 — the server ran the geofence on the payload above and refused. It is the
      // authority on this, so its verdict overrides the on-device check that just
      // passed (a spoofed fix clears the client gate and nothing else). Hard stop,
      // with the server's own wording.
      if (err?.httpStatus === 403 || err?.code === 403) {
        log.jobStartFailed(job, err);
        FlashMessage.error(
          'Too far to check in',
          err?.message || 'Head to the job site to check in.'
        );
        setStartingId(null);
        return;
      }

      if (alreadyOpen) {
        // OUR OWN session is still open — the app was killed, or the phone lost signal
        // before the check-out landed. That is not a failure: carry on into the job and
        // keep `checkedIn` so leaving still closes it. Blocking here would lock an
        // installer out of their own job with no way back in.
        console.warn('[InstallerJob] Work session was already open for this installer.');
      } else {
        // Anything else (offline, 5xx): the installer is on site regardless, so the
        // job still opens — only the check-out on the way back is skipped.
        checkedIn = false;
        console.warn('[InstallerJob] Check-in failed:', err);
      }
    }

    // What check-in gave us, layered over the list row it was opened from.
    const afterCheckIn = checkInJob ? mergeInstallerJob(job, checkInJob) : job;

    try {
      const started = await updateStatus.mutateAsync({ jobId: job._id, status: 'inProgress' });
      // The transition endpoint isn't contracted to answer with the job, so anything it
      // does send is layered on; the check-in payload is what the screen really runs on.
      const merged = started ? mergeInstallerJob(afterCheckIn, started) : afterCheckIn;
      persistActiveInstallerJob(merged);
      log.jobStarted(merged);
      navigation.navigate('InstallerJobDetail', { job: merged, checkedIn });
      return;
    } catch (err: any) {
      // Check-in already returned the working payload, so a failed status transition
      // is not a dead end — the installer goes in on the check-in data rather than
      // being held out of a job they are standing at. Only logged, no banner.
      if (checkInJob) {
        console.warn(
          '[InstallerJob] Status transition failed; opening on the check-in payload:',
          err
        );
        persistActiveInstallerJob(afterCheckIn);
        log.jobStarted(afterCheckIn);
        navigation.navigate('InstallerJobDetail', { job: afterCheckIn, checkedIn });
        return;
      }

      // The axios interceptor rejects with the server's own body, so `err.message` is
      // the API's wording — shown as-is, with the generic line only as a fallback for
      // a transport failure that carries none. Logged too: the body says more than the
      // banner has room for.
      console.warn('[InstallerJob] Failed to start job:', err);
      log.jobStartFailed(job, err);
      FlashMessage.error(
        "Couldn't start this job",
        err?.message || 'Check your connection and try again.'
      );
      // The session opened a moment ago but the job never opened, so close it again
      // rather than leaving the server believing this installer is still working.
      if (checkedIn) {
        InstallerService.endWork(job._id).catch((e) =>
          console.warn('[InstallerJob] Check-out after failed start failed:', e)
        );
      }
    } finally {
      setStartingId(null);
    }
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['bottom', 'left', 'right']}
    >
      {/* Title + job count */}
      <View className="px-4 pt-6 pb-3 flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-lg font-black" style={{ color: colors.text }}>
            {t('installer.title')}
          </Text>
          {!!companyName && (
            <Text className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>
              {companyName}
            </Text>
          )}
        </View>
        <View
          className="rounded-lg px-3 py-1 items-center"
          style={{ backgroundColor: isDark ? colors.surface : '#4CBB1714' }}
        >
          <Text className="text-base font-bold" style={{ color: colors.primary.main }}>
            {jobCount}
          </Text>
          <Text className="text-[10px] font-medium" style={{ color: colors.primary.main }}>
            {jobCount === 1 ? t('installer.jobsOne') : t('installer.jobsMany')}
          </Text>
        </View>
      </View>

      {/* Schedule tabs. Labels and wire values differ on purpose — the installer reads
          "Today" / "Tomorrow", the request carries `?period=all` / `?period=tomorrow`. */}
      <View className="flex-row px-4 mb-3">
        <SubTab
          label={t('installer.tabAll')}
          active={period === 'all'}
          onPress={() => handlePeriodChange('all')}
        />
        <SubTab
          label={t('installer.tabUpcoming')}
          active={period === 'tomorrow'}
          onPress={() => handlePeriodChange('tomorrow')}
        />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary.main} size="large" />
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item._id}
          windowSize={15}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          removeClippedSubviews={false}
          renderItem={({ item }) => (
            <InstallerJobCard
              job={item}
              // The job's own date, not just the tab: "All" can list a future job, and
              // it must read as a preview rather than offering "Start Appointment" for a
              // tap that will be refused.
              isUpcoming={period === 'tomorrow' || isFutureDatedJob(item)}
              loading={startingId === item._id}
              disabled={!!startingId && startingId !== item._id}
              onPress={() => openJob(item)}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary.main}
              colors={[colors.primary.main]}
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-[30%]">
              <MaterialDesignIcon
                name={isError ? 'cloud-off-outline' : 'calendar-blank-outline'}
                size={64}
                style={{ opacity: 0.7 }}
                color={colors.textSecondary}
              />
              <Text className="text-base text-center mt-4" style={{ color: colors.textSecondary }}>
                {isError
                  ? t('installer.emptyError')
                  : period === 'all'
                  ? t('installer.emptyAll')
                  : t('installer.emptyUpcoming')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

function SubTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} className="mr-6">
      <Text
        className="text-base pb-1.5"
        style={{
          color: active ? colors.primary.main : colors.textSecondary,
          borderBottomWidth: 2,
          borderBottomColor: active ? colors.primary.main : 'transparent',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
