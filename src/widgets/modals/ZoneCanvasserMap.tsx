import React, { useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StatusBar, Platform, type TextInput } from 'react-native';
import { useBottomInset } from '../../hooks/useBottomInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../common/MainHeader';
import { MapToggleSwitch } from '../common/MapToggleSwitch';
import { useWorkLeadMutation } from '../../hooks/useLeadMutation';
import { useZoneCanvasser } from '../../hooks/useZoneCanvasser';
import { MapCanvas } from '../components/ZoneCanvasser/MapCanvas';
import { MapDrawTools } from '../components/ZoneCanvasser/MapDrawTools';
import { MapLegendCard, MapLegendToggle } from '../components/ZoneCanvasser/MapLegend';
import { ArchivedZonesCard, ArchivedZonesToggle } from '../components/ZoneCanvasser/ArchivedZonesPanel';
import { MapControlsPanel } from '../components/ZoneCanvasser/MapControlsPanel';
import { DrawingToolbar } from '../components/ZoneCanvasser/DrawingToolbar';
import { DrawingInfoBanner } from '../components/ZoneCanvasser/DrawingInfoBanner';
import { LoadingOverlay } from '../components/ZoneCanvasser/LoadingOverlay';
import { ZoneCanvasserModals } from '../components/ZoneCanvasser/ZoneCanvasserModals';
import { ZoneSearchBar } from '../components/ZoneCanvasser/ZoneSearchBar';
import {
  executeStartAppointmentFlow,
  logLeadActionClick,
  persistActiveLeadId,
  planZoneCanvasserStartAppointment,
} from '../../utils/lead-activity-log';
import { isOnline } from '../../services/connectivity';
import { findOfflineWorkForLead, queueLeadWorkStart } from '../../services/offlineLeadStore';
import { markLeadCheckedInOffline } from '../../services/offlineLeadStatus';
import { createdAtTheDoor, isOfflineLead, offlineCheckInModule } from '../../utils/offline-lead-work';
import type { ZoneCanvasserMapProps } from '../../types/zone-canvasser';
import { MapFiltersModal, countAppliedMapFilters, type FilterState } from './MapFiltersModal';
import { DEFAULT_MAP_FILTERS } from '../../utils/map-job-filters';

