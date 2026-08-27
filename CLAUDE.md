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

### My Deals detail IS the Lead Center screen (ticket: "My deals should match resulted lead page")

Tapping a deal in **My Deals** no longer opens a separate deal screen — it opens the **same
Lead Center screen a sold lead opens**, so the two entry points are pixel-identical (lead info
block, **Job docs / Map / Tools**, the green `SALE - LEAD RESULTED` `ContractDetailsCard` with
its price rows + Agreement / Order Sheets / Down Payment Receipt sections and **Add Document**,
and **Msg Ops/IM**). Only the *edit* behaviour differs, and no result buttons are involved.

- **Entry point**: `MyDeals.openDeal` navigates to **`LeadCenter` with `{ lead, fromMyDeals: true }`**
  (was `DealDetail`). `fromMyDeals?: boolean` was added to the `LeadCenter` params in
  `RootStackParamList` (`src/navigation/index.tsx`).
- **The pencil opens the 4-step deal-edit wizard.** `JobDocsSection` has an optional
  **`onEditContract?: () => void`** prop that overrides `ContractDetailsCard`'s `setShowEditModal`;
  `LeadCenter` passes `onEditContract={isDynamicDeal ? handleEditDeal : undefined}`, and
  `handleEditDeal` navigates to `DynamicDealCenter` with
  `{ lead, mode:'edit', calculatorResultData: { calculatorId, appointmentId } }` (multi-shape id
  resolution, ported from the old `DealDetail.onEdit`). See "The Contract Details pencil opens the
  deal-edit wizard on BOTH entry points" below — it is **no longer gated on `fromMyDeals`**.
- **Header title is entry-aware**: `{fromMyDeals ? 'Deal' : 'Lead Center'}` (`LeadCenter/index.tsx`).
- **My Deals shows the global `MainHeader`** (added to the `showHeader` list in
  `navigation/index.tsx`) so its frame matches the screen it navigates into. Because the
  navigator's outer `SafeAreaView` already applies the **top** inset when the header shows,
  `MyDeals`' own `SafeAreaView` was switched to **`edges={['bottom','left','right']}`** — matching
  Lead Center. Leaving it on the default (all edges) double-pads the title bar.
- **`src/screens/DealDetail/` is now UNREACHABLE** (nothing navigates to it) but is still
  registered in the stack. Its **Addendums list** (tap an approved addendum → signed PDF via
  `getDraftAmendmentPdf`, plus the `DraftComparison` diff) has **no equivalent on the Lead Center
  screen**. ✅ **BOTH halves of that gap are now CLOSED** — the pending-signature status in
  "The Deal screen's pending-signature status" below, and the addendums LIST itself in the
  follow-up right after it. The only piece still missing is `DealDetail`'s `DraftComparison`
  drill-in: on the Lead Center a PENDING addendum warns rather than opening its changes.

### The Deal screen's pending-signature status — ONE amber header, back to green on approval

Ticket: *"after submitting status should be show like this, in mobile this thing is missing"* (a web
screenshot of an amber **PENDING ADDENDUM - AWAITING CUSTOMER SIGNATURE** bar; mobile showed nothing
after submitting an addendum), then the design correction: *"a bit change in the design of the status,
it should be like above, and once the user approved it will come back to the same green"*.

