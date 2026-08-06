import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, isValid } from 'date-fns';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LeadService } from '../../services/api/leads';

/**
 * My Deals — reached from the Leads-page calendar button. Web parity with
 * `MyDealsView` (`src/sections/map/components/my-deals-view.js`): a paginated,
 * filterable list of resulted deals fed by `GET /demo/v1/leads/sales`. Tapping a
 * deal opens the **Deal Detail** screen (web navigates to `/dashboard/deal/:id`),
 * from which the rep starts the 4-step dynamic edit wizard.
 *
 * Styled to match the Dynamic Job Builder (slate surfaces, green accent).
 */

interface MyDealsProps {
  navigation?: NativeStackNavigationProp<any>;
}

const PAGE_LIMIT = 12;

// Tab index → scheduleFilter (web `getScheduleFilter`): 1→scheduled, 2→TBD, 0→All.
const SCHEDULE_FILTERS: (string | null)[] = [null, 'scheduled', 'TBD'];
const TAB_LABELS = ['All', 'Scheduled', 'TBD'];

// ── card display helpers (web parity: my-deal-card.js) ──────────────────────
function shortenOfficeName(name?: string): string {
  if (!name || typeof name !== 'string') return '';
  const words = name.trim().split(' ');
  if (words.length === 1) {
    return name.length <= 3 ? name.toUpperCase() : name.slice(0, 3).toUpperCase();
  }
  return words.map((w) => w[0]).join('').toUpperCase();
}

function getDisplayLeadId(lead: any): string {
  const officeName = lead?.assignedRepDetails?.office?.[0]?.name;
  const shortName = shortenOfficeName(officeName) || 'N/A';
  const rawId = lead?.leadId || lead?._id || '12345';
  let displayId = rawId;
  if (rawId && typeof rawId === 'string' && rawId.length > 8) {
    displayId = rawId.slice(-5).toUpperCase();
  }
  return `${shortName}${displayId}`;
}

interface DealMeta {
  displayLeadId: string;
  customerName: string;
  statusLabel: string;
  statusColor: 'success' | 'warning' | 'error';
  dateTimeText: string;
}

function deriveDealMeta(lead: any): DealMeta {
  const displayLeadId = getDisplayLeadId(lead);
  const customerName =
    `${lead?.customerDetails?.firstName || ''} ${lead?.customerDetails?.lastName || ''}`.trim() ||
    'Unknown';

  const leadStatus = String(lead?.result || lead?.status || '').toLowerCase();
  const isCancelled = leadStatus === 'cancelled';

  const scheduleTime = lead?.jobBuilder?.scheduleTime;
  const scheduleDate = scheduleTime?.date;
  const timeWindow = scheduleTime?.timeWindow;
  const isTBD = !scheduleDate || scheduleDate === 'TBD' || scheduleDate === 'Pending';

  let statusLabel = 'TBD';
  let statusColor: DealMeta['statusColor'] = 'warning';
  let dateTimeText = 'TBD';

  if (isCancelled) {
    statusLabel = 'CANCELLED';
    statusColor = 'error';
  }

  if (!isTBD) {
    if (!isCancelled) {
      statusLabel = 'SCHEDULED';
      statusColor = 'success';
    }
    try {
      const date = new Date(scheduleDate);
      if (!isValid(date)) throw new Error('invalid');
      const formattedDate = format(date, 'M/d/yy');
      const timePart = timeWindow ? String(timeWindow).split(' - ')[0] : '';
      dateTimeText = `${formattedDate} ${timePart}`.trim();
    } catch {
      if (!isCancelled) {
        statusLabel = 'TBD';
        statusColor = 'warning';
      }
      dateTimeText = 'TBD';
    }
  } else if (isCancelled) {
    dateTimeText = 'Cancelled';
  }

  return { displayLeadId, customerName, statusLabel, statusColor, dateTimeText };
}

const STATUS_CHIP: Record<DealMeta['statusColor'], { bg: string; text: string }> = {
  success: { bg: '#DCFCE7', text: '#15803D' },
  warning: { bg: '#FEF9C3', text: '#A16207' },
  error: { bg: '#FEE2E2', text: '#B91C1C' },
};

