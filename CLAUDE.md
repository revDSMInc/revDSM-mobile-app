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
| My Deals (deal list → detail) | ✅ detail **reuses Lead Center** (see below) | `src/screens/MyDeals/index.tsx` → `LeadCenter` w/ `fromMyDeals` | `src/sections/deal/view/deal-details-view.js` |
| My Learning (LMS) | ⛔ 34-line stub | `src/screens/Learning/index.tsx` | external LMS redirect |
| User management (other users) | ⛔ not implemented (own profile only) | — | `src/sections/user/` |

### My Deals detail IS the Lead Center screen (ticket: "My deals should match resulted lead page")

Tapping a deal in **My Deals** no longer opens a separate deal screen — it opens the **same
Lead Center screen a sold lead opens**, so the two entry points are pixel-identical (lead info
block, **Job docs / Map / Tools**, the green `SALE - LEAD RESULTED` `ContractDetailsCard` with
its price rows + Agreement / Order Sheets / Down Payment Receipt sections and **Add Document**,
and **Msg Ops/IM**). Only the *edit* behaviour differs, and no result buttons are involved.

- **Entry point**: `MyDeals.openDeal` navigates to **`LeadCenter` with `{ lead, fromMyDeals: true }`**
  (was `DealDetail`). `fromMyDeals?: boolean` was added to the `LeadCenter` params in
  `RootStackParamList` (`src/navigation/index.tsx`).
- **The pencil keeps the My Deals flow.** On the normal lead path the Contract Details pencil
  opens the inline `EditContractDetailsModal`; from My Deals it must still launch the **4-step
  dynamic deal-edit wizard** (Install Date → Job Build → Job Price → Review & Submit). So
  `JobDocsSection` gained an optional **`onEditContract?: () => void`** prop that overrides
  `ContractDetailsCard`'s `setShowEditModal`; `LeadCenter` passes
  `onEditContract={fromMyDeals ? handleEditDealFromMyDeals : undefined}`. `handleEditDealFromMyDeals`
  (in `LeadCenter/index.tsx`) is the port of the old `DealDetail.onEdit`: legacy (non-dynamic) deal →
  "Edit on web" flash; dynamic deal → `navigate('DynamicDealCenter', { lead, mode:'edit',
  calculatorResultData: { calculatorId, appointmentId } })` with the same multi-shape id resolution.
  **Undefined on the normal lead path, so Lead Center is unchanged there.**
- **Header title is entry-aware**: `{fromMyDeals ? 'Deal' : 'Lead Center'}` (`LeadCenter/index.tsx`).
- **My Deals shows the global `MainHeader`** (added to the `showHeader` list in
  `navigation/index.tsx`) so its frame matches the screen it navigates into. Because the
  navigator's outer `SafeAreaView` already applies the **top** inset when the header shows,
  `MyDeals`' own `SafeAreaView` was switched to **`edges={['bottom','left','right']}`** — matching
  Lead Center. Leaving it on the default (all edges) double-pads the title bar.
- **`src/screens/DealDetail/` is now UNREACHABLE** (nothing navigates to it) but is still
  registered in the stack. Its **Addendums list** (tap an approved addendum → signed PDF via
  `getDraftAmendmentPdf`, plus the `DraftComparison` diff) has **no equivalent on the Lead Center
  screen** — Lead Center only shows the pending-signature banner (from its own `leadDraft` fetch).
  Re-add that list under the contract card if reps need it.

### Deal-edit wizard Step 0 now matches web (intro → calendar → confirm time → success)

`DynamicDealEditScreen.tsx` (the 4-step wizard the Deal pencil opens) previously dropped the rep
**straight onto the calendar** with a compact "Current" pill. It now mirrors web
`dynamic-deal-edit-modal.js` step 0, whose `dateStep` has **four** sub-views instead of two:

- **`intro`** (new landing view) — a centred white card: **"Edit Job Build"** / "Install Date", a
  grey bordered **Current Install Date** block (date `M/d/yy` stacked over its time window, or
  `TBD`), then full-width stacked actions **Modify Install Date** (green) / **No Change — Skip**
  (outlined) / **Cancel Job** (red filled). Web's `showCalendar === false` state.
- **`calendar`** — **"‹ Back"** (green) + centred **"Select Install Date"** title, the existing
  `InstallDateCalendar` in its own bordered box, a **"Sundays unavailable"** caption, then
  **TBD** (outlined) + **Use \<Mmm d, yy\>** (green, disabled → "Select a Date" until a day is
  picked). **Tapping a day now only SELECTS it** (web `handleDatePick`); the confirm-time card
  opens on **Use \<date\>** (`handleUseSelectedDate`) — previously a tap jumped straight to it.
- **`time`** — **"Confirm Time Window"** (`ProposedTimeCard`, rebuilt to match web's `showProposal`
  card): the long date (`EEEE, MMMM d, yyyy`), a **green-outlined block** naming the offered window
  — `MORNING` / `AFTERNOON` over the big green time range over "Arrival window" — then
  **"Work for the customer?"** and **Doesn't Work** (outlined) / **Confirm** (green). The old
  design (a "Proposed Install Date" eyebrow, a small pill, Yes/No, and a "← Back to calendar"
  link) is gone; web has no back link, so the prop and `handleBackToCalendar` were removed.
- **`success`** — the confirmation card (web `showSuccess`), reached from **both** TBD and
  Confirm: a 72px circular badge (**blue `#00B8D9` + `?`** for TBD, **green + check** otherwise),
  the title **"Install Date Set to TBD"** / **"Install Date Updated"**, then either
  "Will be scheduled at a later time" or the committed long date + time window, and a full-width
  green **"Done — Next →"** (`handleFinishInstallDate`) that advances to Job Build and resets
  `dateStep` to `intro`. NOTE: `handleAcceptProposedTime` and `handleSelectTbd` no longer call
  `setStep(1)` themselves — they land on this card, and **only "Done — Next →" advances the step**.

**One window is offered at a time, and declining both returns to the calendar.**
`INSTALL_WINDOWS` is the 2-slot list (web `TIME_SLOTS`) and its `period` values are now
**`Morning` / `Afternoon`** (were `AM` / `PM`), rendered uppercase. `handleProposeNextSlot`
(web `handleProposalNo`) advances to the second window, then on the next decline resets the slot
index and sends the rep back to **`calendar`**. It previously **rolled forward to the next
non-Sunday day**, silently moving the date the rep had picked. `proposedDate` is deliberately
kept on that return, so the calendar reopens with the date still selected.

Also: `handleSelectTbd` (new) sets `scheduleDate='TBD'` and clears the window. `proposedDate`
doubles as web's `selectedDate` (the calendar highlights `proposedDate || parsedScheduleDate`) and
is deliberately **kept** through Confirm so the success card can echo the committed date —
`handleFinishInstallDate` clears it. Styling moved into a **`StyleSheet`** at the bottom of the
file (`styles.dateCard`, `currentInstallBox`, `primaryBtn`, `calendarHeader`, `useDateBtn`,
`windowBox`, `successIcon`, …) — the first non-inline styles in this file.

The whole of step 0 is now a 1:1 port of web's step 0; nothing is intentionally left out.

### Deal-edit Review step names rows after the SECTION, not the tab

Ticket: *"My deals - review screen - I added porch ceiling soffit not regular soffit like it's
saying."* The wizard's step-4 review listed **`Soffit · Location / Footage / Type / Color`** for a
rep who had actually filled in the **Porch Ceiling SqFT** section. A **tab groups several sections
that reuse the same field ids** — the Soffit tab holds both *Vinyl Soffit* and *Porch Ceiling SqFT*,
each with `location`/`footage`/`type`/`color` — so labelling by tab tells the rep they changed the
wrong product.

`src/screens/DynamicDealCenter/utils/dynamic-deal-diff.ts` was an **incomplete port** of web
`src/sections/deal/components/dynamic-deal-diff.js`; three pieces were missing and are now in:

- **`sectionLabel` is captured.** `buildFieldLabelMap`'s `collect()` gained `sectionLabel` +
  `parentLabel` params, and the section loop now passes `s.label` —
  `collect(s.fields, s.id, t.label, v.label, s.label || '')`. It was previously dropped entirely, so
  the label map had no way to name the section.
- **New `formatChangeFieldLabel(meta)`** (web parity) replaces the inline
  `meta.tab ? \`${meta.tab} · ${meta.label}\` : meta.label` in `computeDynamicBuildChanges`. Prefix is
  **`meta.sectionLabel || meta.tab`** — section wins, tab is the fallback for tab-level fields (which
  have no section, e.g. `Lighting · Watts`).
- **New `resolveFieldLabel(field, parentLabel)` + `COLOR_FIELD_TYPES`.** A field with no label
  inherits its container's (`isContainerFieldType` → `stack`/`accordion`, imported from
  `utils/dynamic-job-builder/constants/field-types`), else falls back to **`'Color'`** for
  `swatch`/`colorSelection`/`customColor` — which are authored unlabelled because the swatch *is* the
  label. Previously such a field fell through to its raw **`f.id`**.
- **`SCOPE_SEP` fixed to `'\u0000'` (NUL)** (was a plain space `' '`). Scope keys are
  `` `${scopeId}${SCOPE_SEP}${fieldId}` ``, so with a space `"a b" + "c"` and `"a" + "b c"` collide;
  NUL can never occur in an authored id. ⚠️ Write it as the **escape sequence**, never a raw NUL byte
  — a literal `\0` in the source makes grep treat the file as binary.

Verified against the config shape in the ticket: section-not-tab naming, sibling sections with
shared field ids staying separate, unlabelled swatch → `Color`, and the tab-level fallback still
reading `Lighting · Watts`. Confirmed failing on the pre-fix code and passing after.

### Deal-edit Review: a REMOVED combination read as an edit of the surviving one

