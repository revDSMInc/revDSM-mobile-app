import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface MapToggleSwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  activeLabel: string;
  inactiveLabel: string;
  activeColor?: string;
  activeDotColor?: string;
  activeLabelColor?: string;
}

const DEFAULT_ACTIVE_COLOR = '#4CBB17';
const DEFAULT_ACTIVE_DOT_COLOR = '#4ade80';
const DEFAULT_ACTIVE_LABEL_COLOR = 'white';

export const MapToggleSwitch = ({
  value,
  onValueChange,
  activeLabel,
  inactiveLabel,
  activeColor = DEFAULT_ACTIVE_COLOR,
  activeDotColor = DEFAULT_ACTIVE_DOT_COLOR,
  activeLabelColor = DEFAULT_ACTIVE_LABEL_COLOR,
}: MapToggleSwitchProps) => {
  const animatedValue = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(animatedValue, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,
      friction: 8,
      tension: 40,
    }).start();
  }, [value]);

  const translateY = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 42], // Adjusted for vertical toggle
  });

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(245, 245, 245, 0.8)', activeColor],
  });

  const trackBorderColor = `${activeColor}33`;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => onValueChange(!value)}
        style={[styles.toggleContainer, { borderColor: trackBorderColor }]}
      >
        <Animated.View style={[styles.background, { backgroundColor }]}>
          <View style={styles.labelsContainer}>
            {!value && (
              inactiveLabel === 'star' ? (
                <Icon name="star" size={13} color="#FFA500" style={styles.iconInactive} />
              ) : (
                <Text style={styles.labelInactive}>{inactiveLabel}</Text>
              )
            )}
            {value && <Text style={[styles.labelActive, { color: activeLabelColor }]}>{activeLabel}</Text>}
          </View>

          <Animated.View style={[styles.circle, { transform: [{ translateY }] }]}>
            <View
              style={[styles.innerCircle, { backgroundColor: value ? activeDotColor : '#cbd5e1' }]}
            />
          </Animated.View>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 5,
  },
  toggleContainer: {
    width: 32,
    height: 70,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  background: {
    flex: 1,
    position: 'relative',
  },
  labelsContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  labelActive: {
    fontSize: 9,
    fontWeight: '900',
    position: 'absolute',
    top: 10,
  },
  labelInactive: {
    fontSize: 9,
    fontWeight: '900',
    color: '#64748b',
    position: 'absolute',
    bottom: 10,
  },
  iconInactive: {
    position: 'absolute',
    bottom: 8,
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'white',
    position: 'absolute',
    left: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 2,
  },
  innerCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
});
