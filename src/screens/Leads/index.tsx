import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  StyleSheet,
  Modal,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { getScheduledDateTime } from '../../utils/location-util';
import {
  executeStartAppointmentFlow,
  persistActiveLeadId,
} from '../../utils/lead-activity-log';
import { logSalesMapView } from '../../utils/activity-log/map-activity-log';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { useLeadsData } from '../../hooks/useLeadsData';
import { useRehashLeads } from '../../hooks/useRehashLeads';
import { useWorkLeadMutation } from '../../hooks/useLeadMutation';
import LeadCreateModal from '../../widgets/modals/LeadCreate';
import ZoneCanvasserMap from '../../widgets/modals/ZoneCanvasserMap';
import { LeadCard } from '../../widgets/components/LeadCard';
import { PendingLeadsBanner } from '../../widgets/components/PendingLeadsBanner';
import {
  offlineArchivedLeads,
  offlineLeadsForTab,
  isOfflineLead,
  pendingLeadArchives,
  pendingLeadDeletes,
  createdAtTheDoor,
} from '../../utils/offline-lead-work';
import {
  getOfflineWork,
  findOfflineWorkForLead,
  queueLeadWorkStart,
  subscribeOfflineWork,
} from '../../services/offlineLeadStore';
import {
  applyOfflineWorkflow,
  getOfflineWorkflow,
  markLeadCheckedInOffline,
  subscribeOfflineWorkflow,
} from '../../services/offlineLeadStatus';
import { planStartAppointment, logLeadActionClick } from '../../utils/lead-activity-log';
import { warmLeadCalculators } from '../../services/dealCenterWarmer';
import { useWarmDealCenterConfig } from '../DynamicDealCenter/hooks/useWarmDealCenterConfig';
import { isOnline } from '../../services/connectivity';
import { Header } from '../../widgets/common/MainHeader';
import { RootStackParamList } from '../../navigation';
import type { Lead } from '../../config/types/lead';
import { useRoute, RouteProp } from '@react-navigation/native';
import Clipboard from '../../assets/svgs/icons/clipboard';
import Feather from 'react-native-vector-icons/Feather';
import MaterialDesignIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome from 'react-native-vector-icons/FontAwesome5';
import Geolocation from 'react-native-geolocation-service';
import { PermissionsAndroid } from 'react-native';
import { consumeZoneCanvasserReopen } from '../../utils/zone-canvasser-session';
import { useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../../services/api/leads';
import { triggerThresholdCrossing, prepareHaptic } from '../../utils/haptics';
import { logEvent } from '../../services/api/LoggerService';

const LEAD_HANDOFF_MAX_MS = 15000;

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Leads'>>();
  const { user } = useAuth();

  useEffect(() => {
    if (!user?._id) return;
    const prefetchMapJobs = async () => {
      try {
        console.log('[LeadsPage Prefetch] Prefetching map jobs (all)...');
        await queryClient.prefetchQuery({
          queryKey: ['mapJobs', 'all'],
          queryFn: async () => {
            const res = await LeadService.findJobs({});
            return res.data?.data || [];
          },
          staleTime: 1000 * 60 * 5,
        });
        console.log('[LeadsPage Prefetch] Prefetch successful.');
      } catch (e) {
        console.warn('[LeadsPage Prefetch] Failed:', e);
      }
    };
    prefetchMapJobs();
  }, [user?._id, queryClient]);

  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [currentTab, setCurrentTab] = useState<'issued' | 'selfGen' | 'rehash'>('issued');
  const [issuedSubTab, setIssuedSubTab] = useState<'today' | 'tomorrow'>('today');
  const [selfGenSubTab, setSelfGenSubTab] = useState<'today' | 'archived' | 'sold'>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [zoneCanvasserVisible, setZoneCanvasserVisible] = useState(false);

  const reopenZoneFromParams = route.params?.reopenZoneCanvasser;

  useEffect(() => {
    if (reopenZoneFromParams) {
      setZoneCanvasserVisible(true);
      navigation.setParams({ reopenZoneCanvasser: undefined });
    }
  }, [reopenZoneFromParams, navigation]);

  useFocusEffect(
    useCallback(() => {
      if (reopenZoneFromParams) return undefined;
      const shouldReopen = consumeZoneCanvasserReopen();
      if (shouldReopen) {
        setZoneCanvasserVisible(true);
      }
      return undefined;
    }, [reopenZoneFromParams])
  );

  useEffect(() => {
    if (zoneCanvasserVisible && user) {
      logSalesMapView(user);
    }
  }, [zoneCanvasserVisible, user]);

  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(
    null
  );

  const isRehash = currentTab === 'rehash';

  const apiParams = useMemo(() => {
    if (currentTab === 'rehash') return {};
    if (currentTab === 'issued') return { status: 'lfLead', period: issuedSubTab };
    if (currentTab === 'selfGen') {
      if (selfGenSubTab === 'archived') return { status: 'archive' };
      if (selfGenSubTab === 'sold') return { status: 'resulted' };
      return { status: 'selfGenerated', period: 'today' };
    }
    return {};
  }, [currentTab, issuedSubTab, selfGenSubTab]);

  const { leads, loading, refresh, removeLocalLead } = useLeadsData(apiParams, {
    enabled: !isRehash,
  });
  const {
    rehashLeads,
    loading: rehashLoading,
    refresh: refreshRehash,
    removeLocalLead: removeLocalRehashLead,
  } = useRehashLeads(isRehash);

  const [offlineWork, setOfflineWork] = useState(() => getOfflineWork());
  useEffect(() => subscribeOfflineWork(() => setOfflineWork([...getOfflineWork()])), []);

  const [justLandedIds, setJustLandedIds] = useState<string[]>([]);
  const seenWorkRef = useRef(offlineWork);

  const [offlineWorkflow, setOfflineWorkflow] = useState(() => getOfflineWorkflow());
  useEffect(
    () => subscribeOfflineWorkflow(() => setOfflineWorkflow({ ...getOfflineWorkflow() })),
    []
  );

  const serverLeads = isRehash ? rehashLeads : leads;

  const serverLeadIds = useMemo(
    () => (serverLeads || []).map((l: any) => String(l?._id || '')).filter(Boolean),
    [serverLeads]
  );

  const deletedOffline = useMemo(() => pendingLeadDeletes(offlineWork), [offlineWork]);
  const archivedOffline = useMemo(() => pendingLeadArchives(offlineWork), [offlineWork]);
  const isArchivedTab = currentTab === 'selfGen' && selfGenSubTab === 'archived';

  const sourceLeads = useMemo(() => {
    const applyOfflineActions = (list: any[] | null | undefined) =>
      (list || []).filter((l) => {
        const id = String(l?._id || l?.id || '');
        if (!id) return true;
        if (deletedOffline.has(id)) return false;
        const archived = archivedOffline.get(id);
        if (archived === undefined) return true;
        return archived === isArchivedTab;
      });
    const withWorkflow = (list: any[] | null | undefined) =>
      applyOfflineActions(list).map((l) => applyOfflineWorkflow(l, offlineWorkflow));
    if (isRehash) return withWorkflow(serverLeads);
    if (isArchivedTab) {
      const archivedHere = offlineArchivedLeads(offlineWork, { serverLeadIds });
      if (!archivedHere.length) return withWorkflow(serverLeads);
      return withWorkflow([...archivedHere, ...(serverLeads || [])]);
    }
    const onCurrentTab =
      currentTab === 'issued' ? issuedSubTab === 'today' : selfGenSubTab === 'today';
    if (!onCurrentTab) return withWorkflow(serverLeads);

    const pending = offlineLeadsForTab(
      offlineWork,
      currentTab === 'issued' ? 'lfLead' : 'selfGen',
      { serverLeadIds, keepUploaded: justLandedIds }
    );
    if (!pending.length) return withWorkflow(serverLeads);
    return withWorkflow([...pending, ...(serverLeads || [])]);
  }, [
    isRehash,
    serverLeads,
    serverLeadIds,
    offlineWork,
    offlineWorkflow,
    justLandedIds,
    deletedOffline,
    archivedOffline,
    isArchivedTab,
    currentTab,
    issuedSubTab,
    selfGenSubTab,
  ]);
  const isListLoading = isRehash ? rehashLoading : loading;
  const refreshActive = useCallback(
    () => (isRehash ? refreshRehash() : refresh()),
    [isRehash, refreshRehash, refresh]
  );
  const removeActiveLead = useCallback(
    (id: string) => (isRehash ? removeLocalRehashLead(id) : removeLocalLead(id)),
    [isRehash, removeLocalRehashLead, removeLocalLead]
  );

  useEffect(() => {
    const seen = seenWorkRef.current;
    seenWorkRef.current = offlineWork;

    const landed = offlineWork
      .filter(
        (w) =>
          w.status === 'uploaded' &&
          seen.some((prev) => prev.clientId === w.clientId && prev.status !== 'uploaded')
      )
      .map((w) => w.clientId);
    if (!landed.length) return;

    setJustLandedIds((prev) => Array.from(new Set([...prev, ...landed])));
    const release = () =>
      setJustLandedIds((prev) => prev.filter((id) => !landed.includes(id)));

    const cap = setTimeout(release, LEAD_HANDOFF_MAX_MS);

    queryClient
      .invalidateQueries({ queryKey: ['leads'] })
      .catch((err) => console.warn('[Leads] post-upload refresh failed:', err))
      .finally(() => {
        clearTimeout(cap);
        release();
      });
  }, [offlineWork, queryClient]);

  const [refreshing, setRefreshing] = useState(false);

  React.useEffect(() => {
    if (route.params?.openChatId && leads) {
      const matchingLead = leads.find((l) => l._id === route.params?.openChatId);
      if (matchingLead) {
        setSelectedLead(matchingLead);
        navigation.setParams({ openChatId: undefined } as any);
        navigation.navigate('LeadCenter', { lead: matchingLead, initialTool: 'chat' });
      }
    }
  }, [route.params?.openChatId, leads]);

  const hasFiredRefreshHaptic = useRef(false);

  const handleScrollBeginDrag = useCallback(() => {
    prepareHaptic('impact');
    hasFiredRefreshHaptic.current = false;
  }, []);

  const handleScroll = useCallback((event: any) => {
    const y = event.nativeEvent.contentOffset.y;

    if (y <= -80) {
      if (!hasFiredRefreshHaptic.current) {
        triggerThresholdCrossing();
        hasFiredRefreshHaptic.current = true;
      }
    }
  }, []);

  React.useEffect(() => {
    let watchId: number | undefined;
    let cancelled = false;

    const startLocationWatch = async () => {
      try {
        if (Platform.OS === 'android') {
          const hasLocation = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
          let granted = PermissionsAndroid.RESULTS.GRANTED;
          if (!hasLocation) {
            granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
              {
                title: 'Location Permission',
                message: 'This app needs access to your location for geofencing.',
                buttonNeutral: 'Ask Me Later',
                buttonNegative: 'Cancel',
                buttonPositive: 'OK',
              }
            );
          }
          if (granted !== PermissionsAndroid.RESULTS.GRANTED || cancelled) return;
        } else {
          const currentAuth = await Geolocation.requestAuthorization('whenInUse');
          if (currentAuth !== 'granted' || cancelled) return;
        }

        Geolocation.getCurrentPosition(
          (pos) => { if (!cancelled) setUserLocation(pos.coords); },
          (err) => console.warn('[Location] Initial fix error:', err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );

        watchId = Geolocation.watchPosition(
          (pos) => {
            if (!cancelled) setUserLocation(pos.coords);
          },
          (err) => console.warn('[Location] Watch error:', err),
          {
            enableHighAccuracy: true,
            distanceFilter: 0,   // fire immediately on mount, then on every position event
            interval: 10000,
            fastestInterval: 5000,
            // Note: maximumAge is NOT valid on GeoWatchOptions — only on getCurrentPosition
            forceRequestLocation: false,
            showLocationDialog: false,
          }
        );
      } catch (err) {
        console.warn('[Location] Permission error:', err);
      }
    };

    startLocationWatch();
    return () => {
      cancelled = true;
      if (watchId !== undefined) Geolocation.clearWatch(watchId);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      Geolocation.getCurrentPosition(
        (pos) => { if (!cancelled) setUserLocation(pos.coords); },
        (err) => console.warn('[Location] Focus fix error:', err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );

      refreshActive().catch((err) => console.warn('[Leads] Focus refresh error:', err));

      return () => { cancelled = true; };
    }, [refreshActive])
  );

  const filteredLeads = useMemo(() => {
    if (!sourceLeads) return [];
    const q = searchQuery.toLowerCase();

    const filtered = sourceLeads.filter((l) => {
      const name = `${l.customerDetails?.firstName || ''} ${l.customerDetails?.lastName || ''
        }`.toLowerCase();
      const addr = String(l.fullAddress ?? '').toLowerCase();
      const lid = String(l.leadId ?? '').toLowerCase();
      const lcode = String(l.leadCode ?? '').toLowerCase();
      return (
        name.includes(q) ||
        addr.includes(q) ||
        lid.includes(q) ||
        lcode.includes(q)
      );
    });

    if (
      isRehash ||
      (currentTab === 'selfGen' && (selfGenSubTab === 'archived' || selfGenSubTab === 'sold'))
    ) {
      return filtered;
    }
    return filtered.sort((a, b) => {
      const timeA = getScheduledDateTime(a)?.getTime() || 0;
      const timeB = getScheduledDateTime(b)?.getTime() || 0;
      return timeA - timeB;
    });
  }, [sourceLeads, searchQuery, currentTab, selfGenSubTab, isRehash]);

  useFocusEffect(
    useCallback(() => {
      const userId = user?._id || user?.id;
      if (filteredLeads && filteredLeads.length > 0 && userId) {
        logEvent('view', {
          user_id: userId,
          module_type: 'leads_list',
          created_by: userId,
          meta: {
            totalLeads: filteredLeads.length,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }, [filteredLeads, user])
  );

  useWarmDealCenterConfig();

  useFocusEffect(
    useCallback(() => {
      if (!isOnline() || !sourceLeads?.length) return;
      void warmLeadCalculators(sourceLeads as any[], user?._id || (user as any)?.id);
    }, [sourceLeads, user])
  );

  const workMutation = useWorkLeadMutation();
  const [navigatingLeadId, setNavigatingLeadId] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    if (Platform.OS === 'android') {
      triggerThresholdCrossing();
    }
    setRefreshing(true);
    const refreshPromise = refreshActive();
    const delayPromise = new Promise<void>((resolve) => setTimeout(resolve, 1000));
    await Promise.all([refreshPromise, delayPromise]);
    setRefreshing(false);
  }, [refreshActive]);

  const handleActionPress = async (item: Lead) => {
    setSelectedLead(item);
    setNavigatingLeadId(item._id!);

    console.log(
      '[CheckInTrace] tap id=%s offlineLead=%s online=%s workflowState=%s status=%s',
      item._id,
      isOfflineLead(item),
      isOnline(),
      (item as any)?.workflowState,
      (item as any)?.status
    );
    if (isOfflineLead(item) || !isOnline()) {
      try {
        await persistActiveLeadId(item._id);
        const plan = planStartAppointment(item, userLocation);
        const atTheDoor = createdAtTheDoor(findOfflineWorkForLead(item));
        console.log(
          '[CheckInTrace] plan shouldCallWork=%s logModule=%s inRange=%s atTheDoor=%s hasRecord=%s',
          plan.shouldCallWork,
          plan.logModule || 'NONE',
          plan.isInRange,
          atTheDoor,
          !!findOfflineWorkForLead(item)
        );
        if (plan.shouldCallWork || atTheDoor) {
          const logModule = plan.logModule || (atTheDoor ? 'lead_check_in' : '');
          if (logModule) {
            void logLeadActionClick(user, logModule, item);
          }
          console.log('[CheckInTrace] resolved logModule=%s', logModule || 'NONE');
          if (logModule !== 'lead_review') {
            markLeadCheckedInOffline(item._id || (item as any).id);
            queueLeadWorkStart(item, String(user?._id || (user as any)?.id || ''));
          }
        }
      } catch (e) {
        console.warn('[Leads] offline check-in could not be recorded:', e);
      }
      setNavigatingLeadId(null);
      navigation.navigate('LeadCenter', { lead: item });
      return;
    }

    try {
      const { lead: targetLead } = await executeStartAppointmentFlow({
        lead: item,
        user,
        userLocation,
        workMutation,
      });
      navigation.navigate('LeadCenter', { lead: targetLead, appointmentStarted: true });
    } catch (err) {
      console.log('Action Error:', err);
      await persistActiveLeadId(item._id);
      navigation.navigate('LeadCenter', { lead: item });
    } finally {
      setNavigatingLeadId(null);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['bottom', 'left', 'right']}>

      {/* Search Bar & Add Button */}
      <View
        className="px-4 pt-6 pb-3 flex-row items-center"
      >
        <View
          className="flex-1 py-2 rounded-lg flex-row items-center px-3"
          style={{ backgroundColor: isDark ? colors.surface : '#919EAB14' }}
        >
          <Feather
            name="search"
            size={20}
            color={isDark ? colors.textSecondary : colors.textSecondary}
          />
          <TextInput
            placeholder="Search leads..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="flex-1 ml-2"
            style={[styles.searchInput, { color: colors.text,fontSize:Platform.OS==='android'?17:16 }]}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} className="p-1 rounded-full bg-text-secondary">
              <Feather
                name="x"
                size={12}
                color={"white"}
              />
            </TouchableOpacity>
          )}
        </View>
        <View
          className="rounded-lg flex-col h-full px-2 ml-3 items-center py-1"
          style={{
            backgroundColor: isDark ? colors.surface : '#8E33FF14',
          }}
        >
          <Text className="text-base font-medium" style={{ color: '#8E33FF' }}>
            {filteredLeads.length}
          </Text>
          <Text className="text-base font-medium" style={{ color: '#8E33FF' }}>
            Leads
          </Text>
        </View>
      </View>

      {/* Main Feature Tabs */}
      <View>
        <View
          className="mx-4 p-2 rounded-lg flex-row items-center"
          style={{ backgroundColor: isDark ? colors.surface : '#F4F6F8' }}
        >
          {(['issued', 'selfGen', 'rehash'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setCurrentTab(tab)}
              style={[
                styles.tabItem,
                {
                  backgroundColor: currentTab === tab ? colors.primary.main : 'transparent',
                },
                currentTab === tab && styles.tabItemActive,
              ]}
            >
              <Text
                className="font-medium"
                style={[
                  styles.tabLabel,
                  { color: currentTab === tab ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                {tab === 'issued' ? 'Issued' : tab === 'selfGen' ? 'Self Gens' : 'Rehash'}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => navigation.navigate('MyDeals')}
            style={{
              backgroundColor: '#EAB308',
              borderRadius: 8,
              height: 36,
              width: 36,
              alignItems: 'center',
              justifyContent: 'center',
              marginHorizontal: 12,
            }}
          >
            <Feather name="edit-3" size={24} color={'#FFFFFF'} />
          </TouchableOpacity>
          {/* <TouchableOpacity
            onPress={() => navigation.navigate('Appointments')}
            style={{
              backgroundColor: '#22C55E',
              borderRadius: 8,
              height: 36,
              width: 36,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
            }}
          >
            <Feather name="clock" size={22} color={'#FFFFFF'} />
          </TouchableOpacity> */}
          <TouchableOpacity
            onPress={() => setZoneCanvasserVisible(true)}
            style={{
              backgroundColor: '#C684FF',
              borderRadius: 8,
              height: 36,
              width: 36,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FontAwesome name="shoe-prints" size={20} className="-rotate-90" color={'#FFFFFF'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Dynamic Subtabs */}
      <View className="flex-row px-4 my-3">
        {currentTab === 'issued' ? (
          <>
            <SubTab
              label="Today"
              active={issuedSubTab === 'today'}
              onPress={() => setIssuedSubTab('today')}
            />
            <SubTab
              label="Tomorrow"
              active={issuedSubTab === 'tomorrow'}
              onPress={() => setIssuedSubTab('tomorrow')}
            />
          </>
        ) : currentTab === 'selfGen' ? (
          <>
            <SubTab
              label="Today"
              active={selfGenSubTab === 'today'}
              onPress={() => setSelfGenSubTab('today')}
            />
            <SubTab
              label="Archived"
              active={selfGenSubTab === 'archived'}
              onPress={() => setSelfGenSubTab('archived')}
            />
            <SubTab
              label="Sold"
              active={selfGenSubTab === 'sold'}
              onPress={() => setSelfGenSubTab('sold')}
            />
          </>
        ) : (
          <View className="h-6" /> // Placeholder for rehash which has no subtabs
        )}
      </View>

      {/* Self Gen Archival Note (Web Parity) */}
      {currentTab === 'selfGen' && (
        <View className="px-4 mb-2">
          <View
            className="pl-2 border-l-[3px]"
            style={{ borderLeftColor: colors.success.main }}
          >
            <Text
              className="text-[10px] italic"
              style={{ color: colors.textSecondary }}
            >
              All Self Gen Leads will be archived end of day unless deleted
            </Text>
          </View>
        </View>
      )}

      {isListLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary.main} size="large" />
        </View>
      ) : (
        <FlatList
          data={filteredLeads}
          keyExtractor={(item, index) =>
            String(item._id ?? (item as any).id ?? item.leadId ?? index)
          }
          ListHeaderComponent={<PendingLeadsBanner colors={colors} isDark={isDark} />}
          windowSize={15}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          removeClippedSubviews={false}
          renderItem={({ item }) => (
            <LeadCard
              lead={item}
              colors={colors}
              isDark={isDark}
              isTomorrow={currentTab === 'issued' && issuedSubTab === 'tomorrow'}
              isArchived={
                currentTab === 'selfGen' && selfGenSubTab === 'archived'
              }
              actionLoading={navigatingLeadId === item._id}
              onPress={() => handleActionPress(item)}
              onPitchbookPress={() => {
                navigation.navigate('Pitchbook', { lead: item });
              }}
              onActionPress={() => handleActionPress(item)}
              onArchiveSuccess={(id) => removeActiveLead(id)}
              onDeleteSuccess={(id) => removeActiveLead(id)}
              userLocation={userLocation}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary.main}
              colors={[colors.primary.main]}
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-[30%]">
              <Clipboard className="text-text-secondary" />
              <Text className="text-base text-center mt-4" style={{ color: colors.textSecondary }}>
                {/* Web says "No rehash leads found" here — worth keeping distinct, so an
                    empty Rehash tab reads as "you have none" rather than as the tab
                    having failed to load. */}
                {isRehash ? 'No rehash leads found' : 'No jobs available'}
              </Text>
            </View>
          }
        />
      )}

      {/* Floating Meta Indicator */}

      <TouchableOpacity
        onPress={() => setCreateModalVisible(true)}
        style={[
          styles.addBtn,
          { backgroundColor: colors.primary.main, bottom: 24 + insets.bottom },
        ]}
      >
        <Feather name="plus" size={30} color="#FFFFFF" />
      </TouchableOpacity>

      <LeadCreateModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onSuccess={(createdLead, leadType) => {
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          if (leadType === 'selfGen') {
            setCurrentTab('selfGen');
            setSelfGenSubTab('today');
          } else if (leadType === 'lf_lead') {
            setCurrentTab('issued');
            setIssuedSubTab('today');
          }
        }}
        user={user}
      />

      <ZoneCanvasserMap
        visible={zoneCanvasserVisible}
        onClose={() => setZoneCanvasserVisible(false)}
        user={user}
        navigation={navigation}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  searchInput: {
    fontSize: 16,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    minHeight: 24,
  },
  tabLabel: {
    fontSize: 16,
    ...Platform.select({ ios: { lineHeight: 24 }, default: {} }),
  },
  addBtn: {
    width: 44,
    height: 44,
    position: 'absolute',
    right: 12,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 5.5,
    elevation: 5,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabItemActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
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
          borderBottomWidth: Platform.OS==='android'?2.3:2,
          borderBottomColor: active ? colors.primary.main : 'transparent',
          fontWeight:Platform.OS==='android'?'500':'400'
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
