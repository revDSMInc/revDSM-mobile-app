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
    id: 'home',
    name: 'Home',
    subCategories: [
      { id: 'front-image', name: 'Front of Home', required: 1, thumbnail: 'front_view' },
      { id: 'front-left', name: 'Front-Left', required: 1, thumbnail: 'front_left' },
      { id: 'front-right', name: 'Front-Right', required: 1, thumbnail: 'front_right' },
      { id: 'left-side', name: 'Left Side', required: 1, thumbnail: 'left_side' },
      { id: 'right-side', name: 'Right Side', required: 1, thumbnail: 'right_side' },
      { id: 'back-image', name: 'Back of Home', required: 1, thumbnail: 'back_view' },
      { id: 'back-left', name: 'Back-Left', required: 1, thumbnail: 'back_left' },
      { id: 'back-right', name: 'Back-Right', required: 1, thumbnail: 'back_right' },
    ],
  },
  {
    id: 'inspection',
    name: 'Inspection',
    subCategories: [
      { id: 'inside-k-style-gutter-run', name: 'Inside K-style gutter run', required: 1, thumbnail: 'gutter_kstyle' },
      { id: 'inside-box-gutter-run', name: 'Inside Box gutter run', required: 1, thumbnail: 'gutter_box' },
      { id: 'inside-super-gutter', name: 'Inside Super gutter', required: 1, thumbnail: 'gutter_super' },
      { id: 'close-ups-for-revrender', name: 'Close Ups for revRender', required: 1, thumbnail: 'gutter_super' },
    ],
  },
  {
    id: 'measurements',
    name: 'Measurements',
    subCategories: [
      { id: 'k-styler-gutter-width-measurement', name: 'K Style Gutter Width Measurement', required: 1, thumbnail: 'k_style_width' },
      { id: 'box-gutter-width-measurement', name: 'Box gutter width measurement', required: 1, thumbnail: 'box_gutter_width' },
      { id: 'super-gutter-width-measurement', name: 'Super gutter width measurement', required: 1, thumbnail: 'super_gutter_width' },
      { id: 'fascia-board-width', name: 'Fascia board width', required: 1, thumbnail: 'fascia_width' },
      { id: 'fascia-height', name: 'Fascia height', required: 1, thumbnail: 'fascia_height' },
      { id: 'soffit-width', name: 'Soffit width (house to edge)', required: 1, thumbnail: 'soffit_width' },
      { id: 'soffit-panel-measurement', name: 'Soffit panel measurement', required: 1, thumbnail: 'soffit_panel' },
    ],
  },
  {
    id: 'miscellaneous',
    name: 'Miscellaneous',
    subCategories: [
      { id: 'pool-screens', name: 'Pool screens', required: 1, thumbnail: 'pool_screens' },
      { id: 'misc-1', name: 'Miscellaneous 1', required: 1, thumbnail: 'misc1' },
      { id: 'misc-2', name: 'Miscellaneous 2', required: 1, thumbnail: 'misc2' },
      { id: 'misc-3', name: 'Miscellaneous 3', required: 1, thumbnail: 'misc3' },
      { id: 'misc-4', name: 'Miscellaneous 4', required: 1, thumbnail: 'misc4' },
    ],
  },
  {
    id: 'roofline-observation',
    name: 'Roofline Observation',
    subCategories: [
      { id: 'roof-edge-left-side', name: 'Roof Edge — Left Side', required: 1, thumbnail: 'roof_edge' },
      { id: 'roof-edge-right-side', name: 'Roof Edge — Right Side', required: 1, thumbnail: 'roof_edge' },
      { id: 'roof-penetration-vent-area', name: 'Roof Penetration / Vent Area', required: 1, thumbnail: 'roof_edge' },
      { id: 'general-roof-surface-condition', name: 'General Roof Surface Condition', required: 1, thumbnail: 'roof_edge' },
    ],
  },
  {
    id: 'roof-inspection',
    name: 'Roof Inspection',
    subCategories: [],
    cardGroups: [
      {
        id: 'granule-loss',
        name: 'Granule Loss',
        subCategories: [
          { id: 'bare-spots-on-shingles', name: 'Bare Spots on Shingles', required: 1, thumbnail: 'bare_spots' },
          { id: 'granules-in-gutters', name: 'Granules in Gutters', required: 1, thumbnail: 'granules_gutters' },
          { id: 'granules-at-downspout', name: 'Granules at Downspout', required: 1, thumbnail: 'granules_downspout' },
        ],
      },
      {
        id: 'curling-cracking',
        name: 'Curling & Cracking Shingles',
        subCategories: [
          { id: 'curling-edges', name: 'Curling Edges', required: 1, thumbnail: 'curling_edges' },
          { id: 'cracked-surface', name: 'Cracked Surface', required: 1, thumbnail: 'cracked_surface' },
          { id: 'curling-corner', name: 'Curling Corner', required: 1, thumbnail: 'curling_corner' },
        ],
      },
      {
        id: 'blistering-buckling',
        name: 'Blistering & Buckling Shingles',
        subCategories: [
          { id: 'blistered-shingles', name: 'Blistered Shingles', required: 1, thumbnail: 'blistered_shingles' },
          { id: 'buckled-shingles', name: 'Buckled Shingles', required: 1, thumbnail: 'buckled_shingles' },
          { id: 'lifted-shingle-field', name: 'Lifted Shingle Field', required: 1, thumbnail: 'lifted_shingle_field' },
        ],
      },
      {
        id: 'missing-loose',
        name: 'Missing or Loose Shingles',
        subCategories: [
          { id: 'missing-shingle-gap', name: 'Missing Shingle Gap', required: 1, thumbnail: 'missing_shingle_gap' },
          { id: 'slipped-shingle', name: 'Slipped Shingle', required: 1, thumbnail: 'slipped_shingle' },
          { id: 'loose-shingle-edge', name: 'Loose Shingle Edge', required: 1, thumbnail: 'loose_shingle_edge' },
        ],
      },
      {
        id: 'algae-streaks',
        name: 'Algae & Streaks',
        subCategories: [
          { id: 'dark-streaks', name: 'Dark Streaks', required: 1, thumbnail: 'dark_streaks' },
          { id: 'algae-coverage', name: 'Algae Coverage', required: 1, thumbnail: 'algae_coverage' },
          { id: 'streak-pattern', name: 'Streak Pattern', required: 1, thumbnail: 'streak_pattern' },
        ],
      },
      {
        id: 'flashing-pipe-boot',
        name: 'Flashing & Pipe Boot Issues',
        subCategories: [
          { id: 'cracked-pipe-boot', name: 'Cracked Pipe Boot', required: 1, thumbnail: 'cracked_pipe_boot' },
          { id: 'tarred-flashing', name: 'Tarred Flashing', required: 1, thumbnail: 'tarred_flashing' },
          { id: 'missing-flashing', name: 'Missing Flashing', required: 1, thumbnail: 'missing_flashing' },
        ],
      },
    ],
  },
  {
    id: 'roof-inspection-plane',
    name: 'Roof Inspection Plane',
    subCategories: [
      { id: 'plane-1', name: 'Plane 1', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-2', name: 'Plane 2', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-3', name: 'Plane 3', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-4', name: 'Plane 4', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-5', name: 'Plane 5', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-6', name: 'Plane 6', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-7', name: 'Plane 7', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-8', name: 'Plane 8', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-9', name: 'Plane 9', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-10', name: 'Plane 10', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-11', name: 'Plane 11', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-12', name: 'Plane 12', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-13', name: 'Plane 13', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-14', name: 'Plane 14', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-15', name: 'Plane 15', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-16', name: 'Plane 16', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-17', name: 'Plane 17', required: 1, thumbnail: 'roof_edge' },
      { id: 'plane-18', name: 'Plane 18', required: 1, thumbnail: 'roof_edge' },
    ],
  },
];

