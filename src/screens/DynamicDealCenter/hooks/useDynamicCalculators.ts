import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { LeadService } from '../../../services/api/leads';
import type { CalculatorEntry, CalculatorTotals, CalculatorSchema } from '../types/calculator';
import { computeDerivedTitles } from '../utils/tab-naming';
import { computeTitleSaveOrder, getUniquePersistableTitles, resolvePersistableTitle, TEMP_TITLE_PREFIX } from '../utils/title-save-order';
import { buildAllEntriesMap, mergeFullEntries } from '../utils/build-all-entries';
import {
  normalizeSingleAcceptedDrop,
  adoptServerDropIds,
  readServerDrops,
  toDropPricePayload,
  idlessDropSignature,
} from '../utils/drop-prices';
import { scopeSignature } from '../utils/scope-signature';
import { logCalculatorFieldEntry, logCalculatorCreated, logCalculatorRename, logPaymentMethodInherited, logSectionCleared, logCalculatorAutoRenamed, logCalculatorViewed } from '../../../utils/activity-log/calculator-log';
import { buildFieldLogLabel, findFieldStoryLabel } from '../utils/story-log-label';
import { isOnline } from '../../../services/connectivity';
import { logEvent } from '../../../services/api/LoggerService';
import {
  ensureOfflineWorkForLead,
  runUpload,
  saveOfflineDealCenter,
} from '../../../services/offlineLeadStore';
import {
  hasUnsyncedDealCenter,
  isClientId,
  newWorkId,
  type OfflineCalculatorWork,
} from '../../../utils/offline-lead-work';
import { readOfflineCache, writeOfflineCache } from '../../../utils/offline-query-cache';
import {
  cachedCalculatorsOf,
  dealCenterCacheName,
  resolveOfflineDealCenterSource,
  type CachedDealCenter,
} from '../../../utils/offline-deal-center';
import {
  canUseLocalOnlyMode,
  readOutcome,
  resolveAppointmentFallback,
  resolveOnlineLoadSource,
} from '../../../utils/deal-center-load';
import { canAddCalculatorTab, canDuplicateCalculatorTab } from '../../../utils/calculator-tab-gate';

export interface CalcTab {
  id: string;
  title: string;
  entries: Record<string, CalculatorEntry>;
  totals: CalculatorTotals;
  isRolloutConfirmed?: boolean;
  price?: number;
  resultType?: 'sale' | 'demo';
  paymentMethod?: string;
  dropPrice?: any[];
  downPayment?: number;
  discountPercentage?: number;
  selectedRenders?: any[];
  oneYearMonthlyPlan?: {
    mode: 'match' | 'default' | 'custom';
    planKey?: string;
    apr?: number;
    monthlyPayment?: number;
    grandTotal?: number;
    isDefault?: boolean;
  } | null;
  inHome?: {
    planKey?: string;
    addedPlans?: string[];
    apr?: number;
    monthlyPayment?: number;
    grandTotal?: number;
    optInProgram?: 'inhome' | 'oneyear' | null;
  } | null;
  descriptions?: string[];
  /**
   * The same scope lines grouped by trade, for the Investment Center's
   * "<categoryName> Installation:" headings. Carried verbatim from the API.
   */
  descriptionsByCategory?: Array<{ categoryId?: string; categoryName?: string; descriptions?: string[] }>;
  manualTitle?: string;
  pricemarkup?: string;
  priceScopeSig?: string;
  persisted?: boolean;
}

const SAVE_DEBOUNCE_MS = 1500;
const ZERO: CalculatorTotals = { cost: 0, par: 0, retail: 0 };

const isBackendId = (id?: string) => !!id && /^[a-f0-9]{24}$/i.test(id);

function tabFromOfflinePayload(
  calc: OfflineCalculatorWork,
  schemas: CalculatorSchema[]
): CalcTab {
  const p = (calc.payload || {}) as any;
  const entries = mergeFullEntries(parseEntries(p.entries), schemas);
  return {
    id: calc.serverId || calc.clientId,
    title: p.title || '1',
    entries,
    totals: p.totals || computeTotals(entries),
    isRolloutConfirmed: p.isRolloutConfirmed,
    price: p.price,
    pricemarkup: p.pricemarkup,
    priceScopeSig: p.priceScopeSig || '',
    paymentMethod: p.paymentMethod || undefined,
    dropPrice: p.dropPrice || [],
    downPayment: p.downPayment,
    discountPercentage: p.discountPercentage,
    selectedRenders: p.selectedRenders || [],
    oneYearMonthlyPlan: p.oneYearMonthlyPlan ?? null,
    inHome: p.inHome ?? null,
    // ⚠️ NOT `persisted`. Nothing has reached the server, and the flag gates the unmount PUT.
    persisted: false,
  };
}

function tabFromServerCalculator(c: any, schemas: CalculatorSchema[]): CalcTab {
  const entries = mergeFullEntries(parseEntries(c?.entries), schemas);
  return {
    id: String(c?._id || c?.id),
    title: c?.title || '1',
    entries,
    totals: c?.totals || computeTotals(entries),
    isRolloutConfirmed: c?.isRolloutConfirmed,
    price: c?.price,
    priceScopeSig: c?.priceScopeSig || '',
    paymentMethod: c?.paymentMethod || undefined,
    dropPrice: normalizeSingleAcceptedDrop(c?.dropPrice),
    downPayment: c?.downPayment || 0,
    discountPercentage: Number(c?.discountPercentage) || undefined,
    selectedRenders: Array.isArray(c?.selectedRenders) ? c.selectedRenders : [],
    oneYearMonthlyPlan: c?.oneYearMonthlyPlan || null,
    inHome: c?.inHome ?? c?.in_home ?? null,
    descriptions: Array.isArray(c?.descriptions) ? c.descriptions : [],
    // ⚠️ This mapper is a WHITELIST - a field not copied here never reaches the Investment
    // Center, and the grouped headings would silently never appear.
    descriptionsByCategory: Array.isArray(c?.descriptionsByCategory) ? c.descriptionsByCategory : [],
    persisted: true,
  };
}

function computeTotals(entries: Record<string, CalculatorEntry>): CalculatorTotals {
  return Object.values(entries).reduce(
    (a, e) => ({
      cost: a.cost + (e.computed?.cost || 0),
      par: a.par + (e.computed?.par || 0),
      retail: a.retail + (e.computed?.retail || 0),
    }),
    { ...ZERO }
  );
}

function tabSignature(tab: CalcTab): string {
  const entrySig = Object.entries(tab.entries || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, e]) => `${id}:${e?.inputValue ?? ''}`)
    .join('|');
  const renderSig = (tab.selectedRenders || [])
    .map((r: any) => r?.runId || r?._id || r?.generatedUrl || '')
    .join('|');
  const oy = tab.oneYearMonthlyPlan;
  const oneYearSig = oy ? `${oy.mode ?? ''}:${oy.planKey ?? ''}:${oy.isDefault ? 1 : 0}` : '';
  const ih = tab.inHome;
  const inHomeSig = ih ? `${ih.planKey ?? ''}:${Array.isArray(ih.addedPlans) ? ih.addedPlans.join('|') : ''}:${ih.optInProgram ?? ''}` : '';
  return `${entrySig}#${tab.title}#${tab.isRolloutConfirmed ? 1 : 0}#${tab.price ?? ''}#${tab.pricemarkup ?? ''}#${tab.paymentMethod ?? ''}#${tab.downPayment ?? ''}#${tab.discountPercentage ?? ''}#${renderSig}#${oneYearSig}#${inHomeSig}#${tab.priceScopeSig ?? ''}`;
}

