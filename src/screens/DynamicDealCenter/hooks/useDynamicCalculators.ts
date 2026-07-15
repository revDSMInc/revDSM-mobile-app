import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { LeadService } from '../../../services/api/leads';
import type { CalculatorEntry, CalculatorTotals, CalculatorSchema } from '../types/calculator';
import { computeDerivedTitles } from '../utils/tab-naming';
import { buildAllEntriesMap, mergeFullEntries } from '../utils/build-all-entries';
import { calculateMarkupLabel } from '../../../utils/activity-log/rollout-log-meta';

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
  /** a manual (session) rename — wins over the derived title */
  manualTitle?: string;
  /** Markup percentage string (e.g. "COST + 25%", "PAR") — web parity. */
  pricemarkup?: string;
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
  const dropSig = (tab.dropPrice || []).map((d: any) => d?.price ?? '').join(',');
  return `${entrySig}#${tab.title}#${tab.isRolloutConfirmed ? 1 : 0}#${tab.price ?? ''}#${tab.pricemarkup ?? ''}#${tab.paymentMethod ?? ''}#${dropSig}#${tab.downPayment ?? ''}#${tab.discountPercentage ?? ''}`;
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

  try {
    const res = await LeadService.getAppointments(leadDate ? { lead_date: leadDate } : undefined);
    const appts = res.data?.data || res.data || [];
    const found = (appts as any[]).find(
      (a) =>
        (a.leadId && a.leadId !== 'N/A' && String(a.leadId) === String(leadIdHuman)) ||
        (a.selfGenLeadId && a.selfGenLeadId !== 'N/A' && String(a.selfGenLeadId) === String(selfGenLeadId))
    );
    if (found) return String(found._id || found.id);

    // No appointment on this lead's date → create one (web parity).
    const createRes = await LeadService.createAppointment({
      title: customerTitleOf(lead),
      address: lead?.fullAddress || lead?.address || '',
      leadId: leadIdHuman,
      selfGenLeadId,
    });
    const created = createRes.data?.data || createRes.data;
    return created ? String(created._id || created.id) : null;
  } catch {
    return null;
  }
}

async function createRemoteTab(
  appointmentId: string,
  title: string,
  entries: Record<string, CalculatorEntry>,
  leadId: string | undefined,
  enteredBy: string | undefined,
  schemas: CalculatorSchema[],
  position: number
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
    };
  } catch {
    return null;
  }
}

export function useDynamicCalculators(lead: any, schemas: CalculatorSchema[] = []) {
  const { user } = useAuth();

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

  // Keep the latest schemas available to the (stable) retitle/save callbacks
  // without churning their identities.
  const schemasRef = useRef(schemas);
  schemasRef.current = schemas;
  const snapshotId = () => schemasRef.current?.[0]?.id || 'static';

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
      paymentMethod: tab.paymentMethod,
      dropPrice: tab.dropPrice || [],
      downPayment: tab.downPayment,
      discountPercentage: tab.discountPercentage,
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
      schemasRef.current || []
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

      try {
        await LeadService.updateCalculator(tabId, buildPayloadRef.current(tab));
        setLastUpdated(
          new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        );
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
    [scheduleSave]
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
              paymentMethod: c.paymentMethod || undefined,
              dropPrice: Array.isArray(c.dropPrice) ? c.dropPrice : [],
              downPayment: c.downPayment || 0,
              discountPercentage: Number(c.discountPercentage) || undefined,
              persisted: true,
            };
          });
          setTabs(retitle(hydrated));
          setActiveTabId(hydrated[0].id);
        } else {
          const created = await createRemoteTab(apptId, '1', {}, leadId, enteredBy, schemasRef.current, 1);
          if (cancelled) return;
          if (created) {
            setTabs(retitle([created]));
            setActiveTabId(created.id);
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
    const inFlight = saveInFlight.current;
    const dirtyMap = dirty.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
      tabsRef.current.forEach((tab) => {
        if (tab.persisted && isBackendId(tab.id) && dirtyMap[tab.id] && !inFlight[tab.id]) {
          LeadService.updateCalculator(tab.id, buildPayloadRef.current(tab)).catch(() => {});
        }
      });
    };
  }, []);

  const handleEntryChange = useCallback(
    (fieldId: string, entry: CalculatorEntry) => {
      setTabs((prev) => {
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
        }
        return retitled;
      });
    },
    [activeTabId, retitle, markDirty]
  );

  const handleAddTab = useCallback(async () => {
    const placeholder = String(tabs.length + 1);
    if (appointmentId) {
      const created = await createRemoteTab(appointmentId, placeholder, {}, leadId, enteredBy, schemasRef.current, tabs.length + 1);
      if (created) {
        setTabs((p) => retitle([...p, created]));
        setActiveTabId(created.id);
        return;
      }
    }
    const local: CalcTab = { id: `local-${Date.now()}`, title: placeholder, entries: buildAllEntriesMap(schemasRef.current), totals: { ...ZERO } };
    setTabs((p) => retitle([...p, local]));
    setActiveTabId(local.id);
  }, [tabs.length, appointmentId, leadId, enteredBy, retitle]);

  const handleDuplicateTab = useCallback(
    async (tabId: string) => {
      const source = tabs.find((t) => t.id === tabId);
      if (!source) return;
      const placeholder = String(tabs.length + 1);
      // Copy the source's full entries (back-filled from schema so nothing is lost).
      const entries = mergeFullEntries(JSON.parse(JSON.stringify(source.entries)), schemasRef.current);
      if (appointmentId) {
        const created = await createRemoteTab(appointmentId, placeholder, entries, leadId, enteredBy, schemasRef.current, tabs.length + 1);
        if (created) {
          setTabs((p) => retitle([...p, created]));
          setActiveTabId(created.id);
          return;
        }
      }
      const local: CalcTab = { id: `local-${Date.now()}`, title: placeholder, entries, totals: computeTotals(entries) };
      setTabs((p) => retitle([...p, local]));
      setActiveTabId(local.id);
    },
    [tabs, appointmentId, leadId, enteredBy, retitle]
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
        const updated = prev.map((t) => (t.id === tabId ? { ...t, manualTitle: name } : t));
        const retitled = retitle(updated);
        tabsRef.current = retitled;
        markDirty(tabId);
        return retitled;
      });
    },
    [retitle, markDirty]
  );

  const handleReorderTabs = useCallback(
    (orderedIds: string[], activeId: string) => {
      setTabs((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t]));
        const next = orderedIds.map((id) => byId.get(id)).filter(Boolean) as CalcTab[];
        return next.length === prev.length ? retitle(next) : prev;
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
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === tabId ? { ...t, dropPrice: drops } : t));
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

  const handleConfirmRollouts = useCallback(
    (confirmed: Array<{ id: string; price: number }>) => {
      const priceById = new Map(confirmed.map((c) => [c.id, c.price]));
      setTabs((prev) => {
        const next = prev.map((t) => {
          if (!priceById.has(t.id)) return t;
          const endPrice = priceById.get(t.id) || 0;
          // Web parity (ViewAllCalculators.calculateMarkup): compute the markup
          // string (e.g. "COST + 25%") using the raw schema totals as anchors.
          const cost = Math.round(t.totals?.cost || 0);
          const par = Math.round(t.totals?.par || 0);
          const retail = Math.round(t.totals?.retail || 0);
          const pricemarkup = endPrice > 0 ? calculateMarkupLabel(endPrice, cost, par, retail) : undefined;
          return { ...t, isRolloutConfirmed: true, price: endPrice, pricemarkup };
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
  };
}
