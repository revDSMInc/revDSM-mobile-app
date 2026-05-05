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
    return acc + (section.subCategories?.reduce((s, sub) => s + (sub.required || 1), 0) || 0);
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

  const handleUpload = async (catName: string, idx: number, asset: any) => {
    if (!lead?._id) return;

    const catObj = IMAGE_CATEGORIES.find((c) => c.name === catName);
    const sub = catObj?.subCategories?.[idx];
    // Use name as requested in latest example (e.g. "Left Side")
    const subcategoryName = sub?.name || `Extra ${catName}`;

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

    const slotKey = `${catName}-${idx}`;
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
            onUpload={(idx: number, asset: any) => handleUpload(section.name, idx, asset)}
            onDelete={(image: SectionImage) => handleDelete(section.name, image)}
            onPreview={(uri: string) => setPreviewImage(uri)}
            forceExpanded={expandedAll}
            isUploading={uploadImagesMutation.isPending}
            uploadingSlots={uploadingSlots}
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

const AccordionItem = ({
  title,
  subCategories,
  images,
  onUpload,
  onDelete,
  onPreview,
  forceExpanded,
  isUploading,
  uploadingSlots,
}: any) => {
  const { colors, isDark } = useTheme();
  const [localExpanded, setLocalExpanded] = useState(false);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  const expanded = forceExpanded || localExpanded;
  const total = subCategories?.length || 0;
  const displaySlots = Math.max(total, images.length) + 1;
  const displayTotal = Math.max(total, images.length);

  const openCamera = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }

    const targetIndex = pickerIndex;
    setPickerIndex(null);

    setTimeout(
      () => {
        launchCamera({ mediaType: 'photo', quality: 0.8 }, (response) => {
          if (response.assets?.[0]?.uri && targetIndex !== null) {
            onUpload(targetIndex, response.assets[0]);
          }
        });
      },
      Platform.OS === 'ios' ? 400 : 100
    );
  };

  const openGallery = () => {
    const targetIndex = pickerIndex;
    setPickerIndex(null);

    setTimeout(() => {
      launchImageLibrary({ mediaType: 'photo', quality: 0.8 }, (response) => {
        if (response.assets?.[0]?.uri && targetIndex !== null) {
          onUpload(targetIndex, response.assets[0]);
        }
      });
    }, 400);
  };

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
          <View className="flex-row flex-wrap justify-between">
            {[...Array(displaySlots)].map((_, idx) => {
              const existingImage = images.find((img: any) => img.index === idx);
              const isAddMoreSlot = idx >= total && !existingImage;
              const slotKey = `${title}-${idx}`;

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

                      {/* Top Left Eye Icon */}
                      <TouchableOpacity
                        onPress={() => onPreview(existingImage.uri)}
                        className="absolute top-2 left-2 p-1.5 bg-black/40 rounded-full"
                      >
                        <Icon name="eye-outline" size={16} color="white" />
                      </TouchableOpacity>

                      {/* Top Right Delete Icon */}
                      <TouchableOpacity
                        onPress={() => onDelete(existingImage)}
                        className="absolute top-2 right-2 p-1.5 bg-red-500/80 rounded-full"
                      >
                        <Icon name="trash-can-outline" size={16} color="white" />
                      </TouchableOpacity>

                      {/* Bottom Info Overlay */}
                      <View className="absolute bottom-0 left-0 right-0 p-1.5 bg-black/40">
                        <Text
                          className="text-[9px] text-white font-bold text-center"
                          numberOfLines={1}
                        >
                          {existingImage.subcategory?.replace(/-/g, ' ')}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setPickerIndex(idx)}
                      disabled={isUploading}
                      className="w-full h-full items-center justify-center p-2"
                    >
                      {uploadingSlots[`${title}-${idx}`] ? (
                        <View className="items-center justify-center w-full h-full bg-black/5">
                          <ActivityIndicator size="small" color={colors.primary.main} />
                          <Text className="text-[9px] font-black uppercase text-gray-500 mt-2">
                            Uploading...
                          </Text>
                          <View className="w-16 h-1 bg-gray-200 rounded-full mt-2 overflow-hidden">
                            <View
                              className="h-full bg-green-500"
                              style={{ width: '60%' }} // Indeterminate look
                            />
                          </View>
                        </View>
                      ) : (
                        <>
                          <View className="absolute inset-0 items-center justify-center opacity-20">
                            {subCategories[idx]?.thumbnail && (JobDocsThumbnails as any)[subCategories[idx].thumbnail] && (
                              <Image
                                source={(JobDocsThumbnails as any)[subCategories[idx].thumbnail]}
                                className="w-20 h-20"
                                resizeMode="contain"
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
                            className="text-[10px] font-black uppercase text-center mx-2"
                            style={{ color: isAddMoreSlot ? '#00AB55' : colors.text }}
                          >
                            {isAddMoreSlot ? 'Add Extra' : (subCategories[idx]?.name || `${title} ${idx + 1}`)}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
};
