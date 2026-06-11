import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LoadingImage } from './JobDocsUtils';
import { ImageSlideshowModal } from './ImageSlideshowModal';

interface ManagePhotosModalProps {
  visible: boolean;
  onClose: () => void;
  lead: any;
  insets: any;
  navigation: any;
  refetch: () => Promise<void>;
  activeManageTab: string;
  setActiveManageTab: (tab: string) => void;
  isAnnotationSelectMode: boolean;
  setIsAnnotationSelectMode: (mode: boolean) => void;
  selectedAnnotationPhotos: any[];
  setSelectedAnnotationPhotos: React.Dispatch<React.SetStateAction<any[]>>;
  getTabCounts: (tabId: string) => { captured: number; total: number };
  getRequiredSlotsForActiveTab: () => any[];
  getExtraFilledSlotsForTab: (tabId: string) => any[];
  getAnnotatedSlotsForTab: (tabId: string) => any[];
  toggleSelectPhoto: (img: any, category: string) => void;
  handleOpenPreviewTab: (uri: string) => void;
  setMovingImage: (img: any) => void;
  setShowTagModal: (show: boolean) => void;
  setShowManageModal?: (show: boolean) => void;
  handleDelete: (category: string, image: any) => void;
  getSubcategoryLabel: (cat: string, sub: string) => string;
}

const MANAGE_TABS = [
  { id: 'HOME', label: 'HOME', icon: 'home-outline' },
  { id: 'INSPECTION', label: 'INSPECTION', icon: 'magnify' },
  { id: 'MEASURE', label: 'MEASURE', icon: 'ruler' },
  { id: 'ROOFLINE', label: 'ROOFLINE', icon: 'home-roof' },
  { id: 'MISC', label: 'MISC', icon: 'dots-horizontal' },
];

