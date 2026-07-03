import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  CalculatorSchema,
  CalculatorCategory,
  CalculatorSection,
  CalculatorField,
} from '../types/calculator';
import { DEMO_CALCULATOR_SCHEMA } from '../constants/mock-calculator-schema';

/**
 * Loads the category-shaped calculator schema that drives the Dynamic Deal
 * Center calculator + rollout forms.
 *
 * Mirrors the web implementation (`src/api/calculator-form-schemas.js`):
 *   GET /calculator-form-schemas/deal-center  ->  { data: [entity, ...] }
 * Each entity carries `calculatorFormSchema.categories[]`, and every field has a
 * `price: { retail, cost, par }`. We normalize the payload exactly like the web
 * does and keep only "configured" schemas (those that actually contain fields).
 *
 * If the backend returns nothing configured (or the request fails) we fall back
 * to the bundled template schema so the flow keeps working offline / pre-config.
 */

const DEAL_CENTER_SCHEMAS_URL = '/calculator-form-schemas/deal-center';

function normalizePrice(price: any): { retail: number; cost: number; par: number } {
  if (!price) return { retail: 0, cost: 0, par: 0 };
  return {
    retail: Number(price.retail) || 0,
    cost: Number(price.cost) || 0,
    par: Number(price.par) || 0,
  };
}

function normalizeField(field: any): CalculatorField {
  return { ...field, price: normalizePrice(field?.price) };
}

function normalizeSection(section: any): CalculatorSection {
  return { ...section, fields: (section?.fields || []).map(normalizeField) };
}

function normalizeCategory(category: any): CalculatorCategory {
  const directFields = (category?.directFields || category?.fields || []).map(normalizeField);
  return {
    ...category,
    directFields,
    sections: (category?.sections || []).map(normalizeSection),
  };
}

function normalizeSchema(entity: any): CalculatorSchema {
  const formSchema = entity?.calculatorFormSchema || {};
  return {
    id: entity?._id,
    product: { name: entity?.name, icon: entity?.icon, color: entity?.color },
    icon: entity?.icon,
    color: entity?.color,
    categories: (formSchema.categories || []).map(normalizeCategory),
  };
}

/** A schema is "configured" only if some category actually has fields. */
export function isConfiguredDealCenterSchema(schema: CalculatorSchema): boolean {
  return (schema.categories || []).some((category) => {
    const directFields = category.directFields || category.fields || [];
    if (directFields.length > 0) return true;
    return (category.sections || []).some((s) => (s.fields || []).length > 0);
  });
}

interface UseCalculatorSchemaOptions {
  enabled?: boolean;
}

interface UseCalculatorSchemaResult {
  /** primary schema for the single-schema screen (first configured, else template) */
  schema: CalculatorSchema;
  /** all normalized schemas returned by the backend */
  schemas: CalculatorSchema[];
  /** normalized schemas that actually have fields configured */
  configuredSchemas: CalculatorSchema[];
  /** true when the schema came from the backend rather than the bundled template */
  isRemote: boolean;
  /** true when the backend has at least one configured deal-center schema */
  isConfigured: boolean;
  isLoading: boolean;
}

export function useCalculatorSchema(
  options: UseCalculatorSchemaOptions = {}
): UseCalculatorSchemaResult {
  const { enabled = true } = options;

  const { data, isLoading } = useQuery<CalculatorSchema[]>({
    queryKey: ['dealCenterCalculatorSchemas'],
    queryFn: async () => {
      const res = await api.get<any>(DEAL_CENTER_SCHEMAS_URL);
      const raw = (res.data as any)?.data || [];
      return (Array.isArray(raw) ? raw : []).map(normalizeSchema);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return useMemo(() => {
    const schemas = data || [];
    const configuredSchemas = schemas.filter(isConfiguredDealCenterSchema);
    const isConfigured = configuredSchemas.length > 0;
    return {
      schema: configuredSchemas[0] ?? DEMO_CALCULATOR_SCHEMA,
      schemas,
      configuredSchemas,
      isRemote: isConfigured,
      isConfigured,
      isLoading,
    };
  }, [data, isLoading]);
}
