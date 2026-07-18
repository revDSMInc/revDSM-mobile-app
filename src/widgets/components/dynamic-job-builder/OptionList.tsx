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
}: OptionListProps) {
  const requestedCols = columns && columns > 0 ? Math.max(1, Math.round(columns)) : autoColumns(options);
  // Long option labels (e.g. Roofing → Shingles "Premium Architectural (30-year)")
  // clip on a narrow phone when the schema requests 3–4 columns. Web fits them by
  // shrinking the font to fit desktop-wide cells; on mobile we instead cap the
  // columns so the label has room — very long ⇒ stacked full-width, long ⇒ 2-up —
  // then let the text wrap (below) so nothing is cut off. Short options are unaffected.
  const longestOption = options.reduce((max, o) => Math.max(max, (o || '').length), 0);
  const columnCap = longestOption > 18 ? 1 : longestOption > 10 ? 2 : requestedCols;
  const cols = Math.min(requestedCols, columnCap);
  const selectedValues = isMulti ? (Array.isArray(value) ? value : []) : [];

  const isSelected = (opt: string) =>
    isMulti ? selectedValues.includes(opt) : value === opt;

  const handlePress = (opt: string) => {
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
                className="py-3.5 rounded-xl border-2"
                style={{
                  // Stacked options read left-aligned with roomy padding (web's
                  // `justifyContent: 'flex-start'`); side-by-side ones center in
                  // their column and drop the padding so labels don't clip.
                  alignItems: cols > 1 ? 'center' : 'flex-start',
                  paddingHorizontal: cols > 1 ? 4 : 20,
                  borderColor: selected ? color : '#F1F5F9',
                  backgroundColor: selected ? `${color}12` : '#fff',
                }}
              >
                <Text
                  numberOfLines={2}
                  className="text-[12px] font-black"
                  style={{
                    color: selected ? color : '#64748B',
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
