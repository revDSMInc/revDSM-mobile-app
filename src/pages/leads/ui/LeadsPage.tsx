import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../shared/hooks/useAuth';
import { useTheme } from '../../../app/providers/ThemeProvider';
import { useLeadsData } from '../../../features/sales/hooks/useLeadsData';
import type { Lead } from '../../../entities/lead/model/types';

const STATUS_MAP: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: '#D3FCD2', text: '#118D57', label: 'Active' },
  sold: { bg: '#C8FAD6', text: '#007867', label: 'Sold' },
  no_sale: { bg: '#FFE9D5', text: '#B71D18', label: 'No Sale' },
  pending: { bg: '#FFF5CC', text: '#B76E00', label: 'Pending' },
  cancelled: { bg: '#FFE9D5', text: '#B71D18', label: 'Cancelled' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { bg: '#F4F6F8', text: '#637381', label: status };
  return (
    <View
      style={{ backgroundColor: s.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}
    >
      <Text style={{ color: s.text, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' }}>
        {s.label}
      </Text>
    </View>
  );
}

function LeadCard({ lead, colors }: { lead: Lead; colors: any }) {
  const date = lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '—';
  const install = lead.scheduleTime?.date
    ? lead.scheduleTime.date === 'TBD'
      ? 'TBD'
      : new Date(lead.scheduleTime.date).toLocaleDateString()
    : '—';

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 14,
        padding: 16,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 2 }}>
            {lead.customerName || lead.title || 'Customer'}
          </Text>
          {lead.address ? (
            <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
              📍 {lead.address}
            </Text>
          ) : null}
        </View>
        <StatusBadge status={lead.status || 'pending'} />
      </View>

      <View style={{ flexDirection: 'row', marginTop: 12 }}>
        <View style={{ marginRight: 20 }}>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 10,
              fontWeight: '600',
              marginBottom: 2,
            }}
          >
            CREATED
          </Text>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '500' }}>{date}</Text>
        </View>
        <View>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 10,
              fontWeight: '600',
              marginBottom: 2,
            }}
          >
            INSTALL DATE
          </Text>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '500' }}>{install}</Text>
        </View>
      </View>
    </View>
  );
}

export default function LeadsPage() {
  const { logout, user } = useAuth();
  const { leads: rawLeads, loading, refresh } = useLeadsData();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const leads: Lead[] = Array.isArray(rawLeads) ? rawLeads : [];
  const filtered = leads.filter((l) =>
    (l.customerName || l.title || '').toLowerCase().includes(query.toLowerCase())
  );

  const stats = [
    { label: 'Total', value: leads.length },
    { label: 'Active', value: leads.filter((l) => l.status === 'active').length },
    { label: 'Sold', value: leads.filter((l) => l.status === 'sold').length },
  ];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (typeof refresh === 'function') await refresh();
    } catch (e) {
      console.warn('Refresh failed', e);
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 14,
        }}
      >
        <View>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Welcome back,</Text>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>
            {user?.firstName || 'Rep'} 👋
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => typeof logout === 'function' && logout()}
          style={{
            backgroundColor: colors.surface,
            borderRadius: 20,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>
            Logout
          </Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', marginHorizontal: 20, marginBottom: 14 }}>
        {stats.map((s, i) => (
          <View
            key={s.label}
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderRadius: 12,
              padding: 12,
              alignItems: 'center',
              marginRight: i < stats.length - 1 ? 10 : 0,
            }}
          >
            <Text style={{ color: '#4CBB17', fontSize: 20, fontWeight: '800' }}>{s.value}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Search */}
      <View
        style={{
          marginHorizontal: 20,
          marginBottom: 14,
          backgroundColor: colors.surface,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ marginRight: 8, fontSize: 16 }}>🔍</Text>
        <TextInput
          placeholder="Search leads..."
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          style={{ flex: 1, fontSize: 14, color: colors.text }}
        />
      </View>

      {/* List */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#4CBB17" size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => <LeadCard lead={item} colors={colors} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4CBB17" />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                {query ? 'No matching leads' : 'No leads yet'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
