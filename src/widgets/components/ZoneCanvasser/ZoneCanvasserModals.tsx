import React from 'react';
import LeadCreateModal from '../../modals/LeadCreate';
import { PropertyDetailModal } from './PropertyDetailModal';
import { ResultsModal } from './ResultsModal';
import { ActionModal } from './ActionModal';
import { SubmittedLeadPopup } from './SubmittedLeadPopup';
import { ZoneStatsPopup } from './ZoneStatsPopup';
import type { ZoneCanvasserBuilding, MapCoordinate } from '../../../types/zone-canvasser';

type Props = {
  user: any;
  selectedBuilding: ZoneCanvasserBuilding | null;
  selectedZone: any;
  propertyData: any;
  userLocation: MapCoordinate | null;
  isEditingGoBack: boolean;
  propertyModalOpen: boolean;
  resultsModalOpen: boolean;
  actionModalOpen: boolean;
  selectedAction: string;
  leadCreateOpen: boolean;
  submittedLeadPopupOpen: boolean;
  zoneStatsPopupOpen: boolean;
  setPropertyModalOpen: (v: boolean) => void;
  setResultsModalOpen: (v: boolean) => void;
  setActionModalOpen: (v: boolean) => void;
  setLeadCreateOpen: (v: boolean) => void;
  setSubmittedLeadPopupOpen: (v: boolean) => void;
  setZoneStatsPopupOpen: (v: boolean) => void;
  setSelectedBuilding: (b: ZoneCanvasserBuilding | null) => void;
  setSelectedZone: (z: any) => void;
  setPropertyData: (d: any) => void;
  setIsEditingGoBack: (v: boolean) => void;
  onPropertyContinue: (data: any) => void;
  onSelectResult: (value: string) => void;
  onActionSubmit: (data: any) => void | Promise<void>;
  onLeadCreateSuccess: (lead: any) => void;
  onGoBackEdit: () => void;
  onStartAppointment: () => void | Promise<void>;
};

export function ZoneCanvasserModals({
  user,
  selectedBuilding,
  selectedZone,
  propertyData,
  userLocation,
  isEditingGoBack,
  propertyModalOpen,
  resultsModalOpen,
  actionModalOpen,
  selectedAction,
  leadCreateOpen,
  submittedLeadPopupOpen,
  zoneStatsPopupOpen,
  setPropertyModalOpen,
  setResultsModalOpen,
  setActionModalOpen,
  setLeadCreateOpen,
  setSubmittedLeadPopupOpen,
  setZoneStatsPopupOpen,
  setSelectedBuilding,
  setSelectedZone,
  setPropertyData,
  setIsEditingGoBack,
  onPropertyContinue,
  onSelectResult,
  onActionSubmit,
  onLeadCreateSuccess,
  onGoBackEdit,
  onStartAppointment,
}: Props) {
  const address =
    propertyData?.formattedAddress ||
    selectedBuilding?.label ||
    selectedBuilding?.address ||
    '';

  return (
    <>
      {selectedBuilding && (
        <PropertyDetailModal
          visible={propertyModalOpen}
          building={selectedBuilding}
          onContinue={onPropertyContinue}
          onCancel={() => {
            setPropertyModalOpen(false);
            setSelectedBuilding(null);
            setPropertyData(null);
          }}
        />
      )}

      {selectedBuilding && (
        <ResultsModal
          visible={resultsModalOpen}
          address={address}
          onCancel={() => {
            setResultsModalOpen(false);
            setIsEditingGoBack(false);
            if (!isEditingGoBack) setSelectedBuilding(null);
          }}
          onSelectOption={onSelectResult}
        />
      )}

      {selectedBuilding && (
        <ActionModal
          visible={actionModalOpen}
          actionType={selectedAction}
          address={address}
          onSubmit={onActionSubmit}
          onCancel={() => setActionModalOpen(false)}
        />
      )}

      {selectedBuilding && (
        <LeadCreateModal
          visible={leadCreateOpen}
          onClose={() => setLeadCreateOpen(false)}
          onSuccess={onLeadCreateSuccess}
          user={user}
          fromZone
          zoneId={selectedBuilding.zoneId}
          buildingId={selectedBuilding.id ? String(selectedBuilding.id) : undefined}
          prefilledAddress={
            propertyData?.formattedAddress ||
            selectedBuilding?.leads?.[0]?.address ||
            selectedBuilding.address ||
            selectedBuilding.label ||
            ''
          }
          prefilledCoords={{
            latitude: selectedBuilding.position[0],
            longitude: selectedBuilding.position[1],
          }}
          prefilledOwnerName={propertyData?.owner?.names?.[0] || ''}
        />
      )}

      {selectedBuilding && selectedBuilding.leads?.length > 0 && (
        <SubmittedLeadPopup
          visible={submittedLeadPopupOpen}
          leadData={{
            ...selectedBuilding.leads[0],
            status:
              selectedBuilding.leads[0]?.status ||
              selectedBuilding.leadStatus ||
              undefined,
            address:
              selectedBuilding.leads[0]?.address ||
              selectedBuilding.leads[0]?.fullAddress ||
              selectedBuilding.address,
          }}
          userPosition={userLocation}
          onClose={() => {
            setSubmittedLeadPopupOpen(false);
            setSelectedBuilding(null);
          }}
          onEdit={onGoBackEdit}
          onStartAppointment={onStartAppointment}
        />
      )}

      {selectedZone && (
        <ZoneStatsPopup
          visible={zoneStatsPopupOpen}
          zone={selectedZone}
          onClose={() => {
            setZoneStatsPopupOpen(false);
            setSelectedZone(null);
          }}
        />
      )}

    </>
  );
}
