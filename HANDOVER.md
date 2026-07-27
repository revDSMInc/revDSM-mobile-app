# revDSM Sales — Project Handover Document

> **Document status:** Generated 2026-07-13 from live code analysis of both codebases.  
> Supersedes any earlier drafts. Keep `CLAUDE.md` (mobile deep-dive) as a companion reference.

---

## 1. Project Overview

### What This Project Does

**revDSM Sales** is a door-to-door field sales CRM for a roofing/gutter company. Sales reps use it on their phones to manage leads, run pricing calculators, build jobs/contracts, capture photos, get signatures, and coordinate with the team. Managers and admins use the web frontend for a broader view of the same data. Both apps share one REST + Socket.IO backend.

**Target users:**
- **Field sales reps** — mobile app is their primary tool in the field.
- **Sales managers / admins** — web frontend for oversight, lead management, user management, invoicing, job tracking, and reporting.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│         revDSM Backend (REST + Socket.IO)            │
│   https://demo-api.revdsm.com  (dev / staging)      │
│   https://api.revdsm.com        (production)         │
└──────────────────┬──────────────────────────────────┘
                   │  JWT Bearer Token auth
       ┌───────────┴───────────┐
       │                       │
┌──────▼──────┐       ┌────────▼───────────────────────┐
│  Mobile App │       │     Web Sales Frontend          │
│ React Native│       │  React 18 + Vite + MUI v5      │
│   (iOS/     │       │ mhalt-revDSM-sales-frontend/   │
│  Android)   │       │                                 │
│ revDSM_Sales│       │ Deployed via Docker + Nginx     │
└─────────────┘       └────────────────────────────────┘
       │                        │
       └──────────┬─────────────┘
                  │
        ┌─────────▼─────────┐
        │  AWS S3 (media)   │
        │ mhalt-revdsm /    │
        │ np-revdsm-staging │
        └───────────────────┘
```

### Tech Stack — Web Sales Frontend (`mhalt-revDSM-sales-frontend/`)

| Concern | Choice |
|---|---|
| Framework | React 18, Vite 5 |
| Language | JavaScript (JSX), some TypeScript |
| UI library | MUI v5 (`@mui/material`, `@mui/x-data-grid`, `@mui/x-date-pickers`) |
| Routing | React Router v6 |
| State | React Context API (9 contexts in `src/context/`) + SWR |
| HTTP | Axios |
| Auth | Custom JWT (Amplify / Firebase / Auth0 wired but commented out in App.js) |
| Maps (zone canvasser) | Mapbox GL JS (`mapbox-gl`, `react-map-gl`) |
| Maps (leads/jobs) | `@react-google-maps/api` |
| Charts | ApexCharts (`apexcharts`, `react-apexcharts`) |
| Animations | Framer Motion |
| Calendar | FullCalendar v6 |
| PDF | `@react-pdf/renderer`, `jspdf`, `html2pdf.js` |
| Image annotation | Konva / `react-konva` |
| Signature | `react-sketch-canvas` |
| Real-time | `socket.io-client` |
| i18n | `i18next`, `react-i18next` |
| Styling | MUI theming system (`src/theme/`) |
| Bundler | Vite with path alias `src/` → `src/` |
| Deployment | Docker + Nginx (`Dockerfile`, `nginx.conf`) with ECS runtime env injection |

### Tech Stack — Mobile App (`revDSM_Sales/`)

| Concern | Choice |
|---|---|
| Framework | React Native 0.84.1, React 19 |
| Language | TypeScript (`tsconfig.json`) |
| Navigation | `@react-navigation/native-stack` — single stack in `src/navigation/index.tsx` |
| Styling | NativeWind 4 (Tailwind) + inline styles + SVG |
| Server state | TanStack Query v5 (`src/services/api/queryClient.ts`) |
| Client state | Redux Toolkit + redux-persist (`src/redux/store.ts`) — **auth slice only** |
| Local storage | MMKV (`react-native-mmkv`) primary + AsyncStorage |
| Real-time | `socket.io-client` singleton (`src/services/SocketManager.ts`) |
| Maps (leads/jobs) | `react-native-maps` v1.27.2 (Google Maps) + `react-native-maps-directions` |
| Maps (zone canvasser) | `@rnmapbox/maps` v10 + `supercluster` v8 (marker clustering) |
| Camera | `react-native-vision-camera` v4, `react-native-image-picker` v8 |
| PDF | `react-native-pdf` v7, `react-native-blob-util` |
| Document scanner | `react-native-document-scanner-plugin` v2 |
| Audio | `react-native-nitro-sound` v0.2.12 (voice notes) — patched via patch-package |
| Haptics | Native ObjC module `ios/RNHapticFeedback.{h,m}`; wrapper `src/utils/haptics.ts` |
| HTTP | Axios wrapper — `src/services/api/index.ts` |
| Build tooling | Metro, Gradle (New Architecture enabled), CocoaPods |

### Backend / API

- Base URL: `https://demo-api.revdsm.com/` (dev/staging; hardcoded in `src/config/env.ts`)
- Production URL: `https://api.revdsm.com/` (web uses `VITE_API_URL` env var; mobile needs manual `env.ts` edit)
- Auth: `POST /company/login`, profile `GET /company`
- S3: `mhalt-revdsm` (prod) / `np-revdsm-staging` (staging)
- No API versioning prefix for most endpoints; some newer endpoints use `/v1/`

---

## 2. Repository & Environment Setup

### Web Sales Frontend

**Clone & run:**
```bash
git clone <web-repo-url> mhalt-revDSM-sales-frontend
cd mhalt-revDSM-sales-frontend
yarn install          # runs patch-package postinstall automatically
yarn dev              # starts Vite dev server
```

**Build & deploy:**
```bash
yarn build            # outputs to dist/
docker build -t revdsm-sales-frontend .
# ECS runtime env vars injected by docker-entrypoint.sh at container start
```

**Required environment variables (do NOT commit values):**

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend base URL (e.g. `https://api.revdsm.com/`) |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps Places autocomplete |
| `VITE_MAPBOX_API` | Mapbox GL token for zone canvasser map |
| `VITE_APIFY_API_TOKEN` | Apify web scraper (property data) |
| `VITE_WEATHER_API_KEY` | WeatherAPI.com key |
| `VITE_ASSETS_API` | S3 base URL for media |
| `VITE_MAIN_APP_URL` | Auth redirect URL |
| `VITE_LMS_REDIRECT_URL` | LMS (learning) redirect target |
| `VITE_FIREBASE_*` | Firebase keys (currently unused) |
| `VITE_AUTH0_*` | Auth0 keys (currently unused) |
| `VITE_AWS_AMPLIFY_*` | Amplify keys (currently unused) |

> `docker-entrypoint.sh` substitutes these at runtime into `window.__ENV__`; the `pick()` helper in `src/config-global.js` reads them runtime-first, then Vite build-time.

**jsconfig.json:** defines `src/` path alias — ensure IDE picks it up.

---

### Mobile App

**Prerequisites:**
- Node ≥ 22.11.0, Yarn 1.22.22
- Xcode 16+ (iOS 15.1 deployment target)
- Android Studio with NDK + SDK (API 33+ recommended)
- CocoaPods (`gem install cocoapods`)
- Mapbox private registry token in `~/.netrc` (see below)

