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

// ---- Square eraser, 0..100 ruler (follow-up to REVUIUX-588) -------------------------------------------------------------------
// The eraser footprint is an axis-aligned SQUARE (side = the stroke width), not a round brush, and its size is a continuous 0..100 ruler.
export type EraserShape = 'square' | 'circle';
export const DEFAULT_ERASER_SHAPE: EraserShape = 'square';
/** A saved eraser stroke with no `shape` predates the choice and was round, so it stays round. */
export const eraserShapeOf = (s: { shape?: any } | null | undefined): EraserShape => (s?.shape === 'square' ? 'square' : 'circle');

export const ERASER_MIN_SIZE = 1;
export const ERASER_MAX_SIZE = 100;

export const eraserFromSlider = (v: number): number =>
  Math.max(ERASER_MIN_SIZE, Math.round(clamp01(v) * ERASER_MAX_SIZE));
export const sliderFromEraser = (size: number): number => clamp01(size / ERASER_MAX_SIZE);

type Pt = { x: number; y: number };

const hull = (pts: Pt[]): Pt[] => {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};

/**
 * SVG path (filled, not stroked) of an axis-aligned square of side `size` swept along `points` (normalised px/py): one convex hull of two
 * squares per segment, so a drag leaves a solid band and a tap leaves one square. Same maths as the export script in annotation-render-html.ts.
 */
export const eraserSweepPath = (points: { px: number; py: number }[], w: number, h: number, size: number): string => {
  if (!points || points.length === 0) return '';
  const r = Math.max(size, 1) / 2;
  const corners = (p: { px: number; py: number }): Pt[] => {
    const x = p.px * w;
    const y = p.py * h;
    return [{ x: x - r, y: y - r }, { x: x + r, y: y - r }, { x: x + r, y: y + r }, { x: x - r, y: y + r }];
  };
  const toD = (poly: Pt[]) => poly.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join(' ') + ' Z';
  if (points.length === 1) return toD(corners(points[0]));
  const out: string[] = [];
  for (let i = 1; i < points.length; i++) out.push(toD(hull([...corners(points[i - 1]), ...corners(points[i])])));
  return out.join(' ');
};
