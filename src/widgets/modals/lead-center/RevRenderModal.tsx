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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { REV_RENDER_VIEW_GROUPS } from '../../../constants/lead-center';

interface RevRenderModalProps {
  visible: boolean;
  onClose: () => void;
  lead: any;
  sectionImages: { [key: string]: any[] };
  onNavToDocs: () => void;
  onGenerate: (payload: any) => Promise<string | null>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS_LIST = [
  // Row 1
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Linen', hex: '#F0EAD6' },
  { name: 'Eggshell', hex: '#F0EAD6' },
  { name: 'Wicker', hex: '#C9AE9C' },
  { name: 'Sand', hex: '#C2B280' },
  { name: 'Clay', hex: '#A0785A' },
  { name: 'Gray', hex: '#808080' },
  // Row 2
  { name: 'Beige', hex: '#F5F5DC' },
  { name: 'Almond', hex: '#EFDECD' },
  { name: 'Heather', hex: '#9AA7B0' },
  { name: 'Tan', hex: '#D2B48C' },
  { name: 'Champagne', hex: '#F7E7CE' },
  { name: 'Pebble', hex: '#A9A9A9' },
  { name: 'Fawn', hex: '#E5D3BF' },
  // Row 3
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

// ─── Component ────────────────────────────────────────────────────────────────

export const RevRenderModal = ({
  visible,
  onClose,
  lead,
  sectionImages,
  onNavToDocs,
  onGenerate,
}: RevRenderModalProps) => {
  const { colors, isDark } = useTheme();

  // ── Status & State ─────────────────────────────────────────────────────────
  const [status, setStatus] = useState<'grid' | 'config' | 'generating' | 'result'>('grid');
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);

  // Flatten sectionImages for the grid
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

  // Before/After slider
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

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setStatus('generating');
    try {
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

      const payload = {
        houseImageUrl: selectedPhoto?.uri || selectedPhoto?.s3url,
        houseMimeType: 'image/jpeg',
        leadId: lead?._id || lead?.leadId,
        selections,
        textureImageUrls,
      };

      const resultUrl = await onGenerate(payload);
      sliderPosition.setValue(imageWidth / 2);
      sliderPosition.setOffset(0);
      setGeneratedImg(resultUrl || selectedPhoto?.uri || selectedPhoto?.s3url);
      setStatus('result');
    } catch {
      setStatus('config');
    }
  };

  const handleBack = () => {
    if (status === 'config') {
      setStatus('grid');
      setSelectedPhoto(null);
    } else if (status === 'result') {
      setStatus('config');
    } else {
      handleClose();
    }
  };

  const handleClose = () => {
    setStatus('grid');
    setSelectedPhoto(null);
    setGeneratedImg(null);
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

  // ── Helper Components ──────────────────────────────────────────────────────
  
  const HouseImage = ({ uri, style, height = 130 }: { uri: string; style?: any; height?: number }) => {
    const [loading, setLoading] = useState(true);
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
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
        />
      </View>
    );
  };

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
    // Group photos based on REV_RENDER_VIEW_GROUPS logic (parity with web before.js)
    const discoveredGroups = REV_RENDER_VIEW_GROUPS.map((group) => {
      const discoveredViews: any[] = [];
      const photosInCategory = sectionImages[group.categoryId] || [];

      group.views.forEach((view) => {
        // Find photos matching this subcategory/view ID
        const photo = photosInCategory.find((p) => p.subcategory === view.id);
        if (photo) {
          discoveredViews.push({
            ...photo,
            label: view.label,
          });
        }
      });

      // Also pick up any photos in this category that didn't match a specific view ID
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
        // If sameColorForAll is off, we still use the top picker as a "master" if no section is expanded?
        // Actually, screenshot shows it as "Same Color for All", so let's stick to that.
        newConfig.soffitColor = color; // Fallback
      }
      setConfig(newConfig);
    };

    const toggleChecked = (key: string) => {
      const newChecked = !config[`${key}Checked`];
      const newConfig = { ...config, [`${key}Checked`]: newChecked };
      
      // If turning ON and sameColorForAll is active, sync with global color (using soffitColor as ref)
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
            onPress={handleGenerate}
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

  const renderGenerating = () => (
    <View className="flex-1 items-center justify-center px-8">
      <View
        className="w-28 h-28 rounded-full items-center justify-center mb-8"
        style={{ backgroundColor: colors.primary.main + '15' }}
      >
        <ActivityIndicator size="large" color={colors.primary.main} />
      </View>
      <Text className="text-xl font-bold text-center mb-2" style={{ color: colors.text }}>
        Applying AI Generation...
      </Text>
      <Text className="text-center" style={{ color: colors.textSecondary }}>
        This usually takes 10–30 seconds. The AI is painting your home with the selected materials.
      </Text>
    </View>
  );

  const renderResult = () => {
    const maskWidth = sliderPosition.interpolate({
      inputRange: [0, imageWidth],
      outputRange: [0, imageWidth],
      extrapolate: 'clamp',
    });
    const beforeImage = selectedPhoto?.uri || selectedPhoto?.s3url;

    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-4 pt-6 pb-4">
          <Text className="text-lg font-bold mb-1" style={{ color: colors.text }}>
            revRender Result
          </Text>
          <Text className="text-xs mb-5" style={{ color: colors.textSecondary }}>
            Drag the handle to compare before and after.
          </Text>
        </View>

        {/* Before/After Slider */}
        <View
          style={{
            marginHorizontal: 16,
            width: imageWidth,
            height: imageHeight,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {/* BEFORE layer */}
          <Image
            source={{ uri: beforeImage }}
            style={{ position: 'absolute', width: imageWidth, height: imageHeight }}
            resizeMode="cover"
          />

          {/* AFTER layer (clipped) */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: imageHeight,
              width: maskWidth,
              overflow: 'hidden',
            }}
          >
            <Image
              source={{ uri: generatedImg || beforeImage }}
              style={{ width: imageWidth, height: imageHeight }}
              resizeMode="cover"
            />
          </Animated.View>

          {/* Labels */}
          <View
            className="absolute bottom-2 left-3 px-2 py-1 rounded-md"
            style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          >
            <Text className="text-white text-[10px] font-bold">BEFORE</Text>
          </View>
          <View
            className="absolute bottom-2 right-3 px-2 py-1 rounded-md"
            style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          >
            <Text className="text-white text-[10px] font-bold">AFTER</Text>
          </View>

          {/* Draggable Handle */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 40,
              marginLeft: -20,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ translateX: sliderPosition }],
            }}
            {...panResponder.panHandlers}
          >
            <View
              style={{
                width: 2,
                height: '100%',
                backgroundColor: 'white',
                shadowColor: '#000',
                shadowOpacity: 0.5,
                shadowRadius: 4,
                elevation: 8,
              }}
            />
            <View
              className="w-10 h-10 rounded-full absolute items-center justify-center"
              style={{
                backgroundColor: 'white',
                shadowColor: '#000',
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 10,
              }}
            >
              <Icon name="compare" size={20} color="#1C252E" />
            </View>
          </Animated.View>
        </View>