**Clone & install:**
```bash
git clone <mobile-repo-url> revDSM_Sales
cd revDSM_Sales
yarn install          # runs patch-package postinstall automatically
```

**iOS setup:**
```bash
# 1. Add Mapbox secret download token to ~/.netrc:
#    machine api.mapbox.com
#      login mapbox
#      password sk.<your-secret-download-token>
# Token is also in android/gradle.properties as MAPBOX_DOWNLOADS_TOKEN
cd ios && pod install && cd ..
yarn ios
```

**Android setup:**
```bash
# Set sdk.dir in android/local.properties
yarn android
```

**Environment config:**
- All config is in `src/config/env.ts` — NOT file-driven like the web.
- To switch environments: change `API_URL` in `src/config/env.ts`.
- ⚠️ **Make `env.ts` environment-aware before any production release** — see §10.

**Patches (applied automatically via `yarn postinstall`):**

| Patch | Reason |
|---|---|
| `react-native-blob-util+0.24.10.patch` | Compatibility / build fix |
| `react-native-image-picker+8.2.1.patch` | Compatibility fix |
| `react-native-nitro-sound+0.2.12.patch` | Voice note audio module fix |

**Key native setup notes:**
- iOS min deployment target: 15.1 (set in `Podfile` and all pod build configs)
- iOS uses **Google Maps SDK** (`pod 'GoogleMaps', '9.4.0'`) for `react-native-maps`; Mapbox SDK for `@rnmapbox/maps`
- Android: New Architecture (`newArchEnabled=true`) + Hermes + edge-to-edge (`edgeToEdgeEnabled=true`) all enabled in `android/gradle.properties`
- Native haptics: custom ObjC module `ios/RNHapticFeedback.h` + `.m` (no external library)
- `android/gradle.properties` contains `MAPBOX_DOWNLOADS_TOKEN` — rotate before sharing the repo

---

## 3. Completed Features — Web Sales Frontend

### 3.1 Authentication
**Files:** `src/auth/context/jwt/`, `src/sections/auth/jwt/`, `src/sections/user/two-factor-auth/`, `src/api/two-factor-auth.js`

- Custom JWT bearer token login; Amplify/Firebase/Auth0 are wired but commented out in `src/App.js`
- 2FA via authenticator OTP and email OTP (`src/api/two-factor-auth.js`)
- Full password reset flow; 401 → global logout

---

### 3.2 Map View
**Files:** `src/sections/map/map.js` (~82 KB), `list-view.js`, `list-card.js`, `list-filters.js`, `no-location.js`, `before-after-modal.js` (~69 KB), `beforeImageModal.js`, `afterImageModal.js`, `referal-model.js`, `uploadImageModal.js`, `utils/`, `hooks/`, `data/`, `components/`

- Interactive Google Maps + Mapbox showing all leads as color-coded, clustered markers (`supercluster`)
- Heatmap layer (toggled from UI)
- Before/after image modal (~69 KB) — gallery, upload, tag, compare flows
- Lead list view (split with map), lead filters/search
- Referral modal, upload modal
- Context: `src/context/location-context.js`, `current-location-context.js`, `lead-context.js`
- ⚠️ `src/sections/map/data/dummy-jobs-data.js` — `// TODO: Replace with API call later`

---

### 3.3 Zone Canvasser
**Files:** `src/sections/map/zone-canvasser/` — `zone-canvasser-map.js` (~34 KB), `submitted-lead-popup.js` (~20 KB), `property-detail-modal.js`, `property-info-modal.js`, `action-modal.js`, `lead-creation-modal.js`, `building-modal.js`, `buildings-layer.js`, `draw-control.js`, `results-modal.js`, `zone-stats-popup.js`, `live-location-layer.js`, `user-location-marker.js`. API: `src/api/zone-canvasser.js`

- Mapbox GL draw tool (polygons, rectangles) for territory management
- Apify-powered property data scraping/lookup within drawn zones
- Lead creation from map; property info popup; submitted lead tracking overlay
- Zone statistics popup; live location layer (GPS broadcasting)
- Context: `src/context/zone-canvasser-search-context.js`

---

### 3.4 Lead Management / Job Details
**Files:** `src/sections/job/view/` (job details, job list, job capture images), `job-new-edit-form.js`, `job-item.js`, `job-list.js`, `job-filters.js`, `job-search.js`, `job-sort.js`, `job-details-*.js`, `components/`, `hooks/`  
**API:** `src/api/leads.js` (~19 KB, 30+ endpoint calls)

- Full lead CRUD, job details, job list, filtering and search
- Image capture: before/after/damage photo upload to S3 (`src/api/s3.js`)
- Inspection photo schema (`src/api/inspection-photo-schema.js`), consent form, roof waiver
- Referral management (`src/api/referral.js`), auto-fields (`src/api/auto-fields.js`)

---

### 3.5 Deal Center (Calculator + Job Builder)
**Files:** `src/sections/deal-center/view/deal-center-view.js` (~29 KB), `components/TabbedCalculator.js` (~66 KB), `ViewAllCalculators.js` (~72 KB), `QuoteResultCard.js` (~36 KB), `DropPriceModal.js`, `PremiumQuoteCard.js`, `LockedCalculator.js`, `ConfirmRolloutPrices.js`, `verticals/` (CalculatorVerticalTabs, VerticalsCalculatorView, verticals-data.js ~36 KB), `context/DealCenterContext`  
**API:** `src/api/calculator-form-schemas.js`, `payment-plans.js`, `discount-config.js`, `appointments.js`

