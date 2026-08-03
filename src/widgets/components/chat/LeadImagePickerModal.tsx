import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../../theme/ThemeProvider';
import { useAuth } from '../../../hooks/useAuth';
import { useSecureUrls } from '../../../hooks/useSecureUrls';
import { LeadService } from '../../../services/api/leads';
import { ENV } from '../../../config/env';
import { IMAGE_CATEGORIES } from '../../../constants/lead-center';

// A selected appointment photo, handed back as an S3 reference (NOT re-uploaded).
// Mirrors the web AppointmentPhotosMenu → MessageInput.handleSendAppointmentPhotos.
export interface SelectedAppointmentPhoto {
  _id?: string;
  s3url: string;
  bucketName?: string;
  category?: string;
  subcategory?: string;
  // Human-readable caption ("Front of Home") resolved from IMAGE_CATEGORIES —
  // same label the Manage Photos grid shows.
  label?: string;
  secureUrl?: string;
}

// Resolve a photo's category/subcategory the SAME way the LeadCenter "Manage
// Photos" (Job Docs) does — so this picker shows exactly that set with matching
// labels. A photo whose category isn't a known IMAGE_CATEGORIES section is NOT
// shown in Manage Photos, so we hide it here too.
const findCategoryConfig = (cat?: string): any => {
  if (!cat) return undefined;
  const lc = cat.toLowerCase();
  return IMAGE_CATEGORIES.find(
    (c: any) => c.id.toLowerCase() === lc || c.name.toLowerCase() === lc
  );
};
const isManagePhotosCategory = (cat?: string) => !!findCategoryConfig(cat);
// Dynamic inspection photos are stored under a product-scoped category like
// "Windows — Front" (see useDynamicInspectionCapture.scopeCat). They are NOT in
// IMAGE_CATEGORIES, so the old `isManagePhotosCategory`-only filter dropped them
// from chat. Admit any category carrying the " — " product-scope marker too.
const isDynamicInspectionCategory = (cat?: string) => !!cat && cat.includes(' — ');
const isSelectablePhotoCategory = (cat?: string) =>
  isManagePhotosCategory(cat) || isDynamicInspectionCategory(cat);
const resolveCategoryName = (cat?: string) => findCategoryConfig(cat)?.name || cat || 'Other';
const stripAnnotated = (s: string) => s.replace(/\(annotated\)/gi, '').replace(/\s+/g, ' ').trim();
const resolveSubLabel = (cat?: string, sub?: string): string => {
  const category = findCategoryConfig(cat);
  if (!sub) return stripAnnotated(category?.name || cat || 'Photo');
  if (!category) return stripAnnotated(sub);
  const clean = sub.includes(' - Extra') ? sub.split(' - Extra')[0] : sub;
  const top = category.subCategories?.find((s: any) => s.id === clean || s.name === clean);
  if (top) return top.name;
  const grp = category.cardGroups?.find((g: any) => g.id === clean || g.name === clean);
  if (grp) return grp.name;
  for (const g of category.cardGroups || []) {
    const gs = g.subCategories?.find((s: any) => s.id === clean || s.name === clean);
    if (gs) return gs.name;
  }
  return stripAnnotated(sub);
};

interface LeadImagePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (photos: SelectedAppointmentPhoto[]) => void;
  leadId?: string;
  // Photos handed in from an already-loaded lead (LeadCenter). When present we
  // skip the network fetch entirely — this mirrors the web AppointmentPhotosMenu,
  // which receives `selectedJob.salesPhotos` as a prop.
  initialSalesPhotos?: any[];
}

// Small icon map for the category tabs (web AppointmentPhotosMenu parity).
const getCategoryIcon = (category?: string): string => {
  if (!category) return 'image-multiple-outline';
  const lower = category.toLowerCase();
  if (lower.includes('home')) return 'home-outline';
  if (lower.includes('inspect')) return 'magnify';
  if (lower.includes('measure') || lower.includes('ruler')) return 'ruler';
  if (lower.includes('roof') || lower.includes('gutter')) return 'home-roof';
  if (lower.includes('window')) return 'window-open-variant';
  if (lower.includes('floor')) return 'floor-plan';
  if (lower.includes('misc')) return 'dots-horizontal';
  return 'image-multiple-outline';
};

const keyOf = (p: any) => p?._id || p?.s3url;

