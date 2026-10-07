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

export const STEP_DEPENDENCIES: Record<InstallStepKey, InstallStepKey[]> = {
  pickup: [],
  pec: ['pickup'],
  pre: ['pickup'],
  measure: ['pickup'],
  post: ['pec', 'pre', 'measure'],
  coc: ['post'],
  return: ['coc'],
};

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

export const REQUIRED_PHOTO_TAGS = PHOTO_SECTIONS.flatMap((s) =>
  s.tags.filter((t) => t.hasRep)
);

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

export const DISCREPANCY_ISSUE_TYPES = [
  'Measurement',
  'Color',
  'Wrong Product',
  'Missing Item',
  'Other',
];

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

export const RESULT_STATUS_CODE: Record<
  Exclude<InstallerResultType, 'Reset'>,
  JobResultStatus
> = {
  "Can't Do Work": 'cantDoWork',
  'Not Hit': 'notHit',
};

export const RESET_IN_PROGRESS_STATUS: JobStatus = 'reset';

export const RESULT_STATUS_REQUEST_TYPE: Record<
  InstallerResultType,
  'CANT_DO_WORK' | 'NOT_HIT' | 'RESET'
> = {
  "Can't Do Work": 'CANT_DO_WORK',
  'Not Hit': 'NOT_HIT',
  Reset: 'RESET',
};

export const RESULT_LABEL_KEY: Record<InstallerResultType, TranslationKey> = {
  "Can't Do Work": 'installer.resultCantDoWork',
  Reset: 'installer.resultReset',
  'Not Hit': 'installer.resultNotHit',
};

export const RESULT_COLORS: Record<InstallerResultType, string> = {
  "Can't Do Work": '#FF5630', // error.main
  Reset: '#FFAB00', // warning.main
  'Not Hit': '#212B36', // grey.800
};

export const PRODUCT_PALETTE = ['#4CBB17', '#22C55E', '#8E33FF', '#FFAB00', '#00B8D9'];

const PRODUCT_STYLES: { match: RegExp; color: string; icon: string }[] = [
  { match: /(guard|leaf\s*filter|leaffilter|micro\s*mesh)/i, color: '#22C55E', icon: 'leaf' },
  { match: /gutter|downspout|roofline/i, color: '#00B8D9', icon: 'home-variant' },
  { match: /soffit|porch\s*ceiling|nailer/i, color: '#00B8D9', icon: 'home-outline' },
  { match: /fascia|trim\s*wrap/i, color: '#8E33FF', icon: 'wrench' },
  { match: /light/i, color: '#FFAB00', icon: 'lightbulb-on-outline' },
  { match: /(additional|service|labor|misc)/i, color: '#FFAB00', icon: 'briefcase-outline' },
];

const styleFor = (name?: string) =>
  name ? PRODUCT_STYLES.find((s) => s.match.test(name)) : undefined;

export const productColor = (index: number, explicit?: string, name?: string) =>
  explicit || styleFor(name)?.color || PRODUCT_PALETTE[index % PRODUCT_PALETTE.length];

export const productIcon = (name?: string) =>
  styleFor(name)?.icon || 'package-variant-closed';
