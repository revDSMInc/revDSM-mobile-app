import { logEvent } from '../../services/api/LoggerService';

export const AUTO_FIELDS_BY_SECTION: Record<string, any[]> = {
  gutter: [
    { key: 'extras_wedges', label: 'Wedges', getValue: (cd: any) => cd?.wedges },
    { key: 'extras_straps', label: 'Straps', getValue: (cd: any) => cd?.straps },
    { key: 'extras_modifyHeight', label: 'Modify Height/R&R', getValue: (cd: any) => cd?.modifyHeight },
    { key: 'extras_groundSpout', label: 'GroundSpout', getValue: (cd: any) => cd?.groundSpout },
    { key: 'extras_replaceCorner', label: 'Replace Corner Miter', getValue: (cd: any) => cd?.replaceCorner },
    { key: 'extras_extendedSplashGuard', label: 'Extended Splash Guard', getValue: (cd: any) => cd?.extendedSplashGuard },
    { key: 'extras_extendedSplashGuard032', label: 'Extended .032 Splash Guard', getValue: (cd: any) => cd?.extendedSplashGuard032 },
    { key: 'gutter_profile', label: 'Gutter Size & Profile', getValue: (cd: any) => cd?.gutterProfile ?? cd?.gutter_profile },
  ],
  leaffilter: [
    { key: 'leaffilter_extras_csr', label: 'C-S-R', getValue: (cd: any) => cd?.csr },
    { key: 'leaffilter_extras_cornersFilter', label: 'Corners (Filter)', getValue: (cd: any) => cd?.cornersFilter },
    { key: 'leaffilter_extras_sawzallHanger', label: 'Sawzall Hanger', getValue: (cd: any) => cd?.sawzallHanger },
    { key: 'leaffilter_extras_removeProtection', label: 'Remove Protection', getValue: (cd: any) => cd?.removeProtection },
    { key: 'leaffilter_extras_ribbedRoof', label: 'Ribbed Roof', getValue: (cd: any) => cd?.ribbedRoof },
  ],
  fascia: [
    { key: 'fascia_wrap_footage', label: 'Fascia Wrap Footage', getValue: (cd: any) => cd?.fasciaWrapFootage ?? cd?.trimWrap },
    { key: 'fascia_boards_footage', label: 'Fascia Boards Footage', getValue: (cd: any) => cd?.fasciaBoardsFootage ?? cd?.fasciaBoard },
    { key: 'fascia_aluminum_board_footage', label: 'Aluminum Fascia Board Footage', getValue: (cd: any) => cd?.aluminumFasciaBoard },
  ],
  soffit: [
    { key: 'soffit_vinyl_footage', label: 'Vinyl Soffit Footage', getValue: (cd: any) => cd?.vinylSoffit },
    { key: 'soffit_porch_footage', label: 'Porch Ceiling Footage', getValue: (cd: any) => cd?.porchCeiling },
    { key: 'soffit_nailer_footage', label: 'Nailer Build Out Footage', getValue: (cd: any) => cd?.nailerBuildOut },
  ],
  additional: [
    { key: 'misc_extraLabor', label: 'Extra Labor', getValue: (cd: any) => cd?.extraLabor },
    { key: 'misc_screenPulls', label: 'Number of Screen Pulls', getValue: (cd: any) => cd?.screens },
  ],
  lighting: [
    { key: 'lighting_booster_box', label: 'Booster Box', getValue: (cd: any) => parseFloat(cd?.lightingBoosterBox) || 0 },
    { key: 'lighting_control_box', label: 'Control Box', getValue: (cd: any) => parseFloat(cd?.lightingControlBox) || 0 },
    { key: 'lighting_electrical_outlet', label: 'Electrical Outlet', getValue: (cd: any) => parseFloat(cd?.lightingElectricalOutlet) || 0 },
    { key: 'lighting_wifi_extender', label: 'WiFi Extender', getValue: (cd: any) => parseFloat(cd?.lightingWifiExtender) || 0 },
  ],
  lead_result: [
    { key: 'oneLeg', label: 'One Leg', getValue: (cd: any) => cd?.oneLeg, fieldType: 'auto' },
    { key: 'result', label: 'Result', getValue: (cd: any) => cd?.result, fieldType: 'locked' },
    { key: 'paymentMethod', label: 'Payment Method (Down Payment)', getValue: (cd: any) => cd?.paymentMethod, fieldType: 'auto' },
    { key: 'balancePaymentMethod', label: 'Payment Method (Balance)', getValue: (cd: any) => cd?.balancePaymentMethod ?? cd?.paymentMethod, fieldType: 'auto' },
    { key: 'downPayment', label: 'Down Payment', getValue: (cd: any) => cd?.downPayment, fieldType: 'auto' },
    { key: 'originalContractPrice', label: 'Original Contract Price', getValue: (cd: any) => cd?.originalContractPrice ?? cd?.price, fieldType: 'locked' },
    { key: 'balance', label: 'Balance', getValue: (cd: any) => cd?.balance ?? cd?.price, fieldType: 'locked' },
    {
      key: 'selectedCalculator',
      label: 'Selected Calculator',
      getValue: (cd: any) => cd?.LFCalculator?.title || cd?.lfCalculator?.title || cd?.selectedCalculatorTitle,
      fieldType: 'locked',
    },
  ],
};

function isQualifyingValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

export function getAutoFieldEntriesForSection(section: string, calculatorData: any) {
  const entries: Array<{ key: string; label: string; value: any; fieldType?: string }> = [];
  const fields = AUTO_FIELDS_BY_SECTION[section] || [];

  const flat = {
    ...(calculatorData?.inputs || {}),
    ...(calculatorData?.extras || {}),
    ...(calculatorData || {}),
  };

  for (const field of fields) {
    const value = field.getValue(flat);
    if (isQualifyingValue(value)) {
      entries.push({ key: field.key, label: field.label, value, fieldType: field.fieldType });
    }
  }

  if (section === 'lighting') {
    const storyFields = [
      { key: 'lighting_1st_story_footage', label: 'Lighting 1st Story Footage', getValue: (cd: any) => parseFloat(cd?.lighting1stStory) || 0 },
      { key: 'lighting_2nd_story_footage', label: 'Lighting 2nd Story Footage', getValue: (cd: any) => parseFloat(cd?.lighting2ndStory) || 0 },
      { key: 'lighting_3rd_story_footage', label: 'Lighting 3rd Story Footage', getValue: (cd: any) => parseFloat(cd?.lighting3rdStory) || 0 },
    ];
    storyFields.forEach((f) => {
      const value = f.getValue(flat);
      if (isQualifyingValue(value)) {
        entries.push({
          key: f.key,
          label: f.label,
          value,
          fieldType: 'locked',
        });
      }
    });
  }

  if (section === 'leaffilter') {
    const combinations = flat?.leaffilter?.combinations;
    if (Array.isArray(combinations)) {
      combinations.forEach((combo: any, index: number) => {
        if (!combo?.isLocked) return;
        const n = index + 1;
        const gutterOpeningWidth = combo?.gutterOpeningWidth;
        if (isQualifyingValue(gutterOpeningWidth)) {
          entries.push({
            key: `lf_combo_${n}_gutterOpeningWidth`,
            label: `Gutter Opening Width (Combo ${n})`,
            value: gutterOpeningWidth,
            fieldType: 'locked',
          });
        }
        const lfProfile = combo?.lfProfile;
        if (isQualifyingValue(lfProfile)) {
          entries.push({
            key: `lf_combo_${n}_lfProfile`,
            label: `LeafFilter Profile (Combo ${n})`,
            value: lfProfile,
            fieldType: 'locked',
          });
        }
      });
    }
  }

  return entries;
}

export async function logAutoPopulatedSection(opts: {
  userId: string;
  section: string;
  calculatorData: any;
  leadId: string;
  jobBuilderId?: string;
  moduleType?: 'job_builder' | 'lead_result_field_entry';
  alreadyLogged?: Record<string, boolean>;
  onSectionLogged?: (section: string) => Promise<void>;
}) {
  if (opts.alreadyLogged?.[opts.section]) return 0;

  const entries = getAutoFieldEntriesForSection(opts.section, opts.calculatorData);
  const moduleType = opts.moduleType || 'job_builder';

  for (const entry of entries) {
    await logEvent('auto-populated', {
      user_id: opts.userId,
      created_by: opts.userId,
      module_type: moduleType,
      meta: {
        fieldName: entry.key,
        fieldLabel: entry.label,
        fieldValue: entry.value,
        fieldType: entry.fieldType || 'locked',
        section: opts.section,
        fieldCategory: opts.section,
        leadId: opts.leadId,
        jobBuilderId: opts.jobBuilderId || opts.leadId,
      },
    });
  }

  if (opts.onSectionLogged) {
    await opts.onSectionLogged(opts.section);
  }

  return entries.length;
}
