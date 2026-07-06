import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface ProgressTrackerStep {
  id: string;
  label: string;
  complete?: boolean;
  active?: boolean;
  locked?: boolean;
}

interface ProgressTrackerProps {
  steps?: ProgressTrackerStep[];
  activeStepId?: string;
  onStepPress?: (index: number) => void;
}

export function ProgressTracker({ steps = [], activeStepId, onStepPress }: ProgressTrackerProps) {
  return (
    <View className="flex-row px-4 pt-1 pb-2 gap-1">
      {steps.map((step, index) => {
        const isActive = step.id === activeStepId || step.active;

        const bgColor = isActive
          ? '#0EA5E9'
          : step.complete
            ? '#10b981'
            : step.locked
              ? '#FAD9D3'
              : 'white';

        const borderColor = isActive
          ? '#0EA5E9'
          : step.complete
            ? '#10b981'
            : step.locked
              ? '#FE6644'
              : '#e2e8f0';

        const labelColor = isActive
          ? '#0EA5E9'
          : step.complete
            ? '#10b981'
            : step.locked
              ? '#FE6644'
              : '#94a3b8';

        const handlePress = () => {
          if (step.locked) return;
          if (isActive) return;
          onStepPress?.(index);
        };

        return (
          <React.Fragment key={step.id}>
            <Pressable
              onPress={handlePress}
              className="items-center"
              style={{ flex: 1 }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 4,
                  borderWidth: 2,
                  backgroundColor: bgColor,
                  borderColor: borderColor,
                }}
              >
                {step.locked ? (
                  <Icon name="lock" size={16} color="#FE6644" />
                ) : step.complete ? (
                  <Icon name="check" size={18} color="white" />
                ) : (
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '900',
                      color: isActive ? 'white' : '#94a3b8',
                    }}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                style={{
                  fontSize: 8,
                  fontWeight: '900',
                  letterSpacing: -0.3,
                  color: labelColor,
                }}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </Pressable>
            {index < steps.length - 1 && (
              <View
                style={{
                  height: 2,
                  flex: 1,
                  alignSelf: 'center',
                  marginBottom: 16,
                  backgroundColor: step.complete ? '#10b981' : '#e2e8f0',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}