export const INSPECTION_ISSUES = {
  gutters: [
    {
      label: 'Gutter Overflow',
      description:
        'Overflowing gutters are a clear sign of clogging or undersized drainage. Water spilling over the edge accelerates siding damage and foundation erosion.',
    },
    {
      label: 'Gutter Clogged with Debris',
      description:
        'Debris like leaves and pine needles are visibly clogging the gutter system, preventing proper water flow and increasing the risk of overflow and fascia rot.',
    },
    {
      label: 'Shingle Grit in Gutter',
      description:
        'Excessive shingle granules indicate an aging or deteriorating roof. This debris builds up over time, blocking drainage and reducing system effectiveness.',
    },
    {
      label: 'Gutter Pulling Away',
      description:
        'Gutters pulling from the fascia show structural stress and improper fastener hold, usually caused by rot or prolonged water saturation.',
    },
    {
      label: 'Improper Gutter Pitch',
      description:
        'Water pooling along the gutter indicates an incorrect pitch. Without slope, water stagnates and overflows during heavy rain.',
    },
    {
      label: 'Gutter Chipped, Scratched, or Corroded',
      description:
        'Surface damage to gutters, including chipping, scratching, or corrosion, exposes the metal to accelerated wear and water intrusion.',
    },
    {
      label: 'Spike and Ferrule Failure',
      description:
        'Traditional spike and ferrule gutter systems loosen over time, causing sagging and improper water flow.',
    },
    {
      label: 'Crimped or Damaged Downspout',
      description:
        'Crimped downspouts restrict drainage, leading to water backflow at roof edges and pooling near the foundation.',
    },
    {
      label: 'Downspout Installed Incorrectly',
      description:
        'Improper downspout installation directs excessive water to a concentrated area, leading to soil saturation, erosion, or water pooling at the foundation.',
    },
  ],
  fascia: [
    {
      label: 'Rotting Fascia Board',
      description:
        'The fascia board shows visible rot, likely from prolonged exposure to trapped moisture. This weakens the area where gutters are attached.',
    },
    {
      label: 'Peeling Fascia Paint',
      description:
        'Peeling paint suggests water intrusion behind the fascia. If not addressed, moisture will continue to soften the wood.',
    },
    {
      label: 'Fascia Wrap Separating',
      description:
        'Gaps between fascia wrap and wood create a pocket where moisture becomes trapped, leading to hidden rot.',
    },
    {
      label: 'Moisture Between Wrap and Wood',
      description:
        'Evidence of moisture beneath the fascia wrap suggests improper installation or failed sealing, softening the wood over time.',
    },
    {
      label: 'Fascia Cracking or Warping',
      description:
        'Cracks or warping in the fascia signal water damage or structural strain, threatening gutter attachment points.',
    },
    {
      label: 'Blistered or Swollen Wood',
      description:
        'Blistering or swelling along fascia or soffit lines points to prolonged moisture exposure and potential hidden rot.',
    },
    {
      label: 'Bent or Warped Fascia Wrap',
      description:
        'Warped metal wrap creates openings for water infiltration and undermines structural protection.',
    },
    {
      label: 'Rust Streaks on Fascia Wrap',
      description:
        'Rust stains originating from fasteners or wrap edges signal compromised metal integrity and hidden water penetration.',
    },
    {
      label: 'Buckling Metal Wrap from Thermal Expansion',
      description:
        'Wrap material expanding and contracting without relief cuts causes warping, cracking protective barriers.',
    },
    {
      label: 'Split Fascia Boards from Fastener Pressure',
      description:
        'Overdriven nails or screws split fascia boards, weakening the attachment system.',
    },
    {
      label: 'Staining or Discoloration Around Fasteners',
      description:
        'Water leaks through fastener penetrations into fascia, leading to staining and internal wood decay.',
    },
    {
      label: 'Fasteners Missing or Improperly Spaced',
      description:
        'Fastener gaps beyond spec distances lead to wrap detachment and moisture penetration over time.',
    },
  ],
  ventilation: [
    {
      label: 'Painted-Over Soffit Vents',
      description:
        'Painted-over soffits restrict airflow into the attic, causing shingle damage and mold growth.',
    },
    {
      label: 'Mold on Soffit',
      description:
        'Mold visible on the soffit vent indicates condensation and insufficient airflow, compromising attic health.',
    },
    {
      label: 'Clogged Soffit Vent',
      description:
        'Clogged vents block the intake of cool, dry air, leading to extreme attic heat and moisture accumulation.',
    },
    {
      label: 'Broken or Missing Soffit Panel',
      description:
        'A missing or broken soffit panel exposes the attic to pests and uncontrolled moisture entry.',
    },
    {
      label: 'Insulation Blocking Soffit Ventilation',
      description:
        'Over-insulated eaves without ventilation baffles trap warm, moist air in the attic, causing mold and rot.',
    },
    {
      label: 'Improvised or Incomplete Soffit Repairs',
      description:
        'Makeshift soffit repairs leave open gaps, restrict airflow, and compromise energy efficiency.',
    },
  ],
  structural: [
    {
      label: 'Water Streaking on Fascia or Siding',
      description:
        'Water stains suggesting overflowing gutters or improper drip edge installation, causing long-term paint failure.',
    },
    {
      label: 'Sagging Gutter',
      description:
        'A sagging section indicates the gutter is overloaded or pulling loose from deteriorated fascia.',
    },
    {
      label: 'Cracks in Stucco or Siding',
      description:
        'Foundation cracks or erosion beneath the gutterline may stem from years of misdirected runoff.',
    },
    {
      label: 'Roof Shingle Damage Near Gutter',
      description:
        'Damaged shingles suggest backflow or ice damming, with water backing up under shingles due to poor drainage.',
    },
    {
      label: 'Animal Nests in Gutter',
      description:
        'Nests restrict water flow and introduce bacteria, creating weight that strains fasteners and fascia.',
    },
    {
      label: 'Deck Connection Rot (Ledger Board Rot)',
      description:
        'Moisture pooling along the ledger board leads to deck instability and structural risk.',
    },
    {
      label: 'Spike Heads or Nail Pops at Roofline',
      description:
        'Early signs of decking movement due to trapped attic moisture or structural shifting.',
    },
    {
      label: 'Rotten Roof Sheathing at Eaves',
      description:
        'Water intrusion near gutter lines rots roof decking, weakening structural support.',
    },
    {
      label: 'Fascia Pulling Away from Rafter Tails',
      description: 'Movement of fascia boards away from rafters indicates deep water infiltration.',
    },
    {
      label: 'Multiple Spike/Nail Holes in Fascia',
      description: 'Excessive re-nailing suggests chronic gutter loosening and hidden rot issues.',
    },
    {
      label: 'Cracked Deck Boards Near Ledger Connection',
      description: 'Cracks at ledger connection points to walls signal major water intrusion.',
    },
    {
      label: 'Water-Splattered Stucco Below Gutter Line',
      description: 'Stucco staining below gutters shows chronic splashback from improper drainage.',
    },
    {
      label: 'Weeping Mortar Joints',
      description:
        'Mortar lines oozing or darkened under gutters reveal continuous gutter overflow.',
    },
    {
      label: 'Peeling Exterior Paint Only at Gutter Line',
      description:
        'Localized peeling paint directly below gutters is a sign of overflow-driven saturation.',
    },
  ],
  erosion: [
    {
      label: 'Runoff Discharging Too Close to Foundation',
      description:
        'Water runoff is consistently discharging too close to the home’s foundation, leading to soil displacement.',
    },
    {
      label: 'Missing or Inadequate Water Redirection',
      description:
        'Lack of splash blocks or extended downspouts accelerates erosion and may compromise slab integrity.',
    },
    {
      label: 'Stucco Stains and Algae at Base of Wall',
      description:
        'Discolored stucco and algae growth at the wall’s base indicate prolonged moisture exposure.',
    },
    {
      label: 'Foundation Risk: Cracks, Settlement & Moisture',
      description:
        'Erosion increases risk of foundation cracks, structural settlement, and interior water damage.',
    },
    {
      label: 'Erosion at Ground Level',
      description:
        'Water runoff creating soil displacement, trenching, and weakening the foundation’s support structure.',
    },
    {
      label: 'Foundation Saturation Risk',
      description:
        'Prolonged moisture buildup near foundation increases likelihood of cracking and settlement.',
    },
    {
      label: 'Improper Splash Block Placement',
      description:
        'Missing or poorly positioned splash blocks allow uncontrolled runoff to saturate soil.',
    },
    {
      label: 'Mulch or Soil Washing Away From Perimeter',
      description: 'Mulch displacement shows chronic water discharge damaging landscaping.',
    },
    {
      label: 'Standing Water at Downspout Exit',
      description: 'Pooling at downspouts indicates drainage failure and foundation soaking.',
    },
    {
      label: 'Trenching Along Foundation Wall',
      description: 'Visible trenches at the drip line suggest long-term uncontrolled roof runoff.',
    },
    {
      label: 'Settling or Cracking Driveway/Walkway Adjacent to Foundation',
      description: 'Driveway cracks near the home hint at subsoil erosion from poor drainage.',
    },
    {
      label: 'Basement or Crawlspace Musty Odor',
      description: 'Persistent damp smells indoors can trace back to exterior drainage problems.',
    },
    {
      label: 'Downspouts Terminating on Hard Surfaces',
      description: 'Downspouts draining onto driveways cause surface cracking and icy conditions.',
    },
    {
      label: 'Vegetation Growth Against Foundation',
      description:
        'Thick vegetation near foundation holds moisture, increasing risk of degradation.',
    },
    {
      label: 'Splash Erosion Marks at Soil Line',
      description:
        'Heavy splash erosion against siding suggests chronic uncontrolled water runoff.',
    },
    {
      label: 'Foundation Step Cracks at Downspout Locations',
      description:
        'Visible vertical cracks at foundation steps near downspouts show water-induced settlement.',
    },
    {
      label: 'Mulch Volcanoes Around Downspouts',
      description:
        'Unmanaged runoff forms mounds of displaced mulch, showing severe soil disruption.',
    },
    {
      label: 'Reverse Grading Toward Home',
      description:
        'Soil sloping inward traps water against foundation instead of shedding it away.',
    },
    {
      label: 'Downspout Splash Zones Damaging Pavers',
      description: 'Repeated heavy discharge fractures paver stones or concrete at landing areas.',
    },
    {
      label: 'Moss or Algae Growth on Walkways',
      description: 'Persistent moisture from downspouts creates slick, hazardous walkways.',
    },
    {
      label: 'Exterior Mold on Foundation Walls',
      description: 'Mold growing outside on foundation walls points to long-term standing water.',
    },
    {
      label: 'Ground-Level Water Geyser at Buried Drain Exit',
      description:
        'Water bursting upward from clogged buried drains reveals massive drainage failure.',
    },
    {
      label: 'Undermining of Porch or Step Supports',
      description:
        'Water flow under concrete or porch supports leads to settling or collapse over time.',
    },
    {
      label: 'Sinkholes Developing Near Downspouts',
      description: 'Localized soil collapse at downspout exits reveals subterranean washout.',
    },
  ],
};

