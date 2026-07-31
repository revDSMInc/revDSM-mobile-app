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
  // Web parity: web's stepper is DISPLAY-ONLY — tapping a step never navigates; the
  // footer Next (gated on `canProceed`) is the only way forward. When true the steps
  // are non-interactive, so the rep advances only via the bottom Next button.
  disableNavigation?: boolean;
}

// The stepper scrolls horizontally when the steps don't fit and AUTO-SCROLLS to keep
// the active step centred (so jumping to the Summary reveals the last step instead of
// staying pinned at step 1). Steps and connectors use FIXED widths so the gap is small
// and consistent (the previous `flex: 1` connectors stretched into long lines). Fixed
// dp keeps the layout identical on Android and iOS.
const CIRCLE = 40;
const STEP_WIDTH = 54; // just wider than the circle so labels have room, gaps stay tight
const CONNECTOR_WIDTH = 12; // short connector line between two steps
// Connector aligns with the circle centre (CIRCLE / 2), minus half the line height.
const CONNECTOR_TOP = CIRCLE / 2 - 1;
const PADDING_LEFT = 8; // must match contentContainerStyle.paddingHorizontal
// Left edge of step `i`: paddingLeft + i steps + i connectors before it.
const stepOffset = (i: number) => PADDING_LEFT + i * (STEP_WIDTH + CONNECTOR_WIDTH);

export function ProgressTracker({ steps = [], activeStepId, onStepPress, disableNavigation }: ProgressTrackerProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  // Auto-scroll the strip so the ACTIVE step is centred (or as close as the content
  // allows — scrollTo clamps). Fires whenever the active step changes, e.g. after
  // "Skip to Summary" jumps to the last step: the strip follows to reveal it instead
  // of staying pinned at step 1. `scrollTo` clamps out-of-range x, so the first/last
  // steps settle flush at each end.
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
