import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  PermissionsAndroid,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { launchCamera } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  useSubmitJobBuilderMutation,
  useResetLeadMutation,
  useUploadImagesMutation,
  useDeleteImageMutation,
  useUpdateLeadImagePositionMutation,
} from '../../../hooks/useLeadMutation';
import { ResultLeadModal } from '../../modals/lead-center/ResultLeadModal';
import { CustomCameraModal } from '../../modals/CustomCameraModal';
import { IMAGE_CATEGORIES } from '../../../constants/lead-center';
import Geolocation from 'react-native-geolocation-service';
import { LeadService, resolveLeadCalculatorId } from '../../../services/api/leads';
import { useNavigation } from '@react-navigation/native';
import { EditContractDetailsModal } from '../../modals/lead-center/EditContractDetailsModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DocumentScannerModal } from '../../modals/job-builder/DocumentScannerModal';
import RNFS from 'react-native-fs';
import { convertJpegToPdf as sharedConvertJpegToPdf } from '../../../utils/jpeg-to-pdf';
import { useAuth } from '../../../hooks/useAuth';
import SocketManager from '../../../services/SocketManager';
import { logEvent } from '../../../services/api/LoggerService';
import { getLocalCachePath, getWarmedLocalUri } from '../../../utils/imageFileCache';
import {
  downloadResultMessage,
  offlineDownloadNotice,
} from '../../../utils/photo-download-plan';

const getNativeModules = () => {
  try {
    const cameraRollModule = require('@react-native-camera-roll/camera-roll');
    return {
      ReactNativeBlobUtil: require('react-native-blob-util').default,
      CameraRoll: cameraRollModule.CameraRoll,
      iosReadGalleryPermission: cameraRollModule.iosReadGalleryPermission,
      iosRequestAddOnlyGalleryPermission: cameraRollModule.iosRequestAddOnlyGalleryPermission,
    };
  } catch {
    return {
      ReactNativeBlobUtil: null,
      CameraRoll: null,
      iosReadGalleryPermission: null,
      iosRequestAddOnlyGalleryPermission: null,
    };
  }
};

import { ContractDetailsCard } from './ContractDetailsCard';
import { AddendumsCard } from './AddendumsCard';
import { LeadApprovalsCard } from './LeadApprovalsCard';
import { isLeadResulted } from '../../../utils/lead-result-status';
import { useLeadApprovals } from '../../../hooks/useLeadApprovals';
import { useLeadFunding } from '../../../hooks/useLeadFunding';
import { buildContractRefundSummary, contractFromSaleParts } from '../../../utils/contract-refund-summary';
import { AddendumRecipientCard } from './AddendumRecipientCard';
import {
  DocumentRef,
  collectDocumentIds,
  pickNewDocuments,
  readDocumentGroup,
  toDocumentRefs,
} from '../../../utils/uploaded-document-refs';
import { TagPhotoModal } from './TagPhotoModal';
import { ManagePhotosModal } from './ManagePhotosModal';
import { DynamicManagePhotosView } from '../lead-center/DynamicManagePhotosView';
import { DynamicInspectionView } from '../lead-center/DynamicInspectionView';
import { useInspectionSchema } from '../../../hooks/useInspectionSchema';
import { useIsOnline } from '../../../hooks/useIsOnline';
import { completeOfflineJobBuilder, ensureOfflineWorkForLead } from '../../../services/offlineLeadStore';
import { FlashMessage } from '../../../config/message';
import {
  indexSchema,
  getCapturableSlots,
  norm,
} from '../lead-center/dynamic-inspection-schema-utils';
import { ImageSlideshowModal } from './ImageSlideshowModal';
import { uploadQueueManager, UploadQueueItem } from '../../../utils/uploadQueue';
import { offlinePhotoDeleteQueue } from '../../../services/offlinePhotoDeleteQueue';
import { getCaptureCoords } from '../../../utils/capture-location';
import { resolveS3Url } from '../../../utils/s3-utils';
import { countLeadPhotos, PHOTO_COUNT_HINT } from '../../../utils/lead-photo-counts';

interface SectionImage {
  uri: string;
  index: number;
  s3url?: string;
  id?: string;
  subcategory?: string;
  isOptimistic?: boolean;
}

interface JobDocsSectionProps {
  lead: any;
  sectionImages: { [key: string]: SectionImage[] };
  onSectionImagesChange: (
    images: { [key: string]: SectionImage[] } | ((prev: { [key: string]: SectionImage[] }) => { [key: string]: SectionImage[] })
  ) => void;
  refetch: () => Promise<void>;
  onOpenPdf?: (url: string, title?: string) => void;
  secureUrls?: Record<string, string>;
  isRefreshing?: boolean;
  drafts?: any[];
  draftsReady?: boolean;
  onDraftsChanged?: () => void;
  onEditContract?: () => void;
}

const MANAGE_TABS = [
  { id: 'HOME', label: 'HOME', icon: 'home-outline' },
  { id: 'INSPECTION', label: 'INSPECTION', icon: 'magnify' },
  { id: 'MEASURE', label: 'MEASURE', icon: 'ruler' },
  { id: 'ROOFLINE', label: 'ROOFLINE', icon: 'home-roof' },
  { id: 'MISC', label: 'MISC', icon: 'dots-horizontal' },
];

const getCategoryIdsForTab = (tabId: string): string[] => {
  switch (tabId) {
    case 'HOME':
      return ['home'];
    case 'INSPECTION':
      return ['inspection'];
    case 'MEASURE':
      return ['measurements'];
    case 'ROOFLINE':
      return ['roofline-observation', 'roof-inspection'];
    case 'MISC':
      return ['miscellaneous'];
    default:
      return [];
  }
};

