import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { IMAGE_CATEGORIES } from '../../../constants/lead-center';

interface TagPhotoModalProps {
  visible: boolean;
  onClose: () => void;
  lead: any;
  taggingAsset: any;
  setTaggingAsset: (asset: any) => void;
  movingImage: any;
  setMovingImage: (img: any) => void;
  conflict: any;
  setConflict: (conflict: any) => void;
  activeTagTab: string;
  setActiveTagTab: (tab: string) => void;
  getImagesForSection: (sectionOrNameOrId: any) => any[];
  handleUpload: (catName: string, idx: number, asset: any, groupName?: string) => Promise<void> | void;
  handleDelete: (category: string, image: any) => Promise<void> | void;
  handleMovePhoto: (catName: string, idx: number, groupName?: string) => Promise<void> | void;
  isContinuousCamera: boolean;
  setIsContinuousCamera: (val: boolean) => void;
  reopenCameraContinuous: () => void;
  updateImagePositionMutation: any;
  refetch: () => Promise<void>;
  setShowManageModal: (show: boolean) => void;
  totalUploaded: number;
  displayTotal: number;
  insets: any;
  sectionImages: { [key: string]: any[] };
  onSectionImagesChange: (images: { [key: string]: any[] }) => void;
  getTabCounts: (tabId: string) => { captured: number; total: number };
  waitForPendingUpload: () => Promise<void>;
}

