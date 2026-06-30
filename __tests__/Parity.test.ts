import { calculateResultUtil as mobileCalcResult } from '../src/utils/calculator/calculation-results-util';
// @ts-ignore
import { calculateResultUtil as webCalcResult } from '/Users/apple/Downloads/mhalt-revDSM-sales-frontend-staging/src/sections/lf-calculator/components/utils/calculation-results-util';
import { pricing, extrasList, extrasList50 } from '../src/utils/calculator/pricing-data';
import { paymentPlans } from '../src/utils/calculator/payment-plans';

// Mock vertical items function for web/mobile if needed, but they are imported internally and should work.

describe('Calculator Parity Tests', () => {
  const runParityCheck = (details: any, markupKey: string, paymentMethod: string, isLowesLead = false, ckToInstallers = 0) => {
    // Web expectation: web normalizes details
    // Mobile expectation: mobile normalizes details

    // Let's call both and compare
    const webRes = webCalcResult({
      details,
      markupKey,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod,
      isLowesLead,
      ckToInstallers,
    });

    const mobRes = mobileCalcResult({
      details,
      markupKey,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod,
      isLowesLead,
      ckToInstallers,
    });

    expect(Math.round(mobRes)).toBe(Math.round(webRes));
  };

  test('Simple gutter and versa6 calculations', () => {
    const details = {
      gutter5DsE: '100',
      versa6Ft1: '50',
      paymentMethod: 'wf4103',
    };
    runParityCheck(details, '50', 'wf4103');
    runParityCheck(details, '65', 'wf4103');
    runParityCheck(details, '100', 'wf4103');
  });

  test('Calculations with extra labor and other extras', () => {
    const details = {
      gutter5DsE: '100',
      versa6Ft1: '50',
      extraLabor: '15',
      wedges: '10',
      paymentMethod: 'wf4103',
    };
    runParityCheck(details, '50', 'wf4103');
    runParityCheck(details, '65', 'wf4103');
    runParityCheck(details, '100', 'wf4103');
  });

  test('Calculations with screens (ckToInstallers)', () => {
    const details = {
      gutter5DsE: '100',
      versa6Ft1: '50',
      ckToInstallers: '20',
      screens: '20',
      paymentMethod: 'wf4103',
    };
    // Testing with non-zero ckToInstallers parameter
    runParityCheck(details, '50', 'wf4103', false, 20);
    runParityCheck(details, '65', 'wf4103', false, 20);
    runParityCheck(details, '100', 'wf4103', false, 20);
  });

  test('Nested vs Flat calculation parity', () => {
    const active = {
      _id: 'calc-1',
      inputs: {
        gutter5DsE: '',
        gutter6Ft1: '45',
        gutter7DsE: '',
        versaMaxFt1: '225',
        versa6Ft1: '80',
        versa6Ft2: '',
        versa6Ft3: '',
        versa7Ft1: '',
        versa7Ft2: '',
        versa7Ft3: '',
        filter45Ft1: '',
        filter45Ft2: '',
        filter45Ft3: '',
        extraLabor: '23',
        screens: '',
        ckToInstallers: '',
        paymentPlan: 'check'
      },
      extras: {
        wedges: '60',
        straps: '',
        modifyHeight: '',
        csr: '',
        nailerBuildOut: '',
        vinylSoffit: '',
        porchCeiling: '',
        fasciaBoard: '',
        aluminumFasciaBoard: '',
        trimWrap: '',
        extendedSplashGuard: '',
        extendedSplashGuard032: '',
        replaceCorner: '',
        groundSpout: '',
        extraLabor: '23',
      }
    };

    const webDetails = {
      ...active.extras,
      ...active.inputs,
    };

    const webResCost = webCalcResult({
      details: webDetails,
      markupKey: '50',
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: 'check',
      isLowesLead: false,
    });

    const mobResCost = mobileCalcResult({
      details: active,
      markupKey: '50',
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: 'check',
      isLowesLead: false,
    });

    const webResRetail = webCalcResult({
      details: webDetails,
      markupKey: '100',
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: 'check',
      isLowesLead: false,
    });

    const mobResRetail = mobileCalcResult({
      details: active,
      markupKey: '100',
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: 'check',
      isLowesLead: false,
    });

    expect(Math.round(mobResCost)).toBe(Math.round(webResCost));
    expect(Math.round(mobResRetail)).toBe(Math.round(webResRetail));
    expect(Math.round(webResCost)).toBe(8575);
    expect(Math.round(webResRetail)).toBe(18080);
  });

  test('extraLabor only in inputs matches web flat object', () => {
    const flat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      extraLabor: '1',
      wedges: '60',
      paymentPlan: 'check',
    };

    const nested = {
      inputs: {
        gutter6Ft1: '45',
        versaMaxFt1: '225',
        versa6Ft1: '80',
        extraLabor: '1',
        paymentPlan: 'check',
      },
      extras: {
        wedges: '60',
        extraLabor: '',
      },
    };

    ['50', '65', '100'].forEach((markupKey) => {
      const webRes = webCalcResult({
        details: flat,
        markupKey,
        pricing,
        extrasList,
        extrasList50,
        paymentPlans,
        paymentMethod: 'check',
      });
      const mobRes = mobileCalcResult({
        details: nested,
        markupKey,
        pricing,
        extrasList,
        extrasList50,
        paymentPlans,
        paymentMethod: 'check',
      });
      expect(Math.round(mobRes)).toBe(Math.round(webRes));
    });
  });

  test('tier prices reflect selected payment plan bank fee', () => {
    const active = {
      inputs: {
        gutter6Ft1: '45',
        versaMaxFt1: '225',
        versa6Ft1: '80',
        paymentPlan: 'mcVisaDscvr',
      },
      extras: { wedges: '60' },
    };

    const withCheck = mobileCalcResult({
      details: active,
      markupKey: '100',
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: 'check',
    });

    const withCard = mobileCalcResult({
      details: active,
      markupKey: '100',
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: 'mcVisaDscvr',
    });

    expect(Math.round(withCard)).toBeGreaterThan(Math.round(withCheck));
  });

  test('filter45Ft3 does not double-count vs web flat object', () => {
    const flat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      filter45Ft3: '2',
      wedges: '60',
    };
    const nested = {
      inputs: {
        gutter6Ft1: '45',
        versaMaxFt1: '225',
        versa6Ft1: '80',
        filter45Ft3: '2',
      },
      extras: { wedges: '60' },
    };

    ['50', '65', '100'].forEach((markupKey) => {
      const webRes = webCalcResult({
        details: flat,
        markupKey,
        pricing,
        extrasList,
        extrasList50,
        paymentPlans,
        paymentMethod: 'check',
      });
      const mobFlat = mobileCalcResult({
        details: flat,
        markupKey,
        pricing,
        extrasList,
        extrasList50,
        paymentPlans,
        paymentMethod: 'check',
      });
      const mobNested = mobileCalcResult({
        details: nested,
        markupKey,
        pricing,
        extrasList,
        extrasList50,
        paymentPlans,
        paymentMethod: 'check',
      });
      expect(Math.round(mobFlat)).toBe(Math.round(webRes));
      expect(Math.round(mobNested)).toBe(Math.round(webRes));
    });
  });

  test('Calculations with vertical items (Roofing, Windows, Flooring, Remodeling)', () => {
    const flat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      wedges: '60',
      rfShngl3Tab: '10',
      winSH_VinylStd: '5',
      flMatCarpet: '200',
      rmTubReplace: '1',
    };

    const nested = {
      inputs: {
        gutter6Ft1: '45',
        versaMaxFt1: '225',
        versa6Ft1: '80',
      },
      extras: { wedges: '60' },
      rfShngl3Tab: '10',
      winSH_VinylStd: '5',
      flMatCarpet: '200',
      rmTubReplace: '1',
    };

    ['50', '65', '100'].forEach((markupKey) => {
      const webRes = webCalcResult({
        details: flat,
        markupKey,
        pricing,
        extrasList,
        extrasList50,
        paymentPlans,
        paymentMethod: 'check',
      });
      const mobNested = mobileCalcResult({
        details: nested,
        markupKey,
        pricing,
        extrasList,
        extrasList50,
        paymentPlans,
        paymentMethod: 'check',
      });
      expect(Math.round(mobNested)).toBe(Math.round(webRes));
    });
  });
});

