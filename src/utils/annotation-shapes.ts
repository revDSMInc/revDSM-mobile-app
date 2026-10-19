// Shapes for the photo annotation screen (REVUIUX-559): arrow, straight line, circle, rectangle.
// Everything is stored NORMALISED (0..1 of the canvas box, like strokes and texts) so the on-screen preview and the
// full-resolution export agree. Geometry that needs real distances (circle radius, hit tolerance, arrow head) is done in
// canvas PIXELS via the helpers below. Pure on purpose - the screen imports React Native, this does not.

export type ShapeKind = 'arrow' | 'line' | 'circle' | 'rect';

export interface ShapePoint {
  px: number;
  py: number;
}

export interface AnnotationShape {
  id: string;
  kind: ShapeKind;
  /** line/arrow: start. rect: one corner. circle: the CENTRE. */
  p1: ShapePoint;
  /** line/arrow: end (arrow tip). rect: opposite corner. circle: any point ON the edge (sets the radius). */
  p2: ShapePoint;
  color: string;
  /** Stroke width in canvas px (the same scale as pen strokes). */
  width: number;
}

export type ShapeHandle = 'p1' | 'p2';

export const SHAPE_KINDS: { kind: ShapeKind; label: string; icon: string }[] = [
  { kind: 'arrow', label: 'Arrow', icon: 'arrow-top-right' },
  { kind: 'line', label: 'Line', icon: 'vector-line' },
  { kind: 'circle', label: 'Circle', icon: 'circle-outline' },
  { kind: 'rect', label: 'Box', icon: 'square-outline' },
];

/** Below this drag length (canvas px) a gesture is a TAP (select / deselect), not a new shape. */
export const MIN_SHAPE_DRAG_PX = 8;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clampPoint = (p: ShapePoint): ShapePoint => ({ px: clamp01(p.px), py: clamp01(p.py) });

export const makeShape = (
  kind: ShapeKind,
  id: string,
  start: ShapePoint,
  end: ShapePoint,
  color: string,
  width: number
): AnnotationShape => ({ id, kind, p1: clampPoint(start), p2: clampPoint(end), color, width });

const toPx = (p: ShapePoint, w: number, h: number) => ({ x: p.px * w, y: p.py * h });

export const shapeLengthPx = (s: AnnotationShape, w: number, h: number): number => {
  const a = toPx(s.p1, w, h);
  const b = toPx(s.p2, w, h);
  return Math.hypot(b.x - a.x, b.y - a.y);
};

/** Circle radius in canvas px (centre p1, edge point p2). */
export const circleRadiusPx = (s: AnnotationShape, w: number, h: number): number => shapeLengthPx(s, w, h);

export interface ArrowGeometry {
  /** Where the shaft stops, so the line does not poke through the head's tip. */
  shaftEnd: { x: number; y: number };
  /** The three corners of the filled head: tip, then the two barbs. */
  tip: { x: number; y: number };
  left: { x: number; y: number };
  right: { x: number; y: number };
}

const ARROW_HEAD_HALF_ANGLE = Math.PI / 7;

/**
 * Arrow head for the segment (x1,y1) -> (x2,y2) drawn with a stroke of `width`. The head scales with the stroke so a
 * thick arrow has a proportionate head, and is capped at 60% of a short arrow's length so it never swallows the shaft.
 * ⚠️ The export WebView in `screens/ImageAnnotation/index.tsx` re-implements this maths in its own script string (a
 * function cannot be shipped to the WebView - Hermes has no source text) - change BOTH.
 */
export const arrowGeometry = (x1: number, y1: number, x2: number, y2: number, width: number): ArrowGeometry => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const headLen = Math.min(Math.max(14, width * 4.5), length * 0.6);
  const bx = x2 - ux * headLen;
  const by = y2 - uy * headLen;
  const half = headLen * Math.tan(ARROW_HEAD_HALF_ANGLE);
  const shaft = headLen * 0.85;
  return {
    shaftEnd: { x: x2 - ux * shaft, y: y2 - uy * shaft },
    tip: { x: x2, y: y2 },
    left: { x: bx - uy * half, y: by + ux * half },
    right: { x: bx + uy * half, y: by - ux * half },
  };
};

