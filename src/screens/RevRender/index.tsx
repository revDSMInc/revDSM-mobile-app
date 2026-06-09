import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { REV_RENDER_VIEW_GROUPS, REV_RENDER_COLORS } from '../../constants/lead-center';
import { RootStackParamList } from '../../navigation';

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
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { lead, sectionImages, onNavToDocs, onGenerate, onGenerateAll } = route.params;

  // ── Status & State ─────────────────────────────────────────────────────────
  const [status, setStatus] = useState<'grid' | 'config' | 'queue'>('grid');
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);
  const [renderQueue, setRenderQueue] = useState<any[]>([]);

  const [config, setConfig] = useState<any>(INITIAL_CONFIG);

  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddToQueue = () => {
    const selections: any = {};
    const textureImageUrls: any = {};

    MATERIAL_SECTIONS.forEach(s => {
      if (config[`${s.key}Checked`]) {
        const type = config[s.key];
        const color = config[`${s.key}Color`];
        selections[s.key] = type ? `${type}-${color?.name}` : color?.name;
        selections[`${s.key}Type`] = type;
        textureImageUrls[s.key] = color?.hex || null;
      }
    });

    const newRender = {
      id: Date.now(),
      photo: selectedPhoto,
      selections,
      textureImageUrls,
      summary: MATERIAL_SECTIONS.filter(s => config[`${s.key}Checked`]).map(s => ({
        label: s.label,
        type: config[s.key],
        colorName: config[`${s.key}Color`]?.name,
        colorHex: config[`${s.key}Color`]?.hex
      }))
    };

    setRenderQueue([...renderQueue, newRender]);
    setStatus('queue');
  };

  const handleGenerateAll = async () => {
    try {
      const payloads = renderQueue.map(item => ({
        houseImageUrl: item.photo?.uri || item.photo?.s3url,
        houseMimeType: 'image/jpeg',
        leadId: lead?._id || lead?.leadId,
        selections: item.selections,
        textureImageUrls: item.textureImageUrls,
      }));

      if (onGenerateAll) {
        onGenerateAll(payloads);
      } else {
        payloads.forEach(p => onGenerate(p));
      }
      navigation.goBack();
    } catch (err) {
      console.error('Generate All Error:', err);
    }
  };

  const removeFromQueue = (id: number) => {
    setRenderQueue(prev => prev.filter(item => item.id !== id));
  };

  const handleBack = () => {
    if (status === 'config') {
      setStatus('grid');
      setSelectedPhoto(null);
    } else if (status === 'queue') {
      setStatus('grid');
    } else {
      navigation.goBack();
    }
    return true;
  };

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => backHandler.remove();
  }, [status]);
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

  const renderGrid = () => {
    // Collect all standard views across all groups to prevent extra/discovered view cross-pollution
    const allStandardSubcategories = new Set<string>();
    REV_RENDER_VIEW_GROUPS.forEach((group) => {
      group.views.forEach((view) => {
        allStandardSubcategories.add(view.id);
      });
    });

    const discoveredGroups = REV_RENDER_VIEW_GROUPS.map((group) => {
      const discoveredViews: any[] = [];
      
      // Map category ID to the key stored in sectionImages
      let targetCategory = group.categoryId;
      if (group.categoryId === 'Front View' || group.categoryId === 'Side Views' || group.categoryId === 'Back View') {
        targetCategory = 'Home';
      } else if (group.categoryId === 'Gutter System') {
        targetCategory = 'Inspection';
      }
      
      const photosInCategory = sectionImages[targetCategory] || [];

      group.views.forEach((view) => {
        const photo = photosInCategory.find((p: any) => p.subcategory === view.id);
        if (photo) {
          discoveredViews.push({
            ...photo,
            label: view.label,
          });
        }
      });

      photosInCategory.forEach((p: any) => {
        if (!allStandardSubcategories.has(p.subcategory)) {
          const subLower = p.subcategory?.toLowerCase() || '';
          
          // If the category is 'Home', distribute extras based on keywords to avoid duplicates across Home groups
          if (targetCategory === 'Home') {
            const isSide = subLower.includes('side') || subLower.includes('left') || subLower.includes('right');
            const isBack = subLower.includes('back');
            
            if (group.categoryId === 'Side Views' && !isSide) return;
            if (group.categoryId === 'Back View' && !isBack) return;
            if (group.categoryId === 'Front View' && (isSide || isBack)) return;
          }
          
          if (!discoveredViews.some(existing => existing.uri === p.uri)) {
            discoveredViews.push({
              ...p,
              label: p.subcategory?.replace(/-/g, ' ') || group.categoryId,
            });
          }
        }
      });

      return { ...group, discoveredViews };
    }).filter((g) => g.discoveredViews.length > 0);

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
                    <TouchableOpacity
                      key={index}
                      onPress={() => {
                        setConfig(INITIAL_CONFIG);
                        setSelectedPhoto(photo);
                        setStatus('config');
                      }}
                      className="w-[48%] rounded-2xl overflow-hidden mb-6 shadow-sm border"
                      style={{
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
                    </TouchableOpacity>
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
            <HouseImage uri={selectedPhoto?.uri || selectedPhoto?.s3url} height={220} />
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
                onPress={() => setConfig({ ...config, sameColor: !config.sameColor })}
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
                                onPress={() => setConfig({ ...config, [section.key]: type })}
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
                                onPress={() => setConfig({ ...config, [`${section.key}Color`]: color })}
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

  const hasPhotos = Object.values(sectionImages || {}).flat().length > 0;

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
