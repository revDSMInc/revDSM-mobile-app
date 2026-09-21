# Dynamic Deal Center — calculator, rollout, result & Job Builder

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/DynamicDealCenter/**` (create flow), `src/utils/dynamic-job-builder/**`, `widgets/components/dynamic-job-builder/**`, `widgets/modals/job-builder/**`, `utils/drop-prices.ts`, `utils/activity-log/rollout-summary.ts`.
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## The first calculator IS the customer — stored title, tab label and activity logs

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

⚠️ G ⚠️` collision paths
unchanged. tsc 44 (baseline unchanged); all three touched files byte-identical to their HEAD eslint
baselines (`tab-naming.ts` and `useDynamicCalculators.ts` clean, `CalculatorView.tsx` 118 problems /
3 errors / 115 warnings).

## Rehash with no job scope opens the entry form, not a locked $0 receipt

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

## Rehash "Use Existing" restored nothing after a config rename

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

Tests: `__tests__/utils/dynamic-job-state-storage-restore.test.ts`.

⚠️ **This fixes the rename case only.** If a rep's build is still blank, compare the vertical/tab keys
inside `dynamicJobState` against `GET /company/v1/job-builder-products` — if they match exactly, the
cause is elsewhere.

## A full-package calculator tab shows a package icon + ⓘ, not `G+VMax+S+FWrap`

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

### …and the STORED title carries the box too

Follow-up: *"i want you to add this emoji with the payload of calculatore title when full package
includes"*, with a devtools capture of `PUT /lfcalculators/{id}` reading
`title: "G+VMax+Versa+S+FWrap+FBoard+FAluminum"` while the tab above it showed the package badge.

Everything above is a RENDERING swap — the surfaces replace the derived name with the icon, and the
name itself never changed. The portal has no such rendering and only ever sees the string, so a
package was indistinguishable there from a long product list. **New `FULL_PACKAGE_TITLE_PREFIX`
(`'📦 '`)**, applied in `computeDerivedTitles`.

- **Named at the SOURCE, so nothing can drift.** `resolveSafeTitle` (the PUT payload) and `retitle`
  (the in-memory `tab.title`, which the `calculator viewed` log sends as `calculatorTitle`) both read
  that one function — the same reasoning as the customer-name ticket above, where naming the calculator
  at the source fixed the portal without touching either log.
- **The derived name survives behind the prefix** (`📦 G+VMax+S+FWrap+FBoard`), rather than being
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

Tests: `__tests__/screens/DynamicDealCenter/full-package-title.test.ts`.

Tests: `__tests__/screens/DynamicDealCenter/full-package-tab.test.ts`.

Tests: `__tests__/screens/DynamicDealCenter/rehash-draft-calculators.test.ts`.

## An Extras colour showed "Black" beside a Ground Spout of 0

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

Tests: `__tests__/utils/locked-color-defaults.test.ts`.

### …and in the deal-edit wizard the colour is CLEARED, not just hidden

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

#### …and the second reason it didn't fire: `dealCenterData` still reports the SOLD quantity

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

## The Complete-Job payload now matches the backend's contract exactly

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

### What was wrong

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

### The two judgement calls (answered by the reporter, not inferred)

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

### Deliberately NOT changed

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

Tests: `__tests__/screens/DynamicDealCenter/job-submit-payload.test.ts`.

⚠️ **Needs a device confirmation of the response**, since this is the first submit to carry a real
calculator document — watch for a validation error naming `lfCalculator`.

## Architecture overview

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

## "Complete Job" took ~10 s — five SEQUENTIAL round trips, two carrying the same multi-MB docs

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

## ✅ ROOT CAUSE: mobile's drop-price payload was a SUBSET of the server's array

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

### Fix 1 — adopt the `_id` the server assigns

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

### Fix 2 — ⚠️ STOP COLLAPSING THE LIST. This is the half that made it "still same"

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

⚠️ Needs a device check of the one thing tests cannot see: **whether the PUT response echoes
`dropPrice`.** Watch for one `PUT /lfcalculators/{id}` per drop action, at most one
`GET /lfcalculators/{id}` after the first, and a payload whose `dropPrice` is the server's array
plus the new round.

### …and the follow-up that closed it: no save on OPEN, and a payload of only `dropPrice`

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

⚠️ On device this should now read as **exactly one `PUT /lfcalculators/{id}` per Decline/Secure,
none on opening the sheet**, with a body of `{"dropPrice":[…]}`.

⚠️ **All three files are CRLF** (`drop-prices.ts`, `useDynamicCalculators.ts`, `RolloutView.tsx`).
Use `newline=''` on both ends — same trap as `dynamic-deal-diff.ts` and `EditCustomerModal.tsx`.

## Ticket 409 — a resulted lead locks every rollout tab, and the resulted one offers Reset Job Builder

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

⚠️ Needs a device check (this repo cannot render-test): result a lead from one tab, reopen the deal
center, confirm every tab's two buttons are greyed, the resulted tab shows the red Reset, and that
resetting re-enables Result Lead everywhere.

## ✅ ROOT CAUSE: the TNT board showed the wrong calculator as sold — the fix had been MERGE-REVERTED

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

### …and the `rollout_and_drop_summary` log the board reads was wrong on three counts

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

Tests: `__tests__/screens/DynamicDealCenter/tnt-sold-calculator.test.ts`.

⚠️ Needs a device check of the board itself: sell the DECLINED calculator on a lead that also has an
accepted drop elsewhere, then confirm one `PUT /lfcalculators/{B}` with `{"dropPrice":[…]}` carrying
exactly one `accepted` row, and that the submit's `rollout_and_drop_summary` names calculator B with
`resultStatus: "Sale"` and the real `noOfRollouts`.

## A drop price EQUAL to the rollout price is rejected

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

## Signing an agreement says the customer got a copy

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

## The draft autosave could persist a state SNAPSHOT, losing the agreement

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

### ✅ ROOT CAUSE: on a NEW lead the draft restore never LATCHED, so a later refetch overwrote the signature

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

⚠️ Still wants a device check. Repro: create a lead, reach Summary, **Schedule Appointment → Generate
Dynamic Agreement**, sign, then watch the next `PUT …/outcome/{calcId}` and confirm
`jobBuilder.dynamicJobState.agreements` is present alongside `scheduleTime`.

## Job-builder logs diffed against WEB, payload key by payload key

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

### `configId` was silently `null` on EVERY log

`normalizeLightweight` (`useDynamicCalculatorSchemas`) moves the id onto **`id` and DELETES `_id`**,
so `initialConfig?.configId || initialConfig?._id` could never resolve. Web passes `config?.id`.
⚠️ The submit-payload call site in the same file already read `.id` — only the logging one had drifted,
which is why nothing else looked broken.

### The step number came from the wrong index space, and the file already warned about it

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

### `jobBuilderId` was the lead's mongo id, twice

Web's `jobId` is the **human lead/job number** (`currentLead?.leadId || currentLead?.jobNumber || …`),
and a lead with none stores the literal `'N/A'` — which is what its capture shows. Mobile passed
`jobId: leadId`, so `jobBuilderId` and `leadId` were the same mongo id on every row and the job number
appeared nowhere. Now `lead?.leadId || lead?.jobNumber || leadId`.

### The colour-label rule was a one-liner where web has a whole pass

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

⚠️ Both files are CRLF.

⚠️ **Not changed: `DynamicDealEditScreen` still sends `direction: 'forward' | 'back'`.** That is the
`my_deal` module's own log family, not job_builder, and it was outside this comparison — check it
against web's `use-deal-edit-activity-log.js` before assuming it matches.

## The Summary tab logs the scheduler OPENING, and every document add / remove

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

### ⚠️ `appointment_scheduled` fires on **Yes**, not on "Generate Dynamic Agreement"

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

### …and the three controls that OPEN a document sheet

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

⚠️ That file is **CRLF** — `newline=''`
on both ends.
## The Result Lead sheet shows the funding server's refusal — in front of the sheet, and it stays

Ticket: *"on the funding side we are getting the error from the backend and the error is hitting, but
the error displays below the sheet."* Confirm with a $600 down payment on an $1100 contract →
`PUT /lead/v1/:id/funding` `422 "Down payments total $600, above the 50% maximum ($550)"`. The call,
the classification (`KIND_BY_STATUS[422] → 'rule'`) and the `FlashMessage.warning` were all correct;
the banner was simply drawn behind the sheet, because `ResultJobModal` is a native `Modal` and the
app's only `<FlashMessage />` is in `App.tsx`. Full mechanism and the trap list in
[`app-wide.md`](app-wide.md) — "A flash raised from inside a `Modal` rendered BEHIND it".

Two changes here:

1. **`<ModalFlashHost active={visible} />` is the last child of the sheet's `KeyboardAvoidingView`.**
   Every banner the sheet raises now lands inside it — its own (`'Not ready to confirm'`) *and* the
   ones `useFunding` raises from inside an endpoint call, which know nothing about which sheet is up.
   This covers the Funding screen too (card declined, link not sent, setup required): same Modal.
2. **`saveError` — the server's sentence, kept above Confirm.** A `422` is a RULE the rep has to act
   on, and a four-second banner is not where that belongs. `goFunding` writes `res.error?.message`
   into state on a refused save and renders it in `FUND.RED_BG` directly above the `BlockerList`, so
   the server's reason sits in the same column as the local ones.

⚠️ **`saveError` is cleared by an effect keyed on `rows` / `contractPrice` / `payMode`, not inside each
setter.** Every field on the pricing panel writes through one of those three; a per-setter clear is a
list the next field added to the panel would quietly fall off, leaving a stale refusal above a deal it
no longer describes. It is also reset in the sheet-open effect.

⚠️ **The flash and the inline line are BOTH wanted — this is not a duplicate.** The banner is the
"something just happened"; the inline copy is what the rep reads while fixing the split. Do not drop
one for the other.

⚠️ **The client still does NOT enforce the ceiling, and must not start.** `FundingService`
`getDownPaymentLimit` (`GET /company/v1/down-payment-limit/sales`) exists and has **no consumer** —
deliberately advisory, for showing the ceiling beside the input. The server is the enforcer; a
client-side cap that disagreed with it would either block a legal down payment or promise an illegal
one. Surfacing the limit in the UI is unbuilt, not forgotten.
