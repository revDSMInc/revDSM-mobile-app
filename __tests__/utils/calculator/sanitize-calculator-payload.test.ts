import { sanitizeCalculatorPayload } from '../../../src/services/api/leads';

describe('sanitizeCalculatorPayload — string fields keep "" (web parity)', () => {
  test('non-string numeric-ish blanks coerce to 0', () => {
    const out = sanitizeCalculatorPayload({ price: '', downPayment: '', total: '' });
    expect(out.price).toBe(0);
    expect(out.downPayment).toBe(0);
    expect(out.total).toBe(0);
  });

  test('label/free-text string fields keep empty string, never 0', () => {
    const out = sanitizeCalculatorPayload({
      pricemarkup: '',
      reason: '',
      explain: '',
      demoReason: '',
      reasonExplanation: '',
      paymentMethodLabel: '',
      productName: '',
      unit: '',
      title: '',
    });
    ['pricemarkup', 'reason', 'explain', 'demoReason', 'reasonExplanation', 'paymentMethodLabel', 'productName', 'unit', 'title'].forEach((k) => {
      expect(out[k]).toBe('');
    });
  });

  test('non-empty markup label is preserved verbatim', () => {
    const out = sanitizeCalculatorPayload({ pricemarkup: 'RETAIL + 5%' });
    expect(out.pricemarkup).toBe('RETAIL + 5%');
  });

  test('recurses into nested entries[] and dropPrice[]', () => {
    const out = sanitizeCalculatorPayload({
      entries: [{ productName: '', inputValue: '' }],
      dropPrice: [{ pricemarkup: '', dropedPrice: '' }],
    });
    expect(out.entries[0].productName).toBe('');
    expect(out.entries[0].inputValue).toBe(0);
    expect(out.dropPrice[0].pricemarkup).toBe('');
    expect(out.dropPrice[0].dropedPrice).toBe(0);
  });
});
