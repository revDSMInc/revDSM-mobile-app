# Deal-edit wizard & addendums (My Deals ▸ Edit Job Build)

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `DynamicDealEditScreen.tsx`, `DynamicDealCenter/utils/dynamic-deal-diff.ts`, `dynamic-deal-pricing.ts`, `build-deal-center-data.ts`, `widgets/components/dynamic-job-builder/agreement/SummaryFinalizeCards.tsx`, `DocumentScannerModal.tsx`.
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## "Send Addendum To" now blocks Submit on an incomplete phone number

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

⚠️ Noted while testing: `formatLocalUSPhone` keeps the **LAST** ten digits when handed more (documented
behaviour — it is what makes `+1…` / `1…` / already-formatted input normalise). So over-long input
yields a *different* ten digits rather than a truncation of the first ten. `maxLength={12}` keeps it
unreachable by typing; do not "fix" the formatter to slice from the front, or every E.164 seed breaks.

## Addendum Review diffs a locationGrid CELL BY CELL, not by its total

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

⚠️ **`dynamic-deal-diff.ts` is a CRLF file.** A script that reads/writes it in text mode rewrites all
466 lines to LF and buries the change in a whole-file diff — that happened here and had to be converted
back. Use `newline=''` on both ends. (Same trap as `EditCustomerModal.tsx`; check `file <path>` before
and after.)

## ✅ ROOT CAUSE: the Addendum Review's "original" and the live build were ONE object graph

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

## Deal-edit wizard Step 0 now matches web (intro → calendar → confirm time → success)

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

## Deal-edit Review step names rows after the SECTION, not the tab

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

## Deal-edit Review: a REMOVED combination read as an edit of the surviving one

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

## Deal-edit Review step shows payment-method changes

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

## Deal-edit Job Summary: per-card colours + combination dividers

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

## Deal-edit "Send Addendum To" phone is dash-formatted, always +1

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

## Deal-edit wizard: keyboard covered the Notes / Phone / Price inputs

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

## Deal-edit summary listed every document twice

Ticket: *"My deals - summary page - why is it showing two order sheets and two agreements? I haven't
added any more."* The Deal screen showed 2 agreements + 1 order sheet; **Edit ▸ Summary showed 4 + 2**
— an exact doubling.

There were **two separate causes** — one on the Deal screen, one in the edit wizard. Fix both.

### (a) Deal screen — `JobDocsSection` merged the lead record with two outcome reads

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

### (a2) The mount-time outcome prefetch in `useLeadCenterData` is gone too

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

### (b) Edit wizard — `SummaryFinalizeCards` merged the server list with the draft copy

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

### (c) The backend files a SECOND agreement row on submit

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

## Deal-edit price didn't move when a combination's footage changed

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

### Full web↔mobile diff of the pricing chain (2026-08-11)

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

### ✅ ROOT CAUSE (found 2026-08-11): the edit wizard priced against `configuredSchemas`

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

### ⚠️ The LeafFilter tab is priced ONLY by grid column sums (config fact, 2026-08-12)

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

### ✅ ROOT CAUSE, FOUND AND FIXED (ticket 339, 2026-08-13): a `0` in `dealCenterData` SHADOWED the overlay

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

### Also ported en route: web `ticket-1063` (2026-08-11)

> ⚠️ **CORRECTION — this section described work that had NOT been done.** It entered the repo in
> `4b9ffa9 "update the Claude md file"` (2026-09-15) with no code beside it: no branch, local or remote,
> ever had `getVisibleFieldOptions` in `src/`, and the engine still carried the pre-ticket-1063
> implementation. The port landed later, from the backend team's spec
> (`MOBILE-TICKET-1063-DROPDOWN-CHANGES.md`) — **the record of what actually shipped, including the
> dropdown work this section does not mention, is `deal-center.md` § "Ticket 1063 — dropdowns become
> dependent fields"**. What follows is kept only because the diagnosis (the side-by-side, and WHY the
> stripped rule context hides options) is still correct and still worth reading; read it as the spec it
> was, not as a record.

