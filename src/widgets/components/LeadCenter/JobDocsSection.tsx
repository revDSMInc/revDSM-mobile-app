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
import { LeadService } from '../../../services/api/leads';
import { useNavigation } from '@react-navigation/native';
import { EditContractDetailsModal } from '../../modals/lead-center/EditContractDetailsModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DocumentScannerModal } from '../../modals/job-builder/DocumentScannerModal';
import RNFS from 'react-native-fs';
// @ts-ignore
import base64 from 'base-64';
import { useAuth } from '../../../hooks/useAuth';

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

// Subcomponents
import { ContractDetailsCard } from './ContractDetailsCard';
import { TagPhotoModal } from './TagPhotoModal';
import { ManagePhotosModal } from './ManagePhotosModal';
import { ImageSlideshowModal } from './ImageSlideshowModal';
import { uploadQueueManager, UploadQueueItem } from '../../../utils/uploadQueue';

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
}: JobDocsSectionProps) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const submitJobMutation = useSubmitJobBuilderMutation();
  const resetLeadMutation = useResetLeadMutation();
  const uploadImagesMutation = useUploadImagesMutation();
  const deleteImageMutation = useDeleteImageMutation();
  const updateImagePositionMutation = useUpdateLeadImagePositionMutation();




  const [showResultModal, setShowResultModal] = useState(false);
  const [pendingResult, setPendingResult] = useState<string>('noDemo');

  // Scanner states for direct upload
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerType, setScannerType] = useState<'agreement' | 'orderSheet'>('agreement');
  const [isGenerating, setIsGenerating] = useState(false);

  // Slideshow preview states
  const [previewImages, setPreviewImages] = useState<{ uri: string; label: string }[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Manage components states
  const [showEditModal, setShowEditModal] = useState(false);
  const [, setUploadingSlots] = useState<{ [key: string]: boolean }>({});
  const outcomeData = lead;

  // Upload queue state — persisted to MMKV
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>(() => uploadQueueManager.getQueue());

  const [taggingAsset, setTaggingAsset] = useState<any>(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
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

  // Register queue listener — sync React state with MMKV queue state and trigger refetch
  useEffect(() => {
    const unsubscribe = uploadQueueManager.addListener(() => {
      const currentQueue = uploadQueueManager.getQueue();
      setQueueItems([...currentQueue]);
      // When queue empties (upload finished), refresh lead data from server
      if (currentQueue.length === 0) {
        refetch();
      }
    });

    // On mount: resume any incomplete uploads that survived app restart
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

  // Annotation multiselect states
  const [isAnnotationSelectMode, setIsAnnotationSelectMode] = useState<boolean>(false);
  const [selectedAnnotationPhotos, setSelectedAnnotationPhotos] = useState<SectionImage[]>([]);

  // Contract outcome states
  const [resolvedDocuments, setResolvedDocuments] = useState<{ agreements: any[]; orderSheets: any[] }>({
    agreements: [],
    orderSheets: [],
  });
  const [expandedDocs, setExpandedDocs] = useState<{ agreements: boolean; orderSheets: boolean }>({
    agreements: true,
    orderSheets: true,
  });
  const [leadDraft, setLeadDraft] = useState<any>(null);

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

    // Resolve the canonical key from sectionImages
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

    // Merge pending optimistic items for this lead+category from the MMKV queue
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

    // Don't duplicate: exclude queue items already reflected in s3Images by matching uri
    const existingUris = new Set(s3Images.map((img) => img.uri));
    const uniquePending = pendingForSection.filter((p) => !existingUris.has(p.uri));

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
    const subcategory = groupName
      ? groupName
      : categoryObj?.subCategories?.[idx]?.name || `${categoryName} - Extra ${idx + 1}`;

    const tempPhoto: SectionImage = {
      uri: asset.uri,
      index: idx,
      subcategory,
      isOptimistic: true,
    };

    // --- Instant Optimistic UI: show the photo immediately in its slot ---
    // We use functional update on sectionImages to avoid stale closure overwrites
    // when multiple photos are taken in quick succession.
    onSectionImagesChange((prev: Record<string, SectionImage[]>) => {
      const prevList = prev[categoryName] || [];
      // Only add if not already in the list (guard against double-fire)
      if (prevList.some((img) => img.uri === asset.uri)) return prev;
      return {
        ...prev,
        [categoryName]: [...prevList, tempPhoto],
      };
    });

    // --- Push to persistent MMKV-backed background upload queue ---
    uploadQueueManager.addToQueue({
      leadId: lead._id,
      categoryName,
      subcategory,
      uri: asset.uri,
      type: asset.type || 'image/jpeg',
      name: asset.fileName || `photo_${Date.now()}.jpg`,
    });

    // Clear the per-slot uploading spinner (queue handles the real upload)
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
    const subcategory = targetGroupName
      ? targetGroupName
      : targetCategoryObj?.subCategories?.[targetIdx]?.name || `${targetCatName} - Extra ${targetIdx + 1}`;

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

    // Optimistic local state update
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

    // Await the actual upload/move mutation
    await waitForPendingUpload();
    try {
      await updateImagePositionMutation.mutateAsync({ leadId: lead._id, payload });
      await refetch();
    } catch (e) {
      console.error('Move photo failed', e);
    } finally {
      // Clear moving image state
      setMovingImage(null);
    }
  };

  const handleUpdateContract = async (updatedOutcome: any) => {
    try {
      await LeadService.updateLeadOutcome(lead._id, updatedOutcome);
      await refetch();
    } catch (e) {
      console.error('Update contract details failed', e);
    }
  };

  const handleAddDocument = (type: 'agreement' | 'orderSheet') => {
    setScannerType(type);
    setScannerOpen(true);
  };

  const convertJpegToPdf = (jpegBase64: string, width = 595, height = 842): string => {
    const cleanBase64 = jpegBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    const binaryImg = base64.decode(cleanBase64);
    const imgLength = binaryImg.length;

    const obj1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
    const obj2 = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
    const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources 4 0 R /MediaBox [0 0 ${width} ${height}] /Contents 5 0 R >>\nendobj\n`;
    const obj4 = "4 0 obj\n<< /ProcSet [/PDF /ImageC] /XObject << /Im1 6 0 R >> >>\nendobj\n";
    const contentStream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im1 Do\nQ\n`;
    const obj5 = `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`;
    const obj6Header = `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLength} >>\nstream\n`;
    const obj6Footer = "\nendstream\nendobj\n";

    const pdfHeader = "%PDF-1.3\n";
    const offset1 = pdfHeader.length;
    const offset2 = offset1 + obj1.length;
    const offset3 = offset2 + obj2.length;
    const offset4 = offset3 + obj3.length;
    const offset5 = offset4 + obj4.length;
    const offset6 = offset5 + obj5.length;
    
    const obj6FullLength = obj6Header.length + imgLength + obj6Footer.length;
    const offsetStartXref = offset6 + obj6FullLength;
    
    const padOffset = (offset: number) => String(offset).padStart(10, '0');
    
    const xref = `xref\n0 7\n0000000000 65535 f \n${padOffset(offset1)} 00000 n \n${padOffset(offset2)} 00000 n \n${padOffset(offset3)} 00000 n \n${padOffset(offset4)} 00000 n \n${padOffset(offset5)} 00000 n \n${padOffset(offset6)} 00000 n \n`;
    const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${offsetStartXref}\n%%EOF\n`;
    
    const pdfBinaryString = 
      pdfHeader +
      obj1 +
      obj2 +
      obj3 +
      obj4 +
      obj5 +
      obj6Header +
      binaryImg +
      obj6Footer +
      xref +
      trailer;
      
    return base64.encode(pdfBinaryString);
  };

  const handleSaveScannedDocument = async (pages: any[]) => {
    const scannerCategory = scannerType === 'agreement' ? 'agreement' : 'orderSheet';
    const stateField = scannerCategory === 'agreement' ? 'agreements' : 'orderSheets';
    const leadId = lead?._id;

    if (!leadId) {
      Alert.alert('Error', 'No lead ID found. Cannot upload document.');
      return;
    }

    try {
      setIsGenerating(true);

      // Pre-fetch outcome documents to retrieve existing base64Data
      let preFetchedAppendedDocs: any[] = [];
      try {
        const response = await LeadService.downloadOutcomeDocuments(leadId);
        const dataObj = response.data?.data || response.data || {};
        preFetchedAppendedDocs = [
          ...(dataObj.agreements || []),
          ...(dataObj.orderSheets || [])
        ];
      } catch (err) {
        console.warn('[JobDocsSection] Failed to pre-fetch outcome documents', err);
      }

      const filePayloads: any[] = [];
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const docNum = i + 1;
        const cleanCategoryName = scannerCategory === 'agreement' ? 'Agreement' : 'Order_Sheet';
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
          // If it's an existing document, find its base64 content
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

      await LeadService.submitJobBuilder(leadId, payload);
      setScannerOpen(false);
      await refetch();
      // Trigger delayed refetches in case of minor backend processing/DB replication lag
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

      await submitJobMutation.mutateAsync({
        leadId: lead?._id,
        payload: { leadData, jobState: {} },
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
    if (version >= 33) {
      const [hasImage, hasVideo] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO),
      ]);
      return hasImage && hasVideo;
    }
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

    if (Platform.OS === 'android' && !(await hasAndroidPermission())) {
      const version = Number(Platform.Version);
      if (version >= 33) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        ]);
        if (
          granted[PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES] !== PermissionsAndroid.RESULTS.GRANTED
        ) {
          Alert.alert('Permission Denied', 'Storage permission is required to save photos.');
          return;
        }
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission Denied', 'Storage permission is required to save photos.');
          return;
        }
      }
    }

    if (Platform.OS === 'ios') {
      const iosReadGalleryPermission = modules.iosReadGalleryPermission;
      const iosRequestAddOnlyGalleryPermission = modules.iosRequestAddOnlyGalleryPermission;
      if (iosReadGalleryPermission && iosRequestAddOnlyGalleryPermission) {
        try {
          const status = await iosReadGalleryPermission('addOnly');
          if (status !== 'granted' && status !== 'limited') {
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

    setIsDownloading(true);
    setDownloadProgress(0);

    const imagesToDownload: SectionImage[] = [];
    IMAGE_CATEGORIES.forEach((cat) => {
      const imgs = sectionImages[cat.name] || [];
      imgs.forEach((img) => {
        if (img.uri) {
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

    let completedCount = 0;
    let successCount = 0;

    const downloadAndSavePromises = imagesToDownload.map(async (img, idx) => {
      try {
        const mediaUri = img.uri;
        let localPath = '';

        if (mediaUri.startsWith('file://') || mediaUri.startsWith('/')) {
          localPath = mediaUri;
        } else {
          const ext = 'jpg';
          const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/download_${Date.now()}_${idx}.${ext}`;
          const res = await ReactNativeBlobUtil.config({ path }).fetch('GET', mediaUri);
          localPath = res.path();
        }

        if (localPath) {
          const saveTag = localPath.startsWith('file://') ? localPath : `file://${localPath}`;
          await CameraRoll.saveAsset(saveTag, { type: 'photo' });
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

    if (successCount === imagesToDownload.length) {
      Alert.alert('Success', `Successfully downloaded all ${successCount} photos to your gallery!`);
    } else if (successCount > 0) {
      Alert.alert(
        'Partial Download',
        `Downloaded ${successCount} of ${imagesToDownload.length} photos. Some failed.`
      );
    } else {
      Alert.alert('Error', 'Failed to download photos. Please try again.');
    }
  };

  const onResultPress = (result: string) => {
    setPendingResult(result);
    setShowResultModal(true);
  };

  const handleStartTakingPhotos = () => {
    setIsContinuousCamera(true);
    reopenCameraContinuous();
  };

  const reopenCameraContinuous = async () => {
    setTaggingAsset(null);
    setShowTagModal(true);
  };

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

  useEffect(() => {
    const fetchDraft = async () => {
      if (!lead?._id) return;
      try {
        const companyId = lead?.companyId || user?.companyId;
        const draftRes = await LeadService.getLeadDraft(lead._id, companyId);
        const draftData = draftRes.data?.data || draftRes.data;
        setLeadDraft(draftData);
      } catch {
        setLeadDraft(null);
      }
    };
    fetchDraft();
  }, [lead, user?.companyId]);

  useEffect(() => {
    const resolveDocs = async () => {
      const docs = lead?.jobBuilderDocuments;
      if (docs) {
        const { agreements = [], orderSheets = [] } = docs;
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
            const res = await LeadService.getSecureUrls(allPaths);
            const urls = res.data?.data || res.data;

            const mappedAll = allDocs.map((doc: any) => {
              const urlObj = urls.find((u: any) => u.filePath === doc.filePath);
              const size = doc.fileData?.size || doc.size || doc.fileSize || doc.length || doc.contentLength;
              const finalType = doc.documentType || doc._sourceGroup;
              return {
                uri: urlObj?.secureUrl || urlObj?.url || doc.filePath,
                name: finalType === 'agreement' ? 'Agreement' : 'Order Sheet',
                serverId: doc._id,
                size,
                documentType: finalType,
              };
            });

            setResolvedDocuments({
              agreements: mappedAll.filter((d: any) => d.documentType === 'agreement'),
              orderSheets: mappedAll.filter((d: any) => d.documentType === 'orderSheet'),
            });
          } catch (error) {
            console.error('Failed to resolve secure URLs', error);
          }
        } else {
          setResolvedDocuments({ agreements: [], orderSheets: [] });
        }
      } else {
        setResolvedDocuments({ agreements: [], orderSheets: [] });
      }
    };
    resolveDocs();
  }, [lead?.jobBuilderDocuments]);



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

  const displayTotal = useMemo(() => {
    return globalCounts.total;
  }, [globalCounts]);

  const totalUploaded = useMemo(() => {
    return globalCounts.captured;
  }, [globalCounts]);

  const totalPhotosCount = useMemo(() => {
    let count = 0;
    IMAGE_CATEGORIES.forEach((cat) => {
      const imgs = getImagesForSection(cat);
      const nonAnnotated = imgs.filter(img => !img.subcategory?.toLowerCase().includes('(annotated)'));
      count += nonAnnotated.length;
    });
    return count;
  }, [getImagesForSection]);

  const progressPercent = useMemo(() => {
    if (displayTotal === 0) return 0;
    return Math.round((totalUploaded / displayTotal) * 100);
  }, [totalUploaded, displayTotal]);

  return (
    <View className="px-4 py-2" style={{ flex: 1 }}>
      {/* Result Card Details */}
      <ContractDetailsCard
        lead={lead}
        outcomeData={outcomeData}
        leadDraft={leadDraft}
        isDark={isDark}
        colors={colors}
        resolvedDocuments={resolvedDocuments}
        expandedDocs={expandedDocs}
        setExpandedDocs={setExpandedDocs}
        setShowEditModal={setShowEditModal}
        onOpenPdf={onOpenPdf}
        onImagePreview={(uri) => handleOpenPreviewSingle(uri)}
        getStatusLabel={getStatusLabel}
        hasContract={hasContract}
        isResulted={isResulted}
        onAddDocument={handleAddDocument}
      />

      {/* Progress Bar */}
      <View className="mb-6 px-1">
        <Text className="text-[14px] font-semibold mb-2.5" style={{ color: '#454F5B' }}>
          {totalUploaded}/{displayTotal} slots • {totalPhotosCount} {totalPhotosCount === 1 ? 'photo' : 'photos'}
        </Text>
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
          onPress={() => setShowDownloadModal(true)}
          className="w-full py-4 rounded-xl items-center justify-center flex-row border"
          style={{ borderColor: '#72BD00', backgroundColor: 'transparent' }}
        >
          <Icon name="download" size={20} color="#72BD00" style={{ marginRight: 8 }} />
          <Text className="font-bold text-sm text-[#72BD00]">
            Download Images ({totalUploaded})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Result Buttons */}
      {isResulted ? (
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
        title={scannerType === 'agreement' ? 'Scan Agreement' : 'Scan Order Sheet'}
        leadId={lead?._id || ''}
        category={scannerType}
        initialFiles={
          resolvedDocuments[scannerType === 'agreement' ? 'agreements' : 'orderSheets'] || []
        }
        onSave={handleSaveScannedDocument}
      />

      <EditContractDetailsModal
        visible={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          refetch();
        }}
        outcomeData={outcomeData}
        lead={lead}
        onUpdate={handleUpdateContract}
      />

      {/* Result Modal Wrapper */}
      <ResultLeadModal
        visible={showResultModal}
        onClose={() => setShowResultModal(false)}
        onSubmit={handleResultSubmit}
        initialResult={pendingResult}
        loading={submitJobMutation.isPending || resetLeadMutation.isPending}
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

      {/* Manage Photos Modal */}
      <ManagePhotosModal
        visible={showManageModal}
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
        setShowTagModal={setShowTagModal}
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
