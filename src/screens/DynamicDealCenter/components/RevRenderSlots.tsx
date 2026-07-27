import React, { useMemo, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useRevRenderRunsQuery } from '../../../hooks/useLeadQuery';
import { resolveS3Url } from '../../../utils/s3-utils';

/**
 * "Add Renders" field on the rollout quote card (web parity:
 * `src/sections/deal-center/components/AddRendersField.js`). The rep associates the
 * before/after renders they generated with THIS calculator's job build; the
 * selection persists as `selectedRenders[]` and the Investment Center reads it back.
 *
 * Collapsed → a dashed "Add Renders" card that opens a picker modal.
 * Modal      → a "JOB PHOTOS" grid of every generated render; tap to select.
 * Expanded   → the chosen render thumbnails (remove with ✕) + an "Add" tile.
 */

export interface RenderPair {
  runId: string;
  originalUrl: string;
  generatedUrl: string;
  s3UrlOriginal?: string;
  s3UrlGenerated?: string;
  bucketName?: string;
  viewLabel?: string;
  category?: string;
  subcategory?: string;
}

const keyOf = (p: any) => String(p?.runId || p?._id || p?.generatedUrl || '');
const imgOf = (p: any) =>
  p?.generatedUrl || (p?.s3UrlGenerated ? resolveS3Url(p.s3UrlGenerated) : '') || '';
const labelOf = (p: any) => p?.viewLabel || p?.subcategory || p?.category || 'Render';

/** Normalize raw rev-render runs into deduped before/after pairs (web `buildRevRenderPairs`). */
export function buildRenderPairs(runs: any[]): RenderPair[] {
  const seen = new Set<string>();
  const pairs: RenderPair[] = [];
  (Array.isArray(runs) ? runs : []).forEach((r: any) => {
    const originalUrl = r?.originalUrl || (r?.s3UrlOriginal ? resolveS3Url(r.s3UrlOriginal) : '');
    const generatedUrl = r?.generatedUrl || (r?.s3UrlGenerated ? resolveS3Url(r.s3UrlGenerated) : '');
    if (!originalUrl || !generatedUrl) return;
    const dedupe = String(r?.s3UrlGenerated || generatedUrl);
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    pairs.push({
      runId: String(r?.runId || r?._id || dedupe),
      originalUrl,
      generatedUrl,
      s3UrlOriginal: r?.s3UrlOriginal || '',
      s3UrlGenerated: r?.s3UrlGenerated || '',
      bucketName: r?.bucketName || '',
      viewLabel: r?.viewLabel || r?.subcategory || r?.category || '',
      category: r?.category || '',
      subcategory: r?.subcategory || '',
    });
  });
  return pairs.reverse(); // newest first
}

interface Props {
  leadId?: string;
  selected?: any[];
  onChange: (renders: RenderPair[]) => void;
  /** kept for API compatibility — renders stay editable even on a confirmed rollout. */
  locked?: boolean;
}

const GREEN = '#4CBB17';

function IconBox() {
  return (
    <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: '#EEF2F6', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="images-outline" size={22} color="#637381" />
    </View>
  );
}

