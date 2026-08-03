export const GUTTER_COLORS = [
  { name: 'White', hex: '#F0EDE8' },
  { name: 'Musket Brown', hex: '#3B2E1E' },
  { name: 'Clay', hex: '#8B7D6B' },
  { name: 'Linen', hex: '#9B9080' },
  { name: 'Bronze', hex: '#6B4F2E' },
  { name: 'Black', hex: '#1A1A1A' },
  { name: 'Almond', hex: '#C4B49A' },
  { name: 'Gray', hex: '#7A7A7A' },
];

export const SHINGLE_COLORS = [
  { name: 'Charcoal', hex: '#3D3D3D' },
  { name: 'Weathered Wood', hex: '#6B5E4E' },
  { name: 'Barkwood', hex: '#5C4A35' },
  { name: 'Slate', hex: '#5A6470' },
  { name: 'Driftwood', hex: '#8B7355' },
  { name: 'Mission Brown', hex: '#4A3728' },
];

export const WINDOW_COLORS = [
  { name: 'White', hex: '#F0EDE8' },
  { name: 'Tan', hex: '#C4A882' },
  { name: 'Bronze', hex: '#6B4F2E' },
  { name: 'Black', hex: '#1A1A1A' },
  { name: 'Clay', hex: '#8B7D6B' },
  { name: 'Gray', hex: '#7A7A7A' },
];

export const FLOOR_COLORS = [
  { name: 'Natural Oak', hex: '#C8A97A' },
  { name: 'Gray Oak', hex: '#9A9585' },
  { name: 'Dark Walnut', hex: '#3D2B1F' },
  { name: 'Driftwood', hex: '#A08B6E' },
  { name: 'Espresso', hex: '#2C1A0E' },
  { name: 'Ash White', hex: '#E8E0D0' },
];

export const TILE_COLORS = [
  { name: 'White', hex: '#F5F5F0' },
  { name: 'Gray', hex: '#9A9A9A' },
  { name: 'Beige', hex: '#D4C4A8' },
  { name: 'Black', hex: '#1A1A1A' },
  { name: 'Navy', hex: '#2C3E6B' },
  { name: 'Terracotta', hex: '#B85C38' },
];

export const COLOR_PALETTES: Record<string, Array<{ name: string; hex: string }>> = {
  gutter: GUTTER_COLORS,
  shingle: SHINGLE_COLORS,
  window: WINDOW_COLORS,
  floor: FLOOR_COLORS,
  tile: TILE_COLORS,
  bath: TILE_COLORS,
};

export const LOCATIONS = ['Left Side', 'Right Side', 'Front', 'Rear', 'Garage', 'Other'];
export const STORIES = ['1st', '2nd', '3rd'];
export const ROOMS = [
  'Living Room',
  'Master Bedroom',
  'Bedroom 2',
  'Bedroom 3',
  'Hallway',
  'Kitchen',
  'Dining Room',
  'Basement',
  'Office',
  'Other',
];
export const BATH_SPACES = ['Master Bath', 'Guest Bath', 'Half Bath', 'Basement Bath', 'Other'];

export function resolveColorPalette(paletteKey: string) {
  return COLOR_PALETTES[paletteKey] || GUTTER_COLORS;
}
