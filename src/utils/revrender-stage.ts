/** Word shown next to the revRender progress bar, by percent. */
export function revRenderStageWord(percent: number): string {
  const p = Number.isFinite(percent) ? percent : 0;
  if (p <= 10) return 'Warming up';
  if (p <= 35) return 'Engine running';
  if (p <= 75) return 'Rendering';
  if (p <= 92) return 'Hold On';
  return 'Almost Finished';
}

/** First percent of each stage, in order. */
const STAGE_STARTS = [0, 11, 36, 76, 93];

const stageIndex = (p: number): number => {
  let i = 0;
  for (let k = 0; k < STAGE_STARTS.length; k++) if (p >= STAGE_STARTS[k]) i = k;
  return i;
};

/**
 * One tick of the DISPLAYED percent. Chases `target` but never crosses more than one stage per
 * tick, so a render that finishes quickly still shows every word before the bar reaches 100.
 * Never moves backwards.
 */
export function stepShownPercent(shown: number, target: number): number {
  const s = Math.max(0, Math.min(100, shown));
  const t = Math.max(0, Math.min(100, target));
  const si = stageIndex(s);
  if (stageIndex(t) > si) return STAGE_STARTS[si + 1];
  return Math.max(s, t);
}
