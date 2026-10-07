export interface CalculatorField {
  id: string;
  name: string;
  label: string;
  unit?: string;
  disabled?: boolean;
  price?: {
    cost: number;
    par: number;
    retail: number;
  };
  conditional?: {
    dependsOn?: string | string[];
    matchMode?: 'any' | 'all';
    valueMode?: string;
    fixedValue?: string | number;
    aggregate?: string;
    ranges?: { min: number; max?: number | null; value: string | number }[];
    notifyRep?: boolean;
    addedMessage?: string;
    removedMessage?: string;
    updatedMessage?: string;
    highlightColor?: string;
    behavior?: {
      mode?: string;
      value?: string | number;
      fixedValue?: string | number;
      highlightColor?: string;
    };
  };
}

export interface CalculatorSection {
  id: string;
  label: string;
  fields: CalculatorField[];
}

export interface CalculatorCategory {
  id: string;
  name: string;
  label: string;
  description?: string;
  icon?: string;
  color?: string;
  defaultExpanded?: boolean;
  directFields?: CalculatorField[];
  fields?: CalculatorField[];
  sections?: CalculatorSection[];
}

export interface CalculatorSchema {
  id: string;
  product?: { name: string; icon?: string; color?: string };
  icon?: string;
  color?: string;
  categories: CalculatorCategory[];
}

export interface CalculatorEntry {
  fieldId: string;
  categoryId: string;
  sectionId: string;
  productName?: string;
  name: string;
  label: string;
  unit: string;
  inputValue: number;
  computed: {
    cost: number;
    par: number;
    retail: number;
  };
  pricingAtTimeOfEntry: {
    cost: string;
    par: string;
    retail: string;
  };
}

export interface CalculatorTotals {
  cost: number;
  par: number;
  retail: number;
}

export interface CalculatorDetails {
  _id: string;
  appointmentId: string;
  title: string;
  position: number;
  entries: CalculatorEntry[];
  totals: CalculatorTotals;
  isRolloutConfirmed?: boolean;
  price?: number;
  dropPrice?: any[];
  paymentMethod?: string;
  schemaSnapshotId?: string;
}

export function getCategoryDirectFields(cat: CalculatorCategory): CalculatorField[] {
  return cat.directFields || cat.fields || [];
}

export function getCategorySectionFields(cat: CalculatorCategory): CalculatorField[] {
  return (cat.sections || []).flatMap((s) => s.fields);
}

export function getCategoryAllFields(cat: CalculatorCategory): CalculatorField[] {
  return [...getCategoryDirectFields(cat), ...getCategorySectionFields(cat)];
}
