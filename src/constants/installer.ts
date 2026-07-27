import type {
  InstallStep,
  InstallStepKey,
  PhotoSection,
  PECArea,
  InstallerResultType,
} from '../config/types/installer';

// ─────────────────────────────────────────────────────────────────────────────
// Install timeline
// ─────────────────────────────────────────────────────────────────────────────

export const INSTALL_STEPS: InstallStep[] = [
  {
    key: 'pickup',
    n: 1,
    title: 'Pickup',
    desc: 'Photo the material loaded for this job',
    icon: 'truck-outline',
  },
  {
    key: 'pec',
    n: 2,
    title: 'Pre-Existing Conditions',
    desc: 'Flag & photo site conditions before work',
    icon: 'clipboard-alert-outline',
  },
  {
    key: 'pre',
    n: 3,
    title: 'Pre-Install Photos',
    desc: "Ghost-match the rep's shots",
    icon: 'camera-outline',
  },
  {
    key: 'measure',
    n: 4,
    title: 'Verify Job Scope',
    desc: 'Confirm sold products, footage & colors',
    icon: 'ruler-square',
  },
  {
    key: 'post',
    n: 5,
    title: 'Post-Install Photos',
    desc: 'Second ghost pass — finished work',
    icon: 'camera-check-outline',
  },
  {
    key: 'coc',
    n: 6,
    title: 'CoC',
    desc: 'Scan the signed Certificate of Completion',
    icon: 'file-document-edit-outline',
  },
  {
    key: 'return',
    n: 7,
    title: 'Return',
    desc: 'Photo unused material coming back',
    icon: 'truck-delivery-outline',
  },
];

/**
 * Step gating. A step unlocks once every dependency is satisfied.
 * Pickup first → PEC / Pre-Install / Verify Scope in any order →
 * Post-Install needs all three → CoC → Return.
 */
