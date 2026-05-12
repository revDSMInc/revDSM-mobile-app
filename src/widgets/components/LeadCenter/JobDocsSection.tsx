import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Platform,
  PermissionsAndroid,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { launchCamera, launchImageLibrary, MediaType } from 'react-native-image-picker';
import { GlobalModal } from '../../common/modal/GlobalModal';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  useSubmitJobBuilderMutation,
  useResetLeadMutation,
  useUploadImagesMutation,
  useDeleteImageMutation,
} from '../../../hooks/useLeadMutation';
import { ResultLeadModal } from '../../modals/lead-center/ResultLeadModal';
import { IMAGE_CATEGORIES } from '../../../constants/lead-center';
import { JobDocsThumbnails } from '../../../assets/images/jobdocs';
import Geolocation from 'react-native-geolocation-service';
import { LeadService } from '../../../services/api/leads';
import { useNavigation } from '@react-navigation/native';
import { useEffect } from 'react';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';

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
  onSectionImagesChange: (images: { [key: string]: SectionImage[] }) => void;
  refetch: () => Promise<void>;
  onOpenPdf?: (url: string, title?: string) => void;
}

export const JobDocsSection = ({
  lead,
  sectionImages,
  onSectionImagesChange,
  refetch,
  onOpenPdf,
}: JobDocsSectionProps) => {
  const { colors, isDark } = useTheme();

  const submitJobMutation = useSubmitJobBuilderMutation();
  const resetLeadMutation = useResetLeadMutation();
  const uploadImagesMutation = useUploadImagesMutation();
  const deleteImageMutation = useDeleteImageMutation();

  const [expandedAll, setExpandedAll] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [pendingResult, setPendingResult] = useState<string>('noDemo');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [uploadingSlots, setUploadingSlots] = useState<{ [key: string]: boolean }>({});
  
  const navigation = useNavigation<any>();
  const [outcomeData, setOutcomeData] = useState<any>(null);
  const [resolvedDocuments, setResolvedDocuments] = useState<{ agreements: any[]; orderSheets: any[] }>({
    agreements: [],
    orderSheets: [],
  });
  const [expandedDocs, setExpandedDocs] = useState<{ agreements: boolean; orderSheets: boolean }>({
    agreements: true,
    orderSheets: true,
  });

  const isResulted = useMemo(() => {
    const status = lead?.status?.toLowerCase();
    const outcomeStatus = outcomeData?.status?.toLowerCase() || outcomeData?.result?.toLowerCase();
    const validStatuses = ['sale', 'demo', 'nodemo', 'nothit', 'reset', 'demonosale', 'nothome', 'cancelled', 'rescheduled'];
    
    // Normalize status (remove spaces/dashes)
    const normalize = (s: string) => s?.toLowerCase().replace(/[^a-z]/g, '') || '';
    
    return validStatuses.includes(normalize(status)) || validStatuses.includes(normalize(outcomeStatus));
  }, [lead?.status, outcomeData]);

  const hasContract = useMemo(() => {
    const status = (lead?.status || outcomeData?.status || outcomeData?.result || '').toLowerCase();
    return status === 'sale' || status === 'demo';
  }, [lead?.status, outcomeData]);

  const getStatusLabel = () => {
    const status = (lead?.status || outcomeData?.status || outcomeData?.result || '').toLowerCase().replace(/[^a-z]/g, '');
    const labels: Record<string, string> = {
      sale: 'Sale',
      demo: 'Demo',
      nodemo: 'No Demo',
      demonosale: 'Demo No Sale',
      nothit: 'Not Hit',
      nothome: 'Not Home',
      reset: 'Reset',
      cancelled: 'Cancelled',
      rescheduled: 'Rescheduled'
    };
    return labels[status] || lead?.status || 'Resulted';
  };

  const fetchOutcome = useCallback(async () => {
    if (!lead?._id) return;
    try {
      const response = await LeadService.getLeadOutcome(lead._id);
      const data = response.data?.data || response.data;
      setOutcomeData(data);

      // Resolve documents if any
      const docs = data?.leadOutcomeDocuments;
      if (docs) {
        const { agreements = [], orderSheets = [] } = docs;
        const allPaths = [...agreements, ...orderSheets].map((doc: any) => ({
          filePath: doc.filePath,
          bucketName: doc.bucketName,
        }));

        if (allPaths.length > 0) {
          const res = await LeadService.getSecureUrls(allPaths);
          const urls = res.data?.data || res.data;

          const mapDocs = (list: any[]) =>
            list.map((doc: any) => {
              const urlObj = urls.find((u: any) => u.filePath === doc.filePath);
              return {
                uri: urlObj?.secureUrl || urlObj?.url || doc.filePath,
                name: doc.name || (doc.documentType === 'agreement' ? 'Agreement' : 'Order Sheet'),
                serverId: doc._id,
                size: doc.size,
              };
            });

          setResolvedDocuments({
            agreements: mapDocs(agreements),
            orderSheets: mapDocs(orderSheets),
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch outcome', error);
    }
  }, [lead?._id]);

  useEffect(() => {
    fetchOutcome();
  }, [fetchOutcome]);

  // ── Progress ──────────────────────────────────────────────────────────────
  const totalRequired = IMAGE_CATEGORIES.reduce((acc, section) => {
    const subTotal = section.subCategories?.reduce((s, sub) => s + (sub.required || 1), 0) || 0;
    const groupTotal =
      section.cardGroups?.reduce((g, group) => {
        return g + (group.subCategories?.reduce((s, sub) => s + (sub.required || 1), 0) || 0);
      }, 0) || 0;
    return acc + subTotal + groupTotal;
  }, 0);

  const totalUploaded = Object.values(sectionImages).reduce((acc, imgs) => acc + imgs.length, 0);

  // Calculate empty required slots to make the total dynamic
  const emptyRequiredCount = IMAGE_CATEGORIES.reduce((acc, section) => {
    let empty = 0;
    
    const checkSubs = (subs: any[] = [], sectionName: string) => {
      const sectionImgs = sectionImages[sectionName] || [];
      subs.forEach(sub => {
        const hasImg = sectionImgs.some(img => img.subcategory === sub.name);
        if (!hasImg) empty += (sub.required || 1);
      });
    };

    if (section.subCategories) checkSubs(section.subCategories, section.name);
    if (section.cardGroups) {
      section.cardGroups.forEach(group => {
        if (group.subCategories) checkSubs(group.subCategories, section.name);
      });
    }
    
    return acc + empty;
  }, 0);

  const displayTotal = totalUploaded + emptyRequiredCount;
  const progressPercent = displayTotal > 0 ? (totalUploaded / displayTotal) * 100 : 0;

  const onResultPress = (res: string) => {
    setPendingResult(res);
    setShowResultModal(true);
  };

  const handleResultSubmit = async (resultData: any) => {
    try {
      if (resultData.result === 'reset') {
        await resetLeadMutation.mutateAsync(lead?._id);
        onSectionImagesChange({});
      } else {
        await submitJobMutation.mutateAsync({
          leadId: lead?._id,
          payload: { leadData: resultData, jobState: {} },
        });
      }
      setShowResultModal(false);
    } catch (error) {
      console.error('Submit result failed', error);
    }
  };

  const handleUpload = async (catName: string, idx: number, asset: any, groupName?: string) => {
    if (!lead?._id) return;

    const catObj = IMAGE_CATEGORIES.find((c) => c.name === catName);
    let subcategoryName = `Extra ${catName}`;

    if (groupName) {
      subcategoryName =
        catObj?.cardGroups
          ?.find((g) => g.name === groupName)
          ?.subCategories?.find((_, sIdx) => sIdx === idx)?.name ||
        groupName ||
        catObj?.subCategories?.[idx]?.name ||
        'Photo';
    } else {
      const sub = catObj?.subCategories?.[idx];
      if (sub) {
        subcategoryName = sub.name;
      } else {
        // "Add Extra" slot logic - Use FULL catName and offset by required count
        const existingImages = sectionImages[catName] || [];
        const requiredCount = catObj?.subCategories?.length || 0;

        // Count images that follow the "SectionName - Image X" pattern
        const extraCount = existingImages.filter((img) =>
          img.subcategory?.includes(`${catName} - Image`)
        ).length;

        subcategoryName = `${catName} - Image ${requiredCount + extraCount + 1}`;
      }
    }

    // Get current location
    let coords = { latitude: 0, longitude: 0 };
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          const position = await new Promise<any>((resolve, reject) => {
            Geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 10000,
            });
          });
          coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
        }
      } else {
        // iOS handled by Info.plist, but we can check or just request
        const status = await Geolocation.requestAuthorization('whenInUse');
        if (status === 'granted') {
          const position = await new Promise<any>((resolve, reject) => {
            Geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 10000,
            });
          });
          coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
        }
      }
    } catch (error) {
      console.warn('Could not get location', error);
    }

    const formData = new FormData();
    formData.append('files', {
      uri: asset.uri,
      type: asset.type || 'image/jpeg',
      name: asset.fileName || `photo_${Date.now()}.jpg`,
    } as any);

    const imageInfo = [
      {
        category: catName,
        subcategory: subcategoryName,
        timestampTaken: new Date().toISOString(),
        coordinates: coords,
      },
    ];

    formData.append('images', JSON.stringify(imageInfo));
    formData.append('category', 'salesPhotos');

    const slotKey = `${groupName || catName}-${idx}`;
    setUploadingSlots((prev) => ({ ...prev, [slotKey]: true }));

    try {
      // 1. Optimistic Update: Add to local state immediately
      const optimisticImage: SectionImage = {
        uri: asset.uri,
        s3url: asset.uri, // Use URI as temporary S3 key
        index: idx,
        subcategory: subcategoryName,
        isOptimistic: true,
      };

      const currentImages = sectionImages[catName] || [];
      const updatedImages = {
        ...sectionImages,
        [catName]: [...currentImages, optimisticImage],
      };
      onSectionImagesChange(updatedImages);

      // 2. Perform actual upload
      await uploadImagesMutation.mutateAsync({ leadId: lead._id, formData });

      // 3. Silent refetch in background
      refetch();
    } catch (error) {
      console.error('Upload failed', error);
    } finally {
      setUploadingSlots((prev) => ({ ...prev, [slotKey]: false }));
    }
  };

  const handleDelete = async (catName: string, image: SectionImage) => {
    if (!lead?._id || !image.s3url) return;

    const payload = {
      s3urls: [image.s3url],
      category: 'salesPhotos',
    };

    try {
      await deleteImageMutation.mutateAsync({ leadId: lead._id, payload });
      await refetch();
    } catch (error) {
      console.error('Delete failed', error);
    }
  };

  return (
    <View className="px-4 py-2">
      <ResultLeadModal
        visible={showResultModal}
        onClose={() => setShowResultModal(false)}
        onSubmit={handleResultSubmit}
        initialResult={pendingResult}
        loading={submitJobMutation.isPending || resetLeadMutation.isPending}
      />

      {/* Image Preview Modal */}
      <Modal visible={previewImage !== null} transparent animationType="fade">
        <View className="flex-1 bg-black/90 items-center justify-center p-4">
          <TouchableOpacity
            onPress={() => setPreviewImage(null)}
            className="absolute top-12 right-6 p-2 bg-white/20 rounded-full z-10"
          >
            <Icon name="close" size={24} color="white" />
          </TouchableOpacity>
          {previewImage && (
            <LoadingImage
              uri={previewImage}
              className="w-full h-3/4 rounded-2xl"
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Status Banner */}
      {!isResulted ? (
        <View className="items-center justify-center py-4 mb-3 mt-3">
          <Icon name="file-document-edit-outline" size={32} color={colors.textSecondary} />
          <Text className="text-sm mt-2" style={{ color: colors.textSecondary }}>
            {lead?.status
              ? `Current Status: ${lead.status.toUpperCase()}`
              : 'No contract details available'}
          </Text>
        </View>
      ) : (
        <>
          {/* Resulted Status Header (Removed from top, moved to bottom per user request) */}

          {/* Contract Details Card */}
          {hasContract && (
            <View 
              className="bg-white rounded-2xl mb-6 shadow-sm border border-gray-100 overflow-hidden"
              style={{ backgroundColor: isDark ? colors.card : '#FFFFFF' }}
            >
              <View className="bg-[#4CBB17] py-2.5 flex-row items-center justify-center">
                <Icon name="check" size={16} color="white" />
                <Text className="text-white font-black text-xs ml-2 tracking-widest uppercase">
                  {getStatusLabel().toUpperCase()} - LEAD RESULTED
                </Text>
              </View>

              <View className="p-5">
                <View className="flex-row justify-between items-center mb-6">
                  <Text className="text-lg font-black text-[#1C252E]" style={{ color: colors.text }}>
                    Contract Details
                  </Text>
                  <TouchableOpacity 
                    onPress={() => navigation.navigate('JobBuilder', { lead })}
                    className="p-1"
                  >
                    <Icon name="pencil" size={20} color="#637381" />
                  </TouchableOpacity>
                </View>

                <View className="gap-4 mb-8">
                  <DetailRow 
                    label="Original Contract Price" 
                    value={`$${(Number(outcomeData?.originalContractPrice || outcomeData?.leadData?.originalContractPrice) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
                    color="#4CBB17"
                    isDark={isDark}
                  />
                  <DetailRow 
                    label="Down Payment" 
                    value={(outcomeData?.downPayment || outcomeData?.leadData?.downPayment) ? `$${Number(outcomeData?.downPayment || outcomeData?.leadData?.downPayment).toLocaleString()}` : '-'} 
                    isDark={isDark}
                  />
                  <DetailRow 
                    label="Remaining Balance" 
                    value={`$${(Number(outcomeData?.balance || outcomeData?.leadData?.balance) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
                    showCheck
                    isDark={isDark}
                  />
                  <DetailRow 
                    label="Install Date" 
                    value={(outcomeData?.installDate || outcomeData?.leadData?.installDate) ? new Date(outcomeData?.installDate || outcomeData?.leadData?.installDate).toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric', year: '2-digit' }) + ' • 8:00 AM - 12:00 PM' : 'Not Scheduled'} 
                    isDark={isDark}
                  />
                </View>

                <View className="h-[1px] bg-gray-100 mb-6" />

                {/* Agreement Documents Section */}
                <View className="mb-6">
                  <TouchableOpacity 
                    onPress={() => setExpandedDocs(prev => ({ ...prev, agreements: !prev.agreements }))}
                    className="flex-row items-center justify-between mb-4"
                  >
                    <Text className="text-sm font-bold text-[#1C252E]" style={{ color: colors.text }}>Agreement Documents</Text>
                    <View className="flex-row items-center gap-2">
                      <View className="bg-[#1C252E] px-2 py-0.5 rounded-md">
                        <Text className="text-[10px] font-black text-white">{resolvedDocuments.agreements.length} Files</Text>
                      </View>
                      <Icon name={expandedDocs.agreements ? "chevron-up" : "chevron-down"} size={20} color="#637381" />
                    </View>
                  </TouchableOpacity>

                  {expandedDocs.agreements && (
                    <View className="gap-3">
                      {resolvedDocuments.agreements.map((doc, idx) => (
                        <DocumentItem 
                          key={idx} 
                          doc={doc} 
                          isDark={isDark} 
                          colors={colors} 
                          onOpen={onOpenPdf} 
                          onImagePreview={setPreviewImage} 
                        />
                      ))}
                      <TouchableOpacity 
                        onPress={() => navigation.navigate('JobBuilder', { lead, initialTab: 'Summary' })}
                        className="border-2 border-dashed border-gray-200 rounded-xl py-4 items-center justify-center flex-row gap-2"
                      >
                        <Icon name="plus" size={20} color="#637381" />
                        <Text className="text-sm font-bold text-[#637381]">Add Document</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Order Sheets Section */}
                <View>
                  <TouchableOpacity 
                    onPress={() => setExpandedDocs(prev => ({ ...prev, orderSheets: !prev.orderSheets }))}
                    className="flex-row items-center justify-between mb-4"
                  >
                    <Text className="text-sm font-bold text-[#1C252E]" style={{ color: colors.text }}>Order Sheets</Text>
                    <View className="flex-row items-center gap-2">
                      <View className="bg-[#1C252E] px-2 py-0.5 rounded-md">
                        <Text className="text-[10px] font-black text-white">{resolvedDocuments.orderSheets.length} Files</Text>
                      </View>
                      <Icon name={expandedDocs.orderSheets ? "chevron-up" : "chevron-down"} size={20} color="#637381" />
                    </View>
                  </TouchableOpacity>

                  {expandedDocs.orderSheets && (
                    <View className="gap-3">
                      {resolvedDocuments.orderSheets.map((doc, idx) => (
                        <DocumentItem 
                          key={idx} 
                          doc={doc} 
                          isDark={isDark} 
                          colors={colors} 
                          onOpen={onOpenPdf} 
                          onImagePreview={setPreviewImage} 
                        />
                      ))}
                      <TouchableOpacity 
                        onPress={() => navigation.navigate('JobBuilder', { lead, initialTab: 'Summary' })}
                        className="border-2 border-dashed border-gray-200 rounded-xl py-4 items-center justify-center flex-row gap-2"
                      >
                        <Icon name="plus" size={20} color="#637381" />
                        <Text className="text-sm font-bold text-[#637381]">Add Document</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}
        </>
      )}

      {/* Progress Bar */}
      <View className="mb-6 px-1">
        <View className="flex-row items-center justify-between mb-3 px-1">
          <Text className="text-sm font-semibold text-text-primary">Progress</Text>
          <View className="flex-row gap-4">
            <Text className="text-[13px] font-semibold" style={{ color: colors.primary.main }}>
              {totalUploaded}/{displayTotal} Images
            </Text>
            <TouchableOpacity
              onPress={() => setExpandedAll(!expandedAll)}
              className="flex-row gap-1 items-center"
            >
              <Text className="text-[13px] font-semibold" style={{ color: colors.primary.main }}>
                {expandedAll ? 'Collapse All' : 'Expand All'}
              </Text>
              <Icon
                name={expandedAll ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.primary.main}
              />
            </TouchableOpacity>
          </View>
        </View>
        <View
          className="w-full h-3 rounded-full overflow-hidden"
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
      <View style={{ height: 20 }} />

      {/* Accordion Sections */}
      {IMAGE_CATEGORIES.map((section) => {
        const sectionTotal =
          section.subCategories?.reduce((s, sub) => s + (sub.required || 1), 0) || 0;
        return (
          <AccordionItem
            key={section.id}
            title={section.name}
            subCategories={section.subCategories}
            images={sectionImages[section.name] || []}
            onUpload={(idx: number, asset: any, groupName?: string) =>
              handleUpload(section.name, idx, asset, groupName)
            }
            onDelete={(image: SectionImage) => handleDelete(section.name, image)}
            onPreview={(uri: string) => setPreviewImage(uri)}
            forceExpanded={expandedAll}
            isUploading={uploadImagesMutation.isPending}
            uploadingSlots={uploadingSlots}
            cardGroups={section.cardGroups}
          />
        );
      })}

      {/* Divider */}
      <View style={{ height: 1, overflow: 'hidden', marginVertical: 8 }}>
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

      {/* Result Buttons */}
      {isResulted ? (
        <View 
          className="flex-row items-center justify-between px-4 py-3 rounded-xl mb-4 mt-2"
          style={{ backgroundColor: isDark ? '#FFFFFF08' : '#F4F6F8' }}
        >
          <Text className="text-sm font-bold text-gray-400" style={{ opacity: 0.8 }}>
            Resulted - {getStatusLabel()}
          </Text>
          <TouchableOpacity 
            onPress={() => onResultPress('reset')}
            className="w-10 h-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: isDark ? colors.surface : '#919EAB1F' }}
          >
            <Icon name="refresh" size={20} color={isDark ? '#919EAB' : '#637381'} />
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
            <Text className="text-white text-sm font-bold">No Demo</Text>
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
            <Text className="text-white text-sm font-bold">Not Hit</Text>
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
    </View>
  );
};

// ─── AccordionItem ────────────────────────────────────────────────────────────

interface AccordionItemProps {
  title: string;
  subCategories?: any[];
  cardGroups?: any[];
  images: SectionImage[];
  onUpload: (idx: number, asset: any, groupName?: string) => void;
  onDelete: (image: SectionImage) => void;
  onPreview: (uri: string) => void;
  forceExpanded: boolean;
  isUploading: boolean;
  uploadingSlots: { [key: string]: boolean };
}

const AccordionItem = ({
  title,
  subCategories,
  cardGroups,
  images,
  onUpload,
  onDelete,
  onPreview,
  forceExpanded,
  isUploading,
  uploadingSlots,
}: AccordionItemProps) => {
  const { colors, isDark } = useTheme();
  const [localExpanded, setLocalExpanded] = useState(false);
  const [pickerIndex, setPickerIndex] = useState<{ idx: number; groupName?: string } | null>(null);

  const expanded = forceExpanded || localExpanded;

  const openCamera = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }

    const target = pickerIndex;
    setPickerIndex(null);

    setTimeout(
      () => {
        launchCamera({ mediaType: 'photo', quality: 0.8 }, (response) => {
          if (response.assets?.[0]?.uri && target !== null) {
            onUpload(target.idx, response.assets[0], target.groupName);
          }
        });
      },
      Platform.OS === 'ios' ? 400 : 100
    );
  };

  const openGallery = () => {
    const target = pickerIndex;
    setPickerIndex(null);

    setTimeout(() => {
      launchImageLibrary({ mediaType: 'photo', quality: 0.8 }, (response) => {
        if (response.assets?.[0]?.uri && target !== null) {
          onUpload(target.idx, response.assets[0], target.groupName);
        }
      });
    }, 400);
  };

  const renderSlots = (subs: any[] = [], groupName?: string) => {
    const totalRequired = subs.length;

    // Get images belonging to this section/group
    const groupImages = groupName
      ? images.filter(
          (img) => img.subcategory === groupName || subs.some((s) => s.name === img.subcategory)
        )
      : images;

    // Separate required images from extra images
    const requiredImages = subs.map((sub) =>
      groupImages.find((img) => img.subcategory === sub.name)
    );
    const extraImages = groupImages.filter(
      (img) => !subs.some((sub) => sub.name === img.subcategory)
    );

    return (
      <View className="flex-row flex-wrap justify-between">
        {/* 1. Required Slots */}
        {subs.map((sub, idx) => {
          const existingImage = requiredImages[idx];
          return (
            <View
              key={`req-${idx}`}
              className="w-[48%] h-32 rounded-2xl border-2 border-dashed overflow-hidden mb-4 relative"
              style={{
                borderColor: existingImage ? 'transparent' : colors.primary.main,
                backgroundColor: isDark ? colors.primary.main + '10' : colors.primary.main + '05',
              }}
            >
              {existingImage ? (
                renderFilledSlot(existingImage, false)
              ) : (
                <TouchableOpacity
                  onPress={() => setPickerIndex({ idx, groupName })}
                  disabled={isUploading}
                  className="w-full h-full items-center justify-center p-2"
                >
                  {uploadingSlots[`${groupName || title}-${idx}`] ? (
                    <ActivityIndicator size="small" color={colors.primary.main} />
                  ) : (
                    <>
                      <View className="absolute inset-0">
                        {sub?.thumbnail && (JobDocsThumbnails as any)[sub.thumbnail] && (
                          <Image
                            source={(JobDocsThumbnails as any)[sub.thumbnail]}
                            className="w-full h-full"
                            style={{ opacity: 0.3 }}
                            resizeMode="cover"
                          />
                        )}
                      </View>
                      <Icon
                        name="camera-plus-outline"
                        size={32}
                        color={colors.text}
                        style={{ opacity: 0.5, marginBottom: 4 }}
                      />
                      <Text
                        className="text-[10px] font-black text-center mx-2"
                        style={{ color: colors.text }}
                      >
                        {sub.name}
                      </Text>
                      <Text className="text-[8px] font-bold text-slate-400 mt-1">CAPTURE</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* 2. Extra Uploaded Slots */}
        {extraImages.map((img, idx) => (
          <View
            key={`extra-filled-${idx}`}
            className="w-[48%] h-32 rounded-2xl border-2 border-dashed overflow-hidden mb-4 relative"
            style={{ borderColor: 'transparent' }}
          >
            {renderFilledSlot(img, true)}
          </View>
        ))}

        {/* 3. The Final "Add more" Slot */}
        <View
          className="w-[48%] h-32 rounded-2xl border-2 border-dashed overflow-hidden mb-4 relative"
          style={{
            borderColor: '#00AB55',
            backgroundColor: isDark ? '#00AB5510' : '#00AB5508',
          }}
        >
          <TouchableOpacity
            onPress={() => setPickerIndex({ idx: totalRequired + extraImages.length, groupName })}
            className="w-full h-full items-center justify-center"
          >
            <View className="w-10 h-10 rounded-full bg-[#00AB5520] items-center justify-center mb-2">
              <Icon name="plus" size={24} color="#00AB55" />
            </View>
            <Text className="text-[12px] font-black text-[#00AB55]">Add more</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderFilledSlot = (img: SectionImage, isExtra: boolean) => (
    <>
      <LoadingImage uri={img.uri} className="w-full h-full" resizeMode="cover" />
      <TouchableOpacity
        onPress={() => onPreview(img.uri)}
        className="absolute top-2 left-2 p-1.5 bg-black/40 rounded-full"
      >
        <Icon name="eye-outline" size={16} color="white" />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onDelete(img)}
        className="absolute top-2 right-2 p-1.5 bg-red-500/80 rounded-full"
      >
        <Icon name="trash-can-outline" size={16} color="white" />
      </TouchableOpacity>
      <View
        className={`absolute bottom-0 left-0 right-0 ${
          isExtra ? 'py-1.5 flex-row items-center justify-center gap-1' : 'p-1.5'
        } bg-black/40`}
      >
        <Text className="text-[9px] text-white font-bold text-center" numberOfLines={1}>
          {img.subcategory?.replace(/-/g, ' ')}
        </Text>
        {isExtra && <Icon name="chevron-down" size={10} color="white" />}
      </View>
    </>
  );

  const emptyRequiredCount = useMemo(() => {
    let empty = 0;
    const checkSubs = (subs: any[] = []) => {
      subs.forEach((sub) => {
        const hasImg = images.some((img) => img.subcategory === sub.name);
        if (!hasImg) empty += (sub.required || 1);
      });
    };
    if (cardGroups) cardGroups.forEach((g) => checkSubs(g.subCategories));
    else checkSubs(subCategories);
    return empty;
  }, [images, cardGroups, subCategories]);

  const displayTotal = images.length + emptyRequiredCount;

  return (
    <View className="mb-3">
      <GlobalModal
        visible={pickerIndex !== null}
        title="Upload Image"
        message={`Choose a photo for ${title}.`}
        type="info"
        onClose={() => setPickerIndex(null)}
        confirmText="Cancel"
      >
        <View className="flex-col w-full px-4 mt-4">
          <TouchableOpacity
            onPress={openCamera}
            className="py-4 px-4 rounded-2xl flex-row items-center border mb-3"
            style={{
              borderColor: colors.border,
              backgroundColor: isDark ? colors.surface : '#fff',
            }}
          >
            <Icon name="camera-outline" size={24} color={colors.text} className="mr-3" />
            <Text className="text-sm font-bold" style={{ color: colors.text }}>
              Take Photo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openGallery}
            className="py-4 px-4 rounded-2xl flex-row items-center border"
            style={{
              borderColor: colors.border,
              backgroundColor: isDark ? colors.surface : '#fff',
            }}
          >
            <Icon name="image-outline" size={24} color={colors.text} className="mr-3" />
            <Text className="text-sm font-bold" style={{ color: colors.text }}>
              Choose from Gallery
            </Text>
          </TouchableOpacity>
        </View>
      </GlobalModal>

      <TouchableOpacity
        onPress={() => setLocalExpanded(!localExpanded)}
        className="flex-row items-center justify-between px-3 py-2 rounded-md shadow-sm"
        style={{
          backgroundColor: colors.card,
          borderBottomLeftRadius: expanded ? 0 : 8,
          borderBottomRightRadius: expanded ? 0 : 8,
        }}
      >
        <Text className="text-sm font-semibold text-text-primary">{title}</Text>
        <View className="flex-row items-center">
          <View
            className="px-3 py-1 rounded-md mr-3"
            style={{ backgroundColor: isDark ? colors.surface : colors.text }}
          >
            <Text className="text-sm text-white font-semibold">
              {images.length} of {displayTotal} complete
            </Text>
          </View>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text} />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View
          className="p-4 border-l border-r border-b rounded-b-2xl"
          style={{
            borderColor: colors.border,
            backgroundColor: isDark ? colors.background : colors.surface,
          }}
        >
          {cardGroups
            ? cardGroups.map((group: any) => (
                <View key={group.id} className="mb-6">
                  <View className="flex-row items-center mb-4">
                    <View className="w-1 h-4 bg-green-500 rounded-full mr-2" />
                    <Text className="text-[11px] font-black text-slate-400 tracking-widest">
                      {group.name}
                    </Text>
                  </View>
                  {renderSlots(group.subCategories, group.name)}
                </View>
              ))
            : renderSlots(subCategories)}
        </View>
      )}
    </View>
  );
};

const loadedUris = new Set<string>();

const LoadingImage = React.memo(({ uri, className, style, resizeMode }: any) => {
  const [loading, setLoading] = useState(!loadedUris.has(uri));
  const { colors } = useTheme();

  return (
    <View className="w-full h-full justify-center items-center">
      {loading && (
        <View className="absolute z-10 w-full h-full justify-center items-center bg-black/5">
          <ActivityIndicator size="small" color={colors.primary.main} />
        </View>
      )}
      <Image
        source={{ uri }}
        style={style}
        className={className}
        resizeMode={resizeMode}
        onLoadStart={() => {
          if (!loadedUris.has(uri)) setLoading(true);
        }}
        onLoadEnd={() => {
          loadedUris.add(uri);
          setLoading(false);
        }}
        onError={() => setLoading(false)}
      />
    </View>
  );
});

const DetailRow = ({ label, value, color, showCheck, isDark }: any) => (
  <View className="flex-row justify-between items-center">
    <Text className="text-[13px] text-gray-500 font-medium">{label}</Text>
    <View className="flex-row items-center gap-2">
      <Text 
        className="text-[13px] font-black" 
        style={{ color: color || (isDark ? '#FFFFFF' : '#1C252E') }}
      >
        {value}
      </Text>
      {showCheck && (
        <View className="bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
          <Text className="text-[10px] font-black text-gray-600">CHECK</Text>
        </View>
      )}
    </View>
  </View>
);

const DocumentItem = ({ doc, isDark, colors, onOpen, onImagePreview }: any) => {
  const isImage = doc.uri?.toLowerCase().match(/\.(jpg|jpeg|png|webp|heic)$/) || !doc.uri?.toLowerCase().includes('.pdf');

  return (
    <TouchableOpacity 
      onPress={() => isImage ? onImagePreview?.(doc.uri) : onOpen?.(doc.uri, doc.name)}
      className="flex-row items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100"
      style={{ backgroundColor: isDark ? '#FFFFFF08' : '#F9FAFB' }}
    >
      <View className="flex-row items-center gap-3">
        <View className={`p-2 rounded-lg ${isImage ? 'bg-blue-50' : 'bg-red-50'}`}>
          <Icon 
            name={isImage ? "image-outline" : "file-pdf-box"} 
            size={24} 
            color={isImage ? "#2196F3" : "#FF5630"} 
          />
        </View>
        <View>
          <Text className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
            {isImage ? 'IMAGE' : 'PDF'} • {doc.size ? (doc.size / 1024).toFixed(0) + ' KB' : 'Size N/A'}
          </Text>
        </View>
      </View>
      <Icon name="eye-outline" size={20} color="#637381" />
    </TouchableOpacity>
  );
};