**Final design (the rep's answer to a direct question, not an inference): the Contract Details card
header IS the deal's single pending indicator.** Amber
`SALE - PENDING CUSTOMER SIGNATURE` / *Awaiting Amendment Approval: • Contract Pricing* while a
signature is outstanding, flipping to the green `✓ <STATUS> - LEAD RESULTED` the moment the customer
approves. No second bar.

#### What actually drives it

`ContractDetailsCard`'s `showPendingDraft` now has **two** sources, either of which shows amber:

| # | source | written by |
|---|---|---|
| 1 | `leadDraft` — `GET lead/v1/{id}/draft`, **plus its `showStatus` gate** | ONLY an **EditContractDetails** save (`upsertLeadDraft` has exactly one caller) |
| 2 | `hasPendingAddendum` — a pending row in `GET lead/v1/{id}/job-builder-drafts` | the **My Deals deal-edit wizard** (addendums) |

Source 2 is new and is the whole bug: **the wizard never writes a `leadDraft`**, so before this the
header stayed GREEN after submitting an addendum while the addendums list directly below it read
`Pending` — two elements on one screen disagreeing about the same deal.

⚠️ **The addendum arm must NOT inherit the `showStatus` gate.** That flag belongs to the
contract-edit draft shape; a job-builder draft does not carry it, so requiring it would make the whole
branch permanently dead and silently restore the bug. Tested.

#### `DealBanners` is now the CANCELLED bar only — a deliberate divergence from web

`src/widgets/components/LeadCenter/DealBanners.tsx` began as a faithful port of web
`src/sections/deal/components/deal-banners.js` (rendered from `job-capture-images-view.js` gated on
`isDeal`; `lead-center-tabs.js` places it *"under the tab bar and above every tab"*, which is why mobile
renders it after the **Job docs / Map / Tools** row and OUTSIDE the tab switch, gated on `fromMyDeals`).

⚠️ **Web's pending-addendum bar is deliberately NOT rendered.** Web shows two independent indicators for
one fact — that bar AND the card's own amber header — and on a phone the two sat within half a screen of
each other saying the same thing. Do not "restore parity" here; it was removed on request.

The **JOB CANCELLED** bar stays: nothing else on the screen reports it, and a cancelled deal would
otherwise still show a green *LEAD RESULTED* header.

#### Draft status predicates live in `src/utils/addendum-drafts.ts`

`isDraftApproved` / `isPendingDraft` / `countPendingDrafts` / `hasPendingDraft` — pure and RN-free, for
the reason `utils/inspection-photos.ts` and `utils/job-change-summary.ts` exist: all three consumers
(`AddendumsCard`, `DealBanners`, `JobDocsSection`) pull in React Native and are untestable under jest
here. Keeping the rules in one file is also what stops "pending" meaning two different things on two
surfaces of the same screen.

- **One fetch, shared.** `LeadCenter` holds the single `useQuery` and passes `drafts` down; nothing
  re-fetches. Mirrors web's shared `useJobBuilderDrafts`.
- **The focus effect invalidates it.** Submitting an addendum CREATES the draft and the rep returns here
  straight from the wizard — without the invalidate the header would only turn amber after leaving and
  re-opening the deal. (Web solves the same problem with that hook's `refetch`.)
- **A failed fetch returns `[]`, not an error state** (web: *"Addendums are supplementary; a failure must
  not affect the page"*), so it degrades to a green header rather than breaking the Deal screen.

Verified against the exact `showPendingDraft` expression: a pending addendum turning the header amber
**with no `leadDraft` at all**, approval (`accepted`/`signed`) returning it to green, a declined
addendum reading green, one-approved-plus-one-pending staying amber, the `showStatus` gate still
suppressing the EditContractDetails arm (and still honouring the stringy `'true'`), the addendum arm
NOT inheriting that gate, both-pending, and null/undefined input as green. tsc 44 (baseline unchanged);
`utils/addendum-drafts.ts` is eslint-clean, and `LeadCenter/index.tsx` + `JobDocsSection.tsx` together
are byte-identical to their HEAD baseline (79 problems: 26 errors / 53 warnings, all pre-existing).

#### …and the Addendums list, in web's exact slot

Follow-up, same screen: *"you also have to show this like web in the deal center"* — a web screenshot
of an **Addendum (1)** card holding a `Pending` chip, `Addendum #1`, its date and a chevron, plus the
toast *"The addendum PDF is available once the customer approves it"* from tapping that pending row.

**New `src/widgets/components/LeadCenter/AddendumsCard.tsx`** — a port of web
`src/sections/deal/components/addendums-card.js`. Title `Addendum{s} (N)`; each row is
`StatusChip · Addendum #N · MM/dd/yyyy` with a right-hand **`file-pdf-box`** when approved and a
**`chevron-right`** otherwise. Returns `null` with no addendums.

**Placement is web's, not "at the end".** Web threads it as `docsExtras` into `job-docs-tab.js`, which
renders it between the **contract card** and the **`N/M slots • N photos`** progress row — exactly
where the screenshot shows it, above `Start Taking Photos`. Mobile renders it in the same slot inside
`JobDocsSection`, so it is INSIDE the Job docs tab, not a sibling of it.

⚠️ **The drafts query is no longer gated on `fromMyDeals`** (it was, one ticket ago, when the banners
were the only consumer). Web's own note at the call site: *"The addendums list renders on both routes;
it is null when the lead has none, so it costs the Lead Center nothing when there are no addendums."*
**Only the BANNERS stay deal-only.** One `useQuery` in `LeadCenter` feeds both, mirroring web's shared
`useJobBuilderDrafts` — `drafts` is passed down to `JobDocsSection` rather than re-fetched, so the two
surfaces can never disagree and there is still exactly one request.

**Tap behaviour is web's, including the dead end.** Approved → `getDraftAmendmentPdf` → the app's PDF
viewer via the existing `onOpenPdf`. Anything else → the warning flash in the screenshot. Two pure
exports carry the decisions so the guards are testable — `isDraftApproved` and
**`resolveAddendumTap(draft, pdfLoadingDraftId)` → `'ignore' | 'not-approved' | 'open-pdf'`**:

- ⚠️ **The in-flight guard OUTRANKS the approval check**, deliberately. `/amendment-pdf` **generates**
  the document on demand, so a second tap is a second Puppeteer run, a second S3 upload and two
  `amendment` documents for one addendum. Reversing the order would let a pending row toast mid-build.
- While one is building, that row reads **"Preparing PDF…"** with a spinner and a green border and
  **the other rows dim to 0.6** — web's behaviour, so the others read as unavailable rather than
  silently swallowing a tap. The first open of an addendum approved before this feature existed
  genuinely builds the PDF and takes a few seconds, which is why the row says so instead of just spinning.

⚠️ **Mobile deliberately does NOT open the change comparison for a pending addendum here**, though it
could: the unreachable `screens/DealDetail` did that, and `widgets/components/chat/JobChangeDetailsModal`
already implements it (before/after + the approved→PDF hand-off, with the 409 fallback). Web's toast is a
dead end and was ported as-is because the ticket asked for web's behaviour; wiring that modal to the
`'not-approved'` branch is a one-line change if reps want to read a pending addendum from the deal.

Verified: `isDraftApproved` across all three approved spellings (case-insensitive) and rejecting
pending/declined/missing; the chip's four known labels plus an unknown status shown verbatim and the
`Draft` fallback, each with both colours; and every `resolveAddendumTap` branch — approved→PDF,
pending/declined→warn, **a second tap ignored even on an approved row**, a mid-build pending tap ignored
(guard ordering), and an id-less draft inert. tsc 44 (baseline unchanged); both new files are eslint
error-free and `JobDocsSection.tsx` is byte-identical to its HEAD baseline (10 errors / 29 warnings).


### Result Lead ▸ Reset was missing "Not Home", and a reset lead showed no contract card at all

Ticket: *"Result lead - reset - add 'Not Home' like web; and after reset 'No contract details
available' card should also be show like this."* Two unrelated one-liners on the same flow.

**1. The reason list.** `REASONS_MAP.reset` in `widgets/modals/lead-center/ResultLeadModal.tsx` held
`['No Time', 'Leaving']`; web `job-capture-images-sections/result-lead-drawer.js` has
**`['Not Home', 'No Time', 'Leaving']`** — and `Not Home` is FIRST, being the commonest reset reason, so
reps were filing a door nobody answered as `No Time`. The other two lists (`noDemo`, `notHit`) were
already verbatim matches; only this one had drifted.

**2. The empty contract card.** Web `sections/job/components/contract-details.js` splits TWO cases that
mobile collapsed into a single `return null`:

```js
if (!isResulted) return;                 // scheduled / self-gen — no outcome yet
if (!hasDetails) return <EmptyCard/>;    // resulted, but not a sale/demo
```

`ContractDetailsCard` guarded on `if (!isResulted || !hasContract) return null`, so after a **Reset**
(or No Demo / Not Hit / Cancelled) the card vanished entirely and left a silent gap where it had been.
It now renders web's placeholder — a centred `file-document-remove-outline` at 48px over
**"No contract details available"**.

⚠️ **The two flags were already correct and needed no change** — `isResulted` (`JobDocsSection`) accepts
`reset`/`nothome`/`nothit`/`nodemo`/`cancelled`/`rescheduled` alongside sale/demo, while `hasContract` is
`sale`/`demo`/`demonosale` only. So `isResulted && !hasContract` was already exactly web's `!hasDetails`
branch; the card simply never rendered it. Don't "fix" this by widening `hasContract` — that would put a
$0 contract card on every reset lead.

⚠️ The empty state deliberately carries **no Add Document action** (web's doesn't either): a lead with no
contract has nothing to attach documents to, and the Job Docs tab's own photo/Manage Photos actions below
it are unaffected.

### The first calculator IS the customer — stored title, tab label and activity logs

Ticket: *"by default if we open deal center first tab name should be first name and last name like
web"*, then the correction: *"while we are opening calculator first time with new lead
`calculatorTitle` is going one, it should be the user name like we set in the tab… i also notice while
new calculator is going to create title name is also going to same, which should be the user name.
**remember first calculator should always be a customer name.** it's working fine on web app."*
The `calculator viewed` log read `"calculatorTitle": "1"` while the tab below it read **test mon**.

> ⚠️ **This SUPERSEDES the first pass at this ticket, which was display-only and rested on a wrong
> reading of web. Two claims made there were false:**
>
> 1. *"web **never POSTs** a calculator — the backend creates the appointment's first one already
>    titled with the customer."* It does POST it. `job-capture-images-view.js` (the **Dynamic Deal
>    Center** tool handler mobile's bootstrap mirrors) sends `{ title: customerTitle, price: 0 }` on
>    **both** arms — appointment-exists-but-has-no-calculator, and appointment-just-created. The
>    original `grep` missed it because web calls the `addLfCalculator` **api helper**, never the
>    literal `lfcalculators` path.
> 2. *"⚠️ DISPLAY ONLY — do not write this into `title`… naming the calculator would put every
>    untouched calculator into the rollout as a priceable line."* Only the **first** calculator is
>    named; web's `+` button (`tab-action-utils.addTab`) still uses `String(length + 1)`. So exactly
>    one empty calculator is ever visible in the rollout — which is **web's own behaviour**, since
>    `ViewAllCalculators.visibleCalculators` runs the same `/^\d+$/` filter over the same data.

**The title is now stored, not painted on.** Three pieces, each a straight port:

| | web | mobile (now) |
|---|---|---|
| first calculator's title | `customerTitle` = `` `${firstName} ${lastName}`.trim() `` | `customerNameOf(lead) \|\| '1'` |
| `+` / duplicate | `String(length + 1)` | unchanged — `String(tabs.length + 1)` |
| empty-calculator name | `… \|\| calc.title \|\| String(calc._id)` | `… \|\| storedTitle \|\| String(i + 1)` |

- **`useDynamicCalculators`' bootstrap create** passes the customer's name instead of `'1'`. New
  **`customerNameOf(lead)`** is web's `customerTitle` verbatim — first + last, trimmed, **no
  fallback**; the existing `customerTitleOf` (which falls back to `'Lead'`) is now a wrapper around
  it and stays on the APPOINTMENT title only. ⚠️ Keep them apart: `'Lead'` is a fine appointment
  name and would be read as a *calculator's* name. An unnamed lead therefore keeps `'1'` — a blank
  tab beats a wrong one, and `/^\d+$/` still hides it from the rollout.
- **`computeDerivedTitles` (`utils/tab-naming.ts`) gained a `storedTitle` fallback**, and this is the
  half without which the create change does nothing: the old code went straight to `String(i + 1)`
  when no values were entered, so the **first `retitle` pass renamed `test mon` back to `1`** in
  memory and the tab rendered blank again. Web's chain is
  `getLiveSchemaBaseName(...) || getSchemaCalculatorBaseName(...) || calc.title || String(calc._id)`;
  mobile now matches it. All three call sites (`retitle`, `resolveSafeTitle`,
  `saveDisplacedSiblings`) pass `storedTitle: t.title`.
- **Both activity logs follow for free.** `calculator viewed` sends `calculatorTitle: active.title`
  and the bootstrap `calculator created` sends `created.title`, so naming the calculator at the
  source fixes the portal without touching either log — which is exactly how web gets it
  (`DealCenterContext` logs `details.title`; `job-capture-images-view` logs `response?.data?.title`).

**Entered values still win.** `G+LF` / `(SM)` / the ⚠️ duplicate-price warning / the 📦 package badge
all derive from entries and outrank the stored name, so the customer's name only ever shows while the
calculator is empty. A manual rename still outranks everything.

⚠️ **`CalculatorView.tabCalcs`' `customerTabName` fallback is KEPT, and is now purely LEGACY.** A
first calculator created from here on is stored under the customer's name, so its title is not numeric
and that branch is never reached. Every lead whose calculator was created *before* this fix is still
stored as `"1"`, and without the fallback those deal centers reopen on the unlabelled pill they always
had. It is still tab-0-only, for the original reason: several empty calculators all reading the same
customer name would be worse than blank.

Verified by driving the real `computeDerivedTitles`: the ticket repro (empty first calculator → the
customer's name, where the pre-fix path gives `1`), an unnamed lead and a whitespace-only title still
falling back to the placeholder, entered values deriving `G` over the stored name, a manual rename
outranking both, a second/third empty tab staying numeric — asserted through the rollout's own
`/^\d+$/` filter so only the first is visible — and the `(SM)`/`(LG)` and `⚠️ G ⚠️` collision paths
unchanged. tsc 44 (baseline unchanged); all three touched files byte-identical to their HEAD eslint
baselines (`tab-naming.ts` and `useDynamicCalculators.ts` clean, `CalculatorView.tsx` 118 problems /
3 errors / 115 warnings).

### "Send Addendum To" now blocks Submit on an incomplete phone number

Ticket: *"add the validation for number, don't allow me submit addendum if phone number is below then
10 numbers, like we set before."* The Review step's phone field took any length, so a rep could submit
an addendum whose SMS had nowhere to land — the draft then sits `pending` forever, because the customer
is never asked to sign.

`customerPhoneError` follows the same shape as this screen's existing `contractPriceError` /
`downPaymentError`: red border, message under the field, and the **Submit Addendum** button disabled.

⚠️ **TEN digits here, not the ELEVEN Add New Lead and Edit Customer count.** Those two format through
`formatUSPhoneNumber`, which emits its own `+1 ` prefix, so a complete value strips to 11. This field
renders a **static `+1` label** beside the input and holds the LOCAL part only
(`formatLocalUSPhone`, `maxLength={12}` = 10 digits + 2 dashes) — counting 11 here would reject every
valid number.

⚠️ **The phone gates SUBMIT only, never `Next · Review` on step 2.** The field lives on step 3, so
gating Next would leave the rep on a screen with a dead button and nothing on it explaining why.

**Empty and incomplete are separate messages** — *"Phone number is required to send the addendum."*
vs *"Enter a complete 10-digit phone number."* — matching the Edit Customer treatment. An empty field
is a real case: the seed comes from `lead.customerDetails.phone`, so blank means the lead carries no
number at all, and the submit payload's fallback to that same field is blank too.

Verified with 9 tests driving the real `formatLocalUSPhone` / `toE164USPhone`: every partial length 1–9
blocked and ten accepted; the 10-vs-11 distinction asserted directly; all five stored shapes (raw,
E.164, `1`-prefixed, parens, dashed) seeding to a passing value; a phone-less lead reading *required*
rather than *incomplete*; a genuinely short stored number caught instead of silently sent; and the
passing value converting to `+1XXXXXXXXXX` for the provider. tsc 44 (baseline unchanged); eslint
0 errors, 137 warnings vs a HEAD baseline of 136 — the one added is `react-native/no-inline-styles` on
the new error `Text`, the rule this file already carries 136 of.

⚠️ Noted while testing: `formatLocalUSPhone` keeps the **LAST** ten digits when handed more (documented
behaviour — it is what makes `+1…` / `1…` / already-formatted input normalise). So over-long input
yields a *different* ten digits rather than a truncation of the first ten. `maxLength={12}` keeps it
unreachable by typing; do not "fix" the formatter to slice from the front, or every E.164 seed breaks.

### Addendum Review diffs a locationGrid CELL BY CELL, not by its total

Ticket: *"I also notice this when i change in 3rd story — see I added 33, it's showing the summed-up
value in Addendum Review. It should be like what I changed. Example: `Lighting · Location · 3rd Story`
and behind it `33`."* The rep added **33** to Left Side / 3rd Story and the review read
**`Lighting · Location  110 → 143`**.

Both numbers were true and the row was still useless — **an addendum is read as "the original agreement
PLUS what we added here and MINUS what we removed"**, so restating two totals leaves the customer to
subtract, and (the reporter's original soffit complaint) invites reading a survivor's total as an
addition. The review has to name what the rep touched.

Cause is one line of `displayValue` in `dynamic-deal-diff.ts`: an object-valued field returned
`gridTotal(v)`, so a whole 6×3 grid collapsed to a single number before the diff ever ran.

**`readValues` now expands a grid into ONE ENTRY PER CELL**, keyed
`` `${fieldId}${CELL_SEP}${rowKey}${CELL_SEP}${colKey}` ``, and the existing diff machinery compares
cells with no further change. A row reads
**`Lighting · Location · Left Side · 3rd Story   — → 33`**.

- ⚠️ **`CELL_SEP` is U+0002 and must be written as the ESCAPE SEQUENCE** (``), never a raw
  control byte — same rule as `SCOPE_SEP`: a literal one makes grep treat this file as binary.
- **The ROW is kept as well as the column**, though the ticket's example named only "3rd Story":
  without it, `Left Side / 3rd` and `Front / 3rd` are the same label on one screen.
- **Blank and zero cells are dropped** (`Number(cell) > 0`). Without it every grid emits ~18 rows of
  `0` and buries the one that changed; with it, clearing a cell correctly reads `22 → —`.
- **`gridCellLabels` resolves the names through `resolveLocationGridConfig`** — the same resolver the
  grid widget itself uses — so an authored custom grid and the `singleStory` variant both name their
  cells as the rep saw them. An unknown key falls back to the raw coordinate rather than being dropped.
- **`formatChangeFieldLabel` gained a trailing `cellLabel` segment**, after the combination chip:
  `<section> · Combination #2 · <field> · <row> · <col>`.
- **`describeCombo` names cells too**, so a removed combination is described by the measurements it
  actually held rather than by a total.

⚠️ **The group-meta lookup had to split cell keys as well.** It resolves a section's label by finding
any labelled field among its combinations; a combination whose only labelled field is a GRID would
otherwise resolve nothing and the ENTIRE group — every add/remove row in it — would be dropped as
noise. Tested directly.

Per-cell keys also **sharpen combination matching** for free: `comboSignature` / `overlapScore` now
compare individual cells instead of one collapsed number, so two combinations that happen to share a
grand total are no longer indistinguishable to the pairing pass.

⚠️ The reporter re-sent the earlier *"removed the 85' black soffit, kept the 200' white"* description as
context. That behaviour was fixed previously (see the combination-identity section) and is **asserted
again here as a regression guard** — the removal emits exactly one `removed` row and none of the
survivor's values appear as edits.

Verified with 11 tests over a Lighting tab (tab-level grid) and a Soffit combination section: the
ticket repro naming the cell, an explicit assertion that **no `110 → 143` total row is emitted**, an
edited cell, a cleared cell, two grid rows staying separate, an untouched grid → `[]`, blank/zero cells
never reported, a grid nested INSIDE a combination, a removed grid-only combination still reported, and
the two soffit regression guards. tsc 44 (baseline unchanged); eslint identical to HEAD (2 pre-existing
errors).

⚠️ **`dynamic-deal-diff.ts` is a CRLF file.** A script that reads/writes it in text mode rewrites all
466 lines to LF and buries the change in a whole-file diff — that happened here and had to be converted
back. Use `newline=''` on both ends. (Same trap as `EditCustomerModal.tsx`; check `file <path>` before
and after.)

### ✅ ROOT CAUSE: the Addendum Review's "original" and the live build were ONE object graph

Ticket: *"actually it's 48 but showing 4"*, then, decisively: *"i checked in iphone 14 pro max, still
same issue — it only set it 48 when i save something in this component, even it's empty line or space."*

**`hydrateJobStateForPersistence` SHARES object references with the state it is given** — a field's
value object is carried across, not cloned — and `useDynamicJobBuilderSession` seeds its `useState`
with that exact object (`if (initialJobState) return initialJobState`). So `initialState` (the diff's
ORIGINAL) and the rep's live build were the same object graph, and **any in-place write anywhere in the
~4k-line engine rewrote the "previous value" the review prints.** A `locationGrid` losing one column
that way turns a saved total of **48 into 4** — the reported number, exactly.

Proven, not inferred: driving the real `deserializeDynamicJobStateFromStorage` →
`hydrateJobStateForPersistence` over a LeafFilter-shaped config asserts
**`hydrated…grid === saved…grid`** (identity, not equality), and a single in-place `delete` of one
column then drops the ORIGINAL's total from 48 to 4.

**Fix — the builder gets a DEEP COPY** (`builderInitialState`, a JSON round-trip memoized on
`initialState`); `initialJobState={builderInitialState}` replaces `initialJobState={initialState}`.
`initialState` stays pristine for the diff.

- **A JSON round-trip is the right clone**: this state is exactly what gets PUT to the API, so it is
  plain JSON by construction — no Dates, functions or cycles.
- **Memoized on `initialState`**, so identity changes at the same cadence as before. Safe because the
  session's re-apply is keyed by **`draftToken` = (leadId, calcId)**, never by this object's identity —
  a fresh copy therefore cannot clobber the rep's edits.
- **It protects the query cache too.** `savedDynamicJobState` returns the sub-object of `lead` /
  `savedOutcome` verbatim, so before this the engine's writes were also reaching into the cached lead
  record. Tested.

⚠️ **Not a display bug.** `buildChangeGroups` is submitted as **`buildChangeSummary`**, so the
corrupted original was written onto the addendum **the customer signs**.

> ⚠️ **Two earlier diagnoses of this same ticket were WRONG. Both are retired; do not revisit them.**
> 1. *"iOS clips the trailing glyph of strike-through text."* `from` is not free text — for a
>    `locationGrid` it is `displayValue()` → the grid **TOTAL**, so `"4"` was a wrong SUM and no width
>    or font styling could ever move it. (The width framing was impossible anyway: the column measures
>    ~246pt on an iPhone SE against ~12pt for `"48"`, and the row below rendered a *longer* struck
>    value, `$2,000`, perfectly in the same screenshot.)
> 2. *"the calculator query is still in flight, so the original is half-hydrated."* Real, and the
>    `isCalculatorLoading` hold added for it is **kept** — the original genuinely does move while
>    `dealCenterData` is empty, and a diff computed then must not be rendered OR submitted. But it was
>    not this bug: the symptom survived on an iPhone 14 Pro Max and persisted indefinitely until a
>    Fast Refresh, which is mutation, not a race.
>
> The tell that settled it: **only a Fast Refresh of THIS file fixed it, permanently and on any
> device.** Fast Refresh discards `useMemo` caches, so a recompute from the pristine saved state gave
> 48 while the cached (mutated) object gave 4. A pure memo cannot return two answers for one input —
> so its OUTPUT was being written to.

⚠️ **The engine treats state as shared-mutable in places.** Any future screen that both seeds the
builder AND diffs against the same state must hand the builder a copy. `DynamicDealCenterScreen`
(create path) is unaffected — it has no original to diff against.

Verified with 7 tests: the reference sharing itself, the 48→4 corruption through it, the clone being a
distinct graph, the same write no longer touching the original, the clone being value-identical (so the
builder opens on the same build), the saved lead record protected, and `null` in → `null` out. tsc 44
(baseline unchanged); eslint 0 errors, 136 warnings vs a HEAD baseline of 133 — the three added are
`react-native/no-inline-styles` on the loading block from the previous pass, the same rule the file
already carries 133 of.

### Edit Customer accepted a phone number shorter than 10 digits

Ticket: *"add the validation for phone number, currently i am able to save the number less then 10
digit which is wrong, it should be same like we are doing in the add new lead."*

`EditCustomerModal` checked only `!phone.trim()` — **present**, never **complete** — so `443-87` saved.
Add New Lead (`widgets/modals/LeadCreate`) already had the rule; it is now here verbatim.

**The rule counts ELEVEN digits, not ten.** Both fields format through
`formatUSPhoneNumber`, which always emits the `+1 (XXX) XXX-XXXX` prefix, so a complete number strips
to 11 digits — the ten local ones plus the country code. Writing `!== 10` here would reject every
valid number.

⚠️ **The SEED had to be formatted for the check to be safe**, and this is the half that is easy to
miss. `phone` was seeded raw from `lead.customerDetails.phone`, which may be stored as bare digits or
E.164 (`4438784937` / `+14438784937`) — 10 digits either way. Adding the length check alone would then
have made an **untouched, perfectly valid record unsaveable**: open the modal, fix the address, and
Save would refuse over a phone the rep never touched. `useState(formatUSPhoneNumber(...))` normalizes
every stored shape to the one the field itself produces. (Same reasoning as the deal-edit "Send
Addendum To" field, which formats its seed for the same reason.)

⚠️ Consequence worth knowing: the submit payload now always carries the FORMATTED string. It already
did whenever the rep touched the field (the `onChangeText` formats), so this only makes the untouched
case consistent rather than introducing a new shape.

**Empty and incomplete stay separate messages**, which is a small improvement on Add New Lead rather
than a copy of it: `formatUSPhoneNumber` leaves `'+1 '` behind once the rep types and then clears the
digits, and `.trim()` alone reads that as filled in. The required check is therefore
`!phone.trim() || phoneDigits.length <= 1`, so a cleared field says *"Phone Number is required"* where
Add New Lead would say *"complete 10-digit"*.

Co-buyer phones were already validated at exactly **10** digits — correct and unchanged: they use
`formatCoBuyerPhone`, which emits the local digits with **no** country code, and the field renders a
static `+1` beside the input.

Verified with 9 tests driving the real `formatUSPhoneNumber`: every partial length 1–9 rejected and ten
accepted, the same verdicts as Add New Lead's own expression on each; all six stored shapes (raw,
E.164, `1`-prefixed, parens, dashed, already-formatted) seeding to one accepted value; the raw seed
proven to FAIL without the formatter; a genuinely short stored number still caught; empty vs the
`'+1 '` residue both reading as *required*; and over-typing truncated by the formatter (with
`maxLength={17}` backing it). tsc 44 (baseline unchanged); the file is byte-identical to its HEAD
eslint baseline (4 warnings, 0 errors).

⚠️ **This file is CRLF.** Editing it with a script that reads and writes in text mode rewrites all 776
lines to LF and buries the change in a whole-file diff — that happened once here and had to be undone.
Use `newline=''` on both the read and the write (or an editor that preserves endings).

### Investment Center spotlight: blurred backdrop, smaller card type, no strike-through

Ticket, three unrelated items against the enlarged (spotlight) program cards:
*"1- Make these circled fonts smaller so they fit more comfortably in the space. 2- Remove this line in
the middle of the one year program. 3- Whenever the card is opened in the large view it shouldn't be
visible in the background — you can make it blury like we already using in deal center."*

**1. Type is sized for the ZOOMED card, not the in-place one.** `SpotlightOverlay` renders the *same*
`ProgramCard` at roughly **2× scale** (`finalScale`), so type that merely fits in place reads as
edge-to-edge enlarged — which is what the ticket's screenshot shows for **IN-HOME PRE ORDER** and
**✓ Job Builder Submitted**. Both were flush against their container with **no horizontal padding at
all**, so the fix is padding as much as point size: the header title goes `13 → 11` with
`paddingHorizontal: 14` on the bar, and the opt-in button's label `10 → 9` (submitted) / `12 → 11`
with `paddingHorizontal: 4 → 12`, its check glyph `12 → 11`.

**2. The line was the crossed-off STRIKE, not the divider.** `ProgramCard`'s crossed-off overlay drew
`position:'absolute', top:'50%', height:2, #94A3B8` across the card — and at 50% it lands squarely on
the **Grand Total**, the one number that has to stay readable. Enlarged it stops reading as a strike
and reads as a rule. Removed; the state is still unmistakable from the clip layer's `opacity: 0.45`
plus the `#F1F5F9` body.

⚠️ **Do not confuse it with the divider above Grand Total** (`height: 1, #E2E8F0, marginVertical: 8`),
which is **web parity** — `program-card.js` renders a dotted `<Divider sx={{ mb: 1.25 }} />` in exactly
that slot. That one stays. Web has no `crossedOff` concept at all (the prop is absent from its
`propTypes`), so the strike line was mobile's own invention and nothing had to be diverged from.

**3. The backdrop now blurs.** The overlay dimmed with a flat `rgba(15,23,42,0.72)` scrim, which left
the page legible — and the card's **own in-place copy sits directly behind the enlarged one**, showing
the same figures at half the size, which is what the screenshot circles. It now carries a
`BlurView` + a lighter `0.55` scrim, both **inside the existing `AnimatedPressable`** so they fade with
`backdropStyle` and tap-to-collapse still reaches it.

- **`MODAL_BLUR_AMOUNT` is imported from `DynamicDealCenter/components/modal-chrome`** — the deal
  center constant the ticket points at. Not a new cross-screen dependency: `OptInConfirmModal`, in
  this same folder, already imports it (it is a pure constants module, no components).
- ⚠️ **`blurType` is `"dark"` in BOTH themes**, unlike the deal center's `isDark ? 'dark' : 'light'`
  modals. This overlay is a dark scrim by design because the program cards are white and have to stand
  against it; a light frost would sink the card into the background. `reducedTransparencyFallbackColor`
  is a near-opaque dark for the same reason — with Reduce Transparency on there is no blur, so the
  fallback has to hide the page by itself.

tsc 44 (baseline unchanged); `SpotlightOverlay.tsx` is byte-identical to its HEAD eslint baseline
(9 warnings, 0 errors) and `ProgramCard.tsx` drops from 45 to 44 warnings — the one removed is the
deleted strike-line's own inline style.

### Lead Center scanner: a filed document can't be deleted, and no longer renders blank

Ticket: *"don't allow user to delete the previously uploaded (once he will select the multiple doc then
those will show and can be removeable before uploading it like web) document from the lead center like
in the web."* Contract Details ▸ any **Add Document** opened `DocumentScannerModal` with the filed
document carrying a red ✕, so a rep could delete an executed agreement or a filed receipt from the
Lead Center.

**`JobDocsSection` now passes `allowRemoveExisting={false}`** — the prop added for the My Deals
agreement case, applied here to **all three** categories. A page scanned in THIS session keeps its ✕
(`item.isNew !== false`), so a misscan is never stuck; only what is already on the server is protected.
The info banner swaps to *"Documents already on file can't be removed here."*

⚠️ **Web is stricter than this, and the difference is worth knowing before anyone "completes" the
parity.** Web's dialog opens **EMPTY** — `contract-details.js` passes
`initialDocuments={lead?.jobBuilderData?.agreements || []}` and there IS no `jobBuilderData` on a lead
(0 occurrences in the sales-portal capture; the field is `jobBuilderDocuments`), so `docsToUse` is
`[]` and a filed document is never shown at all. That looks like a web typo rather than a decision, and
matching it on mobile would mean sending ONLY the new pages — which rests on the backend APPENDING
rather than replacing. Mobile still shows the filed documents and still re-sends them, so nothing can
be lost. Hiding them is a separate change and needs that append behaviour confirmed first.

#### …and that is why the blank tile had to be fixed in the same pass

The filed document rendered as a **featureless grey card** — the earlier "Scan-document sheet: blank
PDF tile" ticket fixed this for the My Deals surface but NOT for the Lead Center, and with the ✕ gone
the tile would have had literally nothing on it. Two independent bugs in the modal's `isPdfFile`, both
of which made a filed PDF fall through to `<Image>`, which cannot decode one:

1. **A display name short-circuited the url check.** The rule was
   `String(f?.name || f?.uri || f?.url || '')` — `||`, so only the FIRST truthy candidate is tested.
   `JobDocsSection`'s `mapWith` **overwrites** `name` with a constant (`'Agreement'` /
   `'Order Sheet'` / `'Down Payment Receipt'`), none of which has an extension, so the chain stopped
   there and never reached the url. Every candidate is now tested.
2. **The extension was read off the raw url.** Document urls are **pre-signed S3 links**, so the
   string ends in `…&X-Amz-Signature=…` and `.endsWith('.pdf')` is false on every one of them. The
   path is now split on `?`/`#` first.

Moved to the pure **`src/utils/document-file.ts`** to be testable: the modal imports
`react-native-document-scanner-plugin`, which resolves a **native TurboModule at import time**, so the
component cannot be loaded under jest at all (verified — it throws in `TurboModuleRegistry.getEnforcing`).

⚠️ **`fileSrc` was deliberately NOT moved with it.** `SummaryFinalizeCards`' copy prefers `secureUrl`
over `uri`; the scanner's must prefer `uri`, because a locally-scanned page has only that and
`docIdentity` reads it — re-resolving could change a document's identity across the scanner
round-trip, which is the pruned-on-Update bug that ticket already fixed once.

⚠️ **`screens/DynamicDealCenter/utils/document-payloads.ts` has its OWN `isPdfFile` carrying BOTH bugs**
and was left alone. It sits on the SUBMIT path — it decides whether to run `convertJpegToPdf` on a
contract document — so it should be changed with its own evidence, not as a ride-along.

Verified with 16 tests over the exact row `mapWith` produces: the repro asserted **false under the old
rule and true under the new one**, each bug isolated on its own, all three Lead Center document names,
`contentType`/`mimeType`/`fileData.contentType`/`filePath`/`secureUrl`/`displayUrl`, a local `file://`
scan, and the negatives that matter — a scanned **jpeg** page, a signed jpeg url, an image
`contentType`, and `.pdf` appearing in a FOLDER name — plus junk input as `false` rather than a throw.
The `canRemove` expression is covered too: filed → no ✕, scanned-this-session → ✕, and the two callers
that pass no prop unchanged. tsc 44 (baseline unchanged); `DocumentScannerModal.tsx` (9 problems) and
`JobDocsSection.tsx` (39 problems) are byte-identical to their HEAD eslint baselines, and the new util
is clean.

### Down Payment Receipt upload is logged — with the `filePath` / `bucketName` web omits

Ticket: *"add the log with the above payload while we are adding the down payment from the lead center…
one additional thing you have to add there is bucket name and file path of the document which we are
going to upload so we can show it on portal side. i also shared how it's calling in web, in web file
path and bucket name is missing we have to add it on mobile side."*

Lead Center ▸ Contract Details ▸ **Down Payment Receipt(s) ▸ Add Document** emitted **no activity log
at all** on mobile. Web `sections/job/components/contract-details.js` ›
`handleDownPaymentReceiptUpload` logs one, so the portal timeline had the event for a web upload and
nothing for a mobile one. The payload is now web's verbatim —
`action_type: 'upload'` / `module_type: 'job_builder'` /
`meta: { leadId, action: 'upload_down_payment_receipts', downPaymentReceipt: N }` — **plus the two
fields web does not send**, which are the point of the ticket: without them the portal has an event
saying a receipt was uploaded and no way to open the receipt.

**`filePath` / `bucketName` are generated SERVER-side**, so the device cannot know them at submit time
(`job-builder-docs/{company}/{lead}/downPaymentReceipts/{ts}-{n}-document.pdf`, bucket
`np-revdsm-staging`) — they can only be read back off the stored row. Two sources, in order, and
**neither costs an extra request**:

1. **The `POST lead/v1/{id}/job-builder` response.** Free and immediate. It is **not known** to return
   the filed rows (web ignores this response too), so a miss is an expected outcome here, not an error.
2. **The lead refetch this handler already performs.** On a miss the request is parked on
   `pendingReceiptLogRef` and settled by an effect keyed on `lead.jobBuilderDocuments` — the same
   change the document list re-resolves from. The handler's existing delayed refetches (1 s / 3 s)
   cover backend replication lag for free.

⚠️ **`downloadOutcomeDocuments` is NOT a third source.** It reads **LeadOutcomeDocument**, while this
upload's `/job-builder` POST writes **JobBuilderDocument** — a different collection, and the one
`lead.jobBuilderDocuments` exposes. Reading it back would be a multi-MB base64 round trip that does not
contain the row anyway.

**Rules live in the pure `src/utils/uploaded-document-refs.ts`** — `readDocumentGroup`,
`collectDocumentIds`, `pickNewDocuments`, `toDocumentRefs` — for the reason `utils/addendum-drafts.ts`
and `utils/inspection-photos.ts` exist: `JobDocsSection.tsx` pulls in React Native and is untestable
under jest here.

- **The two sources are interchangeable because the diff is by `_id`, not by count.** The response may
  return the whole group or only the new rows; either way the unknown ids are this upload's. That is
  what lets one helper serve both paths.
- **`readDocumentGroup` walks a FIXED list of roots** (`source`, `.data`, `.data.data`, and the
  `lead`/`outcome` wrappers) × a fixed list of bags (`jobBuilderDocuments`, `leadOutcomeDocuments`,
  `documents`). An unrecognised shape yields `[]` and the caller falls back — it never guesses a path.
- **A row with no `filePath` is dropped** (`toDocumentRefs`): an empty path in the log reads as a
  document that cannot be opened.

⚠️ **`meta.documents` is a LIST, and that is not optional.** One scan files **several** receipts — each
page becomes its own PDF — so a single `filePath` cannot describe the upload. It first shipped with a
singular `meta.filePath` / `meta.bucketName` alongside the list, and the reporter asked for them back
out: they only ever repeated `documents[0]`, and a reader that stops at them silently misses every other
page of a multi-page receipt. **The array is the only place the paths live.**

⚠️ **`downPaymentReceipt` counts the pages the rep ADDED this session** (`newPages.length`), not
`filePayloads.length`. Mobile re-sends the already-filed receipts alongside the new ones (that is how
this endpoint appends), so the payload length is the *total on the lead* and would report "3 uploaded"
for one new receipt.

⚠️ **AGREEMENTS AND ORDER SHEETS ARE STILL NOT LOGGED** on mobile, though web logs both
(`upload_agreements` / `upload_order_sheets`) from the same card. `handleSaveScannedDocument` serves all
three categories, so the branch is one `scannerCategory` test away — it was left out because the ticket
asked for the down payment only.

Verified with 19 tests over the document rows from the sales-portal capture verbatim: the group read off
a lead record and off four response shapes (`data.data.jobBuilderDocuments`, a `lead` wrapper, an
outcome-shaped `leadOutcomeDocuments`, and a bare group array), groups never crossing, junk shapes as a
no-op; the diff with the response holding the whole group, holding only the new row, on a first upload
with nothing known, and not-yet-landed (which is what parks the log), plus an id-less row kept and `id`
honoured beside `_id`; the ref narrowing, a `filePath`-less row dropped, a missing bucket defaulting to
`''`, and multi-page order preserved; and the assembled `meta` matching the ticket's payload exactly. ✅ Confirmed on device.
tsc 44 (baseline unchanged); `JobDocsSection.tsx` is byte-identical to its HEAD eslint baseline
(39 problems: 10 errors / 29 warnings) and the new util is clean.

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
submit time.

> ✅ **ROOT CAUSE FOUND AND FIXED (2026-08-12) — the client DID create it.** The last sentence above
> ("nothing on the client created it") was wrong. The duplicate is written by the **lead-scoped outcome
> mirror in `handleComplete`**, which re-attached the base64 documents at submit. The two timestamps in
> the table are 35 s apart — `…851569` is the sign endpoint filing the real row, `…886943` is the
> submit re-send — and the empty `name` is `buildDocumentPayloads` sending `name: ''`. The old comment
> at that call site asserted "the backend upserts by file, so re-sending … does not duplicate", and
> this table is the proof it does not. See "the lead-scoped outcome mirror no longer re-uploads
> documents" below. **The `dropUnnamedAgreements` display filter is kept** as a safety net for deals
> already carrying a duplicate, but new submits should no longer produce one.

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

> ✅ **CLOSED 2026-08-13 — see "a `0` in `dealCenterData` SHADOWED the overlay" below.** Everything from
> here to that section is the trail of a hunt that kept landing on the wrong layer; the correlations it
> records (Versa vs Micro Mesh, combination age, appointment-id shape) are all **coincidences** and are
> retired there. Read the fix first, then this only if you need the history.

⚠️ **One case is still open — and it is NOT "LeafFilter-only".** Originally filed that way (the failing
repro's GUTTERS tab read "No data entered", so LeafFilter was the only quantity in play). A payload
comparison across four deals on the SAME config (`sales-portal` response, 2026-08-11) reframes it:

| deal | LeafFilter combinations in the submitted build | footage edit re-prices? |
|---|---|---|
| `6a7aaf30…` "recipet lead" | **4** | ✅ yes |
| `6a7b1a12…` "current lead" | 0 | ❌ no |
| `6a7b0ad5…` "tomorrow lead" | 0 | ❌ no |
| `6a7af6a8…` "fu lead" | 0 | ❌ no |

Everything else is identical — same `configId`/`configSnapshotId` (`6a71a118…`), same vertical key,
same six tab ids, same `resultedProducts`, all `isDynamic`, all `submitted`. **4/4 correlation with one
structural fact: whether the combination ROW already existed.**

⚠️ And it is **not** about the saved footage: all four of recipet's combos store `__grid: null`, so it
sold with no footage either. The combos merely EXIST (each carrying a size/type, e.g. `6"` / `Versa`).

⚠️ **The "combination age" hypothesis above was WRONG — superseded by an on-device A/B.** Two builds
were made identical except for one field:

| | recipet | current lead |
|---|---|---|
| Gutter opening / footage | 6" + 7", 444ft | 6" + 7", 444ft |
| **LeafFilter profile** | **`Versa`** | **`Micro Mesh`** |
| New tiers | COST $6,488 / PAR $12,763 / RETAIL $19,636 | $200 / $200 / $200 (unchanged) |

**The price tracks the PROFILE VALUE, not the combination's age** — which also re-explains the earlier
table: every one of recipet's saved combos carried `Versa` / `Versa Max`. `Versa` prices; `Micro Mesh`
does not.

Since the LeafFilter allocation's `optionBinding` / contributor `when` rules live in the CONFIG, and
both apps evaluate them with byte-identical code (`comboMatchesOptionBinding` does an exact
`optionValues.includes(...)` — **neither platform trims**, so an authored trailing space like the
`"Micro Mesh "` seen in the saved payload would break BOTH), the likely conclusion is that the config
wires `Versa`/`Versa Max` to priced calculator fields and `Micro Mesh` to none. **Prediction to test:
web will also fail to re-price a Micro Mesh build.** The earlier "web works fine" comparison was
almost certainly run on a Versa deal.

**Ruled out by direct test against the real `resolveAllocationMetrics`:** the option-binding gate. A
combination whose bound option is blank (which is how a freshly-added one starts) still consumes its
full footage — `comboMatchesOptionBinding` does not zero it. Do not re-investigate that path.

Also noted, ranked second: the three failing deals have `jobBuilder.appointmentId === lead._id` while
recipet has a distinct appointment id — but 20 of the 32 deals in that payload share the same shape, so
it looks like a normal self-gen convention rather than the defect.

Still needed to close it: the job-builder config (`GET /company/v1/job-builder-products`) to read the
LeafFilter allocation's `optionBinding` / `metrics[].valueSource` / `dcField` refs, plus the calculators
for one working and one failing deal (`GET /appointments/{id}/lfcalculators`).

#### Full web↔mobile diff of the pricing chain (2026-08-11)

Driven by *"same functionality is working fine in web… can you fix this issue"*. Every function in the
chain was compared against `mhalt-revDSM-sales-frontend/src/sections/deal/components/dynamic-deal-pricing.js`
and found **at parity** — do not re-diff these:

- `computeEditedTiers` — all three paths, same order, same `previous`/`delta`/`clamp` (mobile adds only
  the `originalContractPrice` RETAIL fallback, which cannot affect `delta`).
- `buildCalculatorDetails`, `extractQuantitiesByFieldId`, `buildFieldCalcKeyMap`,
  `collectAllocationDcRefs`, `buildAllocationQtyMap`, `buildBuilderQtyIndex` — line-for-line equivalent.
- `tierFor`'s schema walk vs web `calculateResultUtil`'s `isSchemaBased` branch — byte-identical
  (`details[field.name] ?? details[field.id]`, `resolveFieldTierPrice`, `applyFeesToTier`, $200 floor).
- Config normalization: both run `enrichConfigWithProductColors` → `migrateConfigTabFields` →
  `ensureVerticalSummaryTabs` over the same endpoint.
- `collectAllocationFields` already delegates to the deep (container-recursing) collector.
- Edited state propagation: both stream the embedded builder's state out via `onStateChange` →
  `setEditedJobState`, and both price `editedJobState || initialState`.

**The one real divergence found is in an INPUT, not the math: `dealCenterData`.** Web
`buildDealCenterSessionData` merges four sources and its `ingestCalculatorObject` walks the calculator's
top-level scalar columns, writing each one under **every alias of the schema field it matches**
(canonical id ⇄ legacy `field.name`). Mobile's `buildDealCenterData` step 3 copied `resultData` keys
**verbatim, with no alias hop**. A calculator stores a quantity under one spelling while the config's
`dcField` may reference the other, so the reference resolves to nothing — a `dealCenter` allocation
metric reads a budget of 0 and the build's footage is mapped onto a ref the schema prices at 0. Silent:
the tiers simply don't move. Ported in `utils/build-deal-center-data.ts` (objects skipped, aliases last —
matching web's merge precedence, where `fromCalculatorDirect` wins).

⚠️ Genuine port gap and strictly additive (it only adds alias keys for scalar values that match a schema
field), but **NOT the cause of the LeafFilter case** — see below.

#### ✅ ROOT CAUSE (found 2026-08-11): the edit wizard priced against `configuredSchemas`

Settled by an on-screen diagnostic rather than more code-reading. `computeEditedTiers` now returns a
`debug` block and `DynamicDealEditScreen` renders it on the Job Price step while `DEAL_PRICING_DEBUG`
is on. On the failing deal it read:

```
path=schema  schemas=1  cfg=Y  flat=2  keyHits=2  alloc=4  diff=25  priceable=0
```

Every link worked — the right branch was taken, allocations mapped 4 refs, and **25 calculator keys
moved** between the original and edited build — and then **not one of them was a key the schema could
price**. `schemas=1` is the tell.

`DynamicDealEditScreen` passed **`configuredSchemas`** (only entities that already have fields) where
web's `dynamic-deal-edit-modal.js` passes the UNFILTERED **`schemas`** — it never references
`configuredSchemas` at all (`grep -c` → 0). `tierFor` prices a quantity by matching it to a schema
field's `id`/`name`, so every schema dropped by that filter takes all of its fields with it. The
build resolved perfectly and then had nothing to price against.

⚠️ **This is why only ONE deal ever worked.** "recipet lead" sold LeafFilter, so its quantities landed
on fields belonging to the single surviving schema; every other deal's edits landed on fields the
filter had removed. The Versa/Micro Mesh and combination-already-exists correlations recorded above
were both **coincidences of that same fact** — they are not causes. Do not re-investigate them.

Fixed in `DynamicDealEditScreen.tsx`: `schemas` now feeds **both** `computeEditedTiers` and
`buildDealCenterData` (web passes the unfiltered list to `buildDealCenterSessionData` too — the
field-option ALIASES are derived from it, so a dropped schema loses every alias it owns as well).
`calculatorSchemas={configuredSchemas}` on the embedded builder is deliberately left alone: it drives
tab accent colours only, and `schemas` ⊇ `configuredSchemas` there so it makes no difference.

⚠️ `useCalculatorSchema` returns BOTH lists. `configuredSchemas` is for **gating UI** ("has the manager
configured the deal center?"). Anything that PRICES must take `schemas`.

#### ⚠️ The LeafFilter tab is priced ONLY by grid column sums (config fact, 2026-08-12)

Follow-up: *"when i am changing in leaffilter tab in my deals flow, in the 3rd step cost PAR and
Retail is not updated… changes are showing in the summary part, but when i go to next step nothing
changed."* Settled by reading the **actual config** (`GET /company/v1/job-builder-products`, saved as
`leaffilter-config.txt`) rather than more code. **Read this before touching the pricing chain again.**

**Two corrections to earlier entries in this file — both were mine, and both sent me down dead ends.**

1. **The `configuredSchemas` → `schemas` "ROOT CAUSE" below did NOT fix this.** The strip still reads
   `schemas=1`, because the endpoint only ever returned one schema — the filter was never dropping
   anything. The change is still correct (web passes the unfiltered list) and is kept, but it was
   **not the cause**, and the section below overstates it.
2. **`diff=25` was the diagnostic LYING.** `describeBridge`'s filter was
   `Number(next[k]) !== Number(prev[k])`, and `Number('Micro Mesh')` / `Number('Versa')` are both
   `NaN` — `NaN !== NaN` is **true**, so every TEXT field counted as a changed quantity. "25 calculator
   keys moved" was mostly profile/colour strings. Fixed: the filter now requires at least one side to
   be numeric. ⚠️ Never compare via `Number()` to detect a change on a map that also holds strings.

**How LeafFilter is actually wired** (all 10 allocations on that tab):

| | Gutters tab | **LeafFilter tab** |
|---|---|---|
| `dcField` on the allocation | `new_number_input`, `6_gutter_ds_e`, `7_gutter_ds_e` | **none — all 10** |
| `optionBinding` | — | **`null` — all 10** |
| `used` contributor | — | `columnSum` of ONE story column of ONE section's `locationGrid` |
| `avail` (budget) | dealCenter ref | dealCenter ref (the calculator's own story×width quantity) |

So a LeafFilter allocation's only calculator ref is its **budget** metric, and
`buildAllocationQtyMap` maps the rep's **allocated** total onto it. Net effect: **the only build edit
that can move a LeafFilter price is a change to a grid column sum.**

Consequences, all verified against the config:

- **"LeafFilter Profile" cannot affect price.** It is a **free-text field**
  (`field_1782365732617_cgzrz`, `type: 'text'`, key `textValue_atgx2`), and every allocation has
  `optionBinding: null`. Typing `Micro Mesh` / `Versa` / `Versa Max` into it changes no priced
  quantity by design. ⚠️ This finally explains — and **retires** — the "Versa prices, Micro Mesh
  doesn't" correlation recorded further up: profile never priced on *either* platform.
- **Adding a combination with no footage changes nothing.** `used` is a column sum; a combination
  whose grid is blank contributes 0. In the reported screenshot only Combination #1 carries footage
  (`3rd Story · Left Side: 444ft`); #2/#3/#4 hold profiles only. Nothing to re-price.
- **Versa Max has its OWN section** (`section_1782386890583`, grid key `grid_acoaz_rsb8y_n70le`,
  aggregate `gridTotal`). Versa Max footage must be entered **there**, not by typing "Versa Max" into
  the profile text field of the 6" section.
- Each width lives in its own section — 6″ → `section_1782365542087` (grid key `grid`), 7″ →
  `section_1782373723139` (`grid_acoaz`), 4&5″ → `section_1782373742457` (`grid_acoaz_rsb8y`) — and
  the three story columns (`1st`/`2nd`/`3rd`) of one grid feed three different allocations.

**The engine was re-diffed against web during this pass and is at parity — do not re-diff:**
`collectAllocationDcRefs` (byte-identical), `buildAllocationQtyMap`, `allocation-value-resolver.ts`
(only TS annotations differ) and `location-grid-utils.ts` (ditto).

**New decisive diagnostic: `allocMoved`.** `describeBridge` now also builds the allocation qty map for
the **original** state and reports which refs differ. The on-screen strip (`EditedTiersResult.debug`,
rendered on the Job Price step) leads with it:

```
schemas=1 schemaKeys=N alloc=6 allocMoved=0 numDiff=0 priceable=0
MOVED none — no allocation total changed
```

⚠️ **Read `allocMoved` FIRST.** `MOVED none` means the build changed nothing the config maps to a
priced quantity — an unchanged tier is then **CORRECT**, not a bug, and no amount of engine work will
change it. Only `allocMoved` non-empty **with** `priceable=0` is a real bridge failure (refs moved but
aren't schema field ids/names).

✅ **Both are now OFF** (2026-08-12, before push): the amber strip was removed from
`DynamicDealEditScreen` and **`DEAL_PRICING_DEBUG` is back to `false`**. The instrumentation itself
(`describeBridge`, `allocMoved`, `EditedTiersResult.debug`) is retained behind the flag — flip it to
`true` to diagnose, and read `allocMoved` first.

#### ✅ ROOT CAUSE, FOUND AND FIXED (ticket 339, 2026-08-13): a `0` in `dealCenterData` SHADOWED the overlay

Settled by an A/B the reporter set up: *"while i create the lead from web the above flow works fine in
the mobile, but when i create lead from mobile the above not works."* Two `sales-portal` captures of the
SAME company, config (`6a71a118…`) and product — **TEST LEAD** `6a7d6aad…` (job created on web) and
**testt lead** `6a7d70c6…` (created on mobile). Editing the web-created one in mobile re-prices; the
mobile-created one shows `PREVIOUS === NEW` and *"No priced quantity change detected from the build"*
while the step-2 Job Build summary shows the footage the rep just entered.

**⚠️ This RETIRES three earlier conclusions in this file. All three were mine and all three were wrong:**

1. **"`MOVED none` ⇒ an unchanged tier is CORRECT, not a bug"** (the box directly above) — **false**, and
   it is the sentence that closed the investigation prematurely. `allocMoved` reads the allocation qty
   map, which is the layer *before* the schema lookup. The refs DID move; they were shadowed one layer
   later. Read `allocMoved` **and** `priceable`, and treat `allocMoved` non-empty as "keep going".
2. **"The LeafFilter tab is priced ONLY by grid column sums"** — still true as a config fact, and it is
   what makes this tab the one that exposes the bug: its allocations have **no `dcField`**, so their only
   calculator ref is the budget metric's, reached exclusively through the overlay this bug broke. A tab
   with direct `dcField`s (Gutters) is priced by the *other* overlay, which already propagated aliases —
   which is exactly why the Gutters edit re-priced to the dollar and LeafFilter never did.
3. **"the edit wizard priced against `configuredSchemas`"** — a real port gap, correctly fixed, but not
   this cause. It is already marked superseded above; this is the actual answer.

**Mechanism.** `tierFor` resolves a schema field's quantity as
`details[field.name] ?? details[field.id]`, and **`??` does NOT fall through on `0`**. Three facts meet:

- A schema field's `id` is portal-generated (`field_1782973860922_36_i4ii`) and its `name` is a separate
  authored string, so the two keys are distinct. `normalizeField` spreads the field through verbatim.
- A **mobile** calculator seeds EVERY schema field at `inputValue: 0` (`build-all-entries.ts` — web
  parity, deliberate), and `buildDealCenterData` writes each entry under **both** the id and the legacy
  `name` (`collectKeysForEntry`). So `dealCenterData` holds `{ [id]: 0, [name]: 0 }` for every field.
- `buildCalculatorDetails`' **allocation** overlay wrote `base[ref] = qty` and **only that key**, while the
  field-map overlay ten lines above it already fanned out to every alias.

Net: the LeafFilter footage reached `base` under the **id**, `tierFor` read the **name** and got the
calculator's `0`, and the delta was exactly zero. It bites only when the calculator carries an entry for
that field — which is precisely the web-created vs mobile-created split the reporter isolated.

Fixed in `buildCalculatorDetails` (`utils/dynamic-deal-pricing.ts`): the allocation overlay now runs each
ref through `collectDealCenterKeysForFieldId` and writes every alias, matching the overlay above it.
`collectDealCenterKeysForFieldId` also gained a **`legacyKey` fallback** to its `find`, so an allocation
that references a field by its legacy `name` updates the canonical id too — the same shadowing, mirrored.
The canonical `key`/`fieldId` match is still attempted first, so existing resolution is byte-identical.

⚠️ **`tierFor` was deliberately NOT touched.** Making it prefer the non-zero alias would diverge from web
`calculateResultUtil` on the hottest path in pricing. Keeping the two aliases *in agreement* is the
narrow fix; the lookup stays a faithful port.

⚠️ **Deliberate divergence — do NOT "re-sync" this to web.** `dynamic-deal-pricing.js:234` is
byte-for-byte the old mobile code and carries the identical latent bug. It is dormant there only while
web's calculators don't seed the shadowing alias; **web will hit this the moment they do.**

**Ruled out by direct test — do not re-investigate:**
- **The saved build is NOT the difference.** The mobile-created lead stores
  `comboGroups[…].combinations: []` for all four LeafFilter sections where the web-created one stores one
  combination each — a real divergence, from mobile's deliberately stronger `comboHasEnteredData`
  (`dynamic-job-state-storage.ts`), which drops a combo carrying only LOCKED/`defaultValue` values. Those
  web combos hold exactly that (`6"`, `Versa`, `grid: null`), so **mobile is the more correct of the two.**
  Driving the real `deserializeDynamicJobStateFromStorage` → `hydrateJobStateForPersistence` over both
  captures gives **identical** hydrated states (`ensureTabStateShape` re-seeds the pruned combo), and a
  555ft edit moves the **same 16 refs with the same delta** on both. The `[]` is harmless.
- The `locationGrid` is **not** locked and is absent from `defaultItem`, so footage always survives the
  prune. The prune has never eaten a measurement.
- `jobBuilder.appointmentId === lead._id` on mobile-created leads (from
  `fallbackAppointmentId: appointmentId || leadId` in `DynamicJobBuilderScreen`) — real, cosmetically
  wrong, and **not** this bug: the wizard fetches the calculator by id (`getCalculator`), never via the
  appointment. Worth its own ticket; it is not a pricing input.

Verified by driving the REAL `computeEditedTiers` over the reporter's own config + both captured builds:
the ticket repro (zero-seeded `dealCenterData` → **fails before the fix, passes after**), a web-shaped
empty calculator still pricing, a **non-zero** prior calculator value being replaced rather than summed,
the mirrored legacy-name allocation, and an untouched build still reporting `changed: false` with
`next === previous` (no false positives). tsc 44 (baseline unchanged); eslint on the file identical to
HEAD (0 errors, 2 pre-existing warnings).

#### Also ported en route: web `ticket-1063` (2026-08-11)

A side-by-side on the SAME deal (`6a7b1a12…`, Micro Mesh, 444 ft) settled it — **web $6,483 / $12,757 /
$19,626, mobile $200 flat** — so it is a mobile bug, not the config. The web repo had been re-pulled and
carried a commit from that same day (`51c8a246 ticket-1063`) touching five engine files, none of it
ported. All of it is now in:

- **`toggle-utils.ts` — THE fix.** `filterVisibleToggleOptions`'s second parameter changed from
  `dealCenterData` to the **full rule context**. An `optionVisibility` rule is an ordinary rule group:
  with only `{dealCenterData, state}` it cannot resolve a field by KEY, reach another section, or read
  an allocation metric, so every such reference evaluated `undefined` → read as "rule not met" → **the
  option was silently hidden**. That is why LeafFilter's `Micro Mesh` never priced on mobile while
  `Versa` (ungated) did. New `getVisibleFieldOptions` + `getBaseFieldOptions` (which reads
  `optionShowFields` KEYS for dropdowns, since `field.options` is stale for those);
  `filterVisibleToggleOptions` is kept as an alias so the name reads the same at call sites.
- **`dependency-engine.ts`** — `buildRuleEvaluationContext` **exported** (option rules must share it);
  `isDefaultColorActive` now honours `useDefaultValue` as the dropdown twin of `useDefaultColor`; new
  `resolveEffectiveDefaultValue`; `validateDependencies` covers `dropdown` optionVisibility.
- **`combination-utils.ts`** — `buildDefaultItemFromFields` seeds a `dropdown` defaultValue (was `text`
  only). Deliberately condition-blind: it cannot import the dependency engine.
- **`dynamic-job-state-storage.ts`** — `hydrateFieldValue` applies `resolveConditionalDefault` **before**
  falling back to `buildDefaultItemFromFields`, so a conditional default is never persisted past its own
  condition. (This is the half that explains the **LeafFilter Color reading White on web vs Clay on
  mobile** for the same saved state.)
- **`tab-validation.ts`** — `isFieldValueComplete` handles `dropdown`, passes `depCtx` (not
  `dealCenterData`), and treats a disabled dropdown / one carrying an active default as answered so Next
  is never disabled with nothing on screen to fix.

⚠️ **`DynamicTabRenderer.tsx`'s three call sites now pass `depCtx`** (already built at ~line 359). Any new
caller of `filterVisibleToggleOptions` / `getVisibleFieldOptions` MUST pass that same context — passing
`dealCenterData` still type-checks and still "works" for same-section rules, which is exactly what made
this bug invisible for so long.

Verified with the real engine: a cross-section-gated option is **hidden under the old stripped context and
kept under the full one** (fails before the port, passes after), a genuinely-unmet rule still hides it,
`applyConditions: false` / no-optionVisibility untouched, `optionShowFields` keys used for dropdowns,
dropdown defaults seeded, `useDefaultValue` honoured (incl. explicit `false`), and `defaultWhen` respected
both ways. tsc 44 (baseline unchanged); eslint per-file identical to HEAD (dependency-engine 2,
storage 3, renderer 12, others 0).

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

`SummaryFinalizeCards` passes
**`allowRemoveExisting={scannerCategory === 'agreement' ? !editMode : true}`**, so the ✕ is hidden for
exactly one case: an **already-filed agreement in the MY DEALS edit flow** (`DynamicDealEditScreen`).

⚠️ **The flow this applies to was INVERTED on 2026-08-11 — read this before "restoring" it.** The
original ticket above was written against the Job Builder create flow, so the rule shipped as
`? editMode :` (hidden while creating). QA then corrected the requirement:

> *"I mistakenly made changes in the Job Builder based on my previous request. Please revert those
> changes… The only change required is to remove the delete/cross option from Agreements in the My
> Deals section."*

The reasoning behind the corrected direction is the stronger one: a **My Deals** deal is already
**submitted**, so its agreement is the *executed contract* — an addendum adds to it and must never
delete it. In the **Job Builder** create flow nothing is filed yet and the rep may still be correcting
the document, so delete stays. Hence `!editMode`. The current truth table:

| | create (Job Builder) | edit (My Deals) |
|---|---|---|
| **Order Sheets** — filed or new | ✕ shown | ✕ shown |
| **Agreements** — already filed | ✕ shown | **hidden** |
| **Agreements** — scanned this session | ✕ shown | ✕ shown |

⚠️ Write it as that **explicit branch on the category**, not as the equivalent
`!editMode || scannerCategory !== 'agreement'`. The two are logically identical, but QA reported the ✕
missing from ORDER SHEETS against the boolean form, and the flat expression makes it easy to believe —
and easy to break for real when the agreement rule is next edited.

⚠️ In the My Deals edit flow this leaves **no delete path for an existing agreement** — the card
header's pencil is the only entry point into the scanner. That is deliberate and is the ticket's intent.

⚠️ **`editMode` is the create/edit discriminator for this whole component** (it also drives
`agreementRequired`, `showOrderSheetCard` and `mergeDocSources`). Gating on the scanner category alone
was an early attempt here and was wrong — it stripped delete from **both** flows.

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

### An Extras colour showed "Black" beside a Ground Spout of 0

Ticket: *"when i create a calculator and not hit any value in the ground spout section, but when i come
to this screen here you see the ground spout is still empty. if its empty than why its colour field
show the black colour. its wrong — if there is no value than the colour value should also be empty."*

The gutter **Extras** section is authored as PAIRS — a locked, calculator-driven quantity
(`Ground Spout`, `dcField: groundSpout`) immediately followed by its locked **Color**. A colour field
carries **no `dcField`**, so `resolveLockedValue` fell straight through to `field.defaultValue` — the
portal's "if they buy one it's Black" default — and painted it on an extra the rep never quoted. The
`Replace Corner` pair directly below read `—` only because ITS colour happens to carry no default, so
one screen showed two contradictory answers to the same question.

⚠️ **It was not only a display bug.** `hydrateFieldValue` (`dynamic-job-state-storage.ts`) resolves
locked fields through the same call, so `"Black"` was **written into the saved job state** and rode
along to the portal. And on the **Job Summary** tab the phantom survived *alone*: the 0 quantity is
dropped there (`isDisplayableFieldSummary` rejects a numeric 0) while `buildStackRowSummary` still
took the row's label from the quantity — rendering **`Ground Spout — Black`** for an extra that is not
on the job.

**New pure `src/utils/dynamic-job-builder/engine/locked-color-defaults.ts`** holds the rule
(`isColorField` / `hasEnteredQuantity` / `findPairedQuantityField` / `resolvePairedQuantityValue` /
`isQuantityLikeField` / `isPairedQuantityEmpty` / `findPairedColorFields` /
`resolveLockedColorFallbackDefault`), for the
reason `utils/addendum-drafts.ts` and `utils/inspection-photos.ts` exist: all three consumers pull in
React Native or are untestable here, and "the extra isn't on the job" must mean one thing on all of
them.

- ⚠️ **The pairing is POSITIONAL, because nothing else links the two fields.** The colour has no
  `dcField`, no `linkedFieldId`, and no `dependencies.requiredWhen` naming the quantity. The nearest
  **preceding non-colour field** in the same fields array is the authoring convention the renderer
  already relies on — `StackFieldGrid` lays an extras stack authored as `[extra, color, extra, color…]`
  onto one row per pair, and the saved payload shows exactly that alternation
  (`…__textvalue-uuu1l: 2`, `…__color-gem7v: "Forest Green"`). Structural fields (`sectionLabel`,
  `allocation`, `combinationSummary`, containers, `_`-keyed) are skipped, and a colour never pairs with
  another colour, so `Wedges / Straps / Modify Height` (which have no colour) are unaffected.
- ⚠️ **Scoped by the PAIRING, not by `field.locked`.** The first pass gated every one of these on
  `isFieldLocked(colour)` and did **nothing on device** — on the live config the Extras colour is
  authored as a plain editable swatch (it renders read-only because the TAB is, not because it
  carries the flag). The scope is instead `isQuantityLikeField`: the colour must FOLLOW A QUANTITY
  (a `number`/`text` box, a `dcField`-bound or legacy `locked` field). A **combination's** colour
  follows a SELECTION — gutter runs are `[size toggle, color]`, downspouts `[dsType toggle, dsColor]`
  — so it never pairs and is never touched. That is the whole guard; there is no locked test left.
- ⚠️ **`lockedWithColor` / any field with `colorKey` is NOT a colour slot**, and neither is a colour
  carrying its own `dcField`. Those resolve their own value from the calculator; suppressing them would
  blank a real measurement. Both are excluded in `isColorField` and both are tested.
- **Suppressed reads `—`, not blank** — the same em dash its unconfigured neighbour already shows.
- **The saved-state fallback is skipped when suppressed**, so a lead saved BEFORE this fix (carrying the
  phantom colour in its stored state) also reads `—` rather than resurrecting it.

Three call sites, one rule:

| where | change |
|---|---|
| `DynamicTabRenderer` generic locked branch | `resolveLockedValue(…, { fallbackDefault })` + `—` when suppressed |
| `DynamicTabRenderer` `colorSelection` locked branch | same — that branch is **also reached with no `field.locked`** (a colorSelection locked by `lockWhenNotRequired`) |
| `hydrateFieldValue` (storage) | `fallbackDefault: ''` when suppressed → the field is EMPTIED, the same mechanism that drops a not-included product from storage |
| `formatFieldSummaryValue` (`vertical-summary-utils`) | returns the `missing` variant, so the row never reaches the Job Summary |

⚠️ The colorSelection branch also gained web's `resolveLockedColorValue` parity it never had: the
fallback default is the **condition-resolved** one (`resolveConditionalDefault`), never the raw
`field.defaultValue`, so a `dependencies.defaultWhen` that is not met can no longer leak its default
either.

⚠️ **Still unfixed: `dynamic-auto-field-entries.ts`** calls `resolveLockedValue` for the ACTIVITY LOG
with no fallback, so a suppressed colour can still be logged. Separate surface, separate evidence.

Verified with 23 tests (`__tests__/utils/locked-color-defaults.test.ts`) driving the real helpers, the
real `hydrateJobStateForPersistence` and the real `buildSimpleSectionSummary`: the ticket repro
(asserted to yield **`Black` under the old expression** and `—` under the new one), the `Replace Corner`
pair unchanged, the default still showing once the quantity IS quoted (from the calculator or from
state), a phantom colour already saved being hidden, a saved colour surviving while its quantity holds,
the pairing walk (label skipping, colour-never-pairs-with-colour, unpaired colour untouched), the two
exclusions above, `hasEnteredQuantity` across `0`/`'0'`/`''`/`—`/grids/multi-selects, hydration not
seeding the colour (and still seeding it when quoted), and the summary row — the summary case
**fails on the pre-fix code and passes after**. tsc 66 errors (baseline unchanged); the new util is
eslint-clean and all three touched files are byte-identical to their HEAD eslint baselines
(`dynamic-job-state-storage` 3 errors, `vertical-summary-utils` clean, `DynamicTabRenderer` 24 problems).

#### …and in the deal-edit wizard the colour is CLEARED, not just hidden

Follow-up on the same pair, from the **My Deals ▸ Edit Job Build** flow: *"currently there is a value
in the ground spout that is 1 — when user change the value from 1 to 0 than the colour should remove
automatically. currently the colour still available but i dont need color if the ground spout value
is 0."*

Everything above is a **read** rule, and the edit wizard is the one surface where it cannot apply:
`editMode` (web `unlockAll`) makes every calculator-locked field editable, so the locked branch — with
all of its suppression — is never reached. The rep edits `Ground Spout` down to `0` in a real
`TextField` while a real colour picker keeps showing `Black`, and that colour is stored state, so it
goes into the **addendum**. Hiding it is not enough here; it has to be removed.

- **`renderField`'s `onChange` is now wrapped** (the raw prop was renamed `onFieldValueChange`, so every
  case inside picks the wrapper up automatically). When a field's new value is empty
  (`hasEnteredQuantity` — `0` / `'0'` / `''` / an empty grid), it also writes `''` to each colour slot
  that belongs to it, through the same `ctx.onFieldChange` the container already uses. Both writes are
  functional state updaters, so they compose in one tick.
- **New `findPairedColorFields(quantityField, fields)`** is the inverse of `findPairedQuantityField`:
  the run of colour fields immediately FOLLOWING the quantity, stopping at the next non-colour field —
  so `Ground Spout` can never reach into the `Replace Corner` pair below it.
- ⚠️ **An unconditionally `required: true` colour is exempt** — emptying it would disable **Next**
  with nothing on screen explaining why. (A `requiredWhen`-gated colour is safe: with the quantity
  at 0 that rule is not met either.) A combination's picker needs no exemption — it follows a
  SELECTION, so `isQuantityLikeField` never pairs it in the first place.
- **`resolveSwatchValue` applies the same rule to the editable picker**, which is what covers a deal
  **saved before any of this existed**: its stored `Black` sits on a 0 extra, and re-offering it as the
  selected swatch would just re-submit the phantom. Same exemption.
- **Nothing is written when there is no colour to clear** (`state[colorId]` already empty), so typing in
  an Extras field can't dirty the draft on its own.

##### …and the second reason it didn't fire: `dealCenterData` still reports the SOLD quantity

QA came back with a screenshot of `Ground Spout 0` beside a black **Color** chip — the fix above,
not working. Two causes, both now fixed, and the second one is the subtle half:

1. the `locked`-flag scoping described in the round-1 section (retired for `isQuantityLikeField`), and
2. **`resolvePairedQuantityValue` preferred the CALCULATOR whenever the state value looked empty.**
   Its first line was `if (hasEnteredQuantity(fromState)) return fromState;`, so a state value of
   **`0` fell through to `resolveLockedValue`** — and in the deal-edit wizard `dealCenterData` still
   holds the quantity the deal was SOLD with (`1`). The rep types 0, the helper reads 1, and the
   colour is judged to be on the job. It now returns any **explicit** state entry, `0` and `''`
   included, and reads the calculator ONLY when the field has no entry at all (a build never
   opened). Same principle `formatFieldSummaryValue` already documents: in edit mode the rep's live
   value must win.

Verified with 15 more tests in the same suite (38 total), driving the real helpers plus the exact
side effect and the exact `resolveSwatchValue` expression: the ticket repro (`1 → 0` and `1 → ''`
both clearing), the typed `0` outranking a calculator that still says `1`, the calculator still
read when the build has no entry, the colour surviving `1 → 2`, the neighbouring pair untouched, a
quantity that owns no colour, the walk stopping at the next quantity, an **unlocked** Extras colour
now covered (the live-config case), a colour that follows a **toggle** left alone in both
directions, the required exemption, the no-op write, and the editable picker painting nothing on a
0 extra while still painting a saved colour once the quantity is back. tsc identical to baseline;
`locked-color-defaults.ts` and `vertical-summary-utils.ts` are eslint-clean and the other two files
are byte-identical to their HEAD baselines (storage 3 errors, `DynamicTabRenderer` 24 problems).

### The Complete-Job payload now matches the backend's contract exactly

Ticket: *"this is the actual payload that is used for the job submit — compare the already implemented
payload with this provided payload and set the already implemented payload 100% same … all the fields
should be populated properly that needs on the backend."* Two references, both in the repo root:

| file | what it is |
|---|---|
| **`payload.dynamic.json`** | the backend dev's CONTRACT — key set, string money, the calculator key, and the four document groups |
| **`web-job-builder.txt`** | a capture of a REAL web submit — the same shape with a real `LFCalculator` document (40 entries) |

⚠️ The capture is hand-truncated at the agreement blob (`"blob":"type": "agreement"`), so it does not
parse and its `jobState` is missing everything after `agreements` — the vertical/tab state was cut, not
absent. Read it for `leadData` only.

**New pure `src/screens/DynamicDealCenter/utils/job-submit-payload.ts`** assembles the body
(`buildSubmitLeadData` / `buildCalculatorDocument` / `buildJobSubmitPayload` / `toPayloadAmount` /
`toPayloadText`). `DynamicJobBuilderScreen.handleComplete` no longer builds it inline.

#### What was wrong

- **The calculator was usually missing entirely.** `leadData.LFCalculator` must be the FULL saved
  calculator document (`_id`, `createdBy`, `appointmentId`, `entries[]`, `totals`, `price`,
  `discountPercentage`, `createdAt`/`updatedAt`, …). Mobile attached the in-memory **`CalcTab`**, which
  has none of those and whose `entries` is a **map keyed by field id, not an array** — and then dropped
  the key altogether unless the tab happened to carry `createdBy`/`appointmentId`/`title`, which it
  never does. So the submit went out with no calculator on the vast majority of jobs.
  **`handleComplete` now reads the server copy** (`GET /lfcalculators/{id}` via
  `LeadService.getCalculator`) and passes it through `buildCalculatorDocument`; the tab is a shaped
  FALLBACK for a failed read (entries map flattened back to an array, ids filled from the submit
  context), so the key is never partial and never absent.
  ⚠️ The read goes through **`extractCalculatorDocument`**, because the response wrapper varies by
  deployment — the repo already unwraps it four ways (`DynamicDealEditScreen`:
  `body?.data?.calculator ?? body?.data ?? body?.calculator ?? body`). Anything without an `_id` is
  treated as UNRESOLVED so the tab fallback runs: sending a wrapper as the calculator looks exactly
  like "no calculator" from the backend. `handleComplete` also logs one line naming the attached
  calculator (`[COMPLETE JOB] leadData calculator: _id=… entries=… source=server|local tab`), so the
  question is answerable from a device trace.
- **`leadData` carried the result modal's whole state.** It was `{ ...resultData }` plus mobile-only
  keys, so it shipped `versatile` / `pineapple` / `resultType` / `demoReason` / `contractPrice`
  alongside `status`, `installDate`, `timeWindow`, `calculatorId`, `appointmentId` — none of which is in
  either reference. It is now assembled key by key.
- **Money went out as NUMBERS.** Both references carry strings (`"originalContractPrice": "24900"`,
  `"balance": "21900"`) — web's `formData` holds typed text. ⚠️ An unset amount is **`''`, never `0`**:
  a zero reads as a real quoted figure on the portal.
- **`paperWork` and `downPaymentReceipt` were never sent.** The contract lists four document groups; the
  job builder produces only agreements and order sheets, so the other two go out as **empty arrays
  rather than absent keys** — not the same thing to a partial-update handler.
- **`lastPriceQuoted` / `originalContractPrice` were both filled from the same field.** Web
  (`result-lead-modal.js`) sends `lastPriceQuoted` on a **Demo** only and `originalContractPrice` on a
  **Sale** only; the other is blanked.

#### The two judgement calls (answered by the reporter, not inferred)

1. **The calculator goes out ONLY as `LFCalculator`** — web's spelling, and what web normalizes a
   stored `lfCalculator` back to on read (`result-lead-modal.js:193`). ⚠️ A lowercase alias holding
   the SAME object shipped briefly (the contract file and this repo's earlier note on
   `LeadHandler.submitJobBuilder` both name the lowercase key) and was removed on sight: *"same
   object sent in two different formats — make sure only upper case is sent"*. If the backend ever
   turns out to read the lowercase key, **rename** this one rather than adding the second.
   The *"lf calculator is not appended"* report was never about the key name — it was the missing
   document below.
   ⚠️ It is **never null** — web's last line before saving is *"ensure LFCalculator is at least an
   empty object for backend validation"*, so an absent calculator goes out as `{}`.
   ⚠️ `selectedAppointmentId` prefers the CALCULATOR's own `appointmentId`
   (web: `targetCalc?.appointmentId || formData.selectedAppointmentId`).
2. **`leadData.jobBuilder` is KEPT** — the one mobile-only key retained, so a backend that reads the
   build from `leadData.jobBuilder` rather than from the top-level `jobState` still gets it. Everything
   else listed above was removed.

#### Deliberately NOT changed

- **`_storageVersion` stays `1`.** The contract file shows `2`, but the real web capture shows `1` and
  it is the serializer's own constant — bumping it is a storage-format change, not a payload field.
- **`agreements[].type` is kept** (`{ name: '', file, type }`). The contract omits it; web's real
  traffic sends it, and it is what tells the backend which group a document belongs to on the non-Sale
  path, where agreements are filed AS order sheets.
- **`explain` is kept.** The contract file omits it (it was empty in their sample); web sends it and it
  carries the demo explanation.
- **The lead-scoped outcome mirror right after the POST is untouched** — it has no fixed contract and is
  what persists `versatile` / `pineapple` / the rest of the modal's fields, so removing them from the
  POST loses nothing. It now attaches the same resolved calculator document.
- **The legacy `screens/JobBuilder` submit** (non-dynamic, `isDynamic` false) builds its own payload and
  was left alone — different contract, and the ticket is about the dynamic flow.

Verified with 26 tests (`__tests__/screens/DynamicDealCenter/job-submit-payload.test.ts`) driving the
real builders against both references verbatim: `leadData`'s exact key list **in order**, every dropped
key asserted absent (modal-only and mobile-only), string money and `''`-not-`0`, the Sale/Demo
blanking, the field-name mapping (`downPaymentMethod` → `paymentMethod`), the server calculator copied
field for field with its `entries` array and `pricingAtTimeOfEntry` intact, the fallback producing the
same shape from a tab, the entries map flattened, the uppercase key carrying the document with **no
lowercase twin**, the `{}`-not-null fallback, the calculator's own `appointmentId` winning, every
wrapper shape the unwrap
accepts (and an id-less one rejected), the four document groups always present, and the
`configSnapshotId` → `'dynamic'` fallback. tsc identical to baseline; the new util is eslint-clean and
`DynamicJobBuilderScreen` drops from 3 errors to 2 (the removed `_dpm`/`_rawLF` unused destructure).

⚠️ **Needs a device confirmation of the response**, since this is the first submit to carry a real
calculator document — watch for a validation error naming `lfCalculator`.
---

### iPad: numeric fields get a DOCKED keyboard, not iPadOS's floating palette

Ticket: *"Change UI of number pad — it should be like 2nd image"*, against a screenshot of the Deal
Center calculator on an iPad with a small floating keypad sitting on top of the Gutters rows it was
meant to fill in.

⚠️ **Not a layout bug, and no prop moves it.** iPadOS renders EVERY "pad" keyboard type — `number-pad`,
`decimal-pad`, and `numeric`, which react-native maps to `UIKeyboardTypeDecimalPad` on iOS — as a
compact FLOATING key palette anchored beside the field, with the phone-keypad `2 ABC / 3 DEF`
lettering. The presentation is Apple's, chosen from the keyboard type alone. A NON-pad type is drawn
as the ordinary full-width keyboard docked at the bottom, and that is the only lever there is.

**New `src/utils/keyboard-type.ts`** holds the decision once: `NUMERIC_KEYBOARD` /
`NUMBER_PAD_KEYBOARD` resolve to `numbers-and-punctuation` on iPad (`Platform.isPad`, no new
dependency) and to the previous `numeric` / `number-pad` everywhere else. **33 inputs across 19 files**
read them, each also gaining `returnKeyType="done"` for the Done key — which doubles as the keyboard
dismissal these fields never had.

- ⚠️ **It is a FULL keyboard, so it carries a letters key.** That is safe ONLY because all 33 consumers
  already strip non-numerics in `onChangeText` (or `parseFloat` the value) — checked before the sweep.
  Do not point these constants at a field that stores raw text.
- ⚠️ **`RolloutView`'s drop-price input had to be DISARMED, and this is the one with teeth.** It commits
  on `onBlur` precisely *because* iPhone's number pad has no return key, so `onSubmitEditing` never
  fires there (its own comment says so). Give iPad a Done key and BOTH fire — Done submits, then blurs —
  so `openDrop` would run **twice for one tap**, on the very screen whose duplicate `dropPrice` rows
  this file documents at length. **`NUMERIC_KEYBOARD_HAS_RETURN_KEY`** gates that blur commit now; read
  it before adding any other blur-as-submit workaround to a numeric field.
- ⚠️ `CalculatorSummary`'s equivalent blur commit is **unconditional** (it already coexists with
  `onSubmitEditing` on Android), so it was left alone — iPad simply behaves like Android does there.
- ⚠️ **The two OTP screens are deliberately EXCLUDED** (`auth/email-otp`, `auth/authenticator-otp`).
  They already own per-box `returnKeyType`/`onSubmitEditing`, and a full keyboard behind six
  single-character boxes is worse than the palette.
- **iPhone and Android are untouched by construction** — the constants resolve to the previous string
  literals there, so the change is a no-op off iPad.

tsc 44 (baseline unchanged); eslint across all touched files **997 → 996 problems, zero added** (the one
removed is the camera fix below). ⚠️ Nine of the 19 files are CRLF — all endings were asserted
byte-identical to HEAD after the sweep.

### iPad: the camera viewfinder pushed the shutter button off the screen

Ticket: *"Screen cutoff on ipad — camera shoot button is not visible."*

`widgets/modals/CustomCameraModal.tsx` sized its 4:3 viewfinder from the WIDTH alone
(`screenWidth * (4 / 3)`) and never consulted the height, which silently assumes a phone:

| device | viewfinder | left for the bottom bar (needs ~200pt) |
|---|---|---|
| iPhone 14 Pro | 524pt | 249pt ✅ |
| iPad 10.9 | 1093pt | **43pt** |
| iPad Pro 12.9 | 1365pt | **−43pt** — the bar is off-screen entirely |

⚠️ **eslint had been reporting the cause for as long as the bug existed**: `'screenHeight' is assigned
a value but never used`. The layout destructured the screen height and then ignored it.

The viewfinder is now capped at the height that is actually left
(`screenHeight − viewfinderTop − insets.bottom − BOTTOM_CONTROLS_MIN_HEIGHT`), and **both** sides are
derived from whichever dimension binds, so the box stays a TRUE 4:3 and is centred rather than
stretched or cropped. On a phone the width still binds, so the geometry there is unchanged to the pixel.

- ⚠️ **iPhone SE was affected too** (427pt available against a 500pt viewfinder) — its shutter was being
  squeezed by the same sum, so this is a visible change on the smallest phones as well, not only iPad.
- ⚠️ **`Dimensions.get('window')` → `useWindowDimensions()`.** iPad allows landscape
  (`UISupportedInterfaceOrientations~ipad`), and the one-shot read never updated on rotation, so the
  viewfinder kept its portrait geometry after turning the device. The hook had to move ABOVE the
  `if (!visible) return null` early return.
- `BOTTOM_CONTROLS_MIN_HEIGHT` (200) is measured from the styles it protects — zoom pills (36 + 24),
  shutter row (76 + 5), section padding (12 + 12 + 20). Keep the two in step.

Verified by computing the geometry for seven device/orientation combinations: all four iPad
orientations now leave 220pt for the bar, and the three phones keep a viewfinder exactly as wide as the
screen. tsc 44 (baseline unchanged); eslint 17 → 16 problems, the removed one being the unused
`screenHeight` above.

### A CANCELLED addendum says so, instead of "once the customer approves it"

Ticket: *"My Deals > Incorrect Addendum Cancellation Message Displayed After cancel from Portal"* — the
message should read **"The Addendum PDF is unavailable because the Addendum was cancelled."**

`resolveAddendumTap` (`widgets/components/LeadCenter/AddendumsCard.tsx`) knew three outcomes and
`cancelled` was not one, so a cancelled row fell through the `!isDraftApproved(draft)` catch-all into
the PENDING message — which tells the rep to wait for a signature that can never arrive.

- **New `isDraftCancelled`** in `utils/addendum-drafts.ts`, the documented home for these predicates, so
  "cancelled" cannot come to mean different things on the three surfaces that read a draft's status.
- **`AddendumTapAction` gained `'cancelled'`**, placed **below the in-flight guard** — that guard still
  outranks every status test, for the reason recorded above (a second tap is a second Puppeteer run) —
  but ABOVE the approval test, which was swallowing the case.
- ⚠️ **Both spellings are accepted** (`cancelled` / `canceled`). The lead's own result status is the
  double-l one, but the funding backend already sends the single-l form for its terminal states.
- **The chip reads `Cancelled`, not raw lowercase `cancelled`** — the status was absent from `CHIP`, so
  it hit the verbatim fallback and sat next to a capitalised `Accepted`. Only the label changed; the
  colour is the exact grey the fallback was already painting.

Verified with 7 tests over the real functions: the repro **with the pre-fix `not-approved` outcome
asserted** so it cannot regress silently, all four spellings/casings, every other status unchanged, the
in-flight guard still winning, an id-less draft still inert, cancelled NOT counting as pending (so it
can never turn the contract header amber), and the chip. tsc 44 (baseline unchanged); eslint identical
to HEAD on both files.

### The Add-to-Job-Tracker modal clipped its own buttons

Ticket: *"Add This Job to Job Tracker modal scroll not working — from end it's hiding the button."*

`AddEditJobModal` had `<ScrollView className="px-8 py-8">`, i.e. the padding on the **ScrollView's own
style**. In react-native that pads the scroll FRAME — it shrinks the visible window without adding any
scrollable length — so the last 32px of content is permanently unreachable and Cancel / Add to Job
Tracker stayed clipped by the card's `overflow: 'hidden'` edge however far the rep scrolled. The list
was scrolling correctly; there was simply nowhere left to scroll to.

⚠️ **Padding on a ScrollView belongs on `contentContainerStyle`.** Moved there as the named
`styles.scrollContent` (same 32px, so the spacing is unchanged).

Also added **`keyboardShouldPersistTaps="handled"`**: the form has four text inputs above the buttons, so
without it the first tap on Cancel/Add with the keyboard up is swallowed dismissing the keyboard.

⚠️ The modal still has **no keyboard avoidance at all** — with the keyboard up the lower fields can sit
behind it. Separate from the reported bug; per §6 the repo's answer for a scrolling form is
`KeyboardAwareScrollView` from `react-native-keyboard-controller`.

tsc 44 (baseline unchanged); eslint byte-identical to HEAD (21 problems: 4 errors / 17 warnings).
⚠️ The file is CRLF.

### Annotation zoom persists into Draw — on BOTH platforms now (ticket 420)

Ticket: *"if i zoomed the image and then go to Draw the zooming will remain… this works fine on iOS but
in android it's not even zooming"*, plus *"in ios it disturbs the zoomed image position when i move to
Draw."* Two symptoms, one cause.

`widgets/components/LeadCenter/AnnotationCanvas.tsx` zoomed with a `ScrollView` carrying
`maximumZoomScale` / `minimumZoomScale` / `zoomScale`. ⚠️ **Those props are iOS-ONLY** — Android's
ScrollView has no pinch-zoom whatsoever, so the feature was silently absent rather than broken. And on
iOS, flipping `scrollEnabled` when the rep picked the pen re-laid out the content, which made
UIScrollView re-clamp its `contentOffset` and slide the image off the detail they had lined up.

**Rewritten as a reanimated TRANSFORM driven by `react-native-gesture-handler`**, reusing the tested
worklet maths from ticket 380 (`utils/zoom-transform.ts`) that `widgets/common/ZoomableImage` already
uses. The same gestures fire on both platforms, and switching tools touches none of the shared values,
so the position is preserved to the pixel — the iOS jump goes away by construction rather than by
patching the clamp.

- ⚠️ **The frame clips; the layer inside it transforms.** Scaling a view that carries its own
  `overflow: 'hidden'` scales the clip with it and lets the image paint over the chrome — hence a static
  frame wrapping an `Animated.View`.
- ⚠️ **The pan bound is the CANVAS, not the container.** `canvasLayout` is already the image's exact
  letterboxed box, so the drag stops at the image's own edge instead of sliding into the empty margin.
  This is the one place it differs from `ZoomableImage`.
- ⚠️ **Gestures are live ONLY in Zoom mode.** In Draw/Text the PanResponder overlay owns every touch
  exactly as before, so a one-finger drag still draws and the two systems never contend.
- **The existing `dx / scale` correction stays valid** because both platforms hit-test through the
  transform (iOS via the layer transform, Android via `TouchTargetHelper`'s inverse matrix), so
  `locationX` still arrives in canvas space.
- **`DraggableText` gained `zoomScale` + `dragEnabled`** — dragging a note while zoomed moved it
  `scale`× too far (the same bug the stroke layer already corrects), and a pinch landing on a note now
  pans instead of dragging it.
- **The zoom resets on Next/Prev**, so the rep never lands on a new photo already zoomed into wherever
  the last one was.

Verified with 6 tests driving the real helpers for this canvas's geometry: the anchor identity, the
`dx/scale` delta, the edge bound, 1x re-centring, the scale clamp, and a second pinch from an
already-panned state. tsc 44 (baseline unchanged); `DraggableText` and `ImageAnnotation/index.tsx`
identical to HEAD, `AnnotationCanvas` +1 `react-native/no-inline-styles`.

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
- **iPad is a supported form factor and it is NOT just "a big phone".** Two standing rules, both of
  which shipped as bugs (see the two iPad sections in §4): any numeric `TextInput` must take
  `NUMERIC_KEYBOARD` / `NUMBER_PAD_KEYBOARD` from `src/utils/keyboard-type.ts`, because iPadOS turns
  every "pad" keyboard type into a floating palette that covers the form; and any full-screen layout
  sized from `screenWidth` must be capped against the height that is LEFT, or its bottom controls end
  up off-screen. iPad also allows LANDSCAPE — prefer `useWindowDimensions()` over
  `Dimensions.get('window')`.
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

### Chat: job-change addendum lifecycle cards

Spec: **`SALES-APP-ADDENDUM-CHAT.md`** (repo root, 2026-08-12) — read it, it is the contract. The
lead chat now receives **general (sender-less) system messages** for the addendum lifecycle: the rep
proposed job changes, and the customer approved or declined them.

**Mobile emits nothing and calls no new endpoint to make these appear.** They ride the existing
`GET /chat/v1/:chatId/messages` and the existing `new-message` socket event; `ChatService.normalizeMessage`
spreads `...m`, so `metadata` already survives **both** paths with no service change. The entire ticket
is *rendering* plus the two View destinations.

⚠️ **There is no web ref to port from.** `grep -rl "JOB_CHANGE_ADDENDUM\|JobChangeMessageCard"` over
`mhalt-revDSM-sales-frontend` returns only `src/api/leads.js` — the sales web app has the two API
functions but not the chat card, so this was written against the spec. §8 of the spec names the web
files to mirror **once they land**.

**Three new files.**

- **`src/utils/job-change-summary.ts`** — pure, zero imports (no React, no RN, no date library).
  Detection (`getJobChangeMeta` / `isJobChangeAddendum` / `getJobChangeTitle` / `formatChatTime`) plus
  the whole diff (`buildJobChangeSummary`). Split out for the same reason as `utils/inspection-photos.ts`
  and `utils/pitch-book.ts`: the card and the modal both pull in RN and are untestable under jest here,
  so **every rule that can be got wrong lives in this file**.
- **`src/widgets/components/chat/JobChangeMessageCard.tsx`** — the row: round status icon, the
  server-authored line, outlined green **View**. ⚠️ The **timestamp sits ABOVE the card, centered**,
  not inside it — it reads as a chat time separator rather than card content, which is how web draws
  it. The first pass put it under the title inside the card and QA sent back the web screenshot.
  The card is a single vertically-centred row (icon | title | View), so the title wraps to two lines
  without pushing anything out of alignment.
- **`src/widgets/components/chat/JobChangeDetailsModal.tsx`** — the before/after, reading
  `LeadService.getDraftSummary` (`/lead/v1/job-builder-draft/{draftId}/public`, **no auth** — the same
  payload the customer's own consent page renders, which is the point).

`ChatDetail/index.tsx` wires them: **`renderMessage` short-circuits** to the card when
`getJobChangeMeta(props.currentMessage)` is non-null, and mounts `JobChangeDetailsModal` +
`PdfPreviewModal`. Both `GiftedChatAny` instances (iOS / Android branches) share that one
`renderMessage`, so a single change covers both.

⚠️ **Intercepting at `renderMessage` — before `<Message>` — is what drops the sender**, and that is the
whole failure mode the spec calls out. `senderId` is a *required, populated* user reference (so it can
never be a `"system"` sentinel), and **all three events carry the REP as the technical sender —
including the customer's approve/decline**, which arrives on a public no-auth endpoint where there is
no user at all. Rendering these through the normal path would draw
*"Customer has approved job changes"* as the rep's **own outgoing bubble**. Bypassing `<Message>` also
suppresses the avatar, me/them alignment, reactions, reply, edit, pin, the long-press menu and the
read-receipt row in one move, rather than teaching each of them an exception.

⚠️ **Gate on `metadata`, NEVER on the message text.** An unrecognised `metadata.type` (e.g.
`INSTALLER_JOB_STATUS_REQUEST`) returns `null` from `getJobChangeMeta`, so future event types degrade
to normal bubble rendering instead of rendering as a broken card.

**View is action-dependent, and deliberately so** (client-specified): `ACCEPTED` → the signed PDF
directly, no intermediate screen; `PROPOSED` / `DECLINED` → the changes screen. **Approved ⇒ PDF,
always** — including when the changes screen is opened from a `PROPOSED` card and the fetched draft
turns out to be `accepted` (the customer signed after the card was posted), which renders a short note
plus an "Open signed addendum PDF" button instead of change rows.

⚠️ **`addendumPdfPending` is BOTH the spinner and the double-tap guard.** `/amendment-pdf`
**generates the document on demand** for addendums approved before this feature existed, so two taps
mean two Puppeteer builds and two S3 uploads for one addendum. A `409` (draft not accepted) falls back
to the changes screen rather than dead-ending. The url is a short-lived pre-signed S3 link — fetched at
tap time, never cached.

⚠️ **The spinner is keyed on the MESSAGE id (`cardId`), not on `draftId`.** QA: *"when i try to view
approved changes loader should only show with approved card."* It shipped keyed on `draftId` and lit up
**two** cards. Not a rendering slip — one addendum posts up to three cards (proposed →
approved/declined) and **they all carry the same `draftId` by design** (§6), so the draft can never
identify which card was tapped. `addendumPdfPending` therefore holds `{ draftId, cardId }`: `draftId`
still de-duplicates the in-flight request (two taps on the two cards of one addendum ARE the same PDF,
so the second is correctly ignored) while `cardId` scopes the spinner. `JobChangeMessageCard` derives
`cardId` from `message._id` and hands it back through `onView(meta, cardId)`. The details modal has a
single button and no card to disambiguate, so it passes a `modal:<draftId>` sentinel and reads the
plain `pdfLoading` boolean.

⚠️ **Always `metadata.draftId` from the tapped card.** A lead can carry several addendums, each a
separate record with its own PDF, so *"the lead's addendum"* is never a valid lookup. Cards are **not
numbered** — the deal-details screen numbers them newest-first, so its numbering shifts whenever a new
one is raised and any numbering here would contradict it. Timestamps are the disambiguator. The server
de-duplicates per `(draftId, action)`, so no client-side dedupe is needed.

#### The four formatting rules are not optional

The two sides of a draft are **written by different screens**, so a naive comparison reports unchanged
values as changes — phantom edits on a document a customer signs. All four live in
`job-change-summary.ts`:

1. **Compare the FORMATTED values, not the raw ones.** `current.scheduleTime.date` may be `"7/21/26"`
   while `proposed` holds `"2026-07-21T…"` for the same day; `"14000"` vs `14000` likewise.
2. **Parse ISO dates as TEXT** — `ISO_DATE` reads the `YYYY-MM-DD` prefix with a regex. ⚠️ The string
   carries a **timezone offset**, so building a local `Date` shifts the calendar day: verified that
   `new Date('2026-08-03T00:30:00+05:00')` is **Aug 2** in `America/New_York` while the text parse is
   **Aug 3**. This is a date a customer signs — never route it through a `Date`.
3. **Normalise the time window before comparing.** `morning → 8:00 AM - 12:00 PM`,
   `afternoon → 12:00 PM - 4:00 PM`, whitespace collapsed, unicode dashes folded. ⚠️ That dash class is
   written as the **escape sequence** `/[\u2010-\u2015\u2212]/` — U+2010–U+2015 and U+2212 are visually
   indistinguishable from `-` in a diff, so a literal class is unreviewable (same family of trap as the
   `SCOPE_SEP` NUL rule).
4. **Strip raw authored ids** out of `buildChangeSummary[].changes[].field` — split on `·`, drop any
   segment matching `^(field|section|tab)_\d{10,}[\w-]*$`, rejoin; `"Job Build"` if nothing survives.

Two guards beyond the spec, both to avoid inventing a change: the **Schedule row is only emitted when
the PROPOSED side actually carries a `scheduleTime`** (a pricing-only addendum leaves it absent, and
absent means unchanged, not "changed to `—`"), and **money/time formatting is hand-rolled** rather than
`toLocaleString`/`toLocaleTimeString` so it cannot depend on Intl being compiled into the JS engine —
the same precedent set by `formatCaptureTime` in `utils/inspection-photos.ts`.

Balance Method renders as `GreenSky — 2521`, taking the provider from the **same side** of the draft so
a provider change still reads as a change. Legacy addendums carry `buildChangeSummary: null` — valid,
pricing and schedule only. `/public` 404 means the draft was hard-deleted: an error state with Try
Again, never a crash.

⚠️ **`DealDetail`'s own `DraftComparison` (`screens/DealDetail/index.tsx:638`) implements NONE of these
four rules** — it compares raw values and prints `ch.field` verbatim. That screen is currently
unreachable (see the My Deals section above), which is why it wasn't touched, but if it is ever revived
it should be pointed at `buildJobChangeSummary` rather than re-deriving the diff.

Verified with 29 tests over the spec's payloads verbatim: detection (incl. `metadata: null`, an unknown
`type`, a blank `draftId`, and asserting the text is never pattern-matched), all four rules with the
timezone case proven against naive parsing, the spec payload emitting exactly Contract Price + Install
Date + the Gutters/Roofline row while the four unchanged pricing fields stay out, provider prefixing,
the accepted/declined flags, `buildChangeSummary: null`, empty change groups skipped, the no-proposed-
schedule guard, and junk input as a no-op. tsc 44 (baseline unchanged); eslint 0 errors on all four
files, and `ChatDetail` byte-for-byte at its HEAD warning count (30).

### "Complete Job" took ~10 s — five SEQUENTIAL round trips, two carrying the same multi-MB docs

Ticket: *"Submitted job took like 10 seconds pls make it <1 second… i saw in debugger there is still
outcome api (old one) is calling, i think that's causing the issue."*

`handleComplete` was a chain of five blocking `await`s before navigation:

| # | call | why it was on the critical path |
|---|---|---|
| 1 | `logRolloutAndDropSummary` | activity log — **awaited, and FIRST** |
| 2 | `buildDocumentPayloads` | may re-`download` stored docs, then `convertJpegToPdf` each |
| 3 | `POST /lead/v1/{id}/job-builder` | the real submit — multi-MB base64 documents |
| 4 | `PUT /lead/v1/{id}/outcome` | the mirror — **the SAME multi-MB documents again** |
| 5 | `PATCH .../timeline-progress` | portal milestone flags |

**Two were removed from the critical path** (both now fire-and-forget with a `.catch`):

- **`logRolloutAndDropSummary` — exact web parity.** Web fires it **without `await`**
  (`TabbedCalculator.js:1103`); mobile awaited it *as the first step*, so a full activity-log round
  trip ran before the job was even sent. Nothing reads the summary synchronously.
- **`updateLeadTimelineProgress`** — portal milestone flags that nothing the rep is about to see
  reads, and it was the **last** blocking call before navigating. **Web makes no equivalent call here
  at all.** ⚠️ Navigating does not cancel it: nothing aborts the request and the JS context outlives
  the screen.

⚠️ **#3 and #4 were deliberately left sequential and awaited.** Web does the same
(`TabbedCalculator.js` ~L1086 `await updateJobBuilder(...)` after the POST) and its own comment reads
*"Non-fatal: the job is already submitted above"*. The mirror is what populates `jobBuilderDocuments`,
which is exactly what the Deal screen renders on arrival — racing or deferring it risks landing the rep
on a just-submitted deal showing **no documents**.

**The 3.73 s "Stalled" the reporter saw on the outcome PUT is almost certainly the logging bug fixed in
the section below.** `logTraffic` runs **synchronously inside the axios REQUEST interceptor, before
`return config`** — i.e. before the request is dispatched — and it was `console.log`ing the full
multi-MB body. "Stalled" measures precisely the gap between queued and sent, so a multi-MB console
write lands there. That trace predates `sanitizeForLog`.

### ⛔ REMOVED APP-WIDE: the bare lead-scoped `lead/v1/{leadId}/outcome`

Ticket: *"here is how i created the job from web and you can see no api is called with the name of
outcome… we replaced the outcome api with the new outcome api `…/outcome/{calculatorId}`. in mobile
there is still old outcome api is calling, which is causing some impact on the speed of the app, i
want you to remove that api in all over the app where it's using."*

**The endpoint is deprecated and 404s on device** — visible in the reporter's own mobile trace, where
every `outcome` row is red/404 next to a working `multiple`. Each call was a wasted round trip that
returned nothing. Web's submit PUTs to `/outcome/{calculatorId}`.

⚠️ **An earlier pass in this file kept the call, on the reasoning that it was the only write feeding
`jobBuilderDocuments`. That reasoning is superseded** — it was based on web's comment, but web's
`updateJobBuilder` is a *different* deployment's contract. The user supplied web + mobile traces.

**`LeadEndpoints.outcome`, `LeadService.getLeadOutcome`, `getJobBuilder` and `updateLeadOutcome` are
DELETED.** Deleting them (rather than editing call sites one by one) made every remaining usage a
**compile error**, which is what guaranteed the sweep was complete — **21 sites across 15 files**.

**New `resolveLeadCalculatorId(lead)` in `services/api/leads.ts`** is the single resolution helper (the
order the Lead Center already used: `selectedCalculatorId` → `calculatorId` →
`jobBuilder.calculatorId` → `outcome.selectedCalculatorId` → `leadData.selectedCalculatorId` →
`LFCalculator._id`). It returns `null` when the lead has no calculator, and **every call site skips the
request in that case** rather than falling back to the removed route.

Conversions, by kind:

| kind | sites | how |
|---|---|---|
| write | DynamicJobBuilderScreen, JobBuilder ×3, SummarySection, useDealOutcome, JobDocsSection | → `updateLeadOutcomeByCalculator`, guarded on an id |
| read | LeadCenter ×2, DealCenter, useDealOutcome, SummarySection, DynamicDealEditScreen, EditContractDetailsModal ×2, job-builder-auto-log | → `getLeadOutcomeByCalculator`, guarded on an id |
| **documents** | `outcome-documents.fetchLeadOutcomeDocumentRows`, `JobDocsSection` fallback | → **`downloadOutcomeDocuments`** |
| lead fields | Pitchbook, RooflineDeck | → **`getSalesDealById`** |
| dead code | `useUpdateLeadOutcomeMutation` | **deleted** — zero call sites |

⚠️ **`downloadOutcomeDocuments` (`…/outcome/documents/download`) is NOT the deprecated route and must
stay.** It is the *other* lead-scoped endpoint, web still calls it, and it returns the same
`{ agreements, orderSheets }` shape. That is what preserves the guarantee
`fetchLeadOutcomeDocumentRows` exists for: a **remotely signed agreement is filed lead-scoped** and the
calculator-scoped read cannot see it.

⚠️ **Pitchbook / RooflineDeck were never reading an outcome in any meaningful sense** — their
`fullLeadData` is used only for `salesPhotos` / `notes` / `customerDetails`, all of which live on the
lead. They now read the lead directly.

⚠️ **`fetchJobBuilderLoggedSections(leadId, calculatorId)` gained a required-in-practice second
argument** and returns the empty shape without one. Both callers (`JobBuilder`, `useOutcomeLogging`)
now pass one, **hoisted to a `loggedSectionsCalcId` const** so the `useEffect` dependency list can name
it — passing `calculators[activeIdx]?._id` inline tripped `react-hooks/exhaustive-deps`.

Verified: `grep` finds **no code reference** to the removed functions (only historical comments);
tsc 44 (baseline unchanged); eslint across all 16 changed files **112 errors — byte-identical to the
HEAD baseline**.

⚠️ **Needs device confirmation on the flows that changed shape**, since a calculator-scoped read can
legitimately return less than the lead-scoped one did: Lead Center auto-open Job Builder, Contract
Details edit + save, legacy Job Builder autosave / manual save, Deal Center "reset outcome", and the
Pitch Book / Roofline Deck notes + photos.

#### The lead-scoped outcome mirror no longer re-uploads documents

Follow-up: *"this outcome api is still calling while completing the job, is it has any purpose here?
because this api was replaced with the new outcome api `…/outcome/{calculatorId}`."* The trace showed
**27 requests, 308 MB transferred**.

**The endpoint has NOT been replaced.** Web still uses the lead-scoped
`PUT /lead/v1/{leadId}/outcome` for `updateJobBuilder` (`src/utils/axios.js:231`,
`jobBuilderUpdate`) and calls it in its own submit path; both variants exist on both clients. So the
call stays — but **its document attachment is now dropped**, which is where the cost and the duplicate
both came from.

**Why mobile must diverge from web here.** Web attaches the documents at submit because on web a
document *exists nowhere else until finalize*. **Mobile files everything eagerly**: a scanned document
is filed by `handleUploadDocs` the moment it is added (calculator-scoped
`PUT /outcome/{calcId}` — "that is what creates the LeadOutcomeDocument rows"), and a generated
agreement is filed by the `/sign` endpoint, which writes its own row. By submit time every document is
already a LeadOutcomeDocument, so re-sending the bytes only **filed a second row** — the duplicate in
section (c) above, proven by its 35-second-later timestamp and its empty `name` (which is exactly what
`buildDocumentPayloads` sends).

So dropping `agreements` / `orderSheets` from `outcomePayload` fixes the duplicate agreement **at its
source** and removes a multi-MB upload from the submit.

⚠️ **Do NOT remove the CALL itself.** It is the only write that persists the outcome **FIELDS** —
contract price, down payment, oneLeg, reason, explain, payment methods, `LFCalculator` — to
LeadOutcome. The eager calculator-scoped PUT sends only
`{ result, status, selectedCalculatorId, jobBuilder, docs }`. Those fields are what Contract Details
renders, so removing the call would blank them.

⚠️ **The `/job-builder` POST still carries the documents** (`documentPayloads` at lines ~1156-1157).
That writes the **JobBuilderDocument** collection — a different collection, which the display path does
not read — and it is web parity for the submit record. It is **not** the source of the duplicate: the
duplicate came back from `downloadOutcomeDocuments`, which reads LeadOutcomeDocument. Removing it there
is a separate question and would need its own evidence.

**Remaining cost.** One multi-MB upload still rides on the `/job-builder` POST, plus
`buildDocumentPayloads` re-downloading and re-converting each document. **<1 s is not reachable while
that holds** — the next lever is the native `convertJpegToPdf` (see the upload section below) and,
if it can be justified, dropping the documents from the POST too.

⚠️ **This is very likely the same defect as "(c) The backend files a SECOND agreement row on submit"
above.** That duplicate row has `name: ""`, an identical `fileData.size` and identical `base64Data`,
but a distinct `_id`/`filePath` — and `buildDocumentPayloads` emits exactly
`{ name: '', file, type }` (`document-payloads.ts:215`). A submit-time re-upload of bytes already
filed produces precisely that row. So dropping `agreements`/`orderSheets` from the outcome mirror
would plausibly fix **both** the duplicate agreement and roughly half the submit time — but it must be
confirmed first that the eager `handleUploadDocs` path files every document type in every flow
(scanned, generated/signed, edit-mode), because if it does not, `jobBuilderDocuments` comes back empty
and the agreement disappears from Contract Details. Not changed unilaterally.

### Order-sheet / agreement upload took ~18 s — multi-MB base64 was being CONSOLE-LOGGED

Ticket: *"Sales rep - Order sheet takes like 18 seconds to show it's uploaded… i checked the api
responses which are taking almost 3 to 4 sec, can you check i think there is something else issue."*
Correct diagnosis — the network was ~3–4 s of the 18 s. The rest was the JS thread, and most of it was
**logging**.

A scanned page becomes a base64 PDF (`convertJpegToPdf`) and is PUT as
`[rootKey][i].file`. For a normal phone photo that string is **~3.4 MB**. Two separate places then
logged it *in full*:

- **`DynamicJobBuilderScreen.handleUploadDocs`** — `JSON.stringify(docSubmitPayload, null, 2)`,
  pretty-printed, base64 included. ⚠️ Its two neighbours in the SAME file (`[COMPLETE JOB PAYLOAD]`,
  `[COMPLETE JOB — OUTCOME MIRROR PAYLOAD]`) already elide the bodies, with the comment *"stringifying
  multi-MB base64 for a log line is exactly the kind of heap spike that used to crash Submit"* — this
  one was simply **missed**. Now elided to `<base64 N chars>` the same way (measured: the logged string
  goes from **3.4 MB to 205 chars**).
- **`services/api/index.ts` › `logTraffic`** — the dev-only axios interceptors logged `config.data` and
  `res.data` verbatim, so the same 3.4 MB went to the console a **second** time on the request, and the
  document-download responses (which carry `base64Data` per row) went again on the way back. New
  **`sanitizeForLog`** replaces any string over 512 chars with `<string N chars>`, caps arrays at 20 and
  depth at 6. It only reads `.length`, so the big strings are never copied or scanned.

⚠️ **The cost is `console.log`, not `JSON.stringify`.** Building the 3.4 MB string is ~16 ms on V8;
what hurts is pushing it to the console — and with **React Native DevTools attached** (as in the
reporter's screenshots) every logged string is serialised across the **CDP websocket**. That is the
multi-second, invisible cost. Never log a document payload, a response containing `base64Data`, or any
request body that can carry a file.

**Still outstanding — `convertJpegToPdf` (`utils/jpeg-to-pdf.ts`) is pure-JS base64 on the JS thread.**
It `base64.decode`s the whole JPEG into a binary string, concatenates it with the PDF objects, and
`base64.encode`s the multi-MB result back — via the pure-JS `base-64` package, which loops per
character. Measured on V8/laptop: **~580 ms for a 2.5 MB JPEG** (decode 385 ms + encode 197 ms); Hermes
on-device is several times slower, and it **blocks the UI** — `handleScannerSave` only calls
`setScannerCategory(null)` *after* the upload resolves, so the scan sheet sits frozen throughout.

The fix is to assemble the PDF **natively** with `react-native-blob-util` file appends
(`writeFile(header,'utf8')` → `appendFile(jpegBase64,'base64')` → `appendFile(footer,'utf8')` →
`readFile('base64')`), which needs no base64 work in JS at all and has no chunk-alignment concern
because each append decodes its own chunk to bytes. ⚠️ **Not done yet because it makes the function
async**, and `document-payloads.ts › storedRowToPayload` is **sync**, plus there are three duplicated
local copies of `convertJpegToPdf` (`screens/JobBuilder/index.tsx`,
`widgets/components/job-builder/SummarySection.tsx`,
`widgets/components/LeadCenter/JobDocsSection.tsx`) — a 4-file change on the legal-document path, which
should not ride along with a logging fix.

⚠️ Do **not** "fix" this by pre-compressing the scan without asking: these are contract documents and
image quality is a business decision, not a perf knob.

### My Deals showed "No leads found" for ~10 s, and made a second API call web doesn't

Ticket: *"can you check it's taking time to open the lead, in web when open my lead only one api call
and it's open instantly, can you fix this issue?"* Device trace: `sales?page=1&limit=12` →
**15,719 kB, 10.69 s**, plus a second `sales?page=2&limit=12` → 0.1 kB, 308 ms. Web issues only the
first. Mid-load the screen showed the **empty state**, not a spinner.

Three separate causes; two are ours and are fixed, one is not.

#### (a) The page-2 request — a ref that lagged state by one render

`onEndReached` was guarded by `loadingRef` / `hasMoreRef`, both mirrored from state via
`useEffect(() => { loadingRef.current = loading })` — which lands a render **LATE**. FlatList fires
`onEndReached` on mount whenever the content is shorter than the viewport, and an empty list always is,
so the guard was still `false` when it fired and page 2 went out under page 1.

- `inFlightRef` (renamed from `loadingRef`) and `hasMoreRef` are now written **synchronously** inside
  `fetchDeals`, never through an effect.
- `onEndReached` **returns early when the list is empty**. Pagination off a list with nothing in it is
  never meaningful, and this is the belt to the braces above.

#### (b) The empty state during the load — one `loading` flag shared by two requests

This is what the rep actually saw. `showInitialLoader` is `loading && !refreshing && !leads.length`;
page 2's fast empty response hit `finally { setLoading(false) }` while page 1 was still downloading, so
the flag page 1 owned was cleared by a different request. `showInitialLoader` went false with `leads`
still `[]`, the `ListEmptyComponent` rendered, and My Deals sat on **"No leads found"** for the rest of
page 1's 10 s — then filled in.

Fixed with a **`requestIdRef` generation counter**: only the newest request may write state, and a
superseded one's `finally` clears nothing. A **new-filter/refresh** load is still allowed to start while
one is in flight (it supersedes), because blocking it would strand the screen on the previous tab's
results; only *pagination* is blocked.

#### (c) ⚠️ The response is 99 % base64 — and that part is SERVER-side

Measured on the reporter's own capture: a 12-deal page is **31 MB, of which 30.9 MB (99 %) is
`data:` URIs** — every deal's signed agreements and order sheets inlined as
`jobBuilder.dynamicJobState.agreements[0].files[0].blob` / `.url` / `.displayUrl`. `limit=12` is already
the smallest page the screen uses.

**No client change makes this fast.** Web is quicker on the same payload only because the browser's JSON
parse is native and it has more headroom — it downloads the same bytes. The real fix is for the list
endpoint to stop embedding document blobs (send `filePath`/`bucketName` and let the client sign on
demand, as every other document surface already does). Until then the 10 s is the payload.

#### ⚠️ …and the log sanitizer that was supposed to prevent this shrank it by 0 %

`sanitizeForLog` (added when the order-sheet upload was traced to `console.log`, section above) had a
depth bug that made it **completely ineffective on exactly this payload**:

```ts
if (!value || typeof value !== 'object' || depth >= LOG_MAX_DEPTH) return value;  // ← returns the SUBTREE
```

At the cutoff it returned the branch **verbatim and unvisited**, and the weight sits below it —
`data.leads[i].jobBuilder.dynamicJobState.agreements[0].files[0].blob` is depth 7. So every base64
document survived and went to `console.log`, which with React Native DevTools attached means pushing it
across the **CDP websocket**. Measured: **31.14 MB in → 31.14 MB out.** The cutoff now returns
`'<object>'` / `` `<array ${n}>` ``; the same response logs as **83 kB** (≈375× smaller).

**Moved to `src/utils/sanitize-for-log.ts`** so it is testable — `services/api/index.ts` pulls in MMKV
and cannot be imported under jest, which is precisely why this shipped untested. Reach for the util; the
axios module just imports it.

⚠️ This is dev-only (`if (!__DEV__) return`), so it never affected release builds — but every trace the
team captures is a dev build, so it inflated the very measurements used to diagnose (a) and (b).

Verified against the reporter's capture driven through the REAL function: 31.14 MB → 82.9 kB with no
`data:image` surviving, a deep subtree replaced by `<object>`, a deep array labelled `<array 3>`, long
strings truncated while short ones stay verbatim, arrays capped at 20 with the remainder marker,
primitives/null/undefined untouched, the input left non-destructively intact, and a 5 MB string handled
in <200 ms (proving only `.length` is read). tsc 44 (baseline unchanged); `sanitize-for-log.ts` and
`services/api/index.ts` are eslint-clean and `MyDeals/index.tsx` is byte-identical to its HEAD baseline
(27 warnings, 0 errors).

⚠️ **(a) and (b) still want a device check** — they are render-timing behaviours and the repo cannot
render-test (see the `ToolsSection` note above). Expect: ONE `sales?page=1` request, a spinner rather
than "No leads found" throughout, and page 2 only on an actual scroll to the bottom.

### `FlashMessage.show()` rendered a TRANSPARENT banner for every non-danger type

Ticket: *"when i click on edit splash message is not visible, looking like it's picking the header
color"* — the Lead Center "Edit on web" notice (`FlashMessage.show(..., 'info')` for a legacy deal)
appeared as white text painted straight onto the dark green `MainHeader`, with no banner behind it.

The bug is in the shared wrapper **`src/config/message.ts`**, not at the call site. `show()` built its
style as:

```ts
style: { zIndex: 9999, elevation: 9999, backgroundColor: type === 'danger' ? '#D32F2F' : undefined }
```

`react-native-flash-message` resolves the type colour into its own style array and then applies **our
`style` last** (`node_modules/react-native-flash-message/src/FlashMessage.js` ~line 224), and RN's
style flatten lets a **present-but-`undefined`** key win over an earlier value. So for `info` /
`success` / `warning` the explicit `undefined` **wiped `ColorTheme[type]`** and the banner rendered
with no background at all. Verified directly: flattening `[{backgroundColor:'#2196F3'}, {…,
backgroundColor: undefined}]` yields `undefined`; dropping the key yields `#2196F3`.

Fixed by **spreading the key in only when it has a value** —
`...(type === 'danger' ? { backgroundColor: '#D32F2F' } : null)`.

⚠️ **Never write a conditional style value as `x ? v : undefined` in an object handed to a library that
merges it last.** The ternary reads as "leave it alone" and does the opposite. Spread the whole key or
omit it.

This fixed **all three** non-danger `show()` call sites at once — `LeadCenter` (Edit on web),
`DealDetail` (same notice) and `AppointmentSchedulerModal` ("Amendment requires customer signature") —
which is why the wrapper was fixed rather than the reported call site. `FlashMessage.success` /
`warning` / `info` / `error` were never affected: they either don't set the key or set a real value, so
`FlashMessage.info(...)` was always the working path.

### Dynamic (portal-authored) Pitch Books

Ticket: *"Portal | Dynamic Pitch Books — PDF Upload and Image Parsing… I think in Lead Center screen
(Pitch book card) there should be arrow down and up option which show the list of pitch, on selecting
the one we will take the id of that pitch book and show the data inside pitchbook accordingly."*

The portal half (bulk PDF upload → parse pages to images → sections → publish) is a separate repo;
this is the **rep-facing consumption** half. A manager can now publish several books, so the rep picks
one instead of always getting the bundled deck. **The web app has no pitch-book API client yet**
(`grep pitch-books` over `mhalt-revDSM-sales-frontend` is empty), so unusually there is **no web ref
to port from** — this was written against the documented endpoints and their sample payloads.

**Two endpoints, both company-scoped by the JWT and both PUBLISHED-only:**
- `GET /pitch-books/sales-rep[?documentType=pitch_book]` → `{ data: { books: [...] } }` — id, name,
  `slideCount`, and a `thumbnail: { filePath, bucketName }`.
- `GET /pitch-books/sales-rep/:bookId` → `{ data: { book, sections: [...] } }` — sections ordered by
  `sectionSortOrder`, each holding slides ordered by `sortOrder`.

⚠️ **Slides arrive as `{ filePath, bucketName }`, NOT urls.** They must be exchanged for pre-signed
urls via `LeadService.getSecureUrls` before an `<Image>` can render them.

Three new files:

- **`src/services/api/PitchBookService.ts`** — the two GETs, in the `InspectionService` house style.
- **`src/utils/pitch-book.ts`** (pure, zero imports) — `normalizePitchBookSections`,
  `collectSlideRefs`, `buildPitchBookDeck`, `normalizePitchBookList`. Split out for the same reason as
  `utils/inspection-photos.ts`: the hook and screen pull in RN, this doesn't, so the logic is testable.
- **`src/hooks/usePitchBooks.ts`** — `usePitchBooks()` (list + batched thumbnail signing) and
  `usePitchBookDeck(bookId)` (one book, slides signed in **one batched call** via `collectSlideRefs`).
  Both cache for **50 minutes** — pre-signed urls expire at 60, the same window `useSecureUrls` uses.

**The key design decision: a remote book is projected into the STATIC decks' shape** —
`categories: [{ id, label }]` + `images: { [categoryId]: { [slideName]: source } }`. `<Image source>`
takes both a `require()` number and `{ uri }`, so once the projection is done **every** downstream read
in `Pitchbook/index.tsx` (slide counts, `getGlobalPosition`, `getCurrentSlideName` analytics, the
fullscreen portrait AND landscape viewers) works against either deck with no per-site branching.

`Pitchbook/index.tsx` now takes **`bookId` / `bookName`** nav params (`RootStackParamList` updated).
With no `bookId` it behaves exactly as before — bundled LeafFilter deck, or the Green Rooflines
company deck. With one, `CATEGORIES` / `pitchBookImages` / `defaultCategoryId` come from the fetched
deck instead. Also:

- **Saved progress is keyed by book** (`pitchbook-progress-{leadId}-{bookId}`) — one shared key would
  restore a rep into a section that doesn't exist in the book they just opened. The default deck keeps
  the old un-suffixed key, so existing saved positions survive.
- **Two reconcile effects.** A remote deck's sections aren't known at mount, so `activeCategory` starts
  `''` and the first effect lands it on the saved-or-first tab once the fetch resolves. The second
  clamps `currentSlideIndex` into range. Both also cover a book **edited on the portal** since the rep
  last presented it (tab deleted / section trimmed) — otherwise the rep opens onto a blank frame with
  working arrows.
- **The persist effect skips an empty `activeCategory`**, or the first render of a remote deck would
  immediately overwrite the position saved on the previous visit.
- **One early return** handles loading / error (with Try Again) / nothing-published, placed after all
  hooks and before the main `return`. Gating the whole screen covers all four slide render sites at
  once; teaching each an empty state would be four chances to miss one.

`ToolsSection`'s Pitch Book `ToolCard` became **`PitchBookCard`** (same file): the familiar row plus a
**chevron-down/up** that expands the published list in place (thumbnail, name, `N slides`), each row
navigating with its `bookId`. `LeadCenter`'s `onShowPitchbook` now takes an optional book.

⚠️ **With nothing published — or a failed list read — one tap opens the bundled deck, exactly as
before.** The dynamic list is strictly additive; a company that hasn't configured any book, or a rep
with no signal, must never end up with no pitch book at all. Same reasoning inside the normalizer: a
slide whose url can't be signed falls back to the bare S3 url rather than being dropped.

Deliberate drops, both because a blank frame mid-pitch is worse than a shorter deck: a **section with
no slides** (a legitimate portal state — created, not filled) and a **slide with no `filePath`**.

⚠️ **Two slides in one section CAN share a `slotDisplayName`** — the portal derives it from the
uploaded file name, and two PDFs both yield "Page 1.jpg". The images map is keyed by name, so
`uniqueName()` suffixes duplicates (`Page 1.jpg (2)`); without it a page vanishes from the deck with
no error anywhere.

#### Follow-up: a failed list read was indistinguishable from "none published"

QA: *"i don't know where do you make the changes, nothing showing here, i even i check api is not
calling here /pitch-books/sales-rep."* The card WAS the new one (its subtitle only exists in the new
code; the old `ToolCard` had none) — but it read **"Present the standard deck"**, which was the single
subtitle for *every* non-loading empty state.

That was a real defect in the fallback above: `data: books = []` swallows an error, so a **404 / 403 /
unreachable endpoint looked exactly like a correctly-working card for a company with nothing
published**, with no way to tell which — including for whoever is debugging it.

- **Three distinct subtitles now**: `Loading pitch books…` / `Couldn't load pitch books — tap ↻ to
  retry` (on `isError`) / `No pitch books published — standard deck`.
- **A retry button rendered OUTSIDE the row's press target**, so tapping the row still opens the
  bundled deck — a rep mid-pitch must never be blocked by a failed list read.
- **Both `queryFn`s log the failure in `__DEV__`** (`[pitchBooks] list FAILED <status> <body>`) and the
  list logs its count on success. The axios wrapper already prints `[API] → GET /pitch-books/sales-rep`
  for every request, so the pair isolates "never requested" from "requested and rejected".

Service layer verified separately (module callable, `/pitch-books/sales-rep`,
`?documentType=pitch_book`, and the `:bookId` detail path) — a failed import would present as "no
request", so that was ruled out explicitly.

Verified against the ticket's payloads verbatim: section/slide ordering (including a payload whose
sections are out of order and a slide pair whose `sortOrder` reverses them), ties keeping server order,
duplicate display names keeping both slides, empty/malformed sections and slides dropped, the
`slotKey` → `Slide N` name fallbacks, section label falling back to its id, ref de-duplication across
sections, an unsignable slide skipped and its section dropped when that empties it, the list
normalizer with and without a `thumbnail` block, and junk input (`undefined` / `null` / `{}`) as a
no-op throughout. tsc 44 (baseline unchanged); eslint on `Pitchbook/index.tsx` back to its HEAD
baseline of 13 pre-existing errors, and the three new files are clean.

### Pitch Book slides pinch, double-tap and drag to zoom (ticket 380)

Ticket: *"Pitch Book | need pinch and pull to zoom — you have to add zoom out zoom in
functionality which we normally have while pinching."* A slide was a plain `<Image>` with
`resizeMode="contain"`, so the fine print on a deck page (the confidential footer, a spec
table) could not be read on a phone and there was no way to get closer to it.

**New `src/widgets/common/ZoomableImage.tsx`** — a drop-in replacement for `<Image>` with
the standard photo-viewer gesture set: **pinch** (anchored to the fingers), **double-tap**
(toward the tapped point, and again to reset) and **drag** while zoomed. Wired into **all
three** places a slide is painted — the inline card, and the fullscreen viewer's **portrait
AND landscape** layouts — so the gesture is there wherever the rep sees the slide.

`source` is an `ImageSourcePropType`, so the bundled `require()` decks (LeafFilter, Green
Rooflines) and a **portal-authored `{ uri }` book** both work with no branching at the call
site — the same property that let the dynamic pitch books be projected into the static decks'
shape in the first place.

⚠️ **`RooflineDeck` was NOT named in the ticket and is fixed too.** Its three slide render
sites are the same code (differing only in `?.src` on the source), so fixing only the
reported screen would have left the other half of the presentation flow without the gesture —
the same reasoning as the inspection-photos ticket.

#### The two things that had to be right

⚠️ **A `Modal` is its own native view tree on Android**, so the app-root
`GestureHandlerRootView` in `App.tsx` never reaches it and **none of the gestures fire in
fullscreen** — which is the surface the ticket's screenshot shows. Both fullscreen modals
now wrap their content in their own `GestureHandlerRootView` (`ImageGalleryModal` already
does this for the same reason). In `Pitchbook` it replaced the modal's existing root `View`;
`RooflineDeck` had no wrapper at all, so one was added.

**Pan is enabled ONLY while zoomed.** At 1× a drag still belongs to whatever surrounds the
image, so nothing this component does can swallow a scroll or a pager swipe. (The pitch book's
own slide area is not inside a scroll view — the main layout is a fixed flex column — but the
component is shared and must not depend on that.)

**`resetKey={`${activeCategory}:${currentSlideIndex}`}`** snaps back to 1× on every slide
change. Without it a rep advances mid-pitch and lands on the next slide already scrolled to
some corner of the previous one's zoom.

The wrapper **clips** (`overflow: 'hidden'`), so a zoomed slide can never paint over the page
counter, the ✕, the arrows or the category tabs — all of which are absolutely-positioned
siblings rendered after it, so they still take their taps first.

#### The maths lives in the pure `src/utils/zoom-transform.ts`

`clampZoomScale` / `panBound` / `zoomOrigin` / `anchoredTranslate` / `doubleTapTranslate` /
`clampPan` — for the reason `utils/addendum-drafts.ts` and `utils/inspection-photos.ts` exist:
the component pulls in react-native + reanimated and cannot be loaded under jest here, and
these six expressions are the whole of what can be **silently** wrong. An anchor that drifts
or a bound that lets a zoomed slide be flung off screen both present as "the zoom feels
broken" and neither throws.

- **Coordinate system**: offsets are SCREEN pixels from the CENTRE of the image box, because
  that is how RN's `transform: [translateX, translateY, scale]` composes — the content scales
  about its own centre first, then translates in parent units. A point `origin` from the centre
  lands at `origin * scale + translate`, which is the identity every test asserts against.
- **Anchoring** solves that for `translate`: `t = focal − origin × scale`, with
  `origin = (focal − t_prev) / scale_prev` captured once at `onStart`. Capturing the origin from
  the PREVIOUS transform is what makes a second pinch — one that starts from an already-panned,
  already-zoomed state — stay under the fingers instead of jumping.
- **`panBound` is 0 at 1×**, which is what re-centres the slide when the rep pinches all the way
  out; no separate "snap back" branch is needed.

⚠️ **Every export carries the `'worklet'` directive** so the gesture callbacks can call it on
the UI thread; they stay ordinary functions on the JS thread, which is what keeps them testable.
**This is the repo's first cross-file worklet** (every other one is an inline closure the plugin
auto-workletizes), so it was verified rather than assumed: running the project's own babel
config over both files shows **6 worklets in the util and 7 in the component**, each component
callback capturing the helpers by name in its `__closure`. The plugin is present via
`nativewind/babel` → `react-native-css-interop/babel`, which registers
`react-native-worklets/plugin` unconditionally — it is **not** in `babel.config.js`, so don't
conclude from that file that worklets are unprocessed.

Verified with 16 tests driving the real helpers: the anchor identity (`origin × scale + t`
returning the focal) from fit, from an already-panned 2× state, and back down to 1× where it
re-centres; the clamp winning over the anchor when honouring it would pull the image's own edge
inside the box, alongside the case that needs no clamp (a pinch from fit lands exactly ON the
bound); double-tap zooming toward the tap rather than the centre, a centre tap staying centred,
and a corner tap staying in bounds; the pan following the finger, pinned at both limits, and
inert at 1×; the scale clamped at both ends; and a zero scale not dividing by zero. tsc 44
(baseline unchanged); both new files eslint-clean, `Pitchbook/index.tsx` 12 errors / 56 warnings
vs a HEAD baseline of 12 / 55 and `RooflineDeck/index.tsx` 11 / 55 vs 11 / 53 — the added ones
are all `react-native/no-inline-styles`, the rule both files already carry 50+ of.

⚠️ Needs a device check for the gesture feel itself (this repo cannot render-test): pinch and
double-tap in **fullscreen portrait, fullscreen landscape and the inline card**, that the arrows
and ✕ still take their taps over a zoomed slide, and that advancing a slide resets the zoom.

### Inspection slot tick moved INSIDE the label (ticket 384)

Ticket: *"The checkmark icon is absolutely positioned and vertically centered on the full
button height… on two-line labels (like 'Roof Penetration / Vent Area') the icon drifts away
from the text and ends up sitting near the button's edge instead of next to the label. This
appears on BOTH iOS and Android."*

The pill is `SlotButton` in **`widgets/components/lead-center/DynamicInspectionRenderer.tsx`**
(not `DynamicInspectionView.tsx`, which the ticket names — that screen renders `CategoryBody`
from the renderer). It is the ONE slot pill behind every layout — `PillGrid`, `CompassLayout`
and the chip selector's nested bodies — and `DynamicMovePhotoModal` renders the same
`CategoryBody`, so a single fix covers the tag flow and the move flow.

⚠️ **Nothing was absolutely positioned** — the tick was already a flex-row sibling
(`alignItems: 'center'`, `gap: 4`). The reported drift has a different cause, and it is why the
prescribed fix would only have half-worked: **a wrapped `Text` takes the full width it was
measured against**, so on a two-line label the label's box spans the whole pill, pinning the
sibling tick to the left edge, and `alignItems: 'center'` then parks it vertically between the
two lines. `alignItems: 'flex-start'` would have lifted it to line 1 and **left it at the edge**,
which is the half the screenshot circles.

**The tick is now the first glyph of the label itself**, so there is no second box to drift:

```tsx
<Text numberOfLines={2} style={{ flexShrink: 1, textAlign: 'center', … }}>
  {filled && !isMoveSource && <Icon name="check" size={13} color="#fff" />}
  {filled && !isMoveSource ? ' ' : ''}
  {isMoveSource ? `FROM · ${slot.name}` : slot.name}
</Text>
```

- **This is what the STATIC flow already does** — `LeadCenter/TagPhotoModal.tsx:600` builds
  `` `✓ ${displayName}` `` as one string, which is exactly why that surface never had the bug.
  The dynamic view now matches it.
- **`Icon` renders a `Text`**, so nesting is legal, and `create-icon-set` applies
  `fontWeight: 'normal'` as a style OVERRIDE — the glyph cannot be synthetically bolded by the
  label's `fontWeight: '600'`, so it looks identical to before. (Checked in node_modules rather
  than assumed; that override is what makes the nesting safe.)
- **The row keeps `alignItems: 'center'`.** With the tick inline, that only governs the upload
  spinner and the `photos.length` count badge, and centring those against the label block is
  right — `flex-start` would push the badge to the top of a two-line pill.
- `flexShrink: 1` on the label so the badge can never push it out of the pill.

Single-line pills are unchanged: the run `✓ Roof Edge — Left Side` centres as one piece, where
before the icon+label pair centred as a group with the same 4px gap.

tsc 44 (baseline unchanged); eslint on the file identical to HEAD (63 problems, 0 errors).
⚠️ Needs a device check — this repo cannot render-test, and the whole ticket is layout.

⚠️ **`DynamicInspectionRenderer.tsx` is a CRLF file** (927 lines). Editing it with a script that
reads/writes in text mode rewrites every line to LF and buries the change in a whole-file diff.
Use `newline=''` on both ends. (Same trap as `EditCustomerModal.tsx` and `dynamic-deal-diff.ts`;
check `file <path>` before and after — the diff here is 10 insertions / 1 deletion.)

### ✅ ROOT CAUSE: mobile's drop-price payload was a SUBSET of the server's array

Ticket: *"while adding or declining the drop price, from mobile when i add the drop price it's
saving duplicate. issue is in the mismatch of the payload"*, then, decisively, the two payloads
for the same calculator side by side: *"a huge difference it should be same like web."*

**Two facts about `dropPrice` explain everything, and they compound:**

1. It is a **subdocument array**: a row arriving WITH an `_id` updates that row, a row without one
   is **filed as new**.
2. The backend **merges rather than replaces**, so a row the payload OMITS is not deleted — it
   survives on the server, invisible to the rep.

Web sends the server's array **verbatim, every row, each with its `_id`**, plus the one new
id-less round:

```json
{"dropPrice":[{"_id":"6a86b180…","dropedPrice":10000,…,"balance":0},
              {"_id":"6a86b18a…","dropedPrice":10000,…,"balance":10000},
              {"_id":"6a86b688…","dropedPrice":8000, …,"balance":0},
              {"_id":"6a86b6a7…","dropedPrice":8000, …,"balance":8000},
              {"_id":"6a86b7ce…","dropedPrice":9000, …},
              {"_id":"6a86c408…","dropedPrice":9999, …},
              {"dropedPrice":8888,"status":"accepted", …}]}   ← only the new round is id-less
```

Mobile sent **four rows for the same calculator** — one per distinct price, three ids, and the
just-entered 9999 id-less **even though the server already held a 9999 row**. So each save both
hid three rounds from itself and filed a fresh copy of the one it had lost track of.

#### Fix 1 — adopt the `_id` the server assigns

`flushSave` discarded the PUT response, so a round entered and then secured was saved id-less
twice and filed twice. Three pure helpers in `utils/drop-prices.ts`:

| | |
|---|---|
| `toDropPricePayload(drops)` | web's exact row shape, **`_id` included** |
| `readServerDrops(response)` | the `dropPrice` rows out of whatever the API wraps them in |
| `adoptServerDropIds(local, serverRows)` | copy each server `_id` onto the local row it belongs to |
| `idlessDropSignature(drops)` | bounds the fallback read below |

`flushSave` and `saveDisplacedSiblings` both adopt from their response. Adoption is deliberately
**not marked dirty** — `_id` is absent from `tabSignature`'s `dropSig`, so it cannot mark the tab
dirty, schedule a save, or make an in-flight save look superseded.

⚠️ **Matching is by (price, status) among unclaimed server rows, NEVER by index.** On an
already-corrupted record the server array is LONGER than the one we sent, so index alignment is
exactly the assumption that cannot hold. Each server row is claimed at most once; an unmatched row
is **left id-less**, because one more duplicate costs a row while a WRONG id overwrites another
round. This is the rule `useCalculatorSummary.saveDropPriceToServer` already used in the CLASSIC
deal center — which is why the duplicate was dynamic-only.

**A bounded fallback read.** The PUT does not always echo the calculator back (the classic flow
re-reads for the same reason), so a response carrying no `dropPrice` triggers one
`getCalculator(tabId)`. `dropIdFetchTried` spends **at most one GET per distinct set of id-less
rows**, so a deployment whose PUT never echoes cannot turn every debounced save into a request.

#### Fix 2 — ⚠️ STOP COLLAPSING THE LIST. This is the half that made it "still same"

Fix 1 alone did not close the ticket, and the second payload is why: `collapseDropsByPrice` kept
**one row per price** on the write path, the read path AND every local update. Web keeps every
round — its array holds two 10000 rows and two 8000 rows, because entering a drop and then
actioning it are two records.

That collapse is what produced the 4-vs-7 mismatch, and it also **re-created the id-less row**:
merging the rep's freshly-entered 9999 with the server's existing 9999 could keep the copy without
the `_id`, so the next save filed a second 9999. A helper written to hide duplicates was
manufacturing them.

- `collapseDropsByPrice` is **DELETED** — no call sites remain, and leaving a row-removing helper
  in that file is the trap this ticket was about.
- `dedupeDrops` is **off both paths**, surviving only as `RolloutView`'s local double-tap guard.
  ⚠️ Its signature does not include `_id`, so on a save it could drop a genuinely distinct server
  row; never reintroduce it to a hydrate or a payload.
- `normalizeSingleAcceptedDrop` **stays on both paths** — it is web's single-accepted invariant and
  is safe precisely because it rewrites a STATUS rather than removing a row.

Also `toDropPricePayload` drops mobile's redundant **`price` mirror** (it duplicates `dropedPrice`
and is not part of the stored shape; every local reader already falls back `price ?? dropedPrice`),
and `openDrop` now seeds the entry row's **`paymentMethod` from the calculator** — web's entry rows
read `"paymentMethod":"check"`, mobile's read `""`.

⚠️ **`paymentMethods` (plural) is KEPT** though web does not send it: `DropOutcomeModal` re-opens a
declined drop with those financing plans still added, so stripping it for exact parity would lose
that state on reload. Omitted when empty rather than sent as `[]`.

⚠️ **Expect existing test leads to show MORE rows than before.** Those rows are real and already on
the server — web lists them too; mobile was hiding them while still leaving them there to be
duplicated. A record corrupted before this fix does not self-heal, because healing means DELETING
server rows and nothing on this screen may do that.

Verified with 32 tests driving the real helpers over both of the ticket's payloads verbatim: the
web array reproduced row-for-row with only the new round id-less; both same-price rounds kept; no
server id ever omitted; the old collapse asserted to yield exactly the 4 rows the ticket reported,
so the regression cannot return silently; the single-accepted rule rewriting a status without
losing a row; the entry row's seeded method; the `price` mirror gone and `paymentMethods`
kept/omitted; the `_id` surviving the write path; **the adoption repro** — the same round asserted
id-less on the second save before adoption and carrying its id after; price+status matching
preferring the accepted row at a shared price, the price-only fallback, no id used twice, an id
already held never re-issued, an unmatched row left alone, id-less server rows ignored, adoption
against a longer/misaligned array, same-reference return when nothing changes; the full
enter→save→adopt→secure→save round trip leaving SEVEN rows with the new one updated in place; and
the fallback guard's signature emptying once every row is filed. tsc 44 (baseline unchanged);
`drop-prices.ts` and `useDynamicCalculators.ts` eslint-clean, `RolloutView.tsx` identical to HEAD
(270 problems, 2 errors).

⚠️ Needs a device check of the one thing tests cannot see: **whether the PUT response echoes
`dropPrice`.** Watch for one `PUT /lfcalculators/{id}` per drop action, at most one
`GET /lfcalculators/{id}` after the first, and a payload whose `dropPrice` is the server's array
plus the new round.

#### …and the follow-up that closed it: no save on OPEN, and a payload of only `dropPrice`

Ticket, with a device trace of a `PUT /lfcalculators/{id}` fired while the drop sheet was merely
open: *"still in backend duplicate secure price is going to create, i think the main issue is we are
calling the api 2 times, when this modal open no need to call the api, api will call on the basis of
selecting the 2 buttons Decline and Secure this price… also we only sending the changed data in the
payload like web, but you are taking the extra things."* Both correct.

**1. Opening the drop sheet wrote a row.** `openDrop` persisted the entered price as a `declined`
row the instant it was typed — a deliberate earlier requirement (*"a drop must be SAVED THE INSTANT
it is entered"*), now reversed by the same reporter. So one decision cost two writes: the twin on
open, then the real row on Secure/Decline. `openDrop` now only sets `pendingDrop` and shows the
modal; the row is created by the action the rep actually takes.

Two things fell out of that and had to go with it:
- ⚠️ **`resolveDropTargetIndex`'s scan for an existing row at this price is REMOVED.** It existed to
  convert the pre-persisted twin. With nothing pre-persisted it would silently fold a genuinely new
  round into an older one at the same price — and web keeps both (its array holds two 10000 rows).
  `pendingDropIndex` alone decides: set when a row is re-opened via **Display** (edit in place),
  `-1` for a fresh round (append).
- ⚠️ **The double-tap guard moved from `dedupeDrops` to the BUTTON.** `DropOutcomeModal` now accepts
  one Decline/Secure per opening (`submitted` ref, reset on `visible`). A guard that DELETES rows is
  the very thing that made mobile's list a subset of the server's, so it cannot live on this path.
  **`dedupeDrops` is deleted** — no call sites remain.

**2. Drops now PUT `{ dropPrice: [...] }` and nothing else.** New `saveDropsNow` in
`useDynamicCalculators` fires on the rep's action, and **`dropPrice` is gone from `buildPayload`** —
the debounced whole-calculator save no longer carries it as a passenger. One writer, one payload,
byte-comparable with web's.

- **`tabSignature` no longer fingerprints drops.** With drops off the debounced path, a `dropSig`
  would only mark the calculator dirty and fire a second, redundant whole-calculator request for a
  change already persisted.
- **`markDirty` is NOT called** by `handleSetDrops`, for the same reason.
- **One request per calculator at a time**, with a newer list queued behind an in-flight one
  (`dropSaveInFlight` / `dropSavePending`). Every request sends the WHOLE array, so latest-wins is
  safe and a failed request is healed by the next drop action; **one** immediate retry covers the
  transient case.
- The response is fed straight to `adoptDropIds`, so the round's `_id` is adopted from the very
  request that created it.

⚠️ The rollout log's `lastDroppedPrice` still reads the entry BEFORE the target — its arithmetic is
unchanged and still correct, but for a different reason: a new round is no longer in `drops` at log
time, so its predecessor is the LAST existing entry (`drops.length - 1`), while an edited row's is
the one before it. The comments were rewritten; don't "fix" the index.

Verified with 9 further tests over the same rows: the body having exactly one key (`dropPrice`);
every row sent with its `_id` and only the new round without; **opening the sheet leaving the list
byte-identical**; Secure and Decline each appending exactly ONE row where the old flow left a twin
beside it; a new round at an already-tried price staying its own row while **Display** still edits in
place; the full open→Secure→adopt→re-secure round trip updating the same row; and a second Secure
demoting the first by status while keeping both rows. tsc 44 (baseline unchanged); `drop-prices.ts`
and `useDynamicCalculators.ts` eslint-clean, `RolloutView.tsx` identical to HEAD (270 problems,
2 errors).

⚠️ On device this should now read as **exactly one `PUT /lfcalculators/{id}` per Decline/Secure,
none on opening the sheet**, with a body of `{"dropPrice":[…]}`.

⚠️ **All three files are CRLF** (`drop-prices.ts`, `useDynamicCalculators.ts`, `RolloutView.tsx`).
Use `newline=''` on both ends — same trap as `dynamic-deal-diff.ts` and `EditCustomerModal.tsx`.


### Recent Leads chat opens on "All", not "Unresulted Leads"

Ticket: *"by default it should be all when we land on this screen instead of Unresulted leads."*
`ChatThreads` seeded `statusFilter: 'unresultedleads'` / `selectedStatus: 'Unresulted Leads'`, so the
list opened already filtered and a rep with only resulted leads landed on **"No Leads Conversations
found"** — an empty screen that reads as broken rather than filtered.

Two seeds, now `'all'` / `'All'`. Nothing else changed: `useChatThreads` already treats `'all'` as "no
status constraint" on **both** sides — the server query (`else if (statusFilter !== 'all')` before it
sets `serverStatus`) and the client-side list filter.

⚠️ **The two seeds must stay in sync.** The dropdown derives the key from the label
(`opt.toLowerCase().replace(/ /g, '')`), so the pair has to be exactly what tapping the **All** row
produces — seeding only the label would leave the list filtered while the control claimed otherwise.

tsc 44 (baseline unchanged); eslint on `ChatThreads/index.tsx` identical to its HEAD baseline
(15 warnings, 0 errors). ⚠️ The file is CRLF **and pure ASCII** — keep new comments ASCII (no warning
emoji) and use `newline=''` on both ends.

### Co-buyers moved below Address, with a "Same address as primary buyer?" tick

Ticket: *"Add Co-Buyer should be below the address field; also inside the co-buyer box add check box
with the title of “Same address as primary buyer?” — by checking it same address should be show inside
the Co-Buyer box."*

`EditCustomerModal` rendered the co-buyer cards and the **+ Add Co-Buyer** button between **Email** and
**Address**. They now sit BELOW the Address field, and each card gained the tick plus its own **Address**
box.

⚠️ **The reorder is what makes the tick coherent, not just a layout preference.** The checkbox mirrors
the primary buyer's Address; with the block above that field the rep would be asked to confirm "same as
primary" before the primary address is on screen.

⚠️ **THIS IS NOT A PORT — web has no co-buyer address at all.** `edit-customer-modal.js`'s
`sanitizedCoBuyers` sends `firstName`/`lastName`/`phone`/`email` only, and there is no such checkbox on
that side. **So `coBuyers[].address` is unverified against the backend**: if the sub-schema does not
declare it, Mongoose drops it silently and the box will look right and read back EMPTY on the next
open. Confirm the field is stored before treating this as done.

⚠️ **`sameAsPrimary` is DERIVED on load, never persisted.** Storing a second flag beside the address
gives the record two ways to disagree with itself, and the answer is already implied by the two
addresses matching. `normalizeCoBuyers(coBuyers, primaryAddress)` does it (trim-compared).

⚠️ **Two BLANK addresses are NOT "the same address".** The derivation requires a non-empty primary, so
a co-buyer with nothing stored opens UNTICKED — otherwise every untouched record would render a
confirmation the rep never gave.

⚠️ **The mirrored address is DERIVED at every read (`coBuyerAddressOf`), never copied into
`coBuyer.address`.** A stored mirror goes stale the moment the rep edits the primary address below —
the co-buyer would keep the old street while the tick still claimed "same as primary buyer". Deriving
also means unticking hands back whatever they had typed, and it is the same expression the SUBMIT
payload uses, so the box and what is saved cannot diverge.

- The co-buyer address input is **read-only while ticked** (grey `fieldBoxReadOnly`) — editable there
  would silently contradict the tick.
- **A new co-buyer starts UNTICKED.** Most co-buyers do share the address, so defaulting it on would
  save a tap — but it would also write an address the rep never affirmed onto a record they may have
  opened only to fix a name. One line to flip if reps prefer it.
- `handleCoBuyerChange`'s `field` param was widened from `keyof CoBuyerDraft` to an explicit string
  union — `sameAsPrimary` is a boolean and has its own `handleCoBuyerSameAddress`, so the old signature
  would have typed a boolean field as taking a string.
- `normalizeCoBuyers` is **exported solely so this rule is testable**; the modal itself does load under
  jest (unusually for this repo), so no `utils/` extraction was needed.

Verified with 8 tests over the real `normalizeCoBuyers` plus the exact derivation expression: a stored
match ticking the box, an own-address co-buyer left unticked, **all four blank combinations staying
unticked**, whitespace ignored on either side, a mirrored co-buyer FOLLOWING a later edit to the primary
address, unticking restoring the typed value, the existing name/phone/email normalisation unchanged, and
junk input as a no-op. tsc 44 (baseline unchanged); eslint identical to its HEAD baseline (4 warnings,
0 errors). ⚠️ The file is CRLF — `newline=''` on both ends.

⚠️ Needs a device check (this repo cannot render-test): the new order, the tick filling and greying the
co-buyer Address, unticking restoring a typed one, and — the important one — that the address SURVIVES a
save and reopen.

### Ticket 409 — a resulted lead locks every rollout tab, and the resulted one offers Reset Job Builder

Ticket: *"when a lead is resulted from one tab, the other tabs of the same lead remain active, allowing
the user to result the lead again from another tab… Show a Reset Job Builder button on the resulted
tab… Until the Job Builder is reset, all other tabs should remain disabled."*

Once the lead carries a resulted calculator the WHOLE quote goes read-only on **every** tab — the item
rows, Add Renders, the payment-plan picker, the COST/PAR/RETAIL tiles, the Rollout End Price field, the
installers bar and the drops list all dim to `opacity: 0.6`, and `+ Nth Drop` / `Result Lead` grey out.
The resulted tab swaps `Result Lead` for a red filled **Reset Job Builder**, which stays live.
Resetting clears the result and unlocks everything.

⚠️ **Dimming alone is not enough — `pointerEvents: 'none'` is what enforces it.** A first pass disabled
only the two action buttons and QA came straight back (*"you forgot to disable the upper part… the only
Reset Job Builder button should be pressable"*): without the wrapper the payment-plan sheet, Add Renders
and the end-price input stay tappable behind the greying, so a rep can still re-quote a lead that is
already resulted. Two wrappers do it — one around the main card, one around the installers bar + drops
list. **The action row sits OUTSIDE the second wrapper**, because Reset Job Builder lives there and is
the one control that must remain pressable. Mirrors the CLASSIC deal center, which already pairs
`opacity: 0.6` with `pointerEvents` on `isJobBuilderSubmitted || isJobSubmittedOnOtherCalc`
(`CalculatorSummary.tsx`).

⚠️ The wrapped children were deliberately **left at their original indentation**. Re-indenting the ~280
lines inside them would bury a 6-line change in a whole-file diff — the same trap the CRLF notes in this
file warn about.

⚠️ **"Disable other tabs" means the ACTIONS, not tab NAVIGATION — this is what web does and what the
ticket's own reference screenshots show.** Web's `<Tab>` carries no `disabled` prop
(`ViewAllCalculators.js`); the lock is entirely `isLocked` / `isDisabled` on the two buttons. The first
reference image is a rep sitting on a NON-resulted tab with both buttons greyed, which is only
reachable if switching tabs is still allowed. Blocking navigation would also hide the resulted tab —
and with it the only Reset button. If reps do want navigation blocked, that is a deliberate divergence
and needs its own decision.

**Rules live in the pure `src/screens/DynamicDealCenter/utils/job-builder-submission.ts`**
(`resolveSubmittedCalculatorId` / `describeCalculatorLock`), for the reason
`utils/rehash-draft-calculators.ts` exists: `RolloutView.tsx` pulls in React Native and is untestable
under jest here, and "which tab owns the result" must mean ONE thing to the button that locks and the
button that unlocks — otherwise a rep is locked out with no tab offering the way back.

⚠️ **It deliberately does NOT require `jobBuilder.status === 'submitted'`.** The ticket is *"after lead
is RESULTED"*, and the outcome modal writes `selectedCalculatorId` **before** the job builder is
completed — gating on the submitted status would leave exactly the window a rep would use to result a
second tab. This matches web's `submittedCalculatorId` chain (`TabbedCalculator.js`), which is also
status-free; the `jobBuilder.calculatorId` arm is web's second source and is what the CLASSIC mobile
deal center reads (`CalculatorSummary.resultedCalculatorId`).

⚠️ **Ids compare as STRINGS.** The id arrives both off the calculators list and off the lead record and
those are not guaranteed to be the same type; a raw `===` silently reports "no tab owns this result",
which unlocks everything and defeats the ticket. A blank/whitespace id resolves to `null` for the same
reason — a truthy-looking lock that no tab can match would strand the rep.

⚠️ **Reset Job Builder is NEVER disabled** (web: `disabled={isJobBuilderSubmittedTab ? false : isDisabled}`).
It is the only way out of the locked state.

- **`jobResetLocally` in `DynamicDealCenterScreen` unlocks immediately after the reset.** `lead` is a
  nav-param snapshot, so the PUT clears the result on the server while the screen still holds the old
  `jobBuilder` — without it the tabs stay locked right after the action meant to unlock them. Web does
  the same locally (`setLead({ ...currentLead, jobBuilder: null })`).
- **The confirm copy and the direct `LeadService.resetLead` call are lifted from the CLASSIC deal
  center's `handleResetJobBuilder`** (`screens/DealCenter/index.tsx`), so both deal centers ask the same
  question and hit the same endpoint (`PUT lead/v1/{id}/reset`).
- ⚠️ **Only ONE hook was added** (`useState` for the reset flag). `submittedCalculatorId` is a plain
  const and `handleResetJobBuilder` a plain function — every hook in this component sits after the
  edit-mode early return (see `rehashBuild`), so each one widens that compromise; `queryClient` was
  already in scope above the branch, which is why the service is called directly rather than through
  `useResetLeadMutation`.

Verified with 10 tests over the real helpers: an unresulted lead locking nothing, all five id shapes web
reads, `leadData` winning the fallback order, the ticket repro (resulted tab → Reset, every other tab →
locked), the no-status-gate case, string comparison of a non-string and a padded id, blank ids never
producing an ownerless lock, **every locked state having exactly one tab able to unlock it**, the local
reset unlocking without mutating the record, and an id-less calculator never mistaken for the resulted
one. tsc 44 (baseline unchanged); the new util is eslint-clean, `RolloutView.tsx` is +2
`react-native/no-inline-styles` + 1 for the read-only wrapper (the rule it already carries 268
of) and `DynamicDealCenterScreen.tsx`
is +1 `react-hooks/rules-of-hooks` — the single added `useState`, joining the 19 the file already
carries for the documented reason.

⚠️ Needs a device check (this repo cannot render-test): result a lead from one tab, reopen the deal
center, confirm every tab's two buttons are greyed, the resulted tab shows the red Reset, and that
resetting re-enables Result Lead everywhere.

### ✅ ROOT CAUSE: the TNT board showed the wrong calculator as sold — the fix had been MERGE-REVERTED

Ticket: *"we create a lead with multiple calculators with different decline drop prices and some with
accepted drop prices but we can go with the calculator in which drop price is decline; when we complete
this lead the TNT portal show that the calculator that have an accepted drop price is sold but in actual
we sold the other calculator in which drop price is decline. This same flow from the website works
perfectly."*

**The sold calculator carried no marker of what the customer agreed to.** A rep walks the customer down
several drops on calculator B, the customer DECLINES every one, and the rep sells B anyway at its
rollout price. Every row on B then reads `declined`, so the only definite *"the customer took this
price"* record anywhere on the lead is the `accepted` drop on the sibling calculator A — which is what
the board reported as sold.

⚠️ **This was fixed once and silently reverted.** Commit **`c65e14f` ("Drop Price TNT Board issu
fixed")** added `openResultChooser` to `RolloutView` — securing the last drop before the outcome modal
opens. Ticket 409 (`6c2e15a`) branched from a commit that PREDATED it, and the merge `9708df7` resolved
`RolloutView.tsx` to the 409 side, dropping the whole thing. The half in `utils/drop-prices.ts`
(`resolveAutoSecureIndex` / `autoSecureLastDrop`) survived and sat there as dead code with only tests
referencing it — which is exactly what a merge-revert looks like. ⚠️ `git log -- <file>` HIDES it
(history simplification skips a change undone by a merge); `git diff c65e14f HEAD -- <file>` is what
shows it.

Restored verbatim, plus the three `dropPriceOf` call sites that were lost with it:

| what | why it matters |
|---|---|
| `openResultChooser` on **Result Lead** | secures the last drop when NOTHING is accepted, so the sold calculator owns the accepted row |
| `finalPrice` | a server round-tripped drop carries **`dropedPrice` only**, so `.price` was `undefined` → Result Lead showed no figure and the outcome modal opened at `$0.00` with Build Job disabled |
| `resolveDropTargetIndex` / the drop row `dp` | same field, same failure — a reloaded drop could not be matched or displayed |

⚠️ **Only when nothing is secured.** A rep who deliberately secured drop #1 and then explored two more
without taking them keeps that choice — `autoSecureLastDrop` returns the SAME array reference, so
nothing is written and nothing is logged. The sibling calculator is never touched either.

⚠️ **The write is immediate**, not debounced: `onDropChange` → `handleSetDrops` → `saveDropsNow` PUTs
`{ dropPrice: [...] }` with every row's `_id`, so the row is filed before the job is built and no
duplicate is appended. A `drop price secured` rollout log is fired for it so the portal timeline can
explain the row.

#### …and the `rollout_and_drop_summary` log the board reads was wrong on three counts

Web fires `logRolloutDropSummaryOnSubmit` with its whole `appointmentsCalculator` list and its
`cleanLeadData`. Mobile's dynamic submit passed neither:

- **`allCalculators: [selectedCalc]`** — a lead worked across four rollouts logged as ONE, with only
  its own drops counted, so `noOfRollouts` / `noOfDropsAllJobs` / `aggregatedRetailPrice` /
  `percentageJobsAt*` under-reported every multi-calculator lead. `DynamicDealCenterScreen` now passes
  the full list (`allCalculators`, backend-shaped from `tabs`), and the resulted calculator is
  force-merged in by id so its LIVE drops/price win over a list that is a render behind.
- **`leadData: rd` verbatim** — the result modal produces `resultType` / `contractPrice` /
  `downPaymentMethod`, while the log reads `result` / `originalContractPrice` / `paymentMethod`. So
  **every dynamic submit logged `resultStatus: "Unknown"`** and a resulted price of `0`
  (`deltaFromRolloutToResult: "0%"`). It is now built by the SAME `buildSubmitLeadData` that assembles
  the submit payload, so the log and the job can never disagree about the result, or about which of
  `lastPriceQuoted` / `originalContractPrice` a Demo vs a Sale carries.
- **`appointmentId: undefined`** — `CalcTab` has no `appointmentId` and the screen never passed the
  hook's. Now threaded, which also stops the outcome write falling back to the LEAD id (the documented
  `jobBuilder.appointmentId === lead._id` oddity on mobile-created jobs).

⚠️ **`calculateTiers` in `utils/activity-log/rollout-summary.ts` is the LEGACY calculator** — it prices
the hardcoded `gutter5DsE` / `versa6Ft1` columns, which a dynamic calculator does not have, so every
dynamic job came back with the same floored tiers, bucketed them all as `atRetail`, and logged
`resultedJobCost/Par/Retail` that no screen agrees with. Web has no such problem: its version passes
`schemas`. Mobile's port is not schema-aware, so the dynamic caller opts in with
**`preferStoredTotals: true`** and the tiers come from the calculator's persisted `totals` (the pure
tier sum `computeTotals` wrote — the same numbers the rollout tiles derive from). **Opt-in, never
inferred:** a classic calculator can carry a `totals` object too, and there the legacy computation is
the correct one.

Verified with 11 tests (`__tests__/screens/DynamicDealCenter/tnt-sold-calculator.test.ts`) over TWO
calculators — the shape a single-calculator test cannot express: the pre-fix state asserted directly
(the lead's only accepted drop sits on the calculator that was NOT sold), resulting the all-declined
calculator securing its last round, the sibling untouched by reference, every `_id` preserved through
`toDropPricePayload` so nothing is re-filed, exactly one accepted row after the save normalizer, a
deliberate earlier secure not overridden, a drop-less calculator and junk input as no-ops, and the
submit/summary naming the sold calculator at the secured price on both the Sale and Demo arms (with
`resultStatus` asserted against the raw `rd` that used to read `Unknown`). tsc 68 (baseline unchanged);
`rollout-summary.ts` is eslint-clean and `RolloutView.tsx` (273 problems), `DynamicJobBuilderScreen.tsx`
(49) and `DynamicDealCenterScreen.tsx` (38) are each byte-identical to their HEAD eslint baselines.

⚠️ Needs a device check of the board itself: sell the DECLINED calculator on a lead that also has an
accepted drop elsewhere, then confirm one `PUT /lfcalculators/{B}` with `{"dropPrice":[…]}` carrying
exactly one `accepted` row, and that the submit's `rollout_and_drop_summary` names calculator B with
`resultStatus: "Sale"` and the real `noOfRollouts`.

### The Job Tracker calendar could not go back a month

Ticket: *"inside the sale, when we open the deal center, at the last of the screen there is a Job
Tracker button; when we click on it the dialogue appears, and when we click on the Install Date box
this calendar appears — in which previous dates are disabled. Make it enable the previous months and
years and days."*

`CustomDatePicker` (`screens/JobTracker/components/`) disabled its BACK chevron on the current month:

```tsx
disabled={isSameMonth(currentMonth, new Date())}
style={{ opacity: isSameMonth(currentMonth, new Date()) ? 0.3 : 1 }}
```

⚠️ **That one chevron was the whole restriction.** The day grid never disabled anything (every day of
the rendered month is tappable — which is why 1–24 August read as normal black text in the report's
screenshot, not greyed), and the year list already spans `currentYear + 5` down to `currentYear - 24`.
So "previous days" and "previous years" needed no change; they were simply unreachable, because the
only way back was a chevron that switched itself off the moment you landed on today's month.

Removed. Nothing else gates a past date — there is no min-date prop and no validation on the way out
(`AddEditJobModal` only requires that an install date is PRESENT, unless `toBeDetermined`).

⚠️ **This picker has FOUR consumers, and the block was wrong for every one of them** — worth knowing
before anyone "restores" it as a safety rail:

| where | field | why past dates matter |
|---|---|---|
| `AddEditJobModal` | Install Date | a job can legitimately be back-dated |
| `AddEditJobModal` | **Date Sold** | a PAST date by definition — it defaults to today, so a sale made last week could not be recorded at all |
| `JobTracker/index.tsx` | sold / payout filters | date RANGES, almost always looking backwards |
| `MapFiltersModal` | two date filters | same |

If a future field genuinely needs a floor, give the component a `minDate` prop and pass it from that
call site — do not put the rule back inside the shared picker.

⚠️ Noted while here, NOT changed (out of the ticket's scope): `currentMonth` is seeded with
`new Date()`, not with `initialDate`. So editing a job whose install date is in October opens the
calendar on the CURRENT month rather than October's. Harmless now that navigation is unrestricted, but
it is an extra two taps every time.

tsc error set byte-identical; eslint on the file goes 4 problems → 3 (the removed inline `opacity`
style takes its own warning with it), the 2 remaining errors being the file's pre-existing unused
`StyleSheet` / `isDark`.

### The Job Tracker Status chip was a one-tap server write

Ticket: *"inside the job tracker, when we click on unpaid status it changes to paid, or when we
click on paid it changes to unpaid — that is wrong, there is no click on status. Make the click
disabled from this field."*

The Paid/Unpaid chip in each row was a `TouchableOpacity` calling `useJobTracker.toggleStatus`,
which is not local state — it `PATCH`es the server (`JobService.updateStatus`) and refetches. So a
stray tap while scrolling a long list changed a real payment status, with no confirmation and no
undo. It is now a plain `View` with the same `w-24 items-center` box, so the layout is unchanged.

⚠️ **Nothing is lost.** The row's ⋮ menu already carries **"Change Status"**, which opens a
dropdown (Unpaid / Paid) behind a Cancel/Update confirmation and calls `JobService.updateStatus`
itself. The chip was a duplicate of that, minus the confirmation.

⚠️ `toggleStatus` is KEPT on the hook but now has zero consumers, and carries a note saying so. If
a one-tap toggle is ever wanted back, put a confirm in front of it rather than re-attaching it to
the chip.

tsc error set byte-identical; eslint on `JobTracker/index.tsx` unchanged at 29 problems (the
destructured `toggleStatus` was removed with its last use, so no unused-var error was added).
### A drop price EQUAL to the rollout price is rejected

Ticket: *"you have to add one more validation here while we are adding the drop price, user also will
not able to add drop price which equal to the rollout price"*, with the exact copy
**"Drop Price cannot be added because it is the same as the Rollout Price."**

`openDrop` (`screens/DynamicDealCenter/components/RolloutView.tsx`) already floored the drop at the
COST tile and capped it at the rollout end price, but the cap was a strict `v > priceNum` — so entering
the rollout price itself sailed through and opened the Secure/Decline sheet. Securing it then filed a
negotiation round that dropped nothing.

⚠️ **The equality test needs its OWN branch BEFORE the `>` check**, not a widening of that check to
`>=`: *"cannot exceed rollout end price"* is a confusing thing to say about a number that does not
exceed it, and the ticket specifies different copy.

- Placed AFTER the cost floor, so a drop that is both below cost and equal to the rollout price still
  reports the cost problem first — that ordering only matters for a rollout priced under its own cost,
  which the end-price validation already prevents.
- **Strict `===` is safe here**: both sides are `parseFloat` of a digits-only string, so `333` and
  `333.00` compare equal.
- `openDrop` is the ONLY entry point — the input's `onSubmitEditing`, its iOS `onBlur` commit and the
  add button all funnel through it, and the **Display** re-negotiation path reuses an existing row's
  stored price rather than a typed one, so it cannot reach this.

tsc 44 (baseline unchanged); eslint on `RolloutView.tsx` identical to its HEAD baseline (270 problems:
2 errors / 268 warnings). ⚠️ The file is CRLF — `newline=''` on both ends.

### Signing an agreement says the customer got a copy

Ticket: *"while we are submitting the agreement we have to show these messages as well in the splash
which are coming in the response"*, against the `agreementSent` block the sign flow leaves on the
outcome (`sms` / `email`, each with `to` / `status` / `message`).

**Shipped as a STATIC second line, at the reporter's direction** — the signature success flash now reads

```
Success
Agreement signed successfully
Your finalized document is complete and a copy has been sent to you
```

One `FlashMessage.success` in `AgreementSignatureModal.handleSubmit`, the message on a `\n` after the
existing line. That is the whole change.

⚠️ **A live, per-channel version of this was built and then REMOVED on request** (*"just forget this and
remove the changes… instead just add this message"*). If it is ever wanted again, these are the facts
that cost the most to establish — do not re-derive them:

- **`/sign` returns the PDF as a BLOB** (`responseType: 'blob'`), so the signing response cannot carry
  the delivery result. The block rides on `GET lead/v1/{leadId}/outcome/{calcId}` instead.
- **`agreementSent` is a SIBLING of `outcome`** (`data.data.agreementSent` beside `data.data.outcome`),
  so `unwrapOutcome` — which returns `body.data.outcome` — cannot see it. It has to be read off the raw
  body.
- **The send finishes ASYNCHRONOUSLY.** In a captured payload the outcome's `updatedAt` is **3.5 s
  after** the agreement row's `createdAt`, so a read taken moments after signing legitimately finds the
  document and no delivery block. Any polling window has to clear that comfortably.
- ⚠️ **A flash raised while the signature modal is still up renders BEHIND it.** A native `Modal` is its
  own view tree above the RN root and the app-wide `<FlashMessage />` lives at that root (`App.tsx`).
  The existing success message only gets away with it because `onClose()` fires in the same instant;
  anything raised a few hundred ms later (i.e. after a network read) is drawn under a modal that is
  still dismissing and is never seen. **This is why the live version reported nothing on device**, and
  why the static line above works — it is raised in the same tick as the close.
- **One banner, not two.** `react-native-flash-message` shows a single banner and a second `show()`
  REPLACES the first, so a delivery notice cannot be appended after the success message; it has to be
  folded into it.
- **Web has no equivalent** — `grep agreementSent` over the sales frontend is empty.

⚠️ Noted while tracing, NOT fixed: a failing number was sent to the provider as **`+1 (454) 684-8848`**
— the display-formatted string, not E.164. `formatUSPhoneNumber` emits exactly that shape and (per the
Edit Customer ticket) the submit payload always carries the formatted value, so the backend may be
handing Twilio a string it cannot parse. Area code `454` is also unassigned in the NANP, so that one
number may simply be invalid — the two explanations are not distinguishable from a single sample. Worth
its own ticket with a KNOWN-GOOD number: the deal-edit "Send Addendum To" field already converts through
`toE164USPhone`, and this path has no equivalent.

tsc 44 (baseline unchanged); `AgreementSignatureModal.tsx` is at its HEAD eslint baseline (41 problems),
and `message.ts`, `SummarySection.tsx`, `outcome-documents.ts` and `DynamicJobBuilderScreen.tsx` are
back to their pre-feature state (the first two verified byte-identical against `3d5dbea^`).

### The draft autosave could persist a state SNAPSHOT, losing the agreement

Ticket: *"when i create lead and come to summary, i click schedule appointment — after adding the date
and time it automatically opens the modal asking to generate the agreement. In that scenario, when I
submit the agreement the agreement is not going in the payload. It only goes when I generate it from
the Agreements card."* Two `PUT lead/v1/{id}/outcome/{calcId}` bodies were supplied; both carry
`jobBuilder.status: 'draft'`, i.e. they are **autosaves**, not the Complete-Job submit.

The two payloads are the whole diagnosis. Both hold the same `scheduleTime`
(`8/22/2026 · 8:00 AM - 12:00 PM`) and the same vertical state; only one carries
`dynamicJobState.agreements`. **`scheduleTime` present and `agreements` absent in ONE body is only
possible if that body was serialized from a snapshot taken between the two writes** — both land on the
same object through `updateRootState`, which is a functional updater, so nothing can drop one and keep
the other.

**Cause: `performAutoSave` closed over `jobState`, and its own in-flight guard re-invoked THAT closure.**

```js
if (saveInFlightRef.current) { needsFollowUpRef.current = true; return; }
…
} finally {
  saveInFlightRef.current = false;
  if (needsFollowUpRef.current) { needsFollowUpRef.current = false; void performAutoSave(); }
  //                                                                     ^ recurses into THIS closure
}
```

A save coalesced while another was in flight therefore re-sent the state **as it stood when the FIRST
save started**. The scheduler flow is the one that reliably has a save in flight: scheduling writes
`scheduleTime` and arms a save, and the agreement is generated on top of that — so the agreement write
is the one that gets coalesced away. Generating from the Agreements card has no preceding write, so
its save runs on a fresh closure and the agreement survives. Same class of bug the calculator engine
already fixed (`useDynamicCalculators` reads the current tab from `tabsRef`, *"like web's
`entriesRef.current`"*).

Three changes, all in `DynamicJobBuilderScreen`:

- **New `jobStateRef`**, and `performAutoSave` serializes from `jobStateRef.current`. Whichever closure
  ends up running now sends what the rep actually has.
- **The follow-up fires through `performAutoSaveRef.current()`**, not the `performAutoSave` identifier
  — the latter recurses into the captured closure, so it also re-sent stale `initialConfig` /
  `dealCenterData`.
- **The debounce effect now names `jobState` directly** and fires through the ref.

⚠️ **`jobState` had to come OUT of `performAutoSave`'s dependency list and INTO the effect's.** It was
only ever there to make the callback's identity change so the 2 s timer re-armed on each edit — and
that is precisely what tied the re-arm to a closure carrying a snapshot. Moving it makes the trigger
explicit; the effect also lists everything else `performAutoSave` reads, so a save is still re-armed
when `dealCenterData` settles, exactly as before. Do not "simplify" the effect back down to
`[performAutoSave, …]`, and do not silence the `exhaustive-deps` warning that appears if `jobState` is
left in the callback — the rule is right, the dependency really is unused there now.

⚠️ **Only the DRAFT was affected, not the submitted job.** `handleComplete` serializes `jobState`
directly at submit time, so the finished deal always carried the agreement; what was lost was the
draft on the server between generating and completing — so a reopen (or web) saw a deal with no
agreement, which is the same failure the "documents ride ALONG WITH the draft" comment in
`performAutoSave` already warns about.

⚠️ **Ruled out by reading, do not re-investigate:** `updateRootState` (functional, cannot clobber a
sibling key); both flows sharing ONE `DynamicAgreementDialog` and one `handleAgreementGenerated`; and
the scheduler's `onGenerate`, which is a plain synchronous call plus `handleModalClose()`.

> ⚠️ **This fix is CORRECT and is KEPT, but it did NOT close the ticket** — the reporter came back with
> the same payload. And one line of the paragraph above was wrong: *"the session's draft re-apply …
> runs once on mount and the `commitUploaded` query invalidation cannot re-trigger it."* On a
> **brand-new lead** it never ran on mount at all, and that is the actual bug. See below.

tsc 44 (baseline unchanged); eslint on the file is back to its exact baseline (49 problems, 2 errors).

#### ✅ ROOT CAUSE: on a NEW lead the draft restore never LATCHED, so a later refetch overwrote the signature

Same ticket, reporter's second pass — *"when we came first time in summary after making the new lead …
from this flow by clicking it, we came this card (Modal: Job Booked) and after pressing Generate Dynamic
agreement, when we submit agreement, agreements is not going to sent in the payload"*. The emphasis on
**first time in summary after making the new lead** is the whole answer: the state was not being
serialized from a stale snapshot, it was being **reset out from under the save**.

`useDynamicJobBuilderSession`'s restore effect opened with

```js
if (!initialJobState) return;          // ← before ANY latching
…
if (lastDraftTokenRef.current === draftToken) return;
lastDraftTokenRef.current = draftToken;   // only ever reached with a real draft
```

so a lead whose outcome GET found **nothing** — every new lead — never wrote `lastDraftTokenRef`, and
the session stayed open to a restore **forever**. The first draft to arrive at any later moment was then
applied unconditionally.

One does arrive, and the agreement itself summons it. `commitUploaded` (`SummaryFinalizeCards`) ends with
`queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] })`, so **filing the agreement
REFETCHES the draft** — and by then the server holds the draft the 2 s autosave wrote when the
appointment was scheduled, which carries `scheduleTime` and **no `agreements`**. That draft is restored
over the just-signed agreement, and the next autosave persists the state without it. Exactly the payload
in the ticket.

**Why the Agreements-card flow looked fine:** that card is gated on `isAppointmentSet`, so it is
overwhelmingly used on a deal **reopened** after the appointment was already saved. There the mount-time
GET finds a draft, the token latches, and the later invalidation is a no-op. Both entry points share one
`handleAgreementGenerated` — the difference was never the flow, only whether a draft existed at mount.

⚠️ **And it was never limited to that one flow.** `useLeadReports` invalidates the same
`['leadOutcome', leadId]` key in two places, so on a new lead ANY of those could restore a doc-less draft
over live work.

**Fix — latch on the READ SETTLING, not on a truthy draft.** New `draftSettled?: boolean` option; the
screen passes `isEdit ? undefined : isOutcomeFetched`. Once the GET has settled the token is written
**whether or not it found anything**, because a settled-empty read means there is nothing to restore
*ever*: from then on, every byte the server holds was written by this session.

- **`draftSettled === undefined` keeps the old behaviour**, so no other caller can be changed by this.
  (`DynamicJobBuilderScreen` is the only one that passes `draftToken` at all; edit mode passes neither.)
- **`draftSettled === false` WAITS rather than latching**, which is what preserves the blank-tab fix
  above it: a draft that lands after an early write is still applied, exactly as before.
- The legacy (token-less) path keeps its own `if (!initialJobState) return;` — its rule is
  "apply until the rep's first real edit", which is a different invariant and is untouched.

⚠️ **The `['leadOutcome']` invalidation in `commitUploaded` was deliberately LEFT IN PLACE.** With the
latch it is harmless, and it is not the defect — the defect is that a restore was possible at all that
late. Removing it would only hide the class of bug from the one call site that happened to expose it.

Verified by driving the REAL hook through `react-test-renderer` (this is possible for a hook — it is
`@testing-library/react-native`'s `render` that returns no queries here, so *component* tests are still
out): the ticket repro asserted **failing under the old rule and passing under the new one** (fresh lead
→ scheduleTime + agreements written → a scheduleTime-only draft refetched → the agreement survives), the
blank-tab case still applying a late draft over an early write, a reopened deal still restoring on first
load and then ignoring a re-fetch of the same draft, and edit mode unchanged. tsc 44 (baseline
unchanged); eslint 49 problems / 2 errors across both files — the screen's exact HEAD baseline, and the
session hook clean.

⚠️ Still wants a device check. Repro: create a lead, reach Summary, **Schedule Appointment → Generate
Dynamic Agreement**, sign, then watch the next `PUT …/outcome/{calcId}` and confirm
`jobBuilder.dynamicJobState.agreements` is present alongside `scheduleTime`.

### Edit Customer Details now logs opened / per-field change / saved

Ticket: *"you have to add logs while we are opening customer details from pencil like web / also you
have to add when we edit anything"*, with both web payloads supplied verbatim. Opening the Lead Center
pencil and saving it emitted **nothing** on mobile, so the portal timeline had the events for a web edit
and a blank for a mobile one.

Three events, ported from web `sections/job/components/job-capture-images-sections/edit-customer-modal.js`:

| when | `action_type` | `meta.action` |
|---|---|---|
| the pencil opens the modal | `view` | `edit customer details opened` |
| per field the rep altered | `change` | `customer field changed` |
| the PATCH succeeds | `submit` | `customer details saved` |

All three carry `module_type: 'customer_details'` and `meta.customerId` / `meta.leadId`; the `change`
rows add `fieldLabel` / `fieldName` / `fieldValue` / `fieldCategory` / `oldValue` / `newValue` — the
ticket's payloads exactly. The ids resolve through ONE helper so no two rows can disagree about which
record they name.

> ⚠️ **SUPERSEDED — the two paragraphs that stood here are now WRONG and are retired.** They said the
> `change` rows fire on SAVE and land AFTER the `submit` row, both of which were the requested
> behaviour at the time. The reporter reversed it — *"we implemented the change log in wrong way,
> once we will write any input after a second that log will call"* — so the rows are now **debounced
> off the rep's typing inside the modal**, exactly as web does, and therefore land BEFORE the submit
> row. See "…and the change rows are DEBOUNCED off typing" below. The `view` and `submit` rows are
> unchanged.

⚠️ **`meta.resetCycle` is added SERVER-side, not by the client.** A payload comparison filed against
this ticket showed mobile's stored row carrying `resetCycle: 0` where web's did not — but the two
objects were not the same kind: web's was the REQUEST BODY and mobile's the STORED RECORD (it also
carried `_id`, `user_activity_log_id`, `created_at`, `updated_at`, `__v`). `grep -rn resetCycle src/`
finds it only in `utils/activity-log/calculator-log.ts` and `hooks/useDealCalculator.ts`, both of which
send it deliberately for CALCULATOR logs; nothing on this path does. Mobile sends exactly web's nine
meta keys. Compare two records or two request bodies before chasing a difference here.

⚠️ **The rules live in the pure `src/utils/customer-detail-changes.ts`**
(`resolveCustomerLogIds` / `buildCustomerFieldChanges`), for the reason `utils/addendum-drafts.ts` and
`utils/inspection-photos.ts` exist: `LeadCenter/index.tsx` pulls in React Native and is untestable under
jest here, and the one thing that can be **silently** wrong — reporting a field the rep never touched —
leaves no trace except a wrong row on the portal.

⚠️ **Each baseline must reproduce EXACTLY how `EditCustomerModal` seeds that field.** `phone` is the one
that bites: it is stored raw or E.164 (`4438784937` / `+14438784937`) and the modal seeds it through
`formatUSPhoneNumber`, so diffing against the STORED string would log a phone edit on **every** save.
`address` falls back to `lead.fullAddress` for the same reason. (Same trap the modal's own length
validation hit — see the Edit Customer phone-validation section above.)

⚠️ **Co-buyers are not logged** — web does not track them either; `handleCoBuyerChange` only flips
`hasUnsavedChanges`.

⚠️ **`customerId` is the CUSTOMER record's id, a DIFFERENT document from the lead** — the ticket's own
payload shows `…3a94` vs `…3a97`. `handleCustomerSubmit` resolves the PATCH url with
`lead.customerDetails._id || …id || lead._id || lead.id`, and **that lead-id fallback must not leak into
the log**: the portal joins on this id, so a lead id there reports the wrong record. The emitter reads
the customer record only and sends `null` when the lead genuinely carries none (web reads
`customerData._id` with no fallback at all).

- **The `view` fires on the PENCIL, not in the modal.** Web fires it from an
  `useEffect(… [open, customerData])`; mobile's modal is mounted by `{showEditCustomerModal && …}`, so
  the press handler is the same moment and needs no new prop threaded into `EditCustomerModal`.
- **The `submit` fires AFTER the PATCH resolves**, next to the success flash — web's own position. On
  the button press it would log edits that then failed to save.
- ⚠️ Both read the PRE-save `lead`. `handleCustomerSubmit` calls them after its optimistic `setLead`,
  which is safe because a state setter does not mutate the closure's binding — but that is exactly what
  the diff depends on, so a future caller that re-reads the lead from the cache first would compare a
  record against itself and log nothing.
- **`logEvent` needs no change** — it already emits `{user_id, action_type, module_type, created_by,
  meta}` and only auto-attaches `meta.leadId` when absent, which it isn't here.

#### …and the header phone is formatted the same way

Follow-up on the same screen: *"number is not showing in proper formate, can you formate it like it's
showing in the edit customer modal?"* The Lead Center header printed `18757575799` while the modal
directly below it read `+1 (875) 757-5799` — the header rendered `lead.customerDetails.phone` verbatim
and the record stores it raw or E.164. It now renders through the same `formatUSPhoneNumber` the modal
seeds with, so the two agree.

⚠️ **DISPLAY ONLY.** `handleCall` / `handleTextMessage` / `handleCopyPhone` still read
`customerDetails.phone` and dial through `getRawPhoneNumber`, so the `tel:` / `sms:` links and the
copied string are unchanged.

⚠️ A NON-US stored number will be reshaped by this (the formatter keeps the last 10 digits after an
optional leading `1`). That is not new behaviour being introduced — `EditCustomerModal` already seeds
its field through the same function, so the header now merely matches what the rep is shown when they
open it. Verified across all six stored shapes, an empty phone still rendering nothing, and a partial
number degrading to `+1 (875) 757` rather than blanking.

⚠️ **One web event is still NOT ported**: a `view` / `edit customer details modal closed` fired from
web's **Cancel** button. Left out because the ticket did not ask for it; it is a one-liner on the
modal's `onClose` if the portal wants it.

Verified with 11 tests driving the real `buildCustomerFieldChanges` + `formatUSPhoneNumber`: the ticket
repro emitting its payload verbatim, an untouched form emitting nothing, **all five stored phone shapes
surviving a no-op save** with the naive stored-string comparison asserted to produce the phantom row
that guard prevents, a real phone edit reported in the format the rep saw, several edits emitting
several rows in web's field order, the `fullAddress` fallback, a cleared field reported as an emptying
rather than skipped, a co-buyer-only edit emitting nothing, and junk input as a no-op rather than a
throw. tsc 44 (baseline unchanged); `customer-detail-changes.ts` is eslint-clean and
`LeadCenter/index.tsx` is identical to its HEAD baseline (40 problems: 16 errors / 24 warnings).

#### …and the change rows are DEBOUNCED off typing, not derived on save

Reversal of the requirement above: *"adding denouncing like web, i mean we implemented the change log
in wrong way — once we will write any input after a second that log will call"*, with a devtools
capture of web's own `change` row.

The save-time derivation is **gone**. `buildCustomerFieldChanges` is still exported from
`utils/customer-detail-changes.ts` but is **NO LONGER WIRED** (a note on it says so) — the rows are now
produced by a debounced tracker inside `EditCustomerModal` itself, a port of web's
`trackFieldChange` / `useDebounce(changedValue, 2000)` / flush-effect trio.

| | web | mobile (now) |
|---|---|---|
| queue | `pendingChangesRef` array, filtered per field | `pendingChangesRef` **map keyed by fieldName** — same "last write per field wins" |
| baseline | `lastValuesRef`, seeded on open, advanced on flush | identical (`seedTrackedValues`) |
| trigger | `useDebounce(changedValue, 2000)` | one `setTimeout` ref, `FIELD_CHANGE_DEBOUNCE_MS = 2000` |

⚠️ **A `setTimeout` ref, not a `useDebounce` hook.** Web's `setChangedValue(entry)` re-renders the
whole modal on **every keystroke** purely to drive the debounce. The timer does the same job with no
render, which matters more here — this modal re-renders a Places autocomplete and up to three co-buyer
blocks.

⚠️ **The timer fires through `flushFieldChangesRef.current()`, never the identifier.** The flush reads
`user` and `lead`; a captured stale closure would log against the wrong ids. Same trap
`performAutoSaveRef` exists for in `DynamicJobBuilderScreen`.

⚠️ **Two flush points web does not have, because mobile can lose the pending row where web cannot.**
The modal is unmounted on close (`{showEditCustomerModal && …}`), which clears the timer — so an edit
made inside the last 2 s before Save or Cancel would vanish. `handleSave` flushes before `onSubmit`,
and a mount effect returns `flushFieldChangesRef.current` as its cleanup. The save flush is also what
puts the change rows **ahead of** the `submit` row, which is web's natural ordering.

⚠️ **The baselines advance even when there is no `user_id` to log as.** Otherwise the next flush would
report an `oldValue` the rep moved on from two edits ago.

⚠️ **Deliberate divergence: a row whose value came back to where it started is dropped.** Type a letter
and delete it inside the window and web still logs `Testa → Testa`. Skipping can only remove noise.

⚠️ **The silent GPS auto-fill is NOT tracked.** `applyCurrentLocation(prompt)` runs once on mount with
`prompt: false` when the customer has no address on file; only the crosshair TAP (`prompt: true`) is an
edit the rep made. The typed / cleared / picked-from-suggestions paths are all tracked.

##### Co-buyers are tracked by the same machinery

Mobile-only — web calls `trackFieldChange` for the five primary fields and **nothing** for co-buyers
(`grep` shows no co-buyer call sites). Rows carry `fieldCategory: 'co_buyer'`,
`action: 'co-buyer field changed'`, a `coBuyerNumber`, and `fieldName: coBuyer_<N>_<field>`.

- ⚠️ **`N` is 1-BASED in the key, matching `coBuyerNumber` and the "Co-Buyer N" heading.** It shipped
  0-based beside a 1-based number for one pass; that is an off-by-one a reader of the payload has no
  way to spot.
- ⚠️ **The key is POSITIONAL, because a co-buyer has no `_id` until the customer record is saved.**
  `handleRemoveCoBuyer` therefore **flushes first** (so pending edits are attributed while the indexes
  still mean what they did) and then **re-seeds every co-buyer baseline** against the new positions —
  without that, the co-buyer who shifts up inherits the removed one's values and their next edit
  reports a change against a stranger.
- **Ticking "Same address as primary buyer?" emits an address change**, because the tracked value is
  the DERIVED address (`coBuyerAddressOf`), not the flag.
- **Two structural rows**: `view` / `add co-buyer opened` on the `+` button, and `change` /
  `co-buyer removed` on Remove. The removal row carries `removedCoBuyer` (the name) as well as the
  number, since the number shifts the moment another is removed and cannot identify who left.
- **`meta.is_co_buyer: true` on the add row**, requested by the portal side. It is a **constant** —
  that row only ever fires from the `+ Add Co-Buyer` button — and exists so the portal can attribute
  the event to the co-buyer without pattern-matching on `action`. Not sent on the other rows, which
  already carry `fieldCategory: 'co_buyer'`.

**`CO-BUYER-ACTIVITY-LOGS.md` (repo root) is the payload reference handed to the backend**, since the
portal does not render these `meta.action` values yet. Keep it in step with this code.

##### …and the co-buyer Address searches Places, like the primary one

Follow-up: *"see the address in co-buyer, it should be search same like the above one — no suggestion
showing for co-buyer address field."* The box was a plain `TextInput`; a rep typed `Lahore` and nothing
was offered, while the primary field directly above it listed suggestions.

It now runs the same machinery — the 600 ms debounce, `fetchPlacePredictions`, the `predictionList`
rows, the inline spinner — with three differences that matter:

- ⚠️ **ONE prediction list for all three co-buyers, scoped by `coBuyerSearchIndex`.** Only the focused
  box can be typing, and keying the list to that index is what makes it impossible to drop a suggestion
  into a DIFFERENT co-buyer's address. The list renders only under `coBuyerSearchIndex === index`.
- ⚠️ **No `geocodePlaceId` call.** `CoBuyerPayload` carries an address and no coordinates, so the
  primary field's follow-up geocode would be a request whose result is discarded.
- **A pick goes through `handleCoBuyerChange`**, so it is debounce-logged exactly like a typed address
  rather than bypassing the tracker.

⚠️ **`coBuyerSkipSearchRef` is armed in `onChangeText`, NOT in `handleCoBuyerChange`** — the pick
handler calls that same function, so arming it there would make a chosen suggestion immediately search
itself and reopen the list underneath showing the address back. Same rule, same reason, as the
primary's `skipSearchRef`.

⚠️ **`closeCoBuyerAddressSearch()` fires on remove and on ticking "Same address as primary buyer?"**
The search is scoped by POSITION, so an open list would survive a removal and belong to whoever shifted
up into that slot; and a mirrored box is read-only, so anything still being offered for it is unpickable.

⚠️ The query reads `coBuyers[i].address` — the RAW typed value, never `coBuyerAddressOf` — so a
mirrored co-buyer cannot make the primary's address search itself.

tsc 44 (baseline unchanged); `EditCustomerModal.tsx` is at its HEAD eslint baseline (4 warnings,
0 errors). ⚠️ Needs a device check (this repo cannot render-test): suggestions appearing under the
co-buyer box, a pick landing in the right co-buyer with two of them on screen, and no stale list left
behind after Remove.

Also in this pass, on request: **`floatingLabelText` dropped its `fontWeight: '600'`** so the input
titles render at normal weight, matching web. ⚠️ That weight predates the co-buyer ticket (it is
`'600'` at `58c577b^` too) — it was not a regression from moving the co-buyer block, so don't go
looking for one.

⚠️ Needs a device check (this repo cannot render-test): type in a field and confirm ONE `change` row
lands ~2 s later carrying the whole edit, that a burst across several fields flushes together, that
Save no longer emits a second copy of each row, and that removing co-buyer 1 does not attribute
co-buyer 2's next edit to the wrong person.

tsc 44 (baseline unchanged); `EditCustomerModal.tsx` is byte-identical to its HEAD eslint baseline
(4 warnings, 0 errors), `LeadCenter/index.tsx` to its own (40 problems: 16 errors / 24 warnings), and
`customer-detail-changes.ts` is clean.

### The `inspection_photo` view log on "Start Taking Photos" is gone

Ticket: *"there is one extra log going to call while we press the Start Taking Photos button — remove
that log"*, with the captured payload: `action_type: view` / `module_type: inspection_photo` /
`meta: { leadId }` and **no `action`**.

⚠️ **It was NOT in `JobDocsSection.tsx`**, where the button lives. `handleStartTakingPhotos` only sets
`showDynamicCapture`, and the log was a **mount effect inside `DynamicInspectionView`**
(*"Log a view event on mount (parity with the legacy inspection modal)"*). Removed, along with its
now-unused `logEvent` import; `useAuth`/`user` stay (line ~120 still reads the id).

⚠️ So it fired on **every** mount of the dynamic inspection view, not only from this button —
`DynamicMovePhotoModal` renders the same `CategoryBody`, but the log was on the VIEW, so the button was
simply the reported path. Nothing else in `JobDocsSection` was touched; its own `upload` and `submit`
rows are unrelated and remain.

The bare `meta` in the capture is the tell: the effect passed no `meta` at all, and `LoggerService`
auto-attaches the stored `leadId` for any module not in `ExcludedModuleTypes`. A log with no `action`
cannot be rendered as anything on the portal timeline, which is why it read as noise.

tsc 44 (baseline unchanged); `DynamicInspectionView.tsx` is byte-identical to its HEAD eslint baseline
(123 problems, 0 errors) — the dropped import and the dropped `eslint-disable` cancel out.

### Addendum Review renders a combination as the portal's TABLE, in config field order

Ticket: *"you have to set the my ui same like web"*, with the Review step's two
**Combination Added** rows circled beside the portal's Lead Details build card.

An added/removed combination was one run-on green sentence —
`Type PARTIAL · Vinyl Soffit Footage 200 · Soffit Type HIDDEN VENT VINYL · Color White` — which wraps
to four lines on a phone and has to be read word by word to find a single measurement. The portal shows
the same combination as a labelled table, so mobile now does too.

**Two defects, and the second is the one that isn't cosmetic.**

1. **No structure.** `ReviewRow` gained an optional **`comboFields`**; when present it renders the label
   + eyebrow on top and a tinted card beneath holding one `label ⟷ value` row per measurement
   (`styles.comboCard` / `comboRow` / `comboLabel` / `comboValue`). The plain-row path is untouched, so
   ordinary field edits, Contract Price, Install Date and the payment-method rows are unchanged.
2. ⚠️ **The two combinations of ONE section listed their fields in DIFFERENT orders.** The screenshot's
   first row reads `Type · Footage · Soffit Type · Color` and its sibling
   `Color · Soffit Type · Type · Footage` — the same four fields, so the two read as different products.
   `describeCombo` walked `Object.entries(combo.values)`, i.e. **whatever order the stored object
   happens to hold**, which is not the order the rep filled them in and is not stable between siblings.

**The order now comes from the CONFIG.** `FieldLabelMeta` gained an `order`, stamped by a counter as
`buildFieldLabelMap` walks the config, and the new **`comboFields()`** sorts on it — so a combination is
listed exactly as the portal's card lists it. The sort is stable (ties keep read order), and a field the
label map never saw sorts last rather than being dropped.

⚠️ **`describeCombo` is KEPT and is now DERIVED from `comboFields`.** It is not display-only — that
string is what `buildChangeSummary` puts on the addendum **the customer signs**. Deriving it means the
table and the signed document can never describe one combination differently; it also picks up the
ordering fix for free.

⚠️ **`comboFields` is set ONLY on `added`/`removed` rows**, and `from`/`to` stay authoritative. An
ordinary field edit has no breakdown, so `ReviewRow` falls through to the existing two-column layout —
asserted, so a future change here can't silently reshape every row on the screen.

The card is a soft tint (`#EFF8FA` on `#CFE7EC`) rather than the mobile review's usual slate, matching
the portal card the ticket points at and separating a whole-combination row from the field rows around
it. A **removal keeps its grey values** (`valueColor`), since nothing new was entered.

Verified by driving the REAL `computeDynamicBuildChanges` over a Vinyl Soffit section whose second
combination is stored key-scrambled: both added rows breaking out into config order, the scrambled one
no longer Color-first, its derived `to` string reordering with it, a removed combination carrying the
breakdown too, and an ordinary edit carrying **none**. The pre-fix code was run from `git show HEAD:` in
the same harness and emits the ticket's screenshot string verbatim
(`Color Musket Brown · Soffit Type HIDDEN VENT VINYL · Type PARTIAL · Vinyl Soffit Footage 100`), so the
repro is asserted against the real defect rather than a reconstruction of it.

tsc 44 (baseline unchanged); `dynamic-deal-diff.ts` is identical to its HEAD eslint baseline (2
pre-existing errors) and `DynamicDealEditScreen.tsx` goes 144 → 148 warnings, all four
`react-native/no-inline-styles` — the only rule that file carries, 144 of them already.

⚠️ Needs a device check (this repo cannot render-test): that a long measurement label wraps inside the
card instead of pushing its value off the right edge.

#### …and every combination of a section shares ONE block, edited or added

Follow-up, same screen: *"you set the design but for leaffilter it's showing same, fix that too."* Seven
loose rows — `LeafFilter · Gutter Profile`, `LeafFilter · LeafFilter Color`,
`LeafFilter · Measurements · Left Side · 1st Story` … — sat directly above a tidy
`Fascia Boards · Combination Added` card. Same tab, same kind of edit, two different-looking answers.

**Settled from the captured build (`sale-portal-api-response.txt`), not by reading the labels.** The
LeafFilter tab holds **four UNLABELLED sections, each carrying ONE combination**
(`section_1782373742457__section-4`, `section_1782386890583__section-5`, …). So:

- a section whose combination existed already is **PAIRED**, and a pair emits one row per changed
  field — the loose rows;
- a section that had none is an **ADD**, and gets the card;
- `isMulti` is false for every one of them (one combo each), so **no `Combination #N` chip**, and with
  no section label the prefix falls back to the TAB — every row reads `LeafFilter · <field>` and the
  label alone cannot tell two gutter sizes apart.

**`groupComboRows` now produces the portal's shape: one bordered panel per section, holding
`Combination #1`, `Combination #2`, … as tinted tables** (`ComboSectionCard`). An edit's rows carry the
previous value struck through above the new one (`ComboField.from`, set only on an edit); an add or a
removal says so in its own eyebrow inside the block.

⚠️ **One panel per section, not one per combination.** The first pass emitted a separate card per
combination and the reporter sent it straight back — *"you are making 2 blocks, it should be one block
like web."* Two panels under one heading read as two products. `addBlock` therefore appends to the
panel already open when the section head matches, and `splitComboHead` strips a trailing
`Combination #N` from the head so two combinations of the SAME section can merge instead of each
opening its own.

⚠️ **Merging is by the section HEAD, so two LABELLED sections never merge** — `Vinyl Soffit` and
`Porch Ceiling` stay separate panels. The LeafFilter sections merge precisely because they are
unlabelled and all fall back to the tab name, which is also why they looked identical in the first
place. Tested both ways.

**Blocks are numbered the portal's way**: the authored `Combination #N` chip wins where the diff
carries one (a section holding several combinations), and the rest are numbered by position — so a
panel never repeats one title.

⚠️ **The grouping is DISPLAY ONLY and the `BuildChange` rows stay separate.** They are what
`buildChangeSummary` puts on the addendum **the customer signs** — collapsing them into one row would
change the signed document. That is also why the helper lives beside the diff rather than replacing it.

⚠️ **`comboKey` (`<groupKey>#<comboIndex>`) is what makes the grouping safe.** With four unlabelled
sections all rendering `LeafFilter · …`, grouping on the label would merge two different gutter sizes
into one card. It rides along in the submitted payload as an additive key, like `comboFields`.

⚠️ **A pair that changed only ONE field stays a plain row.** A card holding a single value is heavier
than the row it replaces, and it keeps an ordinary one-field edit reading exactly as it did before.

⚠️ **The pairs loop now sorts its fields by config `order` too.** They came from
`new Set([...Object.keys(from), ...Object.keys(to)])`, i.e. neither the order the rep entered nor
anything stable between two combinations — the same defect the section above fixes for an added
combination. This **reorders rows within `buildChangeSummary`**; the same rows are present, and the
order now matches the portal's build card.

⚠️ `groupComboRows` / `commonLabelPrefix` live in `utils/dynamic-deal-diff.ts`, not the screen, for the
usual reason — `DynamicDealEditScreen.tsx` pulls in React Native and cannot be loaded under jest, and
the prefix walk is exactly the kind of thing that fails silently (it stops one segment short of
consuming a label whole, or a row would have no name left).

Verified with 8 tests over the captured shape: the repro (two edited sections folding into ONE panel of
two combinations, in config order, with the grid cells named), an ADDED combination joining that same
panel, two labelled sections staying separate, a section's own two combinations keeping their authored
chips, a removal reporting its own kind inside the block, an edit keeping its struck `from` while an add
has none, a one-field pair staying a plain row alongside untouched flat rows, and an untouched build
producing nothing.

tsc 44 (baseline unchanged); `dynamic-deal-diff.ts` is identical to its HEAD eslint baseline (2
pre-existing errors) and `DynamicDealEditScreen.tsx` is at 148 warnings, all `react-native/no-inline-styles`
— the only rule that file carries.

##### …and an edited combination is described in FULL, not only by what moved

Follow-up: *"see in 2 boxes leaf filter profile and gutter opening width is not showing."* `Combination
#3` (an ADD) listed all five of its measurements; `#1` and `#2` (edits) listed three each, because a
pair only ever emitted rows for fields that CHANGED. The two identifying fields — `Gutter Opening
Width(4&5)` and `LeafFilter Profile` — were already sold, so they were absent, and the two cards became
indistinguishable from each other.

**New `comboFieldsForPair(orig, next, …)`** returns the whole combination in config order, with `from`
on the measurements that moved and **`unchanged: true`** on the rest. The renderer paints an unchanged
value neutral `#334155` — green would read as newly entered.

- ⚠️ **Carried on the pair's FIRST row only**, not on every changed field, so one combination
  contributes one breakdown to the payload.
- ⚠️ **Display only, again.** `field`/`from`/`to` on the individual rows are untouched — they are what
  the customer signs, and they still list only real changes. Asserted directly.
- **A cleared measurement is kept** (value `—`) rather than vanishing, so dropping a footage to nothing
  still reads as a removal.
- `groupComboRows` falls back to the changed rows when no breakdown is present, so nothing breaks on a
  row set that predates this.

⚠️ **`comboFields`' cell separator changed from `' '` to `' · '`**, matching `formatChangeFieldLabel`.
The two joins differed, so an ADDED combination read `Measurements Front · 2nd Story` while an edited
one read `Measurements · Front · 2nd Story` — the same field, two ways, on one screen. This also flows
into `describeCombo`, i.e. into the submitted addendum's text; it is a separator, not a value.

⚠️ **A pair that changed ONE field still stays a plain row.** The "a card holding a single value is
heavier" reasoning no longer strictly applies now that the card is always full, but widening it would
re-card edits nobody reported — left alone deliberately.

Verified with 6 tests: the repro (all five measurements named, the three untouched ones flagged, only
the two real edits carrying a `from`), the SIGNED rows asserted unchanged and the breakdown counted
once, a cleared measurement still reported, an added combination still carrying no previous values and
no `unchanged` flags, both card kinds naming a grid cell identically, and an untouched build producing
nothing.

### The Contract Details pencil opens the deal-edit wizard on BOTH entry points

Ticket: *"Make my deals flow also on the resulted lead sale page … instead of opening this modal take
me to same my deal flow."* On a resulted SALE opened from Sold Leads, the Contract Details pencil
opened the inline **Edit Contract Details — Select what to edit** sheet (Contract Pricing / Schedule
Date); from My Deals the same pencil on the same screen opened the 4-step wizard.

`onEditContract` was gated on `fromMyDeals`. It is now gated on whether the deal is DYNAMIC, so one
record has one editor however the rep reached it. That matters beyond consistency: **only the wizard
raises an ADDENDUM**, which is what a change to a submitted deal has to be — the inline modal writes a
`leadDraft` instead, and the two produce different documents for the same edit.

⚠️ **A legacy (non-dynamic) deal still gets the inline modal**, and that is a deliberate improvement on
the My Deals behaviour rather than a copy of it. `handleEditDealFromMyDeals` used to flash *"Edit on
web — this deal uses the legacy job builder"* and return, which on the normal lead path would have left
such a deal with **no editor at all on device**. The wizard cannot open a build that is not there; the
modal edits contract pricing and the schedule, which is exactly what that flash was refusing to do. So
the dynamic test moved OUT of the handler and onto the prop, and the flash is gone from both paths.

⚠️ **`isDynamicDeal` is now the single source of truth** for that decision — it was previously computed
inside the handler, where it could only refuse, never choose.

Unreachable without a contract: `ContractDetailsCard` renders the pencil only past its `hasContract`
guard (sale / demo), so a reset / no-demo / not-hit lead — which shows the "No contract details
available" placeholder — has no pencil to press.

`handleEditDealFromMyDeals` was renamed **`handleEditDeal`**; the old name would have read as
My-Deals-only on the path that is now every path. `fromMyDeals` is still used, for the header title
(`Deal` vs `Lead Center`) and the deal-only `DealBanners`.

tsc 44 (baseline unchanged); `LeadCenter/index.tsx` is identical to its HEAD eslint baseline
(40 problems: 16 errors / 24 warnings).

⚠️ Needs a device check (this repo cannot render-test): the pencil on a resulted SALE from Sold Leads
landing on step 1 of the wizard, and a legacy deal still opening the inline modal rather than nothing.

### Lead Center pulls to refresh

Ticket: *"add pull to refresh option here, currently we have no pull to refresh option."* The screen's
`ScrollView` bounced but had no `RefreshControl`, so a pull opened a blank gap and did nothing.

**No new fetching was written** — `useLeadCenterData` already exposes `refetch`, and the screen's
`useFocusEffect` already knew what "refresh this screen" means. `handlePullToRefresh` performs exactly
those three, in the same order: invalidate `['revrender-runs', leadId]`, invalidate
`['lead-job-builder-drafts', leadId]`, then `await refetch()`. Keeping them identical is the point — a
pull and a re-focus must not be able to leave the screen in different states.

⚠️ **The control has its OWN `pullRefreshing` flag; it deliberately does NOT reuse the hook's
`isRefreshing`.** That one is also true for the mount hydrate and every focus refetch, so binding it to
`RefreshControl.refreshing` would spin the control each time the rep merely navigated BACK to this
screen — a refresh animation for something they didn't ask for.

⚠️ `refetch` early-returns while one is already in flight (`hydrateInFlightRef`), so pulling in the
instant after a focus refetch closes the spinner immediately. The data still refreshes — the in-flight
fetch is the same request — only the animation is short. Do not "fix" this by removing the guard; it is
what stops a fast re-focus from stacking calls.

The Map tab navigates to `MapDetail` rather than rendering a map inside this `ScrollView` (only
`job_docs` and `tools` render inline), so there is no gesture to conflict with. `stickyHeaderIndices`
is unaffected — the control sits above the sticky child.

tsc 44 (baseline unchanged); `LeadCenter/index.tsx` is identical to its HEAD eslint baseline
(40 problems: 16 errors / 24 warnings).

---

## 7. Scripts

```
yarn ios / yarn android    # run
yarn start                 # Metro
yarn lint                  # eslint
yarn test                  # jest
```

### iOS pods: `bundle exec pod install`, never a bare `pod install`

CocoaPods is **pinned in the repo's `Gemfile`** (`>= 1.13, != 1.15.0, != 1.15.1`) and installed into
`./vendor/bundle`, so there is no global `pod` on PATH and a bare `pod install` answers
`command not found`. Run it from `ios/` as **`bundle exec pod install`** — Bundler walks up to the root
`Gemfile`, so you need not be in the repo root. Installing CocoaPods globally instead would sidestep
the pin and churn `Podfile.lock` against the rest of the team.

⚠️ **Ruby 3.4+ needs `gem 'nkf'` in the Gemfile**, and that is why it is there: CocoaPods requires
`kconv`, which lives in the `nkf` gem, and that gem stopped being part of Ruby's stdlib in 3.4 — so on
a modern Ruby (a new Mac ships Homebrew Ruby 4.x) `pod install` dies with
`cannot load such file -- kconv` before doing anything. It sits in the Gemfile's existing *"Ruby 3.4.0
has removed some libraries from the standard library"* block beside `bigdecimal`, `logger`, `benchmark`
and `mutex_m`. ⚠️ Do not drop it when resolving a Gemfile conflict — the gem merely being present in
`vendor/bundle` is NOT enough, since Bundler only exposes what the Gemfile declares.

Note `pod install` prints a React Native deprecation notice; `yarn ios` runs it for you.
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

`SummaryFinalizeCards` passes
**`allowRemoveExisting={scannerCategory === 'agreement' ? !editMode : true}`**, so the ✕ is hidden for
exactly one case: an **already-filed agreement in the MY DEALS edit flow** (`DynamicDealEditScreen`).

⚠️ **The flow this applies to was INVERTED on 2026-08-11 — read this before "restoring" it.** The
original ticket above was written against the Job Builder create flow, so the rule shipped as
`? editMode :` (hidden while creating). QA then corrected the requirement:

> *"I mistakenly made changes in the Job Builder based on my previous request. Please revert those
> changes… The only change required is to remove the delete/cross option from Agreements in the My
> Deals section."*

The reasoning behind the corrected direction is the stronger one: a **My Deals** deal is already
**submitted**, so its agreement is the *executed contract* — an addendum adds to it and must never
delete it. In the **Job Builder** create flow nothing is filed yet and the rep may still be correcting
the document, so delete stays. Hence `!editMode`. The current truth table:

| | create (Job Builder) | edit (My Deals) |
|---|---|---|
| **Order Sheets** — filed or new | ✕ shown | ✕ shown |
| **Agreements** — already filed | ✕ shown | **hidden** |
| **Agreements** — scanned this session | ✕ shown | ✕ shown |

⚠️ Write it as that **explicit branch on the category**, not as the equivalent
`!editMode || scannerCategory !== 'agreement'`. The two are logically identical, but QA reported the ✕
missing from ORDER SHEETS against the boolean form, and the flat expression makes it easy to believe —
and easy to break for real when the agreement rule is next edited.

⚠️ In the My Deals edit flow this leaves **no delete path for an existing agreement** — the card
header's pencil is the only entry point into the scanner. That is deliberate and is the ticket's intent.

⚠️ **`editMode` is the create/edit discriminator for this whole component** (it also drives
`agreementRequired`, `showOrderSheetCard` and `mergeDocSources`). Gating on the scanner category alone
was an early attempt here and was wrong — it stripped delete from **both** flows.

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
- **Anything BEYOND the package keeps its letters** (follow-up: *"when i duplicate the box and add any
  other value than show the box + that value letter … currently when we add any other value it should
  not be reflected"*). `describeFullPackage(entries, schemas)` returns `{ isFullPackage, extras }` from
  one pass; `extras` is the derived keys the package doesn't account for, so a duplicated package with
  lighting added renders **`📦 +Light`**. Without it, the copy and the tab it was duplicated from look
  identical while quoting different jobs. `isFullPackageSelection` is now a thin wrapper over it.
  ⚠️ **EVERY guard key is consumed by the package, not just the one that satisfied it** — a calculator
  carrying both `Versa` and `VMax` is still exactly a package (`(Versa OR VMax)` says which one
  qualifies, not that only one may be present), so it must not render `📦 +Versa`. Same for a second
  gutter size. ⚠️ Extras are `''` when the calculator is NOT a package, since the full letters render in
  that case and would otherwise be printed twice.
- ⚠️ On the tab object the field is **`packageExtras`, not `extras`** —
  `HorizontalDraggableTabs.isCalculatorIdentical` reads `calc.extras` as the classic deal center's
  extras OBJECT and would walk a string as one. The dynamic flow opts out of that check
  (`getIsDuplicate={() => false}`), but the name would still be a trap.

⚠️ **The ⓘ sits INSIDE the tab pill**, not floating above it as in the ticket's mock. That row is a
horizontal ScrollView with drag-reorder, and Android clips children drawn outside their parent's
bounds, so an overhanging badge is a coin-flip on whether it renders. For the same reason the popover
is a `Modal` rather than an inline absolutely-positioned card.

**Every place that prints the name carries the badge** (follow-ups: *"the bottom logic is working
perfectly but when we go to the next screen … top shows the combination of the letters"*, then *"here
is still missing the box"* against the two card headings):

| where | component |
|---|---|
| calculator step — footer tab | `HorizontalDraggableTabs`, via `isFullPackage` on `CalculatorView.tabCalcs` |
| calculator step — locked receipt heading | `LockedCalculatorView` |
| rollout step — top tab strip | `RolloutView`, via `packageByCalcId` |
| rollout step — quote card heading | `PremiumQuoteCard` |
| "Result Job \<name\>" — Sale/Demo chooser | `ResultJobChooser` |
| Result Lead sheet — the `Calculator` block | `ResultJobModal` |
| **Investment Center — "Includes the Following" list** | `InvestmentPanel.tsx` — REPLACES the list, see below |
| **Investment Center — calculator tab strip** | `InvestmentCenter/index.tsx`, via its own `packageByCalcId` |

⚠️ The **Investment Center** was added last, and it is TWO surfaces, not one (*"inside the investment
center when we get this combination of the products, instead of this show the box with information icon
same as we implement in the sale side"*, then, against the panel's own list, *"still show the products,
that is not my requirement — i need to show the box with information icon"*). It is the presentation
surface, so a calculator that reads as a package while quoting must read as one in front of the
customer too.

**The panel's "Includes the Following" list is the important one.** `InvestmentPanel`'s
`inclusions = jobScope.length > 0 ? jobScope : productNames` renders the job-scope descriptions when
the company has them and the bare product/category names (`Gutters · LeafFilter · Soffit · Fascia`)
when it does not. On a full package the whole list is now REPLACED by a centred box + ⓘ at `size={22}`
— presentation size, not the 14pt of a tab.

⚠️ **It replaces BOTH branches — including real job-scope sentences — and that was the explicit
answer to a direct question**, not an inference. So a package's scope copy ("Install Gutters and
Downspouts", "Installation: Align, pitch, install hidden hangers every 20-25\"…") does not appear on
this screen at all; the ⓘ card carries what it includes instead. Restricting it to the product-name
fallback was offered and declined. A calculator that is NOT a package still lists everything exactly
as before, so nothing changes for the ordinary lead.

**The tab strip is the second surface.** It is a plain `ScrollView` of `TouchableOpacity` tabs (not
`HorizontalDraggableTabs`), so it calls `describeFullPackage` itself and renders `FullPackageTitle`
for BOTH branches — passing `title` means a non-package tab is byte-identical to the `<Text>` it
replaced. Inactive tabs grey the box and the ⓘ with the rest of the tab (rollout-strip parity).

⚠️ The strip renders **only when `visible.length > 1`**, and `visible` drops unpriced and
bare-numbered calculators — so a lead presenting a SINGLE package shows no strip, which is why the
reporter's second screenshot had no badge anywhere until the panel was covered too. The panel is the
surface that is always present.

⚠️ Both mount **`FullPackageInfoModal`**, not the Overlay: `InvestmentCenter` is a NAVIGABLE SCREEN,
so there is no host modal to stack inside. (The Overlay form exists for the two Result surfaces, which
are already inside one.) They keep SEPARATE anchor state — the strip's ⓘ is at the top of the screen
and the panel's is mid-scroll, and one shared anchor would open the card against the wrong one.

⚠️ `InvestmentPanel` prints `calculator.title` nowhere — it reads it only for an activity log — so
the strip and the inclusions list are the screen's only two occurrences.

Each computes it by calling `isFullPackageSelection` on the calculator's OWN entries, so no screen can
read as a package while another reads as letters, and none of them needs a flag threaded through.

**`components/FullPackageBadge.tsx`** holds the shared rendering — `FullPackageTitle` (the name, or the
icon pair) and the contents card in two forms. Icon size tracks the font size it replaces
(`size * 1.15`), so the 20pt receipt heading and the 13pt Result Lead block each stay optically
balanced, and **`weight` defaults to `900` but must be passed as `600`** by the two Result surfaces —
their headings are not tab labels and would otherwise be silently bolded.

⚠️ **Two forms of the card, and the choice is not cosmetic.** `FullPackageInfoModal` wraps it in a
`Modal` (calculator step, rollout step); **`FullPackageInfoOverlay` is the same scrim + card with NO
`Modal`**, for the two surfaces that are already inside one — the Sale/Demo chooser and the Result Lead
sheet. Stacked native modals are unreliable on both platforms, the same reason the funding flow's
`SendLinkModal` is an in-sheet overlay. Render the overlay as the LAST child of the host modal's
full-screen root: it covers the sheet, and the window-space anchor still resolves because that root
occupies the same frame.

**The card opens directly beneath the tapped ⓘ.** It was first pinned to a fixed screen edge per
screen, which read as "the box appears at the bottom, that is wrong" the moment the rep used the ⓘ on
the *receipt heading* at the TOP of the same screen — one fixed anchor cannot serve two triggers at
opposite ends. Each ⓘ now measures itself on press (`measureAnchor` → `measureInWindow`) and the caller
passes that rect as `anchorRect`:
- **WINDOW space, not parent space** — the card renders inside a `Modal`, its own full-screen host, so
  parent-relative coordinates would resolve against the wrong origin.
- **Measured at tap time, never cached** — both tab strips scroll horizontally and reorder, so an
  icon's position is not knowable earlier.
- The card **flips above** the icon when it won't fit below, and its left edge is **clamped** to the
  screen. Height is estimated from the item count rather than measured: measuring means painting once
  in the wrong place and moving, which reads as a flinch.
- A measure can return zeros for a view mid-layout → `null` → the card **centres itself**. That is why
  visibility is its own state and not `!!anchorRect`.

⚠️ **`HorizontalDraggableTabs` deliberately does NOT import `FullPackageTitle`** — it is a shared
`widgets/` component and must not depend on a screen, so it renders its own icon pair from the
`isFullPackage` flag it is handed, measures its own ⓘ, and declares its own structurally-identical
`PackageAnchorRect`. That is the one intentional duplicate.

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

### Dynamic (portal-authored) Pitch Books

Ticket: *"Portal | Dynamic Pitch Books — PDF Upload and Image Parsing… I think in Lead Center screen
(Pitch book card) there should be arrow down and up option which show the list of pitch, on selecting
the one we will take the id of that pitch book and show the data inside pitchbook accordingly."*

The portal half (bulk PDF upload → parse pages to images → sections → publish) is a separate repo;
this is the **rep-facing consumption** half. A manager can now publish several books, so the rep picks
one instead of always getting the bundled deck. **The web app has no pitch-book API client yet**
(`grep pitch-books` over `mhalt-revDSM-sales-frontend` is empty), so unusually there is **no web ref
to port from** — this was written against the documented endpoints and their sample payloads.

**Two endpoints, both company-scoped by the JWT and both PUBLISHED-only:**
- `GET /pitch-books/sales-rep[?documentType=pitch_book]` → `{ data: { books: [...] } }` — id, name,
  `slideCount`, and a `thumbnail: { filePath, bucketName }`.
- `GET /pitch-books/sales-rep/:bookId` → `{ data: { book, sections: [...] } }` — sections ordered by
  `sectionSortOrder`, each holding slides ordered by `sortOrder`.

⚠️ **Slides arrive as `{ filePath, bucketName }`, NOT urls.** They must be exchanged for pre-signed
urls via `LeadService.getSecureUrls` before an `<Image>` can render them.

Three new files:

- **`src/services/api/PitchBookService.ts`** — the two GETs, in the `InspectionService` house style.
- **`src/utils/pitch-book.ts`** (pure, zero imports) — `normalizePitchBookSections`,
  `collectSlideRefs`, `buildPitchBookDeck`, `normalizePitchBookList`. Split out for the same reason as
  `utils/inspection-photos.ts`: the hook and screen pull in RN, this doesn't, so the logic is testable.
- **`src/hooks/usePitchBooks.ts`** — `usePitchBooks()` (list + batched thumbnail signing) and
  `usePitchBookDeck(bookId)` (one book, slides signed in **one batched call** via `collectSlideRefs`).
  Both cache for **50 minutes** — pre-signed urls expire at 60, the same window `useSecureUrls` uses.

**The key design decision: a remote book is projected into the STATIC decks' shape** —
`categories: [{ id, label }]` + `images: { [categoryId]: { [slideName]: source } }`. `<Image source>`
takes both a `require()` number and `{ uri }`, so once the projection is done **every** downstream read
in `Pitchbook/index.tsx` (slide counts, `getGlobalPosition`, `getCurrentSlideName` analytics, the
fullscreen portrait AND landscape viewers) works against either deck with no per-site branching.

`Pitchbook/index.tsx` now takes **`bookId` / `bookName`** nav params (`RootStackParamList` updated).
With no `bookId` it behaves exactly as before — bundled LeafFilter deck, or the Green Rooflines
company deck. With one, `CATEGORIES` / `pitchBookImages` / `defaultCategoryId` come from the fetched
deck instead. Also:

- **Saved progress is keyed by book** (`pitchbook-progress-{leadId}-{bookId}`) — one shared key would
  restore a rep into a section that doesn't exist in the book they just opened. The default deck keeps
  the old un-suffixed key, so existing saved positions survive.
- **Two reconcile effects.** A remote deck's sections aren't known at mount, so `activeCategory` starts
  `''` and the first effect lands it on the saved-or-first tab once the fetch resolves. The second
  clamps `currentSlideIndex` into range. Both also cover a book **edited on the portal** since the rep
  last presented it (tab deleted / section trimmed) — otherwise the rep opens onto a blank frame with
  working arrows.
- **The persist effect skips an empty `activeCategory`**, or the first render of a remote deck would
  immediately overwrite the position saved on the previous visit.
- **One early return** handles loading / error (with Try Again) / nothing-published, placed after all
  hooks and before the main `return`. Gating the whole screen covers all four slide render sites at
  once; teaching each an empty state would be four chances to miss one.

`ToolsSection`'s Pitch Book `ToolCard` became **`PitchBookCard`** (same file): the familiar row plus a
**chevron-down/up** that expands the published list in place (thumbnail, name, `N slides`), each row
navigating with its `bookId`. `LeadCenter`'s `onShowPitchbook` now takes an optional book.

⚠️ **With nothing published — or a failed list read — one tap opens the bundled deck, exactly as
before.** The dynamic list is strictly additive; a company that hasn't configured any book, or a rep
with no signal, must never end up with no pitch book at all. Same reasoning inside the normalizer: a
slide whose url can't be signed falls back to the bare S3 url rather than being dropped.

Deliberate drops, both because a blank frame mid-pitch is worse than a shorter deck: a **section with
no slides** (a legitimate portal state — created, not filled) and a **slide with no `filePath`**.

⚠️ **Two slides in one section CAN share a `slotDisplayName`** — the portal derives it from the
uploaded file name, and two PDFs both yield "Page 1.jpg". The images map is keyed by name, so
`uniqueName()` suffixes duplicates (`Page 1.jpg (2)`); without it a page vanishes from the deck with
no error anywhere.

#### Follow-up: a failed list read was indistinguishable from "none published"

QA: *"i don't know where do you make the changes, nothing showing here, i even i check api is not
calling here /pitch-books/sales-rep."* The card WAS the new one (its subtitle only exists in the new
code; the old `ToolCard` had none) — but it read **"Present the standard deck"**, which was the single
subtitle for *every* non-loading empty state.

That was a real defect in the fallback above: `data: books = []` swallows an error, so a **404 / 403 /
unreachable endpoint looked exactly like a correctly-working card for a company with nothing
published**, with no way to tell which — including for whoever is debugging it.

- **Three distinct subtitles now**: `Loading pitch books…` / `Couldn't load pitch books — tap ↻ to
  retry` (on `isError`) / `No pitch books published — standard deck`.
- **A retry button rendered OUTSIDE the row's press target**, so tapping the row still opens the
  bundled deck — a rep mid-pitch must never be blocked by a failed list read.
- **Both `queryFn`s log the failure in `__DEV__`** (`[pitchBooks] list FAILED <status> <body>`) and the
  list logs its count on success. The axios wrapper already prints `[API] → GET /pitch-books/sales-rep`
  for every request, so the pair isolates "never requested" from "requested and rejected".

Service layer verified separately (module callable, `/pitch-books/sales-rep`,
`?documentType=pitch_book`, and the `:bookId` detail path) — a failed import would present as "no
request", so that was ruled out explicitly.

Verified against the ticket's payloads verbatim: section/slide ordering (including a payload whose
sections are out of order and a slide pair whose `sortOrder` reverses them), ties keeping server order,
duplicate display names keeping both slides, empty/malformed sections and slides dropped, the
`slotKey` → `Slide N` name fallbacks, section label falling back to its id, ref de-duplication across
sections, an unsignable slide skipped and its section dropped when that empties it, the list
normalizer with and without a `thumbnail` block, and junk input (`undefined` / `null` / `{}`) as a
no-op throughout. tsc 44 (baseline unchanged); eslint on `Pitchbook/index.tsx` back to its HEAD
baseline of 13 pre-existing errors, and the three new files are clean.

---

## 7. Scripts

```
yarn ios / yarn android    # run
yarn start                 # Metro
yarn lint                  # eslint
yarn test                  # jest
```
