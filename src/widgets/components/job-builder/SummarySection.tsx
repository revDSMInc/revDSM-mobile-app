import React, { useState, useMemo } from 'react';
import FileViewer from 'react-native-file-viewer';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppointmentSchedulerModal } from '../../modals/job-builder/AppointmentSchedulerModal';
import { DocumentScannerModal } from '../../modals/job-builder/DocumentScannerModal';
import { AgreementDialogModal } from '../../modals/job-builder/AgreementDialogModal';
import { AgreementSignatureModal } from '../../modals/job-builder/AgreementSignatureModal';
import { LeadService } from '../../../services/api/leads';
import { useAuth } from '../../../hooks/useAuth';
import { useLeadQuery } from '../../../hooks/useLeadQuery';

interface SummarySectionProps {
  jobState: any;
  availableSteps: any[];
  onUpdate?: (section: string, field: string, value: any) => void;
  leadId?: string;
  customerName?: string;
  calculatorData?: any;
  outcomeForm?: any;
}

export const SummarySection = ({
  jobState,
  availableSteps,
  onUpdate,
  leadId,
  customerName,
  calculatorData,
  outcomeForm,
}: SummarySectionProps) => {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const { data: leadData } = useLeadQuery(leadId || '');
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [agreementDialogOpen, setAgreementDialogOpen] = useState(false);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [agreementData, setAgreementData] = useState<any>(null);
  const [scannerType, setScannerType] = useState<'agreement' | 'orderSheet'>('agreement');
  const [isGenerating, setIsGenerating] = useState(false);
  const [outcomeData, setOutcomeData] = useState<any>(null);
  const [resolvedDocuments, setResolvedDocuments] = useState<{
    agreements: any[];
    orderSheets: any[];
  }>({ agreements: [], orderSheets: [] });

  // Fetch lead outcome specifically for documents
  React.useEffect(() => {
    const fetchOutcome = async () => {
      if (!leadId) return;
      try {
        const response = await LeadService.getLeadOutcome(leadId);
        const data = response.data?.data || response.data;
        setOutcomeData(data);
      } catch (error) {
        console.error('[Summary] Failed to fetch outcome:', error);
      }
    };
    fetchOutcome();
  }, [leadId]);

  // Resolve secure URLs for leadOutcomeDocuments
  React.useEffect(() => {
    const resolveDocs = async () => {
      const docs = outcomeData?.leadOutcomeDocuments || leadData?.leadOutcomeDocuments;
      if (docs) {
        const { agreements = [], orderSheets = [] } = docs;
        const allPaths = [...agreements, ...orderSheets].map((doc) => ({
          filePath: doc.filePath,
          bucketName: doc.bucketName,
        }));

        if (allPaths.length > 0) {
          try {
            const response = await LeadService.getSecureUrls(allPaths);
            const urls = response.data?.data || response.data;

            // Map URLs back to original documents
            const mapDocs = (docs: any[]) =>
              docs.map((doc, idx) => {
                const urlObj = urls.find((u: any) => u.filePath === doc.filePath);
                return {
                  uri: urlObj?.url || doc.filePath, // Fallback to path if URL not found
                  name: doc.name,
                  serverId: doc._id,
                  isNew: false,
                };
              });

            setResolvedDocuments({
              agreements: mapDocs(agreements),
              orderSheets: mapDocs(orderSheets),
            });
          } catch (error) {
            console.error('[Summary] Failed to resolve secure URLs:', error);
          }
        }
      }
    };
    resolveDocs();
  }, [leadData?.leadOutcomeDocuments]);

  const hasValue = (val: any): boolean => {
    if (val === null || val === undefined || val === '' || val === 0 || val === '0') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.values(val).some((v) => hasValue(v));
    return true;
  };

  const summarySections = useMemo(() => {
    const sections: any[] = [];

    // 1. Gutter Section
    if (jobState.gutter && hasValue(jobState.gutter)) {
      const gutter = jobState.gutter;
      const subsections: any[] = [];

      // Gutters Combination
      const gutterFields: any[] = [];
      if (gutter.gutterColorsMulti && gutter.gutterColorsMulti.length > 0) {
        gutter.gutterColorsMulti.forEach((combo: any, index: number) => {
          const comboTotal =
            combo.measurements?.reduce(
              (sum: number, val: any) => sum + (parseFloat(val) || 0),
              0
            ) || 0;
          if (comboTotal > 0) {
            const parts = [`${comboTotal}'`, combo.color, combo.size, 'Gutter'].filter(Boolean);
            const accParts: any[] = [];
            if (parseFloat(combo.mitersOutside) > 0)
              accParts.push(`${combo.mitersOutside} Out Miter`);
            if (parseFloat(combo.mitersInside) > 0) accParts.push(`${combo.mitersInside} In Miter`);
            if (parseFloat(combo.endCapsRights) > 0) accParts.push(`${combo.endCapsRights} EC (R)`);
            if (parseFloat(combo.endCapsLefts) > 0) accParts.push(`${combo.endCapsLefts} EC (L)`);

            gutterFields.push({
              label: `Combination #${index + 1}`,
              value:
                accParts.length > 0
                  ? `${parts.join(' · ')} (${accParts.join(', ')})`
                  : parts.join(' · '),
            });
          }
        });
      }
      if (gutterFields.length > 0) subsections.push({ name: '', fields: gutterFields });

      // Downspouts
      const downspoutFields: any[] = [];
      if (gutter.downspoutsMulti && gutter.downspoutsMulti.length > 0) {
        gutter.downspoutsMulti.forEach((ds: any, index: number) => {
          const parts = [];
          if (parseFloat(ds.aElbows) > 0) parts.push(`${ds.aElbows} A Elbows`);
          if (parseFloat(ds.bElbows) > 0) parts.push(`${ds.bElbows} B Elbows`);
          if (parseFloat(ds.roundElbow) > 0) parts.push(`${ds.roundElbow} Rd Elbows`);
          if (parseFloat(ds.offsetElbows) > 0) parts.push(`${ds.offsetElbows} Of Elbows`);
          if (parseFloat(ds.spoutSavers) > 0) parts.push(`${ds.spoutSavers} Spout Savers`);
          if (parseFloat(ds.footage) > 0) parts.push(`${ds.footage}'`);
          if (ds.color) parts.push(ds.color);
          if (ds.type) parts.push(`${ds.type} Downspout`);
          if (parts.length > 0) {
            downspoutFields.push({ label: `DS #${index + 1}`, value: parts.join(' · ') });
          }
        });
      }
      if (downspoutFields.length > 0)
        subsections.push({ name: 'Downspouts & Accessories', fields: downspoutFields });

      // Extras
      const extrasList: any[] = [];
      if (calculatorData?.wedges && parseFloat(calculatorData.wedges) > 0)
        extrasList.push({ label: '', value: `${calculatorData.wedges} Wedges` });
      if (calculatorData?.straps && parseFloat(calculatorData.straps) > 0)
        extrasList.push({ label: '', value: `${calculatorData.straps} Straps` });
      if (gutter.extrasColors?.replaceCorner)
        extrasList.push({ label: 'Replace Corner', value: gutter.extrasColors.replaceCorner });
      if (gutter.extrasColors?.groundSpout)
        extrasList.push({ label: 'Ground Spout', value: gutter.extrasColors.groundSpout });

      if (extrasList.length > 0) subsections.push({ name: 'Extras', fields: extrasList });

      if (subsections.length > 0) {
        sections.push({ title: 'Gutter', color: '#00B8D9', subsections });
      }
    }

    // 2. LeafFilter Section
    if (jobState.leaffilter && hasValue(jobState.leaffilter)) {
      const lf = jobState.leaffilter;
      const subsections: any[] = [];

      const combinationFields: any[] = [];
      if (lf.combinations && lf.combinations.length > 0) {
        const locationNames = ['LEFT SIDE', 'RIGHT SIDE', 'FRONT', 'REAR', 'GARAGE', 'OTHER'];
        lf.combinations.forEach((combo: any, index: number) => {
          const comboTotal =
            combo.measurements?.reduce(
              (sum: number, val: any) => sum + (parseFloat(val) || 0),
              0
            ) || 0;
          if (comboTotal > 0) {
            const parts = [`${comboTotal} ft`, combo.lfColor, combo.lfProfile].filter(Boolean);
            if (combo.gutterOpeningWidth) parts.push(`${combo.gutterOpeningWidth}"`);

            const locationRows: any[] = [];
            locationNames.forEach((loc, locIdx) => {
              const entries: any[] = [];
              [1, 2, 3].forEach((story) => {
                const mIdx = locIdx + (story - 1) * 6;
                const val = parseFloat(combo.measurements?.[mIdx] || 0);
                if (val > 0)
                  entries.push({
                    story: `${story}${story === 1 ? 'st' : story === 2 ? 'nd' : 'rd'} Story`,
                    value: val,
                  });
              });
              if (entries.length > 0) locationRows.push({ location: loc, entries });
            });

            combinationFields.push({
              label: `Combination #${index + 1}`,
              value: parts.join(' · '),
              locationRows,
            });
          }
        });
      }
      if (combinationFields.length > 0) subsections.push({ name: '', fields: combinationFields });

      const lfExtras: any[] = [];
      if (lf.extras?.csr) lfExtras.push({ label: '', value: `${lf.extras.csr} C-S-R` });
      if (lf.extras?.cornersFilter)
        lfExtras.push({ label: '', value: `${lf.extras.cornersFilter} Corners Filter` });
      if (lf.extras?.sawzallHanger)
        lfExtras.push({ label: '', value: `${lf.extras.sawzallHanger} Sawzall Hanger` });
      if (lf.extras?.removeProtection)
        lfExtras.push({ label: '', value: `${lf.extras.removeProtection} Remove Protection` });
      if (lf.extras?.ribbedRoof)
        lfExtras.push({ label: '', value: `${lf.extras.ribbedRoof} Ribbed Roof` });

      if (lfExtras.length > 0) subsections.push({ name: 'Extras', fields: lfExtras });

      if (subsections.length > 0) {
        sections.push({ title: 'LeafFilter', color: '#00A76F', subsections });
      }
    }

    // 3. Soffit Section
    if (jobState.soffit && hasValue(jobState.soffit)) {
      const soffit = jobState.soffit;
      const subsections: any[] = [];

      if (soffit.vinyl?.footage > 0) {
        subsections.push({
          name: 'Vinyl Soffit',
          fields: [
            {
              label: '',
              value: `${soffit.vinyl.footage}' ${soffit.vinyl.color} ${soffit.vinyl.soffitType} Vinyl Soffit`,
            },
          ],
        });
      }
      if (soffit.porch?.footage > 0) {
        subsections.push({
          name: 'Porch Ceiling',
          fields: [
            {
              label: 'Location',
              value: Array.isArray(soffit.porch.location)
                ? soffit.porch.location.join(', ')
                : soffit.porch.location,
            },
            {
              label: '',
              value: `${soffit.porch.footage}' ${soffit.porch.color} ${soffit.porch.soffitType} Porch Ceiling`,
            },
          ],
        });
      }
      if (soffit.nailer?.footage > 0) {
        subsections.push({
          name: 'Nailer Build Out',
          fields: [
            {
              label: '',
              value: `${soffit.nailer.footage}' ${soffit.nailer.color} ${soffit.nailer.soffitType} Nailer Build Out`,
            },
          ],
        });
      }

      if (subsections.length > 0) {
        sections.push({ title: 'Soffit', color: '#82D616', subsections });
      }
    }

    // 4. Fascia Section
    if (jobState.fascia && hasValue(jobState.fascia)) {
      const fascia = jobState.fascia;
      const subsections: any[] = [];

      if (fascia.wrap?.footage > 0) {
        subsections.push({
          name: 'Fascia Trim',
          fields: [
            {
              label: '',
              value: `${fascia.wrap.footage}' ${fascia.wrap.color} ${fascia.wrap.size} Fascia Trim`,
            },
          ],
        });
      }
      if (fascia.boards?.footage > 0) {
        subsections.push({
          name: 'Fascia Boards',
          fields: [
            {
              label: '',
              value: `${fascia.boards.footage}' ${fascia.boards.boardType} ${fascia.boards.size} Fascia Board`,
            },
          ],
        });
      }
      if (fascia.aluminumBoards?.footage > 0) {
        subsections.push({
          name: 'Aluminum Fascia Boards',
          fields: [
            { label: '', value: `${fascia.aluminumBoards.footage}' Aluminum 2"x2" Fascia Board` },
          ],
        });
      }

      if (subsections.length > 0) {
        sections.push({ title: 'Fascia', color: '#8E33FF', subsections });
      }
    }

    // 5. Misc Section
    if (jobState.additional && hasValue(jobState.additional)) {
      const misc = jobState.additional;
      const fields: any[] = [];
      if (misc.extraLabor > 0)
        fields.push({ label: 'Extra Labor', value: `${misc.extraLabor} Hours` });
      if (misc.extraLaborReason) fields.push({ label: 'Reason', value: misc.extraLaborReason });
      if (misc.numberOfScreenPulls > 0)
        fields.push({ label: 'Screen Pulls', value: misc.numberOfScreenPulls });
      if (misc.cutAndRemoveShingleOverhang)
        fields.push({ label: 'Shingle Overhang', value: misc.cutAndRemoveShingleOverhang });
      if (misc.dripEdgeFlashingFootage > 0)
        fields.push({ label: 'Drip Edge', value: `${misc.dripEdgeFlashingFootage} ft` });
      if (misc.fortyFootLadderNeeded)
        fields.push({ label: '40ft Ladder', value: misc.fortyFootLadderNeeded });
      if (misc.requireHarnessWork)
        fields.push({ label: 'Harness Work', value: misc.requireHarnessWork });
      if (misc.needWalkboards) fields.push({ label: 'Walkboards', value: misc.needWalkboards });

      if (fields.length > 0) {
        sections.push({ title: 'Misc', color: '#FFAB00', subsections: [{ name: '', fields }] });
      }
    }

    return sections;
  }, [jobState, calculatorData]);

  const handleGenerateAgreement = async () => {
    setAgreementDialogOpen(false);
    if (!leadId) return;

    try {
      setIsGenerating(true);

      // Construct jobScope directly from summarySections logic for parity
      const scope: string[] = [];
      summarySections.forEach((section) => {
        section.subsections.forEach((sub: any) => {
          sub.fields.forEach((field: any) => {
            if (field.value) {
              if (field.label && !field.label.includes('#')) {
                scope.push(`${field.label}: ${field.value}`);
              } else {
                scope.push(field.value);
              }
            }
          });
        });
      });

      const payload = {
        customer: {
          name:
            customerName ||
            `${leadData?.customerDetails?.firstName} ${leadData?.customerDetails?.lastName}`,
          address: leadData?.fullAddress || leadData?.customerDetails?.address || 'N/A',
          phone: leadData?.customerDetails?.phone || 'N/A',
          email: leadData?.customerDetails?.email || 'N/A',
        },
        job: {
          jobNumber: leadData?.jobNumber || leadId || 'N/A',
          jobDisplay: leadData?.jobNumber || leadId || 'N/A',
        },
        payment: {
          price: outcomeForm?.originalContractPrice
            ? `${outcomeForm.originalContractPrice}`
            : `$${(Number(calculatorData?.price) || 0).toLocaleString()}`,
          downPayment: outcomeForm?.downPayment ? `${outcomeForm.downPayment}` : '$0.00',
          downPaymentMethod: outcomeForm?.paymentMethod || outcomeForm?.downPaymentMethod || 'N/A',
          balance: outcomeForm?.balance ? `${outcomeForm.balance}` : '$0.00',
          balanceMethod: outcomeForm?.paymentMethod === 'Cash' ? 'Cash' : 'Financed',
          installDate: jobState.scheduleTime?.date || 'TBD',
          installWindow: jobState.scheduleTime?.timeWindow || '',

          // Extended fields from web app
          authNumber: outcomeForm?.wfAuthNumber || '',
          planNumber: outcomeForm?.planNumber || '',
          greenskyAppId: outcomeForm?.greenskyAppId || outcomeForm?.applicationId || '',
          ccLast4: outcomeForm?.ccLast4 || '',
        },
        jobScope: scope,
        contractorName: user?.displayName || user?.firstName || 'Representative',
      };

      const response = await LeadService.previewAgreement(leadId, payload);
      const data = response.data?.data || response.data;

      if (data?.agreementId && data?.previewBase64) {
        setAgreementData({ ...data, payload });
        setSignatureModalOpen(true);
      } else {
        throw new Error('Missing agreement data from response');
      }
    } catch (error) {
      console.error('[Summary] Generation failed:', error);
      Alert.alert('Error', 'Failed to generate agreement. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const renderSection = (section: any) => (
    <View
      key={section.title}
      className="mb-6 bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm"
    >
      <View
        style={{ backgroundColor: section.color }}
        className="px-6 py-4 flex-row justify-between items-center"
      >
        <Text className="text-xs font-black text-white  tracking-widest">{section.title}</Text>
        <Icon name="check-circle" size={16} color="white" />
      </View>
      <View className="p-6">
        {section.subsections.map((sub: any, sIdx: number) => (
          <View key={sIdx} className={sIdx > 0 ? 'mt-6' : ''}>
            {sub.name ? (
              <Text className="text-[10px] font-black text-slate-400  mb-4 tracking-widest">
                {sub.name}
              </Text>
            ) : null}
            <View className="gap-4">
              {sub.fields.map((field: any, fIdx: number) => (
                <View key={fIdx}>
                  <View className="flex-row">
                    <View className="flex-1">
                      {field.label ? (
                        <Text className="text-[9px] font-bold text-slate-400  mb-1 tracking-tight">
                          {field.label}
                        </Text>
                      ) : null}
                      <Text className="text-xs font-black text-slate-900 leading-4">
                        {field.value}
                      </Text>
                    </View>
                  </View>

                  {field.locationRows && field.locationRows.length > 0 && (
                    <View className="mt-3 pl-3 border-l-2 border-emerald-100 gap-2">
                      {field.locationRows.map((row: any, rIdx: number) => (
                        <View
                          key={rIdx}
                          className="flex-row justify-between items-center bg-slate-50 px-2 py-1.5 rounded-lg"
                        >
                          <Text className="text-[8px] font-black text-slate-500 ">
                            {row.location}
                          </Text>
                          <Text className="text-[8px] font-bold text-emerald-600 ">
                            {row.entries.map((e: any) => `${e.story}: ${e.value}ft`).join(' · ')}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {fIdx < sub.fields.length - 1 && <View className="h-[1px] bg-slate-50 mt-4" />}
                </View>
              ))}
            </View>
            {sIdx < section.subsections.length - 1 && (
              <View className="h-[1px] bg-slate-100 mt-6" />
            )}
          </View>
        ))}
      </View>
    </View>
  );

  const renderDocThumbnails = (title: string, docs: any[], type: 'agreement' | 'orderSheet') => {
    // Merge local state docs with resolved server docs
    const localFiles = docs.flatMap((d) => d.files || []);
    const serverFiles =
      type === 'agreement' ? resolvedDocuments.agreements : resolvedDocuments.orderSheets;

    // De-duplicate by serverId if present
    const allFiles = [...serverFiles];
    localFiles.forEach((lf) => {
      if (!lf.serverId || !allFiles.some((sf) => sf.serverId === lf.serverId)) {
        allFiles.push(lf);
      }
    });

    const isEmpty = allFiles.length === 0;

    return (
      <View className="mb-6 bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
        <View
          className={`px-6 py-4 flex-row justify-between items-center ${
            type === 'agreement' ? 'bg-red-500' : 'bg-blue-500'
          }`}
        >
          <Text className="text-sm font-black text-white  tracking-widest">{title}</Text>
          <Pressable
            onPress={() => {
              setScannerType(type);
              setScannerOpen(true);
            }}
          >
            <Icon name="plus-circle" size={20} color="white" />
          </Pressable>
        </View>
        <View className="p-6">
          {isEmpty ? (
            <View className="items-center py-6">
              <Icon name="file-document-outline" size={32} color="#CBD5E1" />
              <Text className="text-[10px] font-black text-slate-300  mt-2">
                No documents added
              </Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
              {allFiles.map((file, i) => (
                <Pressable
                  key={i}
                  onPress={() => file.uri && FileViewer.open(file.uri)}
                  className="w-24 h-32 rounded-xl bg-slate-50 mr-3 border border-slate-100 overflow-hidden"
                >
                  {file.uri?.toLowerCase().endsWith('.pdf') ? (
                    <View className="flex-1 items-center justify-center">
                      <Icon name="file-pdf-box" size={32} color="#EF4444" />
                      <Text
                        className="text-[8px] font-black text-slate-400  mt-2 px-1 text-center"
                        numberOfLines={1}
                      >
                        {file.name || 'PDF'}
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: file.uri }}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                  )}
                  <View className="absolute bottom-0 left-0 right-0 bg-black/60 py-1">
                    <Text className="text-white text-[8px] font-black text-center ">
                      Page {i + 1}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    );
  };

  const isScheduled = !!jobState.scheduleTime?.date;

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      <View className="px-5 py-5 pb-24 bg-white">
        <Text className="text-[10px] font-black  tracking-[2px] mb-6 ml-1 text-slate-400">
          Job Completion Blueprint
        </Text>

        {/* Appointment Status Card */}
        <View
          className={`mb-6 p-6 rounded-2xl border ${
            !isScheduled ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'
          }`}
        >
          <View className="flex-row items-center mb-6">
            <View
              className={`w-12 h-12 rounded-full items-center justify-center ${
                !isScheduled ? 'bg-red-500' : 'bg-emerald-500'
              }`}
            >
              <Icon
                name={!isScheduled ? 'calendar-alert' : 'calendar-check'}
                size={24}
                color="white"
              />
            </View>
            <View className="ml-4 flex-1">
              <Text
                className={`text-base font-black  ${
                  !isScheduled ? 'text-red-900' : 'text-emerald-900'
                }`}
              >
                {!isScheduled ? 'Schedule Required' : 'Appointment Locked'}
              </Text>
              {isScheduled && (
                <Text className="text-[10px] font-bold text-emerald-600 ">
                  {jobState.scheduleTime.date} · {jobState.scheduleTime.timeWindow || 'TBD'}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => setSchedulerOpen(true)}
              className={`px-4 h-10 rounded-lg items-center justify-center ${
                !isScheduled ? 'bg-red-600' : 'bg-emerald-600'
              }`}
            >
              <Text className="text-white font-black  text-[10px] tracking-widest">
                {!isScheduled ? 'Schedule' : 'Edit'}
              </Text>
            </Pressable>
          </View>
          {isScheduled && jobState.scheduleTime.reason && (
            <View className="p-3 bg-white/60 rounded-xl">
              <Text className="text-[10px] font-bold text-emerald-800  tracking-tight">
                TBD Reason: {jobState.scheduleTime.reason}
              </Text>
            </View>
          )}
        </View>

        {/* Summary Sections */}
        {summarySections.map(renderSection)}

        {/* Documents Section */}
        {renderDocThumbnails('Agreements', jobState.agreements || [], 'agreement')}
        {renderDocThumbnails('Order Sheets', jobState.orderSheets || [], 'orderSheet')}

        {/* Action Button */}
        <Pressable
          onPress={() => {
            if (!isScheduled) {
              Alert.alert('Required', 'Schedule an appointment before generating an agreement.');
              setSchedulerOpen(true);
            } else {
              setAgreementDialogOpen(true);
            }
          }}
          className="h-16 bg-slate-900 rounded-2xl items-center justify-center flex-row shadow-lg shadow-slate-900/20"
        >
          <Icon name="file-pdf-box" size={24} color="white" />
          <Text className="ml-3 text-white font-black  text-sm tracking-[2px]">
            Generate Agreement
          </Text>
        </Pressable>
      </View>

      <AppointmentSchedulerModal
        visible={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        onConfirm={(data) => onUpdate?.('scheduleTime', '', data)}
        customerName={customerName || 'Customer'}
      />

      <DocumentScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onSave={(pages) => {
          const field = scannerType === 'agreement' ? 'agreements' : 'orderSheets';
          const newValue = [
            {
              files: pages.map((p) => ({
                uri: p.uri,
                name: p.name,
                serverId: p.serverId,
                isNew: p.isNew,
              })),
            },
          ];
          onUpdate?.('', field, newValue);
        }}
        title={scannerType === 'agreement' ? 'Scan Agreement' : 'Scan Order Sheet'}
        leadId={leadId || ''}
        category={scannerType}
      />

      <AgreementDialogModal
        visible={agreementDialogOpen}
        onClose={() => setAgreementDialogOpen(false)}
        onGenerate={handleGenerateAgreement}
        onScan={() => {
          setAgreementDialogOpen(false);
          setScannerType('agreement');
          setScannerOpen(true);
        }}
      />

      {agreementData && (
        <AgreementSignatureModal
          visible={signatureModalOpen}
          onClose={() => setSignatureModalOpen(false)}
          leadId={leadId || ''}
          agreementId={agreementData.agreementId}
          previewBase64={agreementData.previewBase64}
          payload={agreementData.payload}
          signatureFields={agreementData.signatureFields}
          onSuccess={(pdfUrl) => {
            onUpdate?.('', 'agreements', [
              { files: [{ uri: pdfUrl, name: `agreement_${agreementData.agreementId}.pdf` }] },
            ]);
          }}
        />
      )}

      <Modal transparent visible={isGenerating} animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center">
          <View className="bg-white p-8 rounded-[32px] items-center shadow-2xl">
            <ActivityIndicator size="large" color="#00B8D9" />
            <Text className="mt-4 text-slate-900 font-black text-base ">Generating Document</Text>
            <Text className="mt-1 text-slate-400 text-[10px] font-bold  tracking-widest">
              Preparing your agreement
            </Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};
