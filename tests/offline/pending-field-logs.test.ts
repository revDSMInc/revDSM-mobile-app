import {
  FIELD_LOG_DEBOUNCE_MS,
  isRealFieldChange,
  loggedFieldValue,
  queueFieldLog,
  settledFieldLogs,
  type PendingFieldLog,
} from '../../src/utils/activity-log/pending-field-logs';

const entry = (
  calculatorId: string,
  fieldId: string,
  oldValue: any,
  newValue: any
): PendingFieldLog => ({
  calculatorId,
  fieldId,
  payload: { calculatorId, fieldLabel: fieldId, oldValue, newValue, fieldValue: newValue },
});

describe('the debounce window matches web', () => {
  /** `useDebounce(rolloutChangeTrigger, 1000)` in `ViewAllCalculators.js`. */
  it('is 1000 ms', () => {
    expect(FIELD_LOG_DEBOUNCE_MS).toBe(1000);
  });
});

describe('queueFieldLog — one log per settled value', () => {
  /**
   * ⚠️ THE REPORTED CASE. Typing `1487887` fired seven changes; the portal showed seven lines,
   * six struck through.
   */
  it('collapses a burst of keystrokes into ONE pending log', () => {
    let pending: PendingFieldLog[] = [];
    ['1', '14', '148', '1487', '14878', '148788', '1487887'].forEach((v) => {
      pending = queueFieldLog(pending, entry('calc1', 'gutter5', '0', v));
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.newValue).toBe('1487887');
  });

  /**
   * ⚠️ THE EASY MISTAKE: keeping the newest `oldValue` too would log `148788 -> 1487887` instead
   * of the change the rep actually made.
   */
  it('keeps the ORIGINAL oldValue across the burst', () => {
    let pending = queueFieldLog([], entry('calc1', 'gutter5', '0', '1'));
    pending = queueFieldLog(pending, entry('calc1', 'gutter5', '1', '14'));
    pending = queueFieldLog(pending, entry('calc1', 'gutter5', '14', '148'));
    expect(pending[0].payload.oldValue).toBe('0');
    expect(pending[0].payload.newValue).toBe('148');
  });

  it('keeps separate fields separate', () => {
    let pending = queueFieldLog([], entry('calc1', 'gutter5', '0', '10'));
    pending = queueFieldLog(pending, entry('calc1', 'gutter6', '0', '20'));
    expect(pending).toHaveLength(2);
  });

  /** ⚠️ Two tabs can hold the same field id - they must not collapse into each other. */
  it('keeps the same field on different calculators separate', () => {
    let pending = queueFieldLog([], entry('calc1', 'gutter5', '0', '10'));
    pending = queueFieldLog(pending, entry('calc2', 'gutter5', '0', '20'));
    expect(pending).toHaveLength(2);
  });

  it('moves the touched field to the end, so logs land in edit order', () => {
    let pending = queueFieldLog([], entry('calc1', 'a', '0', '1'));
    pending = queueFieldLog(pending, entry('calc1', 'b', '0', '2'));
    pending = queueFieldLog(pending, entry('calc1', 'a', '1', '3'));
    expect(pending.map((p) => p.fieldId)).toEqual(['b', 'a']);
  });

  it('is safe on an empty or missing queue', () => {
    expect(queueFieldLog(null, entry('c', 'f', '0', '1'))).toHaveLength(1);
    expect(queueFieldLog(undefined, entry('c', 'f', '0', '1'))).toHaveLength(1);
  });
});

describe('isRealFieldChange', () => {
  it('a different value is a change', () => {
    expect(isRealFieldChange('0', '5')).toBe(true);
  });

  /** ⚠️ Typing a value then deleting it is NOT two changes - it is none. */
  it('a value typed and removed again is not a change', () => {
    expect(isRealFieldChange('', '')).toBe(false);
    expect(isRealFieldChange('0', '0')).toBe(false);
  });

  it('treats null/undefined and empty as the same nothing', () => {
    expect(isRealFieldChange(null, '')).toBe(false);
    expect(isRealFieldChange(undefined, '')).toBe(false);
  });

  it('ignores surrounding whitespace', () => {
    expect(isRealFieldChange('5', ' 5 ')).toBe(false);
  });

  it('compares across types the way the field renders them', () => {
    expect(isRealFieldChange(5, '5')).toBe(false);
    expect(isRealFieldChange(5, '6')).toBe(true);
  });
});

describe('settledFieldLogs', () => {
  it('drops an edit that ended where it started', () => {
    const pending = [entry('calc1', 'gutter5', '5', '5'), entry('calc1', 'gutter6', '0', '12')];
    const out = settledFieldLogs(pending);
    expect(out).toHaveLength(1);
    expect(out[0].fieldId).toBe('gutter6');
  });

  /** Typing `5` then clearing it leaves nothing to report. */
  it('drops a field typed and cleared within one window', () => {
    let pending = queueFieldLog([], entry('calc1', 'gutter5', '', '5'));
    pending = queueFieldLog(pending, entry('calc1', 'gutter5', '5', ''));
    expect(settledFieldLogs(pending)).toHaveLength(0);
  });

  it('falls back to fieldValue when newValue is absent', () => {
    const p: PendingFieldLog = {
      calculatorId: 'c',
      fieldId: 'f',
      payload: { oldValue: '0', fieldValue: '9' },
    };
    expect(settledFieldLogs([p])).toHaveLength(1);
  });

  it('is safe on junk', () => {
    expect(settledFieldLogs(null)).toEqual([]);
    expect(settledFieldLogs(undefined)).toEqual([]);
  });
});


/**
 * Client, comparing portals: clearing a field logged `Added 0' GroundSpout` from mobile, while web
 * showed the entry struck through with a red DELETED tag. Web sends `''` for an empty box
 * (`DealCenterContext.js`: `value === '' || null || undefined ? '' : Number(value)`).
 */
describe('loggedFieldValue — an emptied field reports as DELETED, not as zero', () => {
  it('reports an empty box as an empty string', () => {
    expect(loggedFieldValue('')).toBe('');
    expect(loggedFieldValue(null)).toBe('');
    expect(loggedFieldValue(undefined)).toBe('');
  });

  /** ⚠️ A rep who TYPES a zero said something; only an absent value is a deletion. */
  it('keeps a deliberately typed zero as 0', () => {
    expect(loggedFieldValue(0)).toBe(0);
    expect(loggedFieldValue('0')).toBe(0);
  });

  it('passes real numbers through, however they arrive', () => {
    expect(loggedFieldValue(65)).toBe(65);
    expect(loggedFieldValue('65')).toBe(65);
    expect(loggedFieldValue('1487887')).toBe(1487887);
    expect(loggedFieldValue(12.5)).toBe(12.5);
  });

  it('treats unparseable junk as empty rather than NaN', () => {
    expect(loggedFieldValue('abc')).toBe('');
    expect(loggedFieldValue(NaN)).toBe('');
  });

  /** ⚠️ Never emit NaN - the portal would render it as a value. */
  it('never returns NaN', () => {
    ['', null, undefined, 'abc', NaN, {}, []].forEach((v) => {
      const out = loggedFieldValue(v as any);
      expect(Number.isNaN(out as number)).toBe(false);
    });
  });

  /** The reported case end to end: 65 -> cleared is a deletion, not "Added 0". */
  it('turns a cleared 65 into a deletion log', () => {
    const pending = queueFieldLog([], {
      calculatorId: 'calc1',
      fieldId: 'groundSpout',
      payload: { oldValue: 65, newValue: loggedFieldValue(''), fieldValue: loggedFieldValue('') },
    });
    const out = settledFieldLogs(pending);
    expect(out).toHaveLength(1);
    expect(out[0].payload.newValue).toBe('');
    expect(out[0].payload.newValue).not.toBe(0);
  });

  /** ⚠️ Clearing a field that was ALREADY empty is not a change at all. */
  it('does not log clearing an already-empty field', () => {
    const pending = queueFieldLog([], {
      calculatorId: 'calc1',
      fieldId: 'groundSpout',
      payload: { oldValue: '', newValue: loggedFieldValue(''), fieldValue: loggedFieldValue('') },
    });
    expect(settledFieldLogs(pending)).toHaveLength(0);
  });
});


/**
 * Client: *"when we press the cleared button, log should be called for the fields which having the
 * values and now become empty just like the web"*. Web emits one `calculator_field_entry` per
 * previously-filled field (`VerticalsCalculatorView.js` `handleClearCard`); mobile sent a single
 * `section cleared` line, so the portal could not say WHICH fields were emptied.
 *
 * These cover the queue shape `handleClearSection` builds. Clear routes through the same
 * `queueFieldLog` as typing, which is what makes the offline path identical - `logEvent` holds and
 * replays each one through `offlineActivityLog`.
 */
describe('Clear button — one log per field that held a value', () => {
  const clearLog = (fieldId: string, oldValue: any): PendingFieldLog => ({
    calculatorId: 'calc1',
    fieldId,
    payload: {
      fieldLabel: fieldId,
      oldValue,
      fieldValue: loggedFieldValue(''),
      newValue: loggedFieldValue(''),
    },
  });

  it('logs every filled field, each reporting empty', () => {
    let pending: PendingFieldLog[] = [];
    [['gutter5', 5], ['gutter6', 6], ['wedges', 56]].forEach(([f, v]) => {
      pending = queueFieldLog(pending, clearLog(f as string, v));
    });
    const out = settledFieldLogs(pending);
    expect(out).toHaveLength(3);
    out.forEach((p) => expect(p.payload.newValue).toBe(''));
    expect(out.map((p) => p.payload.oldValue)).toEqual([5, 6, 56]);
  });

  /** ⚠️ Fields that were already empty are not part of a Clear - nothing changed for them. */
  it('does not log a field that was already empty', () => {
    const pending = [clearLog('groundSpout', ''), clearLog('gutter5', 5)];
    const out = settledFieldLogs(pending);
    expect(out).toHaveLength(1);
    expect(out[0].fieldId).toBe('gutter5');
  });

  /**
   * ⚠️ A Clear right after typing must not race the pending keystroke. Both go through the same
   * per-calculator+field queue, so the clear REPLACES it and one log survives - and it still
   * reports the value the rep started from, not the half-typed one.
   */
  it('a clear straight after typing collapses to one log, keeping the original oldValue', () => {
    let pending = queueFieldLog([], entry('calc1', 'gutter5', 5, 56));
    pending = queueFieldLog(pending, clearLog('gutter5', 56));
    const out = settledFieldLogs(pending);
    expect(out).toHaveLength(1);
    expect(out[0].payload.oldValue).toBe(5);
    expect(out[0].payload.newValue).toBe('');
  });

  it('keeps clears on different calculators apart', () => {
    let pending = queueFieldLog([], clearLog('gutter5', 5));
    pending = queueFieldLog(pending, { ...clearLog('gutter5', 9), calculatorId: 'calc2' });
    expect(settledFieldLogs(pending)).toHaveLength(2);
  });
});
