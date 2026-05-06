import React, { useState, useCallback, useMemo } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { calculateDistance, getScheduledDateTime } from '../../utils/location-util';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { useLeadsData } from '../../hooks/useLeadsData';
import { useWorkLeadMutation } from '../../hooks/useLeadMutation';
import LeadCreateModal from '../../widgets/modals/LeadCreate';
import { LeadCard } from '../../widgets/components/LeadCard';
import { Header } from '../../widgets/common/MainHeader';
import { RootStackParamList } from '../../navigation';
import type { Lead } from '../../config/types/lead';
import { useRoute, RouteProp } from '@react-navigation/native';
import Clipboard from '../../assets/svgs/icons/clipboard';
import Feather from 'react-native-vector-icons/Feather';
import FontAwesome from 'react-native-vector-icons/FontAwesome5';
import Geolocation from 'react-native-geolocation-service';
import { PermissionsAndroid } from 'react-native';
import { logEvent } from '../../services/api/LoggerService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatService from '../../services/api/ChatService';

export default function LeadsPage() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Leads'>>();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [currentTab, setCurrentTab] = useState<'issued' | 'selfGen' | 'rehash'>('issued');
  const [issuedSubTab, setIssuedSubTab] = useState<'today' | 'tomorrow'>('today');
  const [selfGenSubTab, setSelfGenSubTab] = useState<'today' | 'archived'>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(
    null
  );

  const apiParams = useMemo(() => {
    if (currentTab === 'issued') return { status: 'lfLead', period: issuedSubTab };
    if (currentTab === 'selfGen') {
      if (selfGenSubTab === 'archived') return { status: 'archive' };
      return { status: 'selfGenerated', period: 'today' };
    }
    return currentTab === 'rehash' ? { status: 'rehash' } : {};
  }, [currentTab, issuedSubTab, selfGenSubTab]);

  const { leads, loading, refresh, removeLocalLead } = useLeadsData(apiParams);
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

  React.useEffect(() => {
    let watchId: number | undefined;
    let cancelled = false;

    const startLocationWatch = async () => {
      try {
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: 'Location Permission',
              message: 'This app needs access to your location for geofencing.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            }
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED || cancelled) return;
        } else {
          // Check existing status before requesting to avoid the iOS 17+ main-thread warning
          const currentAuth = await Geolocation.requestAuthorization('whenInUse');
          if (currentAuth !== 'granted' || cancelled) return;
        }

        watchId = Geolocation.watchPosition(
          (pos) => {
            if (!cancelled) setUserLocation(pos.coords);
          },
          (err) => console.warn('Location watch error', err),
          {
            enableHighAccuracy: true,
            distanceFilter: 20, // Increased: only update after 20m movement
            interval: 10000, // Android: poll every 10s instead of 5s
            fastestInterval: 5000, // Android: minimum interval
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

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const q = searchQuery.toLowerCase();

    const filtered = leads.filter((l) => {
      const name = `${l.customerDetails?.firstName || ''} ${
        l.customerDetails?.lastName || ''
      }`.toLowerCase();
      return (
        name.includes(q) ||
        l.fullAddress?.toLowerCase().includes(q) ||
        l.leadId?.toLowerCase().includes(q) ||
        l.leadCode?.toLowerCase().includes(q)
      );
    });

    // Web Parity: Always sort by time (earliest first)
    return filtered.sort((a, b) => {
      const timeA = getScheduledDateTime(a)?.getTime() || 0;
      const timeB = getScheduledDateTime(b)?.getTime() || 0;
      return timeA - timeB;
    });
  }, [leads, searchQuery]);

  const workMutation = useWorkLeadMutation();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handleActionPress = async (item: Lead) => {
    setSelectedLead(item);

    // Save leadId for cross-module logging (parity with web localStorage)
    if (item._id) {
      await AsyncStorage.setItem('leadId', item._id);
    }

    // 1. Log Card Select (Web Parity)
    if (user?._id) {
      logEvent('select', {
        user_id: user._id,
        module_type: 'lead_card',
        created_by: user._id,
        meta: {
          leadId: item._id,
          contactPerson:
            `${item.customerDetails?.firstName || ''} ${
              item.customerDetails?.lastName || ''
            }`.trim() || 'N/A',
          address: item.fullAddress || 'N/A',
          action: 'view_lead_details',
        },
      });
    }

    try {
      const workflow = item.workflowState;
      let targetLead = item;

      // Determine log module type based on current state (Web Parity)
      const isInRange =
        userLocation && item.location?.coordinates
          ? calculateDistance(
              userLocation.latitude,
              userLocation.longitude,
              item.location.coordinates[1],
              item.location.coordinates[0]
            ) <= 1.0
          : false;

      const scheduledTime = getScheduledDateTime(item);
      const now = new Date();
      const fifteenMinutesBefore = scheduledTime ? scheduledTime.getTime() - 15 * 60 * 1000 : 0;
      const isUpcoming = scheduledTime ? now.getTime() < fifteenMinutesBefore : false;

      let logModule = '';
      if (workflow === 'preview' || !workflow) {
        if (isInRange && !isUpcoming) logModule = 'lead_check_in';
      } else if (workflow === 'resume') {
        logModule = isInRange ? 'lead_resume' : 'lead_review';
      }

      if (workflow === 'preview' || workflow === 'resume' || !workflow) {
        if (user?._id) {
          const res = await workMutation.mutateAsync({ leadId: item._id, userId: user._id });

          // 2. Log Action Click if work API succeeds
          if (logModule) {
            logEvent('click', {
              user_id: user._id,
              module_type: logModule,
              action: `${logModule}_clicked`,
              created_by: user._id,
              meta: {
                leadId: item._id,
                hasExistingImages: (item.salesPhotos || []).length > 0,
                isSelfGenerated: item.status === 'selfGenerated',
              },
            });

            // 3. Create Chat if becoming ACTIVE (Web Parity)
            if (logModule === 'lead_check_in' && item._id) {
              ChatService.createChatForLead(item._id).catch((e) =>
                console.warn('[Chat] Auto-creation failed:', e)
              );
            }
          }

          const workData = res.data?.data || res.data;
          if (workData) {
            targetLead = { ...item, ...workData };
          }
        }
      }
      navigation.navigate('LeadCenter', { lead: targetLead });
    } catch (err) {
      console.log('Action Error:', err);
      navigation.navigate('LeadCenter', { lead: item });
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <Header onNavigate={(route) => navigation.navigate(route)} />

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
            className="flex-1 ml-2 text-xs"
            style={{ color: colors.text }}
          />
        </View>
        <View
          className="rounded-2xl flex-col h-full px-2 ml-3 items-center py-1"
          style={{
            backgroundColor: isDark ? colors.surface : '#8E33FF14',
          }}
        >
          <Text className="text-sm font-medium" style={{ color: '#8E33FF' }}>
            {filteredLeads.length}
          </Text>
          <Text className="text-sm font-medium" style={{ color: '#8E33FF' }}>
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
                className="text-sm font-medium"
                style={{
                  color: currentTab === tab ? '#FFFFFF' : colors.textSecondary,
                }}
              >
                {tab === 'issued' ? 'Issued' : tab === 'selfGen' ? 'Self Gens' : 'Rehash'}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
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
            <Feather name="calendar" size={24} color={'#FFFFFF'} />
          </TouchableOpacity>
          <TouchableOpacity
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
          </>
        ) : (
          <View className="h-6" /> // Placeholder for rehash which has no subtabs
        )}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary.main} size="large" />
        </View>
      ) : (
        <FlatList
          data={filteredLeads}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <LeadCard
              lead={item}
              colors={colors}
              isDark={isDark}
              isTomorrow={currentTab === 'issued' && issuedSubTab === 'tomorrow'}
              isArchived={
                (currentTab === 'selfGen' && selfGenSubTab === 'archived') ||
                currentTab === 'rehash'
              }
              actionLoading={workMutation.isPending && selectedLead?._id === item._id}
              onPress={() => handleActionPress(item)}
              onPitchbookPress={() => {
                if (user?._id) {
                  logEvent('select', {
                    user_id: user._id,
                    module_type: 'lead_card',
                    created_by: user._id,
                    meta: {
                      leadId: item._id,
                      contactPerson:
                        `${item.customerDetails?.firstName || ''} ${
                          item.customerDetails?.lastName || ''
                        }`.trim() || 'N/A',
                      address: item.fullAddress || 'N/A',
                      action: 'view_pitchbook',
                    },
                  });
                }
                navigation.navigate('Pitchbook', { lead: item });
              }}
              onActionPress={() => handleActionPress(item)}
              onArchiveSuccess={(id) => removeLocalLead(id)}
              onDeleteSuccess={(id) => removeLocalLead(id)}
              userLocation={userLocation}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary.main}
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-[30%]">
              <Clipboard className="text-text-secondary" />
              <Text className="text-xs text-center mt-4" style={{ color: colors.textSecondary }}>
                No jobs available
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
        onSuccess={onRefresh}
        user={user}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
        className="text-sm pb-1.5"
        style={{
          color: active ? colors.primary.main : colors.textSecondary,
          borderBottomWidth: 2,
          borderBottomColor: active ? colors.primary.main : 'transparent',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
