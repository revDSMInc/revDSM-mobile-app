import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  BackHandler,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MIcon from 'react-native-vector-icons/MaterialIcons';
import { REV_RENDER_VIEW_GROUPS, REV_RENDER_COLORS, IMAGE_CATEGORIES } from '../../constants/lead-center';
import { RootStackParamList } from '../../navigation';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';
import { PhotoPeekPressable } from '../../widgets/common/PhotoPeekPressable';
import { useInspectionSchema } from '../../hooks/useInspectionSchema';
import {
  getTopTabs,
  indexSchema,
  getCapturableSlots,
  isContextSelector,
  norm,
  type InspectionCategory,
} from '../../widgets/components/lead-center/dynamic-inspection-schema-utils';
import { IconifyIcon } from '../../widgets/common/IconifyIcon';

// ─── Dynamic (schema-driven) product picker helpers — port of web before.js ─────
// Photos captured via the dynamic inspection flow are stored under a PRODUCT-SCOPED
// category `"<productName> — <categoryLabel>"` (em dash). RevRender groups them by
// product + schema tab, exactly like the web "before" picker.
const GREEN = '#4CBB17';

const scopeCategory = (productKey: string, label: string) =>
  productKey ? `${productKey} — ${label}` : label;
const isAnnotatedRR = (p: any) =>
  String(p?.subcategory || '').toLowerCase().includes('(annotated)');

/** Cards for the active product+tab: photos whose scoped category matches a leaf of
 *  the tab, labelled by their slot's display name (web buildPickerCardsForCategory). */
function buildSchemaPickerCards(
  photos: any[],
  productKey: string,
  activeCategory: InspectionCategory | null
): any[] {
  if (!activeCategory) return [];
  const { leafCategories } = indexSchema([activeCategory]);
  const expectedCats = new Set(
    leafCategories.map((c) => norm(scopeCategory(productKey, c.label as string)))
  );
  const slotLabelByKey = new Map<string, string>();
  leafCategories.forEach((cat) => {
    getCapturableSlots(cat).forEach((slot) => {
      slotLabelByKey.set(`${norm(cat.label)}||${norm(slot.storageName)}`, slot.name as string);
    });
  });
  const cards: any[] = [];
  (photos || []).forEach((img: any, idx: number) => {
    const url = img?.secureUrl || img?.uri || img?.s3url;
    if (!url) return;
    if (isAnnotatedRR(img)) return;
    if (!expectedCats.has(norm(img.category))) return; // product + tab filter
    const scopedCat = String(img.category || '');
    const baseCategory = scopedCat.includes(' — ')
      ? scopedCat.split(' — ').slice(1).join(' — ').trim()
      : scopedCat;
    const displayLabel =
      slotLabelByKey.get(`${norm(baseCategory)}||${norm(img.subcategory)}`) ||
      img.subcategory ||
      'Photo';
    cards.push({
      ...img,
      uri: url,
      label: displayLabel,
      viewId: `dynamic-${idx}-${norm(img.subcategory)}`,
      viewLabel: displayLabel,
    });
  });
  return cards;
}

/** {filled,total} for a tab: total = capturable slots under its leaves, filled = slots
 *  with a matching product-scoped photo (web countPhotosForTab). */
function countPhotosForTab(
  tab: InspectionCategory,
  photos: any[],
  productKey: string
): { filled: number; total: number } {
  const { leafCategories } = indexSchema([tab]);
  let total = 0;
  let filled = 0;
  leafCategories.forEach((cat) => {
    const scoped = scopeCategory(productKey, cat.label as string);
    const underLabel = (photos || []).filter(
      (p) => !isAnnotatedRR(p) && norm(p.category) === norm(scoped)
    );
    if (isContextSelector(cat)) {
      const slotTotal = Array.isArray((cat as any).contextSlots)
        ? (cat as any).contextSlots.length
        : 0;
      total += slotTotal;
      filled += slotTotal > 0 ? Math.min(underLabel.length, slotTotal) : underLabel.length;
      return;
    }
    const slots = getCapturableSlots(cat);
    const definedStorage = new Set(slots.map((s) => norm(s.storageName)));
    slots.forEach((slot) => {
      total += 1;
      if (underLabel.some((p) => norm(p.subcategory) === norm(slot.storageName))) filled += 1;
    });
    // Extras: captured subcategories that aren't one of the defined slots count too.
    const extras = new Set<string>();
    underLabel.forEach((p) => {
      const s = norm(p.subcategory);
      if (s && !definedStorage.has(s)) extras.add(s);
    });
    total += extras.size;
    filled += extras.size;
  });
  return { filled, total };
}

type RevRenderRouteProp = RouteProp<RootStackParamList, 'RevRender'>;

// ─── Constants ────────────────────────────────────────────────────────────────

const MATERIAL_SECTIONS = [
  {
    key: 'soffit',
    label: 'Soffit',
    types: ['Pinhole Soffit', 'Hidden Vent Soffit'],
    getColors: (type?: string) => type === 'Pinhole Soffit' ? REV_RENDER_COLORS.pinholeSoffit : REV_RENDER_COLORS.hiddenVentSoffit
  },
  {
    key: 'fascia',
    label: 'Fascia Wrap',
    types: [],
    getColors: () => REV_RENDER_COLORS.fascia
  },
  {
    key: 'gutter',
    label: 'Gutter',
    types: ['K-Style'],
    getColors: () => REV_RENDER_COLORS.gutter
  },
  {
    key: 'downspout',
    label: 'Downspout',
    types: ['3x4 Rectangular'],
    getColors: () => REV_RENDER_COLORS.gutter
  },
];

const INITIAL_CONFIG = {
  sameColor: true,
  selectedCommonColor: REV_RENDER_COLORS.common[0],
  soffit: 'Hidden Vent Soffit',
  soffitColor: REV_RENDER_COLORS.hiddenVentSoffit[0],
  soffitChecked: false,
  fascia: null,
  fasciaColor: REV_RENDER_COLORS.fascia[0],
  fasciaChecked: false,
  gutter: 'K-Style',
  gutterColor: REV_RENDER_COLORS.gutter[0],
  gutterChecked: false,
  downspout: '3x4 Rectangular',
  downspoutColor: REV_RENDER_COLORS.gutter[0],
  downspoutChecked: false,
};

const loadedUris = new Set<string>();

// ─── Payload Helpers ──────────────────────────────────────────────────────────

/** Converts a UI type label to snake_case API value, stripping the section label suffix.
 *  e.g. toApiType('Hidden Vent Soffit', 'Soffit') → 'hidden_vent'
 *       toApiType('K-Style', 'Gutter')            → 'k_style'
 */
