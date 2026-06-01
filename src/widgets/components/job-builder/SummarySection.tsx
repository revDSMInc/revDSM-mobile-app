import React, { useState, useMemo, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  StyleSheet,
} from 'react-native';
import RNFS from 'react-native-fs';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ENV } from '../../../config/env';
import { AppointmentSchedulerModal } from '../../modals/job-builder/AppointmentSchedulerModal';
import { DocumentScannerModal } from '../../modals/job-builder/DocumentScannerModal';
import { AgreementDialogModal } from '../../modals/job-builder/AgreementDialogModal';
import { AgreementSignatureModal } from '../../modals/job-builder/AgreementSignatureModal';
import { PdfPreviewModal } from '../../modals/PdfPreviewModal';
import { LeadService } from '../../../services/api/leads';
import { useAuth } from '../../../hooks/useAuth';
import { useLeadQuery } from '../../../hooks/useLeadQuery';
import { SafeAreaView } from 'react-native-safe-area-context';

interface SummarySectionProps {
  jobState: any;
  availableSteps: any[];
  onUpdate?: (section: string, field: string, value: any) => void;
  leadId?: string;
  customerName?: string;
  calculatorData?: any;
  outcomeForm?: any;
  resolvedDocuments: { agreements: any[]; orderSheets: any[] };
  setResolvedDocuments: React.Dispatch<React.SetStateAction<{ agreements: any[]; orderSheets: any[] }>>;
  /** Ref shared with the parent JobBuilder screen to block auto-save during document uploads */
  isDocUploadingRef?: React.MutableRefObject<boolean>;
}