function parseEntries(arr: any): Record<string, CalculatorEntry> {
  const map: Record<string, CalculatorEntry> = {};
  (Array.isArray(arr) ? arr : []).forEach((e: any) => {
    const id = e?.fieldId || e?.id;
    if (id) map[id] = { ...e, inputValue: Number(e.inputValue) || 0 };
  });
  return map;
}

function customerNameOf(lead: any): string {
  const cd = lead?.customerDetails || {};
  return `${cd.firstName || lead?.firstName || ''} ${cd.lastName || lead?.lastName || ''}`.trim();
}

function customerTitleOf(lead: any): string {
  return customerNameOf(lead) || lead?.customerName || lead?.name || lead?.title || 'Lead';
}

/**
 * ⚠️ Returns WHY it has no id, not just that it has none.
 *
 * `null` used to mean both "this lead has no appointment" and "every call timed out". The
 * caller dropped into local-only mode on either, so on one bar of LTE a lead with a confirmed
 * rollout showed a blank calculator. `failed` separates the two.
 */
async function resolveAppointmentId(
  lead: any
): Promise<{ id: string | null; failed: boolean }> {
  const direct = lead?.appointmentId;
  if (direct) return { id: String(direct), failed: false };

  const leadIdHuman = lead?.leadId; // human-readable id (e.g. "504")
  const selfGenLeadId = lead?._id || lead?.selfGenLeadId || lead?.id;
  const leadDate = lead?.leadDate || lead?.lead_date;
  if (!leadIdHuman && !selfGenLeadId) return { id: null, failed: false };

  let lookupFailed = false;
  try {
    const res = await LeadService.getAppointments(leadDate ? { lead_date: leadDate } : undefined);
    const appts = res.data?.data || res.data || [];
    const found = (appts as any[]).find(
      (a) =>
        (a.leadId && a.leadId !== 'N/A' && String(a.leadId) === String(leadIdHuman)) ||
        (a.selfGenLeadId && a.selfGenLeadId !== 'N/A' && String(a.selfGenLeadId) === String(selfGenLeadId))
    );
    if (found) return { id: String(found._id || found.id), failed: false };
  } catch {
    lookupFailed = true;
  }

  try {
    const createRes = await LeadService.createAppointment({
      title: customerTitleOf(lead),
      address: lead?.fullAddress || lead?.address || '',
      leadId: leadIdHuman,
      selfGenLeadId,
    });
    const created = createRes.data?.data || createRes.data;
    const createdId = created ? String(created._id || created.id) : '';
    return createdId ? { id: createdId, failed: false } : { id: null, failed: lookupFailed };
  } catch (createErr: any) {
    const body = createErr?.response?.data ?? createErr;
    const existingId =
      body?.data?.appointmentId ||
      body?.appointmentId ||
      createErr?.response?.data?.data?.appointmentId ||
      null;
    const is409 =
      body?.code === 409 ||
      createErr?.response?.status === 409 ||
      createErr?.status === 409 ||
      /already has an appointment/i.test(String(body?.message || createErr?.message || ''));
    if (is409 && existingId) return { id: String(existingId), failed: false };
    // ⚠️ A 4xx/409 is an ANSWER about this lead; a timeout or network error is not. Only the
    // latter may make the caller fall back to the cached appointment id.
    const answered =
      is409 || (typeof createErr?.response?.status === 'number' && createErr.response.status < 500);
    return { id: null, failed: lookupFailed || !answered };
  }
}

interface CreateExtra {
  discountPercentage?: number;
  paymentMethod?: string;
  paymentMethodLabel?: string;
  originalCalculatorId?: string;
  duplicateLog?: any;
  /** A duplicate carries the SOURCE's totals so both tabs price (and therefore title) identically. */
  totals?: CalcTab['totals'];
}

async function createRemoteTab(
  appointmentId: string,
  title: string,
  entries: Record<string, CalculatorEntry>,
  leadId: string | undefined,
  enteredBy: string | undefined,
  schemas: CalculatorSchema[],
  position: number,
  extra: CreateExtra = {}
): Promise<CalcTab | null> {
  try {
    const seeded = mergeFullEntries(entries, schemas);
    const totals = extra.totals ?? computeTotals(seeded);
    const res = await LeadService.createCalculator(appointmentId, {
      title,
      position,
      entries: Object.values(seeded),
      totals,
      schemaSnapshotId: schemas?.[0]?.id || 'static',
      leadId,
      enteredBy,
      enteredAt: new Date().toISOString(),
      ...(extra.discountPercentage != null ? { discountPercentage: extra.discountPercentage } : {}),
      ...(extra.paymentMethod ? { paymentMethod: extra.paymentMethod, paymentMethodLabel: extra.paymentMethodLabel } : {}),
      ...(extra.originalCalculatorId ? { originalCalculatorId: extra.originalCalculatorId } : {}),
      ...(extra.duplicateLog ? { duplicateLog: extra.duplicateLog } : {}),
    });
    const c = res.data?.data || res.data;
    const id = c?._id || c?.id;
    if (!id) return null;
    return {
      id: String(id),
      title: c.title || title,
      entries: c.entries ? mergeFullEntries(parseEntries(c.entries), schemas) : seeded,
      totals: extra.totals ?? c.totals ?? totals,
      persisted: true,
      paymentMethod: extra.paymentMethod || c.paymentMethod,
      discountPercentage: extra.discountPercentage ?? c.discountPercentage,
    };
  } catch {
    return null;
  }
}

interface UseDynamicCalculatorsOptions {
  logCalculatorView?: boolean;
}

