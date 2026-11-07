import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

/** The red Delete revealed by swiping a payment-plan row left. Shared by the drop and opt-in popups. */
export function SwipeDeleteAction({ drag, onDelete }: { drag: any; onDelete: () => void }) {
  const styleAnimation = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value + 80 }],
  }));
  return (
    <View style={{ width: 80, marginLeft: 8, marginBottom: 12 }}>
      <Animated.View style={styleAnimation}>
        <TouchableOpacity
          onPress={onDelete}
          style={{ backgroundColor: '#FF5630', height: '100%', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}
