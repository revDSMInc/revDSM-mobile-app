import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface OptionListProps {
  label?: string;
  options?: string[];
  value?: string | string[];
  onChange?: (val: string | string[]) => void;
  color?: string;
  /** Columns per row, from the schema (web `getOptionGridSize(field.columns)` → 12/span). */
  columns?: number;
  /** Multi-select (web `field.multiSelect`) — value is an array, boxes toggle in/out. */
  isMulti?: boolean;
  /**
   * Ticket 1063 — portal "Rep can use this dropdown → No" (`field.disabled`).
   * The chips grey out and stop responding, but the CURRENT VALUE STAYS VISIBLY
   * SELECTED: the rep must still be able to read what was chosen for them.
   */
  disabled?: boolean;
}

const GAP = 8; // matches gap-2 used by SwatchPicker/RoomPicker

/**
 * Auto column count when the schema doesn't configure one — ports the option
 * count / text-length rules from web `option-selector.js` `getGridSize()`
 * (2 options → xs 6 = 2 cols, 3 → xs 4 = 3 cols, 4 → xs 3 = 4 cols unless an
 * option is long, else xs 6 = 2 cols). So short 3-option fields like Gutter
 * Opening Width sit on a single row instead of stacking.
 */
function autoColumns(options: string[]): number {
  const hasLongText = options.some((o) => (o || '').length > 10);
  if (options.length === 2) return 2;
  if (options.length === 3) return hasLongText ? 1 : 3;
  if (options.length === 4) return hasLongText ? 2 : 4;
  return 2;
}

// Matches the normal Job Builder selector styling: #22C55E selected, slate idle,
// rounded-xl border-2, font-black. When `columns` > 1 the options wrap into a
// grid (web parity — MUI `<Grid item xs>` wrapping), so soffit/fascia "size" /
// "board type" render 2-up and rows grow with options. When `isMulti`, value is
// an array and multiple boxes stay selected (web parity — `option-selector.js`
// handleSelection: e.g. gutter modify-height locations). The selected option is
// shown by its own highlighted state only — no "✓ value" echo underneath, which
// read as a second, duplicate selection.
export function OptionList({
  label,
  options = [],
  value,
  onChange,
  color = '#22C55E',
  columns,
  isMulti = false,
  disabled = false,
}: OptionListProps) {
  const requestedCols = columns && columns > 0 ? Math.max(1, Math.round(columns)) : autoColumns(options);
  // Long option labels (e.g. Roofing → Labor "Standard (4/12 and under)" / Shingles
  // "Premium Architectural (30-year)") clip on a narrow phone when the schema
  // requests 3–4 columns. Web keeps them readable by dropping such groups to a
  // 2-up grid (`option-selector.js` getGridSize → 6 for 4 long options); we mirror
  // that here — long options are capped at 2 columns (two rows) and the text wraps
  // (below) instead of being cut off. Short options are unaffected.
  const longestOption = options.reduce((max, o) => Math.max(max, (o || '').length), 0);
  const columnCap = longestOption > 10 ? 2 : requestedCols;
  const cols = Math.min(requestedCols, columnCap);
  const selectedValues = isMulti ? (Array.isArray(value) ? value : []) : [];

  const isSelected = (opt: string) =>
    isMulti ? selectedValues.includes(opt) : value === opt;

  const handlePress = (opt: string) => {
    // Ticket 1063: a disabled field is not just visually locked — tapping must be a
    // complete no-op, INCLUDING the deselect-on-tap below, or the rep could clear a
    // value they are not allowed to set.
    if (disabled) return;
    if (isMulti) {
      // Web parity (option-selector.js): toggle membership in the array.
      const next = selectedValues.includes(opt)
        ? selectedValues.filter((v) => v !== opt)
        : [...selectedValues, opt];
      onChange?.(next);
      return;
    }
    // Web parity (useCanDeselectSelection): tapping the selected option clears it.
    onChange?.(value === opt ? '' : opt);
  };

  return (
    <View className="mb-4">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-2">{label}</Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -GAP / 2 }}>
        {options.map((opt) => {
          const selected = isSelected(opt);
          return (
            <View key={opt} style={{ width: `${100 / cols}%`, padding: GAP / 2 }}>
              <TouchableOpacity
                onPress={() => handlePress(opt)}
                disabled={disabled}
                accessibilityState={{ disabled, selected }}
                className="py-3.5 rounded-xl border-2"
                style={{
                  // Stacked options read left-aligned with roomy padding (web's
                  // `justifyContent: 'flex-start'`); side-by-side ones center in
                  // their column and drop the padding so labels don't clip.
                  alignItems: cols > 1 ? 'center' : 'flex-start',
                  paddingHorizontal: cols > 1 ? 4 : 20,
                  // Disabled keeps the SELECTED chip readable (muted slate, not the
                  // accent) and mutes the rest — precedent: CalculatorView FieldRow's
                  // `#94A3B8`. Never `x ? v : undefined` here: these values are read
                  // directly, but keeping them concrete also keeps the style mergeable.
                  borderColor: disabled ? (selected ? '#CBD5E1' : '#F1F5F9') : selected ? color : '#F1F5F9',
                  backgroundColor: disabled ? '#F8FAFC' : selected ? `${color}12` : '#fff',
                }}
              >
                <Text
                  numberOfLines={3}
                  className="text-[12px] font-black"
                  style={{
                    color: disabled ? (selected ? '#64748B' : '#94A3B8') : selected ? color : '#64748B',
                    textAlign: cols > 1 ? 'center' : 'left',
                  }}
                >
                  {opt}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}
