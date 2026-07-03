import React from 'react';
import { View, Text } from 'react-native';

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
}

export function ProgressTracker({ steps = [], activeStepId }: ProgressTrackerProps) {
  return (
    <View className="flex-row px-4 py-3 gap-1">
      {steps.map((step, index) => {
        const isActive = step.id === activeStepId;
        const color = step.complete ? '#22c55e' : isActive ? '#3b82f6' : step.locked ? '#999' : '#ddd';

        return (
          <React.Fragment key={step.id}>
            <View className="items-center flex-1">
              <View
                className="w-7 h-7 rounded-full items-center justify-center mb-1"
                style={{ backgroundColor: color }}
              >
                {step.locked ? (
                  <Text className="text-white text-[10px]">🔒</Text>
                ) : step.complete ? (
                  <Text className="text-white text-[11px] font-bold">✓</Text>
                ) : (
                  <Text className="text-white text-[11px] font-bold">{index + 1}</Text>
                )}
              </View>
              <Text
                className="text-[9px] text-center"
                style={{
                  color: isActive ? '#3b82f6' : step.complete ? '#22c55e' : '#999',
                  fontWeight: isActive ? '700' : '400',
                }}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
            {index < steps.length - 1 && (
              <View
                className="h-0.5 flex-1 mt-3.5"
                style={{ backgroundColor: step.complete ? '#22c55e' : '#e5e5ea' }}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}
