import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Alert,
  Image,
} from 'react-native';
import * as Mapbox from '@rnmapbox/maps';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from 'react-native-geolocation-service';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { useLeadsData } from '../../../hooks/useLeadsData';
import { LeadService } from '../../../services/api/leads';
import { ENV } from '../../../config/env';
import { MapJobCard } from './MapJobCard';
import { useAuth } from '../../../hooks/useAuth';
import { MapGalleryModal } from './MapGalleryModal';
const markerImg = require('../../../assets/images/map/marker.png');

const MarkerView = (Mapbox as any).MarkerView;

// Initialize Mapbox with access token
Mapbox.setAccessToken(ENV.MAPBOX_ACCESS_TOKEN);

const { width, height } = Dimensions.get('window');

// STATIC TAMPA DATA
const TAMPA_COORDS = {
  latitude: 27.9506,
  longitude: -82.4572,
};

interface LeadMapProps {
  currentLead?: any;
  fullScreen?: boolean;
  onGalleryPress?: (job: any) => void;
  onCameraPress?: (job: any) => void;
  onReferencePress?: (job: any) => void;
}

export const LeadMap = ({
  currentLead,
  fullScreen = false,
  onGalleryPress,
  onCameraPress,
  onReferencePress,
}: LeadMapProps) => {
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const { leads, refresh } = useLeadsData();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<Mapbox.MapView>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const isInternalMove = useRef(false);

  const [filteredLeads, setFilteredLeads] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<any>(null);
  const [isHeatMap, setIsHeatMap] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryJob, setGalleryJob] = useState<any>(null);
  const [activeFilters, setActiveFilters] = useState(['DEF-0', 'AJ-1', 'DEF-2']);
  const [currentZoom, setCurrentZoom] = useState(10);

  useEffect(() => {
    let result = [...leads];

    // Filter out jobs starting from TAM30000 - TAM30032 (Web parity)
    result = result.filter((item: any) => {
      // ALWAYS show the current lead if jumping from list
      if (currentLead && item._id === currentLead._id) return true;

      const jobNumber = item?.jobNumber;
      if (typeof jobNumber === 'string' && jobNumber.startsWith('TAM')) {
        const num = parseInt(jobNumber.substring(3), 10);
        if (num >= 30000 && num <= 30032) return false;
      }

      // Status Filtering logic
      const status = item.status?.toLowerCase();
      const isAJActive = activeFilters.some(f => f.startsWith('AJ'));
      const isDEFActive = activeFilters.some(f => f.startsWith('DEF'));

      if (!isAJActive && status === 'issued') return false;
      if (!isDEFActive && status === 'deferred') return false;

      return true;
    });

    setFilteredLeads(result);
  }, [leads, activeFilters]);

  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') {
      Geolocation.requestAuthorization('whenInUse');
      startTracking();
    } else {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        startTracking();
      }
    }
  };

  const startTracking = () => {
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation([longitude, latitude]);

        if (currentLead?.location?.coordinates) {
          handleMarkerClick(currentLead);
        } else {
          cameraRef.current?.setCamera({
            centerCoordinate: [longitude, latitude],
            zoomLevel: 12,
            animationDuration: 1000,
          });
        }
      },
      (error) => console.log(error),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const centerOnLead = (lead: any) => {
    const coords = lead.location?.coordinates;
    if (!coords) return;

    cameraRef.current?.setCamera({
      centerCoordinate: [coords[0], coords[1]],
      zoomLevel: 15,
      animationDuration: 1000,
    });
  };

  const handleMarkerClick = (lead: any) => {
    const coords = lead.location?.coordinates;
    if (!coords) return;

    setSelectedLead(lead);

    isInternalMove.current = true;
    cameraRef.current?.setCamera({
      centerCoordinate: [coords[0], coords[1]],
      zoomLevel: 15,
      animationDuration: 800,
    });

    setTimeout(() => {
      isInternalMove.current = false;
    }, 1000);
  };

  const fetchRoute = async () => {
    if (!userLocation || !currentLead?.location?.coordinates) return;

    const start = `${userLocation[0]},${userLocation[1]}`;
    const end = `${currentLead.location.coordinates[0]},${currentLead.location.coordinates[1]}`;
    
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start};${end}?geometries=geojson&access_token=${ENV.MAPBOX_ACCESS_TOKEN}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.routes && data.routes.length > 0) {
        setRouteGeoJSON(data.routes[0].geometry);
      }
    } catch (error) {
      console.error('Error fetching route:', error);
    }
  };

  useEffect(() => {
    if (showRoute) {
      fetchRoute();
    } else {
      setRouteGeoJSON(null);
    }
  }, [showRoute, userLocation, currentLead]);

  // Convert leads to GeoJSON for ShapeSource (Clustering & Heatmap)
  const leadsGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: filteredLeads
        .filter((l: any) => l.location?.coordinates)
        .map((l: any) => ({
          type: 'Feature' as const,
          id: l._id,
          properties: {
            id: l._id,
            price: l.price || 0,
            isFavourite: l.isFavourite,
            lead: l,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [l.location.coordinates[0], l.location.coordinates[1]],
          },
        })),
    };
  }, [filteredLeads]);

  return (
    <View
      className={fullScreen ? 'flex-1' : 'rounded-[32px] overflow-hidden border-2 shadow-2xl mt-4'}
      style={{
        borderColor: colors.border,
        height: fullScreen ? '100%' : 420,
        width: '100%',
        backgroundColor: isDark ? '#121212' : '#f0f0f0',
      }}
    >
      <Mapbox.MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        styleURL={Mapbox.StyleURL.Street}
        logoEnabled={false}
        attributionEnabled={false}
        onPress={() => setSelectedLead(null)}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [TAMPA_COORDS.longitude, TAMPA_COORDS.latitude],
            zoomLevel: currentZoom,
          }}
        />

        {/* Route Layer */}
        {routeGeoJSON && (
          <Mapbox.ShapeSource id="routeSource" shape={routeGeoJSON}>
            <Mapbox.LineLayer
              id="routeLayer"
              style={{
                lineColor: colors.primary.main,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Heatmap Layer */}
        {isHeatMap && (
          <Mapbox.ShapeSource id="heatmapSource" shape={leadsGeoJSON as any}>
            <Mapbox.HeatmapLayer
              id="heatmapLayer"
              style={{
                heatmapWeight: ['interpolate', ['linear'], ['get', 'price'], 0, 0, 10000, 1],
                heatmapIntensity: ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
                heatmapColor: [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0, 'rgba(116, 192, 255, 0)',
                  0.1, '#74c0ff',
                  0.3, '#0072ff',
                  0.5, '#00c853',
                  0.7, '#ffab00',
                  0.85, '#ff6d00',
                  1, '#d50000'
                ] as any,
                heatmapRadius: ['interpolate', ['linear'], ['zoom'], 0, 2, 15, 20],
                heatmapOpacity: 0.7,
              }}
            />
          </Mapbox.ShapeSource>
        )}


        {/* Individual Markers (Unclustered) */}
        {!isHeatMap && (
          <>
            <Mapbox.Images images={{ markerIcon: markerImg }} />
            <Mapbox.ShapeSource
              id="leadsSource"
              shape={leadsGeoJSON as any}
              onPress={(e: { features: any[]; }) => {
                const feature = e.features[0];
                if (feature?.properties?.lead) {
                  handleMarkerClick(feature.properties.lead);
                }
              }}
            >
              <Mapbox.SymbolLayer
                id="leadsSymbols"
                style={{
                  iconImage: 'markerIcon',
                  iconSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.4,
                    15, 0.8
                  ],
                  iconAllowOverlap: true,
                  iconAnchor: 'bottom',
                }}
              />
            </Mapbox.ShapeSource>
          </>
        )}

        {/* User Location Marker */}
        {userLocation && (
          <Mapbox.PointAnnotation 
            id="userLocation" 
            coordinate={[userLocation[0], userLocation[1]]}
          >
            <View className="items-center justify-center">
              <View className="w-8 h-8 rounded-full bg-blue-500/20 border-2 border-white items-center justify-center shadow-lg">
                <View className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
              </View>
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* Preload Marker Images (Optional if using layers) */}
        {/* Selected Job Callout (Anchored to Marker) */}
        {selectedLead && (
          <MarkerView
            key={`callout-${selectedLead._id}`}
            id="selectedCallout"
            coordinate={[
              selectedLead.location.coordinates[0],
              selectedLead.location.coordinates[1],
            ]}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={{ width: 280, marginBottom: 40, alignItems: 'center' }}>
              <View
                style={{
                  backgroundColor: isDark ? '#1E1E1E' : 'white',
                  borderRadius: 24,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: isDark ? '#333' : '#f1f5f9',
                  width: '100%',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 10 },
                  shadowOpacity: 0.2,
                  shadowRadius: 20,
                  elevation: 20,
                }}
              >
                <MapJobCard
                  job={selectedLead}
                  onClose={() => setSelectedLead(null)}
                  isMyJob={
                    selectedLead.salesRepId === (user as any)?._id || 
                    selectedLead.salesRep?._id === (user as any)?._id
                  }
                  onReferencePress={() => {
                    if (onReferencePress) onReferencePress(selectedLead);
                    else navigation.push('LeadCenter', { lead: selectedLead, initialTool: 'referral' });
                  }}
                  onCameraPress={() => {
                    if (onCameraPress) onCameraPress(selectedLead);
                    else navigation.navigate('LeadCenter', { lead: selectedLead, initialTool: 'camera' });
                  }}
                  onGalleryPress={() => {
                    if (onGalleryPress) onGalleryPress(selectedLead);
                    else {
                      setGalleryJob(selectedLead);
                      setShowGallery(true);
                    }
                  }}
                />
              </View>

              {/* Arrow Triangle */}
              <View
                style={{
                  width: 0,
                  height: 0,
                  backgroundColor: 'transparent',
                  borderStyle: 'solid',
                  borderLeftWidth: 12,
                  borderRightWidth: 12,
                  borderTopWidth: 15,
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  borderTopColor: isDark ? '#1E1E1E' : 'white',
                  marginTop: -1,
                }}
              />
            </View>
          </MarkerView>
        )}
      </Mapbox.MapView>

      {/* Floating Controls (Bottom Right) */}
      <View className="absolute bottom-10 right-6 gap-3 items-center" style={{ zIndex: 10 }}>
        {/* Status Capsules */}
        <View className="gap-2">
          {['DEF', 'AJ', 'DEF'].map((label, index) => {
            const isFilterActive = activeFilters.includes(`${label}-${index}`);
            return (
              <TouchableOpacity
                key={`${label}-${index}`}
                onPress={() => {
                  if (isFilterActive) setActiveFilters(activeFilters.filter(f => f !== `${label}-${index}`));
                  else setActiveFilters([...activeFilters, `${label}-${index}`]);
                }}
                className="w-12 h-20 rounded-full bg-white items-center py-2 shadow-lg border border-slate-100"
                style={{
                  borderColor: isFilterActive ? '#2EDE56' : '#e2e8f0',
                  borderWidth: 1,
                }}
              >
                <View 
                  className="w-8 h-8 rounded-full bg-white border-2 items-center justify-center mb-1"
                  style={{ borderColor: isFilterActive ? '#2EDE56' : '#e2e8f0' }}
                >
                  <View 
                    className="w-4 h-4 rounded-full" 
                    style={{ backgroundColor: isFilterActive ? '#2EDE56' : '#f1f5f9' }} 
                  />
                </View>
                <Text className="text-[10px] font-black text-slate-800">{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Location & Zoom Group */}
        <View className="gap-3 items-center">
          <TouchableOpacity
            onPress={startTracking}
            className="w-14 h-14 rounded-full bg-[#2EDE56] items-center justify-center shadow-xl"
          >
            <Icon name="crosshairs-gps" size={32} color="white" />
          </TouchableOpacity>

          <View className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
            <TouchableOpacity
              onPress={() => {
                const newZoom = currentZoom + 1;
                setCurrentZoom(newZoom);
                cameraRef.current?.setCamera({ zoomLevel: newZoom, animationDuration: 300 });
              }}
              className="w-12 h-12 items-center justify-center border-b border-slate-100"
            >
              <Icon name="plus" size={24} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const newZoom = currentZoom - 1;
                setCurrentZoom(newZoom);
                cameraRef.current?.setCamera({ zoomLevel: newZoom, animationDuration: 300 });
              }}
              className="w-12 h-12 items-center justify-center"
            >
              <Icon name="minus" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Back Button (Stays Top Right) */}
      <View className="absolute top-6 right-6" style={{ zIndex: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="w-14 h-14 rounded-full bg-[#2EDE56] items-center justify-center shadow-xl"
        >
          <Icon name="arrow-left" size={32} color="white" />
        </TouchableOpacity>
      </View>

      {/* Heatmap Legend */}
      {isHeatMap && (
        <View className="absolute bottom-6 left-6 right-6 px-4 py-2 bg-white/90 dark:bg-black/80 rounded-full flex-row items-center justify-between">
          <Text className="text-[10px] font-black tracking-widest text-gray-500">
            Price Intensity
          </Text>
          <View className="flex-row items-center gap-4">
            <View className="flex-row items-center">
              <View className="w-2 h-2 rounded-full bg-blue-500 mr-1" />
              <Text className="text-[9px] font-bold">Low</Text>
            </View>
            <View className="flex-row items-center">
              <View className="w-2 h-2 rounded-full bg-red-500 mr-1" />
              <Text className="text-[9px] font-bold">High</Text>
            </View>
          </View>
        </View>
      )}

      <MapGalleryModal
        visible={showGallery}
        job={galleryJob}
        onClose={() => setShowGallery(false)}
        onPresent={() => {}}
      />
    </View>
  );
};
