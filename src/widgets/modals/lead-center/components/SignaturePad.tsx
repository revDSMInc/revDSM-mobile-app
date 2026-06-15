import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const SignaturePad = ({
  showSigPad,
  colors,
  closeSigPad,
  panResponder,
  livePaths,
  currentPath,
  clearSig,
  saveSig,
  onPadLayout,
}: any) => {
  if (!showSigPad) return null;
  return (
    <View style={styles.sigOverlay}>
      <View style={styles.sigCard}>
        <View style={[styles.sigHeader, { backgroundColor: colors.primary.main }]}>
          <View>
            <Text style={styles.sigHeaderTitle}>Draw Your Signature</Text>
            <Text style={styles.sigHeaderSub}>Use your finger or stylus to sign below.</Text>
          </View>
          <TouchableOpacity onPress={closeSigPad}>
            <Icon name="close" size={20} color="white" />
          </TouchableOpacity>
        </View>
        <View style={styles.sigPadWrap}>
          <View
            style={styles.sigPad}
            {...panResponder.panHandlers}
            onStartShouldSetResponder={() => true}
            onLayout={onPadLayout}
          >
            <Svg width="100%" height="100%" pointerEvents="none">
              {livePaths.map((p: any, i: number) => (
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
              {currentPath !== '' && (
                <Path
                  d={currentPath}
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
        <View style={styles.sigActions}>
          <TouchableOpacity onPress={clearSig} style={styles.clearBtn}>
            <Icon name="eraser" size={16} color="#FF5630" style={{ marginRight: 6 }} />
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
          <View style={styles.sigRightBtns}>
            <TouchableOpacity onPress={closeSigPad} style={styles.sigCancelBtn}>
              <Text style={styles.sigCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={saveSig}
              style={[
                styles.sigSaveBtn,
                { backgroundColor: livePaths.length > 0 ? colors.primary.main : '#919EAB33' },
              ]}
            >
              <Icon
                name="check"
                size={16}
                color={livePaths.length > 0 ? 'white' : '#919EABCC'}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  styles.sigSaveText,
                  { color: livePaths.length > 0 ? 'white' : '#919EABCC' },
                ]}
              >
                Save Signature
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  sigOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 16,
    zIndex: 999,
  },
  sigCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 20,
  },
  sigHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    marginBottom: 12,
  },
  sigHeaderTitle: { color: 'white', fontSize: 14, fontWeight: '600' },
  sigHeaderSub: { color: 'white', fontSize: 11, marginTop: 2, opacity: 0.85 },
  sigPadWrap: { paddingHorizontal: 16, marginBottom: 16 },
  sigPad: {
    width: '100%',
    height: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E3E7',
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  sigActions: {
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
  sigRightBtns: { flexDirection: 'row', gap: 10 },
  sigCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#919EAB52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sigCancelText: { color: '#637381', fontWeight: '600', fontSize: 13 },
  sigSaveBtn: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sigSaveText: { fontWeight: '600', fontSize: 13 },
});
