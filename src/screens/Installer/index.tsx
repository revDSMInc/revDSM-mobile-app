import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  beginInstallerWorkSession,
  endInstallerWorkSession,
} from '../../utils/installer-work-session';
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
  resolveProximity,
} from '../../utils/installer-geofence';
import { useInstallerProximity } from '../../hooks/useInstallerProximity';
import { isJobInProgress } from '../../utils/installer-card-state';
import {
  arrivalWindowMessage,
  arrivalWindowStartLabel,
  isBeforeArrivalWindow,
  isFutureDatedJob,
} from '../../utils/installer-schedule';
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
  const { jobs, summaryCounts, loading, isError, refresh } = useInstallerJobs(period);

  /**
   * Drives the pull-to-refresh spinner, and it is deliberately NOT the query's own
   * `isRefetching`.
   *
   * ⚠️ That flag is true for EVERY refetch, including the `useFocusEffect` one below —
   * so binding it here made `RefreshControl` animate itself whenever the installer merely
   * came back from a job. Setting `refreshing` programmatically on iOS inserts the
   * control at the top and pushes the list down, which is the stray spinner and the band
   * of white space reported against this screen: a refresh animation for a gesture nobody
   * made, on a screen the crew had just navigated back to.
   *
   * Only `handleRefresh` — the actual pull — sets this. The focus refetch still runs; it
   * just does so silently, which is what it was always meant to do.
   *
   * (Same reasoning, same fix as the Lead Center's own `pullRefreshing`.)
   */
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const updateStatus = useUpdateJobStatus();
  const log = useInstallerActivityLog();

  // Live device position, watched while this screen is focused. It decides what each
  // card's button SAYS; the tap itself is still gated by `resolveCheckInEligibility`,
  // which takes its own fresh fix.
  const { coords: deviceCoords } = useInstallerProximity();

  /**
   * The other half of what a card's button says: the clock.
   *
   * A 12–4 job reads "Preview Appointment" until its window opens, so a crew waiting on
   * a card at 11:58 has to see it turn into "Start Appointment" without pulling to
   * refresh. Nothing else on this screen re-renders on time alone — the schedule is
   * cached for five minutes and the position watch only fires when the phone MOVES, so a
   * crew already parked at the address gets no render at all.
   *
   * A minute is the resolution the windows are written at (whole hours, in practice), so
   * the label can lag by at most that. Cheap enough to leave running: one `setState` per
   * minute on a focused screen. It stops with the screen, via `useFocusEffect` — an
   * interval left running behind the job detail would re-render a list nobody is looking
   * at, for the whole visit.
   */
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => setNow(new Date()), 60000);
      // Fires immediately as well: coming back from a job that took an hour must not
      // spend another minute showing the labels from before it.
      setNow(new Date());
      return () => clearInterval(timer);
    }, [])
  );

  /**
   * True when the installer is demonstrably somewhere else — a fix exists and it is
   * outside `CHECK_IN_RADIUS_METERS` of both the job's own coordinates and every company
   * office on the profile.
   *
   * **No fix yet** deliberately returns false — permission still pending, location off,
   * or the first fix hasn't landed. Unknown is not "elsewhere", and treating it as such
   * would label a card the crew is standing in front of as a preview.
   *
   * **Nothing to compare against** (`inRange === null` — the job was never geocoded and
   * the profile carries no locatable office) returns TRUE. It used to return false,
   * because the check-in gate let that case through and the button must not contradict
   * the gate; the gate now refuses it, so the button follows. Offering "Start
   * Appointment" for a tap that can only fail is the worse of the two.
   */
  const isOffSite = useCallback(
    (job: InstallerJob): boolean => {
      if (!deviceCoords) return false;
      return resolveProximity(deviceCoords, job, user).inRange !== true;
    },
    [deviceCoords, user]
  );

  /**
   * `FlatList` takes ONE `extraData`, and two things outside `data` decide what a row
   * says — where the phone is and what time it is. Bundled so a change in either re-runs
   * the rows.
   */
  const extraData = useMemo(() => ({ deviceCoords, now }), [deviceCoords, now]);

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

  const handleRefresh = async () => {
    log.jobsRefreshed(period);
    setPullRefreshing(true);
    try {
      await refresh();
    } finally {
      // `finally`, so a failed read releases the control too — otherwise the spinner
      // sticks forever and the list looks frozen with no way to clear it.
      setPullRefreshing(false);
    }
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
   *    "All" happens to list it. Today's job is refused too until its arrival window
   *    OPENS — being late is fine, being early is not.
   *  - **WHERE** (`utils/installer-geofence.ts`) — within `CHECK_IN_RADIUS_METERS` of the
   *    address or of a company office. Runs before anything is sent, so a refusal costs no
   *    request and never flips the job to `inProgress`.
   *
   * **WHEN gates the START of a visit only.** A job already `inProgress` is past it — a
   * visit underway cannot be "too early".
   *
   * **A manager's `installerBypass` switches BOTH gates off** — either of its flags does,
   * since an override is one decision about one job (`utils/job-bypass.ts`). It is applied
   * inside the two helper modules rather than here, so this function reads unchanged and
   * the card's labels, the tap's refusals and the check-in payload cannot drift apart over
   * whether an override was in force. A bypassed job also survives a missing fix and an
   * ungeocoded address: with the radius out of the picture there is nothing left for those
   * to be evidence about. The server's own 403 is still honoured below — it remains the
   * authority, and it holds the same override we do.
   *
   * **WHERE gates EVERY open**, including a re-entry ("Resume Appointment"). It used to be
   * skipped for an in-progress job, so that a crew could reopen from the van or a supply
   * run rather than be locked out of their own job over a GPS reading — but that also
   * meant a live job opened from anywhere at all, which is the rule the gate exists to
   * enforce. The lockout risk is the accepted cost; a crew off site now sees Preview and
   * has to be back in range to re-enter.
   *
   * An already-resulted job skips both as well: the visit is over, so it opens read-only
   * for review with no status change and no geofence — nobody is claiming to be on site.
   * It is still FETCHED, through the same `PUT installer/v1/{id}/work` (it is what answers
   * with the full payload), because nothing on this screen is served from local storage.
   */
  const openJob = async (job: InstallerJob) => {
    // Bind the job to the log context first so every downstream installer event —
    // including the start call below — carries its jobId / leadId / customer.
    // The "opened" event itself is logged by the detail screen, as a check-in or a
    // resume; logging the tap here too would double it.
    persistActiveInstallerJob(job);

    // Review comes first: a resulted job is readable whatever its date.
    const readOnly = !!job.resulted;

    // The two WHEN gates below guard the START of a visit. This job's visit has already
    // started, so neither applies any more and it reopens whatever the clock says. The
    // WHERE gate further down is NOT skipped for it. See `isJobInProgress`.
    const alreadyStarted = isJobInProgress(job);

    // ── WHEN ──────────────────────────────────────────────────────────────────
    // Not due yet. Refused outright rather than opened read-only: there is nothing to
    // review on a visit that hasn't happened, and the message says when to come back.
    if (!readOnly && !alreadyStarted && isFutureDatedJob(job)) {
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

    // Right day, too early — the arrival window hasn't opened. Refused for the same
    // reason a future date is: the visit isn't the crew's yet, and checking in would
    // stamp a start on it hours before the customer expects anyone.
    //
    // Only the window's START gates. A crew arriving after it closed still has the work
    // to do, so a late job opens normally (`workflowState: 'expired'` marks the stale
    // slot); it is being EARLY that is refused.
    if (!readOnly && !alreadyStarted && isBeforeArrivalWindow(job)) {
      const timeLabel = arrivalWindowStartLabel(job);

      log.jobStartFailed(job, new Error('Arrival window has not opened yet'));
      FlashMessage.info(
        t('installer.tooEarlyTitle'),
        // `isBeforeArrivalWindow` can only be true when the start parsed, so the label is
        // always there — the fallback exists so a future refactor can't print "undefined".
        timeLabel
          ? t('installer.tooEarlyBody', { time: timeLabel })
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
        beginInstallerWorkSession(job._id);
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
    //
    // ⚠️ This runs for a RE-ENTRY too ("Resume Appointment"), not just a first check-in.
    // It used to be skipped for a job already in progress, on the reasoning that the
    // crew had proved they were on site to start it and must not be held out of their
    // own open job. That made an in-progress job openable from anywhere — which is the
    // rule this gate exists to enforce, so the skip is gone: every open of a live job
    // re-proves the crew is at the address or at a company office.
    //
    // Cost, deliberately accepted: a crew that steps away mid-job (materials run, lunch,
    // a fix that will not settle on a roof) is refused until they are back in range, and
    // every re-entry now waits on a cold GPS fix. The two WHEN gates above are still
    // skipped for a re-entry — a visit already underway cannot be "too early".
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

    // Where the tap happened, for the server's own check. Omitted only when the gate
    // threw and was failed open, since there is then no fix to report.
    //
    // A re-entry now sends its location too. It used to be omitted deliberately, so the
    // server could not refuse the re-entry on distance — that exemption went with the
    // client-side one above: the position is the evidence, and the backend re-checking
    // it is the point of sending it.
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
      // Recorded the moment the session exists, so every way out of the job can close
      // it — including the ones that never reach the detail screen (see
      // `utils/installer-work-session.ts`).
      beginInstallerWorkSession(job._id);
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
      // authority on WHETHER, so its verdict overrides the on-device check that just
      // passed (a spoofed fix clears the client gate and nothing else). Hard stop.
      //
      // The WORDING is ours, though, so this refusal reads the same as the on-device one
      // — the arrival window, not a distance. The server's own message is the fallback for
      // a job carrying no `leadTime`.
      if (err?.httpStatus === 403 || err?.code === 403) {
        log.jobStartFailed(job, err);
        FlashMessage.error(
          'Too far to check in',
          arrivalWindowMessage(job) ||
            err?.message ||
            'Head to the job site to check in.'
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
        void endInstallerWorkSession('left_job', job._id);
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
          // The rows depend on two things outside `data` — the device fix and the clock.
          // Both have to re-run every visible card's state, or the labels would only
          // catch up the next time the schedule itself changed.
          extraData={extraData}
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
              // Runtime location check — the button reads "Preview Appointment" until
              // the crew is at the address or at a company office.
              offSite={isOffSite(item)}
              // Ticks each minute, so a 12–4 job stops reading "Preview Appointment" the
              // moment its window opens.
              now={now}
              onPress={() => openJob(item)}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={pullRefreshing}
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
