import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  ScrollView,
  PanResponder,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaFrameContext, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { REV_RENDER_VIEW_GROUPS } from '../../../constants/lead-center';
import { FlashMessage } from '../../../config/message';
import { blockedRenderItems, extractS3Key, RENDER_BLOCK_MESSAGE } from '../../../utils/revrender-image-source';

interface RevRenderModalProps {
  visible: boolean;
  onClose: () => void;
  lead: any;
  sectionImages: { [key: string]: any[] };
  onNavToDocs: () => void;
  onGenerate: (payload: any) => Promise<string | null>;
}

const COLORS_LIST = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Linen', hex: '#F0EAD6' },
  { name: 'Eggshell', hex: '#F0EAD6' },
  { name: 'Wicker', hex: '#C9AE9C' },
  { name: 'Sand', hex: '#C2B280' },
  { name: 'Clay', hex: '#A0785A' },
  { name: 'Gray', hex: '#808080' },
  { name: 'Beige', hex: '#F5F5DC' },
  { name: 'Almond', hex: '#EFDECD' },
  { name: 'Heather', hex: '#9AA7B0' },
  { name: 'Tan', hex: '#D2B48C' },
  { name: 'Champagne', hex: '#F7E7CE' },
  { name: 'Pebble', hex: '#A9A9A9' },
  { name: 'Fawn', hex: '#E5D3BF' },
  { name: 'Slate', hex: '#708090' },
  { name: 'Evergreen', hex: '#2E473B' },
  { name: 'Copper', hex: '#B87333' },
  { name: 'Bronze', hex: '#6D5D44' },
  { name: 'Royal Brown', hex: '#4B3621' },
  { name: 'Musket Brown', hex: '#3B3131' },
  { name: 'Black', hex: '#1A1A1B' },
];

const MATERIAL_SECTIONS = [
  {
    key: 'soffit',
    label: 'Soffit',
    types: ['Pinhole Soffit', 'Hidden Vent Soffit'],
  },
  {
    key: 'fascia',
    label: 'Fascia Wrap',
    types: [],
  },
  {
    key: 'gutter',
    label: 'Gutter',
    types: ['K-Style'],
  },
  {
    key: 'downspout',
    label: 'Downspout',
    types: ['3x4 Rectangular'],
  },
];

const toApiType = (type: string | null, sectionLabel: string): string | null => {
  if (!type) return null;
  let cleaned = type.trim();
  const suffix = sectionLabel.trim();
  if (cleaned.toLowerCase().endsWith(suffix.toLowerCase())) {
    cleaned = cleaned.slice(0, -(suffix.length)).trim();
  }
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || null;
};

const getFilename = (url: string | undefined): string => {
  if (!url) return '';
  const withoutQuery = url.split('?')[0];
  const parts = withoutQuery.split('/');
  return parts[parts.length - 1] || '';
};

