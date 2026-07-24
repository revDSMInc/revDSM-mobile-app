import React, { useMemo } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useRevRenderRunsQuery } from '../../../hooks/useLeadQuery';
import { resolveS3Url } from '../../../utils/s3-utils';

/**
 * RevRender slot picker shown at the top of the rollout quote card (web parity:
 * `src/sections/deal-center/components/AddRendersField.js`). The rep taps to
 * associate the before/after renders they generated with THIS calculator's job
 * build; the selection persists on the calculator as `selectedRenders[]` and is
 * read back by the Investment Center to show the images under the job scope.
 *
 * Selection is keyed by `runId` (falling back to the generated URL) so toggling is
 * stable across re-signs. Each stored descriptor keeps the full run identity
 * (`runId`, both URLs, the S3 keys + bucket, and the view/category labels) so the
 * Investment Center can re-resolve secure links later.
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
  // Newest first (web reverses the runs for display).
  return pairs.reverse();
}

interface Props {
  leadId?: string;
  selected?: any[];
  onChange: (renders: RenderPair[]) => void;
  /** A confirmed rollout locks the card — show the selection read-only. */
  locked?: boolean;
}

export function RevRenderSlots({ leadId, selected = [], onChange, locked = false }: Props) {
  const { data: runs, isLoading } = useRevRenderRunsQuery(leadId || '');
  const pairs = useMemo(() => buildRenderPairs(runs || []), [runs]);
  const selectedKeys = useMemo(() => new Set((selected || []).map(keyOf)), [selected]);

  const toggle = (pair: RenderPair) => {
    if (locked) return;
    const k = keyOf(pair);
    if (selectedKeys.has(k)) {
      onChange((selected || []).filter((s) => keyOf(s) !== k) as RenderPair[]);
    } else {
      onChange([...(selected || []), pair] as RenderPair[]);
    }
  };

  // Locked: only show what was chosen (nothing → render nothing so the card stays tidy).
  const shownPairs = locked
    ? pairs.filter((p) => selectedKeys.has(keyOf(p)))
    : pairs;

  if (locked && shownPairs.length === 0) return null;

  return (
    <View style={{ marginHorizontal: 14, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Ionicons name="images-outline" size={14} color="#212B36" />
        <Text style={{ fontSize: 12, fontWeight: '900', color: '#212B36', marginLeft: 6, letterSpacing: 0.3 }}>
          RevRender Slots
        </Text>
        {selectedKeys.size > 0 && (
          <View style={{ marginLeft: 8, backgroundColor: '#EBF9E1', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#4CBB17' }}>{selectedKeys.size} selected</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
          <ActivityIndicator size="small" color="#4CBB17" />
          <Text style={{ fontSize: 11, color: '#94A3B8', marginLeft: 8 }}>Loading renders…</Text>
        </View>
      ) : shownPairs.length === 0 ? (
        <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: '#E2E8F0', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
          <Ionicons name="image-outline" size={18} color="#CBD5E1" />
          <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, textAlign: 'center' }}>
            No renders generated yet.{'\n'}Use RevRender to create before/after images.
          </Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {shownPairs.map((pair) => {
            const isSel = selectedKeys.has(keyOf(pair));
            return (
              <TouchableOpacity
                key={keyOf(pair)}
                activeOpacity={locked ? 1 : 0.8}
                onPress={() => toggle(pair)}
                style={{
                  width: 120,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: isSel ? '#4CBB17' : '#E2E8F0',
                  overflow: 'hidden',
                  backgroundColor: '#fff',
                }}
              >
                <View style={{ position: 'relative' }}>
                  <Image source={{ uri: pair.generatedUrl }} style={{ width: '100%', height: 84, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
                  {isSel && (
                    <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#4CBB17', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="checkmark" size={13} color="#fff" />
                    </View>
                  )}
                </View>
                {!!pair.viewLabel && (
                  <Text numberOfLines={1} style={{ fontSize: 9, fontWeight: '700', color: '#637381', paddingHorizontal: 6, paddingVertical: 5 }}>
                    {pair.viewLabel}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
