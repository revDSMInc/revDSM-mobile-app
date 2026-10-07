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

const HELD_BY_OTHER_MESSAGE =
  'This job is already checked in by another crew member. You can check in once they check out.';

const isHeldByAnotherCrew = (err: any, userId?: string): boolean => {
  const heldBy = err?.data?.workStartedBy;
  const conflict =
    err?.code === 409 || err?.httpStatus === 409 || err?.data?.alreadyCheckedIn === true;
  return !!(conflict && heldBy && heldBy !== userId);
};

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

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const updateStatus = useUpdateJobStatus();
  const log = useInstallerActivityLog();

  const { coords: deviceCoords } = useInstallerProximity();

  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => setNow(new Date()), 60000);
      setNow(new Date());
      return () => clearInterval(timer);
    }, [])
  );

  const isOffSite = useCallback(
    (job: InstallerJob): boolean => {
      if (!deviceCoords) return false;
      return resolveProximity(deviceCoords, job, user).inRange !== true;
    },
    [deviceCoords, user]
  );

  const extraData = useMemo(() => ({ deviceCoords, now }), [deviceCoords, now]);

  const jobCount = summaryCounts?.total ?? jobs.length;
  const companyName = installerCompanyName || jobs[0]?.companyName;

  const viewedPeriods = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (loading || viewedPeriods.current[period]) return;
    viewedPeriods.current[period] = true;
    log.dashboardViewed({ period, jobCount, companyName });
  }, [loading, period, jobCount, companyName, log]);

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
      setPullRefreshing(false);
    }
  };

  const openJob = async (job: InstallerJob) => {
    persistActiveInstallerJob(job);

    const readOnly = !!job.resulted;

    const alreadyStarted = isJobInProgress(job);

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

    if (!readOnly && !alreadyStarted && isBeforeArrivalWindow(job)) {
      const timeLabel = arrivalWindowStartLabel(job);

      log.jobStartFailed(job, new Error('Arrival window has not opened yet'));
      FlashMessage.info(
        t('installer.tooEarlyTitle'),
        timeLabel
          ? t('installer.tooEarlyBody', { time: timeLabel })
          : t('installer.notYetBodyNoDate')
      );
      return;
    }

    if (readOnly) {
      if (startingId) return;
      setStartingId(job._id);
      try {
        const full = await InstallerService.startWork(job._id);
        const merged = full ? mergeInstallerJob(job, full) : job;
        persistActiveInstallerJob(merged);
        beginInstallerWorkSession(job._id);
        navigation.navigate('InstallerJobDetail', { job: merged, checkedIn: true });
      } catch (err: any) {
        if (isHeldByAnotherCrew(err, userId)) {
          log.jobStartFailed(job, err);
          FlashMessage.error('Already checked in', err?.message || HELD_BY_OTHER_MESSAGE);
          return;
        }

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

    let eligibility;
    try {
      eligibility = await resolveCheckInEligibility(job, user);
    } catch (err) {
      console.warn('[InstallerJob] Geofence check failed, allowing check-in:', err);
      eligibility = null;
    }

    if (eligibility && !eligibility.allowed) {
      log.jobStartFailed(job, new Error(eligibility.reason));
      FlashMessage.error(eligibility.title || 'Cannot check in', eligibility.reason);
      setStartingId(null);
      return;
    }

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

    let checkedIn = true;
    let checkInJob: InstallerJob | null = null;
    try {
      checkInJob = await InstallerService.startWork(job._id, checkInPayload);
      beginInstallerWorkSession(job._id);
    } catch (err: any) {
      const alreadyOpen =
        err?.code === 409 || err?.httpStatus === 409 || err?.data?.alreadyCheckedIn === true;

      if (isHeldByAnotherCrew(err, userId)) {
        log.jobStartFailed(job, err);
        FlashMessage.error('Already checked in', err?.message || HELD_BY_OTHER_MESSAGE);
        setStartingId(null);
        return;
      }

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
        console.warn('[InstallerJob] Work session was already open for this installer.');
      } else {
        checkedIn = false;
        console.warn('[InstallerJob] Check-in failed:', err);
      }
    }

    const afterCheckIn = checkInJob ? mergeInstallerJob(job, checkInJob) : job;

    try {
      const started = await updateStatus.mutateAsync({ jobId: job._id, status: 'inProgress' });
      const merged = started ? mergeInstallerJob(afterCheckIn, started) : afterCheckIn;
      persistActiveInstallerJob(merged);
      log.jobStarted(merged);
      navigation.navigate('InstallerJobDetail', { job: merged, checkedIn });
      return;
    } catch (err: any) {
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

      console.warn('[InstallerJob] Failed to start job:', err);
      log.jobStartFailed(job, err);
      FlashMessage.error(
        "Couldn't start this job",
        err?.message || 'Check your connection and try again.'
      );
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
          extraData={extraData}
          windowSize={15}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          removeClippedSubviews={false}
          renderItem={({ item }) => (
            <InstallerJobCard
              job={item}
              isUpcoming={period === 'tomorrow' || isFutureDatedJob(item)}
              loading={startingId === item._id}
              disabled={!!startingId && startingId !== item._id}
              offSite={isOffSite(item)}
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
