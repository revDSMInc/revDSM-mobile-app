import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { LeadService } from '../../../services/api/leads';
import { ModalContainer, ModalHeader } from './components/SharedElements';
import {
  GutterStep,
  LeafFilterStep,
  SoffitFasciaStep,
  LaborStep,
} from './components/JobBuilderSteps';
import { SummaryStep } from './components/JobBuilderSummary';

interface Props {
  lead: any;
  onClose: () => void;
  onSubmit: (payload: any) => Promise<void>;
}

export default function JobBuilder({ lead, onClose, onSubmit }: Props) {
  const { colors, isDark } = useTheme();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const initialJobState = {
    id: Date.now(),
    name: 'Primary Calculation',
    endPrice: '0',
    gutter: {
      color5: '',
      color6: '',
      color7: '',
      g5: '0',
      g6: '0',
      g7: '0',
      wedges: '0',
      straps: '0',
    },
    leaffilter: { versaMax: '0', csr: '0' },
    soffit: { vinyl: '0', porch: '0' },
    fascia: { wrap: '0', boards: '0' },
    discounts: { seniorVet: false, preOrder: false },
  };

  const [calculations, setCalculations] = useState<any[]>([initialJobState]);
  const [activeIndex, setActiveIndex] = useState(0);
  const jobState = calculations[activeIndex];

  useEffect(() => {
    const fetchSaved = async () => {
      if (lead?._id) {
        setLoading(true);
        try {
          const res = await LeadService.getJobBuilder(lead._id);
          if (res.data?.jobBuilder) setCalculations([res.data.jobBuilder]);
        } catch (err) {
          console.warn('Sync failed', err);
        } finally {
          setLoading(false);
        }
      }
    };
    fetchSaved();
  }, [lead?._id]);

  const calculateTotal = (state: any) => {
    let base =
      (Number(state.gutter.g5) || 0) * 22 +
      (Number(state.gutter.g6) || 0) * 23 +
      (Number(state.gutter.g7) || 0) * 31 +
      (Number(state.gutter.wedges) || 0) * 3.5 +
      (Number(state.gutter.straps) || 0) * 3.5 +
      (Number(state.leaffilter.versaMax) || 0) * 50 +
      (Number(state.leaffilter.csr) || 0) * 7 +
      (Number(state.soffit.vinyl) || 0) * 15 +
      (Number(state.fascia.wrap) || 0) * 12 +
      (Number(state.gutter.color5) || 0) * 75;
    if (state.discounts.seniorVet) base *= 0.9;
    if (state.discounts.preOrder) base *= 0.75;
    return base.toFixed(2);
  };

  const updateSectionState = (section: string, key: string, value: any) => {
    const next = [...calculations];
    const current = {
      ...next[activeIndex],
      [section]: { ...next[activeIndex][section], [key]: value },
    };
    current.endPrice = calculateTotal(current);
    next[activeIndex] = current;
    setCalculations(next);
  };

  const handleDuplicate = () => {
    const duplicate = { ...jobState, id: Date.now(), name: `${jobState.name} (Copy)` };
    setCalculations([...calculations, duplicate]);
    setActiveIndex(calculations.length);
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        return <GutterStep jobState={jobState} onUpdate={updateSectionState} />;
      case 2:
        return <LeafFilterStep jobState={jobState} onUpdate={updateSectionState} />;
      case 3:
        return <SoffitFasciaStep jobState={jobState} onUpdate={updateSectionState} />;
      case 4:
        return <SoffitFasciaStep jobState={jobState} onUpdate={updateSectionState} isFascia />;
      case 5:
        return <LaborStep jobState={jobState} onUpdate={updateSectionState} />;
      case 6:
        return (
          <SummaryStep
            jobState={jobState}
            onUpdate={updateSectionState}
            calculateTotal={calculateTotal}
          />
        );
      default:
        return null;
    }
  };

  return (
    <ModalContainer>
      <ModalHeader title="Job Builder" subtitle="Lead Triage & Estimation" onClose={onClose} />

      {/* Dynamic Step Progress Area */}
      <View
        className="flex-row items-center justify-between px-5 py-4 border-b"
        style={{
          backgroundColor: isDark ? colors.background : colors.grey[100],
          borderBottomColor: colors.border,
        }}
      >
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => setCurrentStep(s)}
            className="w-[14%] h-1 bg-slate-200 rounded-full"
            style={{ backgroundColor: currentStep >= s ? '#4CBB17' : colors.border }}
          />
        ))}
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between px-5 py-6">
          <View>
            <Text
              className="text-[10px] font-black uppercase tracking-widest"
              style={{ color: colors.textSecondary }}
            >
              Active Client
            </Text>
            <Text className="text-sm font-black mt-0.5" style={{ color: colors.text }}>
              {lead?.customerDetails?.firstName} {lead?.customerDetails?.lastName}
            </Text>
          </View>
          <View className="items-end">
            <Text
              className="text-[10px] font-black uppercase tracking-widest"
              style={{ color: colors.textSecondary }}
            >
              Session Payout
            </Text>
            <Text className="text-sm font-black mt-0.5 text-[#4CBB17]">
              ${(Number(jobState.endPrice) * 0.1).toFixed(2)}
            </Text>
          </View>
        </View>

        {renderCurrentStep()}

        <View className="mt-12 px-5 mb-10">
          <View className="flex-row items-center justify-between mb-6">
            <Text
              className="text-lg font-black uppercase tracking-widest"
              style={{ color: colors.text }}
            >
              Variants History
            </Text>
            <TouchableOpacity
              onPress={handleDuplicate}
              className="p-3 bg-[#4CBB17] rounded-2xl shadow-lg"
            >
              <Text className="text-white text-lg font-black">+</Text>
            </TouchableOpacity>
          </View>
          {calculations.map((calc, idx) => (
            <TouchableOpacity
              key={calc.id}
              onPress={() => setActiveIndex(idx)}
              className="mb-4 p-5 rounded-[24px] border flex-row items-center justify-between"
              style={{
                borderColor: activeIndex === idx ? colors.primary.main : colors.border,
                backgroundColor:
                  activeIndex === idx
                    ? isDark
                      ? colors.primary.main + '10'
                      : colors.primary.main + '05'
                    : isDark
                    ? colors.surface
                    : colors.background,
              }}
            >
              <View className="flex-row items-center">
                <View
                  className="w-8 h-8 rounded-full items-center justify-center mr-4"
                  style={{ backgroundColor: isDark ? colors.grey[800] : colors.grey[200] }}
                >
                  <Text className="text-xs font-black" style={{ color: colors.text }}>
                    {idx + 1}
                  </Text>
                </View>
                <View>
                  <Text className="text-sm font-black" style={{ color: colors.text }}>
                    {calc.name}
                  </Text>
                  <Text
                    className="text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: colors.textSecondary }}
                  >
                    {activeIndex === idx ? 'Viewing' : 'Archived'}
                  </Text>
                </View>
              </View>
              <Text className="text-base font-black text-[#4CBB17]">${calc.endPrice}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View className="h-20" />
      </ScrollView>

      <View
        className="px-6 py-6 border-t flex-row gap-3 shadow-2xl"
        style={{
          backgroundColor: isDark ? colors.surface : colors.background,
          borderTopColor: colors.border,
          paddingBottom: 40,
        }}
      >
        {currentStep > 1 && (
          <TouchableOpacity
            onPress={() => setCurrentStep((p) => p - 1)}
            className="flex-1 py-4 rounded-xl items-center"
            style={{ backgroundColor: isDark ? colors.grey[800] : colors.grey[100] }}
          >
            <Text
              className="text-[11px] font-black uppercase tracking-widest"
              style={{ color: colors.text }}
            >
              Previous
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => {
            if (currentStep < 6) setCurrentStep((p) => p + 1);
            else onSubmit(jobState);
          }}
          className="flex-[2] py-4 rounded-xl items-center bg-[#4CBB17] shadow-lg shadow-green-600/30"
        >
          <Text className="text-white text-[11px] font-black uppercase tracking-widest">
            {currentStep < 6 ? 'Next Step' : 'Finish & Sync'}
          </Text>
        </TouchableOpacity>
      </View>
    </ModalContainer>
  );
}
