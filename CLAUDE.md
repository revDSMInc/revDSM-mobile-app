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

### Funding: multiple payment methods are LIVE, and a 409 on the link endpoints is terminal

Two backend specs, both at the repo root and both written against the **web** app —
`FUNDING-MULTI-PAYMENT-FRONTEND-CHANGES.md` and `FUNDING-CHARGES-ENABLED-GATE-CLIENT-CHANGES.md`.
Mobile's funding module was already ahead of web's "Stage 0" (it has rendered N rows per group since
it was written), so this pass is the parts mobile was actually missing.

**`MULTI_METHOD_ENABLED` is now `true`** (`screens/DynamicDealCenter/utils/funding.ts`). It gates the
"Add payment method" button **and** the per-row ✕ together — with Add off, a removed row is
unrecoverable inside the session. Flipping it on is what makes the rest of this section necessary:
until now two rows of the same amount and method were impossible.

#### The `charges_enabled` gate — the one 409 that must NOT be retried

`POST …/link` and `…/link-sent` now answer **409** when the company's Stripe account is connected but
`charges_enabled: false`. It used to surface as `503 "No payment provider is configured yet"`, which
sent whoever was debugging to check environment variables that were already correct.

⚠️ **The documented 409 rule ("re-`GET` the record and re-render, often succeeds after a refresh")
LOOPS here.** Nothing about the record is stale; someone with portal access has to finish setup in
Stripe. So `classifyFundingError` gained a distinct **`setupRequired`** kind, decided from the failed
request's url via the pure exported **`isLinkEndpointUrl`** — read off `err.config.url` rather than
passed in by each caller, so no future call site can forget it and quietly restore the loop.
`shouldRefetchAfter` returns **false** for it, and `useFunding.report` neither refetches nor invites a
retry; it stores the server's message on **`paymentsSetupError`**.

- ⚠️ **One banner, never one per row.** The condition is company-wide, so a job with three card rows
  would otherwise meet the same message three times. `FundingView` renders it once at the top,
  `fundingBlockers(payments, price, { setupBlocked })` adds ONE checklist line, and every card's send
  button is *withdrawn* (`linkBlocked`) rather than left live to fail — a rep shown only an error
  retries until they call support.
- `SendLinkModal` gained `blockedReason`, because the FIRST failure happens inside that sheet. It must
  not fall through to the generic *"Close this and try again"*.
- The gate self-clears on any successful `fetchLink` / `markLinkSent` and on `load` — the server trusts
  a `true` for ten minutes but **re-asks Stripe on every `false`**, precisely so an account that
  finishes onboarding is never blocked forever (no `account.updated` webhook exists).
- ⚠️ Every OTHER 409 is still `stale`, **including a refused submit** — that one carries `blockers` and
  its url is `…/submit`. Tested.

#### The client blocker mirror had drifted from the server's rules

`fundingBlockers` mirrors the server so the rep works a list instead of tapping a button that says no.
Two gaps, both newly reachable:

- **No over-allocation line.** It had the under-coverage case but not its mirror, so the rep saw a
  satisfied gate and then a 409. Now `$1,000 more than the contract price is allocated` — **the
  server's exact wording**, because the server's list *replaces* this one on a refused submit and a
  divergence there is worse than having no mirror at all.
- **No row disambiguation.** New **`describePayment(p, payments)`** → `$500 Check (1 of 2)`, matching
  the server, numbered positionally so the Nth sentence names the Nth card. `PaymentFundingCard` shows
  only the ordinal (the amount and method already have their own places on the card).

#### Abandoned applications (`applicationClosed`)

The backend gained `abandoned` / `canceled` / `expired` / `error`, and ⚠️ **it RESETS the row to
unsent**. Nothing read it, so the rep saw *"link not sent yet"* for a link they watched the homeowner
open — which reads as an app bug. Now `isApplicationClosed` / `applicationClosedNote`, an amber card +
"Send a **new** link", and in `stateOf` the Link Sent step draws **`warn`** rather than `now`.
⚠️ In `fundingBlockers` the closed arm must **outrank** the "link not sent yet" arm, or the lie returns.
The flag is deliberately ignored once `linkSent` or a `decision` lands — a stale "they abandoned it"
over a working application is worse than none.

#### Stage 1 — the allocation arrays are persisted

New **`paymentAllocations(rows, price, plans)`** → `{ downPayments, balancePayments }`, threaded through
`ResultJobModal.onConfirm` → `leadData` on the `/job-builder` POST, the outcome mirror, and
`buildCalculatorOutcomePayload` (a **whitelist** — a field not named there is silently dropped).

- ⚠️ **Additive, never a replacement.** The four scalars stay written as a derived mirror (section
  totals + the first funded row's key) because ~20 consumers read those names and the customer-facing
  agreement/amendment renderers would degrade *silently* rather than error. An un-upgraded reader sees a
  **lossy** view — one method named for a job that used three — not a wrong one.
- ⚠️ **`method` is a plan KEY here**, matching the scalar it mirrors — NOT the catalogue LABEL
  `toUpsertRows` sends to the funding API, which is the field the funding server derives `type` from.
  Do not conflate them.
- ⚠️ **Never join methods into `"Check + AMEX"`.** `resolveTierPaymentMethod`
  (`utils/dynamic-deal-pricing.ts:51`) **substring-sniffs** that value to pick the fee that grosses up
  the whole contract, so a joined string containing `amex` would silently reprice a signed deal.
- Sent as `undefined` (not `[]`) on a demo: the backend's `default: undefined` is what distinguishes
  "predates multi-method" from "no rows".
- ⚠️ **Rehydration still comes from the FUNDING record** (`hydrateRowsFromRecord`), not these arrays —
  they carry no `pid`, which is the server's merge key.

#### Also fixed: a named row with no amount vanished

`toUpsertRows` drops a row with a method but no money (the server rejects a zero amount with 422), so a
line the rep added and named silently never reached the deal while the auto row re-absorbed its money.
`confirmBlockers` now names it. The **auto** row and a **decided** row are exempt — $0 there is the
correct end state, not a gap.

#### ⛔ NOT done, and deliberately: Stage 2 (per-row gross-up)

Spec §Stage 2 is **blocked on a RevDSM decision** ("per-row gross-up" vs "one primary row") and the doc
is explicit: *do not guess it — a wrong answer here misprices jobs silently*. It also lives in
`dynamic-deal-pricing.ts`, not the funding module. The landmine is **not armed on mobile** today only
because the scalar mirror is one key and is never joined — see the warning above.

Also not done (out of scope here): Stage 3's read-only consumers, which keep working off the scalars.

Verified with 40 tests (`__tests__/screens/DynamicDealCenter/funding-multi-payment.test.ts`): both link
paths recognised and `/linkage` rejected, the gate classified on both and never refetched, every other
409 still stale incl. a refused submit's blockers, url read off `response.config` too; duplicate naming
across identical/different/positional rows and a row absent from its list; all four closed reasons plus
an unrecognised one, the flag going history on resend or decision, the blocker precedence and the amber
step with regression guards; over- and under-allocation and exact coverage, the one-line setup gate;
`groupTotal` counting the APPROVED amount; the blank named row incl. the auto/decided exemptions; and
`paymentAllocations` storing keys not labels, filing `up` as a down payment, dropping empty rows,
keeping a retired plan on its stored label, and reconciling with the scalar mirror. tsc 44 (baseline
unchanged); the original 75-test funding suite still passes; eslint 0 errors across all touched files.

### Funding activity logging — a `funding` module, and every click in it

The funding module fired **no activity logs at all**, so the one surface where money
actually moves left nothing on the Forever Record. New **`src/utils/activity-log/funding-log.ts`**
(18 events) plus **`FUNDING_MODULE = 'funding'`** in `constants/activity-log.constants.ts`.

Its own module rather than folding into `calculator` / `job_builder` because this is the only
place in the app where `POST …/charge` moves real money and where a third party (a processor,
a lender) decides the outcome — a portal filter on `funding` should read as the money trail for
a job and nothing else. Modelled on `investment-center-log.ts`, which is the closest precedent
(a mobile-first module with no web counterpart).

| where | events |
|---|---|
| pricing panel | `funding_structure_changed`, `funding_payment_row_added`, `funding_payment_row_removed`, `funding_payment_method_selected`, `funding_payments_saved` |
| the hand-off | `funding_opened`, `funding_edit_payments` |
| link | `funding_link_requested` / `_blocked` / `_failed`, `funding_link_sent` / `_send_failed`, `funding_link_copied` |
| advancing | `funding_payment_synced`, `funding_sync_all`, `funding_check_collected`, `funding_card_on_file`, `funding_card_charged` / `_declined`, `funding_loan_activated` |
| finishing | `funding_result_changed`, `funding_submitted` / `funding_submit_blocked` |

#### The endpoint-driven half lives in `useFunding`, not at the call sites

Every funding endpoint already funnels through that hook, so a new action cannot ship unlogged —
but the deciding reason is that **the outcome only exists there**. `sync`'s 200 `message` is what
the lender actually said (`Lender approved part of the request`), and a `402` on a charge is the
difference between *"the card was charged"* and *"the card was declined and nothing moved"*; a
call site sees neither. `useFunding` gained an optional third arg, `logCtx`
(`{ userId, calculatorId, calculatorTitle }`), and `ResultJobModal` a `calculatorId` prop —
display never uses it, it is what links the money back to the quote it came from.

⚠️ **`paymentFor(pid)` snapshots the row BEFORE the call.** Every one of these endpoints returns a
MUTATED record, so reading afterwards would describe a charged card as "charged" in the very event
that says it was charged — and on a failure the row may not come back at all.

#### Four rules that are not stylistic

- ⚠️ **The hosted-page URL is never logged, and no function in `funding-log.ts` accepts one.** It is
  a bearer credential scoped to one payment — anyone holding it can complete that payment. The
  channel and destination are logged instead (the server already stores them as `sentChannel` /
  `sentTo`). **`funding_link_copied` therefore takes no argument**: what matters is that the
  credential left the app, which no other event covers. Asserted by a test that scans the payload
  for anything url-shaped.
- ⚠️ **Failures are their own actions, not a flag.** A timeline showing only `funding_card_charged`
  hides a run of declines, and a `402` leaves the row un-charged so the retry is a genuine second
  attempt. Same for the link: `_blocked` (the `charges_enabled` gate — nobody at the table can fix
  it) is deliberately distinct from `_failed`.
- ⚠️ **A refused submit carries the server's `blockers` verbatim.** "The rep could not submit" is
  only useful with what stopped them, and that list is already itemised and ordered.
- ⚠️ **There is no event for a simulated lender outcome, and there must not be** — see the removal
  below. A decision reaches this module only through `funding_payment_synced` (what the lender
  actually said) or `recordDecision` (a real verdict reported out of band).

#### ⛔ REMOVED: the Scenario Simulator and `POST …/{pid}/mock-provider`

Removed on request. The dashed panel at the foot of the Funding screen stood in for a homeowner or
a lender that does not exist in development, so a tap on it wrote an **invented approval or decline
onto a real funding record** — and those rows then sat in `attemptHistory` beside genuine ones with
nothing distinguishing them.

Gone: `components/funding/ScenarioSimulator.tsx` (deleted), `FundingEndpoints.mockProvider` +
`FundingService.mockProvider`, `useFunding`'s `mockProvider` / `mockDisabled`, `FundingView`'s
`onSimulate` / `mockDisabled` props, and `MOCK_PARTIAL_RATE` in `utils/funding.ts`.

⚠️ **`recordDecision` STAYS.** It looks similar and is not: `POST …/{pid}/decision` records a
lender's *real* verdict reported to the rep out of band, which is a documented production path.
Only the invented one is gone.

⚠️ A test asserts the route is **absent** (`FundingEndpoints` has no `mockProvider`, and no endpoint
builds a path containing `mock`) rather than merely deleting the old assertion — re-adding it should
fail in CI, not ship. If a simulator is ever wanted again it belongs behind a build flag, not in the
service every rep's device carries.

#### The flow the funding was reached through rides on `meta.action`

Follow-up: *"we just append the module type with the meta action because we need to make
a difference in the log … either the user open the funding module from rehash, sale or my
deals flow … make sure the main action type should remain the funding, but inside meta we
need to update the action for each module."*

The funding screen is identical in all three flows, so the rows were indistinguishable.
Every action is now composed as **`<flow>_<baseAction>`** — `rehash_funding_card_charged`,
`sale_funding_opened`, `my_deals_funding_submitted` — with `meta.fundingSource` carried
alongside.

⚠️ **`module_type` stays `funding` for all three.** The flow is never the module, so one
portal filter still returns the whole money trail for a job. That was the explicit ask.

- **`FUNDING_SOURCES`** (`constants/activity-log.constants.ts`) is the vocabulary;
  **`resolveFundingSource({ lead, mode })`** is the single answer — `mode === 'edit'` →
  `my_deals`, else `lead.isRehashed === true` → `rehash`, else `sale`.
- ⚠️ **The FLOW out-ranks the lead's history**: `mode: 'edit'` is tested FIRST, so a
  rehashed lead opened from My Deals files under `my_deals`. The two cannot collide today
  (the deal-edit wizard has no funding step), so this is a documented decision, not an
  observed case — and `isRehashed` is matched strictly against `true`, since a truthy
  string off an API record must not reclassify a plain sale.
- ⚠️ **The prefix is applied in exactly ONE place — `fire()`** — which rewrites the bare
  `action` each emitter passed in. That is why every emitter routes through a single call:
  a newly added event cannot ship unprefixed. A test drives all 18 emitters and asserts it.
- ⚠️ **An unknown source leaves the action BARE rather than defaulting to `sale`.** A mount
  site that forgets then shows up in the data as "origin unknown" instead of being silently
  filed under a flow it never came from. `composeFundingAction` is also idempotent, so a
  double call can't yield `rehash_rehash_funding_opened`.
- The base name keeps its `funding_` segment, so an existing portal filter on `*funding_*`
  matches prefixed and bare rows alike. **`baseFundingAction()`** strips it back off so the
  portal labels from the 29 base names and badges from `fundingSource` — 29 cases, not 87.
- `DynamicDealCenterScreen` resolves it once and passes `fundingSource` to both
  `ResultJobModal` mounts; the sheet threads it into `useFunding`'s `logCtx` and its own
  `fundingLog`. ⚠️ Deliberately a plain `const`, not a `useMemo`: it is a STRING, so there
  is no identity to stabilise, and every hook in that component sits after the edit-mode
  early return — a needless hook there costs a `rules-of-hooks` error.

Verified with 25 tests (`__tests__/utils/funding-log-source.test.ts`): the resolver's three
answers plus the precedence and the strict `isRehashed` check; compose/strip round-trips,
idempotence and the bare-on-unknown rule; and an end-to-end sweep firing **all 18 emitters
in each of the three flows** — every action prefixed, every `module_type` still `funding`,
`fundingSource` mirrored, actions still distinct, verbs untouched, and the no-source
regression guard. Failure variants (`_card_declined`, `_link_blocked`, `_submit_blocked`)
carry the prefix too with the rest of the meta unchanged.

#### …and the `lead_result_field_entry` rows carry it too

Follow-up: *"when i input any value for down payment or financing and also when i changed my
payment methods from the rehash screen than in the logs there is no option that will guide us
that this change is from rehash module, sale module or my deals module … other logs are
define clearly but these logs not clear."*

Correct, and they are **not funding-module rows at all** — which is why the flow prefix missed
them. The down-payment and payment-method rows the rep sees come from
**`useOutcomeLogging`** under `module_type: 'lead_result_field_entry'`. (Entering a down
payment fires one because it flips `primaryDownMethod` from `''` to a real key, which the
form diff sees as a `downPaymentMethod` change.)

That hook now takes an optional **`source`** and stamps each row the same way — the flow
composed onto `meta.action` plus `meta.fundingSource`, reusing `composeFundingAction` so the
two modules can never drift apart.

- ⚠️ **All six `logEvent` sites route through ONE local `stamp()`**, for the reason `fire()`
  exists in `funding-log.ts`: six per-site edits are six chances to forget, and a row that
  silently loses its origin is the bug being fixed.
- ⚠️ **It is opt-in, and it has to be.** `useOutcomeLogging` has **three** callers — the
  dynamic `ResultJobModal`, the classic `DealCenter/OutcomeModal` and
  `lead-center/ResultLeadModal` — and the WEB app emits the same strings into the same
  module. With no `source`, `stamp` returns the meta untouched, so the other two callers and
  web parity are byte-identical. Only the Dynamic Deal Center's sheet passes one.
- ⚠️ **`'lead field changed'` keeps its space-separated web-parity spelling.** The prefix is
  composed in FRONT of it (`rehash_lead field changed`) rather than replacing it, so a portal
  matching with `includes(...)` keeps working. `module_type` is likewise untouched — same
  principle as leaving `funding` alone.
- **Two base actions are new**: `lead_result_field_auto_populated` and
  `lead_result_field_entered`. Those rows carried NO `meta.action` before, and one is added
  only when a flow is known, so nothing changes for a caller that passes none.
- ⚠️ On this module an un-prefixed row therefore means *"a different screen emitted it"*, not
  *"a sale"* — a distinction worth keeping in mind on the portal.

**Amount-as-typed is still not logged here.** `downPayment` is deliberately absent from the
dynamic sheet's `outcomeForm`, so site `lead_result_field_entered` never fires from it: the
amounts are already on `<flow>_funding_payments_saved`, which carries the COMPLETE breakdown
at Confirm. Adding a debounced per-edit row would duplicate that and reintroduce the
per-keystroke noise the funding vocabulary avoids.

Verified with 4 more tests in `funding-log-source.test.ts` (29 total): each outcome action
composed for each flow, the web-parity substring surviving the prefix, every one stripping
back through `baseFundingAction`, and all four left EXACTLY as they were when no flow is
passed. tsc 44 (baseline unchanged); `useOutcomeLogging.ts` and `ResultJobModal.tsx` are both
eslint-error-free, the latter still at its HEAD count of 65 problems.

#### What is deliberately not an event

**Amounts as they are typed** — that would be a row per keystroke. The method pick and the Confirm
save are the two events that describe the split, and `funding_payments_saved` carries the COMPLETE
breakdown (the same list the server treats as authoritative), so the deal is reconstructable from
that one row. A **refused** structure switch is not logged either: nothing changed, and recording it
would put a structure change in the timeline that never happened. A method **re-picked to the same
value** is not a change (same rule as `InvestmentPanel.selectPaymentChoice`).

⚠️ `logFundingRowAdded` / `logFundingRowRemoved` fire **outside** the `setRows` updater. React may
invoke an updater more than once, which would double-log; the removed row is also read before the
update, since afterwards the event is the only record that money was ever assigned there.

Verified with 35 tests (`__tests__/utils/funding-log.test.ts`, `LoggerService` mocked): the module
and actor on every row, a `userId`-less call as a no-op, absent identity fields omitted rather than
blank; each event's verb and action string; both failure variants of the link, the charge and the
save; a QR send carrying no destination; a 502 logged as a failure rather than a delivery; the
approved figure beside the ask on activation, `approvedAmt` omitted when absent but a genuine `0`
kept; blockers verbatim; and two vocabulary guards — every verb one already in use across the app,
and all 18 actions distinct and `funding_`-namespaced. tsc 44 (baseline unchanged); `funding-log.ts`,
its test and `activity-log.constants.ts` are eslint-clean, `ResultJobModal.tsx` is at its exact HEAD
count (65 problems, 0 errors) and `DynamicDealCenterScreen.tsx` at its HEAD 21 pre-existing errors.

### ✅ The refund flow DEAD-ENDED at the over-allocation gate

QA: *"there is no flow for the refund… after the dialogue it does not show me any flow for
the approval."* Repro from the screenshot: a **$500** contract with **$900 already charged**
on the down payment. Auto Adjust → the warning → **Yes** → nothing.

⚠️ **Two bugs, and the first makes the second invisible.**

**1. `confirmBlockers` blocked the way out.** The Job Price footer read *"Payments add up to
$900 — $400 more than the contract price"* and Confirm stayed disabled. The rep cannot clear
that: the row is **settled** (`charged`), so `isSettledRow` makes its amount read-only and
`isRemovableRow` refuses to delete it. There was no way forward at all — including to the
Review step, which is where the refund is raised.

**The overage IS the refund.** `confirmBlockers` gained `opts.refundDue` and only reports
what exceeds it. ⚠️ Only an **acknowledged** refund counts — answering "No" leaves the
blocker standing, which is right: the rep must then either put the price back up or accept
the refund. It never forgives an UNDER-assignment, and every call without the option is
byte-identical.

**2. The refund UI was only on the Review step**, i.e. behind the very button bug 1 disabled.
A refund block now renders on the **Job Price** step too, where the money is over-collected
and where the rep is standing when the dialog fires. The full form — method, reason, approver,
note — stays on Review beside "Send Addendum To", because that is where the rep decides who
the paperwork goes to; the Job Price block says what is happening and what happens next.

There is also an amber block for the in-between state: price below what was collected but the
rep answered **No**. It names the two ways out and offers **Continue with a refund**, which
re-opens the dialog. Without it the disabled Confirm is a puzzle — the guard ref means the
question is not asked twice on its own.

⚠️ **`String.replace` ate three dollar signs during this fix**, and it is worth knowing: a
`$$` in the REPLACEMENT string is an escaped literal `$`, so a patch script writing
``` `$${money(total)}` ``` silently produces ``` `${money(total)}` ``` — the money
formatted with no currency symbol. Tests caught it (`"Payments add up to 900"`). **Use a
function replacer** (`s.replace(from, () => to)`) in any script that writes a template
literal containing `$`.

Verified with 7 more tests (41 in the suite): the QA repro asserted to block before and clear
after, the old message still standing when nothing is acknowledged, an overage BEYOND the
refund still reported, an under-assigned job never turned into a pass, the upfront wording
given the same treatment, every refund-less call unchanged, and `refundDueFor` proven to
produce the figure the screen passes in. tsc 75 (baseline unchanged); eslint 0 errors,
`DynamicDealEditScreen` 147 → 170 warnings of the rule it already carries. 794 tests pass.

⚠️ Needs the device re-check: drop the price below what was collected, answer Yes, and
confirm the red refund block appears on Job Price, Confirm becomes live, and Review shows the
method/reason/approver form.

### My Deals asks its questions in ONE dialog now — `ConfirmDialog`

Ticket: *"in the my deal set these dialogue according to the app already used dialogue theme."*

The wizard asked the rep two destructive questions in two different chromes:

| | before |
|---|---|
| **Cancel this job?** | an inline `<Modal>` card — the app’s own look |
| **Refund required** | `Alert.alert` — **OS chrome**: system font, system buttons, and a title that reads as coming from the phone rather than from the deal |

New **`screens/DynamicDealCenter/components/ConfirmDialog.tsx`**, and both go through it.

⚠️ **The card is the one that was already there** — `borderRadius: 16`, `padding: 20`,
`maxWidth: 340`, a two-button row with `gap: 12` under `marginTop: 20`. It MOVED into the
component rather than being redesigned, so nothing about the dialogue reps already know has
shifted; what changed is that there is now one implementation instead of two that can drift.
It gained the app typeface (`PS`/`FS`) and 44pt buttons, which the inline copy predated.

⚠️ **A real `<Modal>` here, unlike the send sheet’s confirmation**, and the difference is not
stylistic. `SendLinkModal` is itself an overlay inside the Result Lead modal, so its confirm
has to be an absolutely-positioned layer (stacked native modals are unreliable on both
platforms). This one is raised from a SCREEN, where an absolute layer would be clipped by the
sticky footer. Two mechanisms, each correct for its host — do not unify them.

- **`tone`** drives the icon, the tint and the confirm button: `danger` (red) for Cancel Job,
  `warn` (amber) for the refund. A refund is not a mistake being made, it is a decision needing
  sign-off, and painting it red would say otherwise.
- **`note`** is the consequence in its own tinted block — *"This cannot be undone"*, and for the
  refund the figure that has to go back. It is the half a rep skims past when it is one more
  sentence of body text.
- ⚠️ **The refund copy is still Lance’s, verbatim.** The chrome changed; the words did not.

⚠️ The refund prompt moved from a fired-once `Alert` to `showRefundPrompt` state, and the
`refundPromptRef` guard **stays**: it is what stops the question re-asking on every render
while the price sits below the line. Dropping back above the line still clears both the guard
and the answer, so a second crossing asks again rather than inheriting the first YES.

tsc 75 (baseline unchanged); `ConfirmDialog` is eslint-error-free (12 warnings, all
`react-native/no-inline-styles`) and `DynamicDealEditScreen` goes 147 → 171 warnings of the
same rule, 0 errors — the unused `Alert` and `Modal` imports went with the change. 787 tests
pass.

⚠️ `ConfirmDialog` is the place to add the NEXT one. There are still native `Alert`s elsewhere
in the deal center (`DynamicDealCenterScreen`, `JobTrackerButton`, `DynamicJobBuilderScreen`)
that were out of scope here.

### Refunds & internal approvals in My Deals (REVDSM-1159 / 1160)

Refs: **`funding-data/SALES-APP-REFUND-APPROVALS.md`** and
**`funding-data/Funding-My-Deal-REFUND-API.md`**.

⚠️ **One rule decides the whole feature.** Lance, 24 Aug: *"Approvals are only for
refunds… The only thing that needs approval is refunds bc now the company has to give
money back."* So install date, scope, materials and a price that goes **up** need
nothing; only a price that drops **below what has already been COLLECTED** does.

| | approval? |
|---|---|
| $10,000 → $9,000, $1,000 collected | no — the rep re-works the balance |
| $10,000 → $800, $1,000 collected | **yes** — $200 has to go back |

⚠️ **Measured against COLLECTED, never against the old price.** A deal can be re-priced
a long way down and owe nothing. `collectedOn` is the fulcrum: a charged card and a
taken cheque count, a link merely SENT counts for nothing, and an activated loan funds
what the lender **granted** (`fundedAmount`), not what was asked.

#### The ordering that cannot be got wrong

⚠️ **The addendum draft is submitted FIRST, and its `draftId` goes into the refund**
**request.** That id is the only join between the refund and the paperwork the customer
signs; it can ONLY be set at creation (no endpoint attaches a draft afterwards), and the
consent handler advances only refunds whose `draftId` matches the signed draft. A refund
raised without one reaches `pendingCustomer` and **waits there forever**. `handleSubmit`
therefore calls `funding.requestRefund` after the draft POST, reading the id off it.

⚠️ A failed refund request does **not** unwind the addendum — the draft is filed and the
customer notified, so throwing it away would be worse than a refund the rep raises again.
It warns instead.

#### What is NOT built, deliberately

⚠️ **There is no `issueRefund` method and no Issue button.** The endpoint exists and
moves real money, but issuing is **Command Center only** — *"Only managers who have
access to command center can issue a refund."* The rep detects, requests and tracks.
Shipping the method in the app every rep carries is how it ends up behind a button; same
reasoning that retired `mockProvider`. ⚠️ `SALES-APP-REFUND-APPROVALS.md` §4.1 lists it
in a code block — that is the one place the two docs disagree, and the API doc (which
says it three times) wins.

Also skipped: the **approvals inbox** (§4.8, explicitly a nice-to-have — the portal
covers it), the **`feeBorne` toggle** (§5 of the API doc: the rounding question was never
answered, and *"ask before shipping a UI control for this"*), and the **approver
signature** (the API stores it but nothing captures or prints one on any side yet).

#### The down-payment lock was ALREADY enforced

⚠️ Lance asks that a collected down payment not be editable while the price still covers
it. `isSettledRow` (`decision || charged || collected`) already freezes exactly those
rows — amount read-only, no Swap, no Remove — and is stricter in the right direction,
since a charged card cannot be un-charged even below the line. **No new mechanism was
added.** What was missing is the rep being TOLD, so `isDownPaymentLocked` now drives a
caption under the group rather than a second lock that could disagree with the first.

#### Logging — `module_type` stays `funding`

Four emitters in `funding-log.ts` (10 actions). ⚠️ **The flow is never the module.**
These fire from My Deals, so `fire()` composes them as `my_deals_funding_refund_requested`
with `meta.fundingSource: "my_deals"` — the same mechanism every other funding event on
that screen uses, so ONE portal filter on `funding` still returns the whole money trail
for a job, refunds included. A refund is money moving, so it belongs there and not under
`result_lead`, which by design ends at Confirm.

⚠️ **A failure is its own action**, and the no-approvers refusal is its own again
(`funding_refund_blocked`): it is the one refusal nobody at the table can clear, and
folding it into the generic failure would hide a company-wide configuration problem
inside a list of validation errors.

#### Two 409s now, not one

⚠️ `classifyFundingError` gained **`approversMissing`** beside `setupRequired`. A 409 on
`…/refund` means the company has nobody configured to approve — the record is perfectly
current, so the documented "refresh and retry" 409 behaviour LOOPS, exactly as it did for
the Stripe gate. `shouldRefetchAfter` returns false for both. The company-level refusal
is surfaced as "ask your admin", never as a retry.

#### Other decisions worth not re-litigating

- **The warning fires from an effect on the derived flag**, not from `onChangeText`: a rep
  typing 10000 → 12000 passes through `1`, and prompting on every intermediate value would
  make the field unusable. It also cannot be skipped by the auto-adjust buttons, which set
  the price without touching the input.
- ⚠️ **Only YES makes the refund real.** Dropping back above the line forgets both the
  prompt and the answer, so a second crossing asks again rather than inheriting the first.
- **The source row is the LARGEST collected one.** A refund is capped at what ONE row
  holds, so the biggest covers the most without the rep reasoning about it; splitting one
  refund across rows is a separate feature the API has no shape for.
- ⚠️ **A declined or cancelled refund does NOT eat the allowance** (`refundableAmount`) —
  nothing went back, so a rep refused once must still be able to raise it again.
- ⚠️ **`allowSelfApproval: false` excludes the rep from the picker**, which is what stops
  the decide call 403-ing after they have already sent it. Both that and `isConfigured`
  default to the SAFE reading when the field is missing.
- ⚠️ **The approver list comes only from `/lead/v1/approvals/approvers`.** The config
  stores ROLE ids; that endpoint is the join to people and the same rule the decide guard
  enforces. Anything assembled client-side offers choices the server then refuses. It is
  also the only user-list API the mobile client has — chat participants are a different set.
- **New `widgets/modals/UserPickerModal.tsx`** because nothing was reusable: chrome from
  `ParticipantsModal`, rows from `MentionSuggestions`, filter from `Chat.tsx`. It never
  fetches and never filters by role — the caller supplies the list.

Verified with 45 tests: 34 on the rules (`funding-refund-approvals.test.ts`) — Lance’s
worked example both ways, the exact boundary ($1,000 collected re-priced to exactly $1,000
is NOT a refund), a price rise, a job with nothing collected, money collected on the
balance too, a short-approved loan funding what was granted, a sent link counting for
nothing, declined/cancelled refunds not eating the allowance, partial refunds, the lock in
both directions, all eight state labels and the pendingCustomer tone, every blocker
including the approvers-missing short-circuit and the cheque-can-refund-a-card asymmetry,
and self-approval filtering — plus 11 on the logs (`refund-log-my-deals.test.ts`): the
module asserted `funding` on all four emitters, the `my_deals_` prefix and `fundingSource`,
the sale flow prefixing differently, a bare action when no flow is known, each failure as
its own action, the draft id carried, a reassignment naming both ends, and a `userId`-less
call as a no-op. tsc 75 (baseline unchanged); every touched source file eslint-error-free,
`DynamicDealEditScreen` 147 → 168 warnings (all `react-native/no-inline-styles`, the only
rule it carries) and the four new files clean. Suites 787 passing, 1 pre-existing failure.

⚠️ Needs a device check — none of this has been driven against a running server: the
warning firing once on the crossing, the refund card appearing only after YES, the approver
picker populating, the request going out AFTER the draft with its `draftId`, and the 409
on a company with no approvers reading as "ask your admin" rather than a retry.

### The Lead Resulted timeline step now passes through in-progress

Reference: **`funding-data/LEAD-RESULTED-TIMELINE-STEP-MOBILE.md`**. On the portal's Forever
Record the **Lead Resulted** step read `Timestamp: Pending… / Result: N/A` on a lead that had
plainly been resulted — with the **Funding** step directly below it already green.

⚠️ **That step is the one sales-phase milestone with NO log-derived fallback.** The backend
reads `lead.timelineProgress[cycle].leadResulted` and nothing else (`SalesPhaseBuilder`), and
the field is created `pending`. Its neighbours look alive without help — Sales Process is
created `active`, and Funding is derived from the `JobFunding` document — which is why only
this one appeared stuck. **No `result_lead_*` / `funding_*` log moves it**; the logs render the
timeline ROWS only. So this is not a logging gap and cannot be fixed by emitting anything.

In the dynamic flow the ONLY writer was Build Job (`handleResultConfirm`, sending
`leadResulted: 'completed'`), so the field went `pending → completed` with nothing in between —
and that write lands *after* funding is submitted. Hence the screenshot: Funding active, Lead
Resulted still Pending.

`handleResultJob` → `openSheet` (`DynamicDealCenterScreen`) now PATCHes
`{ salesProcess: 'completed', leadResulted: 'active' }`.

- **`openSheet` is the moment, and it is web parity.** `deal-center/components/ResultJobModal.js`
  sends that exact pair from the chooser's Sale **and** Demo buttons — the press that lands here
  — and mobile's own static flow does the same (`useDealOutcome.handleStatusSelect`, the app's
  only other `active` write). It is also the single point BOTH entry branches funnel through, so
  one insertion covers the demo / no-lead-id early return and the normal path, and it covers both
  `<ResultJobModal>` instances this screen renders (they share one `resultModal.visible`).
