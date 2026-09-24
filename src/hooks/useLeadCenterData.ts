import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { applyOfflineResult, isClientId } from '../utils/offline-lead-work';
import { getOfflineWork, subscribeOfflineWork } from '../services/offlineLeadStore';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, readOfflineCache, writeOfflineCache } from '../utils/offline-query-cache';
import { leadDetailForCache } from '../utils/offline-lead-detail-cache';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { resolveS3Url } from '../utils/s3-utils';
import { ENV } from '../config/env';
import { IMAGE_CATEGORIES } from '../constants/lead-center';
import { logLeadSessionEnter, persistActiveLeadId } from '../utils/lead-activity-log';
import { beginLeadWorkSession, clearLeadWorkSession } from '../utils/lead-work-session';

// Frozen module-level singletons so the hook's return identity is stable across
// renders — these are only ever read as fallbacks, never written.
const EMPTY_OUTCOME_FORM = Object.freeze({});
const EMPTY_CALCULATOR_DATA = Object.freeze({});

/**
 * Has `GET demo/v1/leads/sales-portal/:id` been found missing on this API host?
 *
 * The detail endpoint ships with the sales-portal optimization
 * (SALES-PORTAL-API-OPTIMIZATION.md), so an environment running an older build answers
 * with the server's HTML "no such route" page. Module scope, not a ref: the answer is a
 * property of the BACKEND, identical for every lead and every mount, so learning it once
 * should spare every later screen the dead round trip.
 *
 * Deliberately NOT persisted — it resets on app restart, so pointing the app at a
 * freshly-deployed API (or flipping `ENV.API_URL`) picks the endpoint straight back up
 * without anyone having to clear anything.
 */
let salesPortalDetailUnavailable = false;

/**
 * True when a rejection means "this ROUTE does not exist", as opposed to "this LEAD does
 * not exist".
 *
 * Both are 404s. The discriminator is the body: the API answers a real miss with JSON
 * (`{ code: 404, message: 'Lead not found', data: {} }`), while an unrouted path falls
 * through to the server's default HTML error page. `normalizeApiError` attaches `body`
 * only when the payload was NOT json, so a `body` that opens with `<` is the tell.
 */
const isRouteMissing = (err: any): boolean =>
  err?.httpStatus === 404 && typeof err?.body === 'string' && err.body.trim().startsWith('<');

/** Per-lead snapshot name. Scoped by rep inside the envelope, by lead id here. */
const detailCacheKey = (leadId: string) => `${OFFLINE_CACHE.LEAD_DETAIL}:${leadId}`;

/**
 * Keep this lead for the next open with no signal.
 *
 * ⚠️ Always through `leadDetailForCache`, never raw. A sales-portal lead embeds its documents
 * as base64, and MMKV rewrites its whole store on every write — so one document-heavy lead cached
 * verbatim would tax every unrelated write in the app. `null` means "too big to keep", and the
 * right response is to keep nothing: the screen then hydrates over the network exactly as it did
 * before this cache existed.
 */
const cacheLeadDetail = (leadId: string, record: any, userId?: string) => {
  const slim = leadDetailForCache(record);
  if (slim) writeOfflineCache(detailCacheKey(leadId), slim, userId);
};

