import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getAvailableSteps } from '../../utils/job-builder-util';
import { GutterSection } from '../../widgets/components/job-builder/GutterSection';
import { LeafFilterSection } from '../../widgets/components/job-builder/LeafFilterSection';
import { SoffitSection } from '../../widgets/components/job-builder/SoffitSection';
import { FasciaSection } from '../../widgets/components/job-builder/FasciaSection';
import { MiscSection } from '../../widgets/components/job-builder/MiscSection';
import { SummarySection } from '../../widgets/components/job-builder/SummarySection';
import { LeadService } from '../../services/api/leads';
import { validateStep } from '../../utils/job-builder-validation';
import { Alert } from 'react-native';

const { width, height } = Dimensions.get('window');

const STEPS = [
  { id: 'gutter', label: 'Gutter', icon: 'water-outline' },
  { id: 'leaffilter', label: 'LeafFilter', icon: 'leaf-outline' },
  { id: 'soffit', label: 'Soffit', icon: 'home-outline' },
  { id: 'fascia', label: 'Fascia', icon: 'square-outline' },
  { id: 'additional', label: 'Misc', icon: 'dots-horizontal' },
  { id: 'summary', label: 'Summary', icon: 'clipboard-list-outline' },
];

export default function JobBuilderScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { initialJobState, calculatorData, leadId, outcomeForm, onGoBack } = route.params || {};

  const [jobState, setJobState] = useState(initialJobState || {});
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const availableStepsInfo = useMemo(() => getAvailableSteps(calculatorData), [calculatorData]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Set initial step to first unlocked step
  useEffect(() => {
    if (availableStepsInfo[currentStepIndex]?.isLocked) {
      const firstUnlocked = availableStepsInfo.findIndex((s: any) => !s.isLocked);
      if (firstUnlocked !== -1) setCurrentStepIndex(firstUnlocked);
    }
  }, [availableStepsInfo]);

  const [validationModal, setValidationModal] = useState({ visible: false, error: '' });

  const availableStepIds = useMemo(
    () => availableStepsInfo.map((s: any) => s.category),
    [availableStepsInfo]
  );
  const activeStep = availableStepsInfo[currentStepIndex];

  // Auto-save logic
  useEffect(() => {
    if (!leadId) return;

    const timer = setTimeout(async () => {
      try {
        setIsSaving(true);
        const payload = {
          ...outcomeForm,
          result: 'Sale',
          jobBuilder: jobState,
          LFCalculator: calculatorData,
          calculatorId: calculatorData?._id,
          selectedCalculatorId: calculatorData?._id,
          selectedAppointmentId: calculatorData?.appointmentId,
        };
        await LeadService.updateLeadOutcome(leadId, payload);
      } catch (error) {
        console.warn('[JobBuilder] Auto-save failed:', error);
      } finally {
        setIsSaving(false);
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timer);
  }, [jobState, leadId, outcomeForm, calculatorData]);

  const handleUpdate = useCallback((section: string, field: string, value: any) => {
    if (!section) {
      setJobState((prev: any) => ({
        ...prev,
        [field]: value,
      }));
      return;
    }
    if (!field) {
      setJobState((prev: any) => ({
        ...prev,
        [section]: value,
      }));
      return;
    }
    setJobState((prev: any) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  }, []);

  const renderStepIcon = (step: any, index: number) => {
    const isActive = currentStepIndex === index;
    const isCompleted = index < currentStepIndex && !step.isLocked;

    const handleTabPress = () => {
      if (isActive || step.isLocked) return;

      // Validate current step before allowing navigation forward
      const validation = validateStep(activeStep?.category, jobState, calculatorData);

      if (index > currentStepIndex) {
        if (!validation.valid) {
          setValidationModal({ visible: true, error: validation.error || '' });
          return;
        }
      }

      setCurrentStepIndex(index);
    };

    return (
      <Pressable
        key={step.category}
        onPress={handleTabPress}
        className="items-center"
        style={{ width: (width - 40) / availableStepsInfo.length }}
      >
        <View
          className={`w-10 h-10 rounded-full items-center justify-center mb-1.5 border-2 ${
            isActive
              ? 'bg-blue-600 border-blue-600'
              : isCompleted
              ? 'bg-emerald-500 border-emerald-500'
              : step.isLocked
              ? isDark
                ? 'bg-red-900 border-red-700'
                : 'bg-[#fad9d3] border-[#ff5630]'
              : isDark
              ? 'bg-[#1C1C1E] border-[#2C2C2E]'
              : 'bg-white border-slate-200'
          }`}
        >
          {step.isLocked ? (
            <Icon name="lock" size={14} color="#ff5630" />
          ) : isCompleted ? (
            <Icon name="check" size={18} color="white" />
          ) : (
            <Text className={`text-xs font-black ${isActive ? 'text-white' : 'text-slate-400'}`}>
              {index + 1}
            </Text>
          )}
        </View>
        <Text
          className={`text-[8px] font-black uppercase tracking-tighter ${
            isActive ? 'text-blue-600' : isCompleted ? 'text-emerald-500' : 'text-slate-400'
          }`}
          numberOfLines={1}
        >
          {step.name}
        </Text>
      </Pressable>
    );
  };

  const memoizedSection = useMemo(() => {
    if (!activeStep) return null;

    switch (activeStep.category) {
      case 'gutter':
        return (
          <GutterSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
          />
        );
      case 'leaffilter':
        return (
          <LeafFilterSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
          />
        );
      case 'soffit':
        return (
          <SoffitSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
          />
        );
      case 'fascia':
        return (
          <FasciaSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
          />
        );
      case 'additional':
        return (
          <MiscSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
          />
        );
      case 'summary':
        return (
          <SummarySection
            jobState={jobState}
            availableSteps={availableStepsInfo}
            onUpdate={handleUpdate}
            leadId={leadId}
            customerName={outcomeForm?.customerName || 'Customer'}
            calculatorData={calculatorData}
            outcomeForm={outcomeForm}
          />
        );
      default:
        return null;
    }
  }, [
    activeStep?.category,
    jobState,
    calculatorData,
    leadId,
    outcomeForm,
    availableStepsInfo,
    handleUpdate,
  ]);

  const handleClose = () => {
    if (onGoBack) {
      onGoBack(jobState);
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View className="flex-1">
        <View className="flex-1 overflow-hidden" style={{ backgroundColor: colors.background }}>
          {/* Header */}
          <View
            className="px-6 pt-2 pb-6 border-b"
            style={{ backgroundColor: colors.card, borderColor: colors.border }}
          >
            <View className="flex-row items-center justify-between mb-6">
              <View>
                <Text className="text-lg font-black" style={{ color: colors.text }}>
                  Job Builder {isSaving && '• Saving...'}
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.surface }}
              >
                <Icon name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            {/* Iconic Progress Tracker */}
            <View className="flex-row justify-between items-center">
              {availableStepsInfo.map((step: any, index: number) => renderStepIcon(step, index))}
            </View>
          </View>

          {/* Content Area with Keyboard Avoidance */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1"
            keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
          >
            <View className="flex-1" style={{ backgroundColor: colors.background }}>
              {memoizedSection}
            </View>
          </KeyboardAvoidingView>

          <ValidationErrorModal
            visible={validationModal.visible}
            error={validationModal.error}
            onClose={() => setValidationModal({ visible: false, error: '' })}
          />

          {/* Footer */}
          <View
            className="px-6 border-t"
            style={{
              paddingBottom: insets.bottom + 20,
              paddingTop: 10,
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            {/* Inline Validation Warning */}
            {(() => {
              const validation = validateStep(activeStep?.category, jobState, calculatorData);
              if (!validation.valid) {
                return (
                  <View className="flex-row items-center justify-center bg-amber-50 py-2 mb-3 rounded-xl border border-amber-100">
                    <Icon name="alert-circle" size={14} color="#D97706" />
                    <Text className="text-[10px] font-black text-amber-700 ml-2 uppercase tracking-tight">
                      {validation.error}
                    </Text>
                  </View>
                );
              }
              return null;
            })()}

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => {
                  let prevIdx = currentStepIndex - 1;
                  while (prevIdx >= 0 && availableStepsInfo[prevIdx].isLocked) {
                    prevIdx--;
                  }
                  if (prevIdx >= 0) setCurrentStepIndex(prevIdx);
                }}
                disabled={(() => {
                  let prevIdx = currentStepIndex - 1;
                  while (prevIdx >= 0 && availableStepsInfo[prevIdx].isLocked) {
                    prevIdx--;
                  }
                  return prevIdx < 0;
                })()}
                className={`flex-1 h-14 rounded-lg items-center justify-center border`}
                style={{
                  backgroundColor: currentStepIndex === 0 ? colors.background : colors.surface,
                  borderColor: colors.border,
                }}
              >
                <Text
                  className={`font-black uppercase text-[10px] tracking-widest`}
                  style={{ color: currentStepIndex === 0 ? colors.textSecondary : colors.text }}
                >
                  Back
                </Text>
              </Pressable>

              {currentStepIndex === availableStepsInfo.length - 1 ? (
                <Pressable
                  onPress={() => {
                    const validation = validateStep(activeStep?.category, jobState, calculatorData);
                    if (!validation.valid) {
                      setValidationModal({ visible: true, error: validation.error || '' });
                      return;
                    }
                    handleClose();
                  }}
                  className={`flex-[2] h-14 rounded-lg items-center justify-center border-2`}
                  style={{
                    backgroundColor: validateStep(activeStep?.category, jobState, calculatorData)
                      .valid
                      ? isDark
                        ? '#FFFFFF'
                        : '#0F172A'
                      : colors.surface,
                    borderColor: validateStep(activeStep?.category, jobState, calculatorData).valid
                      ? isDark
                        ? '#FFFFFF'
                        : '#0F172A'
                      : colors.border,
                  }}
                >
                  <Text
                    className="font-black uppercase text-[10px] tracking-widest"
                    style={{
                      color: validateStep(activeStep?.category, jobState, calculatorData).valid
                        ? isDark
                          ? '#000000'
                          : '#FFFFFF'
                        : colors.textSecondary,
                    }}
                  >
                    Finish & Close
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    const validation = validateStep(activeStep?.category, jobState, calculatorData);
                    if (!validation.valid) {
                      setValidationModal({ visible: true, error: validation.error || '' });
                      return;
                    }

                    let nextIdx = currentStepIndex + 1;
                    while (
                      nextIdx < availableStepsInfo.length &&
                      availableStepsInfo[nextIdx].isLocked
                    ) {
                      nextIdx++;
                    }
                    if (nextIdx < availableStepsInfo.length) {
                      setCurrentStepIndex(nextIdx);
                    }
                  }}
                  className={`flex-[2] h-14 rounded-lg items-center justify-center border-2`}
                  style={{
                    backgroundColor: validateStep(activeStep?.category, jobState, calculatorData)
                      .valid
                      ? '#2563EB' // blue-600
                      : colors.surface,
                    borderColor: validateStep(activeStep?.category, jobState, calculatorData).valid
                      ? '#2563EB'
                      : colors.border,
                  }}
                >
                  <Text
                    className="font-black uppercase text-[10px] tracking-widest"
                    style={{
                      color: validateStep(activeStep?.category, jobState, calculatorData).valid
                        ? '#FFFFFF'
                        : colors.textSecondary,
                    }}
                  >
                    Next
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

/**
 * Reusable validation alert modal moved outside main component to prevent
 * expensive re-renders and potential navigation context loss.
 */
const ValidationErrorModal = ({
  visible,
  error,
  onClose,
}: {
  visible: boolean;
  error: string;
  onClose: () => void;
}) => {
  const { colors, isDark } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-black/40 justify-center items-center px-6">
        <View
          className="rounded-[32px] w-full p-8 shadow-2xl"
          style={{ backgroundColor: colors.card }}
        >
          <View className="w-16 h-16 bg-amber-50 rounded-full items-center justify-center mb-6 self-center border border-amber-100">
            <Icon name="alert-decagram" size={32} color="#D97706" />
          </View>

          <Text className="text-xl font-black text-center mb-2" style={{ color: colors.text }}>
            Incomplete Section
          </Text>

          <Text
            className="text-center mb-8 font-medium leading-5"
            style={{ color: colors.textSecondary }}
          >
            {error || 'Please complete all required fields before moving to the next section.'}
          </Text>

          <Pressable
            onPress={onClose}
            className="h-14 rounded-2xl items-center justify-center shadow-lg"
            style={{
              backgroundColor: isDark ? '#FFFFFF' : '#0F172A',
              shadowColor: isDark ? '#FFFFFF' : '#0F172A',
            }}
          >
            <Text
              className="font-black uppercase text-[12px] tracking-widest"
              style={{ color: isDark ? '#000000' : '#FFFFFF' }}
            >
              Got it, thanks
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};
