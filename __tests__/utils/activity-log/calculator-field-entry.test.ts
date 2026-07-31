import { logCalculatorFieldEntry } from '../../../src/utils/activity-log/calculator-log';

// Name must start with `mock` so jest allows the factory to reference it (hoisting rule).
const mockLogEvent = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/services/api/LoggerService', () => ({
  logEvent: (...args: any[]) => mockLogEvent(...args),
}));

describe('logCalculatorFieldEntry (web calculator_field_entry parity)', () => {
  beforeEach(() => mockLogEvent.mockClear());

  test('emits a change event with the web module_type + meta shape', async () => {
    await logCalculatorFieldEntry({
      userId: 'u1',
      calculatorId: 'c1',
      appointmentId: 'a1',
      calculatorTitle: 'G+LF',
      fieldLabel: 'Gutter 5" DS/E',
      fieldValue: 100,
      fieldCategory: 'gutters',
      oldValue: 0,
      newValue: 100,
      leadId: 'lead-1',
    });
    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    const [action, payload] = mockLogEvent.mock.calls[0];
    expect(action).toBe('change');
    expect(payload.module_type).toBe('calculator_field_entry');
    expect(payload.meta).toMatchObject({
      calculatorId: 'c1',
      appointmentId: 'a1',
      calculatorTitle: 'G+LF',
      fieldLabel: 'Gutter 5" DS/E',
      fieldValue: 100,
      fieldCategory: 'gutters',
      oldValue: 0,
      newValue: 100,
      action: 'calculator field changed',
      leadId: 'lead-1',
    });
  });

  test('no-ops without a user or calculator id', async () => {
    await logCalculatorFieldEntry({ userId: '', calculatorId: 'c1' });
    await logCalculatorFieldEntry({ userId: 'u1', calculatorId: '' });
    expect(mockLogEvent).not.toHaveBeenCalled();
  });
});
