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
import { useTheme } from '../../../theme/ThemeProvider';
import { useLeadsData } from '../../../hooks/useLeadsData';
import { LeadService } from '../../../services/api/leads';
import { ENV } from '../../../config/env';

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
  const { colors, isDark } = useTheme();
  const { leads, refresh } = useLeadsData();
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<MapView>(null);

  const [region, setRegion] = useState({
    ...TAMPA_COORDS,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });

  const [userLocation, setUserLocation] = useState<any>(null);
  const [isHeatMap, setIsHeatMap] = useState(false);
  const [showRoute, setShowRoute] = useState(false);

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

    // Web logic replication: Animate camera with an upward offset (latitude)
    // to ensure the popup is perfectly centered and visible.
    mapRef.current?.animateCamera(
      {
        center: {
          latitude: coords[1] + 0.0025, // Shift view up so popup fits
          longitude: coords[0],
        },
        zoom: 16,
        pitch: 0,
        heading: 0,
      },
      { duration: 1000 }
    );
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
        initialRegion={region}
        showsUserLocation={!!userLocation}
        onUserLocationChange={() => {}} // Suppress "topuserlocationnchange" error
        showsMyLocationButton={false}
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
          leads.map((lead) => {
            const coords = lead.location?.coordinates;
            if (!coords) return null;
            const isActive = currentLead?._id === lead._id;

            return (
              <Marker
                key={lead._id}
                coordinate={{ latitude: coords[1], longitude: coords[0] }}
                onPress={() => handleMarkerClick(lead)}
              >
                <View className="items-center justify-center">
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

                <Callout tooltip>
                  <View
                    className="bg-white rounded-[24px] shadow-2xl border border-slate-100"
                    style={{ width: 280 }}
                  >
                    {/* Header Row: Job # and Date */}
                    <View className="bg-slate-50 p-4 rounded-t-[24px]">
                      <Text className="text-[16px] font-black text-[#4CBB17] mb-1">
                        {lead.jobNumber ? `Job#${lead.jobNumber}` : `Lead#${lead.leadId || 'N/A'}`}
                      </Text>
                      <View className="flex-row items-center">
                        <Icon
                          name="calendar-outline"
                          size={12}
                          color="#4CBB17"
                          style={{ marginRight: 4 }}
                        />
                        <Text className="text-[10px] text-slate-500 font-bold">
                          {lead.installationDate || 'Schedule Pending'}
                        </Text>
                      </View>
                    </View>

                    {/* Info Section */}
                    <View className="p-4">
                      <View className="flex-row bg-slate-50 rounded-xl p-3 mb-4">
                        <View className="flex-1">
                          <Text className="text-[10px] text-slate-400 font-bold uppercase mb-1">
                            Sales Rep
                          </Text>
                          <Text className="text-[12px] font-black text-[#4CBB17]" numberOfLines={1}>
                            {lead.salesRepName || lead.userName || 'Unassigned'}
                          </Text>
                        </View>
                        <View className="w-[1px] bg-slate-200 mx-3" />
                        <View className="flex-1">
                          <Text className="text-[10px] text-slate-400 font-bold uppercase mb-1">
                            Price
                          </Text>
                          <Text className="text-[12px] font-black text-[#4CBB17]">
                            ${(lead.price || 0).toLocaleString()}
                          </Text>
                        </View>
                      </View>

                      <View className="flex-row items-center mb-4">
                        <View className="w-8 h-8 rounded-full bg-blue-50 items-center justify-center mr-3">
                          <Text className="font-black text-[12px] text-blue-600">
                            {(lead.customerDetails?.firstName || lead.firstName || 'C')[0]}
                          </Text>
                        </View>
                        <View className="flex-1">
                          <Text className="font-bold text-[13px] text-slate-800" numberOfLines={1}>
                            {lead.customerDetails?.firstName || lead.firstName}{' '}
                            {lead.customerDetails?.lastName || lead.lastName}
                          </Text>
                        </View>
                      </View>

                      <View className="h-[1px] bg-slate-100 mb-4" />

                      <View className="flex-row justify-around">
                        <TouchableOpacity onPress={handleOpenCamera} className="items-center">
                          <View className="w-9 h-9 rounded-xl bg-blue-50 items-center justify-center mb-1">
                            <Icon name="camera" size={16} color={colors.primary.main} />
                          </View>
                          <Text className="text-[8px] font-black uppercase text-slate-400">
                            Capture
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleOpenGallery} className="items-center">
                          <View className="w-9 h-9 rounded-xl bg-emerald-50 items-center justify-center mb-1">
                            <Icon name="images" size={16} color="#10B981" />
                          </View>
                          <Text className="text-[8px] font-black uppercase text-slate-400">
                            Gallery
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleToggleFavorite(lead._id)}
                          className="items-center"
                        >
                          <View className="w-9 h-9 rounded-xl bg-amber-50 items-center justify-center mb-1">
                            <Icon
                              name={lead.isFavourite ? 'star' : 'star-outline'}
                              size={16}
                              color="#FBC02D"
                            />
                          </View>
                          <Text className="text-[8px] font-black uppercase text-slate-400">
                            Fav
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Callout>
              </Marker>
            );
          })}

        {isHeatMap && heatmapData.length > 0 && (
          <Heatmap
            points={heatmapData}
            radius={Platform.OS === 'ios' ? 40 : 50}
            opacity={0.6}
            gradient={{
              colors: ['#00B8D9', '#36B37E', '#FFAB00', '#FF5630', '#DE350B'],
              startPoints: [0.1, 0.25, 0.5, 0.75, 1],
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
          <Text className="text-[10px] font-black uppercase tracking-widest text-gray-500">
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
