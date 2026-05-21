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
import { PdfPreviewModal } from '../../widgets/modals/PdfPreviewModal';

const { width } = Dimensions.get('window');

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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { lead } = (route.params as any) || {};

  const [viewMode, setViewMode] = useState<'rep' | 'homeowner'>('rep');
  const [activeCategory, setActiveCategory] = useState('leafFilter_story');
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsImageLoading, setFsImageLoading] = useState(false);
  const [mainImageLoading, setMainImageLoading] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [activeToolTab, setActiveToolTab] = useState('inspection');
  const [loading, setLoading] = useState(true);
  const [fullLeadData, setFullLeadData] = useState<any>(null);
  const [secureImages, setSecureImages] = useState<Record<string, any[]>>({});
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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

  const fetchSecureImages = async (photos: any[]) => {
    if (!photos?.length) return;
    try {
      const filePaths = photos.map((p: any) => ({
        bucketName: p.bucketName || 'np-revdsm-staging',
        filePath: p.s3url,
      }));
      const secureRes = await LeadService.getSecureUrls(filePaths);
      const secureData = secureRes.data?.data || secureRes.data || [];

      const map: Record<string, any[]> = {};
      photos.forEach((photo: any) => {
        const catName = photo.category;
        if (!map[catName]) map[catName] = [];
        const secured = secureData.find(
          (s: any) => s.s3url === photo.s3url || s.filePath === photo.s3url
        );
        map[catName].push({
          uri: secured?.secureUrl || photo.s3url,
          s3url: photo.s3url,
          subcategory: photo.subcategory,
        });
      });
      setSecureImages(map);
    } catch (e) {
      console.warn('Pitchbook fetch secure images failed', e);
    }
  };

  const pollInterval = useRef<any>(null);

  const refetch = async () => {
    const lid = lead?._id || lead?.id;
    if (!lid) return;
    try {
      const response = await LeadService.getLeadOutcome(lid);
      const data = response.data?.data || response.data;
      const outcome = data?.outcome || data;
      setFullLeadData(data);
      if (outcome?.salesPhotos) fetchSecureImages(outcome.salesPhotos);
    } catch (error) { }
  };

  useEffect(() => {
    if (lead?.salesPhotos) {
      fetchSecureImages(lead.salesPhotos);
    }
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

  useEffect(() => {
    setMainImageLoading(true);
  }, [activeCategory, currentSlideIndex]);

  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfPreviewData, setPdfPreviewData] = useState({ url: '', title: '' });

  const riskReports = useMemo(() => {
    const outcome = fullLeadData?.outcome || fullLeadData || lead;
    const reports = outcome?.generatedReports || lead?.generatedReports || [];
    return Array.isArray(reports)
      ? reports.filter((report: any) => {
        const name = report?.reportName || '';
        const type = report?.reportType || '';
        return name.toLowerCase().includes('risk') || type.toLowerCase().includes('risk');
      })
      : [];
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
          Linking.openURL(url);
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to open report');
    }
  };

  const handleNext = () => {
    setFsImageLoading(true);
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
    setFsImageLoading(true);
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

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Header onNavigate={(r) => navigation.navigate(r as any)} />

      {/* Pitch Book Toolbar */}
      <View className="flex-row items-center justify-between px-4 pt-6 bg-background">
        <Text className="text-text-primary text-sm font-medium">Pitch Book</Text>
        <View className="flex-row items-center gap-3">
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
          {/* Close Button */}
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <IonIcon name="close" size={20} color={isDark ? 'white' : '#1C252E'} />
          </TouchableOpacity>
        </View>
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
                  className="mr-5 py-3"
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
                onLoadStart={() => setMainImageLoading(true)}
                onLoad={() => setMainImageLoading(false)}
                onError={() => setMainImageLoading(false)}
              />
              {mainImageLoading && (
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.04)',
                  }}
                >
                  <ActivityIndicator size="large" color="#72BD00" />
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Navigation & Progress */}
        <View className="px-5 pt-4 mb-4 bg-background shadow-sm border-t border-border">
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
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={handlePrev}
              disabled={currentGlobalPageNumber === 1}
              className={`flex-1 flex-row gap-1 items-center justify-center py-2 rounded-lg`}
              style={{
                backgroundColor: currentGlobalPageNumber === 1 ? '#919EABCC' : colors.primary.main,
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
                  currentGlobalPageNumber === totalGlobalPages ? '#919EABCC' : colors.primary.main,
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

        {/* Interactive Tools — Modal Bottom Sheet (Rep Mode only) */}
        <Modal
          visible={viewMode === 'rep' && showTools}
          transparent
          animationType="none"
          statusBarTranslucent
          onRequestClose={toggleTools}
        >
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
              left: 0,
              right: 0,
              height: Dimensions.get('window').height * 0.7,
              transform: [
                {
                  translateY: toolsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [Dimensions.get('window').height * 0.7, 0],
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
                      })}
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
                    lead={fullLeadData?.outcome || lead}
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
        </Modal>

        {/* ── Fullscreen Presentation Modal ── */}
        <Modal
          visible={isFullscreen}
          transparent={true}
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setIsFullscreen(false)}
        >
          {/* Hide status bar in landscape */}
          <StatusBar hidden={isLandscape} backgroundColor="transparent" translucent />

          {isLandscape ? (
            /* ════════════════════════════════════════
               LANDSCAPE LAYOUT
               ════════════════════════════════════════ */
            <View style={{ flex: 1, backgroundColor: '#000', position: 'relative' }}>

              {/* ── Centre: image area + category tabs below image ── */}
              <View style={{ flex: 1, flexDirection: 'column' }}>

                {/* Upper part: Image and top buttons */}
                <View style={{ flex: 1, position: 'relative', justifyContent: 'center', alignItems: 'center' }}>
                  {/* Image */}
                  {currentCategoryImages[currentSlideIndex] && (
                    <>
                      <Image
                        source={currentCategoryImages[currentSlideIndex]}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="contain"
                        onLoadStart={() => setFsImageLoading(true)}
                        onLoad={() => setFsImageLoading(false)}
                        onError={() => setFsImageLoading(false)}
                      />
                      {fsImageLoading && (
                        <View
                          style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0,0,0,0.45)',
                          }}
                        >
                          <ActivityIndicator size="large" color="#72BD00" />
                        </View>
                      )}
                    </>
                  )}

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
                      right: 16,
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
                      left: 8,
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
                      right: viewMode === 'rep' ? 44 : 8,
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
                    paddingVertical: 10,
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
                            setFsImageLoading(true);
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
                  onPress={() => {
                    setIsFullscreen(false);
                    setTimeout(toggleTools, 300);
                  }}
                  style={{
                    position: 'absolute',
                    right: 0,
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
                  <>
                    <Image
                      source={currentCategoryImages[currentSlideIndex]}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="contain"
                      onLoadStart={() => setFsImageLoading(true)}
                      onLoad={() => setFsImageLoading(false)}
                      onError={() => setFsImageLoading(false)}
                    />
                    {fsImageLoading && (
                      <View
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: 'rgba(0,0,0,0.45)',
                        }}
                      >
                        <ActivityIndicator size="large" color="#72BD00" />
                      </View>
                    )}
                  </>
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
                          setFsImageLoading(true);
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
                    onPress={() => {
                      setIsFullscreen(false);
                      setTimeout(toggleTools, 300);
                    }}
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
        </Modal>

        {/* Full Screen Image Preview */}
        <Modal visible={!!previewImage} transparent animationType="fade">
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
          visible={showPdfModal}
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