- Schema-driven pricing calculator (`GET /calculator-form-schemas/deal-center`)
- Multi-tab with drag-reorder; debounced auto-save on every field change (PUT)
- Rollout: confirm end prices, drop prices, payment plan selection (GreenSky, WF, Concora, Lowe's ACH)
- Payment plans from API (`GET /payment-plans/v1/sales/provider-plans`)
- Discount config from API (`GET /company/v1/discount-config/sales`) — pre-order %, Sr+Vet %
- Result Lead outcome modal (Sale/Demo); dynamic job builder modal launch

---

### 3.6 Deals / Dynamic Deal Flow
**Files:** `src/sections/deal/view/deal-details-view.js` (~46 KB), `src/sections/deal/components/dynamic-deal-edit-modal.js` (~60 KB), `dynamic-deal-diff.js`, `dynamic-deal-pricing.js` (~26 KB), `src/pages/deal-drafts.js` (~31 KB), `src/pages/lead-drafts.js` (~15 KB)

- Deal details view (summary, contract, editing)
- Dynamic deal edit modal — 4-step wizard (calculator → rollout → result → job builder)
- Deal diff utility; deal drafts page; lead drafts page
- Routes: `dashboard/deal/:id` (details), `dashboard/dynamic-deal-center` (new flow)

> ⚠️ **The Deals pipeline/kanban view is NOT implemented — see §6.**

---

### 3.7 Job Tracker
**Files:** `src/sections/job-tracker/view/`, `src/sections/job-tracker/components/`

- Tracks job progress/status across stages; timeline view

---

### 3.8 Pitch Book
**Files:** `src/sections/pitch-book/view/`, `components/`, `pitch-book-images-data.js`

- Slide-based presentation viewer for customer-facing sales pitches

---

### 3.9 Roofline Deck
**Files:** `src/sections/roofline-deck/view/`, `components/`, `roofline-deck-images-data.js`

- Roofline-specific product presentation (same pattern as Pitch Book)

---

### 3.10 LF Calculator
**Files:** `src/sections/lf-calculator/view/`, `components/`, `verticals/`

- LeafFilter-specific measurement calculator with vertical sub-calculators

---

### 3.11 Calculator Appointment
**Files:** `src/sections/calculator-appointment/view/calculator-appointment.js`, `components/`

- Appointment scheduling integrated with the calculator
- ⚠️ `// TODO: Navigate to client details` at line 171 — post-booking navigation incomplete

---

### 3.12 Chat
**Files:** `src/sections/chat/` (full UI), `src/components/chat-module/ChatModule.js` (composable core), `src/api/chat.js`

- Lead-linked chat threads and team channels; voice note recording/playback; file attachments; real-time via Socket.IO
- ⚠️ TODOs in `ChatModule.js`: line 892 (error state), line 1136 (forward functionality)

---

### 3.13 Calendar
**Files:** `src/sections/calendar/` — FullCalendar v6; `src/api/calendar.js`

- Month/week/day/list appointment calendar; create, edit, filter events

---

### 3.14 RevRender — Before/After AI
**Files:** `src/sections/job/rev-render-bg/RevRenderBgBootstrap.js`, background processing files; `src/api/rev-render.js` (~13 KB)

- AI-powered before/after roof image generation; background job processing with status polling

---

### 3.15 User Management
**Files:** `src/sections/user/` — `user-new-edit-form.js`, `user-table-row.js`, `user-table-toolbar.js`, `user-quick-edit-form.js`, `user-card.js`, `view/`, `two-factor-auth/`

- Full user list/create/edit/delete/cards view; per-user 2FA management

---

### 3.16 Account / Profile
**Files:** `src/sections/account/` — `account-general.js`, `account-change-password.js`, `account-notifications.js`, `account-billing*.js`, `account-social-links.js`, `view/`

- Profile settings, password change, notification preferences, billing plan management

---

### 3.17 Invoice
**Files:** `src/sections/invoice/` — 11 files including `invoice-details.js`, `invoice-new-edit-form.js`, `invoice-pdf.js`, `view/`

- Full invoice CRUD; PDF export via `@react-pdf/renderer`

---

### 3.18 Kanban
**Files:** `src/sections/kanban/` — `kanban-column.js`, `kanban-task-item.js`, `kanban-details.js`, `view/`; `src/api/kanban.js`

- Drag-and-drop Kanban board (`@hello-pangea/dnd`); task detail panel with comments, attachments, priority
- ⚠️ **This is the raw Minimals template board — NOT connected to deals/leads.** See §6.

---

### 3.19 Filter Selection
**Files:** `src/sections/filter-selection/view.js` (~14 KB)

- Manager-facing filter configuration screen

---

### 3.20 Overview / Analytics Dashboard
**Files:** `src/sections/overview/analytics/`, `app/`, `banking/`, `booking/`, `e-commerce/`, `file/`

- ⚠️ Only `app/` is partially customized for revDSM; all others are Minimals template data — **NOT wired to the revDSM API.**

---

### 3.21 File Manager
**Files:** `src/sections/file-manager/`

- Template file manager — **needs confirmation** whether wired to revDSM storage.

---

### 3.22 Mail
**Files:** `src/sections/mail/`, `src/api/mail.js`

- Template mail UI — **needs confirmation** whether connected to a real email backend.

---

### 3.23 App-Wide Context Providers (`src/context/`)

| Context | Purpose |
|---|---|
| `appointments-context.js` | Global appointments state |
| `current-location-context.js` | GPS current position |
| `job-context.js` | Active jobs list |
| `lead-context.js` | Active lead state |
| `location-context.js` | GPS location tracking |
| `socket-context.js` | Socket.IO singleton |
| `toggle-context.js` | Generic boolean toggle |
| `visibility-context.js` | Component visibility |
| `zone-canvasser-search-context.js` | Zone search state |

---

## 4. Completed Features — Mobile App

### 4.1 Authentication (`src/screens/auth/`)
**Files:** `login.tsx`, `forgot-password.tsx`, `email-otp.tsx`, `reset-password.tsx`, `authenticator-otp.tsx`

- Custom JWT bearer token; `POST /company/login`
- 2FA: email OTP (`EmailOTPScreen`) and authenticator app OTP (`AuthenticatorOTPScreen`)
- Full password reset; state in `src/redux/reducer/auth.reducer.ts`, hook `src/hooks/useAuth.ts`
- Bootstrap: `src/hooks/useAppInitialization.ts` — restores MMKV token, reconnects socket, fetches `/company`, requests camera permission
- 401 → global logout + FlashMessage; `deviceId = mobile-<os>-<email>`, `trustDevice` flag, lat/long on login
- ⚠️ **TODO:** 2FA backup code entry not implemented (commented placeholder in both OTP screens)

---

### 4.2 Leads Screen (`src/screens/Leads/index.tsx`, ~22 KB)

- Home screen; lead list with search, filters, status indicators
- Deep-links: `openChatId` → open specific chat; `reopenZoneCanvasser` → re-enter zone canvasser
- Hosts Zone Canvasser entry point

---

### 4.3 Lead Center — Operational Hub (`src/screens/LeadCenter/index.tsx`, ~57 KB)

**Widget components:** `src/widgets/components/LeadCenter/` — 16 files including `LeadMap.tsx` (~43 KB), `JobDocsSection.tsx` (~57 KB), `ManagePhotosModal.tsx` (~29 KB), `TagPhotoModal.tsx` (~40 KB), `MapGalleryModal.tsx` (~38 KB), `BeforeAfterPresentModal.tsx`, `AnnotationCanvas.tsx`, `AnnotationSlider.tsx`, `AnnotationTextToolbar.tsx`, `DraggableText.tsx`, `ContractDetailsCard.tsx`, `OperationalSections.tsx`, `LeadCard.tsx` (~35 KB), `MapJobCard.tsx`, `ImageSlideshowModal.tsx`, `SharedElements.tsx`

**Lead Center modals:** `src/widgets/modals/lead-center/` — 13 files: `ConsentFormModal.tsx` (~32 KB), `ContractAmendmentModal.tsx` (~35 KB), `EditContractDetailsModal.tsx` (~56 KB), `InspectionFormModal.tsx` (~26 KB), `PitchBook.tsx` (~24 KB), `RevRenderModal.tsx` (~30 KB), `RevRenderHistoryModal.tsx` (~28 KB), `RoofWaiverModal.tsx` (~24 KB), `RiskReportModal.tsx`, `ResultLeadModal.tsx`, `PaperFallbackModal.tsx`, `EditCustomerModal.tsx`, `ImageGridModal.tsx`

- Full in-field hub: photo management, before/after capture, gallery slideshow, photo tagging
- Image annotation (draw/text overlay on inspection photos): `AnnotationCanvas`, `AnnotationSlider`, `AnnotationTextToolbar`, `DraggableText`
- Contract view/edit (`EditContractDetailsModal` ~56 KB), contract amendment, consent form, roof waiver, inspection form
- RevRender launch + history; risk report; result lead; paper fallback; pitch book (in-modal)
- Lead map (Google Maps); job docs section

---

### 4.4 Map Detail — Full-Screen Map (`src/screens/MapDetail/index.tsx`, ~32 KB)

- Full-screen Google Maps of all leads
- `MapFiltersModal.tsx` (~28 KB) — rich filter sheet (status, date range, rep, lead type, Lowe's/self-gen, etc.)
- **Viewport culling:** region bounding renders only visible markers; tested with 3000+ markers
- **Heatmap layer** (`react-native-maps` heatmap overlay); lead card bottom sheet on marker tap
- Real-time location tracking + backend broadcast

---

### 4.5 Zone Canvasser (`src/hooks/useZoneCanvasser.ts` ~28 KB, `src/widgets/components/ZoneCanvasser/` 19 components)

**Key files:** `MapCanvas.tsx` (~14 KB), `ActionModal.tsx` (~13 KB), `SubmittedLeadPopup.tsx` (~12 KB), `PropertyDetailModal.tsx`, `SearchLocationModal.tsx` (~8.6 KB), `ZoneStatsPopup.tsx`, `ZoneCanvasserModals.tsx`

- Mapbox GL territory mapping (separate from Google Maps lead map)
- Polygon/rectangle draw tools; Apify property data fetch within zones
- Lead creation from property pin; submitted lead overlay; zone statistics
- Supercluster marker clustering; `src/utils/zone-canvasser-*.ts` utilities
- Modal: `src/widgets/modals/ZoneCanvasserMap.tsx`

---

### 4.6 Deal Center — Legacy Calculator (`src/screens/DealCenter/index.tsx`, ~45 KB)

**Widgets:** `src/widgets/components/dealcenter/` — `CalculatorForm.tsx` (~45 KB), `CalculatorSummary.tsx` (~109 KB, largest file in repo), `HorizontalDraggableTabs.tsx` (~15 KB), `ResultViews.tsx`, `SharedElements.tsx`

- Static (product-specific) calculator for Gutters + LeafFilter
- Multi-tab with drag-reorder; long-press menu (duplicate, rename, delete)
- Full rollout: COST/PAR/RETAIL tiers, payment plan selection, drop prices, down payment
- `src/hooks/useDealCalculator.ts` (~57 KB) — state machine; `src/hooks/useCalculatorSummary.ts` (~38 KB) — math
- Outcome modal (`OutcomeModal.tsx` ~36 KB): Sale/Demo flow

---

### 4.7 Dynamic Deal Center / Dynamic Job Builder (`src/screens/DynamicDealCenter/`)

**🟡 Status: Calculator + Rollout complete; Job Builder wired (core UI done). See §6 for pending items.**

**Screen/component files:** `DynamicDealCenterScreen.tsx` (~12 KB), `CalculatorView.tsx` (~41 KB), `RolloutView.tsx` (~74 KB), `ResultJobModal.tsx` (~21 KB), `DynamicDealEditScreen.tsx` (~41 KB)

**Hooks:** `useCalculatorSchema.ts`, `useDynamicCalculators.ts` (~25 KB), `useDynamicCalculatorSchemas.ts`, `useDealPricing.ts` (~12 KB), `useAgreementConfig.ts`, `useDescriptionSchema.ts`, `useDynamicJobBuilderActivityLog.ts` (~12 KB)

**Utils:** `tab-naming.ts`, `field-dependency.ts`, `icon-color.ts`, `build-all-entries.ts`, `build-deal-center-data.ts`, `dynamic-deal-diff.ts`, `dynamic-deal-pricing.ts`, `enrich-job-builder-data.ts`

**Engine:** `src/utils/dynamic-job-builder/engine/` — 25 files including `dependency-engine.ts` (~31 KB), `dynamic-job-state-storage.ts` (~22 KB), `allocation-config-utils.ts` (~20 KB), `tab-validation.ts` (~16 KB), `vertical-summary-utils.ts` (~18 KB)

**Job builder widgets:** `src/widgets/components/dynamic-job-builder/` — `DynamicTabRenderer.tsx` (~44 KB), `VerticalSummaryTab.tsx`, `AllocatorBar.tsx`, `SwatchPicker.tsx`, `LocationGrid.tsx`, `RoomPicker.tsx`, `ToggleGroup.tsx`, `OptionList.tsx`, `InputField.tsx`, `LockedField.tsx`, `LockedFieldWithColor.tsx`, `GrandTotalCard.tsx`, `ProgressTracker.tsx`, `agreement/` (AgreementSignatureCapture, DynamicAgreementDialog, DynamicAgreementGenerator, SummaryFinalizeCards)

**Two distinct data systems (do not conflate):**
- **System A** (calculator + rollout): `GET /calculator-form-schemas/deal-center` — category-shaped schema with price tiers
- **System B** (job builder config): `GET /company/v1/job-builder-products` — vertical/tab-shaped config with field types

**What is complete:**
- Schema-driven calculator: field auto-save (debounced 1500ms PUT), in-flight guard, unmount flush, server hydration
- Rollout: payment plans, COST/PAR/RETAIL with $200 floor, drop prices (DropOutcomeModal), pre-order discount, MSRP, monthly payment
- Dynamic tab naming (G+LF, size disambiguation, conflict flag)
- Conditional field highlighting + auto-fill (`field-dependency.ts`)
- Schema-driven icons/colors (Iconify → Ionicons translation, `icon-color.ts`)
- Two-stage Result flow (Sale/Demo chooser → full OutcomeModal)
- Job Builder screen: step-based progress, all field types via `DynamicTabRenderer`
- Agreement generation + signature capture (`agreement/` subfolder)
- Activity logging: `job_builder_opened`, `job_builder_completed`

---

### 4.8 Job Builder — Legacy (`src/screens/JobBuilder/index.tsx`, ~66 KB)

**Widgets:** `src/widgets/components/job-builder/` — `GutterSection.tsx` (~47 KB), `LeafFilterSection.tsx` (~40 KB), `SummarySection.tsx` (~85 KB), `LightingSection.tsx`, `SoffitSection.tsx`, `FasciaSection.tsx`, `MiscSection.tsx`, `color-constant.ts`

- Static product-specific job builder (Gutter, LeafFilter, Soffit, Fascia, Lighting, Misc)
- Step-based wizard: swatch pickers, measurements, allocations, contract summary

**Modals:** `src/widgets/modals/job-builder/`
- `AgreementSignatureModal.tsx` (~28 KB) — PDF agreement + signature capture
- `AgreementDialogModal.tsx` — dialog wrapper
- `AppointmentSchedulerModal.tsx` (~22 KB) — appointment scheduling
- `DocumentScannerModal.tsx` (~10 KB) — `react-native-document-scanner-plugin`

---

### 4.9 Job Tracker (`src/screens/JobTracker/index.tsx`, ~50 KB)

- Job progress/status tracking across stages; `src/hooks/useJobTracker.ts`; `src/services/api/JobService.ts`

---

### 4.10 RevRender — Before/After AI (`src/screens/RevRender/index.tsx`, ~44 KB)

- AI-powered roofing visualization; multi-section image selection; generation progress indicator
- Nav params: `sectionImages`, `onGenerate`, `onGenerateAll` callbacks

---

### 4.11 Image Annotation (`src/screens/ImageAnnotation/index.tsx`, ~47 KB)

- WebView-based canvas annotation (draw/text overlay on photos); save annotated image to S3

---

### 4.12 Pitch Book (`src/screens/Pitchbook/index.tsx`, ~58 KB)

- Slide presentation viewer; images from API; swipe navigation; share/download

---

### 4.13 Roofline Deck (`src/screens/RooflineDeck/index.tsx`, ~57 KB)

- Same pattern as Pitch Book; specialized imagery for roofline products

---

### 4.14 Chat (`src/screens/ChatThreads/`, `src/screens/ChatDetail/`)

**Files:** `ChatThreadsScreen` (~9 KB), `ChatDetailScreen` (~39 KB)  
**Widgets:** `src/widgets/components/chat/` — `Chat.tsx` (~21 KB), `ChatMessageBubble.tsx` (~64 KB), `ChatHeader.tsx`, `ChatBars.tsx`, `ChatModals.tsx` (~16 KB), `VoiceNotePlayer.tsx` (~13 KB), `ThreadItems.tsx`

- Lead-linked 1:1 chats and team channels; real-time via Socket.IO + `SocketManager.ts`
- Voice notes (`src/hooks/useVoiceNote.ts`, `react-native-nitro-sound`); file/image attachments
- Hooks: `useChatLogic.ts`, `useChatSession.ts`, `useChatThreads.ts`

---

### 4.15 My Deals (`src/screens/MyDeals/index.tsx`, ~14 KB)

- List of the rep's saved deals (calculator outcomes); navigates to `DealDetail` on tap

---

### 4.16 Deal Detail (`src/screens/DealDetail/index.tsx`, ~28 KB)

- View saved deal contract summary; edit pencil launches `DynamicDealCenter` in `edit` mode

---

### 4.17 Profile (`src/screens/Profile/index.tsx`, ~61 KB)

- Profile photo, name, contact info; 2FA management; theme toggle; notification settings; logout

---

### 4.18 Offline Image Upload Queue

**Files:** `src/services/api/offlineUploadManager.ts`, `src/utils/uploadQueue.ts`

- MMKV-persisted queue; processes when connectivity restored; S3 multi-part upload

---

### 4.19 Native Haptics Module

**Files:** `ios/RNHapticFeedback.h`, `ios/RNHapticFeedback.m`, `src/utils/haptics.ts`

- Custom ObjC native module; `haptics.ts` wrapper with `light/medium/heavy/success/warning/error` variants

---

### 4.20 Activity Logging

**Files:** `src/services/api/LoggerService.ts`, `src/utils/lead-activity-log.ts`, `src/utils/activity-log/`

- `logEvent(eventName, metadata)` used app-wide; lead-specific activity entries; dynamic job builder logging

---

### 4.21 My Learning (`src/screens/Learning/index.tsx`, ~1.2 KB) — STUB

- 34-line stub; renders nothing meaningful; placeholder for future LMS integration

---

## 5. Web-to-Mobile Feature Parity Check

> Legend: ✅ Parity | 🟡 Partial | ⛔ Missing | 🔎 Needs Confirmation

| Feature | Exists on Web | Exists on Mobile | Status / Notes |
|---|---|---|---|
| **Authentication (login, forgot/reset, 2FA)** | ✅ `src/sections/auth/`, `src/api/two-factor-auth.js` | ✅ `src/screens/auth/` | Parity. **Diff:** 2FA backup-code is TODO on mobile; web has it. |
| **Lead list / home screen** | ✅ Map is home screen | ✅ `src/screens/Leads/` | Present on both. Diff: web opens to map; mobile opens to lead list. |
| **Lead Center (operational hub)** | ✅ `src/sections/job/view/job-capture-images-view.js` | ✅ `src/screens/LeadCenter/` + 16 widget components | Parity. Mobile is decomposed; web is a monolithic JS file. |
| **Google Maps lead/job map** | ✅ `src/sections/map/map.js` (~82 KB) | ✅ `src/screens/MapDetail/` | Parity. |
| **Heatmap layer** | ✅ Mapbox heatmap in `map.js` | ✅ `react-native-maps` heatmap in `MapDetail` | Parity. Different map stacks (Mapbox web, RN Maps mobile). |
| **Map filters** | ✅ `src/sections/map/list-filters.js` | ✅ `MapFiltersModal.tsx` (~28 KB) | Parity. |
| **Zone Canvasser (territory mapping)** | ✅ `src/sections/map/zone-canvasser/` (14 files, Mapbox GL Draw) | ✅ `useZoneCanvasser.ts` + 19 widget components | Parity. Both Mapbox. |
| **Lead creation from Zone Canvasser** | ✅ `lead-creation-modal.js` | ✅ `ActionModal.tsx` | Parity. |
| **Zone statistics** | ✅ `zone-stats-popup.js` | ✅ `ZoneStatsPopup.tsx` | Parity. |
| **Deal Center (legacy calculator)** | ✅ `src/sections/deal-center/` | ✅ `src/screens/DealCenter/` + `CalculatorSummary.tsx` | Parity. |
| **Multi-tab calculator with drag-reorder** | ✅ `TabbedCalculator.js` | ✅ `HorizontalDraggableTabs.tsx` | Parity. |
| **Rollout / quote card + drop prices** | ✅ `ViewAllCalculators.js`, `DropPriceModal.js`, `PremiumQuoteCard.js` | ✅ `CalculatorSummary.tsx`, `OutcomeModal.tsx` | Parity. |
| **Payment plan selection (API-driven)** | ✅ `src/api/payment-plans.js` | ✅ `useDealPricing.ts` | Parity. |
| **Discount config (pre-order %, Sr+Vet)** | ✅ `src/api/discount-config.js` | ✅ `useDealPricing.ts` | Parity. |
| **Dynamic Deal Center (schema-driven)** | ✅ `src/sections/deal-center/` + `dynamic-deal-edit-modal.js` | 🟡 `src/screens/DynamicDealCenter/` — calc+rollout complete; some features pending | Present on both but differs — advanced outcome wiring, appointment-before-finalize, some engine features deferred on mobile (see §6). |
| **Job Builder (static, product-specific)** | ✅ `src/sections/job/components/job-builder-*` | ✅ `src/screens/JobBuilder/` + `src/widgets/components/job-builder/` | Parity. |
| **Agreement / contract signature** | ✅ `src/sections/job/components/agreement-generator/` | ✅ `AgreementSignatureModal.tsx`, `agreement/` subfolder | Parity. |
| **Document scanner** | ✅ `src/components/document-scanner/` | ✅ `DocumentScannerModal.tsx` | Parity. |
| **Inspection form** | ✅ `src/api/inspection-photo-schema.js` + job view | ✅ `InspectionFormModal.tsx` | Parity. |
| **Consent form** | ✅ `src/api/consent-form.js`, `consent.js` | ✅ `ConsentFormModal.tsx` | Parity. |
| **Roof waiver** | ✅ Via leads API | ✅ `RoofWaiverModal.tsx`, `useRoofWaiver.ts` | Parity. |
| **RevRender (before/after AI)** | ✅ `src/api/rev-render.js` + `RevRenderBgBootstrap.js` | ✅ `src/screens/RevRender/` + `RevRenderModal.tsx` | Parity. Diff: web uses background polling; mobile uses nav param callbacks. |
| **Image annotation** | ✅ `src/components/image-annotation/` (Konva) | ✅ `src/screens/ImageAnnotation/` (WebView canvas) | Present on both. Diff: web = Konva; mobile = WebView canvas. |
| **Before/after image capture & gallery** | ✅ `before-after-modal.js` (~69 KB), `beforeImageModal.js`, `afterImageModal.js`, `uploadImageModal.js` | ✅ `BeforeAfterModal.tsx`, `BeforeImageModal.tsx`, `AfterImageModal.tsx`, `ManagePhotosModal.tsx`, `TagPhotoModal.tsx`, `MapGalleryModal.tsx` | Parity. Mobile is more decomposed. |
| **Photo tagging** | ✅ `uploadImageModal.js` | ✅ `TagPhotoModal.tsx` (~40 KB) | Parity. |
| **Pitch Book** | ✅ `src/sections/pitch-book/` | ✅ `src/screens/Pitchbook/` (58 KB) | Parity. |
| **Roofline Deck** | ✅ `src/sections/roofline-deck/` | ✅ `src/screens/RooflineDeck/` (57 KB) | Parity. |
| **Job Tracker** | ✅ `src/sections/job-tracker/` | ✅ `src/screens/JobTracker/` (50 KB) | Parity. |
| **Chat (lead + team channels)** | ✅ `src/sections/chat/` + `ChatModule.js` | ✅ `ChatThreads/`, `ChatDetail/`, `widgets/components/chat/` | Parity. Web has 2 open TODOs. |
| **Voice notes in chat** | ✅ `src/components/voice-recorder/` | ✅ `useVoiceNote.ts`, `VoiceNotePlayer.tsx` | Parity. |
| **Referral** | ✅ `src/api/referral.js`, `referal-model.js` | ✅ `ReferralModal.tsx` | Parity. |
| **Profile / personal account settings** | ✅ `src/sections/account/` | ✅ `src/screens/Profile/` (61 KB) | Parity. |
| **2FA management (enable/disable)** | ✅ `src/sections/user/two-factor-auth/` | ✅ Inside `src/screens/Profile/` | Parity. |
| **Appointment scheduling (in-flow)** | ✅ `src/sections/calculator-appointment/` | 🟡 `AppointmentSchedulerModal.tsx` exists but NOT yet integrated into Dynamic Job Builder summary step | Partial on mobile. |
| **My Deals / deal drafts browser** | 🟡 `src/pages/deal-drafts.js` (drafts list) + `deal-details-view.js` | ✅ `src/screens/MyDeals/` + `src/screens/DealDetail/` | Partial on web (drafts only); full on mobile with edit wizard. |
| **Deal pipeline / Kanban** | 🟡 `src/sections/kanban/` exists but is **template only, not wired to deals** | ⛔ No pipeline screen | **Web only (template stub) — NOT connected to deals domain. See §6.** |
| **Invoice management** | ✅ `src/sections/invoice/` (CRUD + PDF) | ⛔ Not implemented | Web only. |
| **User management (admin)** | ✅ `src/sections/user/` (list, create, edit, delete) | ⛔ Not implemented (own profile only) | Web only. |
| **Analytics / reporting dashboards** | 🟡 `src/sections/overview/` (partial customization) | ⛔ Not implemented | Web only (partially). Needs confirmation whether web dashboards are fully wired. |
| **Calendar** | ✅ `src/sections/calendar/` (FullCalendar) | ⛔ Not implemented | Web only. |
| **Mail** | 🔎 `src/sections/mail/`, `src/api/mail.js` — **needs confirmation** | ⛔ Not implemented | Web status needs confirmation. |
| **File Manager** | 🔎 `src/sections/file-manager/` — **needs confirmation** | ⛔ Not implemented | Web status needs confirmation. |
| **LF Calculator (standalone section)** | ✅ `src/sections/lf-calculator/` | ⛔ Absorbed into Deal Center flow | Web only as standalone section. |
| **Offline image upload queue** | 🟡 `src/utils/background-report-service.js` (partial) | ✅ `offlineUploadManager.ts` + `uploadQueue.ts` | **Mobile strength** — robust MMKV-persisted queue; web is partial. |
| **Native haptics** | N/A (web) | ✅ `ios/RNHapticFeedback.{h,m}` + `haptics.ts` | Mobile only. |
| **Location broadcasting** | ✅ `src/components/location-broadcaster` | ✅ `src/utils/location-util.ts` + socket | Parity. |
| **My Learning / LMS** | 🟡 External redirect (`VITE_LMS_REDIRECT_URL`) | ⛔ 34-line stub | Both incomplete. |
| **Contract amendment** | ✅ In lead/job views | ✅ `ContractAmendmentModal.tsx` (~35 KB) | Parity. |
| **Edit contract details** | ✅ In job detail view | ✅ `EditContractDetailsModal.tsx` (~56 KB) | Parity. |
| **Edit customer details** | ✅ In user/lead views | ✅ `EditCustomerModal.tsx` | Parity. |
| **Risk report** | 🔎 Needs confirmation in web | ✅ `RiskReportModal.tsx` | Web status needs confirmation. |
| **Paper fallback (offline contract)** | 🔎 Needs confirmation in web | ✅ `PaperFallbackModal.tsx` | Web status needs confirmation. |

---

## 6. What's Missing / Incomplete

### ⛔ DEALS PIPELINE — NOT YET DEVELOPED (on either platform)

A **Deals pipeline / deal stage tracking / kanban pipeline** is explicitly **NOT built** in either codebase:

- **Web:** `src/sections/kanban/` exists and is registered as `paths.dashboard.kanban`, but it is the **raw Minimals template Kanban board** connected to a mock `src/api/kanban.js`. Zero deal-domain logic. No pipeline columns, no deal stages, no deal value tracking.
- **Mobile:** No Kanban or pipeline screen exists anywhere in `src/navigation/index.tsx` or `src/screens/`.
- **Search confirms:** No file named `deal-pipeline`, `pipeline`, `deal-stage`, or `deal-status-board` exists in either codebase.
- **What exists instead:** "Deal drafts" (`src/pages/deal-drafts.js` on web) and "My Deals" (`src/screens/MyDeals/`) on mobile — these are **flat list views of saved calculator outcomes**, not a stage pipeline.
- **Conclusion:** A deal pipeline (drag-and-drop stages, deal value tracking by stage, win/loss reporting) must be **built from scratch** on both platforms.

---

### 🟡 Dynamic Deal Center — Advanced Features Pending (Mobile)

Per `CLAUDE.md` §5 and code inspection, the following are deferred on mobile:

1. **Outcome field persistence:** `ResultJobModal` captures all fields but the backend `PUT /lead/v1/{leadId}/outcome` call does not yet wire all extra fields (matching web's `handleFinishOutcome`).
2. **Appointment/signature/scanner integration:** `AppointmentSchedulerModal`, `AgreementSignatureModal`, and `DocumentScannerModal` exist but are **not integrated into the dynamic job builder summary step**.
3. **Payment plan endpoints not runtime-verified:** `useDealPricing`'s new endpoints (`/payment-plans/v1/sales/provider-plans`, `/company/v1/discount-config/sales`) are ported from web but not confirmed working on the demo API (as of 2026-07-02).
4. **Engine feature parity:** Allocation visibility/exclusion, toggle-deselect + field validation, default-combo pruning, and appointment-required-before-finalize (web commits `8ddaaa7`, `102fa4e`, `5c24a8f`, `9a833e7`, `08643b7`) not yet mirrored on mobile.

---

### ⛔ Web-Only Features Not on Mobile

| Feature | Web Location | Notes |
|---|---|---|
| Invoice management (CRUD + PDF) | `src/sections/invoice/` | Medium priority |
| User management (admin CRUD) | `src/sections/user/` | Medium priority |
| Calendar (FullCalendar) | `src/sections/calendar/` | Low priority |
| Analytics / reporting | `src/sections/overview/` | Low-Medium (confirm if fully wired) |
| LF Calculator (standalone) | `src/sections/lf-calculator/` | Low (absorbed into mobile deal center) |
| Mail | `src/sections/mail/` | Low (confirm backend) |
| File Manager | `src/sections/file-manager/` | Low (confirm backend) |

---

### ⛔ Mobile Stubs

| Item | File | Status |
|---|---|---|
| My Learning / LMS | `src/screens/Learning/index.tsx` | 34-line stub — renders blank |
| 2FA backup code entry | `src/screens/auth/email-otp.tsx`, `authenticator-otp.tsx` | Commented TODO button |

---

### 🔎 Web Items Needing Confirmation

- **Kanban** — template only; needs wiring to deal/lead stages if pipeline is desired.
- **`src/sections/overview/analytics/`, `banking/`, `booking/`, `e-commerce/`, `file/`** — all Minimals template dashboards; confirm which are customized with real revDSM data.
- **`src/sections/map/data/dummy-jobs-data.js`** — `// TODO: Replace with API call later`; confirm if map still uses dummy job markers.
- **Mail, File Manager** — confirm if connected to real backends.
- **Risk report, Paper fallback** — confirm web implementation exists.

---

## 7. What's Done But Needs Testing

### Both Platforms — Developed, Pending QA

| Feature | Testing Notes / Risks |
|---|---|
| Auth — Login, 2FA OTP, password reset | Test 2FA authenticator app pairing end-to-end on iOS + Android. |
| Lead Center — all 13+ modals | Each modal is large and complex; test all code paths (happy path + error states). |
| Google Maps lead map + filters | Test with 3000+ markers; verify performance. All filter combinations. |
| Heatmap rendering | Toggle on/off with sparse vs dense lead data. |
| Zone Canvasser | Draw polygon/rectangle; Apify property fetch latency; lead creation from map. |
| Deal Center calculator — multi-tab, rollout | All payment plan types; Lowe's lead path; WF High $7,500 floor; drop prices; confirm rollout. |
| Dynamic Deal Center — calculator + rollout | API connectivity to `/calculator-form-schemas/deal-center` on demo + prod. Payment plan endpoints. |
| Dynamic Job Builder | Tab renderer field types; engine dependency rules; summary finalize; agreement + signature. |
| Agreement signature | PDF rendering, canvas drawing, submit. iOS vs Android rendering differences. |
| Document scanner | Camera permission, scan quality, PDF output. Android more complex. |
| RevRender | Generation latency; history view; before/after image association. |
| Image annotation | WebView canvas on older iOS; save to S3. |
| Chat — voice notes | `react-native-nitro-sound` patch; test audio on Android specifically (patched package). |
| Offline image upload queue | Background/foreground transitions; flaky network simulation. |

### Platform-Specific Quirks

**iOS:**
- Haptics (`RNHapticFeedback`) — iOS only; Android silently ignores calls.
- Mapbox token must be in `~/.netrc` before `pod install` or install will fail.
- `KeyboardAvoidingView` offset: `0` iOS, `24`/`90` Android depending on screen.
- Safe area insets via `useSafeAreaInsets()` — test on notched iPhones and older devices.

**Android:**
- Edge-to-edge (`edgeToEdgeEnabled=true`) — all screens must handle status bar + nav bar insets. Test on gesture-nav and button-nav devices.
- New Architecture (`newArchEnabled=true`) — watch for library compatibility issues and bridge errors.
- `react-native-vision-camera` — Camera2 API; test permissions flow on Android 13+.
- Patches (`react-native-blob-util`, `react-native-nitro-sound`) must survive any package upgrades.

**Known Flaky Areas:**
- `CalculatorSummary.tsx` (~109 KB) and `SummarySection.tsx` (~85 KB) — very large files; re-render performance under heavy data.
- Dynamic job builder engine on JS thread — watch for frame drops on large schemas (no web workers on mobile).
- Zone Canvasser Mapbox + Apify — network timeouts on slow connections.

---

## 8. Known Issues / Technical Debt

### TODO / FIXME Comments

| File | Line | Issue |
|---|---|---|
| `src/screens/auth/authenticator-otp.tsx` | 142 | `// TODO: Implement backup code flow` — button is a no-op |
| `src/screens/auth/email-otp.tsx` | 178 | `// TODO: Implement backup code flow` — same |
| `src/components/chat-module/ChatModule.js` (web) | 892 | `// TODO: Handle error state (remove optimistic message or show error)` |
| `src/components/chat-module/ChatModule.js` (web) | 1136 | `// TODO: Implement forward functionality` |
| `src/sections/map/data/dummy-jobs-data.js` (web) | 1 | `// TODO: Replace this with API call later` |
| `src/sections/calculator-appointment/view/calculator-appointment.js` (web) | 171 | `// TODO: Navigate to client details` — post-booking nav incomplete |

### Patches

| Package | Patch File | Risk |
|---|---|---|
| `react-native-blob-util@0.24.10` | `patches/react-native-blob-util+0.24.10.patch` | Upgrading this package without re-applying patch breaks file operations |
| `react-native-image-picker@8.2.1` | `patches/react-native-image-picker+8.2.1.patch` | Same risk |
| `react-native-nitro-sound@0.2.12` | `patches/react-native-nitro-sound+0.2.12.patch` | Voice notes break without this patch |

> All patches apply automatically via `yarn postinstall` → `patch-package`. Never delete `patches/`.

### Deliberate Version Pins

| Package | Pinned Version | Reason |
|---|---|---|
| `react-native-maps` | `1.27.2` | Conflicts with `pod 'GoogleMaps', '9.4.0'` in newer versions |
| `react-native-nitro-sound` | `0.2.12` | Pinned to version the patch was written for |
| `react-native-nitro-modules` | `0.35.4` | Peer dep of nitro-sound; keep in sync |
| `react-native-worklets` | `0.9.1` | Reanimated peer; update together with Reanimated |
| `nth-check` / `svgo` (web) | overrides in package.json | Security audit fixes for transitive deps |
| `quill` → `2.0.3` (web) | override for `react-quill` | `react-quill` not natively compatible with Quill v2 |
| `jspdf@4.2.1`, `html2pdf.js@0.14.0` (web) | resolutions in package.json | Breaking changes in earlier versions |

### Hardcoded Credentials / API Keys (Security Debt)

| Location | Key | Action Required |
|---|---|---|
| `src/config/env.ts` (mobile) | Google Maps, Mapbox, Apify, Weather keys | Move to environment-driven config before release |
| `android/gradle.properties` | `MAPBOX_DOWNLOADS_TOKEN` | Rotate before sharing repo; move to CI secrets |
| `revDSM_Sales/.env` | Google Maps, Apify, Weather keys | Confirm never committed (in .gitignore) |
| `src/config/env.ts` | `API_URL` hardcoded to `demo-api.revdsm.com` | Build-env-driven URL needed for staging/prod |

### Architecture Debt

- **Mobile env is NOT build-driven.** `src/config/env.ts` has hardcoded `API_URL`. Must be fixed before CI/CD can target multiple environments.
- **Redux is auth-only by design** — all other state is TanStack Query + MMKV. Do not add other slices to Redux.
- **Two map SDKs on mobile** — do not confuse `react-native-maps` (Google, lead maps) with `@rnmapbox/maps` (Zone Canvasser only).
- **Largest files** (treat with care — high complexity):
  - Mobile: `CalculatorSummary.tsx` (~2,298 lines), `SummarySection.tsx` (~1,993 lines), `JobBuilder/index.tsx` (~1,730 lines), `ChatMessageBubble.tsx` (~1,600 lines), `EditContractDetailsModal.tsx` (~1,400 lines)
  - Web: `TabbedCalculator.js` (~66 KB), `ViewAllCalculators.js` (~72 KB), `before-after-modal.js` (~69 KB), `deal-details-view.js` (~46 KB), `ChatModule.js` (large)
- **Web is JavaScript, mobile is TypeScript.** Adding type safety to the web requires a migration.
- **Dynamic Job Builder engine runs on the JS thread.** The web can offload to web workers; mobile cannot. Watch for frame drops on large schemas.
- **No meaningful automated tests** in either repo. `__tests__/` and `jest.config.js` are present on mobile but have no coverage. Adding tests for calculator math (`calculation-results-util.ts`, `lowes-payment-util.ts`) would significantly reduce regression risk.

---

## 9. Build & Release Process

### Web Sales Frontend

**Local dev:**
```bash
yarn dev      # Vite dev server with hot reload
```

**Production build:**
```bash
yarn build    # outputs to dist/
docker build -t revdsm-sales-frontend .
```

- `docker-entrypoint.sh` substitutes ECS environment variables into `window.__ENV__` at container start (runtime injection — no rebuild needed to change API URL)
- Nginx (`nginx.conf`) serves the SPA; all routes → `index.html`
- Check `.github/` for any CI/CD GitHub Actions workflows

**Versioning:** `package.json` is `5.4.0` (inherited from Minimals template). No automatic bumping observed.

---

### Mobile App

> **No Fastlane or CI/CD configuration was found in this audit.**

**iOS (TestFlight):**
1. Ensure `src/config/env.ts` `API_URL` is set to the correct environment
2. `cd ios && pod install`
3. Open `ios/revDSM_Sales.xcworkspace` in Xcode
4. Select "Any iOS Device" → Product → Archive
5. Distribute to TestFlight via Xcode Organizer
6. Signing credentials (Apple Developer team, provisioning profiles) must be configured locally in Xcode

**Android (Play Store / APK):**
```bash
# Ensure API_URL in src/config/env.ts is correct
cd android
./gradlew bundleRelease      # .aab for Play Store
# OR
./gradlew assembleRelease    # .apk for direct distribution
```
- Signing config: check `android/app/build.gradle` for keystore config — **keystore file + credentials are not in this repo**
- Must be set up locally via `android/app/build.gradle` signing config or `ANDROID_*` env vars

**Versioning:** `package.json` is `0.0.1`. Actual app version:
- Android: `versionCode` / `versionName` in `android/app/build.gradle` — bump before release
- iOS: `CFBundleVersion` / `CFBundleShortVersionString` in `ios/revDSM_Sales/Info.plist` — bump before release

---

## 10. Handover Notes

1. **Read `CLAUDE.md` in the mobile root.** 500-line deep-dive into the mobile codebase, especially the Dynamic Deal Center / Dynamic Job Builder system. It is the most current reference for the complex multi-system calculator flow and the schema engine.

2. **The web is the source of truth for feature behavior.** When unsure how a mobile flow should work, find the web equivalent in `CLAUDE.md §4`. The web was built first and is more complete in most areas.

3. **Fix mobile env before any production release.** `src/config/env.ts` has `API_URL` hardcoded to `https://demo-api.revdsm.com/`. This must become build-environment-driven (e.g., via a script that generates `env.ts` from shell env vars, or via `react-native-config`) before a CI/CD pipeline or reliable staging/prod separation is possible.

4. **Two map stacks — keep them straight.** `react-native-maps` (Google Maps SDK) = lead/job maps. `@rnmapbox/maps` (Mapbox SDK) = Zone Canvasser only. The Podfile confirms both coexist. Never cross-use them.

5. **Mapbox requires a private registry token.** Add the Mapbox secret download token to `~/.netrc` before `pod install`. The token is in `android/gradle.properties` as `MAPBOX_DOWNLOADS_TOKEN`. Rotate before sharing the repo publicly.

6. **Patches must be preserved.** If you upgrade `react-native-blob-util`, `react-native-image-picker`, or `react-native-nitro-sound`, re-check and re-apply the patches in `patches/`. Run `npx patch-package <package>` after confirming the fix is still needed.

7. **The Kanban on web is not a deals pipeline.** It is a generic task board from Minimals template. Building a deals pipeline requires designing the data model (stages, deal value, ownership) and new backend API endpoints — it is greenfield work on both platforms.

8. **The Dynamic Deal Center has two separate data systems that must NOT be merged:**
   - **System A** (calculator + rollout): `GET /calculator-form-schemas/deal-center` — category-shaped schema with price tiers.
   - **System B** (job builder config): `GET /company/v1/job-builder-products` — vertical/tab-shaped config with field types (allocation, swatch, locationGrid, etc.).
   Both previously pointed to a wrong `/api/calculator-schemas` path (corrected 2026-07-02).

9. **`CalculatorSummary.tsx` (~109 KB) is the most complex file.** Contains the entire legacy Deal Center rollout logic, payment plan math, and summary rendering. Always regression test the full rollout flow after any changes.

10. **Socket.IO connection management.** Test foreground/background cycling on iOS (background socket behavior is restricted by iOS). The web's `RevRenderBgBootstrap` uses the socket for background report status — don't break this.

11. **Analytics logging (`logEvent`)** is called throughout mobile. Confirm the backend is receiving and processing these events (`src/services/api/LoggerService.ts`).

12. **No automated tests exist.** `__tests__/` is present but has no meaningful coverage. Prioritize adding tests for calculator math utilities (`calculation-results-util.ts`, `lowes-payment-util.ts`) as these power all financial calculations.

13. **The web blocks rendering until Google Maps loads** (`src/main.jsx` shows blank `<div>` until `initMap` fires). If the Google Maps API key is invalid or rate-limited, the web app shows a blank screen indefinitely. Consider adding a timeout/fallback.

14. **ECS runtime env injection (web).** `docker-entrypoint.sh` writes `window.__ENV__` into the served HTML. If the entrypoint fails or environment variables are missing, the app runs with empty API keys. Always verify the container environment in staging before promoting to production.

15. **The `agreement-dialog-new-logic.js` file** exists at the web root (`/Users/macbookpro/Desktop/mhalt-revDSM-sales-frontend/agreement-dialog-new-logic.js`) — this appears to be a scratch/draft file outside `src/`. Confirm whether this logic has been merged into the main codebase or if it is stale.

---

*Document generated 2026-07-13 from automated code analysis of both codebases. Verify any "needs confirmation" items against the live API and with the team before making architectural decisions. Keep this document updated as features are completed.*