export const ManagePhotosModal = ({
  visible,
  onClose,
  lead,
  insets,
  navigation,
  refetch,
  activeManageTab,
  setActiveManageTab,
  isAnnotationSelectMode,
  setIsAnnotationSelectMode,
  selectedAnnotationPhotos,
  setSelectedAnnotationPhotos,
  getTabCounts,
  getRequiredSlotsForActiveTab,
  getExtraFilledSlotsForTab,
  getAnnotatedSlotsForTab,
  toggleSelectPhoto,
  handleOpenPreviewTab,
  setMovingImage,
  setShowTagModal,
  setShowManageModal,
  handleDelete,
  getSubcategoryLabel,
}: ManagePhotosModalProps) => {

  // Local preview slideshow state
  const [localPreviewImages, setLocalPreviewImages] = React.useState<{ uri: string; label: string }[]>([]);
  const [localPreviewIndex, setLocalPreviewIndex] = React.useState<number>(0);
  const [localIsPlaying, setLocalIsPlaying] = React.useState<boolean>(false);
  const [localIsFullscreen, setLocalIsFullscreen] = React.useState<boolean>(false);

  const handleLocalPreview = (clickedImageUri: string) => {
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

    setLocalPreviewImages(allImages.length > 0 ? allImages : [{ uri: clickedImageUri, label: 'Image' }]);
    setLocalPreviewIndex(index >= 0 ? index : 0);
    setLocalIsPlaying(false);
    setLocalIsFullscreen(false);
  };

  const handleClose = () => {
    if (isAnnotationSelectMode) {
      setIsAnnotationSelectMode(false);
      setSelectedAnnotationPhotos([]);
    } else {
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={{ flex: 1, backgroundColor: '#0D1F1A', paddingTop: insets.top > 0 ? insets.top : 16, paddingBottom: insets.bottom }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-4 pb-4 border-b border-white/10 bg-[#0D1F1A]">
          <TouchableOpacity onPress={handleClose}>
            <Icon name={isAnnotationSelectMode ? "arrow-left" : "close"} size={24} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          
          <Text className="text-white font-extrabold text-sm">
            {isAnnotationSelectMode ? 'Select Photos' : 'Manage Photos'}
          </Text>
          
          <TouchableOpacity
            onPress={() => {
              if (isAnnotationSelectMode) {
                setIsAnnotationSelectMode(false);
                setSelectedAnnotationPhotos([]);
              } else {
                setIsAnnotationSelectMode(true);
                setSelectedAnnotationPhotos([]);
              }
            }}
            className="flex-row items-center gap-1 bg-white/10 px-3 py-1.5 rounded-full border border-white/5"
          >
            <Icon
              name={isAnnotationSelectMode ? "pencil-off" : "pencil"}
              size={14}
              color={isAnnotationSelectMode ? "#EF4444" : "#72BD00"}
            />
            <Text
              style={{ fontSize: 10, fontWeight: '800', color: isAnnotationSelectMode ? '#EF4444' : '#72BD00' }}
            >
              {isAnnotationSelectMode ? 'Cancel' : 'Draw'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab row */}
        {!isAnnotationSelectMode && (
          <View className="flex-row border-b border-white/5 bg-[#0D1F1A]">
            {MANAGE_TABS.map((tab) => {
              const isActive = activeManageTab === tab.id;
              const { captured, total } = getTabCounts(tab.id);
              return (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => setActiveManageTab(tab.id)}
                  className="flex-1 py-3 items-center justify-center relative"
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
                    numberOfLines={1}
                  >
                    {tab.label}
                  </Text>
                  <Text
                    className="text-[8px] mt-0.5"
                    style={{ color: isActive ? '#72BD00' : 'rgba(255,255,255,0.3)' }}
                  >
                    {captured}/{total}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Photos scroll list */}
        <ScrollView className="flex-1 px-4 pt-2" contentContainerStyle={{ paddingBottom: 80 }}>
          {getRequiredSlotsForActiveTab().filter(slot => slot.image !== undefined).length === 0 &&
           getExtraFilledSlotsForTab(activeManageTab).length === 0 &&
           getAnnotatedSlotsForTab(activeManageTab).length === 0 ? (
            <View
              style={{
                borderStyle: 'dashed',
                borderWidth: 1.5,
                borderColor: 'rgba(114, 189, 0, 0.3)',
                borderRadius: 16,
                paddingVertical: 36,
                paddingHorizontal: 24,
                marginTop: 32,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#72BD00', fontWeight: '900', fontSize: 14, textAlign: 'center' }}>
                No photos in this section yet.
              </Text>
              <Text style={{ color: 'rgba(255, 255, 255, 0.4)', fontWeight: 'bold', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                Use the tabs above to browse other sections.
              </Text>
            </View>
          ) : (
            <View>
              {/* 1. Required Slots */}
              <View className="flex-row flex-wrap justify-between">
                {getRequiredSlotsForActiveTab().filter(slot => slot.image !== undefined).map((slot, idx) => (
                  <View key={`req-manage-${idx}`} className="w-[48%] mb-4">
                    <Text className="text-white text-[12px] font-bold mb-1.5" numberOfLines={1}>
                      {getSubcategoryLabel(slot.categoryName, slot.image!.subcategory || slot.name).replace('(Annotated)', '').trim()}
                    </Text>
                    
                    <View className="bg-[#12241F] border border-white/5 rounded-2xl p-3">
                      <TouchableOpacity
                        onPress={() => {
                          if (isAnnotationSelectMode) {
                            toggleSelectPhoto(slot.image!, slot.categoryName);
                          } else {
                            handleLocalPreview(slot.image!.uri);
                          }
                        }}
                        className="w-full aspect-[4/3] rounded-xl overflow-hidden relative border border-white/10 bg-black/20"
                      >
                        <LoadingImage uri={slot.image!.uri} style={{ width: '100%', height: '100%' }} resizeMode="cover" />

                        {/* Uploading spinner for optimistic (pending) images */}
                        {slot.image!.isOptimistic && (
                          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                            <ActivityIndicator size="small" color="#72BD00" />
                            <Text style={{ color: '#72BD00', fontWeight: '900', fontSize: 10, marginTop: 6 }}>Uploading...</Text>
                          </View>
                        )}

                        {/* Selection dot — top-right corner only */}
                        {isAnnotationSelectMode && (
                          <View style={{ position: 'absolute', top: 6, right: 6 }}>
                            <View
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 11,
                                borderWidth: 2,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: selectedAnnotationPhotos.some(p => p.uri === slot.image!.uri)
                                  ? '#72BD00'
                                  : 'rgba(0,0,0,0.4)',
                                borderColor: selectedAnnotationPhotos.some(p => p.uri === slot.image!.uri)
                                  ? '#72BD00'
                                  : 'rgba(255,255,255,0.6)',
                              }}
                            >
                              {selectedAnnotationPhotos.some(p => p.uri === slot.image!.uri) && (
                                <Icon name="check" size={13} color="white" />
                              )}
                            </View>
                          </View>
                        )}
                      </TouchableOpacity>

                      {!isAnnotationSelectMode && (
                        <View className="flex-row items-center mt-3">
                          <TouchableOpacity
                            onPress={() => {
                              setMovingImage({
                                image: slot.image!,
                                categoryName: slot.categoryName
                              });
                              onClose();
                              setShowTagModal(true);
                            }}
                            className="flex-1 border border-[#72BD00] rounded-xl py-2 flex-row items-center justify-center mr-2"
                          >
                            <Icon name="subdirectory-arrow-left" size={14} color="#72BD00" style={{ marginRight: 4 }} />
                            <Text className="text-[#72BD00] font-bold text-[11px]">Move</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => {
                              Alert.alert(
                                'Delete Image',
                                'Are you sure want to delete this image?',
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Delete',
                                    style: 'destructive',
                                    onPress: () => handleDelete(slot.categoryName, slot.image!),
                                  },
                                ]
                              );
                            }}
                            className="border border-[#EF4444]/40 rounded-xl p-2 items-center justify-center"
                          >
                            <Icon name="trash-can-outline" size={14} color="#EF4444" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>

              {/* 2. Extra Photos */}
              {getExtraFilledSlotsForTab(activeManageTab).length > 0 && (
                <View className="mt-4 border-t border-white/10 pt-4">
                  <View className="flex-row items-center mb-4">
                    <View className="w-1.5 h-4 bg-[#72BD00] rounded-full mr-2" />
                    <Text className="text-white/60 font-black text-xs tracking-wider uppercase">+ EXTRAS</Text>
                  </View>

                  <View className="bg-[#12241F] border border-white/5 rounded-2xl p-4 mb-6">
                    <View className="flex-row items-center justify-between mb-4 px-1">
                      <Text className="text-white font-extrabold text-sm">Extra photos</Text>
                      <Text className="text-white/40 font-bold text-xs">{getExtraFilledSlotsForTab(activeManageTab).length} photos</Text>
                    </View>

                    <View className="flex-row flex-wrap justify-between">
                      {getExtraFilledSlotsForTab(activeManageTab).map((slot, idx) => {
                        const isSelected = selectedAnnotationPhotos.some(
                          (p) => p.s3url === slot.image.s3url || p.uri === slot.image.uri
                        );
                        return (
                          <View key={`${slot.image.s3url || slot.image.uri}-${idx}`} className="w-[48%] mb-4">
                            <Text className="text-white text-[12px] font-bold mb-1.5" numberOfLines={1}>
                              {getSubcategoryLabel(slot.categoryName, slot.image.subcategory || '').replace('(Annotated)', '').trim()}
                            </Text>

                            <View className="bg-[#0b1714] border border-white/5 rounded-2xl p-2.5">
                              <TouchableOpacity
                                onPress={() => {
                                  if (isAnnotationSelectMode) {
                                    toggleSelectPhoto(slot.image, slot.categoryName);
                                  } else {
                                    handleLocalPreview(slot.image.uri);
                                  }
                                }}
                                className="w-full aspect-[4/3] rounded-xl overflow-hidden relative border border-white/10 bg-black/20"
                              >
                                <LoadingImage uri={slot.image.uri} style={{ width: '100%', height: '100%' }} resizeMode="cover" />

                                {/* Uploading spinner for optimistic (pending) images */}
                                {slot.image.isOptimistic && (
                                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                                    <ActivityIndicator size="small" color="#72BD00" />
                                    <Text style={{ color: '#72BD00', fontWeight: '900', fontSize: 10, marginTop: 6 }}>Uploading...</Text>
                                  </View>
                                )}

                                {isAnnotationSelectMode && (
                                  <View style={{ position: 'absolute', top: 6, right: 6 }}>
                                    <View
                                      style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: 11,
                                        borderWidth: 2,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        backgroundColor: isSelected ? '#72BD00' : 'rgba(0,0,0,0.4)',
                                        borderColor: isSelected ? '#72BD00' : 'rgba(255,255,255,0.6)',
                                      }}
                                    >
                                      {isSelected && (
                                        <Icon name="check" size={13} color="white" />
                                      )}
                                    </View>
                                  </View>
                                )}
                              </TouchableOpacity>

                              {!isAnnotationSelectMode && (
                                <View className="flex-row items-center mt-2.5">
                                  <TouchableOpacity
                                    onPress={() => {
                                      setMovingImage({
                                        image: slot.image,
                                        categoryName: slot.categoryName
                                      });
                                      onClose();
                                      setShowTagModal(true);
                                    }}
                                    className="flex-1 border border-[#72BD00] rounded-xl py-2 flex-row items-center justify-center mr-2"
                                  >
                                    <Icon name="subdirectory-arrow-left" size={12} color="#72BD00" style={{ marginRight: 4 }} />
                                    <Text className="text-[#72BD00] font-bold text-[10px]">Move</Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    onPress={() => {
                                      Alert.alert(
                                        'Delete Image',
                                        'Are you sure want to delete this image?',
                                        [
                                          { text: 'Cancel', style: 'cancel' },
                                          {
                                            text: 'Delete',
                                            style: 'destructive',
                                            onPress: () => handleDelete(slot.categoryName, slot.image),
                                          },
                                        ]
                                      );
                                    }}
                                    className="border border-[#EF4444]/40 rounded-xl p-2 items-center justify-center"
                                  >
                                    <Icon name="trash-can-outline" size={12} color="#EF4444" />
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              )}

              {/* 3. Annotated Photos */}
              {getAnnotatedSlotsForTab(activeManageTab).length > 0 && (
                <View className="mt-2 border-t border-white/10 pt-4">
                  <View className="flex-row items-center mb-4">
                    <View className="w-1.5 h-4 bg-[#4CBB17] rounded-full mr-2" />
                    <Text className="text-white/60 font-black text-xs tracking-wider uppercase">ANNOTATED PHOTOS</Text>
                  </View>

                  <View className="bg-[#12241F] border border-white/5 rounded-2xl p-4 mb-6">
                    <View className="flex-row items-center justify-between mb-4 px-1">
                      <Text className="text-white font-extrabold text-sm">Annotated drawings</Text>
                      <Text className="text-white/40 font-bold text-xs">{getAnnotatedSlotsForTab(activeManageTab).length} photos</Text>
                    </View>

                    <View className="flex-row flex-wrap justify-between">
                      {getAnnotatedSlotsForTab(activeManageTab).map((slot, idx) => {
                        const isSelected = selectedAnnotationPhotos.some(
                          (p) => p.s3url === slot.image.s3url || p.uri === slot.image.uri
                        );
                        return (
                          <View key={`${slot.image.s3url || slot.image.uri}-${idx}`} className="w-[48%] mb-4">
                            <Text className="text-white text-[12px] font-bold mb-1.5" numberOfLines={1}>
                              {getSubcategoryLabel(slot.categoryName, slot.image.subcategory || '').replace('(Annotated)', '').trim()}
                            </Text>

                            <View className="bg-[#0b1714] border border-white/5 rounded-2xl p-2.5">
                              <TouchableOpacity
                                onPress={() => {
                                  if (isAnnotationSelectMode) {
                                    toggleSelectPhoto(slot.image, slot.categoryName);
                                  } else {
                                    handleLocalPreview(slot.image.uri);
                                  }
                                }}
                                className="w-full aspect-[4/3] rounded-xl overflow-hidden relative border border-white/10 bg-black/20"
                              >
                                <LoadingImage uri={slot.image.uri} style={{ width: '100%', height: '100%' }} resizeMode="cover" />

                                {/* Uploading spinner for optimistic (pending) images */}
                                {slot.image.isOptimistic && (
                                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                                    <ActivityIndicator size="small" color="#72BD00" />
                                    <Text style={{ color: '#72BD00', fontWeight: '900', fontSize: 10, marginTop: 6 }}>Uploading...</Text>
                                  </View>
                                )}

                                {isAnnotationSelectMode && (
                                  <View style={{ position: 'absolute', top: 6, right: 6 }}>
                                    <View
                                      style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: 11,
                                        borderWidth: 2,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        backgroundColor: isSelected ? '#72BD00' : 'rgba(0,0,0,0.4)',
                                        borderColor: isSelected ? '#72BD00' : 'rgba(255,255,255,0.6)',
                                      }}
                                    >
                                      {isSelected && (
                                        <Icon name="check" size={13} color="white" />
                                      )}
                                    </View>
                                  </View>
                                )}
                              </TouchableOpacity>

                              {!isAnnotationSelectMode && (
                                <View className="flex-row items-center mt-2.5">
                                  <TouchableOpacity
                                    onPress={() => {
                                      Alert.alert(
                                        'Delete Image',
                                        'Are you sure want to delete this image?',
                                        [
                                          { text: 'Cancel', style: 'cancel' },
                                          {
                                            text: 'Delete',
                                            style: 'destructive',
                                            onPress: () => handleDelete(slot.categoryName, slot.image),
                                          },
                                        ]
                                      );
                                    }}
                                    className="flex-1 border border-[#EF4444]/40 rounded-xl py-2 flex-row items-center justify-center"
                                  >
                                    <Icon name="trash-can-outline" size={12} color="#EF4444" style={{ marginRight: 4 }} />
                                    <Text className="text-[#EF4444] font-bold text-[10px]">Delete</Text>
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Bottom CTA for annotation selection mode */}
        {isAnnotationSelectMode && selectedAnnotationPhotos.length > 0 && (
          <View className="px-4 py-4 border-t border-white/10 bg-[#0D1F1A]">
            <TouchableOpacity
              onPress={() => {
                onClose();
                navigation.navigate('ImageAnnotation', {
                  selectedPhotos: selectedAnnotationPhotos,
                  lead: lead,
                  onSaveSuccess: () => {
                    setSelectedAnnotationPhotos([]);
                    setIsAnnotationSelectMode(false);
                    refetch();
                    setShowManageModal?.(true);
                  },
                  onCancel: () => {
                    setSelectedAnnotationPhotos([]);
                    setIsAnnotationSelectMode(false);
                    setShowManageModal?.(true);
                  }
                });
              }}
              className="w-full py-4 rounded-xl items-center justify-center bg-[#72BD00]"
            >
              <Text className="text-white font-extrabold text-sm uppercase tracking-wider">
                Annotate ({selectedAnnotationPhotos.length})
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Local Image Slideshow Overlay */}
      <ImageSlideshowModal
        visible={localPreviewImages.length > 0}
        onClose={() => setLocalPreviewImages([])}
        previewImages={localPreviewImages}
        setPreviewImages={setLocalPreviewImages}
        previewIndex={localPreviewIndex}
        setPreviewIndex={setLocalPreviewIndex}
        isPlaying={localIsPlaying}
        setIsPlaying={setLocalIsPlaying}
        isFullscreen={localIsFullscreen}
        setIsFullscreen={setLocalIsFullscreen}
        insets={insets}
        asOverlay={true}
      />
    </Modal>
  );
};
