import { useState, useMemo, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { format, parseISO, isValid, addDays } from 'date-fns';
import JobService, { JobEntry } from '../services/api/JobService';

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
    if (!installDate) return 'TBD';
    const date = parseISO(installDate);
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
      const date = parseISO(j.soldDate);
      const matchYear = isValid(date) && date.getFullYear() === selectedYear;
      const matchSoldDate =
        !soldDateFilter ||
        (j.soldDate && format(parseISO(j.soldDate), 'MM/dd/yyyy').includes(soldDateFilter));
      const expectedPayout = calculateExpectedPayout(j.installDate);
      const matchPayoutDate = !payoutDateFilter || expectedPayout.includes(payoutDateFilter);
      const matchStatus = !statusFilter || j.status === statusFilter;
      const matchPayment = !paymentMethodFilter || j.paymentMethod === paymentMethodFilter;
      return (
        matchSearch && matchYear && matchSoldDate && matchPayoutDate && matchStatus && matchPayment
      );
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
    filteredJobs.forEach((job) => {
      earnings += job.commission || 0;
      const date = parseISO(job.soldDate);
      if (isValid(date)) {
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
