import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

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

const DEAL_CENTER_SCHEMAS_URL = '/calculator-form-schemas/deal-center';
const PRICING_CONFIG_URL = '/company/v1/pricing-config/sales';

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
  schema: CalculatorSchema | null;
  schemas: CalculatorSchema[];
  configuredSchemas: CalculatorSchema[];
  isRemote: boolean;
  isConfigured: boolean;
  pricingConfig: PricingConfig | null;
  isLoading: boolean;
}

export function useCalculatorSchema(
  options: UseCalculatorSchemaOptions = {}
): UseCalculatorSchemaResult {
  const { enabled = true } = options;
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data: pricingConfig, isLoading: pricingLoading } = useQuery<PricingConfig | null>({
    queryKey: ['dealCenterPricingConfig'],
    queryFn: () =>
      cachedFetch(
        OFFLINE_CACHE.DEAL_CENTER_PRICING,
        async () => {
          const res = await api.get<any>(PRICING_CONFIG_URL);
          return normalizeSalesPricingConfig(res.data?.data?.config ?? res.data?.config);
        },
        { online: isOnline(), userId }
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: rawEntities, isLoading } = useQuery<any[]>({
    queryKey: ['dealCenterCalculatorSchemas'],
    queryFn: () =>
      cachedFetch(
        OFFLINE_CACHE.DEAL_CENTER_SCHEMA,
        async () => {
          const res = await api.get<any>(DEAL_CENTER_SCHEMAS_URL);
          const raw = (res.data as any)?.data || [];
          return Array.isArray(raw) ? raw : [];
        },
        { online: isOnline(), userId }
      ),
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
