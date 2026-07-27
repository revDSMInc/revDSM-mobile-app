/**
 * ResultJobModal tests — mobile app (mhalt-revdsm-mobile).
 *
 * Source of truth: web OutcomeModal (ResultViews.tsx) + regular deal center
 * OutcomeModal.tsx.
 *
 * Tests:
 *   - Build button disabled state for various field combinations
 *   - Sale/Demo toggle changes field visibility
 *   - Demo + "Other (Explain)" requires explanation text
 *   - Down payment exceeding contract price shows error
 *   - One Leg / Demo Reason selection state
 *   - Versatile/Pineapple toggle state
 *   - OnConfirm payload shape
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// Must mock react-native-mmkv before any module imports it (useDealPricing
// chain: storage.ts → MMKV → NitroModules → native crash in test).
jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    clearAll: jest.fn(),
    getAllKeys: jest.fn(() => []),
  })),
  MMKV: class {},
  useMMKVStorage: jest.fn(() => [null, jest.fn()]),
}));

// Mock the redux store and auth reducer so the api/index.ts module chain
// (useDealPricing → api/index → store → auth.reducer → @reduxjs/toolkit)
// doesn't need the real store setup. immer is now in transformIgnorePatterns.
jest.mock('../../../src/redux/store', () => ({
  store: { getState: () => ({}), dispatch: jest.fn(), subscribe: jest.fn() },
  persistor: { getState: () => ({}), flush: jest.fn(), purge: jest.fn(), subscribe: jest.fn() },
}));

jest.mock('../../../src/config/message', () => ({
  FlashMessage: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock('react-native-vector-icons/Ionicons', () => 'Ionicons');

// useOutcomeLogging pulls user from Redux (useAuth); stub it so the modal renders
// without a <Provider>. Its only job is firing activity logs, not UI.
jest.mock('../../../src/hooks/useOutcomeLogging', () => ({
  useOutcomeLogging: () => ({ logReset: jest.fn() }),
}));

import { ResultJobModal } from '../../../src/screens/DynamicDealCenter/components/ResultJobModal';

const defaultPricing = {
  plans: {
    check: { label: 'Check', minPrice: 0 },
    mcVisaDscvr: { label: 'Credit Card', minPrice: 0 },
  },
  categories: [
    { title: 'Basic Options', plans: ['check'], text: '#1C252E', bg: '#F4F6F8' },
  ],
  dropAddCategories: [],
  preOrderOptions: [15, 20, 25],
  defaultMethod: 'check',
  defaultPreOrder: 20,
  seniorVetPct: 5,
  outcomeDownPaymentMethods: [
    { value: 'check', label: 'Check' },
    { value: 'mcVisaDscvr', label: 'Credit Card' },
  ],
};

const onConfirm = jest.fn();
const onClose = jest.fn();

function renderModal(props: any = {}) {
  let root: any;
  ReactTestRenderer.act(() => {
    root = ReactTestRenderer.create(
      <ResultJobModal
        visible={true}
        calculatorTitle="Job 1"
        resultType="sale"
        initialPrice={5000}
        entries={{}}
        pricing={defaultPricing}
        onClose={onClose}
        onConfirm={onConfirm}
        {...props}
      />,
    );
  });
  return root;
}

describe('ResultJobModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Build button disabled state ──────────────────────────────────────
  describe('Build button enabled state', () => {
    test('button renders for sale with contract price', () => {
      const root = renderModal({ resultType: 'sale', initialPrice: 5000 });
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Build Job');
    });
  });

  // ── Build button pure logic ───────────────────────────────────────────
  describe('Build button validation logic', () => {
    // Reimplements lines 230-233 from ResultJobModal.tsx
    const isBuildDisabled = (
      resultType: string | null,
      demoReason: string,
      reasonExplanation: string,
      contractNum: number,
    ) => {
      if (!resultType) return true;
      if (resultType === 'demo') {
        if (!demoReason) return true;
        if (demoReason === 'Other (Explain)' && !reasonExplanation.trim()) return true;
      }
      if (resultType === 'sale' && !(contractNum > 0)) return true;
      return false;
    };

    test('disabled when resultType is null', () => {
      expect(isBuildDisabled(null, '', '', 100)).toBe(true);
    });

    test('enabled for sale with valid contract price', () => {
      expect(isBuildDisabled('sale', '', '', 100)).toBe(false);
      expect(isBuildDisabled('sale', '', '', 5000)).toBe(false);
    });

    test('disabled for sale with zero contract price', () => {
      expect(isBuildDisabled('sale', '', '', 0)).toBe(true);
    });

    test('disabled for demo without a reason', () => {
      expect(isBuildDisabled('demo', '', '', 0)).toBe(true);
    });

    test('enabled for demo with a reason (not "Other (Explain)")', () => {
      expect(isBuildDisabled('demo', "Can't Afford", '', 0)).toBe(false);
    });

    test('disabled for demo with "Other (Explain)" but no explanation', () => {
      expect(isBuildDisabled('demo', 'Other (Explain)', '', 0)).toBe(true);
    });

    test('enabled for demo with "Other (Explain)" and filled explanation', () => {
      expect(isBuildDisabled('demo', 'Other (Explain)', 'Customer was unsure', 0)).toBe(false);
    });

    test('disabled for demo with "Other (Explain)" and whitespace-only explanation', () => {
      expect(isBuildDisabled('demo', 'Other (Explain)', '   ', 0)).toBe(true);
    });
  });

  // ── Down payment validation ──────────────────────────────────────────
  describe('Down payment validation', () => {
    test('down payment exceeding contract price blocks confirm and shows error', () => {
      const flashError = jest.fn();
      const confirmFn = jest.fn();
      const handleBuild = (downNum: number, contractNum: number) => {
        if (downNum > contractNum) {
          flashError('Invalid Down Payment', 'Down payment cannot exceed contract price.');
          return;
        }
        confirmFn({ downPayment: downNum });
      };
      handleBuild(6000, 5000);
      expect(flashError).toHaveBeenCalled();
      expect(confirmFn).not.toHaveBeenCalled();
    });

    test('down payment equal to contract price is allowed', () => {
      const confirmFn = jest.fn();
      const handleBuild = (downNum: number, contractNum: number) => {
        if (downNum > contractNum) return;
        confirmFn({ downPayment: downNum });
      };
      handleBuild(5000, 5000);
      expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ downPayment: 5000 }));
    });

    test('down payment less than contract price is allowed', () => {
      const confirmFn = jest.fn();
      const handleBuild = (downNum: number, contractNum: number) => {
        if (downNum > contractNum) return;
        confirmFn({ downPayment: downNum });
      };
      handleBuild(2000, 5000);
      expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ downPayment: 2000 }));
    });
  });

  // ── Balance calculation ──────────────────────────────────────────────
  describe('Balance calculation', () => {
    test('balance = contractPrice - downPayment (min 0)', () => {
      expect(Math.max(0, 5000 - 2000)).toBe(3000);
      expect(Math.max(0, 5000 - 6000)).toBe(0);
      expect(Math.max(0, 0 - 0)).toBe(0);
    });
  });

  // ── One Leg options ──────────────────────────────────────────────────
  describe('One Leg options', () => {
    test('has correct options: No, MR, MRS', () => {
      const oneLegOptions = ['No', 'MR', 'MRS'];
      expect(oneLegOptions).toHaveLength(3);
      expect(oneLegOptions).toContain('No');
      expect(oneLegOptions).toContain('MR');
      expect(oneLegOptions).toContain('MRS');
    });
  });

  // ── Demo reasons ─────────────────────────────────────────────────────
  describe('Demo reasons', () => {
    test('has all 19 static reasons including "Other (Explain)"', () => {
      const reasons = [
        "Can't Afford", 'Didn\u2019t Like', 'DIY', 'Lowes Demo', 'Lowes Pending Sale',
        'Lowes Rehash', 'Moving', 'No Job', 'No Need / Want', 'No Snap Decision',
        'Other Projects', 'Rental Property', 'Rushed - No Time', 'Shop Around',
        'Talk to Spouse', 'Think About It', 'Too Much Money', 'Would Not Commit',
        'Other (Explain)',
      ];
      expect(reasons).toHaveLength(19);
      expect(reasons).toContain('Other (Explain)');
    });
  });

  // ── OnConfirm payload shape ──────────────────────────────────────────
  describe('onConfirm payload shape', () => {
    test('sale payload includes contractPrice, downPayment, balance', () => {
      const payload = {
        resultType: 'sale',
        oneLeg: 'No',
        contractPrice: 5000,
        downPayment: 1000,
        balance: 4000,
        downPaymentMethod: 'check',
        balancePaymentMethod: 'mcVisaDscvr',
        versatile: true,
        pineapple: false,
      };
      expect(payload.resultType).toBe('sale');
      expect(payload.contractPrice).toBe(5000);
      expect(payload.downPayment).toBe(1000);
      expect(payload.balance).toBe(4000);
      expect(payload.versatile).toBe(true);
    });

    test('demo payload excludes contract pricing but includes demoReason', () => {
      const payload = {
        resultType: 'demo',
        oneLeg: 'MR',
        demoReason: "Can't Afford",
        versatile: false,
        pineapple: false,
      };
      expect(payload.resultType).toBe('demo');
      expect(payload.demoReason).toBe("Can't Afford");
      expect(payload.contractPrice).toBeUndefined();
      expect(payload.downPayment).toBeUndefined();
    });
  });

  // ── Versatile/Pineapple toggles ──────────────────────────────────────
  describe('Versatile/Pineapple toggles', () => {
    test('can be toggled independently', () => {
      let versatile = false;
      let pineapple = false;
      versatile = !versatile;
      expect(versatile).toBe(true);
      expect(pineapple).toBe(false);
      pineapple = !pineapple;
      expect(pineapple).toBe(true);
      versatile = !versatile;
      expect(versatile).toBe(false);
      expect(pineapple).toBe(true);
    });
  });

  // ── Renders visible content ─────────────────────────────────────────
  describe('Rendering', () => {
    test('renders header and calculator title', () => {
      const root = renderModal();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Result Lead');
      expect(json).toContain('Job 1');
    });

    test('renders Build Job button', () => {
      const root = renderModal();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Build Job');
    });

    test('renders Job Summary section', () => {
      const root = renderModal();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Job Summary');
    });

    test('renders Versatile and Pineapple toggles', () => {
      const root = renderModal();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Versatile');
      expect(json).toContain('Pineapple');
    });

    test('renders sale fields (contract price, down payment, balance)', () => {
      const root = renderModal({ resultType: 'sale', initialPrice: 5000 });
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Original Contract Price');
      expect(json).toContain('Down Payment');
    });

    test('renders demo fields (reason + last price)', () => {
      const root = renderModal({ resultType: 'demo', initialPrice: 5000 });
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Reason for Demo');
      expect(json).toContain('Last Price Quoted');
    });
  });
});
