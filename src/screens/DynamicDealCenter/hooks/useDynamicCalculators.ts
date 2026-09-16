import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { LeadService } from '../../../services/api/leads';
import type { CalculatorEntry, CalculatorTotals, CalculatorSchema } from '../types/calculator';
import { computeDerivedTitles } from '../utils/tab-naming';
import { computeTitleSaveOrder, getUniquePersistableTitles, TEMP_TITLE_PREFIX } from '../utils/title-save-order';
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

/**
 * Persistence hook for the Dynamic Deal Center calculators — the schema-driven
 * counterpart of the web `DealCenterContext` (`src/sections/deal-center/context/`).
 *
 * Mirrors the web save model 1:1:
 *   - list  : GET    /appointments/{appointmentId}/lfcalculators
 *   - create: POST   /appointments/{appointmentId}/lfcalculators   (no meaningful
 *             name — a numeric placeholder; the real name is derived from values)
 *   - save  : PUT    /lfcalculators/{id}   { entries, totals, ... }  (debounced)
 *   - delete: DELETE /lfcalculators/{id}
 *
 * The debounced save engine copies web's `flushSave`/`scheduleDebouncedSave`
 * semantics (see `DealCenterContext.js`), which the previous mobile version was
 * missing — these are the behaviors the web app relies on so a value entered in a
 * field is reliably persisted:
 *   1. `SAVE_DEBOUNCE_MS = 1500` (same as web, was 800 on mobile).
 *   2. In-flight guard + follow-up: never two overlapping PUTs for one calculator;
 *      if edits land while a save is in flight, a follow-up save is rescheduled
 *      after it resolves (prevents out-of-order / dropped saves on slow networks).
 *   3. Latest-state read: the flush reads the CURRENT tab from a ref (like web's
 *      `entriesRef.current`) instead of a stale closure snapshot.
 *   4. Unmount flush: any dirty persisted calculator is saved immediately when the
 *      screen unmounts, so a value typed and then quickly navigated away from is
 *      NOT lost (web does this in its provider cleanup).
 *   5. Payload matches web's `buildSavePayload`
 *      (`{ entries, totals, schemaSnapshotId, leadId, enteredBy, enteredAt }`),
 *      plus the mobile-only `title`/`isRolloutConfirmed`/`price` the mobile flow
 *      needs (web saves the title separately via its auto-rename effect).
 *
 * Entries are keyed by field id; on save they are serialized as `Object.values`
 * (an array) exactly like web. The calculator TITLE is derived live from the
 * entered values (`computeDerivedTitles`) — a manual rename overrides it. If no
 * appointment can be resolved the hook falls back to a purely local (unsaved)
 * calculator so the flow still works.
 */

export interface CalcTab {
  /** backend `_id` once persisted, else a `local-*` id */
  id: string;
  /** derived display title (from values) or manual override */
  title: string;
  entries: Record<string, CalculatorEntry>;
  totals: CalculatorTotals;
  isRolloutConfirmed?: boolean;
  price?: number;
  resultType?: 'sale' | 'demo';
  /** selected payment plan key (e.g. `mcVisaDscvr`) — drives the monthly payment. */
  paymentMethod?: string;
  /** negotiation drop prices persisted with the calc (`[{ price, downPayment? }]`). */
  dropPrice?: any[];
  /** down payment on the rollout price (subtracted before the monthly payment). */
  downPayment?: number;
  /** pre-order discount % (15/20/25) driving the In-Home Pre-Order grand total. */
  discountPercentage?: number;
  /**
   * RevRender before/after pairs the rep associated with THIS calculator's job
   * build (web parity: `lfcalculator.selectedRenders`). Each item keeps
   * `{ runId, originalUrl, generatedUrl, s3UrlOriginal, s3UrlGenerated, bucketName,
   * viewLabel, category, subcategory }` so the Investment Center can re-resolve
   * secure links and show them under the job scope.
   */
  selectedRenders?: any[];
  /**
   * The 1-Year Program monthly-payment selection (web parity:
   * `lfcalculator.oneYearMonthlyPlan`). `mode` is how the plan is chosen:
   * `match` mirrors the In-Home selected plan, `default` uses the 1-Year default
   * financing plan, `custom` pins an explicit `planKey`. The rest are the resolved
   * values persisted for the Investment Center to display without recomputing.
   */
  oneYearMonthlyPlan?: {
    mode: 'match' | 'default' | 'custom';
    planKey?: string;
    apr?: number;
    monthlyPayment?: number;
    grandTotal?: number;
    isDefault?: boolean;
  } | null;
  /**
   * The In-Home Pre-Order "Monthly" shortlist the rep builds in the Investment
   * Center (persisted as `lfcalculator.inHome`): the financing plans added for the
   * customer to compare (`addedPlans`) and which one is selected (`planKey`), plus
   * the resolved values so the read side can show them without recomputing. Persisted
   * on the next debounced save; hydrated back on reopen so the shortlist survives.
   */
  inHome?: {
    planKey?: string;
    addedPlans?: string[];
    apr?: number;
    monthlyPayment?: number;
    grandTotal?: number;
    /** Which program card the rep opted into in the Investment Center ('inhome' or
     *  'oneyear'), so the panel survives tab switches without losing the selection. */
    optInProgram?: 'inhome' | 'oneyear' | null;
  } | null;
  /**
   * Backend-computed job-scope sentences for this calculator (web/backend parity:
   * `lfcalculator.descriptions`) — e.g. `["Install Soffit", "Installation: Install
   * J Channel …"]`. Read-only display data: the backend derives it from the agreement
   * description schemas, so mobile never sends it in a save (web doesn't either). The
   * Investment Center's "Includes the Following" list uses it verbatim (footages/colors
   * stripped) instead of re-deriving the scope locally.
   */
  descriptions?: string[];
  /** a manual (session) rename — wins over the derived title */
  manualTitle?: string;
  /** Markup percentage string (e.g. "COST + 25%", "PAR") — web parity. */
  pricemarkup?: string;
  /**
   * Job-scope fingerprint (`scopeSignature`) captured when the Rollout End Price was
   * entered/confirmed. If the calculator's scope later changes, the live signature no
   * longer matches this, so the rollout shows the "Job Scope was changed" warning —
   * the entered price is kept, never cleared. Dismissing the warning re-snapshots this
   * to the current scope. Empty when no price has been entered.
   */
  priceScopeSig?: string;
  /** true when `id` is a real backend id (so it can be saved/deleted remotely) */
  persisted?: boolean;
}

