// Brush sizes for the photo annotation Draw tool (REVUIUX-588). The pen and the eraser each keep their OWN width: before, the
// eraser reused the pen's size and its size row was hidden, so the eraser could not be resized at all. Pure on purpose.

export type DrawTool = 'pen' | 'eraser';

export const PEN_SIZES = [3, 5, 8, 12];
/** An eraser needs to be wider than a pen to be useful; same canvas-px scale as pen strokes. */
export const ERASER_SIZES = [8, 14, 24, 40];

export const DEFAULT_PEN_SIZE = 5;
export const DEFAULT_ERASER_SIZE = 14;

export const sizesFor = (tool: DrawTool): number[] => (tool === 'eraser' ? ERASER_SIZES : PEN_SIZES);

/** The width a new stroke gets for the active tool. */
export const brushWidth = (tool: DrawTool, penSize: number, eraserSize: number): number =>
  tool === 'eraser' ? eraserSize : penSize;

// ---- Pen transparency + thickness sliders (REVUIUX-590, like CamScanner's) ----------------------------------------------------
// The pen used to have four fixed widths and always drew fully opaque. Both are now continuous. The sliders work in 0..1; these map that to the
// real values (a pen stroke stores `width` in canvas px and `opacity` 0.1..1).
export const PEN_MIN_SIZE = 2;
export const PEN_MAX_SIZE = 30;
/** Never fully invisible: a stroke at 0 opacity could be drawn and then not found again. */
export const PEN_MIN_OPACITY = 0.1;
export const DEFAULT_PEN_OPACITY = 1;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export const sizeFromSlider = (v: number): number => Math.round(PEN_MIN_SIZE + clamp01(v) * (PEN_MAX_SIZE - PEN_MIN_SIZE));
export const sliderFromSize = (size: number): number => clamp01((size - PEN_MIN_SIZE) / (PEN_MAX_SIZE - PEN_MIN_SIZE));

export const opacityFromSlider = (v: number): number =>
  Math.round((PEN_MIN_OPACITY + clamp01(v) * (1 - PEN_MIN_OPACITY)) * 100) / 100;
export const sliderFromOpacity = (o: number): number => clamp01((o - PEN_MIN_OPACITY) / (1 - PEN_MIN_OPACITY));

/** A saved stroke's opacity, tolerant of strokes saved before this existed (no field = fully opaque) or a bad value. */
export const strokeOpacity = (s: { opacity?: any } | null | undefined): number => {
  const o = Number(s?.opacity);
  return Number.isFinite(o) && o > 0 && o <= 1 ? o : 1;
};