export const SummarySection = ({
  jobState,
  availableSteps,
  onUpdate,
  leadId,
  customerName,
  calculatorData,
  outcomeForm,
  resolvedDocuments,
  setResolvedDocuments,
  isDocUploadingRef,
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
  const [previewImage, setPreviewImage] = useState<{ uri: string; name: string } | null>(null);
  const [pdfPreview, setPdfPreview] = useState({ visible: false, uri: '', title: '' });

  const isAppointmentSet = !!jobState.scheduleTime?.date;
  const stableIsEdit = useMemo(() => isAppointmentSet, [schedulerOpen]);

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

  // Fetch lead outcome specifically for documents
  React.useEffect(() => {
    fetchOutcome();
  }, [leadId]);


  // Resolve secure URLs for leadOutcomeDocuments
  React.useEffect(() => {
    const resolveDocs = async () => {
      // Use outcomeData from API as primary source, fallback to leadData
      const docs = outcomeData?.leadOutcomeDocuments || leadData?.leadOutcomeDocuments;
      if (docs) {
        const { agreements = [], orderSheets = [] } = docs;

        // Preserve original group source in case documentType is missing
        const allDocs = [
          ...agreements.map((d: any) => ({ ...d, _sourceGroup: 'agreement' })),
          ...orderSheets.map((d: any) => ({ ...d, _sourceGroup: 'orderSheet' })),
        ];

        const allPaths = allDocs.map((doc: any) => ({
          filePath: doc.filePath,
          bucketName: doc.bucketName,
        }));

        if (allPaths.length > 0) {
          try {
            const response = await LeadService.getSecureUrls(allPaths);
            const urls = response.data?.data || response.data;

            const mappedAll = allDocs.map((doc: any) => {
              const urlObj = urls.find((u: any) => u.filePath === doc.filePath);
              const isPdf = doc.filePath?.toLowerCase().includes('.pdf') || doc.name?.toLowerCase().includes('.pdf');
              const finalType = doc.documentType || doc._sourceGroup;
              return {
                uri: urlObj?.secureUrl || urlObj?.url || doc.filePath,
                name: doc.name || (finalType === 'agreement' ? 'Agreement' : 'Order Sheet'),
                serverId: doc._id,
                isNew: false,
                isSystemGenerated: finalType === 'agreement' && isPdf,
                documentType: finalType,
              };
            });

            const resolved = {
              agreements: mappedAll.filter((d) => d.documentType === 'agreement'),
              orderSheets: mappedAll.filter((d) => d.documentType === 'orderSheet'),
            };

            setResolvedDocuments(resolved);
          } catch (error) {
            console.error('[Summary] Failed to resolve secure URLs:', error);
          }
        } else {
          setResolvedDocuments({ agreements: [], orderSheets: [] });
        }
      } else {
        setResolvedDocuments({ agreements: [], orderSheets: [] });
      }
    };
    resolveDocs();
  }, [outcomeData?.leadOutcomeDocuments, leadData?.leadOutcomeDocuments]);

  const hasValue = (val: any): boolean => {
    if (val === null || val === undefined || val === '' || val === 0 || val === '0') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.values(val).some((v) => hasValue(v));
    return true;
  };

  const summarySections = useMemo(() => {
    const sections: any[] = [];

    const getVal = (key: string) => {
      if (!calculatorData) return 0;
      const n = (v: any) => parseFloat(v) || 0;
      const lowerKey = key.toLowerCase();
      const target = lowerKey === 'screens' || lowerKey === 'numberofscreenpulls' ? 'cktoinstallers' : lowerKey;

      const findInObj = (obj: any) => {
        if (!obj || typeof obj !== 'object') return 0;
        const k = Object.keys(obj).find((ok) => {
          const lOk = ok.toLowerCase();
          return lOk === target || lOk === target.replace('labor', 'labour');
        });
        return k ? n(obj[k]) : 0;
      };

      return findInObj(calculatorData.inputs) || findInObj(calculatorData.extras) || findInObj(calculatorData) || 0;
    };

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

          if (
            comboTotal > 0 ||
            parseFloat(combo.mitersOutside) > 0 ||
            parseFloat(combo.mitersInside) > 0 ||
            parseFloat(combo.endCapsRights) > 0 ||
            parseFloat(combo.endCapsLefts) > 0
          ) {
            const parts = [];
            parts.push(`Partial: ${combo.partial || 'No'}`);
            if (comboTotal > 0) parts.push(`${comboTotal}'`);
            if (combo.color) parts.push(combo.color);
            if (combo.size) parts.push(combo.size);
            parts.push('Gutter');

            const accParts: any[] = [];
            if (parseFloat(combo.mitersOutside) > 0)
              accParts.push(
                `${combo.mitersOutside} Outside Miter${
                  parseFloat(combo.mitersOutside) > 1 ? 's' : ''
                }`
              );
            if (parseFloat(combo.mitersInside) > 0)
              accParts.push(
                `${combo.mitersInside} Inside Miter${parseFloat(combo.mitersInside) > 1 ? 's' : ''}`
              );
            if (parseFloat(combo.endCapsRights) > 0)
              accParts.push(`${combo.endCapsRights} End Cap (Right)`);
            if (parseFloat(combo.endCapsLefts) > 0)
              accParts.push(`${combo.endCapsLefts} End Cap (Left)`);

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
      const wedges = getVal('wedges');
      const straps = getVal('straps');
      const groundSpoutCount = getVal('groundSpout');
      const modifyHeightVal = getVal('modifyHeight');
      const replaceCornerCount = getVal('replaceCorner');
      const extSplashCount = getVal('extendedSplashGuard');
      const extSplash032Count = getVal('extendedSplashGuard032');

      if (wedges > 0) extrasList.push({ label: '', value: `${wedges} Wedges` });
      if (straps > 0) extrasList.push({ label: '', value: `${straps} Straps` });
      if (groundSpoutCount > 0) {
        const color = gutter.extrasColors?.groundSpout ? gutter.extrasColors.groundSpout + ' ' : '';
        extrasList.push({ label: '', value: `${groundSpoutCount} ${color}GroundSpout` });
      }

      if (gutter.extrasColors?.replaceCorner) {
        extrasList.push({
          label: '',
          value: `${replaceCornerCount > 0 ? replaceCornerCount + ' ' : ''}${
            gutter.extrasColors.replaceCorner
          } Replace Corner Miter`,
        });
      }
      if (gutter.extrasColors?.extendedSplashGuard) {
        extrasList.push({
          label: '',
          value: `${extSplashCount > 0 ? extSplashCount + ' ' : ''}${
            gutter.extrasColors.extendedSplashGuard
          } Extended Splash Guard`,
        });
      }
      if (gutter.extrasColors?.extendedSplashGuard032) {
        extrasList.push({
          label: '',
          value: `${extSplash032Count > 0 ? extSplash032Count + ' ' : ''}${
            gutter.extrasColors.extendedSplashGuard032
          } Extended .032 Splash Guard`,
        });
      }

      if (modifyHeightVal > 0) {
        extrasList.push({ label: 'Modify Height', value: '' });
        if (gutter.modifyHeightLocations && gutter.modifyHeightLocations.length > 0) {
          extrasList.push({
            label: 'Location',
            value: Array.isArray(gutter.modifyHeightLocations)
              ? gutter.modifyHeightLocations.join(', ')
              : gutter.modifyHeightLocations,
          });
        }
        extrasList.push({ label: '', value: `${modifyHeightVal} Modify Height/R&R` });
      }

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
        const storyLabels: any = { 1: '1st Story', 2: '2nd Story', 3: '3rd Story' };

        lf.combinations.forEach((combo: any, index: number) => {
          const comboParts = [];
          const comboTotal =
            combo.measurements?.reduce(
              (sum: number, val: any) => sum + (parseFloat(val) || 0),
              0
            ) || 0;

          if (comboTotal === 0) return;

          if (comboTotal > 0) comboParts.push(`${comboTotal} ft`);
          if (combo.lfColor) comboParts.push(combo.lfColor);

          if (combo.gutterOpeningWidth && combo.lfProfile) {
            const is45Width =
              combo.gutterOpeningWidth === '4 & 5"' || combo.gutterOpeningWidth === '4&5"';
            const widthToShow =
              is45Width && combo.exactSize ? combo.exactSize : combo.gutterOpeningWidth;
            comboParts.push(`${widthToShow} ${combo.lfProfile}`);
          } else if (combo.lfProfile) {
            comboParts.push(combo.lfProfile);
          }

          if (combo.gutterProfile) comboParts.push(combo.gutterProfile);

          const locationRows: any[] = [];
          [1, 2, 3].forEach((story) => {
            const storyEntries: any[] = [];
            locationNames.forEach((loc, locIdx) => {
              const mIdx = locIdx + (story - 1) * 6;
              const val = parseFloat(combo.measurements?.[mIdx] || 0);
              if (val > 0) {
                storyEntries.push({ location: loc, value: val });
              }
            });
            if (storyEntries.length > 0)
              locationRows.push({ story: storyLabels[story], entries: storyEntries });
          });

          combinationFields.push({
            label: `Combination #${combinationFields.length + 1}`,
            value: comboParts.join(' · '),
            locationRows,
          });
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
        const fields = [];
        if (soffit.vinyl.type) fields.push({ label: 'Type', value: soffit.vinyl.type });
        fields.push({
          label: '',
          value: `${soffit.vinyl.footage}' ${soffit.vinyl.color} ${soffit.vinyl.soffitType} Vinyl Soffit`,
        });
        subsections.push({
          name: 'Vinyl Soffit',
          fields,
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
        const fields = [];
        if (soffit.nailer.type) fields.push({ label: 'Type', value: soffit.nailer.type });
        fields.push({
          label: '',
          value: `${soffit.nailer.footage}' ${soffit.nailer.color} ${soffit.nailer.soffitType} Nailer Build Out`,
        });
        subsections.push({
          name: 'Nailer Build Out',
          fields,
        });
      }

      if (subsections.length > 0) {
        sections.push({ title: 'Soffit', color: '#82D616', subsections });
      }
    }

    // 4. Fascia Section
    if (jobState.fascia && hasValue(jobState.fascia)) {
      const fascia = jobState.fascia;
      const fasciaSubsections = [];

      if (
        fascia.wrap &&
        (parseFloat(fascia.wrap.footage) > 0 || fascia.wrap.color || fascia.wrap.type)
      ) {
        const wrapFields = [];
        if (fascia.wrap.type) wrapFields.push({ label: 'Type', value: fascia.wrap.type });

        const parts = [];
        if (fascia.wrap.footage && parseFloat(fascia.wrap.footage) > 0)
          parts.push(`${fascia.wrap.footage}'`);
        if (fascia.wrap.color) parts.push(fascia.wrap.color);
        if (fascia.wrap.size) parts.push(fascia.wrap.size);
        parts.push('Fascia Trim');

        wrapFields.push({ label: '', value: parts.join(' ') });
        fasciaSubsections.push({ name: 'Fascia Trim', fields: wrapFields });
      }

      if (
        fascia.boards &&
        (parseFloat(fascia.boards.footage) > 0 || fascia.boards.boardType || fascia.boards.type)
      ) {
        const boardsFields = [];
        if (fascia.boards.type) boardsFields.push({ label: 'Type', value: fascia.boards.type });

        const parts = [];
        if (fascia.boards.footage && parseFloat(fascia.boards.footage) > 0)
          parts.push(`${fascia.boards.footage}'`);
        if (fascia.boards.boardType) parts.push(fascia.boards.boardType);
        if (fascia.boards.size) parts.push(fascia.boards.size);
        parts.push('Fascia Board');

        boardsFields.push({ label: '', value: parts.join(' ') });
        fasciaSubsections.push({ name: 'Fascia Boards', fields: boardsFields });
      }

      const alumBoardFootage = fascia.aluminumBoards?.footage || getVal('aluminumFasciaBoard');
      if (alumBoardFootage > 0) {
        fasciaSubsections.push({
          name: 'Aluminum Fascia Boards',
          fields: [{ label: '', value: `${alumBoardFootage}' Aluminum 2"x2" Fascia Board` }],
        });
      }

      if (fasciaSubsections.length > 0) {
        sections.push({ title: 'Fascia', color: '#8E33FF', subsections: fasciaSubsections });
      }
    }

    // 5. Misc Section
    if (jobState.additional && hasValue(jobState.additional)) {
      const misc = jobState.additional || {};
      const fields: any[] = [];
      const laborVal = parseFloat(misc.extraLabor) || getVal('extraLabor');
      const screensVal = parseFloat(misc.numberOfScreenPulls) || getVal('screens');

      if (laborVal > 0)
        fields.push({
          label: 'Extra Labor',
          value: `${laborVal} Extra Labor${laborVal > 1 ? 's' : ''}`,
        });
      if (misc.extraLaborReason)
        fields.push({ label: 'Extra Labor Reason', value: misc.extraLaborReason });
      if (screensVal > 0)
        fields.push({ label: 'Number of Screen Pulls', value: String(screensVal) });
      if (misc.cutAndRemoveShingleOverhang)
        fields.push({
          label: 'Cut and Remove Shingle Overhang',
          value: misc.cutAndRemoveShingleOverhang,
        });
      if (misc.dripEdgeFlashingFootage > 0)
        fields.push({
          label: 'Drip Edge/Flashing Footage',
          value: `${misc.dripEdgeFlashingFootage} ft`,
        });
      if (misc.fortyFootLadderNeeded)
        fields.push({ label: 'Forty Foot Ladder Needed', value: misc.fortyFootLadderNeeded });
      if (misc.requireHarnessWork)
        fields.push({ label: 'Require Harness Work', value: misc.requireHarnessWork });
      if (misc.needWalkboards)
        fields.push({ label: 'Need Walkboards', value: misc.needWalkboards });

      if (fields.length > 0) {
        sections.push({ title: 'Misc', color: '#FFAB00', subsections: [{ name: '', fields }] });
      }
    }

    // 5. Lighting Section
    if (jobState.lighting && hasValue(jobState.lighting)) {
      const lighting = jobState.lighting;
      const lightingSubsections: any[] = [];
      const locationNames = ['LEFT SIDE', 'RIGHT SIDE', 'FRONT', 'REAR', 'GARAGE', 'OTHER'];
      const storyLabels = ['1st Story', '2nd Story', '3rd Story'];

      const combinations = lighting.combinations || [];
      const combinationFields: any[] = [];

      combinations.forEach((combo: any, idx: number) => {
        const comboTotal = (combo.measurements || []).reduce((sum: number, v: any) => sum + (parseFloat(v) || 0), 0);
        if (comboTotal === 0 && !combo.trackColor && !combo.wireColor && !combo.trackMaterial && !combo.mountingLocation && !combo.substrate) return;

        const parts = [];
        if (comboTotal > 0) parts.push(`${comboTotal} ft`);
        if (combo.trackColor) parts.push(`Track: ${combo.trackColor}`);
        if (combo.wireColor) parts.push(`Wire: ${combo.wireColor}`);
        if (combo.trackMaterial) parts.push(combo.trackMaterial);
        if (combo.mountingLocation) parts.push(combo.mountingLocation);
        if (combo.substrate) parts.push(combo.substrate);

        const locationRows: any[] = [];
        const storyLabelsNum = { 1: '1st Story', 2: '2nd Story', 3: '3rd Story' };
        [1, 2, 3].forEach((story) => {
          const storyEntries: any[] = [];
          locationNames.forEach((loc, locIdx) => {
            const mIdx = locIdx + (story - 1) * 6;
            const val = parseFloat(combo.measurements?.[mIdx] || 0);
            if (val > 0) {
              storyEntries.push({ location: loc, value: val });
            }
          });
          if (storyEntries.length > 0) {
            locationRows.push({ story: (storyLabelsNum as any)[story], entries: storyEntries });
          }
        });

        combinationFields.push({
          label: `Combination #${idx + 1}`,
          value: parts.join(' · '),
          locationRows,
        });
      });

      if (combinationFields.length > 0) {
        lightingSubsections.push({ name: '', fields: combinationFields });
      }

      const extras = lighting.extras || {};
      const extrasFields: any[] = [];
      const extrasLabels = {
        boosterBox: 'Booster Box',
        controlBox: 'Control Box',
        electricalOutlet: 'Electrical Outlet',
        wifiExtender: 'WiFi Extender',
      };
      Object.entries(extrasLabels).forEach(([key, label]) => {
        const val = parseFloat(extras[key]) || 0;
        if (val > 0) {
          extrasFields.push({ label: '', value: `${val} ${label}` });
        }
      });
      if (extrasFields.length > 0) {
        lightingSubsections.push({ name: 'Extras', fields: extrasFields });
      }

      if (lightingSubsections.length > 0) {
        sections.push({ title: 'Lighting', color: '#FF9F43', subsections: lightingSubsections });
      }
    }

    return sections;
  }, [jobState, calculatorData]);

  const handleGenerateAgreement = async (scheduleTimeOverride?: any) => {
    if (!leadId) return;

    const installDate = scheduleTimeOverride?.date || jobState.scheduleTime?.date;
    const isTbd = installDate === 'TBD' || (scheduleTimeOverride?.reason && !scheduleTimeOverride?.date);

    if (!installDate) {
      Alert.alert(
        'Appointment Required',
        'Please schedule an appointment or select TBD to generate an agreement.'
      );
      return;
    }

    try {
      const shortenOfficeName = (name: any) => {
        if (!name || typeof name !== 'string') return '';
        const words = name.trim().split(' ');
        if (words.length === 1) {
          return name.length <= 3 ? name.toUpperCase() : name.slice(0, 3).toUpperCase();
        }
        return words
          .map((w) => w[0])
          .join('')
          .toUpperCase();
      };
      const officeDetails = leadData?.assignedRepDetails?.office?.[0];
      let officeName = typeof officeDetails === 'string' ? officeDetails : officeDetails?.name;

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

      const jobNumber = `${shortName}-${displayId}`;
      const jobDisplay = `${shortName}${displayId}`;

      setIsGenerating(true);
      const userFullName =
        user?.displayName ||
        `${user?.firstName || ''} ${user?.lastName || ''}`.trim() ||
        'Representative';

      // Lead Name for Customer
      const leadFullName =
        `${leadData?.customerDetails?.firstName || ''} ${
          leadData?.customerDetails?.lastName || ''
        }`.trim() || customerName;

      // Construct high-fidelity Job Scope (Description of Work) to match web app logic
      const scope: string[] = [];
      const findSec = (t: string) =>
        summarySections.find((s) => s.title.toLowerCase().includes(t.toLowerCase()));
      const getFields = (s: any, sub: string) =>
        s?.subsections.find((x: any) => x.name.toLowerCase().includes(sub.toLowerCase()))?.fields ||
        [];
      const extractFt = (v: any) => (v ? (String(v).match(/(\d+)/) || [])[1] : null);

      // 1. CSR
      const lfSec = findSec('leaffilter');
      const csrField = getFields(lfSec, 'extras').find((f: any) =>
        f.value.toLowerCase().includes('c-s-r')
      );
      if (csrField) {
        scope.push(
          `Clean, Seal and Reinforce: Clean interior of Gutter and Downspouts, Seal each seam with 50yr Silicone, Install Hidden Hangers to reinforce — ${
            extractFt(csrField.value) || '1'
          }'`
        );
      }

      // 2. Fascia Board
      const fSec = findSec('fascia');
      getFields(fSec, 'boards').forEach((f: any) => {
        const ft = extractFt(f.value);
        const match = f.value.match(/(\w+)\s+(\d+X\d+)\s+Fascia Board/i);
        if (match) scope.push(`Install Fascia Board (${match[2]} ${match[1]}) — ${ft}'`);
      });

      // 3. Soffit & Porch
      const sSec = findSec('soffit');
      let soffitFt = 0;
      let soffitColor = '';
      let soffitType = '';
      let soffitInstallType = 'Partial Home';
      getFields(sSec, 'vinyl').forEach((f: any) => {
        if (f.value.toLowerCase().includes('vinyl soffit')) {
          const ft = extractFt(f.value);
          soffitFt += parseInt(ft || '0');
          // Improved color/type extraction
          const m = f.value.match(/(\d+'\s+)(.+?)\s+Vinyl Soffit/i);
          if (m) {
            const fullContent = m[2].trim();
            const typeKeywords = ['HIDDEN VENT VINYL', 'VENT VINYL', 'SOLID VINYL', 'ALUMINUM'];
            let extractedColor = fullContent;
            let extractedType = '';
            for (const keyword of typeKeywords) {
              if (fullContent.toUpperCase().includes(keyword)) {
                const parts = fullContent.toUpperCase().split(keyword);
                if (parts.length >= 2) {
                  extractedColor = parts[0].trim();
                  extractedType = keyword;
                  break;
                }
              }
            }
            if (!soffitColor) soffitColor = extractedColor;
            if (!soffitType) soffitType = extractedType;
          }
        }
      });
      const typeField = sSec?.subsections
        .flatMap((ss: any) => ss.fields)
        .find((f: any) => f.label === 'Type');
      if (typeField?.value.toLowerCase().includes('full')) soffitInstallType = 'Full Home';
      if (soffitFt > 0) {
        scope.push(
          `Install ${soffitColor} ${soffitType} soffit — ${soffitFt}'; Type: ${soffitInstallType}`
        );
        scope.push(
          `Installation: Install ${soffitColor} J Channel on structure every 12", cut and install soffit ${soffitColor} to edge and secure.`
        );
      }
      const porchField = getFields(sSec, 'porch').find((f: any) =>
        f.value.toLowerCase().includes('porch ceiling')
      );
      const porchLoc = getFields(sSec, 'porch').find((f: any) => f.label === 'Location');
      if (porchField) {
        // Extract color from porch field
        const pm = porchField.value.match(/(\w+)\s+([\w\s]+)\s+Porch Ceiling/i);
        const pColor = pm ? pm[1] : (soffitColor || 'White');
        scope.push(
          `Install ${pColor} soffit on Porch Ceiling: ${porchLoc?.value || 'N/A'}`
        );
      }

      // 5. Fascia Wrap
      getFields(fSec, 'trim').forEach((f: any) => {
        if (f.value.toLowerCase().includes('fascia trim')) {
          const ft = extractFt(f.value);
          const colorMatch = f.value.match(/(\d+'\s+)([^0-9]+?)\s+/);
          scope.push(`Install ${colorMatch ? colorMatch[2].trim() : 'White'} fascia wrap — ${ft}'`);
        }
      });

      // 6. Gutter & Remove/Rehang
      const gSec = findSec('gutter');
      const rrField = getFields(gSec, 'extras').find(
        (f: any) =>
          f.value.toLowerCase().includes('modify height') || f.value.toLowerCase().includes('r&r')
      );
      let hasWedges = getFields(gSec, 'extras').some((f: any) => f.value.toLowerCase().includes('wedges'));
      
      if (rrField) {
        const rrLocField = gSec?.subsections?.find((sub: any) => 
          sub.name && sub.name.toLowerCase().includes('extras')
        )?.fields?.find((f: any) => f.label === 'Location');
        const rrLoc = rrLocField?.value || 'Front';
        scope.push(`Remove and Rehang ${rrLoc}: ${extractFt(rrField.value)}'`);
        
        let installDesc = 'Installation: Align, pitch';
        if (hasWedges) installDesc += ', install wedges for slanted/step fascia';
        installDesc += ', install hidden hangers every 20-25", seal each seam, miter and connection with 50yr silicone';
        scope.push(installDesc);
      }

      let totalGutterFt = 0;
      let gColor = '';
      let gSizes: string[] = [];
      let gLocs: string[] = [];
      const gMain = gSec?.subsections.find(
        (ss: any) => ss.name === '' || ss.name.toLowerCase().includes('gutter')
      );
      gMain?.fields.forEach((f: any) => {
        if (f.label?.startsWith('Combination #')) {
          const parts = f.value.split('·').map((s: any) => s.trim());
          if (parts.length >= 2) {
            // Find the part that looks like footage (e.g., "100'")
            const ftPart = parts.find((p: string) => /\d+'/.test(p) || /\d+ ft/.test(p));
            const ft = parseInt(extractFt(ftPart) || '0');
            
            if (ft > 0) {
              totalGutterFt += ft;
              // Extract color - usually the part after footage or containing a known color
              // But more reliably, it's one of the parts that isn't footage, size, or "Gutter"
              const colorPart = parts.find((p: string) => 
                !p.includes("'") && 
                !p.includes('"') && 
                !p.toLowerCase().includes('partial') && 
                !p.toLowerCase().includes('gutter')
              );
              gColor = colorPart || 'White';
              
              const sizePart = parts.find((p: string) => p.includes('"'));
              const size = (sizePart?.match(/(\d+)/) || [])[1] || '5';
              
              if (!gSizes.includes(size)) gSizes.push(size);
              if (size === '5' || size === '6') {
                if (!gLocs.includes('LEFT SIDE')) gLocs.push('LEFT SIDE');
              } else if (size === '7') {
                if (!gLocs.includes('REAR')) gLocs.push('REAR');
              }
            }
          }
        }
      });

      if (totalGutterFt > 0) {
        const sizeText = gSizes.length > 1 ? `${gSizes.join('" & ')}"` : `${gSizes[0]}"`;
        scope.push(
          `Install ${sizeText} K-Style ${gColor} gutters on ${gLocs.join(', ')}; ${totalGutterFt}'`
        );
        let installDesc = 'Installation: Align, pitch';
        if (hasWedges) installDesc += ', install wedges for slanted/step fascia';
        installDesc += ', install hidden hangers every 20-25", seal each seam, miter and connection with 50yr silicone';
        scope.push(installDesc);
      }
      if (gColor && ['white', 'clay', 'linen', 'musket brown'].includes(gColor.toLowerCase())) {
        scope.push(
          `Includes 50-year Sherwin Williams paint warranty with Kynar (Won't Chip & Scratch) and TrueCoat (Won't Fade or Stain)`
        );
      }

      // 10. Downspouts
      const dsSub = gSec?.subsections.find((ss: any) =>
        ss.name.toLowerCase().includes('downspout')
      );
      dsSub?.fields.forEach((f: any) => {
        if (f.value && !f.label) {
          const ft = extractFt(f.value);
          const sizeMatch = f.value.match(/(\d+\s*[Xx]\s*\d+)/);
          const colorMatch = f.value.match(/([A-Za-z\s]+?)\s+\d+\s*[Xx]/i);
          if (ft && sizeMatch)
            scope.push(
              `Install ${ft}' of ${sizeMatch[0].replace(/\s*[Xx]\s*/, ' X ')} ${
                colorMatch ? colorMatch[1].trim() : gColor || 'White'
              } downspouts`
            );
        }
      });

      // 11. LeafFilter
      let hasLF = false;
      let hasVM = false;
      const lfByColor: any = {};
      const lfMain = lfSec?.subsections.find(
        (ss: any) => ss.name === '' || ss.name.toLowerCase().includes('combination')
      );
      
      const locationNames = ['LEFT SIDE', 'RIGHT SIDE', 'FRONT', 'REAR', 'GARAGE', 'OTHER'];
      
      lfMain?.fields.forEach((f: any, fIdx: number) => {
        if (f.label?.startsWith('Combination #')) {
          const p = f.value.split('·').map((s: any) => s.trim());
          if (p.length >= 3) {
            const ft = parseInt(extractFt(p[0]) || '0');
            const color = p[1];
            const profile = p[2].toLowerCase();
            
            if (ft > 0) {
              const comboIdx = parseInt(f.label.match(/#(\d+)/)?.[1] || '0') - 1;
              const combo = jobState.leaffilter?.combinations?.[comboIdx];
              const comboLocs: string[] = [];
              
              if (combo?.measurements) {
                locationNames.forEach((locName, locIdx) => {
                  let locTotal = 0;
                  for (let story = 0; story < 3; story++) {
                    locTotal += parseFloat(combo.measurements[locIdx + (story * 6)]) || 0;
                  }
                  if (locTotal > 0) comboLocs.push(locName);
                });
              }
              
              if (comboLocs.length === 0) comboLocs.push('LEFT SIDE');

              if (profile.includes('versa max')) {
                hasVM = true;
              } else {
                hasLF = true;
                if (!lfByColor[color]) lfByColor[color] = { ft: 0, locs: [] };
                lfByColor[color].ft += ft;
                comboLocs.forEach(loc => {
                  if (!lfByColor[color].locs.includes(loc)) lfByColor[color].locs.push(loc);
                });
              }
            }
          }
        }
      });
      
      Object.keys(lfByColor).forEach((c) =>
        scope.push(
          `Install ${c} LeafFilter on ${lfByColor[c].locs.join(', ')} — ${lfByColor[c].ft}'`
        )
      );
      if (hasLF && totalGutterFt === 0)
        scope.push(
          `Gutter Tune-Up: Remove debris, clean thoroughly, realign and repitch, Install Hidden Hangers every 25", seal with 50yr silicone`
        );
      if (hasVM)
        scope.push(
          `Existing Fascia Gutter Tune Up: Remove all debris, seal each seam, miter and connection with 50yr silicone`
        );
      if (hasLF || hasVM)
        scope.push(
          `Includes No Clog and No Leak Guarantee and Lifetime Transferable Warranty on LeafFilter`
        );

      // 19. Groundspouts & Misc
      const gsField = getFields(gSec, 'extras').find((f: any) =>
        f.value.toLowerCase().includes('groundspout')
      );
      if (gsField) scope.push(`Install ${extractFt(gsField.value) || '1'} groundspouts`);

      // 19.5. Lighting
      const lightSec = findSec('lighting');
      if (lightSec) {
        getFields(lightSec, '').forEach((f: any) => {
          if (f.label && f.label.startsWith('Combination #') && f.value) {
            const parts = f.value.split('·').map((s: string) => s.trim()).filter(Boolean);
            const footage = extractFt(parts[0]) || '0';

            let locationStr = '';
            if (f.locationRows && f.locationRows.length > 0) {
              locationStr = f.locationRows
                .map((row: any) => {
                  const locs = row.entries.map((e: any) => `${e.location}: ${e.value} ft`).join(', ');
                  return `${row.story} (${locs})`;
                })
                .join(', ');
            }

            const detailParts = parts.slice(1);
            const detailStr = detailParts.length > 0 ? ` (${detailParts.join(', ')})` : '';
            const locationPart = locationStr ? ` — ${locationStr}` : ` — ${footage} ft`;

            scope.push(`Install Permanent Lighting${detailStr}${locationPart}`);
          }
        });

        const extraFields = getFields(lightSec, 'extras');
        const extraItems = extraFields
          .filter((f: any) => f.value && f.value.trim() !== '')
          .map((f: any) => f.value.trim());
        if (extraItems.length > 0) {
          scope.push(`Lighting Extras: ${extraItems.join(', ')}`);
        }
      }

      const mSec = findSec('misc');
      const mFields = getFields(mSec, '');
      const labField = mFields.find((f: any) => f.label?.toLowerCase().includes('extra labor'));
      if (labField?.value) scope.push(`Additional Labor: ${labField.value}`);
      const notesField = mFields.find((f: any) => f.label?.toLowerCase().includes('notes'));
      if (notesField?.value) scope.push(notesField.value);

      const payload = {
        customer: {
          name: leadFullName,
          address: leadData?.fullAddress || leadData?.customerDetails?.address || 'N/A',
          phone: leadData?.customerDetails?.phone || 'N/A',
          email: leadData?.customerDetails?.email || 'N/A',
        },
        job: {
          jobNumber: jobNumber,
          jobDisplay: jobDisplay,
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
        },
        jobScope: scope.length > 0 ? scope : ['Project completion per summary details'],
        contractorName: `${userFullName}`,
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

  const handleOpenDocument = async (file: any) => {
    if (!file.uri) return;

    try {
      let documentUri = file.uri;

      // If it's a relative server path, prepend the base API URL
      if (documentUri.startsWith('/') && !documentUri.startsWith('file://')) {
        const exists = await RNFS.exists(documentUri);
        if (!exists) {
          documentUri = `${ENV.API_URL}${documentUri.startsWith('/') ? '' : '/'}${documentUri}`;
        }
      }

      const isPdf =
        documentUri.toLowerCase().includes('.pdf') ||
        file.name?.toLowerCase().includes('.pdf') ||
        file.documentType === 'agreement';

      const isImage =
        documentUri.match(/\.(jpg|jpeg|png|webp|heic)/i) || documentUri.startsWith('data:image');

      if (isImage && !isPdf) {
        setPreviewImage({ uri: documentUri, name: file.name || 'Document Preview' });
        return;
      }

      if (documentUri.startsWith('http')) {
        let extension = isPdf ? 'pdf' : 'jpg';
        const baseUrl = documentUri.split('?')[0].toLowerCase();
        if (baseUrl.endsWith('.jpg') || baseUrl.endsWith('-jpg')) extension = 'jpg';
        else if (baseUrl.endsWith('.jpeg') || baseUrl.endsWith('-jpeg')) extension = 'jpeg';
        else if (baseUrl.endsWith('.png') || baseUrl.endsWith('-png')) extension = 'png';
        else if (baseUrl.endsWith('.pdf') || baseUrl.endsWith('-pdf')) extension = 'pdf';
        else if (isPdf) extension = 'pdf';
        extension = extension.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        const sanitizedName = (file.name || 'document').replace(/[^a-zA-Z0-9]/g, '_');
        const localPath = `${RNFS.CachesDirectoryPath}/${sanitizedName}_${Date.now()}.${extension}`;

        // Try RNFS download first; fall back to fetch+write if DNS fails (common on Android emulator)
        let downloaded = false;
        try {
          const dl = RNFS.downloadFile({ fromUrl: documentUri, toFile: localPath });
          await dl.promise;
          downloaded = true;
        } catch (dlErr: any) {
          console.warn('[Summary] RNFS download failed, trying fetch fallback:', dlErr?.message);
        }

        if (!downloaded) {
          // fetch fallback — includes Authorization header in case URL requires it
          const token = await AsyncStorage.getItem('accessToken');
          const res = await fetch(documentUri, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          await RNFS.writeFile(localPath, base64, 'base64');
        }

        if (isPdf) {
          setPdfPreview({ visible: true, uri: localPath, title: file.name || 'PDF Preview' });
        } else {
          setPreviewImage({ uri: `file://${localPath}`, name: file.name || 'Document Preview' });
        }
      } else {
        const path = documentUri.startsWith('file://') ? documentUri : `file://${documentUri}`;
        if (isPdf) {
          setPdfPreview({ visible: true, uri: path, title: file.name || 'PDF Preview' });
        } else {
          await FileViewer.open(path);
        }
      }
    } catch (error) {
      console.error('[Summary] Failed to open document:', error);
      Alert.alert('Error', 'Could not open this document. It may still be processing or the network is unavailable.');
    }
  };

  const renderSection = (section: any) => (
    <View
      key={section.title}
      style={{ marginBottom: 24, backgroundColor: 'white', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
    >
      <View
        style={{ backgroundColor: section.color, paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Text style={{ fontSize: 10, fontWeight: '900', color: 'white', letterSpacing: 1.5, textTransform: 'uppercase' }}>{section.title}</Text>
        <Icon name="check-circle" size={16} color="white" />
      </View>
      <View style={{ padding: 24 }}>
        {section.subsections.map((sub: any, sIdx: number) => (
          <View key={sIdx} style={sIdx > 0 ? { marginTop: 24 } : {}}>
            {sub.name ? (
              <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', marginBottom: 16, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                {sub.name}
              </Text>
            ) : null}
            <View style={{ gap: 16 }}>
              {sub.fields.map((field: any, fIdx: number) => (
                <View key={fIdx}>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ flex: 1 }}>
                      {field.label ? (
                        <Text style={{ fontSize: 7, fontWeight: 'bold', color: '#94a3b8', marginBottom: 4, letterSpacing: -0.3 }}>
                          {field.label}
                        </Text>
                      ) : null}
                      <Text style={{ fontSize: 11, fontWeight: '900', color: '#0f172a', lineHeight: 18 }}>
                        {field.value}
                      </Text>
                    </View>
                  </View>

                  {field.locationRows && field.locationRows.length > 0 && (
                    <View style={{ marginTop: 12, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: '#d1fae5', gap: 8 }}>
                      {field.locationRows.map((row: any, rIdx: number) => (
                        <View
                          key={rIdx}
                          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 }}
                        >
                          <Text style={{ fontSize: 6, fontWeight: '900', color: '#64748b' }}>{row.story}</Text>
                          <Text style={{ fontSize: 6, fontWeight: 'bold', color: '#059669' }}>
                            {row.entries.map((e: any) => `${e.location}: ${e.value}ft`).join(' · ')}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {fIdx < sub.fields.length - 1 && <View style={{ height: 1, backgroundColor: '#f8fafc', marginTop: 16 }} />}
                </View>
              ))}
            </View>
            {sIdx < section.subsections.length - 1 && (
              <View style={{ height: 1, backgroundColor: '#f1f5f9', marginTop: 24 }} />
            )}
          </View>
        ))}
      </View>
    </View>
  );

  const [thumbLoadingMap, setThumbLoadingMap] = useState<Record<string, boolean>>({});

  const handleDeleteDocument = useCallback(
    async (file: any, type: 'agreement' | 'orderSheet') => {
      const docId = file.serverId || file._id || file.id;
      if (!docId) return;

      Alert.alert(
        'Delete Document',
        'Are you sure you want to permanently delete this document?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await LeadService.deleteOutcomeDocument(docId);
                // Refresh from server to reflect deletion
                await fetchOutcome();
              } catch (err) {
                console.error('[Summary] Delete failed:', err);
                Alert.alert('Error', 'Could not delete the document. Please try again.');
              }
            },
          },
        ],
      );
    },
    [fetchOutcome],
  );

  const renderDocThumbnails = (title: string, docs: any[], type: 'agreement' | 'orderSheet') => {
    const serverFiles =
      type === 'agreement' ? resolvedDocuments.agreements : resolvedDocuments.orderSheets;
    const isEmpty = serverFiles.length === 0;

    const isDemo = outcomeForm?.result?.toLowerCase() === 'demo';
    const isRequired = type === 'agreement' ? !isDemo : isDemo;

    return (
      <View style={{ marginBottom: 24, backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}>
        <View
          style={{
            paddingHorizontal: 24,
            paddingVertical: 16,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: type === 'agreement' ? '#ef4444' : '#00B8D9'
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 8, fontWeight: '900', color: 'white', letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 8 }}>
              {title}
            </Text>
            {isRequired && (
              <View style={{ backgroundColor: 'white', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: type === 'agreement' ? '#ef4444' : '#00B8D9', fontSize: 6, fontWeight: '900' }}>REQUIRED</Text>
              </View>
            )}
          </View>
          {!isEmpty && (type !== 'agreement' || isAppointmentSet) && (
            <Pressable
              onPress={() => {
                if (type === 'agreement') {
                  setScannerType('agreement');
                  setScannerOpen(true);
                } else {
                  setScannerType('orderSheet');
                  setScannerOpen(true);
                }
              }}
              hitSlop={10}
            >
              <Icon
                name="plus-circle"
                size={20}
                color="white"
              />
            </Pressable>
          )}
        </View>
        <View style={{ padding: 24 }}>
          {isEmpty ? (
            <View style={{ alignItems: 'center', paddingVertical: 24, borderStyle: 'dashed', borderColor: '#f1f5f9', borderRadius: 24, borderWidth: 2 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Icon
                  name={type === 'agreement' ? 'file-certificate-outline' : 'file-document-outline'}
                  size={32}
                  color="#CBD5E1"
                />
              </View>
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#94a3b8', marginBottom: 24 }}>No documents</Text>

              <View style={{ width: '100%', paddingHorizontal: 48, gap: 12 }}>
                {type === 'agreement' ? (
                  isAppointmentSet ? (
                    <Pressable
                      onPress={handleGenerateAgreement}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', borderWidth: 1, borderColor: '#e2e8f0', height: 44, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
                    >
                      <Icon name="auto-fix" size={18} color="#22C55E" style={{ marginRight: 8 }} />
                      <Text style={{ color: '#059669', fontWeight: '900', fontSize: 10 }}>Generate</Text>
                    </Pressable>
                  ) : (
                    <View style={{ alignItems: 'center', padding: 8 }}>
                      <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#ef4444', textAlign: 'center' }}>
                        Schedule an appointment to enable agreements
                      </Text>
                    </View>
                  )
                ) : (
                  <Pressable
                    onPress={() => {
                      setScannerType('orderSheet');
                      setScannerOpen(true);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', borderWidth: 1, borderColor: '#e2e8f0', height: 44, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
                  >
                    <Icon name="plus" size={18} color="#0F172A" />
                    <Text style={{ color: '#0f172a', fontWeight: '900', fontSize: 10, marginLeft: 8 }}>Add Document</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
              {serverFiles.map((file, i) => {
                const thumbKey = `${type}-${file.serverId || file.id || i}`;
                const isLoading = thumbLoadingMap[thumbKey] !== false; // default true until loaded
                const isPdf =
                  file.uri?.toLowerCase().includes('.pdf') ||
                  file.name?.toLowerCase().includes('.pdf') ||
                  !file.uri?.match(/\.(jpg|jpeg|png|webp|heic)/i);

                return (
                  <View
                    key={thumbKey}
                    style={{ width: 96, height: 128, borderRadius: 12, backgroundColor: '#f8fafc', marginRight: 12, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', position: 'relative', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
                  >
                    {/* Tap area to preview */}
                    <Pressable
                      onPress={() => handleOpenDocument(file)}
                      style={StyleSheet.absoluteFill}
                    >
                      {isPdf ? (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(248, 250, 252, 0.5)' }}>
                          <Icon name="file-pdf-box" size={32} color="#EF4444" />
                          <Text
                            style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', marginTop: 8, paddingHorizontal: 4, textAlign: 'center' }}
                            numberOfLines={1}
                          >
                            {file.name || 'PDF'}
                          </Text>
                        </View>
                      ) : (
                        <>
                          <Image
                            source={{ uri: file.uri }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                            onLoadStart={() =>
                              setThumbLoadingMap((prev) => ({ ...prev, [thumbKey]: true }))
                            }
                            onLoadEnd={() =>
                              setThumbLoadingMap((prev) => ({ ...prev, [thumbKey]: false }))
                            }
                            onError={() =>
                              setThumbLoadingMap((prev) => ({ ...prev, [thumbKey]: false }))
                            }
                          />
                          {isLoading && (
                            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
                              <ActivityIndicator size="small" color="#00B8D9" />
                            </View>
                          )}
                        </>
                      )}
                    </Pressable>

                    {/* Page label */}
                    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', paddingVertical: 4 }}>
                      <Text style={{ color: 'white', fontSize: 6, fontWeight: '900', textAlign: 'center' }}>
                        Page {i + 1}
                      </Text>
                    </View>

                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    );
  };

  const isDateScheduled = isAppointmentSet && jobState.scheduleTime?.date !== 'TBD';

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <View style={{ paddingHorizontal: 20, paddingVertical: 20, paddingBottom: 96, backgroundColor: 'white' }}>
        <View style={{ marginBottom: 24, marginLeft: 4 }}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: '#0f172a', marginBottom: 4 }}>Job Builder Summary</Text>
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#94a3b8' }}>
            Review all configured job details before completing the job.
          </Text>
        </View>

        {/* Summary Sections */}
        {summarySections.map(renderSection)}

        {/* Appointment Status Card */}
        {outcomeForm?.result?.toLowerCase() !== 'demo' && (
          !isAppointmentSet ? (
            /* ── NOT SCHEDULED ─────────────────────────────────────── */
            <View
              style={{ marginBottom: 24, borderRadius: 16, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2', padding: 20 }}
            >
              {/* Title row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a', marginRight: 12 }}>
                  Schedule Appointment
                </Text>
                <View style={{ backgroundColor: '#ef4444', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                  <Text style={{ color: 'white', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 }}>Required</Text>
                </View>
              </View>

              {/* Description */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#ef4444', marginBottom: 20 }}>
                Appointment scheduling is required to complete the job
              </Text>

              {/* CTA button */}
              <Pressable
                onPress={() => setSchedulerOpen(true)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#10b981', height: 56, borderRadius: 12 }}
              >
                <Icon name="calendar-clock" size={22} color="white" />
                <Text style={{ color: 'white', fontWeight: '900', fontSize: 14, marginLeft: 12 }}>Schedule Appointment</Text>
              </Pressable>
            </View>
          ) : (
            /* ── SCHEDULED ──────────────────────────────────────────── */
            <View style={{ marginBottom: 24, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9', backgroundColor: 'white', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}>
              {/* Green header */}
              <View style={{ backgroundColor: '#10b981', paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: 'white', fontWeight: '900', fontSize: 14 }}>Scheduled Appointment</Text>
                <Pressable onPress={() => setSchedulerOpen(true)} hitSlop={10}>
                  <Icon name="pencil" size={20} color="white" />
                </Pressable>
              </View>

              {/* Body rows */}
              <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
                {/* Customer */}
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8', marginBottom: 4 }}>Customer</Text>
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#0f172a', marginBottom: 16 }}>
                  {jobState.scheduleTime?.customerName || customerName || 'N/A'}
                </Text>
                <View style={{ height: 1, backgroundColor: '#f1f5f9', marginBottom: 16 }} />

                {/* Date */}
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8', marginBottom: 4 }}>Date</Text>
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#0f172a', marginBottom: 16 }}>
                  {jobState.scheduleTime?.date === 'TBD'
                    ? 'TBD'
                    : jobState.scheduleTime?.date || 'N/A'}
                </Text>
                <View style={{ height: 1, backgroundColor: '#f1f5f9', marginBottom: 16 }} />

                {/* Time Window */}
                {jobState.scheduleTime?.timeWindow ? (
                  <>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8', marginBottom: 4 }}>Time Window</Text>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: '#0f172a', marginBottom: 16 }}>
                      {jobState.scheduleTime.timeWindow}
                    </Text>
                  </>
                ) : null}

                {/* TBD Reason */}
                {jobState.scheduleTime?.reason ? (
                  <>
                    <View style={{ height: 1, backgroundColor: '#f1f5f9', marginBottom: 16 }} />
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8', marginBottom: 4 }}>TBD Reason</Text>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#334155', marginBottom: 16 }}>
                      {jobState.scheduleTime.reason}
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
          )
        )}

        {/* Documents Section */}
        {outcomeForm?.result?.toLowerCase() !== 'demo' && renderDocThumbnails('Agreements', jobState.agreements || [], 'agreement')}
        {renderDocThumbnails('Order Sheets', jobState.orderSheets || [], 'orderSheet')}
      </View>

      <AppointmentSchedulerModal
        visible={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        onConfirm={(data) => onUpdate?.('scheduleTime', '', data)}
        onGenerate={(data) => {
          onUpdate?.('scheduleTime', '', data);
          setTimeout(() => handleGenerateAgreement(data), 500);
        }}
        onUpload={(data) => {
          onUpdate?.('scheduleTime', '', data);
          setTimeout(() => {
            setScannerType('agreement');
            setScannerOpen(true);
          }, 500);
        }}
        customerName={
          `${leadData?.customerDetails?.firstName || ''} ${
            leadData?.customerDetails?.lastName || ''
          }`.trim() || customerName || 'Customer'
        }
        isEdit={stableIsEdit}
        initialDate={jobState.scheduleTime?.date}
        initialTimeWindow={jobState.scheduleTime?.timeWindow}
      />

      <DocumentScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title={scannerType === 'agreement' ? 'Scan Agreement' : 'Scan Order Sheet'}
        leadId={leadId || ''}
        category={scannerType === 'agreement' ? 'agreement' : 'orderSheet'}
        initialFiles={
          resolvedDocuments[scannerType === 'agreement' ? 'agreements' : 'orderSheets'] || []
        }
        onChange={(files) => {
          const field = scannerType === 'agreement' ? 'agreements' : 'orderSheets';
          // Update local state with draft images
          onUpdate?.('', field, files.length > 0 ? [{ files }] : []);
        }}
        onSave={async (pages) => {
          const scannerCategory = scannerType === 'agreement' ? 'agreement' : 'orderSheet';
          const stateField = scannerCategory === 'agreement' ? 'agreements' : 'orderSheets';

          if (!leadId) {
            Alert.alert('Error', 'No lead ID found. Cannot upload document.');
            return;
          }

          try {
            setIsGenerating(true);
            if (isDocUploadingRef) isDocUploadingRef.current = true;

            const filePayloads: any[] = [];
            for (let i = 0; i < pages.length; i++) {
              const p = pages[i];
              if (p.isNew) {
                const base64 = await RNFS.readFile(p.uri, 'base64');
                filePayloads.push({
                  file: `data:image/jpeg;base64,${base64}`,
                  name: p.name || `scanned_${scannerCategory}_${Date.now()}_${i}.jpg`,
                  documentType: scannerCategory,
                  isNew: true,
                });
              } else {
                // Keep existing server file info
                filePayloads.push({
                  _id: p.serverId,
                  name: p.name,
                  documentType: scannerCategory,
                  isNew: false,
                });
              }
            }

            const outcomePayload: any = {
              ...outcomeForm,
              result: 'Sale',
              status: 'Sale',
              jobBuilder: {
                ...jobState,
                // Only send NEW files to avoid "file is required" error for existing ones.
                // Existing files are already on the server and deletions were handled individually in the scanner.
                [stateField]: filePayloads.filter((p: any) => p.isNew),
              },
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

            await LeadService.updateLeadOutcome(leadId, outcomePayload);
            await fetchOutcome();
            onUpdate?.('', stateField, []);
            setScannerOpen(false);
          } catch (error: any) {
            console.error('[Summary] Outcome document upload failed:', error);
            Alert.alert('Error', error?.message || 'Could not update documents.');
          } finally {
            setIsGenerating(false);
            if (isDocUploadingRef) isDocUploadingRef.current = false;
          }
        }}
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
            // Refresh outcome to pull S3 version once processed
            fetchOutcome();
          }}
        />
      )}

      <Modal transparent visible={isGenerating} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: 'white', padding: 32, borderRadius: 32, alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#00B8D9" />
            <Text style={{ marginTop: 16, color: '#0f172a', fontWeight: '900', fontSize: 14 }}>Generating Document</Text>
            <Text style={{ marginTop: 4, color: '#94a3b8', fontSize: 8, fontWeight: '700', letterSpacing: 2 }}>
              Preparing your agreement
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!previewImage}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)', alignItems: 'center', justifyContent: 'center' }}>
          <SafeAreaView style={{ width: '100%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 }}>
              <Text style={{ color: 'white', fontWeight: '900', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' }}>
                {previewImage?.name || 'Image Preview'}
              </Text>
              <Pressable
                onPress={() => setPreviewImage(null)}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255, 255, 255, 0.1)', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="close" size={24} color="white" />
              </Pressable>
            </View>
          </SafeAreaView>

          <View style={{ flex: 1, width: '100%', padding: 16 }}>
            {previewImage && (
              <Image
                source={{ uri: previewImage.uri }}
                style={{ width: '100%', height: '100%', borderRadius: 16 }}
                resizeMode="contain"
              />
            )}
          </View>

          <SafeAreaView style={{ width: '100%' }}>
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: 8, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>
                Pinch to zoom (System Preview coming soon)
              </Text>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
      <PdfPreviewModal
        visible={pdfPreview.visible}
        uri={pdfPreview.uri}
        title={pdfPreview.title}
        onClose={() => setPdfPreview({ visible: false, uri: '', title: '' })}
      />
    </ScrollView>
  );
};
