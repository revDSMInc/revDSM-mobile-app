import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import MapView from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import axios from 'axios';

import api from '../services/api';
import { ENV } from '../config/env';
import { normalizeLeadStatus } from '../utils/zone-canvasser-status';
import {
  createBuildingLead,
  updateBuildingLead,
  updateSalesRepLead,
} from '../services/api/zone-canvasser';
import type {
  ActionSubmitData,
  BuildingStatusOverride,
  MapCoordinate,
  ZoneCanvasserBuilding,
  ZoneCanvasserMapProps,
} from '../types/zone-canvasser';

export function useZoneCanvasser({ visible, user }: Pick<ZoneCanvasserMapProps, 'visible' | 'user'>) {
  const mapRef = useRef<MapView>(null);

  const [mapType, setMapType] = useState<'standard' | 'satellite'>('satellite');
  const [userLocation, setUserLocation] = useState<MapCoordinate | null>(null);
  const [initialRegion, setInitialRegion] = useState<any>(null);

  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawType, setDrawType] = useState<'polygon' | 'rectangle'>('polygon');
  const [drawCoordinates, setDrawCoordinates] = useState<MapCoordinate[]>([]);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchCoords, setSearchCoords] = useState<MapCoordinate | null>(null);
  const [isEditingGoBack, setIsEditingGoBack] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [startPoint, setStartPoint] = useState<any>(null);

  const [zones, setZones] = useState<any[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);

  const [selectedBuilding, setSelectedBuilding] = useState<ZoneCanvasserBuilding | null>(null);
  const [propertyData, setPropertyData] = useState<any>(null);
  const [propertyModalOpen, setPropertyModalOpen] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState('');
  const [leadCreateOpen, setLeadCreateOpen] = useState(false);
  const [submittedLeadPopupOpen, setSubmittedLeadPopupOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState<any>(null);
  const [zoneStatsPopupOpen, setZoneStatsPopupOpen] = useState(false);
  const [buildingStatusOverrides, setBuildingStatusOverrides] = useState<
    Record<string, BuildingStatusOverride>
  >({});
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchZones = useCallback(async () => {
    setLoadingZones(true);
    try {
      const response = await api.get<any>('/revzones/v1/sales-rep/my-revzones');
      const data = response?.data;
      if (data && typeof data === 'object') {
        if (Array.isArray(data)) setZones(data);
        else if (Array.isArray(data.zones)) setZones(data.zones);
        else if (Array.isArray(data.data)) setZones(data.data);
        else setZones([]);
      } else {
        setZones([]);
      }
    } catch (error) {
      console.error('Error fetching zones:', error);
      setZones([]);
    } finally {
      setLoadingZones(false);
    }
  }, []);

  const handleGetCurrentLocation = useCallback(() => {
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
      () => {
        setInitialRegion({
          latitude: 27.9506,
          longitude: -82.4572,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }, []);

  useEffect(() => {
    if (visible) {
      setBuildingStatusOverrides({});
      fetchZones();
      handleGetCurrentLocation();
    }
  }, [visible, fetchZones, handleGetCurrentLocation]);

  const allBuildings = useMemo(() => {
    const list: ZoneCanvasserBuilding[] = [];
    if (!Array.isArray(zones)) return list;

    zones.forEach((zone: any) => {
      if (!zone || !Array.isArray(zone.buildingDetails)) return;

      zone.buildingDetails.forEach((building: any) => {
        if (!building) return;

        const canvasserLeadGroup = Array.isArray(zone.salesRepBuildingLeads)
          ? zone.salesRepBuildingLeads.find(
              (leadGroup: any) =>
                Array.isArray(leadGroup) &&
                leadGroup[0]?.buildingDetails?.id !== undefined &&
                leadGroup[0]?.buildingDetails?.id === building.id
            )
          : null;

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
        let leadStatus = normalizeLeadStatus(rawStatus);
        const isCrmLead = rawStatus === 'selfGenerated';
        let leads = matchedGroup || [];

        const override = buildingStatusOverrides[building.id];
        if (override) {
          leadStatus = override.leadStatus ?? leadStatus;
          if (override.leads) leads = override.leads;
        }

        list.push({
          id: building.id,
          position: building.position,
          label: building.label,
          type: building.type,
          zoneId: zone.zoneId || zone._id,
          zoneName: zone.zoneName,
          leads,
          leadStatus,
          leadId: finalLead?._id || override?.leads?.[0]?._id || null,
          address: building.label || 'N/A',
          isCrmLead,
        });
      });
    });
    return list;
  }, [zones, buildingStatusOverrides]);

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
        setSearchCoords({ latitude: lat, longitude: lng });
        mapRef.current?.animateToRegion(
          { latitude: lat, longitude: lng, latitudeDelta: 0.00922, longitudeDelta: 0.00421 },
          500
        );
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

  const handleZoom = (zoomIn: boolean) => {
    mapRef.current?.getCamera().then((camera) => {
      if (camera?.zoom !== undefined) {
        mapRef.current?.animateCamera({ zoom: camera.zoom + (zoomIn ? 1 : -1) }, { duration: 300 });
      } else if (camera?.altitude !== undefined) {
        mapRef.current?.animateCamera(
          { altitude: camera.altitude * (zoomIn ? 0.5 : 2) },
          { duration: 300 }
        );
      }
    });
  };

  const handleTouchStart = async (e: any) => {
    if (!isDrawingMode || drawType !== 'rectangle') return;
    const { locationX, locationY } = e.nativeEvent;
    try {
      const coord = await mapRef.current?.coordinateForPoint({ x: locationX, y: locationY });
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
      const currentCoord = await mapRef.current?.coordinateForPoint({ x: locationX, y: locationY });
      if (currentCoord && startPoint.coord) {
        const corner1 = startPoint.coord;
        const corner2 = currentCoord;
        const minLat = Math.min(corner1.latitude, corner2.latitude);
        const maxLat = Math.max(corner1.latitude, corner2.latitude);
        const minLng = Math.min(corner1.longitude, corner2.longitude);
        const maxLng = Math.max(corner1.longitude, corner2.longitude);
        setDrawCoordinates([
          { latitude: maxLat, longitude: minLng },
          { latitude: maxLat, longitude: maxLng },
          { latitude: minLat, longitude: maxLng },
          { latitude: minLat, longitude: minLng },
        ]);
      }
    } catch (err) {
      console.warn('Touch move error:', err);
    }
  };

  const handleTouchEnd = () => setStartPoint(null);

  const handleMapPress = (e: any) => {
    if (!isDrawingMode || drawType !== 'polygon') return;
    setDrawCoordinates((prev) => [...prev, e.nativeEvent.coordinate]);
  };

  const handleSaveZone = async () => {
    if (drawCoordinates.length < 3) {
      Alert.alert('Invalid Zone', 'A zone must have at least 3 points.');
      return;
    }
    setIsProcessing(true);
    try {
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
        ( way["building"](poly:"${polygonString}"); relation["building"](poly:"${polygonString}"); );
        out center;
      `;
      const response = await axios.post('https://overpass-api.de/api/interpreter', overpassQuery, {
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent': 'RevDSMSalesMobile/1.0 (dev@revdsm.com)',
        },
      });

      const elements = response.data.elements || [];
      const buildingsData = elements
        .filter((el: any) => el.center)
        .map((element: any, index: number) => ({
          id: element.id || `building-${Date.now()}-${index}`,
          position: [element.center?.lat, element.center?.lon],
          label: element.tags?.name || `Building ${index + 1}`,
          type: element.tags?.building || 'yes',
        }));

      const residentialBuildings = buildingsData.filter((b: any) =>
        ['house', 'yes', 'detached', 'residential'].includes(b.type)
      );

      if (residentialBuildings.length === 0) {
        Alert.alert(
          'No Buildings Found',
          'We could not detect any residential buildings within the boundary of this zone.'
        );
        setIsProcessing(false);
        return;
      }

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
        if (first[0] !== last[0] || first[1] !== last[1]) geoJSONCoordinates.push(first);
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
          geometry: { type: 'Polygon', coordinates: [geoJSONCoordinates] },
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
      Alert.alert(
        'Error',
        `${error?.message || 'Error occurred while creating zone.'}`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBuildingPress = (building: ZoneCanvasserBuilding) => {
    setSelectedBuilding(building);
    setIsEditingGoBack(false);
    if (building.leadStatus && building.leads?.length > 0) {
      setSubmittedLeadPopupOpen(true);
    } else {
      setPropertyData(null);
      setPropertyModalOpen(true);
    }
  };

  const handlePropertyDetailContinue = (data: any) => {
    setPropertyData(data);
    setPropertyModalOpen(false);
    setResultsModalOpen(true);
  };

  const handleGoBackEdit = () => {
    setSubmittedLeadPopupOpen(false);
    setIsEditingGoBack(true);
    setResultsModalOpen(true);
  };

  const handlePolygonPress = (zone: any) => {
    setSelectedZone(zone);
    setZoneStatsPopupOpen(true);
  };

  const handleActionSubmit = async (data: ActionSubmitData) => {
    if (!selectedBuilding) return;
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
        address: isEditingGoBack
          ? selectedBuilding?.leads?.[0]?.address || selectedBuilding.label || selectedBuilding.address
          : propertyData?.formattedAddress || selectedBuilding.label || selectedBuilding.address,
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

      let response: any;
      if (isEditingGoBack && selectedBuilding.leadId) {
        response = await updateSalesRepLead(selectedBuilding.leadId, payload);
      } else if (selectedBuilding.leadId) {
        response = await updateBuildingLead(selectedBuilding.leadId, payload);
      } else {
        response = await createBuildingLead(payload);
      }

      const ok = response?.code === 200 || response?.status === 200;
      if (ok) {
        const savedLead = response?.data || payload;
        const markerStatus = normalizeLeadStatus(selectedAction) || selectedAction;
        const mergedLead = {
          ...savedLead,
          status: savedLead?.status || selectedAction,
          address: savedLead?.address || payload.address,
          note: savedLead?.note ?? payload.note,
          date: savedLead?.date || payload.date,
          followupDate: savedLead?.followupDate || payload.followupDate,
          prefferedTime: savedLead?.prefferedTime || payload.prefferedTime,
          name: savedLead?.name || payload.name,
          selectedItems: savedLead?.selectedItems || payload.selectedItems,
        };
        setBuildingStatusOverrides((prev) => ({
          ...prev,
          [selectedBuilding.id]: {
            leadStatus: markerStatus,
            leads: [mergedLead],
          },
        }));
        Alert.alert(
          'Success',
          isEditingGoBack || selectedBuilding.leadId
            ? 'Lead updated successfully'
            : 'Lead created successfully'
        );
        setActionModalOpen(false);
        setSelectedAction('');
        setResultsModalOpen(false);
        setPropertyModalOpen(false);
        setPropertyData(null);
        setIsEditingGoBack(false);
        setSelectedBuilding(null);
        fetchZones();
      } else {
        Alert.alert('Error', 'Failed to submit action result.');
      }
    } catch (error: any) {
      Alert.alert('Submission Error', error?.message || 'Failed to submit action');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLeadCreateSuccess = (createdLead: any) => {
    setLeadCreateOpen(false);
    setResultsModalOpen(false);
    setPropertyModalOpen(false);

    if (createdLead) {
      const responseData = createdLead?.data || createdLead?.lead || createdLead;
      const processedLead = {
        _id: responseData._id || responseData.id,
        status: 'selfGenerated',
        fullAddress: responseData.fullAddress,
        assignedRep: responseData.assignedRep,
        leadCode: responseData.leadCode,
        city: responseData.city,
        leadDate: responseData.leadDate,
        createdAt: responseData.createdAt,
        location: responseData.location,
        assignedRepId: responseData.assignedRepId,
        workflowState: responseData.workflowState || 'preview',
        actionCounts: responseData.actionCounts || {},
      };

      setSelectedBuilding((prev) => {
        if (!prev) return prev;
        setBuildingStatusOverrides((overrides) => ({
          ...overrides,
          [prev.id]: { leadStatus: 'create_lead', leads: [processedLead] },
        }));
        return {
          ...prev,
          leads: [processedLead],
          leadStatus: 'create_lead',
          leadId: processedLead._id,
          isCrmLead: true,
        };
      });
      setPropertyData(null);
      fetchZones();
      setTimeout(() => setSubmittedLeadPopupOpen(true), 200);
    } else {
      setSelectedBuilding(null);
      setPropertyData(null);
    }
  };

  const startDrawing = (type: 'polygon' | 'rectangle') => {
    setIsDrawingMode(true);
    if (drawType !== type) {
      setDrawType(type);
      setDrawCoordinates([]);
    }
  };

  const cancelDrawing = () => {
    setIsDrawingMode(false);
    setDrawCoordinates([]);
  };

  return {
    mapRef,
    mapType,
    setMapType,
    userLocation,
    initialRegion,
    isDrawingMode,
    drawType,
    drawCoordinates,
    setDrawCoordinates,
    searchModalVisible,
    setSearchModalVisible,
    searchText,
    setSearchText,
    searchCoords,
    isEditingGoBack,
    legendOpen,
    setLegendOpen,
    zones,
    loadingZones,
    allBuildings,
    selectedBuilding,
    setSelectedBuilding,
    propertyData,
    setPropertyData,
    propertyModalOpen,
    setPropertyModalOpen,
    resultsModalOpen,
    setResultsModalOpen,
    actionModalOpen,
    setActionModalOpen,
    selectedAction,
    setSelectedAction,
    leadCreateOpen,
    setLeadCreateOpen,
    submittedLeadPopupOpen,
    setSubmittedLeadPopupOpen,
    selectedZone,
    setSelectedZone,
    zoneStatsPopupOpen,
    setZoneStatsPopupOpen,
    isProcessing,
    handleGetCurrentLocation,
    handleLocationSearch,
    handleZoom,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleMapPress,
    handleSaveZone,
    handleBuildingPress,
    handlePropertyDetailContinue,
    handleGoBackEdit,
    handlePolygonPress,
    handleActionSubmit,
    handleLeadCreateSuccess,
    startDrawing,
    cancelDrawing,
    setIsEditingGoBack,
  };
}