Ticket: *"My deals - addendums - combinations issues. I removed 85' of black hidden vent soffit from
the job. But I kept the original 200' white hidden vent soffit… Makes it seem like I removed the 85
feet black soffit and added an ADDITIONAL 200ft white soffit… I believe this issue is bc of
combinations. This needs to be resolved correctly for ALL combinations."* The review listed
`Soffit · Type PARTIAL → FULL`, `Soffit · Vinyl Soffit Footage 85 → 200`,
`Soffit · Color Musket Brown → White` — i.e. the removal was invisible and the untouched survivor's
values were reported as edits *to the deleted combination*. On an addendum ("original agreement plus
what we added minus what we removed") that reads as **200′ + 200′ of white soffit**.

⚠️ **Web has the identical bug** — `src/sections/deal/components/dynamic-deal-diff.js` is byte-for-byte
the same algorithm. This is the first deliberate **divergence** in this file, not a port; do not
"re-sync" it to web.

Cause is one line of `flattenStateValues` in
`src/screens/DynamicDealCenter/utils/dynamic-deal-diff.ts`: every combination of a section was
ingested under the **same** `qualify(sectionId, fieldId)` keys, so *"later writes override earlier"* —
a section collapsed to whichever combination happened to be **last**. With combos
`[white 200, black 85]` the original flattened to black/85/PARTIAL/Musket Brown; after the delete it
flattened to white/200/FULL. Hence the three phantom rows. **Positional diffing cannot work here**:
`handleRemoveCombo` (`DynamicTabRenderer.tsx`) both shifts the array *and* renumbers
`_combinationNumber` to `comboIndexOffset + idx + 1`, so **combinations carry no stable id at all**.

Rewritten to diff combinations by **identity**:

- **`collectStateSnapshot(jobState)`** replaces the flat-only walk, returning
  `{ flat, groups }` — `flat` holds single-valued state (section fields, combination-section
  `sectionState`, tab fields) and `groups` keeps each section's combinations as a **LIST**, keyed
  `` `${verticalKey}\0${tabId}\0${scopeId}` `` so groups never cross tabs. Legacy tab-level
  `combinations` are scoped by tab id, same as before.
- **`matchCombinations(orig, next)`** — three passes:
  1. **Exact-signature pairs claim each other FIRST.** This is the pass that fixes the ticket: the
     untouched survivor locks onto its own original, so it can never be paired with the deleted one.
  2. **Greedy best-overlap** (`overlapScore` = number of fields two combos agree on, ties broken by
     index distance) for the rest, so a genuinely *edited* combination still reads as a field change
     rather than a remove + an add.
  3. **One left on each side ⇒ pair them** regardless of overlap — otherwise rewriting every field of
     a section's only combination would report it as removed AND added.
- **Leftovers become their own rows**: `Combination Removed` (`kind: 'removed'`) / `Combination Added`
  (`kind: 'added'`), whose value is `describeCombo` — the combination named by its **contents**
  (`Location Rear · Vinyl Soffit Footage 85 · Type PARTIAL · Color Musket Brown`). Deliberately **not**
  numbered: `#N` is unstable across a removal (the deleted combo and the renumbered survivor can both
  be `#1`), so content is the only honest identifier.
- **`formatChangeFieldLabel(meta, comboLabel)`** now takes an optional middle segment, inserted **only
  when the section holds more than one combination** (`Soffit · Combination #2 · Vinyl Soffit Footage`).
  A single-combination section keeps the exact `<section> · <field>` label from the previous ticket —
  that regression guard is tested.
- **Empty combinations are dropped from both snapshots.** `ensureTabStateShape` seeds one blank default
  combo into any section that saved none, so without this the mount would emit a phantom
  `Combination Added` row and flip `buildChanged` true on a build the rep never touched.
- **`BuildChange` gained `kind?: 'change' | 'added' | 'removed'`** and `ReviewRow`
  (`DynamicDealEditScreen.tsx`) renders it: eyebrow `REMOVED` (red) / `ADDED` / `NEW`, a removal's value
  column stays neutral grey (not green — nothing new was entered), and an **added** row hides the
  struck-through `from` entirely, since striking an em dash reads as "something was there before".

`flattenStateValues` is **kept exported but is now explicitly documented as LOSSY** for combination
sections and is no longer used by the diff. It has no other consumer — if you reach for it, that is
the trap this ticket was about.

⚠️ `SCOPE_SEP` must still be written as the escape sequence `'\u0000'`. Writing the file with a raw NUL
byte (and the `comboSignature` join with a raw `\u0001`) makes grep treat the source as binary — that
happened once during this fix and had to be undone.

Verified against a two-combination Soffit config with a sibling `Porch Ceiling SqFT` section sharing
its field ids: the ticket repro (removal → exactly one `removed` row, and **none** of the three phantom
rows), edit-one-of-two, single-combo label regression, addition, remove-plus-edit together, sibling
sections staying separate, untouched build → `[]`, the blank-default-combo guard, and a fully rewritten
single combination still reading as field edits. The four combination cases **fail on the pre-fix code
and pass after**; the five regression guards pass on both. Applies to every combination section in the
config, so Gutters / gutter guards / soffit / porch ceiling / fascia wrap / fascia boards are all covered
by the same path.

### Investment Center tile unlocks instantly after "Jobs Built — Back to Tools"

Ticket: *"Investment center should be ready to go immediately after clicking 'jobs built - take me to
tools' button… when i confirm rollouts and go back to tools it take time to enable the Investment
Center button, can you enable it instantly, i think it's because we are calling api here, what if you
add a small loader right end of the investment center card?"* Correct diagnosis — the tile sat on
**"Please Fully Build ALL jobs first"** for the length of a round trip the rep had no reason to wait on.

`ToolsSection` (`widgets/components/LeadCenter/OperationalSections.tsx`) gates the tile on
`useLeadCalculatorStatus().allConfirmed`, whose `queryFn` does **two sequential GETs** — resolve the
appointment (`/appointments`), then read its calculators (`/appointments/{id}/lfcalculators`) — and
`useFocusEffect` refetches it on arrival. Until that resolves the hook serves the **stale cached**
value, which is `allConfirmed: false` because it was cached *before* the rep confirmed. So the tile
stayed locked, and tapping it warned "build and confirm all rollouts first" — about rollouts that had
just been confirmed.

**The app already knows the answer**, so the fix is to stop asking. In `hooks/useLeadCalculatorStatus.ts`:

- **New `markLeadRolloutsConfirmed(queryClient, lead)`** writes
  `{ hasCalculator: true, allConfirmed: true, count: max(prev,1) }` straight into the cache.
  `DynamicDealCenterScreen`'s `onRolloutsConfirmedDone` calls it before navigating — that button only
  renders once **every** rollout is confirmed, which is exactly the tile's gate, so the optimistic
  write can't claim more than is true.
- **It updates by key PREFIX** (`['lead-calc-status', <leadId>]` via `setQueriesData`), not the full
  key. `LeadCenter` re-fetches its lead through `useLeadCenterData`, so the `appointmentId` /
  `leadDate` segments of the key can differ from the copy the deal center was handed — **only the lead
  id is dependable**. An exact-key write would silently miss.
- **New bounded `LOCAL_CONFIRM_GRACE_MS` (60 s) override.** The confirmation is persisted by the deal
  center's **debounced** save engine (`handleConfirmRollouts` only calls `markDirty`), so a GET can
  legitimately still report `isRolloutConfirmed: false`. Without the override the tile would unlock and
  then **RE-LOCK** on the first server read — visibly worse than the delay being removed. Every exit of
  the `queryFn` — **including the two error paths** — goes through `applyLocalConfirmation`, so a
  transient appointment-resolution failure can't re-lock the tile either. The override **self-clears**
  the moment the server agrees (or the window elapses), so a genuinely unconfirmed lead can never stay
  unlocked, and a later real un-confirm still re-locks.

For the loader, `ToolCard` already had `isLoading` — but it swaps the ICON for a spinner, dims the card
to 0.6 and **disables the press**, which is wrong for a background refresh the rep isn't blocked on.
Added a light **`busy`** prop instead: the small right-side `ActivityIndicator` only, card at full
opacity and still tappable, with the lock glyph suppressed while it spins. `ToolsSection` passes
`busy={isCalcStatusFetching && !allConfirmed}` — **only while still locked**, since a spinner on a tile
the rep can already open is noise. The subtitle reads **"Checking job status…"** during that window, and
tapping then shows an `info` flash rather than the "you haven't built the jobs" warning, which mid-check
would be a guess — and usually a wrong one, this being precisely the post-confirm window.

Net: the tile is live on the first paint after "Jobs Built — Back to Tools"; the refetch still runs and
reconciles in the background.

⚠️ `markLeadRolloutsConfirmed` is the ONLY sanctioned way to unlock the tile early. Widening the grace
window, or making it sticky without the self-clear, would let an unconfirmed lead present a quote.

Verified against a real `QueryClient`: the cached status flips to unlocked, prefix matching survives a
drifted `appointmentId`/`leadDate`, a **different** lead is untouched, a lead with **no id** is a no-op
(rather than unlocking everything), and a lead with nothing cached still ends up reporting a calculator.
⚠️ The React-rendering half could not be exercised — `@testing-library/react-native`'s `render` returns
an object with **no queries** in this repo (the `__mocks__/test-renderer.js` React 19 shim), so
component-level tests of `ToolsSection` are not currently possible.

### Deal-edit Review step shows payment-method changes

Ticket: *"My deals - review screen - I changed payment plan - not showing changes."* The step-4
review listed build / Install Date / Contract Price / Down Payment but had **no row for either
payment method**, so switching the balance plan (e.g. `4091` → `2511`) reviewed as though nothing
had happened. Web shows **Down Pmt Method** and **Balance Method** rows.

The change flags already existed on mobile — but were **inlined inside `hasAnyChange`**, so a
payment-plan edit *enabled Submit* while rendering no row: the rep saw an empty review for an
addendum that really was being submitted. In `DynamicDealEditScreen.tsx`:

- **Flags extracted and named** (web parity): `downPaymentChanged`, `downPaymentMethodChanged`,
  `balanceMethodChanged`. `hasAnyChange` now composes those named flags instead of re-deriving them,
  so the button and the list can never disagree again.
- **New `resolvePlanLabel(stored, fallbackKey)`** (web `resolvePlanLabel`) — runs `coerceToPlanKey`
  then maps the key to its catalog label, so a row reads
  `2511 (6 Months 0% Interest No Payments…) (Bank Fee: 4%)` rather than a bare id. Falls back to the
  raw key when the catalog has no entry, and to **`—`** when nothing is set. Note an *unrecognized*
  stored method fuzzy-resolves via `resolveTierPaymentMethod` (amex / visa-mc-dscvr, else **check**),
  so it renders a real label — same as web.
- **Two `ReviewRow`s added**: `Down Pmt Method` and `Balance Method`, each gated on its flag.
- ⚠️ ~~Mobile keeps its `!!key &&` guard on both method flags.~~ **Superseded** — the pickers no
  longer open blank, so the guard is gone. See "Deal-edit payment methods now seed from the sale".
- **`ReviewRow`'s value column now shrinks and wraps** (`flexShrink: 1`, `maxWidth: '55%'`,
  `textAlign: 'right'`). Plan labels are long sentences and RN defaults a `View` to `flexShrink: 0`,
  which would have pushed the value off-screen — web wraps it the same way.

