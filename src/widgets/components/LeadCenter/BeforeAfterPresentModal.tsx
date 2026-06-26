import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  Dimensions,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';

const { width, height } = Dimensions.get('window');

interface BeforeAfterPresentModalProps {
  visible: boolean;
  onClose: () => void;
  beforeImages: string[];
  afterImages: string[];
  job?: any;
}

export const BeforeAfterPresentModal = ({
  visible,
  onClose,
  beforeImages,
  afterImages,
  job,
}: BeforeAfterPresentModalProps) => {
  const { user } = useAuth();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const scrollViewRef = React.useRef<ScrollView>(null);

  React.useEffect(() => {
    const userId = user?._id || user?.id;
    if (visible && userId) {
      logEvent('view', {
        user_id: userId,
        created_by: userId,
        module_type: 'presentation',
        meta: {
          jobNumber: job?.jobNumber,
          jobId: job?._id,
          beforeImagesCount: beforeImages.length,
          afterImagesCount: afterImages.length,
          action: 'presentation_mode_selected',
        },
      });
    }
  }, [visible, user, job, beforeImages.length, afterImages.length]);

  // Number of slides is determined by the number of complete pairs
  const numSlides = Math.min(beforeImages.length, afterImages.length);

  const scrollTo = (index: number) => {
    if (index >= 0 && index < numSlides) {
      scrollViewRef.current?.scrollTo({ x: index * (width * 0.95), animated: true });
      setActiveIndex(index);
    }
  };

  const handleScroll = (event: any) => {
    const xOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(xOffset / (width * 0.95));
    if (index !== activeIndex) {
      setActiveIndex(index);
    }
  };

  if (numSlides === 0) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Before & After Gallery</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={Platform.OS === 'ios' ? 22 : 28} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }}>
            <ScrollView
              ref={scrollViewRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleScroll}
              style={{ flex: 1 }}
            >
              {[...Array(numSlides)].map((_, index) => (
                <View key={`slide-${index}`} style={{ width: width * 0.95, padding: 16 }}>
                  {/* Before Card */}
                  <View className="flex-1 mb-4 rounded-3xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm relative">
                    <Image 
                      source={{ uri: beforeImages[index] }} 
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                    <View className="absolute top-4 left-4 bg-slate-800/80 px-3 py-1.5 rounded-xl">
                      <Text className="text-white text-[11px] font-black tracking-widest">BEFORE</Text>
                    </View>
                  </View>

                  {/* After Card */}
                  <View className="flex-1 rounded-3xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm relative">
                    <Image 
                      source={{ uri: afterImages[index] }} 
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                    <View className="absolute top-4 left-4 bg-[#65C216] px-3 py-1.5 rounded-xl">
                      <Text className="text-white text-[11px] font-black tracking-widest">AFTER</Text>
                    </View>
                  </View>
                </View>
              ))}

            </ScrollView>

            {/* Navigation Arrows */}
            {activeIndex > 0 && (
              <TouchableOpacity 
                onPress={() => scrollTo(activeIndex - 1)}
                style={[styles.navArrow, { left: 10 }]}
              >
                <Icon name="chevron-left" size={30} color="#64748b" />
              </TouchableOpacity>
            )}
            {activeIndex < numSlides - 1 && (
              <TouchableOpacity 
                onPress={() => scrollTo(activeIndex + 1)}
                style={[styles.navArrow, { right: 10 }]}
              >
                <Icon name="chevron-right" size={30} color="#64748b" />
              </TouchableOpacity>
            )}

            {/* Pagination Dots */}
            {numSlides > 1 && (
              <View style={styles.pagination}>
                {[...Array(numSlides)].map((_, i) => (
                  <View 
                    key={i} 
                    style={[
                      styles.dot, 
                      { backgroundColor: i === activeIndex ? '#65C216' : '#e2e8f0' }
                    ]} 
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: Platform.OS === 'ios' ? width * 0.95 : width * 0.95,
    height: Platform.OS === 'ios' ? height * 0.8 : height * 0.92,
    backgroundColor: 'white',
    borderRadius: 32,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Platform.OS === 'ios' ? 16 : 24,
    paddingVertical: Platform.OS === 'ios' ? 12 : 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: {
    fontSize: Platform.OS === 'ios' ? 16 : 22,
    fontWeight: '900',
    color: '#1e293b',
  },
  closeButton: {
    padding: Platform.OS === 'ios' ? 2 : 4,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    flex: 1, // Make cards take equal space
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: '#65C216',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    zIndex: 10,
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  navArrow: {
    position: 'absolute',
    top: '45%',
    backgroundColor: 'rgba(255,255,255,0.9)',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 100,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 5,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
});

