import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  Dimensions,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { LeadService } from '../../../services/api/leads';

interface RevRenderHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  runs: any[];
  initialIndex: number;
  leadId?: string;
  onDeleteSuccess?: () => void;
}

export const RevRenderHistoryModal = ({
  visible,
  onClose,
  runs,
  initialIndex,
  leadId,
  onDeleteSuccess,
}: RevRenderHistoryModalProps) => {
  const { colors, isDark } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex, visible]);

  useEffect(() => {
    if (visible && runs.length === 0) {
      onClose();
    }
  }, [runs, visible]);

  useEffect(() => {
    if (currentIndex >= runs.length) {
      setCurrentIndex(Math.max(0, runs.length - 1));
    }
  }, [runs, currentIndex]);

  const handleDeletePress = () => {
    setDeleteReason('');
    setDeleteVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!currentRun?.runId && !currentRun?._id) return;
    const runId = currentRun.runId || currentRun._id;
    setIsDeleting(true);
    try {
      await LeadService.deleteRevRenderRun(runId, { reason: deleteReason });
      
      if (onDeleteSuccess) {
        onDeleteSuccess();
      }

      if (runs.length <= 1) {
        onClose();
      } else {
        setCurrentIndex((prev) => {
          if (prev >= runs.length - 1) {
            return Math.max(0, runs.length - 2);
          }
          return prev;
        });
      }
      setDeleteVisible(false);
      setDeleteReason('');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to delete render.');
    } finally {
      setIsDeleting(false);
    }
  };

  const screenWidth = Dimensions.get('window').width;
  const imageWidth = screenWidth - 40;
  const imageHeight = 400;

  // ── Pinch / pan for zooming ───────────────────────────────────────────
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => { scale.value = savedScale.value * e.scale; })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1); savedScale.value = 1;
        translateX.value = withSpring(0); translateY.value = withSpring(0);
        savedTranslateX.value = 0; savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const zoomPan = Gesture.Pan()
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

  const composedGesture = Gesture.Simultaneous(pinchGesture, zoomPan);

  const imageAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // ── Comparison slider ─────────────────────────────────────────────────
  // sliderX lives in Reanimated so the handle moves without a JS bridge round-trip.
  const sliderX = useSharedValue(imageWidth / 2);
  const savedSliderX = useSharedValue(imageWidth / 2);

  // Reset whenever the card changes
  useEffect(() => {
    sliderX.value = imageWidth / 2;
    savedSliderX.value = imageWidth / 2;
  }, [currentIndex]);

  const sliderPan = Gesture.Pan()
    // Only activate on clear horizontal swipes so vertical scrolls pass through
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      const next = savedSliderX.value + e.translationX;
      sliderX.value = Math.max(0, Math.min(imageWidth, next));
    })
    .onEnd(() => {
      savedSliderX.value = sliderX.value;
    });

  const handleAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sliderX.value - 0 }], // -30 = half handle width (60/2)
  }));

  const maskAnimStyle = useAnimatedStyle(() => ({
    width: sliderX.value,
  }));

  // ── Nav ───────────────────────────────────────────────────────────────
  const handlePrev = () => { if (currentIndex > 0) setCurrentIndex(currentIndex - 1); };
  const handleNext = () => { if (currentIndex < runs.length - 1) setCurrentIndex(currentIndex + 1); };

  const currentRun = runs[currentIndex];
  if (!currentRun) return null;

  const beforeImage = currentRun.originalUrl || currentRun.s3UrlOriginal;
  const afterImage = currentRun.generatedUrl || currentRun.s3UrlGenerated;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.95)' }]}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.headerTitle}>Render #{currentIndex + 1}</Text>
                {(currentRun?.runId || currentRun?._id) && (
                  <TouchableOpacity onPress={handleDeletePress} style={{ marginLeft: 12 }}>
                    <Icon name="trash-can-outline" size={22} color="#FF5630" />
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.statusRow}>
                <Icon name="check-circle" size={14} color="#72BD00" />
                <Text style={styles.statusText}>Rendered</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>

          {/* Comparison Slider — zoom wrapper */}
          <GestureDetector gesture={composedGesture}>
            <Reanimated.View
              style={[styles.sliderContainer, { width: imageWidth, height: imageHeight }, imageAnimStyle]}
            >
              {/* AFTER — background */}
              <Image
                source={{ uri: afterImage }}
                style={{ position: 'absolute', width: imageWidth, height: imageHeight }}
                resizeMode="cover"
              />

              {/* BEFORE — clipped left portion, driven by sliderX */}
              <Reanimated.View
                style={[
                  {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: imageHeight,
                    overflow: 'hidden',
                    borderRightWidth: 1,
                    borderRightColor: 'rgba(255,255,255,0.5)',
                  },
                  maskAnimStyle,
                ]}
              >
                <Image
                  source={{ uri: beforeImage }}
                  style={{ width: imageWidth, height: imageHeight }}
                  resizeMode="cover"
                />
              </Reanimated.View>

              {/* Labels */}
              <View style={[styles.label, styles.labelBefore]}>
                <Text style={styles.labelText}>Before</Text>
              </View>
              <View style={[styles.label, styles.labelAfter]}>
                <Text style={styles.labelText}>After</Text>
              </View>

              {/* Draggable handle — uses its own RNGH Pan so it doesn't fight PanResponder */}
              <GestureDetector gesture={sliderPan}>
                <Reanimated.View style={[styles.handle, { height: imageHeight }, handleAnimStyle]}>
                  <View style={styles.handleLine} />
                  <View style={styles.handleCircle}>
                    <Icon name="compare-horizontal" size={20} color="#1C252E" />
                  </View>
                </Reanimated.View>
              </GestureDetector>
            </Reanimated.View>
          </GestureDetector>

          {/* Footer Navigation */}
          <View style={styles.footer}>
            <View style={styles.navRow}>
              <TouchableOpacity
                onPress={handlePrev}
                disabled={currentIndex === 0}
                style={[styles.navBtn, currentIndex === 0 && { opacity: 0.3 }]}
              >
                <Icon name="chevron-left" size={32} color="white" />
              </TouchableOpacity>

              <View style={styles.pagination}>
                {runs.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: i === currentIndex ? '#72BD00' : 'rgba(255,255,255,0.3)' },
                    ]}
                  />
                ))}
              </View>

              <TouchableOpacity
                onPress={handleNext}
                disabled={currentIndex === runs.length - 1}
                style={[styles.navBtn, currentIndex === runs.length - 1 && { opacity: 0.3 }]}
              >
                <Icon name="chevron-right" size={32} color="white" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.footerCloseBtn}>
              <Text style={styles.footerCloseText}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Delete Confirmation Modal */}
          <Modal visible={deleteVisible} transparent animationType="fade">
            <View style={styles.deleteOverlay}>
              <View style={[styles.deleteContainer, { backgroundColor: isDark ? '#1C252E' : 'white' }]}>
                <View style={styles.alertIconBg}>
                  <Icon name="alert-outline" size={32} color="#FF5630" />
                </View>
                <Text style={[styles.deleteTitle, { color: isDark ? 'white' : '#1C252E' }]}>Delete render?</Text>
                <Text style={styles.deleteDesc}>
                  This render will be removed from your gallery. Please enter a short reason for your records.
                </Text>
                <TextInput
                  style={[styles.reasonInput, { color: isDark ? 'white' : '#1C252E', borderColor: colors.border }]}
                  placeholder="Reason for deletion"
                  placeholderTextColor="#919EAB"
                  value={deleteReason}
                  onChangeText={setDeleteReason}
                  multiline
                  maxLength={2000}
                />
                <View style={styles.deleteActions}>
                  <TouchableOpacity
                    onPress={() => setDeleteVisible(false)}
                    disabled={isDeleting}
                    style={[styles.deleteBtnCancel, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.btnTextCancel, { color: isDark ? 'white' : '#1C252E' }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDeleteConfirm}
                    disabled={isDeleting || !deleteReason.trim()}
                    style={[styles.deleteBtnConfirm, { opacity: (isDeleting || !deleteReason.trim()) ? 0.6 : 1 }]}
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text style={styles.btnTextConfirm}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    paddingTop: 50,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 40,
    alignItems: 'center',
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusText: {
    color: '#72BD00',
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '600',
  },
  closeBtn: {
    marginLeft: 'auto',
    padding: 8,
  },
  sliderContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1E1E1E',
  },
  label: {
    position: 'absolute',
    top: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  labelBefore: {
    left: 20,
    backgroundColor: '#3498dbCC',
  },
  labelAfter: {
    right: 20,
  },
  labelText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    marginLeft: -30,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  handleLine: {
    width: 2,
    height: '100%',
    backgroundColor: 'white',
  },
  handleCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  footer: {
    width: '100%',
    position: 'absolute',
    bottom: 60,
    alignItems: 'center',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  navBtn: {
    padding: 10,
  },
  pagination: {
    flexDirection: 'row',
    marginHorizontal: 20,
  },
  dot: {
    width: 20,
    height: 4,
    borderRadius: 2,
    marginHorizontal: 3,
  },
  footerCloseBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
  },
  footerCloseText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  deleteContainer: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  alertIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 86, 48, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  deleteTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  deleteDesc: {
    color: '#637381',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  reasonInput: {
    width: '100%',
    height: 80,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    textAlignVertical: 'top',
    fontSize: 14,
    marginBottom: 20,
  },
  deleteActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  deleteBtnCancel: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnConfirm: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#FF5630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTextCancel: {
    fontSize: 14,
    fontWeight: '600',
  },
  btnTextConfirm: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
