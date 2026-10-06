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

/**
 * How long a just-filed lead may be held on the list while its server row is fetched.
 *
 * Generous — it is a backstop for a refetch that never settles, not a timing knob: the hold is
 * released by the refetch itself in the ordinary case, which is well under a second.
 */
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

  // Rehash is served by its OWN endpoint (`rehash/rep/v1/leads`), not by a `status`
  // filter on the sales-portal list — see `useRehashLeads`.
  const isRehash = currentTab === 'rehash';

  const apiParams = useMemo(() => {
    // Unused while the Rehash tab is open: the sales-portal query is disabled below,
    // exactly as web nulls its SWR key for this tab. The object is still returned so
    // the query key stays stable across the tab switch rather than churning.
    if (currentTab === 'rehash') return {};
    if (currentTab === 'issued') return { status: 'lfLead', period: issuedSubTab };
    if (currentTab === 'selfGen') {
      if (selfGenSubTab === 'archived') return { status: 'archive' };
      // Web parity (job-list.js): the Sold sub-tab lists resulted self-gen leads.
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

  // The rest of the screen — search, count chip, list, refresh, archive/delete — is
  // written against these three, so the Rehash tab reuses all of it instead of getting
  // a parallel branch that can drift.
  // Leads the rep created with no signal. They exist only on this device until the uploader files
  // them, so nothing on the server can return them and they have to be merged in here.
  const [offlineWork, setOfflineWork] = useState(() => getOfflineWork());
  useEffect(() => subscribeOfflineWork(() => setOfflineWork([...getOfflineWork()])), []);

  /**
   * Records whose upload landed since this screen mounted, held on screen until the refetch that
   * replaces them with the server's own row settles. See the effect below.
   *
   * ⚠️ Seeded EMPTY and driven by an observed transition, never by the record's current status.
   * A record that was already `uploaded` when the screen mounted must not be held — its server row
   * is in the list we are about to draw, and holding it would print the door twice.
   */
  const [justLandedIds, setJustLandedIds] = useState<string[]>([]);
  const seenWorkRef = useRef(offlineWork);

  /**
   * Appointments the rep started with no signal.
   *
   * Offline the Leads screen skips the `work` call entirely, so nothing moved `workflowState` and
   * the card still offered **Start Appointment** on a door the rep was already standing at.
   */
  const [offlineWorkflow, setOfflineWorkflow] = useState(() => getOfflineWorkflow());
  useEffect(
    () => subscribeOfflineWorkflow(() => setOfflineWorkflow({ ...getOfflineWorkflow() })),
    []
  );

  const serverLeads = isRehash ? rehashLeads : leads;

  /** What the server already carries, so the projection can stand down for those doors. */
  const serverLeadIds = useMemo(
    () => (serverLeads || []).map((l: any) => String(l?._id || '')).filter(Boolean),
    [serverLeads]
  );

  /**
   * Doors the rep archived or deleted with no signal.
   *
   * ⚠️ The list has no other defence against these. `removeLocalLead` prunes the query cache,
   * which the next refetch — or the cached list a relaunch serves — simply refills, so without a
   * standing suppression a lead the rep deleted comes straight back in front of them. Both sets
   * clear themselves the moment the change reaches the server, and the upload awaits the list
   * refetch before it lets go, so there is no frame where the old row is back.
   */
  const deletedOffline = useMemo(() => pendingLeadDeletes(offlineWork), [offlineWork]);
  const archivedOffline = useMemo(() => pendingLeadArchives(offlineWork), [offlineWork]);
  const isArchivedTab = currentTab === 'selfGen' && selfGenSubTab === 'archived';

  const sourceLeads = useMemo(() => {
    /** Drop what this device knows is gone, and what it knows belongs on another tab. */
    const applyOfflineActions = (list: any[] | null | undefined) =>
      (list || []).filter((l) => {
        const id = String(l?._id || l?.id || '');
        if (!id) return true;
        if (deletedOffline.has(id)) return false;
        const archived = archivedOffline.get(id);
        // No pending change: the server's own answer stands, whichever tab this is.
        if (archived === undefined) return true;
        return archived === isArchivedTab;
      });
    // ⚠️ Applied to the REHASH tab too. The mark is keyed by lead id and `applyOfflineWorkflow`
    // returns the same reference when there is nothing to paint, so this costs a tab that never
    // sees one exactly nothing.
    const withWorkflow = (list: any[] | null | undefined) =>
      applyOfflineActions(list).map((l) => applyOfflineWorkflow(l, offlineWorkflow));
    if (isRehash) return withWorkflow(serverLeads);
    // ⚠️ A lead archived with no signal is in NEITHER server list — not Today, which no longer
    // offers it, and not Archived, which was fetched before the change. Left to the sync it would
    // simply be gone, which reads to the rep as the delete they did not perform, so the device
    // draws its own snapshot here until the PATCH lands.
    if (isArchivedTab) {
      const archivedHere = offlineArchivedLeads(offlineWork, { serverLeadIds });
      if (!archivedHere.length) return withWorkflow(serverLeads);
      return withWorkflow([...archivedHere, ...(serverLeads || [])]);
    }
    // ⚠️ Only on the tab a NEW lead would land on. Showing it under Archived or Sold would say the
    // lead has a history it does not have yet.
    const onCurrentTab =
      currentTab === 'issued' ? issuedSubTab === 'today' : selfGenSubTab === 'today';
    if (!onCurrentTab) return withWorkflow(serverLeads);

    const pending = offlineLeadsForTab(
      offlineWork,
      currentTab === 'issued' ? 'lfLead' : 'selfGen',
      { serverLeadIds, keepUploaded: justLandedIds }
    );
    if (!pending.length) return withWorkflow(serverLeads);
    // First: they carry no scheduled time, and it is the lead the rep just knocked.
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
  // A card archived or deleted from the Rehash tab lives in the rehash cache, not the
  // sales-portal one — pruning the wrong list would leave the row on screen.
  const removeActiveLead = useCallback(
    (id: string) => (isRehash ? removeLocalRehashLead(id) : removeLocalLead(id)),
    [isRehash, removeLocalRehashLead, removeLocalLead]
  );

  /**
   * A queued lead has just been filed — pull the server's copy in before letting go of ours.
   *
   * The drain runs in the background on reconnect and nothing here was watching it, so the list
   * kept serving the copy it fetched before the lead existed. The rep saw their lead disappear the
   * moment it uploaded and come back only on a manual pull-to-refresh, which reads as the app
   * having lost it — the client flagged it as "weird" for exactly that reason.
   *
   * ⚠️ The row is HELD (`justLandedIds`) across the refetch rather than dropped and re-added.
   * Invalidating alone still blinks: `uploaded` removes the projection in the same tick, and the
   * server row is a round trip behind it.
   */
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

    // ⚠️ A hard cap as well as the promise. A refetch that never settles (the signal that came
    // back is gone again) must not pin a filed lead to the list forever — the record is uploaded,
    // so once the hold lapses the server list is the only honest source for it.
    const cap = setTimeout(release, LEAD_HANDOFF_MAX_MS);

    // The whole `['leads']` prefix, not just the tab on screen: a lead lands on one tab but the
    // others are cached for five minutes, so switching to one would serve a list that predates it.
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

  // ── Location: permission + watchPosition (kept for movement updates) ──────
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

        // Web parity: always get a fresh fix immediately (maximumAge:0).
        // watchPosition with distanceFilter:20 never fires when the rep is
        // already standing at the lead — this one-shot call mirrors what the
        // web does with getCurrentPosition({ maximumAge: 0 }) per card.
        Geolocation.getCurrentPosition(
          (pos) => { if (!cancelled) setUserLocation(pos.coords); },
          (err) => console.warn('[Location] Initial fix error:', err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );

        // Keep the watch running for ongoing movement updates
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

  // ── Web parity: on every focus (e.g. returning from LeadCenter) —
  // 1. fresh GPS fix (maximumAge:0) so isInRange is never stale
  // 2. refresh() so workflowState in the list matches what LeadCenter changed
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      // Fresh GPS fix — mirrors web's getCurrentPosition({ maximumAge: 0 }) per card
      Geolocation.getCurrentPosition(
        (pos) => { if (!cancelled) setUserLocation(pos.coords); },
        (err) => console.warn('[Location] Focus fix error:', err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );

      // Re-fetch leads so workflowState (resume/preview/complete) is in sync
      // with whatever changed in the LeadCenter (footstep) session. Only the list
      // actually on screen — refetching the disabled one would defeat the point of
      // disabling it.
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
      // Coerce to string before toLowerCase — leadId/leadCode/fullAddress can come
      // back as numbers (or objects) from the API, where `?.` doesn't guard and
      // `(123).toLowerCase()` throws "undefined is not a function".
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

    // Web parity (job-list.js): the Archived + Sold self-gen tabs are shown
    // as-returned by the API (not time-sorted). Rehash likewise — web's `rehashJobs`
    // only maps and search-filters, and the rehash service returns its own ordering,
    // which a client-side sort by lead time would throw away.
    if (
      isRehash ||
      (currentTab === 'selfGen' && (selfGenSubTab === 'archived' || selfGenSubTab === 'sold'))
    ) {
      return filtered;
    }
    // Otherwise sort by time (earliest first)
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

  /**
   * Read each visible lead's quote while there is still signal.
   *
   * ⚠️ This is the Leads list's job, not the Deal Center's, and that is the whole point. The Deal
   * Center caches what it opens, which only ever helps a lead the rep has already worked — a lead
   * knocked for the FIRST time out of coverage still met "This quote isn't saved on your device",
   * and the rep could do nothing about it at the door. Here they are usually still in the truck.
   *
   * A no-op offline, while a pass is running, or when every lead already holds a fresh snapshot,
   * and it never creates an appointment — see `dealCenterWarmer`.
   */
  // …and the company's Deal Center setup those quotes are rendered with. Without it an offline
  // Deal Center reads "isn't configured yet" on a device that never opened it online.
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
    // NOTE: no `lead_card` / `view_lead_details` log here. Web fires that event only
    // from the MAP job-card click (`useJobCard.handleCardClick`), NOT when a lead is
    // opened from the leads list — so firing it on list-open was a mobile-only event
    // that showed up on lead entry. Removed for web parity.

    // ⚠️ The start-appointment flow is a WRITE. Offline it can only time out, and the rep would
    // watch a spinner for the length of that timeout before the catch below opens the screen
    // anyway — so go straight there. A lead with no server record has no appointment to start.
    // ⚠️ TEMPORARY DIAGNOSTIC — remove before release.
    console.log(
      '[CheckInTrace] tap id=%s offlineLead=%s online=%s workflowState=%s status=%s',
      item._id,
      isOfflineLead(item),
      isOnline(),
      (item as any)?.workflowState,
      (item as any)?.status
    );
    if (isOfflineLead(item) || !isOnline()) {
      // …but the ARRIVAL still happened, and it used to leave no trace at all: no log for the
      // office, and a card that went on offering **Start Appointment** on a door the rep was
      // standing at. Both are recorded here — the log is held and replayed on reconnect
      // (carrying `occurredAt`), the card state is local and never uploaded.
      //
      // ⚠️ Gated on the SAME plan the online path runs, so an out-of-range tap that would not
      // have checked in online does not check in here either.
      try {
        await persistActiveLeadId(item._id);
        const plan = planStartAppointment(item, userLocation);
        // ⚠️ A lead the rep CREATED at this door is its own arrival evidence, and without this
        // the check-in was silently dropped. `shouldCallWork` needs `isLeadInGeofence`, which
        // needs both a device fix and `lead.location.coordinates` — offline neither is
        // guaranteed (no network location provider, and `LeadCreate` files `location: null`
        // rather than guessing when it cannot geocode). So the rep stood at the door, opened the
        // lead they had just typed, and it queued no `work` and therefore no `chat`: the lead
        // uploaded with no check-in log and `GET chat/v1/lead/{id}` answered 404.
        //
        // Only ever true for a create that has not uploaded yet — see `createdAtTheDoor`. It does
        // not relax the geofence for any lead the rule already covers.
        const atTheDoor = createdAtTheDoor(findOfflineWorkForLead(item));
        // ⚠️ TEMPORARY DIAGNOSTIC — remove before release. If `shouldCallWork` is false and
        // `atTheDoor` is false, NOTHING below runs: no log, no queued work, no chat.
        console.log(
          '[CheckInTrace] plan shouldCallWork=%s logModule=%s inRange=%s atTheDoor=%s hasRecord=%s',
          plan.shouldCallWork,
          plan.logModule || 'NONE',
          plan.isInRange,
          atTheDoor,
          !!findOfflineWorkForLead(item)
        );
        if (plan.shouldCallWork || atTheDoor) {
          // With no fix the plan has no module; the door we are standing at is a check-in.
          const logModule = plan.logModule || (atTheDoor ? 'lead_check_in' : '');
          if (logModule) {
            // Not awaited: it is held on disk, and the rep should not wait on a write to open
            // the lead they are standing in front of.
            void logLeadActionClick(user, logModule, item);
          }
          // A REVIEW is off-site — the rep never arrived — so it must not colour the card as
          // resumed. Online the same distinction is made by what `work` returns.
          // ⚠️ TEMPORARY DIAGNOSTIC — remove before release.
          console.log('[CheckInTrace] resolved logModule=%s', logModule || 'NONE');
          if (logModule !== 'lead_review') {
            markLeadCheckedInOffline(item._id || (item as any).id);
            // …and the SERVER half. The mark above only colours this device's card; without
            // this the office never learns the door was worked, and once the mark ages out
            // the lead reads **Start Appointment** again as though nobody had been.
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
      // style={{ borderBottomColor: isDark ? colors.border : '#F4F6F8' }}
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
            // `text-base` is gone from here on purpose — see `styles.searchInput`.
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
                // `text-base` is gone from here on purpose — see `styles.tabLabel`.
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
          // Web's rehash list falls back the same way (`_id || id || leadId ||
          // jobNumber`) — a rehash row is not guaranteed to carry the sales-portal's
          // `_id`, and an undefined key silently collapses the list to one row.
          keyExtractor={(item, index) =>
            String(item._id ?? (item as any).id ?? item.leadId ?? index)
          }
          // Leads queued on the device sit ABOVE the server's list — that is where the rep looks
          // for the one they just created, and the banner renders nothing when the queue is empty.
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
          // A created lead is always Issued or Self-Gen, never Rehash — and the tab it
          // belongs to is switched to on the next line. Invalidating by PREFIX marks
          // every sales-portal list stale, including the one currently disabled behind
          // the Rehash tab, so the tab being switched to refetches instead of serving a
          // cache that predates the lead. (`refresh()` would only cover the key mounted
          // right now, which may not be the destination.)
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
  /**
   * The leads search field, matched across platforms.
   *
   * It used to be styled by the `text-base` class alone, which supplies `lineHeight: 24`
   * as well as the size — and a TextInput is not a Text. iOS lays the glyphs out inside
   * that taller line box and sits them HIGH in it, so the tail of a `q` was clipped at
   * the bottom edge and the whole string read as sitting above centre. Android reserved
   * its own font padding on top of the container's, landing the text somewhere else
   * again, so the two platforms disagreed about both size and position.
   *
   * ⚠️ Do NOT put `lineHeight` back on this input. It is the cause of the clipping, and
   * a single-line field has no use for one: the height comes from `minHeight` plus the
   * wrapper's own `py-2`, which is what keeps the bar the same height as before.
   */
  searchInput: {
    fontSize: 16,
    // Zeroes the platform default input padding so the wrapper's `py-2` is the only
    // vertical padding in play, on both platforms.
    padding: 0,
    // Android-only, ignored by iOS: drop the reserved metric padding and centre what is
    // left, so the text sits on the same line as iOS instead of riding low.
    includeFontPadding: false,
    textAlignVertical: 'center',
    // Room for the descender — without it the box can collapse to the glyph and clip
    // the tail again.
    minHeight: 24,
  },
  /**
   * The Issued / Self Gens / Rehash tab labels.
   *
   * Same cause as `searchInput`, different symptom: `text-base` also supplies
   * `lineHeight: 24`, and on Android that line box cuts the descender off the `g` in
   * "Self Gens" — the client's "hiding from bottom". iOS renders the same label
   * correctly, so the line height is KEPT there rather than changing the platform that
   * already looks right; only Android drops it and measures the label by its own font
   * metrics instead. The pill's `paddingVertical: 8` supplies the height either way.
   */
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
