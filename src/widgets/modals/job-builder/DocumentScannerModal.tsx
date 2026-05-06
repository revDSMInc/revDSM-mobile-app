import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentScanner from 'react-native-document-scanner-plugin';
import { LeadService } from '../../../services/api/leads';

interface DocumentScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (images: any[]) => void;
  title: string;
  leadId: string;
  category: 'agreement' | 'orderSheet';
}

export const DocumentScannerModal = ({
  visible,
  onClose,
  onSave,
  title,
  leadId,
  category,
}: DocumentScannerModalProps) => {
  const { colors, isDark } = useTheme();
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const startScan = async () => {
    try {
      const { scannedImages } = await DocumentScanner.scanDocument({
        maxNumDocuments: 1,
        letUserAdjustCrop: true,
      } as any);

      if (scannedImages && scannedImages.length > 0) {
        setScannedPages([...scannedPages, ...scannedImages]);
      }
    } catch (error) {
      console.error('Scanning error:', error);
      Alert.alert('Scanning Error', 'An error occurred while trying to scan the document.');
    }
  };

  const removePage = (index: number) => {
    const newPages = [...scannedPages];
    newPages.splice(index, 1);
    setScannedPages(newPages);
  };

  const handleSave = async () => {
    if (scannedPages.length === 0) return;

    setLoading(true);
    try {
      const uploadedFiles = [];

      for (let i = 0; i < scannedPages.length; i++) {
        const uri = scannedPages[i];
        const fileName = `scanned_${category}_${Date.now()}_${i}.jpg`;

        const formData = new FormData();
        formData.append('file', {
          uri: uri,
          name: fileName,
          type: 'image/jpeg',
        } as any);
        formData.append('category', category);

        const response = await LeadService.uploadImages(leadId, formData);
        const result = response.data?.data || response.data;

        if (result?.[0]?.url || result?.url) {
          uploadedFiles.push({
            uri: result?.[0]?.url || result?.url,
            name: fileName,
            serverId: result?.[0]?._id || result?._id,
            isNew: true,
          });
        } else {
          // Fallback to local URI if upload didn't return a URL (should not happen in prod)
          uploadedFiles.push({ uri, name: fileName });
        }
      }

      onSave(uploadedFiles);
      setScannedPages([]);
      onClose();
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Upload Error', 'Failed to store documents in S3. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 bg-black/90">
        {/* Header */}
        <View className="flex-row justify-between items-center px-6 pt-14 pb-4 bg-slate-900">
          <TouchableOpacity onPress={onClose} className="p-2">
            <Icon name="close" size={24} color="white" />
          </TouchableOpacity>
          <Text className="text-white font-black  text-sm tracking-widest">{title}</Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={scannedPages.length === 0 || loading}
            className={`px-4 py-2 rounded-full ${
              scannedPages.length > 0 ? 'bg-green-500' : 'bg-slate-700'
            }`}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white font-black  text-[10px]">
                Save ({scannedPages.length})
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {scannedPages.length === 0 ? (
          <View className="flex-1 items-center justify-center px-10">
            <View className="w-24 h-24 rounded-full bg-slate-800 items-center justify-center mb-6">
              <Icon name="file-document-outline" size={48} color={colors.primary.main} />
            </View>
            <Text className="text-white text-xl font-black text-center  mb-2">Native Scanner</Text>
            <Text className="text-slate-400 text-center text-xs font-medium leading-5 mb-10  tracking-widest">
              Capture documents with automatic edge detection and corner highlighting
            </Text>

            <TouchableOpacity
              onPress={startScan}
              className="w-full h-16 bg-white rounded-3xl items-center justify-center flex-row"
            >
              <Icon name="camera" size={24} color="black" />
              <Text className="ml-3 font-black  text-sm">Open Native Scanner</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="flex-1">
            <ScrollView className="flex-1 px-4 py-6">
              <View className="flex-row flex-wrap justify-between">
                {scannedPages.map((uri, idx) => (
                  <View
                    key={idx}
                    className="w-[48%] aspect-[3/4] rounded-2xl overflow-hidden mb-4 bg-slate-800 border border-slate-700"
                  >
                    <Image source={{ uri }} className="w-full h-full" resizeMode="cover" />
                    <View className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded-lg">
                      <Text className="text-white text-[10px] font-black">PAGE {idx + 1}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => removePage(idx)}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500 items-center justify-center"
                    >
                      <Icon name="trash-can-outline" size={16} color="white" />
                    </TouchableOpacity>
                  </View>
                ))}

                {/* Add More Button */}
                <TouchableOpacity
                  onPress={startScan}
                  className="w-[48%] aspect-[3/4] rounded-2xl border-2 border-dashed border-slate-700 items-center justify-center mb-4"
                >
                  <Icon name="plus-circle-outline" size={32} color="#475569" />
                  <Text className="mt-2 text-slate-500 font-black  text-[10px]">Add Page</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}

        {/* Bottom Tip */}
        <View className="px-8 py-6 bg-slate-900 flex-row items-center">
          <Icon name="shield-check" size={20} color="#22c55e" />
          <Text className="ml-3 text-[10px] font-bold text-slate-400  leading-4 flex-1">
            The native scanner will automatically detect borders. You can manually adjust corners if
            needed.
          </Text>
        </View>
      </View>
    </Modal>
  );
};
