import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
  ScrollView,
  TextInput,
  Dimensions,
  SafeAreaView,
  Switch,
  FlatList,
} from 'react-native';
import MapView, { Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import Ionicons from 'react-native-vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import axios from 'axios';

import { useTheme } from '../../theme/ThemeProvider';
import { ENV } from '../../config/env';
import api from '../../services/api';
import LeadCreateModal from './LeadCreate';
import { useWorkLeadMutation } from '../../hooks/useLeadMutation';
import { Header } from '../../widgets/common/MainHeader';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const { width, height } = Dimensions.get('window');

interface ZoneCanvasserMapProps {
  visible: boolean;
  onClose: () => void;
  user: any;
  navigation: any;
}

// Marker Color Legend Mapping
const getMarkerColor = (status: string) => {
  switch (status) {
    case 'go_back':
      return '#fd7e14'; // orange
    case 'not_interested':
      return '#4B0082'; // indigo
    case 'not_qualified':
      return '#6c757d'; // grey
    case 'not_home':
      return '#0d6efd'; // blue
    case 'interested_no_time':
      return '#ffc107'; // yellow
    case 'create_lead':
    case 'selfGenerated':
      return '#198754'; // green
    case 'no_soliciting':
      return '#000000'; // black
    default:
      return '#dc3545'; // red (not visited)
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'go_back': return 'Go Back';
    case 'not_interested': return 'Not Interested';
    case 'not_qualified': return 'Not Qualified';
    case 'not_home': return 'Not Home';
    case 'interested_no_time': return 'Interested - No Time';
    case 'create_lead':
    case 'selfGenerated': return 'Lead Created';
    case 'no_soliciting': return 'No Soliciting';
    default: return 'Not Visited';
  }
};

// Haversine distance in miles
function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export default function ZoneCanvasserMap({ visible, onClose, user, navigation }: ZoneCanvasserMapProps) {
  const { colors, isDark } = useTheme();
  const mapRef = useRef<MapView>(null);
  const workMutation = useWorkLeadMutation();

  // Map & User Location State
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('satellite');
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [initialRegion, setInitialRegion] = useState<any>(null);

  // Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawType, setDrawType] = useState<'polygon' | 'rectangle'>('polygon');
  const [drawCoordinates, setDrawCoordinates] = useState<{ latitude: number; longitude: number }[]>([]);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const [startPoint, setStartPoint] = useState<any>(null);

  // Zones & Buildings Loaded State
  const [zones, setZones] = useState<any[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);

  // Active Modals & Selected Target Data
  const [selectedBuilding, setSelectedBuilding] = useState<any>(null);
  const [propertyData, setPropertyData] = useState<any>(null);
  const [propertyModalOpen, setPropertyModalOpen] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [leadCreateOpen, setLeadCreateOpen] = useState(false);
  const [submittedLeadPopupOpen, setSubmittedLeadPopupOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState<any>(null);
  const [zoneStatsPopupOpen, setZoneStatsPopupOpen] = useState(false);

  // Loading indicator for API actions
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch Zones & Building details
  const fetchZones = async () => {
    setLoadingZones(true);
    try {
      const response = await api.get<any>('/revzones/v1/sales-rep/my-revzones');
      const data = response?.data;
      if (data && typeof data === 'object') {
        if (Array.isArray(data)) {
          setZones(data);
        } else if (Array.isArray(data.zones)) {
          setZones(data.zones);
        } else if (Array.isArray(data.data)) {
          setZones(data.data);
        } else {
          setZones([]);
        }
      } else {
        setZones([]);
      }
    } catch (error) {
      console.error('Error fetching zones:', error);
      setZones([]);
    } finally {
      setLoadingZones(false);
    }
  };

  useEffect(() => {
    if (visible) {
      fetchZones();
      handleGetCurrentLocation();
    }
  }, [visible]);

  // Recenter or fetch current location
  const handleGetCurrentLocation = () => {
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ latitude, longitude });
        const region = {
          latitude,
          longitude,
          latitudeDelta: 0.00922,
          longitudeDelta: 0.00421,
        };
        setInitialRegion(region);
        mapRef.current?.animateToRegion(region, 500);
      },
      (error) => {
        console.warn('Geolocation error:', error);
        // Default to Tampa, FL
        const defaultRegion = {
          latitude: 27.9506,
          longitude: -82.4572,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        };
        setInitialRegion(defaultRegion);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  // Compile all buildings with status across loaded zones
  const allBuildings = useMemo(() => {
    const list: any[] = [];
    if (!Array.isArray(zones)) return list;
    
    zones.forEach((zone: any) => {
      if (!zone || !Array.isArray(zone.buildingDetails)) return;
      
      zone.buildingDetails.forEach((building: any) => {
        if (!building) return;
        
        // Canvasser lead group match
        const canvasserLeadGroup = Array.isArray(zone.salesRepBuildingLeads)
          ? zone.salesRepBuildingLeads.find(
              (leadGroup: any) =>
                Array.isArray(leadGroup) &&
                leadGroup[0]?.buildingDetails?.id !== undefined &&
                leadGroup[0]?.buildingDetails?.id === building.id
            )
          : null;
          
        // CRM self-gen lead match
        const crmLeadGroup = Array.isArray(zone.salesRepBuildingLeads)
          ? zone.salesRepBuildingLeads.find(
              (leadGroup: any) =>
                Array.isArray(leadGroup) &&
                leadGroup[0]?.buildingId !== undefined &&
                String(leadGroup[0]?.buildingId) === String(building.id)
            )
          : null;

        const matchedGroup = canvasserLeadGroup || crmLeadGroup;
        const finalLead = matchedGroup ? matchedGroup[0] : null;
        const rawStatus = finalLead?.status || null;
        const leadStatus = rawStatus === 'selfGenerated' ? 'create_lead' : rawStatus;
        const isCrmLead = rawStatus === 'selfGenerated';

        list.push({
          id: building.id,
          position: building.position, // [lat, lng]
          label: building.label,
          type: building.type,
          zoneId: zone.zoneId || zone._id,
          zoneName: zone.zoneName,
          leads: matchedGroup || [],
          leadStatus,
          leadId: finalLead?._id || null,
          address: building.label || 'N/A',
          isCrmLead,
        });
      });
    });
    return list;
  }, [zones]);

  // Location search handler
  const handleLocationSearch = async () => {
    if (!searchText.trim()) return;
    setIsProcessing(true);
    try {
      const res = await axios.get(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          searchText
        )}&key=${ENV.GOOGLE_MAPS_API_KEY}`
      );
      if (res.data.results?.[0]) {
        const { lat, lng } = res.data.results[0].geometry.location;
        const region = {
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.00922,
          longitudeDelta: 0.00421,
        };
        mapRef.current?.animateToRegion(region, 500);
        setSearchModalVisible(false);
      } else {
        Alert.alert('Not Found', 'Could not find that location.');
      }
    } catch (error) {
      console.error('Search failed', error);
      Alert.alert('Error', 'Failed to search for location.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Zoom control handler
  const handleZoom = (zoomIn: boolean) => {
    mapRef.current?.getCamera().then((camera) => {
      if (camera && camera.zoom !== undefined) {
        const nextZoom = camera.zoom + (zoomIn ? 1 : -1);
        mapRef.current?.animateCamera({ zoom: nextZoom }, { duration: 300 });
      } else if (camera && camera.altitude !== undefined) {
        const nextAltitude = camera.altitude * (zoomIn ? 0.5 : 2);
        mapRef.current?.animateCamera({ altitude: nextAltitude }, { duration: 300 });
      }
    });
  };

  // Touch handlers for drag-to-draw rectangle
  const handleTouchStart = async (e: any) => {
    if (!isDrawingMode || drawType !== 'rectangle') return;
    const { locationX, locationY } = e.nativeEvent;
    try {
      const coord = await mapRef.current?.coordinateForPoint({
        x: locationX,
        y: locationY,
      });
      if (coord) {
        setStartPoint({ x: locationX, y: locationY, coord });
        setDrawCoordinates([coord]);
      }
    } catch (err) {
      console.warn('Touch start error:', err);
    }
  };

  const handleTouchMove = async (e: any) => {
    if (!isDrawingMode || drawType !== 'rectangle' || !startPoint) return;
    const { locationX, locationY } = e.nativeEvent;
    try {
      const currentCoord = await mapRef.current?.coordinateForPoint({
        x: locationX,
        y: locationY,
      });
      if (currentCoord && startPoint.coord) {
        const corner1 = startPoint.coord;
        const corner2 = currentCoord;

        const minLat = Math.min(corner1.latitude, corner2.latitude);
        const maxLat = Math.max(corner1.latitude, corner2.latitude);
        const minLng = Math.min(corner1.longitude, corner2.longitude);
        const maxLng = Math.max(corner1.longitude, corner2.longitude);

        setDrawCoordinates([
          { latitude: maxLat, longitude: minLng }, // Top-Left
          { latitude: maxLat, longitude: maxLng }, // Top-Right
          { latitude: minLat, longitude: maxLng }, // Bottom-Right
          { latitude: minLat, longitude: minLng }, // Bottom-Left
        ]);
      }
    } catch (err) {
      console.warn('Touch move error:', err);
    }
  };

  const handleTouchEnd = () => {
    setStartPoint(null);
  };

  // Drawing Vertex tap handler (used only for polygon sequential tap)
  const handleMapPress = (e: any) => {
    if (!isDrawingMode) return;
    const { coordinate } = e.nativeEvent;
    
    if (drawType === 'polygon') {
      setDrawCoordinates((prev) => [...prev, coordinate]);
    }
  };

  // Save Zone - compiles polygon coordinates and fetches residential buildings inside
  const handleSaveZone = async () => {
    if (drawCoordinates.length < 3) {
      Alert.alert('Invalid Zone', 'A zone must have at least 3 points.');
      return;
    }
    setIsProcessing(true);
    try {
      // Formulate closed polygon coords for OSM Overpass
      let closedCoords = [...drawCoordinates];
      if (closedCoords.length > 0) {
        const first = closedCoords[0];
        const last = closedCoords[closedCoords.length - 1];
        if (first.latitude !== last.latitude || first.longitude !== last.longitude) {
          closedCoords.push(first);
        }
      }
      const polygonString = closedCoords.map((c) => `${c.latitude} ${c.longitude}`).join(' ');
      const overpassQuery = `
        [out:json];
        (
          way["building"](poly:"${polygonString}");
          relation["building"](poly:"${polygonString}");
        );
        out center;
      `;

      const response = await axios.post(
        'https://overpass-api.de/api/interpreter',
        overpassQuery,
        {
          headers: {
            'Content-Type': 'text/plain',
            'User-Agent': 'RevDSMSalesMobile/1.0 (dev@revdsm.com)',
          },
        }
      );

      const elements = response.data.elements || [];
      const buildingsData = elements
        .filter((el: any) => el.center)
        .map((element: any, index: number) => ({
          id: element.id || `building-${Date.now()}-${index}`,
          position: [element.center?.lat, element.center?.lon],
          label: element.tags?.name || `Building ${index + 1}`,
          type: element.tags?.building || 'yes',
        }));

      // Filter residential buildings
      const residentialBuildings = buildingsData.filter(
        (b: any) =>
          b.type === 'house' ||
          b.type === 'yes' ||
          b.type === 'detached' ||
          b.type === 'residential'
      );

      if (residentialBuildings.length === 0) {
        Alert.alert('No Buildings Found', 'We could not detect any residential buildings within the boundary of this zone.');
        setIsProcessing(false);
        return;
      }

      // Format payload to replicate CRM creation
      const zoneId = Date.now().toString() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const zoneName = `REV-${zoneId}`;
      const processedBuildings = residentialBuildings.map((b: any, idx: number) => ({
        ...b,
        id: b.id || (800400000 + (parseInt(zoneId.slice(-3)) || 0) * 100 + idx + 1),
      }));

      const geoJSONCoordinates = drawCoordinates.map((c) => [c.longitude, c.latitude]);
      if (geoJSONCoordinates.length > 0) {
        const first = geoJSONCoordinates[0];
        const last = geoJSONCoordinates[geoJSONCoordinates.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          geoJSONCoordinates.push(first);
        }
      }

      const payload = {
        zoneId,
        zoneName,
        assignedUsers: [],
        layerType: 'polygon',
        color: '#99FFB1',
        geoJSON: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [geoJSONCoordinates],
          },
        },
        coordinates: drawCoordinates.map((c) => [c.latitude, c.longitude]),
        buildingDetails: processedBuildings,
        userId: user?._id || user?.id,
        companyId: user?.companyId,
      };

      const res = await api.post('/revzones/v1/sales-rep/create', payload);
      if (res.status === 200 || res.status === 201) {
        Alert.alert('Success', `Zone successfully created with ${processedBuildings.length} buildings.`);
        setIsDrawingMode(false);
        setDrawCoordinates([]);
        fetchZones();
      } else {
        Alert.alert('Error', 'Failed to save zone details to server.');
      }
    } catch (error: any) {
      console.error('Error creating zone:', error);
      const serverMsg = error?.response?.data?.message || error?.response?.data || '';
      console.error('Server response:', serverMsg);
      Alert.alert(
        'Error',
        `${error?.message || 'Error occurred while creating zone.'}\nDetails: ${JSON.stringify(serverMsg)}`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Building Marker Press Handler
  const handleBuildingPress = async (building: any) => {
    setSelectedBuilding(building);
    if (building.leadStatus && building.leads?.length > 0) {
      // Visited building -> Open Details modal
      setSubmittedLeadPopupOpen(true);
    } else {
      // Not visited -> Reverse geocode first then PropertyDetails modal
      setIsProcessing(true);
      try {
        const lat = building.position[0];
        const lng = building.position[1];
        const res = await axios.get(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${ENV.GOOGLE_MAPS_API_KEY}`
        );
        let address = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        if (res.data.results?.[0]) {
          address = res.data.results[0].formatted_address;
        }

        // Fetch detailed property lookup from backend
        let propertyInfo: any = null;
        try {
          const propRes = await api.get(`/property/v1/properties?address=${encodeURIComponent(address)}`);
          propertyInfo = propRes.data;
        } catch (e) {
          console.warn('Property lookup failed', e);
        }

        setPropertyData({
          ...(propertyInfo || {}),
          formattedAddress: address,
        });
        setPropertyModalOpen(true);
      } catch (error) {
        console.error('Geocoding error:', error);
        Alert.alert('Error', 'Failed to retrieve address for this building.');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // Polygon Area Press Handler (Stats popup)
  const handlePolygonPress = (zone: any) => {
    setSelectedZone(zone);
    setZoneStatsPopupOpen(true);
  };

  // ActionModal submission handler
  const handleActionSubmit = async (data: any) => {
    setIsProcessing(true);
    try {
      const payload = {
        zoneId: selectedBuilding.zoneId,
        officeId: user?.officeId || user?.companyId,
        buildingDetails: {
          id: selectedBuilding.id,
          position: selectedBuilding.position,
          label: selectedBuilding.label,
          type: selectedBuilding.type,
        },
        address: propertyData?.formattedAddress || selectedBuilding.label || selectedBuilding.address,
        status: selectedAction,
        note: data.note,
        date: new Date().toISOString(),
        ...(selectedAction === 'interested_no_time' && {
          name: data.name,
          followupDate: data.followupDate,
          prefferedTime: data.prefferedTime,
          selectedItems: data.selectedItems,
        }),
        ...(selectedAction === 'go_back' && {
          followupDate: data.followupDate,
          prefferedTime: data.prefferedTime,
        }),
      };

      const res = await api.post('/sales-rep/lead/v1/create', payload);
      if (res.status === 200 || res.status === 201) {
        Alert.alert('Success', 'Result saved successfully.');
        setActionModalOpen(false);
        setResultsModalOpen(false);
        setPropertyModalOpen(false);
        fetchZones();
      } else {
        Alert.alert('Error', 'Failed to submit action result.');
      }
    } catch (error: any) {
      Alert.alert('Submission Error', error?.message || 'Error occurred while saving action.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Lead created callback
  const handleLeadCreateSuccess = (createdLead: any) => {
    setLeadCreateOpen(false);
    setResultsModalOpen(false);
    setPropertyModalOpen(false);
    fetchZones();

    if (createdLead) {
      setSelectedBuilding((prev: any) => ({
        ...prev,
        leads: [createdLead],
        leadStatus: 'create_lead',
        leadId: createdLead._id,
        isCrmLead: true,
      }));
      // Open detail popup after minor lag to allow modal transition
      setTimeout(() => {
        setSubmittedLeadPopupOpen(true);
      }, 500);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}>
        
        {/* Main Header Component */}
        <Header
          onFilterPress={() => setSearchModalVisible(true)}
          onNavigate={(route: any) => {
            if (route === 'Leads') {
              onClose();
            } else {
              navigation.navigate(route);
            }
          }}
        />

        {/* Info panel for drawing mode */}
        {isDrawingMode && (
          <View style={styles.drawingInfoBox}>
            <Text style={styles.drawingInfoText}>
              {drawType === 'polygon'
                ? 'Tap sequentially on the map to define polygon vertices. Tap Save Zone once done.'
                : 'Tap two opposite corners to define a rectangular canvassing zone.'}
            </Text>
          </View>
        )}

        {/* Primary Map View */}
        <View style={styles.mapContainer}>
          <View
            style={StyleSheet.absoluteFillObject}
            onStartShouldSetResponder={() => isDrawingMode && drawType === 'rectangle'}
            onMoveShouldSetResponder={() => isDrawingMode && drawType === 'rectangle'}
            onResponderGrant={handleTouchStart}
            onResponderMove={handleTouchMove}
            onResponderRelease={handleTouchEnd}
          >
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              mapType={mapType}
              initialRegion={initialRegion}
              onPress={handleMapPress}
              showsUserLocation
              showsMyLocationButton={false}
              scrollEnabled={!isDrawingMode || drawType !== 'rectangle'}
              zoomEnabled={!isDrawingMode || drawType !== 'rectangle'}
              pitchEnabled={!isDrawingMode || drawType !== 'rectangle'}
              rotateEnabled={!isDrawingMode || drawType !== 'rectangle'}
            >
              {/* Draw Polygon/Rectangle draft rendering */}
              {isDrawingMode && drawCoordinates.length > 0 && (
                <>
                  <Polyline coordinates={drawCoordinates} strokeColor="#FF5630" strokeWidth={3} />
                  {drawCoordinates.length >= 3 && (
                    <Polygon coordinates={drawCoordinates} fillColor="rgba(255, 86, 48, 0.2)" strokeColor="#FF5630" strokeWidth={1} />
                  )}
                  {drawCoordinates.map((coord, idx) => (
                    <Marker key={`draft-${idx}`} coordinate={coord} anchor={{ x: 0.5, y: 0.5 }}>
                      <View style={styles.draftVertex} />
                    </Marker>
                  ))}
                </>
              )}

              {/* Created Zones Polygons */}
              {!isDrawingMode &&
                Array.isArray(zones) &&
                zones.map((zone) => {
                  let polygonCoords = [];
                  if (zone.geoJSON?.geometry?.coordinates) {
                    polygonCoords = zone.geoJSON.geometry.coordinates[0].map((coord: any) => ({
                      latitude: coord[1],
                      longitude: coord[0],
                    }));
                  } else if (zone.coordinates) {
                    polygonCoords = zone.coordinates.map((coord: any) => ({
                      latitude: coord[0],
                      longitude: coord[1],
                    }));
                  }

                  if (polygonCoords.length < 3) return null;

                  return (
                    <Polygon
                      key={zone._id || zone.zoneId}
                      coordinates={polygonCoords}
                      fillColor={`${zone.color || '#99FFB1'}30`}
                      strokeColor={zone.color || '#99FFB1'}
                      strokeWidth={2}
                      tappable
                      onPress={() => handlePolygonPress(zone)}
                    />
                  );
                })}

              {/* Building Markers */}
              {!isDrawingMode &&
                allBuildings.map((building) => (
                  <Marker
                    key={building.id}
                    coordinate={{ latitude: building.position[0], longitude: building.position[1] }}
                    onPress={() => handleBuildingPress(building)}
                  >
                    <View
                      style={[
                        styles.buildingMarker,
                        {
                          backgroundColor: getMarkerColor(building.leadStatus),
                          borderColor: '#FFFFFF',
                        },
                      ]}
                    >
                      <Ionicons name="home" size={10} color="#FFFFFF" />
                    </View>
                  </Marker>
                ))}
            </MapView>
          </View>

          {/* Top-Right Drawing Tools Stack */}
          <View style={styles.topRightTools}>
            <TouchableOpacity
              onPress={() => {
                setIsDrawingMode(true);
                if (drawType !== 'polygon') {
                  setDrawType('polygon');
                  setDrawCoordinates([]);
                }
              }}
              style={[
                styles.toolSquareBtn,
                isDrawingMode && drawType === 'polygon' && styles.toolSquareBtnActive,
              ]}
            >
              <MaterialCommunityIcons
                name="vector-polygon"
                size={22}
                color={isDrawingMode && drawType === 'polygon' ? '#FFFFFF' : '#475569'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setIsDrawingMode(true);
                if (drawType !== 'rectangle') {
                  setDrawType('rectangle');
                  setDrawCoordinates([]);
                }
              }}
              style={[
                styles.toolSquareBtn,
                isDrawingMode && drawType === 'rectangle' && styles.toolSquareBtnActive,
              ]}
            >
              <MaterialCommunityIcons
                name="vector-rectangle"
                size={22}
                color={isDrawingMode && drawType === 'rectangle' ? '#FFFFFF' : '#475569'}
              />
            </TouchableOpacity>
          </View>

          {/* Bottom-Left Legend Panel / Palette button */}
          {!isDrawingMode && (
            <View style={styles.bottomLeftControls}>
              {legendOpen ? (
                <>
                  <View style={[styles.legendCard, { backgroundColor: isDark ? colors.surface : '#FFFFFF' }]}>
                    <Text style={[styles.legendTitle, { color: colors.textSecondary }]}>BUILDING STATUS</Text>
                    {[
                      { color: '#dc3545', label: 'Not Visited' },
                      { color: '#198754', label: 'Lead Created' },
                      { color: '#fd7e14', label: 'Go Back' },
                      { color: '#ffc107', label: 'Interested – No Time' },
                      { color: '#0d6efd', label: 'Not Home' },
                      { color: '#4B0082', label: 'Not Interested' },
                      { color: '#000000', label: 'No Soliciting' },
                      { color: '#6c757d', label: 'Not Qualified' },
                    ].map((item) => (
                      <View key={item.label} style={styles.legendItemRow}>
                        <View style={[styles.legendBadge, { backgroundColor: item.color }]} />
                        <Text style={[styles.legendBadgeText, { color: colors.text }]}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity onPress={() => setLegendOpen(false)} style={styles.legendCloseBtn}>
                    <Ionicons name="close" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity onPress={() => setLegendOpen(true)} style={styles.legendToggleBtn}>
                  <Ionicons name="color-palette" size={24} color="#475569" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Bottom-Right Stack Controls */}
          <View style={styles.bottomRightControls}>
            {/* Round Green Back Button */}
            <TouchableOpacity onPress={onClose} style={styles.roundGreenBtn}>
              <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            {/* Round Green Locate Button */}
            <TouchableOpacity onPress={handleGetCurrentLocation} style={styles.roundGreenBtn}>
              <Ionicons name="locate" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            {/* White control stack */}
            <View style={styles.whiteStack}>
              {/* Map Type toggle */}
              <TouchableOpacity
                onPress={() => setMapType((t) => (t === 'standard' ? 'satellite' : 'standard'))}
                style={styles.stackBtn}
              >
                <Ionicons name="layers" size={20} color="#475569" />
              </TouchableOpacity>

              {/* Zoom In */}
              <TouchableOpacity onPress={() => handleZoom(true)} style={styles.stackBtn}>
                <Ionicons name="add" size={24} color="#475569" />
              </TouchableOpacity>

              {/* Zoom Out */}
              <TouchableOpacity onPress={() => handleZoom(false)} style={styles.stackBtn}>
                <Ionicons name="remove" size={24} color="#475569" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Centered Drawing Toolbar */}
          {isDrawingMode && (
            <View style={styles.drawingToolbarCenter}>
              <TouchableOpacity
                onPress={() => {
                  setIsDrawingMode(false);
                  setDrawCoordinates([]);
                }}
                style={[styles.toolButton, { backgroundColor: '#FF5630' }]}
              >
                <Text style={styles.toolBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setDrawCoordinates((prev) => prev.slice(0, -1))}
                style={[styles.toolButton, { backgroundColor: '#FFAB00' }]}
                disabled={drawCoordinates.length === 0}
              >
                <Text style={styles.toolBtnText}>Undo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSaveZone}
                style={[styles.toolButton, { backgroundColor: '#36B37E' }]}
                disabled={
                  drawType === 'polygon'
                    ? drawCoordinates.length < 3
                    : drawCoordinates.length < 4
                }
              >
                <Text style={styles.toolBtnText}>Save Zone</Text>
              </TouchableOpacity>
            </View>
          )}

        </View>

        {/* Global Loading overlay */}
        {isProcessing && (
          <View style={styles.loaderOverlay}>
            <ActivityIndicator size="large" color={colors.primary.main} />
            <Text style={styles.loaderText}>Processing...</Text>
          </View>
        )}

        {/* SUB-MODAL 1: PropertyDetailModal */}
        {propertyData && (
          <PropertyDetailModal
            visible={propertyModalOpen}
            building={selectedBuilding}
            propertyData={propertyData}
            onCancel={() => {
              setPropertyModalOpen(false);
              setSelectedBuilding(null);
            }}
            onContinue={() => {
              setPropertyModalOpen(false);
              setResultsModalOpen(true);
            }}
            isDark={isDark}
            colors={colors}
          />
        )}

        {/* SUB-MODAL 2: ResultsModal */}
        {selectedBuilding && (
          <ResultsModal
            visible={resultsModalOpen}
            address={propertyData?.formattedAddress || selectedBuilding.label}
            onCancel={() => {
              setResultsModalOpen(false);
              setSelectedBuilding(null);
            }}
            onSelectOption={(val: string) => {
              if (val === 'create_lead') {
                setLeadCreateOpen(true);
              } else {
                setSelectedAction(val);
                setActionModalOpen(true);
              }
            }}
            isDark={isDark}
            colors={colors}
          />
        )}

        {/* SUB-MODAL 3: ActionModal */}
        {selectedBuilding && (
          <ActionModal
            visible={actionModalOpen}
            actionType={selectedAction}
            address={propertyData?.formattedAddress || selectedBuilding.label}
            onSubmit={handleActionSubmit}
            onCancel={() => {
              setActionModalOpen(false);
            }}
            isDark={isDark}
            colors={colors}
          />
        )}

        {/* SUB-MODAL 4: LeadCreateModal */}
        {selectedBuilding && (
          <LeadCreateModal
            visible={leadCreateOpen}
            onClose={() => setLeadCreateOpen(false)}
            onSuccess={handleLeadCreateSuccess}
            user={user}
            fromZone={true}
            zoneId={selectedBuilding.zoneId}
            buildingId={selectedBuilding.id}
            prefilledAddress={propertyData?.formattedAddress || selectedBuilding.label}
            prefilledCoords={{ latitude: selectedBuilding.position[0], longitude: selectedBuilding.position[1] }}
            prefilledOwnerName={propertyData?.owner?.names?.[0] || ''}
          />
        )}

        {/* SUB-MODAL 5: SubmittedLeadPopup */}
        {selectedBuilding && selectedBuilding.leads?.length > 0 && (
          <SubmittedLeadPopup
            visible={submittedLeadPopupOpen}
            leadData={selectedBuilding.leads[0]}
            userPosition={userLocation}
            onClose={() => {
              setSubmittedLeadPopupOpen(false);
              setSelectedBuilding(null);
            }}
            onEdit={() => {
              setSubmittedLeadPopupOpen(false);
              setSelectedAction('go_back');
              setActionModalOpen(true);
            }}
            onStartAppointment={async () => {
              // start work mutation and navigate to LeadCenter
              const lead = selectedBuilding.leads[0];
              const leadId = lead._id || lead.id;
              if (leadId) {
                try {
                  await workMutation.mutateAsync({ leadId, userId: user?._id || user?.id });
                } catch (e) {
                  console.warn('Work mutation failed', e);
                }
                setSubmittedLeadPopupOpen(false);
                onClose();
                navigation.navigate('LeadCenter', { lead });
              }
            }}
            isDark={isDark}
            colors={colors}
          />
        )}

        {/* SUB-MODAL 6: ZoneStatsPopup */}
        {selectedZone && (
          <ZoneStatsPopup
            visible={zoneStatsPopupOpen}
            zone={selectedZone}
            onClose={() => {
              setZoneStatsPopupOpen(false);
              setSelectedZone(null);
            }}
            isDark={isDark}
            colors={colors}
          />
        )}

        {/* Location Search Modal */}
        <Modal
          visible={searchModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSearchModalVisible(false)}
        >
          <View style={styles.overlay}>
            <View style={styles.searchModalContainer}>
              <TouchableOpacity
                onPress={() => setSearchModalVisible(false)}
                style={styles.searchCloseBtn}
              >
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>

              <View style={styles.searchBoxRow}>
                <View style={styles.searchIconBox}>
                  <Ionicons name="location" size={20} color="#FFFFFF" />
                </View>
                <TextInput
                  style={styles.searchField}
                  placeholder="Enter a location"
                  placeholderTextColor="#94A3B8"
                  value={searchText}
                  onChangeText={setSearchText}
                  onSubmitEditing={handleLocationSearch}
                />
              </View>

              <TouchableOpacity
                onPress={handleLocationSearch}
                style={styles.searchSubmitBtn}
              >
                <Ionicons name="search" size={20} color="#FFFFFF" />
                <Text style={styles.searchSubmitBtnText}>Search</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </Modal>
  );
}

// Sub component: PropertyDetailModal
function PropertyDetailModal({ visible, building, propertyData, onContinue, onCancel, isDark, colors }: any) {
  const ownerName = propertyData?.owner?.names?.[0] || 'Unknown Owner';
  const address = propertyData?.formattedAddress || building?.label || 'N/A';

  const yearsOfResidence = propertyData?.lastSaleDate
    ? `${new Date().getFullYear() - new Date(propertyData.lastSaleDate).getFullYear()} years`
    : 'N/A';

  const homeValue = (() => {
    const assessments = propertyData?.taxAssessments;
    if (assessments) {
      const years = Object.keys(assessments).sort((a: any, b: any) => b - a);
      const latestYear = years[0];
      const value = assessments[latestYear]?.value;
      return value ? `$${value.toLocaleString()}` : 'N/A';
    }
    return propertyData?.lastSalePrice ? `$${propertyData.lastSalePrice.toLocaleString()}` : 'N/A';
  })();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: isDark ? colors.surface : '#FFFFFF' }]}>
          <View style={[styles.dialogHeader, { borderBottomColor: isDark ? colors.border : '#E2E8F0' }]}>
            <Text style={[styles.dialogTitle, { color: colors.text }]}>Property Details</Text>
            <TouchableOpacity onPress={onCancel}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.dialogBody}>
            <View style={styles.ownerCard}>
              <View style={[styles.avatar, { backgroundColor: colors.primary.main }]}>
                <Ionicons name="home" size={28} color="#FFFFFF" />
              </View>
              <View style={styles.ownerInfo}>
                <Text style={[styles.ownerName, { color: colors.text }]}>{ownerName}</Text>
                <Text style={[styles.ownerAddress, { color: colors.textSecondary }]}>{address}</Text>
              </View>
            </View>

            <View style={styles.detailsGrid}>
              <DetailItem label="Length of Residence" value={yearsOfResidence} isDark={isDark} colors={colors} />
              <DetailItem label="Year Home Built" value={propertyData?.yearBuilt || 'N/A'} isDark={isDark} colors={colors} />
              <DetailItem label="Square Footage" value={propertyData?.squareFootage ? `${propertyData.squareFootage.toLocaleString()} sq ft` : 'N/A'} isDark={isDark} colors={colors} />
              <DetailItem label="Household Income" value={propertyData?.householdIncome ? `$${propertyData.householdIncome.toLocaleString()}` : 'N/A'} isDark={isDark} colors={colors} />
              <DetailItem label="Owner/Renter" value={propertyData?.ownerOccupied !== undefined ? (propertyData.ownerOccupied ? 'Owner Occupied' : 'Renter') : 'N/A'} isDark={isDark} colors={colors} />
              <DetailItem label="Home Value" value={homeValue} isDark={isDark} colors={colors} />
            </View>
          </ScrollView>

          <View style={styles.dialogFooter}>
            <TouchableOpacity onPress={onCancel} style={[styles.actionBtn, styles.cancelBtn]}>
              <Text style={styles.actionBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onContinue} style={[styles.actionBtn, { backgroundColor: colors.primary.main }]}>
              <Text style={styles.actionBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DetailItem({ label, value, isDark, colors }: any) {
  return (
    <View style={styles.gridItem}>
      <Text style={[styles.gridItemLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.gridItemValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

// Sub component: ResultsModal
function ResultsModal({ visible, address, onSelectOption, onCancel, isDark, colors }: any) {
  const resultOptions = [
    { value: 'not_interested', label: 'Not Interested' },
    { value: 'not_qualified', label: 'Not Qualified' },
    { value: 'no_soliciting', label: 'No Soliciting' },
    { value: 'not_home', label: 'Not Home/No Answer' },
    { value: 'go_back', label: 'Go Back' },
    { value: 'interested_no_time', label: 'Interested - No Time' },
    { value: 'create_lead', label: 'Create Lead' },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: isDark ? colors.surface : '#FFFFFF' }]}>
          <View style={[styles.dialogHeader, { borderBottomColor: isDark ? colors.border : '#E2E8F0' }]}>
            <Text style={[styles.dialogTitle, { color: colors.text }]}>Results</Text>
            <TouchableOpacity onPress={onCancel}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.addressBar}>
            <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            <Text numberOfLines={2} style={[styles.addressText, { color: colors.textSecondary }]}>
              {address}
            </Text>
          </View>

          <FlatList
            data={resultOptions}
            keyExtractor={(item) => item.value}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                onPress={() => onSelectOption(item.value)}
                style={[
                  styles.optionRow,
                  {
                    borderBottomColor: isDark ? colors.border : '#E2E8F0',
                    borderBottomWidth: index < resultOptions.length - 1 ? 1 : 0,
                  },
                ]}
              >
                <Text style={[styles.optionLabel, { color: colors.text }]}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            style={{ maxHeight: 350 }}
          />

          <View style={styles.dialogFooter}>
            <TouchableOpacity onPress={onCancel} style={[styles.actionBtn, styles.cancelBtn, { width: '100%' }]}>
              <Text style={styles.actionBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Sub component: ActionModal
function ActionModal({ visible, actionType, address, onSubmit, onCancel, isDark, colors }: any) {
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [followupDate, setFollowupDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [preferredTime, setPreferredTime] = useState('09:00 AM');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);

  const isGoBack = actionType === 'go_back';
  const isInterestedNoTime = actionType === 'interested_no_time';

  const PREFERRED_TIMES = ['09:00 AM', '11:00 AM', '01:00 PM', '03:00 PM', '05:00 PM', '07:00 PM'];
  const SELECT_ITEMS = ['Fascia Rot', 'Fascia Wrap', 'Soffit', 'Gutter', 'Leaf Filter'];

  const handleItemToggle = (item: string) => {
    setSelectedItems((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));
  };

  const handleFormSubmit = () => {
    onSubmit({
      note,
      ...(isInterestedNoTime && {
        name,
        followupDate: followupDate.toISOString(),
        prefferedTime: preferredTime,
        selectedItems,
      }),
      ...(isGoBack && {
        followupDate: followupDate.toISOString(),
        prefferedTime: preferredTime,
      }),
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: isDark ? colors.surface : '#FFFFFF' }]}>
          <View style={[styles.dialogHeader, { borderBottomColor: isDark ? colors.border : '#E2E8F0' }]}>
            <Text style={[styles.dialogTitle, { color: colors.text }]}>{getStatusLabel(actionType)}</Text>
            <TouchableOpacity onPress={onCancel}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.dialogBody}>
            {isInterestedNoTime && (
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter Name"
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.textInput, { color: colors.text, borderColor: colors.border }]}
                />
              </View>
            )}

            {(isGoBack || isInterestedNoTime) && (
              <View style={styles.row}>
                <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={[styles.inputLabel, { color: colors.text }]}>Date</Text>
                  <TouchableOpacity
                    onPress={() => setShowDatePicker(true)}
                    style={[styles.dropdownTrigger, { borderColor: colors.border }]}
                  >
                    <Text style={{ color: colors.text }}>{format(followupDate, 'MM/dd/yyyy')}</Text>
                    <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker
                      value={followupDate}
                      mode="date"
                      display="default"
                      onChange={(event, date) => {
                        setShowDatePicker(false);
                        if (date) setFollowupDate(date);
                      }}
                    />
                  )}
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={[styles.inputLabel, { color: colors.text }]}>Preferred Time</Text>
                  <TouchableOpacity
                    onPress={() => setShowTimeDropdown((v) => !v)}
                    style={[styles.dropdownTrigger, { borderColor: colors.border }]}
                  >
                    <Text style={{ color: colors.text }}>{preferredTime}</Text>
                    <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>

                  {showTimeDropdown && (
                    <View style={[styles.timeDropdown, { backgroundColor: isDark ? colors.surface : '#FFFFFF', borderColor: colors.border }]}>
                      {PREFERRED_TIMES.map((time) => (
                        <TouchableOpacity
                          key={time}
                          onPress={() => {
                            setPreferredTime(time);
                            setShowTimeDropdown(false);
                          }}
                          style={styles.timeDropdownItem}
                        >
                          <Text style={{ color: colors.text }}>{time}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Address</Text>
              <TextInput
                value={address}
                editable={false}
                style={[styles.textInput, { color: colors.textSecondary, borderColor: colors.border, backgroundColor: isDark ? '#1a1a1a' : '#F8FAFC' }]}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Note</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Enter additional notes..."
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
                style={[styles.textInput, { height: 80, color: colors.text, borderColor: colors.border }]}
              />
            </View>

            {isInterestedNoTime && (
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 8 }]}>Select Items</Text>
                <View style={styles.checkboxContainer}>
                  {SELECT_ITEMS.map((item) => (
                    <TouchableOpacity
                      key={item}
                      onPress={() => handleItemToggle(item)}
                      style={[
                        styles.checkboxItem,
                        {
                          backgroundColor: selectedItems.includes(item) ? colors.primary.main : 'transparent',
                          borderColor: selectedItems.includes(item) ? colors.primary.main : colors.border,
                        },
                      ]}
                    >
                      <Text style={{ color: selectedItems.includes(item) ? '#FFFFFF' : colors.text, fontSize: 12 }}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>

          <View style={styles.dialogFooter}>
            <TouchableOpacity onPress={onCancel} style={[styles.actionBtn, styles.cancelBtn]}>
              <Text style={styles.actionBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleFormSubmit} style={[styles.actionBtn, { backgroundColor: colors.primary.main }]}>
              <Text style={styles.actionBtnText}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Sub component: SubmittedLeadPopup
function SubmittedLeadPopup({ visible, leadData, userPosition, onClose, onEdit, onStartAppointment, isDark, colors }: any) {
  const isCrmLead = leadData?.status === 'selfGenerated' || !!leadData?.fullAddress;

  const isInRange = useMemo(() => {
    if (!userPosition) return false;
    const coords = leadData?.location?.coordinates;
    if (!coords || coords.length < 2) return false;
    // coords are [lng, lat]
    return distanceMiles(userPosition.latitude, userPosition.longitude, coords[1], coords[0]) <= 1.0;
  }, [userPosition, leadData]);

  const workflowState = leadData?.workflowState || 'preview';
  const resumeCount = leadData?.actionCounts?.lead_resume || 0;
  const reviewCount = leadData?.actionCounts?.lead_review || 0;

  const canCheckIn = workflowState === 'preview';
  const isResume = workflowState === 'resume';

  const getApptStatus = () => {
    if (canCheckIn && isInRange) {
      return { text: 'Start Appointment', disabled: false };
    }
    if (!isInRange && !canCheckIn) {
      const text = reviewCount >= 1 ? `Review Appointment (${reviewCount})` : 'Review Appointment';
      return { text, disabled: false };
    }
    if (isResume && isInRange) {
      const text = resumeCount >= 1 ? `Resume Appointment (${resumeCount})` : 'Resume Appointment';
      return { text, disabled: false };
    }
    return { text: 'Preview Appointment (Arrive On-site)', disabled: true };
  };

  const apptStatus = getApptStatus();
  const address = isCrmLead ? leadData.fullAddress : leadData.address;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: isDark ? colors.surface : '#FFFFFF' }]}>
          <View style={[styles.dialogHeader, { backgroundColor: colors.primary.main, borderBottomWidth: 0, paddingVertical: 16 }]}>
            <View>
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 18 }}>Lead Detail</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4 }}>{getStatusLabel(leadData.status)}</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.dialogBody}>
            {isCrmLead && canCheckIn && (
              <View style={styles.congratsBanner}>
                <Text style={styles.congratsText}>🎉 Congrats you created a lead</Text>
              </View>
            )}

            <PopupField icon="location-outline" label="Address" value={address || 'N/A'} colors={colors} />
            
            {isCrmLead ? (
              <>
                {leadData.assignedRep && <PopupField icon="person-outline" label="Assigned Rep" value={leadData.assignedRep} colors={colors} />}
                {leadData.leadCode && <PopupField icon="pricetag-outline" label="Lead Code" value={leadData.leadCode} colors={colors} />}
                {leadData.city && <PopupField icon="business-outline" label="City" value={leadData.city} colors={colors} />}
                {leadData.leadDate && (
                  <PopupField
                    icon="calendar-outline"
                    label="Lead Date"
                    value={format(new Date(leadData.leadDate), 'MM/dd/yyyy')}
                    colors={colors}
                  />
                )}
                {leadData.createdAt && (
                  <PopupField
                    icon="time-outline"
                    label="Submitted"
                    value={format(new Date(leadData.createdAt), 'MM/dd/yyyy hh:mm a')}
                    colors={colors}
                  />
                )}
              </>
            ) : (
              <>
                {leadData.name && <PopupField icon="person-outline" label="Name" value={leadData.name} colors={colors} />}
                {leadData.status === 'create_lead' && leadData.phoneNumber && (
                  <PopupField icon="call-outline" label="Phone" value={leadData.phoneNumber} colors={colors} />
                )}
                {leadData.followupDate && (
                  <PopupField
                    icon="calendar-outline"
                    label="Follow-up Date"
                    value={format(new Date(leadData.followupDate), 'MM/dd/yyyy')}
                    colors={colors}
                  />
                )}
                {leadData.prefferedTime && <PopupField icon="time-outline" label="Preferred Time" value={leadData.prefferedTime} colors={colors} />}
                {leadData.selectedItems && leadData.selectedItems.length > 0 && (
                  <PopupField icon="list-outline" label="Selected Items" value={leadData.selectedItems.join(', ')} colors={colors} />
                )}
                {leadData.date && (
                  <PopupField
                    icon="time-outline"
                    label="Submitted"
                    value={format(new Date(leadData.date), 'MM/dd/yyyy hh:mm a')}
                    colors={colors}
                  />
                )}
                <PopupField icon="document-text-outline" label="Note" value={leadData.note || 'No notes'} colors={colors} />
              </>
            )}
          </ScrollView>

          <View style={styles.dialogFooter}>
            {leadData.status === 'go_back' && onEdit && (
              <TouchableOpacity onPress={onEdit} style={[styles.actionBtn, styles.cancelBtn, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.actionBtnText}>Edit Result</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={onStartAppointment}
              disabled={apptStatus.disabled}
              style={[
                styles.actionBtn,
                {
                  flex: 2,
                  backgroundColor: apptStatus.disabled ? '#94A3B8' : colors.primary.main,
                },
              ]}
            >
              <Text style={styles.actionBtnText}>{apptStatus.text}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PopupField({ icon, label, value, colors }: any) {
  return (
    <View style={styles.popupFieldRow}>
      <View style={[styles.popupFieldIconContainer, { backgroundColor: colors.border }]}>
        <Ionicons name={icon} size={16} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.popupFieldLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[styles.popupFieldValue, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
  );
}

// Sub component: ZoneStatsPopup
function ZoneStatsPopup({ visible, zone, onClose, isDark, colors }: any) {
  const totalHomes = zone.buildingDetails?.length || 0;

  let allLeads: any[] = [];
  if (Array.isArray(zone.salesRepBuildingLeads)) {
    zone.salesRepBuildingLeads.forEach((leadGroup: any) => {
      if (Array.isArray(leadGroup)) {
        allLeads.push(...leadGroup);
      }
    });
  } else if (zone.buildingLeads && Array.isArray(zone.buildingLeads)) {
    zone.buildingLeads.forEach((leadGroup: any) => {
      if (Array.isArray(leadGroup)) {
        allLeads.push(...leadGroup);
      }
    });
  }

  const homesKnocked = allLeads.length;
  const notHome = allLeads.filter((lead) => lead?.status === 'not_home').length;
  const noAnswer = allLeads.filter((lead) => lead?.status === 'no_answer').length;
  const notQualified = allLeads.filter((lead) => lead?.status === 'not_qualified').length;
  const leadsCreated = allLeads.filter((lead) => lead?.status === 'create_lead' || lead?.status === 'selfGenerated').length;
  const goBack = allLeads.filter((lead) => lead?.status === 'go_back').length;
  const interestedNoTime = allLeads.filter((lead) => lead?.status === 'interested_no_time').length;
  const notInterested = allLeads.filter((lead) => lead?.status === 'not_interested').length;
  const noSoliciting = allLeads.filter((lead) => lead?.status === 'no_soliciting').length;

  const percentage = totalHomes > 0 ? Math.round((homesKnocked / totalHomes) * 100) : 0;

  const displayName = (() => {
    const name = zone.zoneName || zone.zoneId || 'Zone Statistics';
    return name.replace(/^(REV-)(\d+)(\d{4})$/, '$1...$3');
  })();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: isDark ? colors.surface : '#FFFFFF' }]}>
          <View style={[styles.dialogHeader, { borderBottomColor: isDark ? colors.border : '#E2E8F0' }]}>
            <Text style={[styles.dialogTitle, { color: colors.text }]}>{displayName}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.dialogBody}>
            <View style={styles.statsGrid}>
              <StatItem label="Total Homes" value={totalHomes} colors={colors} />
              <StatItem label="Homes Knocked" value={homesKnocked} colors={colors} />
              <StatItem label="Not Home / No Answer" value={notHome + noAnswer} colors={colors} />
              <StatItem label="Not Qualified" value={notQualified} colors={colors} />
              <StatItem label="Leads Created" value={leadsCreated} colors={colors} />
              <StatItem label="Go Back" value={goBack} colors={colors} />
              <StatItem label="Interested No Time" value={interestedNoTime} colors={colors} />
              <StatItem label="Not Interested" value={notInterested} colors={colors} />
              <StatItem label="No Soliciting" value={noSoliciting} colors={colors} />
            </View>

            <View style={{ marginTop: 24 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>Progress</Text>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{percentage}% Complete</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: isDark ? colors.border : '#E2E8F0', overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${percentage}%`, backgroundColor: colors.primary.main }} />
              </View>
            </View>
          </ScrollView>

          <View style={styles.dialogFooter}>
            <TouchableOpacity onPress={onClose} style={[styles.actionBtn, { backgroundColor: colors.primary.main, width: '100%' }]}>
              <Text style={styles.actionBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function StatItem({ label, value, colors }: any) {
  return (
    <View style={styles.statGridItem}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 4 }}>{value}</Text>
    </View>
  );
}

// Styling specifications
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  mapTypeToggle: {
    padding: 8,
    borderRadius: 8,
  },
  drawingInfoBox: {
    backgroundColor: '#FF563020',
    padding: 12,
    alignItems: 'center',
  },
  drawingInfoText: {
    color: '#FF5630',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  draftVertex: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF5630',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  buildingMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingControls: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    alignItems: 'center',
    gap: 12,
  },
  floatingButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  floatingBtnLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  drawingToolbar: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 20,
    padding: 6,
    marginRight: 60,
  },
  toolButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  toolBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  legendContainer: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    width: 160,
    borderRadius: 12,
    padding: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  legendTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  legendColor: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  loaderText: {
    color: '#FFFFFF',
    marginTop: 8,
    fontWeight: '600',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialog: {
    width: width * 0.9,
    maxHeight: height * 0.8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  dialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  dialogBody: {
    padding: 20,
  },
  dialogFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 20,
  },
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: '#94A3B8',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  ownerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ownerInfo: {
    flex: 1,
  },
  ownerName: {
    fontSize: 16,
    fontWeight: '700',
  },
  ownerAddress: {
    fontSize: 12,
    marginTop: 4,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    width: (width * 0.9 - 52) / 2,
    marginBottom: 12,
  },
  gridItemLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  gridItemValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  addressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 8,
  },
  addressText: {
    fontSize: 13,
    fontWeight: '500',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  textInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownTrigger: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeDropdown: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 8,
    zIndex: 1000,
    elevation: 5,
  },
  timeDropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  checkboxContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checkboxItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 20,
  },
  congratsBanner: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  congratsText: {
    color: '#15803D',
    fontWeight: '700',
    fontSize: 14,
  },
  popupFieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  popupFieldIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupFieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  popupFieldValue: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  statGridItem: {
    width: (width * 0.9 - 56) / 2,
  },
  topRightTools: {
    position: 'absolute',
    top: 16,
    right: 16,
    gap: 8,
  },
  toolSquareBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  toolSquareBtnActive: {
    backgroundColor: '#4CBB17',
    borderColor: '#4CBB17',
  },
  bottomLeftControls: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    alignItems: 'flex-start',
    gap: 8,
  },
  legendToggleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  legendCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  legendCard: {
    width: 220,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  legendItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  legendBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  legendBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomRightControls: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    alignItems: 'center',
    gap: 12,
  },
  roundGreenBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#4CBB17',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  whiteStack: {
    width: 40,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stackBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  drawingToolbarCenter: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  searchModalContainer: {
    width: width * 0.85,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  searchCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
  },
  searchBoxRow: {
    flexDirection: 'row',
    height: 48,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 20,
    width: '100%',
  },
  searchIconBox: {
    width: 48,
    backgroundColor: '#4CBB17',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchField: {
    flex: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#000000',
  },
  searchSubmitBtn: {
    flexDirection: 'row',
    height: 48,
    backgroundColor: '#4CBB17',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    width: '100%',
    gap: 8,
  },
  searchSubmitBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
