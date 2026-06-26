import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import { MapView, Camera } from '@rnmapbox/maps';
import type { Region } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import axios from 'axios';

import api from '../services/api';
import { ENV } from '../config/env';
import { logEvent } from '../services/api/LoggerService';
import { calculateDistance } from '../utils/location-util';
import { normalizeLeadStatus } from '../utils/zone-canvasser-status';
import {
  createBuildingLead,
  updateBuildingLead,
  updateSalesRepLead,
} from '../services/api/zone-canvasser';
import {
  clearZoneMapState,
  markZoneCanvasserShouldReopen,
  peekZoneMapState,
  saveZoneMapState,
} from '../utils/zone-canvasser-session';
import type {
  ActionSubmitData,
  BuildingStatusOverride,
  MapCoordinate,
  ZoneCanvasserBuilding,
  ZoneCanvasserMapProps,
} from '../types/zone-canvasser';

export function useZoneCanvasser({ visible, user }: Pick<ZoneCanvasserMapProps, 'visible' | 'user'>) {
  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);
  const mapRegionRef = useRef<Region | null>(null);
  const hasRestoredRef = useRef(false);
  const pendingRestoreRef = useRef<Awaited<ReturnType<typeof peekZoneMapState>>>(null);

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

  /** Animate the Mapbox camera to a react-native-maps-style Region (lat/lng + deltas). */
  const animateToRegion = useCallback((region: Region, duration = 500) => {
    const latDelta = region.latitudeDelta > 0 ? region.latitudeDelta : 0.05;
    const zoom = Math.max(0, Math.min(20, Math.log2(360 / latDelta)));
    cameraRef.current?.setCamera({
      centerCoordinate: [region.longitude, region.latitude],
      zoomLevel: zoom,
      animationDuration: duration,
    });
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
        animateToRegion(region, 500);
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
  }, [animateToRegion]);

  useEffect(() => {
    if (!visible) {
      hasRestoredRef.current = false;
      pendingRestoreRef.current = null;
      return;
    }
    setBuildingStatusOverrides({});
    fetchZones();
    handleGetCurrentLocation();
    const saved = peekZoneMapState();
    if (saved) pendingRestoreRef.current = saved;
  }, [visible, fetchZones, handleGetCurrentLocation]);

  const handleMapRegionChange = useCallback((region: Region) => {
    mapRegionRef.current = region;
  }, []);

  /** Web handleSaveMapState — persist camera + building before navigating to Lead Center. */
  const saveMapStateForAppointment = useCallback(async () => {
    if (!selectedBuilding) return;
    const region =
      mapRegionRef.current ||
      initialRegion || {
        latitude: 27.9506,
        longitude: -82.4572,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      };
    saveZoneMapState({
      latitude: region.latitude,
      longitude: region.longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
      buildingId: selectedBuilding.id,
    });
    markZoneCanvasserShouldReopen();
  }, [selectedBuilding, initialRegion]);

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
        let leadStatus = normalizeLeadStatus(rawStatus) || (finalLead ? 'create_lead' : null);
        const isCrmLead = rawStatus === 'selfGenerated' || rawStatus === 'create_lead' || !!crmLeadGroup;
        let leads = matchedGroup || [];

        const override = buildingStatusOverrides[String(building.id)];
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

  /** Keep selected building lead in sync after zones refetch (e.g. workflowState → resume after Start Appointment). */
  useEffect(() => {
    if (!visible || !selectedBuilding?.id) return;
    const fresh = allBuildings.find((b) => String(b.id) === String(selectedBuilding.id));
    if (!fresh) return;

    const prevLead = selectedBuilding.leads?.[0];
    const nextLead = fresh.leads?.[0];
    const prevWs = prevLead?.workflowState;
    const nextWs = nextLead?.workflowState;

    if (
      prevWs !== nextWs ||
      JSON.stringify(prevLead?.actionCounts) !== JSON.stringify(nextLead?.actionCounts)
    ) {
      console.log('[ZoneCanvasser] Syncing building lead from zones', {
        buildingId: fresh.id,
        prevWorkflowState: prevWs,
        nextWorkflowState: nextWs,
        prevActionCounts: prevLead?.actionCounts,
        nextActionCounts: nextLead?.actionCounts,
      });
      setSelectedBuilding(fresh);
    }
  }, [allBuildings, visible, selectedBuilding?.id]);

  // Restore map + building popup after returning from Lead Center (web sessionStorage parity)
  useEffect(() => {
    if (!visible || hasRestoredRef.current) return;

    let cancelled = false;
    (async () => {
      if (!pendingRestoreRef.current) {
        pendingRestoreRef.current = peekZoneMapState();
      }
      const saved = pendingRestoreRef.current;
      if (!saved) {
        hasRestoredRef.current = true;
        return;
      }

      if (allBuildings.length === 0) return;

      const building = allBuildings.find(
        (b) => String(b.id) === String(saved.buildingId)
      );
      if (!building) return;

      if (cancelled) return;

      const region = {
        latitude: saved.latitude,
        longitude: saved.longitude,
        latitudeDelta: saved.latitudeDelta,
        longitudeDelta: saved.longitudeDelta,
      };
      mapRegionRef.current = region;
      pendingRestoreRef.current = null;
      clearZoneMapState();
      hasRestoredRef.current = true;

      setSelectedBuilding(building);
      setSubmittedLeadPopupOpen(true);
      fetchZones();

      console.log('[ZoneCanvasser] Restored map state after Lead Center', {
        buildingId: saved.buildingId,
        workflowState: building.leads?.[0]?.workflowState,
      });

      setTimeout(() => {
        animateToRegion(region, 400);
      }, 350);
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, allBuildings]);

  const navigateToSearchLocation = useCallback((coords: MapCoordinate) => {
    setSearchCoords(coords);
    animateToRegion(
      {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.00922,
        longitudeDelta: 0.00421,
      },
      500
    );
    setSearchModalVisible(false);
  }, [animateToRegion]);

  const handleZoom = async (zoomIn: boolean) => {
    try {
      const zoom = await mapRef.current?.getZoom();
      if (zoom != null) {
        cameraRef.current?.zoomTo(
          Math.max(0, Math.min(20, zoom + (zoomIn ? 1 : -1))),
          300
        );
      }
    } catch (err) {
      console.warn('Zoom error:', err);
    }
  };

  const handleTouchStart = async (e: any) => {
    if (!isDrawingMode || drawType !== 'rectangle') return;
    const { locationX, locationY } = e.nativeEvent;
    try {
      const point = await mapRef.current?.getCoordinateFromView([locationX, locationY]);
      const coord = point ? { latitude: point[1], longitude: point[0] } : null;
      if (coord) {
        setStartPoint({ x: locationX, y: locationY, coord });
        setDrawCoordinates([coord]);
      }
    } catch (err) {
      console.warn('Touch start error:', err);
    }
  };

  const isConvertingRef = useRef(false);

  const handleTouchMove = async (e: any) => {
    if (!isDrawingMode || drawType !== 'rectangle' || !startPoint) return;
    if (isConvertingRef.current) return;

    const { locationX, locationY } = e.nativeEvent;
    
    isConvertingRef.current = true;
    try {
      const point = await mapRef.current?.getCoordinateFromView([locationX, locationY]);
      const currentCoord = point ? { latitude: point[1], longitude: point[0] } : null;
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
          { latitude: maxLat, longitude: minLng }, // close the loop
        ]);
      }
    } catch (err) {
      console.warn('Touch move error:', err);
    } finally {
      // Small delay to prevent bridge flooding
      setTimeout(() => {
        isConvertingRef.current = false;
      }, 16);
    }
  };

  const handleTouchEnd = () => setStartPoint(null);

  const handleMapPress = (e: any) => {
    if (!isDrawingMode || drawType !== 'polygon') return;
    // Extract coordinate synchronously before setState — React's event pooling
    // nullifies e.nativeEvent by the time the updater callback runs, causing
    // "Cannot read property 'coordinate' of null" on the 3rd dot.
    const coordinate = e?.nativeEvent?.coordinate;
    if (!coordinate) return;
    setDrawCoordinates((prev) => [...prev, coordinate]);
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
      let response: any = null;
      let overpassError: any = null;
      const endpoints = [
        'https://overpass-api.de/api/interpreter',
        'https://lz4.overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
      ];
      
      for (let i = 0; i < endpoints.length; i++) {
        try {
          response = await axios.post(endpoints[i], overpassQuery, {
            headers: {
              'Content-Type': 'text/plain',
              'User-Agent': 'RevDSMSalesMobile/1.0 (dev@revdsm.com)',
            },
            timeout: 15000, // 15 seconds
          });
          if (response && response.data) break;
        } catch (err: any) {
          overpassError = err;
          console.warn(`Overpass API failed on ${endpoints[i]}:`, err?.message);
          // Wait 1s before trying next endpoint to allow servers to breathe/cache
          await new Promise(resolve => setTimeout(() => resolve(undefined), 1000));
        }
      }

      if (!response || !response.data) {
        throw new Error(
          `Failed to fetch building data. Please try again or draw a smaller zone. (${overpassError?.message || 'Timeout'})`
        );
      }

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
    if (building.leads && building.leads.length > 0) {
      setSubmittedLeadPopupOpen(true);

      const leadData = building.leads[0];
      const coords = leadData?.location?.coordinates;
      const targetLat = coords ? coords[1] : building.position[0];
      const targetLng = coords ? coords[0] : building.position[1];
      const fromLat = userLocation?.latitude;
      const fromLng = userLocation?.longitude;
      const distance = (fromLat != null && fromLng != null)
        ? calculateDistance(fromLat, fromLng, targetLat, targetLng)
        : 0;

      logEvent('click', {
        user_id: user?._id || user?.id,
        created_by: user?._id || user?.id,
        module_type: 'map_interaction',
        meta: {
          jobNumber: leadData?.jobNumber || 'N/A',
          jobId: leadData?._id || leadData?.id || 'N/A',
          address: leadData?.address?.streetName || leadData?.streetName || building.label || 'N/A',
          city: leadData?.address?.city || leadData?.city || 'N/A',
          state: leadData?.address?.state || leadData?.state || 'N/A',
          coordinates: { lat: targetLat, lng: targetLng },
          price: leadData?.price || 0,
          installDate: leadData?.installationDate || leadData?.leadDate || '',
          distance: distance || 0,
          distanceFrom: 'user_gps',
          action: 'job_pin_selected',
        },
      });
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
          [String(selectedBuilding.id)]: {
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

  /** Optimistic + persisted lead patch after setLeadWork (preview → resume on web). */
  const patchBuildingLeadAfterWork = useCallback(
    (buildingId: string | number, patch: Record<string, any>) => {
      console.log('[ZoneCanvasser] patchBuildingLeadAfterWork', { buildingId, patch });
      const key = String(buildingId);
      setBuildingStatusOverrides((prev) => {
        const existing = prev[key];
        const baseLeads = existing?.leads || selectedBuilding?.leads || [];
        const lead0 = baseLeads[0] || {};
        const mergedLead = { ...lead0, ...patch };
        return {
          ...prev,
          [key]: {
            leadStatus: existing?.leadStatus ?? selectedBuilding?.leadStatus ?? null,
            leads: [mergedLead],
          },
        };
      });
      if (selectedBuilding && String(selectedBuilding.id) === key) {
        const lead0 = selectedBuilding.leads?.[0] || {};
        setSelectedBuilding({
          ...selectedBuilding,
          leads: [{ ...lead0, ...patch }],
        });
      }
    },
    [selectedBuilding]
  );

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
        lowesLead: responseData.lowesLead === true,
      };
      console.log('[ZoneCanvasser] Lead created (self-gen)', {
        leadId: processedLead._id,
        workflowState: processedLead.workflowState,
        lowesLead: processedLead.lowesLead,
      });

      setSelectedBuilding((prev) => {
        if (!prev) return prev;
        setBuildingStatusOverrides((overrides) => ({
          ...overrides,
          [String(prev.id)]: { leadStatus: 'create_lead', leads: [processedLead] },
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
    cameraRef,
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
    navigateToSearchLocation,
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
    handleMapRegionChange,
    saveMapStateForAppointment,
    patchBuildingLeadAfterWork,
    fetchZones,
  };
}
