import React, { useEffect, useRef, useState } from 'react';
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
  /**
   * The strokes of the mark already saved for this pad, so reopening it can be an EDIT.
   *
   * ⚠️ The caller stores a rendered PNG for the document, which cannot be drawn back into an
   * SVG pad - so without these the pad reopened EMPTY and the rep had to redraw from scratch.
   * The online pad (`AgreementSignatureModal`) keeps its paths in state and has always restored
   * them; this is that behaviour for the offline twin.
   */
  initialPaths?: string[];
  onCapture: (dataUri: string, paths: string[]) => void;
}

export function AgreementSignatureCapture({
  visible,
  title = 'Draw Your Signature',
  onClose,
  initialPaths,
  onCapture,
}: AgreementSignatureCaptureProps) {
  const svgRef = useRef<any>(null);
  const [padSize, setPadSize] = useState({ width: 0, height: 0 });
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const currentRef = useRef('');
  const [agreedToESign, setAgreedToESign] = useState(false);

  /**
   * Opening the pad RESTORES the mark already saved for it, and pre-ticks the consent that mark
   * was saved under.
   *
   * ⚠️ Both halves were missing offline, and together they made an existing mark uneditable:
   * the pad opened blank (the caller only kept a PNG), and the tick was cleared, so the rep had
   * to redraw AND re-agree just to adjust a signature. The online pad has always restored its
   * paths; this is the same flow for the offline twin.
   *
   * ⚠️ A FRESH pad still opens empty and UNTICKED. Consent is per mark - initials and
   * signature are agreed to separately - so it keys off this pad's own saved ink, nothing else.
   *
   * ⚠️ Keyed on `visible` only: re-running while the rep draws would undo a `Clear`.
   */
  useEffect(() => {
    if (!visible) return;
    const existing = initialPaths && initialPaths.length > 0 ? [...initialPaths] : [];
    setPaths(existing);
    setCurrent('');
    currentRef.current = '';
    setAgreedToESign(existing.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
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
        const finished = currentRef.current;
        currentRef.current = '';
        setCurrent('');
        if (finished) {
          setPaths((prev) => [...prev, finished]);
        }
      },
      onPanResponderTerminate: () => {
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
    // The consent belonged to the mark just discarded; what gets drawn next is a new one.
    setAgreedToESign(false);
  };

  const hasDrawing = paths.length > 0 || current !== '';
  // Ink AND consent, the same gate the online pad applies - ticking alone must not enable a
  // blank pad, and drawn ink alone must not save without the agreement.
  const canSave = hasDrawing && agreedToESign;

  const handleClose = () => {
    clear();
    onClose();
  };

  const save = () => {
    if (!canSave) return;
    const ref = svgRef.current;
    if (!ref || typeof ref.toDataURL !== 'function') {
      console.warn('[AgreementSignatureCapture] Svg.toDataURL unavailable');
      handleClose();
      return;
    }
    // Snapshot BEFORE `clear()` - the callback runs async and `paths` would already be empty.
    const saved = [...paths];
    ref.toDataURL((base64: string) => {
      if (base64) onCapture(`data:image/png;base64,${base64}`, saved);
      clear();
      onClose();
    });
  };

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

          {/* Consent sits ABOVE the buttons, and Save stays disabled until it is ticked. */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setAgreedToESign((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreedToESign }}
            style={styles.consentRow}
          >
            <View
              style={[
                styles.consentBox,
                {
                  borderColor: agreedToESign ? '#1C252E' : '#919EAB',
                  backgroundColor: agreedToESign ? '#1C252E' : 'white',
                },
              ]}
            >
              {agreedToESign ? <Icon name="check" size={14} color="white" /> : null}
            </View>
            <Text style={styles.consentText}>I agree to electronic signature</Text>
          </TouchableOpacity>

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
                disabled={!canSave}
                style={[styles.saveBtn, { backgroundColor: canSave ? '#22C55E' : '#919EAB33' }]}
              >
                <Icon name="check" size={16} color={canSave ? 'white' : '#919EABCC'} style={{ marginRight: 4 }} />
                <Text style={[styles.saveText, { color: canSave ? 'white' : '#919EABCC' }]}>Save</Text>
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
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  consentBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  consentText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#1C252E' },
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