/** Matches web `SAVE_DEBOUNCE_MS` in `DealCenterContext.js`. */
const SAVE_DEBOUNCE_MS = 1500;
const ZERO: CalculatorTotals = { cost: 0, par: 0, retail: 0 };

const isBackendId = (id?: string) => !!id && /^[a-f0-9]{24}$/i.test(id);

/**
 * Rebuild a tab from the body stored on the device.
 *
 * ⚠️ The stored payload IS the body its `PUT /lfcalculators/{id}` would have sent, so this is the
 * exact inverse of `buildPayload`. Keeping the two in step is what lets one record serve both the
 * screen the rep is looking at and the upload that files it later.
 */
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

/**
 * Rebuild a tab from a calculator row as the SERVER returns it.
 *
 * ⚠️ Hoisted out of the bootstrap because the OFFLINE hydrate reads the same rows out of the
 * device snapshot. Two copies of this mapping would mean a lead's quote could look one way at a
 * door and another way with signal, from the same bytes.
 */
function tabFromServerCalculator(c: any, schemas: CalculatorSchema[]): CalcTab {
  // Back-fill the full schema field list so untouched fields are present
  // and every subsequent save PUTs the complete entries array (web parity).
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
    // The server's rows VERBATIM (web parity: its rollout lists `dropPrice`
    // 1:1). Only the single-accepted repair runs, because it rewrites a status
    // rather than removing a row — anything that collapsed rows here would
    // make local state a subset of the server's, and the next save would then
    // omit rows the rep can no longer see.
    dropPrice: normalizeSingleAcceptedDrop(c?.dropPrice),
    downPayment: c?.downPayment || 0,
    discountPercentage: Number(c?.discountPercentage) || undefined,
    selectedRenders: Array.isArray(c?.selectedRenders) ? c.selectedRenders : [],
    oneYearMonthlyPlan: c?.oneYearMonthlyPlan || null,
    inHome: c?.inHome ?? c?.in_home ?? null,
    // Backend-computed job-scope sentences — surfaced verbatim in the
    // Investment Center "Includes the Following" list (read-only, never re-sent).
    descriptions: Array.isArray(c?.descriptions) ? c.descriptions : [],
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

/**
 * Stable signature of the persisted surface of a tab — mirrors web's
 * `entriesSignature`, extended with the mobile-only title/rollout/price fields.
 * Used to tell whether newer edits landed while a save was in flight.
 */
function tabSignature(tab: CalcTab): string {
  const entrySig = Object.entries(tab.entries || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, e]) => `${id}:${e?.inputValue ?? ''}`)
    .join('|');
  // ⚠️ Drops are NOT fingerprinted here. They no longer ride the debounced save at all
  // (`saveDropsNow` PUTs `{ dropPrice }` on the rep's action), so including them would
  // mark the calculator dirty and fire a second, redundant whole-calculator request for
  // a change that has already been persisted.
  // Selected renders: a stable key of the chosen run ids so add/remove marks dirty.
  const renderSig = (tab.selectedRenders || [])
    .map((r: any) => r?.runId || r?._id || r?.generatedUrl || '')
    .join('|');
  // 1-Year monthly plan: mode + resolved plan key + default flag.
  const oy = tab.oneYearMonthlyPlan;
  const oneYearSig = oy ? `${oy.mode ?? ''}:${oy.planKey ?? ''}:${oy.isDefault ? 1 : 0}` : '';
  // In-Home Monthly shortlist: selected plan + the added-plan list.
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

/**
 * The customer's own name, or `''`. Web's `customerTitle`
 * (`job-capture-images-view.js`) verbatim: first + last, trimmed, no fallback —
 * it titles BOTH the appointment and the first calculator with this.
 *
 * Kept separate from `customerTitleOf` below because a fallback that is fine on an
 * appointment ("Lead") would become a calculator's NAME, and the rep would read it
 * as one. Callers decide what an unnamed lead gets.
 */
function customerNameOf(lead: any): string {
  const cd = lead?.customerDetails || {};
  return `${cd.firstName || lead?.firstName || ''} ${cd.lastName || lead?.lastName || ''}`.trim();
}

/** Best-effort customer display name for a new appointment (web `customerTitle`). */
function customerTitleOf(lead: any): string {
  return customerNameOf(lead) || lead?.customerName || lead?.name || lead?.title || 'Lead';
}

/**
 * Resolve the appointment for this lead exactly like web's "Dynamic Deal Center"
 * tool handler (`job-capture-images-view.js`):
 *   1. use `lead.appointmentId` if already carried in;
 *   2. else `GET /appointments?lead_date={leadDate}` and match by human `leadId`
 *      or `selfGenLeadId`;
 *   3. else **create** a new appointment `{ title, address, leadId, selfGenLeadId }`.
 * Returns the appointment id (or null only if everything fails → local mode).
 */
async function resolveAppointmentId(lead: any): Promise<string | null> {
  const direct = lead?.appointmentId;
  if (direct) return String(direct);

  const leadIdHuman = lead?.leadId; // human-readable id (e.g. "504")
  const selfGenLeadId = lead?._id || lead?.selfGenLeadId || lead?.id;
  const leadDate = lead?.leadDate || lead?.lead_date;
  if (!leadIdHuman && !selfGenLeadId) return null;

  // Step 1: try to find an existing appointment for this lead on its date. A failure
  // here (network / date filter) is non-fatal — we fall through to create, which
  // itself surfaces an already-existing appointment via 409 (Step 2).
  try {
    const res = await LeadService.getAppointments(leadDate ? { lead_date: leadDate } : undefined);
    const appts = res.data?.data || res.data || [];
    const found = (appts as any[]).find(
      (a) =>
        (a.leadId && a.leadId !== 'N/A' && String(a.leadId) === String(leadIdHuman)) ||
        (a.selfGenLeadId && a.selfGenLeadId !== 'N/A' && String(a.selfGenLeadId) === String(selfGenLeadId))
    );
    if (found) return String(found._id || found.id);
  } catch {
    // ignore — proceed to create
  }

  // Step 2: create one (web parity). If the backend already has an appointment for
  // this lead it responds 409 "This lead already has an appointment" and returns the
  // existing `appointmentId` — adopt it instead of failing. This is the key fix: the
  // lead_date-filtered GET above can MISS the existing appointment (it may sit under a
  // different date — e.g. a UTC/local off-by-one on `lead_date`), so without honoring
  // the 409 the flow would keep trying to create and drop into local mode.
  try {
    const createRes = await LeadService.createAppointment({
      title: customerTitleOf(lead),
      address: lead?.fullAddress || lead?.address || '',
      leadId: leadIdHuman,
      selfGenLeadId,
    });
    const created = createRes.data?.data || createRes.data;
    return created ? String(created._id || created.id) : null;
  } catch (createErr: any) {
    // The axios interceptor rejects with the response BODY, so a 409 arrives as
    // `{ code: 409, message, data: { appointmentId } }`. Cover the full-error shape too.
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
    if (is409 && existingId) return String(existingId);
    return null;
  }
}

