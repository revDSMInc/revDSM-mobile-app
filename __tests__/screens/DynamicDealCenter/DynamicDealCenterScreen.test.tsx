/**
 * DynamicDealCenterScreen tests — mobile app (mhalt-revdsm-mobile).
 *
 * Source of truth: web DealCenterContext + DynamicJobBuilder flow.
 *
 * Tests:
 *   - Loading, not-configured, and ready states
 *   - Customer name display from lead
 *   - Sync status rendering
 *   - Back button
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// ── Mocks ───────────────────────────────────────────────────────────────

const mockGoBack = jest.fn();

// NOTE: DynamicDealCenterScreen receives `route` as a prop (not from useRoute),
// so we pass it directly to the component. The mock below is just for navigation.
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: any) => children,
  SafeAreaProvider: ({ children }: any) => children,
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack, reset: jest.fn(), dispatch: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

jest.mock('../../../src/screens/DynamicDealCenter/hooks/useCalculatorSchema', () => ({
  useCalculatorSchema: jest.fn(),
}));

jest.mock('../../../src/screens/DynamicDealCenter/hooks/useDynamicCalculatorSchemas', () => ({
  useDynamicCalculatorSchemas: jest.fn(),
}));

jest.mock('../../../src/screens/DynamicDealCenter/hooks/useDynamicCalculators', () => ({
  useDynamicCalculators: jest.fn(),
}));

jest.mock('../../../src/screens/DynamicDealCenter/hooks/useDealPricing', () => ({
  useDealPricing: jest.fn().mockReturnValue({ plans: {}, categories: [], dropAddCategories: [], preOrderOptions: [15, 20, 25], defaultMethod: 'check', defaultPreOrder: 20, seniorVetPct: 5, outcomeDownPaymentMethods: [] }),
}));

jest.mock('../../../src/screens/DynamicDealCenter/components/CalculatorView', () => ({
  CalculatorView: () => null,
}));

jest.mock('../../../src/screens/DynamicDealCenter/components/RolloutView', () => ({
  RolloutView: () => null,
}));

jest.mock('../../../src/screens/DynamicDealCenter/components/ResultJobModal', () => ({
  ResultJobModal: ({ visible }: any) => (visible ? <>{null}</> : null),
}));

jest.mock('../../../src/screens/DynamicDealCenter/DynamicJobBuilderScreen', () => ({
  DynamicJobBuilderScreen: () => null,
}));

jest.mock('../../../src/screens/DynamicDealCenter/utils/build-deal-center-data', () => ({
  buildDealCenterData: jest.fn().mockReturnValue({}),
}));

import DynamicDealCenterScreen from '../../../src/screens/DynamicDealCenter/components/DynamicDealCenterScreen';
import { useCalculatorSchema } from '../../../src/screens/DynamicDealCenter/hooks/useCalculatorSchema';
import { useDynamicCalculatorSchemas } from '../../../src/screens/DynamicDealCenter/hooks/useDynamicCalculatorSchemas';
import { useDynamicCalculators } from '../../../src/screens/DynamicDealCenter/hooks/useDynamicCalculators';

const mockUseCalculatorSchema = useCalculatorSchema as jest.Mock;
const mockUseDynamicCalculatorSchemas = useDynamicCalculatorSchemas as jest.Mock;
const mockUseDynamicCalculators = useDynamicCalculators as jest.Mock;

const defaultCalculatorSchema = {
  configuredSchemas: [{ id: 'v1', name: 'Gutters', categories: [] }],
  isConfigured: true,
  isLoading: false,
};

const defaultDynamicSchemas = {
  config: { verticals: [{ id: 'v1', tabs: [] }] },
  isConfigured: true,
  isLoading: false,
};

const defaultDynamicCalculators = {
  tabs: [{ id: 'tab1', title: 'Job 1', entries: {}, totals: { cost: 0, par: 0, retail: 0 } }],
  activeTabId: 'tab1',
  setActiveTabId: jest.fn(),
  loading: false,
  isSaving: false,
  lastUpdated: null,
  handleEntryChange: jest.fn(),
  handleAddTab: jest.fn(),
  handleDuplicateTab: jest.fn(),
  handleDeleteTab: jest.fn(),
  handleRenameTab: jest.fn(),
  handleReorderTabs: jest.fn(),
  handleConfirmRollouts: jest.fn(),
  handleSetPaymentMethod: jest.fn(),
  handleSetDrops: jest.fn(),
  handleSetDiscount: jest.fn(),
  handleSetDownPayment: jest.fn(),
};

const testLead = {
  _id: 'lead123',
  customerDetails: { firstName: 'John', lastName: 'Doe' },
  leadTime: '24h',
};

function renderScreen(lead = testLead) {
  let root: any;
  ReactTestRenderer.act(() => {
    root = ReactTestRenderer.create(
      <DynamicDealCenterScreen
        route={{ params: { lead } }}
      />,
    );
  });
  return root;
}

describe('DynamicDealCenterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCalculatorSchema.mockReturnValue(defaultCalculatorSchema);
    mockUseDynamicCalculatorSchemas.mockReturnValue(defaultDynamicSchemas);
    mockUseDynamicCalculators.mockReturnValue(defaultDynamicCalculators);
  });

  // ── Loading state ──────────────────────────────────────────────────────
  describe('Loading state', () => {
    test('shows loading when calculator schema is loading', () => {
      mockUseCalculatorSchema.mockReturnValue({ ...defaultCalculatorSchema, isLoading: true });
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Loading calculator');
    });

    test('shows loading when job builder config is loading', () => {
      mockUseDynamicCalculatorSchemas.mockReturnValue({ ...defaultDynamicSchemas, isLoading: true });
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Loading calculator');
    });
  });

  // ── "Not configured" state ────────────────────────────────────────────
  describe('Not configured state', () => {
    test('shows not-configured when calculator schema is missing', () => {
      mockUseCalculatorSchema.mockReturnValue({ ...defaultCalculatorSchema, isConfigured: false });
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain("isn");
      expect(json).toContain("configured");
    });

    test('shows not-configured when job builder config is missing', () => {
      mockUseDynamicCalculatorSchemas.mockReturnValue({ ...defaultDynamicSchemas, isConfigured: false });
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain("isn");
      expect(json).toContain("configured");
    });

    test('shows schema-specific message when calculator schema is missing', () => {
      mockUseCalculatorSchema.mockReturnValue({ ...defaultCalculatorSchema, isConfigured: false });
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('calculator form schema');
    });

    test('shows config-specific message when job builder config is missing', () => {
      mockUseDynamicCalculatorSchemas.mockReturnValue({ ...defaultDynamicSchemas, isConfigured: false });
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('job-builder configuration');
    });
  });

  // ── Customer name display ─────────────────────────────────────────────
  describe('Customer name display', () => {
    test('shows lead customer first + last name with lead time', () => {
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('John');
      expect(json).toContain('Doe');
      expect(json).toContain('24h');
    });
  });

  // ── Sync status ──────────────────────────────────────────────────────
  describe('Sync status', () => {
    test('shows syncing when isSaving is true', () => {
      mockUseDynamicCalculators.mockReturnValue({ ...defaultDynamicCalculators, isSaving: true });
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Syncing');
    });

    test('shows "No changes to save" when not saving and no lastUpdated', () => {
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('No changes to save');
    });

    test('shows last updated time when available', () => {
      mockUseDynamicCalculators.mockReturnValue({
        ...defaultDynamicCalculators,
        isSaving: false,
        lastUpdated: '10:30 AM',
      });
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Last updated at');
    });
  });

  // ── Back button ───────────────────────────────────────────────────────
  describe('Back navigation', () => {
    test('renders at least one pressable/touchable', () => {
      const root = renderScreen();
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain('Ionicons');
    });
  });
});
