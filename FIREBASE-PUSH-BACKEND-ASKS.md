# Firebase Push — What Mobile Needs From Backend

**From:** mobile (React Native app, `mhalt-revdsm-mobile`)
**Re:** `NOTIFICATIONS-MOBILE-API.md` — branch `revDSMUIUX-97` / REVUIUX-97
**Status:** your side is complete. Mobile client work has not started, and is blocked on §1.

This lists **only what we cannot do ourselves**. Everything else — Firebase app registration, native config, token binding, deep-link routing, the notification list — is on us and needs nothing from you.

---

## TL;DR

| # | Ask | Blocking? |
|---|---|---|
| 1 | Firebase **project ID + project number**, and Editor access to that project | **Yes — nothing works without it** |
| 2 | Confirm whether demo and production share one Firebase project or have one each | **Yes** — decides whether we ship one config file or build variants |
| 3 | Tell us who holds the Apple Developer account, so we know who uploads the APNs key | **Yes** for iOS only |
| 4 | Confirm **Cloud Messaging API (V1)** is enabled on the project | Yes |
| 5 | One captured `GET /history/…` response — the row nesting is ambiguous in the doc | No, but we are guessing until we have it |
| 6 | Answers to five contract questions in §5 | No — we have safe defaults for all five |
| 7 | A few `dryRun: true` sends at agreed moments during integration | No |

Two items in §6 are flagged as **backend-side issues we cannot fix from the client**.

---

## 1. ⚠️ Firebase project identity and access — the blocking item

Your checklist says *"App registered in the same Firebase project as the server credentials."* We do not know which project that is, and we cannot find out from either repo — the web app's `FIREBASE_API` is env-injected and empty in source control, and it is used for **auth only** (`src/auth/context/firebase/auth-provider.js`), so it may well be a different project from the one your service account belongs to.

**Please send:**

- **Project ID** (e.g. `revdsm-prod`)
- **Project number** / Sender ID (the 12-digit number)
- **Editor** role on that project for `<mobile dev email>`

Editor, not Viewer — registering an app and uploading an APNs key both require it.

> ⚠️ **Why this is worth getting exactly right.** If we register the apps in the wrong project, everything looks correct and nothing works: `POST /bind` returns 200, `GET /devices/userId/:id` shows the token, your send reports `devices: 1` — and the device never receives anything, because the token belongs to a different project. There is no error and no client-visible symptom. This is the most expensive way to lose a week on this feature.
>
> Once we have the config files we will verify `project_id` against the value you send before doing anything else.

**What we will register once we have access** (no action needed from you, listed so you can sanity-check the identifiers):

| Platform | Identifier | Source of truth |
|---|---|---|
| Android | `com.revdsm` | `android/app/build.gradle` → `applicationId` |
| iOS | `com.revdsm.sales` | Xcode → `PRODUCT_BUNDLE_IDENTIFIER` |

The two genuinely differ — that is not a typo on our side.

---

## 2. ⚠️ One project, or one per environment?

