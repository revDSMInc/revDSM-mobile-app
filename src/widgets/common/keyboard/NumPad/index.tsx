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

/**
 * In-app number pad, app-wide. Numeric TextInputs (see `useNumPadField`, wired into the global
 * TextInput patch in index.js) attach to the NEAREST `NumPadProvider`:
 *   - one at the app root (App.tsx) serves every screen,
 *   - the patched `Modal` (index.js) mounts one INSIDE each modal, because a Modal is its own
 *     native view tree and a pad drawn by the root would sit hidden underneath it.
 *   - Lead Create mounts its own `mode="inflow"` provider (pad under the ScrollView).
 * Outside any provider nothing changes.
 *
 * `mode="inflow"` (default) keeps the page where it is: the pad takes its own strip at the bottom and the
 * screen above shrinks, exactly like the system keyboard did - header and footer never move.
 * `mode="pan"` is layout-agnostic: the pad is an overlay and the host slides its
 * content up just far enough to keep the focused field clear of it - so it works for any
 * screen/modal without knowing its layout, and animates on the native thread (no layout pass
 * per frame). `mode="inflow"` puts the pad in the column and the form above shrinks.
 */

/** What a focused field hands the pad. */
export interface NumPadTarget {
  getValue: () => string;
  setValue: (next: string) => void;
  mode: NumPadMode;
  maxLength?: number;
  /** Backspace on an already-empty field (OTP boxes use it to step back a box). */
  onBackspaceEmpty?: () => void;
  /** Done: submit, then blur. */
  dismiss: () => void;
}

interface NumPadContextValue {
  attach: (target: NumPadTarget) => void;
  detach: (target: NumPadTarget) => void;
}

const NumPadContext = createContext<NumPadContextValue | null>(null);
/** True while a pad is up under the nearest provider (lets a KeyboardAvoidingView stand down). */
const NumPadActiveContext = createContext(false);

/** Null outside a provider - callers fall back to the system keyboard. */
export const useNumPad = () => useContext(NumPadContext);
export const useNumPadActive = () => useContext(NumPadActiveContext);
/**
 * The field that currently owns the pad (null when it is down). The identity changes every time
 * focus moves to another numeric field, so an effect keyed on it re-runs per field - used to scroll
 * the focused field clear of the pad (`hooks/useNumPadScrollIntoView`).
 */
const NumPadTargetContext = createContext<NumPadTarget | null>(null);
export const useNumPadTarget = () => useContext(NumPadTargetContext);

const SLIDE_MS = 220;
// Focus often jumps A -> B as "blur A" then "focus B"; clearing straight away would slide the
// pad out and back in. Detach waits this long for a newcomer.
const DETACH_GRACE_MS = 60;

