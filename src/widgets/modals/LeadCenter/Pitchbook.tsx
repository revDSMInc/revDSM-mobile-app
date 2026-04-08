import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import pitchBookImages from './pitchbook-images';
import { ModalContainer, ModalHeader } from './components/SharedElements';
import Icon from 'react-native-vector-icons/Ionicons';

const { width } = Dimensions.get('window');

const TABS = [
  { value: 'leafFilter_story', label: 'LeafFilter Story', icon: 'book-outline', color: '#4CBB17' },
  {
    value: 'problems_risk',
    label: 'Problems & Risk',
    icon: 'alert-circle-outline',
    color: '#FF5722',
  },
  {
    value: 'rules_elimination',
    label: 'Rules & Elimination',
    icon: 'ban-outline',
    color: '#263238',
  },
  { value: 'product_testing', label: 'Product & Testing', icon: 'flask-outline', color: '#2962FF' },
  { value: 'our_process', label: 'Our Process', icon: 'settings-outline', color: '#4CBB17' },
  { value: 'summary', label: 'Summary', icon: 'cash-outline', color: '#FF9800' },
];

interface Props {
  onClose: () => void;
}

export default function Pitchbook({ onClose }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('leafFilter_story');
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isImageLoading, setIsImageLoading] = useState(true);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setIsImageLoading(true);
    fadeAnim.setValue(0);
  }, [currentSlideIndex, activeTab]);

  const onImageLoad = () => {
    setIsImageLoading(false);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const activeTabColor = TABS.find((t) => t.value === activeTab)?.color || '#4CBB17';

  const currentImages = useMemo(() => {
    const imagesObj = pitchBookImages[activeTab] || {};
    return Object.values(imagesObj);
  }, [activeTab]);

  const slideCount = currentImages.length;

  const handleNext = () => {
    if (currentSlideIndex < slideCount - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    } else {
      const currentIdx = TABS.findIndex((t) => t.value === activeTab);
      if (currentIdx < TABS.length - 1) {
        setActiveTab(TABS[currentIdx + 1].value);
        setCurrentSlideIndex(0);
      } else {
        setActiveTab(TABS[0].value);
        setCurrentSlideIndex(0);
      }
    }
  };

  const handlePrev = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    } else {
      const currentIdx = TABS.findIndex((t) => t.value === activeTab);
      if (currentIdx > 0) {
        const prevTab = TABS[currentIdx - 1].value;
        setActiveTab(prevTab);
        setCurrentSlideIndex(Object.values(pitchBookImages[prevTab]).length - 1);
      } else {
        const lastTab = TABS[TABS.length - 1].value;
        setActiveTab(lastTab);
        setCurrentSlideIndex(Object.values(pitchBookImages[lastTab]).length - 1);
      }
    }
  };

  return (
    <ModalContainer>
      <ModalHeader title="Pitch Book" subtitle="Presentation Materials" onClose={onClose} />

      {/* Tabs Scrollable */}
      <View
        className="py-2.5 border-b shadow-sm"
        style={{ backgroundColor: isDark ? '#1A1A1A' : '#fff', borderBottomColor: colors.border }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 15 }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <TouchableOpacity
                key={tab.value}
                onPress={() => {
                  setActiveTab(tab.value);
                  setCurrentSlideIndex(0);
                }}
                className="mr-3 flex-row items-center px-4 py-2 rounded-xl border"
                style={{
                  backgroundColor: isActive ? tab.color : 'transparent',
                  borderColor: isActive ? tab.color : colors.border,
                }}
              >
                <Icon
                  name={tab.icon}
                  size={14}
                  color={isActive ? 'white' : colors.text}
                  style={{ marginRight: 6 }}
                />
                <Text
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: isActive ? 'white' : colors.text }}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View className="flex-1 items-center justify-center bg-black">
        {/* Progress Dots */}
        <View className="absolute top-6 flex-row z-10">
          {currentImages.map((_, idx) => (
            <View
              key={idx}
              className="h-1.5 rounded-full mx-1"
              style={{
                width: currentSlideIndex === idx ? 20 : 6,
                backgroundColor:
                  currentSlideIndex === idx ? activeTabColor : 'rgba(255,255,255,0.3)',
              }}
            />
          ))}
        </View>

        {isImageLoading && (
          <View className="absolute z-10">
            <ActivityIndicator size="large" color={activeTabColor} />
          </View>
        )}

        <Animated.View style={{ opacity: fadeAnim, width: '100%', height: '100%' }}>
          <Image
            source={currentImages[currentSlideIndex]}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
            onLoad={onImageLoad}
          />

          {/* Hidden pre-loading buffer for next slide */}
          {currentSlideIndex < slideCount - 1 && (
            <Image
              source={currentImages[currentSlideIndex + 1]}
              style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}
            />
          )}
          {/* Dark Mode Effect Overlay */}
          {isDark && <View className="absolute inset-0 bg-black/15 pointer-events-none" />}
        </Animated.View>

        {/* Navigation Overlays */}
        <TouchableOpacity
          onPress={handlePrev}
          className="absolute left-0 top-0 bottom-0 w-24 items-center justify-center"
        >
          <View className="w-10 h-10 rounded-full bg-black/30 items-center justify-center">
            <Icon name="chevron-back" size={24} color="white" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleNext}
          className="absolute right-0 top-0 bottom-0 w-24 items-center justify-center"
        >
          <View className="w-10 h-10 rounded-full bg-black/30 items-center justify-center">
            <Icon name="chevron-forward" size={24} color="white" />
          </View>
        </TouchableOpacity>
      </View>
    </ModalContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
