import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  PanResponder,
  Animated,
  StyleSheet,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

interface HorizontalDraggableTabsProps {
  calculators: any[];
  activeIdx: number;
  setActiveIdx: (idx: number) => void;
  onReorder: (newOrder: any[], newActiveIdx: number) => void;
  setMenuVisible: (idx: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

export const HorizontalDraggableTabs: React.FC<HorizontalDraggableTabsProps> = ({
  calculators,
  activeIdx,
  setActiveIdx,
  onReorder,
  setMenuVisible,
  onDragStateChange,
}) => {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  // We keep a temporary drop-animating state to run the smooth slide animation after release
  const [dropAnimatingIdx, setDropAnimatingIdx] = useState<number | null>(null);

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

  // Active calculator tracking
  const activeCalcId = calculators[activeIdx]?._id;

  const getTabPanResponder = (index: number) => {
    let hasMoved = false;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 12 || Math.abs(gestureState.dy) > 12;
      },
      onPanResponderGrant: () => {
        setDraggingIdx(index);
        setDropAnimatingIdx(null);
        panX.setValue(0);
        panY.setValue(0);
        hasMoved = false;
        onDragStateChange?.(true);
        // Reset all shifts
        shiftAnims.current.forEach(anim => anim.setValue(0));
      },
      onPanResponderMove: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5) {
          hasMoved = true;
        }
        panX.setValue(gestureState.dx);
        panY.setValue(gestureState.dy);

        const draggedLayout = layouts.current[index];
        if (!draggedLayout) return;

        const gap = 8;
        const shiftDistance = draggedLayout.width + gap;

        // Shift neighboring tabs dynamically
        calculators.forEach((_, i) => {
          if (i === index) return;

          const currentLayout = layouts.current[i];
          if (!currentLayout) return;

          let toValue = 0;

          if (i > index) {
            const midpoint = currentLayout.x + currentLayout.width / 2;
            const draggedRightEdge = draggedLayout.x + draggedLayout.width + gestureState.dx;
            if (draggedRightEdge > midpoint) {
              toValue = -shiftDistance;
            }
          } else {
            const midpoint = currentLayout.x + currentLayout.width / 2;
            const draggedLeftEdge = draggedLayout.x + gestureState.dx;
            if (draggedLeftEdge < midpoint) {
              toValue = shiftDistance;
            }
          }

          Animated.spring(shiftAnims.current[i], {
            toValue,
            useNativeDriver: true,
            tension: 100,
            friction: 12,
          }).start();
        });
      },
      onPanResponderRelease: (_, gestureState) => {
        if (!hasMoved) {
          // Normal Tap
          setActiveIdx(index);
          setDraggingIdx(null);
          onDragStateChange?.(false);
        } else {
          const draggedLayout = layouts.current[index];
          let targetIdx = index;

          if (draggedLayout) {
            const currentCenterX = draggedLayout.x + draggedLayout.width / 2 + gestureState.dx;
            
            // Find target index
            for (let i = 0; i < calculators.length; i++) {
              if (i === index) continue;
              const layout = layouts.current[i];
              if (layout) {
                const layoutCenterX = layout.x + layout.width / 2;
                if (i < index && currentCenterX < layoutCenterX) {
                  targetIdx = i;
                  break;
                } else if (i > index && currentCenterX > layoutCenterX) {
                  targetIdx = i;
                }
              }
            }
          }

          if (targetIdx !== index && draggedLayout && layouts.current[targetIdx]) {
            // Reorder array
            const updated = [...calculators];
            const [removed] = updated.splice(index, 1);
            updated.splice(targetIdx, 0, removed);

            // Compute correct offset to prevent visual jumping
            const oldX = draggedLayout.x;
            const newX = layouts.current[targetIdx].x;
            const diffX = oldX - newX;

            // Set the animation starting values relative to the new layout position
            panX.setValue(gestureState.dx + diffX);
            panY.setValue(gestureState.dy);

            // Lock drop animating state to run slide animation
            setDropAnimatingIdx(targetIdx);
            setDraggingIdx(null);
            onDragStateChange?.(false);

            // Apply state updates by finding the active calculator's new index by reference
            const activeCalc = calculators[activeIdx];
            const newActiveIdx = updated.indexOf(activeCalc);
            onReorder(updated, newActiveIdx >= 0 ? newActiveIdx : 0);

            // Animate tab into new slot smoothly
            Animated.parallel([
              Animated.spring(panX, {
                toValue: 0,
                useNativeDriver: true,
                tension: 110,
                friction: 12,
              }),
              Animated.spring(panY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 110,
                friction: 12,
              }),
              ...shiftAnims.current.map(anim =>
                Animated.spring(anim, {
                  toValue: 0,
                  useNativeDriver: true,
                  tension: 110,
                  friction: 12,
                })
              ),
            ]).start(() => {
              setDropAnimatingIdx(null);
            });
          } else {
            // Dragged back to original position
            setDraggingIdx(null);
            onDragStateChange?.(false);
            Animated.parallel([
              Animated.spring(panX, {
                toValue: 0,
                useNativeDriver: true,
                tension: 110,
                friction: 12,
              }),
              Animated.spring(panY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 110,
                friction: 12,
              }),
              ...shiftAnims.current.map(anim =>
                Animated.spring(anim, {
                  toValue: 0,
                  useNativeDriver: true,
                  tension: 110,
                  friction: 12,
                })
              ),
            ]).start();
          }
        }
      },
      onPanResponderTerminate: () => {
        setDraggingIdx(null);
        setDropAnimatingIdx(null);
        onDragStateChange?.(false);
        Animated.parallel([
          Animated.spring(panX, {
            toValue: 0,
            useNativeDriver: true,
          }),
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
          }),
          ...shiftAnims.current.map(anim =>
            Animated.spring(anim, {
              toValue: 0,
              useNativeDriver: true,
            })
          ),
        ]).start();
      },
    });
  };

  return (
    <View style={styles.container}>
      {calculators.map((calc, idx) => {
        const isWarning = calc.name?.startsWith('⚠️') && calc.name?.endsWith('⚠️');
        const isActive = idx === activeIdx;
        const isCurrentlyDragging = idx === draggingIdx;
        const isDropAnimating = idx === dropAnimatingIdx;

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
        } else if (isDropAnimating) {
          animatedStyle = {
            transform: [{ translateX: panX }, { translateY: panY }],
            zIndex: 999,
          };
        } else {
          animatedStyle = {
            transform: [{ translateX: shiftAnims.current[idx] || 0 }],
            zIndex: 1,
          };
        }

        const dragHandleColor = isActive ? '#FFFFFF' : '#637381';

        return (
          <Animated.View
            key={calc._id || calc.name || `tab-key-${idx}`}
            onLayout={(event) => {
              layouts.current[idx] = event.nativeEvent.layout;
            }}
            {...getTabPanResponder(idx).panHandlers}
            style={[
              styles.tabWrapper,
              animatedStyle as any,
            ]}
          >
            <View
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
              {/* Drag Handle Grid */}
              <View style={styles.dragHandle}>
                <View style={styles.dragHandleCol}>
                  <View style={[styles.dragHandleDot, { backgroundColor: dragHandleColor }]} />
                  <View style={[styles.dragHandleDot, { backgroundColor: dragHandleColor }]} />
                  <View style={[styles.dragHandleDot, { backgroundColor: dragHandleColor }]} />
                  <View style={[styles.dragHandleDot, { backgroundColor: dragHandleColor }]} />
                </View>
                <View style={styles.dragHandleCol}>
                  <View style={[styles.dragHandleDot, { backgroundColor: dragHandleColor }]} />
                  <View style={[styles.dragHandleDot, { backgroundColor: dragHandleColor }]} />
                  <View style={[styles.dragHandleDot, { backgroundColor: dragHandleColor }]} />
                  <View style={[styles.dragHandleDot, { backgroundColor: dragHandleColor }]} />
                </View>
              </View>

              <Text
                style={[
                  styles.tabText,
                  isActive ? styles.activeTabText : styles.inactiveTabText,
                ]}
              >
                {calc.name === '.' ? '' : calc.name || `Rollout ${idx + 1}`}
              </Text>
              <TouchableOpacity
                onPress={() => setMenuVisible(idx)}
                style={styles.menuButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name="ellipsis-vertical"
                  size={14}
                  color={isActive ? '#FFFFFF' : '#637381'}
                />
              </TouchableOpacity>
            </View>
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
  },
  tabWrapper: {
    marginRight: 8,
  },
  tab: {
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  inactiveTabText: {
    color: '#637381',
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
});