export const LeadImagePickerModal = ({
  visible,
  onClose,
  onConfirm,
  leadId,
  initialSalesPhotos,
}: LeadImagePickerModalProps) => {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const screenWidth = Dimensions.get('window').width;

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState(0);

  // Reset selection whenever the picker is (re)opened.
  useEffect(() => {
    if (visible) {
      setSelectedKeys([]);
      setActiveTab(0);
    }
  }, [visible]);

  // Fetch the lead from the Sales Portal endpoint — the SAME source LeadCenter
  // reads `salesPhotos` from (see useLeadCenterData). `workLead` is a
  // work-session PUT and does not reliably return the photo array, which is why
  // this picker previously showed no photos. Gated on `visible` so opening a
  // chat never triggers a lead fetch on its own.
  const { data: lead, isLoading: leadLoading } = useQuery({
    queryKey: ['lead-photos', leadId],
    queryFn: async () => {
      try {
        const res = await LeadService.getSalesLeads(user!._id, { leadId });
        const leadsList = res.data?.data?.leads || res.data?.leads || [];
        const found = leadsList.find(
          (l: any) => l._id === leadId || l.id === leadId
        );
        if (found?.salesPhotos?.length) return found;
      } catch (e) {
        console.warn('[LeadImagePicker] sales-portal lead fetch failed:', e);
      }
      // Fallback for envs/reps where the sales-portal list doesn't surface it.
      const workRes = await LeadService.workLead(leadId as string, user!._id);
      return workRes.data?.data || workRes.data;
    },
    enabled: visible && !!user?._id && !!leadId && !(initialSalesPhotos && initialSalesPhotos.length),
    staleTime: 60000,
  });

  // Raw photo records (carry s3url / category / subcategory / bucketName).
  // Restricted to the SAME set the LeadCenter "Manage Photos" (Job Docs) shows:
  // sales photos whose category is a known IMAGE_CATEGORIES section.
  const leadPhotos = useMemo(() => {
    const photos =
      (initialSalesPhotos && initialSalesPhotos.length ? initialSalesPhotos : lead?.salesPhotos) || [];
    return photos.filter((p: any) => p?.s3url && isSelectablePhotoCategory(p.category));
  }, [initialSalesPhotos, lead?.salesPhotos]);

  const { data: secureMap, isLoading: urlsLoading } = useSecureUrls(leadPhotos);

  // Signed URL for each photo, keyed by its s3url.
  const secureByS3 = useMemo(() => {
    const map: Record<string, string> = {};
    if (secureMap) {
      Object.values(secureMap)
        .flat()
        .forEach((it: any) => {
          if (it?.s3url) map[it.s3url] = it.uri;
        });
    }
    return map;
  }, [secureMap]);

  // Warm the native image cache for EVERY photo (not just the ones currently
  // on-screen in the FlatList) as soon as the signed URLs resolve. Combined with
  // `cache: 'force-cache'` on the thumbnails, this makes re-opening the picker —
  // and scrolling through it — instant instead of re-downloading each time. The
  // signed URLs themselves are already cached for 50 min by useSecureUrls, so
  // these bytes stay valid for the whole chat session.
  useEffect(() => {
    Object.values(secureByS3).forEach((u) => {
      if (u) Image.prefetch(u).catch(() => {});
    });
  }, [secureByS3]);

  // Category tabs: an "ALL" tab + one tab per distinct category (web parity).
  const dynamicTabs = useMemo(() => {
    const byKey = new Map<string, { id: string; label: string; icon: string; count: number }>();
    byKey.set('__all__', {
      id: '__all__',
      label: 'ALL',
      icon: 'image-multiple-outline',
      count: leadPhotos.length,
    });
    leadPhotos.forEach((p: any) => {
      const cat = p.category || 'Other';
      const key = cat.toLowerCase();
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else
        byKey.set(key, {
          id: key,
          label: resolveCategoryName(cat).toUpperCase(),
          icon: getCategoryIcon(cat),
          count: 1,
        });
    });
    return Array.from(byKey.values());
  }, [leadPhotos]);

  useEffect(() => {
    if (activeTab >= dynamicTabs.length) setActiveTab(0);
  }, [dynamicTabs.length, activeTab]);

  const photosForTab = useMemo(() => {
    const tab = dynamicTabs[activeTab];
    if (!tab) return [];
    if (tab.id === '__all__') return leadPhotos;
    return leadPhotos.filter((p: any) => (p.category || 'Other').toLowerCase() === tab.id);
  }, [leadPhotos, activeTab, dynamicTabs]);

  const togglePhoto = useCallback((key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const handleConfirm = useCallback(() => {
    const selected: SelectedAppointmentPhoto[] = leadPhotos
      .filter((p: any) => selectedKeys.includes(keyOf(p)))
      .map((p: any) => ({
        _id: p._id,
        s3url: p.s3url,
        // Same bucket resolution useSecureUrls used to DISPLAY these photos, so
        // the chat's later signed-URL fetch (on reload) hits the right bucket.
        bucketName: p.bucketName || ENV.S3_BUCKET,
        category: p.category || '',
        subcategory: p.subcategory || '',
        // Human label ("Front of Home") — shown under the photo in the chat grid.
        label: resolveSubLabel(p.category, p.subcategory),
        secureUrl: secureByS3[p.s3url] || undefined,
      }));
    if (selected.length) onConfirm(selected);
  }, [leadPhotos, selectedKeys, secureByS3, onConfirm]);

  const hasInitial = !!(initialSalesPhotos && initialSalesPhotos.length);
  const loading = (leadLoading && !hasInitial) || (leadPhotos.length > 0 && urlsLoading);

  const gap = 8;
  const cardHPad = 12;
  const itemSize = (screenWidth - cardHPad * 2 - gap) / 2;

  const renderPhoto = ({ item }: { item: any }) => {
    const key = keyOf(item);
    const uri = secureByS3[item.s3url];
    const selected = selectedKeys.includes(key);
    const label = resolveSubLabel(item.category, item.subcategory);
    return (
      <View style={{ width: itemSize, marginBottom: 12 }}>
        <Text
          numberOfLines={1}
          className="text-[11px] font-black mb-1"
          style={{ color: colors.text }}
        >
          {label}
        </Text>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => togglePhoto(key)}
          className="rounded-xl overflow-hidden"
          style={{
            width: itemSize,
            aspectRatio: 4 / 3,
            backgroundColor: isDark ? '#1B2B34' : '#e5e7eb',
            borderWidth: 2,
            borderColor: selected ? '#22C55E' : 'transparent',
          }}
        >
          {uri ? (
            <Image
              source={{ uri, cache: 'force-cache' }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
              fadeDuration={0}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <MCIcon name="image-outline" size={22} color={isDark ? '#4b5563' : '#9ca3af'} />
            </View>
          )}
          {/* Selection circle (top-right) */}
          <View
            className="absolute top-1.5 right-1.5 rounded-full items-center justify-center"
            style={{
              width: 22,
              height: 22,
              backgroundColor: selected ? '#22C55E' : 'rgba(0,0,0,0.45)',
              borderWidth: 2,
              borderColor: selected ? '#22C55E' : 'rgba(255,255,255,0.6)',
            }}
          >
            {selected && <MCIcon name="check" size={12} color="#fff" />}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={StyleSheet.absoluteFillObject} className="justify-end">
        <TouchableOpacity
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl overflow-hidden"
          style={{ backgroundColor: colors.card, maxHeight: '78%' }}
        >
          {/* Grab handle */}
          <View className="items-center pt-2.5 pb-1">
            <View className="w-10 h-1.5 rounded-full" style={{ backgroundColor: colors.border }} />
          </View>

          {/* Header */}
          <View
            className="px-4 pb-3 flex-row items-center justify-between border-b"
            style={{ borderBottomColor: colors.border }}
          >
            <View className="flex-1">
              <Text className="text-base font-black" style={{ color: colors.text }}>
                Appointment Photos
              </Text>
              <Text className="text-[11px] font-bold mt-0.5" style={{ color: colors.textSecondary }}>
                {selectedKeys.length > 0
                  ? `${selectedKeys.length} selected`
                  : `${leadPhotos.length} photo${leadPhotos.length === 1 ? '' : 's'} for this lead`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-9 h-9 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.surface }}
            >
              <Icon name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Category tabs */}
          {leadPhotos.length > 0 && (
            <View className="border-b" style={{ borderBottomColor: colors.border }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 8 }}
              >
                {dynamicTabs.map((tab, idx) => {
                  const isActive = activeTab === idx;
                  return (
                    <TouchableOpacity
                      key={tab.id}
                      onPress={() => setActiveTab(idx)}
                      className="items-center px-3 py-2"
                      style={{
                        minWidth: 56,
                        borderBottomWidth: 2,
                        borderBottomColor: isActive ? '#22C55E' : 'transparent',
                      }}
                    >
                      <MCIcon
                        name={tab.icon}
                        size={18}
                        color={isActive ? '#22C55E' : colors.textSecondary}
                      />
                      <Text
                        className="text-[9px] font-black mt-0.5 tracking-wider"
                        style={{ color: isActive ? colors.text : colors.textSecondary }}
                      >
                        {tab.label}
                      </Text>
                      <Text className="text-[9px] font-bold" style={{ color: colors.textSecondary }}>
                        {tab.count}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Grid */}
          {loading ? (
            <View className="items-center justify-center" style={{ height: 220 }}>
              <ActivityIndicator size="large" color={colors.primary.main} />
              <Text
                className="mt-4 font-bold opacity-40 tracking-widest text-[10px]"
                style={{ color: colors.text }}
              >
                Loading Photos...
              </Text>
            </View>
          ) : (
            <FlatList
              data={photosForTab}
              keyExtractor={(item, index) => `${keyOf(item)}-${index}`}
              numColumns={2}
              columnWrapperStyle={{ justifyContent: 'space-between' }}
              contentContainerStyle={{ padding: cardHPad, paddingBottom: 24 }}
              renderItem={renderPhoto}
              ListEmptyComponent={
                <View className="items-center justify-center py-16">
                  <Icon name="images-outline" size={44} color={colors.textSecondary} />
                  <Text
                    className="text-sm mt-4 opacity-50 font-bold text-center px-8"
                    style={{ color: colors.textSecondary }}
                  >
                    No appointment photos in this section yet.
                  </Text>
                </View>
              }
            />
          )}

          {/* Send bar (appears once ≥1 photo is selected) */}
          {selectedKeys.length > 0 && (
            <View
              className="px-4 py-3 border-t"
              style={{ borderTopColor: colors.border, backgroundColor: colors.card }}
            >
              <TouchableOpacity
                onPress={handleConfirm}
                activeOpacity={0.85}
                className="h-12 rounded-2xl flex-row items-center justify-center"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Icon name="send" size={18} color="#fff" />
                <Text className="text-white font-black ml-2 text-[15px]">
                  Send {selectedKeys.length} photo{selectedKeys.length === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};
