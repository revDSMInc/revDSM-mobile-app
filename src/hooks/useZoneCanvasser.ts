import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import { MapView, Camera } from '@rnmapbox/maps';
import type { Region } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import axios from 'axios';

import { useDeviceHeading } from './useDeviceHeading';

import { logEvent } from '../services/api/LoggerService';
import { logMapPinSelected } from '../utils/activity-log/map-activity-log';
import { normalizeLeadStatus } from '../utils/zone-canvasser-status';
import {
  archiveZone,
  createBuildingLead,
  createZone,
  deleteZone,
  fetchArchivedZones,
  fetchCanvasserZones,
  unarchiveZone,
  updateBuildingLead,
  updateSalesRepLead,
} from '../services/api/zone-canvasser';
import {
  DEFAULT_ZONE_COLOR,
  createZonePayload,
  isZoneActionSuccess,
  overpassElementsToHouses,
  resolveZoneCreateError,
  toZoneCoordinates,
  validateZonePayload,
  zoneApiId,
} from '../utils/zone-helpers';
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
  const [liveLocation, setLiveLocation] = useState<{
    latitude: number;
    longitude: number;
    heading: number | null;
    accuracy: number | null;
  } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const [initialRegion, setInitialRegion] = useState<any>(null);

  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawType, setDrawType] = useState<'polygon' | 'rectangle'>('polygon');
  const [drawCoordinates, setDrawCoordinates] = useState<MapCoordinate[]>([]);
  const [searchAddress, setSearchAddress] = useState('');
  const [searchCoords, setSearchCoords] = useState<MapCoordinate | null>(null);
  const [isEditingGoBack, setIsEditingGoBack] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [showLeadPins, setShowLeadPins] = useState(true);
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

  const [archivedZones, setArchivedZones] = useState<any[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [unarchivingZoneId, setUnarchivingZoneId] = useState<string | null>(null);
  const [isZoneActionProcessing, setIsZoneActionProcessing] = useState(false);

  const fetchZones = useCallback(async () => {
    setLoadingZones(true);
    try {
      setZones(await fetchCanvasserZones());
    } catch (error) {
      console.error('Error fetching zones:', error);
      setZones([]);
    } finally {
      setLoadingZones(false);
    }
  }, []);

  const fetchArchived = useCallback(async () => {
    setArchivedLoading(true);
    try {
      setArchivedZones(await fetchArchivedZones());
    } catch (error) {
      console.error('Error fetching archived zones:', error);
      setArchivedZones([]);
    } finally {
      setArchivedLoading(false);
    }
  }, []);

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
      setSearchAddress('');
      setSearchCoords(null);
      setArchivedOpen(false);
      return;
    }
    setBuildingStatusOverrides({});
    fetchZones();
    fetchArchived();
    handleGetCurrentLocation();
    const saved = peekZoneMapState();
    if (saved) pendingRestoreRef.current = saved;
  }, [visible, fetchZones, fetchArchived, handleGetCurrentLocation]);

  useEffect(() => {
    const stopWatch = () => {
      if (watchIdRef.current != null) {
        Geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };

    if (!visible || isDrawingMode) {
      stopWatch();
      return;
    }

    watchIdRef.current = Geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, heading, accuracy } = position.coords;
        setLiveLocation({
          latitude,
          longitude,
          heading: heading != null && !Number.isNaN(heading) && heading >= 0 ? heading : null,
          accuracy: accuracy != null && accuracy > 0 ? accuracy : null,
        });
      },
      (err) => {
        console.warn('[ZoneCanvasser] live-location watch error:', err?.message);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 1,
        interval: 2000,
        fastestInterval: 1000,
      }
    );

    return stopWatch;
  }, [visible, isDrawingMode]);

  const compassHeading = useDeviceHeading(visible && !isDrawingMode);
  const liveLocationWithHeading = useMemo(() => {
    if (!liveLocation) return null;
    return {
      ...liveLocation,
      heading: compassHeading != null ? compassHeading : liveLocation.heading,
    };
  }, [liveLocation, compassHeading]);

  const handleMapRegionChange = useCallback((region: Region) => {
    mapRegionRef.current = region;
  }, []);

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

  const updateSearch = useCallback((address: string, coords: MapCoordinate) => {
    setSearchAddress(address);
    setSearchCoords(coords);
    cameraRef.current?.setCamera({
      centerCoordinate: [coords.longitude, coords.latitude],
      zoomLevel: 17,
      animationDuration: 500,
    });
  }, []);

  const clearSearch = useCallback(() => {
    setSearchAddress('');
    setSearchCoords(null);
  }, []);

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
      setTimeout(() => {
        isConvertingRef.current = false;
      }, 16);
    }
  };

  const handleTouchEnd = () => setStartPoint(null);

  const handleMapPress = (e: any) => {
    if (archivedOpen) setArchivedOpen(false);
    if (!isDrawingMode || drawType !== 'polygon') return;
    const coordinate = e?.nativeEvent?.coordinate;
    if (!coordinate) return;
    setDrawCoordinates((prev) => [...prev, coordinate]);
  };

  const handleSaveZone = async () => {
    const coordinates = toZoneCoordinates(drawCoordinates);
    if (coordinates.length < 3) {
      Alert.alert('Invalid Zone', 'Please draw a valid area');
      return;
    }

    setIsProcessing(true);
    try {
      const polygonString = coordinates.map((c) => `${c[0]} ${c[1]}`).join(' ');
      const overpassQuery = `
        [out:json];
        (
          way["building"](poly:"${polygonString}");
          relation["building"](poly:"${polygonString}");
        );
        out center;
      `;
      const overpassEndpoints = [
        'https://overpass-api.de/api/interpreter',
        'https://lz4.overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
      ];
      let elements: any[] | null = null;
      for (const endpoint of overpassEndpoints) {
        try {
          const response = await axios.post(endpoint, overpassQuery, {
            headers: {
              'Content-Type': 'text/plain',
              'User-Agent': 'RevDSMSalesMobile/1.0 (dev@revdsm.com)',
            },
            timeout: 15000,
          });
          if (response?.data) {
            elements = response.data.elements || [];
            break;
          }
        } catch (err: any) {
          console.warn(`Overpass API failed on ${endpoint}:`, err?.message);
        }
      }
      const buildingsFetchFailed = elements === null;
      const buildingsData = overpassElementsToHouses(elements || []);

      const payload = createZonePayload({
        coordinates,
        buildingDetails: buildingsData,
        layerType: 'polygon',
        color: DEFAULT_ZONE_COLOR,
        userId: user?._id || user?.id,
        companyId: user?.companyId,
      });

      const validation = validateZonePayload(payload);
      if (!validation.isValid) {
        console.error('Zone payload validation failed:', validation.errors);
        Alert.alert('Error', `Validation failed: ${validation.errors.join(', ')}`);
        return;
      }

      try {
        const response = await createZone(payload);
        if (response?.code === 200) {
          Alert.alert(
            'Success',
            `Zone ${payload.zoneName} created with ${buildingsData.length} buildings`
          );
          setIsDrawingMode(false);
          setDrawCoordinates([]);
          fetchZones();
        } else {
          Alert.alert('Error', resolveZoneCreateError(response?.message));
        }
      } catch (error: any) {
        console.error('Error creating zone:', error);
        const message = resolveZoneCreateError(error?.message);
        Alert.alert(
          'Error',
          buildingsFetchFailed ? `Failed to fetch buildings. ${message}` : message
        );
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleZoneDelete = async (zone: any) => {
    const zoneId = zoneApiId(zone);
    if (!zoneId) return;
    try {
      setIsZoneActionProcessing(true);
      const response = await deleteZone(zoneId);
      if (response?.code === 200) {
        setZoneStatsPopupOpen(false);
        setSelectedZone(null);
        fetchZones();
        setTimeout(() => Alert.alert('Success', 'Zone deleted successfully'), 400);
      } else {
        Alert.alert('Error', response?.message || 'Failed to delete zone');
      }
    } catch (error: any) {
      console.error('Error deleting zone:', error);
      Alert.alert('Error', error?.message || 'Failed to delete zone');
    } finally {
      setIsZoneActionProcessing(false);
    }
  };

  const handleZoneArchive = async (zone: any) => {
    const zoneId = zoneApiId(zone);
    if (!zoneId) return;
    try {
      setIsZoneActionProcessing(true);
      const response = await archiveZone(zoneId);
      if (isZoneActionSuccess(response)) {
        setZoneStatsPopupOpen(false);
        setSelectedZone(null);
        fetchZones();
        fetchArchived();
        setTimeout(() => Alert.alert('Success', 'Zone archived successfully'), 400);
      } else {
        Alert.alert('Error', response?.message || 'Failed to archive zone');
      }
    } catch (error: any) {
      console.error('Error archiving zone:', error);
      Alert.alert('Error', error?.message || 'Failed to archive zone');
    } finally {
      setIsZoneActionProcessing(false);
    }
  };

  const handleZoneUnarchive = async (zone: any) => {
    const zoneId = zoneApiId(zone);
    if (!zoneId) return;
    try {
      setUnarchivingZoneId(zoneId);
      const response = await unarchiveZone(zoneId);
      if (isZoneActionSuccess(response)) {
        setArchivedOpen(false);
        fetchArchived();
        fetchZones();
        Alert.alert('Success', 'Zone unarchived successfully');
      } else {
        Alert.alert('Error', response?.message || 'Failed to unarchive zone');
      }
    } catch (error: any) {
      console.error('Error unarchiving zone:', error);
      Alert.alert('Error', error?.message || 'Failed to unarchive zone');
    } finally {
      setUnarchivingZoneId(null);
    }
  };

  const toggleArchivedOpen = () => {
    setArchivedOpen((v) => !v);
    setLegendOpen(false);
  };

  const openLegend = () => {
    setLegendOpen(true);
    setArchivedOpen(false);
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

      logMapPinSelected(user, {
        job: {
          ...leadData,
          address: leadData?.address || { streetName: building.label },
        },
        coordinates: { lat: targetLat, lng: targetLng },
        userLocation,
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

      const userId = user?._id || user?.id;
      if (userId) {
        logEvent('add', {
          user_id: userId,
          module_type: 'self_gen_lead',
          created_by: userId,
          meta: {
            leadData: responseData,
            action: 'self_gen_lead_created',
          },
        });
      }

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
    liveLocation: liveLocationWithHeading,
    initialRegion,
    isDrawingMode,
    drawType,
    drawCoordinates,
    setDrawCoordinates,
    searchAddress,
    searchCoords,
    updateSearch,
    clearSearch,
    isEditingGoBack,
    legendOpen,
    setLegendOpen,
    showLeadPins,
    setShowLeadPins,
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
    archivedZones,
    archivedLoading,
    archivedOpen,
    setArchivedOpen,
    toggleArchivedOpen,
    openLegend,
    unarchivingZoneId,
    isZoneActionProcessing,
    handleZoneDelete,
    handleZoneArchive,
    handleZoneUnarchive,
  };
}
