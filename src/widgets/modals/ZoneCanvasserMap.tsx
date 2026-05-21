import React from 'react';
import { Modal, SafeAreaView, View } from 'react-native';
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
import type { ZoneCanvasserMapProps } from '../../types/zone-canvasser';

export default function ZoneCanvasserMap({
  visible,
  onClose,
  user,
  navigation,
}: ZoneCanvasserMapProps) {
  const { colors, isDark } = useTheme();
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
    if (leadId) {
      try {
        await workMutation.mutateAsync({ leadId, userId: user?._id || user?.id });
      } catch (e) {
        console.warn('Work mutation failed', e);
      }
      z.setSubmittedLeadPopupOpen(false);
      onClose();
      navigation.navigate('LeadCenter', { lead });
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        className="flex-1"
        style={{ backgroundColor: isDark ? colors.background : '#F8FAFC' }}
      >
        <Header
          onFilterPress={() => z.setSearchModalVisible(true)}
          onNavigate={(route: string) => {
            if (route === 'Leads') {
              onClose();
            } else {
              navigation.navigate(route);
            }
          }}
        />

        {z.isDrawingMode && <DrawingInfoBanner drawType={z.drawType} />}

        <View className="flex-1 relative">
          <MapCanvas
            mapRef={z.mapRef}
            mapType={z.mapType}
            initialRegion={z.initialRegion}
            isDrawingMode={z.isDrawingMode}
            drawType={z.drawType}
            drawCoordinates={z.drawCoordinates}
            zones={z.zones}
            allBuildings={z.allBuildings}
            searchCoords={z.searchCoords}
            onMapPress={z.handleMapPress}
            onBuildingPress={z.handleBuildingPress}
            onPolygonPress={z.handlePolygonPress}
            onTouchStart={z.handleTouchStart}
            onTouchMove={z.handleTouchMove}
            onTouchEnd={z.handleTouchEnd}
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
          searchModalVisible={z.searchModalVisible}
          searchText={z.searchText}
          setPropertyModalOpen={z.setPropertyModalOpen}
          setResultsModalOpen={z.setResultsModalOpen}
          setActionModalOpen={z.setActionModalOpen}
          setLeadCreateOpen={z.setLeadCreateOpen}
          setSubmittedLeadPopupOpen={z.setSubmittedLeadPopupOpen}
          setZoneStatsPopupOpen={z.setZoneStatsPopupOpen}
          setSearchModalVisible={z.setSearchModalVisible}
          setSearchText={z.setSearchText}
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
          onLocationSearch={z.handleLocationSearch}
        />
      </SafeAreaView>
    </Modal>
  );
}
