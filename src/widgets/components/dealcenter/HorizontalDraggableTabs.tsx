import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  PanResponder,
  Animated,
  StyleSheet,
  ScrollView,
  Dimensions,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

interface HorizontalDraggableTabsProps {
  calculators: any[];
  activeIdx: number;
  setActiveIdx: (idx: number) => void;
  onReorder: (newOrder: any[], newActiveIdx: number) => void;
  setMenuVisible: (idx: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  tabsScrollViewRef?: React.RefObject<ScrollView | null>;
  scrollXRef?: React.MutableRefObject<number>;
  /**
   * Optional override for the "identical calculator" warning. The default
   * detection compares gutter/leaf-filter input keys, which don't exist on the
   * schema-driven Dynamic Deal Center tabs (so every tab would falsely read as a
   * duplicate). Dynamic callers pass `() => false` to opt out.
   */
  getIsDuplicate?: (calc: any, idx: number) => boolean;
  /**
   * Tapping a full-package tab's ⓘ. A calculator flagged `isFullPackage` shows a
   * package icon + this button INSTEAD of its derived `G+VMax+S+FWrap` name, and the
   * caller owns the popover that lists what the package contains.
   *
   * Omitted by the classic deal center, which never sets `isFullPackage`, so its tabs
   * are untouched.
   */
  onShowPackageInfo?: (calc: any, idx: number) => void;
}

const isCalculatorIdentical = (c1: any, c2: any) => {
  if (!c1 || !c2) return false;
  const inputs1 = c1.inputs || {};
  const inputs2 = c2.inputs || {};
  const compareInputKeys = [
    'gutter5DsE', 'gutter6Ft1', 'gutter7DsE', 'miters', 'endCaps', 'spoutSavers',
    'versaMaxFt1', 'versa6Ft1', 'versa7Ft1', 'filter45Ft1',
    'versa6Ft2', 'versa7Ft2', 'filter45Ft2', 'versa6Ft3', 'versa7Ft3', 'filter45Ft3',
    'ckToInstallers', 'extraLabor', 'paymentPlan', 'markup', 'discountPercentage'
  ];
  for (const key of compareInputKeys) {
    const val1 = inputs1[key] === undefined || inputs1[key] === null ? '' : String(inputs1[key]).trim();
    const val2 = inputs2[key] === undefined || inputs2[key] === null ? '' : String(inputs2[key]).trim();
    if (val1 !== val2) return false;
  }
  const extras1 = c1.extras || {};
  const extras2 = c2.extras || {};
  const extraKeys = new Set([...Object.keys(extras1), ...Object.keys(extras2)]);
  const ignoreKeys = ['_id', 'id', 'createdAt', 'updatedAt'];
  for (const key of extraKeys) {
    if (ignoreKeys.includes(key)) continue;
    const val1 = extras1[key] === undefined || extras1[key] === null ? '' : String(extras1[key]).trim();
    const val2 = extras2[key] === undefined || extras2[key] === null ? '' : String(extras2[key]).trim();
    if (val1 !== val2) return false;
  }
  return true;
};

export const HorizontalDraggableTabs: React.FC<HorizontalDraggableTabsProps> = ({
  calculators,
  activeIdx,
  setActiveIdx,
  onReorder,
  setMenuVisible,
  onDragStateChange,
  tabsScrollViewRef,
  scrollXRef,
  getIsDuplicate,
  onShowPackageInfo,
}) => {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  // Track layouts of all tabs
  const layouts = useRef<{ x: number; width: number }[]>([]);

  // Array of Animated.Values to shift other tabs smoothly
  const shiftAnims = useRef<Animated.Value[]>([]);

  // Initialize or update shift animations when calculators length changes
  if (shiftAnims.current.length !== calculators.length) {
    shiftAnims.current = calculators.map(() => new Animated.Value(0));
  }

  const longPressTimer = useRef<any>(null);
  const isDraggingActiveRef = useRef<boolean>(false);
  const autoScrollTimer = useRef<any>(null);
  const initialScrollX = useRef<number>(0);

  const startAutoScroll = (speed: number) => {
    if (autoScrollTimer.current) {
      if (autoScrollTimer.current.speed === speed) return;
      clearInterval(autoScrollTimer.current.timer);
    }

    const timer = setInterval(() => {
      if (tabsScrollViewRef?.current && scrollXRef) {
        const nextX = Math.max(0, scrollXRef.current + speed);
        scrollXRef.current = nextX;
        tabsScrollViewRef.current.scrollTo({ x: nextX, animated: false });
      }
    }, 16);

    autoScrollTimer.current = { timer, speed };
  };

  const stopAutoScroll = () => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current.timer);
      autoScrollTimer.current = null;
    }
  };

  const hasPanResponderCapturedRef = useRef<boolean>(false);

  // A horizontal ScrollView must measure its child by its intrinsic content
  // width. Keep the selected tab in view after a programmatic tab change (for
  // example, selecting it from the grid), rather than relying on a guessed
  // fixed tab width in each screen.
  useEffect(() => {
    const layout = layouts.current[activeIdx];
    if (!layout || !tabsScrollViewRef?.current) return;

    const frame = requestAnimationFrame(() => {
      tabsScrollViewRef.current?.scrollTo({
        x: Math.max(0, layout.x - 8),
        animated: true,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIdx, calculators.length, tabsScrollViewRef]);

  const getTabPanResponder = (index: number) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => {
        return isDraggingActiveRef.current;
      },
      onMoveShouldSetPanResponderCapture: () => {
        return isDraggingActiveRef.current;
      },
      onPanResponderGrant: () => {
        hasPanResponderCapturedRef.current = true;
      },
      onPanResponderMove: (_, gestureState) => {
        if (!isDraggingActiveRef.current) {
          return;
        }

        panX.setValue(gestureState.dx);
        panY.setValue(gestureState.dy);

        // Auto-scroll logic near horizontal edges
        const screenWidth = Dimensions.get('window').width;
        const leftThreshold = 60;
        const rightThreshold = screenWidth - 100;

        if (gestureState.moveX < leftThreshold) {
          startAutoScroll(-8);
        } else if (gestureState.moveX > rightThreshold) {
          startAutoScroll(8);
        } else {
          stopAutoScroll();
        }

        const draggedLayout = layouts.current[index];
        if (draggedLayout) {
          const scrollDelta = scrollXRef ? (scrollXRef.current - initialScrollX.current) : 0;
          const currentCenterX = draggedLayout.x + draggedLayout.width / 2 + gestureState.dx + scrollDelta;

          // Find closest target index
          let targetIdx = index;
          let minDistance = Infinity;
          for (let i = 0; i < calculators.length; i++) {
            const layout = layouts.current[i];
            if (layout) {
              const layoutCenterX = layout.x + layout.width / 2;
              const dist = Math.abs(currentCenterX - layoutCenterX);
              if (dist < minDistance) {
                minDistance = dist;
                targetIdx = i;
              }
            }
          }

          // Shifting tabs:
          for (let i = 0; i < calculators.length; i++) {
            if (i === index) continue;
            const layout = layouts.current[i];
            if (layout) {
              if (index < targetIdx) {
                // Dragging right
                if (i > index && i <= targetIdx) {
                  shiftAnims.current[i].setValue(-(draggedLayout.width + 8));
                } else {
                  shiftAnims.current[i].setValue(0);
                }
              } else if (index > targetIdx) {
                // Dragging left
                if (i >= targetIdx && i < index) {
                  shiftAnims.current[i].setValue(draggedLayout.width + 8);
                } else {
                  shiftAnims.current[i].setValue(0);
                }
              } else {
                shiftAnims.current[i].setValue(0);
              }
            }
          }

        }
      },
      onPanResponderTerminationRequest: () => !isDraggingActiveRef.current,
      onPanResponderRelease: (_, gestureState) => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }

        tabsScrollViewRef?.current?.setNativeProps({ scrollEnabled: true });

        isDraggingActiveRef.current = false;
        stopAutoScroll();
        const draggedLayout = layouts.current[index];
        let targetIdx = index;

        if (draggedLayout) {
          const scrollDelta = scrollXRef ? (scrollXRef.current - initialScrollX.current) : 0;
          const currentCenterX = draggedLayout.x + draggedLayout.width / 2 + gestureState.dx + scrollDelta;

          let minDistance = Infinity;
          for (let i = 0; i < calculators.length; i++) {
            const layout = layouts.current[i];
            if (layout) {
              const layoutCenterX = layout.x + layout.width / 2;
              const dist = Math.abs(currentCenterX - layoutCenterX);
              if (dist < minDistance) {
                minDistance = dist;
                targetIdx = i;
              }
            }
          }
        }

        if (targetIdx !== index && draggedLayout && layouts.current[targetIdx]) {
          const updated = [...calculators];
          const [removed] = updated.splice(index, 1);
          updated.splice(targetIdx, 0, removed);

          const activeCalc = calculators[activeIdx];
          const newActiveIdx = updated.indexOf(activeCalc);

          setDraggingIdx(null);
          onDragStateChange?.(false);
          panX.setValue(0);
          panY.setValue(0);
          shiftAnims.current.forEach(anim => anim.setValue(0));

          onReorder(updated, newActiveIdx >= 0 ? newActiveIdx : 0);
        } else {
          Animated.parallel([
            Animated.spring(panX, { toValue: 0, useNativeDriver: true, tension: 110, friction: 12 }),
            Animated.spring(panY, { toValue: 0, useNativeDriver: true, tension: 110, friction: 12 }),
            ...shiftAnims.current.map(anim =>
              Animated.spring(anim, { toValue: 0, useNativeDriver: true, tension: 110, friction: 12 })
            ),
          ]).start(() => {
            setDraggingIdx(null);
            onDragStateChange?.(false);
          });
        }
      },
      onPanResponderTerminate: () => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        tabsScrollViewRef?.current?.setNativeProps({ scrollEnabled: true });
        isDraggingActiveRef.current = false;
        stopAutoScroll();
        Animated.parallel([
          Animated.spring(panX, { toValue: 0, useNativeDriver: true }),
          Animated.spring(panY, { toValue: 0, useNativeDriver: true }),
          ...shiftAnims.current.map(anim =>
            Animated.spring(anim, { toValue: 0, useNativeDriver: true })
          ),
        ]).start(() => {
          setDraggingIdx(null);
          onDragStateChange?.(false);
        });
      },
    });
  };

  return (
    <View style={styles.container}>
      {calculators.map((calc, idx) => {
        const isDuplicate = getIsDuplicate
          ? getIsDuplicate(calc, idx)
          : calculators.some((otherCalc, otherIdx) => {
            if (idx === otherIdx) return false;
            return isCalculatorIdentical(calc, otherCalc);
          });
        const isWarning = (calc.name?.startsWith('⚠️') && calc.name?.endsWith('⚠️')) || isDuplicate;
        const isActive = idx === activeIdx;
        const isCurrentlyDragging = idx === draggingIdx;

        let animatedStyle = {};

        if (isCurrentlyDragging) {
          animatedStyle = {
            transform: [{ translateX: panX }, { translateY: panY }, { scale: 1.05 }],
            zIndex: 999,
            opacity: 0.9,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 12,
          };
        } else {
          animatedStyle = {
            transform: [{ translateX: shiftAnims.current[idx] || 0 }],
            zIndex: 1,
          };
        }

        return (
          <Animated.View
            key={`${calc._id || calc.name || `tab-key-${idx}`}-${draggingIdx !== null ? 'dragging' : 'idle'}`}
            onLayout={(event) => {
              layouts.current[idx] = event.nativeEvent.layout;
            }}
            {...getTabPanResponder(idx).panHandlers}
            style={[
              styles.tabWrapper,
              animatedStyle as any,
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.9}
              onPressIn={() => {
                hasPanResponderCapturedRef.current = false;
              }}
              onLongPress={() => {
                isDraggingActiveRef.current = true;
                initialScrollX.current = scrollXRef ? scrollXRef.current : 0;
                setDraggingIdx(idx);
                onDragStateChange?.(true);
              }}
              delayLongPress={500}
              onPressOut={() => {
                if (!hasPanResponderCapturedRef.current && isDraggingActiveRef.current) {
                  isDraggingActiveRef.current = false;
                  setDraggingIdx(null);
                  onDragStateChange?.(false);
                }
              }}
              onPress={() => {
                if (!isDraggingActiveRef.current) {
                  setActiveIdx(idx);
                }
              }}
              style={[
                styles.tab,
                isActive
                  ? isWarning
                    ? styles.activeWarningTab
                    : styles.activeTab
                  : styles.inactiveTab,
                isCurrentlyDragging && styles.draggingTab,
              ]}
            >
              {isDuplicate && (
                <Ionicons
                  name="warning"
                  size={12}
                  color={isActive ? '#FFFFFF' : '#FF990F'}
                  style={{ marginRight: 6 }}
                />
              )}
              {calc.isFullPackage ? (
                /* A full package replaces the derived name outright: the four-part
                   `G+VMax+S+FWrap` string is what the package icon stands for, so
                   rendering both would just be the same fact twice. The ⓘ carries the
                   breakdown the letters used to spell out.

                   ⓘ sits INSIDE the pill rather than floating above it as in the mock:
                   this row is a horizontal ScrollView with drag-reorder, and Android
                   clips children drawn outside their parent's bounds, so an overhanging
                   badge is a coin-flip on whether it renders at all. */
                <View style={styles.packageRow}>
                  <Ionicons
                    name="cube"
                    size={18}
                    color={isCurrentlyDragging ? '#22C55E' : isActive ? '#FFFFFF' : '#94A3B8'}
                  />
                  <TouchableOpacity
                    onPress={() => onShowPackageInfo?.(calc, idx)}
                    style={styles.infoButton}
                    hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="What the full package includes"
                  >
                    <Ionicons
                      name="information-circle"
                      size={18}
                      color={isCurrentlyDragging ? '#22C55E' : isActive ? '#FFFFFF' : '#00B8D9'}
                    />
                  </TouchableOpacity>
                </View>
              ) : (
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[
                    styles.tabText,
                    isActive ? styles.activeTabText : styles.inactiveTabText,
                    isCurrentlyDragging && styles.draggingTabText,
                  ]}
                >
                  {calc.name === '.' ? '' : calc.name || ''}
                </Text>
              )}
              <TouchableOpacity
                onPress={() => setMenuVisible(idx)}
                style={styles.menuButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name="ellipsis-vertical"
                  size={14}
                  color={isCurrentlyDragging ? '#22C55E' : isActive ? '#FFFFFF' : '#637381'}
                />
              </TouchableOpacity>
            </TouchableOpacity>
          </Animated.View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    flexGrow: 0,
    flexShrink: 0,
  },
  tabWrapper: {
    marginRight: 8,
    flexShrink: 0,
  },
  tab: {
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  activeTab: {
    backgroundColor: '#22C55E', // green-500
    borderColor: '#22C55E',
  },
  activeWarningTab: {
    backgroundColor: '#F59E0B', // amber-500
    borderColor: '#F59E0B',
  },
  inactiveTab: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  draggingTab: {
    borderColor: '#22C55E',
    backgroundColor: '#F0FDF4', // Very light green backdrop on dragging
  },
  tabText: {
    fontSize: 10,
    fontWeight: '900',
    maxWidth: 199,
    flexShrink: 1,
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  inactiveTabText: {
    color: '#637381',
  },
  draggingTabText: {
    color: '#22C55E',
  },
  dragHandle: {
    flexDirection: 'row',
    gap: 2,
    marginRight: 8,
    opacity: 0.6,
  },
  dragHandleCol: {
    gap: 2,
  },
  dragHandleDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  menuButton: {
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  packageRow: { flexDirection: 'row', alignItems: 'center' },
  infoButton: { marginLeft: 6, alignItems: 'center', justifyContent: 'center' },
});