        {/* Material Summary */}
        <View
          className="mx-4 mt-5 p-4 rounded-2xl border"
          style={{ borderColor: colors.border, backgroundColor: isDark ? '#1E1E1E' : '#F8FAFB' }}
        >
          <Text
            className="text-[10px] font-black  tracking-widest mb-3"
            style={{ color: colors.textSecondary }}
          >
            Applied Configuration
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {MATERIAL_SECTIONS.map((section) => {
              const type = config[section.key];
              const color = config[`${section.key}Color`];
              if (!config[`${section.key}Checked`]) return null;
              return (
                <View
                  key={section.key}
                  className="flex-row items-center px-3 py-1.5 rounded-full border"
                  style={{
                    borderColor: colors.primary.main + '40',
                    backgroundColor: colors.primary.main + '10',
                  }}
                >
                  {color && (
                    <View
                      className="w-3 h-3 rounded-full mr-1.5 border"
                      style={{ backgroundColor: color.hex, borderColor: '#D0D5DD' }}
                    />
                  )}
                  <Text className="text-[10px] font-bold" style={{ color: colors.primary.main }}>
                    {section.label}
                    {type ? `: ${type}` : ''}
                    {color ? ` · ${color.name}` : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Action Buttons */}
        <View className="px-4 mt-6 mb-8 gap-3">
          <TouchableOpacity
            onPress={() => {
              setStatus('config');
              setExpandedSection('gutter');
            }}
            className="w-full h-12 items-center justify-center rounded-xl border flex-row"
            style={{ borderColor: colors.border }}
          >
            <Icon name="tune-variant" size={18} color={colors.text} style={{ marginRight: 6 }} />
            <Text className="font-bold text-sm" style={{ color: colors.text }}>
              Adjust Configuration
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleClose}
            className="w-full h-12 items-center justify-center rounded-xl flex-row"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Icon name="check-circle" size={18} color="white" style={{ marginRight: 6 }} />
            <Text className="text-white font-bold text-sm">Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  // ── Main Render ─────────────────────────────────────────────────────────────

  const hasPhotos = allPhotos.length > 0;

  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View 
        className="flex-1" 
        style={{ 
          backgroundColor: isDark ? '#121212' : '#F9FAFB',
          paddingTop: insets.top > 0 ? 0 : 10 // PageSheet handles some top inset already
        }}
      >
        {/* Header (Web Parity based on screenshot) */}
        <View
          className="flex-row items-center px-4 py-3"
          style={{
            backgroundColor: isDark ? '#1A1A1A' : '#F9FAFB',
            borderBottomWidth: 1,
            borderBottomColor: isDark ? '#2A2A2A' : '#F4F6F8',
            zIndex: 1000,
          }}
        >
          <TouchableOpacity
            onPress={() => {
              if (status === 'config') {
                setStatus('grid');
                setSelectedPhoto(null);
              } else if (status === 'result') {
                setStatus('config');
              } else {
                handleClose();
              }
            }}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.6}
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ 
              backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8',
            }}
          >
            <Icon name="arrow-left" size={24} color="#919EAB" />
          </TouchableOpacity>

          <View className="flex-1">
            <Text className="text-[17px] font-black" style={{ color: colors.text }}>
              {status === 'config' ? 'Configure Render' : 'revRender'}
            </Text>
            <Text className="text-xs" style={{ color: colors.textSecondary }} numberOfLines={1}>
              {status === 'config' 
                ? (selectedPhoto?.label || selectedPhoto?.subcategory?.replace(/-/g, ' '))
                : 'Select a photo to render (from Job Docs)'}
            </Text>
          </View>
        </View>

        {/* Content */}
        <View className="flex-1" style={{ zIndex: 1 }}>
          {status === 'generating'
            ? renderGenerating()
            : !hasPhotos
            ? renderEmptyState()
            : status === 'grid'
            ? renderGrid()
            : status === 'config'
            ? renderConfig()
            : renderResult()}
        </View>
      </View>
    </Modal>
  );
};
