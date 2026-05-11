import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
import RNFS from 'react-native-fs';
import { getAvailableSteps } from '../../utils/job-builder-util';
import { GutterSection } from '../../widgets/components/job-builder/GutterSection';
import { LeafFilterSection } from '../../widgets/components/job-builder/LeafFilterSection';
import { SoffitSection } from '../../widgets/components/job-builder/SoffitSection';
import { FasciaSection } from '../../widgets/components/job-builder/FasciaSection';
import { MiscSection } from '../../widgets/components/job-builder/MiscSection';
import { SummarySection } from '../../widgets/components/job-builder/SummarySection';
import { LeadService } from '../../services/api/leads';
import { validateStep } from '../../utils/job-builder-validation';
import { useAuth } from '../../hooks/useAuth';
import { useLeadQuery } from '../../hooks/useLeadQuery';
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
  const { data: leadData } = useLeadQuery(leadId || '');
  const availableStepsInfo = useMemo(() => getAvailableSteps(calculatorData), [calculatorData]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [resolvedDocuments, setResolvedDocuments] = useState<{
    agreements: any[];
    orderSheets: any[];
  }>({ agreements: [], orderSheets: [] });

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
  const firstUnlockedIndex = useMemo(
    () => availableStepsInfo.findIndex((s: any) => !s.isLocked),
    [availableStepsInfo]
  );
  const activeStep = availableStepsInfo[currentStepIndex];

  // Auto-save logic
  const { user } = useAuth();

  const sentImageIds = useRef(new Set());
  // Blocks the 2s debounce auto-save while a document upload is in progress
  // to avoid MongoDB write conflicts on the outcome record.
  const isDocUploadingRef = useRef(false);

  useEffect(() => {
    if (!leadId) return;

    const timer = setTimeout(async () => {
      // Skip auto-save while a document upload (agreement/orderSheet) is in progress
      // to prevent MongoDB write conflicts on the outcome record.
      if (isDocUploadingRef.current) {
        console.log('[JobBuilder] Auto-save skipped — document upload in progress.');
        return;
      }

      try {
        setIsSaving(true);

        // Strip documents from the auto-save payload — they are managed strictly
        // by SummarySection via the outcome PUT. Sending large base64 payloads
        // here would hit API size limits and cause write conflicts.
        const { agreements: _a, orderSheets: _o, ...jobStateWithoutDocs } = jobState as any;

        const payload = {
          ...outcomeForm,
          result: 'Sale',
          status: 'Sale',
          jobBuilder: jobStateWithoutDocs,
          LFCalculator: {
            ...calculatorData,
            createdBy: user?._id || user?.id || calculatorData?.createdBy,
            appointmentId: calculatorData?.appointmentId || leadId,
            title: calculatorData?.title || 'Job Builder Estimate',
          },
          calculatorId: calculatorData?._id,
          selectedCalculatorId: calculatorData?._id,
          selectedAppointmentId: calculatorData?.appointmentId || leadId,
          appointmentId: calculatorData?.appointmentId || leadId,
        };
        await LeadService.updateLeadOutcome(leadId, payload);
      } catch (error) {
        console.warn('[JobBuilder] Auto-save failed:', error);
      } finally {
        setIsSaving(false);
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timer);
  }, [jobState, leadId, outcomeForm, calculatorData, user, resolvedDocuments]);

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

  const onForceSave = useCallback(async (newState?: any) => {
    try {
      setIsSaving(true);
      const stateToSave = newState || jobState;
      
      const payload = {
        ...outcomeForm,
        result: 'Sale',
        status: 'Sale',
        jobBuilder: stateToSave,
        LFCalculator: {
          ...calculatorData,
          createdBy: user?._id || user?.id || calculatorData?.createdBy,
          appointmentId: calculatorData?.appointmentId || leadId,
          title: calculatorData?.title || 'Job Builder Estimate',
        },
        calculatorId: calculatorData?._id,
        selectedCalculatorId: calculatorData?._id,
        selectedAppointmentId: calculatorData?.appointmentId || leadId,
        appointmentId: calculatorData?.appointmentId || leadId,
      };

      await LeadService.updateLeadOutcome(leadId, payload);
      
      // Clear local new files after successful manual force save
      setJobState((prev: any) => {
        const cleanedState = { ...prev };
        if (cleanedState.agreements) {
          cleanedState.agreements = cleanedState.agreements.map((doc: any) => ({
            ...doc,
            files: (doc.files || []).filter((f: any) => !f.isNew),
          })).filter((doc: any) => (doc.files || []).length > 0 || doc.serverId);
        }
        if (cleanedState.orderSheets) {
          cleanedState.orderSheets = cleanedState.orderSheets.map((doc: any) => ({
            ...doc,
            files: (doc.files || []).filter((f: any) => !f.isNew),
          })).filter((doc: any) => (doc.files || []).length > 0 || doc.serverId);
        }
        return cleanedState;
      });
    } catch (error) {
      console.warn('[JobBuilder] Force save failed:', error);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [jobState, leadId, outcomeForm, calculatorData, user]);

  const onValidationError = useCallback((error: string) => {
    setValidationModal({ visible: true, error });
  }, []);

  const renderStepIcon = (step: any, index: number) => {
    const isActive = currentStepIndex === index;
    const isCompleted = index < currentStepIndex && !step.isLocked;

    const handleTabPress = () => {
      if (isActive || step.isLocked) return;

      const validation = validateStep(activeStep?.category, jobState, calculatorData);

      if (index > currentStepIndex) {
        return;
      }

      setCurrentStepIndex(index);
    };

    return (
      <Pressable
        key={step.category}
        onPress={handleTabPress}
        style={{ width: (width - 40) / availableStepsInfo.length, alignItems: 'center' }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 6,
            borderWidth: 2,
            backgroundColor: isActive
              ? '#0EA5E9'
              : isCompleted
              ? '#10b981'
              : step.isLocked
              ? '#FAD9D3'
              : isDark
              ? '#1C1C1E'
              : 'white',
            borderColor: isActive
              ? '#0EA5E9'
              : isCompleted
              ? '#10b981'
              : step.isLocked
              ? '#FE6644'
              : isDark
              ? '#2C2C2E'
              : '#e2e8f0'
          }}
        >
          {step.isLocked ? (
            <Icon name="lock" size={16} color="#FE6644" />
          ) : isCompleted ? (
            <Icon name="check" size={18} color="white" />
          ) : (
            <Text style={{ fontSize: 12, fontWeight: '900', color: isActive ? 'white' : '#94a3b8' }}>
              {index + 1}
            </Text>
          )}
        </View>
        <Text
          style={{
            fontSize: 8,
            fontWeight: '900',
            letterSpacing: -0.3,
            color: isActive ? '#0EA5E9' : isCompleted ? '#10b981' : '#94a3b8'
          }}
          numberOfLines={1}
        >
          {step.name}
        </Text>
      </Pressable>
    );
  };

  const renderActiveSection = () => {
    if (!activeStep) return null;

    switch (activeStep.category) {
      case 'gutter':
        return (
          <GutterSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
            jobSummaryItems={calculatorData?.jobSummaryItems || []}
            onValidationError={onValidationError}
          />
        );
      case 'leaffilter':
        return (
          <LeafFilterSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
            onValidationError={onValidationError}
          />
        );
      case 'soffit':
        return (
          <SoffitSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
            onValidationError={onValidationError}
          />
        );
      case 'fascia':
        return (
          <FasciaSection
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
            onValidationError={onValidationError}
          />
        );
      case 'additional':
        return (
          <MiscSection
            key="misc-section"
            jobState={jobState}
            onUpdate={handleUpdate}
            calculatorData={calculatorData}
            onValidationError={onValidationError}
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
            resolvedDocuments={resolvedDocuments}
            setResolvedDocuments={setResolvedDocuments}
            isDocUploadingRef={isDocUploadingRef}
          />
        );
      default:
        return null;
    }
  };

  const handleCompleteJob = async () => {
    try {
      const hasAgreement =
        (jobState.agreements || []).some((doc: any) => (doc.files || []).length > 0) ||
        resolvedDocuments.agreements.length > 0;
      const hasOrderSheet =
        (jobState.orderSheets || []).some((doc: any) => (doc.files || []).length > 0) ||
        resolvedDocuments.orderSheets.length > 0;

      if (!hasAgreement || !hasOrderSheet) {
        let msg = 'Please ensure both an Agreement and an Order Sheet are attached.';
        if (!hasAgreement && hasOrderSheet) msg = 'Please attach a signed Agreement.';
        if (hasAgreement && !hasOrderSheet) msg = 'Please attach an Order Sheet.';
        onValidationError(msg);
        return;
      }

      setIsSaving(true);

      const gutterExtras: any[] = [];
      const extraKeys = [
        'wedges',
        'straps',
        'modifyHeight',
        'groundSpout',
        'replaceCorner',
        'extendedSplashGuard',
        'extendedSplashGuard032',
      ];

      extraKeys.forEach((key) => {
        if (calculatorData?.[key] && parseFloat(calculatorData[key]) > 0) {
          const extraItem: any = { [key]: parseFloat(calculatorData[key]) };
          if (jobState.gutter?.extrasColors?.[key]) {
            extraItem.color = jobState.gutter.extrasColors[key];
          }
          gutterExtras.push(extraItem);
        }
      });

      const getBase64Docs = async (docs: any[]) => {
        if (!docs || docs.length === 0) return [];
        const allFiles = docs.flatMap((doc: any) => doc.files || []);
        const newFiles = allFiles.filter((f: any) => f.isNew && f.uri);

        const results = [];
        for (const f of newFiles) {
          try {
            const base64 = await RNFS.readFile(f.uri, 'base64');
            const mimeType = f.uri.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
            results.push({
              file: `data:${mimeType};base64,${base64}`,
              name: f.name || 'document.jpg',
            });
          } catch (e) {
            console.warn('[JobBuilder] File read failed:', f.uri, e);
          }
        }
        return results;
      };

      const [agreementsPayload, orderSheetsPayload] = await Promise.all([
        getBase64Docs(jobState.agreements),
        getBase64Docs(jobState.orderSheets),
      ]);

      const finalJobState = {
        ...jobState,
        gutter: {
          ...jobState.gutter,
          extras: gutterExtras,
        },
        agreements: agreementsPayload,
        orderSheets: orderSheetsPayload,
        status: 'submitted', // Explicitly set status to submitted for web parity
      };

      const payload = {
        leadData: {
          ...outcomeForm,
          result: outcomeForm?.result === 'sale' ? 'Sale' : 'Demo',
          status: outcomeForm?.result === 'sale' ? 'Sale' : 'Demo',
          jobBuilder: finalJobState,
          LFCalculator: {
            ...calculatorData,
            createdBy: user?._id || user?.id || calculatorData?.createdBy,
            appointmentId: calculatorData?.appointmentId || leadId,
            title: calculatorData?.title || 'Job Builder Estimate',
          },
          calculatorId: calculatorData?._id,
          selectedCalculatorId: calculatorData?._id,
          selectedAppointmentId: calculatorData?.appointmentId || leadId,
          appointmentId: calculatorData?.appointmentId || leadId,
        },
        jobState: finalJobState,
      };

      if (leadId) {
        await Promise.all([
          LeadService.submitJobBuilder(leadId, payload),
          LeadService.updateLeadTimelineProgress(leadId, { jobBuild: 'complete' }),
        ]);
      }

      // Navigate back to DealCenter and trigger a refresh to show updated state
      navigation.navigate('DealCenter', {
        lead: { 
          ...(leadData || route.params?.lead), 
          jobBuilder: { status: 'submitted', calculatorId: calculatorData?._id } 
        },
        onRefresh: route.params?.onRefresh,
      });
    } catch (error) {
      console.error('[JobBuilder] Completion failed:', error);
      Alert.alert('Error', 'Failed to complete the job. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = async () => {
    try {
      setIsSaving(true);
      const gutterExtras: any[] = [];
      const extraKeys = [
        'wedges',
        'straps',
        'modifyHeight',
        'groundSpout',
        'replaceCorner',
        'extendedSplashGuard',
        'extendedSplashGuard032',
      ];

      extraKeys.forEach((key) => {
        if (calculatorData?.[key] && parseFloat(calculatorData[key]) > 0) {
          const extraItem: any = {
            [key]: parseFloat(calculatorData[key]),
          };
          if (jobState.gutter?.extrasColors?.[key]) {
            extraItem.color = jobState.gutter.extrasColors[key];
          }
          gutterExtras.push(extraItem);
        }
      });

      const finalJobState = {
        ...jobState,
        gutter: {
          ...jobState.gutter,
          extras: gutterExtras,
        },
      };

      if (leadId) {
        // Documents are handled via S3 in SummarySection

        const payload = {
          ...outcomeForm,
          result: 'Sale',
          status: 'Sale',
          jobBuilder: finalJobState,
          LFCalculator: {
            ...calculatorData,
            title: calculatorData?.title || 'Job Builder Estimate',
            createdBy: user?._id || user?.id || calculatorData?.createdBy,
            appointmentId: calculatorData?.appointmentId || leadId,
          },
          calculatorId: calculatorData?._id,
          appointmentId: calculatorData?.appointmentId || leadId,
        };

        await Promise.all([
          LeadService.updateLeadOutcome(leadId, payload),
          LeadService.updateLeadTimelineProgress(leadId, { jobBuild: 'complete' }),
        ]);
      }

      if (onGoBack) {
        onGoBack(jobState);
      }
      navigation.goBack();
    } catch (error) {
      console.error('[JobBuilder] Finish failed:', error);
      Alert.alert('Error', 'Failed to complete the job. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, overflow: 'hidden', backgroundColor: colors.background }}>
          <View
            style={{ 
              paddingHorizontal: 24, 
              paddingTop: 8, 
              paddingBottom: 24, 
              borderBottomWidth: 1, 
              backgroundColor: colors.card, 
              borderColor: colors.border 
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <View>
                <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>
                  {(() => {
                    const shortenOfficeName = (name: any) => {
                      if (!name || typeof name !== 'string') return '';
                      const words = name.trim().split(' ');
                      if (words.length === 1) {
                        return name.length <= 3
                          ? name.toUpperCase()
                          : name.slice(0, 3).toUpperCase();
                      }
                      return words
                        .map((w) => w[0])
                        .join('')
                        .toUpperCase();
                    };

                    const officeDetails = leadData?.assignedRepDetails?.office?.[0];
                    let officeName =
                      typeof officeDetails === 'string' ? officeDetails : officeDetails?.name;

                    if (!officeName && user?.office) {
                      officeName =
                        typeof user.office === 'object'
                          ? user.office.name || user.office.officeName
                          : user.office;
                    }

                    const shortName = shortenOfficeName(officeName) || 'N/A';

                    let rawId = leadData?.leadId || leadId || 'N/A';
                    let displayId = '';

                    if (rawId && typeof rawId === 'string' && rawId.length > 8) {
                      displayId = rawId.slice(-5).toUpperCase();
                    } else {
                      displayId = rawId;
                    }

                    return `${shortName}${displayId}`;
                  })()}{' '}
                  {isSaving && '• Saving...'}
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}
              >
                <Icon name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              {availableStepsInfo.map((step: any, index: number) => renderStepIcon(step, index))}
            </View>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
          >
            <View style={{ flex: 1, backgroundColor: colors.background }}>
              {renderActiveSection()}
            </View>
          </KeyboardAvoidingView>

          <ValidationErrorModal
            visible={validationModal.visible}
            error={validationModal.error}
            onClose={() => setValidationModal({ visible: false, error: '' })}
          />

          <View
            style={{
              paddingHorizontal: 24,
              borderTopWidth: 1,
              paddingBottom: 10,
              paddingTop: 5,
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', gap: 16, justifyContent: 'space-between' }}>
              {currentStepIndex > firstUnlockedIndex ? (
                <Pressable
                  onPress={() => {
                    let prevIdx = currentStepIndex - 1;
                    while (prevIdx >= 0 && availableStepsInfo[prevIdx].isLocked) {
                      prevIdx--;
                    }
                    if (prevIdx >= 0) setCurrentStepIndex(prevIdx);
                  }}
                  style={{
                    padding: 6,
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    width: 80
                  }}
                >
                  <Text style={{ fontWeight: '600', fontSize: 12, color: colors.text }}>
                    Back
                  </Text>
                </Pressable>
              ) : (
                <View style={{ width: 80 }} />
              )}

              {currentStepIndex === availableStepsInfo.length - 1 ? (
                (() => {
                  const hasAgreement =
                    (jobState.agreements || []).some((doc: any) => (doc.files || []).length > 0) ||
                    (resolvedDocuments.agreements.length > 0);
                  const hasOrderSheet =
                    (jobState.orderSheets || []).some((doc: any) => (doc.files || []).length > 0) ||
                    (resolvedDocuments.orderSheets.length > 0);
                  const canComplete = hasAgreement && hasOrderSheet;

                  return (
                    <Pressable
                      onPress={handleCompleteJob}
                      style={{
                        paddingHorizontal: 24,
                        paddingVertical: 10,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'row',
                        backgroundColor: canComplete ? '#22C55E' : '#CBD5E1',
                      }}
                    >
                      <Icon name="check-all" size={18} color="white" style={{ marginRight: 8 }} />
                      <Text style={{ fontWeight: '900', fontSize: 12, color: 'white', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Complete Job
                      </Text>
                    </Pressable>
                  );
                })()
              ) : (
                (() => {
                  const validation = validateStep(activeStep?.category, jobState, calculatorData);
                  const isStepValid = validation.valid;

                  return (
                    <Pressable
                      onPress={() => {
                        if (!isStepValid) return;

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
                      style={{
                        padding: 6,
                        flexDirection: 'row',
                        borderRadius: 8,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isStepValid ? '#000000' : '#CBD5E1',
                        opacity: isStepValid ? 1 : 0.8,
                        width: 80
                      }}
                    >
                      <Text style={{ fontWeight: '600', fontSize: 12, color: 'white' }}>Next</Text>
                      <Icon name="arrow-right" size={18} color="white" style={{ marginLeft: 8 }} />
                    </Pressable>
                  );
                })()
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
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
        <View
          style={{ 
            backgroundColor: colors.card,
            borderRadius: 32,
            width: '100%',
            padding: 32,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.25,
            shadowRadius: 15,
            elevation: 10
          }}
        >
          <View style={{ width: 64, height: 64, backgroundColor: '#FFFBEB', borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 24, alignSelf: 'center', borderWidth: 1, borderColor: '#FEF3C7' }}>
            <Icon name="alert-decagram" size={32} color="#D97706" />
          </View>

          <Text style={{ fontSize: 20, fontWeight: '900', textAlign: 'center', marginBottom: 8, color: colors.text }}>
            Incomplete Section
          </Text>

          <Text
            style={{ textAlign: 'center', marginBottom: 32, fontWeight: '500', lineHeight: 20, color: colors.textSecondary }}
          >
            {error || 'Please complete all required fields before moving to the next section.'}
          </Text>

          <Pressable
            onPress={onClose}
            style={{
              height: 56,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isDark ? '#FFFFFF' : '#0F172A',
              shadowColor: isDark ? '#FFFFFF' : '#0F172A',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.2,
              shadowRadius: 8,
              elevation: 4
            }}
          >
            <Text
              style={{ fontWeight: '900', fontSize: 12, color: isDark ? '#000000' : '#FFFFFF', textTransform: 'uppercase' }}
            >
              Got it, thanks
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};
