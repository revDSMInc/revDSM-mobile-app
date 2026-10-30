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

### A rollout log survived a Wi-Fi sync and vanished on mobile data (2026-10-20)
Files: `utils/network-error.ts` (`NETWORK_MESSAGE_RE`), `utils/offline-activity-log.ts` (`rekeyQueuedLogs`),
`services/offlineActivityLog.ts` (`persistResolvedPayload`), `services/offlineLeadStore.ts` (re-key at the step funnel).
Tests: `tests/offline/network-error-cellular.test.ts`, `tests/offline/activity-log-rekey-deep.test.ts`.

Reported: *"create a lead offline and sync on Wi-Fi — logs generate correctly; create a lead offline and
sync on mobile data — this log is missing."* The sample was a `rollout_and_drop` / `end price entered`
log carrying `queuedOffline: true`. **Three independent defects, each on its own sufficient, and all three
invisible on Wi-Fi.** The queue, the hold policy and the one-id-per-log work from the earlier tickets were
all correct; these sit underneath them.

| # | Was | Fix |
|---|---|---|
| 1 | `NETWORK_MESSAGE_RE` recognised `timeout` / `aborted` / `econn` / `socket`, but **not** the wordings a dying *cellular* socket actually produces — `connection reset`, `connection closed`, `connection refused`, `stream was reset`, `broken pipe`, `unexpected end of stream`, `software caused connection abort`, `no address associated with hostname`, `host is unreachable`, `network is unreachable`, `handshake`/`ssl`/`tls`. None carries an axios `code` on RN, so there was nothing else to recognise them by: they fell through to `'rejected'`, **spent one of `MAX_LOG_ATTEMPTS` (5), and the fifth one DELETED the log** | The regex covers them, so they classify `'transport'` → the log is kept, unchanged, attempts untouched |
| 2 | `rekeyQueuedLogs` rewrote **only `meta.leadId`**. A rollout log also names `meta.calculatorId` and `meta.appointmentId`, which are device ids (`calc-...`, `appt-...`) offline. An unrepaired one keeps `hasUnsendableClientId` true, so the log stays held — and `nextSendableLog` holds back **every later log of that lead** with it | `swapIdDeep` matches **by value at any depth**, so a new id-bearing field needs no change here. `rekeyActivityLogs` is now also called for the appointment and every calculator id, at the **single step funnel** in `uploadOne` rather than per step |
| 3 | The send-time resolver repaired only the **copy going out**; the stored MMKV row kept its device ids. On Wi-Fi invisible (first send succeeds, row deleted). On cellular the send fails, the row is read again, still stale — and once the minting work has finished, the hold policy has gone false and the row is **released carrying a counterfeit id**, which the backend drops | `persistResolvedPayload` writes the repair back onto the stored row before sending |

- ⚠️ **Wi-Fi is not a weaker version of cellular, it is a different failure distribution.** Every one of
  these needs a *failed send that is later retried* to show at all; on office Wi-Fi the first POST
  essentially never fails, so the row is deleted before any of the three can bite. Testing the offline
  queues on Wi-Fi proves almost nothing about them.
- ⚠️ **An omission in `NETWORK_MESSAGE_RE` is a LOST LOG, not a cosmetic issue.** It is the only thing
  separating "keep forever" from "spend an attempt, then delete". Add a wording when in doubt — a
  real HTTP answer is recognised by its **status**, which is checked first and always wins.
- ⚠️ **`isTimeoutError` must NOT inherit the widened wording.** It answers a narrower question (did this
  specific request time out) and is used for retry/backoff decisions elsewhere; a `connection reset` is
  not a timeout. Tested explicitly.
- ⚠️ **Re-key by VALUE, never by field name.** The previous version named `leadId`, which is why the
  calculator and appointment ids were missed for so long: each new id-bearing field would have needed
  another line, and nothing fails loudly when one is forgotten.
- ⚠️ **The resolver is not a substitute for a re-key.** It is not persisted, so it repairs exactly one
  attempt. The two are complementary: the re-key fixes the row when the id is minted, the resolver covers
  a row whose id was minted by work this device no longer holds.