function DealCard({ lead, onPress }: { lead: any; onPress: () => void }) {
  const meta = deriveDealMeta(lead);
  const chip = STATUS_CHIP[meta.statusColor];
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={{
        backgroundColor: '#fff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        padding: 14,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A', flex: 1 }} numberOfLines={1}>
          {meta.displayLeadId}
        </Text>
        <View style={{ backgroundColor: chip.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: chip.text }}>{meta.statusLabel}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#334155', flex: 1 }} numberOfLines={1}>
          {meta.customerName}
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#94A3B8' }}>{meta.dateTimeText}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MyDeals({ navigation }: MyDealsProps) {
  const [activeTab, setActiveTab] = useState(0); // 0 All, 1 Scheduled, 2 TBD
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');

  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const fetchDeals = useCallback(
    async (pageNum: number, isNewFilter: boolean) => {
      setLoading(true);
      try {
        const scheduleFilter = SCHEDULE_FILTERS[activeTab];
        const res = await LeadService.getSalesDeals({ page: pageNum, limit: PAGE_LIMIT, scheduleFilter });
        const body = res?.data || {};
        const newLeads = body?.data?.leads || body?.leads || [];
        const pagination = body?.pagination || body?.data?.pagination || {};
        const total = pagination.total || 0;
        const totalPages =
          pagination.totalPages ||
          pagination.total_pages ||
          (total > 0 ? Math.ceil(total / PAGE_LIMIT) : 0);

        setLeads((prev) => (isNewFilter ? newLeads : [...prev, ...newLeads]));
        setHasMore(pageNum < totalPages);
      } catch (err) {
        console.warn('[MyDeals] fetch failed:', err);
        if (isNewFilter) setLeads([]);
        setHasMore(false);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeTab]
  );

  // Reset + refetch page 1 whenever the filter tab changes.
  useEffect(() => {
    setLeads([]);
    setPage(1);
    setHasMore(true);
    fetchDeals(1, true);
  }, [activeTab, fetchDeals]);

  const onEndReached = useCallback(() => {
    if (loadingRef.current || !hasMoreRef.current) return;
    const next = page + 1;
    setPage(next);
    fetchDeals(next, false);
  }, [page, fetchDeals]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    fetchDeals(1, true);
  }, [fetchDeals]);

  const openDeal = useCallback(
    (lead: any) => {
      const leadId = lead?._id || lead?.id || lead?.leadId;
      if (!leadId) return;
      // A deal opens the SAME Lead Center screen a sold lead opens (lead info +
      // Job docs / Map / Tools + the resulted Contract Details card), rather than a
      // separate deal screen. `fromMyDeals` retitles the header "Deal" and keeps the
      // Contract Details pencil on the My Deals edit flow (the deal-edit wizard).
      navigation?.navigate('LeadCenter', { lead, fromMyDeals: true });
    },
    [navigation]
  );

  // Client-side search over the loaded deals (matches the visible "Search leads…"
  // box in the web mobile view). Server filtering stays on the schedule tabs.
  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => {
      const name = `${l?.customerDetails?.firstName || ''} ${l?.customerDetails?.lastName || ''}`.toLowerCase();
      const id = String(l?.leadId || l?._id || '').toLowerCase();
      const addr = String(l?.fullAddress || l?.address?.streetName || '').toLowerCase();
      return name.includes(q) || id.includes(q) || addr.includes(q);
    });
  }, [leads, search]);

  const showInitialLoader = loading && !refreshing && leads.length === 0;

  return (
    // The global revDSM header (MainHeader) sits above this screen and already consumes
    // the top inset — same as Lead Center — so only the remaining edges are applied here,
    // otherwise the title bar would get double top padding.
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={['bottom', 'left', 'right']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingVertical: 12,
          backgroundColor: '#fff',
          borderBottomWidth: 1,
          borderBottomColor: '#E2E8F0',
        }}
      >
        <TouchableOpacity
          onPress={() => navigation?.goBack()}
          style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
        >
          <Ionicons name="arrow-back" size={16} color="#637381" />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A', flex: 1 }}>My Deals</Text>
        <Icon name="clipboard-list-outline" size={22} color="#22C55E" />
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#fff',
            borderWidth: 1,
            borderColor: '#E2E8F0',
            borderRadius: 12,
            paddingHorizontal: 12,
          }}
        >
          <Icon name="magnify" size={18} color="#94A3B8" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search leads..."
            placeholderTextColor="#94A3B8"
            style={{ flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 10, marginLeft: 6 }}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Icon name="close" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
        {TAB_LABELS.map((label, idx) => {
          const active = activeTab === idx;
          return (
            <TouchableOpacity
              key={label}
              onPress={() => setActiveTab(idx)}
              activeOpacity={0.8}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: active ? '#22C55E' : '#E2E8F0',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '800', color: active ? '#fff' : '#64748B' }}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showInitialLoader ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#22C55E" />
          <Text style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Loading leads...</Text>
        </View>
      ) : (
        <FlatList
          data={visibleLeads}
          keyExtractor={(item, idx) => String(item?._id || item?.leadId || idx)}
          renderItem={({ item }) => <DealCard lead={item} onPress={() => openDeal(item)} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22C55E" />}
          ListEmptyComponent={
            !loading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
                <Icon name="calendar-blank-outline" size={44} color="#CBD5E1" />
                <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569' }}>
                  {activeTab === 0 ? 'No leads found' : activeTab === 1 ? 'No scheduled leads' : 'No TBD leads'}
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            loading && leads.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 8 }}>
                <ActivityIndicator size="small" color="#22C55E" />
                <Text style={{ fontSize: 13, color: '#94A3B8' }}>Loading more leads...</Text>
              </View>
            ) : !hasMore && leads.length > 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <Text style={{ fontSize: 12, fontStyle: 'italic', color: '#94A3B8' }}>You’ve reached the end</Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
