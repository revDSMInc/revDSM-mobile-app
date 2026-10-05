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

**Related fix:** `uploadQueueManager.resetForNewSession()` now RELOADS the queue from MMKV instead of
emptying it. `upload_photo_queue` is a session-keep key; emptying the memo made the next `saveQueue()`
erase the earlier rep's unsent photos.

**Still open (not done here):** BGProcessingTask / WorkManager to resume after the process is killed;
background `URLSession` for large files; the photo queue still drops an item after 5 failed attempts; a
parked 401 still marks work `failed` (`classifyCreateOutcome`); no backend idempotency key. These are the
audit's remaining high items.

**Device test matrix:** airplane mode toggled while backgrounded; app left in recents vs swiped away (each
platform); reboot with a non-empty queue; weak signal / captive portal; token expired mid-drain; low
battery / Doze; two reps on one handset. Expect: iOS drains only within ~30 s of backgrounding, Android
shows the "Uploading your work" / "Waiting for connection" notification.
