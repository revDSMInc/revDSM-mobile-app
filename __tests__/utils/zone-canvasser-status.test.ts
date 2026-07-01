import {
  BUILDING_MARKER_COLORS,
  DEFAULT_MARKER_COLOR,
  LEGEND_ITEMS,
  RESULT_OPTIONS,
  ACTION_TITLES,
  PREFERRED_TIMES,
  SELECT_ITEMS,
  APPOINTMENT_COLORS,
  STATUS_CHIP_CONFIG,
  normalizeLeadStatus,
  getMarkerColor,
  getStatusLabel,
  getStatusChipConfig,
} from '../../src/utils/zone-canvasser-status';

describe('BUILDING_MARKER_COLORS', () => {
  test('has all expected statuses', () => {
    const statuses = ['go_back', 'not_interested', 'not_qualified', 'not_home', 'interested_no_time', 'create_lead', 'selfGenerated', 'no_soliciting'];
    statuses.forEach(s => expect(BUILDING_MARKER_COLORS[s]).toBeDefined());
  });

  test('selfGenerated shares color with create_lead', () => {
    expect(BUILDING_MARKER_COLORS.selfGenerated).toBe(BUILDING_MARKER_COLORS.create_lead);
  });
});

describe('DEFAULT_MARKER_COLOR', () => {
  test('is red', () => {
    expect(DEFAULT_MARKER_COLOR).toBe('#dc3545');
  });
});

describe('LEGEND_ITEMS', () => {
  test('includes Not Visited as first item', () => {
    expect(LEGEND_ITEMS[0].label).toBe('Not Visited');
    expect(LEGEND_ITEMS[0].status).toBeNull();
  });

  test('has 8 entries', () => {
    expect(LEGEND_ITEMS).toHaveLength(8);
  });

  test('all items have color and label', () => {
    LEGEND_ITEMS.forEach(item => {
      expect(item.color).toBeDefined();
      expect(item.label).toBeDefined();
    });
  });
});

describe('RESULT_OPTIONS', () => {
  test('has 7 options', () => {
    expect(RESULT_OPTIONS).toHaveLength(7);
  });

  test('every option has value and label', () => {
    RESULT_OPTIONS.forEach(opt => {
      expect(opt.value).toBeDefined();
      expect(opt.label).toBeDefined();
    });
  });

  test('first option is not_interested', () => {
    expect(RESULT_OPTIONS[0].value).toBe('not_interested');
  });
});

describe('ACTION_TITLES', () => {
  test('has all expected keys', () => {
    const keys = ['not_interested', 'not_qualified', 'no_soliciting', 'not_home', 'no_answer', 'interested_no_time', 'go_back'];
    keys.forEach(k => expect(ACTION_TITLES[k]).toBeDefined());
  });
});

describe('PREFERRED_TIMES', () => {
  test('has 6 times', () => {
    expect(PREFERRED_TIMES).toHaveLength(6);
  });

  test('starts with 9am', () => {
    expect(PREFERRED_TIMES[0]).toBe('09:00 AM');
  });
});

describe('SELECT_ITEMS', () => {
  test('has 5 items', () => {
    expect(SELECT_ITEMS).toHaveLength(5);
  });

  test('includes all services', () => {
    expect(SELECT_ITEMS).toContain('Gutter');
    expect(SELECT_ITEMS).toContain('Leaf Filter');
    expect(SELECT_ITEMS).toContain('Soffit');
    expect(SELECT_ITEMS).toContain('Fascia Wrap');
    expect(SELECT_ITEMS).toContain('Fascia Rot');
  });
});

describe('APPOINTMENT_COLORS', () => {
  test('has all 4 states', () => {
    expect(APPOINTMENT_COLORS.ACTIVE).toBe('#ff6b35');
    expect(APPOINTMENT_COLORS.PROGRESS).toBe('#6fcf97');
    expect(APPOINTMENT_COLORS.OFFSITE).toBe('#9e9e9e');
    expect(APPOINTMENT_COLORS.UPCOMING).toBe('#2196f3');
  });
});