export const STEP_DEPENDENCIES: Record<InstallStepKey, InstallStepKey[]> = {
  pickup: [],
  pec: ['pickup'],
  pre: ['pickup'],
  measure: ['pickup'],
  post: ['pec', 'pre', 'measure'],
  coc: ['post'],
  return: ['coc'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Photo match sections — mirrors the rep's ARC tagger
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tags with `hasRep: false` have no rep reference shot, so there is nothing to
 * ghost-match: they render dimmed and are not required to complete the step.
 * The real API will drive `hasRep` off the rep's actual capture set.
 */
export const PHOTO_SECTIONS: PhotoSection[] = [
  {
    id: 'home',
    name: 'HOME',
    icon: 'home-outline',
    tags: [
      { id: 'back-left', label: 'Back-Left', hasRep: true },
      { id: 'back', label: 'Back', hasRep: true },
      { id: 'back-right', label: 'Back-Right', hasRep: true },
      { id: 'left', label: 'Left Side', hasRep: true },
      { id: 'right', label: 'Right Side', hasRep: false },
      { id: 'front-left', label: 'Front-Left', hasRep: true },
      { id: 'front', label: 'Front', hasRep: true },
      { id: 'front-right', label: 'Front-Right', hasRep: true },
    ],
  },
  {
    id: 'inspection',
    name: 'INSPECT',
    icon: 'magnify',
    tags: [
      { id: 'insp-k', label: 'Inside K-style gutter run', hasRep: true },
      { id: 'insp-box', label: 'Inside Box gutter run', hasRep: false },
      { id: 'insp-super', label: 'Inside Super gutter', hasRep: false },
      { id: 'insp-render', label: 'Close Ups for revRender', hasRep: true },
    ],
  },
  {
    id: 'measure',
    name: 'MEASURE',
    icon: 'ruler',
    tags: [
      { id: 'm-k', label: 'K Style Gutter Width', hasRep: true },
      { id: 'm-box', label: 'Box Gutter Width', hasRep: false },
      { id: 'm-super', label: 'Super Gutter Width', hasRep: false },
      { id: 'm-fw', label: 'Fascia Board Width', hasRep: true },
      { id: 'm-fh', label: 'Fascia Height', hasRep: true },
      { id: 'm-sw', label: 'Soffit Width', hasRep: false },
      { id: 'm-sp', label: 'Soffit Panel', hasRep: false },
    ],
  },
  {
    id: 'roofline',
    name: 'ROOFLINE',
    icon: 'home-roof',
    tags: [
      { id: 'rl-front', label: 'Roofline Front', hasRep: true },
      { id: 'rl-back', label: 'Roofline Back', hasRep: true },
      { id: 'rl-left', label: 'Roofline Left', hasRep: false },
      { id: 'rl-right', label: 'Roofline Right', hasRep: false },
      { id: 'rl-drip', label: 'Drip Edge', hasRep: true },
      { id: 'rl-shingle', label: 'Shingle Lift', hasRep: false },
    ],
  },
  {
    id: 'misc',
    name: 'MISC',
    icon: 'dots-horizontal',
    tags: [
      { id: 'misc-pool', label: 'Pool Cage', hasRep: true },
      { id: 'misc-extra', label: 'Extras', hasRep: false },
    ],
  },
];

/** Every tag the installer must match, flattened across sections. */
export const REQUIRED_PHOTO_TAGS = PHOTO_SECTIONS.flatMap((s) =>
  s.tags.filter((t) => t.hasRep)
);

// ─────────────────────────────────────────────────────────────────────────────
// Pre-existing conditions
// ─────────────────────────────────────────────────────────────────────────────

export const PEC_AREAS: PECArea[] = [
  { id: 'front', label: 'Front Exterior' },
  { id: 'left', label: 'Left Side' },
  { id: 'right', label: 'Right Side' },
  { id: 'back', label: 'Back Exterior' },
  { id: 'roof', label: 'Roof' },
  { id: 'siding', label: 'Siding / Paint' },
  { id: 'drive', label: 'Driveway / Walkways' },
  { id: 'yard', label: 'Landscaping / Yard' },
  { id: 'other', label: 'Other' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Scope discrepancies
// ─────────────────────────────────────────────────────────────────────────────

export const DISCREPANCY_ISSUE_TYPES = [
  'Measurement',
  'Color',
  'Wrong Product',
  'Missing Item',
  'Other',
];

// ─────────────────────────────────────────────────────────────────────────────
// Result reasons
// ─────────────────────────────────────────────────────────────────────────────

export const INSTALLER_RESULT_REASONS: Record<InstallerResultType, string[]> = {
  "Can't Do Work": [
    'Roof Access Unsafe',
    'Structural Issue Found',
    'Product / Measure Mismatch',
    'Weather',
    'HOA / Permit Issue',
  ],
  Reset: ['Homeowner Not Home'],
  'Not Hit': ['Car Broke Down', 'Medical Emergency'],
};

export const INSTALLER_RESULT_TYPES: InstallerResultType[] = [
  "Can't Do Work",
  'Reset',
  'Not Hit',
];

// The result action IS the status: `PUT update-job-status` takes the button label
// verbatim (`"Can't Do Work"` / `"Reset"` / `"Not Hit"`) plus the chosen reason, so
// there is no mapping between the two.

/** Accent per result action, matching the app's semantic colors. */
export const RESULT_COLORS: Record<InstallerResultType, string> = {
  "Can't Do Work": '#FF5630', // error.main
  Reset: '#FFAB00', // warning.main
  'Not Hit': '#212B36', // grey.800
};

// ─────────────────────────────────────────────────────────────────────────────
// Product accents — used when the API doesn't supply `color`
// ─────────────────────────────────────────────────────────────────────────────

export const PRODUCT_PALETTE = ['#4CBB17', '#22C55E', '#8E33FF', '#FFAB00', '#00B8D9'];

export const productColor = (index: number, explicit?: string) =>
  explicit || PRODUCT_PALETTE[index % PRODUCT_PALETTE.length];
