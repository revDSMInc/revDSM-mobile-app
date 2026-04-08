import React, { useState, useEffect, useMemo } from 'react';
import { calculateQuote } from './utils/calculation-utils';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import { LeadService } from '../../../services/api/leads';
import { ModalContainer, ModalHeader } from './components/SharedElements';

interface Props {
  lead: any;
  onCalculate?: (results: any) => void;
  onClose: () => void;
}

export default function LFCalculator({ lead, onCalculate, onClose }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [calculatorId, setCalculatorId] = useState<string | null>(null);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);

  const [expanded, setExpanded] = useState({
    gutters: true,
    leaffilter: true,
    soffit: false,
    fascia: false,
  });

  const [inputs, setInputs] = useState<any>({
    gutter5: '',
    gutter6: '',
    gutter7: '',
    versaMax: '',
    csr: '',
    vinylSoffit: '',
    trimWrap: '',
  });

  const [discounts, setDiscounts] = useState({ seniorVet: false, preOrder: false });

  useEffect(() => {
    const init = async () => {
      if (!lead?._id) return;
      setLoading(true);
      try {
        const appts = await LeadService.getAppointments();
        const myAppt = appts.data?.data?.find(
          (a: any) => a.leadId === lead._id || a.selfGenLeadId === lead._id
        );
        if (myAppt) {
          setAppointmentId(myAppt._id);
          const calcs = await LeadService.getCalculators(myAppt._id);
          if (calcs.data?.data?.[0]) {
            const c = calcs.data.data[0];
            setCalculatorId(c._id);
            setInputs({
              gutter5: String(c.gutter5DsE || ''),
              gutter6: String(c.gutter6Ft1 || ''),
              gutter7: String(c.gutter7DsE || ''),
              versaMax: String(c.versaMaxFt1 || ''),
              csr: String(c.csr || ''),
              vinylSoffit: String(c.vinylSoffit || ''),
              trimWrap: String(c.trimWrap || ''),
            });
          }
        }
      } catch (err) {
        console.warn('Sync failed', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [lead?._id]);

  const results = useMemo(() => {
    const rawInputs = {
      gutter5DsE: Number(inputs.gutter5) || 0,
      gutter6Ft1: Number(inputs.gutter6) || 0,
      gutter7DsE: Number(inputs.gutter7) || 0,
      versaMaxFt1: Number(inputs.versaMax) || 0,
      ...inputs,
    };
    const calculation = calculateQuote(
      rawInputs,
      {}, // extras
      1, // storyCount
      '1', // markup
      'cash', // paymentPlan
      discounts
    );
    return {
      msrp: calculation.baseRetailTotal.toFixed(2),
      total: calculation.finalPrice.toFixed(2),
      savings: (calculation.baseRetailTotal - calculation.finalPrice).toFixed(2),
    };
  }, [inputs, discounts]);

  const toggleSection = (s: string) =>
    setExpanded({
      ...expanded,
      [s as keyof typeof expanded]: !expanded[s as keyof typeof expanded],
    });

  const InputField = ({ label, value, keyName, placeholder }: any) => (
    <View className="mb-4">
      <Text
        className="text-[10px] font-black uppercase tracking-widest mb-1 ml-1"
        style={{ color: colors.textSecondary }}
      >
        {label}
      </Text>
      <TextInput
        className="h-14 border rounded-2xl px-4 text-sm font-bold"
        style={{
          borderColor: colors.border,
          backgroundColor: isDark ? colors.grey[800] : colors.grey[100],
          color: colors.text,
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary + '40'}
        keyboardType="numeric"
        value={value}
        onChangeText={(txt) => setInputs({ ...inputs, [keyName]: txt })}
      />
    </View>
  );

  const Section = ({ title, id, children, icon }: any) => (
    <View
      className="mb-4 rounded-[24px] overflow-hidden border"
      style={{
        borderColor: colors.border,
        backgroundColor: isDark ? colors.surface : colors.background,
      }}
    >
      <TouchableOpacity
        onPress={() => toggleSection(id)}
        className="flex-row items-center justify-between p-5"
      >
        <View className="flex-row items-center">
          <Text className="text-xl mr-3">{icon}</Text>
          <Text
            className="text-[11px] font-black uppercase tracking-widest"
            style={{ color: colors.text }}
          >
            {title}
          </Text>
        </View>
        <Text style={{ color: colors.textSecondary }}>
          {expanded[id as keyof typeof expanded] ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>
      {expanded[id as keyof typeof expanded] && <View className="px-5 pb-5">{children}</View>}
    </View>
  );

  return (
    <ModalContainer>
      <ModalHeader title="LF Calculator" subtitle="Metric Triage Helper" onClose={onClose} />

      {loading && (
        <View
          className="absolute inset-0 z-50 items-center justify-center"
          style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)' }}
        >
          <ActivityIndicator color={colors.primary.main} size="large" />
        </View>
      )}

      <ScrollView className="flex-1 p-5" showsVerticalScrollIndicator={false}>
        <Section title="Gutters" id="gutters" icon="🏠">
          <InputField
            label='5" Gutter (FT)'
            value={inputs.gutter5}
            keyName="gutter5"
            placeholder="0"
          />
          <InputField
            label='6" Gutter (FT)'
            value={inputs.gutter6}
            keyName="gutter6"
            placeholder="0"
          />
          <InputField
            label='7" Gutter (FT)'
            value={inputs.gutter7}
            keyName="gutter7"
            placeholder="0"
          />
        </Section>

        <Section title="LeafFilter" id="leaffilter" icon="🏢">
          <InputField
            label="Versa Max (FT)"
            value={inputs.versaMax}
            keyName="versaMax"
            placeholder="0"
          />
          <InputField label="CSR Standard (FT)" value={inputs.csr} keyName="csr" placeholder="0" />
        </Section>

        <Section title="Fascia / Soffit" id="soffit" icon="🏗️">
          <InputField
            label="Vinyl Soffit (FT)"
            value={inputs.vinylSoffit}
            keyName="vinylSoffit"
            placeholder="0"
          />
          <InputField
            label="Trim Wrap (FT)"
            value={inputs.trimWrap}
            keyName="trimWrap"
            placeholder="0"
          />
        </Section>

        <View className="mt-8 mb-10">
          <View
            className="p-6 rounded-[32px] border shadow-2xl"
            style={{
              borderColor: colors.border,
              backgroundColor: isDark ? colors.surface : colors.background,
            }}
          >
            <View
              className="flex-row items-center justify-between mb-4 border-b pb-4"
              style={{ borderBottomColor: colors.border }}
            >
              <Text
                className="text-base font-black uppercase tracking-widest"
                style={{ color: colors.text }}
              >
                Grand Total
              </Text>
              <Text className="text-2xl font-black" style={{ color: colors.primary.main }}>
                ${results.total}
              </Text>
            </View>
            <View className="gap-2">
              <View className="flex-row justify-between">
                <Text
                  className="text-[10px] font-black uppercase"
                  style={{ color: colors.textSecondary }}
                >
                  MSRP Total
                </Text>
                <Text className="text-[10px] font-black" style={{ color: colors.text }}>
                  ${results.msrp}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text
                  className="text-[10px] font-black uppercase"
                  style={{ color: colors.primary.main }}
                >
                  Total Savings
                </Text>
                <Text className="text-[10px] font-black" style={{ color: colors.primary.main }}>
                  -${results.savings}
                </Text>
              </View>
            </View>

            <View className="mt-6 flex-row gap-2">
              <TouchableOpacity
                onPress={() => setDiscounts({ ...discounts, seniorVet: !discounts.seniorVet })}
                className="flex-1 py-3 border rounded-xl items-center"
                style={{
                  backgroundColor: discounts.seniorVet ? colors.primary.main + '10' : 'transparent',
                  borderColor: discounts.seniorVet ? colors.primary.main : colors.border,
                }}
              >
                <Text
                  className="text-[10px] font-black uppercase"
                  style={{
                    color: discounts.seniorVet ? colors.primary.main : colors.textSecondary,
                  }}
                >
                  Senior/Vet 10%
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDiscounts({ ...discounts, preOrder: !discounts.preOrder })}
                className="flex-1 py-3 border rounded-xl items-center"
                style={{
                  backgroundColor: discounts.preOrder ? colors.primary.main + '10' : 'transparent',
                  borderColor: discounts.preOrder ? colors.primary.main : colors.border,
                }}
              >
                <Text
                  className="text-[10px] font-black uppercase"
                  style={{ color: discounts.preOrder ? colors.primary.main : colors.textSecondary }}
                >
                  Pre-Order 25%
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              className="mt-8 h-14 bg-[#4CBB17] rounded-2xl items-center justify-center shadow-lg shadow-green-600/30"
              onPress={() => {
                onCalculate?.(results);
                onClose();
              }}
            >
              <Text className="text-white text-sm font-black uppercase tracking-widest">
                Commit Estimate
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View className="h-20" />
      </ScrollView>
    </ModalContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
