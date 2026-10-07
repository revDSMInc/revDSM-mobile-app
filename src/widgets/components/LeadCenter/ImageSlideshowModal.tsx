import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  FlatList,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { LoadingImage } from './JobDocsUtils';

interface ImageSlideshowModalProps {
  visible: boolean;
  onClose: () => void;
  previewImages: { uri: string; label: string }[];
  setPreviewImages: React.Dispatch<React.SetStateAction<{ uri: string; label: string }[]>>;
  previewIndex: number;
  setPreviewIndex: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  isFullscreen: boolean;
  setIsFullscreen: (fs: boolean) => void;
  insets: any;
  asOverlay?: boolean;
}

export const ImageSlideshowModal = ({
  visible,
  onClose,
  previewImages,
  setPreviewImages,
  previewIndex,
  setPreviewIndex,
  isPlaying,
  setIsPlaying,
  isFullscreen,
  setIsFullscreen,
  insets,
  asOverlay = false,
}: ImageSlideshowModalProps) => {
  const thumbnailListRef = useRef<FlatList>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    let timer: any = null;
    if (isPlaying && previewImages.length > 1) {
      timer = setInterval(() => {
        setPreviewIndex((prev) => (prev + 1) % previewImages.length);
        resetZoomState();
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, previewImages.length]);

  useEffect(() => {
    if (previewImages.length > 0 && thumbnailListRef.current) {
      try {
        thumbnailListRef.current.scrollToIndex({
          index: previewIndex,
          animated: true,
          viewPosition: 0.5,
        });
      } catch (e) {
      }
    }
  }, [previewIndex, previewImages]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ]
  }));

  const resetZoomState = () => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const handleZoomIn = () => {
    const nextScale = Math.min(scale.value + 0.5, 4);
    scale.value = withSpring(nextScale);
    savedScale.value = nextScale;
  };

  const handleZoomOut = () => {
    const nextScale = Math.max(scale.value - 0.5, 1);
    scale.value = withSpring(nextScale);
    savedScale.value = nextScale;
    if (nextScale === 1) {
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    }
  };

  const handleDismiss = () => {
    setPreviewImages([]);
    setIsPlaying(false);
    resetZoomState();
    onClose();
  };

  if (!visible || previewImages.length === 0) return null;

  const content = (
    <GestureHandlerRootView style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}>
      <View style={{ flex: 1, backgroundColor: '#050D0A', paddingTop: insets.top > 0 ? insets.top : 16, paddingBottom: insets.bottom > 0 ? insets.bottom : 16 }}>
        {/* Header */}
        {!isFullscreen && (
          <View className="flex-row items-center justify-between px-4 pb-4 border-b border-white/10">
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text className="text-white font-extrabold text-sm" numberOfLines={1}>
                {previewImages[previewIndex]?.label || 'Image'}
              </Text>
              {previewImages.length > 1 && (
                <Text className="text-[10px] text-slate-400 font-bold mt-0.5">
                  {previewIndex + 1} / {previewImages.length}
                </Text>
              )}
            </View>
            
            <View className="flex-row items-center gap-3">
              <TouchableOpacity onPress={handleZoomIn} className="p-2 bg-white/10 rounded-full">
                <Icon name="magnify-plus" size={18} color="white" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleZoomOut} className="p-2 bg-white/10 rounded-full">
                <Icon name="magnify-minus" size={18} color="white" />
              </TouchableOpacity>
              
              {previewImages.length > 1 && (
                <TouchableOpacity onPress={() => setIsPlaying(!isPlaying)} className="p-2 bg-white/10 rounded-full">
                  <Icon name={isPlaying ? "pause" : "play"} size={18} color="white" />
                </TouchableOpacity>
              )}
              
              <TouchableOpacity onPress={() => setIsFullscreen(!isFullscreen)} className="p-2 bg-white/10 rounded-full">
                <Icon name={isFullscreen ? "fullscreen-exit" : "fullscreen"} size={18} color="white" />
              </TouchableOpacity>
              
              <TouchableOpacity
                onPress={handleDismiss}
                className="p-2 bg-white/20 rounded-full"
              >
                <Icon name="close" size={18} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Minimised Fullscreen Exit button */}
        {isFullscreen && (
          <TouchableOpacity
            onPress={() => setIsFullscreen(false)}
            className="absolute top-12 right-6 p-2 bg-black/60 rounded-full z-10 border border-white/20"
          >
            <Icon name="fullscreen-exit" size={20} color="white" />
          </TouchableOpacity>
        )}

        {/* Main View with Left/Right arrows and GestureDetector */}
        <View className="flex-1 items-center justify-center relative">
          {/* Left Navigation Arrow */}
          {previewImages.length > 1 && previewIndex > 0 && !isFullscreen && (
            <TouchableOpacity
              onPress={() => {
                setIsPlaying(false);
                setPreviewIndex(prev => prev - 1);
                resetZoomState();
              }}
              className="absolute left-4 p-3 bg-black/55 rounded-full z-10 border border-white/10"
            >
              <Icon name="chevron-left" size={24} color="white" />
            </TouchableOpacity>
          )}

          {/* Center Image */}
          {previewImages[previewIndex] && (
            <GestureDetector gesture={composedGesture}>
              <Animated.View className="w-full h-[70%]" style={animatedStyle}>
                <LoadingImage
                  uri={previewImages[previewIndex].uri}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </Animated.View>
            </GestureDetector>
          )}

          {/* Right Navigation Arrow */}
          {previewImages.length > 1 && previewIndex < previewImages.length - 1 && !isFullscreen && (
            <TouchableOpacity
              onPress={() => {
                setIsPlaying(false);
                setPreviewIndex(prev => prev + 1);
                resetZoomState();
              }}
              className="absolute right-4 p-3 bg-black/55 rounded-full z-10 border border-white/10"
            >
              <Icon name="chevron-right" size={24} color="white" />
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom thumbnail list strip */}
        {!isFullscreen && previewImages.length > 1 && (
          <View className="px-4 py-2 border-t border-white/10 bg-black/30">
            <FlatList
              ref={thumbnailListRef}
              horizontal
              data={previewImages}
              keyExtractor={(item, index) => `${item.uri}-${index}`}
              showsHorizontalScrollIndicator={false}
              getItemLayout={(data, index) => (
                { length: 72, offset: 72 * index, index }
              )}
              contentContainerStyle={{ paddingHorizontal: 8, gap: 8 }}
              renderItem={({ item, index }) => {
                const isActive = index === previewIndex;
                return (
                  <TouchableOpacity
                    onPress={() => {
                      setIsPlaying(false);
                      setPreviewIndex(index);
                      resetZoomState();
                    }}
                    style={{
                      width: 64,
                      height: 48,
                      borderRadius: 8,
                      overflow: 'hidden',
                      borderWidth: isActive ? 2 : 0,
                      borderColor: 'white',
                      opacity: isActive ? 1 : 0.5,
                    }}
                  >
                    <Image source={{ uri: item.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
      </View>
    </GestureHandlerRootView>
  );

  if (asOverlay) {
    return content;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      {content}
    </Modal>
  );
};
