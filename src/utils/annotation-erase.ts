// Text notes under the eraser (REVUIUX-588). The eraser rubs out ink and shapes pixel by pixel (see annotation-layers.ts), but a text note cannot
// be rubbed out in part, so a note the eraser passes over is removed WHOLE - this decides what counts as "passed over". Pure on purpose: the
// screen imports React Native, this does not.

/**
 * A text note's box in canvas px, ESTIMATED from its text and font size (the real box is measured by the rendered note and is not known here):
 * 8px padding all round (DraggableText), ~0.6em per character, 1.3em per line.
 */
export const textBox = (t: any, w: number, h: number) => {
  const size = Number(t?.fontSize) || 16;
  const lines = String(t?.text ?? '').split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const left = (t?.px ?? 0) * w;
  const top = (t?.py ?? 0) * h;
  return { left, top, right: left + longest * size * 0.6 + 16, bottom: top + lines.length * size * 1.3 + 16 };
};

export const hitText = (t: any, x: number, y: number, w: number, h: number, radius: number): boolean => {
  const b = textBox(t, w, h);
  return x >= b.left - radius && x <= b.right + radius && y >= b.top - radius && y <= b.bottom + radius;
};

/**
 * The undo step for a removal. A pen stroke / text note keeps the mark itself (`removed: true`, it is no longer on the canvas); a shape
 * uses the existing before/after entry (`after: null` = deleted). Only text notes are removed this way today.
 */
export const removalEntry = (kind: 'stroke' | 'text' | 'shape', mark: any): any =>
  kind === 'shape'
    ? { id: mark.id, type: 'shape', before: mark, after: null }
    : { id: mark.id, type: kind, removed: true, data: mark };
