import { LeadService } from '../../../services/api/leads';

/**
 * Dynamic Job Builder product-data enrichment/extraction.
 *
 * Faithful port of the web portal's
 * `src/sections/lead-map/components/lead-details-modal/enrich-job-builder-product-data.js`.
 * Used by the mobile deal-edit flow to load a lead's saved job-builder state
 * from the PortalJobBuilder (with a calculator-outcome fallback), decide whether
 * it is dynamic, and hand a clean `dynamicJobState` to the deserializer.
 */

/** System / document fields — never treated as product payload when merging portal data. */
export const PORTAL_MERGE_METADATA_KEYS = new Set([
  '_id',
  '__v',
  'leadId',
  'jobBuilderId',
  'calculatorId',
  'appointmentId',
  'status',
  'scheduleTime',
  'createdAt',
  'updatedAt',
  'agreements',
  'orderSheets',
  'paperWork',
  'amendments',
  'jobBuilderDocuments',
  'documents',
  'leadData',
  'autoFieldsLogged',
  'leadStatus',
  '_productSource',
]);

/** Legacy static sections at document root — not config-driven vertical keys. */
const LEGACY_STATIC_PRODUCT_ROOT_KEYS = new Set([
  'gutter',
  'leaffilter',
  'soffit',
  'fascia',
  'lighting',
  'additional',
  'gutter_extras',
  'Leaffilter_extras',
  'Soffit',
  'Fasica',
  'misc',
  'wedges',
  'straps',
  'modifyHeight',
  'groundSpout',
  'replaceCorner',
  'extendedSplashGuard',
  'extendedSplashGuard032',
  'aluminumFasciaBoard',
]);

/** Keys excluded when extracting root-serialized dynamic vertical state. */
const DYNAMIC_STATE_EXCLUDED_KEYS = new Set([
  ...PORTAL_MERGE_METADATA_KEYS,
  ...LEGACY_STATIC_PRODUCT_ROOT_KEYS,
  'isDynamic',
  'dynamicJobState',
  'configId',
  'configSnapshotId',
  'calculatorType',
  '_storageVersion',
]);

function pickContextFromInput(input: any = {}) {
  const context: any = {};
  if (input.jobBuilderDocuments) context.jobBuilderDocuments = input.jobBuilderDocuments;
  if (input.leadStatus !== undefined) context.leadStatus = input.leadStatus;
  if (input.leadData !== undefined) context.leadData = input.leadData;
  return context;
}

function extractProductFieldsFromRecord(record: any = {}) {
  const product: any = {};
  Object.entries(record).forEach(([key, value]) => {
    if (PORTAL_MERGE_METADATA_KEYS.has(key)) return;
    if (key === 'documents') return;
    if (value !== undefined) product[key] = value;
  });
  return product;
}

function isEmptySummaryFieldValue(val: any) {
  if (val === '' || val === null || val === undefined) return true;
  if (val === 0 || val === '0') return true;
  if (Array.isArray(val) && val.length === 0) return true;
  if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return true;
  return false;
}

/**
 * Remove stale colorValues entries when authoritative top-level field values exist.
 * Portal/socket payloads often store both; preview must not read outdated colorValues.
 */
export function reconcileDynamicJobStateColorValues(state: any): any {
  if (!state || typeof state !== 'object') return state;
  if (Array.isArray(state)) {
    return state.map((item) => reconcileDynamicJobStateColorValues(item));
  }

  const next: any = { ...state };

  if (next.colorValues && typeof next.colorValues === 'object') {
    const cleanedColorValues: any = { ...next.colorValues };
    Object.keys(cleanedColorValues).forEach((key) => {
      const topLevel = next[key];
      if (!isEmptySummaryFieldValue(topLevel)) {
        delete cleanedColorValues[key];
      }
    });
    next.colorValues = cleanedColorValues;
  }

  Object.keys(next).forEach((key) => {
    if (key === 'colorValues') return;
    const val = next[key];
    if (val && typeof val === 'object') {
      next[key] = reconcileDynamicJobStateColorValues(val);
    }
  });

  return next;
}

/**
 * Extract dynamic job state from job builder payloads (nested or root-serialized).
 */
export function extractDynamicJobState(data: any): any | null {
  if (!data || typeof data !== 'object') return null;

  if (data.dynamicJobState && typeof data.dynamicJobState === 'object') {
    return data.dynamicJobState;
  }

  if (data.jobBuilder?.dynamicJobState) {
    return data.jobBuilder.dynamicJobState;
  }

  if (data._storageVersion >= 1) {
    const verticalEntries = Object.entries(data).filter(
      ([key]) => !DYNAMIC_STATE_EXCLUDED_KEYS.has(key)
    );
    if (verticalEntries.length > 0) {
      return Object.fromEntries(verticalEntries);
    }
  }

  return null;
}

export function isDynamicJobBuilderData(data: any): boolean {
  if (!data) return false;
  if (data.isDynamic === true) return true;
  if (String(data.calculatorType || '').toLowerCase() === 'dynamic') return true;

  const state = extractDynamicJobState(data);
  return Boolean(state && typeof state === 'object' && Object.keys(state).length > 0);
}

