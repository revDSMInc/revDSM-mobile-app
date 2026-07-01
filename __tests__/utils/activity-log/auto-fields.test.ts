jest.mock('../../../src/services/api/LoggerService', () => ({
  logEvent: jest.fn(() => Promise.resolve()),
}));

import { AUTO_FIELDS_BY_SECTION, getAutoFieldEntriesForSection, logAutoPopulatedSection } from '../../../src/utils/activity-log/auto-fields';
import { logEvent } from '../../../src/services/api/LoggerService';

describe('AUTO_FIELDS_BY_SECTION', () => {
  test('has all 7 sections', () => {
    const sections = ['gutter', 'leaffilter', 'fascia', 'soffit', 'additional', 'lighting', 'lead_result'];
    sections.forEach(s => expect(AUTO_FIELDS_BY_SECTION[s]).toBeDefined());
  });

  test('each section has non-empty field array', () => {
    Object.entries(AUTO_FIELDS_BY_SECTION).forEach(([key, fields]) => {
      expect(Array.isArray(fields)).toBe(true);
      expect(fields.length).toBeGreaterThan(0);
    });
  });

  test('each field has key, label, getValue', () => {
    Object.values(AUTO_FIELDS_BY_SECTION).forEach(fields => {
      fields.forEach((field: any) => {
        expect(typeof field.key).toBe('string');
        expect(typeof field.label).toBe('string');
        expect(typeof field.getValue).toBe('function');
      });
    });
  });
});

