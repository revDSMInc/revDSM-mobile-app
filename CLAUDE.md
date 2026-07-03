# revDSM Sales — Mobile (React Native) — Repo Guide

> **What this repo is:** the React Native field-sales app for **revDSM Sales**, a door-to-door
> roofing/gutter sales CRM. It is the mobile counterpart of the web app
> (`mhalt-revDSM-sales-frontend`), which is the older and more complete reference implementation.
> Both apps share one backend.
>
> This document is a working guide to the mobile codebase: stack, conventions, feature map, and the
> known in-progress areas. Status reflects the repo as of **2026-07-02**.

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
| Zone Canvasser | ✅ | `src/hooks/useZoneCanvasser.ts`, `src/widgets/components/ZoneCanvasser/*` | `src/sections/map/zone-canvasser/` |
| Deal Center (quoting calculator) | ✅ | `src/screens/DealCenter/index.tsx`, `src/hooks/useDealCalculator.ts`, `src/widgets/components/dealcenter/*` | `src/sections/deal-center/` |
| **Dynamic Deal Center / Job Builder** | 🟡 **in progress (see §5)** | `src/screens/DynamicDealCenter/*`, `src/utils/dynamic-job-builder/*` | `src/components/dynamic-job-builder/`, `src/sections/deal-center/` |
| Job Builder | ✅ | `src/screens/JobBuilder/index.tsx`, `src/widgets/components/job-builder/*` | `src/sections/job/components/job-builder-*` |
| Job Tracker | ✅ | `src/screens/JobTracker/index.tsx` | `src/sections/job-tracker/` |
| RevRender (before/after) | ✅ | `src/screens/RevRender/index.tsx` | `src/pages/dashboard/rev-render/` |
| Image Annotation | ✅ | `src/screens/ImageAnnotation/index.tsx` (WebView canvas) | `src/components/image-annotation/` |
| Pitch Book | ✅ | `src/screens/Pitchbook/index.tsx` | `src/sections/pitch-book/` |
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
| My Learning (LMS) | ⛔ 34-line stub | `src/screens/Learning/index.tsx` | external LMS redirect |
| User management (other users) | ⛔ not implemented (own profile only) | — | `src/sections/user/` |

---

## 5. Dynamic Deal Center / Dynamic Job Builder — in-progress area

This is the schema-driven ("dynamic") calculator + job-builder that renders forms from a backend
config instead of hardcoded verticals. It is the mobile counterpart of the web
`src/components/dynamic-job-builder/` engine + `src/sections/deal-center/`.

**The flow has two distinct data models — do not conflate them:**
- **Calculator + Rollout (System A)** — a **category-shaped** schema (`types/calculator.ts`:
  `CalculatorSchema { categories[] }`, each field carries `price: { cost, par, retail }`). Drives
  the pricing calculator and the rollout end-price step. Rendered by `CalculatorView.tsx` /
  `RolloutView.tsx`.
- **Job Builder (System B)** — a **vertical/tab-shaped** config (`utils/dynamic-job-builder/types.ts`:
  `JobBuilderConfig { verticals[].tabs[] }`, fields are `allocation`/`swatch`/`locationGrid`/`toggle`
  etc. — measurements & colors, no pricing tiers). This is the *product configurator* step reached
  **after** Result. Rendered by `DynamicJobBuilderScreen.tsx` + `DynamicTabRenderer`.
- The two systems have **two different backend endpoints** (both mirror the web — do not merge them):
  - System A (calculator + rollout): **`GET /calculator-form-schemas/deal-center`** — web ref
    `src/api/calculator-form-schemas.js`. Returns `{ data: [entity] }`, each entity holds
    `calculatorFormSchema.categories[]` with per-field `price: { retail, cost, par }`.
  - System B (job builder config): **`GET /company/v1/job-builder-products`** — web ref
    `src/api/job-builder-products.js`. Returns `{ code: 200, data: { verticals[], products[] } }`,
    consumed only by the vertical picker (`DynamicViewAllCalculators.tsx`). It is **not** the
    calculator's data source.
  - ⚠️ Both once pointed at a wrong `/api/calculator-schemas` path — corrected 2026-07-02.

**Layout (mobile):**
- Screen flow: `src/screens/DynamicDealCenter/components/DynamicDealCenterScreen.tsx` (registered as
  `DynamicDealCenter`) → `CalculatorView.tsx` → `RolloutView.tsx` → `ResultJobModal.tsx` →
  `DynamicJobBuilderScreen.tsx`. Flow steps: `calculator → rollout → result → jobBuilder`.