export const JobDocsSection = ({
  lead,
  sectionImages,
  onSectionImagesChange,
  refetch,
  onOpenPdf,
  secureUrls: _secureUrls = {},
  isRefreshing = false,
  onEditContract,
  drafts = [],
  draftsReady = true,
  onDraftsChanged,
}: JobDocsSectionProps) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const leadApprovals = useLeadApprovals(lead?._id, isLeadResulted(lead), lead?.companyId);
  const leadFunding = useLeadFunding(
    lead?._id,
    isLeadResulted(lead) && leadApprovals.approvals.length > 0,
    lead?.companyId
  );
  const refundSummary = React.useMemo(
    () =>
      buildContractRefundSummary({
        payments: leadFunding.payments,
        currentContractPrice:
          Number(
            String(lead?.originalContractPrice ?? lead?.leadData?.originalContractPrice ?? 0).replace(/[^0-9.-]/g, '')
          ) || 0,
        fundingContractPrice: leadFunding.contractPrice,
        saleTotal: contractFromSaleParts(
          lead?.downPayment ?? lead?.leadData?.downPayment,
          lead?.balance ?? lead?.leadData?.balance
        ),
      }),
    [leadFunding.payments, leadFunding.contractPrice, lead]
  );

  const submitJobMutation = useSubmitJobBuilderMutation();
  const resetLeadMutation = useResetLeadMutation();
  const uploadImagesMutation = useUploadImagesMutation();
  const deleteImageMutation = useDeleteImageMutation();
  const updateImagePositionMutation = useUpdateLeadImagePositionMutation();




  const [showResultModal, setShowResultModal] = useState(false);
  const [pendingResult, setPendingResult] = useState<string>('noDemo');

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerType, setScannerType] = useState<'agreement' | 'orderSheet' | 'downPaymentReceipt'>('agreement');
  const [isGenerating, setIsGenerating] = useState(false);

  const [previewImages, setPreviewImages] = useState<{ uri: string; label: string }[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [, setUploadingSlots] = useState<{ [key: string]: boolean }>({});
  const outcomeData = lead;

  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>(() => uploadQueueManager.getQueue());
  const [deletedUrls, setDeletedUrls] = useState<Set<string>>(() =>
    offlinePhotoDeleteQueue.deletedUrls(lead?._id)
  );
  useEffect(() => {
    const sync = () => setDeletedUrls(offlinePhotoDeleteQueue.deletedUrls(lead?._id));
    sync();
    return offlinePhotoDeleteQueue.addListener(sync);
  }, [lead?._id]);

  const [taggingAsset, setTaggingAsset] = useState<any>(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showDynamicCapture, setShowDynamicCapture] = useState(false);
  const { configuredProducts, productsLoading, schemaResolved } = useInspectionSchema({ enabled: true });
  const isDynamicInspection = configuredProducts.length > 0;
  const isOnline = useIsOnline();

  const inspectionSchemaUnavailable = !schemaResolved && !isOnline;
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [activeTagTab, setActiveTagTab] = useState<string>('HOME');
  const [activeManageTab, setActiveManageTab] = useState<string>('HOME');
  const [isContinuousCamera, setIsContinuousCamera] = useState<boolean>(false);
  const [customCameraVisible, setCustomCameraVisible] = useState<boolean>(false);
  const [movingImage, setMovingImage] = useState<{ image: SectionImage; categoryName: string } | null>(null);
  const [conflict, setConflict] = useState<any | null>(null);

  const pendingUploadRef = useRef<Promise<any> | null>(null);

  useEffect(() => {
    const unsubscribe = uploadQueueManager.addListener(() => {
      const currentQueue = uploadQueueManager.getQueue();
      setQueueItems([...currentQueue]);
      refetch();
    });

    if (uploadQueueManager.getQueue().length > 0) {
      console.log('[JobDocsSection] Resuming', uploadQueueManager.getQueue().length, 'pending uploads from MMKV queue.');
      uploadQueueManager.processQueue();
    }

    return () => unsubscribe();
  }, []);

  const waitForPendingUpload = useCallback(async () => {
    if (pendingUploadRef.current) {
      try {
        await pendingUploadRef.current;
      } catch (err) {
        console.warn('Error waiting for pending upload:', err);
      }
    }
  }, []);

  const [isAnnotationSelectMode, setIsAnnotationSelectMode] = useState<boolean>(false);
  const [selectedAnnotationPhotos, setSelectedAnnotationPhotos] = useState<SectionImage[]>([]);

  const [resolvedDocuments, setResolvedDocuments] = useState<{ agreements: any[]; orderSheets: any[]; downPaymentReceipts: any[] }>({
    agreements: [],
    orderSheets: [],
    downPaymentReceipts: [],
  });
  const [expandedDocs, setExpandedDocs] = useState<{ agreements: boolean; orderSheets: boolean; downPaymentReceipts: boolean }>({
    agreements: true,
    orderSheets: true,
    downPaymentReceipts: true,
  });
  const [leadDraft, setLeadDraft] = useState<any>(null);

  const pendingReceiptLogRef = useRef<{ knownIds: Set<string>; added: number } | null>(null);

  const logDownPaymentReceiptUpload = useCallback(
    (refs: DocumentRef[], added: number) => {
      const userId = user?._id || user?.id;
      if (!userId || !lead?._id) return;
      logEvent('upload', {
        user_id: userId,
        created_by: userId,
        module_type: 'job_builder',
        meta: {
          leadId: lead._id,
          action: 'upload_down_payment_receipts',
          downPaymentReceipt: added,
          documents: refs,
        },
      });
    },
    [user, lead?._id]
  );

  useEffect(() => {
    const pending = pendingReceiptLogRef.current;
    if (!pending) return;
    const fresh = pickNewDocuments(
      pending.knownIds,
      readDocumentGroup(lead, 'downPaymentReceipt')
    );
    if (!fresh.length) return;
    pendingReceiptLogRef.current = null;
    logDownPaymentReceiptUpload(toDocumentRefs(fresh), pending.added);
  }, [lead, logDownPaymentReceiptUpload]);

  const getSubcategoryLabel = useCallback((catNameOrId: string, subIdOrName: string) => {
    if (!subIdOrName) return '';
    const category = IMAGE_CATEGORIES.find(
      (c) => c.id === catNameOrId || c.name === catNameOrId
    );
    if (!category) return subIdOrName;

    let cleanSubIdOrName = subIdOrName;
    if (subIdOrName.includes(' - Extra')) {
      cleanSubIdOrName = subIdOrName.split(' - Extra')[0];
    }

    const sub = category.subCategories?.find(
      (s) => s.id === cleanSubIdOrName || s.name === cleanSubIdOrName
    );
    if (sub) return sub.name;
    const group = category.cardGroups?.find(g => g.name === cleanSubIdOrName || g.id === cleanSubIdOrName);
    if (group) return group.name;

    return subIdOrName;
  }, []);

  const getImagesForSection = useCallback((sectionOrNameOrId: any): SectionImage[] => {
    if (!sectionOrNameOrId) return [];
    let searchStr = '';
    if (typeof sectionOrNameOrId === 'object') {
      searchStr = sectionOrNameOrId.name || '';
    } else {
      searchStr = sectionOrNameOrId;
    }

    if (!searchStr) return [];

    let s3Images: SectionImage[] = [];
    if (sectionImages[searchStr]) {
      s3Images = sectionImages[searchStr];
    } else {
      const matchingKey = Object.keys(sectionImages).find(
        (k) => k.toLowerCase() === searchStr.toLowerCase()
      );
      if (matchingKey) {
        s3Images = sectionImages[matchingKey];
      } else if (typeof sectionOrNameOrId === 'object' && sectionOrNameOrId.id) {
        const matchingKeyId = Object.keys(sectionImages).find(
          (k) => k.toLowerCase() === sectionOrNameOrId.id.toLowerCase()
        );
        if (matchingKeyId) s3Images = sectionImages[matchingKeyId];
      }
    }

    const pendingForSection = queueItems
      .filter((item) =>
        item.leadId === lead?._id &&
        item.categoryName.toLowerCase() === searchStr.toLowerCase()
      )
      .map((item, i): SectionImage => ({
        uri: item.uri,
        index: s3Images.length + i,
        subcategory: item.subcategory,
        isOptimistic: true,
      }));

    const serverCountBySub = new Map<string, number>();
    s3Images.forEach((img) => {
      const k = (img.subcategory || '').toLowerCase();
      serverCountBySub.set(k, (serverCountBySub.get(k) || 0) + 1);
    });
    const uniquePending = pendingForSection.filter((p) => {
      const k = (p.subcategory || '').toLowerCase();
      const remaining = serverCountBySub.get(k) || 0;
      if (remaining > 0) {
        serverCountBySub.set(k, remaining - 1); // this pending item is already on the server
        return false;
      }
      return true;
    });

    return [...s3Images, ...uniquePending];
  }, [sectionImages, queueItems, lead?._id]);

  const handleDelete = async (categoryName: string, image: SectionImage) => {
    if (!image.s3url) {
      const filtered = (sectionImages[categoryName] || []).filter((img) => img.uri !== image.uri);
      onSectionImagesChange({ ...sectionImages, [categoryName]: filtered });
      return;
    }

    try {
      const payload = {
        s3urls: [image.s3url],
        category: 'salesPhotos',
      };
      await deleteImageMutation.mutateAsync({ leadId: lead._id, payload });
      const filtered = (sectionImages[categoryName] || []).filter((img) => img.s3url !== image.s3url);
      onSectionImagesChange({ ...sectionImages, [categoryName]: filtered });
      refetch();
    } catch (error) {
      console.error('Delete error', error);
      Alert.alert('Delete Failed', 'Could not delete the photo. Please try again.');
    }
  };

  const handleUpload = async (categoryName: string, idx: number, asset: any, groupName?: string) => {
    if (!asset || !lead?._id) return;

    const slotKey = `${categoryName}-${groupName || ''}-${idx}`;
    setUploadingSlots((prev) => ({ ...prev, [slotKey]: true }));

    const categoryObj = IMAGE_CATEGORIES.find((cat) => cat.name === categoryName);
    const baseSubcatCount = categoryObj?.subCategories?.length ?? 0;
    const existingExtraCount = getImagesForSection(categoryName).filter(
      (img) => img.subcategory?.includes(`${categoryName} - Extra`)
    ).length;
    const nextExtraIndex = baseSubcatCount + existingExtraCount + 1;
    const subcategory = groupName
      ? groupName
      : categoryObj?.subCategories?.[idx]?.name || `${categoryName} - Extra ${nextExtraIndex}`;

    const tempPhoto: SectionImage = {
      uri: asset.uri,
      index: idx,
      subcategory,
      isOptimistic: true,
    };

    onSectionImagesChange((prev: Record<string, SectionImage[]>) => {
      const prevList = prev[categoryName] || [];
      if (prevList.some((img) => img.uri === asset.uri)) return prev;
      return {
        ...prev,
        [categoryName]: [...prevList, tempPhoto],
      };
    });

    void getCaptureCoords().then((coords) => {
      uploadQueueManager.addToQueue({
        leadId: lead._id,
        categoryName,
        subcategory,
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || `photo_${Date.now()}.jpg`,
        userId: user?._id || user?.id,
        ...(coords ? { coordinates: coords } : null),
      });
    });

    setUploadingSlots((prev) => ({ ...prev, [slotKey]: false }));
  };

  const handleReset = async () => {
    Alert.alert('Reset Job Docs', 'Are you sure you want to reset all job documents? This will permanently delete all uploaded images and documents.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          try {
            await resetLeadMutation.mutateAsync(lead._id);
            refetch();
          } catch (e) {
            console.error('Failed to reset lead job docs', e);
          }
        },
      },
    ]);
  };

  const handleQuickReset = () => {
    Alert.alert(
      'Reset Lead',
      'Are you sure you want to reset this lead? This will clear current work state.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              if (lead?._id) {
                await resetLeadMutation.mutateAsync(lead._id);
                onSectionImagesChange({});
                await refetch();
              }
            } catch (error) {
              console.error('Reset failed', error);
            }
          },
        },
      ]
    );
  };

  const handleMovePhoto = async (
    targetCatName: string,
    targetIdx: number,
    targetGroupName?: string
  ) => {
    if (!movingImage || !lead?._id) return;

    const targetCategoryObj = IMAGE_CATEGORIES.find((cat) => cat.name === targetCatName);
    const targetBaseSubcatCount = targetCategoryObj?.subCategories?.length ?? 0;
    const targetExtraCount = getImagesForSection(targetCatName).filter(
      (img) => img.subcategory?.includes(`${targetCatName} - Extra`)
    ).length;
    const targetNextExtraIndex = targetBaseSubcatCount + targetExtraCount + 1;
    const subcategory = targetGroupName
      ? targetGroupName
      : targetCategoryObj?.subCategories?.[targetIdx]?.name || `${targetCatName} - Extra ${targetNextExtraIndex}`;

    const payload = {
      photoId: movingImage.image.id,
      currentPosition: {
        category: movingImage.categoryName,
        subcategory: movingImage.image.subcategory || '',
      },
      newPosition: {
        category: targetCatName,
        subcategory,
      },
    };

    const currentCategory = movingImage.categoryName;
    const currentImgs = sectionImages[currentCategory] || [];
    const photoToMove = currentImgs.find(
      (img) => img.id === movingImage.image.id || img.uri === movingImage.image.uri
    );

    if (photoToMove) {
      const updatedPhoto = {
        ...photoToMove,
        subcategory,
        index: targetIdx,
      };

      const nextCurrentList = currentImgs.filter(
        (img) => img.id !== photoToMove.id && img.uri !== photoToMove.uri
      );
      const targetImgs = currentCategory === targetCatName ? nextCurrentList : (sectionImages[targetCatName] || []);
      const nextTargetList = [...targetImgs, updatedPhoto];

      onSectionImagesChange({
        ...sectionImages,
        [currentCategory]: nextCurrentList,
        [targetCatName]: nextTargetList,
      });
    }

    await waitForPendingUpload();
    try {
      await updateImagePositionMutation.mutateAsync({ leadId: lead._id, payload });
      await refetch();
    } catch (e) {
      console.error('Move photo failed', e);
    } finally {
      setMovingImage(null);
    }
  };

  const handleUpdateContract = async (updatedOutcome: any) => {
    try {
      const calcId = resolveLeadCalculatorId(lead);
      if (!calcId) {
        console.warn('[JobDocsSection] no calculator on the lead — contract update skipped');
        return;
      }
      await LeadService.updateLeadOutcomeByCalculator(lead._id, calcId, updatedOutcome);
      await refetch();
    } catch (e) {
      console.error('Update contract details failed', e);
    }
  };

  const handleAddDocument = (type: 'agreement' | 'orderSheet' | 'downPaymentReceipt') => {
    setScannerType(type);
    setScannerOpen(true);
  };

  const convertJpegToPdf = (jpegBase64: string, width = 595, height = 842): string =>
    sharedConvertJpegToPdf(jpegBase64, width, height);

  const handleSaveScannedDocument = async (pages: any[]) => {
    const scannerCategory = scannerType;
    const stateField =
      scannerCategory === 'agreement' ? 'agreements'
      : scannerCategory === 'orderSheet' ? 'orderSheets'
      : 'downPaymentReceipt';
    const leadId = lead?._id;

    if (!leadId) {
      Alert.alert('Error', 'No lead ID found. Cannot upload document.');
      return;
    }

    const newPages = pages.filter((p) => p.isNew === true);

    if (newPages.length === 0) {
      setScannerOpen(false);
      return;
    }

    try {
      setIsGenerating(true);

      let preFetchedAppendedDocs: any[] = [];
      try {
        const response = await LeadService.downloadOutcomeDocuments(leadId);
        const dataObj = response.data?.data || response.data || {};
        preFetchedAppendedDocs = [
          ...(dataObj.agreements || []),
          ...(dataObj.orderSheets || []),
          ...(dataObj.downPaymentReceipt || [])
        ];
      } catch (err) {
        console.warn('[JobDocsSection] Failed to pre-fetch outcome documents', err);
      }

      const filePayloads: any[] = [];
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const docNum = i + 1;
        const cleanCategoryName = scannerCategory === 'agreement' ? 'Agreement' : scannerCategory === 'orderSheet' ? 'Order_Sheet' : 'Down_Payment_Receipt';
        const defaultName = `${cleanCategoryName}_${docNum}.pdf`;
        const documentName = p.name ? p.name.replace(/\.[a-z]+$/i, '.pdf') : defaultName;

        if (p.isNew) {
          const rawBase64 = await RNFS.readFile(p.uri, 'base64');
          const pdfBase64 = p.uri.endsWith('.pdf') ? rawBase64 : convertJpegToPdf(rawBase64);
          filePayloads.push({
            name: documentName,
            file: `data:application/pdf;base64,${pdfBase64}`,
            type: scannerCategory,
          });
        } else {
          const docId = p.serverId || p.id || p._id;
          const serverDoc = preFetchedAppendedDocs.find(
            (d) => String(d._id) === String(docId)
          );
          if (serverDoc && serverDoc.base64Data) {
            const cType = serverDoc.fileData?.contentType || 'application/pdf';
            const base64Prefix = serverDoc.base64Data.startsWith('data:')
              ? serverDoc.base64Data
              : `data:${cType};base64,${serverDoc.base64Data}`;

            filePayloads.push({
              name: documentName,
              file: base64Prefix,
              type: scannerCategory,
            });
          }
        }
      }

      const payload = {
        leadData: {},
        jobState: {},
        [stateField]: filePayloads,
      };

      const knownReceiptIds =
        scannerCategory === 'downPaymentReceipt'
          ? collectDocumentIds(readDocumentGroup(lead, 'downPaymentReceipt'))
          : null;

      const submitRes = await LeadService.submitJobBuilder(leadId, payload);

      if (knownReceiptIds) {
        const fromResponse = pickNewDocuments(
          knownReceiptIds,
          readDocumentGroup(submitRes, 'downPaymentReceipt')
        );
        const refs = toDocumentRefs(fromResponse);
        if (refs.length) {
          logDownPaymentReceiptUpload(refs, newPages.length);
        } else {
          pendingReceiptLogRef.current = { knownIds: knownReceiptIds, added: newPages.length };
        }
      }

      setScannerOpen(false);
      await refetch();
      setTimeout(() => refetch(), 1000);
      setTimeout(() => refetch(), 3000);
    } catch (error: any) {
      console.error('[JobDocsSection] Document upload failed:', error);
      Alert.alert('Error', error?.message || 'Could not upload documents.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleResultSubmit = async (resultData: any) => {
    try {
      const { result } = resultData;
      const leadData = {
        ...resultData,
        status: result === 'noDemo' ? 'noDemo' : result === 'notHit' ? 'notHit' : result,
      };
      const payload = { leadData, jobState: {} };

      /**
       * ⚠️ Logged BEFORE the online/offline branch so both paths record the same thing.
       * It sat after the `mutateAsync` instead, so the offline branch returned past it and a
       * result taken at a door left no Forever Record entry at all - the same shape as ticket
       * 1310, where a missing log made a rep look as though they had skipped a step.
       *
       * `logEvent` holds it itself when offline (`lead_result_field_entry` is queueable) and
       * stamps `occurredAt` now, so the replay lands at the moment the rep acted.
       */
      const userId = user?._id || user?.id;
      if (userId) {
        logEvent('submit', {
          user_id: userId,
          created_by: userId,
          module_type: 'lead_result_field_entry',
          meta: {
            leadId: lead?._id,
            result: leadData.result,
            reason: leadData.reason,
            action: 'submit_lead_result_form',
          },
        });
      }

      /**
       * ⚠️ No Demo / Not Hit / Reset must work at a door with no signal. They are ordinary
       * lead results on the SAME endpoint the queue's `submit` step already calls
       * (`submitJobBuilder`), so queueing them needs no new arm - only this branch.
       *
       * Without it `mutateAsync` threw, the catch below closed the modal and logged to the
       * console, and the rep saw nothing happen at all: no error, no change, no record.
       *
       * ⚠️ This is NOT the destructive "Reset Job Docs" (`resetLeadMutation`), which deletes
       * uploaded documents server-side. That one stays online-only on purpose - a queued replay
       * could land after work the rep did later and destroy it.
       */
      if (!isOnline) {
        const work = ensureOfflineWorkForLead(lead);
        if (!work) {
          FlashMessage.error(
            'Could not save',
            "This lead has no offline record yet, so the result can't be held. Try again once you have a connection."
          );
          setShowResultModal(false);
          return;
        }
        completeOfflineJobBuilder(work.clientId, payload as any);
        FlashMessage.success(
          'Result saved',
          'It uploads on its own as soon as you have a connection.'
        );
        setShowResultModal(false);
        return;
      }

      await submitJobMutation.mutateAsync({
        leadId: lead?._id,
        payload,
      });

      setShowResultModal(false);
      await refetch();
    } catch (error) {
      setShowResultModal(false);
      console.error('Submit result failed', error);
    }
  };



  const hasAndroidPermission = async () => {
    const version = Number(Platform.Version);
    if (version >= 33) return true;
    return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
  };

  const handleDownloadAllImages = async () => {
    const modules = getNativeModules();
    const ReactNativeBlobUtil = modules.ReactNativeBlobUtil;
    const CameraRoll = modules.CameraRoll;

    if (!ReactNativeBlobUtil || !CameraRoll) {
      Alert.alert('Error', 'Native modules not found');
      return;
    }

    let permissionRequested = false;

    if (Platform.OS === 'android' && !(await hasAndroidPermission())) {
      permissionRequested = true;
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Permission Denied', 'Storage permission is required to save photos.');
        return;
      }
    }

    if (Platform.OS === 'ios') {
      const iosReadGalleryPermission = modules.iosReadGalleryPermission;
      const iosRequestAddOnlyGalleryPermission = modules.iosRequestAddOnlyGalleryPermission;
      if (iosReadGalleryPermission && iosRequestAddOnlyGalleryPermission) {
        try {
          const status = await iosReadGalleryPermission('addOnly');
          if (status !== 'granted' && status !== 'limited') {
            permissionRequested = true;
            const requestStatus = await iosRequestAddOnlyGalleryPermission();
            if (requestStatus !== 'granted' && requestStatus !== 'limited') {
              Alert.alert('Permission Denied', 'Photo Library permission is required to save photos.');
              return;
            }
          }
        } catch (error) {
          console.error('Failed to check/request iOS photo library permission:', error);
        }
      }
    }

    if (permissionRequested) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    const imagesToDownload: SectionImage[] = [];
    const seenDownloadUris = new Set<string>();
    Object.values(sectionImages || {}).forEach((imgs) => {
      (Array.isArray(imgs) ? imgs : []).forEach((img) => {
        const uri = img?.uri || (img as any)?.s3url;
        if (uri && !seenDownloadUris.has(uri)) {
          seenDownloadUris.add(uri);
          imagesToDownload.push(img);
        }
      });
    });

    if (imagesToDownload.length === 0) {
      Alert.alert('No Photos', 'There are no photos to download.');
      setIsDownloading(false);
      setShowDownloadModal(false);
      return;
    }

    /**
     * Resolve a photo to a file already on this device.
     *
     * ⚠️ Two lookups, not one. `getWarmedLocalUri` is the in-memory map and only knows what
     * THIS app session warmed; after a relaunch it is empty while the files are still there.
     * `getLocalCachePath` + `fs.exists` is the authoritative check, and it is what makes the
     * feature survive the rep closing the app. The path deliberately ignores the S3 query
     * string, so a re-signed URL still finds yesterday's file.
     */
    const resolveOnDevice = async (uri: string): Promise<string | null> => {
      if (uri.startsWith('file://') || uri.startsWith('/')) return uri;
      const warmed = getWarmedLocalUri(uri);
      if (warmed) return warmed;
      const path = getLocalCachePath(uri);
      if (!path) return null;
      try {
        return (await ReactNativeBlobUtil.fs.exists(path)) ? `file://${path}` : null;
      } catch {
        return null;
      }
    };

    // The component's own reactive flag (line ~227); no second source of truth here.
    const online = isOnline;

    // Resolve every photo against the device cache BEFORE deciding anything. Offline, this is
    // the whole feature: the bytes are already here and only needed looking up.
    const resolved = await Promise.all(
      imagesToDownload.map(async (img) => ({ img, local: await resolveOnDevice(img.uri) }))
    );

    const onDevice = resolved.filter((r) => r.local);
    const needsNetwork = resolved.filter((r) => !r.local);

    // Offline, anything not on the device is simply not happening - say so up front rather
    // than letting it fail one by one into a misleading "Failed to download photos".
    if (!online) {
      const notice = offlineDownloadNotice(onDevice.length, needsNetwork.length);
      if (notice.kind === 'blocked') {
        Alert.alert(notice.title, notice.message);
        setIsDownloading(false);
        setShowDownloadModal(false);
        return;
      }
      if (notice.kind === 'partial') Alert.alert(notice.title, notice.message);
    }

    const attempts = online ? resolved : resolved.filter((r) => r.local);
    const skippedOffline = resolved.length - attempts.length;

    const saveToCameraRollWithRetry = async (tag: string, type: 'photo' | 'video', retries = 2, delayMs = 1000) => {
      for (let i = 0; i <= retries; i++) {
        try {
          await CameraRoll.saveAsset(tag, { type });
          return true;
        } catch (err) {
          if (i === retries) throw err;
          console.log(`Save attempt ${i + 1} failed, retrying in ${delayMs}ms...`, err);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
      return false;
    };

    let completedCount = 0;
    let successCount = 0;

    const downloadAndSavePromises = attempts.map(async ({ img, local }, idx) => {
      try {
        // Already on the device - straight to the camera roll, no network at all.
        let localPath = local || '';

        if (!localPath) {
          const ext = 'jpg';
          const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/download_${Date.now()}_${idx}.${ext}`;
          const res = await ReactNativeBlobUtil.config({ path }).fetch('GET', img.uri);
          localPath = res.path();
        }

        if (localPath) {
          const saveTag = localPath.startsWith('file://') ? localPath : `file://${localPath}`;
          await saveToCameraRollWithRetry(saveTag, 'photo');
          successCount++;
        }
      } catch (err) {
        console.error('Failed to download image index:', idx, err);
      } finally {
        completedCount++;
        setDownloadProgress(completedCount);
      }
    });

    await Promise.all(downloadAndSavePromises);

    setIsDownloading(false);
    setShowDownloadModal(false);

    // Counts come from `downloadResultMessage` (it knows about `skippedOffline`, which the
    // offline filter above produces); delivery is the app's own banner, not a native Alert.
    // ⚠️ Raised after a beat: the download modal was only just dismissed and a banner shown
    // under a dismissing modal is never seen.
    const { title, message } = downloadResultMessage(
      successCount,
      attempts.length,
      skippedOffline
    );
    setTimeout(() => {
      if (successCount === 0) {
        FlashMessage.error(title, message);
      } else if (successCount === attempts.length && skippedOffline === 0) {
        FlashMessage.success(title, message);
      } else {
        FlashMessage.warning(title, message);
      }
    }, 450);
  };

  const onResultPress = (result: string) => {
    setPendingResult(result);
    setShowResultModal(true);
  };

  const handleStartTakingPhotos = () => {
    if (inspectionSchemaUnavailable) {
      Alert.alert(
        'Photo tagging needs to sync first',
        'Your photo categories have not been downloaded to this device yet. Connect once and reopen this lead — after that, taking photos works offline.'
      );
      return;
    }
    if (isDynamicInspection) {
      setShowDynamicCapture(true);
      return;
    }
    setIsContinuousCamera(true);
    reopenCameraContinuous();
  };

  const reopenCameraContinuous = async () => {
    setTaggingAsset(null);
    setShowTagModal(true);
  };

  const openLegacyTagModal = useCallback(
    (next: boolean) => {
      if (next && inspectionSchemaUnavailable) {
        Alert.alert(
          'Photo tagging needs to sync first',
          'Your photo categories have not been downloaded to this device yet. Connect once and reopen this lead — after that, taking photos works offline.'
        );
        return;
      }
      setShowTagModal(next);
    },
    [inspectionSchemaUnavailable]
  );

  const getRequiredSlotsForActiveTab = useCallback(() => {
    const catIds = getCategoryIdsForTab(activeManageTab);
    const slots: any[] = [];

    catIds.forEach((catId) => {
      const section = IMAGE_CATEGORIES.find((c) => c.id === catId);
      if (!section) return;

      const addSubs = (subs: any[] = [], groupName?: string) => {
        subs.forEach((sub, idx) => {
          const sectionImgs = getImagesForSection(section);
          const isInspection = catId === 'inspection' || catId === 'roof-inspection-plane';

          if (isInspection) {
            const matchingImages = sectionImgs.filter(
              (img) =>
                (img.subcategory === sub.name ||
                  img.subcategory === sub.id ||
                  img.subcategory?.startsWith(`${sub.name} - Extra`) ||
                  img.subcategory?.startsWith(`${sub.id} - Extra`)) &&
                !img.subcategory?.toLowerCase().includes('(annotated)')
            );
            if (matchingImages.length > 0) {
              matchingImages.forEach((img, imgIdx) => {
                slots.push({
                  id: `${sub.id}-${imgIdx}`,
                  name: sub.name,
                  categoryName: section.name,
                  groupName,
                  idx,
                  image: img,
                });
              });
            } else {
              slots.push({
                id: sub.id,
                name: sub.name,
                categoryName: section.name,
                groupName,
                idx,
                image: undefined,
              });
            }
          } else {
            const existingImage = sectionImgs.find(
              (img) => (img.subcategory === sub.name || img.subcategory === sub.id) && !img.subcategory?.toLowerCase().includes('(annotated)')
            );

            slots.push({
              id: sub.id,
              name: sub.name,
              categoryName: section.name,
              groupName,
              idx,
              image: existingImage,
            });
          }
        });
      };

      if (section.subCategories && section.subCategories.length > 0) {
        addSubs(section.subCategories);
      }
      if (section.cardGroups) {
        section.cardGroups.forEach((group) => {
          if (group.subCategories) {
            addSubs(group.subCategories, group.name);
          }
        });
      }
    });

    return slots;
  }, [activeManageTab, getImagesForSection]);

  const getExtraFilledSlotsForTab = useCallback((tabId: string) => {
    const catIds = getCategoryIdsForTab(tabId);
    const extraSlots: any[] = [];

    catIds.forEach((catId) => {
      const section = IMAGE_CATEGORIES.find((c) => c.id === catId);
      if (!section) return;

      const sectionImgs = getImagesForSection(section);
      const isRequiredSub = (name: string) => {
        if (section.subCategories?.some((sub) => sub.name === name)) return true;
        if (section.cardGroups?.some((group) => group.subCategories?.some((sub) => sub.name === name))) return true;
        return false;
      };

      sectionImgs.forEach((img) => {
        const isAnnotated = img.subcategory?.toLowerCase().includes('(annotated)');
        if (!isAnnotated && (!img.subcategory || !isRequiredSub(img.subcategory))) {
          extraSlots.push({
            categoryName: section.name,
            image: img,
          });
        }
      });
    });

    return extraSlots;
  }, [getImagesForSection]);

  const getAnnotatedSlotsForTab = useCallback((tabId: string) => {
    const catIds = getCategoryIdsForTab(tabId);
    const annotated: any[] = [];

    catIds.forEach((catId) => {
      const section = IMAGE_CATEGORIES.find((c) => c.id === catId);
      if (!section) return;

      const sectionImgs = getImagesForSection(section);
      sectionImgs.forEach((img) => {
        if (img.subcategory?.toLowerCase().includes('(annotated)')) {
          annotated.push({
            categoryName: section.name,
            image: img,
          });
        }
      });
    });

    return annotated;
  }, [getImagesForSection]);

  const getTabCounts = useCallback((tabId: string) => {
    const catIds = getCategoryIdsForTab(tabId);
    let captured = 0;
    let total = 0;

    catIds.forEach((catId) => {
      const section = IMAGE_CATEGORIES.find((c) => c.id === catId);
      if (!section) return;

      const sectionImgs = getImagesForSection(section);
      const standardCount = section.subCategories?.length || 0;
      const groupCount = section.cardGroups?.reduce((sum, g) => sum + (g.subCategories?.length || 0), 0) || 0;
      const baseRequired = standardCount + groupCount;

      const extras = getExtraFilledSlotsForTab(tabId).filter(s => s.categoryName === section.name).length;
      const annotated = getAnnotatedSlotsForTab(tabId).filter(s => s.categoryName === section.name).length;

      let requiredFilled = 0;
      let inspectionExtras = 0;
      const addSubsCount = (subs: any[] = []) => {
        subs.forEach((sub) => {
          const matchingImages = sectionImgs.filter(
            (img) =>
              (img.subcategory === sub.name ||
                img.subcategory === sub.id ||
                img.subcategory?.startsWith(`${sub.name} - Extra`) ||
                img.subcategory?.startsWith(`${sub.id} - Extra`)) &&
              !img.subcategory?.toLowerCase().includes('(annotated)')
          );
          const isInspection = catId === 'inspection' || catId === 'roof-inspection-plane';

          if (isInspection) {
            requiredFilled += matchingImages.length;
            if (matchingImages.length > 1) {
              inspectionExtras += (matchingImages.length - 1);
            }
          } else {
            if (matchingImages.length > 0) {
              requiredFilled += 1;
            }
          }
        });
      };

      if (section.subCategories && section.subCategories.length > 0) {
        addSubsCount(section.subCategories);
      }
      if (section.cardGroups) {
        section.cardGroups.forEach((group) => {
          if (group.subCategories) {
            addSubsCount(group.subCategories);
          }
        });
      }

      total += baseRequired + extras + annotated + inspectionExtras;
      captured += requiredFilled + extras + annotated;
    });

    return { captured, total };
  }, [getImagesForSection, getExtraFilledSlotsForTab, getAnnotatedSlotsForTab]);

  const toggleSelectPhoto = (img: SectionImage, category: string) => {
    const isSelected = selectedAnnotationPhotos.some(
      (p) => p.s3url === img.s3url || p.uri === img.uri
    );
    if (isSelected) {
      setSelectedAnnotationPhotos(prev => prev.filter((p) => p.uri !== img.uri));
    } else {
      setSelectedAnnotationPhotos(prev => [...prev, { ...img, categoryName: category }]);
    }
  };

  const handleOpenPreviewTab = (clickedImageUri: string) => {
    const requiredImgs = getRequiredSlotsForActiveTab()
      .filter((slot) => slot.image !== undefined)
      .map((slot) => ({
        uri: slot.image!.uri,
        label: getSubcategoryLabel(slot.categoryName, slot.image!.subcategory || slot.name).replace('(Annotated)', '').trim(),
      }));

    const extraImgs = getExtraFilledSlotsForTab(activeManageTab)
      .map((slot) => ({
        uri: slot.image.uri,
        label: getSubcategoryLabel(slot.categoryName, slot.image.subcategory || '').replace('(Annotated)', '').trim(),
      }));

    const annotatedImgs = getAnnotatedSlotsForTab(activeManageTab)
      .map((slot) => ({
        uri: slot.image.uri,
        label: getSubcategoryLabel(slot.categoryName, slot.image.subcategory || '').replace('(Annotated)', '').trim(),
      }));

    const allImages = [...requiredImgs, ...extraImgs, ...annotatedImgs];
    const index = allImages.findIndex((img) => img.uri === clickedImageUri);

    setPreviewImages(allImages.length > 0 ? allImages : [{ uri: clickedImageUri, label: 'Image' }]);
    setPreviewIndex(index >= 0 ? index : 0);
    setIsPlaying(false);
    setIsFullscreen(false);
  };

  const handleOpenPreviewSingle = (uri: string, label: string = 'Image') => {
    setPreviewImages([{ uri, label }]);
    setPreviewIndex(0);
    setIsPlaying(false);
    setIsFullscreen(false);
  };

  const isResulted = useMemo(() => {
    const status = lead?.status?.toLowerCase();
    const outcomeStatus = outcomeData?.status?.toLowerCase() || outcomeData?.result?.toLowerCase();
    const validStatuses = ['sale', 'demo', 'nodemo', 'nothit', 'reset', 'demonosale', 'nothome', 'cancelled', 'rescheduled'];
    const normalize = (s: string) => s?.toLowerCase().replace(/[^a-z]/g, '') || '';
    return validStatuses.includes(normalize(status)) || validStatuses.includes(normalize(outcomeStatus));
  }, [lead?.status, outcomeData]);

  const hasContract = useMemo(() => {
    const status = (lead?.status || outcomeData?.status || outcomeData?.result || '').toLowerCase();
    const normalized = status.replace(/[^a-z]/g, '');
    return normalized === 'sale' || normalized === 'demo' || normalized === 'demonosale';
  }, [lead?.status, outcomeData]);

  const getStatusLabel = () => {
    const status = (lead?.status || outcomeData?.status || outcomeData?.result || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    const labels: Record<string, string> = {
      sale: 'Sale',
      demo: 'Demo',
      nodemo: 'No demo',
      demonosale: 'Demo No Sale',
      nothit: 'Not hit',
      nothome: 'Not Home',
      reset: 'Reset',
      cancelled: 'Cancelled',
      rescheduled: 'Rescheduled',
    };
    return labels[status] || lead?.status || 'Resulted';
  };

  const fetchDraft = useCallback(async () => {
    if (!lead?._id) return;
    try {
      const companyId = lead?.companyId || user?.companyId;
      const draftRes = await LeadService.getLeadDraft(lead._id, companyId);
      const draftData = draftRes.data?.data || draftRes.data;
      setLeadDraft(draftData);
    } catch {
      setLeadDraft(null);
    }
  }, [lead?._id, lead?.companyId, user?.companyId]);

  useEffect(() => {
    fetchDraft();
  }, [fetchDraft]);

  useEffect(() => {
    const leadId = lead?._id;
    if (!leadId) return;

    console.log('[Socket] Joining lead draft room:', leadId);
    SocketManager.emit('join-lead-draft', leadId);

    const unsubscribe = SocketManager.on('lead-draft-update', (payload: any) => {
      if (!payload || String(payload.leadId) !== String(leadId)) return;

      console.log('[Socket] lead-draft-update payload received:', payload);

      if (payload.draft !== undefined) {
        setLeadDraft(payload.draft ?? null);
      }

      if (payload.lead && typeof payload.lead === 'object') {
        refetch();
      }
    });

    return () => {
      console.log('[Socket] Leaving lead draft room:', leadId);
      SocketManager.emit('leave-lead-draft', leadId);
      unsubscribe();
    };
  }, [lead?._id, refetch]);

  useEffect(() => {
    let cancelled = false;

    const mapWith = (allDocs: any[], urls: any[] | null) =>
      allDocs.map((doc: any) => {
        const urlObj = urls?.find((u: any) => u.filePath === doc.filePath);
        const size = doc.fileData?.size || doc.size || doc.fileSize || doc.length || doc.contentLength;
        const finalType = doc.documentType || doc._sourceGroup;
        return {
          uri: urlObj?.secureUrl || urlObj?.url || resolveS3Url(doc.filePath),
          name: finalType === 'agreement' ? 'Agreement' : finalType === 'orderSheet' ? 'Order Sheet' : 'Down Payment Receipt',
          serverId: doc._id,
          size,
          documentType: finalType,
        };
      });

    const split = (mappedAll: any[]) => ({
      agreements: mappedAll.filter((d: any) => d.documentType === 'agreement'),
      orderSheets: mappedAll.filter((d: any) => d.documentType === 'orderSheet'),
      downPaymentReceipts: mappedAll.filter((d: any) => d.documentType === 'downPaymentReceipt'),
    });

    const flatten = (bag: any) => [
      ...(bag?.agreements || []).map((d: any) => ({ ...d, _sourceGroup: 'agreement' })),
      ...(bag?.orderSheets || []).map((d: any) => ({ ...d, _sourceGroup: 'orderSheet' })),
      ...(bag?.downPaymentReceipt || []).map((d: any) => ({ ...d, _sourceGroup: 'downPaymentReceipt' })),
    ];

    const keyOf = (d: any) => d.filePath || d._id || '';
    const contentKeyOf = (d: any) => {
      const size = d.fileData?.size ?? d.size ?? d.fileSize ?? d.length ?? d.contentLength;
      const type = d.documentType || d._sourceGroup || '';
      return size ? `${type}:${size}` : '';
    };

    const resolveDocs = async () => {
      const leadId = lead?._id;
      const jbAllDocs = flatten(lead?.jobBuilderDocuments);

      if (!cancelled) setResolvedDocuments(split(mapWith(jbAllDocs, null)));

      const dedupeDocs = (docs: any[]) => {
        const seen = new Set<string>();
        const seenContent = new Set<string>();
        const out: any[] = [];
        for (const d of docs) {
          const k = keyOf(d);
          const ck = contentKeyOf(d);
          if ((k && seen.has(k)) || (ck && seenContent.has(ck))) continue;
          if (k) seen.add(k);
          if (ck) seenContent.add(ck);
          out.push(d);
        }
        return out;
      };

      let mergedAllDocs = dedupeDocs(jbAllDocs);

      if (leadId && mergedAllDocs.length === 0) {
        try {
          const calcId = resolveLeadCalculatorId(lead);
          const [dlRes, calcRes] = await Promise.all([
            LeadService.downloadOutcomeDocuments(leadId).catch(() => null),
            calcId
              ? LeadService.getLeadOutcomeByCalculator(leadId, calcId).catch(() => null)
              : Promise.resolve(null),
          ]);
          const docsFrom = (res: any) => {
            const body: any = res?.data;
            const outcome = body?.data?.outcome ?? body?.outcome ?? body?.data ?? body;
            return flatten(outcome?.leadOutcomeDocuments ?? outcome);
          };
          mergedAllDocs = dedupeDocs([...docsFrom(dlRes), ...docsFrom(calcRes)]);
        } catch (e) {
          console.warn('[JobDocsSection] outcome document fallback failed', e);
        }
      }

      if (mergedAllDocs.length === 0) {
        if (!cancelled) setResolvedDocuments({ agreements: [], orderSheets: [], downPaymentReceipts: [] });
        return;
      }

      if (!cancelled) setResolvedDocuments(split(mapWith(mergedAllDocs, null)));

      try {
        const allPaths = mergedAllDocs.map((doc: any) => ({
          filePath: doc.filePath,
          bucketName: doc.bucketName,
        }));
        const res = await LeadService.getSecureUrls(allPaths);
        const urls = res.data?.data || res.data;
        if (!cancelled && Array.isArray(urls)) setResolvedDocuments(split(mapWith(mergedAllDocs, urls)));
      } catch (error) {
        console.error('Failed to resolve secure URLs', error);
      }
    };
    resolveDocs();
    return () => {
      cancelled = true;
    };
  }, [lead?.jobBuilderDocuments, lead?._id]);



  const globalCounts = useMemo(() => {
    let totalCaptured = 0;
    let totalSlots = 0;
    MANAGE_TABS.forEach((tab) => {
      const { captured, total } = getTabCounts(tab.id);
      totalCaptured += captured;
      totalSlots += total;
    });
    return { captured: totalCaptured, total: totalSlots };
  }, [getTabCounts]);

  const [photoCountHintOpen, setPhotoCountHintOpen] = useState(false);

  const dynamicCounts = useMemo(() => {
    if (!isDynamicInspection) return null;
    const photos = (Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [])
      .filter(Boolean)
      .filter((p: any) => !deletedUrls.has(p?.s3url));

    const pending = (queueItems || [])
      .filter((it: any) => it.leadId === lead?._id)
      .map((it: any) => ({
        uri: it.uri,
        s3url: it.s3url,
        category: it.categoryName,
        subcategory: it.subcategory,
      }));

    let totalSlots = 0;
    const configuredKeys = new Set<string>();
    configuredProducts.forEach((prod: any) => {
      const pfx = prod?.name || prod?.id ? `${prod.name || prod.id} — ` : '';
      indexSchema(prod?.categories || []).leafCategories.forEach((cat: any) => {
        getCapturableSlots(cat).forEach((slot: any) => {
          totalSlots += 1;
          configuredKeys.add(`${norm(`${pfx}${cat.label}`)}||${norm(slot.storageName)}`);
        });
      });
    });

    // One rule for every surface - see `utils/lead-photo-counts`. Extras and annotated photos
    // count, and each brings its own slot, so the denominator grows as the rep adds them.
    return countLeadPhotos([...photos, ...pending], configuredKeys, totalSlots);
  }, [isDynamicInspection, configuredProducts, lead?.salesPhotos, queueItems, lead?._id, deletedUrls]);

  const displayTotal = useMemo(() => {
    if (dynamicCounts) return dynamicCounts.slots;
    return globalCounts.total;
  }, [dynamicCounts, globalCounts]);

  const totalUploaded = useMemo(() => {
    if (dynamicCounts) return dynamicCounts.photos;
    return globalCounts.captured;
  }, [dynamicCounts, globalCounts]);

  const totalPhotosCount = useMemo(() => {
    if (dynamicCounts) return dynamicCounts.photos;
    const seen = new Set<string>();
    let count = 0;
    IMAGE_CATEGORIES.forEach((cat) => {
      getImagesForSection(cat).forEach((img: any) => {
        const id = img?.s3url || img?.uri || img?._id;
        if (id) {
          if (seen.has(id)) return;
          seen.add(id);
        }
        count += 1;
      });
    });
    return count;
  }, [dynamicCounts, getImagesForSection]);

  const progressPercent = useMemo(() => {
    if (displayTotal === 0) return 0;
    return Math.round((totalUploaded / displayTotal) * 100);
  }, [totalUploaded, displayTotal]);

  return (
    <View className="px-4 py-2" style={{ flex: 1 }}>
      {/* Pending addendum — its OWN section, ABOVE the contract card, so the two
          statuses read as separate blocks (web `deal-banners.js` places its bar in the
          same slot). Renders null when nothing is pending, so the normal deal is
          unchanged and the contract card keeps its green LEAD RESULTED header. */}
      <AddendumRecipientCard
        lead={lead}
        drafts={drafts}
        draftsReady={draftsReady}
        isDark={isDark}
        colors={colors}
        onRecipientChanged={onDraftsChanged}
      />

      {/* Outstanding approvals — `GET /lead/v1/:leadId/approvals`.

          ⚠️ **ABOVE the contract card, not below the addendums**, on request. A refund
          waiting on somebody is the most time-sensitive thing on this screen — it is the
          only block reporting a person the rep may have to chase — and under the contract
          card's Agreement / Order Sheets / Down Payment Receipt sections it sat below the
          fold on most deals, which is exactly where a rep does not look for something
          they are waiting on.

          ⚠️ Gated on a RESULTED lead so an ordinary scheduled or self-gen lead makes no
          extra request. An approval only ever exists against a refund, and a refund only
          against a deal that has collected money and been re-priced — so an unresulted
          lead cannot have one, and asking would be a round trip whose answer is always
          empty. This screen is watched closely for request count (opening a Deal was cut
          by three not long ago); keep it that way.

          Renders null with nothing outstanding, so even a resulted lead shows nothing
          until it has an approval. */}
      <LeadApprovalsCard
        leadId={lead?._id}
        companyId={lead?.companyId}
        payments={leadFunding.payments}
        enabled={isLeadResulted(lead)}
      />

      {/* Result Card Details */}
      <ContractDetailsCard
        lead={lead}
        refundSummary={refundSummary}
        outcomeData={outcomeData}
        leadDraft={leadDraft}
        isDark={isDark}
        colors={colors}
        resolvedDocuments={resolvedDocuments}
        expandedDocs={expandedDocs}
        setExpandedDocs={setExpandedDocs}
        setShowEditModal={onEditContract ? () => onEditContract() : setShowEditModal}
        onOpenPdf={onOpenPdf}
        onImagePreview={(uri) => handleOpenPreviewSingle(uri)}
        getStatusLabel={getStatusLabel}
        hasContract={hasContract}
        isResulted={isResulted}
        onAddDocument={handleAddDocument}
      />

      {/* Addendums — web `job-docs-tab.js` renders `docsExtras` in exactly this
          slot, between the contract card and the slots/photos progress row.
          Renders null when the lead has no addendums. */}
      <AddendumsCard
        drafts={drafts}
        onOpenPdf={onOpenPdf}
        isDark={isDark}
        colors={colors}
      />

      {/* Progress Bar */}
      <View className="mb-3 mt-2 px-1">
        <View className="flex-row items-center mb-2.5">
          {/* Why the total moves as extras and annotations are added. An in-card popover rather
              than a Modal - this screen already stacks several, and iOS drops a presentation
              requested while another is dismissing. */}
          <View>
            {photoCountHintOpen && (
              <View
                className="absolute bottom-full left-0 mb-1.5 rounded-lg px-3 py-2"
                style={{ width: 230, backgroundColor: '#1C252E', zIndex: 10, elevation: 6 }}
              >
                <Text className="text-[11px] leading-[15px]" style={{ color: '#FFFFFF' }}>
                  {PHOTO_COUNT_HINT}
                </Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => setPhotoCountHintOpen((v) => !v)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="How photos are counted"
            >
              <Icon name="information-outline" size={16} color="#919EAB" />
            </TouchableOpacity>
          </View>
          <Text className="text-[14px] font-semibold ml-1.5" style={{ color: '#454F5B' }}>
            {totalUploaded}/{displayTotal} slots • {totalPhotosCount} {totalPhotosCount === 1 ? 'photo' : 'photos'}
          </Text>
        </View>
        <View
          className="w-full h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: '#919EAB1F' }}
        >
          <View
            className="h-full rounded-full"
            style={{
              width: `${Math.min(progressPercent, 100)}%`,
              backgroundColor: '#72BD00',
            }}
          />
        </View>
      </View>
      <View style={{ height: 10 }} />

      {/* Capture CTA & Manage Photos Buttons */}
      <TouchableOpacity
        onPress={handleStartTakingPhotos}
        className="w-full py-4 rounded-xl items-center justify-center flex-row mb-2"
        style={{ backgroundColor: '#72BD00' }}
      >
        <Icon name="camera" size={20} color="white" style={{ marginRight: 8 }} />
        <Text className="text-white font-bold text-sm">
          {totalUploaded > 0 ? 'Continue' : 'Start'} Taking Photos
        </Text>
      </TouchableOpacity>
      <Text className="text-[11px] font-bold text-slate-400 text-center mb-4">
        Shoot first — tag by location after each shot
      </Text>

      <View className="w-full gap-2.5 mb-6">
        <TouchableOpacity
          onPress={() => setShowManageModal(true)}
          className="w-full py-4 rounded-xl items-center justify-center flex-row border"
          style={{ borderColor: '#72BD00', backgroundColor: 'transparent' }}
        >
          <Icon name="grid" size={20} color="#72BD00" style={{ marginRight: 8 }} />
          <Text className="font-bold text-sm text-[#72BD00]">
            Manage Photos ({totalUploaded})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            if (totalUploaded === 0) {
              Alert.alert('No Photos', 'There are no photos to download.');
            } else {
              setShowDownloadModal(true);
            }
          }}
          className="w-full py-4 rounded-xl items-center justify-center flex-row border"
          style={{
            borderColor: totalUploaded > 0 ? '#72BD00' : '#919EAB33',
            backgroundColor: 'transparent'
          }}
        >
          <Icon
            name="download"
            size={20}
            color={totalUploaded > 0 ? '#72BD00' : '#919EAB'}
            style={{ marginRight: 8 }}
          />
          <Text
            className="font-bold text-sm"
            style={{ color: totalUploaded > 0 ? '#72BD00' : '#919EAB' }}
          >
            Download Images ({totalUploaded})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Result Buttons */}
      {Platform.OS === 'android' && isRefreshing ? (
        <View
          className="py-4 flex-row items-center justify-center"
          style={{ height: 80, backgroundColor: isDark ? colors.surface : colors.background }}
        >
          <ActivityIndicator size="small" color="#72BD00" />
        </View>
      ) : isResulted ? (
        <View className="flex-row gap-2 mt-2 mb-4">
          <View
            className="flex-[3] h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: '#94a3b8' }}
          >
            <Text className="text-white font-bold text-sm tracking-tight">
              Resulted — {getStatusLabel()}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleQuickReset}
            disabled={resetLeadMutation.isPending}
            className="flex-1 h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: '#94a3b8' }}
          >
            {resetLeadMutation.isPending ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Icon name="refresh" size={22} color="white" />
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View
          className="py-4 flex-row gap-3"
          style={{ backgroundColor: isDark ? colors.surface : colors.background }}
        >
          <TouchableOpacity
            onPress={() => onResultPress('noDemo')}
            className="flex-1 h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: '#FF5630' }}
          >
            <Text className="text-white text-sm font-bold">No demo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onResultPress('reset')}
            className="flex-1 h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: '#F59E0B' }}
          >
            <Text className="text-white text-sm font-bold">Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onResultPress('notHit')}
            className="flex-1 h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: '#212B36' }}
          >
            <Text className="text-white text-sm font-bold">Not hit</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ height: 1, overflow: 'hidden' }}>
        <View
          style={{
            height: 2,
            borderWidth: 1,
            borderColor: '#C5CAD17A',
            borderStyle: 'dashed',
            borderRadius: 0.01,
          }}
        />
      </View>

      <DocumentScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title={scannerType === 'agreement' ? 'Scan Agreement' : scannerType === 'orderSheet' ? 'Scan Order Sheet' : 'Scan Down Payment Receipt'}
        leadId={lead?._id || ''}
        category={scannerType}
        initialFiles={
          resolvedDocuments[scannerType === 'agreement' ? 'agreements' : scannerType === 'orderSheet' ? 'orderSheets' : 'downPaymentReceipts'] || []
        }
        allowRemoveExisting={false}
        onSave={handleSaveScannedDocument}
      />

      <EditContractDetailsModal
        visible={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          refetch();
          fetchDraft();
        }}
        outcomeData={outcomeData}
        lead={lead}
        onUpdate={handleUpdateContract}
        onSendSuccess={() => {
          refetch();
          fetchDraft();
        }}
      />

      {/* Result Modal Wrapper */}
      <ResultLeadModal
        visible={showResultModal}
        onClose={() => setShowResultModal(false)}
        onSubmit={handleResultSubmit}
        initialResult={pendingResult}
        loading={submitJobMutation.isPending || resetLeadMutation.isPending}
        lead={lead}
      />

      {/* Download Images Confirmation Modal */}
      <Modal visible={showDownloadModal} transparent animationType="fade">
        <View className="flex-1 justify-center items-center bg-black/50 px-6">
          <View
            className="w-full max-w-sm rounded-[32px] p-6 items-center"
            style={{ backgroundColor: isDark ? colors.surface : 'white' }}
          >
            {/* Download Icon Wrapper */}
            <View
              className="w-20 h-20 rounded-full items-center justify-center mb-5"
              style={{ backgroundColor: '#72BD0015' }}
            >
              <View
                className="w-14 h-14 rounded-full items-center justify-center"
                style={{ backgroundColor: '#72BD0022' }}
              >
                <Icon name="download" size={32} color="#72BD00" />
              </View>
            </View>

            {/* Title */}
            <Text
              className="text-lg font-black mb-3"
              style={{ color: colors.text }}
            >
              Download Images
            </Text>

            {/* Message */}
            <Text
              className="text-slate-500 text-sm text-center mb-6 px-4"
              style={{ color: isDark ? colors.textSecondary : '#637381' }}
            >
              {isDownloading
                ? `Downloading ${downloadProgress} of ${totalUploaded} photos...`
                : `Are you sure you want to download all ${totalUploaded} photos?`}
            </Text>

            {/* Buttons Row */}
            {!isDownloading ? (
              <View className="flex-row gap-3 w-full">
                <TouchableOpacity
                  onPress={() => setShowDownloadModal(false)}
                  className="flex-1 h-12 rounded-xl items-center justify-center border"
                  style={{ borderColor: '#919EAB33' }}
                >
                  <Text className="text-sm font-bold" style={{ color: colors.text }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDownloadAllImages}
                  className="flex-1 h-12 rounded-xl items-center justify-center"
                  style={{ backgroundColor: '#72BD00' }}
                >
                  <Text className="text-white text-sm font-bold">Download</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ActivityIndicator size="small" color="#72BD00" />
            )}
          </View>
        </View>
      </Modal>


      {/* Tag Photo Modal */}
      <TagPhotoModal
        visible={showTagModal}
        onClose={() => setShowTagModal(false)}
        lead={lead}
        taggingAsset={taggingAsset}
        setTaggingAsset={setTaggingAsset}
        movingImage={movingImage}
        setMovingImage={setMovingImage}
        conflict={conflict}
        setConflict={setConflict}
        activeTagTab={activeTagTab}
        setActiveTagTab={setActiveTagTab}
        getImagesForSection={getImagesForSection}
        handleUpload={handleUpload}
        handleDelete={handleDelete}
        handleMovePhoto={handleMovePhoto}
        isContinuousCamera={isContinuousCamera}
        setIsContinuousCamera={setIsContinuousCamera}
        reopenCameraContinuous={reopenCameraContinuous}
        updateImagePositionMutation={updateImagePositionMutation}
        refetch={refetch}
        setShowManageModal={setShowManageModal}
        totalUploaded={totalUploaded}
        displayTotal={displayTotal}
        totalPhotosCount={totalPhotosCount}
        insets={insets}
        sectionImages={sectionImages}
        onSectionImagesChange={onSectionImagesChange}
        getTabCounts={getTabCounts}
        waitForPendingUpload={waitForPendingUpload}
      />

      {/* Dynamic capture (web `DynamicInspectionPhotosDialog`) — the schema-driven
          replacement for the static camera → TagPhotoModal flow. */}
      {showDynamicCapture && isDynamicInspection && (
        <Modal visible animationType="none" onRequestClose={() => setShowDynamicCapture(false)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <DynamicInspectionView
              lead={lead}
              products={configuredProducts}
              onClose={() => setShowDynamicCapture(false)}
              refetch={refetch}
            />
          </View>
        </Modal>
      )}

      {/* Manage Photos — schema-driven when the company configured an inspection
          schema (web `DynamicManagePhotosDialog`), else the static slot grid. */}
      {showManageModal && isDynamicInspection && (
        <Modal visible animationType="slide" onRequestClose={() => setShowManageModal(false)}>
          <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: '#0D1F1A' }}>
            <DynamicManagePhotosView
              lead={lead}
              products={configuredProducts}
              onClose={() => setShowManageModal(false)}
              onReopen={() => setShowManageModal(true)}
              refetch={refetch}
            />
          </View>
        </Modal>
      )}

      {showManageModal && !isDynamicInspection && productsLoading && (
        <Modal visible transparent animationType="fade">
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        </Modal>
      )}

      <ManagePhotosModal
        visible={showManageModal && !isDynamicInspection && !productsLoading}
        onClose={() => setShowManageModal(false)}
        lead={lead}
        insets={insets}
        navigation={navigation}
        refetch={refetch}
        activeManageTab={activeManageTab}
        setActiveManageTab={setActiveManageTab}
        isAnnotationSelectMode={isAnnotationSelectMode}
        setIsAnnotationSelectMode={setIsAnnotationSelectMode}
        selectedAnnotationPhotos={selectedAnnotationPhotos}
        setSelectedAnnotationPhotos={setSelectedAnnotationPhotos}
        getTabCounts={getTabCounts}
        getRequiredSlotsForActiveTab={getRequiredSlotsForActiveTab}
        getExtraFilledSlotsForTab={getExtraFilledSlotsForTab}
        getAnnotatedSlotsForTab={getAnnotatedSlotsForTab}
        toggleSelectPhoto={toggleSelectPhoto}
        handleOpenPreviewTab={handleOpenPreviewTab}
        setMovingImage={setMovingImage}
        setShowTagModal={openLegacyTagModal}
        setShowManageModal={setShowManageModal}
        handleDelete={handleDelete}
        getSubcategoryLabel={getSubcategoryLabel}
      />

      {/* Fullscreen Image Slideshow Modal */}
      <ImageSlideshowModal
        visible={previewImages.length > 0}
        onClose={() => setPreviewImages([])}
        previewImages={previewImages}
        setPreviewImages={setPreviewImages}
        previewIndex={previewIndex}
        setPreviewIndex={setPreviewIndex}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        isFullscreen={isFullscreen}
        setIsFullscreen={setIsFullscreen}
        insets={insets}
      />
    </View>
  );
};
