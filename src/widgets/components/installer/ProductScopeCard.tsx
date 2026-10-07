import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { productIcon } from '../../../constants/installer';
import { rowText } from '../../../utils/installer-product-scope';
import type { ScopeFieldRow, ScopeSection, SoldProduct } from '../../../config/types/installer';

const LINE_HEIGHT = 20;

const LABEL_WIDTH = '46%';

const CARD_TINT = '10'; // ~6%  — the card itself
const CARD_BORDER = '59'; // ~35% — soft edge, as on the sales card
const BLOCK_TINT = '1F'; // ~12% — a combination block, one step deeper than the card
const RULE = '33'; // ~20% — the rule under the product name

function SpecRow({ row, color, muted }: { row: ScopeFieldRow; color: string; muted: string }) {
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
          <BulletList rows={section.rows} accent={accent} color={color} />
        ))}
    </View>
  );
}

interface Props {
  product: SoldProduct;
  accent: string;
  children?: React.ReactNode;
}

export function ProductScopeCard({ product, accent, children }: Props) {
  const { colors } = useTheme();
  const sections = product.sections ?? [];
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