- ⚠️ **Tapping "Result Lead" changes nothing.** That opens the `ResultJobChooser`, which fires no
  timeline write and no funding log; only PICKING Sale/Demo calls `handleResultJob`. Verified,
  because "opening the result screen must not flip the portal status" was the explicit
  requirement alongside this fix.
- ⚠️ **Safe to repeat.** `canAdvanceStatus` is FORWARD-ONLY (`pending → active → completed`), so
  re-opening the sheet on an already-built lead cannot knock the step back, and the Build Job
  write still wins. Abandoning the sheet leaves it 'active', which is correct — the rep did begin
  resulting the lead.
- ⚠️ **The RESUME path deliberately skips it.** A rep returning to a lead whose funding was
  already submitted goes straight to `handleResultConfirm` → `'completed'`, never through
  `openSheet`. Unchanged.
- **Not awaited**, matching the Build Job site: nothing on screen reads these flags, and a failed
  PATCH must never block resulting a lead.

#### …and **Confirm** closes it, so the step no longer waits for Build Job

Follow-up on the same ticket: *"when we click on the confirm button from the result lead screen
than call the timeline progress and … make sure the status update `leadResulted: completed`,
currently this is not calling on the confirm button."* Correct — `goFunding` saved the payments
and moved to Funding without touching the milestone, so it sat `active` for the whole of the
money flow and only completed at Build Job.

`goFunding` (`ResultJobModal`) now PATCHes `{ salesProcess: 'completed', leadResulted: 'completed' }`.
The result IS finished at Confirm — outcome, contract price and the whole payment split are
saved — and everything past it belongs to **Funding**, which the portal derives separately from
the `JobFunding` document. So the milestone now spans exactly the sheet: `active` when it opens,
`completed` when the rep confirms.

- ⚠️ **`jobBuild` is deliberately NOT advanced here.** The rep has not started building. Build
  Job still sends `{ leadResulted: 'completed', jobBuild: 'active' }` of its own accord, and the
  repeated `leadResulted` is a harmless no-op under the forward-only guard.
- ⚠️ **Fired AFTER the save succeeds, unlike `result_lead_confirmed` — and the split is the**
  **point.** That log is an EVENT (the rep pressed Confirm, which happened whatever the server
  said, which is why it is unconditional); this is a STATE CLAIM. A refused save leaves the rep
  on the pricing panel still able to change the result, and `canAdvanceStatus` is forward-only —
  so completing the milestone there would be a claim that cannot be walked back.
- **`DynamicDealEditScreen`'s Confirm is deliberately untouched.** That is the My Deals addendum
  wizard; its lead was resulted long ago and the milestone is already `completed`, so a write
  there would be a no-op at best.

#### …and the audit that came with it: nothing changes portal status on open

The **Funding** step IS log-derived (`JobFunding doc || funding logs`), so a stray `funding_*`
row on the pricing panel would turn it active before any money existed. Checked and clean:

| on the pricing panel | emits |
|---|---|
| structure switch · row add · row remove · method pick | `result_lead_*` — the module split, not `funding_*` |
| the outcome fields | `useOutcomeLogging` with `moduleType: RESULT_LEAD_MODULE` |
| `funding.load()` | **nothing** — a plain `GET /lead/v1/{id}/funding`; the doc is created by `savePayments()` at Confirm |

The first `funding_*` row is `funding_payments_saved`, fired from inside `savePayments` at
Confirm — immediately after `result_lead_confirmed` and before `funding_opened`, which is the
boundary this file already documents. `funding_link_copied` is unreachable from the pricing
panel: `SendLinkModal` is gated on `linkPayment`, set only by a card inside `FundingView`.

⚠️ **The action vocabulary is exactly in sync with the portal doc** — 40 actions emitted
(33 `funding_*`, 7 `result_lead_*`), 40 named in `RESULT-LEAD-AND-FUNDING-ACTIVITY-LOGS-PORTAL.md`,
nothing missing in either direction. Verified by extracting the string literals from both log
modules (comments stripped, so prose examples do not count) and diffing against the doc.

⚠️ `LEAD-RESULTED-TIMELINE-STEP-MOBILE.md` §5 is STALE where it says *"`result_lead_*` logs are
not emitted yet on this branch… there is no `src/utils/activity-log/result-lead-log.ts`"*. That
file and its 7 emitters exist. The rest of the doc is accurate.

tsc 75 (baseline unchanged); `DynamicDealCenterScreen.tsx` is byte-identical to its HEAD eslint
baseline (39 problems: 23 errors / 16 warnings). 16 suites / 400 tests pass.

⚠️ Needs a portal check, since the step is server-rendered: tap **Sale**, stop at the sheet, and
confirm **Lead Resulted** reads in-progress with a timestamp while **Funding** below it stays
Pending. Then **Confirm** — Lead Resulted flips to Complete and Funding goes active in the same
moment (two `timeline-progress` PATCHes will have gone out, one per end of the sheet). Then
Submit → Build Job, and reopen the sheet to confirm it STAYS Complete.

### "No money down" now confirms — the down row is named before the rep touches it

Ticket: *"if user do not want to provide any down payment go with only balance part than
allow the user to move to the next screen for the approval of their balance section."*

On the Result Lead pricing panel the rep clears the **Down Payment** so the balance carries
the whole contract — and **Confirm stays dead**, listing *"Enter an amount for the payment
method you added, or remove that line"*. The balance can never go for approval, on a
structure that is perfectly ordinary.

⚠️ **They never added it.** `confirmBlockers`' `emptyNamed` rule reads a picked method as
*"I meant to fund this line"* — a good signal, and the rule it guards is real (a line the rep
named and left blank is dropped by `toUpsertRows`, the server rejecting a zero amount with
422, while the auto row silently re-absorbs the money). But the down row is **SEEDED** with
the lead's own payment method (`seedDownMethod`, from `initialPaymentMethod`), so it arrives
already named and the signal is simply absent there.

`emptyNamed` now exempts an **entirely unfunded `down` group**. Both halves of that scope
are load-bearing:

- ⚠️ **`down` only.** It is the ONLY group whose row is named without the rep choosing
  anything — every other seed writes `method: ''` (`switchPayMode`'s upfront row and its
  split re-entry rows), and any other non-auto named row is either one the rep added or one
  hydrated from a save that carried money. A group-agnostic version was written first and it
  **broke an existing test** (`funding-multi-payment`: a blank balance line carrying a
  retired plan label must still block) — correctly, and that is the case that pins the scope.
- ⚠️ **Entirely unfunded.** $1,300 down beside a second down line left blank is still the
  forgotten amount it looks like, and is still blocked.

⚠️ **Nothing is lost by exempting it.** A blank row contributes $0, so the auto row's
remainder is identical whether it is dropped or kept, and the coverage rule below it is
untouched — an unpaid contract still cannot be confirmed. **Upfront is unaffected** (no auto
row there, and its seed names nothing), so an all-blank upfront structure is still caught by
the unassigned-contract line.

⚠️ The ✕ on the down row already worked and still does. This fixes the more obvious
gesture — clearing the amount — dead-ending on a message about a line the rep never added.

**Both flows get it from the one function**: `ResultJobModal`'s Confirm and
`DynamicDealEditScreen`'s **Next · Review** both gate on `confirmBlockers`, and the deal-edit
wizard seeds its down row from the deal's stored `paymentMethod` the same way.

Downstream is already correct and needed no change: `toUpsertRows` drops the empty row, so
the `PUT` sends one balance row; `autoAmount` hands it the full contract; `paymentAllocations`
files no $0 allocation; and the derived scalars report `downPayment: 0` with a blank
`paymentMethod`, which is what a job with no money down is.

Verified with 14 tests (`__tests__/screens/DynamicDealCenter/funding-no-down-payment.test.ts`):
the repro cleared and typed as `0`, **with the pre-fix expression asserted to have flagged it**
so the regression cannot return silently; the balance taking the whole contract and exactly one
row reaching the server; an ordinary split unchanged; and the guard still armed — a second down
line blank beside a funded one, several of them counted, a blank balance line beside a funded
balance, the balance and upfront groups explicitly NOT inheriting the exemption, plus the price,
method and over-allocation rules still speaking for themselves. tsc 75 (baseline unchanged);
`funding.ts` and the new test are eslint-clean. The 14 DynamicDealCenter suites pass, 347 tests.

⚠️ Needs a device check: clear the Down Payment on a $1,500 sale and confirm the Balance reads
$1,500, **Confirm** is live, and the funding screen opens with a single balance card.

### The Result Lead sheet was rendering in the SYSTEM font, not Public Sans

Ticket: *"adjust the screen font size and family according to the already used in the app,
make the screen more readable by reducing the font size."*

⚠️ **The family half was a real defect, not a preference.** The whole Dynamic Deal Center is
inline-styled, and these nine files declared a numeric `fontWeight` with **no `fontFamily`** —
so every line rendered in Roboto / SF while the rest of the app rendered in **Public Sans**.
NativeWind screens get it for free from `tailwind.config.js`, which maps `font-bold` →
`PublicSans-Bold`; there is no class here to do that, so nothing named the face.

⚠️ **This is the SECOND time this exact bug has been recorded in this repo.**
`screens/Installer/JobDetail.tsx` already carries the note: *"the values here used to be
`font-normal`, which resolves to NO fontFamily in this tailwind config — so half the block
rendered in the SYSTEM font while sales rendered in Public Sans."* Any new inline-styled
screen has the same hole.

#### Two tokens in `funding/funding-theme.ts`, and one sweep

**`PS`** names the six faces; **`FS`** is a 9-step scale. 130 weights and 126 sizes were
converted mechanically, with the script asserting on any unmapped value rather than letting
it through as a system-font line.

⚠️ **The weight lives in the FACE — never pair `PS.bold` with a numeric `fontWeight`.** iOS
synthesises bold on top of an already-bold face and Android can fail the lookup and fall back
to the system font, which is the very bug being fixed. That is exactly why the tailwind config
forces `fontWeight: normal` on every named weight class. All 130 `fontWeight`s are gone.

⚠️ **The screen had grown EIGHTEEN distinct sizes** — 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5,
13, 13.5, 14, 14.5, 15.5, 16, 18, 19, 22, 24, 34 — with no relationship between them. That is
what made it read as crowded rather than dense: the eye gets no hierarchy out of a half-point
difference. They collapse onto `MICRO 9 · TINY 10 · SMALL 11 · BODY 12 · BODY_LG 13 · LEAD 14
· TITLE 16 · DISPLAY 20 · EMOJI 30`, every one at or below what it replaced.

⚠️ **`MICRO` is the floor and is deliberately NOT reduced further.** It is only ever
letter-spaced uppercase eyebrows, which stay legible small — and shrinking text does not by
itself make a screen more readable, it makes it less crowded. Below ~9pt that trade stops
paying.

⚠️ **Public Sans has a taller x-height than the faces this screen was accidentally rendering
in**, so it reads slightly LARGER at the same point size. The two changes belong together:
swapping the family alone would have made the screen tighter, not looser.

#### Three things the sweep deliberately did not touch

- **`lineHeight`.** Every size went DOWN, so the existing values can only add leading — never
  clip. Re-tuning them would have buried the change in a whole-file diff.
- **Two nested `<Text>`s** (`BlockerList`, `FundingView` section label) carry only a colour.
  They INHERIT the parent `Text`'s family, so naming one would be noise.
- **The `✅` on the send confirmation.** Emoji render from the emoji font whatever the family
  says; it takes `FS.EMOJI` for its size and no face.

Two orphans DID need fixing — the `Calculator` label and the `→` glyph on the funding card had
a size but no weight, so the sweep (which hangs the family off `fontWeight`) would have left
them behind in the system font. Found by a follow-up scan asserting every `fontSize` line also
names a family; run it again after any edit here.

#### …and the payment fields, which the first sweep silently MISSED

Follow-up: *"these field size is still very large adjust it as well"*, against the Down
Payment / Balance rows.

⚠️ **Four sites kept their original sizes and the verification did not catch it.** The sweep
matched `fontSize: <number>`; these read **`fontSize: plain ? 16 : 18`** and
`fontSize: plain ? 13.5 : 13`, so neither the replace NOR the follow-up
`grep "fontSize: [0-9]"` saw them — the character after the colon is a letter. They are the
amount and the method label, i.e. exactly the two controls in the screenshot. **Grep for
`fontSize: [a-zA-Z]` as well after any pass like this.** All four are now `FS` tokens, and no
ternary sizes remain on the screen.

The amount drops 18 → `FS.LEAD` (14) and the method label 13 → `FS.BODY` (12); the label being
smaller is also what stops `Check (Bank …` clipping, helped by the amount column going
**34% → 30%** so the freed width lands on the method beside it.

⚠️ **`minHeight: 44` is now explicit on every control that was shrunk, and it is a floor, not**
**a style.** 44pt is the accessibility minimum for a touch target (Apple HIG 44 / Android 48dp),
and 9pt padding around 12pt text is ~34 — so the padding could come down only because the floor
holds the target. Do not remove it to make a row shorter. The sheet's own `SelectField` /
`MoneyField` come 48 → 44 for the same reason: that is the whole budget there is.

The rest is spacing, which has no such floor — group card `20/14/18` → `16/11/14`, row gaps
10 → 8, the plain line 10 → 8, and the add-payment circle 21 → 19.
tsc 75 (baseline unchanged). eslint **0 errors** and every file at or BELOW its HEAD warning
count — `ResultJobModal` 65→63, `FundingView` 32→28, `PaymentRowsGroup` 62→57, `SendLinkModal`
48→47, `CoverageBar` 3→2, `FundingStepper` 8→7, `PaymentFundingCard` 33→32, `BlockerList` and
`SegmentedChoice` unchanged — all of them `react-native/no-inline-styles`, the only rule these
files carry. 742 tests pass.

⚠️ Needs a device check, since this repo cannot render-test and the fonts resolve natively:
confirm the sheet is in Public Sans (compare against the Lead Center, which already is), that
nothing reads *thinner* than before — which is what a failed family lookup looks like — and
that no label now truncates at the smaller size.

### A corrected number CANCELS the old link — re-issue, not resend (REVDSM-1155)

Reference: **`funding-data/TAYYAB-1155-WRONG-DESTINATION.md`**. Builds on the resend flow
below, and changes what a resend MEANS when the rep fixes the destination.

⚠️ **The payment link is a bearer credential** — whoever opens that URL can put a card on
this job. So a fat-fingered digit hands a working card-capture page to a stranger, and
until now correcting the number made it *worse*: the backend reuses an open Checkout
session, so the resend handed the wrong person **the very same URL again**, alive until
Stripe expired it 24 hours later. A mistyped number often belongs to a real person, who
could vault THEIR card against this job and have the row reach Card on File looking
completely normal, brand and last4 and all.

**The backend now expires the old session whenever `link-sent` arrives with a different**
**`destination`.** ⚠️ **There is no new endpoint** — the behaviour keys entirely off the
destination string the app already sends, which is why the app's whole job here is to
decide *correctly* whether this send is going somewhere new.

| | the server |
|---|---|
| same destination | reuses the link — the *"the SMS never arrived"* case, where the page was fine and only the delivery failed |
| **different destination** | **expires the old session**, then mints a new page |

#### `isReissue` is the whole of what can be silently wrong

`normalizeDestination` / `isReissue` / `reissueWarning` are pure, in `utils/funding.ts`,
for the reason the rest of that file is: neither component can be loaded under jest here,
and this predicate is wrong in **both** directions with no visible symptom —

- a false **"different"** cancels a link that was working;
- a false **"same"** leaves a live credential with a stranger.

⚠️ **A raw string compare would be wrong.** The row stores E.164 (`+14438784937`) while the
sheet holds whatever the rep typed, and an email differing only in case or a trailing space
is the same inbox. `normalizeDestination` reduces both sides first.

⚠️ **A QR send never re-issues** — nothing was transmitted, the rep is showing their own
screen, and there is no wrong recipient. ⚠️ Nor does a **first** send, or a row whose last
send WAS a QR: there is no earlier destination, so a warning would name nobody. ⚠️ An
unreadable stored destination reads as unchanged rather than being guessed at — the server
decides for real either way, and a prompt naming a blank recipient tells the rep nothing.

#### The two calls, in the spec's order

⚠️ **Expiring the old link does not fix the RECORD**, so the next agreement or addendum would
go to the same wrong address. `markLinkSent` therefore PATCHes
`lead/v1/customer/{customerId}` **before** the send:

- **Before, deliberately.** A failed send then still leaves the record corrected — which is
  right on its own terms — whereas the other order can send fine and leave the typo in place.
- ⚠️ **A failure here must NOT abort the send.** The re-issue is the urgent half: it is what
  kills the link a stranger is holding. So it is awaited but never thrown from; the rep gets
  a warning naming Edit Customer instead.
