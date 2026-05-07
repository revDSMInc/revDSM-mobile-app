import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import MapView, { Marker, Callout, Heatmap, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import Icon from 'react-native-vector-icons/Ionicons';
import Geolocation from 'react-native-geolocation-service';
import { launchCamera, launchImageLibrary, MediaType } from 'react-native-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { useLeadsData } from '../../../hooks/useLeadsData';
import { LeadService } from '../../../services/api/leads';
import { ENV } from '../../../config/env';
import { MapJobCard } from './MapJobCard';
import { useAuth } from '../../../hooks/useAuth';

const { width, height } = Dimensions.get('window');

const GOOGLE_MAPS_API_KEY = ENV.GOOGLE_MAPS_API_KEY;

// STATIC TAMPA DATA
const TAMPA_COORDS = {
  latitude: 27.9506,
  longitude: -82.4572,
};

interface LeadMapProps {
  currentLead?: any;
  fullScreen?: boolean;
}

export const LeadMap = ({ currentLead, fullScreen = false }: LeadMapProps) => {
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const { leads, refresh } = useLeadsData();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<MapView>(null);
  const isInternalMove = useRef(false);

  const [filteredLeads, setFilteredLeads] = useState<any[]>([]);

  useEffect(() => {
    let result = [...leads];

    // Filter out jobs starting from TAM30000 - TAM30032 (Web parity)
    result = result.filter((item) => {
      const jobNumber = item?.jobNumber;
      if (typeof jobNumber === 'string' && jobNumber.startsWith('TAM')) {
        const number = parseInt(jobNumber.replace('TAM', ''), 10);
        if (!isNaN(number) && number >= 30000 && number <= 30032) {
          return false;
        }
      }
      return true;
    });

    setFilteredLeads(result);
  }, [leads]);

  const [region, setRegion] = useState({
    ...TAMPA_COORDS,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });

  const [userLocation, setUserLocation] = useState<any>(null);
  const [isHeatMap, setIsHeatMap] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);

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
        setUserLocation({ latitude, longitude });

        // If we have a current lead, center on it. Otherwise center on user.
        if (currentLead?.location?.coordinates) {
          centerOnLead(currentLead);
        } else {
          const newReg = {
            latitude,
            longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          };
          setRegion(newReg);
          mapRef.current?.animateToRegion(newReg, 1000);
        }
      },
      (error) => console.log(error),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const centerOnLead = (lead: any) => {
    const coords = lead.location?.coordinates;
    if (!coords) return;

    // Web logic: center and offset slightly upwards (approx 0.005 deg for zoom 16)
    const newReg = {
      latitude: coords[1] - 0.002,
      longitude: coords[0],
      latitudeDelta: 0.012,
      longitudeDelta: 0.012,
    };
    setRegion(newReg);
    mapRef.current?.animateToRegion(newReg, 1000);
  };

  const handleMarkerClick = (lead: any) => {
    const coords = lead.location?.coordinates;
    if (!coords) return;

    setSelectedLead(lead);

    isInternalMove.current = true;
    mapRef.current?.animateCamera(
      {
        center: {
          latitude: coords[1] + 0.0055, // Larger offset to center the modal, not the marker
          longitude: coords[0],
        },
        zoom: 16,
        pitch: 0,
        heading: 0,
      },
      { duration: 800 }
    );
    // Reset flag after animation
    setTimeout(() => {
      isInternalMove.current = false;
    }, 1000);
  };

  const handleToggleFavorite = async (leadId: string) => {
    try {
      await LeadService.toggleFavourite(leadId);
      refresh();
      // Optional: Add haptic feedback here
    } catch (e) {
      Alert.alert('Error', 'Could not update favorite status.');
    }
  };

  const handleOpenCamera = () => {
    launchCamera(
      { mediaType: 'photo' as MediaType, quality: 0.8, saveToPhotos: true },
      (response) => {
        if (response.didCancel) return;
        if (response.assets?.[0]?.uri) {
          Alert.alert(
            'Photo Captured',
            'Would you like to sync this photo to Job Docs immediately?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Sync Now',
                onPress: () => Alert.alert('Sync', 'Image added to background upload queue.'),
              },
            ]
          );
        }
      }
    );
  };

  const handleOpenGallery = () => {
    launchImageLibrary({ mediaType: 'photo' as MediaType, quality: 0.8 }, (response) => {
      if (response.didCancel) return;
      if (response.assets?.[0]?.uri) {
        Alert.alert(
          'Media Ready',
          'Image selected for Lead Gallery. Tap "Job Docs" to view your saved assets.'
        );
      }
    });
  };

  const handleOpenReferral = () => {
    Alert.alert(
      'Lead Referral',
      'Referral modules are currently being synchronized with the web console. Please use the Lead Details screen to manage referrals for now.',
      [{ text: 'Acknowledged' }]
    );
  };

  // Convert leads to heatmap data
  const heatmapData = leads
    .filter((l) => l.location?.coordinates && l.price)
    .map((l) => ({
      latitude: l.location!.coordinates[1],
      longitude: l.location!.coordinates[0],
      weight: Math.min((l.price || 0) / 10000, 1) || 0.5,
    }));

  const userCoords = userLocation || region;

  const destination = currentLead?.location?.coordinates
    ? {
        latitude: currentLead.location.coordinates[1],
        longitude: currentLead.location.coordinates[0],
      }
    : null;

  return (
    <View
      className={fullScreen ? 'flex-1' : 'rounded-[32px] overflow-hidden border-2 shadow-2xl mt-4'}
      style={{
        borderColor: colors.border,
        height: fullScreen ? undefined : 420,
        width: '100%',
        backgroundColor: isDark ? '#121212' : '#f0f0f0',
      }}
    >
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        customMapStyle={isDark ? darkMapStyle : []}
        initialRegion={region}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onRegionChangeStart={() => {
          if (!isInternalMove.current) {
            setSelectedLead(null);
          }
        }}
        onPress={() => setSelectedLead(null)}
      >
        {showRoute && userLocation && destination && GOOGLE_MAPS_API_KEY ? (
          <MapViewDirections
            origin={userLocation}
            destination={destination}
            apikey={GOOGLE_MAPS_API_KEY}
            strokeWidth={4}
            strokeColor={colors.primary.main}
            optimizeWaypoints={true}
            onReady={(result) => {
              mapRef.current?.fitToCoordinates(result.coordinates, {
                edgePadding: { right: 50, bottom: 50, left: 50, top: 50 },
              });
            }}
          />
        ) : null}

        {!isHeatMap &&
          leads.map((lead: any) => {
            const coords = lead.location?.coordinates;
            if (!coords) return null;
            const isActive = selectedLead?._id === lead._id || currentLead?._id === lead._id;

            return (
              <Marker
                key={lead._id}
                coordinate={{ latitude: coords[1], longitude: coords[0] }}
                onPress={() => handleMarkerClick(lead)}
                onSelect={() => handleMarkerClick(lead)}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={true}
                zIndex={isActive ? 999 : 1}
              >
                <View className="items-center justify-center" collapsable={false}>
                  <View className="shadow-2xl">
                    <Icon
                      name="location"
                      size={isActive ? 42 : 36}
                      color={
                        lead.isFavourite ? '#FFD700' : isActive ? colors.primary.main : '#FF5630'
                      }
                    />
                  </View>
                  {isActive && (
                    <View
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg"
                      style={{ elevation: 5 }}
                    />
                  )}
                  {lead.isFavourite && !isActive && (
                    <View className="absolute -top-1 -right-1">
                      <Icon name="star" size={12} color="#FFD700" />
                    </View>
                  )}
                </View>
              </Marker>
            );
          })}

        {isHeatMap && heatmapData.length > 0 && (
          <Heatmap
            points={heatmapData}
            radius={Platform.OS === 'ios' ? 40 : 50}
            opacity={0.6}
            gradient={{
              colors: ['#74c0ff', '#0072ff', '#00c853', '#ffab00', '#ff6d00', '#d50000'],
              startPoints: [0.1, 0.3, 0.5, 0.7, 0.85, 1],
              colorMapSize: 2048,
            }}
          />
        )}

        {/* User Current Position Marker */}
        {userLocation && (
          <Marker coordinate={userLocation} title="My Position" zIndex={100}>
            <View className="items-center justify-center">
              <View className="w-8 h-8 rounded-full bg-blue-500/20 border-2 border-white items-center justify-center shadow-lg">
                <View className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
              </View>
              <View
                className="absolute -bottom-1 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-transparent"
                style={{ borderTopColor: colors.primary.main }}
              />
            </View>
          </Marker>
        )}
      </MapView>

      {/* High-Fidelity Floating UI */}
      <View className="absolute top-6 right-6 gap-3">
        <TouchableOpacity
          onPress={() => setIsHeatMap(!isHeatMap)}
          className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 shadow-2xl items-center justify-center border border-gray-100 dark:border-zinc-700"
        >
          <Icon name="flame" size={24} color={isHeatMap ? '#EF4444' : '#94A3B8'} />
        </TouchableOpacity>

        {destination && (
          <TouchableOpacity
            onPress={() => {
              if (!GOOGLE_MAPS_API_KEY) {
                Alert.alert(
                  'API Key Required',
                  'Google Maps Directions API key is missing in config.'
                );
                return;
              }
              setShowRoute(!showRoute);
            }}
            className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 shadow-2xl items-center justify-center border border-gray-100 dark:border-zinc-700"
          >
            <Icon
              name="navigate-circle"
              size={24}
              color={showRoute ? colors.primary.main : '#94A3B8'}
            />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={startTracking}
          className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 shadow-2xl items-center justify-center border border-gray-100 dark:border-zinc-700"
        >
          <Icon name="locate" size={22} color={colors.primary.main} />
        </TouchableOpacity>
      </View>

      {/* Heatmap Legend */}
      {isHeatMap && (
        <View className="absolute bottom-6 left-6 right-6 px-4 py-2 bg-white/90 dark:bg-black/80 rounded-full flex-row items-center justify-between">
          <Text className="text-[10px] font-black  tracking-widest text-gray-500">
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

      {/* Custom High-Fidelity Overlay Modal */}
      {selectedLead && (
        <View
          className="absolute top-0 left-0 right-0 bottom-0 pointer-events-box-none items-center justify-center"
          pointerEvents="box-none"
          style={{ zIndex: 1000 }}
        >
          <View style={{ width: 260, height: 360, marginTop: -60 }}>
            <View
              style={{
                backgroundColor: 'white',
                borderRadius: 24,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: '#f1f5f9',
                height: 320,
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
                isMyJob={selectedLead.salesRepId === (user as any)?._id}
                onReferencePress={() =>
                  navigation.navigate('LeadCenter', { lead: selectedLead, initialTool: 'referral' })
                }
                onCameraPress={() =>
                  navigation.navigate('LeadCenter', { lead: selectedLead, initialTool: 'camera' })
                }
                onGalleryPress={() => {
                  setSelectedLead(null);
                  navigation.navigate('LeadCenter', { lead: selectedLead });
                }}
              />
            </View>

            {/* Arrow Triangle */}
            <View className="items-center">
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
                  borderTopColor: 'white',
                  marginTop: -1,
                }}
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#121212' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#757575' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#181818' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
];