Verified: label resolution (incl. legacy saves that stored the label instead of the key, and the
fuzzy fallback), the ticket's `4091 → 2511` switch, unchanged/blank-picker non-changes, and that
every flag feeding `hasAnyChange` has a row able to render it.

### Deal-edit Job Summary: per-card colours + combination dividers

Ticket: *"My deals - job summary - LeafFilter - make it more distinct between combinations, add
horizontal line between like web; also the card colors are purple, it should also be like web."*
Two unrelated causes.

**1. Every card was purple — a missing prop, not a styling bug.** Each summary card's header colour
comes from the matching **calculator-schema CATEGORY** (`resolveTabAccentColor` →
`findTabCategoryColorFromSchemas`), which needs the **System A** schemas. Those are NOT on
`initialConfig` (that is the System B job-builder config), so they arrive via the separate
**`calculatorSchemas`** prop. `DynamicDealCenterScreen` (new-deal path) passes it as
`calculatorSchemas={verticals}`; **`DynamicDealEditScreen` passed nothing**, so `schemas` was `[]`,
the category branch returned null, and every tab fell through to the single `vertical.color`.
Fixed by passing `calculatorSchemas={configuredSchemas}` — literally the same array (in
`DynamicDealCenterScreen`, `verticals = configuredSchemas`).

> Confirmed by calling the real `resolveTabAccentColor` for three tabs of one vertical:
> `schemas: []` → `['#8b5cf6','#8b5cf6','#8b5cf6']` (**`#8b5cf6` is exactly the reported purple**);
> with schemas → `['#00B8D9','#22c55e','#4CBB17']`. So any *other* screen that embeds
> `DynamicJobBuilderScreen` must pass `calculatorSchemas` or its summary will go monochrome too.

**2. Combinations ran together — the dividers existed but were invisible.** Web draws them at two
weights via `alpha(theme.palette.divider, …)`: **0.4** (a visible rule) between combinations and
between combination groups, **0.12** (a hairline) between field rows in a simple section. Mobile
used `border-slate-100` / `border-slate-50` for all of them — near-white on a white card. Now in
`VerticalSummaryTab.tsx` as two named constants, **`DIVIDER_STRONG = '#CBD5E1'`** (≈ 0.4) and
**`DIVIDER_HAIRLINE = '#F1F5F9'`** (≈ 0.12), applied as explicit `borderTopWidth`/`borderBottomWidth`
styles rather than NativeWind classes. Also **added the between-group rule** mobile never had (web
`groupIndex < section.combinationSections.length - 1`) — that is the line above
**"Downspout & Accessories"** in the web screenshot.

