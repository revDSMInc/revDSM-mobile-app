# Dynamic Deal Center — calculator, rollout, result & Job Builder

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/DynamicDealCenter/**` (create flow), `src/utils/dynamic-job-builder/**`, `widgets/components/dynamic-job-builder/**`, `widgets/modals/job-builder/**`, `utils/drop-prices.ts`, `utils/activity-log/rollout-summary.ts`, `hooks/useOutcomeLogging.ts`, `utils/activity-log/job-builder-auto-log.ts`, `services/api/leads.ts` (`jobBuilder`/`updateJobBuilder` endpoint).
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

## Pre-Order Discount tiles stay live after Confirm Rollouts

Ticket: *"when the price is locked after confirm rollout inside the Deal Center, the 15%, 20% and 25%
are currently locked — we should unlock these values even after the rollout price is confirmed."*

`PremiumQuoteCard` (`RolloutView.tsx`) disabled the tiles and faded the unchosen ones on
`isLocked = !!calculator.isRolloutConfirmed`, reasoning that a confirmed rollout is a receipt and a tile
tap would "re-price" it. The Default toggle beside them was disabled the same way.

**Mobile was stricter than web.** Web's `QuoteResultCard` discount group is `disabled={isDisabled}`, and
`ViewAllCalculators.js` passes `isDisabled = isAnyJobSubmitted && (isRolloutConfirmed ||
hasJobBuilderSubmitted(id))` — a **submitted job**, not a confirmed rollout. Web's Default checkbox is
only `disabled={!currentDiscount}`. The screenshot's state (every rollout confirmed, "Jobs Built — Back
to Tools" showing, no job submitted) is one where web lets the rep change the discount.

Both controls now drop the `isLocked` gate and the fade. Nothing else changed:

- **What a tile moves:** MSRP and the 1-Year Program totals, via `computeRolloutResult`. It does **not**
  move the confirmed end price — the In-Home grand total stays the locked figure.
- **How it saves:** `handleSetDiscount` → `markDirty` → the debounced PUT, with no confirmed-tab guard.
  That is the same path the down payment already uses after lock, and the hook's **unmount flush** saves
  a tile tapped just before "Jobs Built — Back to Tools".
- **Downstream:** the Investment Center reads the saved `calculator.discountPercentage` live
  (`InvestmentPanel.tsx`), and the Complete-Job payload picks it up in `job-submit-payload.ts`.
- **Still locked after a job is submitted:** the card-wide `pointerEvents={jobLock.isAnySubmitted ?
  'none' : 'auto'}` wrapper covers the tiles along with everything else, which is web's
  `isDisabled`.

⚠️ **`isLocked` is kept, and still gates Add Renders** (`RevRenderSlots locked={isLocked}`). The ticket
named only the discount values, so do not read this as "a confirmed rollout locks nothing".

⚠️ **Do not re-lock the tiles on `isRolloutConfirmed`.** That reinstates the stricter-than-web rule this
ticket removed. The comment on `isLocked` records why.

⚠️ `RolloutView.tsx` is **CRLF** (already in the root guide's list). No unit test: the change is
interaction gating inside a React Native component, and no pricing rule moved.

**Needs a device check:**
- On a confirmed rollout, open the chevron, tap 20% and then 25%. MSRP and the 1-Year totals should
  follow while the end price and the In-Home grand total stay put.
- The Default toggle sets and clears.
- Leave through "Jobs Built — Back to Tools" and reopen. The new % should persist and appear in the
  Investment Center.
- After Result / a submitted job, the tiles no longer respond.

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

## A `bank` (financing) row can never leave "Link Sent" — the client-side bypass

Ticket: card and check "work perfectly", but picking a financing plan (GreenSky, Wells Fargo — any
plan `methodTypeOf` resolves to `type: 'bank'`) got the rep stuck on the Funding screen: the lender
integration behind `sync`/decision isn't live yet, so no decision ever arrives, `activated` never
ticks, and — because `fundingBlockers` mirrors the server's own submit rule — **Submit Funding**
(`ResultJobModal`) stays disabled forever on a step nobody can complete. Root cause is the missing
backend/lender integration, not a client bug; the ask was a temporary, obviously-removable frontend
workaround, not a fix to the real flow.

- **`FINANCING_BYPASS_ENABLED` / `isFinancingBypassed(payment)`** (`utils/funding.ts`, beside
  `MULTI_METHOD_ENABLED`) — the one flag. `true` for every `p.type === 'bank'` row while it's on.
- **`fundingBlockers`**: a bypassed row contributes **no** blocker — inserted as its own arm, but
  *after* the declined / open-short / application-closed checks, so a REAL signal (a decision did
  come back some other way) still reports exactly as before. Only "never progressed" is swallowed.
- **`PaymentFundingCard`**: a bypassed row renders `FinancingBypassNotice` (`Financed through {plan}` +
  "Approval and funding for this amount are confirmed directly between the lender and the customer.")
  **instead of** `FundingStepper` and every rep-action button/sync row — not layered on top of them.
  The message is deliberately about *how the payment is being made*, never about a missing feature —
  and deliberately does NOT say "nothing to do here"/"not needed", which reads as dismissive rather
  than as a statement of who owns the next steps.
- ⚠️ **Does NOT touch `coverageOK` / `fundedAmount` / `stateOf` / `FLOW` / the pricing-screen chip
  (`PaymentRowsGroup`, `lenderState`)** — a bypassed row still pledges its full amount toward the
  contract total exactly as before, and still reads "Pending lender decision" on the pricing screen.
  Only the Funding-screen rail and the submit gate change.
- ⚠️ **Does not, and cannot, change what the real `POST …/funding/submit` call does.** Removing the
  CLIENT pre-check only lets the rep tap Submit; `funding.submit()` (`useFunding.ts`) is untouched, and
  `handleBuild` still only proceeds past the sheet on `res.ok` (spec rule 3 — the server owns every
  step). If the backend also refuses an unresolved financing row, `funding.serverBlockers` still
  overrides the local list exactly as it already did before this ticket — this only removes an
  over-eager CLIENT wall in front of a tap the rep should get to try.
- **My Deals** (`DynamicDealEditScreen`) needed no separate change — it renders the same
  `FundingView`/`PaymentFundingCard` and calls the same `fundingBlockers`, and its own "Next · Review"
  was already non-blocking on funding completion (see the comment at its footer: *"Submitting an
  addendum has never required funding to be complete"*). Confirms the "no second implementation" rule
  this file's STEP 2 comment already states.

⚠️ **This is the one thing to revert once real lender decisions start arriving** — search
`FINANCING_BYPASS_ENABLED` / `isFinancingBypassed`. Flip the flag (or delete it and the two branches
above) and the original stepper, actions and blockers come back exactly as they were; nothing they
guard was rewritten, only skipped.

## Ticket 1063 — dropdowns become dependent fields (option rules, defaults, `disabled`)

Portal `feature/ticket-1063` (`40f31a96`, 2026-08-11) turned the `dropdown` field type from a plain
static list into a first-class dependent field. The portal is only the **authoring** side, so every one
of the five capabilities is a Sales-app behaviour. The keys ride the existing job-builder schema JSON —
**no backend or API change**; mobile only consumes them. Both entry points inherit this, because both
render through `DynamicTabRenderer`: the **lead-creation → Deal Center → Job Builder** flow
(`DynamicDealCenterScreen` → `DynamicJobBuilderScreen`) and the **My Deals edit wizard**
(`DynamicDealEditScreen`, which embeds the same builder with `mode="edit"`).

### ⚠️ The previous "port" was documented but never landed

`deal-edit-addendums.md` § *"Also ported en route: web `ticket-1063`"* claimed this work was **"now in"**
six engine files. It was not — the paragraph entered the repo in `4b9ffa9 "update the Claude md file"`
(2026-09-15) with no code beside it; no branch, local or remote, had `getVisibleFieldOptions` in `src/`.
That block is now corrected to point here. **Treat a doc claim with no code behind it as a spec, not a
record** — this one would have sent the next reader straight back into the bug.

### `toggle-utils.ts` — the fix everything else hangs off

`filterVisibleToggleOptions`'s **2nd parameter changed from `dealCenterData` to the full rule context**.
An `optionVisibility` entry is an ordinary rule group: given only `{dealCenterData, state}` it cannot
resolve a field by KEY, reach another section, or read an allocation metric, so every such reference
evaluated `undefined` → read as "rule not met" → **the option silently disappeared**.

- New `getVisibleFieldOptions(field, ctx, state, applyConditions)` is the real implementation;
  `filterVisibleToggleOptions` is kept as an alias so toggle/optionList call sites read the same.
- New `getBaseFieldOptions(field)` reads `optionShowFields` **KEYS** for a dropdown (`field.options` is
  stale for a dependency-mode field). It covers `select` too — the renderer runs both through one
  `case 'dropdown': case 'select':` branch, and gating on `'dropdown'` alone would have quietly dropped
  `optionShowFields` support for a `select`.

⚠️ **Any new caller MUST pass the rule context, never `dealCenterData`.** It still type-checks (`any`)
and still "works" for same-section rules, which is exactly how the bug stayed invisible. The three
renderer call sites (`text`-with-options, `toggle`, `optionList`) and `tab-validation.ts:200` now pass
`depCtx`.

### `dependency-engine.ts`

- `buildRuleEvaluationContext` is **exported** — option rules must share the exact context field-level
  rules use.
- `isDefaultColorActive` reads the opt-in through the new shared
  `isDefaultValueOptedIn` (`dropdown-utils.ts`): `useDefaultColor ?? useDefaultValue ??
  Boolean(defaultValue)`. Pre-flag configs behave exactly as before; `useDefaultValue: false` now stops a
  leftover `defaultValue` being applied.
- New `resolveEffectiveDefaultValue(field, state, ctx)` — "what is the effective default", returning `''`
  for all three no-default cases. Distinct from `resolveConditionalDefault`, which returns `undefined`
  when there is no `defaultWhen` at all; **do not merge them**, the storage layer depends on that
  `undefined` to leave unconditioned defaults alone.
- `validateDependencies` validates `optionVisibility` for `dropdown` alongside toggle/optionList.

### The default is written into STATE, not just displayed

This is the load-bearing half, and the reason a render-only default is not enough: other fields'
`optionVisibility` rules read `state[field.id]`, so a defaulted dropdown that is only render-resolved is
**invisible to them and rules their options out** — the field looks answered while everything downstream
behaves as if it were blank.

Three layers, each gated differently on purpose:

| Layer | File | Gate |
|---|---|---|
| Seed at build | `combination-utils.ts` `buildDefaultItemFromFields` | `dropdown` joins `text`; **condition-blind** (this file must not import the dependency engine) but honours `isDefaultValueOptedIn`, which is a flag read, not a rule |
| Gate at hydrate | `dynamic-job-state-storage.ts` `hydrateFieldValue` | `resolveConditionalDefault` now runs on the **non-locked** branch too, before falling back to `buildDefaultItemFromFields` |
| Seed/clear at render | `DropdownField.tsx` → `dropdown-state-sync.ts` | full `depCtx`, via `resolveEffectiveDefaultValue` |

⚠️ The hydrate gate is the one that is easy to miss: without it a dropdown carrying `defaultValue` +
`defaultWhen` gets its **raw** default persisted even when the condition is not met — the same
phantom-value class already fixed for locked LeafFilter colours, just reached through the other branch.

⚠️ `comboHasEnteredData` drops a combo carrying only LOCKED/`defaultValue` values, so a newly seeded
dropdown default on an untouched combo is pruned rather than saved as a phantom combo. **Keep that.**

### `DropdownField.tsx` + `dropdown-state-sync.ts` (new)

Mobile renders a "dropdown" as the same chip grid as `optionList`, so this is the dropdown twin of
`OptionToggleField` — and it exists for the same reason that component does: `renderField` is a plain
function, so a hook cannot live there. It owns hide-when-empty, the state seed and the stale-value clear.
The **decision** is a pure function in `dropdown-state-sync.ts` so it can be unit tested (a component
cannot be loaded under jest here); the component only commits it.

⚠️ **Zero visible options writes NOTHING** — no clear. This reads like a divergence from the spec's
`if (currentValue && !opts.includes(currentValue)) onChange('')` but is the same behaviour: sales returns
`null` from the renderer *before* mounting the component, so its effect never runs with an empty list
either. Mobile keeps the guard inside the component so hook order stays stable. It matters because the
rule context settles across several renders here (`dealCenterData` and the saved draft both arrive async
— see the draft-restore notes in `useDynamicJobBuilderSession`): a momentarily-empty option list is not
proof the stored answer is stale, and clearing on it would destroy a saved selection the next render
offers again. `OptionToggleField` takes the same early return.

⚠️ The seed writes through the normal field-change path, which latches `userEditedRef` in
`useDynamicJobBuilderSession`. That is safe because `resolveDropdownSync` is **idempotent** — it returns
`{write: false}` once the value is present — and because the draft restore is keyed on `draftToken`, not
on that latch. Do not add a seed that can re-fire.

### `field.disabled` — "Rep can use this dropdown → No"

`OptionList` / `DynamicOptionField` take a `disabled` prop: chips grey (`#94A3B8`, precedent
`CalculatorView.tsx` `FieldRow`), the **current value stays visibly selected** so the rep can still read
what was chosen for them, and `handlePress` is a complete no-op — including the deselect-on-tap, which
would otherwise let the rep clear a value they are not allowed to set.

⚠️ **The deal-edit wizard UNLOCKS it**: `Boolean(field.disabled) && !editMode`, the same rule the
`colorSelection` lock already uses. Per the portal's own helper text.

### `tab-validation.ts`

⚠️ **The dropdown exemptions live in `isFieldValueComplete`, NOT in `isEmptyRequiredValue`.** An earlier
draft of the spec put them in the latter; that is wrong, and `isEmptyRequiredValue`'s `case 'dropdown'`
stays the bare `!value` it always was. The three exemptions join the **existing** all-options-ruled-out
guard, which also has its 2nd argument swapped from `dealCenterData` to `depCtx`:

1. no visible options → not the blocker (the field renders nothing);
2. `field.disabled` → the rep cannot answer it;
3. an active default **that is among the visible options**.

⚠️ Condition 3's visibility check is not optional. A default whose option is currently ruled out is **not
an answer** — the renderer will not show it and `resolveDropdownSync` will not seed it — so counting it
would enable Next over a field that reads blank.

### ⚠️ `resolveConditionalDefault` at hydrate, never `resolveEffectiveDefaultValue`

The two are **not** interchangeable and the difference is a real regression, not a style point.
`resolveEffectiveDefaultValue` always returns a string, so using it in `hydrateFieldValue` would hand
`''` to **every** field — including `roomPicker` (needs `[]`), `locationGrid` (needs `null`) and every
type whose default comes from `buildDefaultItemFromFields`. `resolveConditionalDefault` returns
`undefined` unless the field actually carries a `dependencies.defaultWhen`, so it intervenes only where
it should and leaves every other field byte-identical. Covered by the acceptance #14 regression test.

### `sections` on both dependency contexts (spec §3.1)

Added to the renderer's `depCtx` and validation's `buildDepCtx` so the two cannot disagree about which
options exist — if they did, the field would render fine while Next stayed disabled.

⚠️ **Belt-and-braces only — this was never the bug, and the spec now agrees.** An earlier revision called
a missing `sections` the single most likely cause of a vanishing field. Probed here against the live
LeafFilter shape with `sections` absent, present, and with a `tab`-less ctx: **all three returned the
correctly narrowed list.** The backend author then retested on web and issued the same correction —
`findFieldContextOnTab` passes `sections` to `buildTabForFieldOptions`, which returns `tab` unchanged when
they are absent, and `getTabSections(tab)` derives them from the tab itself. `sections` is only an
**override**, for a caller holding an edited section list that differs from `tab.sections` (the portal
editor). Do not spend a debugging session here. It is read straight off `tab` rather than via
`getTabSections` because `depCtx` is rebuilt per field and that call normalizes every section.

### Verification

`__tests__/utils/dynamic-dropdown-ticket-1063.test.ts` — 31 tests covering the portal's 13-row
acceptance checklist through the pure rules (options by key / cross-section / dependency-mode, all-ruled-
out, stale clear, default seeded / withheld / opted out, disabled and default as answered, the
toggle/optionList regression row). Zero new tsc or eslint findings; the 11 pre-existing suite failures
(`contract-refund-summary`, `funding`, `FundingService` — modules that do not exist) are unchanged.
⚠️ `__tests__/` is gitignored, so this suite does not survive a clone.

**Needs a device check** (do both flows — the create flow and My Deals → edit):
- A dropdown gated on another field narrows as that field changes; an ungated option always shows.
- A rule pointing at another section or an allocation metric resolves (this is the half that was broken).
- Every option ruled out → the field disappears and Next is not blocked.
- Change the parent after selecting → the now-unoffered selection clears.
- `useDefaultValue` + `defaultValue` preselects AND other fields' rules react to it; with an unmet
  `defaultWhen` nothing is shown or saved; `useDefaultValue: false` applies nothing.
- `disabled` greys out and cannot be changed in the create flow, and is editable again in deal edit.

### ✅ ROOT CAUSE: an UNAUTHORED rule failed closed and took out two controls

Several device rounds chased symptoms here (a width dropdown that never appeared, then a profile
reading `Versa Max` on a combination whose real value was `Versa`). Both had one cause, confirmed by the
backend author running the reported company's config — `6984431a7bee5bd189067d36` "riley obrien llc",
LeafFilter tab, `section_1782365542087` — through the engine:

```jsonc
// LeafFilter Profile (field_1790073436781_z7sq5), optionVisibility["Versa"]
{ "source": "dealCenter", "field": "", "fields": [], "fieldId": "", "operator": "anyNonZero" }
```

**No field is selected.** `resolveSourceValue` has nothing to look up and returns `undefined`,
`anyNonZero` reads that as false, so `Versa` was hidden. That left `["Versa Max"]`, the configured
default `Versa` resolved correctly but could not be applied (not on offer), and all seven
`Gutter Opening Width` options — each gated on the profile — then failed, so the **width field vanished
entirely**. One unauthored rule removing two controls, with nothing on screen saying why.

`evaluateRule` now returns `true` for a rule that names no field of any kind
(`ruleReferencesNoField`), matching `evaluateRule(null)` / `evaluateRuleGroup(null)`.

⚠️ **Failing OPEN is deliberate.** Failing closed hides the control, and Lance's requirement on this
ticket is the opposite: the rep must always be able to pick any width the company configured, as a manual
override. Blast radius measured on web across every job-builder config in the dev database: **1 rule out
of 519** references no field — that one.

Also fixed, §2.2: `validateRuleRefs`'s guard was `rule.field && !String(rule.field).trim()`, which can
only be true for a **whitespace-only** key. For `field: ""` the first clause is falsy, so the one case it
exists to catch never reported — which is how the broken config reached production silently. Cosmetic on
mobile (nothing surfaces validator output), but the three engines stay in step.

#### ⚠️ Do NOT add a "lone visible option → select it" rule

It was tried, to make a profile dropdown showing only `Versa Max` fill itself in so the width field
depending on it would stop hiding. It **wrote `Versa Max` into combinations whose real profile was
`Versa`** — the reported symptom being a Job Builder disagreeing with the Deal Center over the same deal.
The single option was itself the bug. With the fix above the list is complete and the configured default
applies normally, so there is nothing left for an auto-select to repair. `OptionToggleField` does
auto-select for toggle/optionList, but it owns its value; a dropdown here can be answered by the
calculator, and overwriting that is data loss.

#### The `choices`/`items` fallback is gated

`const opts = (ruleOpts.length || hasAuthoredOptions ? ruleOpts : field.choices || field.items) || []`.
That fallback is for a non-standard `select` carrying **neither** `options` **nor** `optionShowFields`; it
must never fire because the *rules* said no, or a field that deliberately ruled everything out would fall
back to its full raw list. Nothing in the DB hits it today — the two cases are opposites and the gate
keeps them apart.

### ⚠️ The one place this deviates from the spec's literal text: `combination-utils.ts`

§4.3 says `(field.type === 'text' || field.type === 'dropdown') && field.defaultValue`. Mobile also
requires `isDefaultValueOptedIn(field)`. Without it, acceptance **#8** ("`useDefaultValue: false` with a
leftover `defaultValue` → no default applied") **fails**: `buildDefaultItemFromFields` would seed the raw
`defaultValue` into state, and from then on `shownValue` renders it as the selected chip because the
value is genuinely in state — the renderer's `resolveEffectiveDefaultValue` gate never gets a say. The
check is a flag read, not a rule, so the file stays condition-blind and still imports no engine. A config
authoring neither flag is unaffected (`Boolean(defaultValue)` keeps it seeding).

### ⚠️ A DISABLED dropdown renders its VALUE, not a greyed option list

Three device rounds on the LeafFilter tab converged here. Combination #2 showed two tidy boxes
("Gutter Opening Width / 7\"", "LeafFilter Profile / Versa"); Combination #1 showed a label-less strip
of greyed chips (`< 2.5 | 2.5 - 3.4 | > 7`) and no visible selection. Same data, two different-looking
cards.

Spec §2.3 is explicit and easy to skim past: *"Greyed out on Sales: **shows its value**, cannot be
opened."* On web that is automatic — a disabled `<Select>` only ever shows its selection. Mobile draws a
dropdown as a chip grid, so the literal translation ("grey the chips") wrongly leaves the whole option
list on screen. `LockedField` **is** that value box, so `DropdownField` reuses it when `disabled`, which
makes the two presentations identical rather than merely similar.

⚠️ **The box is rendered INSIDE `DropdownField`, after the hooks — never from `renderField`.** Returning
a box from the renderer instead would unmount the seed/clear effect, and that effect is what writes the
value other fields' `optionVisibility` rules read. That is precisely what left the width dropdown with
no selectable option and hid it completely.

⚠️ **It passes `field.label`, not the `label` prop.** `label` has already been through the renderer's
`showLabel` / `repeatsParentLabel` suppression, which is a rule for an inline chip grid sitting under a
heading that already names it. The locked branch has always passed `field.label` straight through, so
honouring the suppression here prints a label in one card and none in the next.

⚠️ **The box resolves in three steps and the CONFIG WINS**: `fallbackValue` → the active
`resolveEffectiveDefaultValue` default → saved job state. That order is the opposite of `shownValue`'s
and of the usual "never clobber what is stored", and it is deliberate — a `disabled` field's value was
never the rep's to set, so when the portal's answer and the saved draft disagree, the draft is simply out
of date.

It is also the fix for a precise reported symptom: **the box showed the correct new value for a moment,
then reverted.** The config resolves synchronously on mount, but the saved draft arrives later from the
outcome GET (`useDynamicJobBuilderSession` applies it once `draftToken` / `draftSettled` settle) — so
with state first in the chain, that late write visibly overwrote the fresh value about a second after the
screen opened. Any "correct, then wrong" flicker in this builder is worth checking against that draft
restore first.

`fallbackValue` is the portal-derived answer: `resolveLockedValue` reads the field's `dcField`/`dcFields`
out of the quote and falls back to the config's own `defaultValue`. Saved state stays last so a field the
config cannot answer at all still shows what the deal holds rather than going blank.

### ⚠️ Displaying the resolved value is NOT enough — it must reach job state

An intermediate version of this work resolved a disabled dropdown's value for the BOX only and
deliberately left job state alone, reasoning that a render should not re-save a submitted deal. **That
was wrong, and it is worth understanding why, because the reasoning sounds right.**

Spec §2.4 says it plainly: *"the default is written into STATE, not just displayed … because rules on
OTHER fields read state. A defaulted dropdown that is only render-resolved is invisible to
`optionVisibility`, so a rule pointing at it evaluates as empty and silently rules every option out."*

It surfaced as three unrelated-looking bug reports, all one cause — a profile box DISPLAYING `Versa`
while state held nothing:

1. **A whole field vanished.** The width dropdown's options are each gated on the profile, so every rule
   failed, `visibleOptions` came back empty and `DropdownField` returned `null`. The rep saw a
   combination with a profile and no width at all.
2. **The Job Builder Summary dropped the row**, because it reads job state. Reported as "Gutter Opening
   Width shows for Combination #2 but not #1" — the only difference being that #2 happened to hold a
   stored value.
3. The value would not have been in the submitted payload either.

`DropdownField` seeds `defaultValue || fallbackValue` — the same chain the box displays — so whatever the
rep is shown is what the rest of the engine reads. **Do not "optimise" this back to display-only.**

⚠️ **…and the renderer alone is NOT enough, which is the sharper half of this trap.** A field whose value
other fields depend on may never reach `DropdownField`: if it is also `locked`, `renderField` returns a
`LockedField` **before the type switch**, so the seeding effect never runs. And even when it does run, it
runs a render LATE — by then the dependent field's rules have already read an empty state, ruled every
option out and removed themselves from the screen.

So `hydrateFieldValue` (`dynamic-job-state-storage.ts`) resolves a `disabled` field the same way it
resolves a locked one, at STATE-BUILD time, for every combination, before anything renders. That fixes
the cascade at its source and is independent of which branch draws the field. `preserveExisting`
(deal-edit) still defers to the rep, since the field is unlocked there.

#### Debugging a dropdown that is not on screen

A dropdown that rules out every option renders nothing **by design**, which on screen is
indistinguishable from a field the config forgot — telling those two apart from screenshots cost several
rounds. The renderer now logs, under `__DEV__` only, which rule did it and what the referenced field
actually held:

```
[Dropdown] "Gutter Opening Width" hidden — 0 of 7 options visible.
  6" needs [section_…:field_…=undefined] | 7" needs [section_…:field_…=undefined] | …
```

`=undefined` on the referenced field means the cascade above, not a bad rule. Check that first.

`formatFieldSummaryValue` (`vertical-summary-utils.ts`) still carries its own `field.disabled` branch as
a belt-and-braces resolution for a deal saved before this seeding existed. It is kept SEPARATE from the
`isFieldLocked` branch above it: that one is load-bearing for deal-edit and passes the RAW
`field.defaultValue`, while this one gates on `dependencies.defaultWhen` exactly as the builder box does,
so a default is never shown past its own condition. Both defer to the rep's value in `editMode`.

⚠️ The trade-off that motivated display-only is real but smaller than it looks: `comboHasEnteredData`
drops a combination carrying only locked/`defaultValue` values, so a seeded default on an untouched
combination is pruned rather than saved as a phantom.

⚠️ **The box title comes from `boxTitleFor(field, ctx)`: `field.label → field.title → ctx.parentLabel`.**
That last step is the one that matters and is easy to miss. `containerLabel` (the stack's / accordion's
own label) is computed in the container branch and passed down as `ctx.parentLabel`, but it is ONLY ever
used to suppress a duplicate child label — **it is never rendered as a heading**. So a field authored
with no `label` of its own, sitting in a stack that carries the name — exactly the LeafFilter
"Gutter Opening Width" / "LeafFilter Profile" shape — printed a completely untitled box, with nothing
anywhere on screen saying what the value was. `field.title` is in the `Field` type but nothing else in
the engine reads it; `label` is the canonical key (53 call sites).

The same resolver is used by the locked branch's `LockedField`, so a field gets a title whichever of the
two paths renders it.

⚠️ **Boxed presentation only.** An inline chooser keeps the renderer's `visibleLabel`, whose
`showLabel` / `repeatsParentLabel` suppression exists precisely to stop it repeating a heading already on
screen. Do not route `boxTitleFor` into the chip grid or the picker.

⚠️ **In deal-edit it is a full chip grid again**, because `disabled` is gated
`Boolean(field.disabled) && !editMode` — Lance's manual-override requirement. The value box is the
create-flow presentation only.

### The editable dropdown is a REAL dropdown (`DropdownSelect.tsx`)

The ticket's title is the requirement: *"My deals — NEVER have text inputs — always should be a drop down
with all options."* Mobile drew every option field as a chip grid, so in the deal-edit wizard — where
conditions are lifted and a LeafFilter width field therefore offers all seven options at once — one
combination rendered a four-row block of chips and pushed the rest of the card off screen. `DropdownSelect`
collapses that to a single row showing the current selection, which opens the list on tap.

Applied for `dropdown` / `select` only, and only when **single-select**: a collapsed control cannot show
several selections at once, so a `multiSelect` dropdown keeps the chip grid. toggle / optionList are
untouched — they are authored as inline choosers on purpose.

⚠️ **The list expands INLINE — never a `Modal`, never an absolute overlay.** Both are traps recorded in
the root guide: the Job Builder already renders inside a native `Modal` and iOS silently drops a
presentation requested while another is dismissing (this froze the CoC paper-fallback scanner); and an
absolute overlay would lose its touches anyway, because a sibling `GestureDetector` swallows them
whatever its `zIndex` — `zIndex` orders painting only — and these fields sit inside gesture-driven,
scrollable combination cards. Expanding in flow costs a little scroll height and sidesteps both.

⚠️ **It keeps tap-to-clear**, matching the chip grid it replaces (`useCanDeselectSelection`), so a
non-required dropdown can still be unanswered.

⚠️ **It passes the renderer's `visibleLabel`, NOT `field.label || field.title`** — the opposite of the
disabled box above, and deliberately. The `showLabel` / `repeatsParentLabel` suppression exists for
inline choosers sitting under a heading that already names them (Flooring → "Existing Flooring Type"
printed its title twice before that fix). The disabled box overrides it only because it reuses
`LockedField`, whose branch has always passed `field.label` straight through. If a dropdown shows no
label in edit mode, that is the config's `showLabel: false`, not this component.

### ⚠️ Portal config edits did not reach the app — the config query was cached for 5 minutes

Reported: a value changed in the portal (a width, `Versa` → `Versa Max`) still rendered the old value in
the app. Nothing was hardcoded; the config was simply stale. Three things compounded, and only the first
is obvious:

1. `useDynamicCalculatorSchemas` used `staleTime: 5 * 60 * 1000`, so a portal edit was invisible for at
   least five minutes.
2. `refetchOnWindowFocus` is `false` globally (`services/api/queryClient.ts`), **and** nothing wired
   React Query's `focusManager` to RN's `AppState` — so on mobile that option could never have fired
   anyway. A mounted builder therefore never revalidated at all, five minutes or five hours.
3. The cache is memory-only — there is no `persistQueryClient` / storage persister anywhere — which is
   exactly why **restarting the app** was the only thing that picked changes up. That is the quickest
   way to confirm this class of bug: if a restart shows the new values, it is the query cache, not the
   payload.

Now: `staleTime: 0` + `refetchOnMount: 'always'` (stale-while-revalidate — the cached config is handed
back synchronously so the tab still paints instantly, then a background refetch re-renders it if the
config actually moved), plus `refetchOnReconnect` and `refetchOnWindowFocus: true` for this one query.
`queryClient.ts` now wires `focusManager` to `AppState`, so returning from the background revalidates
even when nothing unmounted. The hook also returns `refetch` for a manual force.

⚠️ **`refetchOnMount` was not enough on its own — mount ≠ opening the builder.** It fires when a new
query OBSERVER mounts, and `DynamicDealCenterScreen` owns the only one: `DynamicJobBuilderScreen` takes
the config as the `initialConfig` **prop** and never calls the hook. Opening the builder only flips
`flowStep`, and closing it with the ✕ flips it back, so the screen never unmounts and the config was read
exactly once per visit to Tools — a portal edit made while the rep sat there was never picked up.

Both entry points now call `refetchJobBuilderConfig()` explicitly: `openJobBuilder` (the normal path,
~line 429) and the push-notification path that sets `flowStep` directly (~line 330). **Add the same call
to any new route into the builder.** The refetch is deliberately not awaited — React Query serves the
cached config synchronously so the builder opens with no delay, then re-renders if the response differs.

The My Deals edit wizard needs none of this: `DynamicDealEditScreen` calls the hook itself, so opening it
mounts a fresh observer and `refetchOnMount: 'always'` does the job.

⚠️ **Cost is one GET per MOUNT plus one per builder open, not per render** — the Deal Center, Job Builder
and Investment Center all share the single `['jobBuilderProductsConfig']` key.

⚠️ **The `focusManager` wiring only ENABLES focus refetching**; the global default stays
`refetchOnWindowFocus: false`, so a query refetches on foreground only if it opts in. Today just this
one. Adding `refetchOnWindowFocus: true` elsewhere now has a real effect — it previously did nothing.

⚠️ **This does not refresh a SAVED DRAFT.** Config staleness and build staleness are different things:
`hydrateFieldValue` returns an existing saved value before it consults any config default
(`if (existingValue !== undefined) return existingValue`), by design. A deal already carrying a value
keeps it after a portal edit — that is not this bug.

#### Ruled out along the way — do not re-investigate

- **It is not the locked branch.** An early attempt made `renderField`'s locked branch render a chip grid
  for dropdown-typed fields. That was wrong twice over: Combination #2's `LockedField` boxes were already
  the *desired* look, and the change touched every locked dropdown app-wide. Reverted.
- **It is not spec §3.1 (`sections`).** See that section above — probed three ways, all correct without it.
- **The "Versa Max" box was never a `LockedField`** — no padlock, no *Locked from Job Summary* caption. It
  was an unselected chip at 50% width (`autoColumns` returns 2 for a one-option list). That is what put
  the lone-option auto-select above in.

**Needs a device check:** both LeafFilter combinations should now show the same labelled value boxes in
the create flow, and the same deal opened from My Deals → edit should show selectable chip grids.

### My Deals hides a combination whose colour was never picked

Full write-up: **`deal-edit-addendums.md` § "My Deals hides a LeafFilter combination whose colour was
never picked"** — it is a deal-EDIT behaviour, but the code lives here, so the traps are repeated:

- `utils/dynamic-job-builder/engine/combination-color-filter.ts` (new, pure + unit tested) —
  `isColorField`, `resolveComboColorValue`, `comboHasSelectedColor`.
- `DynamicTabRenderer.tsx` `CombinationSectionBlock` skips a combo when
  `editMode && !comboHasSelectedColor(combo, baseRowFields)`.

⚠️ **DISPLAY ONLY, and edit-mode only** — the combination stays in job state and round-trips untouched.
The CREATE flow is deliberately not filtered: that is where the rep is still picking colours, and hiding
a combination mid-entry would remove the row being worked on.

⚠️ **`return null` INSIDE `combos.map`, never a filtered array.** Every handler in that block is bound to
`comboIndex` and `handleRemoveCombo` renumbers by position, so filtering first would edit and delete the
WRONG combination.

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

⚠️ **A combination with no colour field is always shown**, and one with several needs all of them
answered. ⚠️ A colour is not identified by `type` alone — `isColorField` also matches a `text`/`locked`
field carrying `palette` / `colors` / `colorKey`, because `renderField` draws those as a SwatchPicker;
and `resolveComboColorValue` checks the `colorValues` side-map as well as id and key, which is how a
picked colour survives the save round-trip.

### The `flow` rule source — create vs My Deals (REVDSM-1063 follow-up)

A LeafFilter width dropdown has to offer only some options while the job is being **built** and all of
them while it is **amended in My Deals**. Rather than a second field, a duplicate combination or a new
field property, the backend added one new rule **source**: `flow`, beside `dealCenter` and `state`.

That choice is the whole design: `optionVisibility`, `dependencies.visibleWhen`, `requiredWhen` and
`defaultWhen` are all just rule groups that end up in `evaluateRule`, so **one source makes all four
flow-aware at once**. Additive — no new field properties, no migration, no config rewrite.

```jsonc
{ "source": "flow", "operator": "eq", "value": "edit" }   // operator: eq | neq; value: create | edit | []
```

- `dependency-engine.ts` — `FLOW_MODES`, `isFlowRule`, `evaluateFlowRule`, the branch in `evaluateRule`,
  and `editMode: Boolean(ctx.editMode ?? ctx.unrestrictedEdit)` in `buildRuleEvaluationContext` (both
  names read so the three engines stay diffable).
- `DynamicTabRenderer.tsx` `depCtx` and `tab-validation.ts` `buildDepCtx` + `isTabComplete`'s
  `validationCtx` carry `editMode`; `DynamicJobBuilderScreen`'s `validationCtx` memo supplies it as
  `isEdit` (⚠️ and lists `isEdit` in its dep array, or the memo keeps a stale flag on reuse).

⚠️⚠️ **THE FLOW BRANCH MUST SIT ABOVE `ruleReferencesNoField`.** A flow rule names no field BY DESIGN —
it asks which surface the builder is on, it does not read a value — so the unauthored-rule guard is true
for every one of them. Below the guard, each flow rule is read as "no rule", returns `true`, and the
options it exists to hide all appear at create time. **It fails silently in both directions**, so there
is a direct unit test for it (`dynamic-flow-rules.test.ts`, "the ordering trap"). The backend author hit
this same trap on web.

⚠️ **A flow rule only ever does work at CREATE time**, and that is deliberate, not a gap. The edit
wizard runs with `applyConditions: false` (`portalUnrestrictedEdit`), so the option list is returned
unfiltered before any rule is consulted. Hence *"show when flow is `edit`"* is the usable direction — it
hides the option while building, and edit shows everything anyway. *"Show only at `create`"* cannot be
enforced; do not author it or try to make it work. Web is identical
(`effectiveApplyConditions = editMode ? false : …`).

⚠️ **Both contexts, not just the renderer.** Wiring only `depCtx` would leave the option list on screen
and the Next-button completeness check reading different flags — the same class of failure as the
original `tab-validation` depCtx gap.

⚠️ **Nothing here knows what config it is running.** No field name, combination index or vertical is
referenced anywhere; the whole feature is inert unless a rule says `source: 'flow'` (pinned by the
regression test). Do not special-case a field, and do not add a create/edit toggle to the UI —
conditions-off already IS the My Deals view.

**Not ported:** web's `validateRuleRefs` flow branch. `validateDependencies` is exported but never
called anywhere in `src/`, so it changes no runtime behaviour on the phone — authoring is the portal's.

### Out of scope, noted by the backend author
- `mhalt-revDSM-backend` `jobBuilderSummary/engine/dependency-engine.ts:880` has the **same**
  `toggle || optionList` gap in `validateDependencies` — separate ticket, not a mobile blocker.
- `DEAL_PRICING_DEBUG` in `dynamic-deal-pricing.ts` is still `true` on `dev-v1-funding` and must be
  `false` before release. **Not changed here** — it is not part of this ticket.

### Follow-up — the dropdown lost its "Important Notice" popup

*"when we add the value in the Versa Max and then select the 2.5 value from the drop down, this alert
[Important Notice — Ensure Agreement has Special Can't Guarantee Cleaning or Sealing Clause] should show;
currently it doesn't."* The popup is schema-driven: `field.notice` `{ enabled, head, dealsDescription,
triggerValue }`, resolved by `resolveFieldNotice` (`notice-utils.ts`) and shown by `useFieldNotice`
(`FieldNoticeModal.tsx`). Web's `DropdownField` (`field-registry.js`) fires it from `onChange`.
Moving `dropdown`/`select` onto `DropdownField.tsx` in this ticket dropped it, because only
`DynamicOptionField` (the chip grid) wired the notice, and the single-select path renders
`DropdownSelect` directly.

- `DropdownField` now calls `useFieldNotice(field)` and wraps the single-select `DropdownSelect`
  `onChange` with `handleValueChange`. Multi-select still goes through `DynamicOptionField`, which wires
  the notice itself, so it isn't wired twice.
- ⚠️ **Only the rep's pick opens it.** The auto seed/clear in the `useLayoutEffect` writes through
  `onChangeRef` and must NOT call `handleValueChange`, or reopening a saved deal or seeding a default would
  pop the notice on its own.
- The notice is a child `Modal` of the Job Builder's modal, the same as the chip-grid notice.
  `DropdownSelect` expands inline (not a Modal), so there's no stacked-dismiss trap.
- Which option triggers it is **config** (`notice.triggerValue`, exact string match; empty = any value).
  If it still doesn't show, check the portal field's `notice.enabled` / `triggerValue` against the option
  text. Test: `__tests__/field-notice.test.ts`.

## Dynamic Job Builder — combination numbering & the parent combination (LeafFilter and every combination section)

Report: the LeafFilter "+" (Add Combination) *"is not working properly … the combination should come
with the accurate combination number"*. A per-combination "+" duplicate button was tried and then
**removed at the user's request** — *"we only add the combination by pressing the bottom button, do not
need any plus icon on top"*. Don't re-add a header "+".

- **Add Combination (bottom) is the only way to add**; it still adds a **blank** default combination.
  `createNextCombinationItem` now numbers `max(offset + length, highest chip on screen) + 1`, so a stale
  stored `_combinationNumber` from a saved draft can no longer hand the new one a number already taken.
- **The parent combination gets no Remove.** The parent is the section's **first** combination
  (`isParentCombination(index)` → `index === 0`, `combination-utils.ts`): hydration seeds exactly one per
  section (fields "Locked from Job Summary"); everything after it was added by the rep. Remove renders
  only on `index > 0` (it used to show on the parent whenever `combos.length > 1`), and
  `handleRemoveCombo` also refuses index 0.
- ⚠️ **Positional, not a `_userAdded` flag, on purpose.** `ensureTabStateShape`
  (`dynamic-job-state-storage.ts`) rebuilds each combination from its known row fields plus
  `_combinationNumber` only, so a marker would be dropped on the next reload, and an extra `_` key would
  also leak into the activity-log / empty-step-gate / diff key walks, which skip only the known ones.
- Test: `__tests__/combination-numbering.test.ts` (gitignored, see §6).

### Follow-up — numbers run ACROSS sections; renumbered tab-wide, displayed by position

*"we received two combinations; if I add after combination 2 first, then after combination 1, the count
is disturbed."* LeafFilter has **two combination sections** (6" parent = #1, 7" parent = #2) and the
chip numbers run across them. Each section numbered a new combination only from its own count
(`comboIndexOffset` was read from the section's first stored number), and the later section's stored
numbers were never shifted — so 7" add → #3, then 6" add → **#2 again**.

- **`renumberTabCombinations(sections, tabState)`** (`combination-utils.ts`) rewrites every
  `_combinationNumber` 1..N in render order. `updateSectionCombos` (`DynamicTabRenderer.tsx`) runs it on
  every combinations write (add, remove, any field edit), so the stored numbers the summary, logs and
  diff read stay in step. `sections` must be the **rendered** combination sections
  (`getRenderedCombinationSections`: not simple, has fields, visible). A section with nothing saved
  still counts its one default combination but is **not written** into state.
- **Chips and the Grand Total card's `#N` are positional** (`comboIndexOffsets[section.id] + index + 1`),
  never the stored number, so a draft saved before this fix displays correctly at once; its stored
  numbers are fixed by the next edit. `_combinationNumber` is in the diff's `SKIP_LEAF_KEYS`, so
  renumbering produces no phantom addendum rows.
- `getRenderedSectionCombos` mirrors the renderer's old inline `getSectionCombos` (now delegates to it).
- **My Deals** (edit mode) uses the same numbering plus the colour filter: hidden combinations take no
  number, and an added combination is tagged `_addedInEdit` so it isn't hidden. See `deal-edit-addendums.md`,
  "Add Combination looked dead; chip numbers had gaps".

### Merge note: `handleResultConfirm` deps are a UNION of two branches

`DynamicDealCenterScreen.tsx` conflicted on exactly one line when `dev-v1-multi-tenat` merged in — the
`handleResultConfirm` `useCallback` dependency array. Each branch had appended a different dep to the
same base list:

- offline branch: `handleSetDownPayment` — the down-payment persistence fix (Result modal → Build Job →
  back → the figure was gone, because it only ever lived in screen state).
- `dev-v1-multi-tenat`: `refetchJobBuilderConfig` — re-reads the published job-builder config every time
  the builder is opened, since this screen never unmounts and owns the only observer.

**Both function bodies auto-merged cleanly; only the deps line collided.** That is the dangerous shape:
taking either side alone leaves a live call in the body whose dep is missing, i.e. a stale closure. The
resolution keeps both, and both calls are still present in the callback.

⚠️ If this line conflicts again, do not pick a side — reconcile it against what the body actually calls.

**It conflicted again** when `dev-v1-funding` merged in, in the same callback and the same shape: funding
added `const resultCalcId = calcIdOverride || currentCalculatorId` (the resume path reaches this in the
same tick as its `setCurrentCalculatorId`, so the state id is a tick stale) while the offline branch added
the down-payment write directly above it. Union again — and the reconciliation caught a real bug: the
down-payment write was keyed on `currentCalculatorId`, which on the resume path is exactly the stale id
funding introduced `resultCalcId` to avoid. It now writes against `resultCalcId`. Taking either side alone
would have saved the rep's down payment onto the PREVIOUSLY selected calculator, silently, because both
writes succeed.

### Merge note: the outcome read answers TWO independent questions

The same `dev-v1-funding` merge conflicted on the Job Builder's `['leadOutcome']` `queryFn`
(`DynamicJobBuilderScreen.tsx`), where each branch had reworked the same two `return` statements for a
different reason:

- offline branch: `applySaved(…)` deserialization, plus **the device copy standing in on a failed read** —
  answering `undefined` there is what blanked the builder on a flaky connection.
- `dev-v1-funding`: an **`outcomeExists`** flag gating the DOCUMENTS query below, with `isMissingOutcome(e)`
  separating a normal first-open 404 from a real failure.

⚠️ **Neither side could simply be taken.** Funding's `return { initialJobState: jobState … }` names a
variable that no longer exists on the offline branch (renamed to `savedState` + `applySaved`), so "theirs"
does not compile; "ours" drops the flag and restores the duplicate 404 on every first open.

The resolution keeps both because **they answer different questions**: "what build should the rep see?"
(device copy vs server) and "does an outcome RECORD exist?" (gates the documents read). A 404 answers
both — no record, no build. Any other error answers *neither*, so the device copy is offered AND the
documents read still gets its own chance.

⚠️ The **device-source early return** (`resolveJobBuildSource === 'device'`) now returns
`outcomeExists: false` explicitly. It predates the flag, so it returned none — and `undefined !== false`
reads as "unknown", which lets the documents query fire on exactly the offline path where its signed-URL
round-trip cannot succeed and where `calcId` may be a client id the server has never seen. Documents
re-resolve on the next online open, when that branch is no longer taken.

## Opening the Result Lead sheet 404'd — `updateJobBuilder` was PUTting a POST-only route

Ticket: opening `ResultJobModal` (the funding "Result Lead" sheet) logged a **404** —
`PUT /lead/v1/:id/job-builder Cannot PUT /lead/v1/:id/job-builder`. Confirmed by backend
(2026-09-28): `/job-builder` has no PUT handler, POST only, and POST upserts by lead id.

Root cause: `useOutcomeLogging`'s mount effect (shared by `ResultJobModal`, the classic
`OutcomeModal`, and the Lead Center `ResultLeadModal` — all three render the sheet this hook
drives) auto-populates the `lead_result` field-entry rows, then calls
`markAutoFieldsLogged(leadId, jobBuilder, 'lead_result')` (`utils/activity-log/job-builder-auto-log.ts`)
to persist `jobBuilder.autoFieldsLogged.lead_result = true` so the same rows don't re-fire on
the next open. That write went through `LeadService.updateJobBuilder`, which called
`api.put(LeadEndpoints.jobBuilder(leadId), …)` — the one caller in the file using PUT where every
other write to this route (`submitJobBuilder`, `AppointmentSchedulerModal`'s amendment-submit
double-write) already used POST.

- **Fix: `updateJobBuilder` now POSTs too** (`services/api/leads.ts`). It stays a separate
  function from `submitJobBuilder` — same request, kept for call-site clarity (callers that mean
  "update" vs. "submit") — not collapsed into one, since other call sites reference it by name.
- ⚠️ **Don't "restore" a PUT here.** `/job-builder` never had a PUT handler; the original PUT was
  the bug, not a divergence to re-sync.
- `AppointmentSchedulerModal.handleAmendmentSubmit` calls `submitJobBuilder` then `updateJobBuilder`
  back-to-back with the same payload — before this fix, the second call's 404 threw and skipped the
  success flash / draft-accept, another symptom of the same root cause, now resolved by the same edit.

### ✅ The Job Builder read the SAME outcome endpoint twice on every first open

Ticket, with a devtools capture on opening the Job Builder for the first time:
*"when first time this screen is open this end point is calling with the 404 not found error"* —
`GET /lead/v1/{leadId}/outcome/{calculatorId}` → `{"code":404,"message":"Lead calculator outcome not found"}`,
logged red from `outcome-documents.ts` as a failed document read.

**The endpoint was not misbehaving.** That outcome record is created by the first **save**, so on a
first open there is genuinely nothing to read and `404` is the correct answer. Two separate faults
turned a normal state into an error in the console:

1. ⚠️ **The same URL was requested TWICE.** The draft query (`['leadOutcome', leadId, calcId, startFresh]`)
   calls `getLeadOutcomeByCalculator` and swallows its 404 silently; the documents query
   (`['leadOutcomeDocs', leadId, calcId]` → `loadResolvedOutcomeDocuments` → `fetchOutcomeDocumentRows`)
   then re-reads **the same endpoint** — a record the app had *already been told does not exist*. That
   second call is the one in the log, and the capture shows both.
2. **It reported the 404 as a failure.** `fetchOutcomeDocumentRows` already returned `null` (so behaviour
   was correct), but it `console.warn`ed unconditionally.

#### The fix

- **New `isMissingOutcome(e)`** in `utils/outcome-documents.ts` — reads `response.status ?? httpStatus`.
  The warn now fires only for a GENUINE failure. ⚠️ **Do not widen it to swallow everything**: an empty
  document list on a lead that HAS documents is a real problem and must stay loud.
- **The draft query returns `outcomeExists`** (`true` on success, `!isMissingOutcome(e)` in the catch) and
  the documents query is gated `… && outcomeData?.outcomeExists !== false`. **Documents live ON the
  outcome**, so no outcome means no documents and nothing to ask for — the request is not silenced, it is
  not made.

⚠️ **A non-404 failure keeps `outcomeExists: true` deliberately.** An unrelated 500 on the draft read must
not suppress a document list that may well come back fine.

⚠️ **`outcomeExists !== false`, not `=== true`.** `initialJobState: undefined` is normal — an outcome can
exist with no saved build (Start Fresh on a rehash, or an empty one) — so only an *explicit* `false` gates.

⚠️ **It re-enables itself, and every path was checked:** filing the first document creates the outcome and
`commitUploaded` invalidates `['leadOutcome', leadId]` — a **prefix** of the draft query's key — so it
refetches, `outcomeExists` flips true and the documents query runs. A **delete-only** Update invalidates
only `['leadOutcomeDocs', leadId]`, which is safe because documents existing implies the outcome exists, so
the query was already enabled. `handleUploadDocs` also returns its rows from its own direct
`fetchOutcomeDocumentRows` call, so a just-uploaded document reaches the caller either way.

Verified with 7 tests (`__tests__/screens/DynamicDealCenter/outcome-first-open.test.ts`) driving the real
`isMissingOutcome` plus the query's exact `enabled` expression: the 404 recognised under both status
spellings, a 500 / 403 / network error / `undefined` still reported, **the repro (no outcome → the
documents query does not run)**, it running once an outcome exists, a non-404 failure still letting the
read try, an outcome-less payload not mistaken for a missing outcome, and the `isEdit` / `isOutcomeFetched`
/ id gates unchanged. tsc 44 (baseline unchanged); `outcome-documents.ts` is eslint-clean and
`DynamicJobBuilderScreen.tsx` is at its exact HEAD baseline (49 problems: 2 errors / 47 warnings).
22 suites / 390 tests pass and the iOS bundle builds. ⚠️ Both files are **CRLF**.

⚠️ Needs a device check: open the Job Builder on a NEW lead and confirm the console shows **no**
`GET …/outcome/{calcId}` at all; then file an agreement and confirm the documents list still populates.

## My Deals no longer hides uncoloured LeafFilter combinations

Ticket: *show combinations with values AND those with none — a free hand over the LeafFilter combination
inputs.* `isComboHiddenInDealEdit` (`utils/dynamic-job-builder/engine/combination-color-filter.ts`) now always
returns `false`, so the tab cards, Grand Total card, Summary step and combination numbering (Deal Center's
`renumberTabCombinations` included) show and count every combination. Full note and restore recipe:
`deal-edit-addendums.md`, "My Deals shows uncoloured LeafFilter combinations again".

⚠️ Display only — the function stays as the single choke point; do not re-add per-surface filters. An
untouched empty combination is still pruned on save, so no blank rows persist.

## Funding: financing method stays changeable; funding rows are scoped to the calculator

Ticket: *once a down payment is paid its field should lock, but the rep must still be able to change the
financing method — and financing picked on one calculator must not affect the lead's other calculators.*

**1. Method lock is narrower than "settled".** `isMethodLockedRow` (`DynamicDealCenter/utils/funding.ts`) =
`charged || collected || activated`. `PaymentRowsGroup` locks the method on that; a lender **decision alone**
(approved / short / declined) no longer does, so Swap / the dropdown stay live on a financing row.
`lockedMethodNote` gates on it too (new "financing has been activated" line).
⚠️ `isSettledRow` is unchanged and still drives **amount read-only** and **Remove** — a decided row's amount is
the lender's figure and the server 409s its deletion; only the METHOD opens up. A paid down payment stays fully locked.
⚠️ `swapRowMethod` now clears `linkSent/activated/decision` on ANY method change of a decided row (previously only the
chip/Swap path did), matching the server reset; `ResultJobModal.selectRowMethod` now uses it (it used to just set `method`,
leaving a stale decision). If the backend refuses a PUT that changes a decided row's method, `useFunding`'s existing
error surface shows it — the client cannot verify that rule.

**2. Funding is lead-scoped, so ownership is remembered per device.** `GET/PUT /lead/v1/:leadId/funding` has no
calculator id; every Result Lead sheet hydrated the SAME rows, so calculator A's financing showed on B.
`utils/funding-owner.ts` (`shouldAdoptSavedFunding`, key `funding-owner:<leadId>` in MMKV) records the calculator on a
successful Confirm; `ResultJobModal`'s open-hydrate skips another calculator's rows (and its stored price / bank-decline flag).
⚠️ It still adopts when **no owner** is stored (older data / other device) or when the rows have **started**
(`structureLocked`: link sent, decision, charged…) — those are real, a PUT cannot drop them, hiding them would strand the rep.
⚠️ Device-local, not a backend guarantee: a proper fix needs a `calculatorId` on the funding record.
Tests: `__tests__/utils/funding-owner.test.ts` (gitignored dir).

### Follow-up: tapping Sale on an already-submitted funding opens the Funding screen, not the Job Builder

Ticket: *after funding is submitted and the rep comes back, Sale jumped straight to the Job Builder inputs; it
should land on the funding screen (a collected down payment stays locked).* `handleResultJob`
(`DynamicDealCenterScreen.tsx`, CRLF file) used to run `canResumeJobBuild` → `resumeRef.confirm(resumeOutcomeFromRecord(...))`.
It now calls `openSheet(true)` → `resultModal.startOnFunding` → `ResultJobModal` prop `startOnFunding`, which, once
`funding.load()` has hydrated the saved rows, does `setScreen('funding')` (and sets `wentToFundingRef`).
⚠️ `resumeOutcomeFromRecord` is now unused (kept, still tested) — the build is reached from the funding screen's own
Submit/continue. ⚠️ Only applies when the saved rows were adopted (`shouldAdoptSavedFunding`, see above) and exist.
Locking on that screen is the existing rule: charged/collected rows locked, financing method swappable.

### Follow-up: funding of one calculator still appeared on its sibling — the "started" exception is gone

Ticket: *two calculators on one lead; funding entered on one populated the other.* The first isolation pass still
adopted another calculator's rows when they had **started** (`structureLocked`) or when **no owner** was stored, and the
Sale-tap resume ignored ownership entirely. Now `shouldAdoptSavedFunding(owner, calculatorId)` (`utils/funding-owner.ts`) is
strict: another owner's rows are **never** adopted, and `handleResultJob`'s submitted-funding shortcut (open on Funding)
requires the same match. An un-owned record is **claimed** by the first calculator that adopts it, so it can't leak later.
⚠️ The backend record is still ONE per lead: a save from calculator B replaces A's rows, and the API 409s if A's rows have a
sent link / decision — that refusal is surfaced as-is. Full isolation needs a `calculatorId` on the funding record.
⚠️ Records saved before this change and never opened since have no owner and go to whichever calculator opens first.

### Follow-up: Result Lead is refused on a sibling calculator once one calculator's funding is submitted

Ticket: *submit funding on one calculator → the other calculators must not proceed; tell the rep to refund the submitted job first.*
`handleResultJob` (`DynamicDealCenterScreen.tsx`, CRLF) reads the funding record on a Sale tap; if `status === 'submitted'` and
the stored owner (`funding-owner:<leadId>`) is a DIFFERENT calculator, it shows an Alert — *"You already submitted a funding against
the calculator "<title>". … first run the refund process against that submitted job."* — and returns: no sheet, no Job Builder.
The owner's title comes from `tabs` (now in the callback deps). ⚠️ Needs a recorded owner (set at Confirm / first adoption); a
submitted record with NO owner can't be attributed and is not blocked. ⚠️ Sale only — a Demo is not gated. ⚠️ Device-local, like the
rest of the ownership scheme; a lookup failure falls through to the sheet (never blocks resulting on an error).

### Follow-up: the "Funding already submitted" notice uses the app's own dialog

The native `Alert.alert` read as OS chrome. It is now `ConfirmDialog` (`tone="warn"`, new **`hideCancel`** prop for an
information-only card with one OK button) rendered beside both `ResultJobModal`s in `DynamicDealCenterScreen`, driven by
`fundingBlock` state. ⚠️ Both render branches (edit-mode early return and the main flow) carry the dialog — keep them in step.

## Result Lead payment rows: one card per payment, amount and method in separate boxes

Ticket: *two separate boxes — one for the amount, one for the payment method; several payments must not share a line; Down Payment,
Balance and Upfront.* On the **panel** layout of `PaymentRowsGroup` (`DynamicDealCenter/components/funding/`) each payment is now its own
bordered card — `PAYMENT n` header (with the ✕ remove) → **Amount** box → **Payment method** box, both full width. They used to share one
line, which truncated both (`$2,8…`, `Check (Bank F…`). The three groups (Down Payment / Balance / Upfront) all render through it, so one
change covers them. ⚠️ The **plain** layout (My Deals mockup) is deliberately untouched. ⚠️ `amountCell` / `methodCell`, the lock rules, the
locked-note and archived block are the same objects as before — only the container changed, so don't fork the logic per layout.

### Follow-up: the "PAYMENT n" title shows only with more than one payment in the group

`PaymentRowsGroup` panel layout draws the card header title only when `rows.length > 1`. A lone removable row keeps just the ✕
(right-aligned, no title); a lone locked row has no header at all.

## Portal-driven automatic quantity (Lighting -> Booster box)

Ask: when the lighting footage adds up to a range, add booster boxes automatically (226-450 ft = 1, 451-675 = 2...), keep it
rep-editable, and pop a message when one is added, updated or removed. ⚠️ **Nothing may be hardcoded; ranges AND messages come
from the portal.**

The portal publishes it on the field's `conditional` in `GET /calculator-form-schemas/deal-center` (Lighting ->
`booster_box_over_225`), in a new **`valueMode: 'range'`**:

```json
"conditional": { "dependsOn": ["<1st>", "<2nd>", "<3rd>"], "matchMode": "any", "valueMode": "range", "aggregate": "sum",
  "ranges": [{ "min": 226, "max": 450, "value": "1" }, { "min": 451, "max": 675, "value": "2" }],
  "notifyRep": true, "addedMessage": "{field} was added automatically ({value}) because the total is now {total}",
  "removedMessage": "...", "updatedMessage": "..." }
```

- Pure rules in `screens/DynamicDealCenter/utils/auto-quantity.ts` (tests: `__tests__/utils/auto-quantity.test.ts`); the effect is
  in `CalculatorView` (`autoFields`). Placeholders: `{field}` `{value}` `{total}` `{previous}`. No message / `notifyRep` not true =
  no popup (no copy lives in the app). `aggregate`: sum (default) | max | min.
- ⚠️ **`range` is NOT `fixed`.** `field-dependency.ts` reads an unknown `valueMode` as `userInput`, so the field stays editable -
  that is what lets a rep order one at 220 ft. Do not add `range` to the fixed/locked branch.
- ⚠️ **The rep's value is protected without any flag**: the rule only writes when the field still equals what it would have
  set for the PREVIOUS footage, so an override, or a quantity saved on a reopened calculator, is never overwritten.
- ⚠️ **The first sight of a tab only records its footage**, so opening or switching tabs never rewrites a quantity.
- One popup per burst of typing (700 ms), reporting the net change: added (0 -> n), removed (n -> 0), updated (n -> m).
- Control Box (`control_box`) is a separate portal rule: `valueMode: 'fixed'`, value 1, locked. Unrelated to this feature.

### Reversal: the Investment Center package tab shows the box + ⓘ AND the scope list

The "REPLACES the list" decision recorded above (`InvestmentPanel` "Includes the Following") is **superseded**. QA: *"when the i icon is displayed, the details are missing here - I need the details"*. On a full package the centred box + ⓘ now sits ABOVE the same `inclusions` list a normal tab shows (job-scope sentences, else product names), per the calculator being presented. The ⓘ card still carries the package breakdown. ⚠️ Do not restore the replace-the-list branch.

## Agreement signature pad: e-signature consent gates Save Mark

`widgets/modals/job-builder/AgreementSignatureModal.tsx` (the "Sign to Finalize Order" capture overlay, used by the create flow; the edit-flow note is in `deal-edit-addendums.md`). An "I agree to electronic signature" checkbox sits above Clear / Save Mark; Save Mark is disabled until ticked and `savePad` returns early without it.

- ⚠️ The tick resets on every pad open (`useEffect` on `activePad`), so initials and signature are each an explicit agreement.
- ⚠️ Nothing is sent to `/agreement/{leadId}/sign` - the consent only gates capture.
- ⚠️ Save Mark needs the tick AND ink: `canSavePad = agreedToESign && (live strokes > 0)`. Ticking alone used to enable it on an empty pad, so a blank mark could be saved. A stroke counts once the finger lifts (the live path array only grows on release).

## Job Builder Extras ▸ Wedges showed the 5" gutter footage

Ticket: Wedges = 5 and 5" Gutter/DS/E = 12 in the calculator, but the Job Builder's locked Extras ▸ Wedges read 12.

`build-deal-center-data.ts` is the only map the locked, `dcField`-driven fields resolve from. It wrote every entry under its field id AND its legacy-name aliases in ONE pass, in the order the entries arrived (arbitrary for a saved calculator), and then let the result's top-level legacy columns overwrite whatever it had. Either could put one field's value under another field's key.

- Now two passes: aliases first, each entry's own canonical field id LAST; an alias never overwrites another live entry's id; and a key supplied by the entries is not overridden by `resultData`.
- ⚠️ **Unverified against the live schema** — the cause was deduced from the code, not reproduced. If Wedges still reads the gutter value, inspect the Wedges field's `dcField` in the portal job-builder config (it may name the gutter field) and the calculator schema's `name`/`pricingKey` for the two fields; the app cannot fix a mis-authored `dcField`.

### Merge note: `dev-qs-offline` into the draft read in `DynamicJobBuilderScreen`

Both branches changed the `['leadOutcome', ...]` query. The merged read keeps BOTH: `dev-qs-offline`'s device-first source and `applySaved` (honours `startFresh`), and this branch's `outcomeExists` flag that gates the documents query. Success: `{ initialJobState: applySaved(savedState), outcomeExists: true }`. Failure: `{ initialJobState: applySaved(stored), outcomeExists: !isMissingOutcome(e) }`.

- ⚠️ On a FAILED read the device copy stands in (no blank builder on a flaky connection), but a read that SUCCEEDS with no build is still an answer and does not fall back to the device copy (a job reset on the portal must not be resurrected).
- ⚠️ `outcomeExists` is false only for a 404; any other failure leaves it true so the documents read still gets its chance. The device-first early return sets no flag, which the documents gate treats as "exists".

## "How is this being paid?" is a 3-option dropdown

Ticket: the two radio cards truncated "Down Pay…". Now a `DropdownChoice` (`components/funding/DropdownChoice.tsx`, expands IN PLACE — never a nested Modal) with **No Down Payment / Down Payment / Paid in Full Upfront**, titles never truncated. Used by `ResultJobModal` and `DynamicDealEditScreen`; `SegmentedChoice` is no longer used by either.

- ⚠️ **"No Down Payment" is not a third wire structure.** It is `payMode === 'split'` plus a UI-only `noDown` flag (`PayStructure`, `payStructureOf` in `utils/funding.ts`): the Down Payment group is hidden, down rows are cleared to `''`, and the balance carries the whole contract. An entirely unfunded down row is already exempt in `confirmBlockers`, and `toUpsertRows` drops zero rows — so nothing downstream changed.
- On reopen, `inferNoDownPayment(record)` restores it for a saved split deal with no funded down row. The flag is not persisted.
- Once money has moved (`structureLocked`) the other options are disabled and explain why, same as before.
- `structureHint` takes a 4th `noDown` arg.

### Result Lead opens on "No Down Payment" and warns on Confirm

`ResultJobModal` defaults the dropdown to **No Down Payment** unless the rollout carried a down payment (`initialDownPayment > 0`); a saved deal still restores through `inferNoDownPayment`. Tapping **Confirm** on No Down Payment raises the app's own `ConfirmDialog` (tone `warn`) — "you are going with financing for the whole payment" — and only **Continue** runs `goFunding(true)`. Down Payment and Upfront show nothing.

- ⚠️ The dialog is drawn with `ConfirmDialog`'s new `inline` prop (absolute layer, no native Modal): the Result Lead sheet is itself a Modal, and native Modals must never stack. A full-screen `<Modal>` dialog from here would be dropped on iOS.
- Scope: Result Lead only. `DynamicDealEditScreen` keeps its own default (reopened deals restore from the saved record) and has no warning.
- ⚠️ `goFunding` now takes an `acknowledged` flag and `noDown` is in its dependency list — a stale closure there would skip or repeat the warning. The Confirm button calls `goFunding()` through an arrow, never `onPress={goFunding}` (that would pass the press event as `acknowledged`).

### Result Lead: Original Contract Price field matches the payment Amount field

`MoneyField` (`ResultJobModal.tsx`) now uses the same type as `PaymentRowsGroup`'s Amount field: `FS.LEAD` + `PS.bold` for the `$` and the value, `minHeight: 46`, `borderWidth: 1.6`, `FUND.BORDER`, `borderRadius: 12`. It was `FS.BODY` + `PS.semibold` on a thin 8-radius box, so the two fields stacked on one sheet read as different sizes. ⚠️ Keep the two in step; the locked (non-editable) state keeps its grey fill and text.
- Follow-up: `MoneyField`'s title is now a plain `FS.SMALL` / `PS.bold` / `FUND.SUBTEXT` line ABOVE the box (`marginBottom: 5`), like the payment rows' "Amount" label, instead of a floating cut-out label; locked fill is `FUND.FILL`. `labelBg` is now unused. Title and box therefore match the Amount field exactly.

## Job Builder footer: Back/Next flush against the Android nav bar

`DynamicJobBuilderScreen`'s bottom bar used `paddingBottom: Math.max(insets.bottom, 16)`. With
`edgeToEdgeEnabled=true` the footer ends exactly where the system nav bar starts, so the 16 floor never
showed and Next sat flush against the bar (small 80x~30 buttons made it worse).

- Now `insets.bottom + 16`. ⚠️ Add the gap ON TOP of the inset, never `max()` it: insets read 0 under gesture
  navigation and equal the bar height under 3-button nav - both need the extra space.
- Back / Next / Clear / Skip-all are one size: 38pt tall, radius 10, Back/Next 84pt wide, 13pt labels (46pt/100pt was tried and judged too big).

## Job Builder: the screen SHOOK while scrolling slowly (collapsing header)

Ticket: *"when the user moves the screen up very slowly the screen shakes very fast - make it smooth at any speed."*

⚠️ **Root cause: the collapsing header animated its HEIGHT** (`useCollapsingHeader`, JS driver). Every scroll
frame resized the ScrollView below it, the resize moved `contentOffset` on its own, `onScroll` fired again and
the content jittered against the finger - worst on a slow drag, where each frame's delta is under a pixel.
The old `userDriven` guard only stopped the header re-opening; it could not stop a layout feedback loop.

**Fix: no layout changes while scrolling.** `DynamicJobBuilderScreen` now renders
`<View {...outerProps}>` (flex 1, clips) > `<Animated.View style={innerStyle}>` (header + pinned tracker +
ScrollView, a FIXED `outer + headerHeight` tall) and the block slides up with `translateY = -collapsed`.
The footer is a SIBLING of that block, not inside it. The settle animation and the opacity fade run on the
native driver; the finger-tracking maths in `utils/collapsing-header.ts` is unchanged.

- ⚠️ **Never go back to animating `height` / `paddingTop` from `onScroll`.** `underHeaderStyle` is now a static
  8pt because the tracker rides up WITH the header instead of closing a gap.
- ⚠️ **Do not mix drivers**: `collapsed` feeds native nodes (translate, opacity), so `settle()` must also be
  `useNativeDriver: true` or RN throws.
- The block is `H` taller than the visible area, so the ScrollViews' bottom `H` px sit under the clip while the
  header is open. Both (`DynamicTabRenderer`, `VerticalSummaryTab`) already have `paddingBottom: 160`, which is
  what keeps the last content reachable - keep it >= the header height if you ever shrink it.
- Not verified on device from this session: slow drag, fast fling, and a tab change (the hook resets to open on
  `resetKey`) on Android and iOS.

### Follow-up: it still shook WHILE THE FINGER WAS DOWN (collapse now runs on the UI thread)

After the translate fix the screen still shook while the rep HELD the screen as the header moved, and was
calm once they let go. Cause: the scroll offset is native and instant, but the collapse was computed in a JS
`onScroll` and pushed to the native transform a frame or two later, so scroll and translate fought each other
for as long as the finger drove the scroll. Momentum after release is smooth enough to hide it.

- `hooks/useCollapsingHeader.ts` is now **Reanimated**: `useAnimatedScrollHandler` (begin/end drag, momentum,
  scroll) computes `collapsed` in a worklet in the SAME frame as the scroll; `useAnimatedStyle` drives the
  block's `translateY` and the header's opacity; settle is `withTiming`. `utils/collapsing-header.ts` functions
  are `'worklet'`s (pure, closure-free) - keep them that way.
- ⚠️ **The scroll view must be a Reanimated one** to host the handler: `KeyboardAwareScrollView`
  (`DynamicTabRenderer`) already is; `VerticalSummaryTab` was switched from RN `ScrollView` to
  `Reanimated.ScrollView` (NativeWind `className="p-4"` does not reach it, so it is an explicit
  `contentContainerStyle={{ padding: 16, ... }}`). A plain `ScrollView` given this `onScroll` silently
  never collapses the header.
- ⚠️ In `DynamicJobBuilderScreen` the block and the header are `Reanimated.View`s and the header's style is an
  ARRAY (`[static, headerStyle]`) - an animated style cannot be spread into an object.
- ⚠️ Never move the calculation back into a JS `onScroll` + `setValue`, even with `useNativeDriver`: the
  value arrives late whatever the driver.
- `hidden` on the hook is now always `false` (no caller read it; the state lives on the UI thread).

### Follow-up 2 (the real root cause): the ScrollView must NEVER move - header + trackers are overlays

It STILL shook while a finger was down (calm after release) even with the UI-thread worklet. So timing was
not the cause. ⚠️ **A scroll view measures the finger relative to ITSELF.** Both the height animation and the
translated block moved the scroll view, so every px it slid under a held finger read as extra finger travel:
it scrolled more, which collapsed more - a feedback loop that exists ONLY while a finger is down.
That is why nothing about the driver, thread or throttle could fix it.

**Design now (supersedes the "fixed-size translated block" described above):**
- `DynamicJobBuilderScreen`: a clipping `View` (`overflow: 'hidden'`) holds the content FIRST and the header
  AFTER it as an `absolute` overlay (`top: 0`, `zIndex: 60`). The header slides up with `translateY` + fades.
- `DynamicTabRenderer`: the two pinned trackers are wrapped in one `absolute` `Reanimated.View`
  (`top: collapsingTopInset`, `zIndex: 50`) that slides up by the same amount. Its height is measured
  (`trackerHeight`) and the ScrollView's `contentContainerStyle.paddingTop` = `12 + topInset + trackerHeight`,
  so the list starts below them. `VerticalSummaryTab` takes `collapsingTopInset` for the same reason. The
  empty-step gate is padded by `topInset`.
- `useCollapsingHeader` returns `headerStyle`, `trackerStyle`, `topInset` (replaces `outerProps`/`innerStyle`).
- Legacy path kept: with no `collapsingTrackerStyle` the renderer lays the trackers out in flow as before.
- ⚠️ **Rule: nothing that CONTAINS a scroll view may be translated, resized or re-padded from scroll position.**
  Overlays that float over it are fine. Re-padding on a TAB change or a tracker-height change is fine (not
  scroll-driven).
- Touches on the floating header/trackers do not scroll the list (same as before, they were outside it).
- Not verified on device from this session: slow held drag up/down, fast fling, tab change while collapsed,
  allocation banner changing the tracker height mid-scroll.
- `DynamicTabRenderer.tsx` detail: the `trackerHeight` `useState` sits ABOVE the `tab.isSummary` early return (a hook after it trips rules-of-hooks). The pinned trackers are built once as `trackerBlocks` and rendered either inside the overlay `Reanimated.View` (when `collapsingTrackerStyle` is passed) or in flow (legacy). ⚠️ Keep both paths rendering the SAME `trackerBlocks`, or the two layouts drift.

## Agreement signature modal: Cancel / Submit sat against the system bar

`widgets/modals/job-builder/AgreementSignatureModal.tsx`'s footer used `paddingBottom: Math.max(insets.bottom, 16)`,
so the buttons ended almost flush with the Android nav bar (and `insets.bottom` reads 0/stale inside a Modal).
It now uses `footerBottomPadding(insets.bottom)` from `utils/installer-insets.ts` (inset floored at 16, PLUS a 16
gap) and 12pt top padding - the same helper the installer sub-flows use.

- ⚠️ Add the gap on top of the inset, never `max()` it (same trap as the Job Builder footer above).
- The modal still declares only `statusBarTranslucent`; `EDGE_TO_EDGE_MODAL` was NOT adopted (it would put the sheet under
  the nav bar and must travel with this padding as one change).
- ⚠️ Follow-up: the buttons still sat under the nav bar because `insets` there is the APP ROOT's (bottom 0), while this Modal's window extends beneath the Android nav bar. The footer is now `ModalFooterBar`, a child of the modal's INNER `SafeAreaProvider`, so `useSafeAreaInsets()` reports the modal window's real bottom inset (padding = `footerBottomPadding(inner.bottom)`, top 16 so the row reads centred). Do not read the footer inset from the component that renders `<Modal>`. Not verified on device.
- The footer also floors the inset at 32 on Android, so a window that reports 0 still clears a 3-button nav bar.
- Header: the title block ran UNDER the Send Remotely button (it kept its one-line width). It is now `flex: 1, minWidth: 0` with a 12pt right margin and wraps (`numberOfLines={2}`); the button group is `flexShrink: 0`, 36pt tall, with a one-line 10.5pt label. ⚠️ A `flex: 1` sibling needs `minWidth: 0` to be allowed to shrink below its text width.