export function RevRenderSlots({ leadId, selected = [], onChange }: Props) {
  const { data: runs, isLoading } = useRevRenderRunsQuery(leadId || '');
  const pairs = useMemo(() => buildRenderPairs(runs || []), [runs]);
  const selectedList: RenderPair[] = useMemo(() => (Array.isArray(selected) ? selected : []), [selected]);
  const selectedKeys = useMemo(() => new Set(selectedList.map(keyOf)), [selectedList]);
  const [modalVisible, setModalVisible] = useState(false);

  const toggle = (pair: RenderPair) => {
    const k = keyOf(pair);
    if (selectedKeys.has(k)) onChange(selectedList.filter((s) => keyOf(s) !== k));
    else onChange([...selectedList, pair]);
  };
  const remove = (pair: RenderPair) => onChange(selectedList.filter((s) => keyOf(s) !== keyOf(pair)));

  const hasSelection = selectedList.length > 0;

  return (
    <View style={{ marginHorizontal: 14, marginBottom: 14 }}>
      {hasSelection ? (
        // ── Expanded: chosen renders + Add tile ──
        <View style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: GREEN, borderRadius: 16, backgroundColor: '#F8FAFC', padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconBox />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#1C252E' }}>Add Renders</Text>
              <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 1 }}>
                {selectedList.length} render{selectedList.length === 1 ? '' : 's'} selected
              </Text>
            </View>
            <View style={{ minWidth: 26, height: 26, borderRadius: 13, backgroundColor: '#EBF9E1', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: GREEN }}>{selectedList.length}</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
            {selectedList.map((pair) => (
              <View key={keyOf(pair)} style={{ width: 96, alignItems: 'center' }}>
                <View style={{ width: 96, height: 88, borderRadius: 12, borderWidth: 2, borderColor: GREEN, overflow: 'hidden', backgroundColor: '#E2E8F0' }}>
                  <Image source={{ uri: imgOf(pair) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                </View>
                <TouchableOpacity
                  onPress={() => remove(pair)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={{ position: 'absolute', top: -8, right: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: '#FF5630', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}
                >
                  <Ionicons name="close" size={14} color="#fff" />
                </TouchableOpacity>
                <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: '#637381', marginTop: 4 }}>{labelOf(pair)}</Text>
              </View>
            ))}

            <TouchableOpacity
              onPress={() => setModalVisible(true)}
              style={{ width: 96, height: 88, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: GREEN, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0FDF4' }}
            >
              <Ionicons name="add" size={22} color={GREEN} />
              <Text style={{ fontSize: 12, fontWeight: '900', color: GREEN, marginTop: 2 }}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // ── Collapsed: Add Renders prompt ──
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setModalVisible(true)}
          style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#E2E8F0', borderRadius: 16, backgroundColor: '#F8FAFC', padding: 14 }}
        >
          <IconBox />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#1C252E' }}>Add Renders</Text>
            <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 1 }}>Select before/after photos for estimate</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
        </TouchableOpacity>
      )}

      {/* ── Picker modal ── */}
      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        {/* A RN Modal renders outside the root SafeAreaProvider, so its own provider
            is needed for SafeAreaView insets to resolve inside the modal. */}
        <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={['top', 'bottom']}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEF2F6' }}>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <Ionicons name="chevron-back" size={20} color="#334155" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E' }}>Add Renders</Text>
              <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 1 }}>Select photos to show before/after on estimate</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#637381', letterSpacing: 1, marginBottom: 14 }}>JOB PHOTOS</Text>
              {isLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <ActivityIndicator size="small" color={GREEN} />
                  <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>Loading renders…</Text>
                </View>
              ) : pairs.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Ionicons name="image-outline" size={26} color="#CBD5E1" />
                  <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
                    No renders generated yet.{'\n'}Use RevRender to create before/after images.
                  </Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                  {pairs.map((pair) => {
                    const isSel = selectedKeys.has(keyOf(pair));
                    return (
                      <TouchableOpacity
                        key={keyOf(pair)}
                        activeOpacity={0.85}
                        onPress={() => toggle(pair)}
                        style={{ width: 150, borderRadius: 12, borderWidth: 2, borderColor: isSel ? GREEN : '#E2E8F0', backgroundColor: '#fff', overflow: 'hidden' }}
                      >
                        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '900', color: '#1C252E', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 }}>{labelOf(pair)}</Text>
                        <View style={{ position: 'relative' }}>
                          <Image source={{ uri: imgOf(pair) }} style={{ width: '100%', height: 120, backgroundColor: '#E2E8F0' }} resizeMode="cover" />
                          {isSel && (
                            <View style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name="checkmark" size={15} color="#fff" />
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>

          {/* Footer — Done (SafeAreaView's bottom edge already clears the home indicator) */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: '#F8FAFC' }}>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={{ backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#fff' }}>Done</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}
