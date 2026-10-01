import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LeadService } from '../../../services/api/leads';
import { SendToHomeownerSheet, ShareableRender } from './SendToHomeownerSheet';

const GREEN = '#2EDE56';

type Run = {
  runId: string;
  viewLabel?: string;
  generatedUrl?: string | null;
  s3UrlGenerated?: string | null;
  createdAt?: string;
  selections?: Record<string, any> | null;
};

/** A run carries renderType in its stored selections — that is how Core and Lighting are told apart. */
const isLighting = (r: Run) => r.selections?.renderType === 'look' || r.selections?.renderType === 'lighting';

function detailFor(r: Run): string {
  if (isLighting(r)) {
    const name = r.selections?.lookName;
    const pattern = r.selections?.pattern === 'single' ? 'Single color' : 'Alternating';
    return name ? `${name} · ${pattern}` : pattern;
  }
  // Core: list whichever surfaces were chosen.
  const sel = r.selections ?? {};
  const parts = ['soffit', 'fascia', 'gutter', 'downspout']
    .filter((k) => sel[k])
    .map((k) => `${k[0].toUpperCase()}${k.slice(1)}: ${sel[k]}`);
  return parts.join(' · ');
}

/**
 * Results — the renders that are ready, and sending them to the homeowner.
 *
 * The homeowner receives a LINK, not the images, so "Send" collects a recipient
 * and the backend mints and delivers it. Nothing here downloads or attaches an
 * image.
 */
export function ResultsPanel({
  leadId,
  isDark,
  defaultName,
  defaultPhone,
  defaultEmail,
  onBack,
}: {
  leadId: string;
  isDark: boolean;
  defaultName?: string;
  defaultPhone?: string;
  defaultEmail?: string;
  onBack: () => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendFor, setSendFor] = useState<ShareableRender[] | null>(null);
  const [sentIds, setSentIds] = useState<string[]>([]);

  const sub = isDark ? '#919EAB' : '#637381';
  const label = isDark ? '#fff' : '#212B36';
  const cardBg = isDark ? '#1E1E1E' : '#fff';

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await LeadService.getRevRenderRuns(leadId);
      const list: Run[] = res.data?.runs || res.data?.data?.runs || [];
      // Newest first, and only runs that actually produced an image.
      setRuns(
        list
          .filter((r) => r.generatedUrl || r.s3UrlGenerated)
          .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
      );
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not load renders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const shareable = (r: Run): ShareableRender => ({
    runId: r.runId,
    label: r.viewLabel || 'Render',
    detail: detailFor(r),
  });

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={GREEN} />
        <Text className="text-[13px] mt-3" style={{ color: sub }}>Loading your renders…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GREEN} />
        }
      >
        <View className="px-4 py-6">
          <View className="flex-row items-center mb-6">
            <TouchableOpacity
              onPress={onBack}
              accessibilityLabel="Back"
              className="mr-4 w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff', borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#F4F6F8' }}
            >
              <Icon name="arrow-left" size={22} color={sub} />
            </TouchableOpacity>
            <View>
              <Text className="text-xl font-bold" style={{ color: label }}>Your Renders</Text>
              <Text className="text-sm font-bold" style={{ color: sub }}>
                {runs.length} ready
              </Text>
            </View>
          </View>

          {!!error && (
            <View className="rounded-[14px] p-4 mb-4" style={{ backgroundColor: '#FF563022' }}>
              <Text className="text-[13px]" style={{ color: '#B71D18' }}>{error}</Text>
            </View>
          )}

          {runs.length === 0 && !error && (
            <View className="items-center py-16">
              <Icon name="image-off-outline" size={36} color={sub} />
              <Text className="text-[14px] font-bold mt-3" style={{ color: label }}>No renders yet</Text>
              <Text className="text-[12px] mt-1 text-center" style={{ color: sub }}>
                Generate from the queue and they will appear here.
              </Text>
            </View>
          )}

          {runs.map((r, i) => {
            const uri = r.generatedUrl || r.s3UrlGenerated || undefined;
            const lighting = isLighting(r);
            const sent = sentIds.includes(r.runId);
            return (
              <View
                key={r.runId}
                className="rounded-[20px] overflow-hidden mb-5"
                style={{ backgroundColor: cardBg, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#F4F6F8' }}
              >
                {uri && <Image source={{ uri }} style={{ width: '100%', height: 200 }} resizeMode="cover" />}

                <View className="p-4">
                  <View className="flex-row items-center mb-1">
                    <View className="w-7 h-7 rounded-full items-center justify-center mr-2" style={{ backgroundColor: GREEN }}>
                      <Text className="text-white font-black text-[12px]">{i + 1}</Text>
                    </View>
                    <Text className="text-[16px] font-black flex-1" style={{ color: label }} numberOfLines={1}>
                      {r.viewLabel || 'Render'}
                    </Text>
                    <View
                      className="rounded-full px-2 py-0.5 flex-row items-center"
                      style={{ backgroundColor: lighting ? '#1F2937' : isDark ? '#2A2F36' : '#F4F6F8' }}
                    >
                      {lighting && <View className="rounded-full mr-1" style={{ width: 5, height: 5, backgroundColor: '#FFC94D' }} />}
                      <Text className="text-[10px] font-black tracking-wider" style={{ color: lighting ? '#FFC94D' : sub }}>
                        {lighting ? 'LIGHTING' : 'CORE'}
                      </Text>
                    </View>
                  </View>

                  <Text className="text-[12px] mb-4" style={{ color: sub }} numberOfLines={2}>
                    {detailFor(r)}
                  </Text>

                  <TouchableOpacity
                    onPress={() => setSendFor([shareable(r)])}
                    accessibilityRole="button"
                    className="rounded-full items-center justify-center flex-row"
                    style={{ minHeight: 46, backgroundColor: sent ? (isDark ? '#2A2F36' : '#F4F6F8') : GREEN }}
                  >
                    <Icon name={sent ? 'check' : 'send'} size={16} color={sent ? sub : '#fff'} style={{ marginRight: 8 }} />
                    <Text className="text-[14px] font-black" style={{ color: sent ? sub : '#fff' }}>
                      {sent ? 'Sent' : 'Send to homeowner'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {runs.length > 0 && (
        <View className="px-4 pb-6 pt-2" style={{ backgroundColor: isDark ? '#121212' : '#fff' }}>
          <TouchableOpacity
            onPress={() => setSendFor(runs.map(shareable))}
            accessibilityRole="button"
            className="rounded-full items-center justify-center flex-row"
            style={{ minHeight: 54, backgroundColor: GREEN }}
          >
            <Icon name="send" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text className="text-[16px] font-black text-white">Send all to homeowner</Text>
          </TouchableOpacity>
        </View>
      )}

      <SendToHomeownerSheet
        visible={sendFor !== null}
        renders={sendFor ?? []}
        leadId={leadId}
        defaultName={defaultName}
        defaultPhone={defaultPhone}
        defaultEmail={defaultEmail}
        isDark={isDark}
        onClose={() => setSendFor(null)}
        onSent={(res) => { if (res.sent) setSentIds((p) => [...p, ...(sendFor ?? []).map((s) => s.runId)]); }}
      />
    </View>
  );
}
