import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { useLeadsData } from '../../hooks/useLeadsData';
import { useWorkLeadMutation } from '../../hooks/useLeadMutation';
import LeadCreateModal from '../../widgets/components/modal/LeadCreate';
import LeadCenterModal from '../../widgets/components/modal/LeadCenter';
import { LeadCard } from '../../widgets/components/card/LeadCard';
import { Header } from '../../widgets/components/header/MainHeader';
import { RootStackParamList } from '../../navigation';
import type { Lead } from '../../config/types/lead';

export default function LeadsPage() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  
  const [currentTab, setCurrentTab] = useState<'issued' | 'selfGen' | 'rehash'>('issued');
  const [issuedSubTab, setIssuedSubTab] = useState<'today' | 'tomorrow'>('today');
  const [selfGenSubTab, setSelfGenSubTab] = useState<'today' | 'archived'>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [centerModalVisible, setCenterModalVisible] = useState(false);

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

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const q = searchQuery.toLowerCase();
    return leads.filter(l => {
      const name = `${l.customerDetails?.firstName} ${l.customerDetails?.lastName}`.toLowerCase();
      return name.includes(q) || l.fullAddress?.toLowerCase().includes(q) || l.leadId?.toLowerCase().includes(q);
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
    } catch (err) { }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header onNavigate={(route) => navigation.navigate(route)} />

      {/* Search Bar */}
      <View style={[styles.searchContainer, { borderBottomColor: isDark ? colors.border : colors.grey[200] }]}>
        <View style={[styles.searchBar, { backgroundColor: isDark ? colors.surface : colors.grey[200] }]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder="Search active leads..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
        <TouchableOpacity 
          onPress={() => setCreateModalVisible(true)} 
          style={[styles.addButton, { backgroundColor: colors.primary.main }]}
        >
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Main Tabs - Using StyleSheet to fix Navigation Context Error */}
      <View style={styles.tabContainerOuter}>
        <View style={[styles.tabContainerInner, { backgroundColor: isDark ? colors.surface : colors.grey[200] }]}>
          {(['issued', 'selfGen', 'rehash'] as const).map((tab) => (
            <TouchableOpacity 
              key={tab} 
              onPress={() => setCurrentTab(tab)} 
              style={[
                styles.tabButton,
                currentTab === tab && styles.tabActiveShadow,
                { backgroundColor: currentTab === tab ? (isDark ? colors.background : '#fff') : 'transparent' }
              ]}
            >
              <Text 
                style={[
                  styles.tabText,
                  { color: currentTab === tab ? colors.text : colors.textSecondary }
                ]}
              >
                {tab === 'issued' ? 'ISSUED' : tab === 'selfGen' ? 'SELF GENS' : 'REHASH'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Subtabs Area */}
      <View style={styles.subtabContainer}>
        {currentTab === 'issued' ? (
          <>
            <SubTab label="Today" active={issuedSubTab === 'today'} onPress={() => setIssuedSubTab('today')} />
            <SubTab label="Tomorrow" active={issuedSubTab === 'tomorrow'} onPress={() => setIssuedSubTab('tomorrow')} />
          </>
        ) : currentTab === 'selfGen' ? (
          <>
            <SubTab label="Active" active={selfGenSubTab === 'today'} onPress={() => setSelfGenSubTab('today')} />
            <SubTab label="Archived" active={selfGenSubTab === 'archived'} onPress={() => setSelfGenSubTab('archived')} />
          </>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loaderContainer}>
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
              isArchived={(currentTab === 'selfGen' && selfGenSubTab === 'archived') || currentTab === 'rehash'} 
              actionLoading={workMutation.isPending && selectedLead?._id === item._id}
              onPress={() => {
                setSelectedLead(item);
                setCenterModalVisible(true);
              }}
              onActionPress={() => handleActionPress(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary.main} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📂</Text>
              <Text style={[styles.emptyText, { color: colors.text }]}>No leads found in this category.</Text>
            </View>
          }
        />
      )}

      {/* Floating Stat Indicator - StyleSheet Refactored */}
      <View style={[styles.floatingStat, { backgroundColor: isDark ? colors.surface : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }]}>
        <Text style={[styles.statValue, { color: colors.primary.main }]}>{filteredLeads.length}</Text>
        <Text style={[styles.statLabel, { color: colors.textSecondary }]}>LEADS AVAILABLE</Text>
      </View>

      <LeadCreateModal visible={createModalVisible} onClose={() => setCreateModalVisible(false)} onSuccess={onRefresh} user={user} />
      <LeadCenterModal visible={centerModalVisible} onClose={() => setCenterModalVisible(false)} lead={selectedLead} />
    </SafeAreaView>
  );
}

function SubTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={styles.subtabButton}>
      <Text 
        style={[
          styles.subtabText,
          { 
            color: active ? colors.primary.main : colors.textSecondary,
            borderBottomColor: active ? colors.primary.main : 'transparent',
            borderBottomWidth: active ? 2 : 0
          }
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  searchBar: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  searchIcon: {
    fontSize: 16,
    opacity: 0.5,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  tabContainerOuter: {
    paddingTop: 8,
  },
  tabContainerInner: {
    marginHorizontal: 16,
    padding: 4,
    borderRadius: 20,
    flexDirection: 'row',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 16,
  },
  tabActiveShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  tabText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  subtabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  subtabButton: {
    marginRight: 24,
  },
  subtabText: {
    fontSize: 13,
    fontWeight: '700',
    paddingBottom: 6,
  },
  loaderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 40,
    opacity: 0.3,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 16,
    opacity: 0.4,
    textAlign: 'center',
    maxWidth: 200,
  },
  floatingStat: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
    marginLeft: 8,
    opacity: 0.7,
  },
});