// Rev Render view groups (same structure as web app REV_RENDER_VIEW_GROUPS)
export const REV_RENDER_VIEW_GROUPS = [
  {
    sectionLabel: 'FRONT VIEWS',
    categoryId: 'Front View',
    views: [
      { id: 'front-image', label: 'Front of Home' },
      { id: 'front-left', label: 'Front-Left' },
      { id: 'front-right', label: 'Front-Right' },
    ],
  },
  {
    sectionLabel: 'SIDE VIEWS',
    categoryId: 'Side Views',
    views: [
      { id: 'right-side', label: 'Right Side' },
      { id: 'left-side', label: 'Left Side' },
    ],
  },
  {
    sectionLabel: 'BACK VIEWS',
    categoryId: 'Back View',
    views: [
      { id: 'back-image', label: 'Back of Home' },
      { id: 'back-left', label: 'Back-Left' },
      { id: 'back-right', label: 'Back-Right' },
    ],
  },
  {
    sectionLabel: 'Gutter system',
    categoryId: 'Gutter System',
    views: [
      { id: 'inside-k-style-gutter-run', label: 'Inside K-Style Gutter run' },
      { id: 'inside-box-gutter-run', label: 'Inside Box Gutter run' },
      { id: 'inside-super-gutter', label: 'Inside Super gutter' },
    ],
  },
  {
    sectionLabel: 'MEASUREMENTS',
    categoryId: 'Measurements',
    views: [
      { id: 'k-styler-gutter-width-measurement', label: 'K Style Gutter Width Measurement' },
      { id: 'box-gutter-width-measurement', label: 'Box gutter width measurement' },
      { id: 'super-gutter-width-measurement', label: 'Super gutter width measurement' },
      { id: 'fascia-board-width', label: 'Fascia board width' },
      { id: 'fascia-height', label: 'Fascia height' },
      { id: 'soffit-width', label: 'Soffit width (house to edge)' },
      { id: 'soffit-panel-measurement', label: 'Soffit panel measurement' },
    ],
  },
  {
    sectionLabel: 'MISCELLANEOUS',
    categoryId: 'Miscellaneous',
    views: [
      { id: 'pool-screens', label: 'Pool screens' },
      { id: 'misc-1', label: 'Miscellaneous 1' },
      { id: 'misc-2', label: 'Miscellaneous 2' },
      { id: 'misc-3', label: 'Miscellaneous 3' },
      { id: 'misc-4', label: 'Miscellaneous 4' },
    ],
  },
  {
    sectionLabel: 'ROOFLINE OBSERVATION',
    categoryId: 'Roofline Observation',
    views: [
      { id: 'roof-edge-left-side', label: 'Roof Edge — Left Side' },
      { id: 'roof-edge-right-side', label: 'Roof Edge — Right Side' },
      { id: 'roof-penetration-vent-area', label: 'Roof Penetration / Vent Area' },
      { id: 'general-roof-surface-condition', label: 'General Roof Surface Condition' },
    ],
  },
];
// Rev Render color palettes (ported from web app)
export const REV_RENDER_COLORS = {
  fascia: [
    { name: 'White', hex: '#E7E7E2' },
    { name: 'Almond', hex: '#D8D4C0' },
    { name: 'Classic Cream', hex: '#D8D5B6' },
    { name: 'Linen', hex: '#D0D0C3' },
    { name: 'Cameo', hex: '#D0CCB6' },
    { name: 'Desert Sand', hex: '#C4C0B0' },
    { name: 'Silver Grey', hex: '#B9B8B0' },
    { name: 'Sandtone', hex: '#BCB195' },
    { name: 'Harbor Grey', hex: '#B5AFAB' },
    { name: 'Wicker', hex: '#B6AF97' },
    { name: 'Jefferson Tan', hex: '#A9A79D' },
    { name: 'Victorian Grey', hex: '#9D9B91' },
    { name: 'Pebblestone Clay', hex: '#A49A84' },
    { name: 'Rugged Canyon', hex: '#9B9481' },
    { name: 'Montana Suede', hex: '#968979' },
    { name: 'Terra Bronze', hex: '#928776' },
    { name: 'London Brown', hex: '#8F7F76' },
    { name: 'Charcoal Grey', hex: '#7E807F' },
    { name: 'Royal Brown', hex: '#86665E' },
    { name: 'Evergreen', hex: '#46714E' },
    { name: 'Russet Red', hex: '#A9443B' },
    { name: 'Musket Brown', hex: '#65564F' },
    { name: 'Dark Bronze', hex: '#55524E' },
    { name: 'Black', hex: '#1B1B1B' },
  ],
  gutter: [
    { name: '80 Degree White', hex: '#EBEAE5' },
    { name: 'White', hex: '#E7E7E2' },
    { name: 'Almond', hex: '#D8D4C0' },
    { name: 'Classic Cream', hex: '#D8D5B6' },
    { name: 'Linen', hex: '#D0D0C3' },
    { name: 'Cameo', hex: '#D0CCB6' },
    { name: 'Desert Sand', hex: '#C4C0B0' },
    { name: 'Silver Grey', hex: '#B9B8B0' },
    { name: 'Sandtone', hex: '#BCB195' },
    { name: 'Wicker', hex: '#B6AF97' },
    { name: 'Jefferson Tan', hex: '#A9A79D' },
    { name: 'Victorian Grey', hex: '#9D9B91' },
    { name: 'Pebblestone Clay', hex: '#A49A84' },
    { name: 'Rugged Canyon', hex: '#9B9481' },
    { name: 'Montana Suede', hex: '#968979' },
    { name: 'Terra Bronze', hex: '#928776' },
    { name: 'London Brown', hex: '#8F7F76' },
    { name: 'Traditional Blue', hex: '#768F94' },
    { name: 'Terratone', hex: '#9D9276' },
    { name: 'English Wedgewood', hex: '#8C9996' },
    { name: 'Cocoa Brown', hex: '#A88F75' },
    { name: 'Dove Gray', hex: '#888884' },
    { name: 'Pearl Gray', hex: '#838580' },
    { name: 'Beaver Brown', hex: '#9D7F6B' },
    { name: 'Deerskin', hex: '#9D8A65' },
    { name: 'Charcoal Grey', hex: '#7E807F' },
    { name: 'Royal Brown', hex: '#86665E' },
    { name: 'Evergreen', hex: '#46714E' },
    { name: 'Musket Brown', hex: '#65564F' },
    { name: 'Dark Bronze', hex: '#55524E' },
    { name: 'Scotch Red', hex: '#A5453B' },
    { name: 'Russet Red', hex: '#A9443B' },
    { name: 'Bronze', hex: '#302E2C' },
    { name: 'Black', hex: '#2D2E2E' },
  ],
  hiddenVentSoffit: [
    { name: 'White', hex: '#E7E7E2' },
    { name: 'Almond', hex: '#D8D4C0' },
    { name: 'Classic Cream', hex: '#D8D5B6' },
    { name: 'Linen', hex: '#D0D0C3' },
    { name: 'Cameo', hex: '#D0CCB6' },
    { name: 'Desert Sand', hex: '#C4C0B0' },
    { name: 'Silver Grey', hex: '#B9B8B0' },
    { name: 'Sandtone', hex: '#BCB195' },
    { name: 'Harbor Grey', hex: '#B5AFAB' },
    { name: 'Wicker', hex: '#B6AF97' },
    { name: 'Victorian Grey', hex: '#9D9B91' },
    { name: 'Pebblestone Clay', hex: '#A49A84' },
    { name: 'Rugged Canyon', hex: '#9B9481' },
    { name: 'Montana Suede', hex: '#968979' },
    { name: 'English Wedgewood', hex: '#8C9996' },
    { name: 'Deep Granite', hex: '#717C73' },
    { name: 'Autumn Harvest', hex: '#A0701F' },
    { name: 'Misty Shadow', hex: '#4A4D39' },
    { name: 'Musket Brown', hex: '#65564F' },
    { name: 'Russet Red', hex: '#A9443B' },
    { name: 'Black', hex: '#2D2E2E' },
  ],
  pinholeSoffit: [
    { name: 'White', hex: '#E7E7E2' },
    { name: 'Almond', hex: '#D8D4C0' },
    { name: 'Classic Cream', hex: '#D8D5B6' },
    { name: 'Linen', hex: '#D0D0C3' },
    { name: 'Cameo', hex: '#D0CCB6' },
    { name: 'Desert Sand', hex: '#C4C0B0' },
    { name: 'Silver Grey', hex: '#B9B8B0' },
    { name: 'Sandtone', hex: '#BCB195' },
    { name: 'Harbor Grey', hex: '#B5AFAB' },
    { name: 'Wicker', hex: '#B6AF97' },
    { name: 'Victorian Grey', hex: '#9D9B91' },
    { name: 'Pebblestone Clay', hex: '#A49A84' },
    { name: 'Everest', hex: '#7E8D91' },
    { name: 'Musket Brown', hex: '#65564F' },
    { name: 'Black', hex: '#2D2E2E' },
  ],
  common: [
    { name: 'White', hex: '#E7E7E2' },
    { name: 'Almond', hex: '#D8D4C0' },
    { name: 'Classic Cream', hex: '#D8D5B6' },
    { name: 'Linen', hex: '#D0D0C3' },
    { name: 'Cameo', hex: '#D0CCB6' },
    { name: 'Desert Sand', hex: '#C4C0B0' },
    { name: 'Silver Grey', hex: '#B9B8B0' },
    { name: 'Sandtone', hex: '#BCB195' },
    { name: 'Wicker', hex: '#B6AF97' },
    { name: 'Victorian Grey', hex: '#9D9B91' },
    { name: 'Pebblestone Clay', hex: '#A49A84' },
    { name: 'Musket Brown', hex: '#65564F' },
    { name: 'Black', hex: '#2D2E2E' },
  ],
};
