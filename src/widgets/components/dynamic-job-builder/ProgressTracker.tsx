import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
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

// The stepper always starts at step 1 and scrolls horizontally when the steps don't
// fit (no auto-scroll to the active step — web parity: the browser stepper stays at
// the start). Steps and connectors use FIXED widths so the gap between them is small
// and consistent (the previous `flex: 1` connectors stretched into long lines). Fixed
// dp keeps the layout identical on Android and iOS.
const CIRCLE = 40;
const STEP_WIDTH = 54; // just wider than the circle so labels have room, gaps stay tight
const CONNECTOR_WIDTH = 12; // short connector line between two steps
// Connector aligns with the circle centre (CIRCLE / 2), minus half the line height.
const CONNECTOR_TOP = CIRCLE / 2 - 1;

export function ProgressTracker({ steps = [], activeStepId, onStepPress }: ProgressTrackerProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: 4, paddingBottom: 8, paddingHorizontal: 8 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
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
              {index > 0 && (
                <View
                  style={{
                    height: 2,
                    width: CONNECTOR_WIDTH,
                    marginTop: CONNECTOR_TOP,
                    backgroundColor: step.complete ? '#10b981' : '#e2e8f0',
                  }}
                />
              )}
              <Pressable
                onPress={handlePress}
                className="items-center"
                style={{ width: STEP_WIDTH, flexShrink: 0 }}
              >
                <View
                  style={{
                    width: CIRCLE,
                    height: CIRCLE,
                    borderRadius: CIRCLE / 2,
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
                    letterSpacing: -0.2,
                    lineHeight: 10,
                    textAlign: 'center',
                    color: labelColor,
                    width: STEP_WIDTH - 2,
                  }}
                  numberOfLines={2}
                >
                  {step.label}
                </Text>
              </Pressable>
            </React.Fragment>
          );
        })}
      </View>
    </ScrollView>
  );
}
