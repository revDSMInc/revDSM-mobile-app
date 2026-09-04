import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { productIcon } from '../../../constants/installer';
import { rowText } from '../../../utils/installer-product-scope';
import type { ScopeFieldRow, ScopeSection, SoldProduct } from '../../../config/types/installer';

/**
 * Line height of a spec line — also the height of a bullet's centring box.
 *
 * 20 on the 14 px spec line. The dot centres itself in a box exactly this tall, so it
 * sits on the middle of the first line however the text wraps; a bare margin guess
 * drifts as soon as the font size does.
 */
const LINE_HEIGHT = 20;

/**
 * Width of the label column in a spec row.
 *
 * The rows are read as a table — every label on one edge, every value on another — so
 * the column is a share of the card rather than the widest label: a percentage keeps
 * the values aligned across combinations that carry different fields.
 */
const LABEL_WIDTH = '46%';

/** Alpha suffixes on the product accent. One place, so the tints stay a family. */
const CARD_TINT = '10'; // ~6%  — the card itself
const CARD_BORDER = '59'; // ~35% — soft edge, as on the sales card
const BLOCK_TINT = '1F'; // ~12% — a combination block, one step deeper than the card
const RULE = '33'; // ~20% — the rule under the product name

function SpecRow({ row, color, muted }: { row: ScopeFieldRow; color: string; muted: string }) {
  // No label — the value is the whole of what the field says, so it spans the row.
  if (!row.label) {
    return (
      <Text className="text-sm font-bold py-0.5" style={{ color, lineHeight: LINE_HEIGHT }}>
        {row.value}
      </Text>
    );
  }

  return (
    <View className="flex-row items-start py-0.5">
      <Text
        className="text-[13px] font-semibold"
        style={{ color: muted, width: LABEL_WIDTH, paddingRight: 8, lineHeight: LINE_HEIGHT }}
      >
        {row.label}
      </Text>
      <Text
        className="flex-1 text-[13px] font-bold"
        style={{ color, lineHeight: LINE_HEIGHT }}
      >
        {row.value}
      </Text>
    </View>
  );
}

/** A tinted block — one combination, or a titled group of loose fields ("Extras"). */
function ScopeBlock({
  title,
  headline,
  rows,
  accent,
  color,
  muted,
}: {
  title: string;
  headline?: string;
  rows: ScopeFieldRow[];
  accent: string;
  color: string;
  muted: string;
}) {
  return (
    <View
      className="rounded-xl p-3 mb-2"
      style={{ backgroundColor: accent + BLOCK_TINT }}
    >
      {!!title && (
        <Text className="text-xs font-semibold mb-1.5" style={{ color: muted }}>
          {title}
        </Text>
      )}
      {!!headline && (
        <Text
          className="text-sm font-bold mb-1"
          style={{ color, lineHeight: LINE_HEIGHT }}
        >
          {headline}
        </Text>
      )}
      {rows.map((row, idx) => (
        <SpecRow key={`${row.label}-${idx}`} row={row} color={color} muted={muted} />
      ))}
    </View>
  );
}

/** Loose fields with nothing to title them — the flat list, as bullets. */
function BulletList({
  rows,
  accent,
  color,
}: {
  rows: ScopeFieldRow[];
  accent: string;
  color: string;
}) {
  return (
    <>
      {rows.map((row, idx) => (
        <View key={`bullet-${idx}`} className="flex-row items-start mb-1">
          <View
            className="items-center justify-center mr-2"
            style={{ width: 6, height: LINE_HEIGHT }}
          >
            <View
              className="rounded-full"
              style={{ width: 6, height: 6, backgroundColor: accent }}
            />
          </View>
          <Text
            className="flex-1 text-sm font-semibold"
            style={{ color, lineHeight: LINE_HEIGHT }}
          >
            {rowText(row)}
          </Text>
        </View>
      ))}
    </>
  );
}

function SectionBody({
  section,
  accent,
  color,
  muted,
}: {
  section: ScopeSection;
  accent: string;
  color: string;
  muted: string;
}) {
  const hasCombos = section.combinations.length > 0;

  /*
   * Where the section's own name goes.
   *
   * A section that holds COMBINATIONS is a product within the product ("Vinyl Soffit",
   * "Porch Ceiling SqFT"), so its name is a heading over the blocks. A section that
   * holds only loose fields IS one block ("Extras"), so its name titles that block —
   * printing it in both places would say it twice.
   */
  const heading = hasCombos ? section.label : '';
  const looseTitle = hasCombos ? '' : section.label;

  return (
    <View className="mb-1">
      {!!heading && (
        <Text className="text-sm font-bold mb-1.5" style={{ color }}>
          {heading}
        </Text>
      )}

      {section.combinations.map((combo) => (
        <ScopeBlock
          key={`combo-${combo.number}`}
          title={`Combination #${combo.number}`}
          headline={combo.headline}
          rows={combo.rows}
          accent={accent}
          color={color}
          muted={muted}
        />
      ))}

      {section.rows.length > 0 &&
        (looseTitle || hasCombos ? (
          <ScopeBlock
            title={looseTitle}
            rows={section.rows}
            accent={accent}
            color={color}
            muted={muted}
          />
        ) : (
          // Nothing names them and nothing else is in the section — the flat list is
          // the honest rendering, and it is what a "Additional Services" card is.
          <BulletList rows={section.rows} accent={accent} color={color} />
        ))}
    </View>
  );
}

interface Props {
  product: SoldProduct;
  /** Resolved accent — callers pass `productColor(idx, product.color, product.name)`. */
  accent: string;
  /** Verification controls, rendered under the spec. Read-only surfaces pass none. */
  children?: React.ReactNode;
}

/**
 * One sold product, as the installer reads it: name, then the rep's build laid out the
 * way the sales summary lays it out — a heading per section, a tinted block per
 * combination, and every measurement beside the label it was entered under.
 *
 * Shared by the Job Reference list and Verify Job Scope deliberately. The two drew
 * byte-identical spec lists before this and had already started to drift (two copies of
 * the same bullet geometry, two different title weights); one component is what stops
 * the same product looking like two different jobs on two screens.
 */
export function ProductScopeCard({ product, accent, children }: Props) {
  const { colors } = useTheme();
  const sections = product.sections ?? [];
  // The flat form is the fallback for a payload whose structure came out empty — a
  // shape we have not seen still shows what was sold rather than an empty card.
  const fallback = sections.length === 0 ? product.lines : [];

  return (
    <View
      className="rounded-2xl p-3 mb-2.5 border"
      style={{ backgroundColor: accent + CARD_TINT, borderColor: accent + CARD_BORDER }}
    >
      <View className="flex-row items-center">
        <Icon name={productIcon(product.name)} size={18} color={accent} />
        <Text className="ml-2 text-base font-black" style={{ color: colors.text }}>
          {product.name}
        </Text>
      </View>
      <View
        className="mt-2.5 mb-2.5"
        style={{ borderBottomWidth: 1, borderBottomColor: accent + RULE }}
      />

      {sections.map((section) => (
        <SectionBody
          key={section.id}
          section={section}
          accent={accent}
          color={colors.text}
          muted={colors.textSecondary}
        />
      ))}

      {fallback.length > 0 && (
        <BulletList
          rows={fallback.map((line) => ({ label: '', value: line }))}
          accent={accent}
          color={colors.text}
        />
      )}

      {children}
    </View>
  );
}
