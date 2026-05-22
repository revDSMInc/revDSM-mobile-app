export type MapCoordinate = { latitude: number; longitude: number };

export type BuildingStatusOverride = {
  leadStatus: string | null;
  leads?: any[];
};

export type ZoneCanvasserBuilding = {
  id: string | number;
  position: [number, number];
  label: string;
  type: string;
  zoneId: string;
  zoneName?: string;
  leads: any[];
  leadStatus: string | null;
  leadId: string | null;
  address: string;
  isCrmLead: boolean;
};

export type ZoneCanvasserMapProps = {
  visible: boolean;
  onClose: () => void;
  user: any;
  navigation: any;
};

export type ActionSubmitData = {
  note: string;
  name?: string;
  followupDate?: string;
  prefferedTime?: string;
  selectedItems?: string[];
};