/** Inherited defaults / lineage seeded onto a new or duplicated calculator (web parity). */
interface CreateExtra {
  /** user.defaultPercentage (web `addTab` seeds this when set). */
  discountPercentage?: number;
  /** Lowe's → lowes_ach, else user.defaultPaymentMethod (web addTab). */
  paymentMethod?: string;
  paymentMethodLabel?: string;
  /** Duplicate lineage — the source calculator's backend id (web `handleDuplicateSubmit`). */
  originalCalculatorId?: string;
  /**
   * Web parity (tab-action-utils.js:196-206): the `calculator_duplicated` activity
   * log is handed to the create POST so the BACKEND writes it with the NEW
   * calculator's id as entityId — attributing it to the right tab. Firing a
   * separate client logEvent (with only meta.calculatorId, no entityId) lands it
   * in a stray group, which is exactly why web moved it into the create body.
   */
  duplicateLog?: any;
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
    // Web parity: a new calculator is seeded with the FULL flattened field list
    // across every vertical (untouched → inputValue 0), so every save PUTs the
    // complete entries array (see `buildAllEntriesFromSchema`).
    const seeded = mergeFullEntries(entries, schemas);
    const totals = computeTotals(seeded);
    const res = await LeadService.createCalculator(appointmentId, {
      title,
      position,
      entries: Object.values(seeded),
      totals,
      schemaSnapshotId: schemas?.[0]?.id || 'static',
      leadId,
      enteredBy,
      enteredAt: new Date().toISOString(),
      // Web parity (tab-action-utils.js:48-60 / 166-188): inherited rep defaults +
      // duplicate lineage. Only sent when present so we don't clobber with blanks.
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
      // Re-seed from schema in case the API echoes back a sparse entries array.
      entries: c.entries ? mergeFullEntries(parseEntries(c.entries), schemas) : seeded,
      totals: c.totals || totals,
      persisted: true,
      paymentMethod: extra.paymentMethod || c.paymentMethod,
      discountPercentage: extra.discountPercentage ?? c.discountPercentage,
    };
  } catch {
    return null;
  }
}

interface UseDynamicCalculatorsOptions {
  /**
   * Fire the web-parity `calculator viewed` (module `calculator`) log when a tab
   * first becomes active. Defaults to `true` for the Deal Center. The Investment
   * Center passes `false`: it logs its OWN presentation view under the
   * `investment_center` module (`logInvestmentCalculatorViewed`), and while its
   * consent gate is up nothing should be logged but "consent portal opened".
   */
  logCalculatorView?: boolean;
}