/**
 * PortalJobBuilder product fields win entirely; only UI context is kept from input.
 */
export function buildProductDataFromPortalRecord(input: any = {}, portalRecord: any = {}) {
  const context = pickContextFromInput(input);
  const product = extractProductFieldsFromRecord(portalRecord);
  const merged: any = {
    ...context,
    ...product,
    _productSource: 'portal',
  };

  const portalState = extractDynamicJobState(portalRecord);
  if (portalState) {
    merged.dynamicJobState = reconcileDynamicJobStateColorValues(portalState);
    merged.isDynamic = portalRecord.isDynamic ?? merged.isDynamic ?? true;
  } else if (portalRecord.isDynamic === false) {
    merged.isDynamic = false;
    delete merged.dynamicJobState;
  }

  return merged;
}

/**
 * When no PortalJobBuilder exists, use JobBuilder (sales) product fields as fallback.
 */
export function buildProductDataFromJobBuilderRecord(input: any = {}, jobBuilderRecord: any = {}) {
  const context = pickContextFromInput(input);
  const product = extractProductFieldsFromRecord(jobBuilderRecord);
  const merged: any = {
    ...context,
    ...product,
    _productSource: 'jobBuilder',
  };
  const jbState = extractDynamicJobState(jobBuilderRecord);
  if (jbState) {
    merged.dynamicJobState = reconcileDynamicJobStateColorValues(jbState);
    merged.isDynamic = jobBuilderRecord.isDynamic ?? merged.isDynamic ?? true;
  }
  return merged;
}

function mergeDynamicFields(target: any = {}, source: any = {}) {
  if (!source || typeof source !== 'object') return target;

  const next: any = { ...target };
  const dynamicState = extractDynamicJobState(source);

  if (source.isDynamic !== undefined) next.isDynamic = source.isDynamic;
  if (dynamicState) next.dynamicJobState = dynamicState;
  if (source.configId) next.configId = source.configId;
  if (source.configSnapshotId) next.configSnapshotId = source.configSnapshotId;
  if (source.calculatorType) next.calculatorType = source.calculatorType;
  if (source.calculatorId) next.calculatorId = source.calculatorId;
  if (source.appointmentId) next.appointmentId = source.appointmentId;

  return next;
}

/** Fallback when no PortalJobBuilder exists — read the calculator-scoped outcome. */
async function fetchCalculatorOutcome(leadId?: string, calculatorId?: string) {
  if (!leadId || !calculatorId) return null;
  try {
    const res = await LeadService.getLeadOutcomeByCalculator(leadId, calculatorId);
    const body = res.data;
    return body?.data ?? body ?? null;
  } catch {
    return null;
  }
}

function resolveApiSource(portalRes: any): 'portal' | 'jobBuilder' | null {
  if (!portalRes?.portalJobBuilder) return null;
  if (portalRes.source === 'portal' || portalRes.source === 'jobBuilder') {
    return portalRes.source;
  }
  if (portalRes.portalJobBuilder._productSource === 'portal') return 'portal';
  if (portalRes.portalJobBuilder._productSource === 'jobBuilder') return 'jobBuilder';
  if (portalRes.portalJobBuilder.jobBuilderId) return 'portal';
  return 'jobBuilder';
}

/**
 * Load product data: PortalJobBuilder first, JobBuilder API fallback, then
 * calculator-outcome/input. Returns an enriched object carrying `dynamicJobState`
 * + `isDynamic` when the deal is dynamic.
 */
export async function enrichJobBuilderProductData(jobBuilderData: any, lead: any = null) {
  const leadId = lead?._id || lead?.leadId || jobBuilderData?.leadId;

  if (!leadId) {
    return { ...(jobBuilderData || {}) };
  }

  const portalRes = await LeadService.getPortalJobBuilder(leadId);
  const apiRecord = portalRes?.portalJobBuilder;
  const apiSource = resolveApiSource(portalRes);

  let merged: any;

  if (apiSource === 'portal' && apiRecord) {
    merged = buildProductDataFromPortalRecord(jobBuilderData, apiRecord);
  } else if (apiRecord) {
    merged = buildProductDataFromJobBuilderRecord(jobBuilderData, apiRecord);
  } else {
    merged = { ...(jobBuilderData || {}), _productSource: 'socket' };

    const calculatorId =
      merged.calculatorId ||
      lead?.selectedCalculatorId ||
      lead?.lfCalculator?._id ||
      lead?.lfCalculator;

    const outcome = await fetchCalculatorOutcome(leadId, calculatorId);
    const outcomeJobBuilder = outcome?.jobBuilder;
    if (outcomeJobBuilder) {
      merged = mergeDynamicFields(merged, outcomeJobBuilder);
    }
  }

  if (isDynamicJobBuilderData(merged)) {
    const dynamicState = reconcileDynamicJobStateColorValues(extractDynamicJobState(merged));
    return {
      ...merged,
      dynamicJobState: dynamicState,
      isDynamic: merged.isDynamic ?? true,
    };
  }

  return merged;
}