export const useLeadCenterData = (
  initialLead: any,
  user: any,
  options?: { appointmentStarted?: boolean; fromMyDeals?: boolean }
) => {
  const queryClient = useQueryClient();
  const [lead, setLead] = useState<any>(initialLead);

  // Sync state if navigation params change (e.g. on back navigation with updated lead)
  useEffect(() => {
    if (initialLead) {
      setLead(initialLead);
    }
  }, [initialLead]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // The lead id currently being hydrated, so the open-hydrate and the focus refresh
  // cannot fire two identical requests. A ref, not state: it must be readable and
  // writable synchronously inside `refetch`, before any re-render.
  const hydrateInFlightRef = useRef<string | null>(null);
  // Kept as empty defaults, not state: nothing writes them since the mount-time
  // outcome fetch was removed (see the effect below). The two Job Builder launch
  // paths that consume them now read the real values off their own outcome response
  // and only fall back to these.
  const outcomeForm: any = EMPTY_OUTCOME_FORM;
  const calculatorData: any = EMPTY_CALCULATOR_DATA;
  const [isOutcomeLoading, setIsOutcomeLoading] = useState(true);
  const [jobState, setJobState] = useState<any>({
    gutter: {
      partial: '',
      gutterColorsMulti: [],
      downspoutsMulti: [],
      extrasColors: { groundSpout: 'Black' },
    },
    leaffilter: {
      combinations: [],
      extras: { csr: 0, cornersFilter: 0, sawzallHanger: 0, removeProtection: 0, ribbedRoof: 0 },
    },
    soffit: { vinyl: { type: '' }, porch: { location: [] }, nailer: { type: '' } },
    fascia: { wrap: { type: '' }, boards: { boardType: '' }, aluminumBoards: { footage: '' } },
    additional: { extraLabor: 0 },
    scheduleTime: null,
  });

  /**
   * Load the FULL lead for this screen — and it is a load, not just a refresh.
   *
   * The list this screen is opened from now returns SLIM rows (`view=summary`), which
   * carry `salesPhotos: []` and no `jobBuilder` at all. Everything below and downstream
   * reads those — the photo sections, the inspection capture, the chat composer, the
   * contract card — so without this call the Lead Center opens empty. That is why the
   * hydrate effect below runs it on open rather than leaving it to a pull-to-refresh.
   *
   * ⚠️ It fetches ONE lead by id (`…/sales-portal/:id`). It used to request the LIST
   * with `?leadId=` and `.find()` the row — that pattern is now actively wrong: the
   * server IGNORES `leadId` on the list query string, so it would download every lead
   * the rep has to pick one out client-side.
   */
  const refetch = useCallback(async () => {
    if (!user?._id || !lead?._id) return;
    // ⚠️ A lead the rep created with no signal has no server record to hydrate FROM — its id is one
    // this device minted, so the request is `…/sales-portal/work-1773…`, which 404s. The local
    // record IS the truth until the uploader files it, so leave `lead` exactly as it was handed in.
    // ⚠️ Tested on the ID ALONE, never on the lead object. This callback deliberately closes over
    // `lead._id` and not `lead` (see the note on its dependency list) — reading another field here
    // puts `lead` in the deps and re-runs the hydrate on every hydrate.
    if (isClientId(lead._id)) return;

    // Offline: there is no request to make, but there may well be a copy of this lead from the
    // last time it was opened with signal — and without it the screen renders the SLIM summary row
    // the list handed it, which carries `salesPhotos: []` and no `jobBuilder`. That is the "no data
    // inside the lead" QA reported after killing the app: the lead opens, and everything in it is
    // missing. Merged the same way a live response is, so the two paths cannot diverge.
    if (!isOnline()) {
      const saved = readOfflineCache<any>(detailCacheKey(lead._id), { userId: user._id })?.data;
      if (saved) {
        setLead((prev: any) => ({
          ...prev,
          ...saved,
          generatedReports: saved.generatedReports || prev?.generatedReports || [],
        }));
      }
      return;
    }
    // Collapse the open-hydrate and the focus refresh into a single request when they
    // land together on mount, and stop a fast re-focus from stacking calls.
    if (hydrateInFlightRef.current === lead._id) return;
    hydrateInFlightRef.current = lead._id;
    try {
      setIsRefreshing(true);

      let full: any = null;
      if (!salesPortalDetailUnavailable) {
        try {
          const res = await LeadService.getSalesPortalLeadById(lead._id);
          full = res.data?.data?.lead || res.data?.lead;
        } catch (detailErr: any) {
          // A 404 here has TWO very different meanings and they must not be conflated:
          //
          //  - JSON body (`{ code: 404, message: 'Lead not found' }`) — the documented
          //    response when the signed-in rep is neither `assignedRepId` nor
          //    `assignedShadowRepId`. Real, per-lead, and the fallback below covers it.
          //  - HTML body (`<!DOCTYPE html>…<title>Error</title>`) — the server's default
          //    "no such route" page, i.e. the endpoint is NOT DEPLOYED on this API host.
          //    `normalizeApiError` only sets `body` for a non-JSON payload, so its
          //    presence is what tells the two apart.
          //
          // For the undeployed case, latch it off for the rest of the session: retrying
          // a route that does not exist costs one dead request per lead open AND per
          // focus, and the fallback below already produces a usable lead.
          if (isRouteMissing(detailErr)) {
            salesPortalDetailUnavailable = true;
            if (__DEV__) {
              console.warn(
                '[LeadCenter] sales-portal detail endpoint not deployed on this API — ' +
                  'falling back to workLead for the rest of the session.'
              );
            }
          } else if (detailErr?.httpStatus !== 404) {
            // Anything that is not a 404 (500, timeout, offline) is not a routing fact;
            // let the outer handler report it rather than silently masking it.
            throw detailErr;
          }
        }
      }

      if (full) {
        // Keep it for the next open with no signal. Written from the RESPONSE, never from the
        // merged state: `prev` may already carry an offline overlay of work this device has not
        // uploaded yet, and storing that would make a local draft look like something the server
        // had confirmed.
        cacheLeadDetail(lead._id, full, user._id);
        setLead((prev: any) => ({
          ...prev,
          ...full,
          // Explicitly prioritize the reports from the Sales Portal response
          generatedReports: full.generatedReports || prev?.generatedReports || [],
        }));
      } else {
        // Fallback — reached when the detail endpoint is missing, 404s for this lead, or
        // answers with nothing usable. `workLead` is the check-in PUT and returns the
        // lead record, so the screen still gets real data instead of the summary row.
        const workRes = await LeadService.workLead(lead._id, user._id);
        const workData = workRes.data?.data || workRes.data;
        if (workData) {
          cacheLeadDetail(lead._id, workData, user._id);
          setLead((prev: any) => ({ ...prev, ...workData }));
        }
      }
    } catch (err: any) {
      // This runs from `useFocusEffect` on EVERY focus, and it is a background
      // refresh of a lead that is already on screen — losing it costs the rep
      // nothing, they keep the record they navigated in with. `normalizeApiError`
      // only attaches `httpStatus` when a response came back, so its absence means
      // the request never reached the API (no connectivity, VPN down, or the
      // configured `ENV.API_URL` host isn't listening). That is an environment
      // condition, not a fault in this screen, so it must not `console.error` —
      // in dev that throws the full-screen red LogBox over a working Lead Center.
      //
      // ⚠️ A handled condition must never reach `console.error` either: in dev that
      // red LogBox reads as a crash over a Lead Center that is working fine. Only a
      // genuinely unexpected failure logs at error level.
      if (err?.httpStatus === undefined) {
        console.warn('[LeadCenter] Refresh skipped — API unreachable:', err?.message || err);
      } else {
        console.error('[LeadCenter] Refresh failed:', err);
      }
    } finally {
      hydrateInFlightRef.current = null;
      setIsRefreshing(false);
    }
  }, [user?._id, lead?._id]);

  // Hydrate on open. `LeadCenter`'s focus effect also calls `refetch`, but relying on
  // it alone would leave any OTHER entry point (the chat deep link, the map, a lead
  // opened straight from a notification) rendering a summary row with no photos. The
  // in-flight guard above means the two collapse into one request on mount.
  useEffect(() => {
    if (!lead?._id || !user?._id) return;
    refetch();
    // Keyed on the lead, not on `refetch` — `refetch`'s identity changes with the lead
    // id it closes over, so depending on it would re-run this on every hydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, user?._id]);

  // NO outcome fetch on mount — web parity.
  //
  // This hook used to `GET /lead/v1/{leadId}/outcome` for every resulted lead just to
  // prefill `jobState` / `calculatorData` / `outcomeForm`. Nothing renders from those:
  // the screen's documents and contract figures come from the lead record itself (the
  // sales-portal payload), exactly as web's deal route does — web makes no outcome
  // request on this screen at all.
  //
  // Their only consumers are the two Job Builder launch paths in `LeadCenter`
  // (`openJobBuilder` auto-open and `handleShowJobBuilder`), and BOTH already issue
  // their own `getLeadOutcome` at the moment of launch — they now also read
  // `LFCalculator` / the outcome form off that response instead of this prefetch. So
  // opening a Deal costs one request fewer and the Job Builder gets fresher data.
  //
  // `isOutcomeLoading` stays in the API (it gates the auto-open effect) but is simply
  // never true now; the values below remain as the defaults those paths fall back to.
  useEffect(() => {
    setIsOutcomeLoading(false);
  }, [lead?._id]);

  const [sectionImages, setSectionImages] = useState<Record<string, any[]>>({});

  useEffect(() => {
    const fetchSecureImages = async () => {
      if (lead?.salesPhotos?.length > 0) {
        try {
          // Check what we already have to avoid redundant fetching
          const existingMap = { ...sectionImages };
          const existingS3Urls = new Set(
            Object.values(existingMap)
              .flat()
              .map((img) => img.s3url)
          );

          const newPhotos = lead.salesPhotos.filter((p: any) => !existingS3Urls.has(p.s3url));

          let updatedSecureData: any[] = [];
          if (newPhotos.length > 0) {
            try {
              const filePaths = newPhotos.map((p: any) => ({
                bucketName: p.bucketName || ENV.S3_BUCKET,
                filePath: p.s3url,
              }));
              const secureRes = await LeadService.getSecureUrls(filePaths);
              updatedSecureData = secureRes.data?.data || secureRes.data || [];
            } catch (err) {
              console.warn('Failed to fetch secure URLs from API, using fallback S3 URLs:', err);
            }
          }

          const map: Record<string, any[]> = {};
          lead.salesPhotos.forEach((photo: any) => {
            const catName = photo.category;

            // Find category config case-insensitively by ID or name
            const categoryConfig = IMAGE_CATEGORIES.find(
              (c) => c.id.toLowerCase() === catName.toLowerCase() || c.name.toLowerCase() === catName.toLowerCase()
            );

            // Normalize key to categoryConfig.name (e.g. "Inspection" instead of "inspection")
            const normalizedCatKey = categoryConfig ? categoryConfig.name : catName;

            if (!map[normalizedCatKey]) map[normalizedCatKey] = [];

            // Try to find existing image data first
            let imageData = Object.values(existingMap)
              .flat()
              .find((img) => img.s3url === photo.s3url);

            if (!imageData) {
              let subIndex = -1;
              if (categoryConfig && photo.subcategory) {
                // Try standard subcategories first
                subIndex =
                  categoryConfig.subCategories?.findIndex(
                    (s) => s.id === photo.subcategory || s.name === photo.subcategory
                  ) ?? -1;

                // Try cardGroups subcategories if not found
                if (subIndex === -1 && categoryConfig.cardGroups) {
                  for (const group of categoryConfig.cardGroups) {
                    const foundIdx = group.subCategories?.findIndex(
                      (s) => s.id === photo.subcategory || s.name === photo.subcategory
                    ) ?? -1;
                    if (foundIdx !== -1) {
                      subIndex = foundIdx;
                      break;
                    }
                  }
                }
              }

              if (subIndex === -1) {
                const parts = photo.subcategory?.split('-');
                const numericPart = parseInt(parts?.[parts.length - 1] || '');
                if (!isNaN(numericPart)) subIndex = numericPart - 1;
              }

              const secured = updatedSecureData.find(
                (s: any) => s.s3url === photo.s3url || s.filePath === photo.s3url
              );
              const imageUri = secured?.secureUrl || resolveS3Url(photo.s3url);

              imageData = {
                uri: imageUri,
                s3url: photo.s3url,
                id: photo._id,
                index: subIndex >= 0 ? subIndex : map[normalizedCatKey].length,
                subcategory: photo.subcategory,
              };
            }

            map[normalizedCatKey].push(imageData);
          });
          setSectionImages(map);
        } catch (error) {
          console.error('Failed to fetch secure URLs', error);
        }
      } else {
        setSectionImages({});
      }
    };
    fetchSecureImages();
  }, [lead?.salesPhotos]);

  useEffect(() => {
    if (!lead?._id || !user?._id) return;

    persistActiveLeadId(lead._id);
    logLeadSessionEnter(user, lead);

    // Remember the session OUTSIDE React, so the one exit that runs no cleanup at all —
    // the app being killed — can still be closed, on the next launch.
    beginLeadWorkSession(lead, user, options?.fromMyDeals);

    if (!options?.appointmentStarted) {
      LeadService.workLead(lead._id, user._id).catch((e) =>
        console.warn('[LeadCenter] Work start failed:', e)
      );
    }

    return () => {
      // NOTE: no `unload` / `lead_check_out` log here any more. Web has no such event —
      // backing out of the Lead Center is a session PAUSE there — so the portal timeline
      // read differently depending on which client the rep used. `logLeadSessionPause`
      // (fired by `LeadCenter`, which knows whether this is a deal) is the replacement.
      //
      // ⚠️ The `endWorkLead` release used to live HERE and no longer does — it moved to
      // `LeadCenter.pauseLeadSession`, which is the one exit path every route already
      // goes through. An unmount is not the only way the rep leaves a lead: the header's
      // bell / chat / account buttons PUSH their screen on top, so this cleanup never ran
      // for them and the session was never given back. Releasing beside the pause log
      // makes the two inseparable, and `LeadCenter`'s focus effect re-acquires on the way
      // back. Do not add a second release here — two owners is how they drifted apart.
      //
      // ⚠️ Guarded on the app being in the FOREGROUND. Opening the camera hands the
      // foreground to another activity, and Android can tear this screen down behind it;
      // clearing the stored session then would let a kill go unswept.
      // `LeadCenter.pauseLeadSession` carries the same check and the reasoning in full.
      if (AppState.currentState !== 'active') return;

      // Forgotten here and now, so the next launch does not treat it as stale and file a
      // second pause for a lead the rep already left. `pauseLeadSession` clears it too;
      // the call is idempotent and this is the backstop for an unmount that somehow
      // bypassed it.
      clearLeadWorkSession();
    };
  }, [lead?._id, user?._id, options?.appointmentStarted, options?.fromMyDeals]);

  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ['lead', initialLead?._id] });
    };
  }, [initialLead?._id, queryClient]);

  // ── A job finished with no signal, shown as finished ──────────────────────────────
  //
  // The rep completes the job at the door and comes straight back here. The lead record still
  // says nothing happened — it cannot, the submit is sitting in the upload store — so the screen
  // offered No demo / Reset / Not hit on a job that was already sold. Overlaying the stored
  // submit makes the Lead Center read the way it will once the upload lands, from the rep's own
  // figures until the server has its own.
  //
  // ⚠️ Applied at the RETURN, not written into `lead` state. The overlay must never be a value
  // `refetch` could merge over, cache as though it were the server's, or send back up.
  const [offlineWork, setOfflineWork] = useState(getOfflineWork);
  useEffect(() => subscribeOfflineWork(() => setOfflineWork(getOfflineWork())), []);
  const displayLead = useMemo(() => applyOfflineResult(lead, offlineWork), [lead, offlineWork]);

  return {
    lead: displayLead,
    setLead,
    isRefreshing,
    refetch,
    jobState,
    setJobState,
    calculatorData,
    outcomeForm,
    isOutcomeLoading,
    sectionImages,
    setSectionImages,
  };
};
