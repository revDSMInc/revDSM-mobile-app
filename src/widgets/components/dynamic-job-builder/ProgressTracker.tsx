import React, { useEffect, useRef, useState } from 'react';
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
  disableNavigation?: boolean;
}

const CIRCLE = 40;
const STEP_WIDTH = 54; // just wider than the circle so labels have room, gaps stay tight
const CONNECTOR_WIDTH = 12; // short connector line between two steps
const CONNECTOR_TOP = CIRCLE / 2 - 1;
const PADDING_LEFT = 8; // must match contentContainerStyle.paddingHorizontal
const stepOffset = (i: number) => PADDING_LEFT + i * (STEP_WIDTH + CONNECTOR_WIDTH);

export function ProgressTracker({ steps = [], activeStepId, onStepPress, disableNavigation }: ProgressTrackerProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const activeIndex = steps.findIndex((s) => s.id === activeStepId || s.active);
  useEffect(() => {
    if (activeIndex < 0 || viewportWidth <= 0) return;
    const target = stepOffset(activeIndex) + STEP_WIDTH / 2 - viewportWidth / 2;
    scrollRef.current?.scrollTo({ x: Math.max(0, target), animated: true });
  }, [activeIndex, viewportWidth]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: 2, paddingBottom: 2, paddingHorizontal: PADDING_LEFT }}
      keyboardShouldPersistTaps="handled"
      onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId || step.active;

          const bgColor = isActive
            ? '#0EA5E9'
            : step.complete
              ? '#10b981'
              : step.locked
                ? '#F1F5F9'
                : 'white';

          const borderColor = isActive
            ? '#0EA5E9'
            : step.complete
              ? '#10b981'
              : step.locked
                ? '#CBD5E1'
                : '#e2e8f0';

          const labelColor = isActive
            ? '#0EA5E9'
            : step.complete
              ? '#10b981'
              : step.locked
                ? '#94a3b8'
                : '#94a3b8';

          const handlePress = () => {
            if (disableNavigation) return;
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
                disabled={disableNavigation}
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
                    <Icon name="lock" size={16} color="#94a3b8" />
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
