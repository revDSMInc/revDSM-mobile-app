import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../../theme/ThemeProvider';
import {
  applyNumPadKey,
  numPadMetrics,
  NUMPAD_GAP,
  panShiftFor,
  type NumPadKey,
  type NumPadMode,
} from '../../../../utils/numpad';

export interface NumPadTarget {
  getValue: () => string;
  setValue: (next: string) => void;
  mode: NumPadMode;
  maxLength?: number;
  onBackspaceEmpty?: () => void;
  dismiss: () => void;
}

interface NumPadContextValue {
  attach: (target: NumPadTarget) => void;
  detach: (target: NumPadTarget) => void;
}

const NumPadContext = createContext<NumPadContextValue | null>(null);
const NumPadActiveContext = createContext(false);

export const useNumPad = () => useContext(NumPadContext);
export const useNumPadActive = () => useContext(NumPadActiveContext);
const NumPadTargetContext = createContext<NumPadTarget | null>(null);
export const useNumPadTarget = () => useContext(NumPadTargetContext);

const SLIDE_MS = 220;
const DETACH_GRACE_MS = 60;

const AndroidNumPadProvider: React.FC<{
  children: React.ReactNode;
  mode?: 'pan' | 'inflow';
  layoutAnimated?: boolean;
  fill?: boolean;
  onActiveChange?: (active: boolean) => void;
}> = ({ children, mode = 'inflow', layoutAnimated = false, fill = false, onActiveChange }) => {
  const [target, setTarget] = useState<NumPadTarget | null>(null);
  const targetRef = useRef<NumPadTarget | null>(null);
  const [shown, setShown] = useState<NumPadTarget | null>(null);
  const detachTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (target) setShown(target);
  }, [target]);
  const handleClosed = useCallback(() => {
    if (!targetRef.current) setShown(null);
  }, []);
  useEffect(
    () => () => {
      if (detachTimer.current) clearTimeout(detachTimer.current);
    },
    [],
  );

  const attach = useCallback((next: NumPadTarget) => {
    if (detachTimer.current) {
      clearTimeout(detachTimer.current);
      detachTimer.current = null;
    }
    targetRef.current = next;
    setTarget(next);
    try {
      KeyboardController.dismiss({ keepFocus: true });
    } catch {
    }
  }, []);

  const detach = useCallback((old: NumPadTarget) => {
    if (targetRef.current !== old) return;
    if (detachTimer.current) clearTimeout(detachTimer.current);
    detachTimer.current = setTimeout(() => {
      detachTimer.current = null;
      if (targetRef.current !== old) return;
      targetRef.current = null;
      setTarget(null);
    }, DETACH_GRACE_MS);
  }, []);

  const padUp = target != null;
  useEffect(() => {
    if (!padUp || Platform.OS !== 'android') return;
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      try {
        KeyboardController.dismiss({ keepFocus: true });
      } catch {
      }
    });
    return () => sub.remove();
  }, [padUp]);

  useEffect(() => {
    onActiveChange?.(padUp);
  }, [padUp, onActiveChange]);

  const ctx = useMemo(() => ({ attach, detach }), [attach, detach]);

  const panel = shown ? (
    <NumPadPanel
      target={shown}
      open={padUp}
      onClosed={handleClosed}
      overlay={mode === 'pan'}
      layoutAnimated={layoutAnimated}
    />
  ) : null;

  if (mode === 'inflow') {
    return (
      <NumPadContext.Provider value={ctx}>
        <NumPadActiveContext.Provider value={padUp}>
         <NumPadTargetContext.Provider value={target}>
          {fill ? (
            <View style={styles.host}>
              {children}
              {panel}
            </View>
          ) : (
            <>
              {children}
              {panel}
            </>
          )}
         </NumPadTargetContext.Provider>
        </NumPadActiveContext.Provider>
      </NumPadContext.Provider>
    );
  }

  return (
    <NumPadContext.Provider value={ctx}>
      <NumPadActiveContext.Provider value={padUp}>
        <NumPadTargetContext.Provider value={target}>
          <PanHost target={target} padPanel={panel}>
            {children}
          </PanHost>
        </NumPadTargetContext.Provider>
      </NumPadActiveContext.Provider>
    </NumPadContext.Provider>
  );
};

type NumPadProviderProps = React.ComponentProps<typeof AndroidNumPadProvider>;

export const NumPadProvider: React.FC<NumPadProviderProps> = (props) =>
  Platform.OS === 'android' ? <AndroidNumPadProvider {...props} /> : <>{props.children}</>;

