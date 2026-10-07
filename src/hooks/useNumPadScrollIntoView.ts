import { useEffect, type RefObject } from 'react';
import { TextInput } from 'react-native';
import { useNumPadTarget } from '../widgets/common/keyboard/NumPad';

const SETTLE_MS = 260;

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
