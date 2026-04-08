import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const GutterStep = ({ jobState, onUpdate }: any) => {
  const { colors } = useTheme();
  return (
    <View className="px-5 mt-6">
      <Text className="text-xl font-black mb-1" style={{ color: colors.text }}>
        Step 1: Gutters
      </Text>
      <Text className="text-xs font-bold mb-6" style={{ color: colors.textSecondary }}>
        Installation & Accessories Specs
      </Text>
      <ItemRow
        label='5" Gutter'
        price="22"
        value={jobState.gutter.g5}
        onChange={(v: string) => onUpdate('gutter', 'g5', v)}
      />
      <ItemRow
        label='6" Gutter'
        price="23"
        value={jobState.gutter.g6}
        onChange={(v: string) => onUpdate('gutter', 'g6', v)}
      />
      <ItemRow
        label='7" Gutter'
        price="31"
        value={jobState.gutter.g7}
        onChange={(v: string) => onUpdate('gutter', 'g7', v)}
      />
      <Text
        className="text-[11px] font-black uppercase tracking-widest mt-6 mb-4"
        style={{ color: colors.textSecondary }}
      >
        Add-ons
      </Text>
      <ItemRow
        label="Wedges"
        price="3.5"
        value={jobState.gutter.wedges}
        onChange={(v: string) => onUpdate('gutter', 'wedges', v)}
      />
      <ItemRow
        label="Roof Straps"
        price="3.5"
        value={jobState.gutter.straps}
        onChange={(v: string) => onUpdate('gutter', 'straps', v)}
      />
    </View>
  );
};

export const LeafFilterStep = ({ jobState, onUpdate }: any) => {
  const { colors } = useTheme();
  return (
    <View className="px-5 mt-6">
      <Text className="text-xl font-black mb-1" style={{ color: colors.text }}>
        Step 2: LeafFilter
      </Text>
      <Text className="text-xs font-bold mb-6" style={{ color: colors.textSecondary }}>
        Primary Protection Measurements
      </Text>
      <ItemRow
        label="Versa Max Premium"
        price="50"
        value={jobState.leaffilter.versaMax}
        onChange={(v: string) => onUpdate('leaffilter', 'versaMax', v)}
      />
      <ItemRow
        label="C-S-R Standard"
        price="7"
        value={jobState.leaffilter.csr}
        onChange={(v: string) => onUpdate('leaffilter', 'csr', v)}
      />
    </View>
  );
};

export const SoffitFasciaStep = ({
  jobState,
  onUpdate,
  isFascia,
}: {
  jobState: any;
  onUpdate: any;
  isFascia?: boolean;
}) => {
  const { colors } = useTheme();
  return (
    <View className="px-5 mt-6">
      <Text className="text-xl font-black mb-1" style={{ color: colors.text }}>
        Step {isFascia ? '4: Fascia' : '3: Soffit'}
      </Text>
      <Text className="text-xs font-bold mb-6" style={{ color: colors.textSecondary }}>
        {isFascia ? 'Fascia Board & Trim' : 'Ventilation Specs'}
      </Text>
      {isFascia ? (
        <>
          <ItemRow
            label="Trim Wrap"
            price="12"
            value={jobState.fascia.wrap}
            onChange={(v: string) => onUpdate('fascia', 'wrap', v)}
          />
          <ItemRow
            label="Fascia Board"
            price="18"
            value={jobState.fascia.boards}
            onChange={(v: string) => onUpdate('fascia', 'boards', v)}
          />
        </>
      ) : (
        <>
          <ItemRow
            label="Vinyl Soffit"
            price="15"
            value={jobState.soffit.vinyl}
            onChange={(v: string) => onUpdate('soffit', 'vinyl', v)}
          />
          <ItemRow
            label="Porch Soffit"
            price="20"
            value={jobState.soffit.porch}
            onChange={(v: string) => onUpdate('soffit', 'porch', v)}
          />
        </>
      )}
    </View>
  );
};

export const LaborStep = ({ jobState, onUpdate }: any) => {
  const { colors } = useTheme();
  return (
    <View className="px-5 mt-6">
      <Text className="text-xl font-black mb-1" style={{ color: colors.text }}>
        Step 5: Labor & Misc
      </Text>
      <Text className="text-xs font-bold mb-6" style={{ color: colors.textSecondary }}>
        Extra labor and safety requirements
      </Text>
      <ItemRow
        label="Extra Labor (H)"
        price="75"
        value={jobState.gutter.color5}
        onChange={(v: string) => onUpdate('gutter', 'color5', v)}
      />
      <View className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/10 mt-4">
        <View className="flex-row items-center mb-1">
          <Icon name="alert-outline" size={12} color="#EA580C" style={{ marginRight: 4 }} />
          <Text className="text-[10px] font-black uppercase tracking-widest text-orange-600">
            Safety Notice
          </Text>
        </View>
        <Text className="text-[11px] font-bold" style={{ color: colors.text }}>
          Include 40ft ladder if roof height exceeds 2 stories.
        </Text>
      </View>
    </View>
  );
};

export const ItemRow = ({ label, price, value, onChange }: any) => {
  const { colors, isDark } = useTheme();
  return (
    <View
      className="h-14 border rounded-2xl flex-row items-center justify-between px-4 mb-3"
      style={{
        borderColor: colors.border,
        backgroundColor: isDark ? colors.grey[800] : colors.grey[100],
      }}
    >
      <Text
        className="text-[11px] font-black flex-1 uppercase tracking-widest"
        style={{ color: colors.textSecondary }}
      >
        {label}
      </Text>
      <TextInput
        value={String(value)}
        onChangeText={onChange}
        keyboardType="numeric"
        className="w-20 h-10 text-right font-black mr-3 rounded-xl px-3"
        style={{
          color: colors.text,
          backgroundColor: isDark ? colors.background : colors.grey[100],
        }}
        placeholder="0"
      />
      <Text className="text-[11px] font-black w-14 text-right" style={{ color: colors.text }}>
        ${price}
      </Text>
    </View>
  );
};
