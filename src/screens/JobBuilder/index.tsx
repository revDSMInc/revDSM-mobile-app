import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
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
import { FlashMessage } from '../../config/message';

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
  const queryClient = useQueryClient();
  const { initialJobState, calculatorData, leadId, outcomeForm, onGoBack, onComplete } = route.params || {};

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
    FlashMessage.warning('Incomplete Section', error);
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
            outcomeForm={outcomeForm}
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

      const isDemo = outcomeForm?.result?.toLowerCase() === 'demo';
      if (isDemo) {
        if (!hasOrderSheet) {
          onValidationError('Please attach an Order Sheet.');
          return;
        }
      } else {
        if (!hasAgreement) {
          onValidationError('Please attach a signed Agreement.');
          return;
        }
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
          result: outcomeForm?.result || 'Sale',
          status: outcomeForm?.status || outcomeForm?.result || 'Sale',
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
          installDate: jobState.scheduleTime?.date,
          timeWindow: jobState.scheduleTime?.timeWindow,
          // Sync financial outcome fields if they exist in outcomeForm
          originalContractPrice: outcomeForm?.originalContractPrice,
          downPayment: outcomeForm?.downPayment,
          balance: outcomeForm?.balance,
          balancePaymentMethod: outcomeForm?.balancePaymentMethod,
          downPaymentMethod: outcomeForm?.downPaymentMethod,
        },
        jobState: finalJobState,
      };

      if (leadId) {
        await Promise.all([
          LeadService.submitJobBuilder(leadId, payload),
          LeadService.updateLeadTimelineProgress(leadId, { jobBuild: 'complete' }),
        ]);

        // Invalidate queries to update Leads page and Lead Center data
        queryClient.invalidateQueries({ queryKey: ['leads'] });
        queryClient.invalidateQueries({ queryKey: ['lead', leadId] });

        FlashMessage.success('Job Complete', 'Job builder submitted successfully');
        // Signal DealCenter to close OutcomeModal and switch to Rollout (Summary) view
        if (onComplete) onComplete(finalJobState);
        navigation.goBack();
      }
    } catch (error) {
      console.error('[JobBuilder] Completion failed:', error);
      Alert.alert('Error', 'Failed to complete the job. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = async () => {
    // Lightweight draft save — no loader, no timeline update
    // Just persist the current job state and return to the OutcomeModal
    try {
      if (leadId) {
        const gutterExtras: any[] = [];
        const extraKeys = [
          'wedges', 'straps', 'modifyHeight', 'groundSpout',
          'replaceCorner', 'extendedSplashGuard', 'extendedSplashGuard032',
        ];
        extraKeys.forEach((key) => {
          if (calculatorData?.[key] && parseFloat(calculatorData[key]) > 0) {
            const extraItem: any = { [key]: parseFloat(calculatorData[key]) };
            if (jobState.gutter?.extrasColors?.[key]) extraItem.color = jobState.gutter.extrasColors[key];
            gutterExtras.push(extraItem);
          }
        });

        const draftPayload = {
          ...outcomeForm,
          jobBuilder: {
            ...jobState,
            gutter: { ...jobState.gutter, extras: gutterExtras },
          },
          LFCalculator: {
            ...calculatorData,
            createdBy: user?._id || user?.id || calculatorData?.createdBy,
            appointmentId: calculatorData?.appointmentId || leadId,
          },
          calculatorId: calculatorData?._id,
          appointmentId: calculatorData?.appointmentId || leadId,
        };

        // Fire-and-forget draft save — don't await, don't block navigation
        LeadService.updateLeadOutcome(leadId, draftPayload).catch((e) =>
          console.warn('[JobBuilder] Draft save failed silently:', e)
        );
      }
    } catch (_) { /* silent */ }

    if (onGoBack) onGoBack(jobState);
    navigation.goBack();
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
                  const isDemo = outcomeForm?.result?.toLowerCase() === 'demo';
                  const hasAgreement =
                    (jobState.agreements || []).some((doc: any) => (doc.files || []).length > 0) ||
                    (resolvedDocuments.agreements.length > 0);
                  const hasOrderSheet =
                    (jobState.orderSheets || []).some((doc: any) => (doc.files || []).length > 0) ||
                    (resolvedDocuments.orderSheets.length > 0);
                  const canComplete = isDemo ? hasOrderSheet : hasAgreement;

                  return (
                    <Pressable
                      onPress={handleCompleteJob}
                      disabled={!canComplete || isSaving}
                      style={{
                        paddingHorizontal: 24,
                        paddingVertical: 10,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'row',
                        backgroundColor: canComplete ? '#22C55E' : '#CBD5E1',
                        opacity: isSaving ? 0.7 : 1,
                      }}
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                      ) : (
                        <Icon name="check-all" size={18} color="white" style={{ marginRight: 8 }} />
                      )}
                      <Text style={{ fontWeight: '900', fontSize: 12, color: 'white', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {isSaving ? 'Completing...' : 'Complete Job'}
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