- **Calculator schema loader (System A): `src/screens/DynamicDealCenter/hooks/useCalculatorSchema.ts`**
  — the single seam for the calculator schema. Fetches `GET /calculator-form-schemas/deal-center` and
  normalizes the payload exactly like the web (`normalizeSchema`/`Category`/`Section`/`Field`), keeping
  only "configured" schemas (those with fields). Falls back to the bundled template
  (`constants/mock-calculator-schema.ts` → `DEMO_CALCULATOR_SCHEMA`) when nothing is configured. Exposes
  `{ schema, schemas, configuredSchemas, isRemote, isConfigured, isLoading }` (`schema` = first
  configured schema, else template).
- Job-builder config fetch (System B): `src/screens/DynamicDealCenter/hooks/useDynamicCalculatorSchemas.ts`
  — fetches `GET /company/v1/job-builder-products`, normalizes the lightweight doc and ensures each
  vertical has a Summary tab (`ensureVerticalSummaryTabs`), falls back to `createDefaultJobBuilderConfig()`.
  Exposes `{ verticals, config, isRemote, isLoading }`.
- **Calculator persistence (System A): `src/screens/DynamicDealCenter/hooks/useDynamicCalculators.ts`**
  — the schema-driven counterpart of the web `DealCenterContext`. Signature is
  `useDynamicCalculators(lead, schemas)` (schemas = the configured verticals, needed for dynamic naming).
  **Bootstrap (web parity with the "Dynamic Deal Center" tool handler in `job-capture-images-view.js`):**
  `resolveAppointmentId(lead)` uses `lead.appointmentId` if present, else `GET /appointments?lead_date={leadDate}`
  and matches by human `leadId` or `selfGenLeadId`, else **creates a new appointment**
  (`POST /appointments { title, address, leadId, selfGenLeadId }`) — mobile previously stopped at "not found →
  local mode" and never created one. Then loads saved calculators (`GET /appointments/{id}/lfcalculators`);
  if none exist it **creates one**. It **debounce-saves on every field change**
  (`PUT /lfcalculators/{id}` with `{ title, entries: Object.values(map), totals, isRolloutConfirmed,
  price, schemaSnapshotId, leadId, enteredBy, enteredAt }`). New calculators are **created with a numeric
  placeholder name** (`POST` with `title: String(position)`, `position`, and the **full seeded entries**) — the
  real name is then **derived live from the entered values** (see `tab-naming.ts` below), so create/
  duplicate/delete/reorder all end with a `retitle()` pass. Also handles delete via `LeadService`; falls
  back to a purely local (unsaved) tab when no appointment resolves. Exposes `{ tabs, activeTabId,
  setActiveTabId, loading, isSaving, lastUpdated, handleEntryChange, handleAddTab, handleDuplicateTab,
  handleDeleteTab, handleRenameTab, handleReorderTabs, handleConfirmRollouts }`; the screen header shows a
  "Syncing…" / "Last updated at" status from it.
  - **Save engine ports web `DealCenterContext.flushSave`/`scheduleDebouncedSave` exactly** (this was the
    prior mobile↔web save divergence): `SAVE_DEBOUNCE_MS = 1500` (was 800); a **per-tab in-flight guard +
    follow-up** (`saveInFlight`/`needsFollowUp` refs) so two PUTs never overlap for one calculator and the
    latest state is re-saved after an in-flight save resolves; the debounced flush **reads the current tab
    from `tabsRef`** (like web's `entriesRef.current`) instead of a stale closure; a **`dirty` ref** skips
    no-op saves and drives an **unmount flush** — any dirty persisted calculator is `PUT` immediately on
    unmount so a value typed then quickly navigated away from is not lost. Payload mirrors web's
    `buildSavePayload` (adds `enteredBy` from `useAuth().user`), plus mobile-only `title`/`isRolloutConfirmed`/`price`.
  - **Entries are the FULL flattened field list, not just touched fields** (`utils/build-all-entries.ts`,
    port of web `buildAllEntriesFromSchema`). Web persists EVERY field across EVERY vertical — each with
    `pricingAtTimeOfEntry` from the schema and `inputValue: 0` for anything untouched — so every
    `PUT /lfcalculators/{id}` sends the complete entries array (the actual web payload has ~100+ entries with
    one non-zero). Mobile now seeds this on **create** (`mergeFullEntries({}, schemas)`), **hydrate**
    (`mergeFullEntries(parseEntries(saved), schemas)` back-fills missing fields), **local add**
    (`buildAllEntriesMap`), and **duplicate**. Direct (section-less) fields save under
    `sectionId = \`${categoryId}__direct\`` (was a bare `'__direct'`), and each entry carries
    `productName` (`schema.name || ''`) — both matching the web payload. Consumers that list entered items
    (Job Summary, rollout item rows, rollout category chips) filter on `inputValue > 0` so the zero-seeds
    stay hidden. `sanitizeCalculatorPayload` (`services/api/leads.ts`) was extended so entry descriptor
    string fields (`unit`, `label`, `productName`, `sectionId`, `categoryId`, `fieldId`, …) keep `''` instead
    of being coerced to `0`.
- **Dynamic tab naming: `src/screens/DynamicDealCenter/utils/tab-naming.ts`** (port of web
  `tab-naming.utils.js`). `getLiveSchemaBaseName(entries, schemas)` derives a base name from which schema
  categories have a filled field, joined by category initials (`getCategoryInitials`: "Gutters"→"G",
  "LeafFilter"→"LF") — e.g. `G+LF`. `computeDerivedTitles(tabs, schemas)` returns `id → title`: manual
  renames win; empty calculators fall back to their 1-based position; same-name calculators are
  disambiguated by retail price with `(SM)`/`(MD)`/`(LG)…` suffixes, or flagged `⚠️ base ⚠️` when two share
  the same name **and** price. The hook applies this on every mutation and when schemas load.
- **Conditional fields: `src/screens/DynamicDealCenter/utils/field-dependency.ts`** (port of web
  `field-dependency-utils.js`). A schema field's `conditional` reacts to OTHER fields having a value
  (`dependsOn`, `matchMode` any/all): `valueMode: 'highlight'` tints the dependent field's background
  (`highlightColor`, default `#FFEB3B`) while its parent is filled (e.g. gutter DS/E = 5 → wedges bg turns
  yellow); `valueMode: 'fixed'` auto-fills the dependent with `fixedValue` and locks it. `CalculatorView`
  builds a flattened `allFields` (across all verticals) + a `formState` map (keyed by field id AND name →
  value) and passes them to each `CategoryCard`, which resolves highlight/fixed per field.
- **Dynamic icons/colors: `src/screens/DynamicDealCenter/utils/icon-color.ts`.** Schema `icon` is an
  Iconify string (`mdi:home`, `solar:home-2-bold-duotone`, `mdi:leaf`) and `color` is a hex or MUI token
  (`success.main`, `warning.dark`). `iconifyToIonicons` translates the icon to the closest Ionicons name
  and `resolveSchemaColor` resolves the color to hex; `resolveSchemaStyle` combines them (falling back to
  a name-based palette only when the schema supplies neither). Used for the vertical pills, category
  cards, Job Summary rows, and rollout item rows/pills — so icons are **data-driven**, matching web.
- Session hook: `src/screens/DynamicDealCenter/useDynamicJobBuilderSession.ts`.
- Engine: `src/utils/dynamic-job-builder/engine/*` (~4k lines — `dependency-engine`,
  `allocation-config-utils`, `dynamic-job-state-storage`, `allocation-value-resolver`,
  `dynamic-activity-log-utils`), `constants/`, `types.ts`.
- Field widgets: `src/widgets/components/dynamic-job-builder/*` (`InputField`, `OptionList`,
  `ToggleGroup`, `LockedField`, `DynamicTabRenderer`).
- Types: `src/screens/DynamicDealCenter/types/calculator.ts`.

**Status: 🟡 calculator + rollout corrected; Job Builder wiring still pending.**

Done (calculator + rollout):
- **Payment plans + discount tiers are now BACKEND-DRIVEN (web parity), not static constants.** New hook
  `src/screens/DynamicDealCenter/hooks/useDealPricing.ts` fetches, normalizes (1:1 with the web
  `useGetPaymentPlans` / `useGetDiscountConfig`), and returns a `DealPricing` object:
  - `plans` : `GET /payment-plans/v1/sales/provider-plans` → `{ [key]: DealPlan }` (provider plans +
    standalone, `paymentFactor→pf`); `categories` groups **basics (cash/card) flat + one group per
    financing provider** (colored by `providerColor`/`getGroupColor` fallback), `dropAddCategories` =
    financing groups only, `outcomeDownPaymentMethods` = cash/card plans, `defaultMethod` = lead-aware.
  - discount : `GET /company/v1/discount-config/sales` → `preOrderOptions` (e.g. 15/20/25),
    `defaultPreOrder` (config `isDefault`, else 25), `seniorVetPct` (usually 10) — the Sr+Vet % and
    pre-order tiles/MSRP are now driven by these, no longer hardcoded `+10` / `[15,20,25]` / default 15.
  - **Static fallback**: when either endpoint returns nothing configured (or errors), it falls back to the
    same shared `payment-plans.ts` / `lowes-payment-util.ts` the regular mobile Deal Center uses, so the UI
    is identical either way. `isDynamic` flags which path is live.
  - `pricing` is created once in `DynamicDealCenterScreen` and threaded to `RolloutView` + `ResultJobModal`
    (both replaced their static `paymentPlans` / `getRolloutPaymentCategories` / `getOutcomeDownPaymentMethods`
    imports with `pricing.*`). Pure plan-math helpers (`planLabelOf`, `calcMonthly`, `withPlanFee`,
    `isFinancing`, `planBelowMin`, `belowMinMsg`) now take the resolved `plans` map. `endPriceError` /
    drop validation are **minPrice-driven** (a plan's `minPrice`, e.g. 7,500, is the single source of truth —
    web parity), so the old `WELLS_FARGO_HIGH_KEYS` / `WF_HIGH_MIN_PRICE` special case is gone.
  - **Demo/result reasons stay STATIC** (`ResultJobModal` `DEMO_REASONS`) — there is NO reasons endpoint on
    either platform; the web hardcodes them everywhere too. This is the only intentionally-static list left.

  > Note: the bullets below that reference `getRolloutPaymentCategories` / `getDefaultPaymentMethod` /
  > `getOutcomeDownPaymentMethods` / `15-20-25` / WF constants now describe the **fallback** path; the live
  > path is `useDealPricing`.
- **UI replicated from the old (non-dynamic) deal center — verticals on top, categories stacked.**
  `CalculatorView` renders a **horizontal *vertical* (product) scroller on top** (from
  `configuredSchemas`, one pill per product like web's Flooring / Roofing / Gutter-Roofline; shown only
  when >1 vertical, matching web). Each pill shows its **schema icon** + name, and the active pill is
  filled with its color + a close (✕) glyph — mirroring web's `deal-center-view.js` product tabs.
  Selecting a vertical reveals **all of its categories stacked as collapsible cards** (`CategoryCard`) —
  the old deal center `Section` look (rounded white card, icon-circle header, chevron toggle) with
  schema-driven `FieldRow` inputs (floating label, bordered input, unit + green retail-price badge). A
  **Job Summary** card (entered items grouped by category, spanning all verticals) and a **Totals** card
  follow, matching `src/widgets/components/dealcenter/{CalculatorForm,SharedElements}.tsx`.
  The footer reuses the deal center **`HorizontalDraggableTabs`** (drag-reorder + long-press menu →
  duplicate / rename / delete) plus add (＋) and view-all/rollout (grid) buttons; the shared component
  gained an optional `getIsDuplicate` prop so the gutter-specific duplicate check doesn't misfire on
  schema-driven tabs (dynamic passes `() => false`). The screen header is the compact deal-center bar
  (back button + **lead name** `+ " - {leadTime} Lead"` + Syncing/Last-updated status), matching the
  regular `DealCenter` header (`src/screens/DealCenter/index.tsx` line ~468) — the active calculator name
  lives in the bottom tab bar, not the header. The global `MainHeader` still shows (parity with
  `DealCenter` in `navigation/index.tsx`'s `showHeader` list). `CalculatorView` takes `verticals` (not a
  single `schema`) + `onReorderTabs`.
- **Icons/colors are schema-driven (not hard-coded).** Vertical pills, category cards, Job Summary rows,
  and rollout item rows/pills all resolve icon+color from the schema via `utils/icon-color.ts`
  (Iconify → Ionicons + hex/token resolution), falling back to the name-based palette only when the
  schema omits both. Schema `product.icon`/`product.color` and `category.icon`/`category.color` now flow
  through (added to `CalculatorSchema['product']` + `normalizeSchema`).
- **Field entries auto-save to the API, matching web's save engine 1:1.** `useDynamicCalculators` persists
  every field change (debounced `PUT /lfcalculators/{id}` with `{ title, entries, totals, schemaSnapshotId,
  leadId, enteredBy, enteredAt, … }`) and hydrates saved calculators on open. The debounce (1500 ms),
  **in-flight guard + follow-up save**, **latest-state read**, and **unmount flush** now mirror web's
  `DealCenterContext` — closing the earlier gap where a quickly-navigated-away edit could be dropped or two
  saves could race. Tab add/duplicate/delete hit the backend too (`POST`/`DELETE` on
  `/appointments/{id}/lfcalculators` and `/lfcalculators/{id}`; create sends a numeric placeholder title);
  reorder is local.
- **Calculator name is dynamic.** The calculator has no fixed name — its title is **derived live from the
  entered values** (`tab-naming.ts`: `G+LF`, `(SM)`/`(LG)`, `⚠️ … ⚠️`), and shows in the tabs footer. The
  screen header shows the **lead** (customer name + lead time), NOT the calc name (see the header bullet
  above); the header subtext is "Syncing…" / "Last updated at …" / "No changes to save".
- **Saved values hydrate back into the inputs on reopen.** `useDynamicCalculators` loads the calculator's
  `entries` array (`GET /appointments/{id}/lfcalculators`) and maps each `{ fieldId, inputValue, … }` by
  `fieldId`; `FieldRow` reads `entries[field.id].inputValue` so a rep sees what they entered earlier.
  Two robustness fixes: (1) if the real schema arrives AFTER the calculators load, the `[schemas]` effect
  back-fills the full field seed onto every tab (`{ ...seed, ...t.entries }`) so saved values line up with
  the schema field ids — entered values are never overwritten, only missing fields are added; (2) on
  (re)open `CalculatorView` auto-selects the **vertical that already has entered values** (one-shot per
  mount, never fights a later manual switch) so the rep isn't dropped on an empty first vertical while
  their data sits in another. NOTE: this reads the dynamic `entries` array (web parity) — a legacy
  calculator whose values live only in the old top-level columns (`wedges`, `gutter5DsE`, …) with an
  all-zero `entries` array will show zeros, exactly as web's dynamic deal center does.
- **Field UI matches web exactly.** In `CategoryCard`/`FieldRow`: on focus the input **border turns green**
  (`#4CBB17`); entering a value **no longer changes the background** (was a green tint). A conditional
  **highlight** dependent field tints its background (`highlightColor`) while its parent is filled; a
  **fixed** dependent field is auto-filled + locked (`utils/field-dependency.ts`). The per-category **blue
  count chip was removed**; a red **Clear** button now appears next to the chevron when the category has
  values and clears all of its fields (mirrors web's category Clear button).
- **Rollout card order matches the regular mobile rollout** (`CalculatorSummary`): the `PremiumQuoteCard`
  sections now paint top-to-bottom as **(1) heading** (calculator name + LOCKED badge) → **(2) Payment
  Method** selector + Set-as-Default toggle → **(3) list of items** (category pills + entered line-item
  rows: icon-circle + `{qty}{unit} {label}`, grouped by category, dynamic icons) → **(4) COST/PAR/RETAIL
  tiles** (payment-plan-fee-inflated; **all three carry the $200 floor independently**) → **(5) green
  Rollout-End-Price sub-card** (with inline validation; once confirmed the box becomes a **chevron toggle**
  that collapses/expands the breakdown) → **(5b) result breakdown** (End Price w/ Screens,
  Pre-Order discount, MSRP, 1-Year Program vs In-Home Pre-Order, down payment, monthly — auto-shows while
  entering a valid price, and behind the chevron once locked) → **(6) actions** (drops + Result Lead).
  Category pills/labels are fed
  `verticals` so they resolve across every vertical — the same layout/order as the regular
  `dealcenter/CalculatorSummary.tsx` summary card.
- **Endpoints corrected to match web.** System A now calls `/calculator-form-schemas/deal-center` (was
  a wrong `/api/calculator-schemas`) with web-faithful normalization; System B now calls
  `/company/v1/job-builder-products` (was the same wrong path). Base URL has no `/api` prefix.
- The mounted screen no longer hardcodes the mock inline — it loads the calculator schema through
  `useCalculatorSchema` (real endpoint with template fallback) and shows a loading state.
- **Rollout end-price is now persisted.** Previously `onConfirmRollouts` passed only calculator IDs,
  so the confirmed price was dropped and the locked card / downstream steps showed `$0`. It now
  threads `{ id, price }[]` and stores `price` on each confirmed tab; price-completeness checks
  respect a tab's existing `price` (`effectivePrice`).
- **Stale calculator inputs fixed.** The category `FieldRow` (keyed by stable `field.id`) resyncs its
  displayed value to the active tab when not focused, so switching / duplicating / confirming a tab
  shows the correct quantities. `PremiumQuoteCard` in `RolloutView` is keyed per calculator and seeded
  with `initialPrice` so switching selected calculators no longer shows a stale typed price.
- **Rollout confirm validation ported from web** (`ViewAllCalculators`). `RolloutView` now: (1) **hides
  empty calculators** whose title is still a bare number (`/^\d+$/`) from the rollout — matches web's
  `visibleCalculators`, so only real (named/with-entries) calculators can be priced; (2) enforces
  **"Price can NOT be below cost."** — the end-price input turns red with an inline hint when the entered
  price is below the calculator's cost, and **Confirm Rollouts** aborts with a `FlashMessage.error`
  (mobile's `enqueueSnackbar` equivalent) naming the offending calculator instead of confirming it;
  (3) still requires a price on every calculator (button disabled via `allHavePrices`). `ResultJobModal`
  now validates too: a **Sale requires a contract price** (and down payment ≤ contract price), a **Demo
  requires a reason** — else a `FlashMessage.error` and no confirm.
- **Rollout quote card now has payment plans, monthly payment, drops & default toggle** (web
  `QuoteResultCard`/`PremiumQuoteCard` parity). `PremiumQuoteCard` gained: (1) a **Payment Method**
  selector (bottom-sheet `PaymentPlanModal`) with a **"Set as Default"** switch that
  calls `SettingsService.updateCalculatorsSetting({ defaultPaymentMethod })` + `refreshUser()`; the shown
  method resolves saved → `user.defaultPaymentMethod` → `getDefaultPaymentMethod(isLowesLead)`
  (`lowes_ach` for Lowe's leads, else `check`). The picker is **grouped exactly like the regular rollout**
  (`CalculatorSummary` line ~1541) via the shared **`getRolloutPaymentCategories(isLowesLead)`**
  (`lowes-payment-util.ts`): colored section headers — **Basic Options / GreenSky Plans / Wells Fargo Plans
  / Wells Fargo High (>$7,500) / Concora Credit** for standard leads, or **(no header) / Lowe's Plan** for
  Lowe's leads. Plans below their `minPrice` for the current end price are **greyed + `Requires $X+`** and
  warn (via `isPlanBelowMinPrice` / `getBelowMinMessage`) instead of selecting. `isLowesLead` (=
  `lead?.lowesLead === true`) is threaded `DynamicDealCenterScreen` → `RolloutView` → card. (Tailwind group
  colors from the util are mapped to hex by a small `tw()` helper since this screen uses inline styles.)
  (2) a **monthly payment** in the result breakdown for
  financing plans (`calcMonthly` mirrors `useCalculatorSummary.calculateMonthly`: `pf` multiply / duration
  divide; base = **pre-order grand total − down payment**, matching the regular rollout's In-Home box).
  (3) **cost / min-price checks ported from the regular rollout**
  (`CalculatorSummary.handlePriceBlur` / `handleAddDrop`) — COST/PAR/RETAIL now each **rely on the selected
  payment plan**: every tier is fee-inflated by `withPlanFee` (mirroring `calculateResultUtil`'s
  `price = fee >= 1 ? v : v/(1-fee)`), so a financing plan raises all three. **All three tiers carry the
  $200 job-minimum floor independently** (`floorTier`), mirroring `calculateResultUtil`, which runs
  cost(50)/par(65)/retail(100) through the same `price < 200 → 200` clamp per tier (fee gross-up first, then
  floor — confirmed against both the web `calculation-results-util.js` and the regular-mobile
  `calculation-results-util.ts`). So a tiny job reads `$200` across COST/PAR/RETAIL, and each grows once its
  own fee-inflated basis clears `$200` (this is the user's rule: "if cost is 200, par and retail are
  according to 200, not the raw price of the selected items" — par/retail are NOT ratio-derived from a
  floored cost, each is clamped on its own base). The end price is validated
  against the **fee-free floored cost** (`effectiveCostOf`, matching web's `costAtCheck` computed at
  `'check'`), then the
  Wells-Fargo-high **$7,500** minimum, then the plan's own minimum. `endPriceError` returns the
  most-specific reason inline using the regular app's exact strings — `Price cannot be less than cost ($X)`
  (X = floored cost, so a tiny job reads `$200`), `<family> High plans require a minimum of $7,500`, and
  `validatePriceForPaymentMethod(...).message`; **Confirm Rollouts** runs the same `endPriceError` per
  calculator and aborts naming the offender. Drops mirror the regular drop checks (below floored cost →
  exceeds rollout end price → WF-high → plan min). WF constants come from `payment-method-validation`
  (`WELLS_FARGO_HIGH_KEYS`, `WF_HIGH_MIN_PRICE`, `validatePriceForPaymentMethod`); the old
  `minEndPrice`/`getMinimumPriceForMethod` path was replaced. (4) **drop prices** — once confirmed, an add-drop input
  validates the typed drop, then opens the **Drop Price modal** (`DropOutcomeModal`) — now a faithful visual
  port of the regular rollout's centered drop card (web `DropPriceModal`), **not a bottom sheet**: a
  `rounded-40` centered card with a green check, the **UPDATED PRICE** eyebrow, the price with **CK/CC** (or
  **ACH/CC** for Lowe's) method badges, an **Add Down Payment** → Down Payment / Balance block (Balance =
  drop − down), a **Monthly Options** list of financing plans (add via `getDropAddPlanCategories`, select,
  remove — each showing its `/mo` on the balance), and **Decline** (red) / **Secure This Price** (green,
  disabled until a plan is selected & down ≤ drop). **Secure** records the drop `status:'accepted'`, demotes
  any prior accepted drop to declined (web's single-accepted rule), then opens the **Sale/Demo chooser**;
  **Decline** records `status:'declined'`. Each drop entry is
  `{ price, dropedPrice, status, paymentMethod, downPayment, balance }` (web `dropEntryToPayload` shape).
  **Drop-price listings now match the regular rollout** (`CalculatorSummary` listings): a green
  **"{ordinal} Dropped Price"** header + **✓ SECURED** badge (accepted) / **DECLINED** badge, then a white
  **border-2 price box** (green `#22C55E` when secured, slate `#E2E8F0` otherwise) showing the price
  (green `#16A34A` / slate), the plan label, and a **SECURED/DECLINED** status — with the dynamic flow's
  **Result** (opens the chooser) + remove actions retained.
- **Two-stage Result flow, matching the regular rollout.** Tapping **Result Lead** (or per-drop **Result**,
  or **Secure**) first opens a small centered **Sale/Demo chooser** (`ResultJobChooser` — "Result Job {name}",
  most-recent price, Sale/Demo/Cancel; web `showResultModal`), which then opens the full **Result Lead
  outcome modal** (`ResultJobModal`, rebuilt as a faithful port of the regular
  `src/widgets/modals/DealCenter/OutcomeModal.tsx`): a green-header sheet with **One Leg**, a **Result**
  (Demo/Sale) dropdown, branch fields (**demo** → Reason-for-Demo from the regular's 19 reasons + Explain +
  Last Price Quoted; **sale** → Original Contract Price / Down Payment / Balance / a down-payment method
  picker + a categorized balance-payment picker via `getOutcomeDownPaymentMethods` &
  `getRolloutPaymentCategories`), a **Job Summary** card (entered items), **Versatile/Pineapple** toggles, and
  a **Build Job** action (disabled until the outcome is valid). The chooser lives in `RolloutView`; the
  outcome modal is mounted alongside `RolloutView` (and in the calculator step) and receives `entries` +
  `isLowesLead` from `DynamicDealCenterScreen`. Its `onConfirm` payload carries all captured fields
  (oneLeg / contract / down / balance / payment methods / reason / versatile / pineapple), then proceeds to
  the job builder. `paymentMethod` / `dropPrice` / `downPayment` are carried on `CalcTab`, hydrated from
  the calculator, included in `buildPayload`, and folded into `tabSignature`; hook handlers
  `handleSetPaymentMethod` / `handleSetDrops` mark the tab dirty so both auto-save via the same debounced
  `PUT /lfcalculators/{id}` (`paymentMethod` is already a `sanitize` string key).
- **Rollout result breakdown ported from the regular rollout** (`CalculatorSummary` result section, web
  `PremiumQuoteCard`/`QuoteResultCard`). It **auto-shows while a valid end price is being entered**, and
  once the rollout is **confirmed/locked it collapses behind a chevron** on the Rollout-End-Price box
  (`showLockedDetails`, default collapsed — web `isRolloutExpanded`; tapping the locked box toggles it).
  `PremiumQuoteCard` renders it
  live: **End Price w/ Screens** (`endPrice + screens×75`; schema calcs have no "check to installers"
  screens field yet → screens 0, so it equals the end price), a **Pre-Order Discount** selector
  (options + default from `useDealPricing` — `pricing.preOrderOptions` / `pricing.defaultPreOrder`, e.g.
  15/20/25 default 25) with a **Set-as-Default** switch
  (`SettingsService.updateCalculatorsSetting({ defaultPercentage })` + `refreshUser`), **MSRP**
  (`priceWithScreens / (1 − (discount+seniorVetPct)/100)`, `seniorVetPct` from the discount config, default
  10), then **1-Year Program** (Total = MSRP, −`seniorVetPct` % Sr+Vet, Grand Total = `MSRP×(1−seniorVetPct/100)`)
  beside the highlighted **In-Home Pre-Order** box (−`seniorVetPct` % Sr+Vet, −discount %,
  Grand Total = `MSRP×(1 − (seniorVetPct+discount)/100)`, a **Down Payment** add/edit input capped at the end price,
  and the financing **/mo**). Formulas mirror `CalculatorSummary.tsx:422-429` exactly. The discount % and
  down payment persist on `CalcTab` (`discountPercentage`/`downPayment` in `buildPayload`, hydrate, and
  `tabSignature`) via new hook handlers `handleSetDiscount` / `handleSetDownPayment`, threaded
  `DynamicDealCenterScreen` → `RolloutView` → card, auto-saving through the same debounced
  `PUT /lfcalculators/{id}`. (Down-payment activity logging is not wired — persist-only, unlike web.)
- **Confirm-rollout progress bar tracks entered prices, not confirmations** (web `ConfirmRolloutPrices`
  parity — this was the "progress bar not set" bug). The bar/label count calculators with an **end price
  entered** (`effectivePrice(c) > 0`), labelled `X of Y entered`, and fill **blue → green** once all are
  priced — so it advances as the rep prices each calculator instead of sitting at 0 % until the final
  confirm (the old bar counted only `isRolloutConfirmed`, which is always 0 pre-confirm).
- **Confirm-rollout bar respects the bottom safe area.** `RolloutView` reads `useSafeAreaInsets()` and
  pads the sticky bottom Confirm-Rollouts bar by `insets.bottom + 16`, so on gesture-nav / notched devices
  the progress + Confirm button clear the home indicator instead of sitting under it (the rollout step
  renders `RolloutView` directly, outside `DynamicDealCenterScreen`'s `SafeAreaView`).
- **Calculator form shows name + price only.** The dynamic `FieldRow` (`CalculatorView`) no longer renders
  the per-field `unit` (sqft/ft) badge — only the field **label** and its `$retail` **price**, matching the
  regular `CalculatorForm`/`InputField`, whose per-row `unit` prop is always empty (the unit lives inside
  the field label, e.g. "Porch Ceiling Soffit (sqft)"). The right-hand divider block is now only rendered
  when the field has a price.
- **Confirmed calculator form renders a receipt view, not disabled inputs.** When a tab's rollout is
  confirmed (`readOnly`), `CalculatorView` short-circuits to a `LockedCalculatorView` — a faithful port of
  the regular `CalculatorForm` `LockedCalculatorView`: an amber "locked" banner + a green-bordered card with
  the calculator name, tappable **category-filter pills** (with counts), the entered **item rows**, the
  **COST/PAR/RETAIL** tiles ($200-floored, RETAIL highlighted), and a green **Rollout End Price** sub-card
  (plus an **Updated End Price** row when drops exist) with amber-lock **LOCKED** badges. The confirmed price
  and drop list reach it via new `price` / `drops` props threaded `DynamicDealCenterScreen` → `CalculatorView`.
  The editable (non-locked) path — categories + Job Summary + Totals — is unchanged; the vertical scroller is
  hidden while locked. The tab footer (draggable tabs / add / view-all) stays mounted in both states.
- **Calculator tab menu no longer offers Rename.** The tab context menu keeps only **Duplicate** and
  **Delete** (the `RenameModal` and its menu item were removed), matching the regular deal center where tab
  names are auto-derived from the calculator contents rather than hand-edited.
- **Keyboard-avoiding views added across the dynamic flow** (they were missing). `RolloutView` wraps its
  root in `KeyboardAvoidingView` (`padding`/`padding`, offset 0 iOS / 24 Android — matching
  `CalculatorSummary`); `CalculatorView` (`padding`/`height`, 0/90 — matching `CalculatorForm`); and
  `ResultJobModal` + the new `DropOutcomeModal` wrap their content (`padding`/`height` inside the `Modal` —
  matching `OutcomeModal`). So the end-price / drop / down-payment inputs stay above the keyboard instead of
  being covered.

Still pending (deferred — the Job Builder step):
- `DynamicJobBuilderScreen.tsx` uses `createDefaultJobBuilderConfig()` directly and ignores its
  `initialConfig` prop — it should consume the fetched System-B config and use
  `useDynamicJobBuilderSession`.
- The resulted calculator (id + result data from `ResultJobModal`) is not yet carried into the Job
  Builder (`handleResultConfirm`'s `data` and `jobBuilderCalculatorId` are unused).
- The outcome modal now captures the full regular field set (one-leg / demo reason + explain / contract /
  down / balance / payment methods / versatile / pineapple) in its `onConfirm` payload, but the backend
  wiring to **persist** those extra fields (web `handleFinishOutcome`) is not done yet — confirming records
  the outcome locally and proceeds to the job builder.
- The template fallback remains in `useCalculatorSchema` for offline / not-yet-configured companies;
  once the manager configures the deal center, `isConfigured` flips true and the real schema is used.
- `useDealPricing`'s two endpoints (`/payment-plans/v1/sales/provider-plans`,
  `/company/v1/discount-config/sales`) are ported from the web but **not yet runtime-verified** on the
  mobile demo API (the app couldn't be safely bundled while the `tailwind.config.js` malware history was
  live). If either 404s / returns unconfigured, the static fallback keeps the flow working (`isDynamic:false`);
  confirm the response shapes on-device once builds are safe again.
- Web pull (2026-07-02) added job-builder engine work that the pending mobile Job Builder wiring should
  mirror: persistence & activity logging, allocation visibility/exclusion, toggle-deselect + field
  validation, default-combo pruning before state storage, and **appointment-required-before-finalize**
  (web commits `8ddaaa7`, `102fa4e`, `5c24a8f`, `9a833e7`, `08643b7`).

---

## 6. Key gotchas

- **Redux is auth-only** — everything else is TanStack Query + hooks + MMKV.
- **Two map stacks** — keep `react-native-maps` (Google, lead/job maps) vs `@rnmapbox/maps` (Zone Canvasser) straight.
- **Hardcoded demo API URL** in `src/config/env.ts` (§3).
- **Dynamic Job Builder engine runs on the JS thread** — web offloads the same compute to web workers; watch performance on large schemas.
- **Largest files** (respect when editing): `src/widgets/components/dealcenter/CalculatorSummary.tsx` (~2,298),
  `src/widgets/components/job-builder/SummarySection.tsx` (~1,993), `src/screens/JobBuilder/index.tsx` (~1,730).
- Web is the **source of truth** for feature behavior; when unsure how a flow should work, check the web ref path in §4.

---

## 7. Scripts

```
yarn ios / yarn android    # run
yarn start                 # Metro
yarn lint                  # eslint
yarn test                  # jest
```
