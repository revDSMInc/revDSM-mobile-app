import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  TextInput,
  StyleSheet,
  Dimensions,
  PanResponder,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { WebView } from 'react-native-webview';
import ReactNativeBlobUtil from 'react-native-blob-util';

const WebViewComponent = WebView as any;
import Geolocation from 'react-native-geolocation-service';
import { useUploadImagesMutation } from '../../hooks/useLeadMutation';
import { useRoute, useNavigation } from '@react-navigation/native';
import { IMAGE_CATEGORIES } from '../../constants/lead-center';

// Subcomponents
import { AnnotationCanvas } from '../../widgets/components/LeadCenter/AnnotationCanvas';
import { AnnotationTextToolbar } from '../../widgets/components/LeadCenter/AnnotationTextToolbar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SectionImage {
  uri: string;
  index: number;
  s3url?: string;
  id?: string;
  subcategory?: string;
  categoryName?: string;
  isOptimistic?: boolean;
}

export default function ImageAnnotationScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { selectedPhotos = [], lead, onSaveSuccess, onCancel } = route.params || {};

  const uploadImagesMutation = useUploadImagesMutation();

  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const currentPhoto = selectedPhotos[activeImageIndex];
  const photoId = currentPhoto ? (currentPhoto.id || currentPhoto.uri) : '';
  const [activeTool, setActiveTool] = useState<'none' | 'zoom' | 'draw' | 'text'>('none');
  
  // Sub-modes settings
  const [activeDrawTool, setActiveDrawTool] = useState<'pen' | 'eraser'>('pen');
  const [activeColor, setActiveColor] = useState<string>('#4CBB17'); // Green
  const [activeSize, setActiveSize] = useState<number>(5);
  const [showColorPanel, setShowColorPanel] = useState<boolean>(false);

  // Canvas stroke & text maps keyed by photo ID
  const [strokesMap, setStrokesMap] = useState<Record<string, any[]>>({});
  const [textsMap, setTextsMap] = useState<Record<string, any[]>>({});
  const [historyMap, setHistoryMap] = useState<Record<string, any[]>>({});
  const [redoMap, setRedoMap] = useState<Record<string, any[]>>({});

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [containerLayout, setContainerLayout] = useState<{ width: number; height: number } | null>(null);
  const [pendingTextPos, setPendingTextPos] = useState<{ px: number; py: number } | null>(null);

  useEffect(() => {
    if (currentPhoto?.uri) {
      Image.getSize(currentPhoto.uri, (w, h) => {
        setImageSize({ width: w, height: h });
      }, (error) => {
        console.warn('Failed to get image size', error);
        setImageSize({ width: 4, height: 3 }); // fallback
      });
    }
  }, [currentPhoto?.uri]);

  useEffect(() => {
    const backAction = () => {
      handleBackPress();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [strokesMap, textsMap, onCancel]);

  const canvasLayout = useMemo(() => {
    if (!containerLayout || !imageSize) {
      const w = SCREEN_WIDTH - 32;
      return { width: w, height: w * 0.75 };
    }
    const containerRatio = containerLayout.width / containerLayout.height;
    const imageRatio = imageSize.width / imageSize.height;

    if (imageRatio > containerRatio) {
      const w = containerLayout.width;
      const h = w / imageRatio;
      return { width: w, height: h };
    } else {
      const h = containerLayout.height;
      const w = h * imageRatio;
      return { width: w, height: h };
    }
  }, [containerLayout, imageSize]);

  // Current active drawing stroke
  const [activeStroke, setActiveStroke] = useState<any | null>(null);
  const activeStrokeRef = useRef<any | null>(null);
  const startXRef = useRef<number>(0);
  const startYRef = useRef<number>(0);

  // Backup arrays for transaction cancel/commit
  const backupStrokesRef = useRef<any[]>([]);
  const backupTextsRef = useRef<any[]>([]);

  // Text inputs & edit
  const [showTextDialog, setShowTextDialog] = useState<boolean>(false);
  const [textInputValue, setTextInputValue] = useState<string>('');
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [showStylePanel, setShowStylePanel] = useState<boolean>(false);
  const [showFontDropdown, setShowFontDropdown] = useState<boolean>(false);

  useEffect(() => {
    setSelectedTextId(null);
    setShowStylePanel(false);
    setShowFontDropdown(false);
  }, [activeImageIndex]);

  // Get current active photo data
  const currentStrokes = strokesMap[photoId] || [];
  const currentTexts = textsMap[photoId] || [];

  // Helper to map category/subcategory
  const getSubcategoryLabel = (catNameOrId: string, subIdOrName: string) => {
    if (!subIdOrName) return '';
    const category = IMAGE_CATEGORIES.find(
      (c) => c.id === catNameOrId || c.name === catNameOrId
    );
    if (!category) return subIdOrName;
    const sub = category.subCategories?.find(
      (s) => s.id === subIdOrName || s.name === subIdOrName
    );
    if (sub) return sub.name;
    const group = category.cardGroups?.find(g => g.name === subIdOrName || g.id === subIdOrName);
    if (group) return group.name;
    return subIdOrName;
  };

  const getPathData = (points: { px: number; py: number }[]) => {
    if (points.length === 0) return '';
    const first = points[0];
    let d = `M ${first.px * canvasLayout.width} ${first.py * canvasLayout.height}`;
    if (points.length === 1) {
      d += ` L ${(first.px * canvasLayout.width) + 0.1} ${first.py * canvasLayout.height}`;
    } else {
      for (let i = 1; i < points.length; i++) {
        const pt = points[i];
        d += ` L ${pt.px * canvasLayout.width} ${pt.py * canvasLayout.height}`;
      }
    }
    return d;
  };

  // Latest state reference for PanResponder callbacks
  const stateRef = useRef({
    activeTool,
    activeDrawTool,
    activeColor,
    activeSize,
    photoId,
    canvasLayout,
  });

  useEffect(() => {
    stateRef.current = {
      activeTool,
      activeDrawTool,
      activeColor,
      activeSize,
      photoId,
      canvasLayout,
    };
  });

  // PanResponder to capture drawing strokes & text placement taps
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        const { activeTool } = stateRef.current;
        return activeTool === 'draw' || activeTool === 'text';
      },
      onMoveShouldSetPanResponder: () => {
        const { activeTool } = stateRef.current;
        return activeTool === 'draw';
      },
      onPanResponderGrant: (evt, gestureState) => {
        const { activeTool, activeDrawTool, activeColor, activeSize, photoId, canvasLayout } = stateRef.current;
        if (activeTool === 'draw') {
          if (!photoId) return;
          const { locationX, locationY } = evt.nativeEvent;
          startXRef.current = locationX;
          startYRef.current = locationY;
          const px = locationX / canvasLayout.width;
          const py = locationY / canvasLayout.height;
          const newStroke = {
            id: Date.now(),
            points: [{ px, py }],
            color: activeDrawTool === 'eraser' ? 'transparent' : activeColor,
            width: activeSize,
            isEraser: activeDrawTool === 'eraser',
          };
          activeStrokeRef.current = newStroke;
          setActiveStroke(newStroke);
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const { activeTool, canvasLayout } = stateRef.current;
        if (activeTool === 'draw' && activeStrokeRef.current) {
          const curX = startXRef.current + gestureState.dx;
          const curY = startYRef.current + gestureState.dy;
          const px = Math.max(0, Math.min(1, curX / canvasLayout.width));
          const py = Math.max(0, Math.min(1, curY / canvasLayout.height));
          const updatedStroke = {
            ...activeStrokeRef.current,
            points: [...activeStrokeRef.current.points, { px, py }],
          };
          activeStrokeRef.current = updatedStroke;
          setActiveStroke(updatedStroke);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { activeTool, photoId, canvasLayout } = stateRef.current;
        if (activeTool === 'draw') {
          const finishedStroke = activeStrokeRef.current;
          if (finishedStroke) {
            setStrokesMap((sm) => {
              const existing = sm[photoId] || [];
              return { ...sm, [photoId]: [...existing, finishedStroke] };
            });
            setHistoryMap((hm) => {
              const existing = hm[photoId] || [];
              const actionItem = { id: finishedStroke.id, type: 'stroke', data: finishedStroke };
              return { ...hm, [photoId]: [...existing, actionItem] };
            });
            setRedoMap((rm) => ({ ...rm, [photoId]: [] }));
          }
          activeStrokeRef.current = null;
          setActiveStroke(null);
        } else if (activeTool === 'text') {
          const { locationX, locationY } = evt.nativeEvent;
          const px = locationX / canvasLayout.width;
          const py = locationY / canvasLayout.height;
          setEditingTextId(null);
          setTextInputValue('');
          setPendingTextPos({ px, py });
          setShowTextDialog(true);
        }
      },
    })
  ).current;

  // Undo/Redo/Reset Actions
  const handleUndo = () => {
    const history = historyMap[photoId] || [];
    if (history.length === 0) return;

    const action = history[history.length - 1];
    setHistoryMap((hm) => ({ ...hm, [photoId]: history.slice(0, -1) }));

    setRedoMap((rm) => {
      const existing = rm[photoId] || [];
      return { ...rm, [photoId]: [...existing, action] };
    });

    if (action.type === 'stroke') {
      setStrokesMap((sm) => {
        const existing = sm[photoId] || [];
        return { ...sm, [photoId]: existing.filter((s) => s.id !== action.id) };
      });
    } else if (action.type === 'text') {
      setTextsMap((tm) => {
        const existing = tm[photoId] || [];
        return { ...tm, [photoId]: existing.filter((t) => t.id !== action.id) };
      });
    }
  };

  const handleRedo = () => {
    const redo = redoMap[photoId] || [];
    if (redo.length === 0) return;

    const action = redo[redo.length - 1];
    setRedoMap((rm) => ({ ...rm, [photoId]: redo.slice(0, -1) }));

    setHistoryMap((hm) => {
      const existing = hm[photoId] || [];
      return { ...hm, [photoId]: [...existing, action] };
    });

    if (action.type === 'stroke') {
      setStrokesMap((sm) => {
        const existing = sm[photoId] || [];
        return { ...sm, [photoId]: [...existing, action.data] };
      });
    } else if (action.type === 'text') {
      setTextsMap((tm) => {
        const existing = tm[photoId] || [];
        return { ...tm, [photoId]: [...existing, action.data] };
      });
    }
  };

  const handleResetCanvas = () => {
    setStrokesMap((sm) => ({ ...sm, [photoId]: [] }));
    setTextsMap((tm) => ({ ...tm, [photoId]: [] }));
    setHistoryMap((hm) => ({ ...hm, [photoId]: [] }));
    setRedoMap((rm) => ({ ...rm, [photoId]: [] }));
  };

  const updateSelectedText = (properties: Partial<any>) => {
    if (!selectedTextId) return;
    setTextsMap((tm) => {
      const existing = tm[photoId] || [];
      const updated = existing.map((t) =>
        t.id === selectedTextId ? { ...t, ...properties } : t
      );
      return { ...tm, [photoId]: updated };
    });
  };

  const handleDeleteTextNote = (id: string) => {
    setTextsMap((tm) => {
      const existing = tm[photoId] || [];
      return { ...tm, [photoId]: existing.filter((t) => t.id !== id) };
    });
    setHistoryMap((hm) => {
      const existing = hm[photoId] || [];
      return { ...hm, [photoId]: existing.filter((a) => a.id !== id) };
    });
  };

  // Text Actions
  const handleAddTextPress = () => {
    setEditingTextId(null);
    setTextInputValue('');
    setShowTextDialog(true);
  };

  const handleTextSubmit = () => {
    if (!textInputValue.trim()) return;

    if (editingTextId) {
      setTextsMap((tm) => {
        const existing = tm[photoId] || [];
        const updated = existing.map((t) =>
          t.id === editingTextId ? { ...t, text: textInputValue } : t
        );
        return { ...tm, [photoId]: updated };
      });
    } else {
      const newText = {
        id: `text-${Date.now()}`,
        text: textInputValue,
        px: pendingTextPos ? pendingTextPos.px : 0.35,
        py: pendingTextPos ? pendingTextPos.py : 0.45,
        color: activeColor || '#42A5F5',
        fontSize: 24,
        opacity: 1.0,
        fontStyle: 'regular',
      };
      setTextsMap((tm) => {
        const existing = tm[photoId] || [];
        return { ...tm, [photoId]: [...existing, newText] };
      });
      setHistoryMap((hm) => {
        const existing = hm[photoId] || [];
        const actionItem = { id: newText.id, type: 'text', data: newText };
        return { ...hm, [photoId]: [...existing, actionItem] };
      });
      setRedoMap((rm) => ({ ...rm, [photoId]: [] }));
    }
    setShowTextDialog(false);
    setEditingTextId(null);
    setTextInputValue('');
    setPendingTextPos(null);
  };

  const handleTextPress = (text: any) => {
    setEditingTextId(text.id);
    setTextInputValue(text.text);
    setShowTextDialog(true);
  };

  const handleMoveText = (id: string, newPx: number, newPy: number) => {
    setTextsMap((tm) => {
      const existing = tm[photoId] || [];
      const updated = existing.map((t) =>
        t.id === id ? { ...t, px: Math.max(0, Math.min(1, newPx)), py: Math.max(0, Math.min(1, newPy)) } : t
      );
      return { ...tm, [photoId]: updated };
    });
  };

  // Main UI Mode Switchers
  const enterDrawMode = () => {
    backupStrokesRef.current = [...currentStrokes];
    setActiveTool('draw');
  };

  const commitDrawMode = () => {
    setActiveTool('none');
  };

  const cancelDrawMode = () => {
    setStrokesMap((sm) => ({ ...sm, [photoId]: backupStrokesRef.current }));
    setActiveTool('none');
  };

  const enterTextMode = () => {
    backupTextsRef.current = [...currentTexts];
    setActiveTool('text');
  };

  const commitTextMode = () => {
    setActiveTool('none');
  };

  const cancelTextMode = () => {
    setTextsMap((tm) => ({ ...tm, [photoId]: backupTextsRef.current }));
    setActiveTool('none');
  };

  // Image Saving & Rasterization Queue
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveProgressText, setSaveProgressText] = useState<string>('');
  const webViewRef = useRef<any>(null);
  
  const [mountWebView, setMountWebView] = useState<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMountWebView(true);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const saveQueueRef = useRef<any[]>([]);
  const saveResultsRef = useRef<any[]>([]);

  const getBase64FromUri = async (uri: string): Promise<string> => {
    if (uri.startsWith('file://')) {
      const cleanPath = uri.replace('file://', '');
      const data = await ReactNativeBlobUtil.fs.readFile(cleanPath, 'base64');
      return `data:image/jpeg;base64,${data}`;
    }
    const res = await ReactNativeBlobUtil.config({ fileCache: true }).fetch('GET', uri, {
      'Accept-Encoding': 'identity',
    });
    const path = res.path();
    const base64Data = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
    await ReactNativeBlobUtil.fs.unlink(path);
    return `data:image/jpeg;base64,${base64Data}`;
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    saveResultsRef.current = [];
    
    const photosToProcess = selectedPhotos.filter((photo: any) => {
      const pId = photo.id || photo.uri;
      const strokes = strokesMap[pId] || [];
      const texts = textsMap[pId] || [];
      return strokes.length > 0 || texts.length > 0;
    });

    if (photosToProcess.length === 0) {
      setIsSaving(false);
      onCancel?.();
      navigation.goBack();
      return;
    }

    setSaveProgressText('Downloading original images...');

    // Pre-download all remote S3 photos in parallel
    const base64Promises = photosToProcess.map(async (photo: any) => {
      try {
        const base64 = await getBase64FromUri(photo.uri);
        return { pId: photo.id || photo.uri, base64 };
      } catch (e) {
        console.error('Failed to get base64 for photo:', photo.uri, e);
        return { pId: photo.id || photo.uri, base64: null };
      }
    });

    const base64Results = await Promise.all(base64Promises);
    const base64Map: Record<string, string> = {};
    base64Results.forEach(res => {
      if (res.base64) {
        base64Map[res.pId] = res.base64;
      }
    });

    // Ensure WebView is mounted
    if (!mountWebView) {
      setMountWebView(true);
      await new Promise<void>(resolve => setTimeout(resolve, 300));
    }

    saveQueueRef.current = photosToProcess.map((photo: any) => ({
      ...photo,
      base64Data: base64Map[photo.id || photo.uri] || null
    }));

    setSaveProgressText(`Preparing image 1 of ${photosToProcess.length}...`);
    processNextInQueue(0);
  };

  const processNextInQueue = async (idx: number) => {
    if (idx >= saveQueueRef.current.length) {
      uploadProcessedImages(saveResultsRef.current);
      return;
    }
    
    const photo = saveQueueRef.current[idx];
    setSaveProgressText(`Drawing annotations for image ${idx + 1} of ${saveQueueRef.current.length}...`);
    
    try {
      const base64Data = photo.base64Data || await getBase64FromUri(photo.uri);
      const pId = photo.id || photo.uri;

      const strokes = strokesMap[pId] || [];
      const texts = textsMap[pId] || [];

      const normalizedStrokes = strokes.map(s => ({
        isEraser: s.isEraser,
        color: s.color,
        width: s.width,
        points: s.points
      }));

      const normalizedTexts = texts.map(t => ({
        text: t.text,
        color: t.color,
        fontSize: t.fontSize,
        px: t.px,
        py: t.py
      }));

      const message = {
        backgroundImageBase64: base64Data,
        layoutWidth: canvasLayout.width,
        layoutHeight: canvasLayout.height,
        strokes: normalizedStrokes,
        texts: normalizedTexts,
        imageIndex: idx
      };
      
      webViewRef.current?.postMessage(JSON.stringify(message));
    } catch (e) {
      console.error('Rasterization failed for index:', idx, e);
      processNextInQueue(idx + 1);
    }
  };

  const handleWebViewMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.status === 'success') {
        const cleanBase64 = data.base64.replace(/^data:image\/\w+;base64,/, '');
        const tempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/annotated_${Date.now()}_${data.imageIndex}.jpg`;
        
        await ReactNativeBlobUtil.fs.writeFile(tempPath, cleanBase64, 'base64');
        
        const originalPhoto = saveQueueRef.current[data.imageIndex];
        saveResultsRef.current.push({
          uri: `file://${tempPath}`,
          originalPhoto
        });
        
        processNextInQueue(data.imageIndex + 1);
      } else {
        console.warn('WebView canvas drawing failed:', data.message);
        processNextInQueue(data.imageIndex + 1);
      }
    } catch (e) {
      console.error('WebView message handling error:', e);
      if (saveQueueRef.current) {
        const activeIdx = saveResultsRef.current.length;
        processNextInQueue(activeIdx + 1);
      }
    }
  };

  const uploadProcessedImages = async (results: any[]) => {
    if (results.length === 0) {
      setIsSaving(false);
      onCancel?.();
      navigation.goBack();
      return;
    }

    setSaveProgressText('Getting location & uploading annotated images...');

    let coords = { latitude: 0, longitude: 0 };
    try {
      const position = await new Promise<any>((resolve, reject) => {
        Geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 300000, // 5 minutes cache
        });
      });
      coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch (error) {
      console.warn('Could not get location for annotated photos', error);
    }
    
    // Process uploads sequentially to prevent backend database write race conditions
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      setSaveProgressText(`Uploading annotated image ${i + 1} of ${results.length}...`);
      
      const orig = res.originalPhoto;
      const annotatedSubcategory = `${orig.subcategory} (Annotated)`;
      
      const formData = new FormData();
      formData.append('files', {
        uri: res.uri,
        type: 'image/jpeg',
        name: `annotated_${Date.now()}.jpg`,
      } as any);

      const imageInfo = [
        {
          category: orig.categoryName || orig.category || '',
          subcategory: annotatedSubcategory,
          timestampTaken: new Date().toISOString(),
          coordinates: coords,
        },
      ];

      formData.append('images', JSON.stringify(imageInfo));
      formData.append('category', 'salesPhotos');

      try {
        await uploadImagesMutation.mutateAsync({ leadId: lead._id, formData });
      } catch (uploadError: any) {
        console.error('Failed to upload annotated image:', uploadError?.response?.data || uploadError?.message || uploadError);
      }
      
      try {
        const cleanPath = res.uri.replace('file://', '');
        await ReactNativeBlobUtil.fs.unlink(cleanPath);
      } catch (cleanupError) {
        console.warn('Failed to delete temp file:', cleanupError);
      }
    }

    setIsSaving(false);
    onSaveSuccess?.();
    navigation.goBack();
  };

  const handleBackPress = () => {
    const hasUnsavedChanges = Object.values(strokesMap).some(s => s.length > 0) || Object.values(textsMap).some(t => t.length > 0);
    if (hasUnsavedChanges) {
      Alert.alert(
        'Discard Changes',
        'Are you sure you want to discard your drawing changes?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              onCancel?.();
              navigation.goBack();
            },
          },
        ]
      );
    } else {
      onCancel?.();
      navigation.goBack();
    }
  };

  const selectedText = currentTexts.find(t => t.id === selectedTextId);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView className="flex-1" style={{ backgroundColor: '#090e0c' }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-2 pb-4 bg-[#090e0c]">
          <TouchableOpacity
            onPress={handleBackPress}
            className="w-10 h-10 rounded-full bg-white/10 items-center justify-center"
          >
            <Icon name="chevron-left" size={24} color="white" />
          </TouchableOpacity>

          <Text className="text-white/40 font-bold text-xs">
            Annotate ({activeImageIndex + 1}/{selectedPhotos.length})
          </Text>

          <TouchableOpacity
            onPress={handleSaveAll}
            disabled={isSaving}
            className="px-6 py-2.5 rounded-full bg-[#72BD00]"
          >
            <Text className="text-white font-extrabold text-sm">Save All</Text>
          </TouchableOpacity>
        </View>

        {/* Loading Overlay */}
        {isSaving && (
          <View className="absolute inset-0 bg-black/85 z-50 items-center justify-center p-6">
            <ActivityIndicator size="large" color="#72BD00" />
            <Text className="text-white font-bold text-base mt-4 text-center">
              {saveProgressText}
            </Text>
          </View>
        )}

        {selectedPhotos.length > 0 && currentPhoto && (
          <View className="flex-1 flex-col justify-between">
            {/* Space Given to it Container */}
            <View
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (width > 0 && height > 0) {
                  setContainerLayout({ width, height });
                }
              }}
              className="flex-1 items-center justify-center p-4 w-full"
            >
              <AnnotationCanvas
                canvasLayout={canvasLayout}
                activeTool={activeTool}
                currentPhoto={currentPhoto}
                activeImageIndex={activeImageIndex}
                currentStrokes={currentStrokes}
                activeStroke={activeStroke}
                currentTexts={currentTexts}
                getPathData={getPathData}
                selectedTextId={selectedTextId}
                setSelectedTextId={setSelectedTextId}
                panResponder={panResponder}
                handleTextPress={handleTextPress}
                setShowStylePanel={setShowStylePanel}
                handleDeleteTextNote={handleDeleteTextNote}
                handleMoveText={handleMoveText}
              />
            </View>

            {/* Subcategory Label Pill */}
            <View className="items-center my-2">
              <View className="bg-[#72BD00] px-5 py-2 rounded-full">
                <Text className="text-white font-extrabold text-xs">
                  {getSubcategoryLabel(currentPhoto.categoryName || currentPhoto.category || '', currentPhoto.subcategory || '') || 'Photo'}
                </Text>
              </View>
            </View>

            {/* Tool Toolbar */}
            {(activeTool === 'none' || activeTool === 'zoom') && !showStylePanel ? (
              <View className="bg-[#0b0e0c] border-t border-white/10 px-4 py-4 pb-8 flex-row items-center justify-between">
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setActiveTool('zoom')}
                    className={`w-14 h-14 rounded-xl items-center justify-center ${
                      activeTool === 'zoom' ? 'bg-[#72BD00]' : 'bg-white/10'
                    }`}
                  >
                    <Icon name="magnify" size={20} color="white" />
                    <Text className="text-white text-[10px] font-bold mt-1">Zoom</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={enterDrawMode}
                    className="w-14 h-14 rounded-xl items-center justify-center bg-white/10"
                  >
                    <Icon name="pencil" size={20} color="white" />
                    <Text className="text-white text-[10px] font-bold mt-1">Draw</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={enterTextMode}
                    className="w-14 h-14 rounded-xl items-center justify-center bg-white/10"
                  >
                    <Icon name="format-text" size={20} color="white" />
                    <Text className="text-white text-[10px] font-bold mt-1">Text</Text>
                  </TouchableOpacity>
                </View>

                {/* Undo, Redo, Reset */}
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={handleUndo}
                    disabled={!(historyMap[photoId]?.length > 0)}
                    className="w-11 h-11 rounded-xl items-center justify-center bg-white/10"
                    style={{ opacity: (historyMap[photoId]?.length > 0) ? 1 : 0.35 }}
                  >
                    <Icon name="undo" size={20} color="white" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleRedo}
                    disabled={!(redoMap[photoId]?.length > 0)}
                    className="w-11 h-11 rounded-xl items-center justify-center bg-white/10"
                    style={{ opacity: (redoMap[photoId]?.length > 0) ? 1 : 0.35 }}
                  >
                    <Icon name="redo" size={20} color="white" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleResetCanvas}
                    className="w-11 h-11 rounded-xl items-center justify-center bg-white/10"
                  >
                    <Icon name="refresh" size={20} color="white" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {showStylePanel && selectedTextId && selectedText && (
              <AnnotationTextToolbar
                selectedText={selectedText}
                updateSelectedText={updateSelectedText}
                setShowStylePanel={setShowStylePanel}
                showFontDropdown={showFontDropdown}
                setShowFontDropdown={setShowFontDropdown}
              />
            )}

            {/* DRAW MODE TOOLBAR */}
            {activeTool === 'draw' ? (
              <View className="bg-[#0b0e0c] border-t border-white/10 px-4 py-4 pb-8">
                <View className="flex-row justify-center gap-6 mb-5">
                  <TouchableOpacity
                    onPress={() => {
                      setActiveDrawTool('pen');
                      setShowColorPanel(!showColorPanel);
                    }}
                    className={`flex-row items-center px-6 py-2.5 rounded-full ${
                      activeDrawTool === 'pen' ? 'bg-[#72BD00]/25 border border-[#72BD00]' : 'bg-white/5 border border-white/10'
                    }`}
                  >
                    <Icon name="pencil" size={16} color={activeDrawTool === 'pen' ? '#72BD00' : 'white'} />
                    <Text className="text-white text-xs font-bold ml-1.5">Pen</Text>
                    <Icon name="chevron-down" size={12} color="white" className="ml-1" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setActiveDrawTool('eraser');
                      setShowColorPanel(false);
                    }}
                    className={`flex-row items-center px-6 py-2.5 rounded-full ${
                      activeDrawTool === 'eraser' ? 'bg-[#72BD00]/25 border border-[#72BD00]' : 'bg-white/5 border border-white/10'
                    }`}
                  >
                    <Icon name="eraser" size={16} color={activeDrawTool === 'eraser' ? '#72BD00' : 'white'} />
                    <Text className="text-white text-xs font-bold ml-1.5">Eraser</Text>
                  </TouchableOpacity>
                </View>

                {showColorPanel && activeDrawTool === 'pen' && (
                  <View className="bg-[#121614] border border-white/5 p-4 rounded-2xl mb-4">
                    <View className="flex-row justify-between mb-4">
                      {['#FF7043', '#4CBB17', '#42A5F5', '#FFB74D', '#FFFFFF', '#000000'].map((color) => (
                        <TouchableOpacity
                          key={color}
                          onPress={() => setActiveColor(color)}
                          style={{
                            backgroundColor: color,
                            borderWidth: activeColor === color ? 2.5 : 0,
                            borderColor: '#FFFFFF',
                          }}
                          className="w-8 h-8 rounded-full border border-white/10"
                        />
                      ))}
                      <View className="w-8 h-8 rounded-full bg-white/5 items-center justify-center">
                        <Icon name="palette" size={18} color="white" />
                      </View>
                    </View>

                    <View className="flex-row items-center justify-between mt-1 px-1">
                      <Text className="text-white/60 text-xs font-bold">Size</Text>
                      <View className="flex-1 flex-row items-center justify-end gap-3 mx-4">
                        {[3, 5, 8, 12].map((size) => (
                          <TouchableOpacity
                            key={size}
                            onPress={() => setActiveSize(size)}
                            className={`w-7 h-7 rounded-full items-center justify-center ${
                              activeSize === size ? 'bg-[#72BD00]' : 'bg-white/5'
                            }`}
                          >
                            <Text className="text-white text-[10px] font-bold">{size}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text className="text-white text-xs font-bold">{activeSize}</Text>
                    </View>
                  </View>
                )}

                <View className="flex-row items-center justify-between">
                  <TouchableOpacity onPress={cancelDrawMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="close" size={24} color="white" />
                  </TouchableOpacity>
                  <Text className="text-white font-extrabold text-sm uppercase tracking-widest">Brush</Text>
                  <TouchableOpacity onPress={commitDrawMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="check" size={24} color="#72BD00" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* TEXT MODE TOOLBAR */}
            {activeTool === 'text' ? (
              <View className="bg-[#0b0e0c] border-t border-white/10 px-4 py-4 pb-8">
                <View className="items-center mb-4">
                  <Text className="text-white/60 text-xs font-bold">Tap anywhere on the image to add text</Text>
                </View>

                <View className="flex-row items-center justify-between">
                  <TouchableOpacity onPress={cancelTextMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="close" size={24} color="white" />
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    onPress={handleAddTextPress}
                    className="flex-row items-center bg-[#72BD00]/15 border border-[#72BD00]/30 px-6 py-2.5 rounded-full"
                  >
                    <Icon name="plus-circle" size={16} color="#72BD00" />
                    <Text className="text-white text-xs font-bold ml-1.5">Add Text</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={commitTextMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="check" size={24} color="#72BD00" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* Pagination Navigation Footer */}
            {(activeTool === 'none' || activeTool === 'zoom') && !showStylePanel ? (
              <View className="bg-[#0b0e0c] flex-row justify-between items-center px-4 py-4 pb-8 border-t border-white/5">
                <TouchableOpacity
                  disabled={activeImageIndex === 0}
                  onPress={() => setActiveImageIndex(prev => prev - 1)}
                  className={`py-3 px-6 rounded-xl flex-row items-center ${
                    activeImageIndex === 0 ? 'opacity-40' : 'bg-white/5 border border-white/10'
                  }`}
                >
                  <Icon name="chevron-left" size={18} color="white" />
                  <Text className="text-white font-bold text-xs ml-1">Prev</Text>
                </TouchableOpacity>
                
                <Text className="text-slate-400 font-bold text-xs">
                  {activeImageIndex + 1} of {selectedPhotos.length}
                </Text>

                <TouchableOpacity
                  disabled={activeImageIndex === selectedPhotos.length - 1}
                  onPress={() => setActiveImageIndex(prev => prev + 1)}
                  className={`py-3 px-6 rounded-xl flex-row items-center ${
                    activeImageIndex === selectedPhotos.length - 1 ? 'opacity-40' : 'bg-white/5 border border-white/10'
                  }`}
                >
                  <Text className="text-white font-bold text-xs mr-1">Next</Text>
                  <Icon name="chevron-right" size={18} color="white" />
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Inline Text Input Dialog Overlay */}
            {showTextDialog && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1000 }]}>
                <View style={{ backgroundColor: '#1E1E1E', borderRadius: 28, padding: 24, width: '100%', maxWidth: 320, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 }}>
                  <TextInput
                    value={textInputValue}
                    onChangeText={setTextInputValue}
                    placeholder="Enter text..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    autoFocus
                    style={{
                      width: '100%',
                      backgroundColor: '#2E2E2E',
                      borderRadius: 16,
                      color: 'white',
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      fontSize: 16,
                      fontWeight: 'bold',
                      marginBottom: 24,
                    }}
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <TouchableOpacity
                      onPress={() => {
                        setShowTextDialog(false);
                        setEditingTextId(null);
                        setTextInputValue('');
                      }}
                      style={{
                        flex: 1,
                        backgroundColor: '#3E3E3E',
                        borderRadius: 16,
                        paddingVertical: 14,
                        alignItems: 'center',
                        marginRight: 8,
                      }}
                    >
                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleTextSubmit}
                      style={{
                        flex: 1,
                        backgroundColor: '#4CBB17',
                        borderRadius: 16,
                        paddingVertical: 14,
                        alignItems: 'center',
                        marginLeft: 8,
                      }}
                    >
                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>OK</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>

      {/* Hidden WebView for high-res rasterization */}
      {mountWebView && (
        <View style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}>
          <WebViewComponent
            ref={webViewRef}
            onMessage={handleWebViewMessage}
            originWhitelist={['*']}
            source={{
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <style>
                    body, html { margin: 0; padding: 0; overflow: hidden; background: transparent; }
                    canvas { display: none; }
                  </style>
                </head>
                <body>
                  <canvas id="canvas"></canvas>
                  <script>
                    document.addEventListener("message", function(event) {
                      handleMessage(JSON.parse(event.data));
                    });
                    window.addEventListener("message", function(event) {
                      handleMessage(JSON.parse(event.data));
                    });

                    async function handleMessage(data) {
                      try {
                        const canvas = document.getElementById("canvas");
                        const ctx = canvas.getContext("2d");

                        const img = new Image();
                        img.onload = function() {
                          const w = img.naturalWidth || img.width;
                          const h = img.naturalHeight || img.height;
                          canvas.width = w;
                          canvas.height = h;

                          ctx.drawImage(img, 0, 0);

                          if (data.strokes) {
                            data.strokes.forEach(stroke => {
                              if (stroke.points.length === 0) return;
                              
                              ctx.beginPath();
                              ctx.lineCap = 'round';
                              ctx.lineJoin = 'round';
                              
                              if (stroke.isEraser) {
                                ctx.globalCompositeOperation = 'destination-out';
                                ctx.lineWidth = stroke.width * (w / data.layoutWidth);
                              } else {
                                ctx.globalCompositeOperation = 'source-over';
                                ctx.strokeStyle = stroke.color;
                                ctx.lineWidth = stroke.width * (w / data.layoutWidth);
                              }

                              const firstPoint = stroke.points[0];
                              ctx.moveTo(firstPoint.px * w, firstPoint.py * h);
                              
                              stroke.points.forEach(pt => {
                                ctx.lineTo(pt.px * w, pt.py * h);
                              });
                              
                              ctx.stroke();
                            });
                          }

                          ctx.globalCompositeOperation = 'source-over';

                          if (data.texts) {
                            data.texts.forEach(textObj => {
                              const textScale = w / data.layoutWidth;
                              const fontSize = textObj.fontSize * textScale;
                              
                              let fontStylePrefix = "";
                              if (textObj.fontStyle === 'bold') {
                                fontStylePrefix = "bold ";
                              } else if (textObj.fontStyle === 'italic') {
                                fontStylePrefix = "italic ";
                              } else if (textObj.fontStyle === 'bold-italic') {
                                fontStylePrefix = "italic bold ";
                              }
                              ctx.font = fontStylePrefix + fontSize + "px sans-serif";
                              
                              ctx.globalAlpha = textObj.opacity !== undefined ? textObj.opacity : 1.0;
                              ctx.fillStyle = textObj.color || '#FFFFFF';
                              ctx.fillText(textObj.text, textObj.px * w, textObj.py * h + fontSize * 0.8);
                              ctx.globalAlpha = 1.0;
                            });
                          }

                          const base64 = canvas.toDataURL("image/jpeg", 0.85);
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            status: 'success',
                            imageIndex: data.imageIndex,
                            base64: base64
                          }));
                        };
                        img.onerror = function() {
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            status: 'error',
                            imageIndex: data.imageIndex,
                            message: 'Image load failed'
                          }));
                        };
                        img.src = data.backgroundImageBase64;
                      } catch (e) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                          status: 'error',
                          imageIndex: data.imageIndex,
                          message: e.message
                        }));
                      }
                    }
                  </script>
                </body>
                </html>
              `
            }}
          />
        </View>
      )}
    </GestureHandlerRootView>
  );
}