const PanHost: React.FC<{
  target: NumPadTarget | null;
  padPanel: React.ReactNode;
  children: React.ReactNode;
}> = ({ target, padPanel, children }) => {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const hostRef = useRef<View>(null);
  const contentRef = useRef<View>(null);
  const hostHeight = useRef(0);
  const shift = useRef(new Animated.Value(0)).current;
  const shiftedBy = useRef(0);

  const animateTo = useCallback(
    (to: number) => {
      if (shiftedBy.current === to) return;
      shiftedBy.current = to;
      Animated.timing(shift, {
        toValue: -to,
        duration: SLIDE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [shift],
  );

  const mode = target?.mode;
  useEffect(() => {
    if (!mode) {
      animateTo(0);
      return;
    }
    const { panelHeight } = numPadMetrics(windowHeight, insets.bottom, mode, Platform.OS === 'ios');
    const raf = requestAnimationFrame(() => {
      const input = (TextInput as any).State?.currentlyFocusedInput?.();
      const host = hostRef.current;
      const content = contentRef.current;
      if (!input?.measureInWindow || !host || !content) return;
      host.measureInWindow((_hx, hostY) => {
        content.measureInWindow((_cx, contentY) => {
          input.measureInWindow((_ix: number, inputY: number, _w: number, inputH: number) => {
            const inputBottom = hostY + (inputY + inputH - contentY);
            const padTop = hostY + hostHeight.current - panelHeight;
            animateTo(panShiftFor(inputBottom, padTop, panelHeight));
          });
        });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [target, mode, windowHeight, insets.bottom, animateTo]);

  return (
    <View
      ref={hostRef}
      collapsable={false}
      style={styles.host}
      onLayout={(e) => {
        hostHeight.current = e.nativeEvent.layout.height;
      }}
    >
      <Animated.View
        ref={contentRef}
        collapsable={false}
        style={[styles.host, { transform: [{ translateY: shift }] }]}
      >
        {children}
      </Animated.View>
      {padPanel}
    </View>
  );
};

const ROWS: NumPadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];
const GAP = NUMPAD_GAP;
const REPEAT_DELAY_MS = 380;
const REPEAT_EVERY_MS = 70;

const Key: React.FC<{
  height: number;
  bg: string;
  pressedBg: string;
  a11y: string;
  flex?: number;
  /** Corner radius; defaults to a full pill (height / 2). A tall key needs a smaller one. */
  radius?: number;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  children?: React.ReactNode;
}> = ({ height, bg, pressedBg, a11y, flex = 1, radius, onPress, onPressIn, onPressOut, children }) => {
  const [down, setDown] = useState(false);
  const inert = !onPress && !onPressIn;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={inert}
      onPress={onPress}
      onPressIn={() => {
        setDown(true);
        onPressIn?.();
      }}
      onPressOut={() => {
        setDown(false);
        onPressOut?.();
      }}
      style={{
        flex,
        height,
        borderRadius: radius ?? height / 2,
        backgroundColor: down ? pressedBg : bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Pressable>
  );
};

const NumPadPanel: React.FC<{
  target: NumPadTarget;
  open: boolean;
  onClosed: () => void;
  overlay: boolean;
  layoutAnimated: boolean;
}> = ({ target, open, onClosed, overlay, layoutAnimated }) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const repeatRef = useRef<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null>(
    null,
  );

  const { bottomPad, keyHeight, panelHeight } = numPadMetrics(
    windowHeight,
    insets.bottom,
    target.mode,
    Platform.OS === 'ios',
  );

  const [colWidth, setColWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? SLIDE_MS : SLIDE_MS - 40,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: !layoutAnimated,
    });
    anim.start(({ finished }) => {
      if (finished && !open) onClosed();
    });
    return () => anim.stop();
  }, [open, progress, onClosed, layoutAnimated]);

  const press = useCallback(
    (key: NumPadKey) => {
      const current = target.getValue();
      const next = applyNumPadKey(current, key, target.mode, target.maxLength);
      if (next !== current) target.setValue(next);
      else if (key === 'back' && current === '') target.onBackspaceEmpty?.();
    },
    [target],
  );

  const stopRepeat = useCallback(() => {
    if (repeatRef.current) {
      clearTimeout(repeatRef.current as ReturnType<typeof setTimeout>);
      clearInterval(repeatRef.current as ReturnType<typeof setInterval>);
      repeatRef.current = null;
    }
  }, []);
  useEffect(() => stopRepeat, [stopRepeat]);

  const startBackRepeat = () => {
    stopRepeat();
    repeatRef.current = setTimeout(() => {
      repeatRef.current = setInterval(() => press('back'), REPEAT_EVERY_MS);
    }, REPEAT_DELAY_MS);
  };

  const keyBg = isDark ? '#2C3239' : '#FFFFFF';
  const keyDown = isDark ? '#4A525C' : '#C9CFD6';
  const fnBg = isDark ? '#454C5E' : '#D3D8DF';
  const fnDown = isDark ? '#5E667C' : '#B9C0C9';
  const doneBg = colors.primary.main;

  const digit = (k: string, flex = 1) => (
    <Key key={k} a11y={k} flex={flex} height={keyHeight} bg={keyBg} pressedBg={keyDown} onPressIn={() => press(k as NumPadKey)}>
      <Text style={[styles.keyText, { color: colors.text }]}>{k}</Text>
    </Key>
  );

  const backKey = (
    <Key
      a11y="backspace"
      height={keyHeight}
      bg={fnBg}
      pressedBg={fnDown}
      onPressIn={() => {
        press('back');
        startBackRepeat();
      }}
      onPressOut={stopRepeat}
    >
      <Ionicons name="backspace-outline" size={26} color={colors.text} />
    </Key>
  );
  const doneKey = (
    <Key a11y="Done" height={keyHeight} bg={doneBg} pressedBg={colors.primary.dark} onPress={target.dismiss}>
      <Ionicons name="checkmark" size={28} color="#FFFFFF" />
    </Key>
  );

  const slide = {
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [panelHeight, 0] }) },
    ],
  };
  const bg = isDark ? '#1E2229' : '#E6E9EE';

  return (
    <Animated.View
      style={
        overlay
          ? [styles.overlay, { height: panelHeight, backgroundColor: bg }, slide]
          : {
              height: layoutAnimated
                ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, panelHeight] })
                : panelHeight,
              overflow: 'hidden',
              backgroundColor: bg,
            }
      }
    >
      <Animated.View
        style={[styles.panel, { height: panelHeight, paddingBottom: bottomPad }, overlay ? null : slide]}
        // One of 4 equal columns, measured: the tall Done key + the 3-column block under the
        // 4-column rows must use EXACTLY these widths or the Done key drifts (a flex 3:1 split
        // ignores the gaps and left it wider, off the column above it).
        onLayout={(e) => setColWidth((e.nativeEvent.layout.width - GAP * 5) / 4)}
      >
      {target.mode === 'decimal' ? (
        // 4 columns x 4 rows (one row shorter than the old 3-column layout, which put Done on a
        // row of its own): 1 2 3 back / 4 5 6 . / 7 8 9 + a TALL Done spanning the last two rows
        // / a wide 0.
        <>
          <View style={styles.row}>
            {digit('1')}
            {digit('2')}
            {digit('3')}
            {backKey}
          </View>
          <View style={styles.row}>
            {digit('4')}
            {digit('5')}
            {digit('6')}
            <Key a11y="decimal point" height={keyHeight} bg={fnBg} pressedBg={fnDown} onPressIn={() => press('.')}>
              <Text style={[styles.keyText, { color: colors.text }]}>.</Text>
            </Key>
          </View>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            <View style={{ width: colWidth ? colWidth * 3 + GAP * 2 : undefined, flex: colWidth ? undefined : 3 }}>
              <View style={styles.row}>
                {digit('7')}
                {digit('8')}
                {digit('9')}
              </View>
              <View style={styles.row}>{digit('0')}</View>
            </View>
            <View style={{ width: colWidth || undefined, flex: colWidth ? undefined : 1, marginBottom: GAP }}>
              <Key
                a11y="Done"
                radius={keyHeight / 2}
                height={keyHeight * 2 + GAP}
                bg={doneBg}
                pressedBg={colors.primary.dark}
                onPress={target.dismiss}
              >
                <Ionicons name="checkmark" size={28} color="#FFFFFF" />
              </Key>
            </View>
          </View>
        </>
      ) : (
        <>
          {ROWS.map((row, i) => (
            <View key={i} style={styles.row}>
              {row.map((k) => digit(k))}
            </View>
          ))}
          <View style={styles.row}>
            {backKey}
            {digit('0')}
            {doneKey}
          </View>
        </>
      )}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: { paddingTop: GAP, paddingHorizontal: GAP },
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  keyText: { fontSize: 24, fontWeight: '500' },
});