export function useDynamicCalculators(
  lead: any,
  schemas: CalculatorSchema[] = [],
  options: UseDynamicCalculatorsOptions = {},
) {
  const { logCalculatorView = true } = options;
  const { user } = useAuth();

  const inheritedDefaults = useCallback((): CreateExtra => {
    const isLowesLead = lead?.lowesLead === true;
    const paymentMethod = isLowesLead ? 'lowes_ach' : (user?.defaultPaymentMethod || undefined);
    return {
      ...(user?.defaultPercentage ? { discountPercentage: Number(user.defaultPercentage) } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
    };
  }, [lead?.lowesLead, user?.defaultPaymentMethod, user?.defaultPercentage]);

  const [tabs, setTabs] = useState<CalcTab[]>([
    { id: 'local-1', title: '1', entries: {}, totals: { ...ZERO } },
  ]);
  const [activeTabId, setActiveTabId] = useState('local-1');
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  /**
   * The rep pressed "Work offline" on a load that would not finish.
   *
   * ⚠️ Forces the device-authoritative path even though `isOnline()` says true - which on one
   * bar it does, right up to the timeout. Without this escape the cached quote already on the
   * device is unreachable precisely when it is most needed.
   */
  const [preferDevice, setPreferDevice] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const saveTimers = useRef<Record<string, any>>({});
  const saveInFlight = useRef<Record<string, boolean>>({});
  const needsFollowUp = useRef<Record<string, boolean>>({});
  const dirty = useRef<Record<string, boolean>>({});
  const lastSavedTitle = useRef<Record<string, string>>({});
  /**
   * The baseline for the OFFLINE `auto_rename` log only.
   *
   * ⚠️ Deliberately separate from `lastSavedTitle`, which must hold only server-acknowledged
   * titles because `resolveSafeTitle` uses it to decide what is safe to send.
   */
  const lastOfflineLoggedTitle = useRef<Record<string, string>>({});
  const loggedViewIds = useRef<Set<string>>(new Set());
  const bootstrapLeadRef = useRef<string | null>(null);

  const offlineWorkIdRef = useRef<string | null>(null);
  const offlineModeRef = useRef(false);
  const apptClientIdRef = useRef<string | null>(null);
  const apptPayloadRef = useRef<Record<string, unknown> | null>(null);
  const apptServerIdRef = useRef<string | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistOfflineRef = useRef<((list?: CalcTab[]) => void) | null>(null);

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const leadId = lead?._id || lead?.leadId || lead?.id;
  const enteredBy = user?._id || user?.id || '';

  useEffect(() => {
    if (!logCalculatorView || !enteredBy || !activeTabId) return;
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active) return;
    const calcId = (active as any).calculatorId || active.id;
    // A calculator minted on the device (`calc-...`) is viewed too: online logs this for every tab, and
    // the queued log is resolved to the server id once the calculator uploads.
    if ((!isBackendId(active.id) && !isClientId(active.id)) || loggedViewIds.current.has(calcId)) return;
    loggedViewIds.current.add(calcId);
    logCalculatorViewed({
      userId: enteredBy,
      calculatorId: calcId,
      appointmentId: (active as any).appointmentId || appointmentId,
      calculatorTitle: active.title,
      leadId: leadId || undefined,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, tabs, enteredBy, logCalculatorView]);

  const schemasRef = useRef(schemas);
  schemasRef.current = schemas;
  const leadRef = useRef(lead);
  leadRef.current = lead;
  const snapshotId = () => schemasRef.current?.[0]?.id || 'static';

  const categoryNameOf = useCallback((categoryId?: string): string => {
    if (!categoryId) return '';
    for (const s of schemasRef.current || []) {
      for (const c of s.categories || []) {
        if (c.id === categoryId) return c.name || c.label || categoryId;
      }
    }
    return categoryId;
  }, []);

  const titleInputs = useCallback(
    (list: CalcTab[]) =>
      list.map((t, i) => ({
        id: t.id,
        entries: t.entries,
        price: t.totals?.retail || 0,
        manualTitle: t.manualTitle,
        storedTitle: t.title,
        originalTitle: i === 0 ? customerTitleOf(leadRef.current) : undefined,
      })),
    []
  );

  /**
   * ⚠️ The title we SEND, which is not always the title we SHOW.
   *
   * `computeDerivedTitles` gives two same-priced tabs the same decorated name (`⚠️ G ⚠️`) on
   * purpose, so the rep can see the pair is ambiguous. The server refuses a duplicate outright
   * (409 "LFCalculator title must be unique..."), so that decorated name must never be persisted.
   *
   * ⚠️ Online this worked by accident: `lastSavedTitle` held the title the SERVER confirmed
   * (the placeholder "2"), so the fallback was already unique. Offline nothing is ever confirmed,
   * and `persistOffline` was writing the DERIVED title into the same map - so the fallback handed
   * back `⚠️ S ⚠️` and every queued copy carried it. The lead then could not drain.
   * `resolvePersistableTitle` falls back to the position placeholder instead, as online does.
   */
  const resolveSafeTitle = useCallback((tab: CalcTab): string => {
    const list = tabsRef.current;
    const derived = computeDerivedTitles(titleInputs(list), schemasRef.current || []);
    const idx = list.findIndex((t) => t.id === tab.id);
    return resolvePersistableTitle({
      tabId: tab.id,
      derived,
      lastSaved: lastSavedTitle.current,
      position: (idx >= 0 ? idx : list.length) + 1,
      currentTitle: tab.title,
    });
  }, [titleInputs]);

  const buildPayload = useCallback(
    (tab: CalcTab) => ({
      title: resolveSafeTitle(tab),
      entries: Object.values(tab.entries),
      totals: tab.totals,
      isRolloutConfirmed: tab.isRolloutConfirmed,
      price: tab.price,
      pricemarkup: tab.pricemarkup,
      priceScopeSig: tab.priceScopeSig ?? '',
      paymentMethod: tab.paymentMethod,
      downPayment: tab.downPayment,
      discountPercentage: tab.discountPercentage,
      selectedRenders: tab.selectedRenders || [],
      oneYearMonthlyPlan: tab.oneYearMonthlyPlan ?? null,
      inHome: tab.inHome ?? null,
      schemaSnapshotId: snapshotId(),
      leadId,
      enteredBy,
      enteredAt: new Date().toISOString(),
    }),
    [leadId, enteredBy, resolveSafeTitle]
  );
  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;

  const anyInFlight = () => Object.values(saveInFlight.current).some(Boolean);

  const retitle = useCallback((list: CalcTab[]): CalcTab[] => {
    const titles = computeDerivedTitles(
      titleInputs(list),
      schemasRef.current || [],
    );
    let changed = false;
    const next = list.map((t) => {
      if (titles[t.id] && titles[t.id] !== t.title) {
        changed = true;
        return { ...t, title: titles[t.id] };
      }
      return t;
    });
    return changed ? next : list;
  }, [titleInputs]);

  const cacheDealCenterSnapshot = useCallback(
    (rows: unknown[], apptId?: string | null) => {
      const name = dealCenterCacheName(leadId);
      if (!name) return;
      writeOfflineCache<CachedDealCenter>(
        name,
        { appointmentId: apptId ?? apptServerIdRef.current ?? null, calculators: rows },
        enteredBy || null
      );
    },
    [leadId, enteredBy]
  );

  const cacheTabsSnapshot = useCallback(
    (list: CalcTab[], apptId?: string | null) => {
      cacheDealCenterSnapshot(
        list
          .filter((t) => isBackendId(t.id))
          .map((t) => ({
            ...buildPayloadRef.current(t),
            _id: t.id,
        dropPrice: toDropPricePayload(normalizeSingleAcceptedDrop(t.dropPrice || [])),
          })),
        apptId
      );
    },
    [cacheDealCenterSnapshot]
  );
  const cacheDealCenterSnapshotRef = useRef(cacheDealCenterSnapshot);
  cacheDealCenterSnapshotRef.current = cacheDealCenterSnapshot;
  const cacheTabsSnapshotRef = useRef(cacheTabsSnapshot);
  cacheTabsSnapshotRef.current = cacheTabsSnapshot;

  // `persistOffline` is created once, so what it logs with is read from here.
  const offlineLogCtx = useRef({ enteredBy: '', leadId: '' as string | undefined, appointmentId: '' as string | undefined });
  offlineLogCtx.current = { enteredBy, leadId: leadId || undefined, appointmentId: appointmentId || undefined };

  // True while this instance holds a change the debounced device save has not written yet.
  const offlineDirty = useRef(false);

  const persistOffline = useCallback((explicit?: CalcTab[]) => {
    const workId = offlineWorkIdRef.current;
    if (!workId) return;
    if (!offlineModeRef.current && isOnline()) return;
    offlineDirty.current = false;
    // Online logs `auto_rename` when a save changes a tab's title (flushSave); a device save never
    // reaches flushSave, so the same comparison is made here.
    //
    // ⚠️ THIS LOOP IS FOR LOGGING ONLY - it must NOT write into `lastSavedTitle`.
    // That map means "a title the SERVER has acknowledged", and `resolveSafeTitle` trusts it as a
    // uniqueness fallback. Writing the DERIVED display title here made the ambiguous `⚠️ S ⚠️`
    // look confirmed, so every queued duplicate was sent with that same title and the lead stuck
    // on a 409 no retry could clear. Offline nothing is acknowledged, so nothing is recorded here.
    (explicit || tabsRef.current).forEach((t) => {
      const prevTitle = lastOfflineLoggedTitle.current[t.id] ?? lastSavedTitle.current[t.id];
      if (prevTitle === undefined) {
        lastOfflineLoggedTitle.current[t.id] = t.title;
        return;
      }
      if (prevTitle === t.title || t.title.startsWith(TEMP_TITLE_PREFIX)) return;
      const ctx = offlineLogCtx.current;
      if (ctx.enteredBy) {
        logCalculatorAutoRenamed({
          userId: ctx.enteredBy,
          calculatorId: (t as any).calculatorId || t.id,
          appointmentId: (t as any).appointmentId || ctx.appointmentId,
          calculatorTitle: t.title,
          leadId: ctx.leadId,
        }).catch(() => {});
      }
      lastOfflineLoggedTitle.current[t.id] = t.title;
    });
    const calculators: OfflineCalculatorWork[] = (explicit || tabsRef.current).map((t) => ({
      clientId: t.id,
      serverId: isBackendId(t.id) ? t.id : undefined,
      payload: {
        ...buildPayloadRef.current(t),
        /**
         * ⚠️ THROUGH `toDropPricePayload`, exactly like the online saves (and never raw).
         *
         * This used to send `t.dropPrice` as-is, so the queued payload carried the INTERNAL row -
         * `price`, `paymentMethods`, and any other field the UI hangs on a drop - instead of the
         * six-key contract the API accepts. Online it never showed, because both online savers
         * already map through the builder; offline the raw row went up on sync and the calculator
         * write failed with a 500.
         *
         * `normalizeSingleAcceptedDrop` matches the online path too: at most one accepted drop.
         */
        dropPrice: toDropPricePayload(normalizeSingleAcceptedDrop(t.dropPrice || [])),
      },
    }));
    saveOfflineDealCenter(workId, {
      appointment: apptPayloadRef.current || undefined,
      appointmentClientId: apptClientIdRef.current || undefined,
      appointmentServerId: apptServerIdRef.current || undefined,
      calculators,
    });
    if (isOnline()) runUpload();
  }, []);
  persistOfflineRef.current = persistOffline;

  const flushSaveRef = useRef<((tabId: string) => void) | null>(null);

  const scheduleSave = useCallback((tabId: string) => {
    if (offlineModeRef.current || !isBackendId(tabId) || !isOnline()) {
      offlineModeRef.current = true;
      offlineDirty.current = true;
      if (offlineWorkIdRef.current) {
        if (offlineTimer.current) clearTimeout(offlineTimer.current);
        offlineTimer.current = setTimeout(() => persistOfflineRef.current?.(), SAVE_DEBOUNCE_MS);
      }
      return;
    }
    if (saveTimers.current[tabId]) clearTimeout(saveTimers.current[tabId]);
    saveTimers.current[tabId] = setTimeout(() => flushSaveRef.current?.(tabId), SAVE_DEBOUNCE_MS);
  }, []);

  const dropIdFetchTried = useRef<Record<string, string>>({});
  const dropSaveInFlight = useRef<Record<string, boolean>>({});
  const dropSavePending = useRef<Record<string, any[] | null>>({});
  const saveDropsNowRef = useRef<((tabId: string, drops: any[], attempt?: number) => void) | null>(null);

  const adoptDropIds = useCallback(async (tabId: string, response: any) => {
    let serverDrops = readServerDrops(response);
    if (!serverDrops.length) {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      const sig = idlessDropSignature(tab?.dropPrice);
      if (!sig || dropIdFetchTried.current[tabId] === sig) return;
      dropIdFetchTried.current[tabId] = sig;
      try {
        serverDrops = readServerDrops(await LeadService.getCalculator(tabId));
      } catch {
        return; // next save retries
      }
      if (!serverDrops.length) return;
    }
    setTabs((prev) => {
      let touched = false;
      const next = prev.map((t) => {
        if (t.id !== tabId || !t.dropPrice?.length) return t;
        const adopted = adoptServerDropIds(t.dropPrice, serverDrops);
        if (adopted === t.dropPrice) return t;
        touched = true;
        return { ...t, dropPrice: adopted };
      });
      if (!touched) return prev;
      tabsRef.current = next;
      return next;
    });
  }, []);

  const saveDropsNow = useCallback(
    async (tabId: string, drops: any[], attempt = 0) => {
      if (!isBackendId(tabId) || !isOnline()) {
        persistOfflineRef.current?.();
        return;
      }
      if (dropSaveInFlight.current[tabId]) {
        dropSavePending.current[tabId] = drops;
        return;
      }
      dropSaveInFlight.current[tabId] = true;
      setIsSaving(true);
      try {
        const res = await LeadService.updateCalculator(tabId, {
          dropPrice: toDropPricePayload(normalizeSingleAcceptedDrop(drops)),
        });
        setLastUpdated(
          new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        );
        await adoptDropIds(tabId, res);
      } catch {
        if (attempt === 0) {
          dropSavePending.current[tabId] = drops; // one immediate retry
        } else {
          offlineModeRef.current = true;
          persistOfflineRef.current?.();
        }
      } finally {
        dropSaveInFlight.current[tabId] = false;
        setIsSaving(anyInFlight() || Object.values(dropSaveInFlight.current).some(Boolean));
        const pending = dropSavePending.current[tabId];
        if (pending) {
          dropSavePending.current[tabId] = null;
          saveDropsNowRef.current?.(tabId, pending, attempt + 1);
        }
      }
    },
    [adoptDropIds]
  );
  saveDropsNowRef.current = saveDropsNow;

  const saveDisplacedSiblings = useCallback(async (changedTabId: string) => {
    const all = tabsRef.current;
    if (all.length <= 1) return;

    const derived = computeDerivedTitles(
      titleInputs(all),
      schemasRef.current || [],
    );
    const persistable = getUniquePersistableTitles(derived);
    const order = computeTitleSaveOrder({
      allCalcs: all.map((t) => ({ id: t.id, dbTitle: lastSavedTitle.current[t.id] ?? t.title })),
      changedCalcId: changedTabId,
      newTitles: derived,
    });

    const displaced = order.slice(0, -1);
    for (const step of displaced) {
      const st = all.find((t) => t.id === step.calculatorId);
      if (!st || !st.persisted || !isBackendId(st.id)) continue;
      const isTemp = step.newTitle.startsWith(TEMP_TITLE_PREFIX);
      if (!isTemp && persistable[step.calculatorId] !== step.newTitle) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await LeadService.updateCalculator(step.calculatorId, { ...buildPayloadRef.current(st), title: step.newTitle });
        adoptDropIds(step.calculatorId, res);
        if (!isTemp) {
          const prev = lastSavedTitle.current[step.calculatorId];
          if (enteredBy && prev !== undefined && prev !== step.newTitle) {
            logCalculatorAutoRenamed({
              userId: enteredBy,
              calculatorId: (st as any).calculatorId || st.id,
              appointmentId: (st as any).appointmentId || appointmentId,
              calculatorTitle: step.newTitle,
              leadId: leadId || undefined,
            }).catch(() => {});
          }
          lastSavedTitle.current[step.calculatorId] = step.newTitle;
        }
      } catch {
      }
    }
  }, [enteredBy, appointmentId, leadId, adoptDropIds, titleInputs]);

  const flushSave = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || !tab.persisted || !isBackendId(tab.id)) return;
      if (!dirty.current[tabId]) return; // nothing new to save

      if (saveInFlight.current[tabId]) {
        needsFollowUp.current[tabId] = true;
        return;
      }

      const sig = tabSignature(tab);
      saveInFlight.current[tabId] = true;
      setIsSaving(true);

      const savedTitle = resolveSafeTitle(tab);
      try {
        await saveDisplacedSiblings(tabId);
        const res = await LeadService.updateCalculator(tabId, buildPayloadRef.current(tab));
        adoptDropIds(tabId, res);
        cacheTabsSnapshotRef.current?.(tabsRef.current);
        setLastUpdated(
          new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        );
        const prevTitle = lastSavedTitle.current[tabId];
        if (enteredBy && prevTitle !== undefined && prevTitle !== savedTitle) {
          logCalculatorAutoRenamed({
            userId: enteredBy,
            calculatorId: (tab as any).calculatorId || tab.id,
            appointmentId: (tab as any).appointmentId || appointmentId,
            calculatorTitle: savedTitle,
            leadId: leadId || undefined,
          }).catch(() => {});
        }
        lastSavedTitle.current[tabId] = savedTitle;
        const latest = tabsRef.current.find((t) => t.id === tabId);
        if (latest && tabSignature(latest) === sig) dirty.current[tabId] = false;
      } catch {
      } finally {
        saveInFlight.current[tabId] = false;
        setIsSaving(anyInFlight());

        const latest = tabsRef.current.find((t) => t.id === tabId);
        const hasNewerEdits = !!latest && tabSignature(latest) !== sig;
        if (needsFollowUp.current[tabId] || hasNewerEdits || dirty.current[tabId]) {
          needsFollowUp.current[tabId] = false;
          scheduleSave(tabId);
        }
      }
    },
    [scheduleSave, enteredBy, appointmentId, leadId, saveDisplacedSiblings, resolveSafeTitle, adoptDropIds]
  );
  flushSaveRef.current = flushSave;

  const markDirty = useCallback(
    (tabId: string) => {
      dirty.current[tabId] = true;
      scheduleSave(tabId);
    },
    [scheduleSave]
  );

  useEffect(() => {
    const key = `${leadId || 'none'}:${preferDevice ? 'device' : 'net'}`;
    if (bootstrapLeadRef.current === key) return; // already bootstrapped this lead
    bootstrapLeadRef.current = key;
    let cancelled = false;
    (async () => {
      setLoading(true);

      const work = ensureOfflineWorkForLead(lead);
      if (work) offlineWorkIdRef.current = work.clientId;

      const deviceIsAuthoritative =
        preferDevice || !isOnline() || isClientId(String(leadId || '')) || hasUnsyncedDealCenter(work);

      if (deviceIsAuthoritative) {
        offlineModeRef.current = true;
        if (work) {
          offlineWorkIdRef.current = work.clientId;
          const apptClientId = work.appointmentClientId || newWorkId('appt');
          apptClientIdRef.current = apptClientId;
          apptPayloadRef.current = {
            title: customerTitleOf(lead),
            address: lead?.fullAddress || lead?.address || '',
            leadId: lead?.leadId,
            selfGenLeadId: lead?._id || lead?.selfGenLeadId || lead?.id,
          };

          const cacheName = dealCenterCacheName(leadId);
          const cached = cacheName
            ? readOfflineCache<CachedDealCenter>(cacheName, { userId: enteredBy || undefined })?.data
              || null
            : null;

          apptServerIdRef.current = work.serverIds.appointmentId || cached?.appointmentId || null;
          setAppointmentId(apptServerIdRef.current || apptClientId);

          const stored = work.calculators || [];
          const source = resolveOfflineDealCenterSource({
            storedCalculators: stored.length,
            cached,
            leadCreatedOffline:
              work.origin === 'created-offline' || isClientId(String(leadId || '')),
            storedDrained: !hasUnsyncedDealCenter(work),
          });

          if (source === 'unavailable') {
            if (cancelled) return;
            setTabs([]);
            setOfflineUnavailable(true);
            setLoading(false);
            return;
          }
          setOfflineUnavailable(false);

          const hydrated: CalcTab[] =
            source === 'device'
              ? stored.map((c) => tabFromOfflinePayload(c, schemasRef.current))
              : source === 'cache'
                ? cachedCalculatorsOf(cached).map((c) =>
                    tabFromServerCalculator(c, schemasRef.current)
                  )
                : [
                    (() => {
                      const seeded = mergeFullEntries({}, schemasRef.current);
                      return {
                        id: newWorkId('calc'),
                        title: customerNameOf(lead) || '1',
                        entries: seeded,
                        totals: computeTotals(seeded),
                      };
                    })(),
                  ];

          if (cancelled) return;
          hydrated.forEach((t) => { lastSavedTitle.current[t.id] = t.title; });
          setTabs(hydrated);
          setActiveTabId(hydrated[0].id);
          setLoading(false);
          if (source !== 'cache') persistOfflineRef.current?.(hydrated);
          if (source === 'mint' && enteredBy) {
            // The first calculator of an offline lead: online logs this when it creates the tab.
            logCalculatorCreated({
              userId: enteredBy,
              calculatorId: hydrated[0].id,
              appointmentId: apptServerIdRef.current || apptClientId,
              calculatorTitle: hydrated[0].title,
              isFirstCalculator: true,
              leadId: leadId || undefined,
            }).catch(() => {});
          }
          return;
        }
        if (!isOnline()) {
          setTabs([]);
          setLoading(false);
          return;
        }
        offlineModeRef.current = false;
      }

      /**
       * ⚠️ The snapshot is read on the ONLINE path too, before anything is concluded from a
       * read that may never answer. `isOnline()` is true on one bar of LTE right up to the
       * 15 s timeout, so this branch runs for exactly the reps who most need the cache.
       */
      const onlineCacheName = dealCenterCacheName(leadId);
      const onlineCached = onlineCacheName
        ? readOfflineCache<CachedDealCenter>(onlineCacheName, { userId: enteredBy || undefined })?.data
          || null
        : null;
      const cachedRows = cachedCalculatorsOf(onlineCached).length;

      const showCached = (apptForCache: string | null) => {
        const hydrated: CalcTab[] = cachedCalculatorsOf(onlineCached).map((c: any) =>
          tabFromServerCalculator(c, schemasRef.current)
        );
        if (!hydrated.length) return false;
        hydrated.forEach((t) => { lastSavedTitle.current[t.id] = t.title; });
        setTabs(retitle(hydrated));
        setActiveTabId(hydrated[0].id);
        if (apptForCache) {
          setAppointmentId(apptForCache);
          apptServerIdRef.current = apptForCache;
        }
        return true;
      };

      const appt = await resolveAppointmentId(lead);
      if (cancelled) return;
      const resolved = resolveAppointmentFallback({
        resolvedId: appt.id,
        lookupFailed: appt.failed,
        cachedAppointmentId: onlineCached?.appointmentId ?? null,
      });
      const apptId = resolved.appointmentId;
      setAppointmentId(apptId);
      apptServerIdRef.current = apptId;

      if (!apptId) {
        // ⚠️ Only a lookup that ANSWERED "no appointment" may fall through to the blank
        // local-only calculator. A timed-out lookup shows the cached quote instead.
        if (!canUseLocalOnlyMode({ lookupFailed: appt.failed, cachedRows })) {
          showCached(null);
        }
        setLoading(false);
        return;
      }

      // The lookup failed and we are running on a cached appointment id: do not ask the server
      // for calculators we cannot reach - show the snapshot and let a later mount refresh it.
      if (resolved.source === 'cache') {
        if (!cancelled) {
          showCached(apptId);
          setLoading(false);
        }
        return;
      }

      let threw = false;
      let list: any[] = [];
      try {
        const res = await LeadService.getCalculators(apptId);
        const body = res.data?.data || res.data || [];
        list = Array.isArray(body) ? body : [];
      } catch {
        threw = true;
      }
      if (cancelled) return;

      try {
        const source = resolveOnlineLoadSource({
          outcome: readOutcome({ threw, rows: list }),
          cachedRows,
        });

        if (source === 'server') {
          cacheDealCenterSnapshotRef.current?.(list, apptId);
          const hydrated: CalcTab[] = list.map((c: any) =>
            tabFromServerCalculator(c, schemasRef.current)
          );
          hydrated.forEach((t) => { lastSavedTitle.current[t.id] = t.title; });
          setTabs(retitle(hydrated));
          setActiveTabId(hydrated[0].id);
        } else if (source === 'cache') {
          showCached(apptId);
        } else if (source === 'hold') {
          // Nothing proved and nothing cached. Keep the screen as it is rather than writing a
          // calculator we may be about to discover already exists.
        } else {
          const created = await createRemoteTab(
            apptId, customerNameOf(lead) || '1', {}, leadId, enteredBy, schemasRef.current, 1
          );
          if (cancelled) return;
          if (created) {
            lastSavedTitle.current[created.id] = created.title;
            setTabs(retitle([created]));
            setActiveTabId(created.id);
            cacheTabsSnapshotRef.current?.([created], apptId);
            if (enteredBy) {
              logCalculatorCreated({
                userId: enteredBy,
                calculatorId: (created as any).calculatorId || created.id,
                appointmentId: apptId,
                calculatorTitle: created.title,
                isFirstCalculator: true,
                leadId: leadId || undefined,
              }).catch(() => {});
            }
          }
        }
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, preferDevice]);

  useEffect(() => {
    setTabs((prev) => {
      const seed = buildAllEntriesMap(schemasRef.current);
      const seedKeys = Object.keys(seed);
      if (!seedKeys.length) return retitle(prev);
      let changed = false;
      const next = prev.map((t) => {
        if (!seedKeys.some((k) => !(k in t.entries))) return t; // already complete
        changed = true;
        return { ...t, entries: { ...seed, ...t.entries } };
      });
      return retitle(changed ? next : prev);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemas]);

  useEffect(() => {
    const timers = saveTimers.current;
    const dirtyMap = dirty.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      // ⚠️ Only a pending change is flushed. The Investment Center mounts its own copy of this hook and
      // stays mounted under the Deal Center it opens, so an unconditional save here replaced the device
      // record with that copy's stale tabs when the rep finished the deal.
      if (offlineDirty.current) persistOfflineRef.current?.();
      tabsRef.current.forEach((tab) => {
        if (tab.persisted && isBackendId(tab.id) && dirtyMap[tab.id]) {
          LeadService.updateCalculator(tab.id, buildPayloadRef.current(tab)).catch(() => {});
        }
      });
    };
  }, []);

  const handleEntryChange = useCallback(
    (fieldId: string, entry: CalculatorEntry) => {
      setTabs((prev) => {
        const prevActive = prev.find((t) => t.id === activeTabId);
        const oldEntry = prevActive?.entries?.[fieldId] as any;
        const updated = prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const entries = { ...t.entries, [fieldId]: entry };
          return { ...t, entries, totals: computeTotals(entries) };
        });
        const retitled = retitle(updated);
        const active = retitled.find((t) => t.id === activeTabId);
        if (active) {
          tabsRef.current = retitled; // let the debounced flush read this immediately
          markDirty(active.id);
          const e = entry as any;
          if (enteredBy && (oldEntry?.inputValue ?? '') !== (e?.inputValue ?? '')) {
            logCalculatorFieldEntry({
              userId: enteredBy,
              calculatorId: (active as any).calculatorId || active.id,
              appointmentId: (active as any).appointmentId,
              calculatorTitle: active.title,
              fieldLabel: buildFieldLogLabel(e?.label || fieldId, findFieldStoryLabel(fieldId, schemasRef.current)),
              fieldValue: e?.inputValue,
              fieldCategory: categoryNameOf(e?.categoryId),
              oldValue: oldEntry?.inputValue ?? '',
              newValue: e?.inputValue,
              leadId: leadId || undefined,
            }).catch(() => {});
          }
        }
        return retitled;
      });
    },
    [activeTabId, retitle, markDirty, enteredBy, leadId, categoryNameOf]
  );

  // A calculator added while the device is authoritative (offline, or a lead/appointment that exists only
  // here). Nothing is sent: it takes a `calc-...` id, is saved to the device record, and uploads with
  // the rest of the deal. The server is never asked, so its logs are written here instead.
  const deviceTabFrom = useCallback(
    (title: string, entries: Record<string, CalculatorEntry>, extra: CreateExtra): CalcTab => {
      const seeded = mergeFullEntries(entries, schemasRef.current);
      const tab: CalcTab = {
        id: newWorkId('calc'),
        title,
        entries: seeded,
        totals: extra.totals ?? computeTotals(seeded),
        paymentMethod: extra.paymentMethod,
        discountPercentage: extra.discountPercentage,
        persisted: false,
      };
      lastSavedTitle.current[tab.id] = tab.title;
      offlineModeRef.current = true;
      const next = retitle([...tabsRef.current, tab]);
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(tab.id);
      markDirty(tab.id);
      persistOfflineRef.current?.(next);
      return tab;
    },
    [retitle, markDirty]
  );
  const onDevice = useCallback(
    () => offlineModeRef.current || !isOnline() || isClientId(String(appointmentId || '')),
    [appointmentId]
  );

  const addingTabRef = useRef(false);

  const handleAddTab = useCallback(async () => {
    /**
     * ⚠️ Second line of defence. `CalculatorView` already refuses and explains, but the gate
     * belongs here too: this is the only writer, and a future caller that forgets the check
     * would silently create the blank tab the rule exists to prevent. Returns quietly - the
     * UI owns the message, and two flashes for one tap is worse than none.
     *
     * ⚠️ READS `tabsRef.current`, NOT `tabs`, and locks `addingTabRef` synchronously across
     * the async `createRemoteTab` round-trip so rapid taps on `+` can never create two empty
     * calculators before the first request finishes.
     */
    if (addingTabRef.current) return;
    if (!canAddCalculatorTab(tabsRef.current as any, activeTabId).allowed) return;
    addingTabRef.current = true;
    try {
      const nextPos = tabsRef.current.length + 1;
      const placeholder = String(nextPos);
      if (onDevice() && offlineWorkIdRef.current) {
        const defaults = inheritedDefaults();
        const created = deviceTabFrom(placeholder, {}, defaults);
        if (enteredBy) {
          logCalculatorCreated({
            userId: enteredBy,
            calculatorId: created.id,
            appointmentId: appointmentId || '',
            calculatorTitle: created.title,
            calculatorPosition: nextPos,
            leadId: leadId || undefined,
          }).catch(() => {});
          if (defaults.paymentMethod) {
            logPaymentMethodInherited({
              userId: enteredBy,
              calculatorId: created.id,
              appointmentId: appointmentId || '',
              calculatorTitle: created.title,
              fromCalculator: null,
              toCalculator: created.id,
              paymentMethod: defaults.paymentMethod,
              inheritanceSource: 'default payment method',
              ...(leadId ? { leadId } : {}),
            }).catch(() => {});
          }
        }
        return;
      }
      if (appointmentId) {
        const defaults = inheritedDefaults();
        const created = await createRemoteTab(appointmentId, placeholder, {}, leadId, enteredBy, schemasRef.current, nextPos, defaults);
        if (created) {
          if (!canAddCalculatorTab(tabsRef.current as any, activeTabId).allowed) {
            LeadService.deleteCalculator(created.id).catch(() => {});
            return;
          }
          lastSavedTitle.current[created.id] = created.title; // baseline for auto_rename
          const next = retitle([...tabsRef.current, created]);
          tabsRef.current = next;
          setTabs(next);
          setActiveTabId(created.id);
          cacheTabsSnapshotRef.current?.(next);
          if (enteredBy) {
            logCalculatorCreated({
              userId: enteredBy,
              calculatorId: (created as any).calculatorId || created.id,
              appointmentId: appointmentId,
              calculatorTitle: created.title,
              calculatorPosition: nextPos,
              leadId: leadId || undefined,
            }).catch(() => {});
            if (defaults.paymentMethod) {
              logPaymentMethodInherited({
                userId: enteredBy,
                calculatorId: (created as any).calculatorId || created.id,
                appointmentId: appointmentId,
                calculatorTitle: created.title,
                fromCalculator: null,
                toCalculator: (created as any).calculatorId || created.id,
                paymentMethod: defaults.paymentMethod,
                inheritanceSource: 'default payment method',
                ...(leadId ? { leadId } : {}),
              }).catch(() => {});
            }
          }
          return;
        }
      }
      const local: CalcTab = { id: `local-${Date.now()}`, title: placeholder, entries: buildAllEntriesMap(schemasRef.current), totals: { ...ZERO } };
      const next = retitle([...tabsRef.current, local]);
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(local.id);
    } finally {
      addingTabRef.current = false;
    }
  }, [activeTabId, tabs.length, appointmentId, leadId, enteredBy, retitle, inheritedDefaults, onDevice, deviceTabFrom]);

  const handleDuplicateTab = useCallback(
    async (tabId: string) => {
      if (!canDuplicateCalculatorTab(tabsRef.current as any, tabId).allowed) return;
      const source = tabsRef.current.find((t) => t.id === tabId);
      if (!source) return;
      const position = tabsRef.current.length + 1;
      const placeholder = String(position);
      const entries = mergeFullEntries(JSON.parse(JSON.stringify(source.entries)), schemasRef.current);
      const sourceBackendId = isBackendId(source.id) ? source.id : undefined;
      if (onDevice() && offlineWorkIdRef.current) {
        const copy = deviceTabFrom(placeholder, entries, {
          ...inheritedDefaults(),
          ...(source.totals ? { totals: JSON.parse(JSON.stringify(source.totals)) } : {}),
        });
        if (enteredBy) {
          // Online the server writes the `duplicate` log from `duplicateLog`; no request is made here.
          logEvent('duplicate', {
            user_id: enteredBy,
            created_by: enteredBy,
            module_type: 'calculator',
            meta: {
              ...(leadId ? { leadId } : {}),
              sourceCalculatorId: source.id,
              sourceCalculatorTitle: source.title,
              newCalculatorTitle: placeholder,
              calculatorId: copy.id,
              appointmentId,
              position,
              action: 'calculator_duplicated',
            },
          }).catch(() => {});
          const inherited = (source as any).paymentMethod || '';
          if (inherited) {
            logPaymentMethodInherited({
              userId: enteredBy,
              calculatorId: copy.id,
              appointmentId: appointmentId || '',
              calculatorTitle: placeholder,
              fromCalculator: source.id,
              toCalculator: copy.id,
              paymentMethod: inherited,
              inheritanceSource: 'calculator duplication',
              sourceCalculatorTitle: source.title,
              newCalculatorTitle: placeholder,
              ...(leadId ? { leadId } : {}),
            }).catch(() => {});
          }
        }
        return;
      }
      const duplicateLog =
        enteredBy && sourceBackendId
          ? {
              user_id: enteredBy,
              created_by: enteredBy,
              module_type: 'calculator',
              actionType: 'duplicate',
              meta: {
                ...(leadId ? { leadId } : {}),
                sourceCalculatorId: sourceBackendId,
                sourceCalculatorTitle: source.title,
                newCalculatorTitle: placeholder,
                appointmentId,
                position,
                action: 'calculator_duplicated',
              },
            }
          : undefined;
      if (appointmentId) {
        // OPTIMISTIC: the copy appears and is selected on the tap; the POST runs behind it and the real id is
        // swapped in when it lands. Awaiting the POST first made the rep stare at nothing for the round trip.
        const defaults = inheritedDefaults();
        const tempId = `local-${Date.now()}`;
        const temp: CalcTab = {
          id: tempId,
          title: placeholder,
          entries,
          totals: source.totals ? JSON.parse(JSON.stringify(source.totals)) : computeTotals(entries),
          paymentMethod: (source as any).paymentMethod ?? defaults.paymentMethod,
          discountPercentage: (source as any).discountPercentage ?? defaults.discountPercentage,
        };
        const withTemp = retitle([...tabsRef.current, temp]);
        tabsRef.current = withTemp;
        setTabs(withTemp);
        setActiveTabId(tempId);

        const created = await createRemoteTab(appointmentId, placeholder, entries, leadId, enteredBy, schemasRef.current, position, {
          ...defaults,
          ...(source.totals ? { totals: JSON.parse(JSON.stringify(source.totals)) } : {}),
          ...(sourceBackendId ? { originalCalculatorId: sourceBackendId } : {}),
          ...(duplicateLog ? { duplicateLog } : {}),
        });
        if (created) {
          const latest = tabsRef.current.find((t) => t.id === tempId);
          if (!latest) {
            // The rep deleted the copy before the server answered: do not leave an orphan row behind.
            LeadService.deleteCalculator(created.id).catch(() => {});
            return;
          }
          lastSavedTitle.current[created.id] = created.title; // baseline for auto_rename
          // Keep what is on screen (the rep may already have typed into the copy); take the server's identity.
          const merged: CalcTab = {
            ...created,
            ...latest,
            id: created.id,
            persisted: true,
            paymentMethod: latest.paymentMethod ?? created.paymentMethod,
            discountPercentage: latest.discountPercentage ?? created.discountPercentage,
          };
          const swapped = retitle(tabsRef.current.map((t) => (t.id === tempId ? merged : t)));
          tabsRef.current = swapped;
          setTabs(swapped);
          setActiveTabId((cur) => (cur === tempId ? created.id : cur));
          cacheTabsSnapshotRef.current?.(swapped);
          // Edits made while the POST was in flight were never sent (a `local-` tab is not saved): send them now.
          if (latest.entries !== temp.entries || latest.totals !== temp.totals) markDirty(created.id);
          const inheritedPaymentMethod = (source as any).paymentMethod || '';
          if (enteredBy && inheritedPaymentMethod) {
            logPaymentMethodInherited({
              userId: enteredBy,
              calculatorId: (created as any).calculatorId || created.id,
              appointmentId: appointmentId,
              calculatorTitle: placeholder,
              fromCalculator: sourceBackendId ?? null,
              toCalculator: (created as any).calculatorId || created.id,
              paymentMethod: inheritedPaymentMethod,
              inheritanceSource: 'calculator duplication',
              sourceCalculatorTitle: source.title,
              newCalculatorTitle: placeholder,
              ...(leadId ? { leadId } : {}),
            }).catch(() => {});
          }
        }
        // On failure the copy simply stays as the local-only tab the old fallback produced.
        return;
      }
      const local: CalcTab = { id: `local-${Date.now()}`, title: placeholder, entries, totals: source.totals ? JSON.parse(JSON.stringify(source.totals)) : computeTotals(entries) };
      const next = retitle([...tabsRef.current, local]);
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(local.id);
    },
    [tabs, appointmentId, leadId, enteredBy, retitle, inheritedDefaults, onDevice, deviceTabFrom, markDirty]
  );

  const handleDeleteTab = useCallback(
    (tabId: string) => {
      const target = tabs.find((t) => t.id === tabId);
      if (tabs.length <= 1) return;
      if (saveTimers.current[tabId]) clearTimeout(saveTimers.current[tabId]);
      delete saveTimers.current[tabId];
      delete dirty.current[tabId];
      delete needsFollowUp.current[tabId];
      if (target?.persisted && isBackendId(tabId)) {
        LeadService.deleteCalculator(tabId).catch(() => {});
      }
      setTabs((prev) => {
        const next = retitle(prev.filter((t) => t.id !== tabId));
        if (activeTabId === tabId) setActiveTabId(next[0]?.id || '');
        return next;
      });
      cacheTabsSnapshotRef.current?.(tabs.filter((t) => t.id !== tabId));
    },
    [tabs, activeTabId, retitle]
  );

  const handleRenameTab = useCallback(
    (tabId: string, name: string) => {
      setTabs((prev) => {
        const before = prev.find((t) => t.id === tabId);
        const updated = prev.map((t) => (t.id === tabId ? { ...t, manualTitle: name } : t));
        const retitled = retitle(updated);
        tabsRef.current = retitled;
        markDirty(tabId);
        if (enteredBy && before && before.title !== name) {
          logCalculatorRename({
            userId: enteredBy,
            calculatorId: (before as any).calculatorId || before.id,
            appointmentId: (before as any).appointmentId || '',
            previousCalculatorTitle: before.title,
            newCalculatorTitle: name,
          }).catch(() => {});
        }
        return retitled;
      });
    },
    [retitle, markDirty, enteredBy]
  );

  const handleReorderTabs = useCallback(
    (orderedIds: string[], activeId: string) => {
      setTabs((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t]));
        const next = orderedIds.map((id) => byId.get(id)).filter(Boolean) as CalcTab[];
        if (next.length !== prev.length) return prev;
        const positions = next
          .map((t, position) => ({ id: t.id, position }))
          .filter((p) => isBackendId(p.id));
        if (positions.length) {
          LeadService.reorderCalculators(positions).catch((e) =>
            console.warn('[DynamicCalculators] reorder persist failed:', e?.message || e),
          );
        }
        return retitle(next);
      });
      if (activeId) setActiveTabId(activeId);
    },
    [retitle]
  );

  const handleSetPaymentMethod = useCallback(
    (tabId: string, method: string) => {
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, paymentMethod: method } : t));
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
  );

  const handleSetDrops = useCallback(
    (tabId: string, drops: any[]) => {
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, dropPrice: drops } : t));
        tabsRef.current = next;
        return next;
      });
      saveDropsNowRef.current?.(tabId, drops);
    },
    []
  );

  const handleSetDiscount = useCallback(
    (tabId: string, discountPercentage: number) => {
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, discountPercentage } : t));
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
  );

  const handleSetDownPayment = useCallback(
    (tabId: string, downPayment: number) => {
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, downPayment } : t));
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
  );

  const handleSetRenders = useCallback(
    (tabId: string, renders: any[]) => {
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, selectedRenders: renders } : t));
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
  );

  const handleSetOneYearMonthly = useCallback(
    (tabId: string, plan: CalcTab['oneYearMonthlyPlan']) => {
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, oneYearMonthlyPlan: plan } : t));
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
  );

  const handleSetInHome = useCallback(
    (tabId: string, inHome: CalcTab['inHome']) => {
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, inHome } : t));
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
  );

  const handleSetPrice = useCallback(
    (tabId: string, price: number, pricemarkup?: string) => {
      setTabs((prev) => {
        const next = prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                price,
                priceScopeSig: price > 0 ? scopeSignature(t.entries) : '',
                ...(pricemarkup !== undefined && { pricemarkup }),
              }
            : t
        );
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
  );

  const handleAckScopeWarning = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.map((t) =>
          t.id === tabId ? { ...t, priceScopeSig: scopeSignature(t.entries) } : t
        );
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
  );

  const handleClearSection = useCallback(
    (categoryId: string, categoryLabel: string) => {
      let clearedTab: CalcTab | undefined;
      setTabs((prev) => {
        const updated = prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const entries = { ...t.entries };
          let changed = false;
          Object.keys(entries).forEach((fid) => {
            const e = entries[fid] as any;
            if (e?.categoryId === categoryId && Number(e.inputValue || 0) !== 0) {
              entries[fid] = { ...e, inputValue: 0, computed: { cost: 0, par: 0, retail: 0 } };
              changed = true;
            }
          });
          if (!changed) return t;
          return { ...t, entries, totals: computeTotals(entries) };
        });
        const retitled = retitle(updated);
        clearedTab = retitled.find((t) => t.id === activeTabId);
        tabsRef.current = retitled;
        return retitled;
      });
      if (clearedTab) {
        markDirty(clearedTab.id);
        if (enteredBy) {
          logSectionCleared({
            userId: enteredBy,
            calculatorId: (clearedTab as any).calculatorId || clearedTab.id,
            appointmentId: (clearedTab as any).appointmentId || appointmentId,
            calculatorTitle: clearedTab.title,
            fieldName: categoryLabel,
            fieldLabel: categoryLabel,
            fieldCategory: categoryNameOf(categoryId) || categoryLabel,
          }).catch(() => {});
        }
      }
    },
    [activeTabId, retitle, markDirty, enteredBy, appointmentId, categoryNameOf]
  );

  const handleConfirmRollouts = useCallback(
    (confirmed: Array<{ id: string; price: number; pricemarkup?: string }>) => {
      const priceById = new Map(confirmed.map((c) => [c.id, c.price]));
      const markupById = new Map(confirmed.map((c) => [c.id, c.pricemarkup]));
      setTabs((prev) => {
        const next = prev.map((t) => {
          if (!priceById.has(t.id)) return t;
          const endPrice = priceById.get(t.id) || 0;
          const pricemarkup = endPrice > 0 ? markupById.get(t.id) : undefined;
          return { ...t, isRolloutConfirmed: true, price: endPrice, pricemarkup, priceScopeSig: scopeSignature(t.entries) };
        });
        tabsRef.current = next;
        next.forEach((t) => {
          if (priceById.has(t.id)) markDirty(t.id);
        });
        return next;
      });
    },
    [markDirty]
  );

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    appointmentId,
    loading,
    offlineUnavailable,
    workFromDevice: () => setPreferDevice(true),
    isSaving,
    lastUpdated,
    handleEntryChange,
    handleClearSection,




    handleAddTab,
    handleDuplicateTab,
    handleDeleteTab,
    handleRenameTab,
    handleReorderTabs,
    handleConfirmRollouts,
    handleSetPaymentMethod,
    handleSetDrops,
    handleSetDiscount,
    handleSetDownPayment,
    handleSetRenders,
    handleSetOneYearMonthly,
    handleSetInHome,
    handleSetPrice,
    handleAckScopeWarning,
  };
}
