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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../../widgets/common/MainHeader';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { format, addDays, parseISO, isValid } from 'date-fns';
import JobService, { JobEntry } from '../../services/api/JobService';
import { AddEditJobModal } from './components/AddEditJobModal';
import { CustomDatePicker } from './components/CustomDatePicker';
import { paymentPlans } from '../../utils/calculator/payment-plans';
import Feather from 'react-native-vector-icons/Feather';
import { Modal, Pressable } from 'react-native';

const YEARS = [2026, 2025, 2024];

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
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

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
      <View style={{ height: insets.top, backgroundColor: isDark ? colors.surface : '#111827' }} />
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
                  setEditingJob(null);
                  setModalVisible(true);
                }}
                className="flex-row items-center px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Icon name="add" size={20} color="#fff" />
                <Text className="text-white font-bold ml-2 text-sm">Manual Job Entry</Text>
              </TouchableOpacity>
            </View>

            <View className="gap-4">
              <TouchableOpacity
                onPress={() => {
                  setDatePickerTarget('sold');
                  setShowDatePicker(true);
                }}
                className="flex-row items-center justify-between"
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                }}
              >
                <View className="flex-1">
                  <Text className="text-[10px] font-bold text-text-secondary uppercase">
                    Date Sold
                  </Text>
                  <Text
                    className={`text-sm font-medium ${
                      soldDateFilter ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    {soldDateFilter ? format(parseISO(soldDateFilter), 'MM/dd/yyyy') : 'MM/DD/YYYY'}
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
                className="flex-row items-center justify-between"
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                }}
              >
                <View className="flex-1">
                  <Text className="text-[10px] font-bold text-text-secondary uppercase">
                    Expected Payout Date
                  </Text>
                  <Text
                    className={`text-sm font-medium ${
                      payoutDateFilter ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    {payoutDateFilter
                      ? format(parseISO(payoutDateFilter), 'MM/dd/yyyy')
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
              <TouchableOpacity
                onPress={() => setShowStatusPicker(true)}
                className="flex-row items-center justify-between"
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                }}
              >
                <Text
                  className="text-sm font-medium"
                  style={{
                    color: statusFilter ? colors.text : colors.textSecondary,
                  }}
                >
                  {statusFilter
                    ? statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)
                    : 'Status'}
                </Text>
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
                className="flex-row items-center justify-between"
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                }}
              >
                <Text
                  numberOfLines={1}
                  className="text-sm font-medium flex-1 mr-2"
                  style={{
                    color: paymentMethodFilter ? colors.text : colors.textSecondary,
                  }}
                >
                  {paymentMethodFilter
                    ? paymentPlans[paymentMethodFilter]?.label || paymentMethodFilter
                    : 'Payment Method'}
                </Text>
                {paymentMethodFilter ? (
                  <TouchableOpacity onPress={() => setPaymentMethodFilter('')}>
                    <Feather name="x" size={14} color="#FF4842" />
                  </TouchableOpacity>
                ) : (
                  <Feather name="chevron-down" size={20} color="#637381" />
                )}
              </TouchableOpacity>
              <View
                className="flex-row items-center"
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: '#919EAB33',
                  borderRadius: 8,
                }}
              >
                <Icon name="search" size={18} color={colors.textSecondary} className="mr-1" />
                <TextInput
                  placeholder="Search job number or customer..."
                  placeholderTextColor={colors.textSecondary}
                  className="flex-1 text-[10px]"
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
                                <Text className="w-28 text-[13px] font-medium text-text-primary">
                                  {job.installDate
                                    ? format(parseISO(job.installDate), 'MM/dd/yyyy')
                                    : 'TBD'}
                                </Text>
                                <Text className="w-28 text-[13px] font-medium text-text-primary">
                                  {format(parseISO(job.soldDate), 'MM/dd/yyyy')}
                                </Text>
                                <Text className="w-36 text-[13px] font-medium text-text-primary">
                                  {calculateExpectedPayout(job.installDate)}
                                </Text>
                                <Text className="w-40 text-[13px] font-medium text-text-primary">
                                  {job.paymentMethod}
                                </Text>
                                <Text className="w-40 text-[13px] font-medium text-text-primary">
                                  {job.customerName}
                                </Text>
                                <Text className="w-40 text-[13px] font-medium text-text-primary">
                                  {(job as any).calculator?.name || 'N/A'}
                                </Text>
                                <TouchableOpacity
                                  onPress={() => toggleStatus(job)}
                                  className="w-24 items-center"
                                >
                                  <View
                                    className="px-3 py-1 rounded-full"
                                    style={{
                                      backgroundColor:
                                        job.status === 'paid' ? '#C8FACD' : '#FFE4D0',
                                    }}
                                  >
                                    <Text
                                      className="text-[12px] font-bold capitalize"
                                      style={{
                                        color: job.status === 'paid' ? '#007B55' : '#B76E00',
                                      }}
                                    >
                                      {job.status || 'Unpaid'}
                                    </Text>
                                  </View>
                                </TouchableOpacity>

                                <View className="w-12 flex-row justify-end">
                                  <TouchableOpacity
                                    onPress={() => {
                                      setEditingJob(job);
                                      setModalVisible(true);
                                    }}
                                  >
                                    <Icon
                                      name="dots-vertical"
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
      <Modal visible={showStatusPicker} transparent animationType="fade">
        <Pressable
          className="flex-1 bg-black/40 justify-center px-6"
          onPress={() => setShowStatusPicker(false)}
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
                    setShowStatusPicker(false);
                  }}
                  className={`p-4 rounded-2xl mb-1 ${statusFilter === s ? 'bg-[#72BD0010]' : ''}`}
                >
                  <Text
                    className={`text-sm font-bold ${
                      statusFilter === s ? 'text-[#72BD00]' : 'text-text-secondary'
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
                    className={`p-4 rounded-2xl mb-1 ${
                      paymentMethodFilter === key ? 'bg-[#72BD0010]' : ''
                    }`}
                  >
                    <Text
                      className={`text-[13px] font-bold ${
                        paymentMethodFilter === key ? 'text-[#72BD00]' : 'text-text-secondary'
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
                    <Text className="text-[11px] font-black text-[#72BD00] uppercase">
                      {cat.label}
                    </Text>
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
                        className={`p-4 rounded-2xl mb-1 ${
                          paymentMethodFilter === key ? 'bg-[#72BD0010]' : ''
                        }`}
                      >
                        <Text
                          className={`text-[13px] font-medium ${
                            paymentMethodFilter === key ? 'text-[#72BD00]' : 'text-text-secondary'
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
