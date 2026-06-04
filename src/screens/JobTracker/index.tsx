import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Alert,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../../widgets/common/MainHeader';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { format, addDays, parseISO, isValid } from 'date-fns';
import JobService, { JobEntry } from '../../services/api/JobService';
import { parseSafeISO } from '../../utils/date-util';
import { AddEditJobModal } from './components/AddEditJobModal';
import { CustomDatePicker } from './components/CustomDatePicker';
import { paymentPlans } from '../../utils/calculator/payment-plans';
import Feather from 'react-native-vector-icons/Feather';
import { Modal, Pressable } from 'react-native';

const YEARS = [2026, 2025, 2024];
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

import { useJobTracker } from '../../hooks/useJobTracker';

export default function JobTrackerPage() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [selectedYear, setSelectedYear] = useState(2026);
  const [showOverview, setShowOverview] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<JobEntry | null>(null);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<'sold' | 'payout' | null>(null);
  const [showStatusFilterPicker, setShowStatusFilterPicker] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedJobForMenu, setSelectedJobForMenu] = useState<JobEntry | null>(null);
  const [menuPosition, setMenuPosition] = useState(0);
  const [showStatusUpdateModal, setShowStatusUpdateModal] = useState(false);
  const [selectedPaymentDetails, setSelectedPaymentDetails] = useState<string | null>(null);

  const [jobToUpdateStatus, setJobToUpdateStatus] = useState<JobEntry | null>(null);

  const getStatusColors = (status?: string) => {
    switch (status?.toLowerCase()) {
      case 'paid':
        return { bg: '#C8FACD', text: '#007B55' };
      case 'cancelled':
      case 'bank decline':
        return { bg: '#FFE9D5', text: '#B71D18' };
      case 'unpaid':
      default:
        return { bg: '#FFF5CC', text: '#B76E00' };
    }
  };

  const getRowBackgroundColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case 'paid':
        return isDark ? 'rgba(34, 197, 94, 0.16)' : 'rgba(34, 197, 94, 0.08)';
      case 'cancelled':
      case 'bank decline':
        return isDark ? 'rgba(255, 86, 48, 0.16)' : 'rgba(255, 86, 48, 0.08)';
      default:
        return 'transparent';
    }
  };

  const getDateChipStyle = (date: string | null | undefined, type: 'install' | 'expectedPayout') => {
    if (!date) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let compareDate: Date;
    if (type === 'expectedPayout') {
      const parts = date.split('/');
      if (parts.length !== 3) return null;
      compareDate = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    } else {
      compareDate = parseSafeISO(date);
    }

    if (!isValid(compareDate)) return null;
    compareDate.setHours(0, 0, 0, 0);

    if (type === 'expectedPayout') {
      if (today >= compareDate) return { bg: '#C8FACD', text: '#007B55' };
    } else if (type === 'install') {
      if (today.getTime() === compareDate.getTime()) return { bg: '#FFF5CC', text: '#B76E00' };
      if (today > compareDate) return { bg: '#C8FACD', text: '#007B55' };
    }
    return null;
  };

  const formatPaymentMethod = (paymentMethod: string) => {
    if (!paymentMethod) return 'N/A';

    // Check if it's in paymentPlans
    const plan = paymentPlans[paymentMethod];
    if (!plan) return paymentMethod;

    // Basic Options
    const basicKeys = ['check', 'mcVisaDscvr', 'amex', 'lowes_ach', 'lowes_cc'];
    if (basicKeys.includes(paymentMethod)) {
      return plan.label;
    }

    if (paymentMethod === 'concora') {
      return plan.label.split(' (Bank Fee:')[0];
    }

    if (plan.shortlabel) {
      return plan.shortlabel;
    }

    // Financing Plans (GreenSky / Wells Fargo)
    let planName = '';
    if (paymentMethod.startsWith('greensky')) planName = 'GreenSky';
    else if (paymentMethod.startsWith('wf')) planName = 'Wells Fargo';

    const numberMatch = plan.label.match(/^(\d+)/);
    if (numberMatch && planName) {
      return `${planName} ${numberMatch[1]}`;
    }

    return plan.label;
  };

  const {
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
    groupedJobs,
    calculateExpectedPayout,
  } = useJobTracker(selectedYear);

  useEffect(() => {
    if (Object.keys(groupedJobs).length > 0 && Object.keys(expandedGroups).length === 0) {
      const sortedKeys = Object.keys(groupedJobs).sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime()
      );
      setExpandedGroups({ [sortedKeys[0]]: true });
    }
  }, [groupedJobs]);

  const handleDelete = (job: JobEntry) => {
    Alert.alert('Delete Job', 'Are you sure you want to delete this job entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await JobService.deleteJob((job.id || job._id)!);
          fetchJobs();
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: isDark ? colors.background : '#FAF9F6' }]}>
      <View style={{ height: insets.top, backgroundColor: isDark ? colors.surface : '#FAF9F6' }} />
      <Header onNavigate={(route) => navigation.navigate(route)} />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="px-4 py-3 pb-8">
          {/* Header Title & Back Button */}
          <View className="flex-row items-center justify-between pb-3">
            <View className="flex-row items-center">
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                className="mr-3 p-1 items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.06)',
                  borderRadius: 8,
                }}
              >
                <Feather
                  name="arrow-left"
                  size={14}
                  color={isDark ? colors.text : colors.textSecondary}
                />
              </TouchableOpacity>
              <View>
                <Text className="text-sm font-medium" style={{ color: colors.text }}>
                  Job Tracker
                </Text>
              </View>
            </View>
          </View>

          {/* Overview Section */}
          <View
            className="mb-3 rounded-lg overflow-hidden shadow-sm"
            style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
          >
            <TouchableOpacity
              onPress={() => setShowOverview(!showOverview)}
              className="flex-row items-center justify-between p-3"
            >
              <View className="flex-row items-center">
                <Icon
                  name={showOverview ? 'caret-down' : 'caret-forward'}
                  size={18}
                  color={colors.textSecondary}
                  className="mr-3"
                />
                <Text className="font-semibold text-xs" style={{ color: colors.text }}>
                  Overview Job Tracker
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowYearPicker(!showYearPicker)}>
                <View
                  className="flex-row items-center rounded-[10px] px-4 py-2 border border-border"
                  style={{ backgroundColor: isDark ? colors.background : colors.card }}
                >
                  <Text className="text-xs font-semibold mr-3" style={{ color: colors.text }}>
                    {selectedYear}
                  </Text>
                  <Icon name="chevron-down" size={12} color={colors.textSecondary} />
                </View>
              </TouchableOpacity>
            </TouchableOpacity>

            {showYearPicker && (
              <View
                className="absolute top-16 right-5 z-50 rounded-xl border shadow-xl p-1"
                style={{ backgroundColor: colors.card, borderColor: colors.border }}
              >
                {YEARS.map((y) => (
                  <TouchableOpacity
                    key={y}
                    onPress={() => {
                      setSelectedYear(y);
                      setShowYearPicker(false);
                    }}
                    className="px-6 py-3 rounded-lg"
                    style={{
                      backgroundColor:
                        selectedYear === y ? colors.primary.main + '15' : 'transparent',
                    }}
                  >
                    <Text
                      className="text-xs font-bold"
                      style={{ color: selectedYear === y ? colors.primary.main : colors.text }}
                    >
                      {y}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {showOverview && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="pb-4">
                  {/* Overview Table Header */}
                  <View className="flex-row px-5 py-6 bg-surface border-b border-t border-border">
                    <Text className="w-24 text-xs font-bold text-text-secondary">
                      Month <Icon name="arrow-up" size={12} />
                    </Text>
                    <Text className="w-24 text-xs font-bold text-text-secondary text-right">
                      Net Sales
                    </Text>
                    <Text className="w-28 text-xs font-bold text-text-secondary text-right">
                      Net Commission
                    </Text>
                    <Text className="w-28 text-xs font-bold text-text-secondary text-right">
                      Net Commission %
                    </Text>
                    <Text className="w-24 text-xs font-bold text-text-secondary text-right">
                      Jobs Sold
                    </Text>
                    <Text className="w-24 text-xs font-bold text-text-secondary text-right">
                      Net Sale per Job
                    </Text>
                    <Text className="w-28 text-xs font-bold text-text-secondary text-right">
                      Net Comm. per Job
                    </Text>
                    <Text className="w-28 text-xs font-bold text-text-secondary text-right">
                      Collected Comm.
                    </Text>
                    <Text className="w-28 text-xs font-bold text-text-secondary text-right">
                      Pending Comm.
                    </Text>
                    <Text className="w-28 text-xs font-bold text-text-secondary text-right">
                      Lost Comm.
                    </Text>
                  </View>

                  {/* Month Rows (Mapping real API data) */}
                  {monthlyStats.length > 0 ? (
                    monthlyStats.map((stat, idx) => {
                      const monthName = format(new Date(2026, stat.month - 1, 1), 'MMMM');
                      return (
                        <View
                          key={stat.month}
                          className="flex-row px-5 py-5 border-b border-border"
                        >
                          <Text className="w-24 text-sm font-medium text-text-primary">
                            {monthName}
                          </Text>
                          <Text className="w-24 text-sm font-medium text-text-primary text-right">
                            ${stat.netSales.toLocaleString()}
                          </Text>
                          <Text className="w-28 text-sm font-medium text-text-primary text-right">
                            ${stat.netCommission.toLocaleString()}
                          </Text>
                          <Text className="w-28 text-sm font-medium text-text-primary text-right">
                            {stat.netCommissionPercentage}%
                          </Text>
                          <Text className="w-24 text-sm font-medium text-text-primary text-right">
                            {stat.jobSold}
                          </Text>
                          <Text className="w-24 text-sm font-medium text-text-primary text-right">
                            ${stat.netSalePricePerJobSold.toLocaleString()}
                          </Text>
                          <Text className="w-28 text-sm font-medium text-text-primary text-right">
                            ${stat.netCommissionPerJobSold.toLocaleString()}
                          </Text>
                          <Text className="w-28 text-sm font-medium text-text-primary text-right">
                            ${stat.collectedCommission.toLocaleString()}
                          </Text>
                          <Text className="w-28 text-sm font-medium text-text-primary text-right">
                            ${stat.pendingCommission.toLocaleString()}
                          </Text>
                          <Text className="w-28 text-sm font-medium text-text-primary text-right">
                            ${stat.lostCommission.toLocaleString()}
                          </Text>
                        </View>
                      );
                    })
                  ) : (
                    <View className="px-5 py-8 items-center">
                      <Text className="text-text-secondary text-sm">
                        No monthly data available for {selectedYear}
                      </Text>
                    </View>
                  )}

                  {/* Totals Row */}
                  {totals && (
                    <View className="flex-row px-5 py-6 bg-surface">
                      <Text className="w-24 text-sm font-bold text-text-primary">Totals</Text>
                      <Text className="w-24 text-sm font-bold text-text-primary text-right">
                        ${totals.netSales.toLocaleString()}
                      </Text>
                      <Text className="w-28 text-sm font-bold text-text-primary text-right">
                        ${totals.netCommission.toLocaleString()}
                      </Text>
                      <Text className="w-28 text-sm font-bold text-text-primary text-right">
                        {totals.netCommissionPercentage}%
                      </Text>
                      <Text className="w-24 text-sm font-bold text-text-primary text-right">
                        {totals.jobSold}
                      </Text>
                      <Text className="w-24 text-sm font-bold text-text-primary text-right">
                        ${totals.netSalePricePerJobSold.toLocaleString()}
                      </Text>
                      <Text className="w-28 text-sm font-bold text-text-primary text-right">
                        ${totals.netCommissionPerJobSold.toLocaleString()}
                      </Text>
                      <Text className="w-28 text-sm font-bold text-text-primary text-right">
                        ${totals.collectedCommission.toLocaleString()}
                      </Text>
                      <Text className="w-28 text-sm font-bold text-text-primary text-right">
                        ${totals.pendingCommission.toLocaleString()}
                      </Text>
                      <Text className="w-28 text-sm font-bold text-text-primary text-right">
                        ${totals.lostCommission.toLocaleString()}
                      </Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            )}
          </View>

          {/* Main Actions & Filters Card */}
          <View
            className="p-3 rounded-xl shadow-sm mb-8"
            style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
          >
            <View className="flex-row justify-end mb-6">
              <TouchableOpacity
                onPress={() => {
                  setEditingJob({ isManual: true } as any);
                  setModalVisible(true);
                }}
                className="flex-row items-center px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Icon name="add" size={20} color="#fff" />
                <Text className="text-white font-bold ml-2 text-sm">Manual Job Entry</Text>
              </TouchableOpacity>
            </View>

            <View className="gap-3 mb-6">
              <View className="flex-row items-center gap-3">
                <TouchableOpacity
                  onPress={() => {
                    setDatePickerTarget('sold');
                    setShowDatePicker(true);
                  }}
                  className="flex-row items-center justify-between flex-1"
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                  }}
                >
                  <View className="flex-1">
                    <Text className="text-[10px] font-bold text-text-secondary">Date Sold</Text>
                    <Text
                      className={`text-sm font-medium ${soldDateFilter ? 'text-text-primary' : 'text-text-secondary'
                        }`}
                    >
                      {soldDateFilter
                        ? format(parseSafeISO(soldDateFilter), 'MM/dd/yyyy')
                        : 'MM/DD/YYYY'}
                    </Text>
                  </View>
                  {soldDateFilter ? (
                    <TouchableOpacity onPress={() => setSoldDateFilter('')}>
                      <Feather name="x" size={14} color="#FF4842" />
                    </TouchableOpacity>
                  ) : (
                    <Feather name="calendar" size={16} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setDatePickerTarget('payout');
                    setShowDatePicker(true);
                  }}
                  className="flex-row items-center justify-between flex-1"
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                  }}
                >
                  <View className="flex-1">
                    <Text className="text-[10px] font-bold text-text-secondary">
                      Expected Payout Date
                    </Text>
                    <Text
                      className={`text-sm font-medium ${payoutDateFilter ? 'text-text-primary' : 'text-text-secondary'
                        }`}
                    >
                      {payoutDateFilter
                        ? format(parseSafeISO(payoutDateFilter), 'MM/dd/yyyy')
                        : 'MM/DD/YYYY'}
                    </Text>
                  </View>
                  {payoutDateFilter ? (
                    <TouchableOpacity onPress={() => setPayoutDateFilter('')}>
                      <Feather name="x" size={14} color="#FF4842" />
                    </TouchableOpacity>
                  ) : (
                    <Feather name="calendar" size={16} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>

              <View className="flex-row items-center gap-3">
                <TouchableOpacity
                  onPress={() => setShowStatusFilterPicker(true)}
                  className="flex-row items-center justify-between flex-1"
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                  }}
                >
                  <View className="flex-1">
                    <Text className="text-[10px] font-bold text-text-secondary">Status</Text>
                    <Text
                      className="text-sm font-medium"
                      style={{
                        color: statusFilter ? colors.text : colors.textSecondary,
                      }}
                    >
                      {statusFilter
                        ? statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)
                        : 'Select Status'}
                    </Text>
                  </View>
                  {statusFilter ? (
                    <TouchableOpacity onPress={() => setStatusFilter('')}>
                      <Feather name="x" size={14} color="#FF4842" />
                    </TouchableOpacity>
                  ) : (
                    <Feather name="chevron-down" size={20} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setShowPaymentPicker(true)}
                  className="flex-row items-center justify-between flex-1"
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                  }}
                >
                  <View className="flex-1">
                    <Text className="text-[10px] font-bold text-text-secondary">Payment</Text>
                    <Text
                      numberOfLines={1}
                      className="text-sm font-medium"
                      style={{
                        color: paymentMethodFilter ? colors.text : colors.textSecondary,
                      }}
                    >
                      {paymentMethodFilter
                        ? paymentPlans[paymentMethodFilter]?.label || paymentMethodFilter
                        : 'Select Plan'}
                    </Text>
                  </View>
                  {paymentMethodFilter ? (
                    <TouchableOpacity onPress={() => setPaymentMethodFilter('')}>
                      <Feather name="x" size={14} color="#FF4842" />
                    </TouchableOpacity>
                  ) : (
                    <Feather name="chevron-down" size={20} color="#637381" />
                  )}
                </TouchableOpacity>
              </View>

              <View
                className="flex-row items-center"
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderWidth: 1,
                  borderColor: '#919EAB33',
                  borderRadius: 12,
                }}
              >
                <Icon name="search" size={20} color={colors.textSecondary} className="mr-2" />
                <TextInput
                  placeholder="Search job or customer..."
                  placeholderTextColor={colors.textSecondary}
                  className="flex-1 text-[14px]"
                  style={{ color: colors.text }}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>
            </View>
          </View>

          {/* Job List Accordion */}
          {loading ? (
            <ActivityIndicator color="#72BD00" className="mt-20" />
          ) : Object.keys(groupedJobs).length === 0 ? (
            <View className="mt-8 mb-20 bg-card rounded-3xl border border-border py-24 items-center shadow-sm">
              <View className="bg-surface p-6 rounded-full mb-6">
                <Icon
                  name="file-document-outline"
                  size={80}
                  color={colors.textSecondary}
                  style={{ opacity: 0.5 }}
                />
              </View>
              <Text className="text-xl font-bold text-text-secondary">No Data</Text>
            </View>
          ) : (
            Object.keys(groupedJobs)
              .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
              .map((groupKey) => {
                const groupOpen = expandedGroups[groupKey];
                return (
                  <View key={groupKey} className="mb-4">
                    <TouchableOpacity
                      onPress={() =>
                        setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))
                      }
                      className="flex-row items-center py-4 px-2"
                    >
                      <Icon
                        name={groupOpen ? 'chevron-down' : 'chevron-forward'}
                        size={20}
                        color={colors.text}
                        className="mr-3"
                      />
                      <Text className="text-xl font-black" style={{ color: colors.text }}>
                        {groupKey}
                      </Text>
                    </TouchableOpacity>

                    {groupOpen && (
                      <View
                        className="rounded-2xl overflow-hidden border"
                        style={{ backgroundColor: colors.card, borderColor: colors.border }}
                      >
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View>
                            {/* Table Header */}
                            <View className="flex-row py-5 px-5 bg-surface">
                              <Text className="w-24 text-[13px] font-bold text-text-secondary">
                                Job Number
                              </Text>
                              <Text className="w-28 text-[13px] font-bold text-text-secondary">
                                Sale Price
                              </Text>
                              <Text className="w-28 text-[13px] font-bold text-text-secondary">
                                Commission
                              </Text>
                              <Text className="w-28 text-[13px] font-bold text-text-secondary">
                                Install Date
                              </Text>
                              <Text className="w-28 text-[13px] font-bold text-text-secondary">
                                Date Sold
                              </Text>
                              <Text className="w-36 text-[13px] font-bold text-text-secondary">
                                Expected Payout Date
                              </Text>
                              <Text className="w-40 text-[13px] font-bold text-text-secondary">
                                Payment Method
                              </Text>
                              <Text className="w-40 text-[13px] font-bold text-text-secondary">
                                Customer Name
                              </Text>
                              <Text className="w-40 text-[13px] font-bold text-text-secondary">
                                Calculator Name
                              </Text>
                              <Text className="w-24 text-[13px] font-bold text-text-secondary text-center">
                                Status
                              </Text>
                              <View className="w-12" />
                            </View>

                            {/* Rows */}
                            {groupedJobs[groupKey].map((job, idx) => (
                              <View
                                key={job.id || job._id || idx}
                                className="flex-row items-center py-6 px-5 border-b border-border"
                                style={{ backgroundColor: getRowBackgroundColor(job.status) }}
                              >
                                <Text className="w-24 text-[13px] font-medium text-text-primary">
                                  {job.jobNumber}
                                </Text>
                                <Text className="w-28 text-[13px] font-medium text-text-primary">
                                  ${job.salesPrice.toLocaleString()}
                                </Text>
                                <Text className="w-28 text-[13px] font-medium text-text-primary">
                                  ${job.commission.toLocaleString()}
                                </Text>
                                <View className="w-28">
                                  {(() => {
                                    const style = getDateChipStyle(job.installDate, 'install');
                                    const dateStr = job.installDate ? format(parseSafeISO(job.installDate), 'MM/dd/yyyy') : 'TBD';
                                    if (style) {
                                      return (
                                        <View className="px-2 py-0.5 rounded-full self-start" style={{ backgroundColor: style.bg }}>
                                          <Text className="text-[11px] font-bold" style={{ color: style.text }}>{dateStr}</Text>
                                        </View>
                                      );
                                    }
                                    return <Text className="text-[13px] font-medium text-text-primary">{dateStr}</Text>;
                                  })()}
                                </View>
                                <Text className="w-28 text-[13px] font-medium text-text-primary">
                                  {format(parseSafeISO(job.soldDate), 'MM/dd/yyyy')}
                                </Text>
                                <View className="w-36">
                                  {(() => {
                                    const payoutStr = calculateExpectedPayout(job.installDate);
                                    const style = getDateChipStyle(payoutStr, 'expectedPayout');
                                    if (style && payoutStr !== 'TBD' && payoutStr !== 'N/A') {
                                      return (
                                        <View className="px-2 py-0.5 rounded-full self-start" style={{ backgroundColor: style.bg }}>
                                          <Text className="text-[11px] font-bold" style={{ color: style.text }}>{payoutStr}</Text>
                                        </View>
                                      );
                                    }
                                    return <Text className="text-[13px] font-medium text-text-primary">{payoutStr}</Text>;
                                  })()}
                                </View>
                                <View className="w-40 flex-row items-center gap-1">
                                  <Text className="text-[13px] font-medium text-text-primary" numberOfLines={1} style={{ flexShrink: 1 }}>
                                    {formatPaymentMethod(job.paymentMethod)}
                                  </Text>
                                  {job.paymentMethod && !['check', 'mcVisaDscvr', 'amex', 'lowes_ach', 'lowes_cc'].includes(job.paymentMethod) && (
                                    <TouchableOpacity
                                      onPress={() => setSelectedPaymentDetails(job.paymentMethod)}
                                      style={{ padding: 4 }}
                                    >
                                      <Feather name="info" size={14} color={colors.primary.main} />
                                    </TouchableOpacity>
                                  )}
                                </View>
                                <Text className="w-40 text-[13px] font-medium text-text-primary">
                                  {(job as any).appointment?.title || job.customerName || 'N/A'}
                                </Text>
                                <Text className="w-40 text-[13px] font-medium text-text-primary">
                                  {job.title || (job as any).calculator?.title || (job as any).calculator?.name || 'N/A'}
                                </Text>
                                <TouchableOpacity
                                  onPress={() => toggleStatus(job)}
                                  className="w-24 items-center"
                                >
                                  {(() => {
                                    const colors = getStatusColors(job.status);
                                    return (
                                      <View
                                        className="px-3 py-1 rounded-full"
                                        style={{ backgroundColor: colors.bg }}
                                      >
                                        <Text
                                          className="text-[12px] font-bold capitalize"
                                          style={{ color: colors.text }}
                                        >
                                          {job.status || 'Unpaid'}
                                        </Text>
                                      </View>
                                    );
                                  })()}
                                </TouchableOpacity>

                                <View className="w-12 flex-row justify-end">
                                  <TouchableOpacity
                                    onPress={(e) => {
                                      const { pageY } = e.nativeEvent;
                                      setMenuPosition(pageY);
                                      setSelectedJobForMenu(job);
                                    }}
                                  >
                                    <Icon
                                      name="ellipsis-vertical"
                                      size={20}
                                      color={colors.textSecondary}
                                    />
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ))}
                          </View>
                        </ScrollView>
                      </View>
                    )}
                  </View>
                );
              })
          )}
        </View>
        <View className="h-20" />
      </ScrollView>

      <AddEditJobModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={fetchJobs}
        job={editingJob}
      />

      <CustomDatePicker
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        initialDate={datePickerTarget === 'sold' ? soldDateFilter : payoutDateFilter}
        onSelect={(date) => {
          if (datePickerTarget === 'sold') setSoldDateFilter(date);
          else setPayoutDateFilter(date);
        }}
      />

      {/* Status Picker Modal */}
      <Modal visible={showStatusFilterPicker} transparent animationType="fade">
        <Pressable
          className="flex-1 bg-black/40 justify-center px-6"
          onPress={() => setShowStatusFilterPicker(false)}
        >
          <View className="bg-card rounded-[32px] overflow-hidden">
            <View className="p-6 border-b border-border">
              <Text className="text-lg font-bold text-text-primary">Select Status</Text>
            </View>
            <View className="p-2">
              {['unpaid', 'paid', 'cancelled', 'bank decline'].map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => {
                    setStatusFilter(s);
                    setShowStatusFilterPicker(false);
                  }}
                  className={`p-4 rounded-2xl mb-1 ${statusFilter === s ? 'bg-[#72BD0010]' : ''}`}
                >
                  <Text
                    className={`text-sm font-bold ${statusFilter === s ? 'text-[#72BD00]' : 'text-text-secondary'
                      }`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Payment Method Picker Modal */}
      <Modal visible={showPaymentPicker} transparent animationType="fade">
        <Pressable
          className="flex-1 bg-black/40 justify-center px-6"
          onPress={() => setShowPaymentPicker(false)}
        >
          <View className="bg-card rounded-[32px] overflow-hidden max-h-[80%]">
            <View className="p-6 border-b border-border flex-row items-center justify-between">
              <Text className="text-lg font-bold text-text-primary">Select Payment Method</Text>
              <TouchableOpacity onPress={() => setShowPaymentPicker(false)}>
                <Feather name="x" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView className="p-2">
              {/* Cash/Card */}
              {Object.keys(paymentPlans)
                .filter((key) => paymentPlans[key].type !== 'financing')
                .map((key) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => {
                      setPaymentMethodFilter(key);
                      setShowPaymentPicker(false);
                    }}
                    className={`p-4 rounded-2xl mb-1 ${paymentMethodFilter === key ? 'bg-[#72BD0010]' : ''
                      }`}
                  >
                    <Text
                      className={`text-[13px] font-bold ${paymentMethodFilter === key ? 'text-[#72BD00]' : 'text-text-secondary'
                        }`}
                    >
                      {paymentPlans[key].label}
                    </Text>
                  </TouchableOpacity>
                ))}

              {/* Categories */}
              {[
                { label: 'GreenSky Plans', prefix: 'greensky' },
                { label: 'Wells Fargo Plans', prefix: 'wf', exclude: 'wf36' },
                { label: 'Wells Fargo Plans (Jobs over $7,500)', prefix: 'wf36' },
                { label: 'Concora Credit', prefix: 'concora' },
              ].map((cat) => (
                <View key={cat.label}>
                  <View className="bg-[#72BD0015] px-4 py-2 mt-4 mb-2 rounded-lg">
                    <Text className="text-[11px] font-black text-[#72BD00]">{cat.label}</Text>
                  </View>
                  {Object.keys(paymentPlans)
                    .filter((key) => {
                      if (cat.exclude && key.startsWith(cat.exclude)) return false;
                      return key.startsWith(cat.prefix);
                    })
                    .map((key) => (
                      <TouchableOpacity
                        key={key}
                        onPress={() => {
                          setPaymentMethodFilter(key);
                          setShowPaymentPicker(false);
                        }}
                        className={`p-4 rounded-2xl mb-1 ${paymentMethodFilter === key ? 'bg-[#72BD0010]' : ''
                          }`}
                      >
                        <Text
                          className={`text-[13px] font-medium ${paymentMethodFilter === key ? 'text-[#72BD00]' : 'text-text-secondary'
                            }`}
                        >
                          {paymentPlans[key].label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              ))}
              <View className="h-6" />
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Action Menu Popover */}
      <Modal visible={!!selectedJobForMenu} transparent animationType="fade">
        <Pressable className="flex-1" onPress={() => setSelectedJobForMenu(null)}>
          <View
            className="absolute right-10 bg-white rounded-2xl shadow-2xl py-2 w-52 border border-border/50"
            style={{
              top: Math.min(menuPosition - 20, SCREEN_HEIGHT - 200), // Dynamic safe positioning
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.1,
              shadowRadius: 20,
              elevation: 20,
            }}
          >
            <TouchableOpacity
              onPress={() => {
                setEditingJob(selectedJobForMenu);
                setModalVisible(true);
                setSelectedJobForMenu(null);
              }}
              className="flex-row items-center px-4 py-3"
            >
              <Feather name="edit-2" size={18} color="#1C252E" />
              <Text className="ml-3 text-sm font-semibold text-[#1C252E]">Manual Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setJobToUpdateStatus(selectedJobForMenu);
                setShowStatusUpdateModal(true);
                setShowStatusDropdown(false);
                setSelectedJobForMenu(null);
              }}
              className="flex-row items-center px-4 py-3"
            >
              <Feather name="rotate-ccw" size={18} color="#1C252E" />
              <Text className="ml-3 text-sm font-semibold text-[#1C252E]">Change Status</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                const jobToDelete = selectedJobForMenu;
                setSelectedJobForMenu(null);
                handleDelete(jobToDelete!);
              }}
              className="flex-row items-center px-4 py-3"
            >
              <Feather name="trash-2" size={18} color="#FF4842" />
              <Text className="ml-3 text-sm font-semibold text-[#FF4842]">Delete</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Status Update Modal */}
      <Modal visible={showStatusUpdateModal} transparent animationType="fade">
        <Pressable
          className="flex-1 bg-black/60 justify-center px-8"
          onPress={() => setShowStatusUpdateModal(false)}
        >
          <View className="bg-white rounded-[24px] p-6 shadow-2xl">
            <Text className="text-xl font-bold text-[#1C252E] mb-8">Change Status</Text>

            <View className="mb-8">
              <TouchableOpacity
                onPress={() => setShowStatusDropdown(!showStatusDropdown)}
                className="h-14 border border-[#1C252E] rounded-xl px-4 flex-row items-center justify-between"
              >
                <View className="absolute -top-2.5 left-3 bg-white px-1">
                  <Text className="text-xs font-bold text-[#1C252E]">Status</Text>
                </View>
                <Text className="text-sm font-semibold text-[#1C252E]">
                  {(jobToUpdateStatus?.status || 'unpaid').charAt(0).toUpperCase() +
                    (jobToUpdateStatus?.status || 'unpaid').slice(1)}
                </Text>
                <Feather
                  name={showStatusDropdown ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#637381"
                />
              </TouchableOpacity>

              {showStatusDropdown && (
                <View className="mt-1 bg-white rounded-xl shadow-lg border border-border/50 py-1">
                  {[
                    { label: 'Unpaid', value: 'unpaid' },
                    { label: 'Paid', value: 'paid' },
                    { label: 'Cancelled', value: 'cancelled' },
                    { label: 'Bank Decline', value: 'bank decline' },
                  ].map((s) => (
                    <TouchableOpacity
                      key={s.value}
                      onPress={() => {
                        setJobToUpdateStatus({ ...jobToUpdateStatus!, status: s.value as any });
                        setShowStatusDropdown(false);
                      }}
                      className={`px-4 py-3 ${jobToUpdateStatus?.status === s.value ? 'bg-slate-50' : ''
                        }`}
                    >
                      <Text
                        className={`text-sm font-semibold ${jobToUpdateStatus?.status === s.value
                            ? 'text-[#1C252E]'
                            : 'text-[#637381]'
                          }`}
                      >
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View className="flex-row justify-end gap-2">
              <TouchableOpacity
                onPress={() => {
                  setShowStatusUpdateModal(false);
                  setShowStatusDropdown(false);
                }}
                className="px-5 h-10 items-center justify-center rounded-xl border border-border"
              >
                <Text className="text-sm font-bold text-[#1C252E]">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  try {
                    await JobService.updateStatus(
                      (jobToUpdateStatus!.id || jobToUpdateStatus!._id)!,
                      jobToUpdateStatus!.status!
                    );
                    setShowStatusUpdateModal(false);
                    setShowStatusDropdown(false);
                    fetchJobs();
                  } catch (e) {
                    Alert.alert('Error', 'Failed to update status');
                  }
                }}
                className="px-5 h-10 items-center justify-center rounded-xl bg-[#72BD00]"
              >
                <Text className="text-sm font-bold text-white">Update</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Payment Method Details Modal */}
      <Modal
        visible={selectedPaymentDetails !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedPaymentDetails(null)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-center items-center px-6"
          onPress={() => setSelectedPaymentDetails(null)}
        >
          <Pressable
            className="w-full max-w-sm rounded-[24px] p-6 shadow-xl"
            style={{ backgroundColor: colors.card }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-black text-text-primary">
                Payment Method Details
              </Text>
              <TouchableOpacity onPress={() => setSelectedPaymentDetails(null)}>
                <Feather name="x" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text className="text-sm font-medium text-text-secondary leading-6">
              {selectedPaymentDetails ? (paymentPlans[selectedPaymentDetails]?.label || selectedPaymentDetails) : ''}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
