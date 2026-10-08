# revDSM Sales — Mobile (React Native) — Repo Guide

> **What this repo is:** the React Native field-sales app for **revDSM Sales**, a door-to-door
> roofing/gutter sales CRM. It is the mobile counterpart of the web app
> (`mhalt-revDSM-sales-frontend`), which is the older and more complete reference implementation.
> Both apps share one backend.

## How this guide is organized

This root file is loaded into every session, so it holds only what applies everywhere: the stack,
conventions, the feature map, cross-cutting gotchas and scripts. **Per-feature ticket notes** (root
causes, decisions, and the ⚠️ traps not to "fix" back) live in `docs/claude/*.md` — see **§8**.

- **Before changing code in an area, read that area's part file** from the §8 table. The traps recorded
  there are specific and several were learned the hard way (reverted fixes, wrong diagnoses).
- **When you finish a change, record it in the matching part file**, in the existing ticket style —
  never append ticket notes to this root file. Only a rule that genuinely applies app-wide belongs in §6.
- Part files are NOT `@`-imported on purpose: an import would load them into every session again.
- **This is enforced, not remembered.** `.claude/hooks/doc-guard.js` (wired to `PostToolUse` + `Stop` in
  `.claude/settings.json`) names the covering part file after each edit, and blocks the end of a turn while a
  code change made that session is newer than every part file covering it — an Installer change asks for
  `installer.md`, a Deal Center change for `deal-center.md`. It routes by **parsing the §8 table below**, so
  widen a row's "Read before changing" column when a new path belongs to that area. Each set of changes is
  raised once, so a change that genuinely needs no note is dismissed in one line.

---

## 1. Stack & conventions

| Concern | Choice |
|---|---|
| Framework | **React Native 0.84**, React 19 (`App.tsx`, `index.js`) |
| Language | TypeScript (`tsconfig.json`) |
| Navigation | `@react-navigation/native-stack` — single stack in `src/navigation/index.tsx` |
| Styling | **NativeWind 4** (Tailwind, `tailwind.config.js`, `global.css`) + inline styles + `react-native-svg` |
| Server state | **TanStack Query** (`@tanstack/react-query`) — `src/services/api/queryClient.ts` |
| Client state | **Redux Toolkit + redux-persist** — `src/redux/store.ts` (persists **auth only**) |
| Local storage | **MMKV** (`react-native-mmkv`) via `src/utils/storage.ts` + AsyncStorage |
| Realtime | `socket.io-client` singleton — `src/services/SocketManager.ts` |
| Maps | `react-native-maps` (+ directions) for lead/job maps; `@rnmapbox/maps` + `supercluster` for Zone Canvasser |
| Camera/media | `react-native-vision-camera`, `react-native-image-picker`, `react-native-pdf`, `react-native-nitro-sound` (voice) |
| HTTP | axios wrapper — `src/services/api/index.ts` |

### Directory layout
- `src/screens/` — one folder per navigable screen (registered in `src/navigation/index.tsx`).
- `src/widgets/` — reusable UI: `common/` (header, inputs, buttons), `components/` (feature widget suites), `modals/`.
- `src/services/` — `SocketManager.ts` + `api/` (typed service classes: `LeadService`, `JobService`, `ChatService`, `auth`, etc.).
- `src/hooks/` — feature logic hooks (large: `useDealCalculator`, `useCalculatorSummary`, `useZoneCanvasser`, `useLeadCenterData`, chat hooks).
- `src/utils/` — business logic: `calculator/`, `dynamic-job-builder/` (schema engine), `activity-log/`, `validation/`, storage/upload/geo helpers.
- `src/redux/` — `store.ts` + `reducer/auth.reducer.ts` (only auth is in Redux).
- `src/config/env.ts` — environment config (⚠️ see gotcha below).
- `src/constants/`, `src/context/`, `src/theme/` (`ThemeProvider`), `src/types/`.

### Conventions
- Server data → TanStack Query hooks; do **not** put it in Redux (Redux is auth-only).
- Navigation params are typed in `RootStackParamList` (`src/navigation/index.tsx`) — update it when adding a screen or param.
- Cross-screen callbacks (e.g. RevRender `onGenerate`, JobBuilder `onGoBack`) are passed as **nav params**.
- Analytics: `logEvent(...)` from `src/services/api/LoggerService.ts` is used app-wide.
- The header is context-driven (`HeaderContext` / `MainHeader`) and only shown for the main authenticated screens.