const TABS = [
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

export const TagPhotoModal = ({
  visible,
  onClose,
  lead,
  taggingAsset,
  setTaggingAsset,
  movingImage,
  setMovingImage,
  conflict,
  setConflict,
  activeTagTab,
  setActiveTagTab,
  getImagesForSection,
  handleUpload,
  handleDelete,
  handleMovePhoto,
  isContinuousCamera,
  setIsContinuousCamera,
  reopenCameraContinuous,
  updateImagePositionMutation,
  refetch,
  setShowManageModal,
  totalUploaded,
  displayTotal,
  insets,
  sectionImages,
  onSectionImagesChange,
  getTabCounts,
  waitForPendingUpload,
}: TagPhotoModalProps) => {
  const [showExtraPicker, setShowExtraPicker] = useState(false);
  const [showFullScreenPreview, setShowFullScreenPreview] = useState(false);

  useEffect(() => {
    if (!visible) {
      setConflict(null);
      setShowExtraPicker(false);
      setShowFullScreenPreview(false);
    }
  }, [visible, setConflict]);

  const renderConflictScreen = () => {
    if (!conflict) return null;

    const { slot, existingImage, asset } = conflict;

    const incomingUri = asset?.uri || asset?.image?.uri;
    const existingUri = existingImage?.uri;

    const handlePickDifferent = () => {
      setConflict(null);
    };

    const handleMoveOption = () => {
      if (movingImage) {
        const payload = {
          photoId: movingImage.image.id,
          currentPosition: {
            category: movingImage.categoryName,
            subcategory: movingImage.image.subcategory || '',
          },
          newPosition: {
            category: slot.categoryName,
            subcategory: slot.name,
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
            subcategory: slot.name,
            index: slot.idx,
          };

          const nextCurrentList = currentImgs.filter(
            (img) => img.id !== photoToMove.id && img.uri !== photoToMove.uri
          );
          const targetImgs =
            currentCategory === slot.categoryName
              ? nextCurrentList
              : sectionImages[slot.categoryName] || [];
          const nextTargetList = [...targetImgs, updatedPhoto];

          onSectionImagesChange({
            ...sectionImages,
            [currentCategory]: nextCurrentList,
            [slot.categoryName]: nextTargetList,
          });
        }

        // Run mutation asynchronously in the background, waiting for any pending upload first
        waitForPendingUpload().then(() => {
          updateImagePositionMutation.mutateAsync({ leadId: lead._id, payload })
            .then(() => refetch())
            .catch((error: any) => console.error('Failed to move photo in cascade background', error));
        });

        // Shift UI immediately to the displaced photo conflict/movement state
        setMovingImage({
          image: existingImage,
          categoryName: slot.categoryName,
        });
        setConflict(null);
      } else {
        // Trigger upload in background without blocking UI
        handleUpload(slot.categoryName, slot.idx, taggingAsset, slot.name);

        // Immediately update state to start moving the displaced image
        setMovingImage({
          image: existingImage,
          categoryName: slot.categoryName,
        });
        setTaggingAsset(null);
        setConflict(null);
      }
    };

    const handleKeepBothOption = () => {
      setShowExtraPicker(true);
    };

    const handleDiscardOption = async () => {
      Alert.alert(
        'Discard Existing Photo',
        'Are you sure you want to permanently delete the existing photo?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard & Replace',
            style: 'destructive',
            onPress: async () => {
              try {
                await handleDelete(slot.categoryName, existingImage);
                if (movingImage) {
                  await handleMovePhoto(slot.categoryName, slot.idx, slot.name);
                } else {
                  await handleUpload(slot.categoryName, slot.idx, taggingAsset, slot.name);
                  setTaggingAsset(null);
                }
                setConflict(null);
                onClose();
              } catch (error) {
                console.error('Discard option failed', error);
              }
            },
          },
        ]
      );
    };

    if (showExtraPicker) {
      const EXTRA_CATEGORIES = [
        { id: 'home', name: 'Home', label: 'Home', icon: 'home-outline' },
        { id: 'inspection', name: 'Inspection', label: 'Inspection', icon: 'layers-outline' },
        { id: 'measurements', name: 'Measurements', label: 'Measurements', icon: 'ruler' },
        { id: 'miscellaneous', name: 'Miscellaneous', label: 'Misc', icon: 'dots-horizontal' },
      ];

      const handleSelectExtraCategory = async (cat: any) => {
        const targetCatName = cat.name;
        const catObjLocal = IMAGE_CATEGORIES.find((c) => c.name === targetCatName);
        const existingImagesLocal = getImagesForSection(targetCatName);
        const requiredCountLocal = catObjLocal?.subCategories?.length || 0;
        const extraCountLocal = existingImagesLocal.filter((img) =>
          img.subcategory?.includes(`${targetCatName} - Image`) ||
          img.subcategory?.includes(`${targetCatName} - Extra`)
        ).length;

        if (movingImage) {
          await handleMovePhoto(targetCatName, requiredCountLocal + extraCountLocal, undefined);
        } else {
          await handleUpload(targetCatName, requiredCountLocal + extraCountLocal, taggingAsset, undefined);
          setTaggingAsset(null);
        }
        setConflict(null);
        setShowExtraPicker(false);
        onClose();
      };

      return (
        <View style={{ flex: 1, backgroundColor: '#0D1F1A', paddingTop: insets.top > 0 ? insets.top : 16, paddingBottom: insets.bottom }}>
          <View className="flex-row items-center justify-between px-4 pt-4 pb-4 border-b border-white/10 bg-[#0D1F1A]">
            <TouchableOpacity
              onPress={() => {
                onClose();
                setConflict(null);
                setShowExtraPicker(false);
              }}
            >
              <Icon name="close" size={24} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
            <Text className="text-white font-extrabold text-[10px] tracking-widest uppercase opacity-60">
              {`${totalUploaded}/${displayTotal} slots | ${totalUploaded} photos`}
            </Text>
          </View>

          <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
            <TouchableOpacity
              onPress={() => setShowExtraPicker(false)}
              className="flex-row items-center mb-4"
            >
              <Icon name="chevron-left" size={20} color="#72BD00" />
              <Text className="text-[#72BD00] font-black text-xs ml-1">Back</Text>
            </TouchableOpacity>

            <View className="flex-row items-center p-4 bg-white/5 border border-white/10 rounded-2xl mb-5">
              {incomingUri && (
                <Image
                  source={{ uri: incomingUri }}
                  className="w-14 h-14 rounded-xl mr-3 bg-black/40"
                  resizeMode="cover"
                />
              )}
              <View className="flex-1">
                <Text className="text-slate-400 font-extrabold text-[10px] tracking-wider uppercase mb-1">
                  TAGGING AS EXTRA
                </Text>
                <Text className="text-white font-bold text-sm">
                  Which category is this extra of?
                </Text>
              </View>
            </View>

            <View className="flex-col">
              {EXTRA_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => handleSelectExtraCategory(cat)}
                  className="flex-row items-center justify-between p-4 bg-[#132B23] border border-white/10 rounded-2xl mb-3"
                >
                  <View className="flex-row items-center">
                    <Icon name={cat.icon} size={20} color="rgba(255,255,255,0.6)" style={{ marginRight: 12 }} />
                    <Text className="text-white font-bold text-sm">{cat.label}</Text>
                  </View>
                  <View className="px-2.5 py-1.5 border border-[#72BD00]/30 bg-[#72BD00]/10 rounded-lg">
                    <Text className="text-[#72BD00] font-black text-[9px] tracking-wider">+ EXTRA</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: '#0D1F1A', paddingTop: insets.top > 0 ? insets.top : 16, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between px-4 pt-4 pb-4 border-b border-white/10 bg-[#0D1F1A]">
          <TouchableOpacity
            onPress={() => {
              onClose();
              setConflict(null);
              if (movingImage) {
                setShowManageModal(true);
              }
            }}
          >
            <Icon name="close" size={24} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          <Text className="text-white font-extrabold text-[10px] tracking-widest uppercase opacity-60">
            {`${totalUploaded}/${displayTotal} slots | ${totalUploaded} photos`}
          </Text>
        </View>

        <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
          <TouchableOpacity
            onPress={handlePickDifferent}
            className="flex-row items-center mb-4"
          >
            <Icon name="chevron-left" size={20} color="#72BD00" />
            <Text className="text-[#72BD00] font-black text-xs ml-1">Pick different slot</Text>
          </TouchableOpacity>

          <Text className="text-white/40 text-[10px] font-black tracking-widest uppercase mb-1">
            SLOT OCCUPIED
          </Text>
          <Text className="text-white font-black text-xl mb-1">
            {slot.name} already has a photo
          </Text>
          <Text className="text-white/50 text-xs mb-5">
            Choose what to do with the existing photo.
          </Text>

          <View className="flex-row gap-3 mb-6">
            <View className="flex-1 rounded-2xl overflow-hidden aspect-[4/3] bg-black/40 relative">
              {incomingUri && (
                <Image
                  source={{ uri: incomingUri }}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              )}
              <View className="absolute bottom-0 left-0 right-0 bg-[#72BD00] py-2 items-center justify-center">
                <Text className="text-white font-black text-[9px] uppercase tracking-wider">
                  INCOMING (will take slot)
                </Text>
              </View>
            </View>

            <View
              className="flex-1 rounded-2xl overflow-hidden aspect-[4/3] bg-black/40 relative border-2"
              style={{ borderColor: '#F59E0B' }}
            >
              {existingUri && (
                <Image
                  source={{ uri: existingUri }}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              )}
              <View className="absolute bottom-0 left-0 right-0 bg-[#F59E0B] py-2 items-center justify-center">
                <Text className="text-white font-black text-[9px] uppercase tracking-wider">
                  EXISTING (needs a home)
                </Text>
              </View>
            </View>
          </View>

          <View className="flex-col gap-3">
            <TouchableOpacity
              onPress={handleMoveOption}
              className="flex-row items-center p-4 rounded-2xl bg-green-500/10 border border-green-500/20"
            >
              <View className="w-10 h-10 rounded-xl bg-green-500/20 items-center justify-center mr-3">
                <Icon name="arrow-all" size={20} color="#72BD00" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-bold text-sm">Move it somewhere else</Text>
                <Text className="text-white/40 text-[10px]">Pick a new slot for the existing photo</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleKeepBothOption}
              className="flex-row items-center p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20"
            >
              <View className="w-10 h-10 rounded-xl bg-blue-500/20 items-center justify-center mr-3">
                <Icon name="content-copy" size={18} color="#3B82F6" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-bold text-sm">Keep both</Text>
                <Text className="text-white/40 text-[10px]">Existing photo stays here · incoming photo becomes an Extra</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleDiscardOption}
              className="flex-row items-center p-4 rounded-2xl bg-red-500/10 border border-red-500/20"
            >
              <View className="w-10 h-10 rounded-xl bg-red-500/20 items-center justify-center mr-3">
                <Icon name="delete-outline" size={20} color="#EF4444" />
              </View>
              <View className="flex-1">
                <Text className="text-[#EF4444] font-bold text-sm">Discard it</Text>
                <Text className="text-white/40 text-[10px]">Permanently delete the existing photo</Text>
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderTaggingSlots = () => {
    const catIds = getCategoryIdsForTab(activeTagTab);
    const slots: any[] = [];
    const isInspectionTab = activeTagTab === 'INSPECTION';

    catIds.forEach((catId) => {
      const section = IMAGE_CATEGORIES.find((c) => c.id === catId);
      if (!section) return;

      const addSubs = (subs: any[] = [], groupName?: string) => {
        subs.forEach((sub, idx) => {
          const sectionImgs = getImagesForSection(section);
          const existingImage = sectionImgs.find((img) => img.subcategory === sub.name);
          const inspectionImageCount = isInspectionTab
            ? sectionImgs.filter(
                (img) =>
                  img.subcategory === sub.name ||
                  img.subcategory?.startsWith(`${sub.name} - Extra`)
              ).length
            : 0;

          slots.push({
            id: sub.id,
            name: sub.name,
            categoryName: section.name,
            groupName,
            idx,
            existingImage,
            inspectionImageCount,
          });
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

    return (
      <ScrollView className="flex-1 px-4 mt-2">
        {isInspectionTab && (
          <View className="mb-3 px-1 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 flex-row items-center">
            <Icon name="information-outline" size={14} color="#60A5FA" style={{ marginRight: 6 }} />
            <Text className="text-blue-400 text-[10px] font-bold flex-1">
              Inspection slots accumulate — each tap adds a new photo without replacing existing ones.
            </Text>
          </View>
        )}
        <View className="flex-row flex-wrap justify-between pb-10">
          {slots.map((slot, i) => {
            const isInspFilled = isInspectionTab && slot.inspectionImageCount > 0;
            const isMoveSource = !!(
              movingImage &&
              slot.categoryName?.toLowerCase() === movingImage.categoryName?.toLowerCase() &&
              slot.name?.trim().toLowerCase() === movingImage.image?.subcategory?.trim().toLowerCase()
            );

            return (
              <TouchableOpacity
                key={`${slot.categoryName}-${slot.id}-${i}`}
                onPress={() => {
                  if (isMoveSource) {
                    onClose();
                    setMovingImage(null);
                    setShowManageModal(true);
                    return;
                  }
                  if (isInspectionTab) {
                    if (movingImage) {
                      const payload = {
                        photoId: movingImage.image.id,
                        currentPosition: {
                          category: movingImage.categoryName,
                          subcategory: movingImage.image.subcategory || '',
                        },
                        newPosition: {
                          category: slot.categoryName,
                          subcategory: slot.name,
                        },
                      };
                      updateImagePositionMutation.mutateAsync({ leadId: lead._id, payload }).then(() => refetch());
                      onClose();
                      setMovingImage(null);
                      setShowManageModal(true);
                    } else {
                      onClose();
                      setTaggingAsset(null);
                      handleUpload(slot.categoryName, slot.idx, taggingAsset, slot.name);
                      if (isContinuousCamera) {
                        setTimeout(() => { reopenCameraContinuous(); }, 500);
                      }
                    }
                  } else if (slot.existingImage) {
                    setConflict({
                      slot,
                      existingImage: slot.existingImage,
                      asset: taggingAsset || movingImage,
                    });
                  } else {
                    if (movingImage) {
                      handleMovePhoto(slot.categoryName, slot.idx, slot.name);
                      onClose();
                    } else {
                      onClose();
                      setTaggingAsset(null);
                      handleUpload(slot.categoryName, slot.idx, taggingAsset, slot.name);
                      if (isContinuousCamera) {
                        setTimeout(() => {
                          reopenCameraContinuous();
                        }, 500);
                      }
                    }
                  }
                }}
                style={{
                  backgroundColor: isMoveSource
                    ? 'rgba(245, 158, 11, 0.15)'
                    : isInspFilled
                    ? 'rgba(59, 130, 246, 0.15)'
                    : slot.existingImage
                    ? 'rgba(114, 189, 0, 0.2)'
                    : 'rgba(255, 255, 255, 0.05)',
                  borderColor: isMoveSource
                    ? '#F59E0B'
                    : isInspFilled
                    ? '#3B82F6'
                    : slot.existingImage
                    ? '#72BD00'
                    : 'rgba(255, 255, 255, 0.1)',
                  borderWidth: 1.5,
                  position: 'relative',
                }}
                className="w-[48%] py-3 px-2 rounded-xl mb-3 items-center justify-center min-h-[50px]"
              >
                <Text
                  className={
                    isMoveSource
                      ? "text-[#F59E0B] text-[11px] font-black text-center"
                      : "text-white text-[11px] font-black text-center"
                  }
                  numberOfLines={2}
                >
                  {slot.name}
                </Text>
                {isInspectionTab ? (
                  <View className="flex-row items-center mt-1">
                    <Icon name="plus-circle-outline" size={10} color="#60A5FA" style={{ marginRight: 3 }} />
                    <Text className="text-[9px] font-black text-blue-400 tracking-widest">
                      {slot.inspectionImageCount > 0 ? `ADD  (${slot.inspectionImageCount})` : 'ADD FIRST'}
                    </Text>
                  </View>
                ) : isMoveSource ? (
                  <Text className="text-[8px] font-black text-[#F59E0B] mt-1 tracking-widest text-center">
                    FROM
                  </Text>
                ) : (
                  slot.existingImage && (
                    <Text className="text-[8px] font-black text-[#72BD00] mt-1 tracking-widest text-center">
                      REPLACE
                    </Text>
                  )
                )}
              </TouchableOpacity>
            );
          })}

          {catIds.map((catId) => {
            const section = IMAGE_CATEGORIES.find((c) => c.id === catId);
            if (!section) return null;

            const existingImages = getImagesForSection(section);
            const requiredCount = section.subCategories?.length || 0;
            const extraCount = existingImages.filter((img) =>
              img.subcategory?.includes(`${section.name} - Image`) ||
              img.subcategory?.includes(`${section.name} - Extra`)
            ).length;

            return (
              <TouchableOpacity
                key={`extra-tag-${catId}`}
                onPress={() => {
                  const asset = taggingAsset;
                  if (movingImage) {
                    handleMovePhoto(section.name, requiredCount + extraCount);
                    onClose();
                  } else {
                    onClose();
                    setTaggingAsset(null);
                    handleUpload(section.name, requiredCount + extraCount, asset);
                    if (isContinuousCamera) {
                      setTimeout(() => {
                        reopenCameraContinuous();
                      }, 500);
                    }
                  }
                }}
                style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  borderColor: 'rgba(245, 158, 11, 0.3)',
                  borderWidth: 1.5,
                }}
                className="w-[48%] py-3 px-2 rounded-xl mb-3 items-center justify-center min-h-[50px]"
              >
                <Text className="text-[#F59E0B] text-[11px] font-black text-center">
                  + Extra {section.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const activePreviewUri = taggingAsset
    ? (taggingAsset.uri || taggingAsset.image?.uri)
    : (movingImage ? movingImage.image.uri : null);

  const handleQuickDiscard = () => {
    if (taggingAsset) {
      setTaggingAsset(null);
      onClose();
      setIsContinuousCamera(false);
      setTimeout(() => {
        reopenCameraContinuous();
      }, 300);
    } else if (movingImage) {
      setMovingImage(null);
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      {conflict ? (
        renderConflictScreen()
      ) : (
        <View style={{ flex: 1, backgroundColor: '#0D1F1A', paddingTop: insets.top > 0 ? insets.top : 16, paddingBottom: insets.bottom }}>
          <View className="flex-row items-center justify-between px-4 pt-4 pb-4 border-b border-white/10 bg-[#0D1F1A]">
            <TouchableOpacity
              onPress={() => {
                onClose();
                setTaggingAsset(null);
                setMovingImage(null);
                setIsContinuousCamera(false);
                if (movingImage) {
                  setShowManageModal(true);
                }
              }}
            >
              <Icon name="close" size={24} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
            <Text className="text-white font-extrabold text-[10px] tracking-widest uppercase opacity-60">
              {totalUploaded}/{displayTotal} SLOTS | {totalUploaded} {totalUploaded === 1 ? 'PHOTO' : 'PHOTOS'}
            </Text>
          </View>

          {/* Tabs bar */}
          <View className="flex-row border-b border-white/5 bg-[#0D1F1A]">
            {TABS.map((tab) => {
              const isActive = activeTagTab === tab.id;
              const { captured, total } = getTabCounts(tab.id);
              return (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => setActiveTagTab(tab.id)}
                  className="flex-1 py-3 items-center justify-center"
                  style={{ borderBottomWidth: isActive ? 2 : 0, borderBottomColor: '#72BD00' }}
                >
                  <Icon
                    name={tab.icon}
                    size={20}
                    color={isActive ? '#72BD00' : 'rgba(255,255,255,0.4)'}
                  />
                  <Text
                    style={{
                      fontSize: 8,
                      fontWeight: '800',
                      color: isActive ? '#72BD00' : 'rgba(255,255,255,0.4)',
                      marginTop: 2,
                    }}
                  >
                    {tab.label}
                  </Text>
                  <Text
                    style={{
                      fontSize: 8,
                      fontWeight: '800',
                      color: isActive ? '#72BD00' : 'rgba(255,255,255,0.3)',
                      marginTop: 1,
                    }}
                  >
                    {captured}/{total}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {movingImage && (
            <View className="mx-4 mt-3 mb-1 p-3.5 rounded-xl border border-[#72BD00]/30 bg-[#72BD00]/10">
              <Text className="text-[#72BD00] font-black text-[11px] uppercase tracking-wider mb-1">
                RE-TAGGING
              </Text>
              <Text className="text-white/80 text-xs">
                Moving photo from <Text className="text-white font-extrabold">{movingImage.image.subcategory || ''}</Text>. Pick a new slot.
              </Text>
            </View>
          )}

          {/* Active Image Preview Block */}
          {activePreviewUri && (
            <TouchableOpacity
              onPress={() => setShowFullScreenPreview(true)}
              className="h-[180px] w-full bg-black relative justify-center items-center overflow-hidden"
            >
              <Image
                source={{ uri: activePreviewUri }}
                className="w-full h-full absolute"
                resizeMode="cover"
              />
              <View className="absolute inset-0 bg-black/25" />

              <View className="absolute bottom-4 left-4 bg-black/50 px-2 py-1 rounded">
                <Text className="text-white text-[10px] font-black uppercase tracking-wider">
                  Tag this photo below
                </Text>
              </View>

              <View className="absolute bottom-4 right-4 bg-black/50 px-2 py-1 rounded">
                <Text className="text-white text-[10px] font-black uppercase tracking-wider">
                  TAP TO EXPAND
                </Text>
              </View>

              <TouchableOpacity
                onPress={handleQuickDiscard}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/60 items-center justify-center"
                style={{ zIndex: 999 }}
              >
                <Icon name="delete-outline" size={18} color="#EF4444" />
              </TouchableOpacity>
            </TouchableOpacity>
          )}

          {/* Slots scroll view */}
          {renderTaggingSlots()}
        </View>
      )}

      {/* Full Screen Preview Modal */}
      <Modal visible={showFullScreenPreview} animationType="fade" transparent={false}>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top > 0 ? insets.top : 16, paddingBottom: insets.bottom }}>
          <View className="flex-row items-center px-4 py-4 border-b border-white/10 bg-black">
            <TouchableOpacity
              onPress={() => setShowFullScreenPreview(false)}
              className="p-2"
            >
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text className="text-white text-base font-bold ml-2">Preview Image</Text>
          </View>

          <View className="flex-1 justify-center items-center bg-black">
            {activePreviewUri && (
              <Image
                source={{ uri: activePreviewUri }}
                className="w-full h-full"
                resizeMode="contain"
              />
            )}
          </View>

          <View className="flex-row px-4 py-6 justify-between gap-4 bg-black">
            <TouchableOpacity
              onPress={() => {
                setShowFullScreenPreview(false);
                handleQuickDiscard();
              }}
              className="flex-1 h-14 rounded-2xl items-center justify-center border-2 border-red-500/50 bg-red-500/10"
            >
              <Text className="text-red-500 font-extrabold text-xs uppercase tracking-wider">
                Discard & Retake
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowFullScreenPreview(false);
              }}
              className="flex-1 h-14 rounded-2xl items-center justify-center bg-green-600"
            >
              <Text className="text-white font-extrabold text-xs uppercase tracking-wider">
                Keep & Tag
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};
