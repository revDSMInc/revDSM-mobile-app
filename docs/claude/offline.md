# Offline module — notes

Covers the offline queues, connectivity, and the **background upload service**. The older offline work
(lead store, photo queue, maps, caches) is described in the code headers of `services/offline*.ts` and
`utils/offline-*.ts`; add ticket notes for it here as it is touched. Merge notes that already exist
elsewhere: `app-wide.md` (queryClient `onlineManager`), `maps-zone-canvasser.md` (Add Lead offline submit),
`deal-center.md` (device-first draft read).

## Background upload service (iOS + Android)

**Goal:** queued data keeps uploading when the app has left the screen (home button / recents), and drains
the moment a good connection returns.

**Structure** — `src/services/background/`, rules in `utils/background-upload-policy.ts` (pure, tested):

| File | Role |
|---|---|
| `uploadCoordinator.ts` | ONE single-flight drain loop over all four queues (activity logs → lead work → photos → installer images). `pendingUploadCount()` is the progress measure. |
| `backgroundUploadService.ts` | `AppState` hook: on leaving the screen with work queued, engages the platform mechanism. Started from `useAppInitialization`. |
| `androidUploadService.ts` | notifee foreground service (`dataSync`). Its runner IS the coordinator drain; the runner's promise is the service's lifetime. Registered at module scope in `index.js`. |
| `nativeBackgroundTask.ts` + `ios/revDSM_Sales/BackgroundUploadTask.{h,m}` | iOS `beginBackgroundTask` grace period (~30 s): `begin` / `end` / `remainingSeconds`. |

**Platform reality (do not promise more):** iOS has no background service. The grace period is finite and
a **force-quit cancels everything** — leaving the app in recents is fine (suspended, not killed). Anything
left drains on the next foreground via the existing triggers. Android holds the process with a foreground
service and waits up to `WAIT_FOR_NETWORK_MS` (15 min) for signal, then releases.

⚠️ **The existing engines and their foreground triggers (reconnect edge, `active`, 60 s sweep) are
unchanged.** Each guards its own `draining` flag, so the coordinator joining in is a no-op, not a rival.
Do not "consolidate" them into the coordinator without re-checking that.

⚠️ **Lead work must drain before photos.** A door created offline has its photos queued under a CLIENT id;
`rekeyLead` re-addresses them only when the lead create lands. Photos first looks like a stall.

⚠️ **Calculator settings are NOT drained by the coordinator.** `flushCalculatorSettings` needs the
`onApplied` callback that patches the Redux user (`useAppInitialization`); without it the pending record
clears and the rep's toggle springs back.

⚠️ **A pass that returns because an engine is already busy is not a stall** (`anyEngineBusy`). Counting it
gave up while a large photo was still on the wire.

⚠️ **iOS: the expiration handler ends the task natively.** Returning without `endBackgroundTask:` makes iOS
terminate the app, and JS is usually frozen by then — never move that call into JS.