---

## 2. Authentication

- **Custom JWT bearer token** (not Amplify/Auth0). Login → `/company/login`; profile → `/company`.
- State: `src/redux/reducer/auth.reducer.ts` + hook `src/hooks/useAuth.ts`.
- Token: MMKV `Storage['accessToken']` (`src/utils/storage.ts`), attached by the axios request interceptor (`src/services/api/index.ts`).
- Bootstrap: `src/hooks/useAppInitialization.ts` (restores token, reconnects socket, `getMe`, requests camera permission).
- Login/2FA mutations: `src/hooks/useAuthMutation.ts` (`useLoginMutation`, `useVerifyOtpMutation`). `deviceId = mobile-<os>-<email>`, `trustDevice`, lat/long captured.
- 401 → global logout + "Session Expired" flash (`src/services/api/index.ts`).
- Screens: `src/screens/auth/{login,forgot-password,email-otp,reset-password,authenticator-otp}.tsx`.
- **Known gap:** 2FA backup-code entry is a `// TODO` in both OTP screens.

---

## 3. Backend / environment

- Base URL is **hardcoded** in `src/config/env.ts` → `https://demo-api.revdsm.com/` (the **demo** environment).
  Also holds Google Maps, Mapbox, Apify and Weather keys, and derived S3 bucket/base URL.
