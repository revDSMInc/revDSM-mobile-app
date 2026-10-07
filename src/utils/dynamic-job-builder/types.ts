export interface Field {
  id: string;
  type: string;
  key: string;
  label?: string;
  title?: string;
  options?: string[];
  placeholder?: string;
  unit?: string;
  rows?: number;
  required?: boolean;
  locked?: boolean;
  dcField?: string;
  dcFields?: string[];
  dcAggregate?: string;
  defaultValue?: any;
  lockedByDefault?: boolean;
  singleStory?: boolean;
  gridConfig?: any;
  roomSet?: string;
  roomOptions?: string[];
  palette?: string;
  colorKey?: string;
  productId?: string;
  icon?: string;
  defaultExpanded?: boolean;
  columns?: number;
  bordered?: boolean;
  borderColor?: string;
  fields?: Field[];
  stickyPosition?: 'none' | 'top' | 'bottom';
  multiSelect?: boolean;
  optionShowFields?: Record<string, string[]>;
  optionVisibility?: any;
  dependencies?: FieldDependencies;
  visibleWhen?: any;
  requiredWhen?: any;
  allocAvail?: number | string;
  allocUnit?: string;
  allocationLayout?: { columns?: number };
  allocationGridColumns?: number;
  fieldGridColumns?: number;
  warningConfig?: { enabled?: boolean; message?: string; color?: string; visibleWhen?: any };
  summaryColumns?: any[];
  columnCount?: number;
  defaultEmptyMessage?: string;
  showFooterTotal?: boolean;
  footerLabel?: string;
  minCombinations?: number;
  comboHeaderFields?: string[];
  scopedToggleFields?: string[];
  colorImageMap?: any;
  colors?: any[];
}

export interface FieldDependencies {
  visibleWhen?: any;
  requiredWhen?: any;
  optionVisibility?: any;
}

export interface CombinationGroup {
  id: string;
  label?: string;
  sectionType?: string;
  fields: Field[];
  headerFields?: Field[];
  showGrandTotalSummary?: boolean;
  bordered?: boolean;
  borderColor?: string;
  stickyPosition?: string;
  allocationLayout?: any;
  allocationGridColumns?: number;
  warningConfig?: any;
}

export interface TabSection {
  id: string;
  label?: string;
  sectionType: 'simple' | 'combination';
  fields: Field[];
  combinationGroups?: CombinationGroup[];
  showGrandTotalSummary?: boolean;
  bordered?: boolean;
  borderColor?: string;
  stickyPosition?: string;
  allocationLayout?: any;
  allocationGridColumns?: number;
  warningConfig?: any;
}

export interface CombinationConfig {
  enabled: boolean;
  defaultItem?: any;
  fields: Field[];
}

export interface Tab {
  id: string;
  label: string;
  lockedByDefault?: boolean;
  dcField?: string;
  dependencies?: any;
  sections?: TabSection[];
  combinationGroups?: CombinationGroup[];
  combinations?: CombinationConfig;
  fields?: Field[];
  isSummary?: boolean;
  showGrandTotalSummary?: boolean;
}

export interface Vertical {
  id: string;
  label: string;
  icon?: string;
  color?: string;
  productId?: string;
  tabs: Tab[];
}

export interface JobBuilderConfig {
  name?: string;
  description?: string;
  status?: string;
  verticals: Vertical[];
}

export interface TabState {
  colorValues?: Record<string, any>;
  sectionFields?: Record<string, any>;
  comboGroups?: Record<string, {
    combinations: any[];
    sectionState: any;
  }>;
  combinations?: any[];
  [key: string]: any;
}

export interface VerticalState {
  [tabId: string]: TabState;
}

export interface ScheduleTime {
  customerName?: string;
  date: string;
  timeWindow?: string;
  reason?: string;
}

export interface JobBuilderFile {
  id?: string;
  serverId?: string;
  name?: string;
  uri?: string;
  url?: string;
  displayUrl?: string;
  secureUrl?: string;
  thumbnailUrl?: string;
  blob?: any;
  file?: string; // 'data:...;base64,...' for upload
  contentType?: string;
  mimeType?: string;
  bucketName?: string;
  filePath?: string;
  documentType?: 'agreement' | 'orderSheet';
  type?: 'agreement' | 'orderSheet' | string;
  isSystemGenerated?: boolean;
  isNew?: boolean;
}

export interface DocumentGroup {
  name?: string;
  files: JobBuilderFile[];
}

export interface JobState {
  [verticalId: string]: VerticalState;
  scheduleTime?: any;
  agreements?: any[];
  orderSheets?: any[];
}

export interface DealCenterData {
  [key: string]: any;
}

export interface LockedTabIdsByVertical {
  [verticalId: string]: string[];
}

export interface PreviewSnapshot {
  previewConfig: JobBuilderConfig;
  configKey: string;
  initialState: JobState;
  lockedTabIdsByVertical: LockedTabIdsByVertical;
}

export interface FieldLogContext {
  skip: boolean;
  tab?: Tab;
  section?: TabSection;
  field?: Field;
  combo?: any;
  comboIndex?: number;
  isColor?: boolean;
  isMeasurement?: boolean;
  rowLabel?: string;
  colLabel?: string;
  fieldId?: string;
  comboNumber?: number;
  location?: string;
  story?: string;
}
