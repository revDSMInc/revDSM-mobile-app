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

  const [searchQuery, setSearchQuery] = useState('');
  const [soldDateFilter, setSoldDateFilter] = useState('');
  const [payoutDateFilter, setPayoutDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('');

  const { payoutConfig } = useCommissionConfig();

  const calculateExpectedPayout = useCallback(
    (job: JobEntry | string | null | undefined) => {
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

      const matchYear = !soldDateFilter && isJobDateValid && jobDate && jobDate.getFullYear() === selectedYear;

      let matchSoldDate = true;
      if (soldDateFilter) {
        const filterDate = parseISO(soldDateFilter);
        if (isValid(filterDate) && isJobDateValid && jobDate) {
          matchSoldDate =
            jobDate.getFullYear() === filterDate.getFullYear() &&
            jobDate.getMonth() === filterDate.getMonth() &&
            jobDate.getDate() === filterDate.getDate();
        } else if (jobDate && isJobDateValid) {
          matchSoldDate = format(jobDate, 'MM/dd/yyyy').includes(soldDateFilter);
        } else {
          matchSoldDate = false;
        }
      }

      let matchPayoutDate = true;
      if (payoutDateFilter) {
        const expectedPayoutStr = calculateExpectedPayout(j);
        const filterDateStr = format(parseSafeISO(payoutDateFilter), 'MM/dd/yyyy');
        matchPayoutDate = expectedPayoutStr === filterDateStr;
      }

      const matchStatus = !statusFilter || j.status === statusFilter;
      const matchPayment = !paymentMethodFilter || j.paymentMethod === paymentMethodFilter;

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
    calculateExpectedPayout,
  ]);

  const { groupedJobs, totalEarnings } = useMemo(() => {
    const groups: Record<string, JobEntry[]> = {};
    let earnings = 0;

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