- ⚠️ **Only the ONE changed field is sent.** The Lead Center writes the whole customer object;
  blanking a name from the funding screen would be indefensible.
- ⚠️ **`getRawPhoneNumber`, not E.164** — that is what `LeadCenter.handleCustomerSubmit`
  already stores (`14438784937`), so the field keeps ONE shape instead of gaining a spelling
  only this path writes. (The provider still gets E.164; two endpoints, two shapes.)
- ⚠️ **`customerId` is the CUSTOMER document, never the lead** — a different record, resolved
  as `lead.customerDetails._id`. It is threaded through `FundingLogContext` so BOTH funding
  screens get one implementation and cannot drift.

#### The cached url is dead, and the rep is told so

⚠️ **Stop assuming the URL is stable.** `markLinkSent` now RETURNS `{ reissued }` and both
hosts re-fetch the link when it is true — the QR and the Copy button were rendering a page
the server had just expired. ⚠️ It has to be reported back rather than re-derived at the call
site: the row now carries the NEW destination, so comparing it there answers false. (Same
snapshot rule as `wasLinkSent`; the new `rowFor` is its full-row sibling.)

The sheet **confirms before cancelling** — *"This cancels the link already sent to
443-878-4937…"* — which the API does not require but is the last moment to check the new
number before a SECOND stranger gets one. ⚠️ The prompt names the number in READABLE form:
nobody proofreads a digit inside `+14438784937`, which is the exact mistake being fixed. The
confirmation screen then says the earlier link was cancelled, which also warns the rep off a
url they may have copied a moment earlier.

⚠️ `cancelledOld` is captured at send time, not re-derived for that copy — the row is
refreshed by the send, so `isReissue` would compare the new destination against itself.

> ⚠️ **SUPERSEDED.** This shipped as a native `Alert.alert`, on the reasoning that the sheet
> is already an overlay inside the Result Lead modal and a further hand-rolled layer would
> go wrong on z-order. QA sent back a screenshot: the OS dialog rendered in system chrome —
> system font, system buttons, a title that reads as coming from the phone rather than from
> the deal. **It is now an in-sheet layer.** The z-order worry did not apply: `SendLinkModal`
> is NOT itself a `<Modal>` (that is the whole point of the stacked-modal note above), it is
> an absolutely-positioned `View`, so another absolute layer as the last child of its own
> root sits above it with nothing to conflict with.

The confirmation is the app’s own destructive-confirm chrome (the one Cancel Job and Reset
Job Builder use): a white card with a red-tinted unlink glyph, the warning, a red block
spelling out that anyone holding the old link — *including whoever received it by mistake* —
can no longer pay on it, then an outlined **Keep it** beside a red **Cancel & send new**.

- ⚠️ **`Keyboard.dismiss()` first.** It is raised from the text/email stage, where the
  keyboard covers the lower half of the screen. The native dialog was drawn over the
  keyboard; an in-sheet card is not, so without this the buttons can sit underneath it.
- ⚠️ **The action is held as a THUNK** (`{ warning, run }`), not reconstructed on YES. The
  channel and destination are captured at the moment the rep pressed Send, so a keystroke
  landing behind the confirmation cannot change what is actually sent.

⚠️ The refund warning in `DynamicDealEditScreen` had the same problem and is **now fixed too**
— see the section below. It needed a different mechanism (a real `<Modal>`, because it is
raised from a SCREEN rather than from inside an overlay), which is why it was a separate pass.

#### `meta.reissued` on the log

Its own field, **not folded into `resend`**: a resend re-delivers the same page to the same
person, while a re-issue **cancelled a live bearer credential**. When somebody later asks how
a stranger came to have a working link, that is the row which answers it. A re-issue implies
`resend` and both are sent, so a reader filtering on either finds it. Documented in §5.3 and
§7.10 of `RESULT-LEAD-AND-FUNDING-ACTIVITY-LOGS-PORTAL.md`.

⚠️ **Unchanged, and worth not re-litigating:** a card already on file refuses the whole thing
with a 409 — changing a card is remove-and-relink through My Deals, not a resend — and
`canResendLink` already gates that out.

Verified with 20 tests (`__tests__/screens/DynamicDealCenter/funding-reissue-link.test.ts`):
five spellings of one phone number normalising equal and an email case/space-insensitive; the
ticket repro (one corrected digit → re-issue) against the same number typed three ways →
not; a corrected email; a channel switch; QR, first send, QR-last-send, blank stored
destination and junk all refusing; the warning naming the old number readably and **asserted
not to show raw E.164**, silent when nothing is cancelled; the gate composing with
`canResendLink` (every re-issuable row is resendable, and Card on File is out of both); and
the corrected number reaching the provider as `+14438784938` while the customer record gets
`14438784938`. tsc 75 (baseline unchanged); `funding.ts`, `useFunding.ts`, `funding-log.ts`
and the test are eslint-clean, `ResultJobModal.tsx` (65) and `DynamicDealEditScreen.tsx` (147)
are byte-identical to their HEAD baselines, and `SendLinkModal.tsx` adds only
`react-native/no-inline-styles` (47 → 52), the sole rule it carries.

⚠️ Needs a device check: send a link to a wrong number, tap **Send again**, correct one digit
and confirm the prompt names the OLD number; after sending, the old url must 404 while the
new one works, the customer record must show the corrected number in Edit Customer, and the
log row must carry `reissued: true`. Then the negative: resending to the SAME number must
show no prompt and keep the original link working.

⚠️ **The one-field customer PATCH is unverified against the backend.** The Lead Center always
sends the whole object; if that endpoint replaces rather than merges, this would blank the
other fields. Confirm on device before trusting it.

### A sent payment link can be sent again (REVDSM-1155 Item A)

Ticket: *"if user input their wrong number and email for getting the payment link … there
is no option for the resend the link for payment."* Correct, and it was a dead end: the
card's send button is gated on `!p.linkSent`, so the moment the server accepts a send the
button disappears. A rep who mistyped one digit was left on a card reading **Link Sent**,
pointing at a number that does not exist, with nothing on the screen able to recover it.