describe('getAutoFieldEntriesForSection', () => {
  test('returns empty array for unknown section', () => {
    expect(getAutoFieldEntriesForSection('unknown', { wedges: '5' })).toEqual([]);
  });

  test('returns empty array when no qualifying values exist', () => {
    expect(getAutoFieldEntriesForSection('gutter', {})).toEqual([]);
    expect(getAutoFieldEntriesForSection('gutter', { wedges: null })).toEqual([]);
    expect(getAutoFieldEntriesForSection('gutter', { wedges: '' })).toEqual([]);
    expect(getAutoFieldEntriesForSection('gutter', { wedges: 0 })).toEqual([]);
  });

  describe('gutter section', () => {
    test('extracts wedges and straps from flat data', () => {
      const entries = getAutoFieldEntriesForSection('gutter', { wedges: '60', straps: '10' });
      const keys = entries.map(e => e.key);
      expect(keys).toContain('extras_wedges');
      expect(keys).toContain('extras_straps');
    });

    test('extracts gutter_profile from nested object', () => {
      const entries = getAutoFieldEntriesForSection('gutter', { gutter_profile: 'K-Style' });
      expect(entries.some(e => e.key === 'gutter_profile')).toBe(true);
    });

    test('prefers gutterProfile over gutter_profile', () => {
      const entries = getAutoFieldEntriesForSection('gutter', { gutterProfile: 'Half-Round', gutter_profile: 'K-Style' });
      const entry = entries.find(e => e.key === 'gutter_profile');
      expect(entry?.value).toBe('Half-Round');
    });

    test('handles nested inputs/extras wrapper', () => {
      const entries = getAutoFieldEntriesForSection('gutter', {
        inputs: { wedges: '30' },
        extras: { straps: '5' },
      });
      expect(entries.some(e => e.key === 'extras_wedges' && e.value === '30')).toBe(true);
      expect(entries.some(e => e.key === 'extras_straps' && e.value === '5')).toBe(true);
    });
  });

  describe('leaffilter section', () => {
    test('extracts CSR and corners', () => {
      const entries = getAutoFieldEntriesForSection('leaffilter', { csr: 'yes', cornersFilter: '4' });
      expect(entries.some(e => e.key === 'leaffilter_extras_csr')).toBe(true);
      expect(entries.some(e => e.key === 'leaffilter_extras_cornersFilter')).toBe(true);
    });

    test('includes locked combo fields', () => {
      const data = {
        leaffilter: {
          combinations: [
            { isLocked: true, gutterOpeningWidth: '5"', lfProfile: 'Pro' },
            { isLocked: true, gutterOpeningWidth: '6"', lfProfile: '' },
            { isLocked: false, gutterOpeningWidth: '7"' },
          ],
        },
      };
      const entries = getAutoFieldEntriesForSection('leaffilter', data);
      expect(entries.some(e => e.key === 'lf_combo_1_gutterOpeningWidth')).toBe(true);
      expect(entries.some(e => e.key === 'lf_combo_1_lfProfile')).toBe(true);
      expect(entries.some(e => e.key === 'lf_combo_2_gutterOpeningWidth')).toBe(true);
      expect(entries.some(e => e.key === 'lf_combo_2_lfProfile')).toBe(false);
      expect(entries.some(e => e.key === 'lf_combo_3_gutterOpeningWidth')).toBe(false);
    });
  });

  describe('fascia section', () => {
    test('extracts wrap and board footage', () => {
      const entries = getAutoFieldEntriesForSection('fascia', { trimWrap: '50', fasciaBoard: '20' });
      expect(entries.some(e => e.key === 'fascia_wrap_footage' && e.value === '50')).toBe(true);
      expect(entries.some(e => e.key === 'fascia_boards_footage' && e.value === '20')).toBe(true);
    });

    test('prefers fasciaWrapFootage over trimWrap', () => {
      const entries = getAutoFieldEntriesForSection('fascia', { fasciaWrapFootage: '60', trimWrap: '50' });
      expect(entries.find(e => e.key === 'fascia_wrap_footage')?.value).toBe('60');
    });
  });

  describe('soffit section', () => {
    test('extracts vinyl, porch, and nailer footage', () => {
      const entries = getAutoFieldEntriesForSection('soffit', { vinylSoffit: '100', porchCeiling: '30', nailerBuildOut: '15' });
      expect(entries.some(e => e.key === 'soffit_vinyl_footage')).toBe(true);
      expect(entries.some(e => e.key === 'soffit_porch_footage')).toBe(true);
      expect(entries.some(e => e.key === 'soffit_nailer_footage')).toBe(true);
    });
  });

  describe('additional section', () => {
    test('extracts extra labor and screens', () => {
      const entries = getAutoFieldEntriesForSection('additional', { extraLabor: '8', screens: '3' });
      expect(entries.some(e => e.key === 'misc_extraLabor')).toBe(true);
      expect(entries.some(e => e.key === 'misc_screenPulls')).toBe(true);
    });
  });

  describe('lighting section', () => {
    test('extracts booster/control box and outlets', () => {
      const entries = getAutoFieldEntriesForSection('lighting', { lightingBoosterBox: '1', lightingControlBox: '2', lightingElectricalOutlet: '3', lightingWifiExtender: '1' });
      expect(entries.some(e => e.key === 'lighting_booster_box')).toBe(true);
      expect(entries.some(e => e.key === 'lighting_control_box')).toBe(true);
      expect(entries.some(e => e.key === 'lighting_electrical_outlet')).toBe(true);
      expect(entries.some(e => e.key === 'lighting_wifi_extender')).toBe(true);
    });

    test('adds story footage fields', () => {
      const entries = getAutoFieldEntriesForSection('lighting', { lighting1stStory: '50', lighting2ndStory: '30' });
      expect(entries.some(e => e.key === 'lighting_1st_story_footage')).toBe(true);
      expect(entries.some(e => e.key === 'lighting_2nd_story_footage')).toBe(true);
      expect(entries.some(e => e.key === 'lighting_3rd_story_footage')).toBe(false);
    });
  });

  describe('lead_result section', () => {
    test('extracts result, payment method, price fields', () => {
      const entries = getAutoFieldEntriesForSection('lead_result', { result: 'sold', paymentMethod: 'check', price: '5000' });
      expect(entries.some(e => e.key === 'result')).toBe(true);
      expect(entries.some(e => e.key === 'paymentMethod')).toBe(true);
      expect(entries.some(e => e.key === 'originalContractPrice')).toBe(true);
    });

    test('balance falls back to price', () => {
      const entries = getAutoFieldEntriesForSection('lead_result', { price: '5000' });
      expect(entries.some(e => e.key === 'balance' && e.value === '5000')).toBe(true);
    });

    test('selectedCalculator resolves from various field names', () => {
      const entries = getAutoFieldEntriesForSection('lead_result', { LFCalculator: { title: 'LF Calc' } });
      expect(entries.some(e => e.key === 'selectedCalculator' && e.value === 'LF Calc')).toBe(true);
    });
  });
});

describe('logAutoPopulatedSection', () => {
  const BASE_OPTS = { userId: 'user-1', section: 'gutter', calculatorData: { wedges: '60' }, leadId: 'lead-1' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns number of entries logged', async () => {
    const count = await logAutoPopulatedSection(BASE_OPTS);
    expect(count).toBe(1);
  });

  test('calls logEvent for each entry', async () => {
    await logAutoPopulatedSection(BASE_OPTS);
    expect(logEvent).toHaveBeenCalledWith('auto-populated', expect.objectContaining({
      user_id: 'user-1',
      meta: expect.objectContaining({ fieldName: 'extras_wedges', fieldValue: '60' }),
    }));
  });

  test('skips when already logged', async () => {
    const count = await logAutoPopulatedSection({ ...BASE_OPTS, alreadyLogged: { gutter: true } });
    expect(count).toBe(0);
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('calls onSectionLogged callback', async () => {
    const onSectionLogged = jest.fn();
    await logAutoPopulatedSection({ ...BASE_OPTS, onSectionLogged });
    expect(onSectionLogged).toHaveBeenCalledWith('gutter');
  });

  test('logs nothing when no qualifying fields', async () => {
    const count = await logAutoPopulatedSection({ ...BASE_OPTS, calculatorData: {} });
    expect(count).toBe(0);
    expect(logEvent).not.toHaveBeenCalled();
  });
});