describe('STATUS_CHIP_CONFIG', () => {
  test('has all expected keys', () => {
    const keys = ['not_interested', 'no_answer', 'not_home', 'no_soliciting', 'create_lead', 'selfGenerated', 'go_back', 'interested_no_time', 'not_qualified'];
    keys.forEach(k => expect(STATUS_CHIP_CONFIG[k]).toBeDefined());
  });

  test('each entry has label, color, bg, icon', () => {
    Object.values(STATUS_CHIP_CONFIG).forEach(entry => {
      expect(entry.label).toBeDefined();
      expect(entry.color).toBeDefined();
      expect(entry.bg).toBeDefined();
      expect(entry.icon).toBeDefined();
    });
  });

  test('selfGenerated same as create_lead', () => {
    expect(STATUS_CHIP_CONFIG.selfGenerated).toEqual(STATUS_CHIP_CONFIG.create_lead);
  });
});

describe('normalizeLeadStatus', () => {
  test('returns null for null/undefined/empty', () => {
    expect(normalizeLeadStatus(null)).toBeNull();
    expect(normalizeLeadStatus(undefined)).toBeNull();
    expect(normalizeLeadStatus('')).toBeNull();
  });

  test('maps selfGenerated to create_lead', () => {
    expect(normalizeLeadStatus('selfGenerated')).toBe('create_lead');
  });

  test('passes through other statuses', () => {
    expect(normalizeLeadStatus('not_home')).toBe('not_home');
    expect(normalizeLeadStatus('go_back')).toBe('go_back');
  });
});

describe('getMarkerColor', () => {
  test('returns default for null/undefined/empty', () => {
    expect(getMarkerColor(null)).toBe(DEFAULT_MARKER_COLOR);
    expect(getMarkerColor(undefined)).toBe(DEFAULT_MARKER_COLOR);
    expect(getMarkerColor('')).toBe(DEFAULT_MARKER_COLOR);
  });

  test('returns mapped color for known status', () => {
    expect(getMarkerColor('create_lead')).toBe(BUILDING_MARKER_COLORS.create_lead);
    expect(getMarkerColor('not_home')).toBe(BUILDING_MARKER_COLORS.not_home);
  });

  test('returns default for unknown status', () => {
    expect(getMarkerColor('unknown_status')).toBe(DEFAULT_MARKER_COLOR);
  });
});

describe('getStatusLabel', () => {
  test('returns "Not Visited" for null/unknown', () => {
    expect(getStatusLabel(null)).toBe('Not Visited');
    expect(getStatusLabel('unknown')).toBe('Not Visited');
  });

  test('returns correct labels for known statuses', () => {
    expect(getStatusLabel('go_back')).toBe('Go Back');
    expect(getStatusLabel('not_interested')).toBe('Not Interested');
    expect(getStatusLabel('not_qualified')).toBe('Not Qualified');
    expect(getStatusLabel('not_home')).toBe('Not Home');
    expect(getStatusLabel('interested_no_time')).toBe('Interested - No Time');
    expect(getStatusLabel('create_lead')).toBe('Lead Created');
    expect(getStatusLabel('selfGenerated')).toBe('Lead Created');
    expect(getStatusLabel('no_soliciting')).toBe('No Soliciting');
  });
});

describe('getStatusChipConfig', () => {
  test('returns unknown config for null', () => {
    const config = getStatusChipConfig(null);
    expect(config.label).toBe('Unknown');
    expect(config.icon).toBe('information-outline');
  });

  test('returns mapped config for known status', () => {
    const config = getStatusChipConfig('create_lead');
    expect(config).toEqual(STATUS_CHIP_CONFIG.create_lead);
  });

  test('falls back to label-based config for unknown status', () => {
    const config = getStatusChipConfig('random_status');
    expect(config.label).toBe(getStatusLabel('random_status'));
    expect(config.icon).toBe('information-outline');
  });
});
