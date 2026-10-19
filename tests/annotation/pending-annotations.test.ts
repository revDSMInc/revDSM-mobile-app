import { buildPendingAnnotations, coverBox } from '../../src/utils/pending-annotations';

const job = (over: any = {}) => ({
  id: 'j1',
  leadId: 'L1',
  categoryName: 'Roof - Front',
  subcategory: 'Front-Left (Annotated)',
  originalUri: 'file:///o.jpg',
  layoutWidth: 400,
  layoutHeight: 300,
  strokes: [],
  texts: [],
  shapes: [],
  annotation: { mode: 'new' as const },
  ...over,
});
const queued = (over: any = {}) => ({
  id: 'q1',
  leadId: 'L1',
  categoryName: 'Roof - Front',
  subcategory: 'Front-Left (Annotated)',
  uri: 'file:///q.jpg',
  annotation: { mode: 'new' as const },
  ...over,
});

describe('buildPendingAnnotations', () => {
  it('lists a saved job (marks over the original) and a queued annotation (local jpeg), for this lead only', () => {
    const out = buildPendingAnnotations([job(), job({ id: 'j2', leadId: 'L2' })], [queued(), queued({ id: 'q2', leadId: 'L2' })], 'L1');
    expect(out.map((p) => p.key)).toEqual(['q-q1', 'j-j1']);
    expect(out[0].previewUri).toBe('file:///q.jpg');
    expect(out[1].job?.originalUri).toBe('file:///o.jpg');
    expect(out[0].baseSubcategory).toBe('Front-Left');
  });

  it('ignores ordinary queued photos and carries the re-edit target id', () => {
    const out = buildPendingAnnotations(
      [],
      [queued({ annotation: undefined }), queued({ id: 'q3', annotation: { mode: 'reedit', existingAnnotationId: 'A9' } })],
      'L1',
    );
    expect(out).toHaveLength(1);
    expect(out[0].mode).toBe('reedit');
    expect(out[0].existingAnnotationId).toBe('A9');
  });

  it('is empty without a lead', () => {
    expect(buildPendingAnnotations([job()], [queued()], undefined)).toEqual([]);
  });
});

describe('coverBox', () => {
  it('crops a wide photo to a 1.6 card exactly like resizeMode cover', () => {
    const b = coverBox(160, 100, 400, 200); // 2:1 photo is wider than the 1.6 card
    expect(b.h).toBe(100);
    expect(b.w).toBe(200);
    expect(b.x).toBe(-20);
    expect(b.y).toBe(0);
    expect(b.scale).toBe(0.5);
  });
  it('crops a tall photo top / bottom', () => {
    const b = coverBox(160, 100, 300, 400);
    expect(b.w).toBe(160);
    expect(Math.round(b.h)).toBe(213);
    expect(b.x).toBe(0);
    expect(b.y).toBeLessThan(0);
  });
});
