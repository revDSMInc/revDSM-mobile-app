export interface VerticalItem {
  id: string;
  name: string;
  cost: number;
  retail: number;
  unit?: string;
  vertical?: string;
  cardId?: string;
}

export interface VerticalCard {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  iconBg: string;
  sections: {
    label: string | null;
    items: VerticalItem[];
  }[];
}

export interface VerticalCategory {
  icon: string;
  color: string;
  cards: VerticalCard[];
}

export const verticals: Record<string, VerticalCategory> = {
  'Gutters / Roofline': {
    icon: '🏠',
    color: '#22c55e',
    cards: [
      {
        id: 'gutters',
        title: 'Gutters',
        subtitle: 'Gutter installation and accessories',
        icon: '🏠',
        iconBg: '#e0f2fe',
        sections: [
          {
            label: 'All Stories',
            items: [
              { id: 'gutter5DsE', name: '5" Gutter/DS/E', cost: 7.25, retail: 14.5 },
              { id: 'gutter6Ft1', name: '6" Gutter/DS/Elbows', cost: 7.5, retail: 15.0 },
              { id: 'gutter7DsE', name: '7" Gutter/DS/Elbows', cost: 10.0, retail: 20.0 },
            ],
          },
          {
            label: 'Extras',
            items: [
              { id: 'wedges', name: 'Wedges', cost: 1.125, retail: 2.25 },
              { id: 'straps', name: 'Roof Straps', cost: 1.125, retail: 2.25 },
              { id: 'modifyHeight', name: 'Modify Height/R&R', cost: 1.25, retail: 2.5 },
              { id: 'groundSpout', name: 'GroundSpout', cost: 15.75, retail: 31.5 },
              { id: 'replaceCorner', name: 'Replace Corner Miter', cost: 31.25, retail: 62.5 },
              { id: 'extendedSplashGuard', name: 'Extended Splash Guard', cost: 1.75, retail: 3.5 },
              { id: 'extendedSplashGuard032', name: 'Extended .032 Splash Guard', cost: 7.25, retail: 14.5 },
            ],
          },
        ],
      },
      {
        id: 'gutterGuards',
        title: 'Gutter Guards',
        subtitle: 'Gutter Guard measurements by story',
        icon: '🍃',
        iconBg: '#dcfce7',
        sections: [
          {
            label: 'All Stories',
            items: [
              { id: 'versaMaxFt1', name: 'Micro Mesh Special', cost: 15.75, retail: 31.5 },
              { id: 'csr', name: 'C-S-R', cost: 2.25, retail: 4.5 },
            ],
          },
          {
            label: 'Story 1',
            items: [
              { id: 'versa6Ft1', name: '6" Micro Mesh', cost: 12.5, retail: 25.0 },
              { id: 'versa7Ft1', name: '7" Micro Mesh', cost: 12.5, retail: 25.0 },
              { id: 'filter45Ft1', name: '4" & 5" Micro Mesh', cost: 12.25, retail: 24.5 },
            ],
          },
          {
            label: 'Story 2',
            items: [
              { id: 'versa6Ft2', name: '6" Micro Mesh', cost: 13.25, retail: 26.5 },
              { id: 'versa7Ft2', name: '7" Micro Mesh', cost: 13.25, retail: 26.5 },
              { id: 'filter45Ft2', name: '4" & 5" Micro Mesh', cost: 13.0, retail: 26.0 },
            ],
          },
          {
            label: 'Story 3',
            items: [
              { id: 'versa6Ft3', name: '6" Micro Mesh', cost: 13.75, retail: 27.5 },
              { id: 'versa7Ft3', name: '7" Micro Mesh', cost: 13.75, retail: 27.5 },
              { id: 'filter45Ft3', name: '4" & 5" Micro Mesh', cost: 13.5, retail: 27.0 },
            ],
          },
          {
            label: 'Extras',
            items: [
              { id: 'cornersFilter', name: 'Corners (Filter)', cost: 9.5, retail: 19.0 },
              { id: 'sawzallHanger', name: 'Sawzall Hanger', cost: 0.5, retail: 1.0 },
              { id: 'removeProtection', name: 'Remove Protection', cost: 1.0, retail: 2.0 },
              { id: 'ribbedRoof', name: 'Ribbed Roof', cost: 1.25, retail: 2.5 },
            ],
          },
        ],
      },
      {
        id: 'soffit',
        title: 'Soffit',
        subtitle: 'Soffit installation services',
        icon: '🏡',
        iconBg: '#e0f2fe',
        sections: [
          {
            label: null,
            items: [
              { id: 'vinylSoffit', name: 'Vinyl Soffit', cost: 7.25, retail: 14.5 },
              { id: 'porchCeiling', name: 'Porch Ceiling Soffit (sqft)', cost: 4.75, retail: 9.5 },
              { id: 'nailerBuildOut', name: 'Nailer Build Out', cost: 3.25, retail: 6.5 },
            ],
          },
        ],
      },
      {
        id: 'fascia',
        title: 'Fascia',
        subtitle: 'Fascia board and trim services',
        icon: '🔧',
        iconBg: '#ede9fe',
        sections: [
          {
            label: null,
            items: [
              { id: 'trimWrap', name: 'Trim Wrap [Fascia]', cost: 5.75, retail: 11.5 },
              { id: 'fasciaBoard', name: 'Fascia Board', cost: 8.0, retail: 16.0 },
              { id: 'aluminumFasciaBoard', name: 'Aluminum 2"x2" Fascia Board', cost: 8.0, retail: 16.0 },
            ],
          },
        ],
      },
      {
        id: 'additionalServices',
        title: 'Additional Services',
        subtitle: 'Extra labor and services',
        icon: '💼',
        iconBg: '#fef9c3',
        sections: [
          {
            label: null,
            items: [
              { id: 'extraLabor', name: 'Extra Labor', cost: 25.0, retail: 50.0 },
              { id: 'screens', name: 'Number of Screens', cost: 23.5, retail: 47.0, unit: '/ea' },
            ],
          },
        ],
      },
    ],
  },
  Roofing: {
    icon: '🔨',
    color: '#f59e0b',
    cards: [
      {
        id: 'roofing_shingles',
        title: 'Shingles',
        subtitle: 'Shingle materials and brands',
        icon: '🔨',
        iconBg: '#fef3c7',
        sections: [
          {
            label: 'Product Lines',
            items: [
              { id: 'rfShngl3Tab', name: '3-Tab (25-year)', cost: 52.5, retail: 105, unit: '/sq' },
              { id: 'rfShnglArch', name: 'Architectural (30-year)', cost: 75, retail: 150, unit: '/sq' },
              { id: 'rfShnglPremArch', name: 'Premium Architectural (50-year)', cost: 115, retail: 230, unit: '/sq' },
              { id: 'rfShnglDesigner', name: 'Designer', cost: 140, retail: 280, unit: '/sq' },
            ],
          },
        ],
      },
      {
        id: 'roofing_underlayment',
        title: 'Underlayment & Moisture',
        subtitle: 'Underlayment and ice protection',
        icon: '🛡️',
        iconBg: '#dbeafe',
        sections: [
          {
            label: 'Underlayment',
            items: [
              { id: 'rfUnderFelt15', name: 'Felt #15', cost: 0.075, retail: 0.15, unit: '/sq ft' },
              { id: 'rfUnderFelt30', name: 'Felt #30', cost: 0.11, retail: 0.22, unit: '/sq ft' },
              { id: 'rfUnderSynthetic', name: 'Synthetic', cost: 0.175, retail: 0.35, unit: '/sq ft' },
              { id: 'rfUnderPeelStick', name: 'Peel-and-Stick', cost: 0.375, retail: 0.75, unit: '/sq ft' },
            ],
          },
          {
            label: 'Ice & Water Shield',
            items: [
              { id: 'rfIceWaterShield', name: 'Ice & Water Shield', cost: 0.75, retail: 1.5, unit: '/sq ft' },
            ],
          },
          {
            label: 'Drip Edge & Starter',
            items: [
              { id: 'rfDripEdgeAlum', name: 'Aluminum Drip Edge', cost: 0.75, retail: 1.5, unit: '/lin ft' },
              { id: 'rfDripEdgeGalv', name: 'Galvanized Steel Drip Edge', cost: 0.875, retail: 1.75, unit: '/lin ft' },
              { id: 'rfStarterStrip', name: 'Starter Strip', cost: 0.625, retail: 1.25, unit: '/lin ft' },
            ],
          },
        ],
      },
      {
        id: 'roofing_ridge_vent',
        title: 'Ridge & Ventilation',
        subtitle: 'Ridge caps and venting',
        icon: '💨',
        iconBg: '#dcfce7',
        sections: [
          {
            label: null,
            items: [
              { id: 'rfRidgeCapStd', name: 'Standard Ridge Cap', cost: 1.75, retail: 3.5, unit: '/lin ft' },
              { id: 'rfRidgeCapHigh', name: 'High-Profile Ridge Cap', cost: 2.5, retail: 5.0, unit: '/lin ft' },
              { id: 'rfRidgeVentCont', name: 'Continuous Ridge Vent', cost: 6.0, retail: 12.0, unit: '/lin ft' },
              { id: 'rfBoxVent', name: 'Box Vent', cost: 22.5, retail: 45.0, unit: '/each' },
              { id: 'rfPipeBoot', name: 'Pipe Boot', cost: 11.0, retail: 22.0, unit: '/each' },
            ],
          },
        ],
      },
      {
        id: 'roofing_flashing',
        title: 'Flashing',
        subtitle: 'All flashing types',
        icon: '⚡',
        iconBg: '#fef9c3',
        sections: [
          {
            label: null,
            items: [
              { id: 'rfFlashChimneyFull', name: 'Chimney Flashing (full replace)', cost: 175, retail: 350 },
              { id: 'rfFlashChimneySpot', name: 'Chimney Flashing (spot repair)', cost: 87.5, retail: 175 },
              { id: 'rfFlashSkylight', name: 'Skylight Flashing', cost: 62.5, retail: 125, unit: '/unit' },
              { id: 'rfFlashStep', name: 'Step Flashing', cost: 3.25, retail: 6.5, unit: '/lin ft' },
              { id: 'rfValleyMetal', name: 'Valley Metal', cost: 2.0, retail: 4.0, unit: '/lin ft' },
            ],
          },
        ],
      },
      {
        id: 'roofing_decking',
        title: 'Decking',
        subtitle: 'Decking repair and replacement',
        icon: '🪵',
        iconBg: '#ffedd5',
        sections: [
          {
            label: null,
            items: [
              { id: 'rfDeckSpotRepair', name: 'Spot Repair', cost: 40, retail: 80, unit: '/sheet' },
              { id: 'rfDeckFullReplace', name: 'Full Replacement', cost: 40, retail: 80, unit: '/sheet' },
            ],
          },
        ],
      },
      {
        id: 'roofing_tearoff',
        title: 'Tear-Off',
        subtitle: 'By story and layer count',
        icon: '🏗️',
        iconBg: '#fce7f3',
        sections: [
          {
            label: 'Story 1',
            items: [
              { id: 'rfTearoff1_1L', name: '1 Layer', cost: 67.5, retail: 135, unit: '/sq' },
              { id: 'rfTearoff1_2L', name: '2 Layers', cost: 115, retail: 230, unit: '/sq' },
              { id: 'rfTearoff1_3L', name: '3+ Layers', cost: 162.5, retail: 325, unit: '/sq' },
            ],
          },
          {
            label: 'Story 2',
            items: [
              { id: 'rfTearoff2_1L', name: '1 Layer', cost: 75.5, retail: 151, unit: '/sq' },
              { id: 'rfTearoff2_2L', name: '2 Layers', cost: 129, retail: 258, unit: '/sq' },
              { id: 'rfTearoff2_3L', name: '3+ Layers', cost: 182, retail: 364, unit: '/sq' },
            ],
          },
          {
            label: 'Story 3',
            items: [
              { id: 'rfTearoff3_1L', name: '1 Layer', cost: 82.5, retail: 165, unit: '/sq' },
              { id: 'rfTearoff3_2L', name: '2 Layers', cost: 140.5, retail: 281, unit: '/sq' },
              { id: 'rfTearoff3_3L', name: '3+ Layers', cost: 198.5, retail: 397, unit: '/sq' },
            ],
          },
        ],
      },
      {
        id: 'roofing_labor',
        title: 'Labor',
        subtitle: 'By story and pitch',
        icon: '👷',
        iconBg: '#fef9c3',
        sections: [
          {
            label: 'Story 1',
            items: [
              { id: 'rfLabor1_Std', name: 'Standard Pitch (4/12 and under)', cost: 2.5, retail: 5.0, unit: '/sq ft' },
              { id: 'rfLabor1_Med', name: 'Medium Pitch (5/12–7/12)', cost: 2.75, retail: 5.5, unit: '/sq ft' },
              { id: 'rfLabor1_Steep', name: 'Steep Pitch (8/12–10/12)', cost: 3.125, retail: 6.25, unit: '/sq ft' },
              { id: 'rfLabor1_VSteep', name: 'Very Steep (11/12+)', cost: 3.5, retail: 7.0, unit: '/sq ft' },
            ],
          },
          {
            label: 'Story 2',
            items: [
              { id: 'rfLabor2_Std', name: 'Standard Pitch (4/12 and under)', cost: 2.8, retail: 5.6, unit: '/sq ft' },
              { id: 'rfLabor2_Med', name: 'Medium Pitch (5/12–7/12)', cost: 3.08, retail: 6.16, unit: '/sq ft' },
              { id: 'rfLabor2_Steep', name: 'Steep Pitch (8/12–10/12)', cost: 3.5, retail: 7.0, unit: '/sq ft' },
              { id: 'rfLabor2_VSteep', name: 'Very Steep (11/12+)', cost: 3.92, retail: 7.84, unit: '/sq ft' },
            ],
          },
          {
            label: 'Story 3',
            items: [
              { id: 'rfLabor3_Std', name: 'Standard Pitch (4/12 and under)', cost: 3.05, retail: 6.1, unit: '/sq ft' },
              { id: 'rfLabor3_Med', name: 'Medium Pitch (5/12–7/12)', cost: 3.355, retail: 6.71, unit: '/sq ft' },
              { id: 'rfLabor3_Steep', name: 'Steep Pitch (8/12–10/12)', cost: 3.815, retail: 7.63, unit: '/sq ft' },
              { id: 'rfLabor3_VSteep', name: 'Very Steep (11/12+)', cost: 4.27, retail: 8.54, unit: '/sq ft' },
            ],
          },
        ],
      },
    ],
  },
  Windows: {
    icon: '🪟',
    color: '#3b82f6',
    cards: [
      {
        id: 'windows_singlehung',
        title: 'Single-Hung',
        subtitle: 'Frame × glass baked-in pricing',
        icon: '🪟',
        iconBg: '#dbeafe',
        sections: [
          { label: 'Vinyl', items: [
            { id: 'winSH_VinylStd', name: 'Standard Double-Pane', cost: 325, retail: 650, unit: '/unit' },
            { id: 'winSH_VinylLowE', name: 'Low-E Double-Pane', cost: 373.5, retail: 747, unit: '/unit' },
            { id: 'winSH_VinylImpact', name: 'Impact/Laminated', cost: 422.5, retail: 845, unit: '/unit' },
          ]},
          { label: 'Aluminum', items: [
            { id: 'winSH_AlumStd', name: 'Standard Double-Pane', cost: 373.5, retail: 747, unit: '/unit' },
            { id: 'winSH_AlumLowE', name: 'Low-E Double-Pane', cost: 430, retail: 860, unit: '/unit' },
            { id: 'winSH_AlumImpact', name: 'Impact/Laminated', cost: 486, retail: 972, unit: '/unit' },
          ]},
          { label: 'Fiberglass', items: [
            { id: 'winSH_FiberStd', name: 'Standard Double-Pane', cost: 455, retail: 910, unit: '/unit' },
            { id: 'winSH_FiberLowE', name: 'Low-E Double-Pane', cost: 523, retail: 1046, unit: '/unit' },
            { id: 'winSH_FiberImpact', name: 'Impact/Laminated', cost: 591.5, retail: 1183, unit: '/unit' },
          ]},
        ],
      },
      {
        id: 'windows_doublehung',
        title: 'Double-Hung',
        subtitle: 'Frame × glass baked-in pricing',
        icon: '🪟',
        iconBg: '#dbeafe',
        sections: [
          { label: 'Vinyl', items: [
            { id: 'winDH_VinylStd', name: 'Standard Double-Pane', cost: 325, retail: 650, unit: '/unit' },
            { id: 'winDH_VinylLowE', name: 'Low-E Double-Pane', cost: 373.5, retail: 747, unit: '/unit' },
            { id: 'winDH_VinylImpact', name: 'Impact/Laminated', cost: 422.5, retail: 845, unit: '/unit' },
          ]},
          { label: 'Aluminum', items: [
            { id: 'winDH_AlumStd', name: 'Standard Double-Pane', cost: 373.5, retail: 747, unit: '/unit' },
            { id: 'winDH_AlumLowE', name: 'Low-E Double-Pane', cost: 430, retail: 860, unit: '/unit' },
            { id: 'winDH_AlumImpact', name: 'Impact/Laminated', cost: 486, retail: 972, unit: '/unit' },
          ]},
          { label: 'Fiberglass', items: [
            { id: 'winDH_FiberStd', name: 'Standard Double-Pane', cost: 455, retail: 910, unit: '/unit' },
            { id: 'winDH_FiberLowE', name: 'Low-E Double-Pane', cost: 523, retail: 1046, unit: '/unit' },
            { id: 'winDH_FiberImpact', name: 'Impact/Laminated', cost: 591.5, retail: 1183, unit: '/unit' },
          ]},
        ],
      },
      {
        id: 'windows_casement',
        title: 'Casement',
        subtitle: 'Frame × glass baked-in pricing',
        icon: '🪟',
        iconBg: '#dbeafe',
        sections: [
          { label: 'Vinyl', items: [
            { id: 'winCS_VinylStd', name: 'Standard Double-Pane', cost: 525, retail: 1050, unit: '/unit' },
            { id: 'winCS_VinylLowE', name: 'Low-E Double-Pane', cost: 604, retail: 1208, unit: '/unit' },
            { id: 'winCS_VinylImpact', name: 'Impact/Laminated', cost: 682.5, retail: 1365, unit: '/unit' },
          ]},
          { label: 'Aluminum', items: [
            { id: 'winCS_AlumStd', name: 'Standard Double-Pane', cost: 604, retail: 1208, unit: '/unit' },
            { id: 'winCS_AlumLowE', name: 'Low-E Double-Pane', cost: 694.5, retail: 1389, unit: '/unit' },
            { id: 'winCS_AlumImpact', name: 'Impact/Laminated', cost: 785, retail: 1570, unit: '/unit' },
          ]},
          { label: 'Fiberglass', items: [
            { id: 'winCS_FiberStd', name: 'Standard Double-Pane', cost: 735, retail: 1470, unit: '/unit' },
            { id: 'winCS_FiberLowE', name: 'Low-E Double-Pane', cost: 845, retail: 1690, unit: '/unit' },
            { id: 'winCS_FiberImpact', name: 'Impact/Laminated', cost: 955.5, retail: 1911, unit: '/unit' },
          ]},
        ],
      },
      {
        id: 'windows_picture',
        title: 'Picture/Fixed',
        subtitle: 'Frame × glass baked-in pricing',
        icon: '🪟',
        iconBg: '#dbeafe',
        sections: [
          { label: 'Vinyl', items: [
            { id: 'winPic_VinylStd', name: 'Standard Double-Pane', cost: 375, retail: 750, unit: '/unit' },
            { id: 'winPic_VinylLowE', name: 'Low-E Double-Pane', cost: 431, retail: 862, unit: '/unit' },
            { id: 'winPic_VinylImpact', name: 'Impact/Laminated', cost: 487.5, retail: 975, unit: '/unit' },
          ]},
          { label: 'Aluminum', items: [
            { id: 'winPic_AlumStd', name: 'Standard Double-Pane', cost: 431, retail: 862, unit: '/unit' },
            { id: 'winPic_AlumLowE', name: 'Low-E Double-Pane', cost: 496, retail: 992, unit: '/unit' },
            { id: 'winPic_AlumImpact', name: 'Impact/Laminated', cost: 560.5, retail: 1121, unit: '/unit' },
          ]},
          { label: 'Fiberglass', items: [
            { id: 'winPic_FiberStd', name: 'Standard Double-Pane', cost: 525, retail: 1050, unit: '/unit' },
            { id: 'winPic_FiberLowE', name: 'Low-E Double-Pane', cost: 604, retail: 1208, unit: '/unit' },
            { id: 'winPic_FiberImpact', name: 'Impact/Laminated', cost: 682.5, retail: 1365, unit: '/unit' },
          ]},
        ],
      },
      {
        id: 'windows_slider',
        title: 'Slider',
        subtitle: 'Frame × glass baked-in pricing',
        icon: '🪟',
        iconBg: '#dbeafe',
        sections: [
          { label: 'Vinyl', items: [
            { id: 'winSL_VinylStd', name: 'Standard Double-Pane', cost: 325, retail: 650, unit: '/unit' },
            { id: 'winSL_VinylLowE', name: 'Low-E Double-Pane', cost: 373.5, retail: 747, unit: '/unit' },
            { id: 'winSL_VinylImpact', name: 'Impact/Laminated', cost: 422.5, retail: 845, unit: '/unit' },
          ]},
          { label: 'Aluminum', items: [
            { id: 'winSL_AlumStd', name: 'Standard Double-Pane', cost: 373.5, retail: 747, unit: '/unit' },
            { id: 'winSL_AlumLowE', name: 'Low-E Double-Pane', cost: 430, retail: 860, unit: '/unit' },
            { id: 'winSL_AlumImpact', name: 'Impact/Laminated', cost: 486, retail: 972, unit: '/unit' },
          ]},
          { label: 'Fiberglass', items: [
            { id: 'winSL_FiberStd', name: 'Standard Double-Pane', cost: 455, retail: 910, unit: '/unit' },
            { id: 'winSL_FiberLowE', name: 'Low-E Double-Pane', cost: 523, retail: 1046, unit: '/unit' },
            { id: 'winSL_FiberImpact', name: 'Impact/Laminated', cost: 591.5, retail: 1183, unit: '/unit' },
          ]},
        ],
      },
      {
        id: 'windows_awning',
        title: 'Awning',
        subtitle: 'Frame × glass baked-in pricing',
        icon: '🪟',
        iconBg: '#dbeafe',
        sections: [
          { label: 'Vinyl', items: [
            { id: 'winAW_VinylStd', name: 'Standard Double-Pane', cost: 375, retail: 750, unit: '/unit' },
            { id: 'winAW_VinylLowE', name: 'Low-E Double-Pane', cost: 431, retail: 862, unit: '/unit' },
            { id: 'winAW_VinylImpact', name: 'Impact/Laminated', cost: 487.5, retail: 975, unit: '/unit' },
          ]},
          { label: 'Aluminum', items: [
            { id: 'winAW_AlumStd', name: 'Standard Double-Pane', cost: 431, retail: 862, unit: '/unit' },
            { id: 'winAW_AlumLowE', name: 'Low-E Double-Pane', cost: 496, retail: 992, unit: '/unit' },
            { id: 'winAW_AlumImpact', name: 'Impact/Laminated', cost: 560.5, retail: 1121, unit: '/unit' },
          ]},
          { label: 'Fiberglass', items: [
            { id: 'winAW_FiberStd', name: 'Standard Double-Pane', cost: 525, retail: 1050, unit: '/unit' },
            { id: 'winAW_FiberLowE', name: 'Low-E Double-Pane', cost: 604, retail: 1208, unit: '/unit' },
            { id: 'winAW_FiberImpact', name: 'Impact/Laminated', cost: 682.5, retail: 1365, unit: '/unit' },
          ]},
        ],
      },
      {
        id: 'windows_assemblies',
        title: 'Assemblies',
        subtitle: 'Bay and bow window assemblies',
        icon: '🏛️',
        iconBg: '#ede9fe',
        sections: [
          {
            label: null,
            items: [
              { id: 'winAssyBay3', name: 'Bay Window (3-panel)', cost: 2450, retail: 4900, unit: '/assembly' },
              { id: 'winAssyBow4', name: 'Bow Window (4-panel)', cost: 2750, retail: 5500, unit: '/assembly' },
              { id: 'winAssyBow5', name: 'Bow Window (5-panel)', cost: 3150, retail: 6300, unit: '/assembly' },
            ],
          },
          {
            label: 'Assembly Add-Ons',
            items: [
              { id: 'winAssySeatStd', name: 'Standard Seat Board', cost: 87.5, retail: 175 },
              { id: 'winAssySeatPrem', name: 'Premium Seat Board', cost: 137.5, retail: 275 },
              { id: 'winAssyProjCapAlum', name: 'Aluminum Projection Cap', cost: 175, retail: 350 },
              { id: 'winAssyProjCapShingle', name: 'Shingle Projection Cap', cost: 275, retail: 550 },
            ],
          },
        ],
      },
      {
        id: 'windows_labor',
        title: 'Labor & Installation',
        subtitle: 'Installation labor',
        icon: '👷',
        iconBg: '#fce7f3',
        sections: [
          {
            label: null,
            items: [
              { id: 'winLaborFullFrame', name: 'Full-Frame Replacement', cost: 137.5, retail: 275, unit: '/unit' },
              { id: 'winLaborTrimReplace', name: 'Trim Replacement', cost: 62.5, retail: 125, unit: '/unit' },
              { id: 'winLaborCaulking', name: 'Exterior Caulking', cost: 9, retail: 18, unit: '/unit' },
              { id: 'winLaborScreen', name: 'Retractable Screen', cost: 42.5, retail: 85, unit: '/unit' },
              { id: 'winLaborHaulAway', name: 'Haul-Away', cost: 17.5, retail: 35, unit: '/unit' },
            ],
          },
        ],
      },
    ],
  },
  Flooring: {
    icon: '🪵',
    color: '#a16207',
    cards: [
      {
        id: 'flooring_materials',
        title: 'Materials — Installed',
        subtitle: 'All flooring materials installed',
        icon: '🪵',
        iconBg: '#ffedd5',
        sections: [
          {
            label: null,
            items: [
              { id: 'flMatCarpet', name: 'Carpet', cost: 3.5, retail: 7, unit: '/sq ft' },
              { id: 'flMatLVP', name: 'LVP/LVT', cost: 4.5, retail: 9, unit: '/sq ft' },
              { id: 'flMatLaminate', name: 'Laminate', cost: 4.5, retail: 9, unit: '/sq ft' },
              { id: 'flMatTile', name: 'Ceramic/Porcelain Tile', cost: 7, retail: 14, unit: '/sq ft' },
              { id: 'flMatEngHardwood', name: 'Engineered Hardwood', cost: 7.5, retail: 15, unit: '/sq ft' },
              { id: 'flMatSolidHardwood', name: 'Solid Hardwood', cost: 10, retail: 20, unit: '/sq ft' },
              { id: 'flMatStone', name: 'Natural Stone', cost: 11, retail: 22, unit: '/sq ft' },
              { id: 'flMatUnfinHardwood', name: 'Unfinished Hardwood finishing add', cost: 2.5, retail: 5, unit: '/sq ft' },
            ],
          },
        ],
      },
      {
        id: 'flooring_carpet_pad',
        title: 'Carpet Pad',
        subtitle: 'Pad types and pricing',
        icon: '🛋️',
        iconBg: '#fce7f3',
        sections: [
          {
            label: null,
            items: [
              { id: 'flPadStd', name: 'Standard (6lb)', cost: 0.3, retail: 0.6, unit: '/sq ft' },
              { id: 'flPadPrem', name: 'Premium (8lb)', cost: 0.45, retail: 0.9, unit: '/sq ft' },
              { id: 'flPadMemory', name: 'Memory Foam', cost: 0.625, retail: 1.25, unit: '/sq ft' },
            ],
          },
        ],
      },
      {
        id: 'flooring_removal',
        title: 'Removal',
        subtitle: 'Existing flooring demo costs',
        icon: '🗑️',
        iconBg: '#ffedd5',
        sections: [
          {
            label: null,
            items: [
              { id: 'flRemCarpet', name: 'Carpet', cost: 0.5, retail: 1, unit: '/sq ft' },
              { id: 'flRemLaminate', name: 'Laminate/LVP', cost: 0.625, retail: 1.25, unit: '/sq ft' },
              { id: 'flRemGluedHardwd', name: 'Glued Hardwood', cost: 1.5, retail: 3, unit: '/sq ft' },
              { id: 'flRemMortarTile', name: 'Mortar-Set Tile', cost: 1.75, retail: 3.5, unit: '/sq ft' },
            ],
          },
        ],
      },
      {
        id: 'flooring_subfloor_prep',
        title: 'Subfloor Prep',
        subtitle: 'Prep and leveling',
        icon: '📐',
        iconBg: '#dcfce7',
        sections: [
          {
            label: null,
            items: [
              { id: 'flSubLevelComp', name: 'Leveling Compound', cost: 0.375, retail: 0.75, unit: '/sq ft' },
              { id: 'flSubSelfLevel', name: 'Self-Leveling Underlayment', cost: 0.75, retail: 1.5, unit: '/sq ft' },
              { id: 'flSubPlywood', name: 'Plywood Overlay', cost: 40, retail: 80, unit: '/sheet' },
              { id: 'flSubMoistureBarrier', name: 'Moisture Barrier', cost: 0.26, retail: 0.52, unit: '/sq ft' },
            ],
          },
        ],
      },
      {
        id: 'flooring_baseboards',
        title: 'Baseboards & Transitions',
        subtitle: 'Trim and transition pieces',
        icon: '📏',
        iconBg: '#fef9c3',
        sections: [
          {
            label: null,
            items: [
              { id: 'flBaseStd', name: 'Standard Baseboard', cost: 1, retail: 2, unit: '/lin ft' },
              { id: 'flBasePrem', name: 'Premium Baseboard', cost: 1.5, retail: 3, unit: '/lin ft' },
              { id: 'flTransTMolding', name: 'T-Molding', cost: 1, retail: 2, unit: '/lin ft' },
              { id: 'flTransReducer', name: 'Reducer', cost: 1, retail: 2, unit: '/lin ft' },
              { id: 'flTransThreshold', name: 'Threshold', cost: 1, retail: 2, unit: '/lin ft' },
              { id: 'flStairTread', name: 'Stair Tread & Nosing', cost: 21, retail: 42, unit: '/step' },
            ],
          },
        ],
      },
      {
        id: 'flooring_additional',
        title: 'Additional Services',
        subtitle: 'Misc job level items',
        icon: '💼',
        iconBg: '#fef9c3',
        sections: [
          {
            label: null,
            items: [
              { id: 'flFurnitureMove', name: 'Furniture Move', cost: 50, retail: 100, unit: '/room' },
            ],
          },
        ],
      },
    ],
  },
  'Home Remodeling': {
    icon: '🛁',
    color: '#8b5cf6',
    cards: [
      {
        id: 'remodel_wet_space',
        title: 'Wet Space',
        subtitle: 'Tub, shower, and conversions',
        icon: '🛁',
        iconBg: '#ede9fe',
        sections: [
          {
            label: null,
            items: [
              { id: 'rmTubReplace', name: 'Tub Replacement', cost: 2250, retail: 4500 },
              { id: 'rmShowerReplace', name: 'Shower Replacement', cost: 2625, retail: 5250 },
              { id: 'rmTubToShower', name: 'Tub-to-Shower Conversion', cost: 3500, retail: 7000 },
              { id: 'rmShowerToTub', name: 'Shower-to-Tub Conversion', cost: 2750, retail: 5500 },
              { id: 'rmWalkInTub', name: 'Walk-In Tub', cost: 7000, retail: 14000 },
              { id: 'rmFullWetRefresh', name: 'Full Wet Space Refresh', cost: 3250, retail: 6500 },
            ],
          },
        ],
      },
      {
        id: 'remodel_surround',
        title: 'Surround Upgrades',
        subtitle: 'Surround system upcharges',
        icon: '🪨',
        iconBg: '#f3e8ff',
        sections: [
          {
            label: null,
            items: [
              { id: 'rmSurrTileAcrylic', name: 'Tile-Look Acrylic', cost: 375, retail: 750 },
              { id: 'rmSurrEngStone', name: 'Engineered Stone/Compressed Resin', cost: 1375, retail: 2750 },
              { id: 'rmSurrCustomTile', name: 'Custom Tile', cost: 1750, retail: 3500 },
            ],
          },
        ],
      },
      {
        id: 'remodel_shower_door',
        title: 'Shower Door & Enclosure',
        subtitle: 'Door types and hardware',
        icon: '🚪',
        iconBg: '#dbeafe',
        sections: [
          {
            label: null,
            items: [
              { id: 'rmDoorCurvedRod', name: 'Curved Rod with Liner', cost: 92.5, retail: 185 },
              { id: 'rmDoorSlidingGlass', name: 'Sliding Glass Door', cost: 325, retail: 650 },
              { id: 'rmDoorHingedGlass', name: 'Hinged Glass Door', cost: 425, retail: 850 },
              { id: 'rmDoorFramelessGlass', name: 'Frameless Glass Door', cost: 700, retail: 1400 },
            ],
          },
        ],
      },
      {
        id: 'remodel_fixtures',
        title: 'Fixtures',
        subtitle: 'Showerheads and body jets',
        icon: '🚿',
        iconBg: '#cffafe',
        sections: [
          {
            label: null,
            items: [
              { id: 'rmFixtStdFixed', name: 'Standard Fixed Showerhead', cost: 62.5, retail: 125 },
              { id: 'rmFixtAdjustHeight', name: 'Adjustable Height', cost: 92.5, retail: 185 },
              { id: 'rmFixtRainfall', name: 'Rainfall Ceiling Mount', cost: 187.5, retail: 375 },
              { id: 'rmFixtHandheld', name: 'Handheld with Slide Bar', cost: 137.5, retail: 275 },
              { id: 'rmFixtRainfallCombo', name: 'Rainfall + Handheld Combo', cost: 262.5, retail: 525 },
              { id: 'rmFixtBodyJets', name: 'Body Jets', cost: 425, retail: 850 },
            ],
          },
        ],
      },
      {
        id: 'remodel_accessibility',
        title: 'Accessibility & Add-Ons',
        subtitle: 'Grab bars, seats, niches',
        icon: '♿',
        iconBg: '#dcfce7',
        sections: [
          {
            label: 'Grab Bars',
            items: [
              { id: 'rmGrabBarStd', name: 'Grab Bar Standard', cost: 112.5, retail: 225 },
              { id: 'rmGrabBarADA', name: 'Grab Bar ADA (2 bars)', cost: 200, retail: 400 },
              { id: 'rmGrabBarFull', name: 'Full Accessibility Package', cost: 375, retail: 750 },
            ],
          },
          {
            label: 'Seating',
            items: [
              { id: 'rmSeatTeak', name: 'Teak Seat', cost: 162.5, retail: 325 },
              { id: 'rmSeatFoldingWall', name: 'Folding Wall Seat', cost: 137.5, retail: 275 },
              { id: 'rmSeatBuiltInBench', name: 'Built-In Bench', cost: 275, retail: 550 },
            ],
          },
          {
            label: 'Niches & Storage',
            items: [
              { id: 'rmNonSlipFloor', name: 'Non-Slip Floor Treatment', cost: 87.5, retail: 175 },
              { id: 'rmNiche1', name: 'Built-In Niche (1)', cost: 162.5, retail: 325 },
              { id: 'rmNiche2', name: 'Built-In Niche (2)', cost: 287.5, retail: 575 },
              { id: 'rmCornerShelving', name: 'Corner Shelving', cost: 112.5, retail: 225 },
            ],
          },
        ],
      },
      {
        id: 'remodel_vanity',
        title: 'Vanity',
        subtitle: 'Vanity, countertop, and mirrors',
        icon: '🪞',
        iconBg: '#fce7f3',
        sections: [
          {
            label: 'Vanity Units',
            items: [
              { id: 'rmVanSingleStd', name: 'Single Sink (standard)', cost: 950, retail: 1900 },
              { id: 'rmVanSingleFloat', name: 'Single Sink (floating)', cost: 1200, retail: 2400 },
              { id: 'rmVanDoubleStd', name: 'Double Sink (standard)', cost: 1625, retail: 3250 },
              { id: 'rmVanDoubleFloat', name: 'Double Sink (floating)', cost: 2000, retail: 4000 },
            ],
          },
          {
            label: 'Countertop Upgrades',
            items: [
              { id: 'rmVanQuartz', name: 'Quartz Countertop', cost: 225, retail: 450 },
              { id: 'rmVanGranite', name: 'Granite Countertop', cost: 325, retail: 650 },
              { id: 'rmVanVesselSink', name: 'Vessel Sink', cost: 137.5, retail: 275 },
            ],
          },
          {
            label: 'Mirrors & Cabinets',
            items: [
              { id: 'rmVanLightedMirror', name: 'Lighted Mirror', cost: 212.5, retail: 425 },
              { id: 'rmVanMedCabinet', name: 'Medicine Cabinet', cost: 175, retail: 350 },
              { id: 'rmVanMedCabinetLit', name: 'Medicine Cabinet (lighted)', cost: 275, retail: 550 },
            ],
          },
        ],
      },
      {
        id: 'remodel_toilet',
        title: 'Toilet',
        subtitle: 'Toilet replacement options',
        icon: '🚽',
        iconBg: '#f0fdf4',
        sections: [
          {
            label: null,
            items: [
              { id: 'rmToiletStd', name: 'Standard Replacement', cost: 262.5, retail: 525 },
              { id: 'rmToiletADA', name: 'Comfort Height (ADA)', cost: 325, retail: 650 },
              { id: 'rmToiletBidet', name: 'Bidet Seat upgrade', cost: 275, retail: 550 },
            ],
          },
        ],
      },
      {
        id: 'remodel_lighting',
        title: 'Lighting & Electrical',
        subtitle: 'Lighting and heated floor',
        icon: '💡',
        iconBg: '#fef9c3',
        sections: [
          {
            label: null,
            items: [
              { id: 'rmElecVanityBar', name: 'Vanity Bar Light', cost: 137.5, retail: 275 },
              { id: 'rmElecRecessed', name: 'Recessed Lighting', cost: 92.5, retail: 185, unit: '/each' },
              { id: 'rmElecExhaustFan', name: 'Exhaust Fan Replacement', cost: 162.5, retail: 325 },
              { id: 'rmElecHeatedFloor', name: 'Heated Floor Mat', cost: 525, retail: 1050 },
            ],
          },
        ],
      },
      {
        id: 'remodel_flooring',
        title: 'Bathroom Flooring',
        subtitle: 'Waterproof flooring options',
        icon: '🔲',
        iconBg: '#ede9fe',
        sections: [
          {
            label: null,
            items: [
              { id: 'rmFlLVT', name: 'LVT', cost: 4.75, retail: 9.5, unit: '/sq ft' },
              { id: 'rmFlCeramicTile', name: 'Ceramic Tile', cost: 6, retail: 12, unit: '/sq ft' },
              { id: 'rmFlPorcelainTile', name: 'Porcelain Tile', cost: 7, retail: 14, unit: '/sq ft' },
              { id: 'rmFlStone', name: 'Natural Stone', cost: 10, retail: 20, unit: '/sq ft' },
              { id: 'rmFlTileRemoval', name: 'Tile Removal', cost: 1.5, retail: 3, unit: '/sq ft' },
            ],
          },
        ],
      },
    ],
  },
};

export const getAllVerticalItems = (): VerticalItem[] => {
  const items: VerticalItem[] = [];
  Object.entries(verticals).forEach(([verticalName, vertical]) => {
    vertical.cards.forEach((card) => {
      card.sections.forEach((section) => {
        section.items.forEach((item) => {
          items.push({
            ...item,
            vertical: verticalName,
            cardId: card.id,
          });
        });
      });
    });
  });
  return items;
};

export const getVerticalItemIds = (): string[] => getAllVerticalItems().map((i) => i.id);

export const getVerticalItemCost = (id: string): number => {
  const items = getAllVerticalItems();
  const found = items.find((i) => i.id === id);
  return found ? found.cost : 0;
};

export const getVerticalItemRetail = (id: string): number => {
  const items = getAllVerticalItems();
  const found = items.find((i) => i.id === id);
  return found ? found.retail : 0;
};

export const getVerticalItemDef = (id: string): VerticalItem | null => {
  const items = getAllVerticalItems();
  return items.find((i) => i.id === id) || null;
};
