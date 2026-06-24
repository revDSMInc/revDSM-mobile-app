import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
  StyleSheet,
  Animated,
  Platform,
  Modal,
  StatusBar,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import pitchBookImages from '../../constants/pitchbook-images';
import { IMAGE_CATEGORIES } from '../../constants/lead-center';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import IonIcon from 'react-native-vector-icons/Ionicons';
import { Header } from '../../widgets/common/MainHeader';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import { LeadService } from '../../services/api/leads';
import { ActivityIndicator, Linking, Alert } from 'react-native';
import { useLeadReports } from '../../hooks/useLeadReports';
import YearDropdown from '../../widgets/components/YearDropdown';
import { ENV } from '../../config/env';

import { PdfPreviewModal } from '../../widgets/modals/PdfPreviewModal';
import { downloadPdfToDevice } from '../../utils/download-utils';
import { storage } from '../../utils/storage';
import { triggerLightTap, prepareHaptic } from '../../utils/haptics';
import { useSecureUrls } from '../../hooks/useSecureUrls';
import Feather from 'react-native-vector-icons/Feather';

const { width } = Dimensions.get('window');

// Persisted slide position per lead, so the pitchbook resumes where the rep left off.
const progressKey = (leadId?: string | null) => `pitchbook-progress-${leadId || 'default'}`;

const CATEGORIES = [
  { id: 'leafFilter_story', label: 'LeafFilter Story' },
  { id: 'problems_risk', label: 'Problems & Risk' },
  { id: 'rules_elimination', label: 'Rules & Elimination' },
  { id: 'product_testing', label: 'Products' },
  { id: 'our_process', label: 'Process' },
  { id: 'summary', label: 'Summary' },
];

