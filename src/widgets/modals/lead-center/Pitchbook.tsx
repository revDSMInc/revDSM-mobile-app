import React, { useState, useMemo, useRef } from 'react';

import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
  Animated,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import pitchBookImages from '../../../constants/pitchbook-images';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import IonIcon from 'react-native-vector-icons/Ionicons';
import { Header } from '../../common/MainHeader';
import { IMAGE_CATEGORIES } from '../../../constants/lead-center';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';

const { width } = Dimensions.get('window');

const CATEGORIES = [
  { id: 'leafFilter_story', label: 'LeafFilter Story' },
  { id: 'problems_risk', label: 'Problems & Risk' },
  { id: 'rules_elimination', label: 'Rules & Elimination' },
  { id: 'product_testing', label: 'Products' },
  { id: 'our_process', label: 'Process' },
  { id: 'summary', label: 'Summary' },
];

interface PitchbookProps {
  onClose: () => void;
  lead?: any;
}

export default function Pitchbook({ onClose, lead }: PitchbookProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'rep' | 'homeowner'>('rep');
  const [activeCategory, setActiveCategory] = useState('leafFilter_story');
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [showTools, setShowTools] = useState(false);
  const [activeToolTab, setActiveToolTab] = useState('inspection');
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

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
    return Object.entries(imagesObj).map(([key, src]) => ({ key, src }));
  }, [activeCategory]);

  const getCurrentSlideName = (categoryId: string, slideIndex: number): string => {
    const imagesObj = pitchBookImages[categoryId] || {};
    return Object.keys(imagesObj)[slideIndex] || '';
  };

  const totalGlobalPages = useMemo(() => {
    return Object.values(pitchBookImages).reduce((acc, cat) => acc + Object.keys(cat).length, 0);
  }, []);

  const getGlobalPosition = (categoryId: string, slideIndex: number) => {
    let count = 0;
    for (const cat of CATEGORIES) {
      if (cat.id === categoryId) {
        count += slideIndex + 1;
        break;
      }
      count += Object.keys(pitchBookImages[cat.id] || {}).length;
    }
    return count;
  };

  const currentGlobalPageNumber = useMemo(() => {
    return getGlobalPosition(activeCategory, currentSlideIndex);
  }, [activeCategory, currentSlideIndex]);

  React.useEffect(() => {
    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('view', {
        user_id: userId,
        module_type: 'pitch_book',
        created_by: userId,
        meta: {
          leadId: lead?._id || lead?.id,
          action: 'pitch_book_opened',
        },
      });
    }

    return () => {
      if (userId) {
        logEvent('close', {
          user_id: userId,
          module_type: 'pitch_book',
          created_by: userId,
          meta: {
            leadId: lead?._id || lead?.id,
            action: 'pitch_book_close',
          },
        });
      }
    };
  }, [user?._id, user?.id, lead?._id, lead?.id]);

  const handleSetViewMode = (mode: 'rep' | 'homeowner') => {
    setViewMode(mode);
    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('mode', {
        user_id: userId,
        module_type: 'pitch_book',
        created_by: userId,
        meta: {
          leadId: lead?._id || lead?.id,
          viewMode: mode,
          action: 'pitch_book_view_mode_changed',
        },
      });
    }
  };

  const handleTabChange = (tabId: string) => {
    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('navigate', {
        user_id: userId,
        module_type: 'pitch_book',
        created_by: userId,
        meta: {
          leadId: lead?._id || lead?.id,
          fromSlideTab: activeCategory,
          toSlideTab: tabId,
          fromSlide: currentGlobalPageNumber,
          fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
          toSlide: getGlobalPosition(tabId, 0),
          toSlideName: getCurrentSlideName(tabId, 0),
          totalSlides: totalGlobalPages,
          action: 'pitch_book_tab_changed',
        },
      });
    }
    setActiveCategory(tabId);
    setCurrentSlideIndex(0);
  };

  const handleNext = () => {
    const userId = user?._id || user?.id;
    if (currentSlideIndex < currentCategoryImages.length - 1) {
      const nextSlideIdx = currentSlideIndex + 1;
      if (userId) {
        logEvent('navigate', {
          user_id: userId,
          module_type: 'pitch_book',
          created_by: userId,
          meta: {
            leadId: lead?._id || lead?.id,
            fromTab: activeCategory,
            toTab: activeCategory,
            fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
            fromSlide: currentGlobalPageNumber,
            toSlideName: getCurrentSlideName(activeCategory, nextSlideIdx),
            toSlide: currentGlobalPageNumber + 1,
            totalSlides: totalGlobalPages,
            action: 'pitch_book_slide_next',
          },
        });
      }
      setCurrentSlideIndex(nextSlideIdx);
    } else {
      const catIdx = CATEGORIES.findIndex((c) => c.id === activeCategory);
      if (catIdx < CATEGORIES.length - 1) {
        const nextCat = CATEGORIES[catIdx + 1].id;
        if (userId) {
          logEvent('navigate', {
            user_id: userId,
            module_type: 'pitch_book',
            created_by: userId,
            meta: {
              leadId: lead?._id || lead?.id,
              fromTab: activeCategory,
              toTab: nextCat,
              fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
              fromSlide: currentGlobalPageNumber,
              toSlideName: getCurrentSlideName(nextCat, 0),
              toSlide: currentGlobalPageNumber + 1,
              totalSlides: totalGlobalPages,
              action: 'pitch_book_slide_next',
            },
          });
        }
        setActiveCategory(nextCat);
        setCurrentSlideIndex(0);
      }
    }
  };

  const handlePrev = () => {
    const userId = user?._id || user?.id;
    if (currentSlideIndex > 0) {
      const prevSlideIdx = currentSlideIndex - 1;
      if (userId) {
        logEvent('navigate', {
          user_id: userId,
          module_type: 'pitch_book',
          created_by: userId,
          meta: {
            leadId: lead?._id || lead?.id,
            fromTab: activeCategory,
            toTab: activeCategory,
            fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
            fromSlide: currentGlobalPageNumber,
            toSlideName: getCurrentSlideName(activeCategory, prevSlideIdx),
            toSlide: currentGlobalPageNumber - 1,
            totalSlides: totalGlobalPages,
            action: 'pitch_book_slide_previous',
          },
        });
      }
      setCurrentSlideIndex(prevSlideIdx);
    } else {
      const catIdx = CATEGORIES.findIndex((c) => c.id === activeCategory);
      if (catIdx > 0) {
        const prevCat = CATEGORIES[catIdx - 1].id;
        const prevCatImagesCount = Object.keys(pitchBookImages[prevCat] || {}).length;
        if (userId) {
          logEvent('navigate', {
            user_id: userId,
            module_type: 'pitch_book',
            created_by: userId,
            meta: {
              leadId: lead?._id || lead?.id,
              fromTab: activeCategory,
              toTab: prevCat,
              fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
              fromSlide: currentGlobalPageNumber,
              toSlideName: getCurrentSlideName(prevCat, prevCatImagesCount - 1),
              toSlide: currentGlobalPageNumber - 1,
              totalSlides: totalGlobalPages,
              action: 'pitch_book_slide_previous',
            },
          });
        }
        setActiveCategory(prevCat);
        setCurrentSlideIndex(prevCatImagesCount - 1);
      }
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: '#F4F6F8' }}>
      <Header onNavigate={() => {}} />

      {/* Pitch Book Toolbar */}
      <View className="flex-row items-center justify-between px-5 py-3 bg-white">
        <Text className="text-[#1C252E] text-lg font-bold">Pitch Book</Text>
        <TouchableOpacity onPress={onClose}>
          <IonIcon name="close" size={24} color="#1C252E" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        {/* Toggle Mode */}
        <View className="px-5 py-4">
          <View className="flex-row bg-[#F4F6F8] p-1 rounded-2xl border border-gray-100">
            <TouchableOpacity
              onPress={() => handleSetViewMode('rep')}
              className={`flex-1 py-3 items-center rounded-xl ${
                viewMode === 'rep' ? 'bg-[#72BD00] shadow-sm' : ''
              }`}
            >
              <Text
                className={`text-sm font-bold ${
                  viewMode === 'rep' ? 'text-white' : 'text-[#637381]'
                }`}
              >
                Rep Mode
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleSetViewMode('homeowner')}
              className={`flex-1 py-3 items-center rounded-xl ${
                viewMode === 'homeowner' ? 'bg-[#72BD00] shadow-sm' : ''
              }`}
            >
              <Text
                className={`text-sm font-bold ${
                  viewMode === 'homeowner' ? 'text-white' : 'text-[#637381]'
                }`}
              >
                Homeowner View
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Categories Tab Bar */}
        <View
          className="border-b"
          style={{ borderBottomColor: '#F4F6F8', backgroundColor: 'white' }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 0 }}
          >
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => handleTabChange(cat.id)}
                  className="mr-6 py-4"
                  style={{
                    borderBottomWidth: isActive ? 2 : 0,
                    borderBottomColor: '#72BD00',
                  }}
                >
                  <Text
                    className={`text-sm font-bold ${
                      isActive ? 'text-[#72BD00]' : 'text-[#919EAB]'
                    }`}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Presentation Area */}
        <View className="px-5 py-6">
          <View className="flex-row items-center justify-between mb-4">
            <TouchableOpacity
              onPress={onClose}
              className="flex-row items-center bg-[#72BD00] px-4 py-2 rounded-xl"
            >
              <IonIcon name="location" size={18} color="white" style={{ marginRight: 6 }} />
              <Text className="text-white font-bold text-sm">Back to Map</Text>
            </TouchableOpacity>
            <View className="bg-[#212B36] px-4 py-1.5 rounded-lg">
              <Text className="text-white text-xs font-bold">
                {currentSlideIndex + 1} of {currentCategoryImages.length}
              </Text>
            </View>
          </View>

          <View className="w-full aspect-[4/3] bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden elevation-2">
            <Image
              source={currentCategoryImages[currentSlideIndex]?.src}
              className="w-full h-full"
              resizeMode="contain"
            />
          </View>
        </View>

        {/* Navigation & Progress */}
        <View className="px-5 pb-12">
          <View className="flex-row items-center mb-4">
            <Text className="text-[#637381] text-xs font-bold mr-3">
              {currentGlobalPageNumber} of {totalGlobalPages}
            </Text>
            <View className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <View
                style={{
                  width: `${(currentGlobalPageNumber / totalGlobalPages) * 100}%`,
                  height: '100%',
                  backgroundColor: '#72BD00',
                }}
              />
            </View>
          </View>

          <View className="flex-row gap-4">
            <TouchableOpacity
              onPress={handlePrev}
              disabled={currentGlobalPageNumber === 1}
              className={`flex-1 flex-row items-center justify-center py-4 rounded-2xl ${
                currentGlobalPageNumber === 1 ? 'bg-gray-200' : 'bg-[#72BD00]'
              }`}
            >
              <IonIcon name="chevron-back" size={20} color="white" />
              <Text className="text-white font-black  tracking-widest ml-1 text-sm">Previous</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleNext}
              disabled={currentGlobalPageNumber === totalGlobalPages}
              className={`flex-1 flex-row items-center justify-center py-4 rounded-2xl ${
                currentGlobalPageNumber === totalGlobalPages ? 'bg-gray-200' : 'bg-[#72BD00]'
              }`}
            >
              <Text className="text-white font-black  tracking-widest mr-1 text-sm">Next</Text>
              <IonIcon name="chevron-forward" size={20} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Interactive Tools Drawer (Only in Rep Mode) */}
      {viewMode === 'rep' && (
        <View className="absolute bottom-0 left-0 right-0 z-50">
          <Animated.View
            className="w-full bg-white rounded-t-[32px] shadow-2xl"
            style={{
              transform: [
                {
                  translateY: toolsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [500, 0],
                  }),
                },
              ],
            }}
          >
            {/* Drawer Header */}
            <View className="px-6 pt-5 pb-4 border-b border-gray-100">
              <View className="flex-row items-center justify-between">
                <Text className="text-[#1C252E] text-lg font-bold">Details</Text>
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

            <View className="p-6 h-[400px]">
              {activeToolTab === 'inspection' && (
                <View>
                  <Text className="text-[#1C252E] font-bold text-base mb-4">
                    Property Inspection Photos
                  </Text>
                  {IMAGE_CATEGORIES.map((section) => {
                    const categoryPhotos = (lead?.salesPhotos || []).filter(
                      (p: any) => p.category === section.name
                    );

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
                                {categoryPhotos.length}{' '}
                                {categoryPhotos.length === 1 ? 'Photo' : 'Photos'}
                              </Text>
                            </View>
                            <IonIcon
                              name={expandedCat === section.id ? 'chevron-up' : 'chevron-down'}
                              size={16}
                              color="#919EAB"
                            />
                          </View>
                        </TouchableOpacity>

                        {expandedCat === section.id && (
                          <View className="flex-row flex-wrap gap-2 mt-3 px-1">
                            {categoryPhotos.map((img: any, i: number) => (
                              <View key={i} className="w-[31%] mb-2">
                                <View className="aspect-square rounded-xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm">
                                  <Image
                                    source={{ uri: img.fileUrl }}
                                    className="w-full h-full"
                                    resizeMode="cover"
                                  />
                                </View>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {(lead?.salesPhotos || []).length === 0 && (
                    <View className="items-center justify-center py-12 opacity-50">
                      <Icon name="image-off" size={48} color="#919EAB" />
                      <Text className="text-[#637381] mt-4">No inspection photos available</Text>
                    </View>
                  )}
                </View>
              )}

              {activeToolTab === 'risk' && <RiskContent lead={lead} />}
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const RiskContent = ({ lead }: any) => {
  const [reportExpanded, setReportExpanded] = useState(true);
  const [resetView, setResetView] = useState(false);

  const riskReport = lead?.generatedReports?.find(
    (r: any) => r.reportName?.toLowerCase().includes('risk') || r.reportType?.includes('risk')
  );

  return (
    <View>
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-[#1C252E] font-bold text-base">Report</Text>
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
            backgroundColor: '#F4F6F8',
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
              <Text className="text-sm font-semibold" style={{ color: '#1C252E' }}>
                Risk Report
              </Text>
            </View>

            {riskReport && !resetView && (
              <View className="bg-violet-100 px-2 py-1 rounded-lg border border-violet-200 mr-2">
                <Text className="text-[9px] font-black text-violet-700 ">Already Generated</Text>
              </View>
            )}

            <View className="flex-row items-center gap-2">
              {riskReport && !resetView ? (
                <View className="flex-row items-center gap-2">
                  <TouchableOpacity className="w-8 h-8 rounded-full items-center justify-center bg-violet-500">
                    <Icon name="eye" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                  <TouchableOpacity className="w-8 h-8 rounded-full items-center justify-center bg-emerald-500">
                    <Icon name="download" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setResetView(true)}
                    className="w-8 h-8 rounded-full items-center justify-center bg-amber-500"
                  >
                    <Icon name="refresh" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  className="w-8 h-8 rounded-full items-center justify-center"
                  style={{ backgroundColor: '#72BD00' }}
                >
                  <Icon name="download" size={16} color={'#ffffff'} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

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
        <Text className={`text-sm font-bold ${active ? 'text-[#72BD00]' : 'text-[#919EAB]'}`}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