**Divider spacing lives in `style`, not NativeWind margin classes**, and is deliberately **asymmetric**:
`CombinationSummaryItem` uses `paddingBottom: 16` / `marginBottom: 22`, and the group rule
`marginTop: 16` / `marginBottom: 6` (the latter stacking on the parent's `space-y-4`).

Web's own 16/16 (`Divider sx={{ mt: 2 }}` + `Stack spacing={2}`) does NOT translate 1:1 here, which
is why this was re-tuned twice — first 12/8, then an even 16/16, and QA still reported the rule
"touching the Combination text". Two optical reasons: above the rule the last field row contributes
its own row spacing, so 16px reads as ~24px; below it the next **"Combination #N" chip is a tight
pill** (`py-0.5`) whose text sits flush against its top edge, so an equal 16px reads as touching.
22px below balances them. Keep the spacing in `style` — the View already carries a `style` prop for
the border, and mixing margin classes with it made it ambiguous which applied.

### Deal-edit "Send Addendum To" phone is dash-formatted, always +1

Ticket: *"My deals - phone number show the dashes, like this: 443-878-4937, always use +1 as we are
using app in usa."* The field took raw keystrokes, so a rep saw `0948320498`.

Two new helpers in **`src/utils/phone-util.ts`** (that file's existing `formatUSPhoneNumber` emits
`+1 (XXX) XXX-XXXX` — parens, and its OWN `+1` — so it is wrong for a field that renders a static
`+1` beside the input):
- **`formatLocalUSPhone(text)`** → the local 10 digits as `XXX-XXX-XXXX`, no country code.
- **`toE164USPhone(text)`** → `+1XXXXXXXXXX` for the API.

Both take the **LAST 10 digits** when given more, rather than stripping a leading `1`. That handles
`+1…` / `1…` / already-formatted input, and never mangles a partially-typed number mid-entry.

In `DynamicDealEditScreen.tsx`: the input formats on change (`maxLength={12}` = 10 digits + 2
dashes, placeholder `443-878-4937`), and the **seed** from `lead.customerDetails.phone` is formatted
too — it may be stored raw or E.164.

⚠️ **The submit payload stays E.164.** The old code passed the value through untouched whenever it
merely *started with* `+`, so a display string like `+1 443-878-4937` would have reached the SMS
provider with spaces and dashes once the field became formatted; and a stored `14438784937` became
`+114438784937`. `toE164USPhone` fixes both.

Verified: progressive typing (`4` → `443-8` → `443-878-4937`), every stored shape (raw / E.164 /
`1`-prefixed / parens / already-dashed) normalizing to the same display and the same `+14438784937`
payload, idempotence, and the 10-digit cap.

### Deal-edit wizard: keyboard covered the Notes / Phone / Price inputs

Ticket: *"My deals - final page - not letting me see 'notes' or 'phone number', keypad in way."*
`DynamicDealEditScreen`'s three step `ScrollView`s had only `keyboardShouldPersistTaps` — no keyboard
avoidance at all — so on the Review & Submit step the keyboard sat over **Additional Notes** and
**Send Addendum To ▸ Phone Number**, which are the last things on the page.

Steps 2 (Job Price) and 3 (Review & Submit) now use **`KeyboardAwareScrollView` from
`react-native-keyboard-controller`** with `bottomOffset={24}`, plus `paddingBottom: 48` so the last
field clears the sticky Back / Submit footer. Step 0 has no text inputs and was left alone.

⚠️ **`automaticallyAdjustKeyboardInsets` is NOT enough — it is iOS-only.** That was the first fix
here and it left Android broken: the phone field still sat behind the keypad. The manifest does set
`android:windowSoftInputMode="adjustResize"`, but that no longer shrinks the window once
`KeyboardProvider` (mounted in `App.tsx`) puts the app edge-to-edge — so nothing moved the field.
`KeyboardAwareScrollView` scrolls the **focused input** above the keyboard on **both** platforms and
needs no per-platform branching. It requires `KeyboardProvider`, which is already app-wide.

This is the **first use of `KeyboardAwareScrollView` in the repo** — prefer it over
`automaticallyAdjustKeyboardInsets` for any *scrolling* form with fields near the bottom.
`VerticalSummaryTab` / `DynamicTabRenderer` / `InvestmentPanel` still use the iOS-only prop and have
the same latent Android gap if a field there ever sits low enough.

⚠️ Still **do NOT** reach for a padding `KeyboardAvoidingView`: it only shrinks the ScrollView to the
space above the keyboard, leaving a low field below the fold and still hidden — the very bug the
comment in `DynamicJobBuilderScreen.tsx` (~line 1412) records having removed. (`RolloutView` /
`CalculatorView` / `ResultJobModal` do use one, but they wrap a non-scrolling root, so the trade-off
differs.)

### Deal-edit summary listed every document twice

Ticket: *"My deals - summary page - why is it showing two order sheets and two agreements? I haven't
added any more."* The Deal screen showed 2 agreements + 1 order sheet; **Edit ▸ Summary showed 4 + 2**
— an exact doubling.

There were **two separate causes** — one on the Deal screen, one in the edit wizard. Fix both.

#### (a) Deal screen — `JobDocsSection` merged the lead record with two outcome reads

⚠️ Corrects an earlier claim in this doc that no legacy outcome call fires here — **it does.** A
device network trace shows `GET /lead/v1/{leadId}/outcome` (no calculator id) on opening the Deal.

Web renders Contract Details documents from **`lead.jobBuilderDocuments` alone** — the record it
already holds from the sales-portal list (`contract-details.js`:
`lead?.jobBuilderDocuments?.agreements`) — and makes **no outcome call on this screen**. Mobile
always merged **two more** sources on top: `getLeadOutcome(leadId)` and
`getLeadOutcomeByCalculator(leadId, calcId)`, both read for `leadOutcomeDocuments`.

That is what listed one agreement twice. The same signed agreement exists as a **JobBuilderDocument**
AND as a **LeadOutcomeDocument** — different collections, so the copies share neither `_id` nor
`filePath`, and their byte sizes differ slightly (68 KB vs 66 KB in the ticket) so the `type:size`
content key misses too. **Neither dedupe key can join them**, so both rendered.

The two outcome reads are now a **FALLBACK, not a merge** — they run only when the lead carries no
documents of its own. That restores web parity and drops two requests per open, while preserving the
case they were added for: a signed/generated agreement is filed ONLY as a LeadOutcomeDocument, and
for that flow the backend returns `jobBuilderDocuments` empty, so without the fallback it would not
appear at all.

#### (a2) The mount-time outcome prefetch in `useLeadCenterData` is gone too

`useLeadCenterData` also fired `GET /lead/v1/{leadId}/outcome` on mount for every resulted lead —
visible in the trace even after (a) — purely to prefill `jobState` / `calculatorData` /
`outcomeForm`. **Nothing renders from those**: the screen's documents and contract figures come from
the lead record itself. Web makes no outcome request on this screen at all.

Their only consumers are the two Job Builder launch paths in `LeadCenter/index.tsx` — the
`openJobBuilder` auto-open effect and `handleShowJobBuilder` — and **both already issue their own
`getLeadOutcome` at the moment of launch**. They previously took only `jobBuilder` from that
response and still read `LFCalculator` / the outcome form from the stale prefetch; they now derive
**all three** from their own response (`outcome?.LFCalculator || calculatorData`), so the Job Builder
gets *fresher* data than before.

The effect is now just `setIsOutcomeLoading(false)` (the flag still gates the auto-open effect, it is
simply never true), and `outcomeForm` / `calculatorData` became frozen module-level empty objects —
stable identities, read only as fallbacks, never written.

Net: opening a Deal makes **three fewer requests** than before this ticket (two from (a), one here).

#### (b) Edit wizard — `SummaryFinalizeCards` merged the server list with the draft copy

`SummaryFinalizeCards.tsx` renders the union of **two display sources**:
the server-resolved list and the draft copy on `jobState.agreements` / `.orderSheets`. Normally they
dedupe, because `commitUploaded` writes the **server rows** (carrying `serverId`) into both. But an
agreement filed by the **sign/scan flow** is stored on the draft as a bare local file —
`{ name, uri: 'file:///…', isSystemGenerated: true }` with **no `serverId`/`filePath`**. `docIdentity`
therefore keys the draft copy on its `file://` uri and the server copy on `serverId`, the keys never
collide, and `dedupeDocs` keeps both.

Fix: **in edit mode the server read is authoritative** — new `mergeDocSources(server, draft)` returns
the server list outright when `editMode && server.length`, and otherwise falls back to the previous
dedupe-union. Rationale:
- The deal is already submitted, so every document is on the server, and `downloadOutcomeDocuments`
  (lead-scoped) is the only source that **reflects deletions** — see [[dynamic-jb-edit-mode-docs-source]].
  So the endpoint choice is deliberate and must NOT be "fixed" by switching to the calc-scoped read.
- A document added *during* the edit session is safe: `commitUploaded` replaces **both** sources with
  the server read-back, so it is already in `resolvedDocuments`.
- The `.length` guard keeps the draft as a fallback, so an edit can never render zero documents.

⚠️ **Name is NOT usable as a dedupe fallback key.** Two genuinely different agreements both display as
`"Agreement"` (the ticket's own screenshot shows 68 KB and 66 KB rows), so matching on name would
silently HIDE a real document.

Note `__tests__/screens/DynamicDealCenter/summary-documents.test.tsx` covers this area but is one of
the two suites that cannot run under jest (no global `react-native-blob-util` mock), so this change
was verified by tracing the two sources' identities rather than by a test run.

#### (c) The backend files a SECOND agreement row on submit

Follow-up on the same symptom: with (a) and (b) fixed, the Edit ▸ Summary Agreements card still showed
**two** PDFs. A device network trace of `GET .../download` ("Lead outcome documents downloaded
successfully") shows the server genuinely returns two agreement rows for one signed agreement:

| | `_id` | `name` | `filePath` | size |
|---|---|---|---|---|
| real | `…b4748` | `Agreement_OFN-A_1786106851569.pdf` | `…/agreements/1786106851569-Agreement_OFN-A_….pdf` | 69395 |
| duplicate | `…b4c0c` | **`""`** | `…/agreements/1786106886943-**0-document.pdf**` | 69395 |

Identical `fileData.size` AND identical `base64Data`, but a **distinct `_id` and `filePath`** — so
`docIdentity` keys them apart, `dedupeDocs` cannot merge them, and neither is `isSystemGenerated` so
`collapseSignedAgreement` passes both through. **This is a real duplicate on the server**, written at
submit time; nothing on the client created it.

⚠️ **The filter MUST run on the RAW server rows, not in the display component.** The first attempt at
this put it in `SummaryFinalizeCards` and it silently did nothing: **every** loader defaults the name —
`d.name || (group === 'agreement' ? 'Agreement' : 'Order Sheet')` — so by the time a row reaches the
card the empty name, the only thing distinguishing the duplicate, is already gone. The card was
labelling the duplicate `"Agreement"` and the filter saw a named row. Two loaders do this:
`resolveOutcomeDocRows` (`utils/outcome-documents.ts:107`, create path) and the inline `toDisplay` in
`DynamicJobBuilderScreen.tsx` (`editDocsData`, the edit path in the ticket).

Two exports in **`utils/outcome-documents.ts`**, applied before either mapper:
- **`dropUnnamedAgreements(rows)`** — a pure agreement array; used by the edit-mode `editDocsData` query.
- **`dropUnnamedAgreementRows(rows)`** — the same rule over a MIXED row list, keyed off each row's
  `documentType`/`_group`; used inside `resolveOutcomeDocRows`, which receives agreements and order
  sheets together.

⚠️ **Explicitly a DISPLAY-LEVEL WORKAROUND**, requested as one (*"for now … only show that agreement
who has the name"*). The duplicate row still exists on the server — the real fix is to stop writing it
on submit. This does NOT contradict the warning above: that says name is unusable as a *dedupe key*
(two real agreements can share a name); this only tests whether a name **exists**.

⚠️ **AGREEMENTS ONLY.** Order sheets are legitimately filed with an empty name by the same endpoint —
the very payload that exposed this has `orderSheets[0].name === ""` — so applying it there would hide
the only order sheet on the deal.

Safety valve, since a blank name is not by itself proof of a duplicate: if filtering leaves **nothing**,
the unfiltered list is returned, so a deal whose agreements are all unnamed still renders them instead
of an empty card. (Locally scanned/draft documents never reach these helpers — they live on
`jobState.agreements` and are merged in the component, downstream of this.)

⚠️ **The Deal screen (`JobDocsSection`) is NOT covered** and will still list both. Its `mapWith`
**overwrites** `name` with a constant (`'Agreement'` / `'Order Sheet'` / …) before display, so the
server name is gone by then — the filter would have to run on the raw docs, pre-map. Separate change.

Verified against the three rows from the trace verbatim (both agreements + the unnamed order sheet):
the duplicate dropped and the real agreement kept; **the unnamed order sheet kept** in the mixed-list
form; all-unnamed falling back to the full list; a single named agreement and two genuinely different
named agreements untouched; the legacy `_group` tag honoured alongside `documentType`; original order
preserved; empty/undefined input a no-op.

### Deal-edit price didn't move when a combination's footage changed

Ticket: *"My deals - I changed footages which means price should change but nothing changed — left
side 333ft and in the third step price is not going to update."* Step 2 (Job Price) showed **New Job
Build identical to Previous** plus *"No priced quantity change detected from the build"*, i.e.
`computeEditedTiers` returned `delta = 0`.

Nothing is wrong in `dynamic-deal-pricing.ts` itself — it is a faithful port. The break is **upstream,
in the job-builder engine it calls**. Money never lives on the builder: a combination's footage
reaches the calculator schema through an **allocation** (`buildCalculatorDetails` →
`buildAllocationQtyMap` → `collectAllocationFields` → `resolveAllocationMetrics().allocated` →
`collectAllocationDcRefs`). Mobile's engine predates web commits **`9293ad28`** and **`99eb8d8a`**
("Improved allocation tracking to be config-driven … and to validate nested allocations in
stacks/accordions"), so three pieces of that chain were missing. Ported now:

- **`allocation-utils.ts` › `collectAllocationFields` only scanned the TOP level** of `tab.fields` and
  `section.fields`. An allocation authored **inside a `stack`/`accordion` container** was invisible →
  `buildAllocationQtyMap` returned `{}` → the footage never reached the schema → `delta` 0. New
  `collectAllocationFieldsDeep` recurses on any `field.fields`, matching web. **This is the fix for
  the ticket**; it also un-breaks tab-completeness checks, which call the same function.
- **`combination-utils.ts` › `computeGroupUsed`** took only the **FIRST** locationGrid
  (`rowFields.find`) and read it **only** as `combo[gridField.id]` — a grid stored under the field's
  `key`, or the legacy `combo.grid` slot, resolved `undefined` → 0 used. Now sums **every** grid field
  with `combo[gf.id] ?? combo[gf.key] ?? combo.grid`, and the no-grid branch sums **every `number`
  field** instead of the hardcoded `['sqft','sq','count']` key heuristic. (Grids win over sibling
  numbers so add-ons like miters/end-caps aren't double-counted against the allocation.)
- **`allocation-utils.ts` › `getTabLevelUsed`** got the same generalization for legacy tab-level
  combinations.
- **`dependency-engine.ts` › `resolveAllocationAvail` is now metrics-first.** Modern allocations put
  the budget in `metrics[{ role:'budget' }].valueSource`; only legacy ones use `field.dcField` /
  `field.avail`. Reading the legacy shape first made a metrics-based card look like a **zero-budget /
  excluded** card.

Two more divergences fixed in the same pass:

- **`dynamic-deal-pricing.ts` › `buildBuilderQtyIndex` triple-counted allocation quantities.**
  `buildAllocationQtyMap` **already emits both the raw ref and `normName(ref)`** as separate keys, and
  the overlay then re-added `normName(ref)` for each of them — so `byDcField[normalized]` ended up at
  3× the real quantity. Web adds each entry once; mobile now does too.
- **`dependency-engine.ts` › `truthy`/`falsy` operators used bare `Boolean(raw)`**, so a quantity of
  `0` — or the string `"0"` a text input produces — read as TRUE. New `isTruthyValue` (web parity)
  treats numeric-zero as falsy and leaves non-numeric strings truthy. ⚠️ This is the one change with
  reach beyond the ticket: it applies to **every** `truthy`/`falsy` dependency rule (tab locks, field
  visibility, allocation contributor `when` gates), which is exactly why the divergence mattered — a
  zero-valued contributor could match on mobile and not on web.

Verified by driving the REAL `computeEditedTiers` over a LeafFilter-shaped config (combination section
+ locationGrid + option-bound allocation), footage 300 → 333: **fails on the pre-fix code** for the
nested-allocation and grid-stored-under-key cases, passes after, and an untouched build still reports
`changed: false` with `next === previous`. tsc error count unchanged (83, all pre-existing), lint
unchanged, suite 926 passing.

✅ **Confirmed on device**: after these fixes a GUTTERS edit re-prices to **COST $3,848 / PAR $5,502 /
RETAIL $8,195** — identical to web to the dollar on the same deal ("QS test"). The bridge works.

⚠️ **One case is still open: a LEAFFILTER-only edit does not move the tiers.** In the failing repro the
GUTTERS tab reads "No data entered", so LeafFilter is the only quantity in play. Not yet reproduced
locally, and it is NOT known whether web moves the price for that case either — the working web
comparison had gutters populated. Do not assume it is the same bug as above; the gutters path proves
the machinery is sound.

Ruled out while chasing it (all verified parity, don't re-investigate): the whole engine —
`allocation-utils`, `combination-utils`, `allocation-value-resolver`, `allocation-config-utils`,
`dependency-engine`, `deal-center-field-utils`, `location-grid-utils`, `toggle-utils`,
`combination-summary-utils`; the price normalizer (`bakeFieldPrice` DOES strip thousands separators,
same as web `toPriceNumber`); `tierFor`'s schema walk (identical to web `calculateResultUtil`); the
embedded builder does **not** auto-save in edit mode (`performAutoSave` early-returns on `embedded`),
so the baseline can't absorb the edit; `jobState` is keyed by config ids via `updateTabState`, so no
storage-key drift; and the builder is seeded from the same `initialState` the diff compares against.

**`DEAL_PRICING_DEBUG` in `dynamic-deal-pricing.ts` is temporarily `true`** and a `describeBridge()`
helper logs `[dealEditPricing:bridge]` with the counts that isolate the broken link — `flatNext` (did
the edited state arrive), `keyMapHits` (do config field ids line up with the state's section-qualified
keys), `allocRefs` (did any allocation map a quantity), `overlayDiff` (did the calculator keys move)
and `overlayDiffPriceable` (are those keys ones the schema can price). ⚠️ **Set the flag back to
`false` before release** — it logs on every keystroke in the wizard.

### Deal-edit Job Price step had NO validation (price below cost, down payment above price)

Ticket: *"it will not allow me to go next, like web, until i filled the right contract price."* Web
shows a red-bordered Contract Price with **"Cannot be below the cost of $3,848."** and a **disabled
Next · Review**; mobile showed the same `COST -94%` badge but no error and an enabled button, so a rep
could advance and submit an addendum priced 94 % below cost.

Mobile had **no price validation at all**. Ported web's three values verbatim into
`DynamicDealEditScreen.tsx`:

- `costFloor = tierResult.next.cost` — the REBUILT cost, so the floor tracks the edited build.
- `contractPriceError` — `Cannot be below the cost of ${fmtMoney(costFloor)}.`
- `downPaymentError` — `Cannot exceed the contract price of ${fmtMoney(contractPrice)}.` (a down
  payment over the price yields a negative balance).
- `hasPriceError` gates **both** footer buttons: `Next · Review` on step 2 and `Submit Addendum` on
  step 3 — web disables both, so an error can't be walked past in either direction.

Each input turns red (`#DC2626`) and renders its message underneath; the Contract Price row drops its
bottom margin to 4 when erroring so the message sits tight under the field, as on web.

⚠️ **Still not ported: web's `rebuildEntriesFromSchema`** (commit `3be3929e`, REVDSM-1075). That
rewrites the stored `LFCalculator` `entries`/`totals` from the schema when an addendum changes the
build, so the accepted scope matches the scoreboard. It affects the **submit payload**, not the tiers
the rep is shown, so it is a separate ticket.

### Scan-document sheet: blank PDF tile + the agreement was deletable from it

Ticket: *"don't allow user to delete agreement from here creating job builder; also show some preview
here like we are showing outside — empty card is not showing well."* Job Builder ▸ Summary ▸
**Agreements** pencil opens `DocumentScannerModal` ("Scan Agreement"), where the filed agreement
rendered as a **blank grey tile with a red ✕**.

Both problems are in **`src/widgets/modals/job-builder/DocumentScannerModal.tsx`**:

- **The tile was blank because the modal threw the file away.** Its `visible` effect projected each
  `initialFiles` entry down to `{ uri, serverId, isNew, name }`. A server document's source lives on
  **`secureUrl`/`url`, not `uri`**, so `<Image source={{ uri: undefined }}>` had nothing to draw —
  and even with a URL a signed agreement is a **PDF**, which `Image` cannot decode. It now **spreads
  the whole file** (`{ ...f, serverId: f.serverId || f._id, isNew: false }`) and renders the same
  placeholder the summary card uses — `file-pdf-box` icon + the document name — whenever
  `isPdfFile(item) || !fileSrc(item)`. `isPdfFile`/`fileSrc` are local copies of the
  `SummaryFinalizeCards` helpers, so the two surfaces agree on what is a PDF.
  - ⚠️ Keeping the whole object also fixes a **latent identity bug**: the narrow projection dropped
    `filePath`, and `SummaryFinalizeCards.handleScannerSave` prunes by `docIdentity`
    (`serverId ?? _id ?? filePath ?? id ?? url ?? uri ?? name`). A document identified only by
    `filePath` therefore failed to match itself on the way back out and was **pruned from the card on
    Update** even though the rep removed nothing.
  - The `uri` field is deliberately **not** overwritten with the resolved source — `docIdentity` reads
    `uri`, so rewriting it could change a document's identity. Display resolution happens at render.
- **New `allowRemoveExisting?: boolean` prop (default `true`).** When false the ✕ is hidden for
  documents that arrived via `initialFiles` (`isNew === false`); **pages scanned in this session keep
  theirs**, so a misscan is never stuck. The info banner swaps to "Documents already on file can't be
  removed here." Defaulting to `true` leaves the other two callers — `LeadCenter/JobDocsSection` and
  the legacy `job-builder/SummarySection` — unchanged.

`SummaryFinalizeCards` passes **`allowRemoveExisting={scannerCategory === 'agreement' ? editMode : true}`**,
so the ✕ is hidden for exactly one case: an **already-filed agreement in the CREATE flow**. Order
sheets always keep delete, and so does the **My Deals ▸ Edit Job Build** flow — the rep is revising a
submitted deal there and must be able to swap out a wrong agreement.

⚠️ Write it as that **explicit branch on the category**, not as the equivalent
`editMode || scannerCategory !== 'agreement'`. The two are logically identical, but QA reported the ✕
missing from ORDER SHEETS against the boolean form, and the flat expression makes it easy to believe —
and easy to break for real when the agreement rule is next edited. The full truth table is: order
sheets `true` in all four (create/edit × filed/new); agreements `false` only for create + already-filed.

⚠️ In the create flow this leaves **no delete path for an existing agreement on the Job Builder
summary screen** — the card header's pencil is the only entry point. That is deliberate and is the
ticket's intent.

⚠️ **`editMode` is the create/edit discriminator for this whole component** (it also drives
`agreementRequired`, `showOrderSheetCard` and `mergeDocSources`). Gating on the scanner category alone
was the first attempt here and was wrong — it stripped delete from the My Deals edit flow too.

The other two callers get the PDF-preview fix for free — they had the same blank-tile bug. They filter
`p.isNew === true` before uploading, so the richer existing-file objects pass straight through.

### Deal-edit payment methods now seed from the sale

Ticket: *"My deals - payment method from sale isn't showing; in web it's showing."* Job Price (step 2)
opened with **Down Pmt Method** and **Balance Method** both reading "Select payment method", even
though the deal was sold with one (the outcome carries `balancePaymentMethod: "check"`).

This was **deliberate on mobile and wrong** — it is the divergence recorded in the section above. The
seed effect explicitly blanked both (`setDownPaymentMethod('')`), reasoning that the rep should
re-pick and that the submit payload falls back to `lead.paymentMethod` anyway. The payload was indeed
fine; the *display* simply never showed the deal's own method. Now a 1:1 port of web
`dynamic-deal-edit-modal.js`, in `DynamicDealEditScreen.tsx`:

- **Seed both from the lead**: `setDownPaymentMethod(lead?.paymentMethod || '')`,
  `setBalanceMethod(lead?.balancePaymentMethod || '')`.
- **`balanceMethodKey = coerceToPlanKey(balanceMethod, 'check')`** — the balance ALWAYS resolves,
  because every sold deal has a balance to collect (web uses the same `'check'` fallback). The down
  payment keeps its blank-allowed form (`downPaymentMethod ? coerce(…, '') : ''`) — a deal with no
  money down legitimately has no method.
- **The `!!key &&` guards are removed** from both change flags; each now compares against the same
  baseline it was seeded from, with the matching fallback:
  `coerceToPlanKey(lead?.paymentMethod, '') !== downPaymentMethodKey` and
  `coerceToPlanKey(lead?.balancePaymentMethod, 'check') !== balanceMethodKey`. The guards only existed
  to stop a blank picker reading as a change; seeding makes them obsolete, and keeping them would have
  **masked a real edit back to the deal's original method**.
- ~~**New `downPaymentSelectOptions`** (web parity), splicing a seeded financing plan into the Down
  Pmt options.~~ **Superseded and removed** — see "Down Pmt Method must never offer a financing plan"
  below. The Balance picker still uses the full `paymentOptions` catalog.

⚠️ **Side effect on the displayed tiers, and it is the correct one.** `computeEditedTiers` receives
`paymentMethod: resolveTierPaymentMethod(balanceMethodKey)`. That key used to be `''` → `'check'` →
0 % bank fee for every deal. A deal whose balance method is **AMEX or MC/VISA/DSCVR** now grosses its
COST/PAR/RETAIL up by that plan's fee, exactly as web does — so those deals' tiers will read higher
than before this change.

The submit payload is unchanged (`downPaymentMethodKey || lead?.paymentMethod || ''`) — it already
matched web.

### Down Pmt Method must never offer a financing plan

Ticket: *"in Down Pmt Method you als showed balance method fix it please."* Job Price (step 2) opened
with **Down Pmt Method** reading `2521 (12 Months…)` — the same financing plan as **Balance Method** —
on a deal with **$0 down**.

This was a **self-inflicted regression from the seeding ticket above.** `pricing.outcomeDownPaymentMethods`
is correctly filtered to cash/card (`p.type === 'cash' || 'card'` in `useDealPricing`), so the picker's
own list was fine — the financing plan was there because **`downPaymentSelectOptions` spliced it in**.

`lead.paymentMethod` IS the down-payment field (see the submit payload), but a sold deal frequently has
the **rollout's** plan written into it, so it holds a financing key. Seeding from it then surfaced that
key, and the splice existed precisely to make such a key selectable — offering "12 months financing" as
a way to pay a *down payment*, which it is not: financing is how the **balance** is carried.

⚠️ **Deliberate divergence from web** (`dynamic-deal-edit-modal.js` is byte-identical here and has the
same flaw — it coerces against the FULL catalog and splices the result). Do not "re-sync" this.

- **New `toDownPaymentKey(stored)`** — coerces, then returns the key **only if it is in
  `downPaymentOptions`**, else `''`. `downPaymentSelectOptions` is deleted; the picker is back to plain
  `downPaymentOptions`, so nothing outside the basics can be shown or chosen.
- **The change-flag baseline uses the SAME helper**
  (`toDownPaymentKey(lead?.paymentMethod) !== downPaymentMethodKey`). Filtering only the seed would
  compare `'2521'` against `''` and make every affected deal open already "changed", rendering a
  phantom Review row and enabling Submit — the exact failure the removed `!!key &&` guards used to mask.
- **The submit payload is untouched**: `downPaymentMethodKey || lead?.paymentMethod || ''` still falls
  back to the stored value, so blanking the *display* never wipes what the deal had. The rep picking a
  real method overrides it as before.

Traced through every stored shape: a financing key → blank picker + no phantom change; `check` and a
legacy label (`AMEX (5.00% Fee)`) → seeded normally; empty → blank; rep picks a method → change flag
true and the Review row renders; unrecognized text → the `resolveTierPaymentMethod` fuzzy fallback still
lands on a basic. Lowe's leads scope `downPaymentOptions` to Lowe's methods, so a non-Lowe's key blanks —
correct, since that method is not offered for the lead, and the payload fallback preserves it.

### Rehash with no job scope opens the entry form, not a locked $0 receipt

Ticket: *"in the rehash module when the lead having `isRehashed: true` … if the lead is in the rehash
and the calculator is not created then the user moves to the calculator screen on which user inputs
the values and creates the calculator; if the calculator is already created then do not move the user
on the input screen, move on the current logic screen."*

A rehash lead opened on the **locked receipt** unconditionally
(`readOnly={activeTab?.isRolloutConfirmed || lead?.isRehashed === true}`), which is right when the
first visit already scoped the job — the second visit renegotiates the PRICE, and dropping the rep
into the product-entry form invites gutter/LeafFilter edits that silently re-scope the original sale.

But a rehash can arrive with **nothing built**. The appointment a rehash resolves is not the original
one, so `useDynamicCalculators` creates an **empty placeholder calculator** for it — seeded with the
full field list at `inputValue: 0`. Locking that is a dead end: an empty receipt (title `1`, "No items
in this category", COST/PAR/RETAIL `$0`, end price `—` **LOCKED**) with no way to enter the job, and
**nothing for the rollout step to show either** — `visibleCalculators` hides calculators whose title
is still a bare number (`/^\d+$/`), and an unbuilt calculator's derived title is exactly that.

⚠️ **"Is a calculator record present" is NOT the question.** One is always POSTed the moment an
appointment resolves, so that test is true for every lead and answers nothing. The real question is
whether a **job scope** was entered — new **`hasEnteredScope(entries)`** in `utils/scope-signature.ts`,
built on the same `inputValue > 0` rule `scopeSignature`, the Job Summary and the rollout item rows
already use, so "entered" can't come to mean two different things.

New **`src/screens/DynamicDealCenter/utils/rehash-draft-calculators.ts`** holds the rule
(`createRehashDraftLatch` / `latchRehashDrafts` / `releaseRehashDrafts` / `isRehashDraftCalculator`);
`DynamicDealCenterScreen` keeps one `useRef` latch and gates on
`readOnly={!isRehashDraftTab && (activeTab?.isRolloutConfirmed || lead?.isRehashed === true)}`.

- ⚠️ **A draft OUT-RANKS the stored `isRolloutConfirmed`** — which is why the check wraps the whole
  expression instead of sitting beside the rehash arm. A rehash can inherit that flag already `true`
  on a calculator carrying **no dynamic scope at all**: the first sale may have been scoped in the
  **classic** deal center, whose values live in the legacy top-level columns (`wedges`, `gutter5DsE`,
  …) and leave `entries` all-zero, exactly as web's dynamic deal center also shows. That stale
  confirmation is what pinned the rep to the `$0` "Rollout price confirmed" receipt in the ticket
  screenshot, and it protects nothing, because the scope it was made against isn't on screen.
  The first pass at this fix gated on `isRolloutConfirmed || (isRehashed && !draft)` and therefore
  **did not fix that lead at all**.
- **Only a confirm made in THIS session re-locks it**: `onConfirmRollouts` on `RolloutView` is wrapped
  to call `releaseRehashDrafts(latch, ids)` before `handleConfirmRollouts`. Driven by the confirm
  ACTION rather than by re-reading `isRolloutConfirmed`, because a flag that is already `true` on
  arrival cannot mark the transition. The wrapper is inline, not a `useCallback` — `RolloutView` holds
  the prop in a ref, so identity churn is free, and another hook would widen the compromise below.
- ⚠️ **The verdict is LATCHED per calculator on first sight and never re-read from the live entries.**
  Re-deriving flips the calculator to locked on the rep's **first keystroke**, swapping the form out
  from under them mid-entry — the whole reason this isn't a one-line expression.
- **Per calculator id, not once per screen**, which is what keeps **＋** working on a rehash: a newly
  added tab is empty when first seen so it opens editable, while the original scoped calculator stays
  locked. A **duplicated** tab copies the source entries, so it latches as already-scoped — correct,
  it is the same job.
- **Latched during render, not in an effect.** An effect lands one frame late and the rep sees the
  locked receipt flash before the form replaces it. The latch is idempotent, so a repeated or
  discarded render reaches the same verdict. Both sets live in **ONE ref** for the reason on
  `rehashBuild` — every hook in this component sits after the edit-mode early return.
- **Guarded on `!isCalcLoading`.** A tab judged before its saved entries arrive would latch as a draft
  and wrongly unlock a scoped calculator. (`setLoading(false)` is batched with the `setTabs` hydration,
  so by the time it flips, entries are real.)
- **Nothing changes for a non-rehash lead** — the latch is only ever fed on `isRehashed`, so its sets
  stay empty and `readOnly` reduces to `isRolloutConfirmed`, exactly as before.

Downstream needs no change: once values are entered the derived title stops being numeric, so the
calculator appears in the rollout, and `PremiumQuoteCard.priceLocked` is already open on a rehash.

### Rehash "Use Existing" restored nothing after a config rename

Ticket: *"when user click on the existing and this screen is open but the previously uploaded data is
not displayed."* The rehash prompt's **Use Existing** opened the job builder with every field blank,
even though `GET /lead/v1/{leadId}/outcome/{calculatorId}` carries the build under
`jobBuilder.dynamicJobState`.

**Start Fresh was verified correct and unchanged** — driving the real engine over a Gutters config
showed `footage/color/location` → `""` and `scheduleTime` dropped on Start Fresh, versus
`120 / Musket Brown / Rear` + the install window on Use Existing. Only the calculator-driven LOCKED
field survives Start Fresh (`5" Gutter/DS/E = 34`), because it comes from `LFCalculator.entries`, not
from the saved build, and it is the allocation budget the rep distributes.

The defect is in `deserializeDynamicJobStateFromStorage` (`engine/dynamic-job-state-storage.ts`).
Storage keys embed **LABELS**:

| level | stored key | rename that breaks it |
|---|---|---|
| vertical | `${vertical.id}__${slug(vertical.label)}` | product label |
| tab | `buildTabKey(productId, productCategory)` — **no tab id at all** | productId, or the category |
| section | `${section.id}__${slug(section.label)}` | (already recovered) |
| field | `${field.id}__${slug(field.key/label)}` | (already recovered) |

Sections and fields recovered from an index miss via `resolveCanonicalKeyFromStorage` (split on the
`__` marker, keep the canonical id). **Verticals and tabs did not** — they were plain
`index.xFromStorage.get(key) || key`, so a miss filed the ENTIRE vertical/tab under the raw storage
key. Nothing reads that id, so the build sat in memory, fully deserialized, and rendered blank. A
rehash is the most exposed population by definition: its saved build is from the earlier appointment,
so it has had the most time to be re-labelled in the portal.

Now resolved through `resolveVerticalIdFromStorage` / `resolveTabIdFromStorage`:
- **vertical** — exact key, else the id before `__` **if it is a real vertical id in this config**.
- **tab** — exact key, else the id before `__` if it is a real tab id (covers the
  `buildStorageKey(tabId, label)` branch), else the **category slug matched against the tabs of the
  RESOLVED vertical** (covers a changed `productId`, whose key carries no tab id).

⚠️ **Membership is checked against the config, never a string prefix** (`field_`, `section_`, …):
vertical and tab ids share no prefix, and inventing an id that is not in the config would re-file the
state under another unreadable key — the very failure being fixed.

⚠️ **A renamed tab CATEGORY is deliberately NOT recovered.** That key carries neither the tab id nor
any other stable handle, so any match would be a guess, and restoring a build onto the WRONG tab is
worse than restoring nothing. The state stays under its raw key: inert, never misattributed. Tested.

Slug recovery is **scoped to the resolved vertical**, so two products that both have a "Gutters" tab
can never cross-restore.

Verified with 9 tests (`__tests__/utils/dynamic-job-state-storage-restore.test.ts`) round-tripping
through the real serializer: no-rename, product rename, productId change, product+productId+section
renamed together, install date surviving a rename, the tab-category limitation, no cross-restore
between two products sharing a category, an unknown vertical left verbatim, and a legacy raw
(pre-storage-key) save passing through.

⚠️ **This fixes the rename case only.** If a rep's build is still blank, compare the vertical/tab keys
inside `dynamicJobState` against `GET /company/v1/job-builder-products` — if they match exactly, the
cause is elsewhere.

### A full-package calculator tab shows a package icon + ⓘ, not `G+VMax+S+FWrap`

Ticket: *"Inside the deal center when user input the data against the Gutter input fields, sofit fields
and fascia first field name Trim wrap [Fascia] … instead of showing the combinations of the letter …
show the box and the information icon; when user click on it show the provided information. Make sure
it should be change on the runtime."* Follow-up: *"also Leaffilter fields include in this conditions."*

A calculator carrying all four of **Gutter + LeafFilter + Soffit + Trim wrap [Fascia]** now renders a
**package icon** and an **ⓘ** in its footer tab in place of the derived name; the ⓘ opens a card
listing **Gutter / Soffit / FWrap / (Versa OR VMax)**.

- **`isFullPackageSelection(entries, schemas)`** (`utils/tab-naming.ts`) is the rule, and
  **`FULL_PACKAGE_INCLUDES`** is the tooltip copy — same file, so the badge and the list it explains
  cannot drift apart.
- **Matched on TAB KEYS, not field ids.** It runs the same `collectTabKeys` pass that derives the name
  it replaces, so the two can never disagree — a calculator is a package exactly when its name would
  have read `G+<guard>+S+FWrap`. That is asserted directly in the tests. It also means a renamed or
  duplicated field still resolves, since `resolveFieldTabKey` reads the server-authored **label +
  category** (`Trim wrap [Fascia]` → `FWrap` via the Fascia resolver's `/trim\s*wrap/i`).
- **The guard slot is a choice** — `Versa` / `VMax`, plus `Guard` / `SpecGuard`, because
  `resolveGuardCategoryKey` names the same product that way in a micro-mesh catalog; requiring the
  literal Versa keys would silently exclude those companies. ⚠️ `LF Misc` / `GuardMisc` do NOT count:
  those are standalone add-ons (corners, sawzall…), not the guard product.
- **Runtime by construction.** `CalculatorView.tabCalcs` recomputes the flag from each tab's OWN live
  entries, so it appears on the fourth field and disappears when one is cleared — including on tabs the
  rep isn't currently viewing. No stored flag. Tested field-by-field.

⚠️ **The ⓘ sits INSIDE the tab pill**, not floating above it as in the ticket's mock. That row is a
horizontal ScrollView with drag-reorder, and Android clips children drawn outside their parent's
bounds, so an overhanging badge is a coin-flip on whether it renders. For the same reason the popover
is a `Modal` (anchored just above the tab bar) rather than an inline absolutely-positioned card.

`HorizontalDraggableTabs` gained `onShowPackageInfo` and reads `calc.isFullPackage`. **The classic deal
center never sets that flag**, so its tabs are untouched.

Verified with 12 tests (`__tests__/screens/DynamicDealCenter/full-package-tab.test.ts`) over a
gutter-roofline schema: the four-part package, `Versa` in place of `VMax`, each of the four missing in
turn, the field-by-field runtime transition, clearing a value, an add-on not counting as the guard,
`Fascia Board` not counting as the trim wrap, extra products not breaking it, empty/no-schema input,
and a renamed trim-wrap field still resolving by label.

Verified with 24 tests (`__tests__/screens/DynamicDealCenter/rehash-draft-calculators.test.ts`) driving
the real helpers plus the exact `readOnly` expression: the ticket repro (unbuilt rehash → editable)
**both with and without an inherited `isRolloutConfirmed`**, a built rehash still locked, **no re-lock
on first keystroke**, still editable between building and confirming, locked after an in-session
confirm, no retro-unlock when a scoped calculator is cleared (before or after release), ＋ on a scoped
rehash, duplicates, and a normal lead unchanged.

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

**Status: 🟡 calculator + rollout corrected; Job Builder wiring done (core UI + session + API config).**

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

Done (job builder — 2026-07-06):
- **DynamicJobBuilderScreen.tsx rewritten** — now consumes `initialConfig` from the API-backed
  `useDynamicCalculatorSchemas` hook (System B), uses `useDynamicJobBuilderSession` for state
  (config + jobState + lockedTabIds + previewSnapshot), and renders a step-based progress tracker
  (circular numbered pills) matching the legacy JobBuilder UI.
- **DynamicTabRenderer.tsx rewritten** — full field-type support: renders `text`, `number`, `textarea`,
  `toggle`, `optionList`, `swatch`, `locationGrid`, `roomPicker`, `sectionLabel`, `allocation`
  (via `AllocatorBar`), `locked` (via `LockedField`/`LockedFieldWithColor`), combination sections
  (add/remove combos + `GrandTotalCard`), simple sections, and summary tabs (via `VerticalSummaryTab`).
  Uses all existing widgets from `src/widgets/components/dynamic-job-builder/`.
- **Data flow wired** — `DynamicDealCenterScreen` passes `jobBuilderConfig` (from `useDynamicCalculatorSchemas`)
  as `initialConfig` and the result modal's `onConfirm` payload as `calculatorResultData` into the job
  builder screen. `onJobComplete` resets navigation to LeadCenter.
- **Auto-save** — 2-second debounced `PUT lead/v1/{leadId}/outcome` (matching legacy behaviour).
- **Activity logging** — `job_builder_opened` on mount, `job_builder_completed` on finalize submission.

Still pending (deferred — advanced features):
- The outcome modal now captures the full regular field set (one-leg / demo reason + explain /
  contract / down / balance / payment methods / versatile / pineapple) in its `onConfirm` payload, but
  the backend wiring to **persist** those extra fields (web `handleFinishOutcome`) is not done yet.
- The template fallback remains in `useCalculatorSchema` for offline / not-yet-configured companies;
  once the manager configures the deal center, `isConfigured` flips true and the real schema is used.
- `useDealPricing`'s two endpoints (`/payment-plans/v1/sales/provider-plans`,
  `/company/v1/discount-config/sales`) are ported from the web but **not yet runtime-verified** on the
  mobile demo API.
- Appointment scheduling modal and document scanning/signature modals exist but are not yet integrated
  into the dynamic job builder summary step.
- Web pull (2026-07-02) added job-builder engine work that the mobile could still mirror: allocation
  visibility/exclusion, toggle-deselect + field validation, default-combo pruning before state storage,
  and appointment-required-before-finalize (web commits `8ddaaa7`, `102fa4e`, `5c24a8f`, `9a833e7`,
  `08643b7`).

---

## 6. Key gotchas

- **Redux is auth-only** — everything else is TanStack Query + hooks + MMKV.
- **Two map stacks** — keep `react-native-maps` (Google, lead/job maps) vs `@rnmapbox/maps` (Zone Canvasser) straight.
- **Hardcoded demo API URL** in `src/config/env.ts` (§3).
- **Dynamic Job Builder engine runs on the JS thread** — web offloads the same compute to web workers; watch performance on large schemas.
- **`Image.prefetch` does NOT work on our photo URLs.** They are pre-signed S3 links with no cache
  headers, so the OS image cache refuses to store them: a thumbnail can be on screen and a
  full-size decode of the *same* url still misses and re-downloads. Anything that needs an image to
  appear instantly must go through the local-FILE cache (`src/utils/imageFileCache.ts`) and render
  `file://…`. See "Hold-to-peek previews" below.
- **Largest files** (respect when editing): `src/widgets/components/dealcenter/CalculatorSummary.tsx` (~2,298),
  `src/widgets/components/job-builder/SummarySection.tsx` (~1,993), `src/screens/JobBuilder/index.tsx` (~1,730).
- Web is the **source of truth** for feature behavior; when unsure how a flow should work, check the web ref path in §4.

### Hold-to-peek previews warm through a shared local-file cache

Ticket: *"Render hold-preview takes 2–3s blank"* — first reported on the RevRender rollout slots,
then again by QA on **Manage Photos**, **revRender ▸ Select a photo** and **Configure Render**.

Cause is the `Image.prefetch` gotcha above: holding a thumbnail opens an enlarged preview, whose
full-size decode misses the OS cache and re-downloads the S3 object, so the peek sits blank.

- **`src/utils/imageFileCache.ts` (new)** — the cache primitives (`getLocalCachePath`,
  `downloadImage`, `prefetchToLocalCache`) **moved here** from
  `widgets/modals/lead-center/RevRenderHistoryModal.tsx`, which now imports and **re-exports**
  `getLocalCachePath` / `prefetchToLocalCache` so its existing callers (`RevRenderSlots`,
  `OperationalSections`) are unaffected. The move exists so a leaf widget can warm images without
  importing a heavy modal screen. Added: **`isRemoteImageUrl`** (only http(s) is worth caching) and
  **`warmToLocalCache(url)`** → resolves the `file://` uri, or `null` so callers fall back to the
  network url.
- **Concurrency is capped at 3** (`MAX_CONCURRENT_WARMS` + a small semaphore). A photo grid can
  mount 20+ thumbnails at once (Manage Photos ▸ Roofline is 0/22); warming them all in parallel
  would saturate the connection and make the *visible* thumbnails slower — the opposite of the goal.
- **Warming lives in `PhotoPeekPressable` itself** (`usePeekCachedUri`), NOT in each screen, so every
  consumer gets it and no new one can forget it — that is what fixes all three screens QA reported
  at once. The preview renders `cachedUri || uri`, so it is never worse than before, and the
  `Animated.Image` is **keyed on the uri** so swapping network→file remounts instead of leaving the
  stale decode up.
- `RevRenderSlots.tsx` keeps its own bespoke warm block. It is now **redundant** (the download layer
  dedupes by cache path, so there is no double fetch) but harmless — it warms slightly earlier, at
  list mount rather than thumbnail mount. `RevRender/index.tsx`'s `Image.prefetch` block is left
  alone too: it targets the `HouseImage` thumbnails, not the peek.

Verified with `react-native-blob-util` mocked: signature-stripping, the **basename-collision**
guard, the cached-hit path making **zero** network calls, failure → `null`, non-remote skip,
concurrent callers **sharing one GET**, and the **≤3 in-flight** cap. (The repo has **no global
mock** for `react-native-blob-util` — that is why the two `DynamicDealCenter` suites which import it
fail under jest; anything testing this module must mock it locally.)

### Inspection photos were invisible in the Pitchbook / Roofline Deck

Ticket: *"images are not showing in inspection like web"* (`src/screens/Pitchbook/index.tsx`). The
tool drawer's **Inspection** tab rendered the "Property Inspection Photos" heading over **blank
space** — no photos, and not even the empty state.

Both screens matched photos against the **static** `IMAGE_CATEGORIES` list:

```ts
IMAGE_CATEGORIES.filter((s) => secureImages[s.name]?.length > 0)   // ← the bug
```

`useSecureUrls` keys its map by the photo's **raw `category`**, and the dynamic capture flow scopes
that per product — `useDynamicInspectionCapture.scopeCat` stores
`` `${productKey} — ${label}` ``, e.g. **`"Gutters/Roofline — HOME"`**. The static list only holds
`Home` / `Inspection` / `Measurements` / `Miscellaneous`, so **nothing matched** and every
dynamically-captured photo was invisible. Only the legacy flow (`JobDocsSection` / `TagPhotoModal`,
which pass a bare `section.name`) ever rendered.

⚠️ The empty state didn't fire either: it tested `Object.keys(secureImages).length === 0`, which is
**false** — the map was full, just under a key nothing looked up. That is why the tab looked broken
rather than empty.

Fixed the way web does it (`src/sections/pitch-book/components/pb-inspection-photos.js`): **derive
sections from each photo's own category, never from a fixed list.** Split across a pure
**`src/utils/inspection-photos.ts`** (grouping) and **`src/widgets/components/InspectionPhotosPanel.tsx`**
(rendering) — the split is deliberate: the panel imports `PhotoPeekPressable`, which pulls in
**reanimated**, and the repo has no reanimated mock, so anything importing the panel is **untestable
under jest**. Keep new logic in the util.

- **`sectionFromCategory(category)`** handles both storage formats — splits on the **em dash** for
  `"{product} — {TAB}"` → `Home`, else takes the name as-is. The **full** category string is the
  section id, so two products that both have a `HOME` tab stay separate accordions instead of merging.
- **`prettify`** title-cases the all-caps tab name, leaving already-cased legacy names
  (`"Roofline Observation"`) intact.
- **Deleted (`deletedAt`) and annotated photos are dropped**, which mobile never did — annotated
  copies belong to the annotation surface and were duplicating the originals here.
- **`buildInspectionSections(photos, secureImages)`** re-groups from the **raw `salesPhotos`** records
  (they carry category / subcategory / deletedAt / timestamp) and uses `secureImages` only as a
  flattened `s3url → signed url` lookup, falling back to `photo.secureUrl`. A photo with no
  resolvable url is skipped rather than rendering a blank tile.
- The count chip is now web's **"N photos"**. The old "N of M complete" derived M from the static
  category's `subCategories`, which a dynamically-captured section does not have.

**Both screens were byte-identical copies of this block**, so `Pitchbook` and `RooflineDeck` now
render the shared panel (each dropped its own `expandedCat` state and its `IMAGE_CATEGORIES` import;
the panel owns the accordion and takes an `onPreview` callback, since the preview `Modal` stays on the
parent). RooflineDeck was **not named in the ticket** but had the exact same defect — fixing only the
reported screen would have left it broken.

⚠️ **`useSecureUrls` was deliberately NOT changed.** Five call sites depend on its
category-keyed shape (`RooflineDeck`, `InvestmentPanel`, `LeadImagePickerModal`,
`DynamicManagePhotosView`, `Pitchbook`); the grouping is wrong only for *this* use, so it is undone
locally rather than by reshaping a shared hook.

⚠️ One deliberate divergence from web: web renders **one card per subcategory slot** with a `+N`
badge. Mobile renders **every** photo instead, so nothing hides behind a badge. Photos are still
grouped by slot (oldest first within a slot) so repeat shots sit together.

#### Card design + instant preview (follow-up on the same ticket)

Follow-up: *"set the design like web and image show instantly while we press like we set in rev
render."*

**Design** now mirrors web's `ImageCard`: the group is one **white elevated card** holding both header
and grid (was a grey `#F4F6F8` bar with the photos loose underneath); tiles are **two per row**
(web `xs={6}`) at a **4/3** crop with a 2px border (were three per row, square); an **eye badge**
sits top-left; and the caption bar carries the subcategory on the left with the **capture time**
(`01:05 PM`) on the right. The time comes from `formatCaptureTime`, written **by hand rather than via
`toLocaleTimeString('en-US', …)`** (what web uses) so it cannot depend on Intl being compiled into the
JS engine.

⚠️ The grid uses `justifyContent: 'space-between'` with `width: '48%'`, **not** a pixel `gap` — two 48%
columns plus a fixed gap can exceed 100% on a narrow drawer and wrap to one card per row.

**Instant preview** reuses the existing revRender machinery rather than re-solving it: each tile is a
**`PhotoPeekPressable`**, so hold-to-peek warms a local `file://` copy through `imageFileCache` and the
enlarged image opens instantly instead of blanking for 2–3 s (see "Hold-to-peek previews" above for
why `Image.prefetch` cannot do this).

- **`PhotoPeekPressable.onPress` now receives the warmed uri** (`(peekUri?: string | null) => void`).
  The panel passes it straight to `onPreview`, so the parent's **tap** preview `Modal` renders the
  cached file too — previously only the hold-peek benefited. Backwards compatible: a `() => void`
  handler is assignable, so the other four call sites are untouched.
- Both drawers now wrap their tool `ScrollView` in **`PhotoPeekScrollLockProvider`** and use
  **`PeekAwareScrollView`** (the same pairing RevRender/RolloutView use). Without it a stray drag
  during the hold scrolls the list, steals the touch and dismisses the peek mid-hold.

Verified additionally: the caption time across noon/midnight/single-digit hours and degrading to `''`
for missing or unparseable timestamps.

#### Card shadow + a pageable viewer (second follow-up)

Follow-up: *"add shadow on card like this also add slide left right option like web."*

**The shadow was already written and simply not rendering.** The group card carried both the shadow
and `overflow-hidden` on the SAME view, and **iOS clips a shadow when the view sets
`overflow: hidden`**. Now two nested Views: shadow on the outer wrapper, rounding/clipping on the
inner one. (Opacity/radius also raised to 0.16 / 10 with `elevation: 4` so it reads on Android.)

**New `InspectionPhotoViewer`** replaces the single-image preview with web's lightbox behaviour:
swipe or tap the chevrons to move through a section's photos, with the `"{Section} - {Subcategory}"`
title, the capture time, an **`n / total`** counter and a tappable **thumbnail strip** that keeps the
active thumb scrolled into view. A horizontal `FlatList` with `pagingEnabled` does the paging;
`getItemLayout` is **required** for `initialScrollIndex`/`scrollToIndex` to work on it.

- **The viewer lives INSIDE the panel, and that removed a duplicate.** Each screen previously carried
  **two identical** preview `Modal`s gated on `isFullscreen`, because the pitchbook renders its tool
  drawer either inside a fullscreen `Modal` or outside it. A `Modal` rendered from the panel nests
  correctly in **both** cases automatically, so the panel's `onPreview` prop and both screens'
  `previewImage` state + **four** dead modals are gone.
- **`useWarmedUris`** warms every photo of the open section through `imageFileCache`, so paging paints
  from `file://` instead of re-fetching a pre-signed S3 object per slide. It keys its effect on the
  **joined url string**, not the array identity — a fresh array each render would restart every
  download on every render. Downloads dedupe by cache path, so overlapping with the thumbnails' own
  warming costs nothing.

⚠️ RN has no `translateY(-50%)`: the chevrons use `top: '50%'` **plus `marginTop: -22`** (half their
height), otherwise their top edge — not their centre — sits on the midline.

⚠️ This supersedes the earlier note that mobile "cannot page a slot". It can now; the reason mobile
still renders every photo rather than web's one-card-per-slot `+N` is simply that nothing should hide
behind a badge.

Verified against both storage formats: the ticket's `"Gutters/Roofline — HOME"` case (with the old
static filter asserted to match **nothing**, and `secureImages` asserted non-empty to show why the
empty state stayed hidden), legacy bare categories, an already-cased legacy name, two products sharing
a tab name, `deletedAt` and both annotated forms excluded, the `secureUrl` fallback, an unresolvable
photo skipped, slot grouping/ordering, empty input → empty state, and a category-less photo landing in
`Other`.

### Chat: the lead header photo had no preview, and message photos opened slowly

Ticket: *"Sales app - messages - should let me preview photo / image should open instantly like re
render and inspection photo"*, circling the **lead thumbnail in the chat header**.

Two separate gaps behind one sentence:

**1. The header thumbnail was inert.** `LeadHeaderThumbnail` (`widgets/components/chat/ChatHeader.tsx`)
rendered a bare `<Image>` with **no press handling at all** — there was no way to open it. It is now a
**`PhotoPeekPressable`**: HOLD peeks it enlarged (instant, warmed to a local `file://`), and a TAP
opens the same **`ImageGalleryModal`** the chat's image messages already use, so the two surfaces
behave alike. The tap gets its uri from `PhotoPeekPressable`'s **`onPress(peekUri)`** — added for the
inspection grid — so the gallery opens on the warmed file rather than re-fetching. The
home-outline placeholder branch is untouched: nothing to preview, nothing to press.

**2. Message photos already had a viewer, but it wasn't instant.** `ImageGalleryModal` rendered raw
urls with `cache: 'force-cache'`, which **buys nothing** on our pre-signed S3 links (no cache headers —
see "Hold-to-peek previews" above). It now resolves through the local-file cache, in both the pager and
the filmstrip.

⚠️ The gallery warms **only while `visible`**. It is mounted per message bubble, so warming on mount
would download every attachment in the thread on open.

The warming hook is now shared: **`src/hooks/useWarmedImageUris.ts`** (`{ [url]: fileUri }`, filling in
as downloads land), used by `ImageGalleryModal` and `InspectionPhotosPanel`. It was written for the
inspection viewer last ticket and moved out rather than copied on the second consumer. It keys its
effect on the **joined url string**, not the array identity — callers build the array inline, so
depending on identity would restart every download on every render.

⚠️ Reach for this hook (or `PhotoPeekPressable`, which warms its own) for **any** new full-size photo
view. `Image.prefetch` and `cache: 'force-cache'` do not work on these urls — that is the standing
gotcha in §6, and this ticket is the third surface to hit it.

Not changed: chat image **messages** were already previewable via `ImageGalleryModal` from
`ChatMessageBubble`, so only their speed needed fixing.

---

## 7. Scripts

```
yarn ios / yarn android    # run
yarn start                 # Metro
yarn lint                  # eslint
yarn test                  # jest
```
