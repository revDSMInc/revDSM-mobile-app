import {
  getCapturableSlots,
  indexSchema,
  countCategory,
  getTopTabs,
  SCOPE_SEP,
  isChipContainer,
  usesPerChipContent,
  type InspectionCategory,
} from '../../../src/widgets/components/lead-center/dynamic-inspection-schema-utils';

// A chip-selector (Windows: Story = Front/Back) whose children carry per-chip
// content (a flat-list of window positions). Each chip must own its own photos.
const perChipWindows: InspectionCategory = {
  id: 'windows',
  label: 'Windows',
  type: 'chip-selector',
  chipLabel: 'Story',
  perChipContent: true,
  children: [
    { id: 'front', label: 'Front', type: 'flat-list', options: ['Window 1', 'Window 2'] },
    { id: 'back', label: 'Back', type: 'flat-list', options: ['Window 1'] },
  ],
};

// Legacy chip-selector: chips are string `options`; children are shared under each.
const legacyChips: InspectionCategory = {
  id: 'rooms',
  label: 'Rooms',
  type: 'chip-selector',
  options: ['Kitchen', 'Bath'],
  children: [{ id: 'shots', label: 'Shots', type: 'flat-list', options: ['Wide', 'Close'] }],
};

describe('inspection chip-selector scoping (web parity)', () => {
  it('classifies a chip-selector with children as a chip container', () => {
    expect(isChipContainer(perChipWindows)).toBe(true);
    expect(usesPerChipContent(perChipWindows)).toBe(true);
    expect(usesPerChipContent(legacyChips)).toBe(false);
  });

  it('applies the chip scope to a leaf slot storage name via _scope', () => {
    const scopedFront = { ...perChipWindows.children![0], _scope: ['Front'] } as InspectionCategory;
    const slots = getCapturableSlots(scopedFront);
    expect(slots.map((s) => s.storageName)).toEqual([
      `Front${SCOPE_SEP}Window 1`,
      `Front${SCOPE_SEP}Window 2`,
    ]);
    // Scope makes the slot id unique so per-slot UI state never collides across chips.
    expect(slots[0].id).toBe('Front::Window 1');
  });

  it('fans out a per-chip selector into one scoped branch per chip in indexSchema', () => {
    const { leafCategories } = indexSchema([perChipWindows]);
    // Front (2 windows) + Back (1 window) → two scoped leaf branches.
    const scopes = leafCategories.map((c) => (c._scope || []).join('|'));
    expect(scopes).toContain('Front');
    expect(scopes).toContain('Back');

    const frontLeaf = leafCategories.find((c) => (c._scope || []).join('|') === 'Front')!;
    const frontStorage = getCapturableSlots(frontLeaf).map((s) => s.storageName);
    expect(frontStorage).toContain(`Front${SCOPE_SEP}Window 1`);
    // The SAME base slot under a different chip resolves to a DIFFERENT storage name
    // → no photo collision across chips.
    const backLeaf = leafCategories.find((c) => (c._scope || []).join('|') === 'Back')!;
    const backStorage = getCapturableSlots(backLeaf).map((s) => s.storageName);
    expect(backStorage).toContain(`Back${SCOPE_SEP}Window 1`);
    expect(frontStorage).not.toContain(`Back${SCOPE_SEP}Window 1`);
  });

  it('fans out a legacy (options-as-chips) selector per option', () => {
    const { leafCategories } = indexSchema([legacyChips]);
    const scopes = leafCategories.map((c) => (c._scope || []).join('|'));
    expect(scopes).toContain('Kitchen');
    expect(scopes).toContain('Bath');
    const kitchen = leafCategories.find((c) => (c._scope || []).join('|') === 'Kitchen')!;
    expect(getCapturableSlots(kitchen).map((s) => s.storageName)).toEqual([
      `Kitchen${SCOPE_SEP}Wide`,
      `Kitchen${SCOPE_SEP}Close`,
    ]);
  });

  it('counts every chip branch (scoped) with no capture', () => {
    const capture = {
      getPhotos: () => [] as any[],
      countUnderLabel: () => 0,
      extrasFor: () => [] as any[],
    };
    // Front (2) + Back (1) = 3 total slots across chips.
    expect(countCategory(perChipWindows, capture)).toEqual({ filled: 0, total: 3 });
  });

  it('does NOT unwrap a chip-selector root in getTopTabs', () => {
    const tabs = getTopTabs([perChipWindows]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe('windows');
  });

  it('DOES unwrap a single root tab-bar in getTopTabs', () => {
    const root: InspectionCategory = {
      id: 'root',
      label: 'Root',
      type: 'tab-bar',
      children: [
        { id: 'a', label: 'A', type: 'flat-list', options: ['x'] },
        { id: 'b', label: 'B', type: 'flat-list', options: ['y'] },
      ],
    };
    const tabs = getTopTabs([root]);
    expect(tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });
});