export const RevRenderModal = ({
  visible,
  onClose,
  lead,
  sectionImages,
  onNavToDocs,
  onGenerate,
}: RevRenderModalProps) => {
  const { colors, isDark } = useTheme();

  const [status, setStatus] = useState<'grid' | 'config' | 'queue'>('grid');
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);
  const [renderQueue, setRenderQueue] = useState<any[]>([]);

  const allPhotos = React.useMemo(() => {
    return Object.values(sectionImages).flat();
  }, [sectionImages]);

  const [config, setConfig] = useState<any>({
    soffit: 'Hidden Vent Soffit',
    soffitColor: COLORS_LIST[0],
    soffitChecked: false,
    fascia: null,
    fasciaColor: COLORS_LIST[0],
    fasciaChecked: false,
    gutter: 'K-Style',
    gutterColor: COLORS_LIST[0],
    gutterChecked: false,
    downspout: '3x4 Rectangular',
    downspoutColor: COLORS_LIST[0],
    downspoutChecked: false,
  });
  const [sameColorForAll, setSameColorForAll] = useState(true);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [generatedImg, setGeneratedImg] = useState<string | null>(null);

  const screenWidth = Dimensions.get('window').width;
  const imageWidth = screenWidth - 32;
  const imageHeight = 240;
  const sliderPosition = useRef(new Animated.Value(imageWidth / 2)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event([null, { dx: sliderPosition }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, gestureState) => {
        const currentX = (sliderPosition as any)._value;
        if (currentX < 0) {
          Animated.spring(sliderPosition, { toValue: 0, useNativeDriver: false }).start();
        } else if (currentX > imageWidth) {
          Animated.spring(sliderPosition, { toValue: imageWidth, useNativeDriver: false }).start();
        } else {
          sliderPosition.setOffset(currentX);
          sliderPosition.setValue(0);
        }
      },
    })
  ).current;

  const handleAddToQueue = () => {
    const selections: any = {};
    const textureImageUrls: any = {};

    MATERIAL_SECTIONS.forEach(s => {
      const isChecked = config[`${s.key}Checked`];
      const type = config[s.key];
      const color = config[`${s.key}Color`];

      if (isChecked) {
        selections[s.key] = color?.name?.toLowerCase() || null;
        selections[`${s.key}Type`] = toApiType(type, s.label);
        textureImageUrls[s.key] = color?.hex || null;
      } else {
        selections[s.key] = null;
        selections[`${s.key}Type`] = null;
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
    /**
     * ⚠️ Same guard as the RevRender screen - see `utils/revrender-image-source`. A photo
     * still in `pending_uploads` has `s3url: ''`, and the old `|| item.photo?.uri` fallback
     * sent its LOCAL file:// path as the S3 key: the backend presigned it, 404d, and the job
     * failed as "Failed to download house image".
     */
    const unsendable = blockedRenderItems(renderQueue);
    if (unsendable.length) {
      FlashMessage.warning(
        unsendable.length === renderQueue.length
          ? 'Photo not uploaded yet'
          : `${unsendable.length} of ${renderQueue.length} renders not sent`,
        RENDER_BLOCK_MESSAGE[unsendable[0].reason]
      );
      return;
    }
    try {
      const leadId = lead?._id || lead?.leadId || '';
      const payloads = renderQueue.map(item => {
        // ⚠️ `s3url` ONLY - the `|| uri` fallback is the bug. Guarded above.
        const rawUrl = item.photo?.s3url || '';
        return {
          houseImageUrl: extractS3Key(rawUrl) || '',
          houseMimeType: 'image/jpeg',
          selections: item.selections,
          textureImageUrls: item.textureImageUrls,
          sourceFileName: getFilename(rawUrl),
          viewLabel: item.viewLabel || item.photo?.label || '',
          leadId,
        };
      });

      payloads.forEach(payload => onGenerate(payload));
      handleClose();
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
      handleClose();
    }
  };

  const handleClose = () => {
    setStatus('grid');
    setSelectedPhoto(null);
    setGeneratedImg(null);
    setRenderQueue([]);
    setConfig({
      soffit: 'Hidden Vent Soffit',
      soffitColor: COLORS_LIST[0],
      soffitChecked: false,
      fascia: null,
      fasciaColor: COLORS_LIST[0],
      fasciaChecked: false,
      gutter: 'K-Style',
      gutterColor: COLORS_LIST[0],
      gutterChecked: false,
      downspout: '3x4 Rectangular',
      downspoutColor: COLORS_LIST[0],
      downspoutChecked: false,
    });
    onClose();
  };

  const HouseImage = ({ uri, style, height = 130 }: { uri: string; style?: any; height?: number }) => {
    return (
      <View style={[{ height, backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }, style]}>
        <Image
          key={uri}
          source={{ uri, cache: 'force-cache' }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          fadeDuration={0}
        />
      </View>
    );
  };

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
          handleClose();
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
    const discoveredGroups = REV_RENDER_VIEW_GROUPS.map((group) => {
      const discoveredViews: any[] = [];
      const photosInCategory = sectionImages[group.categoryId] || [];

      group.views.forEach((view) => {
        const photo = photosInCategory.find((p) => p.subcategory === view.id);
        if (photo) {
          discoveredViews.push({
            ...photo,
            label: view.label,
          });
        }
      });

      const matchedIds = new Set(group.views.map((v) => v.id));
      photosInCategory.forEach((p) => {
        if (!matchedIds.has(p.subcategory)) {
          discoveredViews.push({
            ...p,
            label: p.subcategory?.replace(/-/g, ' ') || group.categoryId,
          });
        }
      });

      return {
        ...group,
        discoveredViews,
      };
    }).filter((g) => g.discoveredViews.length > 0);

    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-4 py-4">
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
                <Text
                  className="text-[11px] font-black tracking-widest mb-4 uppercase"
                  style={{ color: isDark ? colors.textSecondary : '#637381' }}
                >
                  {group.sectionLabel}
                </Text>

                <View className="flex-row flex-wrap justify-between">
                  {group.discoveredViews.map((photo: any, index: number) => (
                    <TouchableOpacity
                      key={index}
                      onPress={() => {
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
                        <Text
                          className="text-xs font-bold"
                          style={{ color: colors.text }}
                          numberOfLines={1}
                        >
                          {photo.label}
                        </Text>
                      </View>
                      <HouseImage
                        uri={photo?.uri || photo?.s3url}
                        height={130}
                      />
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

    const handleGlobalColorSelect = (color: any) => {
      const newConfig = { ...config };
      if (sameColorForAll) {
        MATERIAL_SECTIONS.forEach(s => {
          newConfig[`${s.key}Color`] = color;
        });
      } else {
        newConfig.soffitColor = color; // Fallback
      }
      setConfig(newConfig);
    };

    const toggleChecked = (key: string) => {
      const newChecked = !config[`${key}Checked`];
      const newConfig = { ...config, [`${key}Checked`]: newChecked };

      if (newChecked && sameColorForAll) {
        newConfig[`${key}Color`] = config.soffitColor;
      }

      setConfig(newConfig);
    };

    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 py-4">
          {/* Selected Image Card */}
          <View
            className="rounded-[20px] border mb-6 overflow-hidden"
            style={{
              backgroundColor: isDark ? '#1E1E1E' : '#fff',
              borderColor: isDark ? '#3A3A3A' : '#F4F6F8',
            }}
          >
            <HouseImage
              uri={selectedPhoto?.uri || selectedPhoto?.s3url}
              height={220}
            />
            <View className="px-4 py-3">
              <Text className="font-bold text-sm" style={{ color: isDark ? '#919EAB' : '#637381' }}>
                {selectedPhoto?.label || selectedPhoto?.subcategory?.replace(/-/g, ' ') || 'Selected Photo'}
              </Text>
            </View>
          </View>

          {/* Same Color for All Card */}
          <View
            className="rounded-[24px] border p-5 mb-6"
            style={{
              backgroundColor: isDark ? '#1E1E1E' : '#fff',
              borderColor: '#2EDE56', // Brand green border from screenshot
              shadowColor: '#2EDE56',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.1,
              shadowRadius: 10,
              elevation: 4
            }}
          >
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-[17px] font-black" style={{ color: isDark ? '#fff' : '#1C252E' }}>
                Same Color for All
              </Text>
              <TouchableOpacity
                onPress={() => setSameColorForAll(!sameColorForAll)}
                className="w-12 h-6 rounded-full px-1 justify-center"
                style={{ backgroundColor: sameColorForAll ? '#2EDE56' : '#919EAB' }}
              >
                <View
                  className="w-4 h-4 rounded-full bg-white"
                  style={{ alignSelf: sameColorForAll ? 'flex-end' : 'flex-start' }}
                />
              </TouchableOpacity>
            </View>
            <Text className="text-xs mb-4" style={{ color: isDark ? '#919EAB' : '#637381' }}>
              Apply one color to all checked components
            </Text>

            {sameColorForAll && (
              <>
                <Text className="text-[15px] font-black mb-3" style={{ color: '#2EDE56' }}>
                  {config.soffitColor?.name || 'White'}
                </Text>

                <View className="flex-row flex-wrap gap-2">
                  {COLORS_LIST.map((color) => {
                    const isSelected = config.soffitColor?.name === color.name;
                    return (
                      <TouchableOpacity
                        key={color.name}
                        onPress={() => handleGlobalColorSelect(color)}
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

          {/* Component Accordions */}
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
                        <View
                          className="w-6 h-6 rounded-lg mr-2 border border-gray-200"
                          style={{ backgroundColor: selectedColor.hex }}
                        />
                        <Text className="text-xs" style={{ color: '#919EAB' }}>{selectedColor.name}</Text>
                      </View>
                    )}
                  </View>
                  <Icon
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color="#919EAB"
                  />
                </TouchableOpacity>

                {isOpen && (
                  <View className="px-5 pb-5">
                    {section.types.length > 0 && (
                      <>
                        <Text className="text-[11px] font-black tracking-widest mb-3 uppercase" style={{ color: '#637381' }}>
                          TYPE
                        </Text>
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
                                <Text className="text-[13px] font-black" style={{ color: active ? '#fff' : (isDark ? '#919EAB' : '#1C252E') }}>
                                  {type}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}

                    {!sameColorForAll && (
                      <View className="mt-5">
                        <Text className="text-[11px] font-black tracking-widest mb-3 uppercase" style={{ color: '#637381' }}>
                          TEXTURE
                        </Text>
                        <View className="flex-row flex-wrap gap-2">
                          {COLORS_LIST.map((color) => {
                            const isSelected = selectedColor?.name === color.name;
                            return (
                              <TouchableOpacity
                                key={color.name}
                                onPress={() => {
                                  setConfig({ ...config, [`${section.key}Color`]: color });
                                }}
                                className="w-10 h-10 rounded-lg border-2"
                                style={{
                                  backgroundColor: color.hex,
                                  borderColor: isSelected ? '#2EDE56' : (isDark ? '#3A3A3A' : '#E0E0E0'),
                                }}
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

          {/* Add Render Combo Button */}
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
      <View className="flex-1">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="px-4 py-6">
            <View className="flex-row items-center mb-6">
              <TouchableOpacity onPress={() => setStatus('grid')} className="mr-3">
                <Icon name="arrow-left" size={24} color={colors.text} />
              </TouchableOpacity>
              <View>
                <Text className="text-xl font-black" style={{ color: colors.text }}>Render Queue</Text>
                <Text className="text-xs font-bold" style={{ color: colors.textSecondary }}>
                  {renderQueue.length} {renderQueue.length === 1 ? 'render' : 'renders'} configured
                </Text>
              </View>
            </View>

            <View className="gap-y-6">
              {renderQueue.map((item, index) => (
                <View
                  key={item.id}
                  className="rounded-[32px] border p-6"
                  style={{
                    backgroundColor: isDark ? '#1E1E1E' : '#fff',
                    borderColor: isDark ? '#333' : '#F4F6F8'
                  }}
                >
                  <View className="flex-row justify-between items-center mb-4">
                    <View className="flex-row items-center">
                      <View className="w-8 h-8 rounded-full bg-[#2EDE56] items-center justify-center mr-3">
                        <Text className="text-white font-black text-sm">{index + 1}</Text>
                      </View>
                      <Text className="text-[17px] font-black" style={{ color: colors.text }}>
                        {item.photo?.label || 'Selected Photo'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => removeFromQueue(item.id)}>
                      <Icon name="delete-outline" size={24} color="#FF5630" />
                    </TouchableOpacity>
                  </View>

                  <View className="gap-y-3">
                    {item.summary.map((s: any, idx: number) => (
                      <View
                        key={idx}
                        className="bg-[#919EAB14] p-4 rounded-2xl flex-row items-center justify-between"
                      >
                        <View className="flex-row items-center">
                          <View
                            className="w-4 h-4 rounded-full mr-3 border border-white"
                            style={{ backgroundColor: s.colorHex }}
                          />
                          <Text className="text-sm font-bold" style={{ color: colors.text }}>
                            {s.label}: {s.colorName} {s.type ? `· ${s.type}` : ''}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>

            <View className="mt-8">
              <Text className="text-[11px] font-black tracking-widest mb-4 uppercase" style={{ color: '#637381' }}>
                CUSTOM
              </Text>
              <TouchableOpacity
                onPress={() => setStatus('grid')}
                className="w-full h-16 rounded-[24px] border-2 border-dashed border-[#2EDE56] items-center justify-center flex-row"
              >
                <Icon name="plus" size={20} color="#2EDE56" className="mr-2" />
                <Text className="text-[#2EDE56] font-black text-sm">Add Custom Render</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        <View className="p-4 border-t border-[#919EAB14]">
          <TouchableOpacity
            onPress={handleGenerateAll}
            disabled={renderQueue.length === 0}
            className="w-full h-14 bg-[#2EDE56] rounded-[24px] items-center justify-center flex-row shadow-lg shadow-[#2EDE5633]"
            style={{ opacity: renderQueue.length === 0 ? 0.6 : 1 }}
          >
            <Icon name="send" size={18} color="white" className="mr-3" />
            <Text className="text-white font-black text-base">
              Generate {renderQueue.length} {renderQueue.length === 1 ? 'Render' : 'Renders'}
            </Text>
          </TouchableOpacity>
          <Text className="text-center mt-3 text-[11px] font-bold" style={{ color: colors.textSecondary }}>
            AI-powered visualization · Results in ~30 seconds per render
          </Text>
        </View>
      </View>
    );
  };

  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView>
      <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={handleClose}>
        <View className="flex-1" style={{ backgroundColor: colors.background, paddingTop: insets.top }}>
          {/* Header (only on grid/config) */}
          {status !== 'queue' && (
            <View className="px-4 py-4 flex-row items-center border-b border-[#919EAB14]">
              <TouchableOpacity onPress={handleBack} className="p-1">
                <Icon name="arrow-left" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text className="ml-4 text-lg font-bold" style={{ color: colors.text }}>
                {status === 'grid' ? 'Select Photo' : 'Configure Render'}
              </Text>
              <TouchableOpacity onPress={handleClose} className="ml-auto p-1">
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
          )}

          {status === 'grid' && (allPhotos.length > 0 ? renderGrid() : renderEmptyState())}
          {status === 'config' && renderConfig()}
          {status === 'queue' && renderQueueView()}
        </View>
      </Modal>
    </SafeAreaView>
  );
};