A side-by-side on the SAME deal (`6a7b1a12…`, Micro Mesh, 444 ft) settled it — **web $6,483 / $12,757 /
$19,626, mobile $200 flat** — so it is a mobile bug, not the config. The web repo had been re-pulled and
carried a commit from that same day (`51c8a246 ticket-1063`) touching five engine files, none of it
ported. That work is now in:

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

⚠️ **`DynamicTabRenderer.tsx`'s three call sites now pass `depCtx`** (built at ~line 385). Any new
caller of `filterVisibleToggleOptions` / `getVisibleFieldOptions` MUST pass that same context — passing
`dealCenterData` still type-checks and still "works" for same-section rules, which is exactly what made
this bug invisible for so long.

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

## Deal-edit Job Price step had NO validation (price below cost, down payment above price)

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

## Scan-document sheet: blank PDF tile + the agreement was deletable from it

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

## Deal-edit payment methods now seed from the sale

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

## Down Pmt Method must never offer a financing plan

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

## Addendum Review renders a combination as the portal's TABLE, in config field order

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

⚠️ Needs a device check (this repo cannot render-test): that a long measurement label wraps inside the
card instead of pushing its value off the right edge.

### …and every combination of a section shares ONE block, edited or added

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

#### …and an edited combination is described in FULL, not only by what moved

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

## My Deals shows uncoloured LeafFilter combinations again (supersedes the section below)

Ticket: *show combinations that have values AND the ones with none — give the rep a free hand over the
LeafFilter combination inputs.* `isComboHiddenInDealEdit` (`combination-color-filter.ts`) now always returns
`false`; it stays as the single choke point for the three surfaces (cards, Grand Total, Summary step) and
numbering, so nothing else changed. To restore the colour rule, put back
`editMode && !combo[ADDED_IN_EDIT_KEY] && !comboHasSelectedColor(combo, fields)`. `ADDED_IN_EDIT_KEY` is
still applied but is now inert for visibility. ⚠️ An untouched empty combination is still pruned on save
(`dynamic-job-state-storage.ts` pruning), so showing it does not persist blank rows.

## My Deals hides a LeafFilter combination whose colour was never picked

Ticket: *"inside My Deals make sure only that combination should be displayed in which the color value is
already selected — if the color value is not selected then that combination should not be displayed at
any cost."*

A combination the rep never finished is noise in the edit wizard: it cannot be reviewed or signed off,
and on a multi-combination deal it pushes the finished ones off screen. `CombinationSectionBlock`
(`DynamicTabRenderer.tsx`) now skips it when `editMode && !comboHasSelectedColor(combo, baseRowFields)`.

The rule is a pure util, `utils/dynamic-job-builder/engine/combination-color-filter.ts`, so it is unit
tested (`__tests__/utils/combination-color-filter.test.ts`, 12 cases) — the component itself cannot be
loaded under jest here.

⚠️ **DISPLAY ONLY, and edit-mode only.** The combination stays in job state and round-trips untouched, so
hiding it destroys nothing. The CREATE flow is deliberately not filtered — that is where the rep is still
picking colours, and hiding a combination mid-entry would remove the row they were working on.

⚠️ **`return null` INSIDE `combos.map`, never a filtered array.** Every handler in that block is bound to
`comboIndex`, and `handleRemoveCombo` renumbers by position — filtering first would edit and delete the
wrong combination.

⚠️ **THREE surfaces render a combination, and hiding it on the tab hides it on ONE of them.** The other
two read their own entries straight from `tabState`, so the filtered combinations came back listing
"Not Selected" against every field — exactly what hiding them was meant to stop. All three now apply the
same gate, edit-mode only:

