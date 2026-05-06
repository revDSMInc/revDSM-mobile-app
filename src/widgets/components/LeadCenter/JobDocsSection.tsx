import React, { useState } from 'react';
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

interface SectionImage {
  uri: string;
  index: number;
  s3url?: string;
  id?: string;
  subcategory?: string;
}

interface JobDocsSectionProps {
  lead: any;
  sectionImages: { [key: string]: SectionImage[] };
  onSectionImagesChange: (images: { [key: string]: SectionImage[] }) => void;
  refetch: () => Promise<void>;
}

export const JobDocsSection = ({
  lead,
  sectionImages,
  onSectionImagesChange,
  refetch,
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
  const progressPercent = totalRequired > 0 ? (totalUploaded / totalRequired) * 100 : 0;

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
      subcategoryName = sub?.name || `Extra ${catName}`;
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
      await uploadImagesMutation.mutateAsync({ leadId: lead._id, formData });
      await refetch();
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
            <Image
              source={{ uri: previewImage }}
              className="w-full h-3/4 rounded-2xl"
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Status Banner */}
      <View className="items-center justify-center py-4 mb-3 mt-3">
        <Icon name="file-document-edit-outline" size={32} color={colors.textSecondary} />
        <Text className="text-sm mt-2" style={{ color: colors.textSecondary }}>
          {lead?.status
            ? `Current Status: ${lead.status.toUpperCase()}`
            : 'No contract details available'}
        </Text>
      </View>

      {/* Progress Bar */}
      <View className="mb-6 px-1">
        <View className="flex-row items-center justify-between mb-3 px-1">
          <Text className="text-sm font-semibold text-text-primary">Progress</Text>
          <View className="flex-row gap-4">
            <Text className="text-[13px] font-semibold" style={{ color: colors.primary.main }}>
              {totalUploaded}/{totalRequired} Images
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
    const total = subs.length;
    const groupImages = groupName
      ? images.filter(
          (img) => img.subcategory === groupName || subs.some((s) => s.name === img.subcategory)
        )
      : images;

    const displaySlots = Math.max(total, groupImages.length) + 1;

    return (
      <View className="flex-row flex-wrap justify-between">
        {[...Array(displaySlots)].map((_, idx) => {
          const sub = subs[idx];
          const existingImage = groupImages.find((img: any) =>
            sub ? img.subcategory === sub.name : img.index === idx && !img.subcategory
          );
          const isAddMoreSlot = idx >= total && !existingImage;

          return (
            <View
              key={idx}
              className="w-[48%] h-32 rounded-2xl border-2 border-dashed overflow-hidden mb-4 relative"
              style={{
                borderColor: existingImage
                  ? 'transparent'
                  : isAddMoreSlot
                  ? '#00AB55'
                  : colors.primary.main,
                backgroundColor: isDark
                  ? isAddMoreSlot
                    ? '#00AB5510'
                    : colors.primary.main + '10'
                  : isAddMoreSlot
                  ? '#00AB5508'
                  : colors.primary.main + '05',
              }}
            >
              {existingImage ? (
                <>
                  <Image
                    source={{ uri: existingImage.uri }}
                    className="w-full h-full"
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    onPress={() => onPreview(existingImage.uri)}
                    className="absolute top-2 left-2 p-1.5 bg-black/40 rounded-full"
                  >
                    <Icon name="eye-outline" size={16} color="white" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onDelete(existingImage)}
                    className="absolute top-2 right-2 p-1.5 bg-red-500/80 rounded-full"
                  >
                    <Icon name="trash-can-outline" size={16} color="white" />
                  </TouchableOpacity>
                  <View className="absolute bottom-0 left-0 right-0 p-1.5 bg-black/40">
                    <Text className="text-[9px] text-white font-bold text-center" numberOfLines={1}>
                      {existingImage.subcategory?.replace(/-/g, ' ')}
                    </Text>
                  </View>
                </>
              ) : (
                <TouchableOpacity
                  onPress={() => setPickerIndex({ idx, groupName })}
                  disabled={isUploading}
                  className="w-full h-full items-center justify-center p-2"
                >
                  {uploadingSlots[`${groupName || title}-${idx}`] ? (
                    <View className="items-center justify-center w-full h-full bg-black/5">
                      <ActivityIndicator size="small" color={colors.primary.main} />
                    </View>
                  ) : (
                    <>
                      <View className="absolute inset-0">
                        {sub?.thumbnail && (JobDocsThumbnails as any)[sub.thumbnail] && (
                          <Image
                            source={(JobDocsThumbnails as any)[sub.thumbnail]}
                            className="w-full h-full"
                            style={{ opacity: isDark ? 0.2 : 0.1 }}
                            resizeMode="cover"
                          />
                        )}
                      </View>
                      <Icon
                        name={isAddMoreSlot ? 'image-plus' : 'camera-plus-outline'}
                        size={32}
                        color={isAddMoreSlot ? '#00AB55' : colors.text}
                        style={{ opacity: 0.5, marginBottom: 8 }}
                      />
                      <Text
                        className="text-[10px] font-black text-center mx-2"
                        style={{ color: isAddMoreSlot ? '#00AB55' : colors.text }}
                      >
                        {isAddMoreSlot ? 'Add Extra' : sub?.name || `${title} ${idx + 1}`}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  const displayTotal = cardGroups
    ? cardGroups.reduce((acc, g) => acc + (g.subCategories?.length || 0), 0)
    : subCategories?.length || 0;

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