Reference: **`funding-data/LINK-AND-CARD-CHANGE.md`** (Lance's 26 Aug answers). ⚠️ **No new
endpoint** — a resend is the same two calls the first send makes, `POST …/link` then
`POST …/link-sent`, both of which `useFunding` already had.

#### The rules are pure, in `utils/funding.ts`

`canResendLink` / `lastSendNote` / `resendSeed` — for the reason the rest of that file is
pure: `PaymentFundingCard` and `SendLinkModal` both need them and neither can be loaded
under jest here, and "may this row be sent again" must mean ONE thing on both.

⚠️ **`lastSendNote` is the half that actually fixes the ticket**, not the button.
`Link Sent` alone cannot tell a rep that anything is wrong — the card now reads the
destination back (`Texted to 443-878-4937 · 2:04 PM`). A resend control without it is just
a second chance to send to the same wrong number. The stored value is E.164
(`+14438784937`), so it is formatted through `formatLocalUSPhone` — nobody spots a typo in
an E.164 string. That is the one `phone-util` import in this otherwise self-contained file.

⚠️ **Gated at "Link Sent but not yet Card on File"**, the spec's own wording:
`!charged && !collected`, plus `step < 2` for a card and `!decision && !activated` for a
loan. Past that a resend quietly replaces the stored session reference and **the backend
intends to refuse it** — the doc says in terms *"don't build UI that depends on it"*. The
route for "they want to use a different card" is Item B: remove the row in the pricing
panel and add one with a fresh `pid`, which `PaymentRowsGroup` already supports.

⚠️ **A CLOSED application is deliberately excluded** even though it also sits at "sent".
`isApplicationClosed` resets `linkSent` to false and the card already offers *"Send a new
link"* over a banner explaining why — two competing send controls on one card would be
worse than either alone.

⚠️ **A resend delivers the SAME url.** `link` is idempotent while the page is open, so it
reuses the Checkout session. That is right for *"the SMS never arrived"* — the page was
always fine, the delivery was not. It is **not** a way to revoke a leaked link; a genuinely
new URL is not supported and needs a decision from the client first.

#### The sheet is reused, not duplicated

`SendLinkModal` derives `isResend` from `canResendLink(payment)` — **no new prop on either
host screen**. `PaymentFundingCard`'s new **Send again** calls the same `onSendLink`, which
both `ResultJobModal` and `DynamicDealEditScreen` already wire to `openSendSheet`, so both
flows get this with zero wiring. A separate "resend" sheet would have been a second place
for the channel rules to drift.

On a resend the sheet **opens on the channel that was used, with the destination
prefilled** (`resendSeed`) — the rep corrects the digit they got wrong instead of retyping
from a blank field, which is how the same typo gets made twice. ⚠️ Seeded with **lazy
`useState` initialisers, not an effect**: both hosts mount it conditionally
(`{!!linkPayment && <SendLinkModal …/>}`) so it remounts per open and the seed runs once —
an effect would fight the rep the moment they started editing. ⚠️ A **QR** resend opens on
`choose`: there is nothing to correct about a QR code, and the reason to resend one is
almost always to switch channel. `Back` (relabelled *"Other ways to send"*) still reaches
every other route, so the shortcut takes nothing away.

#### `meta.resend` on the log

`logFundingLinkRequested` / `logFundingLinkSent` gained an optional `resend`, set from a
new **`wasLinkSent(pid)`** in `useFunding`. ⚠️ Read **before** the call, for the same reason
`paymentFor` is: `link-sent` answers with a record whose `linkSent` is true, so reading
after would mark *every* send as a re-send. It is a sibling of `paymentFor` rather than a
field on it, because that one narrows to the log payload shape and drops the step flags.

Worth its own field rather than left to be inferred by counting rows: the commonest reason
for a second send is that the first went to a mistyped number, so *"sent again, to a
different destination"* is the interesting event and a reader should not have to
reconstruct it. Documented for the portal in §5.3 and §7.10 of
`RESULT-LEAD-AND-FUNDING-ACTIVITY-LOGS-PORTAL.md`, with a renderer case.

Verified with 25 tests (`__tests__/screens/DynamicDealCenter/funding-resend-link.test.ts`):
the gate offered on the ticket's exact row and on a loan, refused before the first send,
at `step >= 2`, on charged / collected, on all three lender decisions, on an activated
loan, on a closed application and on a cheque; the note naming the number and **not**
showing raw E.164, the email and QR forms, with and without a timestamp, the
destination-less degenerate row, and silence before any send; the seed opening on text /
email / choose, seeding nothing on a first send or once the gate refuses, and trimming a
padded address; plus a round-trip proving an untouched prefill re-normalises to exactly the
stored `+14438784937` and a corrected digit reaches the provider as `+14438784938`.
tsc 75 (baseline unchanged); `funding.ts`, `useFunding.ts`, `funding-log.ts` and the test
are eslint-clean, and the two components add only `react-native/no-inline-styles` — the
sole rule either file carries (33→37 and 48→51 against their HEAD baselines).

⚠️ Needs a device check: send a link to a wrong number, confirm the card then shows
**Texted to …** with **Send again**, that tapping it opens the sheet on the text stage with
that number prefilled, and that correcting it and resending ticks nothing new but records a
second `funding_link_sent` carrying `resend: true` and the new destination. Then the
negative: once the card is on file the block must disappear.

### The Result Lead sheet is ONE module now — `result_lead`, ending at Confirm

Ticket: *"currently you are implement the two type of logs one is about result lead and the
other is about funding … now we can update these log for the one type, type name is: Result
Lead … all the funding logs that is generated on this screen are converted with the result
lead, and when the user press the confirm button than the result logs are end and the funding
logs flow should be started."*

`ResultJobModal` emitted **two** `module_type`s for one flow — `lead_result_field_entry` for
the outcome fields and `funding` for the payment split — so a portal filter could answer
neither *"how was this job resulted?"* nor *"how did the money come in?"* on its own. New
**`RESULT_LEAD_MODULE = 'result_lead'`** + **`src/utils/activity-log/result-lead-log.ts`**
(7 emitters) cover everything up to and including **Confirm**; `funding` begins there.

| | before | now |
|---|---|---|
| sheet opens | *(nothing)* | `result_lead_opened` — the START |
| One Leg / Result / price / methods | `lead_result_field_entry` | `result_lead` |
| structure · row add · row remove · method | `funding` | `result_lead` |
| **Confirm** | *(nothing)* | `result_lead_confirmed` — the END |
| the save + funding screen onward | `funding` | `funding` (unchanged) |
| **Build Job** on a DEMO | *(nothing)* | `result_lead_build_job` |

⚠️ **The module follows the SCREEN, not the deal's history.** **Edit payments** returns to the
pricing panel, so a re-price after a lender decision fires `result_lead_opened` again (with
`reopened`) and files its edits under `result_lead` — even though the deal is well into the
money flow by then. A timeline therefore ALTERNATES between the two modules; that is correct.

⚠️ **The four `funding-log` twins are NOT dead and must not be deleted.**
`logFundingStructureChanged` / `RowAdded` / `RowRemoved` / `MethodSelected` still serve
`DynamicDealEditScreen`'s **Job Price** step, which renders the same pricing components inside
the My Deals wizard and is not a Result Lead sheet. Their `meta` payloads are kept BYTE-
IDENTICAL to the `result_lead_*` twins on purpose, so one portal renderer serves both — a test
asserts both halves.

⚠️ **`result_lead_confirmed` fires on the PRESS, before the `PUT …/funding`**, and
unconditionally. Gating it on the save succeeding would leave a refused confirm as a flow with
no terminal row — worse to read than an end marker followed by the save's own
`funding_payments_save_failed`.

⚠️ **`useOutcomeLogging` gained an OPT-IN `moduleType`** (default `'lead_result_field_entry'`).
It has THREE callers and the web app emits the same strings into that module, so the classic
`DealCenter/OutcomeModal` and `lead-center/ResultLeadModal` stay byte-identical; only the
dynamic sheet overrides it. **Do not retire `lead_result_field_entry`** — those two still use
it. The six `logEvent` sites all read the variable, for the reason `fire()` exists in
`funding-log.ts`: one missed site would leave the sheet straddling two modules again.

⚠️ `ResultLeadLogBase` is an **alias** of `FundingLogBase`, and `fire()` reuses funding's
`composeFundingAction` and its `fundingSource` field name rather than inventing
`resultLeadSource`. The flow (`sale`/`rehash`/`my_deals`) is a property of the VISIT, not of
the module, and ONE identity object (`logCtx`, renamed from `fundingLog`) feeds both sides of
the boundary — a second shape would only ever be a way for them to disagree.

⚠️ `contractPrice: 0` is OMITTED from `result_lead_opened`: the sheet seeds the price from the
calculator a tick after mount, so a `0` would read as a job quoted at nothing.

**`FUNDING-ACTIVITY-LOGS-PORTAL.md` (repo root) was updated with it** — §2 (the boundary), the
new §4.0 catalogue, §4.6, and a prefix-safe `baseAction()` in the drop-in renderer. ⚠️ That
renderer previously switched on the RAW `meta.action`, so it matched nothing: every action is
prefixed `sale_` / `rehash_` / `my_deals_`. Pre-existing bug, fixed in the same pass.

Verified with 24 tests (`__tests__/utils/result-lead-log.test.ts`): every emitter's module,
verb and action; the money trail still on `funding`; the four twins still firing into `funding`
with `my_deals_` prefixes; the twins' payloads asserted key-for-key identical; the flow prefix
across all three flows with `baseFundingAction` round-tripping; a bare action when no flow is
known; distinct `result_lead_`-namespaced actions; `userId`-less and method-less calls as
no-ops; `contractPrice: 0` omitted while `1234` is kept; `reopened` only on a real return trip;
an absent `rowCount` omitted but a genuine `amount: 0` kept; and — the regression guard that
matters most — that the OTHER two `useOutcomeLogging` callers never pass `moduleType`. tsc 75
(baseline unchanged); `result-lead-log.ts`, `useOutcomeLogging.ts` and
`activity-log.constants.ts` are eslint-clean and `ResultJobModal.tsx` is at its exact HEAD
baseline (65 problems, 0 errors).

⚠️ Needs a device check (this repo cannot render-test): one `result_lead_opened` per entry to
the pricing panel and not one per re-render; a second one carrying `reopened` after **Edit
payments**; `result_lead_confirmed` immediately before `funding_payments_saved`; and a demo
ending on `result_lead_build_job` with no `funding` row at all.

### My Deals ▸ Job Price is now the Deal Center's pricing + funding flow

Ticket: the mockup `Funding-UI-Mokap-My-Deals-Code.txt` (repo root) — the deal-edit
wizard's **3rd step (Job Price)** re-drawn as the multi-method payment allocation, with
a **Confirm →** into the Funding screen. *"implement this new Funding flow in the
existing flow and use the reuseable components that is already created in the Deal
center side."*

`DynamicDealEditScreen` step 2 held four single-value fields — **Down Payment**,
**Down Pmt Method**, **Balance** (read-only), **Balance Method** — so an addendum could
only ever describe a one-method deal. Re-pricing a job is precisely when the split
changes, and the funding module has rendered N rows per group since it was written.

**Step 2 is now TWO screens behind one wizard step**, exactly as `ResultJobModal` is:

| | |
|---|---|
| `priceScreen === 'price'` | PREVIOUS / NEW build tiers + Auto Adjust, the contract price, then the **Down Payment** / **Balance** (or **Upfront**) groups and the **Result** field |
| `priceScreen === 'funding'` | `FundingView` — one card per payment, driven to the end of its own life cycle |

⚠️ **Nothing was re-implemented.** Every control is the Deal Center component:
`funding/PaymentRowsGroup`, `SegmentedChoice`, `CoverageBar`, `BlockerList`,
`FundingView`, `SendLinkModal`, plus `hooks/useFunding` and the whole of
`utils/funding`. The wizard composes them the way the Result Lead sheet does, so a
change to either lands on both — and the pricing panel is deliberately wrapped in a
`FUND.PANEL` block because `PaymentRowsGroup` **notches its title out of that exact
colour**; on white the label reads as floating text.

- **`MethodPicker` is DELETED.** Its only two call sites were the two method fields
  above, and `PaymentRowsGroup` renders the same provider-grouped catalogue with the
  same `planBelowMin` gating, **per line** rather than once for the whole contract. A
  second payment-method picker in this file is exactly how the two surfaces would drift.
- **The four scalars are DERIVED, not dropped** — `downTotal` / `balanceTotal` /
  `primaryDownMethod` / `primaryBalanceMethod` — so `downPayment`, `paymentMethod`,
  `balance` and `balancePaymentMethod` still go out on the addendum draft byte-compatibly.
  `downPayments` / `balancePayments` (`paymentAllocations`) ride **alongside** them.
  ⚠️ Additive, never a replacement: ~20 consumers read the flat names, and the
  customer-facing agreement/amendment renderers would degrade *silently*.
- **`funding.load()` fires on MOUNT**, not on reaching step 2. It resolves long before
  the rep walks Install Date → Job Build, so the hydrate can never land mid-typing —
  the opposite trade-off (defer the request) buys one saved GET for a race on the
  screen that matters.
- **Confirm SAVES.** `goFunding` runs `toUpsertRows` over `activeRows` and `PUT`s the
  COMPLETE list, then advances **only on success** — the funding screen renders the
  server's record, so opening it after a failed save would show the previous state
  under the new price. Back / **Edit payments** runs `applyDecisionsToRows`, which is
  the ONE path that folds a lender decision onto the rows, so the header's back arrow
  is wired to it too rather than to `goBack`.

#### Two phantom-change bugs the sale sheet cannot have

The Review step DIFFS these values, which `ResultJobModal` never does — so two rules
that are correct there are wrong here:

1. ⚠️ **The mirror falls back to a named row holding $0.** The sale sheet's rule is
   strictly *"the first FUNDED row"*. A deal sold with **$0 down** and
   `paymentMethod: 'check'` seeds a down row with a method and no money, so that read
   returns `''` while the baseline reads `check` — and the Review step lists a
   **Down Pmt Method** edit on a wizard the rep opened and did not touch, **with Submit
   enabled behind it**. Same for the balance on a contract paid in full at the table.
   A funded row still wins; a named line with no money now falls back to naming itself.
   The payload is unaffected either way (it already falls back to `lead.paymentMethod`).
2. ⚠️ **`downPaymentChanged` rounds BOTH sides.** The rows hold whole dollars
   (`Math.round` on seed, `toWholeDollars` on upsert), so a stored `500.50` could never
   equal the `500` the field can express and every deal with cents opened as an edit.

⚠️ **The standalone `downPaymentError` ("cannot exceed the contract price") is MOVED,
not dropped.** With the contract split across N lines the honest question is whether
every line TOGETHER adds up — `confirmBlockers` asks it and `CoverageBar` shows it
live. A per-field ceiling could only ever check one line and would have read as
satisfied on a job over-allocated across two. It joins `contractPriceError` in one
`confirmGate` list rendered above Confirm.

#### Deliberate deviations from the mockup

- **The funding screen's primary button is `Next · Review →`, not `Submit Funding`.**
  The wizard's terminal action is the ADDENDUM; funding is submitted at sale time and
  the endpoint is idempotent anyway. The blocker checklist still renders — but it
  **reports, it does not block**: submitting an addendum has never required funding to
  be complete, and a company sitting behind the `charges_enabled` gate (which no rep
  can clear at the table) would otherwise be unable to send a change the customer still
  has to sign.
- **The contract price is always editable; amber is "needs attention", not a lock** —
  an addendum exists to re-price the job. `priceUnlocked` is set by `goPricing` when a
  decision produced banners.
- **Result is locked to `Sale` until a lender declines**, then two pills. The switch
  goes through `funding.setResult`, which the server **refuses without a logged decline**
  on the record. ⚠️ It sets the FUNDING record's result only — the addendum draft still
  carries `lead.result`. Re-resulting a signed deal is a different decision from
  recording that a lender said no.
- **The mockup's archive / restore / swap of a balance plan is NOT ported.** The deal
  center models the same fact differently and already ships it: a row a lender has
  answered LOCKS with an Approved / Declined pill and its approved amount, and
  `applyDecisionsToRows` opens the gap it left. Porting a second, parallel history of
  the same decision is how "pending" comes to mean two things on one screen.
- **Funding is a sub-screen of Job Price, so it carries no stepper** and the header
  subtitle reads `Funding · <customer>`.

`resolveFundingSource({ lead, mode: 'edit' })` → `my_deals`, so every funding row this
wizard writes is filed under the My Deals flow while `module_type` stays `funding`.
⚠️ Its doc comment claimed *"the deal-edit wizard has no funding step"* — that
collision is now REACHABLE (a rehashed lead edited from My Deals) and resolves to
`my_deals`, which is the intended answer; the comment was corrected.

Verified with 20 tests (`__tests__/screens/DynamicDealCenter/deal-edit-funding.test.ts`)
driving the real funding helpers plus the screen's exact derivations: an untouched deal
reading as no change across a normal sale, **$0 down with a stored method** (with the
funded-only value asserted directly, so the phantom cannot return silently), a contract
paid in full, cents on the stored down payment, a financing plan stored in
`paymentMethod` blanking both sides, and a balance-method-less deal; each real edit
still reported; a three-way split where the auto row holds only the remainder, the
mirror names the first funded row and **never a joined string**, the allocations keep
plan KEYS while the upsert sends catalogue LABELS; the Confirm gate ready / method-less
/ **over-allocated across two lines** / price floor first; and upfront filing as a down
payment with the inactive structure never counted. tsc 44 (baseline unchanged); eslint
on `DynamicDealEditScreen.tsx` 143 problems / 0 errors against a HEAD baseline of 144 /
0, `funding-log.ts` and the new test clean. Suite 569 passing, 1 pre-existing failure
(`installer-card-state`, unrelated).

⚠️ Needs a device check (this repo cannot render-test): the split rows and the pickers
inside the recessed panel, **Confirm** saving and opening Funding, **Edit payments** /
the header arrow folding a decision back, the Send Link sheet covering the sticky
footer, and the Review step listing no payment rows on a deal opened and left alone.

⚠️ `DynamicDealEditScreen.tsx` and `funding-log.ts` are both CRLF — use `newline=''`
on both ends (same trap as `dynamic-deal-diff.ts`).

### REVDSM-1160 — the funding routes mobile wasn't calling, and the mockup's row design

Reference: **`funding-data/Funding-my-deals-endpoint-data.md`** (the backend's own
mobile API doc) plus the screenshot of `funding-data/Funding-UI-Mokap-My-Deals-Code.txt`
rendered — the Down Payment line and the Balance line circled. *"the new endpoints for
the My Deals flow where we call the saved down payment and balance method that we store
in the sale section … also make sure the design is exactly match with the image."*

The saved sale was already being read (`funding.load()` → `hydrateRowsFromRecord`), but
four routes were missing, the record was being read through a type that dropped half its
fields, and the rows rendered as the Result Lead sheet draws them rather than as the
mockup does.

#### The four routes that were missing

| | why it matters here |
|---|---|
| `POST …/{pid}/reactivate` | Re-settle a **drifted** row. An addendum that moves the contract price moves what the loan must carry — this is the deal-edit wizard's NORMAL case, not an edge one |
| `POST …/{pid}/restore` | The mockup's **Swap** shelf. Body `{ archivedId }`, and ⚠️ **symmetric** — the current plan goes onto the shelf in exchange, so a restore can itself be undone |
| `POST …/funding/sync-all` | One call for every pollable row |
| `GET /company/v1/down-payment-limit/sales` | The ceiling the `PUT`'s new `422` enforces |

⚠️ **`sync-all` REPLACED a loop, and the loop was the bug.** `syncAll` used to call
`syncPayment` per row. Every response carries the WHOLE record, so a sequential loop
leaves the screen describing several different moments as it goes, and one unreachable
lender aborted the rest of the sweep. The endpoint polls them all and returns the
failures itemised in `problems[]` — surfaced as `FlashMessage.info`, deliberately **not**
as an error: the other rows really were refreshed, and calling the sweep a failure would
suggest nothing happened.

⚠️ **`mock-provider` is still NOT added, and must not be.** The doc lists it; this repo
removed it on request and a test asserts its absence (see "⛔ REMOVED: the Scenario
Simulator"). `check-deposited` is also left out — the doc itself flags it as a manager
action taken at the office days later, which is not a rep-app screen.

#### `userId` is now sent on every funding call

`cfg()` sends `companyid` **and** `userId`. Absent the second, the API attributes every
action on the record to *"RevDSM" (system)* — so a check marked collected, a card charged
and a loan activated all lose the name of the person who did them, in the API's own audit
trail (`collectedBy`, each `events[].by`). ⚠️ It is read off `useFunding`'s `logCtx`
rather than added as a fourth hook argument, so no caller can hand one identity to the
activity log and a different one to the API.

#### `payMode` is now SENT on save

⚠️ It is a real persisted field and was never being written. `inferPayMode` can only read
the structure back off the rows, and a contract paid in full by one down row is
indistinguishable from an upfront one that way. Omitting it from the `PUT` leaves the
stored value alone, which is why the omission was invisible.

#### The record type was dropping the fields the design needs

`FundingPaymentRow` gained `baseline` / `liveUsage` / `drifted`, `archived[]`,
`approvedCeiling`, `chargeAttempts`, `collectedBy`, `lastDecline`, `events[]`, and a
narrowed `providerState` (⚠️ only `cardBrand` / `cardLast4` are safe to display). New
`FundingArchivedPlan` / `FundingDecline` / `FundingRowEvent` / `FundingSyncAllResult` /
`DownPaymentLimit`.

⚠️ **`events[]` is per ROW and `attemptHistory` is per JOB** — kept separate because
folding them loses which row a stage belonged to. `chargeFailed` is the one event the
server does NOT deduplicate, so a count of those is a real retry count.

#### The chip, and what it is allowed to claim

`PaymentRow` mirrors `linkSent` / `activated` / `archived` / the three drift fields, and
two pure helpers in `utils/funding.ts` decide what the chip says: **`lenderState(row)`**
→ `{ tone, sub }` and **`hasLenderState(row)`**.

⚠️ **Order matters and is tested.** `declined` outranks everything — a declined row is
not "pending" merely because a link also went out — and `activated` only ever qualifies
an *approval*, so `{ decision: 'declined', activated: true }` still reads red. This is the
only control on the pricing screen that reports a THIRD PARTY's position: getting it
wrong doesn't look like a rendering bug, it looks like the lender said something they
did not.

⚠️ **Which lines draw the chip is STRUCTURAL, not stateful — `showsChip(row)`.** The
mockup's `autoRowHtml` draws it for the REMAINDER row and `simpleRowHtml` draws a
dropdown for every other line, which is exactly what the two screenshots show: the Down
Payment reads `$500 · MC/VISA ⌄ · Remove` while the Balance reads `$2,363 · GreenSky ·
Approved & activated · Swap`. A DECIDED row joins it wherever it sits — a lender's
verdict does not belong behind a chevron.

> ⚠️ **This first shipped gated on `hasLenderState` alone and that was WRONG — it is the
> "Swap is missing on mobile" bug.** The reasoning recorded here was that the chip
> replaces the dropdown, so a row the rep still has to pick a method for must keep one.
> True in the abstract, and it missed the case that actually occurs: a balance seeded
> from the SALE already has a method but no lender activity, so it fell through to a
> plain dropdown — and with the chip went **Swap** and the **archived shelf**, i.e. the
> only controls that can change the plan or restore an archived one. The remainder row
> is the row the shelf belongs to, so it is the row that must carry the control; Swap
> opens the same catalogue the dropdown does, so nothing is unpickable. Asserted with
> the repro (a check-balance sale hydrating to `auto: true` → `showsChip` true).

⚠️ **`lenderState` takes a `financing` flag, and it only changes the un-submitted case.**
A financing balance with no application out yet is genuinely OUTSTANDING — somebody has
to send it — so it reads amber, matching the mockup's chip. A check the install crew
collects needs nothing from anyone and stays grey. Painting both amber would make "needs
attention" mean nothing; painting both grey would hide the one line that does.

⚠️ **Swap is suppressed on a locked row** (amount and method are frozen server-side) and
becomes **Close** while its picker is open — it is a toggle, not a second control.

⚠️ **The mockup is visibly cramped at 390px** — the plan name truncates to `Gre…` and the
status wraps under the button. Reproduced structurally but not pixel-for-pixel: on a chip
row the amount column drops to 29% (it is READ-ONLY text there, never an input, so it
does not need an input's width), the status line may take two lines rather than being
clipped, and the Swap button is `flexShrink: 0` — it is the last thing that may be
squeezed, being the only way to change the method on that row.

**`driftNote(row)`** is the `Prior $2,863` / `−$500` line under a drifted amount. It
requires a REAL baseline: the server sets `drifted` from its own comparison, and a row
carrying the flag without a baseline would render *"Prior $0"* — which reads as the
lender having committed to nothing.

#### `PaymentRowsGroup` gained a second layout, not a second component

**`layout="plain"`** is the My Deals mockup: a bold `Down Payment` / `Balance` heading over
free-standing bordered lines, a bordered **Remove** button in place of the ✕, the lender
chip (status dot + name + `Approved & activated` + **Swap**) in place of the dropdown once
a row has a lender position, the dashed **ARCHIVED METHODS** shelf with **Restore**, and a
green `+ Add payment method`. `layout="panel"` (the default) is unchanged, so the Result
Lead sheet is byte-identical.

⚠️ **A prop rather than a fork.** Everything that can be got WRONG here — the auto row's
arithmetic, the below-minimum gate, when a row may be removed, what the chip may claim —
is shared. Two components would give two screens two different answers to those, which is
the exact class of bug this module keeps hitting.

⚠️ **The `FUND.PANEL` wrapper was REMOVED from the deal-edit pricing block.** It existed
only because `panel` notches its title out of that colour; with `plain` headings it became
a second, competing container around the lines. The mockup has no panel.

⚠️ **Swap opens the same catalogue the dropdown does.** It is not a different picker — a
second plan list is how the two would drift apart, and it is what makes the chip safe on
a row whose method has not been chosen yet (the name then reads *Select payment method*).

#### Drift on the funding card

`PaymentFundingCard` renders the mockup's `reactivate-summary`: **PRIOR → NEW** with the
delta badge, over a **Reactivate loan for $X** button (`onReactivate`, optional — omit it
and the drift is still *reported*, just not actionable, which is the right degradation).

⚠️ Gated on `drifted && decision !== 'declined' && baseline > 0 && liveUsage !== baseline`,
because `reactivate` is refused on a declined row and `409`s when the two already match —
offering a button that can only fail is worse than showing none.

#### The socket

`useFunding` subscribes to **`funding-updated`** and adopts the record it carries, so a
homeowner finishing a hosted page or a lender answering lands on screen without the rep
tapping Sync.

⚠️ **The event is COMPANY-scoped** (room `company:${companyId}`), so it fires for every
lead in the company. Without the `leadId` filter this screen would adopt a DIFFERENT job's
record over its own — and `apply` replaces wholesale, so the rep would be looking at
someone else's payments with no error anywhere. Compared as STRINGS, for the same reason
the resulted-calculator lock does: the id arrives off a socket payload and off a nav param
and those are not guaranteed to be the same type.

⚠️ The payload shape is tolerated three ways (`{ funding }`, `{ data: { funding } }`, or
the record itself) because `MOBILE-FUNDING-CATCHUP.md` — which the doc names as the source
for it — **is not in this repo**. Guessing wrong would mean silently ignoring every update.

#### Already correct, so left alone

⚠️ The doc's *"the swallowed 422 on save — fix that before anything else"* does **not**
apply to mobile. `classifyFundingError` maps `422 → 'rule'` and `report` raises a
`FlashMessage.warning`, so a refused Confirm has always said why here. That note is about
the web client.

Two new activity-log emitters, both routed through `fire()` like the other 18 so the flow
prefix cannot be forgotten: **`logFundingLoanReactivated`** (its own event, not a second
`funding_loan_activated` — two identical "activated" rows would hide that the amount
moved, which is the only thing that happened) and **`logFundingPlanRestored`** (names BOTH
plans, because the restore is symmetric and recording only the one restored leaves no
trace of what it displaced).

Verified with 34 tests (`__tests__/screens/DynamicDealCenter/funding-endpoints-1160.test.ts`):
every new route path under the lead-scoped base with `sync-all` asserted lead-scoped and
the limit read asserted NOT under `/lead/`, ids url-encoded so a slash cannot escape a
path, `restore` addressed by `archivedId`, the two bodiless posts, `companyid` present and
`userId` present (and each omitted rather than sent empty), `payMode` on the save, all
seven chip states including the two precedence guards, six drift cases including the
no-baseline and already-matching guards and junk input, and the sale-record hydrate —
methods back as plan keys, `pid` preserved, the chip reading *Approved & activated*, the
archived shelf, drift carried through, a short approval showing what was GRANTED, and an
empty record hydrating to nothing. tsc 44 (baseline unchanged); `FundingService.ts`,
`utils/funding.ts`, `useFunding.ts`, `funding-log.ts` and the new test are eslint-clean,
`PaymentRowsGroup.tsx` (62) and `PaymentFundingCard.tsx` (33) carry only
`react-native/no-inline-styles`. Suite 603 passing, 1 pre-existing failure
(`installer-card-state`, unrelated).

⚠️ Needs a device check — none of this has been driven against a running server, and the
doc itself flags archive/restore, sync-all and the down-payment cap as *"unit-tested but
never walked through HTTP"*: the Swap chip and shelf on a real approved row, Restore,
Reactivate on a drifted loan, `sync-all`'s `problems[]`, and — the one with no
documentation at all — whether `funding-updated` arrives without an explicit room join.

### Sale on an abandoned build goes STRAIGHT to the Job Builder

Ticket: *"if the down payment and finance already set and the job builder is not
submitted and user when reopen the lead than do not move the user on the funding screen
directly move to the job builder when user click on the sale button."*

The reachable case, and it is a normal one: the rep prices the job, walks the funding to
the end and taps **Submit Funding** — which results the lead and opens the builder — then
backs out without finishing the build. Only the BUILDER's own submit writes
`selectedCalculatorId`, so ticket 409's lock never engages, Result Lead is live again, and
tapping Sale made them re-walk pricing → Confirm → funding → Submit to land back where
they left off. Three taps that change nothing.

`handleResultJob` (`DynamicDealCenterScreen`) now reads the funding record first on the
**sale** arm and, when it can be resumed, hands the rebuilt outcome straight to
`handleResultConfirm` — the same function the sheet's Build Job calls.

#### ⚠️ Gated on `status === 'submitted'`, NOT on "the rows look filled in"

`canResumeJobBuild` (`utils/funding.ts`) requires a **submitted** record with payments.
This was the ticket's one real decision and it was put to the reporter rather than
inferred: *"already set"* could mean configured, and skipping there would be a hole. The
**Submit Funding gate is what enforces the per-row blockers** — link not sent, card not
charged, check not collected — so a `pending` record has not passed them. Skipping on one
would let a job be built on money nobody has collected AND leave the record `pending`
forever, with no path back to the gate. A configured-but-unsubmitted deal therefore still
gets the full sheet, which is the correct outcome: the rep has not finished the money side.

#### The outcome is REBUILT from the record, not remembered

`resumeOutcomeFromRecord(record, plans)` reconstructs the payload the sheet would have
sent. Every money field is recoverable because the record IS what the sheet saved —
`contractPrice`, and the rows it split it into — with the four flat scalars derived the
same way (`groupTotal` per half, plus the first funded row's plan key) and the full
breakdown alongside in `downPayments` / `balancePayments`.

- ⚠️ **Amounts come from `fundedAmount`, not `amount`**, so a short-approved loan
  contributes what the lender GRANTED. That is what `groupTotal` and `coverageOK` already
  count, and a resumed build must not report a larger figure than the funding screen showed.
- ⚠️ **Plan KEYS, never the catalogue LABELS the record stores.** `resolveTierPaymentMethod`
  substring-sniffs `paymentMethod` to pick the bank fee, and ~20 consumers resolve it
  against the catalogue — a label would resolve by luck, and a renamed plan not at all. A
  plan that has LEFT the catalogue keeps its stored label as the key: it is the only handle
  the record still has on what the money was committed to.
- ⚠️ **`oneLeg` / `versatile` / `pineapple` are not in the funding record** and come back as
  `'No'` / `false` / `false` — exactly what an untouched sheet would have sent. Reading them
  back from a saved outcome was offered and declined; there would be nothing to read anyway
  on this path, since only the builder's submit writes one.

#### Two wiring details that are not style

- ⚠️ **The calculator id travels as an ARGUMENT.** `handleResultConfirm` gained an optional
  `calcIdOverride`, because the resume path reaches it in the same tick as its
  `setCurrentCalculatorId` — the state is not readable yet, so relying on it would attach
  the outcome to whichever calculator was resulted last. The sheet passes nothing and
  behaves exactly as before. All four reads inside that callback use the resolved id.
- ⚠️ **It fires through `resumeRef.current.confirm`, not a direct call.**
  `handleResultConfirm` is defined below and cannot be re-ordered above — the result-opt-in
  effect already depends on `handleResultJob`, so moving that down would put the effect in
  its own temporal dead zone. Routing through the ONE function is also what stops the two
  paths drifting on the timeline PATCH, the `build_job_initiated` log and the rehash
  "reuse the saved build?" prompt.

**A failure falls through to the sheet.** Any error on the lookup opens the Result Lead
modal as before — a lookup problem must never block a rep from resulting a lead, the same
rule the rehash `openJobBuilder` read directly below already follows. The DEMO arm never
reads anything: a demo has nothing to fund.

⚠️ `resumeRef` holds BOTH the callback and the in-flight guard in one ref, for the reason
on `rehashBuild` — every hook in this component sits after the edit-mode early return, so
each one added widens that compromise. The guard is a ref rather than state because
nothing renders from it, and a state flag would be read from whichever closure
`RolloutView` is holding, which is the render before it flipped.

Verified with 15 tests (`__tests__/screens/DynamicDealCenter/funding-resume-job-build.test.ts`):
a submitted record resuming and a **pending one refusing to** (the guard the whole feature
rests on), a submitted record with no payments refused, null/undefined as a no-op; the
rebuilt outcome's price and both halves, methods as plan keys, the allocations, Sale vs a
mirrored Bank Decline, the three defaulted answers, **a short approval contributing 1,800
rather than the 2,363 asked**, a contract paid in full reporting no balance, a three-way
split naming the first funded row and never a joined string, a retired plan keeping its
label, and a $0 row not becoming an allocation. tsc 44 (baseline unchanged); eslint on
`DynamicDealCenterScreen.tsx` 39 problems / 23 errors against a HEAD baseline of 38 / 22 —
the one added is `react-hooks/rules-of-hooks` on the single new `useRef`, joining the 22
the file already carries for the documented reason. Suite 618 passing, 1 pre-existing
failure (`installer-card-state`, unrelated).

⚠️ Needs a device check: submit funding, back out of the builder, reopen the lead and tap
**Sale** — it should land on the Job Builder with no Result Lead sheet, and the submitted
job should carry the same contract price, down payment and both methods as the funding
screen showed. Then the negative: a lead whose funding is configured but NOT submitted must
still open the sheet.


### A PAID payment line can no longer be removed or swapped

Ticket: *"do not allow the user to remove the already paid downpayment or also not
allowed to swap the already paid downpayment in the my deals flow."*

`PaymentRowsGroup`'s lock was **`const locked = !!row.decision`** — and a `decision` only
ever exists on a FINANCING row. So a down payment **card that had been charged**, or a
**check already collected**, counted as untouched: the pricing screen offered **Remove**
and **Swap** on money that is with the processor.

⚠️ Neither failed loudly. Remove would 409 (the server refuses deleting a row with a sent
link or a decision), `classifyFundingError` files that as `stale`, and `report` refetches
and flashes *"Funding updated"* — which reads as success. **Swap is worse**: changing
`method` **resets that row's steps, link and decision** server-side, so it would silently
throw away a completed collection.

#### Two predicates, in `utils/funding.ts`

- **`isSettledRow(row)`** — `decision || charged || collected`. The money has moved, or a
  third party has answered for it. A settled row is a FACT, not an input: amount
  read-only, method fixed, no Swap, no Remove. This replaces `!!row.decision` as the
  component's `locked`.
- **`isRemovableRow(row)`** — `!isSettledRow(row) && !row.linkSent`. ⚠️ **Mirrors the
  SERVER's own rule rather than inventing one**: `PUT` sends the complete list and an
  omitted row is deleted, but the API refuses a row with a sent link or a decision.
  Offering a control that can only fail is worse than not offering it — the rep's route
  out is to reassign the money on the funding screen, not to make the row disappear.

⚠️ **`charged` / `collected` had to be MIRRORED onto `PaymentRow` first** — they were not
carried by `hydrateRowsFromRecord`, so the pricing screen literally could not tell a
charged down payment from an untouched one. That is the whole reason the gap existed.

#### The chip has to say WHY the buttons are gone

`hasLenderState` now counts `charged` / `collected` too, so a settled line still draws the
chip, and `lenderState` gained two branches **above** the `linkSent` one:

| state | tone | sub |
|---|---|---|
| `charged` | green | Charged |
| `collected` | green | Collected |

⚠️ Without them a charged card fell through to the amber **"Pending lender decision"**,
which is wrong twice over — the money is already in, and no lender is involved in a card
at all — and it left a row whose Remove and Swap had both vanished with nothing on screen
explaining it. ⚠️ A lender VERDICT still outranks both: `{ decision: 'declined',
charged: true }` reads *Declined by lender*, not *Charged*.

#### Applies to BOTH flows, deliberately

The ticket names My Deals, but the rule is enforced in the shared `PaymentRowsGroup`, so
the Result Lead sheet gets it too. That is not scope creep — a charged card cannot be
un-charged from either screen, and the sale sheet carried the identical hole. The visible
difference is only that `panel` layout has no Swap button to suppress.

Verified with 20 tests (`__tests__/screens/DynamicDealCenter/funding-settled-row.test.ts`)
driving the component's own two expressions: what counts as settled (charged card with
`decision` asserted `undefined`, so the old rule's blind spot is explicit; collected check;
both decisions; a merely-sent link NOT settled); Remove refused on a paid line **with the
old rule asserted to have allowed it**, refused on a sent link, still allowed on an
untouched line, the auto row still only going at $0, and nothing removable while Add is
off; Swap refused on paid and on decided rows but kept on a line still awaiting an answer
and on the remainder row; the chip still drawn on a settled row with the two new labels and
the verdict precedence; and the record hydrate carrying both flags through so the two
controls really do disappear. tsc 44 (baseline unchanged); eslint 0 errors across
`utils/funding.ts`, `PaymentRowsGroup.tsx` and the new test. Suite 638 passing, 1
pre-existing failure (`installer-card-state`, unrelated).

⚠️ Needs a device check: charge a down payment card on the funding screen, go **Back /
Edit payments**, and confirm that row shows a green **Charged** chip with no Swap and no
Remove — while an untouched line beside it keeps both.


### Swap now ARCHIVES the plan it replaces, and Restore is symmetric

Ticket: *"when we update or swap any method then the UI should behave like this"*, against
the mockup's **ARCHIVED METHODS** block — a swapped-away plan struck through on a dashed
shelf with a **Restore** beside it.

`onChangeMethod` was a plain `updateRow({ method })`. The shelf rendered `row.archived`,
which only ever holds what the **SERVER** archived — and the server has nothing to archive
until the next save. So a swap the rep made two seconds ago left **no trace and could not
be undone**, which is the whole point of the block.

#### The stack is LOCAL, and it has to be

`swapRowMethod` / `restoreRowPlan` (`utils/funding.ts`) are the mockup's `swapMethod` /
`restoreMethod`: the outgoing plan is `unshift`ed to the FRONT of the shelf, and a restore
puts the **current** plan back in its place in exchange — so the shelf is never emptied by
a restore and the restore can itself be undone.

⚠️ **Local because it happens BEFORE any save.** A plan the rep swapped away from a moment
ago has no `archivedId` the server knows, so `POST …/restore` would 404 on it. The shelf
therefore renders BOTH kinds and **`isLocalArchive`** tells them apart — a server entry
still goes to the endpoint, a local one is restored in state. `restorePlan` in
`DynamicDealEditScreen` is the one place that branches.

#### Three rules that are not arbitrary

- ⚠️ **Only SWAP shelves; the ordinary dropdown does not.** The test is `showsChip(row)`,
  because Swap is the only method control a chip row has. A Down Payment line is a rep
  picking a method for the first time, not replacing a plan — shelving those would fill
  the block with every mis-tap.
- ⚠️ **The incoming plan starts UNPROVEN** — `linkSent` / `decision` / `activated` cleared.
  That is the mockup's rule ("the freshly-picked plan never inherits green") AND what the
  server does: changing `method` resets that row's steps, link and decision. Carrying them
  over would show a green *Approved* chip for a lender who has never seen this plan.
- ⚠️ **A restored plan is unproven too — a deliberate divergence from the mockup**, whose
  `restoreMethod` comment says it "brings back exactly the status that plan had when it was
  archived". Locally we cannot honestly claim a lender still stands behind a plan the row
  has not carried for the last few minutes, and the next save resets those steps anyway —
  restoring them would put a green chip on a plan the server is about to un-approve.

A plan that has **left the catalogue** keeps its stored label on restore (`methodLabel`),
since that is the only handle the row still has on what the money was committed to. An
unknown `archivedId` is a no-op rather than a wipe.

Also: the shelf's **Restore button is now `flexShrink: 0`** — the plan name truncates
before the button does, because Restore is the only way back to an archived plan.

⚠️ The local shelf lives for the editing session. It survives Confirm → Funding → **Edit
payments** (those operate on the rows in state), and is lost on a full reload of the
screen, where the server's own `archived[]` takes over. That matches the mockup, whose
stack is session-local too.

Verified with 14 tests (`__tests__/screens/DynamicDealCenter/funding-swap-archive.test.ts`):
the outgoing plan shelved by label and a second swap stacking newest-first (the mockup
screenshot's two entries), the incoming plan not inheriting status, local entries marked as
local while a server id is not, re-picking the same plan archiving nothing, **the dropdown
asserted NOT to shelve** with `showsChip` false on that row, a plan-less row, other rows
untouched by reference; and for restore — the displaced plan taking its place, a restore
undone by restoring again to land exactly where it started, the named entry picked out of a
shelf of several, the restored plan unproven, a retired plan keeping its label, and an
unknown id as a no-op. tsc 44 (baseline unchanged); eslint 0 errors across
`utils/funding.ts`, `PaymentRowsGroup.tsx`, `DynamicDealEditScreen.tsx` and the new test.
Suite 652 passing, 1 pre-existing failure (`installer-card-state`, unrelated).

⚠️ Needs a device check: Swap the Balance plan twice and confirm both previous plans stack
newest-first under ARCHIVED METHODS, that Restore swaps them back symmetrically, and that
changing a Down Payment method through its dropdown adds nothing to any shelf.


### Auto Adjust asks about the refund, and the approval has a progress rail

Ticket: *"add the flow when user click on the auto adjust and the refund is happend than show
the list of the person ho can approve the fund, get the data of aprovers from … `GET
/lead/v1/approvals/approvers?type=refund` … and also add the UI of the aprovals status here
with this bar navigation flow"*, with a screenshot of a four-dot stepper (✓ ✓ ③ ④).

Two gaps on top of the refund work already in this branch. The approver picker existed only on
**Review**, two steps past the moment the rep learns a refund is happening; and once a request
went out there was nothing anywhere saying where it had got to — `liveRefunds` had no consumer
at all.

#### 1. The button asks; it no longer leaves it to the effect

`handleAutoAdjust` set the contract price and returned, relying on the effect over `needsRefund`
to raise Lance's warning. That effect **latches** (`refundPromptRef`) so a rep typing their way
down to a figure is asked once rather than per keystroke — right for typing, wrong for a BUTTON.
A rep who answered *No*, re-shaped the build and pressed **Auto Adjust** again is making a fresh
decision on a fresh number, and the latch swallowed it: the price landed below what was collected
with nothing on screen saying so.

It now computes the adjusted figure into a variable, and re-opens the prompt when
`requiresRefundApproval(adjusted, funding.payments)`. ⚠️ An **already-acknowledged** refund is
left alone — the rep has answered, and re-asking on every adjustment is the noise the latch
exists to prevent.

#### 2. The approval rail — four steps, and `Approved` is the SECOND

**`REFUND_APPROVAL_STEPS` / `refundApprovalStates` / `refundApprovalNote` / `refundsOnJob`** are
pure, in `utils/funding.ts`, for the usual reason: `StepRail` pulls in react-native and cannot be
loaded under jest here.

⚠️ **The expensive mistake this rail can make is implying that approving returns the money.** It
does not — approval only unlocks the customer's *signature*, and a manager releases the funds
afterwards. So the rail is **Raised → Approved → Customer Signs → Refunded** and `Approved` sits
second of four. A two-step approved/not, or a rail that ends on approval, tells the rep the money
is back when it is not. `pendingCustomer` — an approved request waiting on the customer, and the
**normal resting state** — therefore draws amber on step 3 and leaves step 4 untouched.

⚠️ **A dead request dashes its remaining dots rather than greying them.** Grey reads "not yet";
`declined` and `cancelled` are terminal and those milestones will never happen (the rep raises a
NEW refund). `failed` stops on the LAST dot — it got all the way there and fell over — while
`declined` stops on the second.

⚠️ **`refundsOnJob` keeps TERMINAL refunds**, unlike `liveRefunds`. A refund that has actually
been paid back, or one that was declined, is exactly what a rep needs to see on reopening the
deal; dropping it makes a completed refund vanish and read as though it never happened. The rail
reads the SERVER's refund and never re-derives it from `refundDue` — once a request is out, how
far it has got is a fact only the server holds, and the screen's own arithmetic would happily
report an already-declined refund as fresh. When the two figures disagree (the rep re-priced
after sending) the card says *"Sent for approval at $X"* rather than quietly showing the new one.

#### `StepRail` was extracted so there is exactly ONE of these

`FundingStepper`'s body — dot colours, the SVG connectors, the dashed "somebody else posts this"
ring — moved to **`components/funding/StepRail.tsx`**, and `FundingStepper` is now just the
translation from a payment to it. ⚠️ The two rails genuinely appear **together** (a payment card
above, its refund below), so two copies would be two answers to "what does a finished step look
like" on one screen. `RailStep` gained optional `sub` / `caption`, which is all the payment rail
needed to keep its approved-amount line and its owner caption. The Android `borderStyle: 'dashed'`
caveat moved with the code and still applies.

#### The picker is offered where the price dropped, not two steps later

**`RefundApproverRow`** (same file as the rail) is rendered TWICE — on the pricing step, inside
the existing rose refund card, and on Review beside "Send Addendum To". Both drive the same
`approverId`, so the two can never disagree about who was chosen; the Review step's hand-rolled
copy was replaced by it. ⚠️ *"Carry on for two more steps and you will be asked who signs this
off"* is how a request goes out **unassigned** — and an unassigned request appears in **nobody's**
`/approvals/mine` and simply sits there.

The feed is `useRefundApprovers` → `pickableApprovers`, unchanged. ⚠️ The rose hexes in the new
component are deliberately the SAME ones `DynamicDealEditScreen`'s refund blocks already use — it
is dropped inside them, and a second rose reads as a nested, unrelated card.

`FundingView` gained an optional **`refunds`** prop rendering `RefundApprovalCard` **above** the
payment cards: money going back is the exception on that screen and it comes out of a row
underneath, so a rep reading the cards first would reconcile a collected total the refund has
already been taken off. ⚠️ Optional by construction — the Result Lead sheet prices a sale that has
collected nothing to give back, so only the My Deals mount passes it.

Verified with 21 tests (`__tests__/screens/DynamicDealCenter/funding-refund-approval-rail.test.ts`):
four milestones with `Approved` second and `Refunded` last; one state per dot for all eight server
states and for none; the pre-request preview; `pendingApproval` amber and not done; **`pendingCustomer`
approved but the last dot NOT done**, asserted across every state so only `refunded` closes it;
`customerSigned` and `issuing` sharing the last leg; declined stopping on the approval dot with the
rest dashed; cancelled dashed but never `bad`; failed on the last dot; the note never saying approving
returns the money and being distinct for every state; `refundsOnJob` keeping a terminal refund,
ordering newest-first, pairing across rows and no-op on junk; and Auto Adjust reaching the same
verdict the prompt is gated on (below, exactly-covering, and nothing collected). tsc 75 (baseline
unchanged); eslint **0 errors** across all touched files — `DynamicDealEditScreen` 166 warnings,
`FundingView` 28, `RefundApprovalStatus` 12, `StepRail` 7, `FundingStepper` **0** (down from 8; its
styles moved to `StepRail`), `utils/funding.ts` clean, every one of them `react-native/no-inline-styles`.

⚠️ Needs a device check (this repo cannot render-test): press **Auto Adjust** on a deal whose new
price falls below what was collected and confirm the warning fires *every* time, that answering Yes
reveals the rail and the approver picker on the pricing step itself, that picking an approver there
shows the same name on Review, and that after submitting the addendum the rail reads *Waiting on
approval* on both the pricing step and the funding sub-screen.

⚠️ `DynamicDealEditScreen.tsx`, `FundingView.tsx`, `funding.ts` and the two new components are all
CRLF — use `newline=''` on both ends.

#### ✅ …and why the picker was empty: the request was never made, and the flag was read too strictly

Follow-up on the same ticket, with a screenshot of the block reading **No approvers configured**:
*"where you call this end point i dont see this end point response in the console or in the drop
down."* Correct on both counts, and there were **two independent faults** behind the one message.

**1. `useRefundApprovers` was gated on `companyId`, so it never asked.** The query read
`enabled: enabled && !!companyId` with `companyId = user?.companyId`. On a profile that does not
carry one, TanStack never runs the `queryFn` — no request, no console line, and a refusal that had
never asked the server anything. ⚠️ The gate is **gone**: the route is authenticated by the JWT,
which already scopes the company, and `companyid` is a header convention `cfg()` omits when absent
— exactly as every other funding call behaves. The hook also now takes a `companyIdOverride` and
the screen passes **`lead?.companyId || user?.companyId`**, the same expression `useFunding` is
already called with, so the picker and the refund request that follows it cannot end up scoped to
different companies (which would be a 403 at `decide` time).

**2. `isConfigured: body.isConfigured === true` discarded a populated list.** Any deployment that
does not send the field turned two real approvers into "No approvers configured" — telling the rep
to go and ask their admin for something the admin had already done. ⚠️ **A non-empty list IS
configured, whatever the flag says.** The flag is still honoured when the list is EMPTY, because
that is the case it exists to describe: nobody set up ⇒ the request would 409.

That rule is now the pure **`normalizeApproverFeed`** in `utils/funding.ts`, for the reason the
rest of that file is pure — the shape an endpoint answers in is exactly the sort of thing that is
wrong *silently*. It unwraps the envelope at three depths, drops an id-less row (an unassigned
request sits in nobody's `/approvals/mine`), reads `_id` beside `id` and `role` beside `roleName`,
and falls back to an email rather than rendering a blank row.

**3. A failed READ no longer borrows the not-configured message.** They are different problems with
different fixes: one is *"try again"*, the other is *"ask your admin"*, and only the first is the
rep's to solve. `RefundApproverRow` gained `isError` + `onRetry` (a **Try again** link), and the
`queryFn` logs both arms in `__DEV__` — `[refundApprovers] loaded N approver(s)` or
`[refundApprovers] FAILED <status> <body>`. With the axios wrapper's own request line that pair is
what tells "never asked" apart from "asked and rejected", which is the precedent `usePitchBooks`
already set for the same class of bug.

⚠️ `isLoading` is `query.isLoading || (query.isFetching && approvers.length === 0)`, **not a bare
`isFetching`** — a background revalidation would otherwise swap a chosen approver back to
"Loading approvers…" under the rep.

#### The approver is FIXED while the request is out

*"once a approv person is selected than you can not change until unless getting response from that
side."* `approverLocked = jobRefund?.state === 'pendingApproval'` — the picker is disabled, draws a
closed padlock instead of the chevron, and says why.

⚠️ **Locked at SEND, not at selection.** Before submitting, the pick is local state and a mis-tap
has to be correctable; after it, the request the approver is looking at is filed against them
server-side and re-picking here would change a local field and nothing else. Moving a live request
needs `POST /approvals/:id/reassign` (`pending`-only, and not wired) — a picker that silently
changed nothing would be worse than one that says it is shut.

⚠️ **It re-opens on every verdict, including `declined`.** A declined request is terminal, so the
rep raises a NEW refund — and that one may well need to go to somebody else. Locking past the
answer would be a bottleneck with no way out, which is the thing Lance explicitly asked to avoid.

Verified with 20 more tests (`__tests__/screens/DynamicDealCenter/funding-approver-feed.test.ts`):
the spec payload verbatim and all three envelope depths; the repro — a populated list with no flag
now configured, **with the pre-fix expression asserted to have refused it**; the flag still honoured
on a genuinely empty list; id-less rows dropped, `_id`/`role` spellings, the email and placeholder
name fallbacks; five junk shapes each returning a refusal rather than throwing, with
`allowSelfApproval` defaulting strict; the self-approval filter including the one-rep company that
correctly ends up with nobody to send to; and the lock — on for `pendingApproval` only, off for all
seven other states and before anything is raised. tsc 75 (baseline unchanged); eslint **0 errors**
across every touched file. Suite 846 passing, 2 pre-existing failures (`installer-card-state` and
`commission-config`, which imports a module that does not exist — both unrelated).

⚠️ Fault 1 cannot be asserted without rendering the hook, and this repo cannot render-test, so the
device check is the proof: open a refunding deal and confirm **one**
`GET /lead/v1/approvals/approvers?type=refund` in the console with a `[refundApprovers] loaded N`
line beside it, the people listed in the sheet, and the row locking after Submit.

#### The picker sheet sat under the nav bar, and nothing said which tap raises the refund

Two more from the same screen: *"bottom sheet is hide and also what i can do when i slect the
aproval person what is the next flow how i can raised the refund request"*.

**1. `UserPickerModal` had a flat `paddingBottom: 12`.** `KeyboardProvider` (App.tsx) puts the app
edge-to-edge, so on Android the window extends UNDER the three-button navigation bar and the last
row of the list sat behind it — half visible and un-tappable, which is exactly what the screenshot
shows on a one-approver company. It now reads `useSafeAreaInsets()` and pads
`Math.max(insets.bottom, 12)`, the same shape the deal-edit footer already uses, plus a small
`contentContainerStyle` tail on the `FlatList` (the sheet's own padding sits OUTSIDE the list, so a
list long enough to scroll would still end flush against the bar).

⚠️ Insets travel by **React context**, which crosses a `Modal` even though its native view tree does
not — so reading them inside the sheet is enough, with no provider to thread.

⚠️ **Every other bottom sheet in `widgets/modals/` has the same latent gap.** They get away with it
today only because their last row is not the one that matters; `ParticipantsModal`
(`ChatModals.tsx`) is the closest twin and is worth the same treatment when it is next touched.

**2. Picking a person LOOKS like the action, and it is not.** The rail's note already said
*"Submitting the addendum sends this to the approver you choose"* and a rep still asked how to raise
the request — because it never named the tap. Two changes, and the button is the important one:

- the **Submit** button reads **"Submit & Request Refund"** whenever a refund is in play, and plain
  "Submit Addendum" otherwise. That tap genuinely does both, in that order — file the draft, then
  `POST …/refund` carrying its `draftId` — so the label is a description, not a hint.
- the pricing-step card now spells out the sequence once an approver is chosen: *"Nothing has been
  sent yet. Tap **Confirm**, then **Next · Review**, then **Submit & Request Refund** — that one tap
  sends the addendum to the customer and raises this refund with \<name\>."* It names the actual
  buttons in the actual order the footer presents them (`Confirm` on the pricing screen, `Next ·
  Review` on the funding screen, `Submit` on Review).

⚠️ The order is not a UI preference: the refund can only be created **with** a `draftId` and there is
no endpoint to attach a draft afterwards, so the addendum must exist first. That is why there is no
"raise refund" button anywhere on its own, and why the sequence is worth stating rather than leaving
the rep to look for one.

**3. …and the silent skip that made the question worse.** The submit path guards the refund on
`activeRefund && refundSourceRow && draftId && refundGate.length === 0`. A **falsy `draftId`** —
the addendum filed but its id could not be read off the response — skipped the refund with **no
message at all**: the rep believes the money is on its way back, the approver never sees a request,
and the customer signs an addendum with nothing attached to it. It now warns, and raising it without
the id is explicitly not the fallback (it would sit at `pendingCustomer` forever).

⚠️ The existing failure message was also **pointing at a control that does not exist** — *"raise it
again from the funding screen"*. There is no refund action on the funding screen (spec §4.4 is not
built), and a refund is only ever raised alongside an addendum, so both messages now say to submit
another addendum.

tsc 75 (baseline unchanged); eslint **0 errors** — `DynamicDealEditScreen` 172 warnings and
`UserPickerModal` 18, every one `react-native/no-inline-styles`. Suite 846 passing.

⚠️ Needs the device check for both: that the sheet's last row clears the Android nav bar on a
three-button device, and that the footer button reads **Submit & Request Refund** on a refunding
deal and plain **Submit Addendum** on an ordinary one.

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

#### …and the STORED title carries the box too

Follow-up: *"i want you to add this emoji with the payload of calculatore title when full package
includes"*, with a devtools capture of `PUT /lfcalculators/{id}` reading
`title: "G+VMax+Versa+S+FWrap+FBoard+FAluminum"` while the tab above it showed the package badge.

Everything above is a RENDERING swap — the surfaces replace the derived name with the icon, and the
name itself never changed. The portal has no such rendering and only ever sees the string, so a
package was indistinguishable there from a long product list. **New `FULL_PACKAGE_TITLE_PREFIX`
(`'📦 +'`)**, applied in `computeDerivedTitles`.

- **Named at the SOURCE, so nothing can drift.** `resolveSafeTitle` (the PUT payload) and `retitle`
  (the in-memory `tab.title`, which the `calculator viewed` log sends as `calculatorTitle`) both read
  that one function — the same reasoning as the customer-name ticket above, where naming the calculator
  at the source fixed the portal without touching either log.
- **The derived name survives behind the prefix** (`📦 +G+VMax+S+FWrap+FBoard`), rather than being
  replaced by the badge's `+FBoard` extras. The mobile badge can afford to drop the letters because the
  ⓘ lists what a package includes; a bare `+FBoard` in the portal would name only the leftovers.
- ⚠️ **Applied LAST, after the `(SM)`/`(LG)` and duplicate-price passes.** Prefixing the BASE name
  would put the emoji inside the grouping key that disambiguation runs on. Tested: two identical
  packages at different prices still read `(SM)` / `(LG)`, and at the same price still read `⚠️ … ⚠️`.
- ⚠️ **Idempotent by construction** (`startsWith` guard). The hydrate path reads the server's
  already-prefixed title back in as `storedTitle`, and `retitle` recomputes over it on every mutation.
- ⚠️ **A MANUAL rename is left alone** — the rep chose that name. Unreachable today (the dynamic tab
  menu offers only Duplicate/Delete), so it is a guard rather than a live case.

⚠️ **No double box on any surface**, because every one of them replaces the name outright when
`isFullPackage`: `HorizontalDraggableTabs` renders `icon + packageExtras` and `FullPackageTitle` renders
`icon + extras`, neither printing `title`. The two places that DO print the raw title are the Job
Tracker "Add This Job" modal (`JobTrackerButton title={activeTab?.title}`) and the delete-confirm
sheet — both now show the box, which is correct but is the visible reach of this change beyond the
payload.

⚠️ **Existing rows are not migrated.** A package saved before this reads without the box until its next
save; the prefix is added by the ordinary retitle pass, not by a backfill.

Verified with 9 tests (`__tests__/screens/DynamicDealCenter/full-package-title.test.ts`) driving the real
`computeDerivedTitles`: the ticket repro, extras kept in the stored name, a non-package untouched, an
empty calculator keeping its placeholder, the size-suffix and duplicate-price passes both surviving,
idempotence asserted as exactly ONE 📦 after a re-derive, a manual rename untouched, and no schemas → no
prefix. tsc adds nothing; `tab-naming.ts` and the test are eslint-clean.

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

### CoC Paper Fallback scans upload under `phase: 'cocPaperFallback'`

Ticket: the paper-fallback upload should use `PUT /installer/v1/{jobId}/images` with
`phase=cocPaperFallback`. The endpoint and method were already right (`IMAGE_UPLOAD_METHOD` is
`'put'`), so the whole change is the phase.

- `'cocPaperFallback'` added to `InstallerImagePhase` (`config/types/installer.ts`) and to
  `PHASE_ARRAY_KEY` (`services/api/installer.ts`), where it maps to **`installerCocPhotos`** — the
  array `installer-hydrate` already reads, so a scanned page still comes back onto the step.
  `InstallerDeletePhase` is derived from the union, so the delete route inherits it (no CoC delete
  call site exists today).
- `useInstallerPhotoUpload.uploadCoc` sends the new phase; **`uploadCocSignature` stays on `'coc'`**.
  That split is the point of the ticket: the phase is now what tells a SCANNED paper certificate from
  one SIGNED on the device. Both still send `subcategory: 'coc'` (`cocDescriptor` is shared), so
  within a phase only the file distinguishes them, exactly as before.
- ⚠️ `uploadCoc` is reached ONLY from the Paper Fallback pill — `CoCStep.startScan` has no other
  caller (`handlePaperFallback` is its one entry point, by design: *"its only entry point is the
  form's own Paper Fallback pill"*). That is what makes retagging the whole function safe.
- ⚠️ **The BACKEND does not know this phase yet.** `InstallerHandler.uploadJobImages` normalises the
  form field through a ternary chain whose fallback is **`'pre'`**, so until it learns
  `cocpaperfallback` the scans land in `installerPreInstallPhotos` and vanish from the CoC step.
  Ship the backend arm first, or with this.

#### …and a scanned certificate now FILLS THE FORM

Ticket: *"when user scan the paper than the backend provide the JSON response against the paper
scan… place the value directly to the boxes according to the JSON response. make sure in the case of
paper Scan the Job number and date also get from the paper, and if user add the details directly than
the date and job number should be getting Automatically."*

The scan already went up under `phase: 'cocPaperFallback'` (above) and the response was thrown away
past its `s3url`. It now carries the certificate the backend read off the page, and that reopens
`CoCFormModal` with the paper's own values in it.

**The chain, one link per file:**

| where | what |
|---|---|
| `utils/installer-coc-scan.ts` (new, pure) | `extractCocScanFields(body)` → `CocScanFields \| null` |
| `services/api/installer.ts` | `normalizeImageUploadResult` runs it — **gated on the phase** |
| `utils/installer-upload.ts` | `UploadOutcome.scan` |
| `hooks/useInstallerPhotoUpload.ts` | `run` now resolves to **`{ patch, scan }`** (`InstallerUploadResult`) |
| `screens/Installer/JobDetail.tsx` | `handleCocPage` RETURNS that read |
| `steps/CoCStep.tsx` | awaits it, holds it in `scannedFields`, reopens the form |
| `modals/installer/CoCFormModal.tsx` | new `scanned` prop seeds every box |

⚠️ **`run`'s return type changed** — it was the patch, it is now `{ patch, scan }`. Its one consumer
that reads the value (`handleCocSignature`) takes `result?.patch`; every other caller ignores it.

**Job # and Date.** Both stay READ-ONLY; only their SOURCE changed. A scan wins
(`scanned?.jobNumber || job.jobNumber || …`, `scanned?.date || todayMMDDYYYY()`), because the paper
carries its own number and its own date and the customer has already signed against them. Typed in
directly, nothing is scanned and both are derived exactly as before — which is the second half of the
ticket, and needed no change.

⚠️ **`??`, not `||`, on the three tick boxes.** A box the page reports as UNTICKED is `false` and must
stay unticked; `||` would fall through to the filed certificate and tick it back on — an attestation
nobody made. `undefined` (the page did not say) is the only case that falls through.

#### ✅ The live response — and the reason NOTHING was populating

A device trace (`PUT installer/v1/{jobId}/images`, 2026-08-31) settled both halves. The extraction
arrives as **`data.extraction`**:

```json
{ "jobNumber": "090078601", "date": "31-8-2026",
  "homeowner": false, "spouse": false, "other": true, "relationToHomeowner": "Brother",
  "age18OrOlder": true, "homeownerOrAuthorized": true, "installationStatusCompleted": true }
```

⚠️ **THE BUG WAS UPSTREAM OF THE EXTRACTOR: this response carries NO `appended` array.** It answers
with ONE image on `data` itself — `s3url` / `bucketName` at the root plus a `data.cocPaperFallback`
block — while `normalizeImageUploadResult` only ever read `data.appended`. So
`uploadInstallerPhoto` read `appended[0]` as undefined, declared a perfectly good upload **FAILED**,
flashed *"Couldn't upload page 1 of the CoC"*, stored no `s3url` on the page (nothing for the
step-data PATCH to reference) — and the hook's failure branch returns `null`, which threw the
certificate away with it. `normalizeImageUploadResult` now synthesizes the single row when there is no
`appended`. ⚠️ It takes the id from the `data[phase]` block, **never `data._id`** — on this shape that
is the JOB's id, and storing it as the image's `serverId` would point every scanned page at the job.

Three key-name corrections fell out of the same payload — `age18OrOlder`, `installationStatusCompleted`
and `relationToHomeowner` were all absent from the lists, so three of the six boxes would have stayed
empty even once the read arrived.

⚠️ **The relationship is THREE TICK BOXES, not a word** (`homeowner` / `spouse` / `other` + the
`relationToHomeowner` write-in). The boxes win over the word; at least TWO of the three must be present
as booleans before any is read, because `other` on its own is far too common a key to treat as an
answer to "who signed"; and `relationshipOther` is only ever set for `other`, so a name cannot ride
into the payload on a homeowner certificate.

⚠️ **`31-8-2026` is DAY-first.** The extraction hyphenates and writes the day first, while a SLASHED
date is the US month-first form this app prints everywhere else — so the separator decides, and a
component over 12 settles it either way. Reading it month-first turns 31 August into an invalid month
(the old rule produced `31/08/2026`).

The extractor still reads FIXED key lists out of a bounded breadth-first walk, the same discipline as
`readDocumentGroup`: nothing is guessed, an unknown shape yields `null`, and the step then behaves
exactly as it did before this existed — pages filed, result screen, no form.

⚠️ **`jobId` / `_id` / `leadId` are deliberately NOT job-number keys**, and `installDate` is not a date
key. This endpoint's response root carries the job's mongo id, and a 24-character id in the Job # box
would look plausible enough to file.

⚠️ **The date is parsed as TEXT**, never through `new Date(...)` — an offset ISO string shifts the
calendar day either side of midnight, and this is the date on a signed document (the rule
`utils/job-change-summary.ts` records).

⚠️ **The FIRST page that reads back a certificate wins.** A multi-page scan is one document and the
fields sit on the page carrying the signatures, so a later page that read nothing must not blank it.

⚠️ **The two SIGNATURES are still required to submit.** The paper's signatures live in the scanned
image, and nothing weakens `canSubmit` — a legal control was not loosened on the way past. If the crew
should be able to submit a scanned certificate without re-signing on the device, that is a deliberate
change to `canSubmit` and needs asking for.

The read is a round trip behind the scanner closing, so the step raises a small blocking
**"Reading the scanned certificate…"** card (`installer.cocReadingScan`) while it runs — the form is
down at that moment and the crew would otherwise have no reason to think anything was still happening.
`logCocFormOpened` gained a `'scan'` source so the portal can tell that open from the other three.

Verified with 25 tests over the real extractor, five of them driving the captured response VERBATIM
(every box filled, the tick-box relationship, no box ticked, a lone `other` ignored, and the job id
never read as the Job #): a flat response and three wrapper shapes, the
shallowest value winning, the Job # never read off an id, the date never read off `installDate`, an
unticked box staying `false`, a top-level `completed` (the JOB's status) NOT ticking the contract
attestation while `checkboxes.completed` does, an unrecognised relationship becoming `Other` + the
write-in, an explicit write-in outranking it, and a photo-shaped response / junk input as `null`. Plus
the offset-ISO date asserted against what naive `Date` parsing would have given. tsc 138 (baseline
unchanged); the new util is eslint-clean, `CoCFormModal` and `JobDetail` are byte-identical to their
HEAD baselines (18 and 27 warnings) and `CoCStep` is +1 `react-native/no-inline-styles` — the backdrop
of the new card, the rule that file already carries.

#### …and once it is SUBMITTED the step shows the PDF, not the form

Ticket: *"when the installer submit their COC form than we receive the updated PDF document in the
response after submit. when user reopen the tab than there is no option to edit the form once
submitted — after submission you can use the pdf from the response and display that pdf in the COC
tab."*

`PATCH installer/v1/update/{jobId}` (`stepData.coc`) answers with the generated certificate, and the
CoC step now renders it: a green **Certificate submitted** card holding the document, tap to open it
full screen in the app-wide `PdfPreviewModal`, and **no way back into the form**.

| where | what |
|---|---|
| `utils/installer-coc-pdf.ts` (new, pure) | `extractCocPdf(raw)` → `JobPacket \| null` |
| `services/api/installer.ts` | `normalizeInstallerJob` → **`job.cocPacket`** |
| `screens/Installer/JobDetail.tsx` | `sendStepData` now RETURNS the patched job; `handleCocSignOff` stores the document on the sign-off |
| `steps/CoCStep.tsx` | new `document` prop — the PDF card, and the edit button gone |

⚠️ **`sendStepData`'s return type changed** — it was `void`, it is now `Promise<InstallerJob \| null>`
(`null` for every path that did not reach the server: no job, empty patch, unchanged step, or a
failure, which is reported to the installer rather than thrown). Nothing else reads it.

⚠️ **The document is stored on `CocSignOff`, not only on the job.** Progress is persisted, so it
survives a relaunch and a job re-fetched from the LIST — which does not carry the certificate. The
step reads `progress.cocSignOff?.document ?? job.cocPacket`, device copy first. It is written from the
`signOff` object that was just filed, never re-read from progress, so the two cannot drift.

⚠️ **`submissionPdf` is NOT a certificate key, and the generic names (`pdf`, `document`, `url`) are
only read inside a `coc`-scoped container.** The rep's job packet lives on the same job; showing it as
the certificate the customer signed would be a plausible-looking lie rather than a visible failure.

⚠️ **`url` is classified, not assumed.** This API puts a bucket-relative KEY in a field called `url`
(`submissionPdf.url`), so a value is only treated as ready-to-open when it actually starts `http`.
Handing a key to the PDF viewer draws a blank sheet instead of failing.

⚠️ **The inline preview is `pointerEvents="none"`.** `react-native-pdf` handles its own pan and pinch,
and inside the step's `ScrollView` the two fight — the tab stops scrolling past the document. Deaf to
touch it is a picture, and the press wrapping it opens the real viewer.

⚠️ **The edit button is hidden on the DOCUMENT, not on the sign-off.** A submitted certificate whose
PDF could not be read (an older job, or a deployment that does not generate one) keeps the button —
hiding it there would leave the crew a step with nothing on it. Gate it on `signOff` instead if the
rule is meant to hold even with no document.

⚠️ **The response's key name is NOT confirmed against a real submit.** The reader walks a FIXED list of
containers and key names, the discipline `readDocumentGroup` sets, so an unrecognised payload yields
`null` and the step behaves exactly as it did before — signed card, edit button. Pin the list against a
captured response before calling this done.

Verified with 7 tests over the real reader: the `{ url, bucketName }` shape, the document inside a
`coc` block, a ready URL told from a bucket key (with the signed query stripped from the name), an
explicit file name winning, `submissionPdf` never read as the certificate, a generic `pdf` outside a
`coc` container ignored, and a check-in-shaped payload / junk / an empty document object as `null`.
tsc 107 (baseline unchanged); the new util and its test are eslint-clean, `JobDetail` is
byte-identical to its HEAD baseline (27 warnings) and `CoCStep` is +1 `react-native/no-inline-styles`.

#### ⚠️ iOS: Paper Fallback froze the app — never present the scanner mid-transition

Ticket: *"the paper fallback is not working on the IOS device, it works on the android perfectly. when
we click on the paper fallback from the IOS device it blocks me and stuck the whole app."*

`RNDocumentScanner.scanDocument` presents VisionKit on **`RCTPresentedViewController()`** with a bare
`self.viewController?.present(...)` and **no error path** (`node_modules/react-native-document-scanner-plugin/ios/DocumentScanner.swift`).
So a presentation UIKit refuses calls NONE of its three handlers — not success, not error, not cancel —
and the JS promise **never settles**.

`handlePaperFallback` used to `setShowForm(false)` and call the scanner in the same tick, which asks
iOS to present while `CoCFormModal` is still dismissing. UIKit drops exactly that case, so the scanner
never appeared, the `await` never returned, and the step was left with NO surface on screen: the
sub-screen is gated on `hasResult`, which is false on a first scan. Android launches an Activity, which
has no such rule — hence "perfect on Android".

**The form now STAYS UP across the whole scan.** Nothing is transitioning when the scanner is asked
for, on either platform, and the scanner covers the form while it runs. On the way back:

| outcome | what happens |
|---|---|
| pages + a certificate read | `openForm('scan')` — REMOUNTS the form (bumps `formSession`) without closing it, so the values appear in a modal that never went away |
| pages, nothing read | `setShowForm(false)` → the result view, as before |
| cancelled, something already captured | `setShowForm(false)` → the result view |
| cancelled, nothing captured | the form stays exactly as it was |

⚠️ **There is no dismiss/present PAIR left anywhere in this flow**, and that is the point — not the
platform branch it replaced. Do not "tidy" this by closing the form first again.

⚠️ **The "Reading the scanned certificate…" indicator is no longer a `Modal`.** It was a third native
modal raised over the step's own, which is the same hazard on iOS and is against this repo's standing
rule (the signature pad and the exit prompt in this very file are in-card overlays for that reason).
It is now `CoCFormModal`'s **`busyLabel`** prop — an absolute overlay inside the card, carrying the
`zIndex` + `elevation` pair the note on `sigOverlay` explains.

⚠️ Still outstanding, same class: the certificate `PdfPreviewModal` in `CoCStep` is a native modal
rendered while `InstallerSubScreen`'s own modal is up. It is only reached by tapping the document card,
so it is not in this ticket's path, but on iOS it is the same shape of risk — hoist it to `JobDetail`
if it ever misbehaves.

tsc: the error set is byte-identical to HEAD (108). `CoCFormModal` is at its HEAD baseline (18
warnings) and `CoCStep` drops 4 → 3 — the removed modal took its own inline style with it. The iOS
bundle builds (`platform=ios`, HTTP 200).

### Pre-install: the big pane shows the INSTALLER'S shot once there is one

Ticket: *"inside the pre install phase… first time when user open the pre install phase and there is no
image from the sale side then show the house placeholder, and when installer click the image then show
that image on the front screen… if the pre install received images from the sale side then show that
image on the front screen unless installer not capture the image; when user capture the image then
show that image on the front, and when user click on tap to review the flow should be the same for the
image comparison."*

`PhotoMatchStep`'s hero pane rendered `selectedRef` — the REFERENCE — and nothing else, so a tag kept
showing the rep's sale photo (or the line-art house) even after the installer had shot it. The only
place their own shot appeared was the review modal.

One expression now decides the pane:

```ts
const capturedUri = selected ? matched[selected.id]?.uri : undefined;
const heroUri = capturedUri ?? selectedRef;   // own shot › reference › HouseGhost
```

| state | pane |
|---|---|
| no rep photo, nothing shot | `HouseGhost` (unchanged) |
| rep photo, nothing shot | the rep's photo (unchanged) |
| shot taken, either way | **the installer's own photo** |

⚠️ **The chip had to follow.** It read `REP PHOTO • Back-Left` over whatever was on screen; showing the
installer's own work under that label tells them their shot IS the reference they are supposed to be
matching. New `installer.yourPhoto` (`YOUR PHOTO` / `TU FOTO`) is used whenever `capturedUri` is set.

⚠️ **Nothing about the review or the re-shoot changed**, which is the ticket's own requirement:
`MATCHED — tap to review` still opens `ReviewPair` with `referenceUri(tag)` beside the shot, and the
ghost camera still ghosts against `referenceUri` — so the comparison is against the rep's photo exactly
as before. Only the resting pane moved.

⚠️ **This applies to the POST pass too**, deliberately — the rule is written on `capturedUri`, not on a
`phase` branch. Post ghosts against the installer's own pre-install shot, so the same sentence describes
it: the reference holds the pane until there is a shot. Gate it with `phase === 'pre' &&` if it is ever
wanted on pre only.

tsc: error set identical to HEAD. `PhotoMatchStep.tsx` is byte-identical to its HEAD eslint baseline
(31 warnings, 0 errors); the iOS bundle builds (HTTP 200).

### Public Sans is now the app-wide default, so Android's device font can't win

Ticket: *"some of the fonts on android are the android default font, not public sans … make sure all
fonts are connected and are public sans … make sure public sans will show even though we change the
font from over android device setting."*

**The fonts were never missing.** All nine upright faces are bundled and registered on both platforms
(`src/assets/fonts` + `react-native.config.js`; `UIAppFonts`; `android/app/src/main/assets/fonts`). The
gap is that a `<Text>` only gets Public Sans when something **names a face** — the NativeWind `font-*`
classes do (`tailwind.config.js` maps every one of them to a `PublicSans-*` file, ~1,450 sites) and the
**~850 inline `style={{ fontWeight: '700' }}` sites do not**. With no `fontFamily` each platform falls
back to its own system font: on Android that is **whatever the user picked in the device font setting**.

**Pure `src/utils/default-font.ts`** (`resolveFontPatch`) decides the face; it is applied from the
`ScaledText` / `ScaledTextInput` wrappers in **`index.js`** — the same wrappers that do tablet font
scaling, and which already patch the `react-native` exports, so text inside third-party components
(navigation headers, chat, pickers) is covered too rather than 201 files being edited.

⚠️ **The util is INERT without that `index.js` wiring**, and it has already been lost once: `a96b3ac`
committed `default-font.ts` alone, leaving nothing that imports it — which reads on device exactly like
the original bug. If unclassed text is following the device font again, check `index.js` FIRST.

#### ⚠️ Naming a face is NOT enough on Android — the WEIGHT has to go with it

`ReactFontManager.createAssetTypeface` resolves a family + weight by looking for the FILE
`fonts/<family><variant>.ttf`. So `PublicSans-Regular` + `fontWeight: '700'` looks for
**`PublicSans-Regular_bold.ttf`**, misses, and falls through to
`Typeface.create("PublicSans-Regular", BOLD)` — an unknown family — so Android returns the **system
font, synthetically bolded**. Silent, and indistinguishable from the missing-font bug.

Every patch is therefore a PAIR — the face **plus `fontWeight: 'normal'`**:

| | why the pair works |
|---|---|
| Android | `TypefaceStyle.nearestStyle` stays NORMAL (or ITALIC), so the exact `.ttf` is loaded |
| iOS | `RCTFontUtils` reads the name, recovers its real family, then `fontWeight = (fontWeight != 0.0) ?: RCTGetFontWeight(font)` — and `normal` **IS** `UIFontWeightRegular`, which is literally `0.0`, so the named face's own weight wins |

⚠️ This is the exact pair `tailwind.config.js` has always emitted (every `fontWeight` value there is
remapped to `'normal'`) — so it is not a new rendering path, just one applied to the styles that had
none. Do not "tidy" those `'normal'`s away in either place.

#### What it deliberately leaves alone

- ⚠️ **Any font that is not ours** — `Ionicons`, `MaterialCommunityIcons`, … Every icon in the app is a
  `<Text>` with an icon `fontFamily`; rewriting those to Public Sans would replace every icon with a
  missing glyph. Tested.
- ⚠️ **`fontWeight: 'normal'` / `400` beside a face that is already ours.** That value is usually not an
  author's opinion — Tailwind emits it mechanically next to every `font-*` family class — so honouring
  it would turn **every `font-bold` in the app back into a regular face**. A heavier explicit weight
  DOES win, because that is a real instruction and it is also the Android trap above
  (`font-sans` + `fontWeight: '700'`), where iOS already resolves Public Sans Bold and Android does not.

⚠️ **iOS changes too, and that is the point.** Unstyled text there was San Francisco; it is now Public
Sans, so the two platforms finally agree and match the design system. Scope it to Android with a
`Platform.OS` test in `index.js` if that is ever unwanted — but then the platforms diverge again, which
was the complaint one ticket earlier.

⚠️ **Not covered, by nature:** `Animated.Text` (one site, `CustomCameraModal`'s zoom label — RN's
`Animated` namespace wraps the internal Text module, not the patched export), and anything the OS draws
itself (`Alert`, native date pickers, WebView/PDF content).

⚠️ **Font SIZE is untouched.** The device's text-size setting still scales the app (`allowFontScaling`
stays on) — that is accessibility, and this ticket is about the typeface.

#### …and the follow-up: the last Text still following the device font was ITALIC

Ticket, with an Android screenshot whose system font was a script face: *"this text should be change if
we change the font from the android settings"* — pointing at `Leads/index.tsx`'s
`className="text-[10px] italic"` caption (*All Self Gen Leads will be archived end of day unless
deleted*), rendering in that script font while everything around it was Public Sans.

Italic was the one case the first pass skipped, because no italic face was bundled. **Fixed by shipping
the missing faces** rather than by dropping the slant: `PublicSans-Regular_italic.ttf` and
`PublicSans-Bold_italic.ttf`, taken from the official OFL source (`uswds/public-sans`) and verified to
carry the same `Public Sans` family name (and the italic bit, at weights 400/700) as the nine upright
faces — which is what lets iOS find them, since it matches on family + the italic trait, never on the
file name.

⚠️ **Dropping `italic` was NOT an option**, and this is worth knowing before anyone "simplifies" it:
`LeadCenter/DraggableText.tsx` lets the rep CHOOSE Italic / Bold Italic on an annotation, and
`agreement/blocks/SignatureSectionBlock.tsx` uses italic as the stand-in for web's cursive signature
font. Forcing those upright would have broken two features to fix a caption.

⚠️ **An italic style may name ONLY those two families**, and the file NAMES are load-bearing. Android
looks for `fonts/<family>_italic.ttf`, so the files are named after the family the resolver asks for —
not after the fonts' own `PublicSans-Italic` / `PublicSans-BoldItalic` PostScript names. Adding
`PublicSans-SemiBold` to `ITALIC_FACE` selection without shipping `PublicSans-SemiBold_italic.ttf`
sends that text **straight back to the device font**, silently. A heavier italic therefore renders Bold
Italic rather than Black Italic.

⚠️ And it is the `fontWeight: 'normal'` half of the pair that keeps `nearestStyle` at **`ITALIC`** rather
than `BOLD_ITALIC` — without it Android would look for `PublicSans-Bold_bold_italic.ttf` and miss.

⚠️ Linked by hand rather than by re-running `react-native-asset`: two `UIAppFonts` entries plus the four
`project.pbxproj` entries each font needs (`PBXBuildFile`, `PBXFileReference`, the group's children, and
the Resources phase), modelled on the existing `PublicSans-Light.ttf` rows. Both files pass
`plutil -lint`. **iOS needs a rebuild for the new resources to reach the bundle.**

⚠️ **`ios/revDSM_Sales/Info.plist` and `project.pbxproj` are CRLF** — editing them in text mode rewrote
every line to LF and turned a 10-line change into a 262-line one. Use `newline=''`. (Same trap already
recorded here for `dynamic-deal-diff.ts` and `EditCustomerModal.tsx`.)

Verified with 14 tests over the real resolver: both repros (an inline weight with no family; the italic
caption), a style with no font information at all, every one of the nine weights mapping to a face that
is actually bundled and always paired with `'normal'`, italic resolving to one of exactly the two
shipped `_italic` families across all nine weights, a bold italic surviving the Tailwind pair, icon
fonts untouched upright AND italic, the named-face + heavier-weight re-derive, patches returned as the
SAME frozen object per face (so style diffing sees no change), odd weights (450/1000/50) snapping to a
real file, and junk reading as "no opinion". tsc adds nothing (48 before and after — the four above the
old 44 are the parallel offline branch's own test files); `index.js`, `default-font.ts` and the test are
eslint-clean; the Android release bundle builds (exit 0).

⚠️ Needs a device check (this repo cannot render-test): set a custom system font on Android and confirm
the app ignores it, italics included; and watch the tight inputs — Public Sans has different
ascent/descent than SF, so the Leads search field (whose descender clipping was tuned in an earlier
ticket) is where a metric shift would show first.

### Pre-Install references drop the rep's ANNOTATED copies

Ticket: *"inside the installer when user open the lead and go to the step pre install photos, at that
point show us only actual photos — if any photo is having the Annotated tag then don't show that
photo."*

`RepPhoto` has declared `isAnnotated?: boolean` since the type was written and **nothing ever read
it**, so an annotated row went into the tagger like any other. `repPhotoOf` took the first non-installer
photo in the slot, and the annotated copy is filed AFTER the shot it marks up — so whenever the rep
annotated a photo, its marked-up duplicate became the reference and the crew was asked to ghost-match
against arrows and circles drawn over the house.

**New `isAnnotatedRepPhoto` + `actualPhotosOf` in `utils/installer-photo-sections.ts`**; `repPhotoOf`
and the `reference` fallback both read the filtered list.

⚠️ **Three spellings, because three parts of the app write it**: `isAnnotated: true` (what the installer
payload declares), `category: 'annotated'`, and a `"<slot> (Annotated)"` subcategory — the latter pair
is what `screens/ImageAnnotation` files its copy under, and what `utils/inspection-photos.ts` and
`screens/RevRender` already exclude on. `RepPhoto` declares neither of the last two, so they are read
off the raw row.

⚠️ **`category` must EQUAL `annotated`, not merely contain it** (the subcategory test is a `includes`
on the parenthesised suffix). A real category could legitimately be named for what it documents —
"Annotated Damage Notes" is a photo of a house, not a markup layer. Tested both ways.

⚠️ **The fallback is filtered too.** `reference = rep ?? actualPhotosOf(slot)[0]` — a slot the rep
skipped, whose only other row is a marked-up duplicate, still has no reference to pair with, and the
`repPhotoId` the matched shot uploads under must never be the annotated row's.

⚠️ A slot holding ONLY an annotated copy now reads as a slot the rep never shot, so its category is
omitted entirely (`buildRepPhotoSections` already skips a category with no rep photo in it). That is
the same treatment a skipped category gets and is deliberate — there is nothing to match against.

Verified with 7 tests over the real builder, including the repro asserted against the PRE-FIX code:
`git show HEAD:` of the util, driven over the same payload, returns `back-left-annotated.jpeg` /
`annotated-1` as the reference, and returns the real photo after. Plus all three spellings, the
`Annotated Damage Notes` negative, a slot holding only an annotated copy, an annotated copy not standing
in for a skipped slot, a clean slot unchanged, and empty input as a no-op. tsc error set unchanged; the
util and its test are eslint-clean.

### The install-request status moved onto the ACTION BUTTON, and greys the whole card

Ticket: *"these status are shown on top on the installer side but we need to show these status on the
button instead of shown on the top … you can display these status on the button where we currently
show the location icon Resume Appointment"*, then five corrections — *"also pick the colour of the text
for the button"*, *"the button should not be transparent type, the button's look should be same as the
previous"*, *"lead card color, button and the text colour should be same according to the status text
colors"*, *"use the same colour for the card that is used for the RESULTED lead — no need to use the
yellow, blue and other colour"*, and finally, against a resulted card, *"the can't do work status is
still displayed on the top instead of shown on the button"*.

`InstallerJobCard` rendered `installStatusPhrase(job)` as its own chip row above the Lead ID and the
button as `📍 Resume Appointment`. The phrase is now the button's LABEL, **the chip row is gone
entirely**, and the card wears `JOB_CARD_COLORS.RESULTED` grey while it carries one.

| | before | now (phrase present) |
|---|---|---|
| chip row above Lead ID | always, when a phrase exists | **never — removed** |
| button | `📍 Resume Appointment` | `Pending Install Reset` — solid, white label, no pin |
| button, RESULTED job | `Resulted - Cant Do Work!` | `Install Can't Do Work` — the phrase wins |
| border / wash / arrival time / address pin / button | `state.color` (green resume, orange start) | **`#9e9e9e`** |

⚠️ **The row was not free.** "Pending Install Can't Do Work" is nearly thirty characters, which is why
the chip needed a row of its own rather than the arrival-window slot — so removing it takes a whole row
off a card that already carries five, and the button gives the phrase the full width the chip was
competing for.

#### A RESULTED job is no exception — `workflowState` outranks the outcome label

The chip first survived there, on the reasoning that a resulted button is spoken for by its outcome —
and that is precisely the card the reporter came back on: an `INSTALL CAN'T DO WORK` chip sitting
directly above a `Resulted - Cant Do Work!` button, the same sentence twice. Then, on the follow-up
(*"get the button status from this object — `workflowState: "Install Can't Do Work"`"*), the phrase was
made to win the BUTTON on those cards too.

So `showPhraseOnAction` is **`!!workflowPhrase && !loading`** — no `!resulted` arm — and such a card
reads `Install Can't Do Work` rather than `Resulted - Cant Do Work!`.

⚠️ **The two labels are not interchangeable.** The phrase is composed SERVER-side from where the
*request* has got to; `resultedActionLabel` is derived HERE from `job.status`. Dropping the
`Resulted - ` prefix loses nothing, because the card already carries the **RESULTED** badge top-right.

`resultedActionLabel` still answers every resulted job carrying no phrase, which is most of them —
`installStatusPhrase` returns null for a `resulted` `workflowState`.

⚠️ **The card's resulted TREATMENT is untouched by this.** Its `#F4F6F8` ground, `0.85` opacity and the
RESULTED badge are all still keyed on `job.resulted`, not on the phrase — only the button's words
change. And `accent` is the same grey either way, since `state.color` for a resulted job already IS
`JOB_CARD_COLORS.RESULTED`.

`showPhraseChip` and the whole `workflowPhraseColor` helper went with the chip; the top-right
**RESULTED** badge is a different element and is untouched.

#### The colour: one grey, not three tones

`accent` is now `showPhraseOnAction ? JOB_CARD_COLORS.RESULTED : state.color`, and every consumer
follows for free — border, the `+ '1A'` wash, the arrival time, the address pin, `actionBg`/`actionFg`.

⚠️ **Four designs were sent back getting here. Do not re-derive them.**
1. **Button on the card accent, white label** — the status read as an ordinary green Resume card.
2. **Button as a tone WASH** (`tone + '33'` behind `tone`, i.e. the chip widened to the row) — rejected
   as *"transparent type"*: it reads as a disabled or secondary control, and this button is neither,
   since the tap still starts or resumes the visit.
3. **The whole card in the phrase's tone** (amber pending / red `cantDoWork` / blue `rescheduled*`) —
   rejected outright: a list where every card is a different hue is a list with no signal in it.
4. **Keeping the chip for resulted jobs** — the duplicate above; the phrase now takes their button.

What the final answer rests on is that these jobs all share the one fact that matters — **the office is
holding them, so they are not the crew's ordinary work** — and `JOB_CARD_COLORS` already has the word
for that.

⚠️ **Grey the COLOUR, not the resulted TREATMENT.** The card keeps its ordinary `+ '1A'` wash and full
opacity; the resulted card's `#F4F6F8` ground and `0.85` dim say *this visit is over*, which a
pending-reset job flatly is not — its button still starts or resumes the job.

⚠️ **`solidAction = !isPreview || showPhraseOnAction`.** A phrase button stays SOLID even on a preview
card, so the wash is reserved for a genuine preview. The preview signal is not lost: such a card still
resolves to `UPCOMING`, so it still drops the accent bar, and its tap still explains why it will not
open.

#### Smaller decisions

⚠️ **The location pin is dropped with the label** (`showActionIcon`) — the pin belongs to an action that
takes the installer somewhere, and a status report doesn't go anywhere. Same reasoning that dropped it
from the resulted bar. The text's `ml-2` is therefore keyed on the spinner/pin **actually being there**
(`loading || showActionIcon`) rather than on `resulted`, or a phrase button would inherit a margin that
pushes its centred label off centre.

⚠️ The phrase renders **verbatim, not `.toUpperCase()`** as the chip did: at the button's 16 px
`font-medium` a thirty-character phrase in caps would hit `numberOfLines={1}` and truncate, and the
button's own typography is what makes it read as a label rather than a badge.

⚠️ **`loading` is the one state that keeps the phrase book** — the button is a spinner + "Starting Job…"
for that instant.

⚠️ **Nothing was changed in `utils/installer-card-state.ts`.** `installStatusPhrase` /
`resolveJobCardState` are untouched — a phrase in `workflowState` still falls through
`BY_WORKFLOW_STATE` to `isJobInProgress(job)`. Only `state.color` is overridden, so the accent bar still
draws for the two live states and the tap still starts vs resumes exactly as before; the card just says
it in grey.

⚠️ `workflowPhrase` / `showPhraseOnAction` **moved UP** the file, above `accent`, which now derives from
them. `actionBg` / `actionFg` stayed with `isPreview`.

tsc 46 (baseline unchanged); `InstallerJobCard.tsx` is at its HEAD eslint baseline (4 warnings,
0 errors). ⚠️ The file is **CRLF** — `newline=''` on both ends.

⚠️ Needs a device check (this repo cannot render-test): no status chip anywhere, a phrase card fully
grey including its border and arrival time with a solid grey button and a white label, a RESULTED job
carrying a phrase reading `Install Can't Do Work` on its button while keeping its dimmed ground and its
RESULTED badge, and a phrase card still opening the job on tap.

### My Installs flashed a pull-to-refresh spinner every time the crew came back from a job

Ticket: *"when i came back from the lead it shows me a loader on top some time, or some times shows me
the white space — fix this UI glitch"*, with a screenshot of the green refresh spinner sitting above
the first card and the list pushed down.

`screens/Installer/index.tsx` bound the control straight to the query's own refetch flag:

```tsx
const { …, refreshing, refresh } = useInstallerJobs(period);   // refreshing = isRefetching
…
<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
```

⚠️ **`isRefetching` is true for EVERY refetch, not just a pull** — and this screen refetches on every
return by design (`useFocusEffect` → `refresh()`, because a job's status changes while the crew is
inside it and `my-jobs` is the only thing that knows). So walking back from a job set
`RefreshControl.refreshing` **programmatically**, which on iOS inserts the control at the top of the
list and pushes the content down: the stray spinner AND the band of white space, both from the same
line, for a gesture nobody made.

Fixed with a **`pullRefreshing` state that only `handleRefresh` sets** — exactly the flag, and the
reasoning, the Lead Center's own pull-to-refresh already documents. The focus refetch still runs; it
just does so silently, which is what it was always meant to do.

⚠️ `handleRefresh` became `async` and releases the flag in a **`finally`**: on a failed read the
spinner would otherwise stick forever and the list would look frozen with no way to clear it.

⚠️ `refreshing` is no longer destructured from `useInstallerJobs` — the hook still returns it, and it
is a fine thing to read for a *quiet* indicator, just never for `RefreshControl.refreshing`.

⚠️ **Not the cause, and not changed:** `loading` (`isLoading`) is false throughout, because
`staleInstallerJobs` invalidates with `refetchType: 'none'` and TanStack keeps the cached rows — so
there is no empty-list flash, and the full-screen spinner is reserved for a genuinely dataless key
(which is what a Today ⇄ Tomorrow switch is).

tsc 46 (baseline unchanged); `Installer/index.tsx` is at its HEAD eslint baseline (5 warnings,
0 errors). ⚠️ The file is **CRLF** — `newline=''` on both ends.

⚠️ Needs a device check (this repo cannot render-test): open a job, come back, and confirm the list
paints in place with no spinner and no gap — while a real pull still spins and still re-reads.

### The sold scope renders as SECTIONS and COMBINATIONS, not one bullet list

Ticket: *"inside the installer when we open the lead and go to the bottom we see the products section
— now i want to show the products like these combinations … because backend already share the data in
the sections; also show the products as a section wise in the step of verify job scope, update the UI
according to screenshots"*, against six screenshots of the sales build card (Gutter / LeafFilter /
Soffit / Fascia / Lighting / Additional Services).

`normalizeProductDetails` collapsed the whole build into `SoldProduct.lines: string[]` and both
surfaces — Job Reference ▸ Products and Verify Job Scope — drew it as one flat run of bullets. The
backend has always sent it as structure:

```
productDetails.products[].subcategories[].sections[].combinations[].fields[]{ label, value }
```

so flattening threw away the two facts an installer needs most on site: **which measurement belongs to
which run, and how many runs there are.** A gutter job sold as two runs read as one list of numbers.

**New pure `src/utils/installer-product-scope.ts`** (`measurementRows` / `fieldRows` /
`flattenScopeSections` / `rowText` / `normalizeProductDetails`) — the parsing MOVED here out of
`services/api/installer.ts`, which pulls in the axios wrapper (and MMKV through it) and cannot be
loaded under jest, the same reason `utils/installer-coc-scan.ts` and `utils/installer-coc-pdf.ts`
exist. `SoldProduct` gained `sections?: ScopeSection[]` (`ScopeSection` → `ScopeCombination` →
`ScopeFieldRow`, all in `config/types/installer.ts`).

**New `src/widgets/components/installer/ProductScopeCard.tsx`** draws it, and **both surfaces now share
it** — Verify Job Scope passes its confirm / discrepancy controls as `children`. They were
byte-identical spec lists before and had already begun to drift (two copies of the bullet geometry, two
different title weights, one with an icon and one without); one component is what stops the same
product looking like two different jobs on two screens.

| screenshot | what drives it |
|---|---|
| product name + coloured glyph | `productIcon(name)` / `productColor(idx, color, name)` |
| section heading ("Vinyl Soffit") | a section with a HUMAN label that holds combinations |
| tinted `Combination #N` block | one per combination, numbered from the payload's own `index` |
| bold headline (`5" K-Style`) | the combination's UNLABELLED fields, joined with ` · ` |
| `label ⟷ value` rows | its labelled fields, in config order |
| tinted `Extras` block | a section with a human label and NO combinations |
| a loose bullet list | a section with an auto label and no combinations |

⚠️ **A `locationGrid` is stored location-first and read storey-first.** `{"Left Side":{"1st":5}}`
renders `1st Story ⟷ Left Side: 5`, because that is the layout the sales card the installer is
comparing against uses; reading it as stored puts the SIDE in the label column, and on a two-storey job
that reads as two products. Blank and zero cells are dropped — an 18-cell grid of zeroes buries the one
measurement that matters — and an unparseable value is shown verbatim rather than dropped.

⚠️ **" Story" is appended for DISPLAY only, and only to a bare ordinal** (`/^\d+(st|nd|rd|th)$/`). A
column a config already spells out ("1st Story") fails that test, as does one named anything else, and
both print exactly as authored.

⚠️ **A label matching `^(section_|field_|selection_)` is an auto-generated schema id and is dropped** —
that rule predates this ticket. What is new is where the value then goes: a field with no human label
is a bare selection, so its VALUE is hoisted into the combination's headline rather than given a column
with an empty label beside it.

⚠️ **`SoldProduct.lines` is KEPT**, derived from the same walk, and is the render FALLBACK when
`sections` comes out empty — a payload shape we have not seen still shows what was sold. Nothing else
reads it: `installer-step-data.ts` and the activity log take only `id` and `name`, and **`id` is what
`scopeItems` is keyed by**, so the reshape cannot move a discrepancy onto the wrong product.

⚠️ **A subcategory-less product still gets a card**, empty. It IS on the job; a missing card reads as
"not sold" rather than "nothing entered".

⚠️ `productColor` gained a THIRD optional `name` argument rather than a second function — an explicit
API colour still wins, then the name, then the palette rotation. `RepPhotoCard` passes no name and is
unaffected.

Verified with 21 tests driving the real normalizer over the `update-job-status.txt` capture verbatim:
one card per subcategory with its `scopeItems` id intact, the two sections kept apart, the unlabelled
selection hoisted to the headline and never repeated as a row, every labelled field beside its own
label, a combination of only labelled fields carrying no headline, the flat form unchanged; the grid
read storey-first across two storeys and two sides, the ordinal suffix and its two negatives, zero and
blank cells dropped, a storey-less grid, an unparseable one, and a grid identified by its braces rather
than its label; two runs staying two runs, positional numbering with no stated `index`, empty
combinations and sections dropped; and the shapes that must not break the card — subcategory-less, id
fallbacks, an unlabelled subcategory named after its product, junk input, and a value-less field.
tsc 107 (baseline unchanged); zero eslint errors, and the two edited components together hold the same
9 warnings as their HEAD baseline (all `react-native/no-inline-styles`).

⚠️ Needs a device check — this repo cannot render-test, and the whole ticket is layout: the section
headings, one block per combination, and the `Extras` block reading as a block rather than a heading.

#### …and the number is the CARD's, not the section's

Follow-up, with a screenshot of a LeafFilter card reading **Combination #1** three times over three
different gutter widths: *"the same combination number is displayed on every combination — make it auto
increment according to the receiving combination, if 4 received then show #1, #2, #3, #4. These should
be for every case of combinations."*

⚠️ **`combo.index` RESTARTS AT 1 IN EVERY SECTION, and a subcategory is routinely authored as several
one-combination sections** — LeafFilter arrives as four, one per gutter width (this file already records
that, under the addendum-review ticket). So trusting the payload's own index was guaranteed to print
`#1` once per section. New **`renumberScopeCombinations`** assigns the number by position across the
whole card once its sections are built, and `toCombination` no longer reads `index` at all.

That is also what the sales card does — Soffit: *Vinyl Soffit* #1, *Porch Ceiling SqFT* #2, *Nailer
Build Out* #3 — so the two surfaces now agree on what "Combination #2" refers to.

⚠️ **An empty combination is dropped BEFORE numbering**, so a card whose first combination held nothing
still starts at #1 rather than #2. Numbers name what is on screen; a gap invites the installer to look
for a run that was never sold.

⚠️ **`flattenScopeSections` counts the CARD too** (`countCombinations`), not the section it is walking.
Left per-section, four one-combination sections would each have read as a lone *unnumbered* run while
the cards above them numbered 1–4.

Verified with 4 more tests (25 total): the repro — asserted first against the payload, whose three
sections really do all carry `index: 1`, so the old rule could only ever have produced `[1, 1, 1]` —
each number still belonging to the width it was entered against; a stated index that repeats AND one
that skips (`7`) both ignored across two sections; an empty combination not consuming a number; and the
flat form numbering off the same count.

#### …and an Extras colour is folded into the quantity it belongs to

Follow-up, with a screenshot of the Extras block: *"make sure when we receive the Ground Spout value
then append with the colour also, like in the image"* — `Ground Spout ⟷ 3 · Black`,
`Replace Corner Miter ⟷ 3 · Cream`, while `Wedges` / `Straps` / `Modify Height` stay bare.

**The colour is a SEPARATE field with its own id**, immediately following the quantity it belongs to.
Settled from `payload for testing extras.txt` (`section_1781685061809__extras`), which stores exactly
that alternation:

```
field_1781873407628_9hhi0__textvalue-3      2            ← Ground Spout
field_1781873462203_n44h8__color            "Black"      ← its colour
field_1781873537058_tk016__textvalue-uuu1l  2
field_1781873540360_ny9fm__color-gem7v      "Forest Green"
```

⚠️ **The pairing is POSITIONAL, and it has to be**: the colour carries nothing linking it back — no
`dcField`, no parent id, a different field id from its quantity. The authoring convention is the only
link there is, and `utils/dynamic-job-builder/engine/locked-color-defaults.ts` leans on the same one on
the sales side, for the same absence.

⚠️ **A colour folds ONLY into a QUANTITY** — `isQuantityValue`, a bare number and nothing else. That
single guard is what makes the rule safe, and it is deliberately strict:

| the field before the swatch | folds? | why |
|---|---|---|
| `Ground Spout: 3` | ✅ | a count, and the swatch is its colour |
| `Gutter Partial?: Yes` | ❌ | a SELECTION — folding it reads as though "Yes" was measured in Musket Brown |
| `Size: 1 x 4`, `Footage: 111'`, `6"` | ❌ | contains a number; is not one |
| `Measurements` (a grid) | ❌ | expands to several rows; never a fold target |
| another colour (`Track Color` → `Wire Color`) | ❌ | falls out of the same test — a colour's value is not a number |

⚠️ **A swatch authored with NO label arrives as its schema KEY** (`color`, `color_gem7v`,
`color-uq368`) — the portal's own fallback — so a standalone one is displayed as **`Color`**
(`BARE_COLOR_KEY`). An authored label is kept verbatim, so `LeafFilter Color` and `Track Color` are
untouched. A folded colour shows no label at all, being part of its quantity's value.

`buildFieldRows` runs the pass over BOTH a section's loose fields and a combination's, so a folded
colour rides into the combination headline too (`5 · Clay`) where the quantity was unlabelled.

Verified with 8 more tests (33 total): the screenshot's own row set, the selection case left alone, a
colour never folding into a colour, `1 x 4` / `111'` refused, a grid refused, folding inside a
combination and into its headline, a colour with no quantity before it, and an empty colour skipped
rather than folded as a blank.

### The Investment Center never saw the down payment entered on the DROP screen

Ticket: *"Sale Resulted | Down payment did not save or reflect in Contract Details … when i add down
payment from drop price and after that i go to investement center and opt in, the modal again appear
there down payment changes not going to reflect."* Client's rule alongside it: *"It's determined by the
screen they resulted it as a sale on and if that screen had down payment then include it."*

A down payment can be entered in **two** places and only one of them lands on the calculator:

| where | stored on |
|---|---|
| the rollout card's own "Add Down Payment" | `calculator.downPayment` |
| **the drop modal** (`DropOutcomeModal`) | the drop ROW — `dropPrice[i].downPayment` |

`InvestmentPanel` seeded its editor from `calculator.downPayment` **alone**, so after a negotiation the
screen opened on **"Add Down Payment"** for a deal that already had $100 down — and since the opt-in
hands `downPayment: downPay` to the Result flow, opting in resulted the sale at **$0 down**, which is
the blank Contract Details in the ticket title.

⚠️ **Everything downstream was already correct and none of it was touched.** `OptInConfirmModal` has
rendered the Down Payment / Balance block since it shipped (gated on `> 0` — it had no value, not no
UI); `handleOptIn` → `resultOptIn` → `handleResultJob` → `initialDownPayment` already threads the
figure into `ResultJobModal`; and the ROLLOUT screen's own Result path already carries the drop's down
payment (`openResultChooser` → `chooseDown`). The single break was the seed.

**New pure `resolveActiveDownPayment(drops, fallback)` in `utils/drop-prices.ts`**, the documented home
for this family of rules. It mirrors the rollout screen's Result path so the two screens cannot disagree
about what the customer put down: the **SECURED** drop, else the **LAST** drop (because Result Lead
auto-secures that row — `resolveAutoSecureIndex`, so it is the round the sale actually lands on), else
the fallback. The un-secured branch **defers to `resolveAutoSecureIndex` itself** rather than
re-deriving "the last one", so the two can never drift.

⚠️ **A drop round is authoritative even when its down payment is ZERO.** Securing a round with nothing
down IS the decision; falling through to `calculator.downPayment` there would resurrect a rollout-card
figure the rep has since moved off. `openResultChooser` reads the row the same way
(`Number(row?.downPayment) || 0`) — only the **no-drops** case reaches the fallback.

⚠️ **The PRICE is deliberately still the confirmed rollout price.** The standing product decision
("don't ever change it on drops") is untouched — a drop moves the down payment onto this screen, never
MSRP, the two grand totals or the monthly. Only the down payment travels.

⚠️ `lastLoggedDownRef.inhome` is seeded from the SAME resolved value, or the first edit would fire a
`down payment changed` log against a baseline the rep never saw.

Verified with 10 tests driving the real helper plus the panel's exact seed expressions: the ticket repro
(**asserted to seed `''` under the old rule** and `100` under the new one), the opt-in modal's balance
following from it, the secured round winning over a newer one, the last-round branch asserted against
`autoSecureLastDrop` itself, a round secured with `0` down staying at 0, a row with no `downPayment` key,
the no-drops fallback, an untouched deal seeding nothing, junk/negative/NaN as 0 rather than a `NaN` on
screen, and only a positive `'accepted'` counting (matching `hasAcceptedDrop`). tsc 44 (baseline
unchanged); `drop-prices.ts` and the new test are eslint-clean and `InvestmentPanel.tsx` is at its HEAD
baseline (56 problems: 1 pre-existing error / 55 warnings).

⚠️ Both files are CRLF — `newline=''` on both ends.

### The Notification Center rebuilt to the `notify-ui.txt` design

Ticket: *"this file contains the notification UI design … update the Notification UI according to this
design"*, with `notify-ui.txt` (an HTML/CSS mock, in the repo root) and two screenshots of the finished
list. The screen was a flat `FlatList` of hairline-separated rows on the app's plain white; it is now
the mock's layout — a warm paper ground, **day sections**, one bordered **card** per run of
notifications about the same lead, and repeats collapsed behind a disclosure.

| the design | how it is built |
|---|---|
| paper ground `#F6F5F0`, white cards, `#E6E3DA` rules | a `C` token block in the screen, copied from the mock's `:root` |
| `Today · Sep 7` / `Yesterday` / `2 days ago` headings | `SectionList` + `formatDayLabel` |
| ~~one card per lead, hairline between its rows~~ | **SUPERSEDED — one card per NOTIFICATION.** See the follow-up below |
| 3px pine rail + wash on an unread row | `styles.rail` + `itemUnread`, clipped by the card's `overflow` |
| 40px tinted bubble, four families | `describeNotification` now returns `{ icon, color, tint, family }` |
| monospace lead chip (`41PCDLG` / `SelfGen`) | `leadTagOf` |
| ~~`+1 more update on this lead` / `Show breakdown`~~ | **SUPERSEDED — removed.** See the follow-up below |
| `Unread ⑷` count pill | `unreadCount` from the existing badge query |
| `You're viewing the last 3 days` | `endHintFor` — **derived**, see below |

**Every rule lives in the pure `src/utils/notification-groups.ts`**, for the reason
`utils/addendum-drafts.ts` and `utils/inspection-photos.ts` exist: the screen pulls in React Native and
is untestable under jest here, and each of these fails **silently** — a row filed under the wrong day, a
mongo id printed as a lead tag, or two unrelated notifications merged into one card all read as a
styling quirk rather than an error.

#### ~~The grouping is three passes, and each guard is load-bearing~~ — ALL REMOVED

> ⚠️ **SUPERSEDED in full by "…and then the grouping was reversed" below.** Everything in this
> subsection — the card runs, the stacking, the `lead-issued` aggregation and every guard on them — was
> deleted on request. It is left here only so a reader who finds `cardKeyOf` / `stackKeyOf` in the git
> history knows what they did and why they are gone. **Do not reintroduce any of it.**


1. **Day buckets**, then 2. **cards** — a RUN of *adjacent* rows sharing a card key, not a global
   group-by, so an hours-old row can never be pulled up beside a fresh one and read as though they
   happened together — then 3. **items**, where repeats of one event family collapse into the newest and
   the rest become the disclosure's sub-rows.

- ⚠️ **A row with no resolvable identity keys on its OWN id**, so it can never merge into a neighbour.
  Telling the rep two unrelated notifications concern the same lead is worse than an extra card.
- ⚠️ **`addendum-signed` carries its `outcome` in the stack key.** The title reads "Addendum signed" for
  a DECLINE too (the rule `push-routing.addendumOutcome` states), so collapsing the two would hide a
  refusal behind an approval.
- ⚠️ **A collapsed item is unread when ANY row behind it is.** The disclosure hides rows; a hidden
  unread would leave the bell counting something the rep has no way to reach. For the same reason the
  tap marks **every** `ids` entry read, not just the head.
- **`lead-issued` AGGREGATES** rather than collapsing — consecutive batches sum to
  `4 new leads issued to you` with `Show breakdown`, which is the design's own row. An absent `count`
  counts as **one, never zero**, which would erase the row from its own total.

#### Dates are parsed as TEXT, and the day heading and the clock share that parse

⚠️ The repo's standing rule (`utils/job-change-summary.ts`) is that an offset ISO string shifts the
calendar day either side of midnight. The stronger reason here is **consistency**: `dayKeyOf` and
`formatClockTime` read the same `YYYY-MM-DDTHH:MM` prefix, so a row filed under "Yesterday" can never
print a time from today. Change one and you must change the other.

⚠️ **A future day is clamped to `Today`.** Reachable without any clock being wrong — `createdAt` can be
UTC while the rep is behind it — and "Tomorrow" on a notification that has already arrived is the worse
answer. `daysBetween` builds both sides through `Date.UTC` on the parsed components so neither can be
shifted by the device timezone.

#### `leadTagOf` reads a FIXED key list and REJECTS a mongo id

The design's chips are `41PCDLG`, `41AK` and `SelfGen` — the lead's human number, or its `leadCode`
when the number is `"N/A"` (which is exactly what a self-gen lead stores; see `response-one.txt`).

⚠️ **The push payload's `leadId` is a mongo id while the lead RECORD's `leadId` is that human number.**
Both are read from the same key, and the 24-hex guard is the whole reason that is safe: whichever the
backend sends, the right one renders and the wrong one never does. Without it the chip would be filled
on every row with a database key that looks deliberate. `'N/A'`, the other placeholders, and anything
over 16 characters are rejected too, and an unrecognised payload yields `''` so the chip is simply
absent — the discipline `readDocumentGroup` sets.

#### Two deliberate divergences from the mock

⚠️ **The heading is not a serif.** The mock loads Source Serif 4; this app bundles **Public Sans only**
(and naming an unbundled family drops that text straight back onto the device font — the rule the
app-wide font ticket records). The heading is carried by size and tighter tracking instead.

⚠️ **The unread wash is a FLAT tint, not the mock's gradient.** `rgba(30,92,67,0.06) → transparent` needs
a gradient library this repo does not ship, and pulling `react-native-svg` in behind every row to fake
one is not worth it. `#F1F6F2` is that tint flattened over white; the 3px pine rail is what actually
carries the signal.

⚠️ **`You're viewing the last 3 days` is DERIVED from the oldest row loaded**, not hardcoded, and only
shows once `hasMore` is false. The app has no retention window to quote, so a fixed number would be a
claim nothing backs. A list that only reaches today reads *"You're viewing today's notifications"*.

#### Smaller decisions

- **The colour block is literals, not `useTheme()`.** The paper ground is not a colour the app's palette
  has; reading `colors.background` would put the cards on plain white and lose the separation the whole
  design rests on. The app is light-only today (`ThemeProvider` forces it) — give the block a dark twin
  if that changes.
- **`stickySectionHeadersEnabled={false}`** — a pinned day heading over a card list reads as a second
  header, and the design pins only the screen header.
- **`overflow: 'hidden'` on the card** clips the rail and the row wash to its corners. Safe only because
  the card carries no shadow; iOS drops a shadow on a view that sets it (the inspection-photo card note
  above).
- **Mark all read stays MOUNTED at zero**, dimmed and disabled, rather than being swapped for a spacer —
  the header no longer reflows the moment the last notification is read.
- The tap handler, `resolvePushRoute` branch for branch, and the "always fetch `all`, filter unread
  client-side" rule are **unchanged**; only the presentation moved.

Verified with 29 tests (`__tests__/utils/notification-groups.test.ts`) driving the real helpers over the
design's own list verbatim: the three day sections in order, the two `41AK` signature rows in ONE card
with the repeated addendum collapsed behind `+1 more update on this lead`, the two batches aggregating to
`4 new leads issued to you`, every chip the screenshots show, and a single notification's own title and
message surviving untouched; plus the guards — a hidden unread still marking the item unread, an accepted
and a declined addendum never merging, two different leads never merging, two identity-less rows never
merging, a lead's later run staying its own card, an absent count reading as one, a timestamp-less row
filed under `Earlier` rather than dropped, the mongo-id rejection in all three of its forms, the offset
ISO asserted against what a naive `Date` parse would give, month/year day arithmetic, and empty/junk input
as a no-op. tsc 44 (baseline unchanged); `notification-groups.ts` and `useNotifications.ts` are
eslint-clean and `Notifications/index.tsx` drops 5 warnings → 1 (the pre-existing `no-void`); the iOS
bundle builds.

⚠️ Needs a device check — this repo cannot render-test and the whole ticket is layout: the day headings,
the card grouping on a lead with several notifications, the disclosure expanding, and that the chip shows
a readable lead number rather than nothing. **If every chip is absent, the payload is naming no human
lead id** — add the key the backend actually sends to `LEAD_TAG_KEYS`; do not relax the mongo-id guard.

#### …and then the grouping was reversed: ONE CARD PER NOTIFICATION

Follow-up on the same screen: *"currently you have implemented the group notification UI but i need a
separate notification for each notification like grouping in message, issued lead etc — convert it from
group to single."*

Every merging pass is **gone**. `buildNotificationSections` is now a mapping, not a grouping: day
sections, and inside each one **one card per history row**, in the order the API returned them.

| removed | what it used to do |
|---|---|
| `NotificationCard` + `cardKeyOf` | merged adjacent rows about the same lead into a shared card |
| `stackKeyOf` / `buildItem`'s stack | collapsed repeats of one event behind `+N more update on this lead` |
| `issuedCount` / the `lead-issued` aggregate | summed two batches into `4 new leads issued to you` |
| `stackNoun` / `plural` | the disclosure copy |
| `NotificationItem.ids` / `.stack` / `.moreLabel` / `.lessLabel` | the disclosure's data |
| `styles.itemDivided` / `stackMore` / `subList` / `subRow` | the in-card divider and the sub-rows |
| the screen's `expanded` state + `toggleStack` | which stack was open |

- **`NotificationSection.data` is now `NotificationItem[]`** — the card layer is gone entirely, so the
  screen's `renderItem` paints one row and `styles.card` picked up the `flexDirection: 'row'` the item
  used to carry. Each card is its own `TouchableOpacity`.
- **Mark-read is back to one id.** The tap cleared every `ids` entry precisely because a stack could
  hide unread rows; with nothing hidden, `row.id` is the whole of it.
- **`item.key` is the history id**, which is unique per notification and stable across a refetch, so a
  pressed row cannot swap identity under the rep.
- ⚠️ **Rows are still bucketed by day in ARRIVAL ORDER, not sorted.** An out-of-order list therefore
  renders two sections with the same label rather than silently rearranging the rep's notifications —
  the API returns them newest-first, and resorting here would hide a paging bug instead of showing it.
- ⚠️ **`CHAT_EVENTS` is no longer imported by the grouper** (nothing keys a card any more), so the note
  on the export names the three behaviours that remain. The export stays — it is still the one list, and
  the de-duplication it bought is what makes that true.

⚠️ The **day sections, the paper ground, the bubbles, the lead chip, the unread rail and wash, the tabs
and the derived end hint are all unchanged.** Only the merging was reversed; this is not a revert of the
redesign.

Verified with the same suite, rewritten (24 tests): the design's own nine rows emitting **exactly nine
items** with `[7, 1, 1]` per day, the order preserved row for row, the two `41AK` signatures staying
apart with their own times (`10:56` / `10:54`), both `lead-issued` batches keeping their own server
title rather than aggregating, each row carrying its own unread state, item keys being the history ids,
a timestamp-less row still filed under `Earlier`, and an out-of-order list rendering `Today / Yesterday
/ Today` rather than resorting. tsc 44 (baseline unchanged); `notification-groups.ts` is eslint-clean
and `Notifications/index.tsx` is at its HEAD warning count; the iOS bundle builds.

### A resulted lead's `agreement-signed` notification opens the LEAD, not the Job Builder

Ticket: *"when the lead is resulted and the user click on the signed agreement then do not move the user
to the agreement screen — user should move to the lead main screen."*

`agreement-signed` resolves to `{ kind: 'jobBuilder' }`, and the reasoning on that route is sound for
the normal case: signing the agreement is what **unblocks** submitting the job, so the rep's next action
is "Complete Job" and Job Docs is a detour. Once the lead is **resulted** that stops being true — the
deal lives on the Lead Center, which is where the agreement, the contract details and the addendums all
are — and dropping the rep into a builder for a job that is already done reads as though the app has
lost the submission.

**New pure `src/utils/lead-result-status.ts`** (`isLeadResulted` / `normalizeResultStatus`), for the
reason `utils/push-routing.ts` is pure: the two callers are both untestable under jest here and they
**must** answer identically.

⚠️ **BOTH tap paths changed, and that is the point.** The check runs in
`screens/Notifications/index.tsx` *and* in `hooks/usePushNotifications.ts`, against the same helper — a
row and the banner that raised it landing on different screens is the exact failure the shared routing
module exists to prevent. Changing one and not the other would be invisible until a rep noticed.

⚠️ **An ALLOWLIST of resulted statuses, NOT the `NON_RESULTED_STATUSES` deny-list** that
`widgets/components/LeadCard.tsx` and `screens/DealDetail` use (`['lfLead','selfGenerated','scheduled']`,
web parity with `job-card.js`). The two are not interchangeable here: a deny-list reads a **missing or
unknown** status as resulted, and since this rule now decides where a notification lands, that default
would silently divert every status-less lead away from the Job Builder. The allowlist fails the other
way — anything unrecognised keeps the behaviour the app already ships. Its values are
`JobDocsSection.isResulted`'s, so the screen the rep is sent to agrees about why they are there.

- **Placed FIRST in the branch**, above the `isDynamic === false` test and above `resolveBuildIds`, so a
  resulted lead also skips the calculator round trip. Resulted therefore outranks an explicitly dynamic
  push — the dynamic flag says the builder *exists*, not that it should be opened.
- **Navigated with no `tab`**, so the Lead Center opens on its own default (`job_docs`) — the lead's
  main view rather than a sub-tab chosen by a notification.
- **Statuses are normalized** (lower-cased, non-alpha stripped), so `Demo No Sale` → `demonosale`.
- ⚠️ Three other copies of the non-resulted rule exist (`LeadCard.tsx`, `DealDetail/index.tsx`,
  `utils/lead-activity-log.ts`). They were **left alone** — pointing a shared list at big unrelated
  screens is not something a notification ticket should carry — but they are the obvious next adopters.

Verified with 12 tests (`__tests__/utils/lead-result-status.test.ts`): the captured lead's own
`status: "sale"`, all ten resulted spellings including both `cancelled`/`canceled`, each of the four
status keys, the three non-resulted statuses still reaching the builder, **a missing / empty /
unrecognised / non-string status reading FALSE** (the allowlist's whole purpose, asserted directly),
junk input as `false` rather than a throw, and the decision expression itself — asserted in the same
ORDER both call sites run it: not-resulted → `DynamicDealCenter`, resulted → `LeadCenter`, resulted
winning over `isDynamic: 'true'`, the legacy `isDynamic: 'false'` diversion untouched on a lead that is
not resulted, and `addendum-signed` / `chat-message` / `lead-cancelled` all unaffected. tsc 44 (baseline
unchanged); the new util is eslint-clean and both call sites are at their exact HEAD warning counts
(1 and 4 pre-existing `no-void`); the iOS bundle builds.

⚠️ Needs a device check: sign an agreement on a lead that is already resulted and confirm the banner and
the Notification Center row both open the Lead Center, and that a NOT-yet-resulted lead still opens the
Job Builder on its Summary step.

### `chat-reaction` — the tenth event type, and the duplicate list it exposed

Contract: **`CHAT-REACTION-NOTIFICATIONS.md`** (repo root, REVUIUX-97 QA item 5). A rep is not told when
someone reacts to their message. Reactions already exist and already broadcast over the socket
(`reaction-added`); what is missing is the push. §6 of that document says **the app must ship first, or
at least together** — if the backend sends `chat-reaction` to a build that does not know it,
`resolvePushRoute` returns `null` and every reaction is a banner whose tap does nothing and a list row
reading *"There is nothing more to open for this one."*

**This is the app half only. Nothing is sent yet**, and every edit below is INERT until the backend
adds `NotificationEventTypes.ChatReaction` — which is exactly why it is safe to land now.

| site | change |
|---|---|
| `PushEventType` (`utils/push-routing.ts`) | `'chat-reaction'` added to the union |
| `CHAT_EVENTS` (same file) | the event added — **and the set EXPORTED**, see below |
| `describeNotification` (`hooks/useNotifications.ts`) | `case 'chat-reaction'` → slate + `emoticon-happy-outline` |
| `NOTIFICATION_TYPES` (`services/api/notifications.ts`) | added, so `NotificationHistoryType` stays honest |
| `invalidationKeysFor` | **no case, deliberately** — now written down rather than assumed |
| `usePushNotifications` | untouched: it is generic over `isRenderable` / `channelForEvent` |

#### ⚠️ Membership of `CHAT_EVENTS` is the whole implementation — and there were TWO copies

Adding the event to that one set gives it the destination (`resolvePushRoute`'s chat branch already
reads `chatId` and treats an absent `leadId` as a channel), the Android channel (`channelForEvent` →
`CHANNEL_MESSAGES`, so a rep who has muted chatter is not woken by a thumbs-up), and foreground
suppression — which matters more here than for a message, since reacting is cheap and usually happens
while both parties are looking at the thread.

⚠️ **The Notification Center redesign had quietly made a SECOND copy of that list.**
`utils/notification-groups.ts` declared its own `CHAT_EVENTS` for card keying, so the contract's
one-line change would have covered three of the four behaviours and silently missed the fourth: a
reaction would key on its `leadId` (or, on a channel, on its own row id) instead of `chat:<chatId>`,
and would sit in a card of its OWN beside the thread it belongs to. The set was **exported from
`push-routing` and imported** by the grouper. That import is now gone — the ungrouping follow-up above
deleted the card keying entirely, so nothing keys a card any more — but **the export stays**: it is the
one list, and keeping it that way is what stops the eleventh event type repeating this.

#### The two places the contract's text had to be translated rather than copied

⚠️ **`describeNotification`'s suggested `color: '#0B6A85'` is stale.** That is the OLD chat tint,
written before the function moved to the redesign's four families; taking the hex literally would make
the reaction the one chat row painted a fifth colour. It uses **slate** (`#3E5C78`), that colour's
replacement, so a reaction still reads as chat. The document's actual instruction — *don't let it fall
to `default` and show a grey bell in an "Other" group next to correctly grouped chat rows* — is what is
honoured.

⚠️ ~~**The disclosure label could no longer say "on this lead".**~~ **Moot** — the ungrouping follow-up
above removed the disclosure, so a burst now renders as one row per reaction. §5's burst problem is
therefore the BACKEND's to solve (its "notify once, then stay silent for N minutes" option), not
something the list absorbs. Worth knowing if reps report a flooded Notification Center.

#### Not done, and why

- ⚠️ **Tapping does NOT scroll to the reacted message.** `messageId` is in the payload, but §3 files
  this as an open question and says it needs an optional `messageId` on the `chat` `PushRoute` **and**
  `ChatDetail` honouring it — the document's own words, *"a larger change than the rest of this
  document, and worth deciding separately"*. The tap opens the thread, which is the contract's baseline.
- **Every §5 decision is the backend's** — who is notified (proposal: the message author only, never
  self-reactions), the burst rule, never notifying on `remove-reaction`, and whether a reaction writes
  a history row at all. ⚠️ That last one has an app-side consequence: `isRenderable` currently ties
  display and history together, so **banner-only would be the first exception to it** and is not
  something the app can opt into per type today.

Verified with 14 tests (`__tests__/utils/chat-reaction.test.ts`) driving the real functions over §2's
payload verbatim: the lead reaction resolving to its thread, an **absent** `leadId` reading as a channel
rather than a lead chat, a chat-less payload returning `null` instead of guessing, the messages channel,
`isRenderable`, foreground suppression true for that exact thread and false for another chat or another
screen, `invalidationKeysFor` returning the two notification keys and nothing lead-scoped, the reaction
carding **with** its own thread (the regression above, asserted against the pre-fix list), a four-emoji
burst rendering as four separate rows each keeping its own unread state, a reaction sitting beside a
message from the same thread without merging into it, and a channel reaction rendering with no chip. tsc 44 (baseline unchanged); `push-routing.ts`,
`notification-groups.ts`, `useNotifications.ts` and `notifications.ts` are eslint-clean; the iOS bundle
builds.

⚠️ Nothing can be checked on device until the backend sends the event. `npm run test-push -- --user=<id>
--event=chat-reaction` (§6.4) is what fires a real payload without needing two accounts in a chat.

---

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

### Job-builder logs diffed against WEB, payload key by payload key

Ticket: *"we have to compare mobile logs with web and have to generate the same log in mobile just
like web"*, with two portal lifecycle-timeline exports of the SAME config, same vertical, same tabs —
`jobBuilderWeb.txt` / `jobBuilderLogsMobile.txt` (repo root).

**The vocabulary was already right.** Both sides emit exactly `step_viewed` / `step_navigation` /
`field_changed` under `module_type: 'job_builder'`, and the three `metadata` KEY SETS are identical —
no key is missing on either side. Every divergence is in a VALUE:

| key | web | mobile (before) | cause |
|---|---|---|---|
| `configId` | `6a71a118…` | **`null`** | read `configId`/`_id`; the normalizer stores `id` |
| `stepNumber` / `fromStep` / `toStep` | `3` / `4` | **`1` / `2`** | indexed the UNLOCKED tabs |
| `direction` | `next` / `back` | `forward` / `backward` | different words |
| `result` | `Sale` | `sale` | mobile stores it lower-cased |
| `jobBuilderId` | `N/A` | **the mongo lead id** | passed `jobId: leadId` |
| a swatch's `fieldLabel` | `Wrap Color` | `Color` | hardcoded on `isColor` |

⚠️ **`calculatorType` (`Unknown` on web vs `dynamic` on mobile) is NOT a divergence and was left
alone.** Both platforms use the identical fallback chain
(`jobBuilderData?.calculatorType || sessionMeta?.calculatorType || 'dynamic'`); web's capture simply
carried a stored `'Unknown'`. Copying the string would have made mobile report less than it knows.

#### `configId` was silently `null` on EVERY log

`normalizeLightweight` (`useDynamicCalculatorSchemas`) moves the id onto **`id` and DELETES `_id`**,
so `initialConfig?.configId || initialConfig?._id` could never resolve. Web passes `config?.id`.
⚠️ The submit-payload call site in the same file already read `.id` — only the logging one had drifted,
which is why nothing else looked broken.

#### The step number came from the wrong index space, and the file already warned about it

Web numbers against **`tabs = activeVertical?.tabs`** — the vertical's FULL tab list. Mobile used
`currentTabIndex + 1`, an index into `nonSummaryTabs`, which is `availableTabs` filtered, i.e. the
**UNLOCKED** tabs only. On a build whose earlier tabs were locked, Soffit therefore logged as step 1
where web logged step 3.

⚠️ **A step number that moves as tabs unlock is not a stable identifier for the portal** — the same tab
reports a different number on two visits of one session. `currentStepIndex`'s own comment in
`DynamicJobBuilderScreen` already records the two index spaces as a trap ("mixing them misaligns
whenever a vertical has locked tabs"); the three logging calls were reading the wrong one. New
`logStepNumberOf(tab)` is web's expression verbatim (`Math.max(1, tabs.findIndex(id) + 1)`) and feeds
`stepNumber`, `fromStep` and `toStep` so the three can never disagree.

#### `jobBuilderId` was the lead's mongo id, twice

Web's `jobId` is the **human lead/job number** (`currentLead?.leadId || currentLead?.jobNumber || …`),
and a lead with none stores the literal `'N/A'` — which is what its capture shows. Mobile passed
`jobId: leadId`, so `jobBuilderId` and `leadId` were the same mongo id on every row and the job number
appeared nowhere. Now `lead?.leadId || lead?.jobNumber || leadId`.

#### The colour-label rule was a one-liner where web has a whole pass

Mobile: `const fieldLabel = isColor ? 'Color' : field?.label || …` — so a swatch's **own authored
label was discarded**. `Wrap Color` and every other named swatch logged as a bare `Color`, and two
different colours in one section were indistinguishable on the timeline.

Ported web's `buildSchemaFieldLabel` colour pass in full, plus the four helpers it needs —
`COLOR_FIELD_TYPES` / `NON_OWNER_FIELD_TYPES`, `isColorFieldType`, `isGenericColorLabel`,
`findColorOwnerLabel` / **`resolveColorFieldOwnerLabel`**, and **`resolveComboSectionLabel`**:

- **A swatch with a real label keeps it** (`Wrap Color`), and `Color` is appended only when the base
  does not already end in it (`/colou?rs?$/i`) — so it never reads `Wrap Color Color`.
- **A GENERIC label (`Color` / `Colour` / `Custom Color` / `Colors`) carries no identity**, so it falls
  back to `ownerLabel` — the nearest PRECEDING input in the section's field tree, which is the same
  positional convention `utils/dynamic-job-builder/engine/locked-color-defaults.ts` relies on. That is
  what turns an unlabelled Extras swatch into `Ground Spout Color`.
- ⚠️ **Another colour picker can never be the owner** (`NON_OWNER_FIELD_TYPES`), or two adjacent
  swatches would name each other.
- **`resolveComboSectionLabel` gives an unlabelled combination section a stable ordinal**
  (`Section 2`), so LeafFilter's four one-combination sections stop collapsing into four identical
  `LeafFilter Combo #1` rows that the portal's viewer then de-dupes into one.
- ⚠️ **An unlabelled swatch whose KEY is not a colour word logs as `color_gem7v Color`.** Web does
  exactly the same (its `rawFieldLabel` is `label || key || id`), and it is asserted in the tests as
  parity rather than "fixed" — diverging here would put two different labels on one field again,
  which is the whole complaint.

Verified with 13 tests driving the real helpers over the captured Fascia tab: the repro
(`Fascia Wrap Combo #1 - Wrap Color`) **with the pre-fix expression asserted to yield `Color`**, a
generic label resolving to its owner, no doubled word, a non-colour field untouched, the owner walk
(preceding-not-following, never another swatch, descending into a stack, unknown id → `''`), the raw-key
parity case, and the ordinal fallback for two unlabelled sections. tsc 48 (baseline unchanged); the
util and the test are eslint-clean and `DynamicJobBuilderScreen.tsx` is at its HEAD baseline
(49 problems: 2 pre-existing errors / 47 warnings). ⚠️ Both files are CRLF.

⚠️ **Not changed: `DynamicDealEditScreen` still sends `direction: 'forward' | 'back'`.** That is the
`my_deal` module's own log family, not job_builder, and it was outside this comparison — check it
against web's `use-deal-edit-activity-log.js` before assuming it matches.

### The Summary tab logs the scheduler OPENING, and every document add / remove

Ticket: *"you have to add logs while we are trying to open Schedule Appointment"* (with the
payload verbatim), plus *"three more logs — while update the agreement i mean remove it and press
the update button… while we add the document (order sheet)… and while we remove the document"*.

Four rows, all `module_type: 'job_builder'`, all from
`widgets/components/dynamic-job-builder/agreement/SummaryFinalizeCards.tsx` (the card suite
`DynamicJobBuilderScreen` renders through `VerticalSummaryTab` — the screen itself holds none of
these handlers).

| when | `action_type` | `meta.action` |
|---|---|---|
| the scheduler is OPENED | `click` | `appointment_scheduled` |
| an Update REMOVES a filed agreement | `delete` | `agreement_removed` |
| an Update ADDS order-sheet pages | `add` | `order_sheet_uploaded` |
| an Update REMOVES an order sheet | `delete` | `order_sheet_removed` |

**Only ONE of the four is new machinery; the other three are one path.** The scan sheet's Update
is a single button for two different events — the rep may add pages, cross filed ones out, or both
— and `DocumentScannerModal.onSave` hands back **only the survivors**, so a removal has to be
recovered by diffing against what the card held before it opened.

- **`logSchedulerOpened` is DISTINCT from the `change` row `saveAppointment` already files.** It
  reports the appointment **as it stands when the rep opens the sheet**, so the portal can tell an
  open that changed nothing from one that did. Fired from **both** entry points — the pencil on a
  scheduled card and the `Schedule Appointment` button on an unscheduled one.
  ⚠️ `date`/`timeWindow` go out as **`null`, not omitted**, on the unscheduled path: an absent key
  reads as "not reported", and here it is genuinely "not yet set".
- **The removal log is fired BEFORE the delete-only early return**, so a removal is recorded whether
  or not the same Update also added something. The scanner has already awaited its `DELETE`s by the
  time it calls back, so the row reports what happened rather than what was attempted.
- **The agreement upload log was already there; the order sheet's was NOT.** Adding an agreement
  left a trace and adding an order sheet left none. Both now go through one `logDocumentAudit`, so
  the two categories can never file differently-shaped rows for the same act.

⚠️ **`documentCount` counts the pages the rep ADDED, while `documents` (the S3 refs) come from the
SERVER rows** — and the split is the point, not fussiness. `uploadNewFiles` resolves to the
category's **whole server list**, so counting it would report "3 uploaded" for one new page (the
trap the down-payment-receipt log records). But a locally-scanned page has **no `filePath`** — that
is generated server-side — so the refs have to come from the rows that landed, picked as the ones
the card did not already hold. `documentNames` sits beside them because a scanned page has a name
long before it has a path, and `toDocumentRefs` drops a path-less row.

**Rules live in the pure `src/utils/document-audit.ts`** — `documentAuditDescriptor`,
`pickUnknownDocuments`, `buildDocumentAuditMeta` — for the reason `utils/uploaded-document-refs.ts`
and `utils/addendum-drafts.ts` exist: the card pulls in React Native and is untestable under jest
here, and a removal attributed to the wrong category, or a diff reporting a document nobody
touched, leaves **no trace on the device**.

- ⚠️ **`pickUnknownDocuments` takes the caller's `identityOf`, it does not re-derive one.** The card
  already reconciles these documents across the scanner round-trip with its own `docIdentity`
  (`serverId ?? _id ?? filePath ?? id ?? url ?? uri ?? name`); a second, subtly different notion of
  "the same document" would report a removal on a document that is still on the card.
- ⚠️ **A row with no resolvable identity is treated as KNOWN** — neither removed nor added. That is
  the conservative direction on both sides: the scanner cannot have deleted what it could not
  identify either, and inventing an event is worse than missing one.
- **One primitive, both directions**: removals are `pickUnknownDocuments(priorList, survivorIds)`
  and additions `pickUnknownDocuments(serverRows, priorIds)`. Naming them separately would have
  meant two copies of the one rule that matters.
- **`documentAuditDescriptor` is the WHOLE vocabulary** (4 rows). An unknown category yields `null`
  and nothing is logged, rather than a row whose `action` the portal cannot route.
- `agreement_uploaded` keeps the exact `fieldLabel: 'Agreement Uploaded'` it already shipped (web
  parity — `document-summary-cards.js` labels the uploaded path that way and only the GENERATED
  path plain `Agreement`), and `order_sheet_uploaded` matches the LEGACY job builder's own
  `logOrderSheetUploaded`, so both builders file the same action for the same act.

#### ⚠️ `appointment_scheduled` fires on **Yes**, not on "Generate Dynamic Agreement"

Ticket: *"one log is calling in the wrong button — it should be call while we click the yes button
instead of calling Generate Dynamic Agreement."*

The `change` row was filed by `saveAppointment`, and **the create flow never calls `onConfirm`** —
it calls `onGenerate` / `onUpload`, i.e. the two buttons on the *"Job Booked!"* card. So the row
was only filed once the rep chose what to do with the booking, and a rep who booked the job and
then closed the modal filed nothing at all. The booking happens one screen earlier, at
**"Does this time work for the customer?" ▸ Yes**.

- **New optional `onBooked` on `AppointmentSchedulerModal`**, fired from `handleAcceptSlot` (Yes)
  AND `handleConfirmTBDStep` (the TBD path reaches the same card). Audit only — the appointment is
  still persisted by `onGenerate` / `onUpload` / `onConfirm` exactly as before, so nothing about
  when it is SAVED changed. Optional, so `SummarySection` and `EditContractDetailsModal` are
  untouched.
- **The log moved OUT of `saveAppointment`** into a named `logAppointmentScheduled`, called from
  the booked callback and from `handleScheduleConfirm`. `handleScheduleAndGenerate` /
  `handleScheduleAndUpload` no longer log, so one booking is still exactly one row.
- ⚠️ **The booked row is suppressed in the EDIT flow** (`if (isEditingAppt) return`). Re-scheduling
  a booked job commits at **Save Changes**, and with `requireScheduleAmendment` on it commits only
  once the customer has **SIGNED** the amendment — logging at "Yes" would record a reschedule the
  customer can still refuse. `handleScheduleConfirm` is that path's commit point and keeps the row.
- ⚠️ **New `bookedAppointmentData(tbd)` takes `tbd` as an ARGUMENT, never reading `isTBD`.** Both
  accept handlers set that state in the same tick, so reading it would see the previous value and
  a TBD booking would log as a dated one. It also de-duplicates the appointment-shape expression
  the two success-card buttons already repeated.

tsc 48 (baseline unchanged); `SummaryFinalizeCards.tsx` (36 problems) and
`AppointmentSchedulerModal.tsx` (78) are each byte-identical to their HEAD eslint baselines.
⚠️ Both files are CRLF — `newline=''` on both ends.

#### …and the three controls that OPEN a document sheet

Follow-up: *"add click log for agreement and ordersheet as well just like we add for Scheduled
Appointment — when we click generate a log with click action type will call; when we click add
document from agreement same log will call, you can change in mata like if we are generating or
adding; same like in order sheet."*

Three more `action_type: 'click'` rows, one per control on the two document cards:

| control | `meta.action` | `meta.source` |
|---|---|---|
| Agreements ▸ **Generate** | `agreement_generated` | `generate` |
| Agreements ▸ **Add Document** | `agreement_uploaded` | `add_document` |
| Order Sheets ▸ **Add Document** | `order_sheet_uploaded` | `add_document` |
| either card's **pencil** | `<category>_uploaded` | `edit_documents` |

⚠️ **The click carries the SAME `meta.action` as the act it leads to**, told apart only by
`action_type: 'click'` — exactly how the scheduler's open row relates to the `change` row its
confirm files. So the portal reads "they opened the agreement sheet" and "they filed an agreement"
as one story rather than two vocabularies, and `source` says which control started it. The Generate
row therefore reuses the exact `agreement_generated` / `fieldLabel: 'Agreement'` that
`DynamicAgreementDialog` files when the document actually exists (web parity: only the GENERATED
path is plain `Agreement`).

⚠️ **The PENCIL is logged too, though the ticket named three controls.** It is the *same*
`setScannerCategory(cat)` call — **Add Document simply becomes a pencil once the card holds a
document** — so logging only the empty-state button would make the row stop firing the moment
there is anything to edit. `source` keeps the two apart.

⚠️ **`orderSheet` has no `generated` descriptor, on purpose**, so `buildDocumentOpenMeta` returns
`null` there and nothing is logged: there is no order sheet generator, and aliasing it onto the
upload row would report a document as produced by a button that does not exist.

⚠️ **The open row deliberately carries NO `documentCount`/`documents`.** Nothing has been chosen at
click time, and a `documentCount: 0` beside an action named `..._uploaded` reads as an upload that
filed nothing.

Verified with 5 further tests (20 in the suite): the Generate row matching the dialog's own payload
verbatim, both Add Document rows, the pencil sharing the action but not the `source`, no count keys
on an open row, and the order-sheet generate returning `null`.

Verified with 15 tests driving the real helpers and the card's own `docIdentity` verbatim: the
ticket repro (the crossed-out agreement reported, and only it), one of several removed, nothing
removed, a survivor whose re-signed url changed still matching on `serverId`, an identity-less row
inventing nothing, junk input as a no-op; the addition diff against a whole server list; and the
meta — a removal carrying `filePath`/`bucketName`, the add counting **the pages added and not the
server total** while still resolving its refs, a multi-page scan, a path-less row keeping its name,
an unknown category as `null`, and the two categories never crossing. tsc 47 (baseline unchanged);
`document-audit.ts` and its test are eslint-clean and `SummaryFinalizeCards.tsx` is byte-identical
to its HEAD baseline (36 problems: 1 error / 35 warnings). ⚠️ That file is **CRLF** — `newline=''`
on both ends.

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