`src/config/env.ts` in the mobile app is **hardcoded** to `https://demo-api.revdsm.com/`. It is not build-driven yet (the web's `VITE_API_URL` has no mobile equivalent). We are fixing that separately, but the answer here changes what we build now:

- **One Firebase project across all environments** → we ship a single `google-services.json` / `GoogleService-Info.plist`, and demo/prod are separated only by which API a build talks to.
- **One project per environment** → we need per-variant config files, and the env work has to land *before* push rather than after.

Please confirm which. If separate, send the project ID and number for each.

> ⚠️ A device bound from a demo build to a production project (or vice versa) fails in exactly the silent way described in §1.

---

## 3. Who uploads the APNs key?

For iOS, an **APNs Authentication Key** (`.p8`) has to be uploaded to Firebase Console → Project Settings → Cloud Messaging → *Apple app configuration*, together with its Key ID and our Team ID.

Our Apple Team ID is **`A7KTX97372`** (from the Xcode project).

Creating that key needs **Account Holder or Admin** on the Apple Developer account — App Manager cannot do it. Tell us who holds that, and we will take whichever half is ours:

- **If we hold it:** we create the key and upload it ourselves; we just need the Firebase Editor role from §1.
- **If you hold it:** create the key under *Certificates, Identifiers & Profiles → Keys → +*, ticking **Apple Push Notifications service (APNs)**, and upload it to Firebase. Send us the **Key ID** so we can confirm it landed.

> ⚠️ Two constraints worth knowing before anyone clicks: the `.p8` **downloads exactly once** and cannot be retrieved again, and an Apple account may hold **at most two active APNs keys**. Check whether one already exists before creating a new one — a single key covers every app in the team and both sandbox and production, so there is usually no reason to make another.

Please do **not** send us a service account JSON or the legacy server key. Those are yours; neither belongs in a mobile binary in any form.

---

## 4. Confirm Cloud Messaging API (V1) is enabled

Firebase Console → Project Settings → Cloud Messaging. Please confirm **Firebase Cloud Messaging API (V1)** shows as enabled. The legacy API is deprecated and, on newer projects, disabled by default.

If your sends are already working in your environment this is presumably fine — asking only so we can rule it out quickly if the first device test fails.

---

## 5. Contract questions

None of these block us — we have a safe default for each, noted below. Answering them lets us delete a defensive branch.

### 5.1 History row nesting — please send one real response

The doc is ambiguous. The sample in §2 shows:

```json
{ "title": "Agreement signed", "message": "…",
  "data": { "eventType": "agreement-signed", "leadId": "…", "isDynamic": true, "count": 1 } }
```

which is `row.data.eventType` — but the prose immediately after says *"from the history API it is `row.data.data.eventType`"*.

**Our default:** reading both (`row?.data?.data?.eventType ?? row?.data?.eventType`). That works either way but means we cannot type the row properly.

**Ask:** one captured `GET /notifications/push/v1/history/userId/:id/type/all` response body, verbatim, so we can pin it.

### 5.2 `bind` — is `deviceInfo` free-form?

There is no `react-native-device-info` in our repo, so we build the string from React Native's `Platform.constants`:

- Android → `Samsung SM-G991B / Android 14`
- iOS → `iPhone / iOS 18.2`

Note iOS cannot give the exact model without adding a native module — we get the idiom (`iPhone` / `iPad`) and the OS version only.

**Ask:** confirm the field is free-form display text and nothing parses it. If you need the precise iOS model for support, say so and we will add the dependency.

### 5.3 `bind` — what is the upsert keyed on?

The doc says the call is an upsert and asks us to send it on **every app start and every token refresh**, which we will. But a token refresh produces a *different* `deviceToken` for the same user and device.

**Ask:** is the row keyed on `(userId, deviceToken)` or on something device-stable? If it is the token, does the old row get replaced, or does it linger until FCM reports it invalid on a later send? We want to know whether a rep who has used one handset for a year accumulates dead rows — and whether we should be sending a stable device identifier alongside, which we can (the login payload already uses `mobile-<os>-<email>`).

**Our default:** bind on every start and refresh as documented, and assume you handle the housekeeping.

### 5.4 `unbind` — can we unbind by `userId` alone?

`DELETE /internal/device-token` takes `{ userId, deviceToken }`.

We call this on logout **before** clearing the session header, so the request is authenticated. But there are cases where the app no longer holds a token to send: notification permission revoked in system settings, app data cleared, a reinstall, or a logout triggered by the global 401 handler after the session is already gone.

**Ask:** is there a way to unbind every device for a user, or unbind by a stable device id?

**Our default:** we skip the call when we have no token, and rely on your server-side pruning when FCM reports the token invalid.

> ⚠️ This one has a real consequence. Field crews share handsets. A token left bound after logout means the **next rep on that device sees the previous rep's lead names, customer addresses and chat messages on the lock screen.** Your doc notes pruning only happens on the next send, so there is a window. If unbind-by-user is cheap to add, it closes a genuine privacy gap rather than a tidiness one.

### 5.5 `lead-issued` — are `issuedLeadId` and `count` mutually exclusive?

The doc says `issuedLeadId` **or** `count`. We route to the specific lead when `issuedLeadId` is present and to the leads list otherwise (bulk issue and route dispatch), since neither of those can name a single lead.

**Ask:** confirm they are never both present. If a bulk issue of exactly one lead sends both, we would rather deep-link.

### 5.6 `agreement-signed` — confirm the in-person flow sends neither flag

The doc says the lead-outcome save sends `isDynamic` and `count`, and the in-person sign flow (`/pdf-reports/v1/agreement/:leadId/sign`) sends **neither**.

**Our default:** both read as optional, with no assumption about `isDynamic`. Just confirming that is intended and not an oversight, since the two flows otherwise produce the same event.

---

## 6. Two things we believe are backend-side

### 6.1 ⚠️ VP sales dashboard users receive pushes they cannot see

Quoting your own doc (§6):

> Users whose role carries the VP sales dashboard permission have the four chat event types filtered out of **the history list and the unread count** — but that filter is applied only on the read side, not at send time.
>
> So those users **will** receive chat pushes on the device, and those notifications will then appear nowhere in the app, with a badge count that does not match what was delivered.

We agree this cannot be corrected from the client, and we are not going to try. Flagging it because it will be reported as a mobile bug the first time QA tests with a VP sales account — a banner arrives, the rep opens the app, and there is nothing there.

**Ask:** is this on your list? If it is not going to be fixed, we would like to know so we can put it in the QA notes rather than re-investigating it each release.

### 6.2 Suppressing self-triggered notifications

Several events can be caused by the rep who would receive them — most obviously `lead-cancelled`, since the mobile app has its own **Cancel Job** action in the deal-edit wizard, and chat messages the rep sends themselves.

**Ask:** does the sender get filtered out at send time? A rep does not need a push for a button they just pressed, and suppressing it on the client is too late — the phone has already buzzed.

**Our default:** we assume you filter on sender. If you do not, tell us and we will handle what we can.

---

## 7. What we are building, so you know what traffic to expect

| Phase | What lands | Traffic it generates |
|---|---|---|
| Foundation | Permission, token bind, safe routing | `POST /bind` on login **and every app start**; `DELETE /internal/device-token` on logout |
| Signatures | `addendum-signed`, `agreement-signed` deep-links | None new |
| Lead cancelled | `lead-cancelled` deep-link | None new |
| Chat | four chat types, foreground suppression | None new |
| Leads issued | `lead-issued` (three shapes), `appointment-issued` | None new |
| Notification Center | history list, badge, mark-read | `GET /unread-count` polled ~60s per active app; `GET /history` on screen open and paging |

Two notes on that last row:

- **We will poll `unread-count`.** Your doc calls it *"cheap by design — intended to be polled without pulling a page"*, so we are taking that at face value at roughly one call a minute per foregrounded app. Tell us if that is heavier than you meant.
- **`bind` fires on every cold start**, per your instruction, not only at login. On a large team that is one write per app launch.

We handle `go-back` by ignoring it entirely and never rendering it, as documented.

---

## 8. Test support we will need

Your `POST /notifications/push/v1/internal/send` with `"dryRun": true` is exactly the tool we want — it validates the token and payload for real, returns a message id, delivers nothing, and writes no history row, so it will not pollute the list we are testing against.

We will ask for a handful of sends at specific moments:

1. **One `dryRun` immediately after our first successful bind** — to confirm the token is real and reachable before we chase anything else. `devices: 0` tells us the bind never landed.
2. **One real send per event type**, once, so we can verify routing. `addendum-signed` needs **two** — one `accepted`, one `declined` — since the title is identical and only `data.outcome` separates them.
3. **One `lead-issued` in each of its three shapes** (single with `issuedLeadId`, bulk with `count`, route dispatch), because the payload differs and the bulk case cannot deep-link.

If there is a way for us to trigger `dryRun` ourselves against a test user, that would be better than coordinating each one — the endpoint is under `/internal/`, so we assume it is not exposed to us.

---

## Related

- `NOTIFICATIONS-MOBILE-API.md` — your integration guide, which this responds to
- `CHAT-MOBILE-API.md` §2.1, §7 — chat participants gate push delivery; the `chat-tagged` push predates this work
- `docs/REVUIUX-97-NOTIFICATIONS.md` — your backend implementation status