⚠️ **Android 12+ forbids starting a foreground service from the background**; it is started as the app
leaves the screen, in a try/catch, with a direct-drain fallback. Android 14+ needs the `dataSync` type in
BOTH the manifest (`<service … tools:replace>` — notifee's own entry says `shortService`) and on the
notification. `FOREGROUND_SERVICE_DATA_SYNC` permission added.

⚠️ **notifee is required lazily** in `androidUploadService.ts` — a static import takes the bundle down on a
stale native binary (same trap as `services/push-native.ts`).

⚠️ **A JS-only reload against a binary built BEFORE the manifest change CRASHES THE APP, not just the feature.**
Found on the first Android device test (11 offline photos, app backgrounded, signal restored): logcat showed
`IllegalArgumentException: foregroundServiceType 0x00000001 is not a subset of foregroundServiceType attribute
0x00000800` from `app.notifee.core.ForegroundService.onStartCommand`. The JS asked for `dataSync` (0x1) while the
installed manifest still carried notifee's own `shortService` (0x800) — the `<service … tools:replace>` override had
been added after that APK was built. Every attempt to start the service killed the process; the OS restarted it, the
queue uploaded one photo (11 → 10 → 9) and the next backgrounding crashed it again. This is native, so it cannot be
caught in JS. **Any change to `AndroidManifest.xml` needs a native rebuild (`./gradlew installDebug`), not a Metro
reload.** Verify with `./gradlew :app:processDebugManifest` and check the merged
`app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml` shows
`foregroundServiceType="dataSync"` for `app.notifee.core.ForegroundService`.

⚠️ **Never update the foreground-service notification with `asForegroundService: true`.** Second Android device
test, after the manifest rebuild: uploads worked in the background (11 photos drained), but the app then crashed with
`ForegroundServiceDidNotStartInTimeException` (logcat 19:53). notifee treats every `displayNotification` with
`asForegroundService: true` as a fresh START, and every START re-invokes the registered runner. The progress callback was
doing exactly that, so the service restarted itself in a tight loop (`drain started … drain done, pending=0` ×N within
~100 ms) and a `stopForegroundService()` landed before the next START had called `startForeground`. Rules now in
`androidUploadService.ts`: the service is started ONCE (`startAndroidUploadService`, `asService = true`, skipped when
`serviceActive`); progress text goes out as a plain same-id update (`asService = false`) and only when the text changed;
only the runner invocation that owns the service (`runnerOwned`) may stop it, then it also cancels the notification so a
late update cannot leave an orphan. A JS-only change — no native rebuild needed for this one.

**Related fix:** `uploadQueueManager.resetForNewSession()` now RELOADS the queue from MMKV instead of
emptying it. `upload_photo_queue` is a session-keep key; emptying the memo made the next `saveQueue()`
erase the earlier rep's unsent photos.

**Still open (not done here):** BGProcessingTask / WorkManager to resume after the process is killed;
background `URLSession` for large files; no backend idempotency key (see **Hardening pass** below). The photo
queue no longer drops after 5 attempts and a 401 no longer fails work - both fixed in the hardening pass.

**Device test matrix:** airplane mode toggled while backgrounded; app left in recents vs swiped away (each
platform); reboot with a non-empty queue; weak signal / captive portal; token expired mid-drain; low
battery / Doze; two reps on one handset. Expect: iOS drains only within ~30 s of backgrounding, Android
shows the "Uploading your work" / "Waiting for connection" notification.

### iOS build: "Build input file cannot be found: ios/BackgroundUploadTask.m"
The `revDSM_Sales` PBXGroup in `project.pbxproj` has a `name` but **no `path`**, so every file ref inside it must
carry its own `path = revDSM_Sales/<file>` (as `Info.plist`, `AppDelegate.swift`, … do). The `BackgroundUploadTask.h/.m`
refs had a bare `path = BackgroundUploadTask.m`, which resolved to `ios/` (the file lives in `ios/revDSM_Sales/`).
Fixed the two refs. ⚠️ Any new native file added to that group by hand needs the `revDSM_Sales/` prefix too.
(`RNHapticFeedback.*` builds only because a stray duplicate sits in `ios/` — don't rely on that.)

## Two ways a queued photo goes missing — resolve it, and LIST it

`utils/pending-inspection-photos.ts`.

Three rounds were spent on url→bytes resolution before noticing the Roofline Deck's photo was never
in its **list** to begin with. These are independent failures and fixing one cannot fix the other:

| Question | Helper |
|---|---|
| Is the photo in the list at all? | `salesPhotosWithPending` / `pendingAsSalesPhotos` |
| Which URL renders it? | `mergePendingForSlot` / `mergePendingIntoSections` |

⚠️ **Establish which one you have before changing anything.** An empty frame is a resolution
problem; "No inspection photos available" is a listing problem. They look alike on a device.

⚠️ **The surplus rule is per SLOT, not per list.** A queue item outlives its upload by one refetch,
so the photo is briefly in both the server list and the queue. Deduping across the whole list drops
a legitimately-pending second shot in the same slot.

⚠️ **Every merge returns the SAME array when nothing is pending**, so callers keep their memo
identity — these feed dependency arrays on screens that re-render constantly.

## A server job that loses signal is WAITING, not failed

`utils/report-job-connectivity.ts` + `hooks/useLeadReports.ts`.

Reported from a door: a rep started a Risk Report and a revRender, lost signal, and all three
things on screen lied.

| Surface | Offline behaviour | Cause |
|---|---|---|
| revRender bar | **kept climbing** to 67% | `startMockProgress` advances 0→20→67→80% on a `setInterval` over elapsed seconds, with **no server contact** |
| Risk Report bar | froze at 56% on *"Fetching historical data for 2023…"* forever | the poll's `catch` only logged, so the 3s interval retried silently and `riskJob` kept its last `step` |
| a black toast | `Polling error: {"message":"Network Error"}` | raw axios rejection logged once per tick |

⚠️ **Losing signal is not the job failing.** The generation runs on the SERVER — it was accepted, it
has a jobId, and it is very probably still going; the device has merely lost the ability to ask.
Marking it `failed` is a lie in the opposite direction and invites the rep to start it again: a
second billed AI render, or a duplicate report, for a job that was always going to finish. So the
state is **waiting**, the bar holds its last honest number, and polling continues — the first tick
after reconnect clears the flag by itself.

⚠️ **The stale `step` is dropped, not kept.** Holding *"Fetching historical data for 2023…"* on
screen for ten minutes is worse than no label: a live-sounding sentence about work nobody is
observing. `jobWaitState(step, unreachable)` returns `WAITING_LABEL` instead.

⚠️ **Freezing the mock timer is not optional.** Re-labelling alone leaves a bar that keeps filling,
which is a stronger and falser promise than any caption can undo.

⚠️ **Keyed off the ERROR, never `isOnline()`** — same rule as `network-error.ts`. A poll that dies
in a tunnel is the same event whatever the connectivity model believed; the absence of an HTTP
status is the honest signal. A 500 from the generator is a real failure and still fails.

⚠️ **Amber, not red**, and no spinner while waiting — red says "this failed", and a spinning
indicator beside "waiting for signal" contradicts the sentence next to it.

Different moment from the entry-point guard: `offline-capability.ts` already blocks *starting* a
risk report or render with no signal, but it only speaks at the tap and cannot help a bar already
on screen. A render whose *initial* POST never reached the server **is** a genuine failure and
stays `failed` — reported as "No connection — this render was not started", never axios' wording.

## Hardening pass (audit follow-up)

What was fixed, and the rule behind each. Rules live in pure `utils/upload-retry-policy.ts`,
`utils/offline-lead-queue.ts`, `utils/offline-lead-work.ts`, `utils/session-scope.ts` and are tested in
`tests/offline/` (**tracked** - see below).

| Was | Now |
|---|---|
| Photo queue **deleted** an item after 5 failed attempts | It is **parked** (`parkedAt`, `lastError`): file kept, skipped by the drain, not counted by the coordinator, shown on Pending uploads with Retry / Discard (`uploadQueueManager.retryParked` / `dropQueuedItem`) |
| A 401 marked lead work `failed`, spent a photo attempt, and spent an activity-log attempt | `classifyCreateOutcome` -> `'unauthorized'` -> `StepDecision 'pause'`: work stays `draft`, attempts untouched. Photo queue and activity log stop without spending an attempt |
| `offline_image_uploads` was wiped on logout (files orphaned in DocumentDir) and had no owner | Added to `SESSION_KEEP_KEYS`; items carry `ownerId` (legacy items without one belong to whoever is signed in); `getUploadQueue()` returns only the signed-in rep's |
| `offline_calculator_settings` was wiped on logout | Stored per owner as `offline_calculator_settings:<ownerId>` (kept by prefix), so a second rep can neither see nor flush it. The old un-owned key is adopted by the first rep who loads |
| Installer image queue `break`-ed on the first failure, blocking every item behind it, with no cap | Per-item `attempts` + exponential backoff (30 s .. 15 min), parked after `MAX_INSTALLER_ATTEMPTS` (8); the loop carries on to the next item |
| Installer queue saved a stale snapshot, erasing anything enqueued mid-sync | `updateItem` / `removeItem` read-modify-write the fresh list |
| `[CheckInTrace]` / `[LeadSync]` diagnostics, incl. the five marked TEMPORARY | Removed (kept: `[LeadSync] CREATE queued` and `FAILED`) |
| No single place to see what is queued | **Pending uploads** screen (`screens/PendingUploads`), entered from Profile (`PendingUploadsCard`) and the Leads banner ("See all pending uploads"). Lists work, parked photos, installer images, activity-log count |

⚠️ **Parking is not dropping.** A parked photo or installer item must stay in storage with its file until the
rep chooses. `heldCount()` / `pendingInstallerUploadCount()` exclude parked items on purpose: counting them
makes the coordinator "stall" and give up on everything else.

⚠️ **A 401 is the session, never the item.** The api interceptor is already signing the rep out; the queues
must keep what they hold and spend no attempt. Do not map 401 back to `rejected`.

⚠️ **Installer queue ownership:** items queued before this pass have no `ownerId` and are treated as the
current rep's. Never filter on `ownerId` alone.

⚠️ **`tests/` is the one tracked test folder.** `.gitignore` still ignores `__tests__/` and `*.test.ts`
(deliberate - suites are local), with `!tests/**/*.test.ts` carved out so the offline rules run in CI.
`tests/offline/background-upload-policy.test.ts` is a copy of the local one.

### Backend request - idempotency key (NOT done; needs the API)

The client cannot make a timed-out create safe on its own; today it reads the record back before retrying
(`stepReplaySafety`), which only works for steps that have something to read. Ask the backend to accept an
`Idempotency-Key` header (we would send the queue item's client id: `work-...`, `upload-...`, `upload_...`) on
lead / appointment / calculator create and `uploadImages`, and to return the original response for a repeat.
Until then a photo upload that times out after reaching the server can still produce a duplicate photo.

### Still not offline (by design or not yet built)
Installer jobs and Certificate of Completion; My Deals edit wizard / addendums (blocked with a notice);
Zone Canvasser zone create / archive / delete (map tiles are cached, writes are not); referral, Job Tracker
writes, chat sends (blocked with a notice, not queued).


### Activity logs offline: coverage, one action-time key, per-lead order (2026-10-14)
Files: `utils/offline-activity-log.ts` (pure rules), `services/offlineActivityLog.ts` (queue), `services/api/LoggerService.ts`
(`logEvent`), `services/offlineLeadStore.ts` (id resolver), `services/background/uploadCoordinator.ts`. Tests: `tests/offline/offline-activity-log.test.ts`.

| Was | Fix |
|---|---|
| Only a whitelist of modules was held offline; `result_lead`, `lead_result_field_entry`, `calculator_field_entry`, `view_all_calculators`, `roofline_deck`, `investment_center`, `my_deal`... fell to `sendLog`, failed and were lost (only a `console.warn`) | `isQueueableLog` is now **every module except `NON_QUEUEABLE_LOG_MODULES` (`system`)**. A new module is held by default |
| Two names for the action time: `meta.occurredAt` (held logs) and `meta.timestamp` (lead-photo + installer-photo logs) | ONE key, `meta.occurredAt` (`ACTION_TIME_KEY`). `logEvent` stamps it first thing, on EVERY log, online or not. A caller that knows the true moment (photo capture time) passes `occurredAt` and `stampActionTime` keeps it. `imageData.timestampTaken` is the image schema's own field and stays. `leads_list`'s `meta.timestamp` is a view log, not queued, untouched |
| Queue cap 200 silently dropped the oldest log | `MAX_QUEUED_LOGS` = 2000 |
| A log made online right after reconnecting overtook older held ones | `logEvent` holds a log while `hasQueuedActivityLogs()` |
| The drain ran BEFORE lead work, so a log for an offline-created lead went out with the device-only `lead-...` id and `rekeyActivityLogs` ran too late | `nextSendableLog` skips a log whose payload still holds a device id (`findUnresolvedClientIds`) **and every later log of that lead**; `setActivityLogIdResolver` swaps ids from every work's `buildIdMap` at send time (covers appointment + calculator ids, not just the lead); a drain is triggered after `rekeyActivityLogs`, at the end of `drainOfflineWork`, and as a second coordinator pass |

- ⚠️ **Do NOT stamp the time in the sender or `sendLog`.** That is the reconnect time, the exact bug this fixes.
- ⚠️ **Do NOT re-introduce a per-module whitelist.** Exclude by exception only.
- ⚠️ The backend is not in this repo: whether it shows `meta.occurredAt` instead of its own receive time as the log's time is unverified. Backend analytics that read `meta.timestamp` on photo logs must read `meta.occurredAt`.
- Not renamed (separate queues, not activity logs): `OfflineLeadWork.createdAt/updatedAt`, `workStarted.at`, `workEnded.at`, `fundingSubmitted.at`, the upload queue's own `timestamp`.

### Activity logs: one stable id per log, so a retry is not a second row (2026-10-16)
Files: `utils/offline-activity-log.ts` (`newActivityLogId`), `services/api/LoggerService.ts` (`logEvent` stamps `payload.user_activity_log_id`). Test: `tests/offline/offline-activity-log.test.ts`.

| Was | Fix |
|---|---|
| A send that timed out (15 s) but that the server finished was retried or re-queued, and every attempt added a row: one check-in showed 5 times (= `MAX_LOG_ATTEMPTS`) on the Forever Record | `logEvent` makes ONE v4 UUID per log. The held, retried and failure re-queued copies all spread the same `payload`, so they carry it. The backend stores a log once per `user_activity_log_id` and answers a repeat with the stored row (200) |

- ⚠️ **Make the id in `logEvent`, never in `sendLog` or the drain** — an id made per attempt is a new log every time, i.e. the bug.
- ⚠️ The id must stay a **v4 UUID**: the backend ignores anything else and generates its own. An older backend simply accepts the field as the row's id.
- `leads.ts` `logUserActivity` posts without an id and is not queued; it is unchanged.

### REVUIUX-444 — `defaultOneYearPaymentMethod` joins the queued calculator settings

`utils/offline-settings.ts`: `FIELDS` + `PendingCalculatorSettings` gained `defaultOneYearPaymentMethod` (`null` = clear, sent as `null`). Everything else (merge, payload, `hasPendingSettings`, optimistic `applyPendingSettingsToUser`, replay on reconnect) is driven off `FIELDS`. See `deal-center.md` § REVUIUX-444.

⚠️ **Every queue's `start*Sync()` is registered in `hooks/useAppInitialization.ts`**, beside
`startOfflineWorkSync` / `startPhotoQueueSync` / `startActivityLogSync` / `startMapFilterSync`. A
queue that drains only when its own screen mounts never drains at a door — register it there, not
in a component.

## Queue 6 — agreement delivery preference (REVUIUX-391)

`utils/offline-agreement-delivery.ts` (rule), `services/offlineAgreementDelivery.ts` (MMKV queue,
key `offline-agreement-delivery`), drained from `useAppInitialization` via
`startDeliveryPreferenceSync()`. Endpoint: `PUT pdf-reports/v1/agreement/{leadId}/delivery-preference`.

⚠️ **This one BLOCKED THE SALE, which is why it became a queue.** The prompt asking how the
homeowner wants the signed copy gates Generate Agreement, and `onConfirmed()` only fired once the
PUT resolved — so a rep at a door with no signal could not reach the agreement at all. Every other
queue here exists so work is not *lost*; this one exists so work is not *prevented*.

⚠️ **Full-state PUT ⇒ one row per lead, replaced wholesale, and no attempt counter** — the same
shape as the map-filter queue. Only the rep's last choice matters; replaying an earlier one would
overwrite it with stale data.

⚠️ **The prompt reopens on the QUEUED choice, not the lead's default.** Without that, a rep who
reopened the prompt offline saw it reset to the prefill and would reasonably assume their first
answer was lost.

⚠️ Keyed off the error, not only `isOnline()`: a PUT that dies mid-flight queues too, rather than
showing a failure for something the device can hold. Rows are owner-scoped
(`replayableDeliveryWrites`), so another login's choice is never replayed.

Ticket context and the online flow: [`deal-center.md`](deal-center.md).

### Follow-up — Queue 6 now holds client-id rows, and re-keys them

The delivery prompt was suppressed for a lead created at a door (`!isClientId(leadId)`), so the
queue never saw the commonest offline case. It now asks on those leads too, which means the queue
has to hold a row keyed by a **client** id.

⚠️ **A client-id row must be RE-KEYED before it can be sent.** Replaying
`PUT pdf-reports/v1/agreement/{leadId}/delivery-preference` against a client id files the
preference on a lead the server has never heard of — the counterfeit-id trap recorded above.
`rekeyDeliveryPreference(fromId, toId)` is called from the `lead` sync step in
`offlineLeadStore.ts`, beside `rekeyActivityLogs` / `rekeyLeadWorkflow` / the photo-queue re-key.

⚠️ **Any queue that can hold a row for an offline-created lead needs a re-key, and a call in that
same block.** The row is written before the lead exists; nothing else will repair it, and the
drain cannot tell a client id from a real one. This is the fourth queue to need it — add the call
when adding the queue, not after a bug report.

⚠️ The re-key drains immediately after rewriting the row, so a preference queued before the lead
synced is sent as soon as the lead has a real id, rather than waiting for the next reconnect.

Ticket context and the prompt side: [`deal-center.md`](deal-center.md).

### Follow-up — Queues 7 and 8: Submit Funding, and a cheque taken in hand

Result Lead ▸ Confirm offline is **three writes, not one**, and the order is load-bearing. Only
the first existed; the other two were silently dropped. See `deal-center.md` for the UI side.

| Step | Fires when | Safety |
|---|---|---|
| `funding` | Confirm — the split itself (already existed) | `idempotent` (full-state PUT) |
| `fundingCollect` | "Mark collected" on a down-payment cheque | `guarded` |
| `fundingSubmit` | Submit Funding | `guarded` |

⚠️ **Both new steps hang off `funding`** — `isStepApplicable` requires `!!work.funding`. Neither
can address a row the save has not created yet, which is also why they sit after it in
`UPLOAD_STEPS` and before `submit`.

⚠️ **NOT `idempotent`, unlike the save above them.** Both address rows by pid and the server
refuses the repeat. Under `idempotent` an ambiguous failure retries blind, reads the refusal as a
real failure, and parks a sold deal in `needs-review`. Under `guarded` the retry READS the record
first — `isFundingAlreadySubmitted`, and the `collected` pids — and treats "already done" as the
state it wanted. The read is gated on `guarded`, so the happy path costs nothing.

⚠️ **These pids need NO re-key, and that is the exception worth knowing.** Every other queue
holding an offline-created row needs one (four so far — see the note above). `newPaymentId()` mints
the pid **on the device** and the `funding` save sends it in the upsert, so the server adopts the
device's own id. A later POST to `/funding/{pid}/check-collected` therefore addresses correctly
with no rewriting. Contrast the lead id, which the server mints and the device can only guess at.

⚠️ **Don't reach for `submitFunding`'s error shape to detect a repeat.** The already-submitted
refusal is not a documented status, and `normalizeApiError` strips `.response` anyway. Read
`funding.status === 'submitted'` off the record instead — the same shape `isAlreadySubmitted` uses
for the job builder.

**"Sync all" now hides when nothing is syncable** (`payments.some(canSync)`, i.e. a card or loan
row with a link sent), and the header reads "Nothing to check on". Offline that is always the case.
It was never harmful — `syncAll` no-ops on an empty row set — but a Sync button at a door with no
signal is a promise the screen cannot keep.

## Queue 0 — My Deals edit opens offline (Phase 1 of the My Deals plan)

`utils/offline-deal-edit.ts` (pure rules) + `utils/offline-query-cache.ts` (storage). Not a queue —
a **read-path snapshot**, numbered 0 because it feeds the addendum queues that follow.
Full plan and phases: [`docs/MY-DEALS-OFFLINE-PLAN.md`](../MY-DEALS-OFFLINE-PLAN.md).

One envelope per lead, key `deal-edit:<leadId>`, owner-scoped, holding the five things the edit
wizard reads: `outcome`, `calculator`, `portalJobBuilder`, `approvers`, `funding`.

⚠️ **This screen was BROKEN offline, not blocked — a different failure from every other queue
here.** Its four queries each wrap their call in `try/catch → return null`, so offline they
*resolve*. The loading gate clears and the rep gets a half-seeded wizard with blank prices, on a
screen that amends a signed contract. There is no way to tell a genuinely empty field from one
that failed to load.

⚠️ **Serve a cached value from INSIDE the `queryFn`, never via `enabled: false`.** A disabled
query in TanStack v5 keeps `isLoading` **true forever**, so the screen hangs on its spinner — the
exact symptom being fixed. The same applies anywhere `isSuccess` is read (see `useRefundApprovers`
in [`deal-center.md`](deal-center.md)).

⚠️ **The refusal must render ABOVE the loading gate**, for the same reason: offline the gate
clears, so a refusal placed after it never shows.

⚠️ **`buildDealEditCache` returns null without `portalJobBuilder`.** A half-loaded screen must
never overwrite a good snapshot with a worse one — a rep reopening on a flaky line keeps the copy
that works. This is the write-side mirror of `isUsableDealEditCache`.

⚠️ **`dealEditCacheChanged` compares object IDENTITY before serialising.** MMKV rewrites its whole
store per write and this screen re-renders constantly; TanStack returns the same object until data
changes, so reopening an unchanged deal writes nothing. The deep compare is only a fallback for a
refetch that produced equal-but-new objects. Without this guard the feature sits on the hot path
and taxes every unrelated write in the app.

⚠️ **The write effect early-returns while serving FROM the cache**, or the screen rewrites its own
snapshot with a copy of itself.

## The leads list kept saying "Resume Appointment" on a lead resulted offline

Reported from a device with three screenshots. A rep resulted a self-gen lead at a door with no
signal. **Lead Center showed "Resulted — Sale"; the leads list card, on the same lead at the same
moment, still offered "Resume Appointment".** It only caught up after reconnecting and syncing.

`LeadCard.getLeadState` decides RESULTED with
`!NON_RESULTED_STATUSES.includes(lead.status)`, where the list is
`['lfLead', 'selfGenerated', 'scheduled']`. Offline the submit is queued, so the server's
`status` on the device is still `selfGenerated` — the card is reading the truth it was given.

**`applyOfflineResult` already existed and already handled this**, including matching by client
id. The leads list simply never called it: `screens/Leads/index.tsx › withWorkflow` mapped
`applyOfflineWorkflow` only, while Lead Center gets the overlay through
`useLeadCenterData:295`. One `.map()` was missing.

⚠️ **TWO SCREENS DISAGREEING ABOUT ONE LEAD IS WORSE THAN EITHER BEING WRONG.** The rep cannot
tell which to believe and may redo work they have already finished — on a sold job. When an
overlay exists, every surface that renders that record has to apply it; a half-applied overlay is
its own bug class.

⚠️ **`withWorkflow` is the single funnel** in that file — rehash, archived, today and pending-lead
paths all pass through it. Add overlays there, not at the call sites, or the next path added
quietly skips them.

⚠️ **Order matters: result first, then workflow.** The workflow overlay carries check-in/resume
marks; the result overlay supersedes them once the lead is sold.

⚠️ **The overlay dies on `status === 'uploaded'`** (`offlineResultOverlay`), so the server's own
record takes over the moment the submit lands — it never pins the card to what this device sent.

`LeadCard` is the only consumer of that component, so this was the one surface affected. My Deals
reads a different (sold-deals) list and is covered by the My Deals offline plan.

## Queues 9 & 10 — a My Deals addendum raised at the door (Phase 2)

`utils/offline-addendum.ts` (what may be queued) + the `addendumDraft` / `addendumRelease` steps
in `utils/offline-lead-work.ts`, synced from `services/offlineLeadStore.ts`. Plan and phases:
[`docs/MY-DEALS-OFFLINE-PLAN.md`](../MY-DEALS-OFFLINE-PLAN.md).

The rep is at a job they already sold, the customer asks for gutters too, and the addendum has to
be raisable with no signal.

⚠️ **TWO STEPS, NEVER ONE — this is the rule the whole feature hangs on.** The backend requires
`create draft → (refund) → release`, and **`addendumRelease` is never applicable when
`addendum.hasRefund`**. A refund addendum released by the device reaches the homeowner *ahead of
its approval*; the refund machine then refuses `pendingApproval → customerSigned` with a bare
`return`, so **the signature is silently dropped, can never be asked for again, and the money
never moves.** No error, no retry, no trace. The approver releases those server-side
(`ApprovalHandler → releaseAddendumForApprovedRefund`).

⚠️ **The server will NOT protect us here.** The refund's draft lookup is `.select('_id')` — it
does not check the draft's status, so it happily attaches a refund to an addendum already sent or
signed. The ordering has to be right on the client.

⚠️ **A refund addendum has NO release step at all.** Do not add a tidy-looking "finish the job"
step; that would be the bug.

⚠️ **Both steps are `guarded`, never `idempotent`.** A replayed create files a **second**
addendum on the customer. `addendumRelease` treats a 409 as done: the only server gate is
`status !== 'draft'`, so a 409 means somebody else already moved it — which is the state the step
wanted. Same shape as `readIs409` elsewhere in this file.

⚠️ **Nothing binary in the payload.** `addendumOfflineBlock` refuses an addendum carrying a new
agreement or order sheet, so the queued payload can never hold a base64 `data:` URI (R2 of the
plan). Attachments are Phase 4.

⚠️ **`offline_lead_work` is already in `SESSION_KEEP_KEYS`** — verified, not assumed — so a
queued addendum survives logout. That is the bug that silently destroyed five queues before.

**`utils/offline-capability.ts › addendum` is no longer a blanket block.** It stays for callers
that genuinely cannot queue; the edit flow uses `addendumOfflineBlock`, which distinguishes a
plain build change (queueable) from a refund or an attachment (not).

### Follow-up — Queue 11: a cheque refund rides with the addendum (Phase 3)

`utils/offline-addendum.ts` gained `refundMethodAvailableOffline` + `CARD_REFUND_OFFLINE_MSG`,
and `addendumOfflineBlock` now takes the chosen `refundMethod`.

⚠️ **CHEQUE and CARD are different kinds of operation, not degrees of risk.** A cheque refund is
only a RECORD that the office will post one — nothing moves on submit, so it queues like any
other write. A card refund REVERSES the charge through the processor: it can decline, part-settle
or error, none of which a device can resolve. That is the whole reason one queues and the other
cannot.

⚠️ **Only an EXPLICIT cheque queues** — the rule is `method === 'check'`, deliberately **not**
`method !== 'card'`. An unset method must never fall through as "fine", or the refund is filed as
a cheque the rep never chose. The first implementation here had the looser check and a test
caught it; keep the strict form.

⚠️ **A queueable cheque refund must not mask a blocked attachment.** The block reports the card
refund first when both apply (it is the more serious), but still reports documents when the
refund itself is fine — otherwise an addendum would queue having silently dropped its agreement.

⚠️ **The refund message names the ALTERNATIVE, not just the problem**: *"Take it as a cheque, or
raise this once you have signal."* A rep at a table can act on the first half immediately.

Step ordering and the release rule: see the Queues 9 & 10 ticket above. Phases:
[`docs/MY-DEALS-OFFLINE-PLAN.md`](../MY-DEALS-OFFLINE-PLAN.md).

---

## Follow-up — "2 bars of LTE and it says Offline"

Client, on a phone that was **online with two bars**: *"Online and Offline | 2 bars of signal —
Offline banner showed."* Screenshot confirmed it: LTE, two bars, requests working, and the amber
*"Offline — showing saved data"* strip across the top. Two independent defects, either of which
alone produces it.

### 1. One lost packet was being read as a dead network

`probeHealth` was a **single** `GET /health`. Every failure path — abort, DNS, TLS, refused —
funnels into `return false`, and `applyProbeResult(false)` calls `settle(..., 'offline',
{ force: true })`, which **skips the 5 s dwell**. So one dropped packet on a weak radio
instantly relabelled a working phone as offline, with no second opinion and no settling period.

On one bar a dropped request is *routine*, not exceptional. The probe was treating the most
common event on a weak link as proof of the rarest one.

⚠️ **Offline must mean "we looked more than once and found nothing."** `probeHealth` now retries
up to `PROBE_FAILURES_BEFORE_OFFLINE` (2) with a `PROBE_RETRY_GAP_MS` (400 ms) gap, and returns
`false` only if **every** attempt came back empty. Any real answer — including `'slow'` — settles
immediately, so a healthy line still costs exactly **one** request. A captive portal still
answers consistently, so it is still caught, just at the cap.

### 2. Nothing could clear the strip while the app sat idle

The other half, and the reason it *stayed* up. `applyOsConnected` resolves to **`degraded`**,
never `online` — deliberately, because a connected interface is not proof the API is serving.
Only a **2xx on a real request** promotes to `online`. But a probe only runs on a stall or a
transport error, and **an idle app makes no requests at all**. A rep who walked back into signal
kept the warning until they happened to tap something.

⚠️ `syncRecoveryPoll` in `connectivity.ts` now polls **only while a warning is showing**, every
`RECOVERY_POLL_MS` (8 s), and disarms the moment the status leaves offline/degraded — a healthy
app pays nothing.

⚠️ **The poll calls `AuthService.getMe()`, NOT `/health`.** This is the important part. A probe
is not allowed to promote to online (see below), so polling `/health` would have recovered
nothing. `getMe` goes through axios, so its 2xx arrives as an ordinary `success` signal and
recovery happens through the **one** sanctioned path, rather than a second rule that could
drift out of agreement with the first.

### The rule I tried to break, and why it stands

My first attempt made `applyProbeResult(true)` settle straight to `online`. It was wrong, and
the existing test *"⚠️ a probe can NEVER promote to online — it proves reachable, not serving"*
caught it. `/health` is cheap and unauthenticated: it answers happily while the real API is
failing, so promoting on it would tell a rep they were fine while every save failed.

What a healthy probe now does instead is **clear the failure run** (`failures: 0`), so the next
transport error starts counting from scratch rather than re-settling to offline instantly. That
gets the benefit without touching the rule.

⚠️ **Do not "simplify" the retry back to a single fetch**, and do not let a probe promote to
`online`. Each of those re-creates one of the two halves of this bug.

---

## Ticket — NetInfo was asking Google whether our API was up

Client reports clustered on **mobile data (LTE/5G)**; the team tests on office WiFi and could
reproduce almost none of it.

⚠️ **`NetInfo.configure()` had never been called**, so the library ran on its defaults — and the
default is:

```
reachabilityUrl: 'https://clients3.google.com/generate_204'
```

**The app's offline banner was driven by whether GOOGLE answered, not whether our API did.** That
verdict is not a hint: `isInternetReachable === false` flows through `resolveOnline` →
`applyOsDisconnected`, which force-settles to offline **past the dwell**.

Wrong in both directions on a rep's cellular connection:
- a carrier that blocks, throttles or intercepts that endpoint (it is a well-known captive-portal
  probe) marks the app OFFLINE while our API is perfectly reachable;
- Google answering says nothing about our backend, so the app insists it is online while every
  real request fails.

`configureReachability()` in `services/connectivity.ts` now points it at `HEALTH_URL`, called from
`startConnectivityMonitor` **before** the listener is added so the first reported state already
used our url. Timeouts: request 8 s (must clear a cold TLS handshake on a weak cell — NetInfo's
default is 15 s), retry 10 s while failing, 60 s while healthy.

⚠️ **`useNativeReachability: false`.** Android's native check reports the OS's captive-portal
verdict, which is about *the internet*, not about *us*.

⚠️ **`HEALTH_URL` is exported from `health-probe.ts` and shared.** Two different health targets
would let the two halves of connectivity disagree about whether the rep is online.

⚠️ A `configure` failure is caught and logged: NetInfo falls back to its defaults, which is
degraded but still working.

### Why WiFi could never show this

| | WiFi | LTE/5G at a door |
|---|---|---|
| RTT | 10–30 ms | 100–1500 ms |
| Packet loss | ~0 % | routine |
| TLS handshake | ~50 ms | 0.5–3 s (≈3 round trips) |
| IP address | stable | **changes on cell handoff** |
| Middleboxes | none | carrier proxies, NAT, throttling |

Measured from a good line: the Google endpoint answers in ~0.26 s, `api.np.revdsm.com/health` in
~1.03 s. Both multiply on cellular — and only the second one matters.

⚠️ **Every threshold in this area was originally calibrated against WiFi numbers.** When changing
one, reason about the LTE column, not the WiFi one.

### Connection diagnostics

`widgets/components/ConnectionDiagnosticsCard.tsx` (in Profile, beside the offline-data card)
shows status, radio generation, NetInfo's reachability verdict, **the url being tested**, time
since the last successful `/health`, its duration, pending sync count and a badly-skewed clock —
with *Check now* and *Share*. Rules are pure in `utils/connection-diagnostics.ts`.

⚠️ The url line exists because that is exactly what nobody could see: a default that quietly
pointed somewhere else. Keep it on the card.

⚠️ `health-probe.ts` records `lastSuccessAt` / `lastDurationMs` for display **only** — they must
never feed a decision, or diagnostics become load-bearing.

### Follow-up — "Weak connection" on a 46 Mbps line

Caught by the diagnostics card contradicting the banner **on the same screen**: status *Weak
connection*, but **Reachable: yes**, last `/health` success **2 s ago in 249 ms**, 46 Mbps down,
10 ms ping. (The card paid for itself here — without it this is unfalsifiable.)

Two independent defects, either one enough.

**1. An OS connect event was treated as evidence of a weak link.**

`applyOsConnected` force-settled to `degraded` whenever NetInfo reported a connection — and
NetInfo fires on routine events: signal-strength changes, interface detail updates, a Wi-Fi roam,
every cell handoff. So a perfectly healthy app was knocked into the warning state repeatedly, and
only a later 2xx could undo it. Mobile data reconnects constantly, which is why the client saw
this far more than the team did.

⚠️ **A connect event means only "we are no longer definitely OFFLINE."** It now returns the state
untouched when already `online` or `degraded`, and lifts `offline`/`unknown` to `degraded`.
Returning the SAME OBJECT when already degraded matters too: re-stamping restarted `changedAt`
and so re-armed the dwell on every radio event, blocking recovery.

**2. The recovery poll was armed only on a status CHANGE.**

`syncRecoveryPoll()` sat below the early return in `setNetState`, so an app that settled into
`degraded` and then stopped changing never started polling — nothing ever asked whether the line
had recovered. It is now called on the unchanged path too, and once from
`startConnectivityMonitor` for whatever state the app starts in.

⚠️ **The no-promote rule still stands**: `applyProbeResult(true)` must NOT reach `online`.
`/health` is unauthenticated and answers while the real API is failing; only a 2xx on a real
request proves we are being served. That is why recovery goes through `getMe`, not the probe —
do not "simplify" the poll into a probe.

⚠️ `syncRecoveryPoll` is declared below `setNetState` and `startConnectivityMonitor`. Safe today
because every call is inside a function body (evaluated after module load) — a module-level call
would hit the TDZ and crash at startup.

---

## Ticket 1310 — a Forever Record showing a confirmed rollout with no price

Portal ticket: *"Why is investment center showing what price was rolled out but rollout & drops
is NOT? He couldn't have confirmed roll out unless there was a dollar amount filled in."* The
record made it look like a process failure by the rep.

Reproduced by comparing two records of the same flow: the one built on **Wi-Fi** shows
*"Rollout Price $333 (RETAIL + 67%)"* directly above **CONFIRMED ROLLOUTS**; the one built on
**4G** shows the confirmation with **no price line**.

### Root cause: a failed log was thrown away

They are two SEPARATE requests — `logEndPriceEntered` ("end price entered") fires on commit, then
`rolloutConfirmed` fires on the tap, both via `logRolloutChange` → `logEvent`. One was delivered
and the other lost.

`logEvent` queues only when `isOnline()` is **false**. On mobile data the app IS online, so the
log went straight to `sendLog`, whose catch did this and nothing more:

```
console.warn(`[Logger] ✗ ${eventType} …`);
```

⚠️ **A timed-out activity log was gone for good.** `sendLog` uses bare `axios` (not the
retry-aware client), with no queue behind it. On office Wi-Fi that POST essentially never fails,
which is exactly why every record looked complete in testing and only the field saw gaps.

### The fix

`sendLog` now queues a failed log through the existing `queueActivityLog`, gated by
`shouldQueueFailedLog(status)` in `utils/offline-activity-log.ts`:

| failure | queued? | why |
|---|---|---|
| no response (timeout, DNS, TLS, reset) | yes | it never arrived |
| 5xx | yes | server faulted; the payload is fine |
| 401 | yes | goes out after the next sign-in |
| other 4xx | **no** | the server understood and refused — replaying forever just fills the queue |

⚠️ **It re-stamps with the ORIGINAL `occurredAt`**, so a replayed entry lands where the rep
actually did the thing, not at the time it finally got through. A Forever Record in the wrong
order is its own bug.

⚠️ **`attachLocation: false` on the queued copy.** Location was already resolved before the send;
re-resolving on replay attaches where the rep is at RETRY time, which is somewhere else entirely.

⚠️ **The guard is `!rethrow`, and that is load-bearing.** The queue drain calls `sendLog` with
`rethrow = true`, so a failed REPLAY rethrows into the queue's own attempt counter instead of
re-queueing itself. Without it a permanently failing log would multiply on every drain.

### Pre-existing test failures fixed in passing

`__tests__/utils/offline-activity-log.test.ts` still imported `QUEUEABLE_LOG_MODULES`, which
became `NON_QUEUEABLE_LOG_MODULES` in an earlier commit — the suite had been failing to even load.

⚠️ **That rename inverted the model: an allow-list became a deny-list, so everything except
`system` is now queued.** The old allow-list existed to keep per-field modules
(`calculator_field_entry`, `lead_result_field_entry`) out of the queue — they fire PER KEYSTROKE,
one offline quote is hundreds of rows, and MMKV rewrites its whole store on every write.
`MAX_QUEUED_LOGS` is now the only thing holding that back. If a device in a dead zone starts
filling up or replay gets slow, look here first.

### Follow-up — Queues 9 and 10: offline financing (`fundingDecision`, `fundingActivate`)

Ticket: financing plans were disabled with no signal, but the rep now records the lender's answer and activates the
loan in the app, so a loan has to be finishable offline. UI side: [`deal-center.md`](deal-center.md).

| Step | Fires when | Safety |
|---|---|---|
| `fundingDecision` | rep taps Approve full / part / Decline offline | `guarded` (reads the record; skips a pid whose decision already matches) |
| `fundingActivate` | rep taps "Authorize & activate" offline | `guarded` (skips a pid already `activated`) |

Order in `UPLOAD_STEPS`: `funding` -> `fundingCollect` -> **`fundingDecision` -> `fundingActivate`** -> `fundingSubmit`.
Both hang off `funding` (`isStepApplicable` needs `!!work.funding`), and address rows by the device-minted pid, so
**no re-key** (same exception as `fundingCollect`). `methodAvailableOffline` now allows `financing`; a **card** is
still blocked (it needs a processor link). Offline the card hides Send link / Sync and shows a banner; the device
record is ticked by `applyOfflineDecision` / `applyOfflineActivation`, and `fundingBlockers(..., { offline: true })`
drops "link not sent yet" for a loan.
- ⚠️ **The server answers 409 "Send the application link first" on a decision with no link**, and offline the link
  could not be made. The drain therefore does `getLink` + `markLinkSent({ channel: 'qr' })` when the row has
  `linkSent: false`, then records the decision. That stamps a "qr" send the homeowner never scanned — an audit-trail
  compromise pending the client's answer on "record a decision with no link" (needs a backend change to do properly).
- ⚠️ Re-recording a pid replaces its queued entry and drops a queued activation (an activation of the old answer).
- Not covered: My Deals edit (`DynamicDealEditScreen`) offline funding; offline activity logs for decision/activate.
  Not verified on device. Tests: `financing-rail.test.ts` ("offline financing").

### 1 Year default plan - offline + activity logs

The rep default (`defaultOneYearPaymentMethod`) already rides the queued calculator settings (`offline-settings.ts` `FIELDS`): `RolloutView.saveDefault` queues it first, flushes if online, and offline shows "Saved on your device - it'll sync when you're back online"; `useAuth` merges it optimistically so `repOneYearKey` (and the plan sheet's CURRENT DEFAULT) update at once, and `startCalculatorSettingsSync` replays it on reconnect. New: `RolloutView.logOneYearPlan` writes a `oneYearPlan` rollout log through `logRolloutChange` -> `logEvent`, so offline it lands in the activity-log queue with the action-time key and per-lead order like every other rollout log. Actions: `1 year default plan set` / `cleared` (`isRepDefault: true`, logged once per real change) and `1 year plan changed` (`oneYearMode`), fired from `OneYearMonthlyPlan`'s new `onPlanPicked` (only `commit`, i.e. rep taps - never the Default re-stamp effect). Meta `offline` records connectivity at tap time. ⚠️ A server rejection while online leaves the setting queued until the NEXT reconnect (no retry timer) - pre-existing behaviour. Not verified on device.

---

## Ticket — 4 photos became 9, then 7 (mobile data)

> "In mobile data I noticed I uploaded 4 images and it is becoming 9 and some time more. In
> back-left it goes 3 and then in manage photos it increased, and I again checked it become 7."

⚠️ **An upload that times out is not an upload that failed.** Nothing was ever lost — the same
photo was stored repeatedly.

`uploadImages` inherited the **global 15 s** `REQUEST_TIMEOUT_MS` from `services/api/index.ts`.
That is a *JSON* timeout; a 2–5 MB photo on a weak cell routinely exceeds it **while the server
stores it perfectly**. `processQueue` caught the client-side abort, incremented `retryCount`, and
re-sent the identical file — up to `MAX_PHOTO_ATTEMPTS` (5). 4 photos × several attempts each is
exactly the 4 → 9 the rep saw, and the count kept moving because retries were still draining.

⚠️ **The count going DOWN (9 → 7) is not the bug healing.** It is a later `refetchQueries`
replacing an optimistic list with the server's — the duplicates are real rows either way.

⚠️ The pre-upload `existingUrls` snapshot in `uploadItem` looks like a duplicate guard but is
**not** one — it feeds `matchUploadedPhoto` for cache adoption and logging only, and nothing ever
consulted it before sending.

### The fix: three layers, and they are not alternatives

1. **`PHOTO_UPLOAD_TIMEOUT_MS = 120_000`** on `LeadService.uploadImages`, which makes the
   ambiguous window rare. ⚠️ The installer queue **already used 120 s** — only this queue was
   left on the global 15 s. Worth remembering when adding any new multipart call: the global
   `REQUEST_TIMEOUT_MS` is a JSON timeout and is wrong for images.
2. **A stable idempotency key** (`utils/upload-idempotency.ts`), which makes a retry inside that
   window harmless. Only this actually closes the hole, and it needs the server to honour it —
   backend has agreed; spec sent separately.
3. **Treating a duplicate-key rejection as success** in the queue.

⚠️ **Scope: `PUT demo/v1/leads/:leadId/images` only.** The installer queue
(`POST installer/v1/:jobId/images`, `utils/installer-upload.ts`) has the **same defect** — a
timed-out attempt re-sends the image, and ⚠️ its `isRetryableUploadError` returns false for 409
so a duplicate rejection would fall through to `failed(attempt)`, marking a safely-stored photo
as failed. It was deliberately left alone so one endpoint ships at a time. The helpers in
`upload-idempotency.ts` are endpoint-agnostic and can be adopted there unchanged; the key just
needs a stable per-image local id (`photo.id`, minted at capture) and the phase folded in so
pre- and post-install shots of one tag stay distinct.

### `utils/upload-idempotency.ts`

Pure module (CLAUDE.md §6 — the queue imports react-native / blob-util). 17 tests.

- Sent **twice per request**: the `Idempotency-Key` header *and* an `idempotencyKey` form field.
  ⚠️ Mobile proxies strip unexpected headers from multipart bodies more readily than form
  fields, and this bug only shows up on exactly those networks.
- ⚠️ **The key must derive from the item's persisted identity — never the attempt, the clock or
  a random value.** `photoIdempotencyKey` uses `item.id`, minted at enqueue and persisted to
  MMKV, so it survives retries, restarts and a cold drain days later. *A key regenerated per
  attempt is not an idempotency key, it is just a slower duplicate.* A test asserts two calls
  return the identical string.
- ⚠️ `subcategory` is deliberately **not** in the key. Two photos in one slot are two photos; a
  re-shot "Back Left" must still upload. Over-deduplicating loses a photo at a door, which is
  the worse failure.
- Returns `null` rather than fabricating a key when there is no stable id — no key is better
  than a key that isn't stable.

### ⚠️ A duplicate-key 409 is a SUCCESS

`uploadQueue.ts` calls `isDuplicateUploadResponse(err)` **before** its failure handling, then
removes the item and cleans up the file instead of parking it.

Parking a safely-stored photo tells the rep to retake a door they already shot.

⚠️ **The match is narrow on purpose.** It requires 409 **and** an idempotency-flavoured
`code`/`message`. A bare 409 is NOT swallowed — `resolveAppointmentId` returns a 409 for
"lead already has an appointment", and silently treating unrelated conflicts as success would
hide real failures.

`isIdempotentReplay(response)` reads an advisory `idempotentReplay: true` for logging only.
⚠️ Correctness must not depend on the server setting it.

### ⚠️ `data.code`, not `code` — the backend envelope

The backend's responses all go through one helper emitting `{ code, message, data }` where
**`code` is the HTTP status as a NUMBER**. Our first spec asked for `code: "IDEMPOTENT_REPLAY"`,
which would have broken that contract across their whole API. The agreed shape is:

```json
{ "code": 409, "message": "Idempotent replay: ...", "data": { "code": "IDEMPOTENT_REPLAY" } }
```

`isDuplicateUploadResponse` therefore checks `data.code` **first**, then a *string* `body.code`,
then the message. ⚠️ A numeric `body.code` is ignored on purpose — an envelope carrying
`code: 409` must never be read as a marker, or every 409 from this API becomes a silent
"success". The message match is kept only so a server shipping before us is still understood;
⚠️ message text is not a contract and must never be the only thing we match on.

### The second caller: Image Annotation

⚠️ `utils/uploadQueue.ts` is **not** the only path to `PUT demo/v1/leads/:leadId/images`.
`screens/ImageAnnotation/index.tsx` uploads annotated copies through `useUploadImagesMutation`,
and was unprotected. `useUploadImagesMutation` now takes an optional `idempotencyKey`.

⚠️ **The risk there is a different one and needs a different key.** There is no retry loop in
the annotation screen — its catch logs and moves on — so the exposure is an axios-level
retransmit or a double-tap of Save, not a 5-attempt burst. `annotatedPhotoIdempotencyKey` keys
on the **rendered temp file** (`annotated_<ts>_<index>.jpg`), which is minted once per render.
That makes it stable for one save and ⚠️ **deliberately different when the rep annotates the
same source photo again** — that is a new upload, not a duplicate. Keying on the source photo
id instead would silently swallow the second annotation.

⚠️ Its loop sends **one request per image**, so one key still gates exactly one photo. That
invariant is what lets the backend key on the whole request; if any caller here ever batches,
the backend contract breaks (they log a warning when a key arrives with >1 file).

### Still outstanding

Existing duplicates in live records predate the fix and need a one-off backend cleanup.

⚠️ **The backend proposed grouping on `(leadId, subcategory, timestampTaken, coordinates)`,
reasoning that those are capture metadata. They are not.** We send
`timestampTaken: item.timestamp`, and `addToQueue` sets that to `new Date().toISOString()` **when
the photo is ENQUEUED** — never re-stamped on retry. So it does group retries (the value is
frozen on the queue item), but two genuinely different photos enqueued in the same burst can
share it, and `coordinates` won't separate them because both come from one GPS fix at one door.
Grouping on it would delete real photos. They were told to use S3 `HeadObject` (size + MD5) as
the primary identity and the quadruple only as a pre-filter.

⚠️ A cleanup group larger than 5 is suspicious — `MAX_PHOTO_ATTEMPTS` is 5, so a retry run
cannot exceed it.

## The check-in log that logout deleted

`utils/session-scope.ts` (`SESSION_KEEP_KEYS`), `services/offlineActivityLog.ts`.

Reported with the `[LeadSync]` / `[CheckInTrace]` diagnostics on a device. A rep started an
appointment **offline**, came back online, and:

- the lead's status DID change to "Resume Appointment";
- **no `lead_check_in` ever reached the server**;
- after a logout/login the lead read "Start Appointment" again.

The trace showed the log was captured correctly — `[CheckInTrace] logEvent lead_check_in
online=false queueable=true` — so it was held in `offline_activity_logs` as designed.

⚠️ **Logout deleted it.** `resetSessionStorage()` clears every MMKV key that is not in
`SESSION_KEEP_KEYS`, and that set listed only `offline_lead_work` and `upload_photo_queue`. The
`work` PUT therefore survived (hence "Resume"), while the check-in log, the workflow marks, the
photo deletes, the map filters and the delivery preference were all wiped — **five queues**, each
holding work the rep had already done.

⚠️ **Any owner-scoped queue MUST be listed in `SESSION_KEEP_KEYS` when it is added.** Every one of
them already filters by `ownerId` on replay (`replayableLogs`, `replayableFilterWrites`, …), so
keeping the key is safe for the next login — a different user never sees another's rows. Clearing
it is what loses work. This is the single easiest way to silently destroy a queue: the queue code
itself looks perfectly correct.

⚠️ **The reset hooks are NOT the bug and must stay.** They clear the in-memory copy and set
`loaded = false`, which forces a re-read from MMKV on next use — the behaviour `offlineLeadStore`
has always relied on. Removing them would leave one login's rows in memory under the next.

Also fixed: `queueActivityLog` now drains on enqueue when already online, as the other queues do.
A log held during a BRIEF dropout previously waited for the next `onReconnect`, which may never
come in that session.

⚠️ A first device cannot verify this. `markLeadCheckedInOffline` is a local display mark, so the
status looks right there either way — check the portal's Forever Record, or a second device.

### Follow-up — the queue was kept, but still never drained

Two devices, one lead: the iPhone that started the appointment offline showed "Resume"; a second
device logging in as the same rep showed "Start". **The second device is the only honest one** —
`markOfflineCheckIn` is a LOCAL overlay (`applyOfflineWorkflow` rewrites `workflowState` on the
device that queued it), so the first device looks correct whether or not anything reached the
server.

Keeping the key (above) stopped logout deleting the queue. Two further faults stopped it draining:

⚠️ **`onReconnect` is not enough on its own.** `startActivityLogSync` only drained on reconnect
plus once at mount. A rep who reconnects, kills the app, and reopens it **already online** never
gets a reconnect event, and the mount drain races `initialize()` setting the session owner and
token. `offlineLeadStore` has always had three triggers — `onReconnect`, `AppState` 'active', and a
60s sweep — and the activity log now has the same three. Any new queue should.

⚠️ **"No session yet" was burning the retry budget.** `settleQueuedLog` discards an entry after
`MAX_LOG_ATTEMPTS` (5), and the sender throws `no session to replay an activity log with` when the
token has not been restored yet. That counted as a real failure, so a handful of launches could
**silently destroy a check-in the rep genuinely made**. `drainActivityLogs` now returns early
without a session owner or token rather than letting the sender throw.

⚠️ Do not read "the `work` PUT returned 200" as "the lead is checked in". They are different
writes: `PUT lead/v1/{id}/work` records who is working the lead, and the `lead_check_in` activity
log is what the portal's Forever Record and the lead's own history show. A lead can have one
without the other, which is exactly the state this ticket was reported in.

## The lead RELEASE had no queue (only half of "leaving a lead" survived offline)

`utils/offline-lead-work.ts` (the `workEnd` step), `services/offlineLeadStore.ts`
(`queueLeadWorkEnd`), `utils/lead-work-session.ts`. Endpoint:
`PUT lead/v1/{leadId}/work` with `{ workStartedBy: null }`.

Leaving a lead sends two things: the `lead_session` / `session_pause` activity log, and the work
release. Asked to confirm the fix worked online AND offline, only the log did:

| | Offline |
|---|---|
| pause log | queued — `lead_session` is in `QUEUEABLE_LOG_MODULES` |
| work release | **lost** — `endWorkLead` is a bare PUT, the caller caught the throw |

⚠️ **The rep stayed live on the ops board permanently.** Nothing retried it: the stale-session
sweep clears the stored session *before* the call, so once it failed there was no record left to
sweep. A rep leaving a door with no signal looked busy on that lead until someone intervened.

The release is now the `workEnd` step on the existing lead-work queue rather than a sixth queue —
it is the same full-state PUT on the same endpoint the start already uses.

⚠️ **Ordered `work` → `chat` → `workEnd`.** `chat` must stay immediately after `work` (it mirrors
the online flow, and a test asserts it); the release goes after both, so a start and an end queued
in one offline stint replay in the order they happened.

⚠️ **`workEnd` is lead-state, not a document step.** It belongs after `consent` in `UPLOAD_STEPS`
for the same reason `work` and `archive` do — releasing the rep must never hold a signed form or a
sale behind it.

⚠️ **Skipped once `submit` is set.** A sold lead is submitted, not released; `submit` carries the
final state.

⚠️ **`lead-work-session.ts` must stay RN-free** (CLAUDE.md §6). Importing `offlineLeadStore` or
`services/connectivity` into it pulls in netinfo and the whole suite stops loading — which is what
happened on the first attempt. It takes the queue through `setWorkReleaseQueue`, registered by
`offlineLeadStore` at module load.

### Ticket — "one bar": a connection that is alive but unusable

Client video: a rep on **1 bar of 5G** sat on "Loading calculator…" indefinitely. He described it
as a "1 signal issue" and he was right about the cause.

⚠️ **ONE BAR IS WORSE THAN NO BARS, and that is the whole bug.** Every offline path in this app
is reached THROUGH failure: a request dies → `transportError` → `/health` probe → offline →
cached copy. On one bar nothing ever fails. The phone is attached to a tower, the socket opens,
the request just crawls. No failure, no signal, no probe, no fallback. **Airplane mode worked
better than one bar.**

**Why `/health` was never called** (the backend dev asked us to verify this, so it is recorded):
`reportRequestSignal` runs only in the axios response/error interceptors, and `shouldProbe` admits
only `transportError`. A hanging request reaches neither interceptor. With the old 120 s timeout
and `FAILURES_BEFORE_LEAVING_ONLINE = 2`, the earliest possible probe was **4 minutes** in. The
debugger showed nothing because there was nothing to log. `recheckNetworkNow` was also **dead
code** — defined, never called.

**The fix: judge a request while it is still running.** `utils/slow-request.ts` holds an
`InFlightTracker`; `beginRequest`/`endRequest` bracket every call from the axios interceptors, and
a request still open after `SLOW_REQUEST_MS` (3 s) fires the probe directly.

⚠️ **The probe must skip its own URL** (`isProbeUrl`), or a slow probe triggers another probe.

⚠️ **One timer for the whole batch, not one per request.** It only has to notice that *something*
is stuck; a timer per request on a busy screen is pure overhead.

**Timeout 120 s → 15 s.** 120 s is what the rep actually waited, twice, because TanStack retries
once. A request unanswered that long on a field device is not coming.

**Three banner states, not five.** The backend dev proposed a five-bucket latency table
(Healthy/Degraded/Weak/Very weak/Offline). Measured `/health` on `api.np.revdsm.com`: **warm
median 239 ms, p90 358 ms, max 606 ms — but 1018 ms cold**, nearly all TLS handshake. The probe
uses bare `fetch`, outside the axios pool, so it pays that cold cost often. A 350 ms "Healthy"
ceiling would have misfired on **17%** of requests on a *good* office connection. `utils/
connection-banner.ts` keeps three states, because the rep can take exactly three actions.

⚠️ **The weak banner never says "offline".** The rep can still work; "offline" sends them hunting
for signal instead of carrying on.

⚠️ **Hysteresis is asymmetric** — `BANNER_WORSEN_MS` 600 ms, `BANNER_RECOVER_MS` 4 s. Warning is
cheap; clearing a warning while the line is still flapping is what makes a strip nobody reads.

⚠️ **`degraded` still counts as offline for `useIsOnline`** (19 consumers). That is deliberate and
was not changed: a weak line should route writes to the queues exactly as a dead one does.
`useNetworkStatus` is the hook for anything that needs to tell the two apart.

### Follow-up — the strip keeps the original amber

Reviewed on device and corrected. The first cut gave **offline** a slate-grey bar (`#E2E8F0`
on `#334155`) and reserved amber for **weak**. Rejected: slate reads as disabled chrome, so the
eye slides straight off the one state that most needs reading.

⚠️ **Offline keeps `#FFF1C6` on `#7A4100`, 11pt weight 600 — do not restyle it.** That is the
app's established "read this" bar and it predates this ticket; the only change to the offline
state is two words of copy.

⚠️ **Weak is a LIGHTER AMBER (`#FFF8E4`), never a second hue.** Same family on purpose: it is the
same kind of message one step less urgent, and a rep should not have to learn two colours to read
one strip. The foreground stays `#7A4100` so both states are legible against either background.

⚠️ **One text weight, not a bold title plus a lighter detail.** A weight split inside an 11pt line
reads as two separate messages. `bannerFor()` returns `title` and `detail` separately so the rule
stays testable, and the component joins them into one sentence (`"${title}. ${detail}"`) in a
single `<Text>` — the split is for the tests, not for the eye.

### Follow-up — three ways the one-bar fix would still have failed on a weak radio

Found by re-reading the first cut against a *weak* radio rather than a *dead* one. All three
were latent: the logic was right for "no signal" and wrong for "bad signal", which is the case
the ticket exists for.

**1. A slow probe reported the server DEAD.** `PROBE_TIMEOUT_MS` was 2 s, but measured cold TLS
to the live API is **1.0–2.4 s on a good wired line** and the handshake is most of it — on one
bar it routinely exceeds 2 s. An aborted probe returns `false`, and `applyProbeResult(false)`
**force-settles to offline**, skipping the dwell. So the rep with a working-but-weak line was
told they had none. Timeout is now **6 s**.

⚠️ **`false` from the probe means UNREACHABLE, never "slow".** Anything that cannot tell the two
apart must not return `false`. `probeHealth` now returns `true | 'slow' | false`
(`PROBE_SLOW_MS` = 1.5 s), and `applyProbeResult` maps both `true` and `'slow'` to **degraded** —
only `false` reaches offline.

**2. One probe per stall, and the first is the likeliest to be lost.** `beginRequest` armed the
timer only `if (!slowTimer)`; the timer nulled itself when it fired. Nothing re-armed it, because
the screen is blocked — no new request comes through `beginRequest`. `armSlowTimer()` now
re-arms itself while anything is still stuck.

**3. The re-arm was then eaten by the throttle.** `PROBE_MIN_INTERVAL_MS` is 20 s, which outlives
the whole 15 s stall, so every re-probe returned `null`. Added `PROBE_STALL_INTERVAL_MS` (4 s),
passed by `probeAndApply(stalled = true)`.

⚠️ **The stall throttle must stay well under the axios timeout.** If it ever creeps above
`15 s − SLOW_REQUEST_MS` the re-probe silently stops happening and the behaviour reverts to one
probe per stall, with nothing failing to show it. A test pins this relationship.

**Verified across both radios.** TLS needs ~3 RTT before first byte; at edge-of-cell LTE
(~1.2 s RTT) a cold probe lands ~3.8 s — inside the 6 s timeout, correctly reporting `'slow'`.
5G at one bar (~300 ms RTT) lands ~1.05 s and reports quick.

### The drain must not leave a photo in neither set

A follow-up to the duplication ticket above, from the same reports: **"during uploading the
number changes — I uploaded 4 images, it becomes 3, then a second later 4 again."** The UI side
of this (the counter, and a spinner that never stopped) is in
[`lead-center.md`](lead-center.md); what belongs here is what the queue now guarantees.

Every surface that counts photos counts `server salesPhotos + queued items`. That arithmetic is
only correct if a photo is in at least one of those sets at every instant. It was not: the queue
item is dropped the moment its PUT resolves, while the server list changes only when a refetch
lands.

**1. `refetchQueries` is awaited inside `uploadItem`, before `processQueue` calls
`removeItem`.** ⚠️ **Do not make this fire-and-forget to "speed up the drain"** — the await *is*
the fix, and on a weak cell the window it closes is seconds long, not milliseconds.

**2. `recentlyCompleted` covers the residual lag.** Even an awaited refetch can resolve with a
list that does not yet contain the new photo (read-after-write on the backend). The manager
therefore keeps a short list of just-drained slots, exposed as `getRecentlyCompleted()`, which
`JobDocsSection` counts as `settling`.

⚠️ **Recorded BEFORE `removeItem`, not after.** `removeItem` calls `notifyListeners`, so a
listener running between the removal and the record would observe the exact dip being fixed.

⚠️ **Bounded by `RECENTLY_COMPLETED_TTL_MS` (60 s)** via `pruneRecentlyCompleted`. A row that
never arrives must stop being claimed, or the count silently overstates what the office will
actually receive — a worse failure than the flicker, because nothing visibly goes wrong.

⚠️ A settling slot must stop counting **as soon as its server row appears**, or the count
flickers *upward* instead. The dedupe is by **slot**, not by file identity, because the queue
item and the server row describe the same photo with different ids.

Rules and tests: `utils/photo-upload-progress.ts` (20 tests), including a monotonic-sequence
test asserting the count stays 4 through all six stages of the handover.

---

### Activity-log runtime trace (2026-10-14)

- **Runtime trace (dev builds only):** `offlineActivityLog.ts` prints `[ActivityLogQueue]` lines when a drain starts (count + per-lead
  totals, then each log, then the ones held back for an unsynced lead), the exact body of every upload, and `OK` / `FAILED` / `401`
  per log. Payloads go through `sanitizeForLog`. `dumpActivityLogQueue()` (also on `globalThis`) prints what is queued right now.

### Follow-up - the runtime trace now prints each log's server response (2026-10-15)

Ticket: *console the payload AND the response of every log while the offline queue syncs.* `sendLog` (`services/api/LoggerService.ts`)
used to discard the `POST /user-activity-log/v1/create` reply; it now returns `{ status, data }` and the drain in
`services/offlineActivityLog.ts` prints it under the exact body it sent (`OK` + `response <status>: ...`, or `FAILED` + `response body: ...`
from `e.response.data`, so a backend rejection shows its reason).

- ⚠️ Dev builds only (`__DEV__`), and every payload/response goes through `sanitizeForLog` (strings over 512 chars print as `<string N chars>`).
  Do NOT print the raw body: a document or base64 field would flood the CDP socket (see CLAUDE.md §6).
- ⚠️ The return value of `sendLog` is only read by the replay sender; fire-and-forget callers ignore it, so keep it side-effect free.
- Not traced: the lead-work queue (`offlineLeadStore`) and the photo queue (`uploadQueue`) - separate queues with their own requests.

### Follow-up - the photo log must carry the photo (2026-10-16)

Ticket: *an offline lead's photos are logged but the images do not show on the portal.* The portal draws a `photo_uploaded` /
`annotated_photo_uploaded` log from `meta.imageData.s3url` (+ `image_url`), written in `uploadQueue.logUploadSuccessAsync` after the upload.

- Cause: the row was found by category + subcategory + "not on the lead before the upload". After an offline sync that failed twice over:
  the pre-upload `workLead` fetch can fail, leaving `existingUrls` empty (so an OLDER photo of the same slot matched), and the 5-poll lookup
  (about 15 s) gave up while the server list lagged, then **sent the log with `s3url: ''`**.
- Fix (`utils/uploadQueue.ts`): `pickUploadedPhoto` matches first on the `timestampTaken` the upload sent (the server stores it verbatim, so it
  names this photo), then the old slot rule. The lookup now waits up to ~2 min (`1,2,3,5,5,10,15,30,60 s`) for the row before logging.
- Same ticket, one key: the `annotated_photos` logs in `ImageAnnotation` and the delete log in `useDynamicInspectionCapture` now carry
  `meta.occurredAt` instead of `meta.timestamp`.
- ⚠️ The log is still fire-and-forget: if the app is killed during the wait it is lost (the photo itself is already uploaded). A log with
  an empty `image_url` after ~2 min means the row never appeared on the lead - look at the upload, not the log.
- ⚠️ Do not go back to matching on category/subcategory alone. `pickUploadedPhoto` needs React Native to load, so it has no jest test.

### Follow-up - Investment Center completion: logs must not be held forever or overwritten (2026-10-16)

Ticket: *a lead completed through the Investment Center loses logs / images / agreement / order sheet offline, while the Deal Center path is fine.*
The Investment Center hands off to the SAME `DynamicDealCenter` -> `ResultJobModal` -> funding -> job builder screens (`resultOptIn` nav param), so the
log builders are shared. What differs is that `InvestmentCenter/index.tsx` mounts its OWN `useDynamicCalculators` and stays mounted under the Deal Center.

- A log naming a device id nothing can resolve blocked every later log of that lead for good (`nextSendableLog` holds the lead). Holding now applies only
  while offline work is still waiting to upload (`setActivityLogHoldPolicy` -> `uploadableWork(mine()).length > 0`, registered in `offlineLeadStore`). Once
  nothing can create the id, the log is sent as it is rather than lost behind it.
- The Investment Center's hook copy saved its stale tabs over the device record when it unmounted (`useDynamicCalculators` cleanup). The unmount flush now runs
  only when that instance has a pending change (`offlineDirty`).
- ⚠️ A work stuck `failed` / `needs-review` is not "uploadable", so its logs are released with the device id. They arrive on the server but under an id it
  does not know; fix the stuck work, not the policy.
- ⚠️ Not found in the code: any Investment-only log builder or document path. If logs are still missing, read the dev `[ActivityLogQueue]` output of one
  Investment run: the "held back" block names the id that is not resolving.

### Follow-up - the offline lead check-in log from the Zone Canvasser (2026-10-16)

Ticket: *`lead_check_in` log missing offline.* Offline, "start appointment" writes the check-in log only when the geofence plan (`planStartAppointment` /
`planZoneCanvasserStartAppointment`) says the rep is in range. A lead created offline has no coordinates until it syncs, so the plan finds it out of range and
logs nothing. `screens/Leads` already treated a lead created at the door (`createdAtTheDoor`) as a check-in; `widgets/modals/ZoneCanvasserMap.tsx` did not.

- Both screens now ask `offlineCheckInModule(plan, atTheDoor)` (`utils/offline-lead-work.ts`, tested in `tests/offline/offline-activity-log.test.ts`), so the
  rule lives in one place: the plan's module wins, and an at-the-door lead falls back to `lead_check_in` (which also queues the work-start).
- ⚠️ `lead_review` must not queue a work-start or mark the lead checked in; both callers keep that guard.
- Online is unchanged: `executeStartAppointmentFlow` logs from the same plan, and the lead already has coordinates there.