| Surface | Where |
|---|---|
| The combination cards | `DynamicTabRenderer` `CombinationSectionBlock` — `isComboHidden` |
| "Grand Total - All Combinations" | `DynamicTabRenderer` `visibleSummaryEntries`, filtered BEFORE `shouldShowTabGrandTotalSummary` so an emptied tab drops the card entirely rather than rendering a blank one |
| The Job Builder Summary step | `vertical-summary-utils` `buildCombinationSectionSummary` — its own `comboHasMeaningfulData` is a looser rule and let them through |

Each resolves the field list from its OWN section (`getFlattenedCombinationSectionRowFields(section)`) —
sections have different row fields, so a shared list would test the wrong ones. **A fourth surface would
need the same gate**; the value lives in job state and is deliberately not removed from it.

⚠️ **The section's "Add Combination" button goes with them.** Once the filter empties a section, that
bare button was the only thing left of it — a row of orphaned "Add Combination" buttons under an
otherwise empty LeafFilter tab. It is hidden when `visibleComboCount === 0`. Adding one there would
create a combination with no colour, which the same filter hides the instant it is made, so the button
could not do anything useful either. `isComboHidden` / `visibleComboCount` are computed ONCE per section
so the render loop and the button cannot disagree; both are inert outside `editMode`.

⚠️ **THE COLOUR IS NESTED — look inside containers.** This is what made the first attempt do nothing.
LeafFilter authors its colour INSIDE a stack (the amber "INCOMPLETE - Color Required" card *is* that
stack), so a flat scan of the row fields found the stack and no colour field, fell through to the
"no colour field → always show" rule, and every unfinished combination stayed on screen. Two fixes,
both needed:

- `comboHasSelectedColor` flattens any field carrying `fields` (stack, accordion, anything) before
  filtering for colours.
- The call site passes `getFlattenedCombinationSectionRowFields(section)`, **not** `baseRowFields` —
  that list drops accordions outright (`.filter(f => f.type !== 'accordion')`) and leaves stacks
  unflattened.

Container children live FLAT in the combination's state, so a nested colour's value is still read
straight off `combo[field.id]`.

⚠️ **A combination with NO colour field is always shown.** The rule is "an unanswered colour hides it",
not "a colour is required"; gating on a field the config never authored would blank whole verticals.
Where a combination has several colour fields, every one must be answered — they are all part of the same
finished combination, so a half-filled one is exactly the unfinished case this exists to hide.

⚠️ **A colour is not identified by `type` alone.** `isColorField` also matches a `text` / `locked` field
carrying `palette`, `colors` or `colorKey`, because `renderField` draws those as a SwatchPicker too.
`resolveComboColorValue` checks the field id, the field key AND the `colorValues` side-map, which is how
a picked colour survives the save round-trip.

### Follow-up — Add Combination looked dead; chip numbers had gaps

*"inside My Deals the combination count is not accurate and the Add Combination button is not working —
fix the same as the Deal Center."* (Deal Center side: `deal-center.md`, "combination numbering & the parent
combination".)

- **Add Combination was working, but its combination was hidden straight away.** A new combination has no
  colour, so `isComboHidden` hid it as soon as it was created. `handleAddCombo` now tags it in edit mode
  with **`ADDED_IN_EDIT_KEY` (`'_addedInEdit'`)**, and the rule, moved into
  **`isComboHiddenInDealEdit(combo, fields, editMode)`** (`combination-color-filter.ts`), always shows a
  tagged combination. All three surfaces call that one helper now (cards, Grand Total card, Summary step
  `buildCombinationSectionSummary`), so a fourth one should call it too.
- ⚠️ **The marker is session-only and must stay that way.** On save, `ensureTabStateShape` rebuilds each
  combination from its row fields plus `_combinationNumber`, so the marker is dropped (covered by a
  serialize test). In memory it is skipped by every walk over combination keys: activity-log
  `SKIP_STATE_KEYS`, `empty-step-gate`, storage `comboHasEnteredData`, and the diff's `SKIP_LEAF_KEYS`.
  **If a new walk over combination keys is added, add the marker to its skip list too**, or an added
  combination shows up as a field change. After a reload a still-colourless combination hides again, as
  it should.
