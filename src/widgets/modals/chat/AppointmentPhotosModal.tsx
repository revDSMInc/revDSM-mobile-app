/**
 * AppointmentPhotosModal — mobile port of the web `AppointmentPhotosMenu.js`.
 *
 * A bottom-sheet categorized picker for the lead's already-captured
 * appointment / inspection / gallery photos (`lead.salesPhotos`). The user browses
 * by category tab, multi-selects, and taps send. Selected photos are handed back to
 * the caller as S3 descriptors (NO re-upload) — the caller sends them via
 * `ChatService.sendAppointmentPhotos`, matching web's `handleSendAppointmentPhotos`.
 *
 * Photo source is fetched lazily on open: `LeadService.findJobs({})` (the same
 * endpoint the map / lead list already use — list items carry `salesPhotos`), matched
 * by lead `_id`, then secure URLs resolved via `LeadService.getSecureUrls`.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { LeadService } from '../../../services/api/leads';
import { ENV } from '../../../config/env';
import { resolveS3Url } from '../../../utils/s3-utils';

export interface AppointmentPhotoSelection {
  _id?: string;
  bucketName: string;
  s3url: string;
  category: string;
  subcategory: string;
  fileName: string;
  fileType: string;
  secureUrl: string | null;
}

interface SalesPhoto {
  _id?: string;
  bucketName?: string;
  s3url?: string;
  category?: string;
  subcategory?: string;
}

interface AppointmentPhotosModalProps {
  visible: boolean;
  onClose: () => void;
  leadId?: string;
  onSend: (photos: AppointmentPhotoSelection[]) => void;
}

// Ionicons equivalents of the web category icon map.
const CATEGORY_ICONS: Record<string, string> = {
  home: 'home-outline',
  inspection: 'search-outline',
  measurements: 'resize-outline',
  'roofline-observation': 'home-outline',
  'roof-inspection': 'home-outline',
  'roof-inspection-plane': 'search-outline',
  miscellaneous: 'ellipsis-horizontal',
  gutters: 'home-outline',
  roofing: 'home-outline',
  windows: 'browsers-outline',
  flooring: 'grid-outline',
  'home-remodeling': 'hammer-outline',
};

const getCategoryIcon = (category?: string): string => {
  if (!category) return 'images-outline';
  const lower = category.toLowerCase();
  if (CATEGORY_ICONS[lower]) return CATEGORY_ICONS[lower];
  if (lower.includes('home')) return 'home-outline';
  if (lower.includes('inspect')) return 'search-outline';
  if (lower.includes('measure') || lower.includes('ruler')) return 'resize-outline';
  if (lower.includes('roof')) return 'home-outline';
  if (lower.includes('gutter')) return 'home-outline';
  if (lower.includes('misc')) return 'ellipsis-horizontal';
  return 'images-outline';
};

const getCategoryLabel = (category?: string): string => {
  if (!category) return 'OTHER';
  if (category.length <= 6) return category.toUpperCase();
  return category.substring(0, 6).toUpperCase();
};

const buildFileName = (category?: string, subcategory?: string): string => {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '-');
  if (category && subcategory) return `${clean(category)}-${clean(subcategory)}.jpg`;
  if (subcategory) return `${clean(subcategory)}.jpg`;
  if (category) return `${clean(category)}.jpg`;
  return `appointment_photo_${Date.now()}.jpg`;
};

export default function AppointmentPhotosModal({
  visible,
  onClose,
  leadId,
  onSend,
}: AppointmentPhotosModalProps) {
  const { colors } = useTheme();

  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<SalesPhoto[]>([]);
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState(0);

  const keyOf = (p: SalesPhoto) => p._id || p.s3url || '';

  // Fetch the lead's sales photos + secure URLs whenever the sheet opens.
  useEffect(() => {
    if (!visible || !leadId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setSelectedKeys([]);
      setActiveTab(0);
      try {
        const res = await LeadService.findJobs({});
        const leads: any[] = res.data?.data || [];
        const lead = leads.find(
          (l) => String(l._id) === String(leadId) || String(l.id) === String(leadId),
        );
        const salesPhotos: SalesPhoto[] = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
        if (cancelled) return;
        setPhotos(salesPhotos);

        const withPaths = salesPhotos.filter((p) => p.bucketName && p.s3url);
        if (withPaths.length) {
          try {
            const filePaths = withPaths.map((p) => ({
              bucketName: p.bucketName || ENV.S3_BUCKET,
              filePath: p.s3url as string,
            }));
            const secureRes = await LeadService.getSecureUrls(filePaths);
            const data: any[] = secureRes.data?.data || secureRes.data || [];
            if (cancelled) return;
            const map: Record<string, string> = {};
            salesPhotos.forEach((photo) => {
              const secured = data.find(
                (s: any) => s.s3url === photo.s3url || s.filePath === photo.s3url,
              );
              const uri = secured?.secureUrl || secured?.url || resolveS3Url(photo.s3url);
              if (uri) map[keyOf(photo)] = uri;
            });
            setUrlMap(map);
          } catch (err) {
            console.warn('[AppointmentPhotos] secure URL fetch failed, using fallback:', err);
            const map: Record<string, string> = {};
            salesPhotos.forEach((photo) => {
              const uri = resolveS3Url(photo.s3url);
              if (uri) map[keyOf(photo)] = uri;
            });
            if (!cancelled) setUrlMap(map);
          }
        } else {
          setUrlMap({});
        }
      } catch (err) {
        console.warn('[AppointmentPhotos] Failed to load lead photos:', err);
        if (!cancelled) setPhotos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [visible, leadId]);

  const tabs = useMemo(() => {
    const map = new Map<string, { id: string; label: string; icon: string; count: number }>();
    map.set('__all__', { id: '__all__', label: 'ALL', icon: 'images-outline', count: photos.length });
    photos.forEach((p) => {
      const cat = p.category || 'Other';
      const key = cat.toLowerCase();
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { id: key, label: getCategoryLabel(cat), icon: getCategoryIcon(cat), count: 1 });
    });
    return Array.from(map.values());
  }, [photos]);

  useEffect(() => {
    if (activeTab >= tabs.length) setActiveTab(0);
  }, [tabs.length, activeTab]);

  const photosForTab = useMemo(() => {
    const tab = tabs[activeTab];
    if (!tab) return [];
    if (tab.id === '__all__') return photos;
    return photos.filter((p) => (p.category || 'Other').toLowerCase() === tab.id);
  }, [photos, activeTab, tabs]);

  const togglePhoto = useCallback((key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const handleSend = () => {
    if (!selectedKeys.length) return;
    const selected = photos
      .filter((p) => selectedKeys.includes(keyOf(p)))
      .filter((p) => p.bucketName && p.s3url)
      .map<AppointmentPhotoSelection>((p) => ({
        _id: p._id,
        bucketName: p.bucketName as string,
        s3url: p.s3url as string,
        category: p.category || '',
        subcategory: p.subcategory || '',
        fileName: buildFileName(p.category, p.subcategory),
        fileType: 'image/jpeg',
        secureUrl: urlMap[keyOf(p)] || null,
      }));
    if (!selected.length) return;
    onSend(selected);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <TouchableOpacity
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
          activeOpacity={1}
          onPress={onClose}
        />
        <View
          className="rounded-t-3xl overflow-hidden"
          style={{ backgroundColor: colors.card, maxHeight: '80%' }}
        >
          {/* Header */}
          <View
            className="px-5 py-4 flex-row items-center justify-between border-b"
            style={{ borderColor: colors.border }}
          >
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center">
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text className="text-base font-black" style={{ color: colors.text }}>
              Appointment Photos
            </Text>
            <TouchableOpacity
              onPress={handleSend}
              disabled={!selectedKeys.length}
              className="w-9 h-9 rounded-full items-center justify-center"
              style={{ backgroundColor: selectedKeys.length ? colors.primary.main : 'transparent' }}
            >
              {selectedKeys.length ? (
                <Icon name="checkmark" size={20} color="#fff" />
              ) : (
                <View style={{ width: 20 }} />
              )}
            </TouchableOpacity>
          </View>

          {/* Category tabs */}
          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="border-b"
              style={{ borderColor: colors.border, maxHeight: 74 }}
              contentContainerStyle={{ paddingHorizontal: 8 }}
            >
              {tabs.map((tab, idx) => {
                const active = activeTab === idx;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    onPress={() => setActiveTab(idx)}
                    className="items-center px-3 py-2 mx-1"
                    style={{
                      borderBottomWidth: 2,
                      borderBottomColor: active ? colors.primary.main : 'transparent',
                      minWidth: 56,
                    }}
                  >
                    <Icon name={tab.icon} size={18} color={active ? colors.primary.main : colors.textSecondary} />
                    <Text
                      className="text-[9px] font-bold mt-0.5"
                      style={{ color: active ? colors.primary.main : colors.textSecondary }}
                    >
                      {tab.label}
                    </Text>
                    <Text className="text-[9px]" style={{ color: colors.textSecondary }}>
                      {tab.count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Grid */}
          {loading ? (
            <View className="py-16 items-center">
              <ActivityIndicator color={colors.primary.main} />
              <Text className="mt-3 text-xs" style={{ color: colors.textSecondary }}>
                Loading photos...
              </Text>
            </View>
          ) : photosForTab.length === 0 ? (
            <View className="py-16 items-center px-6">
              <Icon name="images-outline" size={48} color={colors.textSecondary} style={{ opacity: 0.5 }} />
              <Text className="mt-3 text-sm font-bold text-center" style={{ color: colors.text }}>
                No photos in this section yet.
              </Text>
              <Text className="mt-1 text-xs text-center" style={{ color: colors.textSecondary }}>
                Use the tabs above to browse other sections.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 12 }} showsVerticalScrollIndicator={false}>
              <View className="flex-row flex-wrap">
                {photosForTab.map((photo) => {
                  const key = keyOf(photo);
                  const uri = urlMap[key];
                  const selected = selectedKeys.includes(key);
                  const label = photo.subcategory || photo.category || 'Photo';
                  return (
                    <View key={key} style={{ width: '50%', padding: 4 }}>
                      <Text
                        className="text-[11px] font-bold mb-1"
                        numberOfLines={1}
                        style={{ color: colors.text }}
                      >
                        {label}
                      </Text>
                      <TouchableOpacity
                        onPress={() => togglePhoto(key)}
                        activeOpacity={0.85}
                        className="rounded-xl overflow-hidden"
                        style={{
                          borderWidth: 2,
                          borderColor: selected ? colors.primary.main : 'transparent',
                          aspectRatio: 4 / 3,
                          backgroundColor: colors.surface,
                        }}
                      >
                        {uri ? (
                          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        ) : (
                          <View className="flex-1 items-center justify-center">
                            <Icon name="image-outline" size={24} color={colors.textSecondary} style={{ opacity: 0.4 }} />
                          </View>
                        )}
                        <View
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full items-center justify-center"
                          style={{
                            backgroundColor: selected ? colors.primary.main : 'rgba(0,0,0,0.4)',
                            borderWidth: 2,
                            borderColor: selected ? colors.primary.main : 'rgba(255,255,255,0.6)',
                          }}
                        >
                          {selected && <Icon name="checkmark" size={13} color="#fff" />}
                        </View>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* Send bar */}
          {selectedKeys.length > 0 && (
            <View className="px-5 py-3 border-t" style={{ borderColor: colors.border }}>
              <TouchableOpacity
                onPress={handleSend}
                className="h-12 rounded-xl items-center justify-center flex-row"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Icon name="send" size={18} color="#fff" />
                <Text className="ml-2 text-sm font-bold" style={{ color: '#fff' }}>
                  Send {selectedKeys.length} photo{selectedKeys.length > 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
