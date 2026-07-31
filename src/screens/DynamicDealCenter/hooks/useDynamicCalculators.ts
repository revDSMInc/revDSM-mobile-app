import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { LeadService } from '../../../services/api/leads';
import type { CalculatorEntry, CalculatorTotals, CalculatorSchema } from '../types/calculator';
import { computeDerivedTitles } from '../utils/tab-naming';
import { buildAllEntriesMap, mergeFullEntries } from '../utils/build-all-entries';
import { normalizeSingleAcceptedDrop, dedupeDrops, collapseDropsByPrice } from '../utils/drop-prices';
import { scopeSignature } from '../utils/scope-signature';
import { logCalculatorFieldEntry, logCalculatorCreated, logCalculatorRename, logPaymentMethodInherited, logSectionCleared, logCalculatorAutoRenamed, logCalculatorViewed } from '../../../utils/activity-log/calculator-log';
import { buildFieldLogLabel, findFieldStoryLabel } from '../utils/story-log-label';

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
  // Every PERSISTED field of a drop must be in the signature, not just its price.
  // With price alone, securing/unselecting an EXISTING drop changed no prices, so a
  // status-only edit that landed while a save was in flight looked identical to the
  // snapshot: `flushSave` cleared `dirty` (line ~354) and computed `hasNewerEdits`
  // false (line ~362), so no follow-up was scheduled and the demotion was NEVER PUT.
  // The server kept the older accepted drop alongside the new one — two SECURED rows
  // on reopen. Adding a genuinely-new drop changed `dropSig` and so always converged,
  // which is exactly why the bug looked intermittent.
  const dropSig = (tab.dropPrice || [])
    .map(
      (d: any) =>
        `${d?.price ?? ''}:${d?.status ?? ''}:${d?.downPayment ?? ''}:${d?.balance ?? ''}:${d?.paymentMethod ?? ''}:${Array.isArray(d?.paymentMethods) ? d.paymentMethods.join('|') : ''}`
    )
    .join(',');
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
  return `${entrySig}#${tab.title}#${tab.isRolloutConfirmed ? 1 : 0}#${tab.price ?? ''}#${tab.pricemarkup ?? ''}#${tab.paymentMethod ?? ''}#${dropSig}#${tab.downPayment ?? ''}#${tab.discountPercentage ?? ''}#${renderSig}#${oneYearSig}#${inHomeSig}#${tab.priceScopeSig ?? ''}`;
}

function parseEntries(arr: any): Record<string, CalculatorEntry> {
  const map: Record<string, CalculatorEntry> = {};
  (Array.isArray(arr) ? arr : []).forEach((e: any) => {
    const id = e?.fieldId || e?.id;
    if (id) map[id] = { ...e, inputValue: Number(e.inputValue) || 0 };
  });
  return map;
}