export function useDynamicCalculators(
  lead: any,
  schemas: CalculatorSchema[] = [],
  options: UseDynamicCalculatorsOptions = {},
) {
  const { logCalculatorView = true } = options;
  const { user } = useAuth();

  // Web parity (tab-action-utils.js:48-60): a newly-created/duplicated calculator
  // inherits the rep's default discount % and payment method (Lowe's → lowes_ach).
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
  /**
   * Opened with no signal, on a lead whose quote this device has never seen.
   *
   * ⚠️ A distinct state from "no calculators", and the screen must say so rather than showing an
   * empty form. Anything the rep enters here would become a RIVAL calculator beside the ones the
   * server is holding — which is what happened before the snapshot existed.
   */
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  // Per-tab save bookkeeping — mirrors web's per-provider refs but keyed by tab id
  // so several calculators can save independently without racing each other.
  const saveTimers = useRef<Record<string, any>>({});
  const saveInFlight = useRef<Record<string, boolean>>({});
  const needsFollowUp = useRef<Record<string, boolean>>({});
  const dirty = useRef<Record<string, boolean>>({});
  // Last title actually PERSISTED for each calculator. A save that writes a title
  // different from this fires `calculator_auto_renamed` (web parity — the calc name
  // is derived from the entries, so it changes as the rep edits). Seeded at hydrate/
  // create so the FIRST save can already detect a load→edit rename.
  const lastSavedTitle = useRef<Record<string, string>>({});
  // Calculators already logged as `calculator viewed` this session — web fires that
  // view event ONCE per calculator (DealCenterContext `loggedViewCalculatorIds`),
  // not on every tab switch.
  const loggedViewIds = useRef<Set<string>>(new Set());
  // Bootstrap (appointment/calculator creation) must run once per lead — this
  // guards against the hydrate effect re-entering and creating duplicates.
  const bootstrapLeadRef = useRef<string | null>(null);

  // Always-current tabs snapshot so the debounced flush reads the LATEST state
  // (web reads `entriesRef.current`, not a stale closure value).
  // ── Offline: the device record this Deal Center session writes into ────────
  // `null` while online — every write below then takes its normal remote path.
  const offlineWorkIdRef = useRef<string | null>(null);
  /**
   * Is THIS session writing to the device rather than to the server?
   *
   * ⚠️ Separate from `offlineWorkIdRef`, which is now set on every path so that a connection
   * dropping mid-quote has somewhere to write. Without the second flag, opening the Deal Center
   * online would mirror the whole session to the device on unmount and leave a permanent
   * "1 lead not yet on the server" banner over a rep who never went offline.
   */
  const offlineModeRef = useRef(false);
  const apptClientIdRef = useRef<string | null>(null);
  const apptPayloadRef = useRef<Record<string, unknown> | null>(null);
  /**
   * The appointment's REAL id, when this lead already has one.
   *
   * ⚠️ Written into the offline record, and that is what stops a duplicate. `isStepApplicable`
   * skips the `appointment` create only when `serverIds.appointmentId` is set — without it a lead
   * hydrated from the snapshot would POST a SECOND appointment on the next drain and hang the
   * rep's calculators off it.
   */
  const apptServerIdRef = useRef<string | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistOfflineRef = useRef<((list?: CalcTab[]) => void) | null>(null);

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const leadId = lead?._id || lead?.leadId || lead?.id;
  const enteredBy = user?._id || user?.id || '';

  // Web parity (DealCenterContext view effect): fire `calculator viewed` ONCE per
  // calculator, when it first becomes the active tab. Only persisted (backend)
  // calculators are logged — a placeholder local tab has no real calculatorId yet.
  useEffect(() => {
    if (!logCalculatorView || !enteredBy || !activeTabId) return;
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active) return;
    const calcId = (active as any).calculatorId || active.id;
    if (!isBackendId(active.id) || loggedViewIds.current.has(calcId)) return;
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

  // Keep the latest schemas available to the (stable) retitle/save callbacks
  // without churning their identities.
  const schemasRef = useRef(schemas);
  schemasRef.current = schemas;
  const snapshotId = () => schemasRef.current?.[0]?.id || 'static';

  // Resolve a field's category id to its human name (web parity: DealCenterContext
  // logs `fieldCategory: category.name`, not the raw id). The portal groups
  // calculator field logs by this value into section headers ("Soffit", "LeafFilter",
  // …); shipping the raw id made those logs group under an unrecognizable header, so
  // they appeared missing/cut on the timeline.
  const categoryNameOf = useCallback((categoryId?: string): string => {
    if (!categoryId) return '';
    for (const s of schemasRef.current || []) {
      for (const c of s.categories || []) {
        if (c.id === categoryId) return c.name || c.label || categoryId;
      }
    }
    return categoryId;
  }, []);

  // The title we may SAFELY persist for a calculator (web `DealCenterContext.resolveTitle`).
  // The backend enforces a unique title per appointment, so a shared "⚠️" duplicate-price
  // title (which `computeDerivedTitles` produces when two calcs match on name AND price)
  // must NOT be written — we keep the last-saved title until the calc earns a distinct
  // SM/MD/LG size. Reads only refs, so it is stable ([] deps).
  const resolveSafeTitle = useCallback((tab: CalcTab): string => {
    const derived = computeDerivedTitles(
      tabsRef.current.map((t) => ({ id: t.id, entries: t.entries, price: t.totals?.retail || 0, manualTitle: t.manualTitle, storedTitle: t.title })),
      schemasRef.current || [],
    );
    const persistable = getUniquePersistableTitles(derived);
    return persistable[tab.id] || lastSavedTitle.current[tab.id] || tab.title || '1';
  }, []);

  // Latest payload builder in a ref so the unmount flush (a [] effect) always
  // uses current leadId/enteredBy/schema instead of the mount-time closure.
  const buildPayload = useCallback(
    (tab: CalcTab) => ({
      // Never PUT a colliding/shared title (unique-title 409); see resolveSafeTitle.
      title: resolveSafeTitle(tab),
      entries: Object.values(tab.entries),
      totals: tab.totals,
      isRolloutConfirmed: tab.isRolloutConfirmed,
      price: tab.price,
      pricemarkup: tab.pricemarkup,
      // Job-scope fingerprint the entered price was priced against (drives the
      // rollout "review the end price" warning). Persisted so the warning survives
      // reload, never the price being auto-cleared.
      priceScopeSig: tab.priceScopeSig ?? '',
      paymentMethod: tab.paymentMethod,
      // ⚠️ `dropPrice` is deliberately ABSENT. Drops are written by `saveDropsNow` as
    // their own `{ dropPrice: [...] }` request the moment the rep Declines or Secures —
    // web's shape exactly — so this debounced whole-calculator save must not carry them
    // as a passenger. One writer, one payload.
      downPayment: tab.downPayment,
      discountPercentage: tab.discountPercentage,
      // Web parity: the renders bound to this job build + the 1-Year monthly plan
      // selection both persist on the calculator so the Investment Center reads them.
      selectedRenders: tab.selectedRenders || [],
      oneYearMonthlyPlan: tab.oneYearMonthlyPlan ?? null,
      // Investment Center In-Home Monthly shortlist (added plans + selection).
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

  // Recompute every tab's derived title from its live entries + configured schemas.
  // Manual renames win; an empty calculator keeps its STORED title (the customer's
  // name on the first one, a numeric placeholder on the rest) and only then falls
  // back to its position — so this pass can no longer rename the first tab to "1".
  const retitle = useCallback((list: CalcTab[]): CalcTab[] => {
    const titles = computeDerivedTitles(
      list.map((t) => ({ id: t.id, entries: t.entries, price: t.totals?.retail || 0, manualTitle: t.manualTitle, storedTitle: t.title })),
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
    // Return the SAME reference when nothing changed so `setTabs` can bail out
    // (prevents a re-render loop when `schemas` is a fresh array each render).
    return changed ? next : list;
  }, []);

  /**
   * Keep a copy of what the SERVER holds for this lead, so the Deal Center can open with no signal.
   *
   * ⚠️ This is not the same thing as `persistOffline` below, and the difference is the whole
   * point. That one records work the server has NOT got and arms an upload; this one records work
   * the server HAS, and arms nothing. Confusing the two would announce every lead the rep merely
   * looked at as pending, and re-PUT state that was already filed.
   *
   * Without it the offline bootstrap had no idea a lead had ever been quoted, so it minted an empty
   * calculator — which the drain then filed as an EXTRA one beside the rep's real tabs.
   */
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

  /**
   * The same snapshot, built from the tabs on screen rather than from a fresh read.
   *
   * ⚠️ Only calculators with a real backend id. A tab that has not been created yet is not
   * something the server holds, and writing it here would let the offline bootstrap hydrate it as
   * though it were — losing the very `serverId` that decides POST vs PUT on the next drain.
   */
  const cacheTabsSnapshot = useCallback(
    (list: CalcTab[], apptId?: string | null) => {
      cacheDealCenterSnapshot(
        list
          .filter((t) => isBackendId(t.id))
          .map((t) => ({
            ...buildPayloadRef.current(t),
            _id: t.id,
            // `buildPayload` omits drops (they have their own writer online); the snapshot is a
            // picture of the calculator, so it carries them.
            dropPrice: t.dropPrice || [],
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

  /**
   * Write the whole Deal Center to the device.
   *
   * Stores each tab under exactly the body its PUT would have carried, so the uploader replays the
   * session as ~one request per calculator rather than one per edit.
   */
  const persistOffline = useCallback((explicit?: CalcTab[]) => {
    const workId = offlineWorkIdRef.current;
    if (!workId) return;
    // ⚠️ Only a session that is actually working offline mirrors itself here. Online, every tab is
    // already on the server and writing them again would arm an upload of state the server holds —
    // announcing the lead as pending, and re-PUTting it on the next reconnect for nothing.
    if (!offlineModeRef.current && isOnline()) return;
    // ⚠️ `tabsRef` is synced by an effect, so it still holds the PREVIOUS list during the render
    // that seeds the tabs. The bootstrap therefore passes its list in rather than reading the ref.
    const calculators: OfflineCalculatorWork[] = (explicit || tabsRef.current).map((t) => ({
      clientId: t.id,
      serverId: isBackendId(t.id) ? t.id : undefined,
      payload: {
        ...buildPayloadRef.current(t),
        // ⚠️ Added back deliberately. `buildPayload` omits `dropPrice` because online it has its
        // own writer (`saveDropsNow`) — offline there is no second writer, so leaving it out would
        // silently drop every negotiation round the rep walked the customer through.
        dropPrice: t.dropPrice || [],
      },
    }));
    saveOfflineDealCenter(workId, {
      appointment: apptPayloadRef.current || undefined,
      appointmentClientId: apptClientIdRef.current || undefined,
      appointmentServerId: apptServerIdRef.current || undefined,
      calculators,
    });
    // ⚠️ Signal can come back while the rep is still on this screen, and this session stays on the
    // device (one writer). Without a kick the edit waited for the 60 s sweep or the next reconnect
    // edge — which, with the rep already online, never comes. `runUpload` is a no-op offline and
    // while a drain is running (that drain picks the record up on its own).
    if (isOnline()) runUpload();
  }, []);
  persistOfflineRef.current = persistOffline;

  // ── Debounced save engine (ports web DealCenterContext.flushSave) ───────────
  const flushSaveRef = useRef<((tabId: string) => void) | null>(null);

  const scheduleSave = useCallback((tabId: string) => {
    // Offline, or a calculator with no server id yet: the state goes to the DEVICE on the same
    // debounce and is uploaded later. One timer for the whole store, not one per tab — the record
    // holds every calculator, so a per-tab timer would just rewrite the same blob N times.
    // ⚠️ ONE writer per session. Once this session belongs to the device it stays there, even if
    // signal returns mid-quote: the drain is what puts the work on the server, and letting a direct
    // PUT race it would have the two disagreeing about which state is current.
    if (offlineModeRef.current || !isBackendId(tabId) || !isOnline()) {
      // From here on this session belongs to the device. The rep may have started online and lost
      // signal mid-quote — that is the case that used to persist NOTHING, because the record was
      // only ever wired up by the offline bootstrap branch.
      offlineModeRef.current = true;
      if (offlineWorkIdRef.current) {
        if (offlineTimer.current) clearTimeout(offlineTimer.current);
        offlineTimer.current = setTimeout(() => persistOfflineRef.current?.(), SAVE_DEBOUNCE_MS);
      }
      return;
    }
    if (saveTimers.current[tabId]) clearTimeout(saveTimers.current[tabId]);
    saveTimers.current[tabId] = setTimeout(() => flushSaveRef.current?.(tabId), SAVE_DEBOUNCE_MS);
  }, []);

  // Per-calculator guard for the fallback read in `adoptDropIds` below: the signature of
  // the id-less drops a GET has already been spent on.
  const dropIdFetchTried = useRef<Record<string, string>>({});
  // One drop request per calculator at a time; a newer list queued while one is in
  // flight supersedes it (every request sends the WHOLE array, so latest wins).
  const dropSaveInFlight = useRef<Record<string, boolean>>({});
  const dropSavePending = useRef<Record<string, any[] | null>>({});
  const saveDropsNowRef = useRef<((tabId: string, drops: any[], attempt?: number) => void) | null>(null);

  /**
   * Take the `_id` the server assigned to each newly-filed drop back into local state.
   *
   * Without this the next PUT re-sends that round id-less and the backend files ANOTHER
   * copy — the duplicate-drop bug. Deliberately NOT marked dirty: `_id` is absent from
   * `tabSignature`'s `dropSig`, so adopting cannot mark the tab dirty, schedule a save,
   * or make an in-flight save look superseded.
   *
   * The CLASSIC deal center already does both halves of this (`useCalculatorSummary.
   * saveDropPriceToServer` back-fills missing ids before its PUT and re-reads
   * `serverCalc.dropPrice` after it); only the dynamic flow never did, which is why the
   * duplicate is dynamic-only.
   */
  const adoptDropIds = useCallback(async (tabId: string, response: any) => {
    let serverDrops = readServerDrops(response);
    if (!serverDrops.length) {
      // The PUT response does not always echo the calculator back — the classic flow hits
      // the same case and re-reads. Bounded by `dropIdFetchTried`: one GET per distinct
      // set of id-less rows, so a response that NEVER carries `dropPrice` cannot turn
      // every debounced save into an extra request.
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

  /**
   * `PUT /lfcalculators/{id}` with ONLY `{ dropPrice }` — web's payload for this action.
   *
   * Fires on the rep's Decline / Secure, never on opening the drop sheet. Sends the whole
   * array every time (each row with its `_id`), so a request that fails is healed by the
   * next drop action rather than needing per-row bookkeeping; one immediate retry covers
   * the transient case.
   */
  const saveDropsNow = useCallback(
    async (tabId: string, drops: any[], attempt = 0) => {
      // Offline, or a calculator with no server id yet: drops are already on the tab, so write the
      // whole record to the device. ⚠️ IMMEDIATELY, not on the debounce — a drop is a deliberate
      // Secure/Decline, and `handleSetDrops` does not `markDirty`, so nothing else would ever
      // persist it. `tabsRef` is updated synchronously by that handler, so this sees the new list.
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
        if (attempt === 0) dropSavePending.current[tabId] = drops; // one retry
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

  // Web parity (DealCenterContext.saveDisplacedSiblings). When the changed calc's derived
  // title shifts (its SM/MD/LG size), a SIBLING may still hold that title in the DB, so
  // saving the changed calc first would collide (backend unique-title → 409). Re-title the
  // displaced siblings FIRST, in the collision-free order from `computeTitleSaveOrder`
  // (temp-title swap breaks A↔B cycles), so the changed calc's own PUT never conflicts.
  // Failures here are non-fatal — a sibling rename must not block the changed calc's save.
  const saveDisplacedSiblings = useCallback(async (changedTabId: string) => {
    const all = tabsRef.current;
    if (all.length <= 1) return;

    const derived = computeDerivedTitles(
      all.map((t) => ({ id: t.id, entries: t.entries, price: t.totals?.retail || 0, manualTitle: t.manualTitle, storedTitle: t.title })),
      schemasRef.current || [],
    );
    const persistable = getUniquePersistableTitles(derived);
    const order = computeTitleSaveOrder({
      allCalcs: all.map((t) => ({ id: t.id, dbTitle: lastSavedTitle.current[t.id] ?? t.title })),
      changedCalcId: changedTabId,
      newTitles: derived,
    });

    // The LAST step is the changed calc itself (flushSave saves it next); re-title only
    // the displaced siblings here.
    const displaced = order.slice(0, -1);
    for (const step of displaced) {
      const st = all.find((t) => t.id === step.calculatorId);
      if (!st || !st.persisted || !isBackendId(st.id)) continue;
      const isTemp = step.newTitle.startsWith(TEMP_TITLE_PREFIX);
      // Only write a REAL title that is unique (web parity); temp-title steps always run.
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
        // non-fatal — a sibling rename must not block the changed calc's own save
      }
    }
  }, [enteredBy, appointmentId, leadId, adoptDropIds]);

  const flushSave = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || !tab.persisted || !isBackendId(tab.id)) return;
      if (!dirty.current[tabId]) return; // nothing new to save

      // Never run two overlapping saves for the same calculator; flag a follow-up.
      if (saveInFlight.current[tabId]) {
        needsFollowUp.current[tabId] = true;
        return;
      }

      const sig = tabSignature(tab);
      saveInFlight.current[tabId] = true;
      setIsSaving(true);

      // The title we will actually persist (unique-safe; may keep the last-saved title
      // when the derived one is a shared "⚠️"). Used below for the auto-rename log and the
      // lastSavedTitle bookkeeping so both reflect what really went to the server.
      const savedTitle = resolveSafeTitle(tab);
      try {
        // Free up any sibling still holding this calc's new title before we save it.
        await saveDisplacedSiblings(tabId);
        const res = await LeadService.updateCalculator(tabId, buildPayloadRef.current(tab));
        // Adopt the ids the server just assigned, so the NEXT save updates these rows
        // instead of filing second copies of them.
        adoptDropIds(tabId, res);
        // The snapshot follows what actually landed, so a rep who quotes online and then walks out
        // of signal re-opens on their real figures rather than on the state at screen-open.
        // ⚠️ After the PUT resolves, never before it — a cache written on a save that failed
        // would hand the door a quote the server does not have.
        cacheTabsSnapshotRef.current?.(tabsRef.current);
        setLastUpdated(
          new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        );
        // Web parity (DealCenterContext.flushSave): when this save changed the
        // calculator's persisted title, log an auto-rename against its own id.
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
        // Only mark clean if nothing changed since we snapshotted this save.
        const latest = tabsRef.current.find((t) => t.id === tabId);
        if (latest && tabSignature(latest) === sig) dirty.current[tabId] = false;
      } catch {
        // keep dirty; the next edit / unmount will retry the save
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

  /** Mark a tab dirty and (re)schedule its debounced save. */
  const markDirty = useCallback(
    (tabId: string) => {
      dirty.current[tabId] = true;
      scheduleSave(tabId);
    },
    [scheduleSave]
  );

  // ── Hydrate: resolve appointment → load saved calculators ──────────────────
  useEffect(() => {
    const key = String(leadId || 'none');
    if (bootstrapLeadRef.current === key) return; // already bootstrapped this lead
    bootstrapLeadRef.current = key;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // ── Which copy of this Deal Center is the rep shown? ─────────────────────
      //
      // ⚠️ THE RECORD IS RESOLVED ON EVERY PATH, and that is the fix for "I did my whole quote and
      // came back and it was all gone". It used to be resolved only when `isOnline()` was false at
      // that instant, which loses a rep's work in two ordinary field situations:
      //
      //   1. They built the quote with no signal, walked back in with a bar of it, and re-opened
      //      the Deal Center. The bootstrap took the ONLINE path, read the server — which has
      //      nothing, because the queue has not drained — and painted an empty calculator over a
      //      finished quote. (On a lead created at the door it was worse still: `resolveAppointmentId`
      //      would POST a NEW appointment against a lead id the server has never seen, then create
      //      a fresh empty calculator in it.)
      //   2. They started online and lost signal mid-quote. `offlineWorkIdRef` was null, so
      //      `scheduleSave`'s offline branch had nowhere to write and persisted NOTHING at all.
      //
      // So: the device record always exists while this screen is open, and the DEVICE wins whenever
      // it holds calculator work the server has not got. It cannot be stale by definition — it IS
      // the writes that have not arrived yet.
      const work = ensureOfflineWorkForLead(lead);
      if (work) offlineWorkIdRef.current = work.clientId;

      // ⚠️ `isClientId` is as disqualifying as no signal. A lead created at a door is addressed by
      // an id this device minted, so every request the online path makes is either a 404 or — for
      // `POST /appointments` — an ORPHAN appointment filed against a lead that does not exist, which
      // the queue then duplicates when the lead lands. Same rule the agreement dialog already uses.
      const deviceIsAuthoritative =
        !isOnline() || isClientId(String(leadId || '')) || hasUnsyncedDealCenter(work);

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

          // What the server held the last time this lead's Deal Center was open with signal.
          const cacheName = dealCenterCacheName(leadId);
          const cached = cacheName
            ? readOfflineCache<CachedDealCenter>(cacheName, { userId: enteredBy || undefined })?.data
              || null
            : null;

          // ⚠️ The appointment's real id comes from the snapshot when the record has not got one.
          // Skipping this files a SECOND appointment on the next drain — `isStepApplicable` only
          // skips the create when `serverIds.appointmentId` is set.
          apptServerIdRef.current = work.serverIds.appointmentId || cached?.appointmentId || null;
          // An appointment already resolved online keeps its real id; otherwise the client one
          // stands in until the upload creates it.
          setAppointmentId(apptServerIdRef.current || apptClientId);

          const stored = work.calculators || [];
          const source = resolveOfflineDealCenterSource({
            storedCalculators: stored.length,
            cached,
            // Nothing the server could be holding — it has never heard of this lead.
            leadCreatedOffline:
              work.origin === 'created-offline' || isClientId(String(leadId || '')),
            storedDrained: !hasUnsyncedDealCenter(work),
          });

          // ⚠️ `'unavailable'` is NOT the same as "no calculators", and treating it as one is the
          // bug this branch was reported for. A lead quoted online and then opened at a door showed
          // a blank Deal Center — the rep's tabs were on the server, unread — and the empty
          // calculator minted in their place was POSTed as an EXTRA one when the queue drained.
          // With no snapshot we do not know what is out there, so we show nothing and say why.
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
                // ⚠️ The SAME mapping the online path runs, so the quote reads identically at a
                // door. Each tab keeps its real `_id`, which is what makes an edit here a PUT to
                // the rep's own calculator rather than a second one filed beside it.
                ? cachedCalculatorsOf(cached).map((c) =>
                    tabFromServerCalculator(c, schemasRef.current)
                  )
                : [
                    (() => {
                      // Web parity: a new calculator is seeded with the FULL field list across every
                      // vertical, so the eventual create sends the same entries array it would online.
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
          setTabs(hydrated);
          setActiveTabId(hydrated[0].id);
          setLoading(false);
          // ⚠️ Seeded ONLY when this device is the one holding the work. A hydrate from the
          // snapshot is a picture of what the server already has; writing it into the record would
          // announce an untouched lead as pending and re-PUT it on the next reconnect for nothing.
          // The rep's first edit arms it through `scheduleSave`, which is the correct moment.
          if (source !== 'cache') persistOfflineRef.current?.(hydrated);
          return;
        }
        // No record could be opened (a lead with no id at all). Offline there is nothing else to
        // try, so stop here rather than spending three doomed requests on the way to an empty
        // screen. Online we fall through and read the server as before.
        if (!isOnline()) {
          setTabs([]);
          setLoading(false);
          return;
        }
        offlineModeRef.current = false;
      }

      const apptId = await resolveAppointmentId(lead);
      if (cancelled) return;
      setAppointmentId(apptId);
      // ⚠️ Recorded even though this is the ONLINE path: the rep may lose signal mid-quote, and
      // from that moment `persistOffline` is what files the session. Without the real id the record
      // would carry only a client one and the drain would create a duplicate appointment.
      apptServerIdRef.current = apptId;

      if (!apptId) {
        setLoading(false); // local-only mode
        return;
      }

      try {
        const res = await LeadService.getCalculators(apptId);
        const list = res.data?.data || res.data || [];
        if (cancelled) return;

        if (Array.isArray(list) && list.length) {
          // Keep the server's own rows, so this lead's Deal Center opens at a door with the quote
          // the rep actually built instead of a blank one. Written from the RAW response rather
          // than from the tabs, so it is the truest picture available.
          cacheDealCenterSnapshotRef.current?.(list, apptId);
          const hydrated: CalcTab[] = list.map((c: any) =>
            tabFromServerCalculator(c, schemasRef.current)
          );
          // Baseline the persisted titles so an auto-rename after the first edit
          // is detected against the loaded name, not a lazily-set one.
          hydrated.forEach((t) => { lastSavedTitle.current[t.id] = t.title; });
          setTabs(retitle(hydrated));
          setActiveTabId(hydrated[0].id);
        } else {
          // The FIRST calculator is titled with the CUSTOMER, not a placeholder —
          // web parity: `job-capture-images-view.js` POSTs `{ title: customerTitle,
          // price: 0 }` for it, and only the `+` button (`tab-action-utils.addTab`)
          // uses `String(length + 1)`. That stored title is what names the tab, and
          // what every calculator activity log (created / viewed) then carries;
          // mobile created it as `'1'`, so the portal logged `calculatorTitle: "1"`.
          // An unnamed lead keeps the numeric placeholder — a blank tab beats a
          // wrong name, and `/^\d+$/` still hides it from the rollout until built.
          const created = await createRemoteTab(
            apptId, customerNameOf(lead) || '1', {}, leadId, enteredBy, schemasRef.current, 1
          );
          if (cancelled) return;
          if (created) {
            lastSavedTitle.current[created.id] = created.title;
            setTabs(retitle([created]));
            setActiveTabId(created.id);
            // ⚠️ Snapshot it immediately. Without this the cache would say the server holds
            // NOTHING for this lead, and the next offline open would mint a second first
            // calculator on the strength of that.
            cacheTabsSnapshotRef.current?.([created], apptId);
            // Web parity (tab-action-utils.js first-calc create): the auto-created
            // FIRST calculator logs `isFirstCalculator: true` / "Created new
            // calculator tab" (no calculatorPosition). Previously the mobile bootstrap
            // created it silently, so the portal never saw its create event.
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
        // keep the local fallback tab
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // When the schemas arrive/change, back-fill each tab with the full field seed
  // (so a calculator hydrated BEFORE the real schema loaded still has every
  // field present and its saved values line up with the schema's field ids) and
  // refresh derived titles. Saved `inputValue`s are preserved — the seed only
  // fills fields the tab is missing.
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

  // ── Unmount: clear timers AND flush any dirty persisted calculator ─────────
  // Mirrors web's provider cleanup so a value typed then quickly navigated away
  // from is still persisted (the debounce may not have fired yet).
  useEffect(() => {
    const timers = saveTimers.current;
    const dirtyMap = dirty.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
      // The offline debounce may not have fired either — same reasoning as the PUT below, and it
      // matters more here: there is no reconnect that would retry a write that never happened.
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      persistOfflineRef.current?.();
      // Fire a FINAL PUT for every dirty calculator with the latest state — even if a
      // save is in flight. On unmount there's no follow-up mechanism left, so skipping
      // an in-flight calc (as before) could drop a just-confirmed price when the rep
      // navigates away; sending the latest state last makes it the winning write.
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
          // Web parity (DealCenterContext.js:218-234): log the field change. Only
          // when the value actually changed, so re-renders don't spam events.
          const e = entry as any;
          if (enteredBy && (oldEntry?.inputValue ?? '') !== (e?.inputValue ?? '')) {
            logCalculatorFieldEntry({
              userId: enteredBy,
              calculatorId: (active as any).calculatorId || active.id,
              appointmentId: (active as any).appointmentId,
              calculatorTitle: active.title,
              // Web parity (DealCenterContext): suffix the label with the field's story
              // ("6\" Micro Mesh 1st Story") so a Story-2 entry doesn't collide with /
              // overwrite the Story-1 log (both stories reuse the same field label).
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

  const handleAddTab = useCallback(async () => {
    const placeholder = String(tabs.length + 1);
    if (appointmentId) {
      const defaults = inheritedDefaults();
      const created = await createRemoteTab(appointmentId, placeholder, {}, leadId, enteredBy, schemasRef.current, tabs.length + 1, defaults);
      if (created) {
        lastSavedTitle.current[created.id] = created.title; // baseline for auto_rename
        setTabs((p) => retitle([...p, created]));
        setActiveTabId(created.id);
        cacheTabsSnapshotRef.current?.([...tabsRef.current, created]);
        // Web parity (tab-action-utils.js:62): calculator_created activity event.
        if (enteredBy) {
          logCalculatorCreated({
            userId: enteredBy,
            calculatorId: (created as any).calculatorId || created.id,
            appointmentId: appointmentId,
            calculatorTitle: created.title,
            calculatorPosition: tabs.length + 1,
            leadId: leadId || undefined,
          }).catch(() => {});
          // Web parity (tab-action-utils.js:75-91): a new calculator that inherits
          // the rep's DEFAULT payment method logs that inheritance.
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
    setTabs((p) => retitle([...p, local]));
    setActiveTabId(local.id);
  }, [tabs.length, appointmentId, leadId, enteredBy, retitle, inheritedDefaults]);

  const handleDuplicateTab = useCallback(
    async (tabId: string) => {
      const source = tabs.find((t) => t.id === tabId);
      if (!source) return;
      const placeholder = String(tabs.length + 1);
      // Copy the source's full entries (back-filled from schema so nothing is lost).
      const entries = mergeFullEntries(JSON.parse(JSON.stringify(source.entries)), schemasRef.current);
      const position = tabs.length + 1;
      const sourceBackendId = isBackendId(source.id) ? source.id : undefined;
      // Web parity (tab-action-utils.js:196-206): hand the `calculator_duplicated`
      // log to the create POST so the backend attributes it to the NEW calculator.
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
        const created = await createRemoteTab(appointmentId, placeholder, entries, leadId, enteredBy, schemasRef.current, position, {
          ...inheritedDefaults(),
          // Web parity (tab-action-utils.js:166-188): carry the duplicate lineage.
          ...(sourceBackendId ? { originalCalculatorId: sourceBackendId } : {}),
          ...(duplicateLog ? { duplicateLog } : {}),
        });
        if (created) {
          lastSavedTitle.current[created.id] = created.title; // baseline for auto_rename
          setTabs((p) => retitle([...p, created]));
          setActiveTabId(created.id);
          // Web parity (tab-action-utils.js:225-244): if the SOURCE carried a
          // payment method, the duplicate inherits it — log that inheritance.
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
          return;
        }
      }
      const local: CalcTab = { id: `local-${Date.now()}`, title: placeholder, entries, totals: computeTotals(entries) };
      setTabs((p) => retitle([...p, local]));
      setActiveTabId(local.id);
    },
    [tabs, appointmentId, leadId, enteredBy, retitle, inheritedDefaults]
  );

  const handleDeleteTab = useCallback(
    (tabId: string) => {
      const target = tabs.find((t) => t.id === tabId);
      if (tabs.length <= 1) return;
      // Cancel any pending save for the removed tab and drop its bookkeeping.
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
      // ⚠️ Or the door would still offer a calculator that no longer exists, and an edit to it
      // would PUT to a deleted id on the next drain.
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
        // Web parity (tab-action-utils.js:126): calculator_rename activity event.
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
        // Web parity (tab-action-utils.js:282 updateLfCalculatorPositions): persist
        // the new order as [{ id, position }] for the backend calculators. Previously
        // reorder was local-only, so a reload lost the order.
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

  /** Set a calculator's payment plan (persisted on the next debounced save). */
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

  /**
   * Replace a calculator's drop-price list and PERSIST IT NOW, as its own request.
   *
   * ⚠️ Drops do NOT go through the debounced whole-calculator save. Two reasons, both
   * from the ticket: the rep's Decline / Secure is a decision that must not sit in a
   * 1.5 s debounce behind an unrelated field edit, and the payload has to be web's
   * `{ dropPrice: [...] }` rather than the entire calculator. `markDirty` is therefore
   * NOT called — `tabSignature` no longer fingerprints drops, so a whole-calculator save
   * would add nothing but a second request.
   *
   * Stored as given: `+ Nth Drop` is its own negotiation round even at a price the rep
   * already tried, and re-opening a row via Display edits that row in place
   * (`resolveDropTargetIndex`), so the list is already one row per round.
   */
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

  /** Set the pre-order discount % (persisted on the next debounced save). */
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

  /** Set the rollout down payment (persisted on the next debounced save). */
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

  /**
   * Replace the RevRender pairs bound to this calculator's job build (web parity:
   * `selectedRenders`). Persisted on the next debounced save; the Investment Center
   * reads them back to show before/after images under the job scope.
   */
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

  /** Set the 1-Year Program monthly-payment selection (persisted on next save). */
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

  /**
   * Set the In-Home Monthly shortlist (added plans + selection) from the Investment
   * Center. Persisted as `in_home` on the next debounced save (web keeps this local;
   * mobile persists it so the shortlist survives reopen). A no-op merge with the same
   * value leaves the signature unchanged, so it won't trigger a redundant save.
   */
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

  /**
   * Persist the entered Rollout End Price on the calculator (debounced save), and
   * snapshot the job scope it was priced against so a later calculator edit can
   * surface the "review the end price" warning. Previously the typed price lived only
   * in the rollout view's local state and was LOST when the rep went back to the
   * calculator — this keeps it (spec: never delete the user's entered end prices).
   * A price of 0 clears the snapshot (nothing to warn about).
   */
  const handleSetPrice = useCallback(
    (tabId: string, price: number, pricemarkup?: string) => {
      setTabs((prev) => {
        const next = prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                price,
                priceScopeSig: price > 0 ? scopeSignature(t.entries) : '',
                // Web parity (handleBlurPrice persists `pricemarkup` alongside `price`):
                // keep the stored markup in step with the entered end price, not only at
                // confirm. Only overwrite when the caller computed one (blur), so a
                // per-keystroke price commit doesn't blank it.
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

  /**
   * Dismiss the "Job Scope was changed" warning for a calculator by re-baselining its
   * scope snapshot to the CURRENT scope — the rep has reviewed the price and is
   * satisfied. The warning reappears only if the scope changes again. The end price is
   * untouched.
   */
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

  /**
   * Clear every field of one category on the active calculator in a single pass,
   * firing ONE `section cleared` activity event — web parity (lf-calculator-view.js
   * category Clear → `action:'section cleared'`). Zeroing here rather than looping
   * `handleEntryChange` avoids emitting N `calculator field changed` events for a
   * single clear (web logs only the one `section cleared`).
   */
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
          // Markup label ("COST + 25%") is computed by RolloutView, which has the
          // pricing config + payment plans to anchor on the fee-adjusted, $200-floored
          // tiers shown on the card (web `calculateMarkup`). The old inline recompute
          // used the raw stored `totals`, whose blank par/cost tiers (retail-only
          // schema) came through as 0 → the markup snapped to the wrong tier.
          const pricemarkup = endPrice > 0 ? markupById.get(t.id) : undefined;
          // Re-baseline the scope snapshot to the confirmed scope, so a calc confirmed
          // via auto-confirm (which never went through handleSetPrice) still warns if
          // its scope later changes.
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
