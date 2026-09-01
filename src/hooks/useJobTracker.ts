import { useState, useMemo, useEffect, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { format, parseISO, isValid, parse } from 'date-fns';
import JobService, { JobEntry } from '../services/api/JobService';
import { parseSafeISO } from '../utils/date-util';
import { triggerThresholdCrossing } from '../utils/haptics';
import { useCommissionConfig } from './useCommissionConfig';
import {
  expectedPayoutDateFor,
  parseEarnedDate,
  resolveEarnedDate,
} from '../utils/calculator/calculate-expected-payout-date';

export const useJobTracker = (selectedYear: number) => {
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [soldDateFilter, setSoldDateFilter] = useState('');
  const [payoutDateFilter, setPayoutDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('');

  // The company's payout calendar. Null / unconfigured / a failed read all
  // resolve to a `scheduleType: 'none'` config, which yields no date at all -
  // see the warning below.
  const { payoutConfig } = useCommissionConfig();

  /**
   * The job's expected payout date, per the company's configured schedule
   * (`payPeriodLag` or `dayOfMonth`). Port notes live in
   * `utils/calculator/calculate-expected-payout-date.ts`.
   *
   * WARNING This REPLACES a flat `installDate + 14 days`, which matched neither
   * the portal's legacy band table nor any configured schedule - it was a
   * fabricated date that happened to look plausible. Expect existing rows to
   * move.
   *
   * WARNING The result is DERIVED at render and deliberately never stored on
   * the job: an admin editing the schedule has to move every unpaid row with it.
   *
   * `TBD` is the guide's "To be determined" - no install date yet, no schedule
   * configured, or a gap in the day-of-month bands. `N/A` is kept for a stored
   * date that cannot be parsed at all, which is a data problem rather than an
   * unanswerable question.
   */
  const calculateExpectedPayout = useCallback(
    (job: JobEntry | string | null | undefined) => {
      // Callers may pass a bare earned date; a job record resolves its own
      // field per `earnedDateField` (installDate today, soldDate if configured).
      const isRecord = !!job && typeof job === 'object';
      const earned = isRecord
        ? resolveEarnedDate(job, payoutConfig)
        : (job as string | null | undefined);

      if (!earned || earned === 'TBD') return 'TBD';
      if (!parseEarnedDate(earned)) return 'N/A';

      const payDate = isRecord
        ? expectedPayoutDateFor(job, payoutConfig)
        : expectedPayoutDateFor({ installDate: earned, soldDate: earned }, payoutConfig);

      return payDate ? format(payDate, 'MM/dd/yyyy') : 'TBD';
    },
    [payoutConfig]
  );

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const [jobsData, statsData] = await Promise.all([
        JobService.getJobs(),
        JobService.getMonthlyStats(selectedYear),
      ]);
      setJobs(jobsData);
      setMonthlyStats(statsData?.monthlyData || []);
      setTotals(statsData?.totals || null);
    } catch (err) {
      console.error('Fetch Jobs Error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  const onRefresh = useCallback(async () => {
    if (Platform.OS === 'android') {
      triggerThresholdCrossing();
    }
    setRefreshing(true);
    await fetchJobs();
    setRefreshing(false);
  }, [fetchJobs]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  /**
   * Flip a job between paid and unpaid.
   *
   * ⚠️ DELIBERATELY NOT WIRED TO ANYTHING. It used to sit on the Status chip in the
   * Job Tracker list, so a stray tap while scrolling PATCHed the server and flipped a
   * real payment status with no confirmation and no undo. The chip is read-only now.
   *
   * The deliberate path is the row menu's "Change Status", which opens a dropdown
   * with a Cancel/Update confirmation and calls `JobService.updateStatus` directly.
   * If a one-tap toggle is ever wanted back, put a confirm in front of it — do not
   * re-attach this to the chip.
   */
  const toggleStatus = async (job: JobEntry) => {
    const newStatus = job.status === 'paid' ? 'unpaid' : 'paid';
    try {
      await JobService.updateStatus((job.id || job._id)!, newStatus);
      fetchJobs();
    } catch (err) {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const matchSearch =
        j.jobNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.customerName?.toLowerCase().includes(searchQuery.toLowerCase());

      const jobDate = j.soldDate ? parseISO(j.soldDate) : null;
      const isJobDateValid = jobDate ? isValid(jobDate) : false;

      // 1. Year Filter: Only applies if no specific Sold Date filter is selected
      const matchYear = !soldDateFilter && isJobDateValid && jobDate && jobDate.getFullYear() === selectedYear;

      // 2. Sold Date Filter: Exact day match
      let matchSoldDate = true;
      if (soldDateFilter) {
        // soldDateFilter is in 'yyyy-MM-dd' format from the CustomDatePicker
        const filterDate = parseISO(soldDateFilter);
        if (isValid(filterDate) && isJobDateValid && jobDate) {
          matchSoldDate =
            jobDate.getFullYear() === filterDate.getFullYear() &&
            jobDate.getMonth() === filterDate.getMonth() &&
            jobDate.getDate() === filterDate.getDate();
        } else if (jobDate && isJobDateValid) {
          // Fallback to string includes if dates aren't fully valid for some reason
          matchSoldDate = format(jobDate, 'MM/dd/yyyy').includes(soldDateFilter);
        } else {
          matchSoldDate = false;
        }
      }

      // 3. Payout Date Filter: Exact day match on calculated expected payout
      let matchPayoutDate = true;
      if (payoutDateFilter) {
        const expectedPayoutStr = calculateExpectedPayout(j);
        const filterDateStr = format(parseSafeISO(payoutDateFilter), 'MM/dd/yyyy');
        matchPayoutDate = expectedPayoutStr === filterDateStr;
      }

      const matchStatus = !statusFilter || j.status === statusFilter;
      const matchPayment = !paymentMethodFilter || j.paymentMethod === paymentMethodFilter;

      // If a specific sold date filter is active, we prioritize it over the year selector
      const finalMatchDate = soldDateFilter ? matchSoldDate : matchYear;

      return matchSearch && finalMatchDate && matchPayoutDate && matchStatus && matchPayment;
    });
  }, [
    jobs,
    searchQuery,
    selectedYear,
    soldDateFilter,
    payoutDateFilter,
    statusFilter,
    paymentMethodFilter,
    // The payout filter matches against the derived date, so a config change
    // has to re-run the filter as well as the column.
    calculateExpectedPayout,
  ]);

  const { groupedJobs, totalEarnings } = useMemo(() => {
    const groups: Record<string, JobEntry[]> = {};
    let earnings = 0;

    // Sort filteredJobs by soldDate descending (latest first)
    const sortedJobs = [...filteredJobs].sort((a, b) => {
      const dateA = a.soldDate ? new Date(a.soldDate).getTime() : 0;
      const dateB = b.soldDate ? new Date(b.soldDate).getTime() : 0;
      return dateB - dateA;
    });

    sortedJobs.forEach((job) => {
      earnings += job.commission || 0;
      const date = job.soldDate ? parseISO(job.soldDate) : null;
      if (date && isValid(date)) {
        const key = format(date, 'MMMM yyyy');
        if (!groups[key]) groups[key] = [];
        groups[key].push(job);
      }
    });
    return { groupedJobs: groups, totalEarnings: earnings };
  }, [filteredJobs]);

  return {
    jobs,
    monthlyStats,
    totals,
    loading,
    refreshing,
    onRefresh,
    fetchJobs,
    toggleStatus,
    searchQuery,
    setSearchQuery,
    soldDateFilter,
    setSoldDateFilter,
    payoutDateFilter,
    setPayoutDateFilter,
    statusFilter,
    setStatusFilter,
    paymentMethodFilter,
    setPaymentMethodFilter,
    filteredJobs,
    groupedJobs,
    totalEarnings,
    calculateExpectedPayout,
  };
};
