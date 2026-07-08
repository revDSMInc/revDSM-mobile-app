import React, { useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  PanResponder,
  StyleSheet,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface AgreementSignatureCaptureProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onCapture: (dataUri: string) => void;
}

/**
 * Self-contained signature/initials drawing surface. The drawn paths are rasterized
 * to a PNG data-URI via react-native-svg's own `Svg.toDataURL()` — NOT view-shot.
 * view-shot can't snapshot react-native-svg content on Android (it renders in a
 * separate texture and comes back blank); toDataURL rasterizes the SVG natively and
 * works on both platforms. The resulting <Image> is then captured fine inside the
 * full-agreement view-shot snapshot.
 */
export function AgreementSignatureCapture({
  visible,
  title = 'Draw Your Signature',
  onClose,
  onCapture,
}: AgreementSignatureCaptureProps) {
  const svgRef = useRef<any>(null);
  const [padSize, setPadSize] = useState({ width: 0, height: 0 });
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const currentRef = useRef('');

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the stroke: don't let a parent (Modal/ScrollView) steal the touch mid-draw.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentRef.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        setCurrent(currentRef.current);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentRef.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        setCurrent(currentRef.current);
      },
      onPanResponderRelease: () => {
        // Capture the finished stroke FIRST: setPaths' updater runs later (on flush),
        // and reading currentRef there would see '' because we clear it below → the
        // stroke would vanish the moment the finger lifts. Use the captured value.
        const finished = currentRef.current;
        currentRef.current = '';
        setCurrent('');
        if (finished) {
          setPaths((prev) => [...prev, finished]);
        }
      },
      onPanResponderTerminate: () => {
        // Same commit path if another responder steals the gesture on lift.
        const finished = currentRef.current;
        currentRef.current = '';
        setCurrent('');
        if (finished) {
          setPaths((prev) => [...prev, finished]);
        }
      },
    })
  ).current;

  const clear = () => {
    setPaths([]);
    setCurrent('');
    currentRef.current = '';
  };

  const handleClose = () => {
    clear();
    onClose();
  };

  const save = () => {
    const ref = svgRef.current;
    if (!ref || typeof ref.toDataURL !== 'function') {
      console.warn('[AgreementSignatureCapture] Svg.toDataURL unavailable');
      handleClose();
      return;
    }
    // toDataURL returns raw base64 (no data: prefix); rasterizes the drawn paths.
    ref.toDataURL((base64: string) => {
      if (base64) onCapture(`data:image/png;base64,${base64}`);
      clear();
      onClose();
    });
  };

  const hasDrawing = paths.length > 0 || current !== '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>{title}</Text>
              <Text style={styles.headerSub}>Use your finger or stylus to sign below.</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Icon name="close" size={20} color="white" />
            </TouchableOpacity>
          </View>

          <View style={styles.padWrap}>
            <View
              collapsable={false}
              style={styles.pad}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (width && height && (width !== padSize.width || height !== padSize.height)) {
                  setPadSize({ width, height });
                }
              }}
              {...panResponder.panHandlers}
            >
              <Svg
                ref={svgRef}
                width={padSize.width || undefined}
                height={padSize.height || undefined}
                viewBox={padSize.width ? `0 0 ${padSize.width} ${padSize.height}` : undefined}
                pointerEvents="none"
              >
                {paths.map((p, i) => (
                  <Path
                    key={i}
                    d={p}
                    stroke="#1C252E"
                    strokeWidth={3}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {current !== '' && (
                  <Path
                    d={current}
                    stroke="#1C252E"
                    strokeWidth={3}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </Svg>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity onPress={clear} style={styles.clearBtn}>
              <Icon name="eraser" size={16} color="#FF5630" style={{ marginRight: 6 }} />
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
            <View style={styles.rightBtns}>
              <TouchableOpacity onPress={handleClose} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={save}
                disabled={!hasDrawing}
                style={[styles.saveBtn, { backgroundColor: hasDrawing ? '#22C55E' : '#919EAB33' }]}
              >
                <Icon name="check" size={16} color={hasDrawing ? 'white' : '#919EABCC'} style={{ marginRight: 4 }} />
                <Text style={[styles.saveText, { color: hasDrawing ? 'white' : '#919EABCC' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#1C252E',
  },
  headerTitle: { color: 'white', fontSize: 14, fontWeight: '600' },
  headerSub: { color: 'white', fontSize: 11, marginTop: 2, opacity: 0.85 },
  padWrap: { paddingHorizontal: 16, marginBottom: 16 },
  pad: {
    width: '100%',
    height: 240,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E3E7',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF5630',
  },
  clearBtnText: { color: '#FF5630', fontWeight: '700', fontSize: 13 },
  rightBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#919EAB52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: '#637381', fontWeight: '600', fontSize: 13 },
  saveBtn: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { fontWeight: '600', fontSize: 13 },
});