- **Numbering counts only SHOWN combinations.** Chips (`chipNumbers` in `CombinationSectionBlock`),
  section offsets (`comboIndexOffsets`), the Grand Total `#N` badges (numbered after the filter), and the
  stored numbers (`renumberTabCombinations(..., isComboShown)`) all skip a hidden combination. A hidden
  combination keeps its old stored number and takes no slot, so the visible chips run 1..N with no gap.
- **The parent is the first SHOWN combination** (`isParentCombination(index, firstShownIndex)`). When a
  hidden saved combination comes first, the first visible one is the parent and has no Remove.
- Tests: `__tests__/combination-numbering.test.ts`.

## Signature pad: "I agree to electronic signature" must be ticked before Save Mark

`widgets/modals/job-builder/AgreementSignatureModal.tsx`. A checkbox row sits ABOVE the Clear / Save Mark buttons on the capture overlay; **Save Mark is disabled (40% opacity) until it is ticked**, and `savePad` itself returns early without it.

- ⚠️ The tick **resets every time a pad opens** (`useEffect` on `activePad`), so the initials and the signature are each an explicit agreement - one tick is not carried from the last mark. It applies to BOTH pads.
- ⚠️ The guard is in `savePad`, not only on the button, so no other caller can save a mark without the consent.
- The consent is not sent to the backend (no field for it); it only gates the capture. If compliance needs it recorded, it has to be added to `/agreement/{leadId}/sign` and the activity log.
- ⚠️ Save Mark needs the tick AND drawn ink (`canSavePad`); ticking alone used to enable it on a blank pad.

### Follow-up — the My Deals hide rule is back ON (it had been stubbed to `return false`)

Ticket: *"inside My Deals the LeafFilter tab should show only the combinations that received values from the Deal
Center; a combination with no value must not display."* An empty `Combination #3` (only the seeded `Versa` profile, no
width, no colour) was showing in the edit wizard.

`isComboHiddenInDealEdit` (`combination-color-filter.ts`) had been neutralised to `return false` in `c4896aa` ("free hand":
leave unfinished combinations visible so the rep can fill them in) and the comment-cleanup commit then dropped the note
saying how to restore it. **Restored:** `editMode && !combo[ADDED_IN_EDIT_KEY] && !comboHasSelectedColor(combo, fields)`.
All three surfaces already call the helper, so cards, Grand Total card, Summary step and chip numbering follow, and the
"Add Combination" button still hides when a section has no visible combination.
- ⚠️ **This deliberately reverses `c4896aa`.** A combination added IN this edit session still shows (`_addedInEdit`), so
  Add Combination works; a SAVED combination with no colour is hidden (display only — it stays in job state). If reps
  need to fill an unfinished saved combination again, this is the one switch to flip back.
- ⚠️ The rule keys on **colour**, as the original ticket did, not on "any value": a saved combination with a width but no
  colour is also hidden. Say so if "no value at all" is wanted instead (it would need a defaults-aware emptiness check).

### Follow-up — ONE universal "Add Combination" in My Deals, with a picker of every combination

Ticket: *when no combination is received from the Deal Center there must be an Add Combination button, and only ONE
universal one, whose dropdown shows all the combination options.* With the colour filter back on (above), a LeafFilter tab
whose combinations were all unfinished showed only the Extras card; a per-section button would have repeated per section.

`DynamicTabRenderer.tsx`: **edit mode** renders a single `UniversalAddCombination` ABOVE the first simple section (the
"Extras" card, after the Grand Total card), or at the end of the tab when it has no simple section (`universalAddPlaced`). One addable section → it adds directly; several → an inline list (not a Modal) of every combination section,
labelled `section.label`, else `<first defaulted row field label>: <default>` (e.g. the 6" / 7" parent), else `Section N`.
The pick adds a blank combination tagged `_addedInEdit` (the filter never hides it) with every dropdown option available.
- ⚠️ **Per-section buttons are gone in edit mode** (`CombinationSectionBlock` now shows its own only when `!editMode`);
  the CREATE flow keeps them. This supersedes the "button goes with them" rule above. Shown whether or not any combination
  is visible, so it is also the way to add to a tab that still has finished ones.
