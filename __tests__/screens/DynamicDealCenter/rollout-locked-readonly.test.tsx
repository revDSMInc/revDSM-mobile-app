/**
 * Rollout quote card — a CONFIRMED (locked) rollout is a receipt, not a form.
 *
 * Regression: the Pre-Order Discount tiles stayed pressable after the end price
 * was locked, so tapping one re-derived MSRP / the program totals on a locked
 * calculator. The end price input already switched to a read-only LOCKED box;
 * the discount row behind its chevron did not.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: ({ children }: any) => <View>{children}</View> };
});
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View: ({ children }: any) => <View>{children}</View> },
    useAnimatedStyle: () => ({}),
    LinearTransition: {},
    FadeOut: {},
  };
});
jest.mock('react-native-vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@react-native-community/blur', () => ({ BlurView: () => null }));
jest.mock('../../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { defaultPercentage: 15, defaultPaymentMethod: null }, refreshUser: jest.fn() }),
}));
jest.mock('../../../src/theme/ThemeProvider', () => ({
  useTheme: () => ({ isDark: false, colors: { surface: '#fff' } }),
}));
jest.mock('../../../src/services/api/SettingsService', () => ({
  SettingsService: { updateCalculatorsSetting: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../../../src/config/message', () => ({
  FlashMessage: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
// The rollout card now renders <RevRenderSlots>, which calls useRevRenderRunsQuery
// (react-query). This locked/readonly test renders RolloutView without a
// QueryClientProvider, so stub the hook — renders aren't relevant to the pricing lock.
jest.mock('../../../src/hooks/useLeadQuery', () => ({
  useRevRenderRunsQuery: () => ({ data: [], isLoading: false }),
}));

const { RolloutView } = require('../../../src/screens/DynamicDealCenter/components/RolloutView');

const pricing = {
  plans: {},
  categories: [],
  dropAddCategories: [],
  preOrderOptions: [15, 20, 25],
  defaultMethod: 'check',
  defaultPreOrder: 15,
  seniorVetPct: 10,
  outcomeDownPaymentMethods: [],
  discountConfig: null,
  isDynamic: false,
};

const baseCalc = {
  id: 'c1',
  title: 'Shng+Und',
  entries: {},
  totals: { cost: 11797, par: 13225, retail: 19579 },
  price: 20000,
  discountPercentage: 15,
};

const render = (calc: any, onDiscountChange = jest.fn()) => {
  let tree: any;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <RolloutView
        calculators={[calc]}
        verticals={[]}
        pricing={pricing}
        activeTabId="c1"
        onBack={jest.fn()}
        onConfirmRollouts={jest.fn()}
        onDiscountChange={onDiscountChange}
      />
    );
  });
  return tree;
};

/** The pressable ancestor of a rendered text node (`{d}%` renders as [d, '%']). */
const pressableFor = (tree: any, match: (children: any) => boolean) => {
  const text = tree.root.findAllByType('Text').find((n: any) => match(n.props.children));
  if (!text) return null;
  let node: any = text;
  while (node && !node.props?.onPress) node = node.parent;
  return node;
};

const discountTile = (tree: any, pct: number) =>
  pressableFor(tree, (c) => Array.isArray(c) && c[0] === pct && c[1] === '%');

/** Expand the locked breakdown — the LOCKED end-price box is a chevron toggle. */
const expandLocked = (tree: any) => {
  const box = pressableFor(tree, (c) => c === 'LOCKED');
  ReactTestRenderer.act(() => box.props.onPress());
};

describe('rollout quote card — unlocked', () => {
  it('lets the rep change the pre-order discount', () => {
    const onDiscountChange = jest.fn();
    const tree = render(baseCalc, onDiscountChange);

    const tile = discountTile(tree, 25);
    expect(tile.props.disabled).toBeFalsy();

    ReactTestRenderer.act(() => tile.props.onPress());
    expect(onDiscountChange).toHaveBeenCalledWith('c1', 25);
  });
});

describe('rollout quote card — locked (isRolloutConfirmed)', () => {
  const lockedCalc = { ...baseCalc, isRolloutConfirmed: true };

  it('keeps the breakdown collapsed until the chevron is tapped', () => {
    const tree = render(lockedCalc);
    expect(discountTile(tree, 25)).toBeNull();
  });

  it('disables every pre-order discount tile once expanded', () => {
    const tree = render(lockedCalc);
    expandLocked(tree);

    for (const pct of pricing.preOrderOptions) {
      const tile = discountTile(tree, pct);
      expect(tile).not.toBeNull();
      expect(tile.props.disabled).toBe(true);
    }
  });

  it('disables the Set-as-Default discount toggle once expanded', () => {
    const tree = render(lockedCalc);
    expandLocked(tree);

    // Both "Set as Default" switches render as a 32-wide pressable; only the
    // discount one (inside the locked breakdown) should be disabled.
    const switches = tree.root.findAll((n: any) => n.props?.onPress && n.props?.style?.width === 32);
    expect(switches.some((n: any) => n.props.disabled === true)).toBe(true);
  });

  it('still shows the locked breakdown figures (it is a receipt, not hidden)', () => {
    const tree = render(lockedCalc);
    expandLocked(tree);
    const texts = tree.root
      .findAllByType('Text')
      .flatMap((n: any) => (typeof n.props.children === 'string' ? [n.props.children] : []));
    // MSRP at 15% + 10% Sr/Vet on a 20,000 end price.
    expect(texts).toContain('$26,667');
  });
});