- This is the **fifth** queue-shaped bug caused by a client id outliving its row (see the "any queue that
  can hold a row for an offline-created lead needs a re-key" note above). The deep swap is the version of
  that rule that does not need remembering.

### Activity logs: one stable id per log, so a retry is not a second row (2026-10-16)
Files: `utils/offline-activity-log.ts` (`newActivityLogId`), `services/api/LoggerService.ts` (`logEvent` stamps `payload.user_activity_log_id`). Test: `tests/offline/offline-activity-log.test.ts`.

| Was | Fix |
|---|---|
| A send that timed out (15 s) but that the server finished was retried or re-queued, and every attempt added a row: one check-in showed 5 times (= `MAX_LOG_ATTEMPTS`) on the Forever Record | `logEvent` makes ONE v4 UUID per log. The held, retried and failure re-queued copies all spread the same `payload`, so they carry it. The backend stores a log once per `user_activity_log_id` and answers a repeat with the stored row (200) |

- ⚠️ **Make the id in `logEvent`, never in `sendLog` or the drain** — an id made per attempt is a new log every time, i.e. the bug.
- ⚠️ The id must stay a **v4 UUID**: the backend ignores anything else and generates its own. An older backend simply accepts the field as the row's id.
- `leads.ts` `logUserActivity` posts without an id and is not queued; it is unchanged.

### Offline-created lead: the real creation time goes up with the lead (2026-10-16)
Files: `services/offlineLeadStore.ts` (`runStep`, case `'lead'`).

| Was | Fix |
|---|---|
| A lead made offline was created on the server only at sync, so the Forever Record's Lead Origin showed the reconnect time (7:04) for a lead made at 6:55 | The `lead` step adds `leadCreationTimestamp: work.createdAt` (ISO UTC) to the create body when `work.origin === 'created-offline'`. The backend already read that field; it now keeps it if it is not in the future and not older than 30 days, else it stamps its own clock |

- ⚠️ **Online creates send nothing** — the server stamps them. Do not add the field to the online `LeadCreate` payload.
- ⚠️ It must stay an ISO string **with `Z`**: the backend parses a bare string in the office timezone.
- Leads already on the server, and uploads from older app builds, keep the backend's fallback (check-in time, self-generated leads only).

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

## The Today tab showed YESTERDAY's offline leads (2026-10-22)

`utils/offline-lead-work.ts` (`offlineLeadsForTab`, `isSameLocalDay`) + `screens/Leads/index.tsx`.
Tests: `tests/offline/offline-leads-today.test.ts`.

Reported with two screenshots: *"when I'm online it shows me today's leads, but when I go offline it also
shows the old leads - I made those offline yesterday and it's showing them under Today. Today is the 22nd
and it's showing the 21st."*

**The two halves of that list are filtered by different rules, and only one of them knew about the day.**
The Leads screen renders `[...pendingOfflineLeads, ...serverLeads]`:

| Half | Day scope |
|---|---|
| Server leads | `apiParams` sends `{ status: 'selfGenerated', period: 'today' }` - the backend filters |
| Queued offline leads | `offlineLeadsForTab` filtered on deleted / uploaded / already-on-server... and **nothing else** |

So every un-uploaded lead ever created stayed pinned to Today until it synced. A rep with no signal for two
days saw both days piled together, with yesterday's dates printed on the cards. Online it never showed,
because an online lead is created on the server immediately and leaves the queue.

**Fix:** `offlineLeadsForTab` takes `todayAt`, and keeps only work created on that calendar day. The Leads
screen passes it on the TODAY sub-tabs and omits it everywhere else.

- ⚠️ **A CALENDAR day, not a rolling 24h window** (`isSameLocalDay`, not `AT_THE_DOOR_TTL_MS`). The tab's
  own caption says *"All Self Gen Leads will be archived end of day"*, so it must RESET AT MIDNIGHT. A 24h
  TTL would keep a lead made at 11pm yesterday on Today until 11pm tonight - the reported bug with extra
  steps.
- ⚠️ **Local time, deliberately.** It is compared against the rep's own clock and the server's
  `period: 'today'`, both of which mean the rep's day. Normalising to UTC would move the boundary by the
  offset and drop a lead made this evening in a UTC-negative timezone.
- ⚠️ **`createdAt` is a full ISO INSTANT, so `new Date()` is right here.** This is NOT the parse-dates-as-
  text trap in the root guide - that one is about bare `YYYY-MM-DD` strings being shifted by an offset.
- ⚠️ **`todayAt` is OPTIONAL and omitted off the Today tabs.** Archived / Sold / Rehash are not day-scoped;
  passing a stamp there would hide queued archived leads.
- ⚠️ **The lead is filtered from the TAB, never from the queue.** It is still `draft`, still syncs, and
  still shows on the pending-uploads banner (`PendingLeadsBanner` reads `activeWork`, untouched). Filtering
  it out of the work list instead would strand it forever - pinned by a test.
- ⚠️ **The day stamp is re-read on FOCUS, not once at mount.** A rep leaves the app open overnight in the
  truck; a stamp captured at mount keeps yesterday's date and the tab silently goes on showing yesterday.
  `useFocusEffect` only replaces it when the day actually changed, so the memo is not invalidated on every
  return to the screen.
- Work with an unparseable `createdAt` is excluded from Today (`createdAtMs` returns 0) but still returned
  wherever no day scope applies, so it can never be stranded.

### Follow-up — the offline lead card showed its date as N/A

`utils/offline-lead-work.ts` (`offlineWorkToLead`, `localDateOnly`).
Test: `tests/offline/offline-lead-card-date.test.ts`.

Reported with two screenshots of the SAME lead: the leads-list card showed **N/A** where the date goes,
while **Lead Center showed 10/22/2026**. Both surfaces were reading their own data correctly:

| Surface | Field read | Set by `offlineWorkToLead`? |
|---|---|---|
| `LeadCenter` | `lead.leadDatetime` | ✅ yes |
| `LeadCard` | `lead.leadDate` | ❌ **never** |

A SERVER lead carries both (`leadDate: "2026-10-22T00:00:00-04:00"` and
`leadDatetime: "2026-10-22T01:48:02-04:00"` - confirmed in a real device store), so the gap only ever
showed on a lead created offline. `offlineWorkToLead` now emits `leadDate` too.

- ⚠️ **It is NOT `work.createdAt` passed through.** The card formats with `new Date(lead.leadDate)`, and
  `createdAt` is a UTC instant - a lead made at 22:30 UTC on the 22nd renders as the **23rd** for a rep at
  +05:00. `localDateOnly` emits the LOCAL `YYYY-MM-DD`, so the card prints the day the rep actually made
  the lead. Same off-by-one class as the Today-tab ticket above, and it is deliberately solved the same
  way, so the card date and the tab filter can never disagree.
- ⚠️ **Date-ONLY, with no time and no `Z`.** It mirrors what the server sends (`...T00:00:00-04:00`
  parses back to local midnight). Appending a `Z` re-introduces the shift this exists to remove.
- ⚠️ **An ISSUED lead keeps `lfLeadDate`**, its scheduled appointment day - NOT the day the work item was
  created. Only a self-gen lead falls back to the creation day.
- An unparseable timestamp yields `''`, so `LeadCard` falls back to **N/A** exactly as before rather than
  printing `Invalid Date`.
- `LeadCard`'s memo already compares `leadDate`; the value is stable per work item, so this adds no
  re-renders.

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

### Documents signed offline are shown from the local file (2026-10-19)

The Lead Center side of this is the ticket in `docs/claude/lead-center.md`; recorded here because
`utils/offline-job-documents.ts` is part of the offline surface.

`addOfflineJobDocument` (`services/offlineLeadStore.ts`) already persists every offline document to
`DocumentDirectory/offline-job-documents/` and records it on the work item, so the bytes are on disk
from the moment the customer signs. Nothing read them back: the contract card resolves only
`lead.jobBuilderDocuments`, which the server fills, so a lead sold offline showed "0 Files".
`utils/offline-job-documents.ts` (pure, 20 tests) merges the queued copies into that view — no new
storage and no new request, since the file is already written, and `DocumentItem` opens a `file://`
PDF exactly like a signed S3 url.

⚠️ **A row with `uploadedAt` is never shown.** `markDocumentUploaded` calls
`discardOfflineDocumentFile` the instant the upload lands, so an uploaded row points at a path that
no longer exists. `pendingQueuedDocuments` drops it and the server copy takes its place. Do not
"fix" this by keeping uploaded rows — they open to nothing.

⚠️ **Queued rows are suppressed once the server has caught up** (`serverRows.length >=
queued.length`). During the sync window the same agreement exists in both places, and a plain
concat shows the customer two copies of one contract.

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

---

## Ticket — check-in showed "Resume" on one device and "Start" on another

> "I created a lead offline and became online — this phone shows Resume Appointment. I logged
> in on another device and the status had not changed, because the check-in was never called;
> it was showing from cache."

⚠️ **Not a merge regression.** The `!work.submit` guard in `isStepApplicable('work')` is intact
and deliberate (its explanatory comment was stripped by the "remove all comments" commit
`160ef22`, which is probably what made it look lost). The reported lead was **unresulted**, so
that guard was never involved.

Two faults, and the second hid the first:

1. The queued `work` call had genuinely not reached the server, so the second device was
   **correct** — the lead really was not checked in server-side.
2. The first device could not tell, because `applyOfflineWorkflow` painted `resume` from its
   own overlay for a full `OFFLINE_WORKFLOW_TTL_MS` (24 h) and **nothing could ever retire an
   entry** — there was no clear path anywhere in `utils/offline-lead-status.ts` or
   `services/offlineLeadStatus.ts`.

### The rule

⚠️ **The overlay stands in for a check-in the server has not heard about — it never offers a
second opinion about one it has.** Once the queued step drains it must go quiet and let the
server answer, *even when the answer is unwelcome*. A local guess that outlives the fact it was
guessing about hides the disagreement, which is worse than being wrong: the rep sees a
confident, stale "Resume" and never learns their check-in is missing.

### What changed

- `applyOfflineWorkflow` takes an optional `pending` predicate. ⚠️ Omitting it keeps the old
  behaviour, for callers that cannot see the queue.
- `hasPendingCheckIn(all, leadId)` (`utils/offline-lead-work.ts`) is that predicate, wired in
  `screens/Leads/index.tsx`. ⚠️ **It matches on BOTH `clientId` and `serverIds.leadId`** — a
  lead created offline is checked in under its client id and only later gets a server id, so
  matching one alone makes the overlay vanish the instant the lead syncs, which is the opposite
  error.
- `clearOfflineCheckIn` / `clearLeadCheckedInOffline` drop the entry, called from the `work`
  step's drain in `offlineLeadStore.ts` ⚠️ **under both ids**, for the same reason.

⚠️ The clear fires when the **`work` step** drains, not when the lead does — a lead can sync
long before the check-in queued against it.

⚠️ `clearOfflineCheckIn` returns the **same object** when nothing changed, so a drain for a
lead with no overlay does not trigger a write or a re-render.

### ⚠️ The ONLINE check-in failure was swallowed — the other half of this bug

The overlay fix above made the first device honest, but the check-in still never reached the
server. The missing piece was on the **online** path, not the offline one.

`isOfflineLead(item)` tests `lead.__offline`. Once a lead created offline has synced it comes
back from the server **without** that flag, so pressing Start Appointment takes the ONLINE
branch in `screens/Leads/index.tsx`. That branch called `executeStartAppointmentFlow`, and its
catch did only this:

```
catch (err) { console.log('Action Error:', err); navigate('LeadCenter', { lead: item }); }
```

⚠️ **A timed-out `workLead` was swallowed entirely.** The rep was navigated into the Lead
Center as though the check-in had succeeded; the server never learned they were on site; their
own card said "Resume Appointment" from the local overlay while a manager's said "Start
Appointment"; and the ops board never showed them at the door. Same rule as everywhere else in
this module: **an unanswered question is not a negative answer.**

The catch now queues the check-in exactly as the offline branch does
(`markLeadCheckedInOffline` + `queueLeadWorkStart`), gated on `plan.shouldCallWork` so a lead
that was never eligible is not queued.

⚠️ Safe to replay: the `work` step is a PUT of who is on the lead, classified `idempotent`.
Replaying one the server already received is harmless; losing one it never received is not.

⚠️ `queueLeadWorkStart` works for a synced lead because `adoptExistingWork` mints a record with
`status: 'draft'`, `serverIds.leadId` set and `done: ['lead']` — so the drain starts at `work`
rather than trying to re-create the lead.

## Ticket — "Weak connection" and "Offline" on a strong line

> "I have a strong connection and it shows me weak signal bar, and sometimes the offline bar.
> Mostly on mobile data, but sometimes on strong Wi-Fi too."

⚠️ **The probe was measuring the TLS HANDSHAKE, not link health.** Measured against the live
API (`https://api.np.revdsm.com/health`) from a good WIRED connection:

| | time |
|---|---|
| Cold request (new TLS handshake) | **~1.00 s** |
| — of which TLS alone | ~0.75 s |
| Warm request (connection reused) | ~0.25 s |
| Server processing | ~0.23 s |

`probeHealth` uses `fetch`, which does **not** share axios's connection pool, so nearly every
probe pays the full handshake. The server is fast; the measurement was not measuring it.

Against that, the old thresholds were wrong by construction:

- `PROBE_SLOW_MS` was **1,500 ms**, so a perfectly healthy app sat ~500 ms from the "Weak
  connection" warning and ordinary jitter crossed it → **1,500 → 4,000 ms** (~4× measured).
- `PROBE_TIMEOUT_MS` was **6,000 ms**. A congested handshake can exceed that, and ⚠️ **two
  aborted probes force-settle straight to OFFLINE past the dwell** → **6,000 → 10,000 ms**.

⚠️ **These are FALSE-POSITIVE budgets, not latency targets.** Being slow to notice a real
outage costs a few seconds of queued work that drains anyway; being wrong about it strands the
rep in front of a customer. Spend the time.

⚠️ **MEASURE BEFORE RETUNING.** `__tests__/utils/health-probe.test.ts` asserts both constants
against the measured cold cost (~1 s) so they cannot be tuned back down by intuition. If the
API's real latency changes, measure it and move the constants and those assertions together.

### Why mobile data showed it most, but Wi-Fi sometimes too

Cellular multiplies the handshake (higher RTT, more retransmits), so it crossed 1,500 ms
constantly. Congested or distant Wi-Fi crosses it occasionally — which is exactly the reported
pattern, and the thing that distinguishes this from a radio problem.

⚠️ Not changed, and deliberately: **a probe still never promotes to `online`.** `/health` is
unauthenticated and cheap, so it answers happily while the real API is failing — only a 2xx on
a real request proves we are being served. A genuine success clears `degraded` immediately
(`applyRequestSignal`), so the warning is not sticky once real traffic flows.

---

### ⚠️ The `pending` predicate was WRONG — a regression I introduced, now reverted

The first overlay fix gated `applyOfflineWorkflow` on `hasPendingCheckIn` — "the overlay only
speaks while the work step is still queued." It sounded right and broke the card a different
way.

⚠️ **The step completes the moment `workLead` returns 2xx, but the list is redrawn from a
SEPARATE read that can lag the write.** In that window the step was done (so the overlay was
suppressed) and the server list had not caught up (so it said "Start Appointment") — the card
flipped back seconds after the rep started, which is worse than the stale overlay it replaced.

The corrected model: **the overlay stands in for a check-in the server has not CONFIRMED, not
for one we have not yet sent.**

- `screens/Leads/index.tsx` passes **no predicate** — ⚠️ do not reintroduce one.
- The `work` step drain calls `refreshLeadLists()` **first**, then `serverSaysCheckedIn(leadId)`
  (a read-back of `workflowState` / `workStartedBy`), and only clears the overlay if the
  server agrees.
- ⚠️ `serverSaysCheckedIn` returns **false on a failed read**, which KEEPS the overlay. An
  unanswered question is not a negative answer, and the safe side is to go on showing the rep
  what they did.
- If the server never agrees, `OFFLINE_WORKFLOW_TTL_MS` still bounds the overlay, so it cannot
  outlive the day.

⚠️ The general trap: **"we sent it" and "a later read reflects it" are different facts.** Any
local overlay retired on the first will flicker on a connection slow enough to separate them.
The photo-count fix in this same file is the same lesson.

### Still true, and separate

The `work` step is still skipped for a **resulted** lead (`!work.submit`). That remains correct:
the result is the stronger statement about where the lead got to, and flipping a sold door back
to `resume` on the ops board is worse than not recording the check-in — which the activity log
has captured anyway.

---

## Ticket — a lead created offline could be created twice

> "I sold that lead in offline but one lead was created automatically at that time."

Same shape as the photo duplication: a create that **times out after the server already made
the lead**, retried, making a second one. The protection that should have caught it could not.

### ⚠️ Why the existing guard missed it

Lead creation was classified `unique-key` in `stepReplaySafety`: on an ambiguous failure,
retry only if the payload carries something the server will reject twice.

- An **Issued (LF)** lead has `lfLeadId` — unique server-side, so it was protected.
- A **Self Gen has nothing unique.** Two real leads can legitimately share a name and an
  address, so `hasServerUniqueKey` returns false for every one of them.

The rule therefore had nothing to test and fell through to `needs-review` — which **discarded
the rep's typed lead** while the create they could not see had often already landed. The same
gap was behind the separate report of a Self Gen vanishing on a timed-out connection.

⚠️ Telling detail: the **appointment** step has had a `findExistingAppointment` re-read before
creating all along. The lead step never had an equivalent.

### What changed (backend live 2026-10-16)

- `leadCreateIdempotencyKey(clientId)` — the key is the work's **own `clientId`**, minted once
  when the lead is queued and persisted with it, so a retry minutes or a week later sends the
  identical value. ⚠️ Returns `null` for an unqueued lead: an **online** create is never
  retried by the queue, sends no key, and keeps today's behaviour exactly.
- `LeadService.createLead(data, idempotencyKey?)` sends it as both the `Idempotency-Key`
  header and an `idempotencyKey` body field (mobile proxies strip unexpected headers from
  some requests).
- `stepReplaySafety('lead')` → **`idempotent`**. ⚠️ Only valid because the server honours the
  key. Reverting the server without reverting this turns an occasional duplicate into a
  reliable one.
- `resolveRetryDecision(outcome, payload, serverHonoursIdempotencyKey = true)` — the flag
  exists so the behaviour can be switched off in one place.

### ⚠️ The replay returns the lead, not a 409

Agreed with the backend deliberately. A photo replay only has to say "stored"; a **lead replay
must hand back the original `_id`**, because the appointment, calculators, photos and outcome
all attach to it. A 409 — which our client reads as "stored, drop it" — would have stranded
every one of them.

So: completed replay → **200 with the original lead** (`idempotentReplay: true`), and a create
still in flight → **503** with `data.code: "IDEMPOTENT_IN_PROGRESS"`, which is retryable.
`isIdempotentInProgress` matches on **`data.code`, never the status** — a generic 503 from a
load balancer is a different event and must stay an ordinary ambiguous failure.

### ⚠️ A duplicate error is still NOT success for a Self Gen

Unchanged, and the reasoning inverts once a key exists: the server **replays** a key it has
already seen rather than rejecting it, so a duplicate error on a keyed create is a genuine
collision, not evidence the first attempt landed. Only `lfLeadId` proves that.

⚠️ That `duplicate` branch is now scoped with `step === 'lead'` explicitly. It used to read
`safety === 'unique-key'`, which happened to mean the same thing; reclassifying `lead` broke
the coupling, and dropping the check outright made **every** step return `done` on a duplicate
whenever the lead carried an `lfLeadId` — an appointment collision says nothing about the
lead's unique key. A test caught it.

### Retention

⚠️ The spec first said 24 h, which was wrong: a parked lead is kept **indefinitely** and the
rep can retry it days later from Pending Uploads. Backend set retention above that window. A
retry after the key expires would create exactly the duplicate this prevents.

## Ticket — a queued lead that can NEVER drain (duplicate calculator title)

A lead sat in the pending list at **"Couldn't be uploaded — 1 of 3 uploaded"** showing the raw
server string *"LFCalculator title must be unique within this appointment for the current user"*.

The full diagnosis and the fix that prevents it are in `docs/claude/deal-center.md`; the queue
side is here. `POST /appointments/{id}/lfcalculators` answers **409** when two calculators in an
appointment share a title, which happens when a rep duplicates a tab (both copies price the same,
so `computeDerivedTitles` cannot separate them and marks the pair `⚠️ G ⚠️`).

⚠️ **This is a POISON ITEM: retrying cannot fix it.** Every other failure in the queue is worth a
retry — signal came back, the server was briefly down. This one replays a payload the server will
refuse identically every time, so **Try again** loops forever. The rep must open the deal and
rename a tab; nothing the queue does on its own will clear it.

`utils/calculator-title-conflict.ts` exports `describeQueueError`, now applied wherever the queue
prints `lastError` — `widgets/components/PendingLeadsBanner.tsx` and `screens/PendingUploads/`
(the status row and all three detail props). It replaces the server string with wording that says
to rename and that retrying will keep failing.

⚠️ The wording names **changing the products or deleting the spare tab**, never "rename": there
is no rename control in the UI, and the tabs are usually locked by then. See the trap in
`docs/claude/deal-center.md`.

⚠️ **It matches on BOTH "lfcalculator" and "title must be unique"**, not on the 409 status — the
status is not kept, only `lastError` is. Both halves are required so an unrelated 409 passes
through untouched; a translator that swallowed other failures would hide real errors behind
advice that does not apply.

⚠️ **The real fix is upstream** — the rollout is now blocked before such a calculator can be
queued (`onViewAll` in `DynamicDealCenterScreen.tsx`), so this message should only ever be seen by
leads queued by a build from before that guard.


## Annotated photos ride the upload queue (background, offline-safe Save)

Full write-up and UX rules: `lead-center.md` § "Annotation Save: background + offline-safe, NO loader". What belongs here:
- `UploadQueueItem` gained `annotation?: UploadQueueAnnotation` (`utils/uploadQueue.ts`). `mode: 'new'` is the normal `PUT demo/v1/leads/:id/images` plus the web's `annotations` field, still idempotency-keyed from `item.id`. `mode: 'reedit'` goes through `uploadAnnotationEdit` -> `PATCH demo/v1/leads/:id/images/:annotatedId/annotation` (multipart `file` + `annotationData`), no idempotency key because it overwrites in place.
- `services/annotationSaveService.ts` is a SECOND, short-lived queue in front of this one: it holds the marks + a durable original until the photo is flattened (`services/annotationRenderer.ts`, `utils/annotation-render-html.ts`), then calls `uploadQueueManager.addToQueue`. Its MMKV key `annotation_save_jobs` is owner-stamped and listed in `SESSION_KEEP_KEYS`.
- ⚠️ Re-edit success must forget the stale local cache (`forgetWarmedUri` on `staleUris`) and refresh `secureUrls` / `leads` / `leadAnnotations` / the lead: the s3url and file name do not change, so the cache path does not either.
- ⚠️ A re-edit does NOT run the add-style "poll for the new row" log (there is no new row); it logs `annotated_photo_updated` with the existing s3url.
- ⚠️ The job drain waits (no attempt spent) when the original is only a remote url and the device is offline; render failures are dropped after 3 attempts with a flash.

- **Follow-up - a re-edit adopts its new bytes into the image cache** (`uploadAnnotationEdit` in `utils/uploadQueue.ts`): after `forgetWarmedUri(staleUris)` it calls `adoptLocalFileAsCached(item.uri, staleUris[0])`, so the edited photo paints from disk the moment the lead refreshes, with no download and no spinner. ⚠️ forget THEN adopt - adopt does nothing when a cached file exists at that path. The UI side (pending cards shown before upload) is in `lead-center.md` § "Annotation Save".

- **Follow-up - the local JPEG is adopted under EVERY url form** (`UploadQueueManager.adoptUnderEveryUrlForm`, `utils/uploadQueue.ts`): the raw `resolveS3Url(s3url)` and the signed url from `getSecureUrls`, for a new annotation after the upload and for a re-edit. The card that takes over paints first from the raw url and then the signed one, and the cache is keyed by url, so a form left out is a download and a visible flicker. Best effort: a failure only logs.

### Install availability check is skipped offline (REVDSM-1300)
`useInstallAvailability` (used by `AppointmentSchedulerModal` and the My Deals edit wizard's install-date step)
reads `useIsOnline()` and does not call `installer/v1/installer-dispatch/availability` while the app is offline
or degraded. `availability` stays `null` and `loading` false, which every caller already treats as "no rules":
all windows are offered, with no spinner and no wait on a request that cannot succeed.

⚠️ Do not make offline booking depend on the scheduler. The server does not enforce windows today, so a booking
made offline is accepted whatever the crews' load is; the manager sees it afterwards on the dispatch board.

- **Follow-up - `annotationSaveService` changes for the order-sheet editor and the card handover** (`services/annotationSaveService.ts`):
  - `flattenMarks({ backgroundBase64, layoutWidth, layoutHeight, strokes, texts, shapes })` is now an exported helper (the render-input mapping that used to sit inside `processOne`). The photo job and the order-sheet editor (REVUIUX-569, `lead-center.md`) both call it, so the marks are drawn identically. ⚠️ An order sheet is NOT queued - it is flattened in the editor and handed to the caller's replace path; only photos ride `annotation_save_jobs` and the upload queue.
  - `getAnnotationJobs()` / `addAnnotationJobListener()` expose the live jobs so Manage Photos can draw a just-saved annotation before it is flattened (`usePendingAnnotations`).
  - ⚠️ A finished job's ORIGINAL file is no longer deleted at once: it is removed after `ORIGINAL_GRACE_MS` (30 s) and by `sweepOrphanOriginals()` at startup (unreferenced files older than a day), because the card keeps drawing the marks over it until the flattened image has painted. Do not move the unlink back to right after `processOne`.

- **Follow-up - the renderer rejects an empty export** (`services/annotationRenderer.ts`, `utils/annotation-render-html.ts`): the page caps the canvas long side at 3600 px and reports an error instead of an empty `data:,`; the service resolves only a real JPEG data uri. This also protects the photo-annotation job (a failed render is retried / dropped with a message, never queued as a blank photo). See `lead-center.md` (order sheet "corrupted" report).


### Follow-up - `annotationSaveService` gains `mode: 'orderSheet'` (REVUIUX-569)

An annotated ORDER SHEET rides the same durable job queue (`OrderSheetJobAnnotation`): after the flatten, `processOne` calls `services/orderSheetSync.saveAnnotatedOrderSheet` (PATCH `/lead/v1/outcome/document/:id/annotation`, with a "route not deployed" fallback) instead of `uploadQueueManager`. Offline it waits like the photo jobs (`!isOnline()` -> resume on reconnect, no attempt spent). ⚠️ Never the offline DOCUMENT queue - it would file a second sheet. Full write-up: `lead-center.md` § "REVUIUX-569 - the backend contract".

## Agreement configuration is warmed for offline (REVUIUX: Lighting description lines)

An agreement drawn on the device needs the layout (`agreement-config`) and each product's description schema (`description-schema:<productId>`, plus the list `description-schema-list` the Investment Center reads). They are now fetched ahead by `useWarmDealCenterConfig` (Leads screen) through `cachedFetch`, so they are on disk before signal is lost; `OFFLINE_CACHE.DESCRIPTION_SCHEMA_LIST` is new in `utils/offline-query-cache.ts`. A local agreement whose schema was never saved refuses to draw (`descriptionSchemaMissingOffline`). Full write-up, and the `[IF]` / `col:` evaluator port: `deal-center.md` § "Description-of-Work templates".

## Ticket — slow mobile data: lost logs and duplicate leads (the attempt budget)

Field report: working offline then reconnecting on **low-speed mobile data** lost the check-in,
rollout and pause/work logs, and QA saw **duplicate leads** after the sync. Both on cellular
only; Wi-Fi looked fine.

⚠️ **One cause: every failure spent an attempt, including a failure the network caused.** Each
queue caps retries at 5 (`MAX_LOG_ATTEMPTS`, `MAX_CREATE_ATTEMPTS`). On a weak radio five
consecutive timeouts are routine, so:

- `settleQueuedLog` (`utils/offline-activity-log.ts`) hit the cap and **deleted the log** —
  though the server never saw it and nothing was wrong with the payload. That is the missing
  check-in / rollout / pause entries.
- `applyStepDecision` (`utils/offline-lead-work.ts`) hit the cap and moved the work to
  **`needs-review`** — the state that asks the rep "is this on the server? retry if it is not".
  A rep who knows they created the lead taps retry, and **that** is the duplicate lead. The
  create itself is idempotent (`leadCreateIdempotencyKey(work.clientId)`), so the duplicate did
  not come from the replay; it came from the queue giving up and handing the decision to a human.

On office Wi-Fi five consecutive failures essentially never happen, which is why neither showed
up in testing — the same reason ticket 1310's lost log only appeared on 4G.

**The rule:** the attempt counter exists to stop something the server keeps **REFUSING** from
cycling forever. A timeout is not that — it is the same work, undelivered. Both settle functions
now take a `'transport' | 'rejected'` failure kind; a transport failure keeps the item unchanged
and spends nothing. Callers classify with `isNetworkError` (`utils/network-error.ts`), which
returns false whenever an HTTP status is present, so a real refusal can never be misread as
transport. Rules are pure, 14 tests in `__tests__/utils/slow-network-attempts.test.ts`.

⚠️ **Both default to `'rejected'`.** A caller that does not classify keeps the old counting
behaviour, so a new call site cannot silently make something un-droppable.

⚠️ **A transport failure does NOT rescue a definite decision.** `failed` and `needs-review` mean
the server answered; only `retry` / `retry-guarded` are exempted. Otherwise a poison item on a
bad radio would become immortal.

⚠️ **`needs-review` must mean "the server answered something we could not interpret", never
"the radio was weak".** It is the only state that asks the rep to judge whether their work
landed, and every wrong entry into it is a chance for a duplicate.

*Not changed:* `MAX_*_ATTEMPTS` stay at 5 — the cap is correct, it was being charged for the
wrong thing. Retries are still bounded by the drain's own stall tracking and the 60 s sweep.

### Follow-up — the check-in was never QUEUED (not a sync failure at all)

> "I created the lead offline and started working on it, I synced on mobile data and it synced
> successfully. I open the user on another phone and the lead was not even checked in. Why?"

The sync was fine. **Device B was right** — there was nothing to sync, because
`handleActionPress` (`screens/Leads/index.tsx`) had decided not to record the check-in. Two
independent ways it reached that decision, both silent:

**1. `createdAtTheDoor` expired the moment the lead uploaded.** It was
`origin === 'created-offline' && isStepPending(work, 'lead')`. The reported sequence is create
offline → the `lead` step drains on reconnect → *then* press Start Appointment. By then the
rescue no longer applied, so nothing overrode a geofence plan that had already said "out of
range". Now bounded by `AT_THE_DOOR_TTL_MS` (12 h) instead: uploading the row says nothing about
where the rep is standing, but re-opening the lead days later must still go back through the
geofence. ⚠️ That second half is load-bearing and has its own test — do not simplify this to a
bare `origin` check.

**2. An unknown location read as out of range.** `isLeadInGeofence` returns false both for "far
away" and for "no GPS fix yet", and `userLocation` starts `null` on the Leads screen and fills in
asynchronously. A rep tapping Start before the fix landed got `logModule = ''` →
`shouldCallWork = false` → no log, no `work` call, **nothing queued**. `countsAsAtTheDoor`
(`utils/location-util.ts`) now treats an unknown location as in range; both
`planStartAppointment` and `planZoneCanvasserStartAppointment` use it.

⚠️ **Not knowing where the rep is is not evidence that they are elsewhere.** The two mistakes do
not cost the same: a check-in wrongly recorded is a tidy-up, a check-in silently dropped loses the
visit with nothing left to show it happened. ⚠️ A REAL fix that puts the rep out of range still
says so — the geofence is not disabled, and that has its own test.

⚠️ **The rule lives in `location-util.ts` because `lead-activity-log.ts` cannot load under jest**
(it imports `LoggerService` → netinfo). `lead-activity-log` delegates; the tests drive the pure
module (`__tests__/utils/offline-checkin-reaches-server.test.ts`).

⚠️ **This was NOT the attempt-budget bug above.** That one lost logs that had been queued; this
one never queued anything. A queue fix can only replay what reached it — when a log is missing,
check whether it was ever enqueued before looking at the drain.

### Follow-up — a log sent ONLINE naming an id the server has never seen

> "Offline or online, the same APIs should be called — offline they go in the queue with the
> same payload. The check-in log api is not being called at all."

The right framing, and it exposed a case neither side of the gate covered. `logEvent` held a log
only when `isOnline()` was false. But the reported sequence is **create the lead offline, press
Start once the phone has signal** — online is true, so the check-in went straight out carrying

```
meta.leadId = "lead-1792411303110-ab12"   // a CLIENT id, known only to this device
```

The backend cannot resolve that, so the log was orphaned or refused, and nothing ever appeared
against the real lead. The `work` call had the same shape and was fixed separately; this is the
log half.

⚠️ **Being online and having sendable IDS are two different questions.** The hold gate in
`services/api/LoggerService.ts` now asks both: `!isOnline() || hasQueuedActivityLogs() ||
hasUnsendableClientId(payload)`. The rule is pure in `utils/offline-activity-log.ts` (7 tests)
and reuses `findUnresolvedClientIds`, so it catches appointment and calculator ids too, at any
depth.

⚠️ **Held, not dropped.** The `lead` step calls `rekeyActivityLogs(work.clientId, id)` the moment
the create lands (`services/offlineLeadStore.ts`), which swaps the client id for the real one and
makes the queued log sendable. The drain's own `hasUnresolvedIds` already held such logs back —
the bug was that this one never reached the queue to be held.

⚠️ **The match must not over-fire.** `isClientId` is anchored (`^(lead|appt|calc|work)-\d{10,}-`),
so ordinary text like `leadCode: 'SelfGen'` or `action: 'lead_check_in'` is not mistaken for an
id. A looser test would hold every log forever and nothing would send — there is a test for this.

**The general rule for this whole class of bug:** anything that travels offline must ask *both*
"can I reach the server?" and "does the server know the things I am naming?" Most of the lost-log
and duplicate reports this week were one or the other half of that question going unasked.

### Follow-up — tracing the check-in log (still reported missing)

Three fixes have landed for "the check-in log never arrives" (the `createdAtTheDoor` TTL, the
unknown-GPS geofence, and the online-with-a-client-id hold gate) and it is **still reported**.
Rather than guess at a fourth cause, the decision points now say what they chose:

- `screens/Leads/index.tsx` logs `[CheckIn] offline start lead=… module=… shouldCallWork=…
  atTheDoor=… inRange=…` on every offline start. ⚠️ `module=(none)` means the app **decided not
  to record a check-in** — there is no failed request to find in the network tab, which is why
  this presented three times as "the API is not called".
- `services/offlineActivityLog.ts` warns `DROPPED … - no session owner`. That branch is a silent
  **drop**, not a hold: the log is gone. It should only ever fire before login.

⚠️ **"No request in the network tab" has two very different causes** — the app never asked, or
the queue swallowed it. They need different fixes and the traces above separate them. Check
`[CheckIn]` first: if `module=(none)`, nothing downstream is at fault.

Verified sound while tracing (do not re-investigate without new evidence): `rekeyQueuedLogs`
rewrites `meta.leadId` on both `meta` and `payload.meta`; `resolveIds` resolves client ids at
SEND time from the live work map; a finished work item stays `uploaded` with its id map intact,
so resolution still works after the drain; `nextSendableLog` blocks only the affected lead.

### Follow-up — the drain now announces every step

"We fix this daily and it comes back" turned out, for two of the four fixes, to be that they were
**never in the build under test** — committed late, after the rebuild. The drain made that
impossible to tell apart from a real failure, because only FAILURES were logged: a step that
never ran left no trace at all.

`services/offlineLeadStore.ts` now logs, per lead:

```
[LeadSync] draining <clientId> - steps pending: lead, work, chat, workEnd
[LeadSync] <clientId> step=work leadId=<serverId|(none yet)>
```

⚠️ **Read the "steps pending" line first.** If the step the rep expects is not in it, the action
was never queued and nothing in the drain can be at fault — that is a `Leads`/`LeadCenter`
problem, not a queue one. The two have been confused repeatedly.

⚠️ **The absence of a `[LeadSync]` line at all means the bundle is stale.** Check that before
diagnosing anything else.

Ruled out while tracing, with evidence (do not re-investigate without new): `runStep` captures
`leadId` per call and `uploadOne` re-reads the work item between steps, so `work` always sees the
id the `lead` step minted; `ChatService.getChatByLeadId` swallows its own errors and cannot halt
the chain before `workEnd`; `serverSaysCheckedIn` and `refreshLeadLists` are both try/caught;
`workLead` / `endWorkLead` PUT the correct bodies.

### Follow-up — the chat 404 is NOT the blocker (and the log queue is now visible)

Reported with a screenshot of `GET /chat/v1/lead/<id>` returning **404**, asking whether that
failure stops the later logs. It does not, and the reasoning is worth keeping:

⚠️ **`ChatService.getChatByLeadId` cannot throw.** A 404 falls through to `createChatForLead`,
and any other error returns `null`. So the `chat` step - which sits between `work` and `workEnd`
in `UPLOAD_STEPS` - cannot halt the chain. A 404 there is the NORMAL first-visit answer: the
thread does not exist yet, so it is created.

⚠️ **A red row in the network tab is not evidence of the bug being chased.** This one is expected
traffic. Several rounds were spent on symptoms that turned out to be healthy.

What the same screenshot DID show is that `PUT .../work` now fires - the earlier fix working.

Since the drain's own guards all return silently, `services/offlineActivityLog.ts` now reports:

```
[ActivityLogQueue] drain: 3 queued (1 held for unresolved ids) - lead_check_in, lead_session, ...
[ActivityLogQueue] NOT draining 3 queued - draining=false online=true sender=false owner=true token=true
```

⚠️ **`sender=false` means `LoggerService` has not been imported yet**, so nothing can send the
queue however healthy it looks. (`hooks/useAppInitialization.ts` imports it at startup, so this
should never be false in practice - but it was unobservable, and it is the only guard that fails
without the rep doing anything wrong.)

⚠️ **`drain: 0 queued` means the log was never enqueued** - look at `logEvent`'s hold gate and
the `[CheckIn]` trace, not at the queue.

## Ticket — THE check-in log bug: the hold policy went false during the drain

The one that survived four previous fixes. Found from a network capture, not from reading code:
after syncing an offline lead, **`leads_list` logs POST happily while `lead_check_in` never
appears at all.**

⚠️ **That asymmetry is the whole diagnosis.** `leads_list` is in `ExcludedModuleTypes`
(`services/api/LoggerService.ts`), so `logEvent` never attaches a `leadId` to it — nothing to
resolve, so it sends. Every LEAD-SCOPED log carries `meta.leadId`, which offline is a client id
(`lead-1792...`).

Such a log is held until the `lead` step mints the real id. The hold is gated on
`holdIsUseful()`, which `offlineLeadStore` wired to:

```ts
setActivityLogHoldPolicy(() => uploadableWork(mine()).length > 0);
```

⚠️ **`uploadableWork` requires `status === 'draft'`** — it answers "what should the drain pick up
next", and `uploadOne` sets `'uploading'` for the whole drain. So the gate went **false for
exactly the window in which ids are minted**. `hasUnresolvedIds` collapsed with it
(`holdIsUseful() && ...`), the log was released carrying the raw client id, and the backend
discarded it. Silently, with a 2xx.

Fixed with `workCanStillMintIds` (`utils/offline-lead-work.ts`, 7 tests), which counts `'draft'`
**and** `'uploading'`. `uploadableWork` is unchanged — it is right for choosing work to drain.

⚠️ **Do not re-wire the hold policy to `uploadableWork`.** The two questions look identical and
are not: "what to drain next" excludes the item being drained; "can an id still appear" must
include it.

⚠️ **It must still go false at `'uploaded'`.** Holding forever blocks every later log of that
lead — the opposite failure, equally bad. There is a test for both directions.

⚠️ **Why four earlier fixes missed it:** each was real (the `createdAtTheDoor` TTL, the
unknown-GPS geofence, the online-with-client-id gate, the queued work release) and each was
upstream of this. The log reached the queue correctly every time; the queue then released it
early. Reading the code could not show this because every component was individually correct —
only the network capture, showing which module_types *did* arrive, located it.

### Follow-up — the release was clobbered by a stale snapshot

With the hold fixed the check-in arrived, but the portal still read **ON SITE**: the `workEnd`
step was being lost after it was queued.

`queueLeadWorkStart` and `queueLeadWorkEnd` (`services/offlineLeadStore.ts`) each read the work
item and then wrote a WHOLE SNAPSHOT back:

```ts
const base = /* read */;
putOfflineWork({ ...base, workEnded: { at: ... } });
```

⚠️ **The check-in itself calls `runUpload()`**, so by the time the rep leaves the lead a drain is
usually IN FLIGHT. `base` was captured before it. Writing the snapshot back put stale `done`,
`serverIds` and `status` over everything the drain had just recorded — undoing completed steps
and losing the `workEnd` with them. The check-in survived only because it happens before any
drain has started.

Both now use `patchOfflineWork`, which re-reads from the store inside the write.

⚠️ **Never `putOfflineWork({ ...base })` from a value read earlier in the call.** The queue is
mutated concurrently by the drain; any read-then-write must go through `patchOfflineWork`. This
is a general rule for this file, not a one-off.

⚠️ **A finished item is re-armed to `'draft'`** so a release queued after the drain completed is
still picked up; an in-flight `'uploading'` is left alone rather than fighting the drain.

### Follow-up — `DEAL_CENTER_DESCRIPTION_SCHEMA` cache key

`utils/offline-query-cache.ts` gains two keys for the Investment Center's scope text:
`DESCRIPTION_SCHEMA_LIST` (job builder) and `DEAL_CENTER_DESCRIPTION_SCHEMA` (deal center).

⚠️ **They are different collections, not a duplicate.** Full ticket in `docs/claude/deal-center.md`;
the trap is that the two endpoints look interchangeable and are not, which cost one round of
"fixed, still broken".

Both are company CONFIGURATION — identical for every lead and rarely changed — so a cached copy is
the same text the server would have sent. That is what makes caching them safe, and it is not true
of lead-scoped data.

## Order-sheet annotation (REVUIUX-569) offline: annotate AND reset queue, every log carries online/offline + the action time

Files: `services/annotationSaveService.ts` (queue), `services/orderSheetSync.ts` (the endpoints), `services/orderSheetAnnotation.ts`
(`warmOrderSheetForOffline`), `utils/activity-log/job-builder-logs.ts`, `hooks/usePendingOrderSheetJobs.ts`.

| Step | Online | Offline |
|---|---|---|
| Open the pencil | bytes from the warmed local copy / download | the warmed copy only: `JobDocsSection` warms every order sheet PDF while online (`warmOrderSheetForOffline`, also adopted under the plain-S3 key the row uses with no signal) |
| Save an annotation | job on the durable queue (mode `orderSheet`) -> PATCH in place | same job, stamped `queuedOffline`; flattened locally (WebView), PATCHed on reconnect |
| Reset all changes | `requestOrderSheetReset` runs `POST .../annotation/reset` at once (server answer shown) | queued as mode `orderSheetReset` on the SAME queue (FIFO: a reset asked after an annotate runs after it); also queued when a request never reached the server (`isNetworkError`) |
| Row state | "Syncing" while ANY order-sheet job (annotate or reset) of the lead is queued | same |

- **Logs:** `order_sheet_annotated` (`click` opened, `add` stored) and `order_sheet_reset` (`add`) now carry `meta.connection` (`online`|`offline` - what the rep's connection was when they acted) and `meta.occurredAt` = the moment the rep tapped Save / confirmed Reset (the job's `createdAt`), NOT the reconnect time. They go through `logEvent`, so offline they are held by the activity-log queue and replayed in order. ⚠️ Do not stamp the time at replay (same rule as every other log - see "Activity logs offline").
- ⚠️ A job that fails with a NETWORK error (weak signal mid-PATCH) now waits for the next reconnect / foreground instead of burning one of its 3 attempts; only a real server answer counts as an attempt.
- ⚠️ `normalizeApiError` rejects with a plain body object (no `.response`): tell a server answer by `httpStatusOf(e) !== undefined`, never `e.response`.
- Needs a device check: airplane mode -> annotate -> Save (row says Syncing) -> reconnect -> sheet replaced, ONE log with `connection: 'offline'` and the Save time; same for Reset. A sheet never opened online cannot be annotated offline (its bytes are not on the phone).

## revRender queue resilience (TAYYAB-REVRENDER-QUEUE-RESILIENCE): submit errors, a persisted batchId, a queue that outlives the screen

Files: `services/revRenderJobs.ts` (module-level manager), `utils/revrender-jobs.ts` (pure rules; tests `tests/offline/revrender-jobs.test.ts`),
`hooks/useLeadReports.ts` (now only subscribes), `screens/RevRender/index.tsx`, `screens/LeadCenter/index.tsx`, `widgets/components/LeadCenter/OperationalSections.tsx`.

| Situation | What the app does |
|---|---|
| `POST /rev-render/v1/batches` is ANSWERED with a `batchId` | `batchId` is written to `rev_render_jobs_<leadId>` BEFORE anything else; the render is the server's from here, whatever the phone does |
| Connection lost AFTER the reply | the 3 s `GET /rev-render/v1/batches/:id` poll marks the card `waiting` (amber, unchanged); polling continues, resumes on reconnect / foreground / screen mount / app restart |
| Connection lost BEFORE the reply | the card FAILS with "Network error - the app could not reach the server..." (`errorKind: 'network'`), payload kept, **Retry / Dismiss** |
| Submit TIMEOUT (120 s) | failed, `ambiguous` - "We couldn't confirm this render started - check Tools before retrying so you aren't charged twice" (the server may have accepted it; NEVER auto-resubmitted) |
| 503 / 429 | "busy" with the server's own text; 400-class = the server's own reason; 401 = "session expired" (never a render fault) |
| App closed mid-submit | on the next open the job has no `batchId` -> failed, `interrupted`, ambiguous, Retry |
| Batch FAILED on the server | failed with the backend's reason (`batchFailureMessage`), Retry |

- **The queue is no longer wiped.** `maybeFinalize` clears only COMPLETED jobs; failed ones stay (key rewritten, deleted only when empty) and the toast uses the real counts ("4 of 6 renders finished. 2 need retrying.", never "finished - check results" when nothing succeeded).
- **Persisted outside React.** The manager writes MMKV first, then notifies. ⚠️ Never put a `Storage.setItem` inside a `setState` updater: an unmounted fiber never calls it (the old queue vanished when the Lead Center was left).
- **Job ids are unique** (`rr-<ts>-<rand>`); a second start APPENDS - the old array-index ids made a second batch overwrite the first one's running jobs.
- **RevRender screen awaits the submit** (`onGenerateAll` / `onGenerate` return promises) and only then clears its queue and goes back; the button shows "Sending...". A failed render keeps its payload on the Tools card, so Retry never needs the rep to rebuild it. ⚠️ The queue SCREEN itself is not persisted (a force-quit while on it still loses it) - an explicit decision.
- **Honest progress:** the timer-driven 0->80 % bar is gone. The Tools card shows "k of N done" (completed renders over the queue); a per-batch percent exists only when the server reports `batch.total > 1`.
- **Poll failures:** transport and 401 -> wait; other server answers are tolerated 8 times in a row (`MAX_POLL_REJECTIONS`) then the job fails (ambiguous - it may still exist).
- ⚠️ Backend still needed: an idempotency key on `POST /rev-render/v1/batches` (a repeat key returns the existing batch). Until then a timeout is genuinely ambiguous and the wording says so. Not verified on device - use `REVRENDER_FAULT=503|hang` from the page above.

### Follow-up - the Tools bar moves in real time again (a live ESTIMATE, not "k of N")

"k of N done" alone gave nothing to watch. `OperationalSections` now shows a spinner, "Rendering · 2 of 6 done" and a live percent, ticking every 500 ms while any render is running. The value is `estimateJobProgress` (`utils/revrender-jobs.ts`): eased from `job.startedAt` (stamped when the POST is sent), capped at 92 so it never says done before the server does, raised by any real `batch.total > 1` progress, and FROZEN from `job.waitingAt` while a status check cannot reach the server (amber "Paused"; on reconnect `startedAt` is shifted by the time spent waiting). ⚠️ It is an estimate by design - do not let it reach 100 or keep climbing while `waiting`. Not verified on device.

## Unsynced lead: "Valid lead id is required" - the counterfeit-id trap, 5th instance (agreement delivery) and an APP-WIDE guard

Reported on the **Send Signed Agreement** prompt (`AgreementDeliveryPrompt`): create a lead offline, reconnect before it uploads, tap Send -> the server answered "Valid lead id is required". Spec: `MOBILE-FIX-UNSYNCED-LEAD-FUNDING.md` (funding half already in: `utils/lead-sync-state.ts`, `utils/lead-server-ready.ts`, `FundingService.leadPath`).

- **Cause:** the prompt asked `isOnline()` ("do I have signal?") when the question is "does this lead exist on the server yet?". With signal back but the lead still keyed `lead-<ts>-<rand>`, it sent `PUT pdf-reports/v1/agreement/<client id>/delivery-preference` (and the open-time `GET`).
- **Fix 1 - the prompt:** both the open-time GET and the Send use `leadReachableOnServer(leadId)` (real id AND signal). Otherwise the choice is queued (`queueDeliveryPreference`, owner-scoped, re-keyed by `rekeyDeliveryPreference` when the `lead` step lands); a `LEAD_NOT_SYNCED` rejection queues too. The sale is never held.
- **Fix 2 - the drain:** `drainDeliveryPreferences` skips a row whose `leadId` is still a client id (`continue`, row kept) - replaying it would 400.
- **Fix 3 - APP-WIDE containment (spec 9.1):** `services/api/index.ts` `api.get/post/put/patch/delete` reject BEFORE axios when the URL PATH carries a client id (`findClientIdInUrl`), with the plain `LEAD_NOT_SYNCED` rejection (no `httpStatus`). So no lead-scoped endpoint can ever send a counterfeit id again, however its caller was gated, and the connectivity model never sees a failed request (no banner flip). Queueing callers (funding, delivery) treat it as "keep on device"; the rest show its plain message instead of Mongo wording.
- ⚠️ A new lead-scoped feature must gate on `leadReachableOnServer` / `isSyncedLeadId`, never `isOnline()` alone - the guard is a net, not a design. ⚠️ Only the PATH is scanned (not query/body); a client id sent as a body field is still the caller's job. ⚠️ If some endpoint legitimately takes a client id in its path, exempt it HERE, do not remove the guard. Chat thread creation already guards with `isClientId`.
- Tests: `tests/offline/lead-sync-state.test.ts` (`findClientIdInUrl`, `isNetworkError` regression). Needs a device check: airplane mode -> create lead -> reconnect at once -> Generate Agreement -> prompt -> Send: no red error, agreement opens, preference sent after the lead syncs.

- **File map for the "Unsynced lead" section above:** `utils/lead-sync-state.ts` (`findClientIdInUrl` added; `urlHasClientId` now delegates to it), `services/api/index.ts` (the pre-axios client-id guard on every `api.*` call), `services/offlineAgreementDelivery.ts` (drain skips client-id rows).

## 409 on sync: "Couldn't be uploaded" on a deal that HAD synced (lfcalculators)

Client reported repeatedly, always after syncing offline work, never online: the pending-uploads card shows `POST /appointments/{id}/lfcalculators` 409 and the deal is stuck. Three separate defects, all in the create path.

**Why only offline.** Online a rep creates calculators one at a time against a server that already knows the earlier ones, so a title clash is caught in the UI before any request goes out. Offline the whole set is posted in one drain, so the first collision is discovered mid-flight, with no UI in front of it.

- **1. A 409 was classified as a flat rejection** (`utils/offline-lead-queue.ts`). It fell into the generic `status >= 400 -> 'rejected'` bucket, and `resolveStepDecision` turns `rejected` into `failed` - a DEAD END on the first attempt. 409 is now `'duplicate'`. WARNING: a conflict is not "your payload is bad", it is "the server already holds a row that collides with yours" - usually one WE created on an earlier half-finished drain.
- **2. A non-lead `duplicate` went to `needs-review`** (`utils/offline-lead-work.ts`, `resolveStepDecision`). Every non-lead step hangs off a parent the server has accepted, so the colliding row is adoptable: a `guarded` step now gets `retry-guarded` and an `idempotent` one `retry`, so `findExistingAppointment` / `findUnclaimedCalculators` actually get a chance to run. `manual` steps still stop for a human, and the `lead` step's own rules are untouched. WARNING: `needs-review`'s only exit is the rep pressing "Try again", which replays the identical request and fails identically - that loop is what the client kept hitting.
- **3. The calculator step threw away ids it had already earned** (`services/offlineLeadStore.ts`). `out` was returned only after the whole loop finished and `markStepDone` is the only thing that persists it, so with three calculators a failure on the third discarded the two the server had already created. On the next sweep they were still `pending` and were created AGAIN - a duplicate factory, and the reason a stuck deal ends up with more calculators than the rep built. Each id is now banked with `patchOfflineWork` the moment it is minted, and the create is wrapped so a 409 adopts an unclaimed calculator instead of throwing.
- **Audit of the other create steps:** `appointment` already caught 409 and adopted; `addendumDraft` already banks its id immediately with `patchOfflineWork`; `documents` / `consent` / `addendumRefund` / `funding` all have `guarded` pre-checks. The calculator step was the only one missing both. With fix 1+2 those existing pre-checks are now actually REACHED on a conflict instead of being skipped by a premature `failed`.
- A genuinely unresolvable clash (two truly identical calculators) is still bounded: adoption finds nothing, the step rethrows, and `MAX_CREATE_ATTEMPTS` lands it in `needs-review` with the translated message from `utils/calculator-title-conflict.ts`. It does not spin forever.
- Tests: `tests/offline/offline-work-decisions.test.ts` (+7) covers the classification, each step's decision, the untouched lead step, and the attempt-budget backstop.
- Not verified on device: build two identical calculators offline, sync, and confirm the deal completes by adopting rather than showing "Couldn't be uploaded"; then three calculators where one collides, and confirm no duplicates appear on the server after repeated sweeps.

### Follow-up - the SAME class in funding: "Cannot remove $100 Check - it has already been collected"

Asked after the 409 audit: "does this also cover funding?" It did NOT - a different failure with the same shape, so it is worth stating the shape plainly.

**The pattern:** a queued payload is a SNAPSHOT of what the rep saw offline. Anything the server learned in between is missing from it, and for a FULL-LIST save an absent row does not mean "unchanged" - it means "remove this". So the server refuses, and the whole step dead-ends.

- **Cause** (`services/offlineLeadStore.ts`, `case 'funding'`): `FundingService.savePayments` replaces the payment list wholesale. A payment collected after the rep went offline - by the office, the portal, or an earlier partial drain of this same deal - is not in `work.funding.payments`, so the save reads as removing money that has already moved, and the server refuses it.
- WARNING: the ONLINE path never hits this because `ResultJobModal` re-sends settled rows through `withSettledRows` (`screens/DynamicDealCenter/utils/funding.ts`). The queue had no equivalent.
- **Fix:** `utils/offline-funding-merge.ts` - `mergeSettledPayments(queued, serverPayments)` carries forward every `charged`/`collected` row the server holds that the snapshot does not mention. Called at DRAIN time, not queue time, because the collection can happen while the phone is offline and long after the snapshot was taken.
- WARNING: carried rows are copied verbatim, never edited or re-priced - that is money that moved, and only a refund reverses it. A queued row with the same `pid` WINS: that is the rep editing a row they could actually see.
- On a read failure the snapshot is sent unchanged rather than blocking the deal; the server stays the authority.
- Tests: `tests/offline/funding-settled-merge.test.ts` (9) - carry, pid collision, verbatim copy, unsettled rows left out, and the no-op cases.
- **The general rule for any new queue step:** if the endpoint takes a FULL LIST, reconcile against the server before sending. `documents`, `consent`, `addendumRefund` and `fundingDecision` are safe because they are per-row or have `guarded` pre-checks; `funding` was the one wholesale save in the queue.
- Not verified on device: collect a payment from the portal while the phone is offline on the same deal, then sync - the funding step should carry that row and succeed instead of showing "Cannot remove".

## Home screen: the pending-uploads CARD became a one-line strip

Ask: "instead of this card just show the syncing bar like the offline bar, and when syncing is done make the bar green and change text to syncing done. No need to show the whole thing, keep it only in account settings. And if any api failed please don't show any message in home screen like we are showing in the form of card."

- **Gone from the lead list:** `PendingLeadsBanner` is no longer mounted (`screens/Leads/index.tsx`). It put queue mechanics - per-lead rows, "N of M uploaded", retry buttons and raw API errors - on the screen a rep works from.
- **In its place:** `widgets/common/SyncBanner.tsx`, mounted in `MainHeader` directly under `OfflineBanner`, so both strips stack and behave alike. Blue + spinner "Syncing your work..." while in flight; green "Syncing done" for `SYNC_DONE_HOLD_MS` (3 s) after the queue empties; otherwise nothing. Rules are pure in `utils/sync-banner.ts`, tests in `tests/offline/sync-banner.test.ts` (9).
- WARNING: **failures are SILENT on the home screen, deliberately.** No error text, no error count, no retry. A rep on a driveway cannot act on "the calculator conflicted", and a red card on the lead list reads as "the app is broken" when the work is safe on the device. Blocked work (`failed` / `needs-review`) maps to tone `none`. This is a product decision - do not add an error state to this strip.
- WARNING: `justFinished` is tracked in component state, not derived from an empty queue. An empty queue on a cold start is the NORMAL case; deriving "done" from it would greet every launch with "Syncing done" for work the rep never saw start.
- The strip stays silent while OFFLINE even with work queued - `OfflineBanner` is already saying the useful thing, and two stacked strips about one situation is noise.
- **Nothing was lost, it moved:** Profile keeps `PendingUploadsCard`, which navigates to `screens/PendingUploads/` - per-item status, `describeQueueError` text, Retry and Remove all still live there.
- `widgets/components/PendingLeadsBanner.tsx` is left in the tree, unreferenced, on purpose: the client has not seen this change yet and re-mounting it is one line. Delete it once they confirm.
- Not verified on device: queue work offline then reconnect - the strip should go blue while draining and green for ~3 s; a failing item should show NOTHING on home and still appear under Profile -> pending uploads.

### RevRender queue: batch retry / dismiss (`retryAllRevRenders`, `dismissAllRevRenders`)

Added for the collapsed failure row in the Tools tab - full note in **`docs/claude/lead-center.md`** ("RevRender failures: five identical cards became one row"). Recorded here because the job queue itself lives in `services/revRenderJobs.ts`.

- WARNING: **a batch action must not be a loop over the single-job function.** `retryRevRender` raises its own `FlashMessage.error` when a job fails again, so retrying five would stack five identical toasts. `retryAllRevRenders` submits them with `Promise.all` and reports ONCE, in the same shape `startRevRenders` already uses for a batch ("N of M renders not started", with the first job's error as the detail).
- `dismissAllRevRenders` filters and persists once rather than calling `dismissRevRender` per job, which would write the store N times.
- Both are no-ops when nothing is failed, so they are safe to call from a control that may be visible for a moment after the last job clears.
- The per-job `retryRevRender` / `dismissRevRender` are unchanged and still exported - the UI simply no longer has a per-row control.

### Offline lead list state: vanish / reappear after reconnect (audit group B)

Found by the offline audit (code reading only; **not yet verified on a device** - no device was connected). Symptom: a lead made offline shows as a pending card, the card disappears when the drain finishes, and the lead only returns minutes later - at random on cellular.

- **Root cause 1 - the refresh lived in a screen.** The only `['leads']` invalidation after a create was an effect in `screens/Leads/index.tsx`, which runs only while that screen is mounted. A rep who reconnected on the Map or in Lead Center had the card retire with no refetch. Now `refreshAfterLeadLanded()` in `services/offlineLeadStore.ts` invalidates `['leads']` and `['mapJobs']` right after the `lead` step and again when the work reaches `uploaded` (fire-and-forget; a slow refetch must not hold the next upload step).
- **Root cause 2 - the card was released when the refetch SETTLED, not when the list CONTAINED the lead.** On a weak link the fetch can fail (and `cachedFetch` answers with the stale on-disk list) or return before the new lead is readable. Now the card (`justLandedIds`) is released only when `serverLeadIds` holds the lead's id; meanwhile the list is re-read every `LEAD_HANDOFF_RETRY_MS` (4 s), and `LEAD_HANDOFF_MAX_MS` (45 s, was 15 s) is only the give-up.
- **Root cause 3 - a stale snapshot counted as fresh.** `cachedFetch` swallows an online fetch error and returns the saved copy, so the query kept it for its whole 5-minute `staleTime`. `cachedFetch` now takes `onStaleFallback`; `useLeadsData` flips `servedStale` and refetches every 15 s until a real fetch succeeds. Offline reads do NOT signal (the saved copy is the expected answer there).
- **Root cause 4 - the row's key changed mid-sync.** `_id` is the client id until the `lead` step lands, then the server id, so the FlatList row remounted. `keyExtractor` now prefers `clientId` (set on offline cards).
- WARNING: **do not move the release back to `.finally()` of the invalidation**, and **do not add a cleanup to the landed-effect that clears the give-up timer** - the effect re-runs on every store update, so the cap would never fire and the card could bridge forever.
- Deliberately NOT changed (product / backend): failed and needs-review leads still show in the Today tab until midnight; an online create that times out can still duplicate until the client id + idempotency key are minted before the first online attempt (needs the backend to honour the key); offline leads still have no map pin.
- Test: `__tests__/utils/offline-query-cache-stale.test.ts` (stale-fallback signal). The screen/store behaviour is not unit-testable here (React Native imports).

### Cellular hardening: one failure rule for every queue (audit group A)

Found by the offline audit; **code + unit tests only, not yet verified on a device**. Symptom: wifi / flight mode sync fine, real mobile data "fails, tries again, fails" and work lands in the backlog.

- **The rule (`utils/transfer-failure.ts`, pure, tested).** `classifyTransferFailure` -> `auth` (401) / `transport` (no HTTP answer) / `transient` (408/425/429, any 5xx, and 403) / `rejected` (other 4xx). `transport` and `transient` are **free**: they spend NO attempt, back off (`transientBackoffMs`: 5 s doubling to 2 m, +-20% jitter) and are only **parked after 24 h** (`TRANSIENT_GIVE_UP_MS`) - parked = kept, visible, retryable, never deleted.
- **Photo queue (`utils/uploadQueue.ts`).** Used to count every non-offline failure as one of `MAX_PHOTO_ATTEMPTS` (5) with 3-15 s waits, so ~30 s of weak signal parked a good photo until the rep tapped Retry. Now a free failure keeps the item, sets `nextAttemptAt`, **stops the pass** (the rest would hit the same dead link) and `scheduleNextRetry()` wakes the drain. `canDrain` skips an item still waiting; `releaseWaiting()` (on a real reconnect or foreground) makes them due. Only `rejected` still uses the attempt budget.
- **Installer queue (`offlineUploadManager.ts`).** Same rule via `afterFreeFailure`; reconnect calls `makeDueNow`.
- **Lead sync + activity logs.** `leavesWorkUndelivered` (transport, 408/429, 5xx; **not 403**) replaces `isNetworkError` as the "spend nothing" test in `offlineLeadStore.ts` and `offlineActivityLog.ts`. A 5xx used to spend an attempt, and five pushed the work to needs-review / deleted the log. 403 deliberately still counts, so a genuine permission refusal ends in the visible needs-review state instead of looping.
- **Photo-delete queue.** Read `err.response.status`, which the api wrapper's normalised rejection does not have, so every failure looked statusless and five bad tries DROPPED the delete (photo stayed on the server). Now `httpStatusOf` + the rule; free failures keep the entry and stop the pass.
- **Annotation jobs.** A 5xx / gateway error no longer burns the 3-attempt budget (it deleted the rep's annotation). A 60 s sweep was added: a 5xx leaves the link up, so no reconnect event would ever re-run a kept job.
- **Silent drops removed.** A missing local photo file now PARKS the photo (reason shown in Pending Uploads) instead of deleting it; the installer queue no longer deletes a whole batch because one file is missing.
- **Connectivity (`services/connectivity.ts`, `services/api/index.ts`).**
  - Multipart (`FormData`) requests are tracked with `beginUpload/endUpload` and are NOT given to the stall watcher: a big upload on a weak uplink is legitimately slow, and was being taken for a dead channel (probe -> "offline" -> queue aborts -> file restarts from byte 0).
  - While an upload is in flight, "connected but `isInternetReachable === false`" cannot flip the app offline (the `/health` GET loses the race against the upload). "Not connected" still does. Entries expire after 330 s so a leaked one can never pin the app online.
  - Reconnect is **one coalesced, staggered event**: both firing paths (OS flag and probe status) merge, wait `RECONNECT_SETTLE_MS` (2 s, cancelled if the link drops again), then listeners start 400 ms apart. Previously a wifi->cellular hop or tower change started seven queues in the same instant.
- **Photo timeout 120 s -> 300 s** (`services/api/leads.ts`): no resume exists, so the only lever is not abandoning a transfer that is still moving. True resumable upload needs the backend.
- **Startup (`useAppInitialization.ts`).** A `getMe` failure other than 401 (timeout, 502/503/504, a proxy's 403) no longer signs a rep with a persisted session out; only a real 401 does.
- WARNING: **never put a counter-spending branch back in front of the free-failure check**, and never classify a status-less error as `rejected` - the 5th "rejection" parks/deletes work the server never judged.
- Not fixed (needs backend): resumable / chunked upload; idempotency keys on appointment, calculator, document, consent and refund POSTs; token refresh.
- Tests: `__tests__/utils/transfer-failure.test.ts`.


### Photo-capture logs lost after an offline sync: record the log durably before the queue item goes (2026-10-29)
Files: `utils/pending-photo-log.ts` (pure rules), `utils/uploadQueue.ts` (`recordPhotoLog`, `settlePhotoLogs`). Test: `tests/offline/pending-photo-log.test.ts`.

Reported: *"images captured offline upload fine on reconnect, but the logs created during the capture session are missing on the portal."*

| Was | Fix |
|---|---|
| The `photo_uploaded` / `annotated_photo_uploaded` log needs the stored `s3url`, so it was built AFTER the upload by a fire-and-forget `logUploadSuccessAsync` that waited up to ~2 min **in memory** for the server row - while the queue item had already been removed. Backgrounding/killing the app in that window (normal at the end of a field session), or a dead lookup on weak cellular, lost the log; the photo itself was safe | `recordPhotoLog` writes a durable `pending_photo_logs` MMKV record (capture time, ids, slot, known url) BEFORE the item is removed. `settlePhotoLogs` does one lookup per record per pass and only then calls `logEvent` (which holds it durably offline); the record is deleted only after that hand-off |
| Gave up after ~9 lookups | Up to `MAX_LOOKUP_PASSES` (30) passes, driven by reconnect, foreground, the 60 s sweep, app start and a 5 s timer. After the last pass the log goes WITHOUT an image rather than being dropped |

- ⚠️ **Never move the record write after `removeItem`**, and never make it in-memory again.
- `meta.occurredAt` stays the photo's capture time, so the portal timeline is in capture order, not reconnect order.
- Offline capture-session actions that go through `logEvent` directly (deletes, annotation edits) were already queued; only this post-upload log had the gap.
- Not verified on device (no signed-in session was available to drive a capture); the pure rules are tested.


### Android upload notification: progress bar, and no "0 items left" (2026-10-29)
Files: `utils/background-upload-policy.ts` (`uploadProgress`, `shouldShowUploadNotification`), `services/background/androidUploadService.ts`. Test: `tests/offline/pending-photo-log.test.ts`.
- The foreground-service notification now carries a notifee `progress` bar: `max` = the most items seen waiting this run (`peakPending`, reset when the service ends; work added mid-run raises it), `current` = done so far. Text still says "N items left to upload."
- `onProgress` with `pending <= 0` shows nothing; the service's `finally` cancels the notification. ⚠️ Do not display on zero: it produced a lingering "0 items left to upload." after a drain.
- Not verified on device.


### Photo cache holds only leads with offline work, and empties once they are delivered (2026-10-29)
Files: `utils/lead-photo-index.ts` (pure rules), `services/leadPhotoIndex.ts` (MMKV index `lead_photo_cache_index`), `services/leadPhotoCache.ts` (`leadHasOfflineWork`, `pruneDeliveredLeadPhotos`, `startLeadPhotoCacheSync`), `hooks/usePrecacheLeadPhotos.ts`, `utils/uploadQueue.ts`, `utils/imageFileCache.ts` (`removeCachedPath`). Test: `tests/offline/lead-photo-index.test.ts`.

Reported: Profile showed "24 photos saved on this device" while "Everything is uploaded"; leads worked online should not be stored.

| Was | Fix |
|---|---|
| `usePrecacheLeadPhotos` warmed EVERY lead opened online into `imageFileCache`, and uploaded photos were adopted into it and never removed | The hook only warms a lead while `leadHasOfflineWork` (queued photos, a pending photo log, or offline lead work for it); it re-checks on queue / offline-work changes. Every file it warms or adopts is recorded per lead in the index |
| Nothing ever freed those files except the 500 MB LRU or the manual Clear button | `pruneDeliveredLeadPhotos` deletes a lead's indexed files when it has no offline work left AND was last touched >= `PRUNE_GRACE_MS` (10 min) ago. Runs 30 s (debounced) after any queue / offline-work change, on foreground and at launch |

- ⚠️ The grace period is what keeps the card the rep is looking at from blanking and reloading when its last upload lands. Do not drop it to 0.
- ⚠️ `uploadQueue.ts` must not import `offlineLeadStore` (the store imports the queue); the combined "has work" check lives in `services/leadPhotoCache.ts`.
- Files cached BEFORE this change are not in the index, so they stay until the rep taps Clear offline photos (the `revrender_` prefix is shared with pitch-book / logo / RevRender files, so they cannot be told apart safely). A lead's photos now come from the server when online, so a first open of a non-offline lead may show a loader.
- Not verified on device.

### Annotation render: square eraser in the offline export (`annotation-render-html.ts`)

Follow-up to the square-eraser ticket in `lead-center.md` (Annotate: square eraser + 0..100 ruler). The hidden-WebView renderer used by `annotationRenderer` / `annotationSaveService` (queued and offline annotation saves) now fills an axis-aligned square per eraser segment (`eraseSquares`, `destination-out`) instead of a round-capped stroked line, so a photo saved offline matches the editor.
- ⚠️ The script duplicates the hull maths of `eraserSweepPath` (`utils/annotation-brush.ts`); change both together. The script is a plain template string: no `${}` or ES-module syntax inside it.
- The stored payload is unchanged (`{ isEraser, width, points }`), so already-queued renders just come out square. Not verified on device.
- Follow-up: the export only takes the square path when `stroke.shape === 'square'`; strokes without `shape` (and `'circle'`) keep the round stroked eraser. `annotationSaveService` forwards `shape`.

## "Offline" on two bars of LTE, and the raw `timeout of 15000ms exceeded` toast

Client (Lance), on screenshots of both: *"I don't want to see this stuff. It's lowers confidence in app"*. Two separate defects, one screen. Reproduced on an iOS Simulator with Network Link Conditioner, custom profile **12 kbps / 35% packets dropped / 3000 ms delay** both directions — the profile is the useful artefact here, because the stock presets cannot produce either (`100% Loss` fails *instantly*, which is a `Network Error`, not a timeout).

### 1. The false "Offline — showing saved data" bar

⚠️ **The banner logic was never wrong.** `bannerFor('degraded')` returns "Weak connection" and only `'offline'` produces the amber offline bar. The state really was `offline`, and this is how:

`NetInfo.configure` gives its reachability GET of `/health` `reachabilityRequestTimeout: 8_000`. **NetInfo has no "slow" verdict** — when that GET misses 8 s it can only report `isInternetReachable: false`, which is byte-identical to a dead link. That flowed through `resolveOnline` → `commit(false)` → `applyOsDisconnected`, which **force-settles past the `MIN_DWELL_MS` guard**. One slow `/health` was therefore a *verdict*, not a hint — exactly what the comment above `configureReachability` had warned about.

The fix splits the two claims in `utils/connectivity-state.ts`:

- `isConnected === false` → the OS says **no interface** (airplane mode, no signal). Still `applyOsDisconnected` → `offline`.
- `isInternetReachable === false` → only the reachability **probe** failed. Now `applyProbeResult(state, 'slow')` → `degraded` → **"Weak connection"**.

`commit(nextOnline, radioIsDown)` carries the distinction; `applySnapshot` computes it with `isDefinitelyDisconnected(snapshot)`.

- ⚠️ `degraded` is **not** a softer online. `isEffectivelyOffline('degraded')` is still `true`, so every server-gated feature stays gated. What changes is that `shouldAttemptSync('degraded')` is `true` — the queues **keep draining on a weak line**, where settling to `offline` used to stop them. That is the real win, not the wording.
- ⚠️ `health-probe.ts` is the only component that can tell slow from dead (`PROBE_SLOW_MS = 4_000`, and `PROBE_FAILURES_BEFORE_OFFLINE = 2` retries before it ever claims offline). After this change it is the **only** path to `offline` besides the radio. Do not re-add a second one.
- ⚠️ Do NOT "fix" this by raising `REACHABILITY_TIMEOUT_MS`. Any finite timeout has the same flaw; the bug is treating a timeout as proof of absence. `applyOsDisconnected` now has exactly **one** call site — keep it that way.

### 2. The raw `timeout of 15000ms exceeded` toast

`normalizeApiError` (`services/api/index.ts`) **always** populates `.message`. So the ~48 sites written

```js
FlashMessage.error('Error', err?.message || 'Could not save the deal')
```

can never reach their fallback — `||` fires only on an empty value and there never is one. ~20 of those fallbacks are genuinely good copy that **has never once rendered**. On a timeout `.message` is axios's own string, so the rep read a millisecond count.

Fixed at the single `emit()` chokepoint in `config/message.ts`, which every `FlashMessage.*` call passes through — all 48 sites at once, plus any added later. Rules live in `utils/transport-error-copy.ts` (pure, so it is testable; `config/message.ts` imports react-native-flash-message and cannot load under jest).

- ⚠️ **Presentation only.** The error object is untouched, so `shouldAnnounceFailure`, `isNetworkError` and the upload retry policies still see the real transport failure. Never make this change the error itself.
- ⚠️ A **server** message passes through verbatim — "Valid lead id is required" is the only useful thing a 400 gives us. Only transport wording is rewritten.
- ⚠️ An **informative title is kept**: `('Could not upload photo', 'Network Error')` keeps its title and replaces only the description. That title is the one thing telling the rep *which* action failed. Only `Error`/`Failed`/`Oops`/empty are replaced (40 sites are titled exactly "Error").
- 13 + 9 tests in `tests/offline/transport-error-copy.test.ts` and `tests/offline/weak-link-not-offline.test.ts`.
- ⚠️ **Still bypassing `emit()`**: 13 `Alert.alert` and 15 `flashRef` sites. They need fixing individually.
### The strip must be ONE line on every phone, and it now owns the connection message alone

Client, on a two-line strip: *"i want to keep it in only one line in any phone"*. The copy was a
title PLUS a detail sentence (`'Offline — showing saved data'` + `'Changes sync when you
reconnect.'`, ~62 chars), rendered `numberOfLines={2}`. On a 320pt iPhone SE that wraps, so the
strip changed height and the screen under it jumped every time the link flapped.

Now one clause each, under `BANNER_MAX_CHARS` (40):

| state | copy |
|---|---|
| `offline` | **Offline — changes sync when you reconnect** |
| `degraded` | **Weak connection — things may be slow** |

`OfflineBanner.tsx` renders `numberOfLines={1}` + `adjustsFontSizeToFit` with
`minimumFontScale={0.85}`, so the longest string shrinks on the narrowest device rather than
wrapping. ⚠️ Keep new copy under `BANNER_MAX_CHARS` (44) or it shrinks far enough to look faint;
a test in `tests/offline/weak-link-not-offline.test.ts` enforces the length.

⚠️ **Do not shorten these further for its own sake.** An intermediate attempt cut offline to
"Offline — changes save to this device", which fits but is vague: it never tells the rep the work
goes up BY ITSELF, which is the entire reassurance. The full clause measures ~234pt of the ~275pt
a 320pt phone has, so the clarity cost nothing. What wrapped originally was the title PLUS a
second detail sentence (~62 chars), not this line.

⚠️ The copy still names what happens to THEIR WORK, not to the socket. "changes save to this
device" is what decides whether the rep carries on; "showing saved data" described the app's
behaviour, which is not their question.

⚠️ The strip (and each screen's own inline state) is now the ONLY place a transport failure is
communicated - the red toast is suppressed unconditionally at `emit()`, NOT gated on the strip
being visible, because not every screen renders one and the status lags the first failure anyway.
See [`app-wide.md`](app-wide.md).

- Not verified on device — reproduced and fixed against the Simulator + NLC profile above.

## Forced sign-out (second device) left the rep ON SITE on the portal

**Reported:** a rep works a lead on phone 1, then logs in on phone 2 to finish up. Phone 1 is signed out automatically — but the portal still shows them on site at that door.

**Cause.** "Leaving a lead" is TWO facts: the `work` release (`PUT /lead/.../work` with `workStartedBy: null`) and the `session_pause` activity log. Both are sent by `endActiveLeadWorkSession()` in `utils/lead-work-session.ts`. Every *deliberate* exit called it — the header home button (`MainHeader`), and manual logout (`useAuth.logout`). **The forced sign-out did not.** The 401 branch of the axios response interceptor (`services/api/index.ts`) cleared the session, the query cache, the socket and Redux, and never touched the work session. Nothing was sent, so the server kept the rep attached to the lead indefinitely. The installer equivalent (`endInstallerWorkSession`) had the same hole.

**Fix.** `releaseActiveWorkOnForcedLogout()` in `services/api/index.ts`, awaited inside the 401 branch.

- ⚠️ **ORDER IS THE WHOLE FIX: it must run BEFORE `clearSession()`.** `LeadService.endWorkLead` is gated on `hasSession()` and returns `Promise.resolve()` with no token; `logEvent` *holds* any log when `Storage.getItem('accessToken')` is empty. Move this call below the wipe and both become silent no-ops — which is precisely the bug being fixed, reintroduced invisibly (nothing throws, nothing logs).
- ⚠️ It must also run **before `store.dispatch(logout())`**: the navigator swaps on `isAuthenticated`, which unmounts Lead Center, and `useLeadCenterData`'s cleanup calls `clearLeadWorkSession()` — wiping the MMKV record *without* releasing. Read the session first or there is nothing left to release.
- ⚠️ **RE-ENTRANCY.** These requests go back through the same interceptor, and the token is already dead server-side, so they can 401 too. The `releasingWork` flag makes that inner 401 fall straight through (`if (releasingWork) return Promise.reject(...)`) instead of recursing into a second sign-out and a second "Session Expired" flash.
- Both releases are individually `try`/`catch`ed and the whole thing is best-effort: a sign-out must never be blocked by a lead release.
- **A release the dead token cannot complete is not lost.** `releaseWork`'s catch hands the lead to `queueLeadWorkEnd` via the injected `setWorkReleaseQueue` hook, and the queued work is written before `resetSessionStorage()` runs. `mine()` scopes offline work to the user, so it replays after the next login.
- Imported with `require` at call time, not at the top of the module: both `lead-work-session` and `installer-work-session` reach React Native, and a top-level import would make the axios module unloadable under jest (CLAUDE.md §6).

**Scope.** Only the 401 forced-logout branch changed. The deliberate-exit paths were already correct and are untouched, and the `isLoginRequest` / `isUserNotFound` / unstable-connection early-returns still short-circuit before any of this — a flaky-signal 401 parks as before and releases nothing.

**Tests:** `tests/offline/forced-logout-work-release.test.ts` (5) — both facts sent; a failed PUT queues; a client id queues instead of PUTting; a no-op with no session; a deal session releases but logs no pause. `services/api/index.ts` itself cannot be loaded under jest (NetInfo via `queryClient`), so the ordering rules above are guarded by the ⚠️ comments in the source, not by a test.
