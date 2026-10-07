export const BUILDING_MARKER_COLORS: Record<string, string> = {
  go_back: '#fd7e14',
  not_interested: '#4B0082',
  not_qualified: '#6c757d',
  not_home: '#0d6efd',
  interested_no_time: '#ffc107',
  create_lead: '#198754',
  selfGenerated: '#198754',
  no_soliciting: '#000000',
};

export const DEFAULT_MARKER_COLOR = '#dc3545';

export const LEGEND_ITEMS = [
  { status: null, color: DEFAULT_MARKER_COLOR, label: 'Not Visited' },
  { status: 'create_lead', color: BUILDING_MARKER_COLORS.create_lead, label: 'Lead Created' },
  { status: 'go_back', color: BUILDING_MARKER_COLORS.go_back, label: 'Go Back' },
  { status: 'interested_no_time', color: BUILDING_MARKER_COLORS.interested_no_time, label: 'Interested – No Time' },
  { status: 'not_home', color: BUILDING_MARKER_COLORS.not_home, label: 'Not Home' },
  { status: 'not_interested', color: BUILDING_MARKER_COLORS.not_interested, label: 'Not Interested' },
  { status: 'no_soliciting', color: BUILDING_MARKER_COLORS.no_soliciting, label: 'No Soliciting' },
  { status: 'not_qualified', color: BUILDING_MARKER_COLORS.not_qualified, label: 'Not Qualified' },
];

export const RESULT_OPTIONS = [
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'not_qualified', label: 'Not Qualified' },
  { value: 'no_soliciting', label: 'No Soliciting' },
  { value: 'not_home', label: 'Not Home/No Answer' },
  { value: 'go_back', label: 'Go Back' },
  { value: 'interested_no_time', label: 'Interested - No Time' },
  { value: 'create_lead', label: 'Create Lead' },
] as const;

export const ACTION_TITLES: Record<string, string> = {
  not_interested: 'Not Interested',
  not_qualified: 'Not Qualified',
  no_soliciting: 'No Soliciting',
  not_home: 'Not Home/No Answer',
  no_answer: 'No Answer',
  interested_no_time: 'Interested - No Time',
  go_back: 'Go Back',
};

export const PREFERRED_TIMES = ['09:00 AM', '11:00 AM', '01:00 PM', '03:00 PM', '05:00 PM', '07:00 PM'];
export const SELECT_ITEMS = ['Fascia Rot', 'Fascia Wrap', 'Soffit', 'Gutter', 'Leaf Filter'];

export const APPOINTMENT_COLORS = {
  ACTIVE: '#ff6b35',
  PROGRESS: '#6fcf97',
  OFFSITE: '#9e9e9e',
  UPCOMING: '#2196f3',
};

export const STATUS_CHIP_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: string }
> = {
  not_interested: { label: 'Not Interested', color: '#ef4444', bg: '#fef2f2', icon: 'thumb-down' },
  no_answer: { label: 'No Answer', color: '#f59e0b', bg: '#fffbeb', icon: 'phone-missed' },
  not_home: { label: 'Not Home', color: '#6366f1', bg: '#eef2ff', icon: 'home-off-outline' },
  no_soliciting: { label: 'No Soliciting', color: '#ec4899', bg: '#fdf2f8', icon: 'cancel' },
  create_lead: { label: 'Lead Created', color: '#10b981', bg: '#ecfdf5', icon: 'check-circle' },
  selfGenerated: { label: 'Lead Created', color: '#10b981', bg: '#ecfdf5', icon: 'check-circle' },
  go_back: { label: 'Go Back', color: '#8b5cf6', bg: '#f5f3ff', icon: 'arrow-left-circle' },
  interested_no_time: { label: 'Interested – No Time', color: '#0ea5e9', bg: '#f0f9ff', icon: 'clock-outline' },
  not_qualified: { label: 'Not Qualified', color: '#64748b', bg: '#f8fafc', icon: 'close-circle' },
};

export function normalizeLeadStatus(rawStatus: string | null | undefined): string | null {
  if (!rawStatus) return null;
  return rawStatus === 'selfGenerated' ? 'create_lead' : rawStatus;
}

export function getMarkerColor(status: string | null | undefined): string {
  if (!status) return DEFAULT_MARKER_COLOR;
  return BUILDING_MARKER_COLORS[status] || DEFAULT_MARKER_COLOR;
}

export function getStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'go_back':
      return 'Go Back';
    case 'not_interested':
      return 'Not Interested';
    case 'not_qualified':
      return 'Not Qualified';
    case 'not_home':
      return 'Not Home';
    case 'interested_no_time':
      return 'Interested - No Time';
    case 'create_lead':
    case 'selfGenerated':
      return 'Lead Created';
    case 'no_soliciting':
      return 'No Soliciting';
    default:
      return 'Not Visited';
  }
}

export function getStatusChipConfig(status: string | null | undefined) {
  if (!status) {
    return {
      label: 'Unknown',
      color: '#64748b',
      bg: '#f8fafc',
      icon: 'information-outline',
    };
  }
  return (
    STATUS_CHIP_CONFIG[status] || {
      label: getStatusLabel(status),
      color: '#64748b',
      bg: '#f8fafc',
      icon: 'information-outline',
    }
  );
}