- ⚠️ Option labels are derived, not authored — a config with unlabelled sections and no `defaultValue` falls back to
  `Section N`. Author `section.label` if that reads badly. `visibleComboCount` was removed (unused).

⚠️ **Update — no picker.** The inline section list was removed (ticket: *"on click do not show these options; show the
combination box directly above the button"*). `UniversalAddCombination` is now a plain button: it adds a blank, `_addedInEdit`
combination to the first addable section that has nothing showing, else the first section with room, and the new card renders
in that section's slot above the button. Its own width / profile dropdowns then carry the choices. ⚠️ Which section gets it is
by config order, so on a LeafFilter deal the new card lands in the first empty section (e.g. the 6" parent), not a chosen one.

⚠️ **Placement update — BELOW the combinations.** Ticket: the button showed above a newly created combination. It was placed
above the first *simple* section, which on that config comes BEFORE the combination sections. It now renders right after the
**last combination section** (and its Grand Total card) in `DynamicTabRenderer.tsx` (`lastCombinationSectionId`), so a new
combination appears above the button regardless of where Extras sits; the end-of-tab fallback stays for a tab with none.

⚠️ **Final placement:** directly under the last combination section and ABOVE the Grand Total card (not below it).

⚠️ **Spacing:** the universal button is `compact` (12 below, not 24) with `marginTop: -12` to cancel the section block's `mb-3`, so the card above and the Grand Total below sit 16 / 12 away. `AddCombinationButton` gained the `compact` prop; the create-flow buttons keep `mb-6`.

⚠️ **Blank, not seeded:** the universal Add Combination uses `createBlankCombinationItem` (`combination-utils.ts`) — `createNextCombinationItem` with every non-`_` key emptied — so nothing is pre-selected (LeafFilter Profile no longer opens on `Versa`). Create-flow "Add Combination" still seeds `defaultValue`s. ⚠️ A required field the rep skips is now caught by normal validation rather than defaulted.

⚠️ **The blank item alone was not enough — `DropdownField` re-seeds.** Its layout effect (`resolveDropdownSync`) writes `defaultValue`/`fallbackValue` into an EMPTY dropdown, so the profile snapped back to `Versa`. The `renderField` dropdown case now passes `defaultValue`/`fallbackValue` as `undefined` when the combination carries `_addedInEdit` (`noSeed`), so a combination added in My Deals shows "Select an option" on every dropdown until the rep picks. Saved combinations keep seeding as before.

### Follow-up — Gutter Opening Width "Important Notice" did not pop up (My Deals)

The notice wiring in `DropdownField` is intact (`useFieldNotice` → `handleValueChange` on the rep's pick), so the likely miss was the
**exact-string** trigger: `resolveFieldNotice` compared the picked option to `notice.triggerValue` with `===`, and a differently
spaced / cased / quoted authoring (`<2.5"` vs `< 2.5″`) never fired. `valueMatchesTrigger` (`notice-utils.ts`) now compares
case-, whitespace- and quote/`&lt;`-insensitively. ⚠️ **Not reproduced on device.** A dev-only log `[FieldNotice] enabled but not fired`
(`FieldNoticeModal.tsx`) prints the picked value and `triggerValue` when a field has a notice that did not match — if the popup is still
missing, read that line (config text mismatch vs. a remount of the field).

### Follow-up — the notice is now presented by ONE host, not a Modal inside each field

Still reported (iPhone) after the trigger-text fix: the `<2.5` "Important Notice" never appeared in My Deals. Cause not proven on device;
the remaining suspects were the field's own card re-mounting (a combination added / renumbered) which destroys a Modal owned by the field, and
iOS failing to present a Modal nested in a scrolling card. `FieldNoticeModal.tsx` now has **`FieldNoticeHost`**, mounted once at the top of
`DynamicTabRenderer`; `useFieldNotice().handleValueChange` publishes to it (module-level listener; the last mounted host wins) and falls back
to the old local modal only when no host is mounted. ⚠️ Keep `<FieldNoticeHost />` at the renderer root — a fixed position outside any
scroll content is the point. If the popup STILL does not show, the dev log `[FieldNotice] enabled but not fired` separates a config
mismatch from a presentation problem.

⚠️ **Second pass (still no popup on a freshly added combination):** the open notice is now ALSO held at module level (`activeNotice`
in `FieldNoticeModal.tsx`) until the rep dismisses it, and a newly mounted `FieldNoticeHost` starts open if one is pending — so a tab
re-mount right after the pick can no longer swallow it. Dev log `[FieldNotice] pick { field, picked, fires, hasHost }` prints on EVERY
pick of a notice-enabled field: no line = the pick never reached the notice code; `fires:false` = trigger text mismatch; `hasHost:false`
= host not mounted. Web's `notice-utils.js` is identical to mobile's (exact `===` there), so the config is the shared contract.

### Follow-up — the notice no longer depends on the tap reaching the widget (`useFieldNoticeWatcher`)

Ticket: *the information popup must display at any cost when `<2.5` is picked.* Two earlier passes hardened the PRESENTATION; this one removes the
dependency on the TRIGGER path. `hooks/useFieldNoticeWatcher.ts` (called at the top of `DynamicTabRenderer`, above the summary early-return) snapshots
every notice-enabled field's value in job state — combination rows, simple sections and tab fields — and when a value **changes** to one
`resolveFieldNotice` matches, it publishes through `publishFieldNotice` (`FieldNoticeModal.tsx`). The widget's own `onChange` path stays and both land in the
same host; `publishFieldNotice` **de-duplicates identical text for 1.5 s**, so a pick shows ONE popup.
- ⚠️ The **first snapshot never fires** (opening a saved deal on `<2.5` stays silent), and a section whose combination count changed between snapshots only
  refreshes the baseline (add / remove shifts indexes) — otherwise deleting a combination could pop a notice for the one that slid into its slot.
- ⚠️ It still needs `field.notice.enabled` + text + a matching `triggerValue` (case / space / quote-insensitive). If the popup is STILL missing, the config
  has no notice on that field (check the portal) — the code paths no longer are the limit. Not verified on device; no jest test (the hook imports RN).

### Follow-up — the `< 2.5` notice is now a BUILT-IN rule (root cause: the schema field carried no notice)

Three passes on triggering/presenting did nothing because the likely cause was never the code path: web's static LeafFilter section **hard-codes** this popup
(`leaffilter-section.js`: `gutterOpeningWidth === '< 2.5'` → "Important Notice / Ensure Agreement has Special Can't Guarantee Cleaning or Sealing
Clause", originally only for Versa Max + Sale), while the dynamic builder shows a notice ONLY when the portal-authored `field.notice` is enabled with text.
A field without it shows nothing — however the pick is wired.
- **`utils/dynamic-job-builder/engine/notice-utils.ts`**: `resolveBuiltinFieldNotice` / `resolveAnyFieldNotice` — a field whose label matches
  `gutter opening width` set to `< 2.5` (case/space/quote-insensitive) yields the notice; the field's own `notice` still wins.
  `useFieldNotice` and `useFieldNoticeWatcher` both call `resolveAnyFieldNotice`, and the watcher now also watches Gutter-Opening-Width fields that have no notice.
- ⚠️ **Deliberately looser than web**: no Versa Max / Sale gate (the ticket: show it whenever `< 2.5` is picked). Re-add the profile / demo checks in
  `resolveBuiltinFieldNotice` if reps complain of it on Versa. A label other than "Gutter Opening Width" needs `field.notice` authored in the portal.
- Test: `__tests__/field-notice.test.ts` (gitignored dir). Not verified on device.

## Cancel Job: the payload logged is the ENVELOPE, not the `lead` passed in

Debug logging added to `LeadService.cancelLead` while chasing a cancel issue.

⚠️ **Logged inside `cancelLead`, where the body is built — not at the `handleCancelJob` call site.**
The screen calls `cancelLead(leadId, lead)` and passes the whole lead, so logging the argument looks
right and is wrong: cancel is **not** a delete or an archive, it POSTs the job-builder endpoint
(`lead/v1/{leadId}/job-builder`) with a **fixed envelope** — eleven named `leadData` fields plus
`result: 'cancelled'` and an empty `jobState`. Logging `lead` would print dozens of fields that are
never sent and omit the defaulting (`?? ''` / `?? null`) that decides what actually goes.

⚠️ **Routed through `sanitizeForLog`, never raw.** A lead loaded from the sales portal can carry
base64 documents, and with DevTools attached every logged string crosses the CDP websocket — that
was most of an 18 s upload once already.

The arrow function gained a block body (`=> { … return api.post(…) }`) to hold the log. ⚠️ The
`return` is load-bearing: dropping it makes `cancelLead` resolve `undefined`, and
`handleCancelJob`'s `await` would succeed instantly on a request that never happened — a cancel that
flashes success, logs the timeline event and navigates back while the server was never told.

Remove the `console.log` before release; the comments above it should go with it.

## Ticket — the edit wizard opens offline (My Deals offline, Phase 1)

`DynamicDealEditScreen.tsx`. The rep is at a job they already sold, the customer asks for gutters
too, and they open My Deals to raise an addendum — at a door, often with no signal.

Plan, phases and the open questions: [`docs/MY-DEALS-OFFLINE-PLAN.md`](../MY-DEALS-OFFLINE-PLAN.md).
The snapshot rules live in [`offline.md`](offline.md); the approver warming in
[`deal-center.md`](deal-center.md).

**What changed in this screen**

- Reads the `deal-edit:<leadId>` snapshot **once into a ref**, not per render.
- Each of the three queries returns the snapshot's value when `usingCache`.
- A new refusal state renders **above** `if (isLoading)` when there is no snapshot.
- One `useEffect` writes the snapshot after a successful **online** open.

⚠️ **Only THREE writes exist in this 3000-line file** — `submitJobBuilderDraft` (~1335),
`requestRefund` (~1348) and `sendDraftSubmitEmail` (~1376) — plus `cancelLead` (~1238). Phase 1
touches none of them; it is read-path only. Do not assume the file's size implies a wide network
surface.

⚠️ **`sendDraftSubmitEmail` is a misleading name.** It is
`PATCH lead/v1/job-builder-draft/{draftId}/submit` (`services/api/leads.ts:323`) — the call that
**releases the addendum to the homeowner**, not a mail helper.

⚠️ **Its `if (draftId && !refundRaised)` guard at ~1373 is LOAD-BEARING, and correct today.** A
refund addendum must not be released by the client; the approver releases it server-side. The
refund machine refuses `pendingApproval → customerSigned` with a bare `return`, so if the customer
signs before the approver decides, **the signature is silently dropped and can never be asked for
again**. Do not "tidy" this condition, and do not let a future queue step call that endpoint for a
refund addendum. (A backend note flagged this call as unconditional at line 1964 — that is not
correct for this branch: 1964 is unrelated JSX and there is exactly one call site.)

⚠️ **`portalRecord` is the RAW axios response** — the screen reads `portalRecord?.portalJobBuilder`
off it at ~380. The snapshot stores it raw for that reason; unwrapping it would silently change
the shape the wizard seeds from.

⚠️ **This file is LF**, while `DynamicDealCenter/utils/dynamic-deal-diff.ts` and
`dynamic-job-builder/agreement/SummaryFinalizeCards.tsx` in the same flow are **CRLF**. Check per
file with `file`; an earlier plan draft asserted this screen was CRLF and was wrong.

### Follow-up — Submit queues the addendum offline (My Deals offline, Phase 2)

`handleSubmit` gained an `if (!isOnline())` branch ahead of
`LeadService.submitJobBuilderDraft(...)`. The payload is already built entirely from local state,
so it queues as-is.

```
offline → addendumOfflineBlock({ hasRefund, newDocumentCount })
        → blocked?  flash and return
        → else      ensureOfflineWorkForLead → saveOfflineAddendum → goBack
```

⚠️ **The gate is checked AFTER the payload is built, on purpose.** `agreementsPayload` /
`orderSheetsPayload` are what tell us whether a new attachment is present, and they only exist
once `collectInlineDocs` has run. Moving the check earlier would need that logic duplicated.

⚠️ **`hasRefund` is `!!activeRefund`**, the same value the online path feeds to
`addendumReleasePlan`. Keep the two reading the same source — if they ever diverge, an addendum
queued as "no refund" would be released to the homeowner by the device.

⚠️ **The queued contact is the FORMATTED phone** (`toE164USPhone`), matching what the online
release sends. The submit payload stays E.164 — see the earlier ticket in this file.

⚠️ **`navigation.goBack()` after queueing**, because the rep has finished. Staying on the wizard
would invite a second submit, and the draft step is `guarded` precisely because a repeat files a
second addendum.

⚠️ **The online path is untouched.** Everything above sits behind `!isOnline()`; the
draft → refund → release chain and its `!refundRaised` guard are exactly as they were.

Queue mechanics: [`offline.md`](offline.md). Entry point: [`lead-center.md`](lead-center.md).
Phases and what is still blocked: [`docs/MY-DEALS-OFFLINE-PLAN.md`](../MY-DEALS-OFFLINE-PLAN.md).

### Follow-up — Confirm on Job Price no longer dead-ends offline (Phase 3)

Reported with a device screenshot: step 2 ▸ **Confirm** flashed *"Save payments needs a
connection. Nothing was sent"* and nothing happened.

`goFunding` did `const res = await funding.savePayments(...); if (!res.ok) return;`. Offline
`useFunding.run` refuses and returns `{ ok: false }`, so Confirm stopped dead — **the rep could
never reach step 4**, which made the Phase 2 addendum queue unreachable by the price-change route.

⚠️ **This was a FOURTH write the first audit of this file missed.** The sweep grepped
`await (LeadService|FundingService)\.` and `\.(post|put|patch|delete)\(`, and this one goes
through the `funding` **hook** — invisible to all three patterns. When auditing a screen's
network writes, grep the hook surface (`funding\.`, `useFunding`) as well.

⚠️ **TWO routes reach Review, and only one was broken.** Price unchanged → **Next · Review**
(`handleNextToReview`) is purely local and always worked offline. Price changed → **Confirm**
(`goFunding`) was the blocked path. A build-only edit therefore queued end-to-end even before
this fix, which is why the gap survived a round of testing.

**Fix:** offline, `goFunding` writes the split through `saveOfflineFunding`, builds a device-held
record with `offlineFundingRecord(...)`, and advances to the funding sub-screen as online does.

⚠️ **`funding` is SHADOWED, not patched at 24 call sites.** `serverFunding` is the hook; `funding`
is a `useMemo` that overlays `record`/`payments` from the device when the offline record exists.
One shadow fixes every reader — a per-call-site fix leaves whichever reader someone adds next
rendering a blank funding screen.

⚠️ **The card option is hidden offline AND the seed no longer pre-selects it.**
`setRefundMethod(refundSourceRow?.type === 'cc' && online ? 'card' : 'check')` — without the
`online` term the rep gets a pre-selected method the picker does not show, so they can neither
see nor change it.

⚠️ **The success flash differs when a refund rides along**: the customer is NOT sent the addendum
on reconnect, the approver releases it. Saying "sent to the customer automatically" there would
be a lie the rep repeats to the homeowner.

Queue mechanics: [`offline.md`](offline.md). Steps: [`deal-center.md`](deal-center.md).