/** Best-effort customer display name for a new appointment (web `customerTitle`). */
function customerTitleOf(lead: any): string {
  const cd = lead?.customerDetails || {};
  const full = `${cd.firstName || lead?.firstName || ''} ${cd.lastName || lead?.lastName || ''}`.trim();
  return full || lead?.customerName || lead?.name || lead?.title || 'Lead';
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

export function useDynamicCalculators(lead: any, schemas: CalculatorSchema[] = []) {
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
    if (!enteredBy || !activeTabId) return;
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
  }, [activeTabId, tabs, enteredBy]);

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

  // Latest payload builder in a ref so the unmount flush (a [] effect) always
  // uses current leadId/enteredBy/schema instead of the mount-time closure.
  const buildPayload = useCallback(
    (tab: CalcTab) => ({
      title: tab.title,
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
      // Web parity (`ViewAllCalculators.js:1116-1123`): normalize to at most one
    // accepted drop at SAVE time, so no path can ever persist two SECURED rows.
    // `collapseDropsByPrice` additionally guarantees at most one row PER PRICE, so a
    // declined twin + its accepted version (or a backend-re-created no-`_id` copy) can
    // never be persisted as two rows.
    dropPrice: normalizeSingleAcceptedDrop(collapseDropsByPrice(dedupeDrops(tab.dropPrice))),
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
    [leadId, enteredBy]
  );
  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;

  const anyInFlight = () => Object.values(saveInFlight.current).some(Boolean);

  // Recompute every tab's derived title from its live entries + configured
  // schemas. Manual renames win; empty calculators fall back to their position.
  const retitle = useCallback((list: CalcTab[]): CalcTab[] => {
    const titles = computeDerivedTitles(
      list.map((t) => ({ id: t.id, entries: t.entries, price: t.totals?.retail || 0, manualTitle: t.manualTitle })),
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

  // ── Debounced save engine (ports web DealCenterContext.flushSave) ───────────
  const flushSaveRef = useRef<((tabId: string) => void) | null>(null);

  const scheduleSave = useCallback((tabId: string) => {
    if (!isBackendId(tabId)) return; // local-only tabs are never saved remotely
    if (saveTimers.current[tabId]) clearTimeout(saveTimers.current[tabId]);
    saveTimers.current[tabId] = setTimeout(() => flushSaveRef.current?.(tabId), SAVE_DEBOUNCE_MS);
  }, []);

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

      const savedTitle = tab.title;
      try {
        await LeadService.updateCalculator(tabId, buildPayloadRef.current(tab));
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
    [scheduleSave, enteredBy, appointmentId, leadId]
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
      const apptId = await resolveAppointmentId(lead);
      if (cancelled) return;
      setAppointmentId(apptId);

      if (!apptId) {
        setLoading(false); // local-only mode
        return;
      }

      try {
        const res = await LeadService.getCalculators(apptId);
        const list = res.data?.data || res.data || [];
        if (cancelled) return;

        if (Array.isArray(list) && list.length) {
          const hydrated: CalcTab[] = list.map((c: any) => {
            // Back-fill the full schema field list so untouched fields are present
            // and every subsequent save PUTs the complete entries array (web parity).
            const entries = mergeFullEntries(parseEntries(c.entries), schemasRef.current);
            return {
              id: String(c._id || c.id),
              title: c.title || '1',
              entries,
              totals: c.totals || computeTotals(entries),
              isRolloutConfirmed: c.isRolloutConfirmed,
              price: c.price,
              priceScopeSig: c.priceScopeSig || '',
              paymentMethod: c.paymentMethod || undefined,
              // Repair records already corrupted by the pre-fix save race, which
              // otherwise render two SECURED rows on every reopen forever.
              // `collapseDropsByPrice` also heals records the backend accumulated into
              // two rows at the same price (declined twin + accepted, or a no-`_id`
              // re-created copy) so a reopened calculator shows each price once.
              dropPrice: normalizeSingleAcceptedDrop(collapseDropsByPrice(dedupeDrops(c.dropPrice))),
              downPayment: c.downPayment || 0,
              discountPercentage: Number(c.discountPercentage) || undefined,
              selectedRenders: Array.isArray(c.selectedRenders) ? c.selectedRenders : [],
              oneYearMonthlyPlan: c.oneYearMonthlyPlan || null,
              inHome: c.inHome ?? c.in_home ?? null,
              // Backend-computed job-scope sentences — surfaced verbatim in the
              // Investment Center "Includes the Following" list (read-only, never re-sent).
              descriptions: Array.isArray(c.descriptions) ? c.descriptions : [],
              persisted: true,
            };
          });
          // Baseline the persisted titles so an auto-rename after the first edit
          // is detected against the loaded name, not a lazily-set one.
          hydrated.forEach((t) => { lastSavedTitle.current[t.id] = t.title; });
          setTabs(retitle(hydrated));
          setActiveTabId(hydrated[0].id);
        } else {
          const created = await createRemoteTab(apptId, '1', {}, leadId, enteredBy, schemasRef.current, 1);
          if (cancelled) return;
          if (created) {
            lastSavedTitle.current[created.id] = created.title;
            setTabs(retitle([created]));
            setActiveTabId(created.id);
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

  /** Replace a calculator's drop-price list (persisted on the next debounced save). */
  const handleSetDrops = useCallback(
    (tabId: string, drops: any[]) => {
      // Collapse to one row per price on EVERY update so the live list never shows a
      // price twice — the declined twin `openDrop` persists on entry merges with its
      // accepted version on Secure, and any same-price re-add is absorbed.
      const collapsed = collapseDropsByPrice(drops);
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, dropPrice: collapsed } : t));
        tabsRef.current = next;
        markDirty(tabId);
        return next;
      });
    },
    [markDirty]
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
