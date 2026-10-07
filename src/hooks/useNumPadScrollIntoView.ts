import { useEffect, type RefObject } from 'react';
import { TextInput } from 'react-native';
import { useNumPadTarget } from '../widgets/common/keyboard/NumPad';

/** Time for the in-flow pad to take its space (it reserves it at once; this covers the layout pass). */
const SETTLE_MS = 260;

/**
 * Scrolls the focused numeric field clear of the in-app number pad.
 *
 * ⚠️ `KeyboardAwareScrollView` cannot do this for the pad: it reacts to KEYBOARD frames, and the pad
 * is a plain in-flow sibling that only shrinks the scroll frame, so a field near the bottom stayed
 * half under the pad whatever `bottomOffset` was. Runs once per field that takes the pad.
 *
 * `contentRef` is a View wrapping the scroll CONTENT (collapsable={false}); its window y against the
 * scroll view's gives the current offset without needing an `onScroll` (callers may already own one).
 * `contentTop` is the content container's top padding.
 */
export function useNumPadScrollIntoView(
  scrollRef: RefObject<any>,
  contentRef: RefObject<any>,
  contentTop = 0,
  margin = 64,
) {
  const target = useNumPadTarget();
  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => {
      const input = (TextInput as any).State?.currentlyFocusedInput?.();
      const sv = scrollRef.current;
      const content = contentRef.current;
      if (!input?.measureInWindow || !sv?.measureInWindow || !content?.measureInWindow) return;
      sv.measureInWindow((_sx: number, svY: number, _sw: number, svH: number) => {
        content.measureInWindow((_cx: number, contentY: number) => {
          input.measureInWindow((_ix: number, inputY: number, _iw: number, inputH: number) => {
            const need = inputY + inputH + margin - (svY + svH);
            if (!(need > 0)) return;
            const offset = Math.max(0, svY + contentTop - contentY);
            sv.scrollTo?.({ y: offset + Math.ceil(need), animated: true });
          });
        });
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [target, scrollRef, contentRef, contentTop, margin]);
}