- **Gotcha:** env is not build-driven (unlike web's `VITE_API_URL`). Make `env.ts` environment-aware before release.

---

## 4. Feature map (mobile)

Legend: ✅ full · 🟡 partial/in-progress · ⛔ stub. "Web ref" points into `mhalt-revDSM-sales-frontend/`.

| Feature | Status | Mobile entry | Web ref |
|---|---|---|---|
| Auth (login, forgot/reset, 2FA/OTP) | ✅ (backup codes TODO) | `src/screens/auth/*`, `src/hooks/useAuthMutation.ts` | `src/sections/auth/jwt/`, `src/api/two-factor-auth.js` |
| Leads (landing list) | ✅ | `src/screens/Leads/index.tsx` | `src/api/leads.js` (surfaced via map/job) |
| Lead Center (operational hub) | ✅ | `src/screens/LeadCenter/index.tsx`, `src/widgets/components/LeadCenter/*`, `src/widgets/modals/lead-center/*` | `src/sections/job/view/job-capture-images-view.js` |
| Map view | ✅ | `src/screens/MapDetail/index.tsx`, `src/widgets/modals/MapFiltersModal.tsx` | `src/sections/map/` |
| Zone Canvasser (footsteps map: zones create / delete / archive / unarchive, address search) | ✅ | `src/hooks/useZoneCanvasser.ts`, `src/services/api/zone-canvasser.ts`, `src/utils/zone-helpers.ts`, `src/widgets/components/ZoneCanvasser/*` | `src/sections/map/zone-canvasser/`, `src/api/zone-canvasser.js` |
| Deal Center (quoting calculator) | ✅ | `src/screens/DealCenter/index.tsx`, `src/hooks/useDealCalculator.ts`, `src/widgets/components/dealcenter/*` | `src/sections/deal-center/` |
| **Dynamic Deal Center / Job Builder** | 🟡 **in progress (see §5)** | `src/screens/DynamicDealCenter/*`, `src/utils/dynamic-job-builder/*` | `src/components/dynamic-job-builder/`, `src/sections/deal-center/` |
| Job Builder | ✅ | `src/screens/JobBuilder/index.tsx`, `src/widgets/components/job-builder/*` | `src/sections/job/components/job-builder-*` |
| Job Tracker | ✅ | `src/screens/JobTracker/index.tsx` | `src/sections/job-tracker/` |
| RevRender (before/after) | ✅ | `src/screens/RevRender/index.tsx` | `src/pages/dashboard/rev-render/` |
| Image Annotation | ✅ | `src/screens/ImageAnnotation/index.tsx` (WebView canvas) | `src/components/image-annotation/` |
| Pitch Book (+ dynamic portal-authored books) | ✅ | `src/screens/Pitchbook/index.tsx`, `src/hooks/usePitchBooks.ts`, `src/utils/pitch-book.ts` | `src/sections/pitch-book/` (static only — web has no pitch-book API client) |
| Roofline Deck | ✅ | `src/screens/RooflineDeck/index.tsx` | `src/sections/roofline-deck/` |
| Chat (leads + team channels) | ✅ | `src/screens/{ChatThreads,ChatDetail}/*`, `src/widgets/components/chat/*` | `src/components/chat-module/`, `team-channels/` |
| Voice notes | ✅ | `src/hooks/useVoiceNote.ts`, `VoiceNotePlayer.tsx` | `src/components/voice-recorder/` |
| Document Scanner | ✅ | `src/widgets/modals/job-builder/DocumentScannerModal.tsx` | `src/components/document-scanner/` |
| Signatures / agreements | ✅ | `src/widgets/modals/job-builder/AgreementSignatureModal.tsx` | `src/sections/job/components/agreement-generator/` |
| Consent / roof waiver | ✅ | `src/widgets/modals/lead-center/{ConsentForm,RoofWaiver}.tsx`, `src/hooks/useRoofWaiver.ts` | `src/api/{consent,consent-form}.js` |
| Offline image upload queue | ✅ (mobile strength) | `src/services/api/offlineUploadManager.ts`, `src/utils/uploadQueue.ts` | `src/utils/background-report-service.js` (partial analog) |
| Referral | ✅ | `src/widgets/modals/ReferralModal.tsx` | `src/api/referral.js` |
| Profile / settings (+2FA mgmt) | ✅ | `src/screens/Profile/index.tsx` | `src/sections/account/`, `src/api/profile.js` |
| Appointments / scheduler | 🟡 in-flow only, no standalone screen | `src/widgets/modals/job-builder/AppointmentSchedulerModal.tsx` | `src/sections/calculator-appointment/` |
| Deal details / drafts | 🟡 outcome modals only, no drafts browser | `src/widgets/modals/DealCenter/OutcomeModal.tsx` | `src/sections/deal/`, `src/pages/deal-drafts.js` |
| My Deals (deal list → detail) | ✅ detail **reuses Lead Center** (see below) | `src/screens/MyDeals/index.tsx` → `LeadCenter` w/ `fromMyDeals` | `src/sections/deal/view/deal-details-view.js` |
| My Learning (LMS) | ⛔ 34-line stub | `src/screens/Learning/index.tsx` | external LMS redirect |
| User management (other users) | ⛔ not implemented (own profile only) | — | `src/sections/user/` |

---

## 5. Dynamic Deal Center / Dynamic Job Builder

Full notes: **`docs/claude/deal-center.md`** (create flow) and **`docs/claude/deal-edit-addendums.md`**
(My Deals edit wizard / addendums). The one fact to hold onto everywhere:

- **Two data models, two endpoints — never conflate them.** System A, the **calculator + rollout**, is
  category-shaped with per-field `price: { cost, par, retail }` — `GET /calculator-form-schemas/deal-center`.
  System B, the **job builder**, is vertical/tab-shaped (allocations, swatches, grids; no prices) —
  `GET /company/v1/job-builder-products`.
- `useCalculatorSchema` returns `schemas` AND `configuredSchemas`: the latter only gates UI; **anything that
  prices must take `schemas`**.

---

## 6. Key gotchas (app-wide)

**Architecture**
- **Redux is auth-only** — server data is TanStack Query + hooks + MMKV.
- **Two map stacks** — `react-native-maps` (Google, lead/job maps) vs `@rnmapbox/maps` (Zone Canvasser).
- **Hardcoded demo API URL** in `src/config/env.ts` (§3).
- **The dynamic job-builder engine runs on the JS thread** (web uses workers) — watch large schemas.
- **Web is the source of truth for behaviour**, but several **deliberate divergences** are recorded in the
  part files (each marked "do NOT re-sync"). Check the area's notes before "restoring parity".
- **The bare lead-scoped `lead/v1/{leadId}/outcome` read is removed app-wide** — use the calculator-scoped
  outcome calls and `downloadOutcomeDocuments`. Details in `docs/claude/lead-center.md`.
- **Largest files** (edit with care): `widgets/components/dealcenter/CalculatorSummary.tsx`,
  `widgets/components/job-builder/SummarySection.tsx`, `screens/JobBuilder/index.tsx`.

**Editing files**
- ⚠️ **Many files are CRLF.** A script that reads/writes in text mode rewrites every line to LF and buries
  the change in a whole-file diff. Use `newline=''` on BOTH read and write, and check `file <path>` before
  and after. Known CRLF: `dynamic-deal-diff.ts`, `drop-prices.ts`, `useDynamicCalculators.ts`,
  `RolloutView.tsx`, `EditCustomerModal.tsx`, `DynamicInspectionRenderer.tsx`, `InstallerJobCard.tsx`,
  `Installer/index.tsx`, `SummaryFinalizeCards.tsx`, `AppointmentSchedulerModal.tsx`, `InvestmentPanel.tsx`,
  `useZoneCanvasser.ts`, `navigation/index.tsx`, `MapDetail/index.tsx`, `ThreadItems.tsx`, `LeadMap.tsx`,
  `MapFiltersModal.tsx`, the iOS `Info.plist` /
  `project.pbxproj` — and more; always check. `ChatThreads/index.tsx` is also **pure ASCII**.
- ⚠️ **Write control characters as escape sequences** (`'\u0000'`, `'\u0002'`), never raw bytes — a raw one
  makes grep treat the file as binary.
- ⚠️ `git log -- <file>` **hides a change undone by a merge**; use `git diff <sha> HEAD -- <file>` to find
  merge-reverted fixes (the TNT-board fix was lost exactly this way).

**Testing**
- Anything importing React Native, reanimated, `react-native-blob-util` or the document-scanner plugin
  **cannot be loaded under jest here** — put the rule in a pure `src/utils/*.ts` and test that (the pattern
  used throughout the part files). There is no global reanimated or blob-util mock.
- `@testing-library/react-native`'s `render` returns **no queries** (React 19 test-renderer shim), so
  component tests don't work; driving a HOOK through `react-test-renderer` does.
- ⚠️ `__tests__/` **and `yarn.lock` are gitignored** — suites don't survive a clone or run in CI, and added
  dependencies don't reach other machines through a lockfile.

**React Native traps**
- ⚠️ **A `Modal` is its own native view tree.** The app-root `GestureHandlerRootView` does not reach it
  (wrap the modal's content in its own); `useSafeAreaInsets()` reads **0 or stale** inside it (apply
  floors); declarative `<StatusBar hidden />` doesn't reliably win (call `StatusBar.setHidden`).
- ⚠️ **Never stack native Modals** — use an in-card overlay. iOS silently drops a presentation requested
  while another modal is still dismissing (this froze the CoC Paper Fallback scanner), and a flash raised
  under a dismissing modal is never seen.
- ⚠️ **A sibling `GestureDetector` swallows touches whatever its `zIndex`** — `zIndex` orders painting only.
  Compose gestures into one detector instead of overlaying strips.
- ⚠️ **Never write a style value as `x ? v : undefined`** in an object a library merges last — a present
  `undefined` wipes the library's own value (this made every non-danger `FlashMessage.show()` transparent).
  Spread the key in or omit it.
- **Padding on a `ScrollView` belongs in `contentContainerStyle`** — on `style` it shrinks the frame and
  makes the last content unreachable.
- **Scrolling forms use `KeyboardAwareScrollView`** (`react-native-keyboard-controller`);
  `automaticallyAdjustKeyboardInsets` is iOS-only.
- RN has no `translateY(-50%)` — centre with `top: '50%'` plus a negative half-height margin.

**Data & correctness**
- ⚠️ **Parse ISO date strings as TEXT** — a timezone offset shifts the calendar day through `new Date()`,
  and several of these dates end up on signed documents.
- ⚠️ **`??` vs `||`**: `||` falls through on `false`/`0` (a tick box unticked on paper must stay unticked);
  `??` does NOT fall through on `0` (a zero alias shadowed a real quantity in pricing).
- ⚠️ **Never log document payloads or base64** — with DevTools attached every logged string crosses the CDP
  websocket (this was most of an 18 s upload). Route traffic logs through `utils/sanitize-for-log.ts`.

**Platform & media**
- **Pre-signed S3 photo URLs defeat `Image.prefetch` and `cache: 'force-cache'`.** Anything that must appear
  instantly goes through the local-file cache (`utils/imageFileCache.ts`, `hooks/useWarmedImageUris.ts`,
  or `PhotoPeekPressable`, which warms its own).
- **Public Sans is forced app-wide** by the `ScaledText` patch in `index.js` (`utils/default-font.ts`). A face
  must be paired with `fontWeight: 'normal'` or Android falls back to the device font; only two italic
  families are bundled. If device fonts reappear, check `index.js` first.
- **Numeric inputs use the in-app number pad, never the system keyboard** (global `TextInput` + `Modal` patches in `index.js`; `NumPadProvider`). Every native tree needs a provider above its fields; `numPad={false}` opts a field out. Details and traps: `docs/claude/app-wide.md`.
- **iPad is not "a big phone"**: numeric inputs take `NUMERIC_KEYBOARD` / `NUMBER_PAD_KEYBOARD` from
  `utils/keyboard-type.ts`; full-screen layouts sized from width must be capped by the remaining height;
  landscape is allowed, so prefer `useWindowDimensions()` over `Dimensions.get('window')`.
- The **iOS 18.4 simulator** fails every `maps.googleapis.com` request over HTTP/3 — test Google address
  lookups on an 18.5+ simulator or a device.

---

## 7. Scripts

```
yarn ios / yarn android    # run
yarn start                 # Metro
yarn lint                  # eslint
yarn test                  # jest
```

**iOS pods: run `bundle exec pod install` from `ios/`, never a bare `pod install`.** CocoaPods is pinned in the
root `Gemfile` and installed into `./vendor/bundle`, so there is no global `pod` (and a global install would
sidestep the pin and churn `Podfile.lock`); `yarn ios` runs it for you. ⚠️ Ruby 3.4+ needs
`gem 'nkf'` in the Gemfile (CocoaPods requires `kconv`) — don't drop it when resolving a Gemfile conflict.

---

## 8. Detailed notes — `docs/claude/`

| Part file | Covers | Read before changing |
|---|---|---|
| [`deal-center.md`](docs/claude/deal-center.md) | Dynamic Deal Center architecture; calculators & tab naming, rollout, drops, Result, rehash, full-package badge, Complete-Job payload, TNT board, ticket 409, job-builder draft autosave & logs | `screens/DynamicDealCenter/**` (create flow), `utils/dynamic-job-builder/**`, `widgets/components/dynamic-job-builder/**`, `utils/drop-prices.ts`, `screens/DealCenter/**`, `widgets/components/dealcenter/**`, `utils/calculator/**`, `hooks/useDealCalculator.ts`, `hooks/useCalculatorSummary.ts`, `hooks/useRehashLeads.ts`, `screens/JobBuilder/**`, `widgets/components/job-builder/**`, `widgets/modals/job-builder/**`, `utils/agreement-delivery.ts` |
| [`deal-edit-addendums.md`](docs/claude/deal-edit-addendums.md) | My Deals edit wizard: install-date step, Job Price pricing & validation, Addendum Review diff, payment methods, summary documents | `DynamicDealEditScreen.tsx`, `dynamic-deal-diff.ts`, `dynamic-deal-pricing.ts`, `SummaryFinalizeCards.tsx`, `DocumentScannerModal.tsx`, `utils/addendum-*.ts`, `hooks/useLeadPendingAddendums.ts`, `utils/job-change-summary.ts` |
| [`lead-center.md`](docs/claude/lead-center.md) | Lead Center & My Deals detail, contract card & addendums list, Edit Customer (validation, co-buyers, logs), document scanner & receipts, outcome-endpoint removal, pull-to-refresh, annotation zoom, inspection slots | `screens/LeadCenter/**`, `screens/MyDeals/**`, `widgets/components/LeadCenter/**`, `widgets/modals/lead-center/**`, `hooks/useLead*.ts`, `hooks/useRoofWaiver.ts`, `hooks/useDealOutcome.ts`, `hooks/useRepPhotoSections.ts`, `widgets/components/lead-center/**` |
| [`installer.md`](docs/claude/installer.md) | Installer jobs list & cards, CoC paper fallback / scan / PDF, pre/post-install photo matching, sold-scope rendering | `screens/Installer/**`, `widgets/components/installer/**`, `services/api/installer.ts`, `utils/installer-*.ts`, `hooks/useInstaller*.ts`, `hooks/useInstallProgress.ts` |
| [`notifications-chat.md`](docs/claude/notifications-chat.md) | Notification Center, push routing (`agreement-signed`, `lead-issued`, `chat-reaction`), chat header photo, job-change addendum cards, chat thread filter | `screens/Notifications/**`, `screens/Chat*/**`, `widgets/components/chat/**`, `utils/push-routing.ts`, `utils/lead-thread-order.ts`, `hooks/useChat*.ts`, `hooks/useNotifications.ts`, `hooks/usePushNotifications.ts`, `utils/notification-groups.ts`, `widgets/modals/chat/**`, `services/api/ChatService.ts` |
| [`pitch-book.md`](docs/claude/pitch-book.md) | Portal-authored pitch books, slide zoom, inspection photos panel, fullscreen presentation (tutorial, dock, top bar, arrows, auto-hide, tab strip) | `screens/Pitchbook/**`, `screens/RooflineDeck/**`, `widgets/components/pitchbook/**`, `ZoomableImage.tsx`, `InspectionPhotosPanel.tsx`, `hooks/usePitchBooks.ts`, `hooks/useTabStripAutoScroll.ts`, `utils/pitch-book.ts`, `utils/inspection-photos.ts`, `utils/presentation-tutorial.ts`, `utils/zoom-transform.ts` |
| [`maps-zone-canvasser.md`](docs/claude/maps-zone-canvasser.md) | Map header icons (`HeaderContext` merge), Zone Canvasser endpoints, delete/archive, search bar, zone create, sales pins (category colours, status filter, legend, job card) | `screens/MapDetail/**`, `navigation/index.tsx`, `useZoneCanvasser.ts`, `widgets/components/ZoneCanvasser/**`, `utils/zone-*.ts`, `services/api/zone-canvasser.ts`, `utils/sales-pins.ts`, `MapFiltersModal.tsx`, `LeadMap.tsx`, `MapJobCard.tsx`, `widgets/modals/LeadCreate/**` (lead coordinates → pin location), `utils/places.ts` |
| [`investment-center-job-tracker.md`](docs/claude/investment-center-job-tracker.md) | Investment Center spotlight, tile unlock, drop down-payment seed; Job Tracker calendar, status chip, add modal | `screens/InvestmentCenter/**`, `screens/JobTracker/**`, `useLeadCalculatorStatus.ts`, `hooks/useJobTracker.ts` |
| [`offline.md`](docs/claude/offline.md) | Offline queues & connectivity, background upload service (iOS grace period, Android foreground service), coordinator drain order | `services/background/**`, `services/offline*.ts`, `services/connectivity.ts`, `services/sessionScope.ts`, `services/dealCenterWarmer.ts`, `utils/offline-*.ts`, `utils/background-upload-policy.ts`, `utils/connectivity-state.ts`, `utils/session-scope.ts`, `utils/uploadQueue.ts`, `utils/pending-inspection-photos.ts`, `services/api/offlineUploadManager.ts`, `hooks/useIsOnline.ts`, `widgets/common/OfflineBanner.tsx`, `widgets/components/PendingLeadsBanner.tsx`, `ios/revDSM_Sales/BackgroundUploadTask.*`, `utils/report-job-connectivity.ts`, `utils/network-error.ts` |
| [`app-wide.md`](docs/claude/app-wide.md) | Public Sans font forcing, iPad keyboard & camera, hold-to-peek image cache, log sanitizing, `FlashMessage` banner | `index.js`, `utils/default-font.ts`, `utils/keyboard-type.ts`, `utils/imageFileCache.ts`, `services/api/index.ts`, `config/message.ts`, `hooks/useWarmedImageUris.ts`, `utils/sanitize-for-log.ts`, `utils/platform-font.ts`, `widgets/common/**`, `config/env.ts`, `utils/storage.ts`, `utils/numpad.ts`, `widgets/common/keyboard/**`, `widgets/common/CustomInput.tsx`, `screens/RevRender/**`, `utils/revrender-lighting/**` |
