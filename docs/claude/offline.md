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

### REVUIUX-444 — `defaultOneYearPaymentMethod` joins the queued calculator settings

`utils/offline-settings.ts`: `FIELDS` + `PendingCalculatorSettings` gained `defaultOneYearPaymentMethod` (`null` = clear, sent as `null`). Everything else (merge, payload, `hasPendingSettings`, optimistic `applyPendingSettingsToUser`, replay on reconnect) is driven off `FIELDS`. See `deal-center.md` § REVUIUX-444.
