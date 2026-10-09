# Investment Center & Job Tracker

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/InvestmentCenter/**`, `src/screens/JobTracker/**`, `hooks/useLeadCalculatorStatus.ts`, `widgets/components/LeadCenter/OperationalSections.tsx` (tool tiles).
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## Investment Center spotlight: blurred backdrop, smaller card type, no strike-through

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

## Investment Center tile unlocks instantly after "Jobs Built — Back to Tools"

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

⚠️ The React-rendering half could not be exercised — `@testing-library/react-native`'s `render` returns
an object with **no queries** in this repo (the `__mocks__/test-renderer.js` React 19 shim), so
component-level tests of `ToolsSection` are not currently possible.

## The Add-to-Job-Tracker modal clipped its own buttons

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

## The Investment Center never saw the down payment entered on the DROP screen

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

⚠️ Both files are CRLF — `newline=''` on both ends.

## The Job Tracker calendar could not go back a month

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

## The Job Tracker Status chip was a one-tap server write

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

## `investment_down_payment_changed` now carries the already-selected plan

Ticket: the down-payment log had no payment plan, so the portal could not tell which plan was chosen when the rep
moved the down payment. `logInvestmentDownPaymentChanged` (`utils/activity-log/investment-center-log.ts`) takes an
optional `selection` and adds the SAME fields as `investment_payment_method_selected`: financing ->
`paymentPlan` / `planLabel` / `monthlyPayment`; basic CK/CC/AMEX -> `paymentMethod` / `methodLabel`; plus `isFinancing`.
Built in `InvestmentPanel.logDownPaymentChange`: In-Home uses the shared `paymentChoice`, 1-Year uses `oneYearKey`.

- ⚠️ `monthlyPayment` is recomputed for the NEW amount (`endPrice - min(amount, endPrice)`): the commit fires on
  blur before the panel re-renders, so the rendered `inHomeMonthly` is still the OLD down payment's.
- 1-Year's `monthlyPayment` is `oneYearMonthlyShown` - it does not depend on the 1-Year down payment today.

- Investment Center company branding row (logo + company name) is `justifyContent: 'center'`; it was `flex-end`, which pushed the LeafFilter logo to the right edge instead of under the screen's centred title and heading.

## Investment Center: a full-package tab shows the box + ⓘ AND the scope list

`screens/InvestmentCenter/InvestmentPanel.tsx`, "Includes the Following". On a full package the centred box + ⓘ used to
REPLACE the whole `inclusions` list, so the job-scope sentences never appeared. QA: the details were missing next to the ⓘ.
The `FullPackageTitle` now renders above the list (`marginBottom: 14`) and the list renders for every calculator, package or not.

- ⚠️ This supersedes the "REPLACES the list" decision in `deal-center.md` (full-package section); do not restore the
  replace branch. The ⓘ card still carries the package breakdown.
- A long scope pushes Total Investment further down; a "Show details" collapse is the fallback if that bothers reps.

- Investment Center branding row: with a logo it shows the LOGO ALONE, centred. The company-name text beside it duplicated the heading below ("Your Investment With {company}") and pulled the logo off-centre; the name now renders only as the fallback when there is no logo.

## REVUIUX-505 — the Forever Record's Investment Center section, end to end

Ticket: the portal's Investment Center section in the Lead Details modal was redesigned around a new
hierarchy — **section -> job scope -> visit -> event** — with a Foundation card of baseline prices at
the top of each scope and a cyan Price Secured box at the bottom. The dev handoff
(`Forever_Record_Investment_Center_Dev_Handoff.md`, attached to the ticket) describes a record the app
was not yet producing: six of its requirements had no event behind them. The portal UI is a rewrite,
the app's logging vocabulary grew, and **the backend did not change at all**.

### The chain

1. **`InvestmentPanel`** emits the events through `utils/activity-log/investment-center-log.ts`, all of
   them under `module_type: 'investment_center'` with the specifics in `meta`.
2. **The backend stores and returns `meta` wholesale.** `UserActivityLogEntity` declares
   `meta: { type: Schema.Types.Mixed }` — no whitelist — and `LeadLifetimeSummaryService` hands it out
   as `metadata`. Grouping into calculators (`InvestmentCenterUtils`) and the Forever Record detail-level
   filter both key off the **module type**, never off `meta.action`. So a new action is carried end to
   end with no backend release.
3. **The portal** groups and renders it in
   `forever-record/sales-process/logs/investment-center/` (new folder; the old
   `investment-center-log.js` / `-log-item.js` pair was deleted). `build-scopes.js` is the pure
   derivation: calculator -> scope, `visitId` -> visit, `meta.action` -> row kind.

A **job scope is a calculator** — the backend already groups a lead's `investment_center` logs by
`meta.calculatorId`, and `calculatorTitle` is the scope's name. Nothing new was needed for that layer;
`baseMeta` has always carried both.

### What the panel now logs

- **`investment_program_enlarged` / `investment_program_minimized`** — the spotlight IS the handoff's
  enlarge. `programOfSection` maps `SpotlightSectionId` onto the program (`'total' -> 'msrp'`, which is
  why `DisplayProgramKey` is wider than `ProgramKey`: the MSRP card can be zoomed but cannot be opted
  into). `priceOfSection` carries the figure on screen. The minimize carries `enlargedSeconds`, which
  the portal prints as "(time spent enlarged X min)".
- **`investment_price_secured`** — fired at `confirmInHome` AND at the 1-Year opt-in toggle. Deliberately
  separate from `investment_opt_in`: In-Home commits behind the "Secure This Price" confirmation modal
  while 1-Year is a direct toggle, so the opt-in alone does not mean the same thing on the two cards.
  Emitting a dedicated event at both commit points makes them read alike in the record.
- **`investment_calculator_left`** — closes the visit, so its duration is the real time in the scope
  rather than the span between the first and last tap. Without it a visit whose last event came early
  reads as far shorter than it was.
- **`visitId` on every event** (`baseMeta`), minted once per panel mount.
- **`baseline`** (`ScopeBaseline`: MSRP / 1-Year / In-Home `{ price, monthly, planLabel }`) on the
  scope-view event — the prices as the scope opened, which is exactly what the Foundation card shows.
- **`program: 'inhome'`** on plan add/remove, which previously carried none, so those rows had no tag.
- **`planMonthlies`** (`PlanMonthlyChange[]`: `planId`, `planLabel`, `old`, `new`) plus
  `previousDownPayment` on the down payment, so the portal's gray panel can list every re-priced plan
  as "$370 -> $343/mo" instead of only the selected one.

### The visit lifecycle

`InvestmentCenter/index.tsx` renders `<InvestmentPanel key={active.id} />`, so switching scope tab
**unmounts and remounts** the panel. That makes one mount exactly one entry into one job scope, which is
the handoff's definition of a visit — so the panel, not the screen, owns it:

- `visitIdRef` is seeded once per mount (`${calculator.id}-${Date.now()}-${random}`) and goes into
  `logBase.visitId`.
- A `useEffect(..., [])` logs `investment_calculator_viewed` with the baseline on mount, and its cleanup
  flushes any open enlarge then logs `investment_calculator_left`.
- `logBaseOnMountRef` pins the identity for that cleanup: a visit's id cannot change while it is open,
  and the cleanup closes over the first render.

**Reproducing a second visit:** enter scope A, switch to scope B, switch back to A. The remount mints a
new `visitId`, so the portal draws `VISIT 2` with its own duration and the section header's total time
becomes the sum of both. On a single-calculator lead, leave the Investment Center screen and re-enter it.
A visit with no events still renders if it has a start time, so entering and leaving is enough to see the
divider.

⚠️ **The duplicate `logInvestmentCalculatorViewed` effect was REMOVED from
`screens/InvestmentCenter/index.tsx`.** It tracked `lastViewedCalcIdRef` and fired on tab change, which
is the same moment the panel now mounts — putting it back double-logs every visit, and the second copy
carries no `visitId` or baseline.

⚠️ **A card left enlarged still owes its minimize.** `flushEnlarged` runs when another card is enlarged
(so two enlarges never overlap in the record), when the spotlight closes (`onClosed`), AND from the
unmount cleanup — the handoff's "if never minimized, close it at scope switch or exit". The unmount path
goes through `flushEnlargedRef` rather than calling `flushEnlarged` directly, because that cleanup closes
over the first render's copy.

⚠️ **`planMonthlies` is In-Home only.** 1-Year's monthly is quoted off `oneYearGrandTotal` and does not
subtract its own down payment (see the `investment_down_payment_changed` note above), so there is no
before/after to report for it — emitting one would print "$370 -> $370". Fixing that is a pricing change,
not a logging one. `inHomeBaseFor(dp)` recomputes the base at both the old and the new down payment and
runs `calcMonthly` over the financing plans in `addedPlanKeys`.

### What the portal does with it, and why every field is optional

Every derivation in `build-scopes.js` degrades to the older shape, because a lead presented before this
build must still render. That is the contract to keep in mind when changing anything above: **removing a
field does not break the portal, it silently drops back to a worse inference.**

| Missing | Portal falls back to |
| --- | --- |
| `visitId` | splits visits on each `investment_calculator_viewed` |
| `investment_calculator_left` | the visit ends at its last event |
| `baseline` | the first price seen per program inside the scope |
| `investment_price_secured` | the last opt-in that was not cancelled afterwards |
| `enlarged` / `minimized` | those rows simply do not appear |
| `planMonthlies` | one row for the selected plan, with no "old ->" half |

⚠️ **`calculatorId` is what makes a scope exist at all.** A log without it is not grouped into
`investmentCalculators`, so it lands in the section-level list and renders as a bare row — no scope
header, no visit divider, no duration. `baseMeta` omits the key when it is falsy, so a log fired before
`calculator.id` is available produces exactly that.

⚠️ **The portal never strikes a row through just because a later event supersedes it.** The log is
append-only; a struck row means a real `investment_plan_removed` / `investment_opt_out` /
down-payment-to-zero. Do not add "corrective" events to tidy the record.

⚠️ **Nothing renders at Forever Record detail level Low.** The backend strips all activity logs there and
keeps only milestones, so an empty-looking section is a permission level before it is a bug.

## Job Tracker Overview table: one column config, everything centred

`screens/JobTracker/index.tsx`. The header, the month rows and the Totals row were three copies of ten hand-written `<Text>` cells with mixed `w-24` / `w-28` widths and right alignment, so labels such as "Net Comm. per Job" wrapped into their neighbour and the numbers sat against each column's right edge, away from their centred-looking headers.

Now a single `OVERVIEW_COLUMNS` list (`key`, `label`, `width`, `format`) drives all three; each cell uses its column's one width, `paddingHorizontal: 6` and `textAlign: 'center'`; the header wraps to at most two lines.

- ⚠️ Add or reorder a column in `OVERVIEW_COLUMNS` only - never hand-write a cell in just one of the three rows, or the widths drift again.
- The Month column is centred too (it was left-aligned).
- The monthly jobs table (Job Number ... Calculator Name, under each "September 2026" group) is centred too: header and cell `Text`s are `text-center`, the date chips are `self-center` inside `items-center` wrappers (they were `self-start`), and the payment-method cell is `justify-center` so its (i) icon stays beside the text.

## "+ Add Plan" from the enlarged card keeps the enlarged card open

`InvestmentPanel`. Tapping "+ Add Plan" on the spotlight (enlarged) In-Home card no longer closes the spotlight. The picker renders as an in-modal overlay: `AddPlanModal` takes `inline` (absolute-fill `View`, no native Modal) and `SpotlightOverlay` takes an `overlay` slot rendered last inside its own Modal. The enlarged card closes only when the rep taps outside it.

- ⚠️ Never stack native Modals: from the spotlight the picker MUST be the `inline` overlay. The ordinary `AddPlanModal` (Modal) is gated `showAddPlan && !spotlight` so only one of the two ever renders. An earlier version closed the spotlight and re-opened it after the picker; reps rejected the flicker. Do not restore it.
- The enlarged card reads live panel state, so an added plan appears in its Monthly list as the overlay closes.

### 1-Year default plan reaches the Investment Center
`InvestmentPanel.tsx` resolved a `Default`-mode 1-Year monthly from the hard-coded `defaultOneYearKey` (first 9.99% APR plan) and ignored the stored `oneYearMonthlyPlan.planKey`, so the rep's picked default never showed. Now `default` mode uses the stored `planKey`; and a calculator with nothing stored (or a bare `Default`) inherits the lead-wide default (`leadOneYearDefaultKey`, computed in `InvestmentCenter/index.tsx` from the first tab with `oneYearMonthlyPlan.isDefault`) - the same inheritance rule as `OneYearMonthlyPlan.tsx`. `defaultOneYearKey` is only the last fallback. Not verified on device.

## Investment Center — company-name text flashed before the logo on a calculator-tab switch

`InvestmentPanel` is `key={active.id}`, so each tab switch REMOUNTS it and `useSecureLogo` restarted from `null`; the
branding row showed the company-name fallback until the secure URL resolved, then swapped to the logo.

- **`hooks/useSecureLogo.ts`** keeps a module-level `resolvedLogos` map (filePath → resolved URI) and seeds its state from
  it (and from a plain `http` source), so a remount already has the logo on the first render.
- **`InvestmentPanel.tsx`** shows the name fallback only when there is NO logo source at all (`hasLogoSource`); while a
  configured logo is still resolving (first ever open) the row stays empty at its `minHeight: 32`.
- ⚠️ Do not drop the cache by "simplifying" the hook, and do not un-key the panel to fix this — the key is what resets
  per-calculator state.
