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
import { useTheme } from '../../theme/ThemeProvider';
import { FlashMessage } from '../../config/message';
import { useInstallerJobs, useUpdateJobStatus } from '../../hooks/useInstallerJobs';
import { useUserRole } from '../../hooks/useUserRole';
import { useInstallerActivityLog } from '../../hooks/useInstallerActivityLog';
import { persistActiveInstallerJob } from '../../utils/activity-log/installer-log';
import { InstallerJobCard } from '../../widgets/components/installer/InstallerJobCard';
import { mergeInstallerJob, type JobPeriod } from '../../services/api/installer';
import type { InstallerJob } from '../../config/types/installer';

/**
 * Installer dashboard — the signed-in installer's schedule.
 *
 * Landing screen for users holding the `installer_dashboard` permission
 * (see `useUserRole` + the role-aware initial route in `src/navigation`).
 */
export default function InstallerDashboard() {
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const { installerCompanyName } = useUserRole();
  const [period, setPeriod] = useState<JobPeriod>('today');
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
   * Tomorrow's previews and already-resulted jobs open read-only: no status change.
   */
  const openJob = async (job: InstallerJob) => {
    const readOnly = period === 'tomorrow' || !!job.resulted;
    // Bind the job to the log context first so every downstream installer event —
    // including the start call below — carries its jobId / leadId / customer.
    // The "opened" event itself is logged by the detail screen, as a check-in or a
    // resume; logging the tap here too would double it.
    persistActiveInstallerJob(job);

    if (readOnly) {
      navigation.navigate('InstallerJobDetail', { job });
      return;
    }
    if (startingId) return;

    setStartingId(job._id);
    try {
      const started = await updateStatus.mutateAsync({ jobId: job._id, status: 'inProgress' });
      const merged = mergeInstallerJob(job, started);
      persistActiveInstallerJob(merged);
      log.jobStarted(merged);
      navigation.navigate('InstallerJobDetail', { job: merged });
    } catch (err) {
      log.jobStartFailed(job, err);
      FlashMessage.error(
        "Couldn't start this job",
        'Check your connection and try again.'
      );
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
            My Installs
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
            {jobCount === 1 ? 'Job' : 'Jobs'}
          </Text>
        </View>
      </View>

      {/* Day tabs */}
      <View className="flex-row px-4 mb-3">
        <SubTab
          label="Today"
          active={period === 'today'}
          onPress={() => handlePeriodChange('today')}
        />
        <SubTab
          label="Tomorrow"
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
              isTomorrow={period === 'tomorrow'}
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
                  ? "Couldn't load your installs. Pull down to retry."
                  : period === 'today'
                  ? 'No installs scheduled for today.'
                  : 'No installs scheduled for tomorrow.'}
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