const AndroidNumPadProvider: React.FC<{
  children: React.ReactNode;
  mode?: 'pan' | 'inflow';
  /** inflow only: tween the pad's HEIGHT too (form above resizes smoothly, JS driver). Default
   *  false: the space is reserved at once and only the pad slides (native driver). */
  layoutAnimated?: boolean;
  /** inflow only: wrap children + pad in a `flex: 1` View. For hosts that fill their parent (app root,
   *  Modal). ⚠️ Off for Lead Create: its parent is content-sized (`maxHeight`), where a flex child collapses. */
  fill?: boolean;
  /** Lets a host turn its own KeyboardAvoidingView off while the pad is up (Lead Create). */
  onActiveChange?: (active: boolean) => void;
}> = ({ children, mode = 'inflow', layoutAnimated = false, fill = false, onActiveChange }) => {
  const [target, setTarget] = useState<NumPadTarget | null>(null);
  const targetRef = useRef<NumPadTarget | null>(null);
  // Kept after `target` clears so the pad can finish sliding OUT before it unmounts.
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
    // Focus moved here FROM a text field: its system keyboard is still up. Hide it but keep
    // the focus (a plain Keyboard.dismiss() would blur the field we just focused).
    try {
      KeyboardController.dismiss({ keepFocus: true });
    } catch {
      // module unavailable (tests/old build) - the pad still works.
    }
  }, []);

  const detach = useCallback((old: NumPadTarget) => {
    // Only the owner may clear: B may already have attached by the time A's blur lands.
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
  // Belt and braces for Android: some IMEs re-raise themselves after the focus change. While a
  // numeric field owns the pad the system keyboard must never stay up - hide it, keep the focus.
  // (Android only: iOS reports a tiny keyboardDidShow for the empty input view; hiding it
  // there would resign the field.)
  useEffect(() => {
    if (!padUp || Platform.OS !== 'android') return;
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      try {
        KeyboardController.dismiss({ keepFocus: true });
      } catch {
        // module unavailable
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

/**
 * ⚠️ ANDROID ONLY. On iOS/iPad this is a pure pass-through - numeric fields keep the SYSTEM keyboard
 * (decision: the custom pad is for Android; iOS keeps what it had, incl. the iPad docked-keyboard
 * workaround in `utils/keyboard-type.ts`). No extra Views are mounted on iOS either, so the
 * app-root and per-Modal hosts cost iOS nothing. `useNumPadField` makes the same platform check -
 * keep the two in step.
 */
export const NumPadProvider: React.FC<NumPadProviderProps> = (props) =>
  Platform.OS === 'android' ? <AndroidNumPadProvider {...props} /> : <>{props.children}</>;

/**
 * Slides `children` up so the focused field clears the overlay pad.
 *
 * ⚠️ Measures with `measureInWindow` on THREE things (host, content, input) and subtracts, so
 * the answer is the same whether the platform includes the current pan transform in the
 * numbers or not (iOS and Android disagree) - switching A -> B while already panned would
 * otherwise compound the shift.
 */
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
      // Every Modal in the app mounts one of these: do nothing when there is nothing to change.
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
    // Next frame: the field has taken focus and the pad is mounting.
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
    // `target` identity: re-measure when focus moves to another numeric field.
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

/**
 * ⚠️ A plain `style` object + `useState` for the pressed look, NOT `Pressable`'s
 * `style={({ pressed }) => ...}`: NativeWind wraps Pressable and drops the function form,
 * which collapsed every key to bare text with no background.
 */
const Key: React.FC<{
  height: number;
  bg: string;
  pressedBg: string;
  a11y: string;
  flex?: number;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  children?: React.ReactNode;
}> = ({ height, bg, pressedBg, a11y, flex = 1, onPress, onPressIn, onPressOut, children }) => {
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
        borderRadius: height / 2,
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
  /** Absolute pad over the host (pan mode) vs. in the column (inflow). */
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

  // ⚠️ overlay: translateY only, so it runs on the native thread. inflow: the pad is in FLOW
  // and the form above shrinks with it every frame, so `height` animates (JS driver - height
  // cannot run natively); it also slides so it reads as rising from the bottom edge.
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
    <Key key={k} a11y={k} flex={flex} height={keyHeight} bg={keyBg} pressedBg={keyDown} onPress={() => press(k as NumPadKey)}>
      <Text style={[styles.keyText, { color: colors.text }]}>{k}</Text>
    </Key>
  );

  // Backspace and Done are the SAME size and shape as every digit key (a tall oval Done key
  // read as out of place).
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
      >
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((k) => digit(k))}
        </View>
      ))}
      {target.mode === 'decimal' ? (
        <>
          <View style={styles.row}>
            <Key a11y="decimal point" height={keyHeight} bg={fnBg} pressedBg={fnDown} onPress={() => press('.')}>
              <Text style={[styles.keyText, { color: colors.text }]}>.</Text>
            </Key>
            {digit('0')}
            {backKey}
          </View>
          {doneKey}
        </>
      ) : (
        <View style={styles.row}>
          {backKey}
          {digit('0')}
          {doneKey}
        </View>
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
