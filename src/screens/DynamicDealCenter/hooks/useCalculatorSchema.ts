import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  CalculatorSchema,
  CalculatorCategory,
  CalculatorSection,
  CalculatorField,
} from '../types/calculator';
import {
  bakeFieldPrice,
  normalizeSalesPricingConfig,
  type PricingConfig,
} from '../utils/pricing-config-util';

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
 * There is NO mock fallback: when the backend returns nothing configured, `schema`
 * is null and `isConfigured` is false — callers must surface a not-configured
 * state (or fall back to the normal builder) rather than render demo data.
 */

const DEAL_CENTER_SCHEMAS_URL = '/calculator-form-schemas/deal-center';
const PRICING_CONFIG_URL = '/company/v1/pricing-config/sales';

// Web parity (`calculator-form-schemas.js` normalizePrice): resolve every tier to a
// concrete number ONCE, at load — an explicit per-field value wins, otherwise it's
// derived as `percentOf% of` another tier via the company pricing config. Without
// this, a field priced only at retail returns cost/par = 0 and the rollout PAR/COST
// tiles floor to $200.
function normalizeField(field: any, pricingConfig: PricingConfig | null): CalculatorField {
  return { ...field, price: bakeFieldPrice(field?.price, pricingConfig) };
}

function normalizeSection(section: any, pricingConfig: PricingConfig | null): CalculatorSection {
  return { ...section, fields: (section?.fields || []).map((f: any) => normalizeField(f, pricingConfig)) };
}

function normalizeCategory(category: any, pricingConfig: PricingConfig | null): CalculatorCategory {
  const directFields = (category?.directFields || category?.fields || []).map((f: any) =>
    normalizeField(f, pricingConfig),
  );
  return {
    ...category,
    directFields,
    sections: (category?.sections || []).map((s: any) => normalizeSection(s, pricingConfig)),
  };
}

function normalizeSchema(entity: any, pricingConfig: PricingConfig | null): CalculatorSchema {
  const formSchema = entity?.calculatorFormSchema || {};
  return {
    id: entity?._id,
    product: { name: entity?.name, icon: entity?.icon, color: entity?.color },
    icon: entity?.icon,
    color: entity?.color,
    categories: (formSchema.categories || []).map((c: any) => normalizeCategory(c, pricingConfig)),
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
  /** primary schema (first configured); null when nothing is configured */
  schema: CalculatorSchema | null;
  /** all normalized schemas returned by the backend */
  schemas: CalculatorSchema[];
  /** normalized schemas that actually have fields configured */
  configuredSchemas: CalculatorSchema[];
  /** true when the schema came from the backend rather than the bundled template */
  isRemote: boolean;
  /** true when the backend has at least one configured deal-center schema */
  isConfigured: boolean;
  /** company pricing config (dynamic tiers / fees / derivation); null pre-config */
  pricingConfig: PricingConfig | null;
  isLoading: boolean;
}

export function useCalculatorSchema(
  options: UseCalculatorSchemaOptions = {}
): UseCalculatorSchemaResult {
  const { enabled = true } = options;

  // Company pricing config drives per-field tier derivation (par/cost from retail)
  // and static fees. Fetched alongside the schemas and baked into the field prices.
  const { data: pricingConfig, isLoading: pricingLoading } = useQuery<PricingConfig | null>({
    queryKey: ['dealCenterPricingConfig'],
    queryFn: async () => {
      const res = await api.get<any>(PRICING_CONFIG_URL);
      return normalizeSalesPricingConfig(res.data?.data?.config ?? res.data?.config);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Fetch the RAW schema entities; normalization (with derivation) happens in the
  // memo below once the pricing config resolves, so blank tiers derive correctly.
  const { data: rawEntities, isLoading } = useQuery<any[]>({
    queryKey: ['dealCenterCalculatorSchemas'],
    queryFn: async () => {
      const res = await api.get<any>(DEAL_CENTER_SCHEMAS_URL);
      const raw = (res.data as any)?.data || [];
      return Array.isArray(raw) ? raw : [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return useMemo(() => {
    const cfg = pricingConfig ?? null;
    const schemas = (rawEntities || []).map((e) => normalizeSchema(e, cfg));
    const configuredSchemas = schemas.filter(isConfiguredDealCenterSchema);
    const isConfigured = configuredSchemas.length > 0;
    return {
      schema: configuredSchemas[0] ?? null,
      schemas,
      configuredSchemas,
      isRemote: isConfigured,
      isConfigured,
      pricingConfig: cfg,
      isLoading: isLoading || pricingLoading,
    };
  }, [rawEntities, pricingConfig, isLoading, pricingLoading]);
}