export default function PitchbookScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;
  const landscapeRightInset = Platform.OS === 'android' ? Math.max(insets.right || 0, 48) : (insets.right || 0);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { lead } = (route.params as any) || {};
  const leadId = lead?._id || lead?.id || null;

  // Restore the last viewed slide for this lead (if any).
  const savedProgress = useMemo(() => {
    try {
      const raw = storage.getString(progressKey(leadId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.category === 'string' && typeof parsed.slideIndex === 'number') {
        return parsed as { category: string; slideIndex: number };
      }
    } catch (e) { }
    return null;
  }, [leadId]);

  const [viewMode, setViewMode] = useState<'rep' | 'homeowner'>('rep');
  const [activeCategory, setActiveCategory] = useState(
    savedProgress?.category || 'leafFilter_story'
  );
  const [currentSlideIndex, setCurrentSlideIndex] = useState(savedProgress?.slideIndex || 0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [activeToolTab, setActiveToolTab] = useState('inspection');
  const [loading, setLoading] = useState(true);
  const [fullLeadData, setFullLeadData] = useState<any>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const activePhotos = useMemo(() => {
    return fullLeadData?.outcome?.salesPhotos || fullLeadData?.salesPhotos || lead?.salesPhotos || [];
  }, [fullLeadData, lead]);

  const { data: secureImages = {} } = useSecureUrls(activePhotos);

  // Animation for tools drawer
  const toolsAnim = useRef(new Animated.Value(0)).current;

  const toggleTools = () => {
    const toValue = showTools ? 0 : 1;
    Animated.spring(toolsAnim, {
      toValue,
      useNativeDriver: true,
      friction: 8,
      tension: 40,
    }).start();
    setShowTools(!showTools);
  };

  const currentCategoryImages = useMemo(() => {
    const imagesObj = pitchBookImages[activeCategory] || {};
    return Object.values(imagesObj);
  }, [activeCategory]);

  const totalGlobalPages = useMemo(() => {
    return Object.values(pitchBookImages).reduce((acc, cat) => acc + Object.keys(cat).length, 0);
  }, []);

  const currentGlobalPageNumber = useMemo(() => {
    let count = 0;
    for (const cat of CATEGORIES) {
      if (cat.id === activeCategory) {
        count += currentSlideIndex + 1;
        break;
      }
      count += Object.keys(pitchBookImages[cat.id] || {}).length;
    }
    return count;
  }, [activeCategory, currentSlideIndex]);

  // Persist the current slide position for this lead whenever it changes.
  useEffect(() => {
    try {
      storage.set(
        progressKey(leadId),
        JSON.stringify({ category: activeCategory, slideIndex: currentSlideIndex })
      );
    } catch (e) { }
  }, [leadId, activeCategory, currentSlideIndex]);

  useEffect(() => {
    prepareHaptic('impact');
  }, []);

  const pollInterval = useRef<any>(null);

  const refetch = async () => {
    const lid = lead?._id || lead?.id;
    if (!lid) return;
    try {
      const response = await LeadService.getLeadOutcome(lid);
      const data = response.data?.data || response.data;
      setFullLeadData(data);
    } catch (error) { }
  };

  useEffect(() => {
    const result = String(lead?.result || lead?.status || '').toLowerCase();
    if (result === 'sale' || result === 'demo') {
      refetch();
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [lead?.id, lead?.result, lead?.status]);


  useEffect(() => {
    if (isFullscreen && isLandscape) {
      StatusBar.setHidden(true, 'fade');
    } else {
      StatusBar.setHidden(false, 'fade');
    }
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [isFullscreen, isLandscape]);

  // Removed artificial loading state that caused permanent loaders for local images

  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfPreviewData, setPdfPreviewData] = useState({ url: '', title: '' });

  const riskReports = useMemo(() => {
    const activeLead = fullLeadData || lead;
    const reports = [
      ...(activeLead?.generatedReports || []),
      ...(activeLead?.outcomeData?.generatedReports || []),
      ...(activeLead?.leadData?.generatedReports || []),
      ...(activeLead?.outcome?.generatedReports || []),
      ...(lead?.generatedReports || []),
      ...(lead?.outcomeData?.generatedReports || []),
      ...(lead?.leadData?.generatedReports || []),
      ...(lead?.outcome?.generatedReports || []),
    ];

    const uniqueMap = new Map();
    reports.forEach((report: any) => {
      const key = report?._id || report?.reportName || report?.url || report?.filePath;
      if (key && !uniqueMap.has(key)) {
        uniqueMap.set(key, report);
      }
    });
    const uniqueReports = Array.from(uniqueMap.values());

    return uniqueReports.filter((report: any) => {
      const name = report?.reportName || '';
      const type = report?.reportType || '';
      return name.toLowerCase().includes('risk') || type.toLowerCase().includes('risk');
    });
  }, [fullLeadData, lead]);

  const handleDownloadReport = async (report: any, index: number, isDownload: boolean = false) => {
    try {
      let url = '';
      if (report?.bucketName && report?.reportPath) {
        const response = await LeadService.getSecureUrls([
          { bucketName: report.bucketName, filePath: report.reportPath },
        ]);
        const secureData = response.data?.data || response.data || [];
        url = secureData[0]?.secureUrl;
      } else {
        url = report?.url || report?.fileUrl || report?.secureUrl;
      }

      if (url) {
        if (
          !isDownload &&
          (url.toLowerCase().includes('.pdf') || report?.reportName?.toLowerCase().includes('.pdf'))
        ) {
          setPdfPreviewData({ url, title: report.reportName || 'Report Preview' });
          setShowPdfModal(true);
        } else {
          downloadPdfToDevice(url, report.reportName || 'Risk Report');
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to open report');
    }
  };

  const handleNext = () => {
    triggerLightTap();
    if (currentSlideIndex < currentCategoryImages.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    } else {
      const catIdx = CATEGORIES.findIndex((c) => c.id === activeCategory);
      if (catIdx < CATEGORIES.length - 1) {
        setActiveCategory(CATEGORIES[catIdx + 1].id);
        setCurrentSlideIndex(0);
      }
    }
  };

  const handlePrev = () => {
    triggerLightTap();
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    } else {
      const catIdx = CATEGORIES.findIndex((c) => c.id === activeCategory);
      if (catIdx > 0) {
        const prevCat = CATEGORIES[catIdx - 1].id;
        setActiveCategory(prevCat);
        setCurrentSlideIndex(Object.keys(pitchBookImages[prevCat]).length - 1);
      }
    }
  };

  const renderInteractiveTools = () => {
    if (viewMode !== 'rep' || !showTools) return null;
    const drawerHeight = isLandscape
      ? winHeight - insets.top
      : winHeight * 0.7;

    return (
      <View style={[{ zIndex: 1000 }, StyleSheet.absoluteFill]}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={toggleTools}
        />
        <Animated.View
          className="w-full bg-background rounded-t-[32px] shadow-2xl"
          style={{
            position: 'absolute',
            bottom: 0,
            left: isLandscape ? insets.left : 0,
            right: isLandscape ? landscapeRightInset : 0,
            width: isLandscape ? undefined : '100%',
            height: drawerHeight,
            paddingLeft: isLandscape ? 16 : 0,
            paddingRight: isLandscape ? 16 : 0,
            paddingBottom: insets.bottom,
            transform: [
              {
                translateY: toolsAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [drawerHeight, 0],
                }),
              },
            ],
          }}
        >
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-gray-300" />
          </View>

          <View className="px-6 pt-4 pb-4 border-b border-border">
            <View className="flex-row items-center justify-between">
              <Text className="text-text-primary text-lg font-bold">Details</Text>
              <TouchableOpacity onPress={toggleTools}>
                <IonIcon name="close" size={24} color="#919EAB" />
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-6 mt-6">
              <ToolTab
                label="Inspection"
                icon="camera"
                active={activeToolTab === 'inspection'}
                onPress={() => setActiveToolTab('inspection')}
              />
              <ToolTab
                label="Risk"
                icon="alert"
                active={activeToolTab === 'risk'}
                onPress={() => setActiveToolTab('risk')}
              />
              <ToolTab
                label="Videos"
                icon="video"
                active={activeToolTab === 'videos'}
                onPress={() => setActiveToolTab('videos')}
              />
              <ToolTab
                label="Notes"
                icon="file-document-outline"
                active={activeToolTab === 'notes'}
                onPress={() => setActiveToolTab('notes')}
              />
            </View>
          </View>
          <View className="flex-1">
            <ScrollView className="p-6" showsVerticalScrollIndicator={false}>
              {activeToolTab === 'inspection' && (
                <View>
                  <Text className="text-text-primary font-bold text-base mb-4">
                    Property Inspection Photos
                  </Text>
                  {IMAGE_CATEGORIES.filter((s) => secureImages[s.name]?.length > 0).map(
                    (section) => {
                      const categoryPhotos = secureImages[section.name] || [];
                      const sectionTotal =
                        section.subCategories?.reduce(
                          (s: number, sub: any) => s + (sub.required || 1),
                          0
                        ) || 0;

                      return (
                        <View key={section.id} className="mb-4">
                          <TouchableOpacity
                            onPress={() =>
                              setExpandedCat(expandedCat === section.id ? null : section.id)
                            }
                            className="flex-row items-center justify-between px-3 py-2 rounded-md shadow-sm"
                            style={{
                              backgroundColor: '#F4F6F8',
                              borderBottomLeftRadius: expandedCat === section.id ? 0 : 8,
                              borderBottomRightRadius: expandedCat === section.id ? 0 : 8,
                            }}
                          >
                            <Text className="text-sm font-semibold text-[#1C252E]">
                              {section.name}
                            </Text>
                            <View className="flex-row items-center">
                              <View
                                className="px-3 py-1 rounded-md mr-3"
                                style={{ backgroundColor: '#212B36' }}
                              >
                                <Text className="text-sm text-white font-semibold">
                                  {categoryPhotos.length} of{' '}
                                  {Math.max(sectionTotal, categoryPhotos.length)} complete
                                </Text>
                              </View>
                              <Icon
                                name={expandedCat === section.id ? 'chevron-up' : 'chevron-down'}
                                size={16}
                                color="#919EAB"
                              />
                            </View>
                          </TouchableOpacity>

                          {expandedCat === section.id && (
                            <View className="flex-row flex-wrap gap-2 mt-3 px-1">
                              {categoryPhotos.map((img, i) => (
                                <View key={i} className="w-[31%] mb-2">
                                  <TouchableOpacity
                                    onPress={() => setPreviewImage(img.uri)}
                                    className="aspect-square rounded-xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm"
                                  >
                                    <Image
                                      source={{ uri: img.uri }}
                                      className="w-full h-full"
                                      resizeMode="cover"
                                    />
                                    <View className="absolute bottom-0 left-0 right-0 bg-black/40 py-1">
                                      <Text
                                        className="text-white text-[8px] font-black text-center  px-1"
                                        numberOfLines={1}
                                      >
                                        {img.subcategory || 'Photo'}
                                      </Text>
                                    </View>
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    }
                  )}
                  {Object.keys(secureImages).length === 0 && (
                    <View className="items-center justify-center py-12 opacity-50">
                      <Icon name="image-off" size={48} color="#919EAB" />
                      <Text className="text-text-secondary mt-4 font-bold">
                        No inspection photos available
                      </Text>
                      <Text className="text-text-secondary text-[10px] mt-1">
                        Photos added in Job Docs will appear here.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {activeToolTab === 'risk' && (
                <RiskContent
                  lead={lead}
                  refetch={refetch}
                  reports={riskReports}
                  onDownload={handleDownloadReport}
                />
              )}

              {activeToolTab === 'notes' && (
                <View>
                  <Text className="text-text-primary font-bold text-base mb-4">Lead Notes</Text>
                  <View className="bg-surface p-4 rounded-xl border border-border">
                    <Text className="text-text-primary text-sm leading-6">
                      {fullLeadData?.notes ||
                        fullLeadData?.customerDetails?.notes ||
                        'No specific notes available for this lead.'}
                    </Text>
                  </View>
                </View>
              )}

              {activeToolTab === 'videos' && (
                <View>
                  <Text className="text-text-primary font-bold text-base mb-4">
                    Educational Videos
                  </Text>
                  <View className="items-center justify-center py-12 opacity-50">
                    <Icon name="video-off" size={48} color="#919EAB" />
                    <Text className="text-text-secondary mt-4">
                      Video content goes here. This area is scrollable.
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom', 'left', 'right']}>

      {/* Pitch Book Toolbar */}
      <View className="flex-row items-center justify-between px-4 pt-6 bg-background">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="p-1 items-center justify-center border border-border rounded-lg"
            style={{
              width: 32,
              height: 32,
            }}
          >
            <Feather
              name="arrow-left"
              size={14}
              color={isDark ? colors.text : colors.textSecondary}
            />
          </TouchableOpacity>
          <Text className="text-text-primary text-sm font-medium">Pitch Book</Text>
        </View>

        {/* Fullscreen Button */}
        <TouchableOpacity
          onPress={() => setIsFullscreen(true)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            backgroundColor: isDark ? '#2D3A24' : '#F0FAE8',
            borderWidth: 1,
            borderColor: colors.primary.main,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IonIcon name="expand" size={16} color={colors.primary.main} />
        </TouchableOpacity>
      </View>

      <View className="flex-1">
        {/* Toggle Mode */}
        <View className="px-4 pt-3">
          <View
            className="flex-row gap-3 p-2 rounded-lg border"
            style={{ borderColor: '#919EAB33', backgroundColor: '' }}
          >
            <TouchableOpacity
              onPress={() => setViewMode('rep')}
              className="flex-1 py-2 items-center rounded-lg"
              style={{ backgroundColor: viewMode === 'rep' ? colors.primary.main : 'transparent' }}
            >
              <Text
                className={`text-sm font-medium ${viewMode === 'rep' ? 'text-white' : 'text-text-secondary'
                  }`}
              >
                Rep Mode
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('homeowner')}
              className="flex-1 py-2 items-center rounded-l"
              style={{
                backgroundColor: viewMode === 'homeowner' ? colors.primary.main : 'transparent',
              }}
            >
              <Text
                className={`text-sm font-medium ${viewMode === 'homeowner' ? 'text-white' : 'text-text-secondary'
                  }`}
              >
                Homeowner View
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Categories Tab Bar */}
        <View className="bg-background shadow-sm pb-6">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 0 }}
          >
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => {
                    setActiveCategory(cat.id);
                    setCurrentSlideIndex(0);
                  }}
                  className="mr-5 pt-3 pb-1"
                  style={{
                    borderBottomWidth: isActive ? 2 : 0,
                    borderBottomColor: colors.primary.main,
                  }}
                >
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: isActive ? colors.primary.main : colors.textSecondary }}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Presentation Area */}
        <View className="px-4 py-4 flex-1">
          <View className="flex-row items-center justify-between mb-4">
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="flex-row items-center p-1.5 rounded-md"
              style={{
                backgroundColor: '#F9FFF6',
                borderColor: colors.primary.main,
                borderWidth: 1,
              }}
            >
              <IonIcon
                name="location"
                size={18}
                color={colors.primary.main}
                style={{ marginRight: 6 }}
              />
              <Text className="font-bold text-sm" style={{ color: colors.primary.main }}>
                Back to Map
              </Text>
            </TouchableOpacity>
            <View className="bg-[#4CBB17] p-1.5 rounded-md">
              <Text className="text-white text-xs font-bold">
                {currentSlideIndex + 1} of {currentCategoryImages.length}
              </Text>
            </View>
          </View>
          <View className="">
            <View
              className="w-full aspect-[4/3] bg-card rounded-2xl shadow-sm border border-border overflow-hidden elevation-2"
              style={{
                position: 'relative',
                justifyContent: 'center',
                alignItems: 'center',
                paddingHorizontal: 2,
                paddingVertical: 3,
              }}
            >
              <Image
                source={currentCategoryImages[currentSlideIndex]}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
              />
            </View>
          </View>
        </View>

        {/* Navigation & Progress */}
        <View className="px-5 pt-4 mb-4 bg-background border-t border-border">
          <View className="flex-row items-center mb-3">
            <Text className="text-text-secondary text-xs mr-2">
              {currentGlobalPageNumber} of {totalGlobalPages}
            </Text>
            <View
              className="flex-1 h-2 rounded-full overflow-hidden"
              style={{ backgroundColor: '#919EAB29' }}
            >
              <View
                style={{
                  width: `${(currentGlobalPageNumber / totalGlobalPages) * 100}%`,
                  height: '100%',
                  backgroundColor: colors.primary.main,
                }}
              />
            </View>
          </View>
          <View className="flex-row gap-4">
            <TouchableOpacity
              onPress={handlePrev}
              disabled={currentGlobalPageNumber === 1}
              className={`flex-1 flex-row gap-1 items-center justify-center py-2 rounded-lg`}
              style={{
                backgroundColor: currentGlobalPageNumber === 1 ? '#637381' : colors.primary.main,
              }}
            >
              <IonIcon name="chevron-back" size={16} color="white" />
              <Text className="text-white font-bold text-sm">Previous</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleNext}
              disabled={currentGlobalPageNumber === totalGlobalPages}
              className={`flex-1 flex-row gap-1 items-center justify-center py-2 rounded-lg`}
              style={{
                backgroundColor:
                  currentGlobalPageNumber === totalGlobalPages ? '#637381' : colors.primary.main,
              }}
            >
              <Text className="text-white font-bold text-sm">Next</Text>
              <IonIcon name="chevron-forward" size={16} color="white" />
            </TouchableOpacity>
          </View>
        </View>
        {/* Persistent Interactive Tools Toggle Bar (Rep Mode only) */}
        {viewMode === 'rep' && (
          <View className="pt-4">
            <TouchableOpacity
              onPress={toggleTools}
              activeOpacity={0.9}
              className="flex-row items-center justify-center py-4"
              style={{
                paddingBottom: Platform.OS === 'ios' ? 16 : 16,
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                backgroundColor: '#F9FFF6',
                borderWidth: 1,
                borderColor: colors.primary.main,
              }}
            >
              <IonIcon
                name={showTools ? 'chevron-down' : 'chevron-up'}
                size={20}
                color={colors.primary.main}
                style={{ marginRight: 8 }}
              />
              <Text className="font-bold text-sm" style={{ color: colors.primary.main }}>
                {showTools ? 'Hide Tools' : 'Interactive Tools'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Fullscreen Presentation Modal ── */}
        <Modal
          visible={isFullscreen}
          animationType="fade"
          statusBarTranslucent
          supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
          onRequestClose={() => setIsFullscreen(false)}
        >
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {/* Hide status bar in landscape */}
            <StatusBar hidden={isLandscape} backgroundColor="transparent" translucent />

            {isLandscape ? (
              /* ════════════════════════════════════════
                 LANDSCAPE LAYOUT
                 ════════════════════════════════════════ */
              <View style={{ flex: 1, backgroundColor: '#000', position: 'relative', paddingTop: insets.top }}>

                {/* ── Centre: image area + category tabs below image ── */}
                <View style={{ flex: 1, flexDirection: 'column' }}>

                  {/* Upper part: Image and top buttons */}
                  <View style={{ flex: 1, position: 'relative', justifyContent: 'center', alignItems: 'center' }}>
                    {/* Image */}
                    <Image
                      source={currentCategoryImages[currentSlideIndex]}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="contain"
                    />

                    {/* ── Overlay: page counter top-left ── */}
                    <View
                      style={{
                        position: 'absolute',
                        top: Math.max(insets.top + 10, 24),
                        left: 16,
                        backgroundColor: 'rgba(0,0,0,0.50)',
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 12,
                        zIndex: 10,
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                        {currentGlobalPageNumber} / {totalGlobalPages}
                      </Text>
                    </View>

                    {/* ── Overlay: compress button top-right ── */}
                    <TouchableOpacity
                      onPress={() => setIsFullscreen(false)}
                      style={{
                        position: 'absolute',
                        top: Math.max(insets.top + 8, 20),
                        right: Math.max(landscapeRightInset, 16),
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: 'rgba(255,255,255,0.15)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10,
                      }}
                    >
                      <IonIcon name="contract" size={20} color="#fff" />
                    </TouchableOpacity>

                    {/* Prev Arrow (Floating next to image) */}
                    <TouchableOpacity
                      onPress={handlePrev}
                      disabled={currentGlobalPageNumber === 1}
                      style={{
                        position: 'absolute',
                        left: Math.max((insets.left || 0) + 24, 48),
                        top: '50%',
                        transform: [{ translateY: -20 }],
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: 'rgba(255,255,255,0.22)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: currentGlobalPageNumber === 1 ? 0.25 : 1,
                        zIndex: 10,
                      }}
                    >
                      <IonIcon
                        name="chevron-back"
                        size={22}
                        color="#fff"
                      />
                    </TouchableOpacity>

                    {/* Next Arrow (Floating next to image, adjusted to clear tools tab) */}
                    <TouchableOpacity
                      onPress={handleNext}
                      disabled={currentGlobalPageNumber === totalGlobalPages}
                      style={{
                        position: 'absolute',
                        right: viewMode === 'rep' ? Math.max(landscapeRightInset + 48, 48) : Math.max(landscapeRightInset + 24, 48),
                        top: '50%',
                        transform: [{ translateY: -20 }],
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: 'rgba(255,255,255,0.22)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: currentGlobalPageNumber === totalGlobalPages ? 0.25 : 1,
                        zIndex: 10,
                      }}
                    >
                      <IonIcon
                        name="chevron-forward"
                        size={22}
                        color="#fff"
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Bottom part: category tabs (sits below image, not overlayed) */}
                  <View
                    style={{
                      backgroundColor: '#111',
                      paddingTop: 10,
                      paddingBottom: Math.max(insets.bottom, 10),
                      paddingLeft: Math.max(insets.left, 8),
                      paddingRight: Math.max(landscapeRightInset, 8),
                      borderTopWidth: 1,
                      borderTopColor: 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{
                        flexGrow: 1,
                        justifyContent: 'center',
                        paddingHorizontal: 8,
                      }}
                    >
                      {CATEGORIES.map((cat) => {
                        const isActive = activeCategory === cat.id;
                        return (
                          <TouchableOpacity
                            key={cat.id}
                            onPress={() => {
                              setActiveCategory(cat.id);
                              setCurrentSlideIndex(0);
                            }}
                            style={{
                              marginHorizontal: 4,
                              paddingHorizontal: 14,
                              paddingVertical: 6,
                              borderRadius: 20,
                              backgroundColor: isActive
                                ? colors.primary.main
                                : 'rgba(255,255,255,0.12)',
                              borderWidth: isActive ? 0 : 1,
                              borderColor: 'rgba(255,255,255,0.18)',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: '600',
                                color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                              }}
                            >
                              {cat.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>

                {/* ── Interactive Tools: right-edge vertical tab (Rep Mode only) ── */}
                {viewMode === 'rep' && (
                  <TouchableOpacity
                    onPress={toggleTools}
                    style={{
                      position: 'absolute',
                      right: landscapeRightInset,
                      top: '50%',
                      transform: [{ translateY: -40 }],
                      width: 32,
                      height: 80,
                      backgroundColor: '#72BD00',
                      borderTopLeftRadius: 16,
                      borderBottomLeftRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 99,
                    }}
                  >
                    <IonIcon name="chevron-back" size={20} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              /* ════════════════════════════════════════
                 PORTRAIT LAYOUT  (unchanged)
                 ════════════════════════════════════════ */
              <View style={{ flex: 1, backgroundColor: '#000' }}>
                {/* Top bar: page counter + exit button */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingTop: insets.top + 40,
                    paddingBottom: 5,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                    {currentGlobalPageNumber} / {totalGlobalPages}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setIsFullscreen(false)}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: 'rgba(255,255,255,0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IonIcon name="contract" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>

                {/* Image with prev/next arrows */}
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  {currentCategoryImages[currentSlideIndex] && (
                    <Image
                      source={currentCategoryImages[currentSlideIndex]}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="contain"
                    />
                  )}

                  {/* Prev Arrow */}
                  <TouchableOpacity
                    onPress={handlePrev}
                    disabled={currentGlobalPageNumber === 1}
                    style={{
                      position: 'absolute',
                      left: 12,
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor:
                        currentGlobalPageNumber === 1
                          ? 'rgba(255,255,255,0.10)'
                          : 'rgba(255,255,255,0.22)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IonIcon
                      name="chevron-back"
                      size={22}
                      color={currentGlobalPageNumber === 1 ? 'rgba(255,255,255,0.35)' : '#fff'}
                    />
                  </TouchableOpacity>

                  {/* Next Arrow */}
                  <TouchableOpacity
                    onPress={handleNext}
                    disabled={currentGlobalPageNumber === totalGlobalPages}
                    style={{
                      position: 'absolute',
                      right: 12,
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor:
                        currentGlobalPageNumber === totalGlobalPages
                          ? 'rgba(255,255,255,0.10)'
                          : 'rgba(255,255,255,0.22)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IonIcon
                      name="chevron-forward"
                      size={22}
                      color={
                        currentGlobalPageNumber === totalGlobalPages
                          ? 'rgba(255,255,255,0.35)'
                          : '#fff'
                      }
                    />
                  </TouchableOpacity>
                </View>

                {/* Bottom: category tabs + interactive tools button */}
                <View
                  style={{
                    backgroundColor: '#111',
                    paddingBottom: insets.bottom + 4,
                    borderTopWidth: 1,
                    borderTopColor: 'rgba(255,255,255,0.08)',
                  }}
                >
                  {/* Category tab strip */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
                  >
                    {CATEGORIES.map((cat) => {
                      const isActive = activeCategory === cat.id;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          onPress={() => {
                            setActiveCategory(cat.id);
                            setCurrentSlideIndex(0);
                          }}
                          style={{
                            marginRight: 8,
                            paddingHorizontal: 14,
                            paddingVertical: 7,
                            borderRadius: 20,
                            backgroundColor: isActive ? colors.primary.main : 'rgba(255,255,255,0.10)',
                            borderWidth: isActive ? 0 : 1,
                            borderColor: 'rgba(255,255,255,0.15)',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '600',
                              color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
                            }}
                          >
                            {cat.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* Interactive Tools button (Rep Mode only) */}
                  {viewMode === 'rep' && (
                    <TouchableOpacity
                      onPress={toggleTools}
                      style={{
                        marginHorizontal: 12,
                        marginBottom: 6,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: 12,
                        borderRadius: 10,
                        backgroundColor: '#F0FAE8',
                        borderWidth: 1,
                        borderColor: colors.primary.main,
                      }}
                    >
                      <IonIcon
                        name="chevron-up"
                        size={18}
                        color={colors.primary.main}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={{ color: colors.primary.main, fontWeight: '700', fontSize: 13 }}>
                        Interactive Tools
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
            {renderInteractiveTools()}

            {/* Full Screen Image Preview (Nested inside Modal to show on top of it) */}
            <Modal visible={!!previewImage && isFullscreen} transparent animationType="fade">
              <View className="flex-1 bg-black/90 justify-center items-center">
                <TouchableOpacity
                  onPress={() => setPreviewImage(null)}
                  className="absolute top-12 right-6 z-10 w-10 h-10 bg-white/20 rounded-full items-center justify-center"
                >
                  <Icon name="close" size={24} color="white" />
                </TouchableOpacity>
                {previewImage && (
                  <Image
                    source={{ uri: previewImage }}
                    className="w-full h-[80%]"
                    resizeMode="contain"
                  />
                )}
              </View>
            </Modal>

            <PdfPreviewModal
              visible={showPdfModal && isFullscreen}
              onClose={() => setShowPdfModal(false)}
              uri={pdfPreviewData.url}
              title={pdfPreviewData.title}
            />
          </View>
        </Modal>

        {!isFullscreen && renderInteractiveTools()}

        {/* Full Screen Image Preview */}
        <Modal visible={!!previewImage && !isFullscreen} transparent animationType="fade">
          <View className="flex-1 bg-black/90 justify-center items-center">
            <TouchableOpacity
              onPress={() => setPreviewImage(null)}
              className="absolute top-12 right-6 z-10 w-10 h-10 bg-white/20 rounded-full items-center justify-center"
            >
              <Icon name="close" size={24} color="white" />
            </TouchableOpacity>
            {previewImage && (
              <Image
                source={{ uri: previewImage }}
                className="w-full h-[80%]"
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>

        <PdfPreviewModal
          visible={showPdfModal && !isFullscreen}
          onClose={() => setShowPdfModal(false)}
          uri={pdfPreviewData.url}
          title={pdfPreviewData.title}
        />
      </View>
    </SafeAreaView>
  );
}

function ToolTab({ label, icon, active, onPress }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="items-center pb-2"
      style={{ borderBottomWidth: active ? 2 : 0, borderBottomColor: '#72BD00' }}
    >
      <View className="flex-row items-center">
        <Icon
          name={icon}
          size={20}
          color={active ? '#72BD00' : '#919EAB'}
          style={{ marginRight: 6 }}
        />
        <Text className={`text-sm font-bold ${active ? 'text-primary' : 'text-text-secondary'}`}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const RiskContent = ({ lead, refetch, reports, onDownload }: any) => {
  const { colors, isDark } = useTheme();
  const { riskJob, handleStartRiskReport, handleResetRiskReport } = useLeadReports(lead, refetch);
  const [selectedYear, setSelectedYear] = useState(3);
  const [resetView, setResetView] = useState(false);
  const [reportExpanded, setReportExpanded] = useState(true);

  const riskReport = reports.find(
    (r: any) => r.reportName?.toLowerCase().includes('risk') || r.reportType?.includes('risk')
  );

  return (
    <View>
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-text-primary font-bold text-base">Report</Text>
        <TouchableOpacity onPress={() => setReportExpanded(!reportExpanded)}>
          <IonIcon
            name={reportExpanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color="#919EAB"
          />
        </TouchableOpacity>
      </View>

      {reportExpanded && (
        <View
          className="p-3 rounded-lg flex-col mb-4 border"
          style={{
            borderColor: '#919EAB33',
            backgroundColor: colors.background,
          }}
        >
          <View className="flex-row justify-between items-center">
            <View
              className="w-8 h-8 rounded-full items-center justify-center"
              style={{ backgroundColor: '#919EAB1F' }}
            >
              <Icon name="alert" size={16} color={'#637381'} />
            </View>
            <View className="flex-1 ml-4">
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                Risk Report
              </Text>
            </View>
            <View className="flex-row items-center gap-3">
              {riskReport && !resetView && !riskJob ? (
                <View className="flex-row items-center gap-2">
                  <TouchableOpacity
                    onPress={() => onDownload(riskReport, 0)}
                    className="w-8 h-8 rounded-full items-center justify-center bg-violet-500"
                  >
                    <Icon name="eye" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onDownload(riskReport, 0, true)}
                    className="w-8 h-8 rounded-full items-center justify-center bg-emerald-500"
                  >
                    <Icon name="download" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setResetView(true);
                      handleResetRiskReport(riskReport._id);
                    }}
                    className="w-8 h-8 rounded-full items-center justify-center bg-amber-500"
                  >
                    <Icon name="refresh" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                </View>
              ) : (
                !riskJob && (
                  <View className="flex-row items-center gap-2">
                    <YearDropdown
                      defaultValue={selectedYear}
                      min={1}
                      max={5}
                      onChange={(val: number) => setSelectedYear(val)}
                    />
                    <TouchableOpacity
                      onPress={() => {
                        handleStartRiskReport(selectedYear);
                        setResetView(false);
                      }}
                      className="w-8 h-8 rounded-full items-center justify-center"
                      style={{ backgroundColor: colors.primary.main }}
                    >
                      <Icon name="download" size={16} color={'#ffffff'} />
                    </TouchableOpacity>
                  </View>
                )
              )}
              {riskJob && riskJob.status !== 'completed' && (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color={colors.primary.main} />
                  <Text className="text-[10px] font-bold text-slate-500 ">{riskJob.progress}%</Text>
                </View>
              )}
            </View>
          </View>

          {/* Progress Bar for Risk Job */}
          {riskJob && riskJob.status !== 'completed' && (
            <View className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <View className="h-full bg-emerald-500" style={{ width: `${riskJob.progress}%` }} />
            </View>
          )}
          {riskJob && riskJob.status !== 'completed' && (
            <Text className="text-[10px] text-slate-400 mt-1 italic">
              {riskJob.step || 'Processing...'}
            </Text>
          )}
        </View>
      )}
      {reports.length > 1 && (
        <View className="mt-2 gap-3">
          <Text className="text-xs font-black  text-gray-400 tracking-widest mb-1">
            Generated History
          </Text>
          {reports.map((report: any, idx: number) => (
            <TouchableOpacity
              key={idx}
              onPress={() => onDownload(report, idx)}
              className="flex-row items-center p-4 bg-white rounded-xl border border-slate-100 shadow-sm"
            >
              <View className="w-10 h-10 bg-red-50 rounded-full items-center justify-center mr-3">
                <Icon name="file-pdf-box" size={24} color="#EF4444" />
              </View>
              <View className="flex-1">
                <Text className="text-text-primary font-bold text-sm" numberOfLines={1}>
                  {report.reportName}
                </Text>
                <Text className="text-text-secondary text-[10px]">
                  {new Date(report.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color="#919EAB" />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};
