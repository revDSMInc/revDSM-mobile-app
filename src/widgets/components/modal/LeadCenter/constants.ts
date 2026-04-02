export const ONE_LEG_OPTIONS = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

export const RESULT_OPTIONS = [
  { label: 'Demo', value: 'demo' },
  { label: 'No Demo', value: 'noDemo' },
  { label: 'Not Hit', value: 'notHit' },
  { label: 'Reset', value: 'reset' },
  { label: 'Sale', value: 'sale' },
];

export const PAYMENT_METHOD_OPTIONS = [
  { label: 'Check', value: 'check' },
  { label: 'MC/VISA/DSCVR', value: 'mcVisaDscvr' },
  { label: 'AMEX', value: 'amex' },
];

export const BALANCE_PAYMENT_METHOD_OPTIONS = [
  { label: 'Check', value: 'check' },
  { label: 'MC/VISA/DSCVR', value: 'mcVisaDscvr' },
  { label: 'AMEX', value: 'amex' },
  // financing plans
  { label: '2511 (GreenSky)', value: 'greensky2511' },
  { label: '2521 (GreenSky)', value: 'greensky2521' },
  { label: '2531 (GreenSky)', value: 'greensky2531' },
  { label: '1599 (GreenSky)', value: 'greensky1599' },
  { label: '4073 (Wells Fargo)', value: 'wf4073' },
  { label: '4079 (Wells Fargo)', value: 'wf4079' },
  { label: '4091 (Wells Fargo)', value: 'wf4091' },
  { label: '4103 (Wells Fargo)', value: 'wf4103' },
  { label: '4115 (Wells Fargo)', value: 'wf4115' },
];

export const IMAGE_CATEGORIES = [
  {
    id: 'front-view',
    name: 'Front View',
    subCategories: [
      { id: 'front-image', name: 'Front of Home', required: 1 },
      { id: 'front-left', name: 'Front-Left', required: 1 },
      { id: 'front-right', name: 'Front-Right', required: 1 },
    ],
  },
  {
    id: 'side-views',
    name: 'Side Views',
    subCategories: [
      { id: 'left-side', name: 'Left Side', required: 1 },
      { id: 'right-side', name: 'Right Side', required: 1 },
    ],
  },
  {
    id: 'back-view',
    name: 'Back View',
    subCategories: [
      { id: 'back-image', name: 'Back of Home', required: 1 },
      { id: 'back-left', name: 'Back-Left', required: 1 },
      { id: 'back-right', name: 'Back-Right', required: 1 },
    ],
  },
  {
    id: 'gutter-system',
    name: 'Gutter System',
    subCategories: [
      { id: 'inside-k-style-gutter-run', name: 'Inside K-style gutter run', required: 1 },
      { id: 'inside-box-gutter-run', name: 'Inside Box gutter run', required: 1 },
      { id: 'inside-super-gutter', name: 'Inside Super gutter', required: 1 },
    ],
  },
  {
    id: 'measurements',
    name: 'Measurements',
    subCategories: [
      { id: 'k-styler-gutter-width-measurement', name: 'K Style Gutter Width Measurement', required: 1 },
      { id: 'box-gutter-width-measurement', name: 'Box gutter width measurement', required: 1 },
      { id: 'super-gutter-width-measurement', name: 'Super gutter width measurement', required: 1 },
      { id: 'fascia-board-width', name: 'Fascia board width', required: 1 },
      { id: 'fascia-height', name: 'Fascia height', required: 1 },
      { id: 'soffit-width', name: 'Soffit width (house to edge)', required: 1 },
      { id: 'soffit-panel-measurement', name: 'Soffit panel measurement', required: 1 },
    ],
  },
  {
    id: 'miscellaneous',
    name: 'Miscellaneous',
    subCategories: [
      { id: 'pool-screens', name: 'Pool screens', required: 1 },
      { id: 'misc-1', name: 'Miscellaneous 1', required: 1 },
      { id: 'misc-2', name: 'Miscellaneous 2', required: 1 },
      { id: 'misc-3', name: 'Miscellaneous 3', required: 1 },
      { id: 'misc-4', name: 'Miscellaneous 4', required: 1 },
    ],
  },
  {
    id: 'roofline-observation',
    name: 'Roofline Observation',
    subCategories: [
      { id: 'roof-edge-left-side', name: 'Roof Edge — Left Side', required: 1 },
      { id: 'roof-edge-right-side', name: 'Roof Edge — Right Side', required: 1 },
      { id: 'roof-penetration-vent-area', name: 'Roof Penetration / Vent Area', required: 1 },
      { id: 'general-roof-surface-condition', name: 'General Roof Surface Condition', required: 1 },
    ],
  },
];
