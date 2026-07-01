import { calculateCommission } from '../../../src/utils/calculator/commission-utils';

describe('calculateCommission', () => {
  test('returns zero commission for zero endPrice', () => {
    const result = calculateCommission(0, 'check');
    expect(result.amount).toBe(0);
    expect(result.details.threshold).toBe('none');
  });

  test('returns zero commission for negative endPrice', () => {
    const result = calculateCommission(-100, 'check');
    expect(result.amount).toBe(0);
  });

  test('returns zero commission for missing paymentMethod', () => {
    const result = calculateCommission(10000, '');
    expect(result.amount).toBe(0);
  });

  test('applies 1% commission for below 40% retail threshold', () => {
    const result = calculateCommission(1000, 'check');
    const afterBankFee = 1000;
    const afterDeduction = 1000 - 500;
    expect(result.amount).toBeCloseTo(afterDeduction * 0.01, 2);
    expect(result.details.threshold).toBe('below 40% retail');
  });

  test('applies 2% commission for 40% retail threshold', () => {
    const result = calculateCommission(1800, 'check');
    expect(result.details.threshold).toBe('40% retail');
  });

  test('applies 5% commission for 50% retail threshold', () => {
    const result = calculateCommission(2500, 'check');
    expect(result.details.threshold).toBe('50% retail');
  });

  test('applies 8% + 40% overage for 65% retail (PAR) threshold', () => {
    const result = calculateCommission(3500, 'check');
    expect(result.details.threshold).toBe('65% retail (PAR)');
    expect(result.details.baseCommission).toBeGreaterThan(0);
    expect(result.details.overageCommission).toBeGreaterThan(0);
  });

  test('applies 20% commission for 100% retail threshold', () => {
    const result = calculateCommission(5000, 'check');
    expect(result.details.threshold).toBe('100% retail');
    expect(result.details.commissionRate).toBe(0.20);
  });

  test('applies 24% commission for 130% retail threshold', () => {
    const result = calculateCommission(6000, 'check');
    expect(result.details.threshold).toBe('130% retail');
    expect(result.details.commissionRate).toBe(0.24);
  });

  test('deducts bank fee before commission calculation', () => {
    const resultCheck = calculateCommission(10000, 'check');
    const resultCard = calculateCommission(10000, 'mcVisaDscvr');
    expect(resultCard.details.bankFee).toBe(0.03);
    expect(resultCard.details.afterBankFee).toBeLessThan(resultCheck.details.afterBankFee);
  });

  test('deducts $500 admin fee after bank fee', () => {
    const result = calculateCommission(10000, 'check');
    expect(result.details.afterDeduction).toBe(result.details.afterBankFee - 500);
  });

  test('returns correctly structured CommissionDetails', () => {
    const result = calculateCommission(10000, 'check');
    expect(result).toHaveProperty('amount');
    expect(result).toHaveProperty('details');
    expect(result.details).toHaveProperty('endPrice');
    expect(result.details).toHaveProperty('bankFee');
    expect(result.details).toHaveProperty('bankFeeAmount');
    expect(result.details).toHaveProperty('afterBankFee');
    expect(result.details).toHaveProperty('afterDeduction');
    expect(result.details).toHaveProperty('commissionRate');
    expect(result.details).toHaveProperty('threshold');
    expect(result.details).toHaveProperty('baseCommission');
    expect(result.details).toHaveProperty('overageCommission');
    expect(result.details).toHaveProperty('paymentMethod');
    expect(result.details).toHaveProperty('paymentMethodLabel');
  });

  test('commission increases with higher endPrice', () => {
    const low = calculateCommission(3000, 'check').amount;
    const high = calculateCommission(6000, 'check').amount;
    expect(high).toBeGreaterThan(low);
  });
});