const toApiType = (type: string | null, sectionLabel: string): string | null => {
  if (!type) return null;
  let cleaned = type.trim();
  // Strip trailing section label word (case-insensitive)
  const suffix = sectionLabel.trim();
  if (cleaned.toLowerCase().endsWith(suffix.toLowerCase())) {
    cleaned = cleaned.slice(0, -(suffix.length)).trim();
  }
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || null;
};

/** Extracts relative S3 key from a full S3 URL or returns the value as-is for local URIs.
 *  e.g. 'https://bucket.s3.amazonaws.com/images/SelfGen/file.jpg' → 'images/SelfGen/file.jpg'
 */
const extractS3Key = (url: string | undefined): string => {
  if (!url) return '';
  // Match 'https://..../path' or 'http://..../path' and extract everything after the host
  const match = url.match(/^https?:\/\/[^/]+\/(.+)/);
  if (match && match[1]) return match[1];
  // Not a full URL (device file:/// URI or already a relative path) — return as-is
  return url;
};

/** Extracts the filename from any URL or path. */
const getFilename = (url: string | undefined): string => {
  if (!url) return '';
  const withoutQuery = url.split('?')[0];
  const parts = withoutQuery.split('/');
  return parts[parts.length - 1] || '';
};

const HouseImage = ({ uri, style, height = 130 }: { uri: string; style?: any; height?: number }) => {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(!loadedUris.has(uri));
  return (
    <View style={[{ height, backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }, style]}>
      {loading && (
        <View className="absolute inset-0 items-center justify-center z-10">
          <ActivityIndicator color={colors.primary.main} />
        </View>
      )}
      <Image
        key={uri}
        source={{ uri, cache: 'force-cache' }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
        fadeDuration={0}
        onLoadStart={() => {
          if (!loadedUris.has(uri)) {
            setLoading(true);
          }
        }}
        onLoad={() => {
          loadedUris.add(uri);
          setLoading(false);
        }}
        onLoadEnd={() => {
          loadedUris.add(uri);
          setLoading(false);
        }}
        onError={() => {
          setLoading(false);
        }}
      />
    </View>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function RevRenderScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RevRenderRouteProp>();
  const { user } = useAuth();

  const { lead, sectionImages, onNavToDocs, onGenerate, onGenerateAll } = route.params;

  // ── Status & State ─────────────────────────────────────────────────────────
  const [status, setStatus] = useState<'grid' | 'config' | 'queue'>('grid');
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);
  const [renderQueue, setRenderQueue] = useState<any[]>([]);

  const [config, setConfig] = useState<any>(INITIAL_CONFIG);

  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // ── Dynamic (schema-driven) product picker ─────────────────────────────────
  // When the company uses the dynamic inspection flow, photos are product-scoped
  // ("<product> — <label>"). Show a product dropdown + schema tabs (web before.js),
  // falling back to the legacy REV_RENDER_VIEW_GROUPS grid otherwise.
  const { configuredProducts } = useInspectionSchema({ enabled: true });
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [dynTab, setDynTab] = useState(0);
  const [prodMenuOpen, setProdMenuOpen] = useState(false);
  // Anchor the product menu directly under the trigger button: measure it in the
  // window on open and position the menu absolutely at its bottom-left.
  const prodBtnRef = React.useRef<View>(null);
  const [prodMenuAnchor, setProdMenuAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const openProdMenu = () => {
    const node = prodBtnRef.current as any;
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        setProdMenuAnchor({ x, y: y + height + 6, width });
        setProdMenuOpen(true);
      });
    } else {
      setProdMenuOpen(true);
    }
  };

  // Flatten the grouped sectionImages back into a raw photo array (category = the map
  // key when a photo doesn't carry its own), so we can match by product-scoped category.
  const rawPhotos = useMemo(() => {
    const out: any[] = [];
    Object.entries(sectionImages || {}).forEach(([cat, imgs]) => {
      (imgs || []).forEach((img: any) => out.push({ ...img, category: img.category || cat }));
    });
    return out;
  }, [sectionImages]);

  const hasProductScopedPhotos = useMemo(
    () => rawPhotos.some((p) => String(p.category || '').includes(' — ')),
    [rawPhotos]
  );
  const useSchemaPicker = configuredProducts.length > 0 && hasProductScopedPhotos;

  useEffect(() => {
    if (!selectedProductId && configuredProducts.length > 0) {
      setSelectedProductId(configuredProducts[0].id as string);
    }
  }, [configuredProducts, selectedProductId]);
  // Reset the active tab when the product changes.
  useEffect(() => setDynTab(0), [selectedProductId]);

  const selectedProduct = useMemo(
    () => configuredProducts.find((p) => p.id === selectedProductId) || configuredProducts[0] || null,
    [configuredProducts, selectedProductId]
  );
  const productKey = selectedProduct?.name || (selectedProduct?.id as string) || '';
  const dynTopTabs = useMemo(
    () => getTopTabs(selectedProduct?.categories || []),
    [selectedProduct]
  );
  const dynActiveCategory =
    dynTopTabs[Math.min(dynTab, Math.max(dynTopTabs.length - 1, 0))] || null;
  const dynTabCounts = useMemo(
    () => dynTopTabs.map((t) => countPhotosForTab(t, rawPhotos, productKey)),
    [dynTopTabs, rawPhotos, productKey]
  );
  const schemaPickerCards = useMemo(
    () =>
      useSchemaPicker && dynActiveCategory
        ? buildSchemaPickerCards(rawPhotos, productKey, dynActiveCategory)
        : [],
    [useSchemaPicker, dynActiveCategory, rawPhotos, productKey]
  );

  // ── Analytics ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const userId = user?._id || user?.id;
    if (!userId) return;

    let screenName = 'before';
    let extraMeta: Record<string, any> = {};

    if (status === 'config') {
      screenName = 'before_configure';
      extraMeta = {
        viewId: selectedPhoto?.viewId,
        viewLabel: selectedPhoto?.viewLabel,
      };
    } else if (status === 'queue') {
      screenName = 'queue';
      // Match web queue.js: include totalRenders + hasLeadContext
      extraMeta = {
        totalRenders: renderQueue.length,
        hasLeadContext: !!(lead?._id || lead?.id || lead?.leadId),
      };
    }

    logEvent('view', {
      user_id: userId,
      module_type: 'rev_render',
      created_by: userId,
      meta: {
        leadId: lead?._id || lead?.id || lead?.leadId || null,
        jobId: lead?._id || lead?.id || lead?.leadId || null,
        screen: screenName,
        ...extraMeta,
      },
    });
  }, [status, selectedPhoto?.viewId, selectedPhoto?.viewLabel, user?._id, user?.id, lead?._id, lead?.id, lead?.leadId, renderQueue.length]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddToQueue = () => {
    const selections: any = {};
    const textureImageUrls: any = {};

    MATERIAL_SECTIONS.forEach(s => {
      const isChecked = config[`${s.key}Checked`];
      const type = config[s.key];
      const color = config[`${s.key}Color`];

      if (isChecked) {
        // API expects lowercase color name and snake_case type without section suffix
        selections[s.key] = color?.name?.toLowerCase() || null;
        selections[`${s.key}Type`] = toApiType(type, s.label);
        textureImageUrls[s.key] = color?.hex || null;
      } else {
        // Always include all components; null for unchecked ones
        selections[s.key] = null;
        selections[`${s.key}Type`] = null;
      }
    });

    const newRender = {
      id: Date.now(),
      photo: selectedPhoto,
      selections,
      textureImageUrls,
      viewId: selectedPhoto?.viewId,
      viewLabel: selectedPhoto?.viewLabel,
      summary: MATERIAL_SECTIONS.filter(s => config[`${s.key}Checked`]).map(s => ({
        label: s.label,
        type: config[s.key],
        colorName: config[`${s.key}Color`]?.name,
        colorHex: config[`${s.key}Color`]?.hex
      }))
    };

    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('add', {
        user_id: userId,
        module_type: 'rev_render',
        created_by: userId,
        meta: {
          leadId: lead?._id || lead?.id || lead?.leadId || null,
          jobId: lead?._id || lead?.id || lead?.leadId || null,
          screen: 'before_configure',
          viewId: selectedPhoto?.viewId,
          viewLabel: selectedPhoto?.viewLabel,
          enabledComponentIds: Object.keys(selections),
          sameColorEnabled: config.sameColor,
        },
      });
    }

    setRenderQueue([...renderQueue, newRender]);
    setStatus('queue');
  };

  const handleGenerateAll = async () => {
    try {
      const userId = user?._id || user?.id;
      if (userId) {
        logEvent('start', {
          user_id: userId,
          module_type: 'rev_render',
          created_by: userId,
          meta: {
            screen: 'Generating renders from queue',
            totalRenders: renderQueue.length,
          },
        });
      }

      const leadId = lead?._id || lead?.leadId || '';

      const payloads = renderQueue.map(item => {
        const rawUrl = item.photo?.s3url || item.photo?.uri || '';
        return {
          houseImageUrl: extractS3Key(rawUrl),
          houseMimeType: 'image/jpeg',
          selections: item.selections,
          textureImageUrls: item.textureImageUrls,
          sourceFileName: getFilename(rawUrl),
          viewLabel: item.viewLabel || item.photo?.label || '',
          leadId,
        };
      });

      // Wrap in the envelope format the API expects
      const requestBody = { payloads, leadId, jobId: leadId };

      if (onGenerateAll) {
        onGenerateAll(requestBody);
      } else {
        payloads.forEach(p => onGenerate(p));
      }
      navigation.goBack();
    } catch (err) {
      console.error('Generate All Error:', err);
    }
  };

  const removeFromQueue = (id: number) => {
    const userId = user?._id || user?.id;
    if (userId) {
      const deletedItem = renderQueue.find(item => item.id === id);
      logEvent('delete', {
        user_id: userId,
        module_type: 'rev_render',
        created_by: userId,
        meta: {
          leadId: lead?._id || lead?.id || lead?.leadId || null,
          jobId: lead?._id || lead?.id || lead?.leadId || null,
          screen: 'queue',
          itemId: id,
          viewId: deletedItem?.viewId || null,
          viewLabel: deletedItem?.viewLabel || deletedItem?.photo?.label || null,
          componentsCount: deletedItem?.summary?.length ?? 0,
          remainingRenders: renderQueue.length - 1,
        },
      });
    }
    setRenderQueue(prev => prev.filter(item => item.id !== id));
  };

  const handleBack = useCallback(() => {
    if (status === 'config') {
      setStatus('grid');
      setSelectedPhoto(null);
    } else if (status === 'queue') {
      setStatus('grid');
    } else {
      navigation.goBack();
    }
    return true;
  }, [status, navigation]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => backHandler.remove();
  }, [handleBack]);
  // ── Renders ────────────────────────────────────────────────────────────────

  const renderEmptyState = () => (
    <View className="flex-1 items-center justify-center px-6">
      <View
        className="w-24 h-24 rounded-full items-center justify-center mb-6"
        style={{ backgroundColor: isDark ? '#1E1E1E' : '#F4F6F8' }}
      >
        <Icon name="image-multiple-outline" size={48} color="#919EAB" />
      </View>
      <Text className="text-base font-bold text-center mb-2" style={{ color: colors.text }}>
        No Images to Render
      </Text>
      <Text className="text-center mb-8" style={{ color: colors.textSecondary }}>
        Please capture the images first from the Job Docs tab. Once photos are added to your job,
        they will appear here for revRender.
      </Text>
      <TouchableOpacity
        onPress={() => {
          navigation.goBack();
          onNavToDocs();
        }}
        className="px-8 py-3 rounded-xl w-full items-center flex-row justify-center"
        style={{ backgroundColor: colors.primary.main }}
      >
        <Icon name="folder-multiple-image" size={18} color="white" style={{ marginRight: 8 }} />
        <Text className="text-white font-bold text-base">Go to Job Docs</Text>
      </TouchableOpacity>
    </View>
  );

  // Dynamic (schema-driven) picker: product dropdown + schema tabs + per-tab grid.
  const renderSchemaPicker = () => {
    const activeIdx = Math.min(dynTab, Math.max(dynTopTabs.length - 1, 0));
    const openPhoto = (photo: any) => {
      const userId = user?._id || user?.id;
      if (userId) {
        logEvent('select', {
          user_id: userId,
          module_type: 'rev_render',
          created_by: userId,
          meta: {
            leadId: lead?._id || lead?.id || lead?.leadId || null,
            jobId: lead?._id || lead?.id || lead?.leadId || null,
            viewId: photo.viewId,
            viewLabel: photo.viewLabel,
            hasImage: !!photo.uri,
            screen: 'before',
          },
        });
      }
      setConfig(INITIAL_CONFIG);
      setSelectedPhoto(photo);
      setStatus('config');
    };

    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-4 py-4">
          <View className="flex-row items-center mb-6">
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="mr-4 w-10 h-10 rounded-full bg-white items-center justify-center shadow-sm border border-gray-100"
            >
              <Icon name="arrow-left" size={24} color="#637381" />
            </TouchableOpacity>
            <View>
              <Text className="text-xl font-bold" style={{ color: colors.text }}>revRender</Text>
              <Text className="text-sm font-bold" style={{ color: '#919EAB' }}>
                Select a photo to render (from Job Docs)
              </Text>
            </View>
          </View>

          <View
            className="rounded-3xl border shadow-sm mb-10 overflow-hidden"
            style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff', borderColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
          >
            {/* Product selector — a dropdown when multiple products, else just the name */}
            <View style={{ paddingVertical: 16, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: isDark ? '#2A2A2A' : '#F4F6F8' }}>
              {configuredProducts.length > 1 ? (
                <View ref={prodBtnRef} collapsable={false}>
                  <TouchableOpacity
                    onPress={openProdMenu}
                    activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(76,187,23,0.5)' }}
                  >
                    <IconifyIcon name={selectedProduct?.icon} size={18} />
                    <Text style={{ color: GREEN, fontWeight: '800', fontSize: 15 }}>{selectedProduct?.name || 'Select product'}</Text>
                    <MIcon name="arrow-drop-down" size={22} color={GREEN} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <IconifyIcon name={selectedProduct?.icon} size={18} />
                  <Text style={{ color: GREEN, fontWeight: '800', fontSize: 15 }}>{selectedProduct?.name}</Text>
                </View>
              )}
            </View>

            {/* Schema tab strip with filled/total counts */}
            {dynTopTabs.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ borderBottomWidth: 1, borderBottomColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
                contentContainerStyle={{ paddingHorizontal: 8 }}
              >
                {dynTopTabs.map((tab, i) => {
                  const active = i === activeIdx;
                  const c = dynTabCounts[i] || { filled: 0, total: 0 };
                  return (
                    <TouchableOpacity
                      key={(tab.id as string) || i}
                      onPress={() => setDynTab(i)}
                      style={{ paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: active ? GREEN : 'transparent' }}
                    >
                      {tab.icon ? <IconifyIcon name={tab.icon as string} size={18} color={active ? GREEN : '#919EAB'} /> : null}
                      <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: active ? GREEN : '#919EAB', marginTop: 2 }}>
                        {tab.label as string}
                      </Text>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: active ? GREEN : '#C4CDD5' }}>{c.filled}/{c.total}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* Grid of matching photos, or the empty state */}
            {schemaPickerCards.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16 }}>
                <Icon name="image-off-outline" size={40} color="#C4CDD5" />
                <Text style={{ color: '#919EAB', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                  {dynActiveCategory?.label
                    ? `No photos tagged under ${dynActiveCategory.label} for ${selectedProduct?.name || 'this product'}.`
                    : 'No photos for this product yet.'}
                </Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap justify-between" style={{ padding: 16 }}>
                {schemaPickerCards.map((photo: any, index: number) => (
                  <PhotoPeekPressable
                    key={photo.viewId || index}
                    uri={photo.uri}
                    label={photo.label}
                    onPress={() => openPhoto(photo)}
                    style={{ width: '48%', borderRadius: 16, overflow: 'hidden', marginBottom: 24, borderWidth: 1, backgroundColor: isDark ? '#2A2A2A' : '#fff', borderColor: isDark ? '#3A3A3A' : '#F4F6F8' }}
                  >
                    <View className="px-3 py-2.5 border-b" style={{ borderBottomColor: isDark ? '#3A3A3A' : '#F4F6F8' }}>
                      <Text className="text-xs font-bold" style={{ color: colors.text }} numberOfLines={1}>{photo.label}</Text>
                    </View>
                    <HouseImage uri={photo.uri} height={130} />
                  </PhotoPeekPressable>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Product dropdown menu */}
        <Modal visible={prodMenuOpen} transparent animationType="fade" onRequestClose={() => setProdMenuOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => setProdMenuOpen(false)} style={{ flex: 1 }}>
            {/* Anchored menu — sits directly below the trigger button (measured). */}
            <View
              style={{
                position: 'absolute',
                top: prodMenuAnchor?.y ?? 120,
                left: prodMenuAnchor?.x ?? 24,
                width: prodMenuAnchor?.width ?? 260,
                backgroundColor: isDark ? '#1E1E1E' : '#fff',
                borderRadius: 12,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: isDark ? '#2A2A2A' : '#E2E8F0',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.18,
                shadowRadius: 14,
                elevation: 10,
              }}
            >
              {configuredProducts.map((p, idx) => {
                const active = p.id === selectedProduct?.id;
                return (
                  <TouchableOpacity
                    key={p.id as string}
                    onPress={() => { setSelectedProductId(p.id as string); setProdMenuOpen(false); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: isDark ? '#2A2A2A' : '#F4F6F8', backgroundColor: active ? 'rgba(76,187,23,0.08)' : 'transparent' }}
                  >
                    <IconifyIcon name={p.icon} size={18} />
                    <Text style={{ color: active ? GREEN : colors.text, fontWeight: active ? '800' : '600', fontSize: 15 }} numberOfLines={1}>{p.name}</Text>
                    {active && <MIcon name="check" size={18} color={GREEN} style={{ marginLeft: 'auto' }} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </Modal>
      </ScrollView>
    );
  };

  const renderGrid = () => {
    if (useSchemaPicker) return renderSchemaPicker();
    const isMatchingView = (p: any, viewId: string, categoryId: string) => {
      if (p.subcategory === viewId) return true;
      const category = IMAGE_CATEGORIES.find(
        (c) => c.id === categoryId || c.name.toLowerCase() === categoryId?.toLowerCase()
      );
      if (!category) return false;
      let subCatObj = category.subCategories?.find(s => s.id === viewId || s.name === viewId);
      if (!subCatObj && category.cardGroups) {
        for (const group of category.cardGroups) {
          subCatObj = group.subCategories?.find(s => s.id === viewId || s.name === viewId);
          if (subCatObj) break;
        }
      }
      if (subCatObj) {
        return p.subcategory === subCatObj.id || p.subcategory === subCatObj.name;
      }
      return false;
    };

    // Collect all standard views across all groups to prevent extra/discovered view cross-pollution
    const allStandardSubcategories = new Set<string>();
    REV_RENDER_VIEW_GROUPS.forEach((group) => {
      group.views.forEach((view) => {
        allStandardSubcategories.add(view.id);
        const category = IMAGE_CATEGORIES.find(
          (c) => c.id === group.categoryId || c.name.toLowerCase() === group.categoryId?.toLowerCase()
        );
        if (category) {
          let subCatObj = category.subCategories?.find(s => s.id === view.id);
          if (!subCatObj && category.cardGroups) {
            for (const g of category.cardGroups) {
              subCatObj = g.subCategories?.find(s => s.id === view.id);
              if (subCatObj) break;
            }
          }
          if (subCatObj) {
            allStandardSubcategories.add(subCatObj.name);
            allStandardSubcategories.add(subCatObj.id);
          }
        }
      });
    });

    // 1. Process each group individually first
    let renderGroups = REV_RENDER_VIEW_GROUPS.map((group) => {
      const discoveredViews: any[] = [];
      
      // Map category ID to the key stored in sectionImages dynamically
      const matchingCategory = IMAGE_CATEGORIES.find(
        (c) => c.id === group.categoryId || c.name.toLowerCase() === group.categoryId?.toLowerCase()
      );
      let targetCategory = matchingCategory ? matchingCategory.name : group.categoryId;

      // Fallback for legacy static group categoryIds
      if (group.categoryId === 'Front View' || group.categoryId === 'Side Views' || group.categoryId === 'Back View') {
        targetCategory = 'Home';
      } else if (group.categoryId === 'Gutter System') {
        targetCategory = 'Inspection';
      }
      
      const photosInCategory = (sectionImages[targetCategory] || []).filter(
        (p: any) => !p.subcategory?.toLowerCase().includes('(annotated)')
      );

      // Add standard views
      group.views.forEach((view) => {
        const matchingPhotos = photosInCategory.filter((p: any) => isMatchingView(p, view.id, group.categoryId));
        matchingPhotos.forEach((photo: any) => {
          discoveredViews.push({
            ...photo,
            viewId: `${group.categoryId}-${view.id}`,
            viewLabel: view.label,
            label: view.label,
          });
        });
      });

      return { ...group, discoveredViews, targetCategory };
    });

    // 2. Distribute extras/uncategorized photos without duplicates
    const accountedPhotoUris = new Set<string>();
    renderGroups.forEach((group) => {
      group.discoveredViews.forEach((v) => accountedPhotoUris.add(v.uri));
    });

    renderGroups.forEach((group) => {
      const photosInCategory = (sectionImages[group.targetCategory] || []).filter(
        (p: any) => !p.subcategory?.toLowerCase().includes('(annotated)')
      );
      
      photosInCategory.forEach((p: any) => {
        if (!allStandardSubcategories.has(p.subcategory) && !accountedPhotoUris.has(p.uri)) {
          const subLower = p.subcategory?.toLowerCase() || '';
          
          // If the category is 'Home', distribute extras based on keywords
          if (group.targetCategory === 'Home') {
            const isSide = subLower.includes('side') || subLower.includes('left') || subLower.includes('right');
            const isBack = subLower.includes('back');
            
            if (group.categoryId === 'Side Views' && !isSide) return;
            if (group.categoryId === 'Back View' && !isBack) return;
            if (group.categoryId === 'Front View' && (isSide || isBack)) return;
          }
          
          group.discoveredViews.push({
            ...p,
            viewId: `${group.categoryId}-${p.subcategory || p.id || p._id}`,
            viewLabel: p.subcategory?.replace(/-/g, ' ') || group.categoryId,
            label: p.subcategory?.replace(/-/g, ' ') || group.categoryId,
          });
          accountedPhotoUris.add(p.uri);
        }
      });
    });

    // 3. Merge roofline-observation and roof-inspection into a single 'ROOFLINE' group
    const roofGroupIds = ['roof-inspection', 'roofline-observation'];
    const roofGroups = renderGroups.filter((g) => roofGroupIds.includes(g.categoryId));
    if (roofGroups.length > 0) {
      const mergedViews: any[] = [];
      const seenMergedUris = new Set<string>();
      roofGroups.forEach((g) => {
        g.discoveredViews.forEach((v) => {
          if (!seenMergedUris.has(v.uri)) {
            mergedViews.push(v);
            seenMergedUris.add(v.uri);
          }
        });
      });

      renderGroups = renderGroups.filter((g) => !roofGroupIds.includes(g.categoryId));
      if (mergedViews.length > 0) {
        renderGroups.push({
          sectionLabel: 'ROOFLINE',
          categoryId: 'roofline',
          views: [],
          discoveredViews: mergedViews,
        } as any);
      }
    }

    // Photos not matched into any static view group — notably the DYNAMIC inspection
    // photos, whose category is product-scoped ("{product} — {label}") and so never
    // lands in a static IMAGE_CATEGORIES bucket. Web parity (before.js step 2):
    // surface every unaccounted photo UNDER ITS OWN CATEGORY SECTION (not one flat
    // "Additional Photos" dump), labeled by its slot (subcategory), so the RevRender
    // picker groups them the same way the capture/manage views do. Runs AFTER the
    // roofline merge so nothing already shown repeats.
    const accountedUris = new Set<string>();
    renderGroups.forEach((g) =>
      g.discoveredViews.forEach((v: any) => v?.uri && accountedUris.add(v.uri))
    );
    const seenExtra = new Set<string>();
    Object.entries(sectionImages || {}).forEach(([catKey, imgs]) => {
      const views: any[] = [];
      (Array.isArray(imgs) ? imgs : []).forEach((p: any) => {
        if (!p) return;
        if (p.subcategory?.toLowerCase().includes('(annotated)')) return;
        const uri = p.uri || p.s3url;
        if (!uri || accountedUris.has(uri) || seenExtra.has(uri)) return;
        seenExtra.add(uri);
        const label = p.subcategory?.replace(/-/g, ' ') || catKey;
        views.push({
          ...p,
          viewId: `dyn-${catKey}-${p.subcategory || p.id || p._id || uri}`,
          viewLabel: label,
          label,
        });
      });
      if (views.length > 0) {
        // The category key is the scoped category ("{product} — {label}") for dynamic
        // inspection photos — a descriptive, per-product section header.
        renderGroups.push({
          sectionLabel: catKey,
          categoryId: `dyn-${catKey}`,
          views: [],
          discoveredViews: views,
        } as any);
      }
    });

    const discoveredGroups = renderGroups.filter((g) => g.discoveredViews.length > 0);

    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-4 py-4">
          <View className="flex-row items-center mb-8">
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="mr-4 w-10 h-10 rounded-full bg-white items-center justify-center shadow-sm border border-gray-100"
            >
              <Icon name="arrow-left" size={24} color="#637381" />
            </TouchableOpacity>
            <View>
              <Text className="text-xl font-bold" style={{ color: colors.text }}>revRender</Text>
              <Text className="text-sm font-bold" style={{ color: '#919EAB' }}>
                Select a photo to render
              </Text>
            </View>
          </View>
          <View
            className="rounded-3xl border shadow-sm mb-10 overflow-hidden"
            style={{
              backgroundColor: isDark ? '#1E1E1E' : '#fff',
              borderColor: isDark ? '#2A2A2A' : '#F4F6F8',
              paddingVertical: 24,
              paddingHorizontal: 16,
            }}
          >
            {discoveredGroups.map((group, gIdx) => (
              <View key={group.sectionLabel} className={gIdx > 0 ? 'mt-8' : ''}>
                <Text className="text-[11px] font-black tracking-widest mb-4 uppercase" style={{ color: '#637381' }}>
                  {group.sectionLabel}
                </Text>

                <View className="flex-row flex-wrap justify-between">
                  {group.discoveredViews.map((photo: any, index: number) => (
                    <PhotoPeekPressable
                      key={index}
                      uri={photo?.uri || photo?.s3url}
                      label={photo.label}
                      onPress={() => {
                        const userId = user?._id || user?.id;
                        if (userId) {
                          logEvent('select', {
                            user_id: userId,
                            module_type: 'rev_render',
                            created_by: userId,
                            meta: {
                              leadId: lead?._id || lead?.id || lead?.leadId || null,
                              jobId: lead?._id || lead?.id || lead?.leadId || null,
                              viewId: photo.viewId,
                              viewLabel: photo.viewLabel,
                              hasImage: !!(photo.uri || photo.s3url),
                              screen: 'before',
                            },
                          });
                        }
                        setConfig(INITIAL_CONFIG);
                        setSelectedPhoto(photo);
                        setStatus('config');
                      }}
                      style={{
                        width: '48%',
                        borderRadius: 16,
                        overflow: 'hidden',
                        marginBottom: 24,
                        borderWidth: 1,
                        backgroundColor: isDark ? '#2A2A2A' : '#fff',
                        borderColor: isDark ? '#3A3A3A' : '#F4F6F8',
                      }}
                    >
                      <View className="px-3 py-2.5 border-b" style={{ borderBottomColor: isDark ? '#3A3A3A' : '#F4F6F8' }}>
                        <Text className="text-xs font-bold" style={{ color: colors.text }} numberOfLines={1}>
                          {photo.label}
                        </Text>
                      </View>
                      <HouseImage uri={photo?.uri || photo?.s3url} height={130} />
                    </PhotoPeekPressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderConfig = () => {
    const isAnyChecked = MATERIAL_SECTIONS.some(s => config[`${s.key}Checked`]);

    const handleCommonColorSelect = (color: any) => {
      const oldVal = config.selectedCommonColor;
      const userId = user?._id || user?.id;
      if (userId) {
        logEvent('change', {
          user_id: userId,
          module_type: 'rev_render',
          created_by: userId,
          meta: {
            leadId: lead?._id || lead?.id || lead?.leadId || null,
            jobId: lead?._id || lead?.id || lead?.leadId || null,
            viewId: selectedPhoto?.viewId,
            screen: 'before_configure',
            fieldName: 'same_color_texture',
            oldValue: oldVal?.name || null,
            oldValueHex: oldVal?.hex || null,
            newValue: color.name,
            newValueHex: color.hex,
          },
        });
      }

      setConfig((prev: any) => {
        const next = { ...prev, selectedCommonColor: color };
        MATERIAL_SECTIONS.forEach(s => {
          const compColors = s.getColors(prev[s.key]);
          const match = compColors.find((c: any) => c.name === color.name || c.hex === color.hex);
          if (match) {
            next[`${s.key}Color`] = match;
          } else {
            next[`${s.key}Color`] = compColors[0];
          }
        });
        return next;
      });
    };

    const toggleChecked = (key: string) => {
      const newChecked = !config[`${key}Checked`];
      const newConfig = { ...config, [`${key}Checked`]: newChecked };
      if (newChecked && config.sameColor) {
        newConfig[`${key}Color`] = config.selectedCommonColor;
      }

      const userId = user?._id || user?.id;
      if (userId) {
        const section = MATERIAL_SECTIONS.find(s => s.key === key);
        const compColor = newConfig[`${key}Color`] || config[`${key}Color`];
        const appliedColorName = compColor?.name ?? null;
        const appliedColorHex = compColor?.hex ?? null;

        logEvent('change', {
          user_id: userId,
          module_type: 'rev_render',
          created_by: userId,
          meta: {
            leadId: lead?._id || lead?.id || lead?.leadId || null,
            jobId: lead?._id || lead?.id || lead?.leadId || null,
            viewId: selectedPhoto?.viewId,
            screen: 'before_configure',
            fieldName: 'component_enabled',
            componentId: key,
            componentLabel: section?.label || key,
            oldValue: config[`${key}Checked`],
            newValue: newChecked,
            ...(appliedColorName != null && {
              [newChecked ? 'appliedColor' : 'removedColor']: appliedColorName,
              [newChecked ? 'appliedColorHex' : 'removedColorHex']: appliedColorHex,
              colorSource: config.sameColor ? 'same_color_for_all' : 'component_default',
            }),
          },
        });
      }

      setConfig(newConfig);
    };

    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 py-4">
          <View className="flex-row items-center mb-8">
            <TouchableOpacity
              onPress={() => setStatus('grid')}
              className="mr-4 w-10 h-10 rounded-full bg-white items-center justify-center shadow-sm border border-gray-100"
            >
              <Icon name="arrow-left" size={24} color="#637381" />
            </TouchableOpacity>
            <View>
              <Text className="text-xl font-bold" style={{ color: colors.text }}>Configure Render</Text>
              <Text className="text-sm font-bold" style={{ color: '#919EAB' }}>
                {selectedPhoto?.label || selectedPhoto?.subcategory?.replace(/-/g, ' ') || 'Selected Photo'}
              </Text>
            </View>
          </View>
          <View
            className="rounded-[20px] border mb-6 overflow-hidden"
            style={{
              backgroundColor: isDark ? '#1E1E1E' : '#fff',
              borderColor: isDark ? '#3A3A3A' : '#F4F6F8',
            }}
          >
            <PhotoPeekPressable
              uri={selectedPhoto?.uri || selectedPhoto?.s3url}
              label={selectedPhoto?.label || selectedPhoto?.subcategory?.replace(/-/g, ' ') || 'Selected Photo'}
            >
              <HouseImage uri={selectedPhoto?.uri || selectedPhoto?.s3url} height={220} />
            </PhotoPeekPressable>
            <View className="px-4 py-3">
              <Text className="font-bold text-sm" style={{ color: isDark ? '#919EAB' : '#637381' }}>
                {selectedPhoto?.label || selectedPhoto?.subcategory?.replace(/-/g, ' ') || 'Selected Photo'}
              </Text>
            </View>
          </View>

          <View
            className="rounded-[24px] border p-5 mb-6"
            style={{
              backgroundColor: isDark ? '#1E1E1E' : '#fff',
              borderColor: '#2EDE56',
            }}
          >
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-[17px] font-black" style={{ color: isDark ? '#fff' : '#1C252E' }}>
                Same Color for All
              </Text>
              <TouchableOpacity
                onPress={() => {
                const newSameColor = !config.sameColor;
                const userId = user?._id || user?.id;
                if (userId) {
                  logEvent('change', {
                    user_id: userId,
                    module_type: 'rev_render',
                    created_by: userId,
                    meta: {
                      leadId: lead?._id || lead?.id || lead?.leadId || null,
                      jobId: lead?._id || lead?.id || lead?.leadId || null,
                      viewId: selectedPhoto?.viewId,
                      screen: 'before_configure',
                      fieldName: 'same_color_enabled',
                      componentId: 'sameColor',
                      componentLabel: 'Same Color for All',
                      oldValue: config.sameColor,
                      newValue: newSameColor,
                    },
                  });
                }
                setConfig({ ...config, sameColor: newSameColor });
              }}
              className="w-12 h-6 rounded-full px-1 justify-center"
              style={{ backgroundColor: config.sameColor ? '#2EDE56' : '#919EAB' }}
            >
              <View
                className="w-4 h-4 rounded-full bg-white"
                style={{ alignSelf: config.sameColor ? 'flex-end' : 'flex-start' }}
              />
            </TouchableOpacity>
          </View>
          <Text className="text-xs mb-4" style={{ color: isDark ? '#919EAB' : '#637381' }}>
            Apply one color to all checked components
          </Text>

          {config.sameColor && (
            <>
              <Text className="text-[15px] font-black mb-3" style={{ color: '#2EDE56' }}>
                {config.selectedCommonColor?.name || 'White'}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {REV_RENDER_COLORS.common.map((color, i) => {
                  const isSelected = config.selectedCommonColor?.hex === color.hex;
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => handleCommonColorSelect(color)}
                      className="w-10 h-10 rounded-lg border-2"
                      style={{
                        backgroundColor: color.hex,
                        borderColor: isSelected ? '#2EDE56' : (isDark ? '#3A3A3A' : '#E0E0E0'),
                      }}
                    />
                  );
                })}
              </View>
            </>
          )}
        </View>

        <Text className="text-[11px] font-black tracking-widest mb-4 uppercase" style={{ color: '#637381' }}>
          SELECT COMPONENTS TO INCLUDE
        </Text>

        {MATERIAL_SECTIONS.map((section) => {
          const isChecked = config[`${section.key}Checked`];
          const isOpen = expandedSection === section.key;
          const selectedType = config[section.key];
          const selectedColor = config[`${section.key}Color`];

          return (
            <View
              key={section.key}
              className="mb-4 rounded-[20px] border overflow-hidden"
              style={{
                backgroundColor: isDark ? '#1E1E1E' : '#fff',
                borderColor: isChecked ? '#2EDE56' : (isDark ? '#3A3A3A' : '#F4F6F8'),
              }}
            >
              <TouchableOpacity
                onPress={() => setExpandedSection(isOpen ? null : section.key)}
                className="p-5 flex-row justify-between items-center"
              >
                <View className="flex-row items-center flex-1">
                  <TouchableOpacity
                    onPress={() => toggleChecked(section.key)}
                    className="w-5 h-5 rounded-md items-center justify-center mr-4"
                    style={{
                      backgroundColor: isChecked ? '#2EDE56' : 'transparent',
                      borderWidth: isChecked ? 0 : 1.5,
                      borderColor: isDark ? '#555' : '#D0D5DD'
                    }}
                  >
                    {isChecked && <Icon name="check" size={14} color="white" />}
                  </TouchableOpacity>
                  <Text className="text-[16px] font-black" style={{ color: isDark ? '#fff' : '#1C252E' }}>
                    {section.label}
                  </Text>
                  {isChecked && selectedColor && (
                    <View className="flex-row items-center ml-auto mr-4">
                      <View className="w-6 h-6 rounded-lg mr-2 border border-gray-200" style={{ backgroundColor: selectedColor.hex }} />
                      <Text className="text-xs" style={{ color: '#919EAB' }}>{selectedColor.name}</Text>
                    </View>
                  )}
                </View>
                <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#919EAB" />
              </TouchableOpacity>

              {isOpen && (
                <View className="px-5 pb-5">
                  {section.types.length > 0 && (
                    <>
                      <Text className="text-[11px] font-black tracking-widest mb-3 uppercase" style={{ color: '#637381' }}>TYPE</Text>
                      <View className="flex-row flex-wrap gap-2">
                        {section.types.map((type) => {
                          const active = selectedType === type;
                          return (
                            <TouchableOpacity
                              key={type}
                              onPress={() => {
                                const oldType = config[section.key];
                                const userId = user?._id || user?.id;
                                if (userId) {
                                  logEvent('change', {
                                    user_id: userId,
                                    module_type: 'rev_render',
                                    created_by: userId,
                                    meta: {
                                      leadId: lead?._id || lead?.id || lead?.leadId || null,
                                      jobId: lead?._id || lead?.id || lead?.leadId || null,
                                      viewId: selectedPhoto?.viewId,
                                      screen: 'before_configure',
                                      fieldName: 'component_type',
                                      componentId: section.key,
                                      componentLabel: section.label,
                                      oldValue: oldType,
                                      newValue: type,
                                    },
                                  });
                                }
                                setConfig({ ...config, [section.key]: type });
                              }}
                              className="px-5 py-2.5 rounded-full border"
                              style={{
                                backgroundColor: active ? '#2EDE56' : 'transparent',
                                borderColor: active ? '#2EDE56' : (isDark ? '#3A3A3A' : '#E0E0E0'),
                              }}
                            >
                              <Text className="text-[13px] font-black" style={{ color: active ? '#fff' : (isDark ? '#919EAB' : '#1C252E') }}>{type}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}
                  {!config.sameColor && (
                    <View className="mt-5">
                      <Text className="text-[11px] font-black tracking-widest mb-3 uppercase" style={{ color: '#637381' }}>COLOR</Text>
                      <View className="flex-row flex-wrap gap-2">
                        {section.getColors(selectedType).map((color: any, i: number) => {
                          const isSelected = selectedColor?.hex === color.hex;
                          return (
                            <TouchableOpacity
                              key={i}
                              onPress={() => {
                                const oldColor = config[`${section.key}Color`];
                                const userId = user?._id || user?.id;
                                if (userId) {
                                  logEvent('change', {
                                    user_id: userId,
                                    module_type: 'rev_render',
                                    created_by: userId,
                                    meta: {
                                      leadId: lead?._id || lead?.id || lead?.leadId || null,
                                      jobId: lead?._id || lead?.id || lead?.leadId || null,
                                      viewId: selectedPhoto?.viewId,
                                      screen: 'before_configure',
                                      fieldName: 'component_texture',
                                      componentId: section.key,
                                      componentLabel: section.label,
                                      oldValue: oldColor?.name || null,
                                      oldValueHex: oldColor?.hex || null,
                                      newValue: color.name,
                                      newValueHex: color.hex,
                                      appliedColor: color.name,
                                      appliedColorHex: color.hex,
                                      previousColor: oldColor?.name || null,
                                      previousColorHex: oldColor?.hex || null,
                                    },
                                  });
                                }
                                setConfig({ ...config, [`${section.key}Color`]: color });
                              }}
                              className="w-10 h-10 rounded-lg border-2"
                              style={{ backgroundColor: color.hex, borderColor: isSelected ? '#2EDE56' : (isDark ? '#3A3A3A' : '#E0E0E0') }}
                            />
                          );
                        })}
                      </View>
                    </View>
                  )}
                  </View>
                )}
              </View>
            );
          })}

          <TouchableOpacity
            onPress={handleAddToQueue}
            disabled={!isAnyChecked}
            className="w-full h-14 items-center justify-center rounded-[24px] mt-6 flex-row"
            style={{ backgroundColor: isAnyChecked ? '#2EDE56' : '#E0E0E0' }}
          >
            <Text className="text-white font-black text-base">+ Add Render Combo</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  const renderQueueView = () => {
    return (
      <View className="flex-1" style={{ backgroundColor: isDark ? '#121212' : '#FFFFFF' }}>
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="px-4 py-6">
            <View className="flex-row items-center mb-8">
              <TouchableOpacity
                onPress={() => setStatus('grid')}
                className="mr-4 w-10 h-10 rounded-full bg-white items-center justify-center shadow-sm border border-gray-100"
              >
                <Icon name="arrow-left" size={24} color="#637381" />
              </TouchableOpacity>
              <View>
                <Text className="text-xl font-bold" style={{ color: colors.text }}>Render Queue</Text>
                <Text className="text-sm font-bold" style={{ color: '#919EAB' }}>
                  {renderQueue.length} {renderQueue.length === 1 ? 'render' : 'renders'} configured
                </Text>
              </View>
            </View>

            <View className="gap-y-6">
              {renderQueue.map((item, index) => (
                <View
                  key={item.id}
                  className="rounded-[24px] border p-5 shadow-sm"
                  style={{
                    backgroundColor: isDark ? '#1E1E1E' : '#fff',
                    borderColor: isDark ? '#2A2A2A' : '#F4F6F8'
                  }}
                >
                  <View className="flex-row justify-between items-center mb-5">
                    <View className="flex-row items-center">
                      <View className="w-8 h-8 rounded-full bg-[#2EDE56] items-center justify-center mr-3">
                        <Text className="text-white font-black text-sm">{index + 1}</Text>
                      </View>
                      <Text className="text-[17px] font-black" style={{ color: colors.text }}>
                        {item.photo?.label || 'Selected Photo'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => removeFromQueue(item.id)}>
                      <Icon name="delete-outline" size={22} color="#FF5630" />
                    </TouchableOpacity>
                  </View>

                  <View className="gap-y-3">
                    {item.summary.map((s: any, idx: number) => (
                      <View
                        key={idx}
                        className="p-3.5 rounded-xl flex-row items-center"
                        style={{ backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
                      >
                        <View
                          className="w-5 h-5 rounded-[4px] mr-3 border border-gray-200"
                          style={{ backgroundColor: s.colorHex }}
                        />
                        <Text className="text-[13px] font-bold flex-1" style={{ color: colors.text }}>
                          {s.label}: {s.colorName} {s.type ? `· ${s.type}` : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>

            <View className="mt-10">
              <Text className="text-[11px] font-black tracking-widest mb-4 uppercase ml-2" style={{ color: '#637381' }}>
                CUSTOM
              </Text>
              <TouchableOpacity
                onPress={() => setStatus('grid')}
                className="w-full h-16 rounded-[20px] border-2 border-dashed border-[#2EDE56] items-center justify-center flex-row"
                style={{ backgroundColor: 'transparent' }}
              >
                <Icon name="plus" size={20} color="#2EDE56" style={{ marginRight: 8 }} />
                <Text className="text-[#2EDE56] font-black text-sm">Add Custom Render</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        <View
          className="px-6 pt-6 pb-10 border-t"
          style={{
            backgroundColor: isDark ? '#1A1A1A' : '#fff',
            borderTopColor: isDark ? '#2A2A2A' : '#F4F6F8',
          }}
        >
          <TouchableOpacity
            onPress={handleGenerateAll}
            disabled={renderQueue.length === 0}
            className="w-full h-14 bg-[#2EDE56] rounded-[24px] items-center justify-center flex-row shadow-lg shadow-[#2EDE5633]"
            style={{ opacity: renderQueue.length === 0 ? 0.6 : 1 }}
          >
            <Icon name="send" size={20} color="white" style={{ marginRight: 10 }} />
            <Text className="text-white font-black text-base">
              Generate {renderQueue.length} {renderQueue.length === 1 ? 'Render' : 'Renders'}
            </Text>
          </TouchableOpacity>
          <Text className="text-center mt-6 text-[13px] font-medium" style={{ color: '#919EAB' }}>
            AI-powered visualization · Results in ~30 seconds per render
          </Text>
        </View>
      </View>
    );
  };

  const hasPhotos = Object.values(sectionImages || {})
    .flat()
    .filter((p: any) => !p.subcategory?.toLowerCase().includes('(annotated)')).length > 0;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: isDark ? colors.background : '#fff' }}>


      <View className="flex-1" style={{ zIndex: 1 }}>
        {!hasPhotos
          ? renderEmptyState()
          : status === 'grid'
            ? renderGrid()
            : status === 'config'
              ? renderConfig()
              : renderQueueView()}
      </View>
    </SafeAreaView>
  );
}
