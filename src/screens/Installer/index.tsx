import React, { useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import MaterialDesignIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { FlashMessage } from '../../config/message';
import { useInstallerJobs, useUpdateJobStatus } from '../../hooks/useInstallerJobs';
import { useUserRole } from '../../hooks/useUserRole';
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

  // Header count prefers the API's own total (paginated lists can be shorter).
  const jobCount = summaryCounts?.total ?? jobs.length;
  // The API stamps the company on each job; the profile field is the fallback.
  const companyName = installerCompanyName || jobs[0]?.companyName;

  /**
   * Opens a job. Today's live jobs are *started* first — the API flips them to
   * `inProgress` and answers with the working payload (contract + the rep's
   * pre-install photos), which exists nowhere else, so the card holds a spinner
   * until it lands and the detail screen opens with real data.
   *
   * Tomorrow's previews and already-resulted jobs open read-only: no status change.
   */
  const openJob = async (job: InstallerJob) => {
    if (period === 'tomorrow' || job.resulted) {
      navigation.navigate('InstallerJobDetail', { job });
      return;
    }
    if (startingId) return;

    setStartingId(job._id);
    try {
      const started = await updateStatus.mutateAsync({ jobId: job._id, status: 'inProgress' });
      navigation.navigate('InstallerJobDetail', { job: mergeInstallerJob(job, started) });
    } catch {
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
        <SubTab label="Today" active={period === 'today'} onPress={() => setPeriod('today')} />
        <SubTab
          label="Tomorrow"
          active={period === 'tomorrow'}
          onPress={() => setPeriod('tomorrow')}
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
              onRefresh={refresh}
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
