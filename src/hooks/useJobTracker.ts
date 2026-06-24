import { useState, useMemo, useEffect, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { format, parseISO, isValid, addDays, parse } from 'date-fns';
import JobService, { JobEntry } from '../services/api/JobService';
import { parseSafeISO } from '../utils/date-util';
import { triggerThresholdCrossing } from '../utils/haptics';

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

  const calculateExpectedPayout = (installDate: string | null) => {
    if (!installDate || installDate === 'TBD') return 'TBD';
    const date = parseSafeISO(installDate);
    if (!isValid(date)) return 'N/A';
    return format(addDays(date, 14), 'MM/dd/yyyy');
  };

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
        const expectedPayoutStr = calculateExpectedPayout(j.installDate);
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