const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

/** Is the canvas-px point (x,y) on the shape's OUTLINE (within `tol` px)? Interiors are deliberately not hit. */
export const hitShapeBody = (s: AnnotationShape, x: number, y: number, w: number, h: number, tol: number): boolean => {
  const a = toPx(s.p1, w, h);
  const b = toPx(s.p2, w, h);
  const reach = tol + s.width / 2;
  switch (s.kind) {
    case 'line':
    case 'arrow':
      return distToSegment(x, y, a.x, a.y, b.x, b.y) <= reach;
    case 'circle': {
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      return Math.abs(Math.hypot(x - a.x, y - a.y) - r) <= reach;
    }
    case 'rect': {
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      const top = Math.min(a.y, b.y);
      const bottom = Math.max(a.y, b.y);
      return (
        distToSegment(x, y, left, top, right, top) <= reach ||
        distToSegment(x, y, right, top, right, bottom) <= reach ||
        distToSegment(x, y, right, bottom, left, bottom) <= reach ||
        distToSegment(x, y, left, bottom, left, top) <= reach
      );
    }
    default:
      return false;
  }
};

/** Which end handle (if any) is within `tol` px of the point? p2 wins a tie so a zero-size shape can be pulled out. */
export const hitShapeHandle = (
  s: AnnotationShape,
  x: number,
  y: number,
  w: number,
  h: number,
  tol: number
): ShapeHandle | null => {
  const a = toPx(s.p1, w, h);
  const b = toPx(s.p2, w, h);
  const d1 = Math.hypot(x - a.x, y - a.y);
  const d2 = Math.hypot(x - b.x, y - b.y);
  if (d2 <= tol && d2 <= d1) return 'p2';
  if (d1 <= tol) return 'p1';
  return null;
};

/** Topmost (last drawn) shape whose outline is under the point. */
export const pickShapeAt = (
  shapes: AnnotationShape[],
  x: number,
  y: number,
  w: number,
  h: number,
  tol: number
): AnnotationShape | null => {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (hitShapeBody(shapes[i], x, y, w, h, tol)) return shapes[i];
  }
  return null;
};

/** Translate a shape by a normalised delta, stopping at the canvas edge WITHOUT squashing it (both points move together). */
export const moveShape = (s: AnnotationShape, dpx: number, dpy: number): AnnotationShape => {
  const minX = Math.min(s.p1.px, s.p2.px);
  const maxX = Math.max(s.p1.px, s.p2.px);
  const minY = Math.min(s.p1.py, s.p2.py);
  const maxY = Math.max(s.p1.py, s.p2.py);
  const ox = Math.max(-minX, Math.min(1 - maxX, dpx));
  const oy = Math.max(-minY, Math.min(1 - maxY, dpy));
  return {
    ...s,
    p1: { px: s.p1.px + ox, py: s.p1.py + oy },
    p2: { px: s.p2.px + ox, py: s.p2.py + oy },
  };
};

export const moveShapeHandle = (s: AnnotationShape, handle: ShapeHandle, to: ShapePoint): AnnotationShape => ({
  ...s,
  [handle]: clampPoint(to),
});

/** Insert / replace / remove (`value === null`) one shape by id, keeping draw order. */
export const applyShapeChange = (
  list: AnnotationShape[] | undefined,
  id: string,
  value: AnnotationShape | null
): AnnotationShape[] => {
  const current = list || [];
  if (value === null) return current.filter((s) => s.id !== id);
  return current.some((s) => s.id === id)
    ? current.map((s) => (s.id === id ? value : s))
    : [...current, value];
};
