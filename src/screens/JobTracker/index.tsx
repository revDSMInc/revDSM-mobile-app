import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../../widgets/components/headers/MainHeader';
import { useNavigation } from '@react-navigation/native';
import { useLeadsData } from '../../hooks/useLeadsData';

const STATUS_FILTERS = [
  { id: 'unpaid', label: 'Unpaid', color: '#FF5722' },
  { id: 'paid', label: 'Paid', color: '#72BD00' },
  { id: 'cancelled', label: 'Cancelled', color: '#9E9E9E' },
  { id: 'decline', label: 'Decline', color: '#F44336' },
];

export default function JobTrackerPage() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [activeFilter, setActiveFilter] = useState('unpaid');

  const { leads: jobs, loading, refresh } = useLeadsData({ status: activeFilter });

  // Group by month as in web
  const groupedJobs = useMemo(() => {
    const groups: Record<string, any[]> = {};
    jobs.forEach((job) => {
      const date = new Date(job.leadDate || Date.now());
      const month = date.toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!groups[month]) groups[month] = [];
      groups[month].push(job);
    });
    return Object.entries(groups).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [jobs]);

  return (
    <View style={[styles.root, { backgroundColor: isDark ? colors.background : '#FAF9F6' }]}>
      <View style={{ height: insets.top, backgroundColor: isDark ? colors.surface : '#fff' }} />
      <Header onNavigate={(route) => navigation.navigate(route)} />

      {/* Tracker Status Tabs */}
      <View
        className="flex-row px-4 py-3 border-b"
        style={{
          backgroundColor: isDark ? colors.surface : '#fff',
          borderBottomColor: colors.border,
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {STATUS_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.id}
              onPress={() => setActiveFilter(f.id)}
              className="mr-2 px-6 py-2 rounded-xl border"
              style={{
                borderColor: activeFilter === f.id ? f.color : isDark ? '#333' : '#E0E0E0',
                backgroundColor: activeFilter === f.id ? f.color + '10' : 'transparent',
              }}
            >
              <Text
                className="text-[11px] font-black uppercase tracking-widest"
                style={{ color: activeFilter === f.id ? f.color : colors.textSecondary }}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {loading ? (
          <View className="py-20">
            <ActivityIndicator color="#72BD00" />
          </View>
        ) : groupedJobs.length === 0 ? (
          <View className="py-20 items-center">
            <Text className="text-4xl mb-4">📂</Text>
            <Text
              className="text-sm font-bold opacity-40 uppercase tracking-widest"
              style={{ color: colors.text }}
            >
              No matches found
            </Text>
          </View>
        ) : (
          groupedJobs.map(([month, monthJobs]) => (
            <View key={month} className="mt-8 px-5">
              <View className="flex-row items-center mb-4">
                <Text
                  className="text-[13px] font-black uppercase tracking-widest opacity-30 mr-3"
                  style={{ color: colors.text }}
                >
                  {month}
                </Text>
                <View className="flex-1 h-[1px] bg-black/5" />
                <View className="ml-3 bg-[#72BD00] rounded-full w-6 h-6 items-center justify-center">
                  <Text className="text-[10px] text-white font-black">{monthJobs.length}</Text>
                </View>
              </View>

              {monthJobs.map((job) => (
                <View
                  key={job._id}
                  className="mb-4 p-5 rounded-[24px] border shadow-sm"
                  style={{
                    backgroundColor: isDark ? colors.surface : '#fff',
                    borderColor: isDark ? colors.border : '#F0F0F0',
                  }}
                >
                  <View className="flex-row justify-between items-start mb-4">
                    <View>
                      <Text className="text-[10px] font-black uppercase tracking-widest text-[#72BD00]">
                        Job #{job.leadId || '2341'}
                      </Text>
                      <Text className="text-base font-black mt-1" style={{ color: colors.text }}>
                        {job.customerDetails?.firstName} {job.customerDetails?.lastName}
                      </Text>
                    </View>
                    <View
                      className="px-3 py-1 rounded-lg border"
                      style={{ borderColor: '#72BD0040', backgroundColor: '#72BD0010' }}
                    >
                      <Text className="text-[9px] font-black uppercase tracking-widest text-[#72BD00]">
                        {activeFilter}
                      </Text>
                    </View>
                  </View>

                  <View
                    className="flex-row border-t border-dashed pt-4"
                    style={{ borderTopColor: colors.border }}
                  >
                    <View className="flex-1">
                      <Text
                        className="text-[9px] font-black uppercase tracking-widest opacity-40"
                        style={{ color: colors.text }}
                      >
                        Sale Price
                      </Text>
                      <Text className="text-base font-black mt-1" style={{ color: colors.text }}>
                        ${job.outcome?.contractedAmount || '0.00'}
                      </Text>
                    </View>
                    <View
                      className="flex-1 border-x border-dashed px-4"
                      style={{ borderColor: colors.border }}
                    >
                      <Text
                        className="text-[9px] font-black uppercase tracking-widest opacity-40"
                        style={{ color: colors.text }}
                      >
                        Commission
                      </Text>
                      <Text className="text-base font-black mt-1 text-[#72BD00]">
                        ${((job.outcome?.contractedAmount || 0) * 0.1).toFixed(2)}
                      </Text>
                    </View>
                    <View className="flex-1 pl-4">
                      <Text
                        className="text-[9px] font-black uppercase tracking-widest opacity-40"
                        style={{ color: colors.text }}
                      >
                        Payout
                      </Text>
                      <Text className="text-base font-black mt-1" style={{ color: colors.text }}>
                        14d Exp.
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ))
        )}
        <View className="h-10" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
