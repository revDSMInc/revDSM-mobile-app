import type {
  InstallStep,
  InstallStepKey,
  PhotoSection,
  PECArea,
  InstallerResultType,
  JobResultStatus,
  JobStatus,
} from '../config/types/installer';
import type { TranslationKey } from '../i18n/translations';

// ─────────────────────────────────────────────────────────────────────────────
// Install timeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 7 install steps.
 *
 * `title` / `desc` are the ENGLISH source strings and stay here so this file still reads
 * as the definition of the timeline. `titleKey` / `descKey` are what the UI renders
 * through `t()` — the English above is then the fallback the translator sees, not a
 * second copy that can drift.
 */
export const INSTALL_STEPS: InstallStep[] = [
  {
    key: 'pickup',
    n: 1,
    title: 'Pickup',
    titleKey: 'installer.stepPickup',
    desc: 'Photo the material loaded for this job',
    descKey: 'installer.stepPickupDesc',
    icon: 'truck-outline',
  },
  {
    key: 'pec',
    n: 2,
    title: 'Pre-Existing Conditions',
    titleKey: 'installer.stepPec',
    desc: 'Flag & photo site conditions before work',
    descKey: 'installer.stepPecDesc',
    icon: 'clipboard-alert-outline',
  },
  {
    key: 'pre',
    n: 3,
    title: 'Pre-Install Photos',
    titleKey: 'installer.stepPre',
    desc: "Ghost-match the rep's shots",
    descKey: 'installer.stepPreDesc',
    icon: 'camera-outline',
  },
  {
    key: 'measure',
    n: 4,
    title: 'Verify Job Scope',
    titleKey: 'installer.stepMeasure',
    desc: 'Confirm sold products, footage & colors',
    descKey: 'installer.stepMeasureDesc',
    icon: 'ruler-square',
  },
  {
    key: 'post',
    n: 5,
    title: 'Post-Install Photos',
    titleKey: 'installer.stepPost',
    desc: 'Second ghost pass — finished work',
    descKey: 'installer.stepPostDesc',
    // `camera-check-outline` does not exist in the bundled MaterialCommunityIcons set,
    // so it rendered as the fallback "?". `camera-retake-outline` does, and says the
    // right thing for a second pass over the same shots.
    icon: 'camera-retake-outline',
  },
  {
    key: 'coc',
    n: 6,
    title: 'CoC',
    titleKey: 'installer.stepCoc',
    desc: 'Scan the signed Certificate of Completion',
    descKey: 'installer.stepCocDesc',
    icon: 'file-document-edit-outline',
  },
  {
    key: 'return',
    n: 7,
    title: 'Return',
    titleKey: 'installer.stepReturn',
    desc: 'Photo unused material coming back',
    descKey: 'installer.stepReturnDesc',
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

/**
 * `label` is the ENGLISH string and stays authoritative: it is what travels to the server
 * as a condition's `label`, and what `installer-hydrate.ts` matches on to map a stored
 * condition back to its area. Translating it would break both. `labelKey` is what the UI
 * renders.
 */
export const PEC_AREAS: PECArea[] = [
  { id: 'front', label: 'Front Exterior', labelKey: 'installer.areaFront' },
  { id: 'left', label: 'Left Side', labelKey: 'installer.areaLeft' },
  { id: 'right', label: 'Right Side', labelKey: 'installer.areaRight' },
  { id: 'back', label: 'Back Exterior', labelKey: 'installer.areaBack' },
  { id: 'roof', label: 'Roof', labelKey: 'installer.areaRoof' },
  { id: 'siding', label: 'Siding / Paint', labelKey: 'installer.areaSiding' },
  { id: 'drive', label: 'Driveway / Walkways', labelKey: 'installer.areaDrive' },
  { id: 'yard', label: 'Landscaping / Yard', labelKey: 'installer.areaYard' },
  { id: 'other', label: 'Other', labelKey: 'installer.areaOther' },
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

/**
 * Button label → the status code the API takes.
 *
 * The two are NOT the same string: the installer reads "Can't Do Work", the wire
 * carries `cantDoWork`. Reset has no entry because it has no fixed code — which of the
 * two routes it takes depends on the job (see `RESET_IN_PROGRESS_STATUS`).
 */
export const RESULT_STATUS_CODE: Record<
  Exclude<InstallerResultType, 'Reset'>,
  JobResultStatus
> = {
  "Can't Do Work": 'cantDoWork',
  'Not Hit': 'notHit',
};

/**
 * Reset takes ONE OF TWO routes, decided by the job's own state:
 *
 *  - **completed / resulted** → `PUT installer/v1/{id}/reset`. There is a result to undo,
 *    and that endpoint is what reopens a closed job; the server decides what it returns
 *    to and answers with `{ previousStatus, status }`.
 *  - **still in progress** → `PUT installer/v1/update/{id}` with this status and the
 *    `statusReason`, i.e. exactly what Can't Do Work and Not Hit do. Nothing has closed
 *    the job, so there is nothing to reopen — sending it to the reset endpoint asks the
 *    server to undo a result that was never recorded. What the crew means here is "wipe
 *    this visit and start over", which is a transition with a reason, not a reopen.
 *
 * ⚠️ Lower-case `reset` — the wire value, not the `Reset` button label. The two differ
 * by one character and only one of them is accepted.
 */
export const RESET_IN_PROGRESS_STATUS: JobStatus = 'reset';

/**
 * Button label per result type.
 *
 * `InstallerResultType` stays the ENGLISH string because it is also the identity the log
 * and the code map key off — translating the union itself would make `RESULT_STATUS_CODE`
 * lookups fail the moment someone switches language. So the type is the id and this is
 * what the installer reads.
 */
export const RESULT_LABEL_KEY: Record<InstallerResultType, TranslationKey> = {
  "Can't Do Work": 'installer.resultCantDoWork',
  Reset: 'installer.resultReset',
  'Not Hit': 'installer.resultNotHit',
};

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

/**
 * Accent + glyph per sold product, so a scope card reads the way the same product reads
 * on the sales side (gutters blue, leaf guards green, fascia purple, lighting amber).
 *
 * Matched on a NORMALISED name — the subcategory label is portal-authored and arrives
 * as "Gutters" / "Gutter Guards" / "LeafFilter" depending on the company — and anything
 * unrecognised falls through to the palette rotation and the generic package glyph, so
 * a product this list has never heard of still gets a distinct colour.
 */
const PRODUCT_STYLES: { match: RegExp; color: string; icon: string }[] = [
  // Guards before gutters: "Gutter Guards" contains "gutter" and would otherwise be
  // claimed by the rule below it.
  { match: /(guard|leaf\s*filter|leaffilter|micro\s*mesh)/i, color: '#22C55E', icon: 'leaf' },
  { match: /gutter|downspout|roofline/i, color: '#00B8D9', icon: 'home-variant' },
  { match: /soffit|porch\s*ceiling|nailer/i, color: '#00B8D9', icon: 'home-outline' },
  { match: /fascia|trim\s*wrap/i, color: '#8E33FF', icon: 'wrench' },
  { match: /light/i, color: '#FFAB00', icon: 'lightbulb-on-outline' },
  { match: /(additional|service|labor|misc)/i, color: '#FFAB00', icon: 'briefcase-outline' },
];

const styleFor = (name?: string) =>
  name ? PRODUCT_STYLES.find((s) => s.match.test(name)) : undefined;

/**
 * The card accent. An explicit API colour always wins; then the product's own name;
 * then the rotation, so two unnamed products are still told apart.
 */
export const productColor = (index: number, explicit?: string, name?: string) =>
  explicit || styleFor(name)?.color || PRODUCT_PALETTE[index % PRODUCT_PALETTE.length];

/** MaterialCommunityIcons glyph for a sold product. */
export const productIcon = (name?: string) =>
  styleFor(name)?.icon || 'package-variant-closed';
