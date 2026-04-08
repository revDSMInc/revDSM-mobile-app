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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { useLeadsData } from '../../hooks/useLeadsData';
import { useWorkLeadMutation } from '../../hooks/useLeadMutation';
import LeadCreateModal from '../../widgets/modals/LeadCreate';
import LeadCenterModal from '../../widgets/modals/LeadCenter';
import { LeadCard } from '../../widgets/components/cards/LeadCard';
import { Header } from '../../widgets/components/headers/MainHeader';
import { RootStackParamList } from '../../navigation';
import type { Lead } from '../../config/types/lead';

import { useRoute, RouteProp } from '@react-navigation/native';

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
  const [centerModalVisible, setCenterModalVisible] = useState(false);
  const [initialTool, setInitialTool] = useState<
    'job_builder' | 'calculator' | 'pitchbook' | 'chat' | undefined
  >(undefined);

  const apiParams = useMemo(() => {
    if (currentTab === 'issued') return { status: 'lfLead', period: issuedSubTab };
    if (currentTab === 'selfGen') {
      if (selfGenSubTab === 'archived') return { status: 'archive' };
      return { status: 'selfGenerated', period: 'today' };
    }
    return currentTab === 'rehash' ? { status: 'rehash' } : {};
  }, [currentTab, issuedSubTab, selfGenSubTab]);

  const { leads, loading, refresh } = useLeadsData(apiParams);
  const [refreshing, setRefreshing] = useState(false);

  React.useEffect(() => {
    if (route.params?.openChatId && leads) {
      const matchingLead = leads.find((l) => l._id === route.params?.openChatId);
      if (matchingLead) {
        setSelectedLead(matchingLead);
        setInitialTool('chat');
        setCenterModalVisible(true);
        navigation.setParams({ openChatId: undefined } as any);
      }
    }
  }, [route.params?.openChatId, leads]);

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const q = searchQuery.toLowerCase();
    return leads.filter((l) => {
      const name = `${l.customerDetails?.firstName} ${l.customerDetails?.lastName}`.toLowerCase();
      return (
        name.includes(q) ||
        l.fullAddress?.toLowerCase().includes(q) ||
        l.leadId?.toLowerCase().includes(q)
      );
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
    try {
      const workflow = item.workflowState;
      if (workflow === 'preview' || workflow === 'resume' || !workflow) {
        if (user?._id) {
          await workMutation.mutateAsync({ leadId: item._id, userId: user._id });
        }
      }
      setCenterModalVisible(true);
    } catch (err) {}
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <Header onNavigate={(route) => navigation.navigate(route)} />

      {/* Search Bar & Add Button */}
      <View
        className="px-4 py-4 flex-row items-center border-b"
        style={{ borderBottomColor: isDark ? colors.border : '#F4F6F8' }}
      >
        <View
          className="flex-1 h-11 rounded-2xl flex-row items-center px-4"
          style={{ backgroundColor: isDark ? colors.surface : '#F4F6F8' }}
        >
          <Text className="text-lg opacity-50">🔍</Text>
          <TextInput
            placeholder="Search active leads..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="flex-1 ml-3 text-sm"
            style={{ color: colors.text }}
          />
        </View>
        <TouchableOpacity
          onPress={() => setCreateModalVisible(true)}
          style={[styles.addBtn, { backgroundColor: colors.primary.main }]}
        >
          <Text className="text-white text-2xl font-black">+</Text>
        </TouchableOpacity>
      </View>

      {/* Main Feature Tabs */}
      <View className="pt-2">
        <View
          className="mx-4 p-1 rounded-[20px] flex-row items-center"
          style={{ backgroundColor: isDark ? colors.surface : '#F4F6F8' }}
        >
          {(['issued', 'selfGen', 'rehash'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setCurrentTab(tab)}
              style={[
                styles.tabItem,
                {
                  backgroundColor:
                    currentTab === tab ? (isDark ? colors.background : '#fff') : 'transparent',
                },
                currentTab === tab && styles.tabItemActive,
              ]}
            >
              <Text
                className="text-[10px] font-black tracking-widest uppercase"
                style={{ color: currentTab === tab ? colors.text : colors.textSecondary }}
              >
                {tab === 'issued' ? 'ISSUED' : tab === 'selfGen' ? 'SELF GENS' : 'REHASH'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Dynamic Subtabs */}
      <View className="flex-row px-4 py-4">
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
              label="Active"
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
              onPress={() => {
                setSelectedLead(item);
                setInitialTool('pitchbook');
                setCenterModalVisible(true);
              }}
              onActionPress={() => handleActionPress(item)}
            />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary.main}
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-20">
              <Text className="text-[40px] opacity-30 mb-4">📂</Text>
              <Text
                className="text-sm font-black opacity-40 text-center max-w-[200px]"
                style={{ color: colors.text }}
              >
                No records found in this category.
              </Text>
            </View>
          }
        />
      )}

      {/* Floating Meta Indicator */}
      <View
        className="absolute right-5 px-4 py-3 rounded-2xl flex-row items-center border shadow-xl"
        style={{
          bottom: 24 + insets.bottom,
          backgroundColor: isDark ? colors.surface : '#fff',
          borderColor: isDark ? colors.border : '#F4F6F8',
        }}
      >
        <Text className="text-xl font-black" style={{ color: colors.primary.main }}>
          {filteredLeads.length}
        </Text>
        <Text
          className="text-[9px] font-black tracking-widest ml-2 opacity-60 uppercase"
          style={{ color: colors.textSecondary }}
        >
          Leads Available
        </Text>
      </View>

      {createModalVisible && (
        <LeadCreateModal
          visible={createModalVisible}
          onClose={() => setCreateModalVisible(false)}
          onSuccess={onRefresh}
          user={user}
        />
      )}
      {centerModalVisible && selectedLead && (
        <LeadCenterModal
          visible={centerModalVisible}
          onClose={() => {
            setCenterModalVisible(false);
            setInitialTool(undefined);
          }}
          lead={selectedLead}
          initialTool={initialTool}
          navigation={navigation}
        />
      )}
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
    borderRadius: 16,
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 16,
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
        className="text-[13px] font-bold pb-1.5"
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
