/**
 * OptionToggleField — single-visible-option lock + auto-select.
 *
 * Source of truth: web `job-builder-common/option-toggle-field.js` (commit
 * 8d1f767) + `locked-single-option-selector.js`.
 *
 * Ticket: "Job builder > Gutter > When Only One Allocation Card Exists then that
 * will show in lock state no need to select that."
 */
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { OptionToggleField } from '../../../src/widgets/components/dynamic-job-builder/OptionToggleField';

const Selector = () => <Text>INTERACTIVE_SELECTOR</Text>;

function render(props: any) {
  let tree: any;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <OptionToggleField {...props}>
        <Selector />
      </OptionToggleField>
    );
  });
  return tree;
}

const texts = (tree: any) =>
  tree.root
    .findAllByType(Text)
    .flatMap((n: any) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c: any) => typeof c === 'string');

describe('rendering', () => {
  it('renders the locked chip and caption when exactly one option is visible', () => {
    const tree = render({ options: ['5" K-Style'], value: '5" K-Style', onChange: jest.fn() });
    const t = texts(tree);

    expect(t).toContain('5" K-Style');
    expect(t).toContain('Only option available');
    expect(t).not.toContain('INTERACTIVE_SELECTOR');
  });

  it('renders the interactive selector when several options are visible', () => {
    const tree = render({ options: ['5"', '6"'], value: '', onChange: jest.fn() });

    expect(texts(tree)).toContain('INTERACTIVE_SELECTOR');
    expect(texts(tree)).not.toContain('Only option available');
  });

  it('renders nothing when no options are visible', () => {
    const tree = render({ options: [], value: '', onChange: jest.fn() });
    expect(tree.toJSON()).toBeNull();
  });

  it('does NOT lock a multi-select field, even with one option', () => {
    const tree = render({ options: ['5" K-Style'], value: [], isMulti: true, onChange: jest.fn() });

    expect(texts(tree)).toContain('INTERACTIVE_SELECTOR');
    expect(texts(tree)).not.toContain('Only option available');
  });

  it('shows the label above the locked chip when one is given', () => {
    const tree = render({ label: 'Gutter Size', options: ['5" K-Style'], value: '5" K-Style', onChange: jest.fn() });
    expect(texts(tree)).toContain('Gutter Size');
  });
});

describe('auto-select — the half that unblocks validation and the allocator', () => {
  it('writes the lone option into state when nothing is selected', () => {
    const onChange = jest.fn();
    render({ options: ['5" K-Style'], value: '', onChange });

    expect(onChange).toHaveBeenCalledWith('5" K-Style');
  });

  it('does not re-write when the lone option is already selected', () => {
    const onChange = jest.fn();
    render({ options: ['5" K-Style'], value: '5" K-Style', onChange });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('never auto-selects for a multi-select field', () => {
    const onChange = jest.fn();
    render({ options: ['5" K-Style'], value: [], isMulti: true, onChange });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not auto-select when several options are visible', () => {
    const onChange = jest.fn();
    render({ options: ['5"', '6"'], value: '', onChange });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the auto-selected value once MORE options unlock (web parity)', () => {
    // An auto-locked value must not survive as a sticky default the rep never chose.
    const onChange = jest.fn();
    let tree: any;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <OptionToggleField options={['5" K-Style']} value={'5" K-Style'} onChange={onChange}>
          <Selector />
        </OptionToggleField>
      );
    });
    onChange.mockClear();

    ReactTestRenderer.act(() => {
      tree.update(
        <OptionToggleField options={['5" K-Style', '6" K-Style']} value={'5" K-Style'} onChange={onChange}>
          <Selector />
        </OptionToggleField>
      );
    });

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('clears a value that dependency filtering has since hidden', () => {
    const onChange = jest.fn();
    render({ options: ['6" K-Style', '7" K-Style'], value: '5" K-Style', onChange });

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('leaves a still-visible selection alone', () => {
    const onChange = jest.fn();
    render({ options: ['5" K-Style', '6" K-Style'], value: '6" K-Style', onChange });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not clear an empty value when many options are visible', () => {
    const onChange = jest.fn();
    render({ options: ['5"', '6"'], value: '', onChange });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not touch state when no options are visible', () => {
    const onChange = jest.fn();
    render({ options: [], value: '5" K-Style', onChange });

    expect(onChange).not.toHaveBeenCalled();
  });
});
