import React from 'react';
import { Modal, View, TouchableOpacity, StatusBar, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../common/MainHeader';
import { useWorkLeadMutation } from '../../hooks/useLeadMutation';
import { useZoneCanvasser } from '../../hooks/useZoneCanvasser';
import { MapCanvas } from '../components/ZoneCanvasser/MapCanvas';
import { MapDrawTools } from '../components/ZoneCanvasser/MapDrawTools';
import { MapLegend } from '../components/ZoneCanvasser/MapLegend';
import { MapControlsPanel } from '../components/ZoneCanvasser/MapControlsPanel';
import { DrawingToolbar } from '../components/ZoneCanvasser/DrawingToolbar';
import { DrawingInfoBanner } from '../components/ZoneCanvasser/DrawingInfoBanner';
import { LoadingOverlay } from '../components/ZoneCanvasser/LoadingOverlay';
import { ZoneCanvasserModals } from '../components/ZoneCanvasser/ZoneCanvasserModals';
import { SearchLocationModal } from '../components/ZoneCanvasser/SearchLocationModal';
import { executeStartAppointmentFlow } from '../../utils/lead-activity-log';
import type { ZoneCanvasserMapProps } from '../../types/zone-canvasser';

export default function ZoneCanvasserMap({
  visible,
  onClose,
  user,
  navigation,
}: ZoneCanvasserMapProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const workMutation = useWorkLeadMutation();
  const z = useZoneCanvasser({ visible, user });

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
        <StatusBar barStyle="light-content" backgroundColor={isDark ? colors.background : '#101828'} translucent />
        {(Platform.OS === 'ios' || Platform.OS === 'android') && (
          <View style={{ height: insets.top, backgroundColor: isDark ? colors.background : '#101828' }} />
        )}
        <Header
          onFilterPress={() => z.setSearchModalVisible(true)}
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
          <SearchLocationModal
            visible={z.searchModalVisible}
            searchText={z.searchText}
            onChangeText={z.setSearchText}
            onClose={() => z.setSearchModalVisible(false)}
            onLocationSelected={z.navigateToSearchLocation}
            isProcessing={z.isProcessing}
          />
          {/* Back Button on Top Left Corner of Map */}
          <TouchableOpacity
            onPress={onClose}
            className="absolute top-5 left-5 w-11 h-11 rounded-full bg-[#4CBB17] items-center justify-center shadow-md"
            style={{ zIndex: 20 }}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>

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
            liveLocation={z.liveLocation}
            onMapPress={z.handleMapPress}
            onBuildingPress={z.handleBuildingPress}
            onPolygonPress={z.handlePolygonPress}
            onTouchStart={z.handleTouchStart}
            onTouchMove={z.handleTouchMove}
            onTouchEnd={z.handleTouchEnd}
            onRegionChangeComplete={z.handleMapRegionChange}
          />

          <MapDrawTools
            isDrawingMode={z.isDrawingMode}
            drawType={z.drawType}
            onStartPolygon={() => z.startDrawing('polygon')}
            onStartRectangle={() => z.startDrawing('rectangle')}
          />

          {!z.isDrawingMode && (
            <MapLegend
              open={z.legendOpen}
              onOpen={() => z.setLegendOpen(true)}
              onClose={() => z.setLegendOpen(false)}
            />
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
        />
        </View>
    </Modal>
  );
}
