// Paint order for the annotation canvas (REVUIUX-588). Pen ink, eraser strokes and shapes are ONE chronological stack: an eraser stroke
// rubs out whatever was drawn BEFORE it - ink AND shapes - and never what is drawn after it. (Shapes used to sit above the eraser, so
// they could not be rubbed out at all; and the preview applied every eraser to every stroke while the saved JPEG applied them in order.)
// Pure on purpose: the editor canvas, the pending-card preview and the export script all derive their layering from here.

export type LayerItem = { kind: 'stroke'; item: any } | { kind: 'shape'; item: any };

/**
 * When a mark was made, from its id: pen strokes use `Date.now()` as the id, shapes `shape-<Date.now()>`. Anything else (a small counter,
 * a web-written id) is unknown - null - and keeps its saved order.
 */
export const markTime = (id: any): number | null => {
  if (typeof id === 'number') return Number.isFinite(id) && id > 1e9 ? id : null;
  const m = /(\d{10,})$/.exec(String(id ?? ''));
  return m ? Number(m[1]) : null;
};

/**
 * Strokes and shapes merged oldest-first. Each input list is already in creation order, so this is a stable two-way merge. A mark with no
 * known time keeps the legacy order: unknown ink first, unknown shapes last (shapes used to be drawn after all ink).
 */
export const orderedLayers = (strokes: any[] | undefined, shapes: any[] | undefined): LayerItem[] => {
  const a = strokes || [];
  const b = shapes || [];
  const out: LayerItem[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i >= a.length) out.push({ kind: 'shape', item: b[j++] });
    else if (j >= b.length) out.push({ kind: 'stroke', item: a[i++] });
    else {
      const ta = markTime(a[i]?.id) ?? -Infinity;
      const tb = markTime(b[j]?.id) ?? Infinity;
      out.push(ta <= tb ? { kind: 'stroke', item: a[i++] } : { kind: 'shape', item: b[j++] });
    }
  }
  return out;
};

/**
 * One block = the marks drawn since the last eraser, plus the eraser strokes that came right BEFORE them. Rendering walks the blocks in
 * order: wrap everything built so far in a group masked by the block's erasers, then add the block's own marks on top. Consecutive
 * eraser strokes share one block, so a long erase session is a handful of masks, not one per stroke.
 */
export interface LayerBlock {
  erasers: any[];
  items: LayerItem[];
}

export const layerBlocks = (layers: LayerItem[]): LayerBlock[] => {
  const blocks: LayerBlock[] = [{ erasers: [], items: [] }];
  layers.forEach((l) => {
    const cur = blocks[blocks.length - 1];
    if (l.kind === 'stroke' && l.item?.isEraser) {
      if (cur.items.length === 0) cur.erasers.push(l.item);
      else blocks.push({ erasers: [l.item], items: [] });
    } else {
      cur.items.push(l);
    }
  });
  return blocks;
};

/** True when an eraser stroke exists anywhere (lets the export skip the layer canvas dance when there is nothing to rub out). */
export const hasEraser = (strokes: any[] | undefined): boolean => (strokes || []).some((s) => s?.isEraser);