export default function ZoneCanvasserMap({
  visible,
  onClose,
  user,
  navigation,
}: ZoneCanvasserMapProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomInset();
  const workMutation = useWorkLeadMutation();
  const z = useZoneCanvasser({ visible, user });
  const searchInputRef = useRef<TextInput>(null);
  // Header funnel -> the same filter sheet the Map screen uses, applied to the sales pins (client-side, not persisted).
  const [showFilters, setShowFilters] = useState(false);
  const [pinFilters, setPinFilters] = useState<FilterState>(DEFAULT_MAP_FILTERS);
  const appliedFilterCount = countAppliedMapFilters(pinFilters);

  const handleSelectResult = (val: string) => {
    z.setResultsModalOpen(false);
    if (val === 'create_lead') {
      z.setLeadCreateOpen(true);
    } else {
      z.setSelectedAction(val);
      z.setActionModalOpen(true);
    }
  };

  const handleStartAppointment = async () => {
    const lead = z.selectedBuilding?.leads?.[0];
    const leadId = lead?._id || lead?.id;
    if (!leadId) return;

    let targetLead = lead;

    if (isOfflineLead(lead) || !isOnline()) {
      try {
        await persistActiveLeadId(leadId);
        const plan = planZoneCanvasserStartAppointment(lead, z.userLocation);
        const atTheDoor = createdAtTheDoor(findOfflineWorkForLead(lead));
        if (plan.shouldCallWork || atTheDoor) {
          const logModule = offlineCheckInModule(plan, atTheDoor);
          if (logModule) {
            void logLeadActionClick(user, logModule as any, lead);
          }
          if (logModule !== 'lead_review') {
            markLeadCheckedInOffline(leadId);
            queueLeadWorkStart(lead, String(user?._id || user?.id || ''));
          }
        }
      } catch (e) {
        console.warn('[ZoneCanvasser] offline check-in could not be recorded:', e);
      }
      await z.saveMapStateForAppointment();
      z.setSubmittedLeadPopupOpen(false);
      setTimeout(() => {
        onClose();
        setTimeout(() => {
          navigation.navigate('LeadCenter', { lead, fromZoneCanvasser: true });
        }, 400);
      }, 100);
      return;
    }

    try {
      const result = await executeStartAppointmentFlow({
        lead,
        user,
        userLocation: z.userLocation,
        workMutation,
        fromZoneCanvasser: true,
        onWorkSuccess: (updated) => {
          if (!z.selectedBuilding?.id) return;
          const prevCounts = lead?.actionCounts || {};
          const nextCounts = updated.actionCounts || {
            ...prevCounts,
            lead_check_in: prevCounts.lead_check_in || 0,
            lead_resume: prevCounts.lead_resume || 0,
          };
          z.patchBuildingLeadAfterWork(z.selectedBuilding.id, {
            workflowState: updated.workflowState || 'resume',
            actionCounts: nextCounts,
          });
        },
      });
      targetLead = result.lead;
    } catch (e) {
      console.warn('[ZoneCanvasser] Start appointment failed', e);
    }

    await z.saveMapStateForAppointment();
    z.setSubmittedLeadPopupOpen(false);
    setTimeout(() => {
      onClose();
      setTimeout(() => {
        navigation.navigate('LeadCenter', {
          lead: targetLead,
          fromZoneCanvasser: true,
          appointmentStarted: true,
        });
      }, 400);
    }, 300);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View
        className="flex-1"
        style={{ flex: 1, backgroundColor: isDark ? colors.background : '#F8FAFC' }}
      >
        <StatusBar barStyle="light-content" backgroundColor={isDark ? colors.background : '#0E2A1C'} translucent />
        {(Platform.OS === 'ios' || Platform.OS === 'android') && (
          <View style={{ height: insets.top, backgroundColor: isDark ? colors.background : '#0E2A1C' }} />
        )}
        <Header
          onFilterPress={() => {
            if (z.isDrawingMode) return;
            setShowFilters(true);
          }}
          filterCount={appliedFilterCount}
          onNavigate={(route: string) => {
            if (route === 'Leads') {
              onClose();
            } else {
              onClose();
              setTimeout(() => {
                navigation.navigate(route);
              }, 400);
            }
          }}
        />

        {z.isDrawingMode && <DrawingInfoBanner drawType={z.drawType} />}

        <View className="flex-1 relative" style={{ flex: 1 }}>
          {/* Top row: back button + address search (web zone-canvasser search bar).
              The suggestions list grows DOWN inside this row, so it stays within its
              parent's bounds — Android drops touches on children drawn outside them. */}
          <View
            className="absolute flex-row items-start"
            style={{ top: 20, left: 16, right: 16, zIndex: 30, elevation: 30, gap: 8 }}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              onPress={onClose}
              className="w-11 h-11 rounded-full bg-[#4CBB17] items-center justify-center shadow-md"
            >
              <MaterialCommunityIcons name="arrow-left" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            {/* Kept mounted while drawing (only hidden) so a typed query survives it. */}
            <View style={{ flex: 1, display: z.isDrawingMode ? 'none' : 'flex' }}>
              <ZoneSearchBar
                ref={searchInputRef}
                visible={visible}
                onSearch={z.updateSearch}
                onClear={z.clearSearch}
              />
            </View>
          </View>

          <MapCanvas
            mapRef={z.mapRef}
            cameraRef={z.cameraRef}
            mapType={z.mapType}
            initialRegion={z.initialRegion}
            isDrawingMode={z.isDrawingMode}
            drawType={z.drawType}
            drawCoordinates={z.drawCoordinates}
            zones={z.zones}
            allBuildings={z.allBuildings}
            searchCoords={z.searchCoords}
            searchAddress={z.searchAddress}
            liveLocation={z.liveLocation}
            onMapPress={z.handleMapPress}
            onBuildingPress={z.handleBuildingPress}
            onPolygonPress={z.handlePolygonPress}
            onTouchStart={z.handleTouchStart}
            onTouchMove={z.handleTouchMove}
            onTouchEnd={z.handleTouchEnd}
            onRegionChangeComplete={z.handleMapRegionChange}
            leadPinsEnabled={visible && z.showLeadPins}
            leadPinFilters={pinFilters}
            userLocation={z.userLocation}
          />

          <MapDrawTools
            isDrawingMode={z.isDrawingMode}
            drawType={z.drawType}
            onStartPolygon={() => z.startDrawing('polygon')}
            onStartRectangle={() => z.startDrawing('rectangle')}
          />

          {/* Bottom-left: archived zones + legend (web zone-canvasser-map). The open card
              renders IN FLOW above the buttons, never as a popover off its own button —
              Android would not deliver the Unarchive taps outside that button's bounds. */}
          {!z.isDrawingMode && (
            <View
              className="absolute bottom-6 left-4"
              style={{ zIndex: 25, elevation: 25 }}
              pointerEvents="box-none"
            >
              {z.archivedOpen && (
                <ArchivedZonesCard
                  zones={z.archivedZones}
                  loading={z.archivedLoading}
                  onUnarchive={z.handleZoneUnarchive}
                  processingId={z.unarchivingZoneId}
                />
              )}
              {z.legendOpen && <MapLegendCard />}
              <View className="self-start" style={{ gap: 8 }}>
                <ArchivedZonesToggle open={z.archivedOpen} onPress={z.toggleArchivedOpen} />
                <MapLegendToggle
                  open={z.legendOpen}
                  onPress={() => (z.legendOpen ? z.setLegendOpen(false) : z.openLegend())}
                />
              </View>
            </View>
          )}

          <MapControlsPanel
            mapType={z.mapType}
            onClose={onClose}
            onLocate={z.handleGetCurrentLocation}
            onToggleMapType={() =>
              z.setMapType((t) => (t === 'standard' ? 'satellite' : 'standard'))
            }
            onZoomIn={() => z.handleZoom(true)}
            onZoomOut={() => z.handleZoom(false)}
          />

          {/* Sales Map pins show/hide toggle — the only control for the pins overlay
              (no filter set, just visibility). Hidden while drawing a zone. */}
          {!z.isDrawingMode && (
            <View className="absolute right-4 items-center" style={{ top: '60%', zIndex: 15, width: 44 }}>
              <View className="bg-black/55 rounded-full px-2 py-[3px] mb-1.5">
                <Text className="text-white text-[9px] font-black tracking-wider">PINS</Text>
              </View>
              <MapToggleSwitch
                value={z.showLeadPins}
                onValueChange={z.setShowLeadPins}
                activeLabel="ON"
                inactiveLabel="OFF"
              />
            </View>
          )}

          {z.isDrawingMode && (
            <DrawingToolbar
              drawType={z.drawType}
              pointCount={z.drawCoordinates.length}
              onCancel={z.cancelDrawing}
              onUndo={() => z.setDrawCoordinates((prev) => prev.slice(0, -1))}
              onSave={z.handleSaveZone}
            />
          )}

          <LoadingOverlay visible={z.isProcessing} />
        </View>

        {/* Bottom safe-area spacer: ends the map ABOVE the system navigation bar / home
            indicator, so every bottom control (draw toolbar, zoom stack, legend) clears it. */}
        <View style={{ height: bottomInset, backgroundColor: isDark ? colors.background : '#0E2A1C' }} />

        {/* Rendered inside this modal's own tree (a sibling native Modal at the app root would sit BEHIND it). */}
        <MapFiltersModal
          visible={showFilters}
          onClose={() => setShowFilters(false)}
          filters={pinFilters}
          onApply={(f) => {
            setPinFilters(f);
            // Filtering hidden pins would look like "nothing matched" - show them.
            if (countAppliedMapFilters(f) > 0 && !z.showLeadPins) z.setShowLeadPins(true);
          }}
          onReset={() => setPinFilters(DEFAULT_MAP_FILTERS)}
        />

        <ZoneCanvasserModals
          user={user}
          selectedBuilding={z.selectedBuilding}
          selectedZone={z.selectedZone}
          propertyData={z.propertyData}
          userLocation={z.userLocation}
          isEditingGoBack={z.isEditingGoBack}
          propertyModalOpen={z.propertyModalOpen}
          resultsModalOpen={z.resultsModalOpen}
          actionModalOpen={z.actionModalOpen}
          selectedAction={z.selectedAction}
          leadCreateOpen={z.leadCreateOpen}
          submittedLeadPopupOpen={z.submittedLeadPopupOpen}
          zoneStatsPopupOpen={z.zoneStatsPopupOpen}
          setPropertyModalOpen={z.setPropertyModalOpen}
          setResultsModalOpen={z.setResultsModalOpen}
          setActionModalOpen={z.setActionModalOpen}
          setLeadCreateOpen={z.setLeadCreateOpen}
          setSubmittedLeadPopupOpen={z.setSubmittedLeadPopupOpen}
          setZoneStatsPopupOpen={z.setZoneStatsPopupOpen}
          setSelectedBuilding={z.setSelectedBuilding}
          setSelectedZone={z.setSelectedZone}
          setPropertyData={z.setPropertyData}
          setIsEditingGoBack={z.setIsEditingGoBack}
          onPropertyContinue={z.handlePropertyDetailContinue}
          onSelectResult={handleSelectResult}
          onActionSubmit={z.handleActionSubmit}
          onLeadCreateSuccess={z.handleLeadCreateSuccess}
          onGoBackEdit={z.handleGoBackEdit}
          onStartAppointment={handleStartAppointment}
          onZoneDelete={z.handleZoneDelete}
          onZoneArchive={z.handleZoneArchive}
          isZoneActionProcessing={z.isZoneActionProcessing}
        />
        </View>
    </Modal>
  );
}
