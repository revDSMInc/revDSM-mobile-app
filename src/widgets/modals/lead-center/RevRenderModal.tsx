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
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Musket Brown', hex: '#3B3131' },
  { name: 'Russet Red', hex: '#632A2A' },
  { name: 'Beige', hex: '#DED3C1' },
  { name: 'Almond', hex: '#D4B896' },
  { name: 'Clay', hex: '#A0785A' },
  { name: 'Charcoal', hex: '#36454F' },
  { name: 'Forest Green', hex: '#355E3B' },
];

const MATERIAL_SECTIONS = [
  {
    key: 'soffit',
    colorKey: 'soffitColor',
    label: 'Soffit',
    icon: 'home-roof',
    types: ['V-Groove', 'Solid', 'Perforated'],
  },
  {
    key: 'fascia',
    colorKey: 'fasciaColor',
    label: 'Fascia',
    icon: 'view-sequential-outline',
    types: ['Standard', 'Wide', 'Wrap'],
  },
  {
    key: 'gutter',
    colorKey: 'gutterColor',
    label: 'Gutter',
    icon: 'pipe',
    types: ['K-Style', 'Half-Round', 'Box'],
  },
  {
    key: 'downspout',
    colorKey: 'downspoutColor',
    label: 'Downspout',
    icon: 'arrow-down-box',
    types: ['Round', 'Rectangular', 'Corrugated'],
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
    soffit: null,
    soffitColor: null,
    fascia: null,
    fasciaColor: null,
    gutter: null,
    gutterColor: null,
    downspout: null,
    downspoutColor: null,
  });
  const [expandedSection, setExpandedSection] = useState<string | null>('gutter');
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
      const payload = {
        houseImageUrl: selectedPhoto?.uri || selectedPhoto?.s3url,
        houseMimeType: 'image/jpeg',
        leadId: lead?._id || lead?.leadId,
        selections: {
          soffit: config.soffit ? `${config.soffit}-${config.soffitColor?.name}` : null,
          soffitType: config.soffit,
          fascia: config.fascia ? `${config.fascia}-${config.fasciaColor?.name}` : null,
          fasciaType: config.fascia,
          gutter: config.gutter ? `${config.gutter}-${config.gutterColor?.name}` : null,
          gutterType: config.gutter,
          downspout: config.downspout ? `${config.downspout}-${config.downspoutColor?.name}` : null,
          downspoutType: config.downspout,
        },
        textureImageUrls: {
          soffit: config.soffitColor?.hex || null,
          fascia: config.fasciaColor?.hex || null,
          gutter: config.gutterColor?.hex || null,
          downspout: config.downspoutColor?.hex || null,
        },
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
    if (status === 'config') setStatus('grid');
    else if (status === 'result') setStatus('config');
    else onClose();
  };

  const handleClose = () => {
    setStatus('grid');
    setSelectedPhoto(null);
    setGeneratedImg(null);
    setConfig({
      soffit: null,
      soffitColor: null,
      fascia: null,
      fasciaColor: null,
      gutter: null,
      gutterColor: null,
      downspout: null,
      downspspoutColor: null,
    });
    onClose();
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

  const renderGrid = () => (
    <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false}>
      <Text className="text-base font-bold mb-1" style={{ color: colors.text }}>
        Select a Photo to Render
      </Text>
      <Text className="text-xs mb-5" style={{ color: colors.textSecondary }}>
        Pick the best angle of the house for AI visualization.
      </Text>
      <View className="flex-row flex-wrap justify-between">
        {allPhotos.map((photo: any, index: number) => (
          <TouchableOpacity
            key={index}
            onPress={() => {
              setSelectedPhoto(photo);
              setStatus('config');
            }}
            className="w-[48%] rounded-2xl overflow-hidden mb-4 shadow-sm"
            style={{
              borderWidth: 2,
              borderColor: 'transparent',
              backgroundColor: isDark ? '#1E1E1E' : '#F4F6F8',
            }}
          >
            <Image
              source={{ uri: photo?.uri || photo?.s3url }}
              style={{ width: '100%', height: 120 }}
              resizeMode="cover"
            />
            <View className="p-2">
              <Text className="text-xs font-bold" style={{ color: colors.text }} numberOfLines={1}>
                {photo?.subcategory?.replace(/-/g, ' ') || `Photo ${index + 1}`}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ height: 30 }} />
    </ScrollView>
  );

  const renderConfig = () => (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      {/* Selected Image Banner */}
      <View style={{ height: 180, backgroundColor: '#000' }}>
        <Image
          source={{ uri: selectedPhoto?.uri || selectedPhoto?.s3url }}
          style={{ width: '100%', height: 180 }}
          resizeMode="cover"
        />
        <View
          className="absolute bottom-0 left-0 right-0 px-4 py-3"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
        >
          <Text className="text-white font-bold text-sm" numberOfLines={1}>
            {selectedPhoto?.subcategory?.replace(/-/g, ' ') || 'Selected Photo'}
          </Text>
          <Text className="text-white text-[10px] opacity-70">
            Configure materials to visualize changes
          </Text>
        </View>
      </View>

      <View className="p-4">
        <Text className="font-bold text-base mb-1" style={{ color: colors.text }}>
          Material Configuration
        </Text>
        <Text className="text-xs mb-5" style={{ color: colors.textSecondary }}>
          Select material type and color for each component.
        </Text>

        {/* Material Sections */}
        {MATERIAL_SECTIONS.map((section) => {
          const isOpen = expandedSection === section.key;
          const selectedType = config[section.key];
          const selectedColor = config[section.colorKey];
          return (
            <View
              key={section.key}
              className="mb-3 rounded-2xl overflow-hidden border"
              style={{
                borderColor: isOpen ? colors.primary.main + '50' : colors.border,
                backgroundColor: isDark ? '#1E1E1E' : '#fff',
              }}
            >
              {/* Section Header */}
              <TouchableOpacity
                onPress={() => setExpandedSection(isOpen ? null : section.key)}
                className="p-4 flex-row justify-between items-center"
              >
                <View className="flex-row items-center flex-1">
                  <View
                    className="w-9 h-9 rounded-xl items-center justify-center mr-3"
                    style={{
                      backgroundColor: isOpen
                        ? colors.primary.main + '15'
                        : isDark
                        ? '#2A2A2A'
                        : '#F4F6F8',
                    }}
                  >
                    <Icon
                      name={section.icon}
                      size={18}
                      color={isOpen ? colors.primary.main : colors.textSecondary}
                    />
                  </View>
                  <View>
                    <Text className="font-bold text-sm" style={{ color: colors.text }}>
                      {section.label}
                    </Text>
                    {selectedType && selectedColor ? (
                      <View className="flex-row items-center mt-0.5">
                        <View
                          className="w-3 h-3 rounded-full mr-1.5 border border-gray-300"
                          style={{ backgroundColor: selectedColor.hex }}
                        />
                        <Text className="text-[10px]" style={{ color: colors.primary.main }}>
                          {selectedType} · {selectedColor.name}
                        </Text>
                      </View>
                    ) : (
                      <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                        Optional — tap to configure
                      </Text>
                    )}
                  </View>
                </View>
                <Icon
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>

              {/* Expanded Config */}
              {isOpen && (
                <View className="px-4 pb-4 border-t" style={{ borderTopColor: colors.border }}>
                  {/* Type Selector */}
                  <Text
                    className="text-[10px] font-black uppercase tracking-widest mt-3 mb-2"
                    style={{ color: colors.textSecondary }}
                  >
                    Type
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingRight: 16 }}
                  >
                    {section.types.map((type) => {
                      const active = config[section.key] === type;
                      return (
                        <TouchableOpacity
                          key={type}
                          onPress={() => setConfig({ ...config, [section.key]: type })}
                          className="mr-2 px-4 py-2 rounded-xl border"
                          style={{
                            borderColor: active ? colors.primary.main : colors.border,
                            backgroundColor: active ? colors.primary.main + '15' : 'transparent',
                          }}
                        >
                          <Text
                            className="text-xs font-bold"
                            style={{ color: active ? colors.primary.main : colors.textSecondary }}
                          >
                            {type}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* Color Selector */}
                  <Text
                    className="text-[10px] font-black uppercase tracking-widest mt-4 mb-2"
                    style={{ color: colors.textSecondary }}
                  >
                    Color
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {COLORS_LIST.map((c) => {
                      const active = config[section.colorKey]?.name === c.name;
                      return (
                        <TouchableOpacity
                          key={c.name}
                          onPress={() => setConfig({ ...config, [section.colorKey]: c })}
                          className="items-center"
                          style={{ width: 60 }}
                        >
                          <View
                            className="w-10 h-10 rounded-full border-2 mb-1"
                            style={{
                              backgroundColor: c.hex,
                              borderColor: active ? colors.primary.main : '#D0D5DDCC',
                              shadowColor: active ? colors.primary.main : 'transparent',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.5,
                              shadowRadius: 4,
                              elevation: active ? 4 : 0,
                            }}
                          />
                          <Text
                            className="text-[9px] text-center font-bold"
                            style={{ color: active ? colors.primary.main : colors.textSecondary }}
                            numberOfLines={1}
                          >
                            {c.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {/* Generate Button */}
        <TouchableOpacity
          onPress={handleGenerate}
          className="w-full h-14 items-center justify-center rounded-2xl mt-4 mb-6 flex-row"
          style={{ backgroundColor: colors.primary.main }}
        >
          <Icon name="auto-fix" size={20} color="white" style={{ marginRight: 8 }} />
          <Text className="text-white font-bold text-base">Generate AI Rendering</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

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
            className="text-[10px] font-black uppercase tracking-widest mb-3"
            style={{ color: colors.textSecondary }}
          >
            Applied Configuration
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {MATERIAL_SECTIONS.map((section) => {
              const type = config[section.key];
              const color = config[section.colorKey];
              if (!type && !color) return null;
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View className="flex-1" style={{ backgroundColor: isDark ? '#121212' : '#fff' }}>
        {/* Header */}
        <View
          className="flex-row items-center justify-between px-4 py-3 border-b"
          style={{
            borderBottomColor: colors.border,
            paddingTop: 16,
            backgroundColor: isDark ? '#1A1A1A' : '#fff',
          }}
        >
          {status !== 'grid' && status !== 'generating' ? (
            <TouchableOpacity
              onPress={handleBack}
              className="p-2 rounded-full"
              style={{ backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
            >
              <Icon name="arrow-left" size={20} color={colors.text} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 36 }} />
          )}

          <View className="items-center">
            <Text className="text-base font-black" style={{ color: colors.primary.main }}>
              revRender
            </Text>
            {lead?.revRenderRuns != null && (
              <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                {lead.revRenderRuns} render{lead.revRenderRuns !== 1 ? 's' : ''} generated
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={handleClose}
            className="p-2 rounded-full"
            style={{ backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
          >
            <Icon name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Content */}
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
    </Modal>
  );
};
