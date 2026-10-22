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

### …and a drop on a FLAKY connection was lost silently, not just offline

Client ticket: *"Deal center - drop did not save… this has got to do with offline/online stuff…
there shouldn't be this fragmented difference between online, offline, and online with little
bars."* The developer could not reproduce on their own (stable) connection.

**True airplane mode already worked.** `saveDropsNow`'s pre-flight `!isOnline()` check routes
straight to `persistOffline` (MMKV-backed, drained on reconnect/`AppState`/a 60 s sweep — see
`offlineLeadStore.ts`). The bug is the **middle case the ticket is actually describing**: "little
bars", where `isOnline()`'s cached/debounced flag reads `true` but the PUT itself fails. The old
code's failure handling was **one immediate retry, then silent loss**: `catch { if (attempt === 0)
dropSavePending.current[tabId] = drops; }` — on a flaky connection the retry fires instantly with
no backoff and no re-check of connectivity, so it fails again for the same reason the first one
did; at `attempt === 1` the `if` is false, nothing is queued, nothing is written to disk, and the
row that only ever existed in `handleSetDrops`'s in-memory `setTabs` update is gone. The rep sees
the modal close and the row on screen (the optimistic update), with **no error, no "pending sync"
indicator — nothing** to say it never reached the server or the device.

⚠️ **`queueCalculatorSetting`/`flushCalculatorSettings` (`services/offlineSettings.ts`) are NOT
involved in drops** — that queue only covers `defaultPaymentMethod`/`defaultPercentage` (the "Set
as Default" toggles), via `saveDefault` in `RolloutView.tsx`. Its imports sitting near the top of
the file are a red herring for this ticket.

**Fix:** the second failed attempt now mirrors what `scheduleSave` already does for every OTHER
calculator field the moment a save fails while `isOnline()` still (wrongly) reads `true` — it
flips `offlineModeRef.current = true` and calls `persistOffline` directly, bypassing
`saveDropsNow`'s own pre-flight `isOnline()` check (which is exactly the flag that lied the first
time). `persistOffline` already special-cases `dropPrice` back into its payload for this reason
(see the comment at its definition — "offline there is no second writer"), and once
`offlineModeRef` is `true` its own online-guard (`if (!offlineModeRef.current && isOnline())
return;`) passes, so the record is written to MMKV unconditionally. From there the existing
reconnect/`AppState`/60 s-sweep drain picks it up like any other offline edit — no new sync
mechanism was needed, only routing a second network failure into the one that already exists.

⚠️ **`offlineWorkIdRef` is always populated** (`ensureOfflineWorkForLead` runs on every bootstrap
path, not just the offline one — see the hydrate effect), so `persistOffline`'s own `if (!workId)
return;` guard is not a concern here; the record to write into always exists by the time a rep can
tap Secure/Decline.

⚠️ **Only the SECOND failure trips this.** The first failure still gets its immediate retry
unchanged — a single transient blip (the case the original comment described) still resolves
online, with no visible change in behavior and no calculator prematurely flipped into
offline-mode for the rest of the session.

**Not done (deliberately out of scope for this pass):** no rep-facing "saved on your device"
message was added for this path. `saveDefault` has one because it can `await` its own result
synchronously; `saveDropsNow` runs deep inside the hook with no promise threaded back through
`handleSetDrops` → `onDropChange`, and wiring that up is a larger, separate change. The rep
currently sees the drop persist correctly (it will sync), just without an explicit "pending sync"
indicator on this specific action — flag if that indicator turns out to matter in practice.

⚠️ **Needs a device confirmation on a genuinely flaky connection** (not just airplane mode) — kill
wifi mid-request, or throttle to induce a real timeout, and confirm the drop survives an app kill
and reappears after the sweep/reconnect drain.

## ✅ ROOT CAUSE: the `end price entered` log was MISSING ON ANDROID — the footer sat above the number pad (2026-10-21)

`screens/DynamicDealCenter/components/RolloutView.tsx`. Reported as an offline/sync bug ("logs generate on
Wi-Fi, this one is missing on mobile data"), then narrowed by the reporter to **Android only; iOS is fine**.
That second report is what identified it: it is not a network bug at all, and nothing in the offline queue
chain is platform-specific.

**The end price is logged on COMMIT, not on keystroke.** `logEndPriceEntered` runs from the field's commit
(the number pad's green ✓) and is also what calls `onPriceChange`. It is guarded by `loggedPriceRef`, so it
fires exactly once per distinct price.

| Platform | Pad | What the rep could do |
|---|---|---|
| iOS | system keyboard — a **native overlay** | It covers the footer. `Confirm Rollouts` is unreachable until Done is pressed, so the commit **always** happens first. The log is always written |
| Android | in-app pad — an **in-flow sibling view** | `NumPadProvider` is a passthrough on iOS but `AndroidNumPadProvider` (`mode='inflow'`) on Android, so the pad **shrinks the column** rather than covering it. The footer is pushed up and `Confirm Rollouts` is fully tappable with the pad still open |

So an Android rep could type `333`, skip the ✓, and tap `Confirm Rollouts` directly. The `rollout confirmed`
log fired (it is on the button) but `end price entered` **was never created** — nothing was lost in transit,
it never existed. The Forever Record then showed "CONFIRMED ROLLOUTS" with no price above it.

**Fix:** the footer is hidden while an entry is open (`entryOpen = numPadActive || systemKeyboardUp`), which
is deliberately the behaviour iOS gets for free. Both footers are gated — the un-confirmed bar *and* the
all-confirmed "Jobs Built" CTA, which occupies the same space.

- ⚠️ **This is the SAME SIGNATURE as ticket 1310 and a completely different cause.** 1310 lost a log that
  was sent (a timeout on mobile data); this one never produced a log at all. Confirming "rollout confirmed
  with no price above it" therefore does **not** on its own point at the network — check whether the log was
  ever created before investigating the queue. The first pass on this ticket went down the offline path on
  exactly that assumption.
- ⚠️ **Do NOT "fix" this by logging the price at Confirm time instead.** The commit is also what writes the
  price into the calculator via `onPriceChange`; moving the log would let the two diverge, and a Confirm-time
  log would report a price the calculator may not hold.
- ⚠️ **`numPadActive` alone is not enough.** A field can opt out with `numPad={false}`, and on iPad the
  numeric layouts come from the system keyboard — so the system keyboard is checked too. Same rule either
  way: if something is being typed, the commit has not happened yet.
- ⚠️ **An in-flow pad does not hide anything.** Any screen whose footer performs a commit-dependent action
  needs this gate; iOS will not reveal the bug, because there the overlay hides the footer by accident. The
  established pattern is `keyboardUp` in `DynamicJobBuilderScreen`.

Offline/queue notes from the first pass on this report (three real cellular defects, all still valid and
fixed): [`offline.md`](offline.md) § *A rollout log survived a Wi-Fi sync and vanished on mobile data*.

## Reopening a signature pad is an EDIT, online and offline (2026-10-21)

`widgets/modals/job-builder/AgreementSignatureModal.tsx` (online),
`widgets/components/dynamic-job-builder/agreement/AgreementSignatureCapture.tsx` +
`DynamicAgreementGenerator.tsx` (offline).

Reported: *"if one time I added the signature and open the modal again to edit it, the checkbox should
be selected as the rep already made it selected"*, and *"offline the rep can't edit again until he
presses Clear — please do the same flow for offline as well."*

**There are TWO signature pads and they had drifted apart.** `DynamicAgreementDialog` picks between
them: online the rep gets `AgreementSignatureModal`, offline they never reach it and the
device-rendered `DynamicAgreementGenerator` IS the signing screen, hosting `AgreementSignatureCapture`.
A change to one is not a change to the other.

| Pad | Was | Now |
|---|---|---|
| Online | `useEffect(() => setAgreedToESign(false), [activePad])` reset the tick on **every** pad open. Ink WAS restored (`setLiveInitials([...initialsPaths])`), so the rep saw their signature on screen with the consent cleared and `Save Mark` dead | The tick is pre-set when that pad already holds a saved mark |
| Offline | The caller kept only a rendered **PNG** (`signatureUri`), never the strokes, so the pad reopened **blank** — and the tick reset too. The rep had to redraw *and* re-agree, i.e. "can't edit until Clear" | The generator also keeps `signaturePaths` / `initialsPaths`, passes them as `initialPaths`, and the pad restores them and pre-ticks consent |

- ⚠️ **Ink on a saved mark IS the evidence of consent.** Saving is gated on `agreedToESign && padHasInk`
  in both pads, so a mark cannot exist without the tick having been given. Re-asking for it reads as the
  app having forgotten something the rep demonstrably did.
- ⚠️ **A FRESH pad still opens unticked, and consent stays PER MARK.** Initials and signature are agreed
  to separately, so each pad keys off *its own* saved ink — never the other pad's state, and never one
  document-level flag. That separation is deliberate; do not collapse it.
- ⚠️ **`Clear` drops the tick again** in both pads. Clearing discards the mark that carried the consent,
  so what follows is a new mark. Without this, Clear would leave a ticked box over an empty pad.
- ⚠️ **The restore effect is keyed on the pad OPENING only** (`[visible]` / `[activePad]`). Re-running it
  as the rep draws would re-tick a box they had just cleared and re-seed ink they had just discarded.
- ⚠️ **Offline, the PNG and the strokes must be cleared TOGETHER.** The generator's "Clear" drops both;
  dropping only the URI would leave a cleared pad reopening with the old ink.
- ⚠️ **`save()` snapshots `paths` BEFORE `clear()`** — `toDataURL` is async, so reading them inside the
  callback hands back an empty array. (`current` is always flushed into `paths` on stroke release, so the
  snapshot is complete.)
- The offline pad's PNG is still what the document renders; the strokes are kept **alongside** it purely
  so the pad can be reopened for editing. They are not sent anywhere.

### The default Pre Order Discount now logs `inheritanceSource`, so the portal can call it inherited (2026-10-21)

`utils/activity-log/rollout-log-meta.ts` (`logPreOrderDiscount`).

The Forever Record showed **"Inherited Payment Method — CK"** but the discount line underneath read only
*"In Home Pre Order Discount: 20%"*, with no indication it came from the rep's own default.

The meta already carried `isDefaultDiscount: true` (confirmed in the device DevTools payload), so nothing
was missing from the data — but the portal renders "inherited" off **`inheritanceSource`**, the key
`logPaymentMethodInherited` sets. The discount log never set it. Added:

```
inheritanceSource: 'default pre order discount'
```

- ⚠️ **`isDefaultDiscount` and `inheritanceSource` answer different questions and BOTH are kept.** The
  boolean says the value *equals* the rep's default; `inheritanceSource` says it *came from* there. A rep
  can deliberately pick 20% when their default is also 20% — equal, but not inherited.
- ⚠️ **Only on the SEEDED log** (`seeded && opts.isDefault`, where `seeded` is `oldDiscountPercentage == null`).
  A rep who taps a chip has chosen explicitly, so a *changed* discount is never inherited even when the
  number matches their default. Setting it on the changed log would relabel a deliberate choice as
  inheritance on a record the customer's pricing is justified from.
- ⚠️ **The value is a STRING naming the source**, matching `logPaymentMethodInherited`
  (`'default payment method'`, `'calculator duplication'`). Keep the vocabulary consistent — the portal
  switches on it.
- ⚠️ `utils/calculator/calculator-field-map.ts` also lists `isDefaultDiscount`, but that filters CALCULATOR
  payloads, not activity-log meta. It does not touch this key.
- **Not testable under jest here**: `rollout-log-meta.ts` imports `LoggerService`, which pulls in React
  Native and hangs the runner (the rule in the root guide). The four cases were verified by mirroring the
  spread logic: seeded+default sets the key; seeded+non-default, changed+default and changed+non-default
  all omit it.
- **Offline works the same way, and it is tested** (`tests/offline/discount-inheritance-offline.test.ts`).
  Two independent halves had to hold:
  1. **The key survives the queue.** `inheritanceSource` reaches `meta` through `restChange`, so it is an
     ordinary meta field - `stampOfflineLog` spreads the whole meta, the deep re-key swaps only id VALUES,
     the send-time resolver rebuilds the object, and a transport failure keeps the row untouched. Verified
     through queue → re-key → resolve → retry, including a lead/appointment/calculator created at a door.
  2. **`isDefault` is computed correctly offline.** It reads `user.defaultPercentage` from the Redux user,
     and `defaultPercentage` is itself a queued setting (`utils/offline-settings.ts`) applied optimistically
     by `applyPendingSettingsToUser`. So a default the rep sets at a door is already on the user when the
     discount is seeded. ⚠️ **Without that optimistic apply the key would silently vanish offline** - the
     log would still send, just without its inheritance, which is the quiet failure worth guarding.
  `rollout_and_drop` is queueable (only `system` is excluded) and is not in `ExcludedModuleTypes`, so the
  log both queues and keeps its `leadId`.
- ⚠️ **Portal side is NOT in this repo.** The key is now emitted; whether the portal renders
  "Inherited Pre Order Discount — 20%" needs a change there too. Confirm with the portal team before
  closing the ticket.

## A drop price saves on DONE, as `pending` — it is no longer lost (2026-10-21)

`screens/DynamicDealCenter/utils/drop-prices.ts` (rules) + `components/RolloutView.tsx` (UI).
Tests: `tests/offline/drop-pending-status.test.ts`.

Reported by a rep, about two real leads: *"It doesn't matter if I never hit secure or never hit decline,
I hit done on the keypad. These drops always have to save. It literally did not save on both those leads.
I dropped to cost price on both of them... there was no cost price displayed on my deal center and none on
tnt scoreboard."*

**They were right, and the cause was structural:** `openDrop` only set component state
(`setPendingDrop` + `setShowDropModal`). `onDropChange` was called **exclusively** from `secureDrop` /
`declineDrop`, so a drop that never reached an outcome was never persisted anywhere — and the modal is
deliberately non-dismissable (web parity), so the rep's only exits were Secure, Decline, or navigating
away and losing it.

**Now:** Done saves the row immediately as `status: 'pending'`, logs `drop price entered`, and the modal
gains an **X** that leaves it pending. Backend accepts `'pending'` (confirmed with the client).

### ⚠️ The trap this nearly introduced — pending must NEVER price the job

`autoSecureLastDrop` promotes `list.length - 1` to `accepted` when nothing is accepted, and it runs on
**Result Lead**. With pending rows saved and no guard, a price the rep merely *typed* would have become
the **SOLD** price, carrying a `drop price secured` log for an outcome that never happened. **That is
worse than the bug being fixed** — losing a drop costs a re-entry; selling an unagreed price does not
unwind. Three defences, deliberately overlapping:

| Guard | Where | Why it is not redundant |
|---|---|---|
| `resolveAutoSecureIndex` skips pending rows | `drop-prices.ts` | Silent correctness for every present and future caller |
| Result Lead refuses while `pendingDropIndex(drops) >= 0`, reopens the modal on that row | `RolloutView.openResultChooser` | TELLS the rep, instead of quietly picking a different row |
| `resolveActiveDownPayment` ignores pending | `drop-prices.ts` | A pending down payment must not seed the Investment Center |

- ⚠️ **`toDropPricePayload`'s `|| 'declined'` fallback is for a row with NO status** (legacy rows). A
  deliberate `'pending'` passes through untouched — coercing it there would file an unresolved drop as
  declined on the server and lose exactly the state this feature adds.
- ⚠️ **The X is only safe BECAUSE the drop is already saved.** Before this, any dismissal discarded the
  drop, which is why the backdrop is still inert and web passes no `onClose`. Closing now means "decide
  later", never "throw it away" — and it does **not** resolve the drop, so Result Lead stays blocked.
- ⚠️ **`openDrop` now passes a real `pendingDropIndex`**, so Secure/Decline UPDATE the pending row via
  `resolveDropTargetIndex` instead of appending a second one. Passing `-1` would double every drop.
- UI: amber `PENDING` chip beside the price, amber border, and the `Display` button reads **`Resolve`**
  while pending (it is the way back to Secure/Decline). `SECURED` / `LOCKED` are unchanged.
- ⚠️ `RolloutView.tsx` has a local state variable named `pendingDropIndex`, so the helper of the same
  name is imported **aliased** as `findPendingDropIndex`. Do not un-alias it.

### Offline: identical, and tested
`handleSetDrops` → `saveDropsNow`, which on `!isOnline()` calls `persistOffline` — that stores
`dropPrice` verbatim on the calculator payload. The `calculatorState` sync step then sends that payload
through `updateCalculator`, so the pending row reaches the server on reconnect with its status intact.

⚠️ **The `calculator` CREATE step deletes `dropPrice`** (`offlineLeadStore.ts`), so a drop NEVER rides the
create — it always arrives via `calculatorState`. Removing or reordering that step would silently lose
every offline drop, pending or not.

### Follow-up — the client's rule: ONLY the most recent drop may be pending

QA screenshot showed **3rd / 4th / 5th Dropped Price all PENDING at once**, each with a Resolve button.
Lance's answer, verbatim:

> *"No. The pending was to just handle the edge case of a sales rep not hitting a 'secure' or a 'decline'.
> We do not want to add a 'pending' button to the drop price screen. This means on a per job level only the
> most recent price drop could ONLY have pending status if the rep didn't hit a secure / decline."*

**Pending is a CATCH, not a workflow.** The first implementation let `openDrop` append blindly, so every
unresolved drop stayed pending and the screen filled with them.

| Was | Now |
|---|---|
| A new drop appended; older pendings stayed pending | `appendDrop` DECLINES every existing pending row as it appends. At most one pending, always the last |
| Superseded drops would have been silently left | They become `declined` and each gets its own `drop price declined` log (`supersededPendingDrops` tells the caller which) |
| Pending card was amber: amber border, amber price, amber `Resolve` button, `PENDING` trailing label | The card is styled **exactly like a declined one** (plain border, grey price, `Display` / `LOCKED`). The only marker is the `PENDING` badge beside the "*Nth* Dropped Price" title |
| `View` was shown on a pending drop | Hidden - there is nothing to show the customer until it is resolved |
| Result Lead raised a red `FlashMessage.error` | No toast. It opens the outcome modal on the pending drop, which IS the asked-for flow: *"when the rep presses Result Lead the last drop price will be shown there and he can secure or decline that one"*. `secureDrop` / `declineDrop` then continue into the chooser as normal |

- ⚠️ **A superseded drop is DECLINED, never discarded.** The rep showed that price to the customer, so it
  stays on the Forever Record. Dropping the row would lose a price that was quoted.
- ⚠️ **Entering a new drop IS an outcome for the old one.** That is the whole reading of Lance's rule -
  moving on without securing is a decline - so the transition is logged, not silent.
- ⚠️ **Do not re-style the pending card.** The client asked for it to look like a declined card with a
  badge; the amber treatment was the thing being rejected. The badge carries the state, nothing else.
- ⚠️ **`resolveAutoSecureIndex` still skips pending rows** and `hasUnresolvedDrop` still gates Result Lead.
  Those guards are unchanged and still load-bearing: with only one pending row possible, they are what stop
  it becoming the sold price by accident.
- **Online and offline are identical** - every rule above lives in `utils/drop-prices.ts` (pure, tested) and
  the queued payload still goes through `toDropPricePayload`, so a superseded drop syncs as `declined`.

### ⚠️ The 500 this caused on a device — the offline payload was sending RAW drop rows

Reported immediately after the above landed: the calculator write failed with a **500** on sync.
Cause, in `useDynamicCalculators.persistOffline`:

```
dropPrice: t.dropPrice || [],                                   // was: the INTERNAL row
dropPrice: toDropPricePayload(normalizeSingleAcceptedDrop(...))  // now: the six-key contract
```

The API accepts exactly `{ dropedPrice, status, paymentMethod, pricemarkup, downPayment, balance }`
(plus `_id` / `paymentMethods` when present). The UI's own drop row additionally carries `price`, which
`toDropPricePayload` strips — and **both online savers already mapped through it**, so the raw shape was
only ever sent from the offline path. That is why it never appeared in online testing.

⚠️ **This bug PRE-DATES the pending work** (the raw spread was already there); pending only made it
reachable sooner, because a drop now exists before an outcome is chosen. Do not assume a drop payload
problem is new code.

⚠️ **Every path that writes `dropPrice` must go through `toDropPricePayload`.** There are three:
`saveDropsNow` (drop-only save), `cacheTabsSnapshot` (cache) and `persistOffline` (queue). The contract
is pinned by KEY SET in `tests/offline/drop-pending-status.test.ts` › *the dropPrice wire contract*, so a
field added to a drop row in the UI can never leak to the API again.

**Still open — ask the client:** nothing forces a pending drop to resolve *before* Result Lead is
attempted; the gate only fires at that moment. If deals are expected never to carry a pending drop at
all, a sweep at Confirm Rollouts (or auto-decline on result) is the follow-up. Confirm Rollouts
deliberately does NOT block today: it confirms rollouts, and drops legitimately come after it.

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

## The "Jobs Built — Back to Tools" footer covered a focused field (End Price, Down Payment, drop price)

Ticket: *"the button is looking up and hiding the drop price field."* Tapping "+ Nth Drop" opens the
inline `showDropInput` price field and the keyboard comes up for its `autoFocus` — the fixed footer
below the scroll area (either "Confirm Rollouts" or, once every rollout is confirmed, "Jobs Built —
Back to Tools") visually lands on top of it.

**Not a z-index/overlap bug** — the footer is a correctly-structured sibling AFTER the scrollable
content closes, not an absolutely-positioned overlay.

### First attempt was too narrow — caught by the reporter, not by testing

The first fix only handled the ONE trigger the screenshot showed (tapping "+ Nth Drop"): a
`mainScrollViewRef.current?.scrollToEnd(...)` fired from that button's `onPress`. The reporter came
back with a SECOND screenshot showing the identical symptom on the plain **Rollout End Price** field
— a completely different `TextInput`, nowhere near `showDropInput`, which the first fix could not
possibly have reached. That disproved the "it's specifically the drop flow" framing and pointed at
the real scope: EVERY text input in `PremiumQuoteCard` (Rollout End Price, Add Down Payment, the
inline drop-price field) has this problem, because the screen has no keyboard-aware scrolling
anywhere, full stop — not because of anything particular to drops.

### Root cause and actual fix

This screen wrapped its content in a `KeyboardAvoidingView` with `behavior="padding"`, which shrinks
the whole column when the keyboard opens, but nothing inside ever scrolled the FOCUSED field back
into the shrunken space — so whichever input the rep just tapped (top-of-card End Price, or
bottom-of-card Down Payment / drop price) could end up under the footer or the keyboard depending on
where it happened to sit.

**Fixed by matching `DynamicDealEditScreen`'s own documented pattern** ("Deliberately NOT a padding
`KeyboardAvoidingView`" — see that screen's comment beside its own `KeyboardAwareScrollView`s):
- The outer `KeyboardAvoidingView` became a plain `View` — stacking it around a
  `KeyboardAwareScrollView` double-compensates for the keyboard instead of helping; the library
  already keeps whichever field is focused visible on its own.
- The main content `ScrollView` (`PeekAwareScrollView`) became `KeyboardAwareScrollView`
  (`bottomOffset={24}`, same as `DynamicDealEditScreen`'s usage) — done LOCALLY in this file, not by
  editing the shared `widgets/common/PhotoPeekScrollLock.tsx` component itself, which five OTHER
  screens (Pitchbook, RooflineDeck, RevRender, RevRenderSlots, Manage Photos) also depend on. Verified
  first that `RolloutView` never actually renders a `PhotoPeekPressable` (grep for it: zero hits) —
  the peek-lock scroll-freeze it exists for was never exercised here, so swapping this one usage is
  inert everywhere else. `PhotoPeekScrollLockProvider` was left in place (harmless, unused) rather
  than pulled out, to keep the diff to the actual bug.
- This automatically covers ALL THREE inputs — End Price, Down Payment, and the drop price field —
  with no per-field wiring, which is why the earlier `onDropInputOpened`/`scrollToEnd` approach was
  abandoned rather than extended: a hand-rolled scroll target for each field would have to know each
  one's position and re-derive it if the card's layout ever changes, where `KeyboardAwareScrollView`
  tracks whichever input is ACTUALLY focused automatically.
- Nothing else about `showDropInput`/`openDrop`/the equality-rejection rule above, or the OTHER
  `KeyboardAvoidingView` in this file (inside `DropOutcomeModal`, its own separate `Modal` — untouched
  and correctly still using `behavior`, since that one has no `KeyboardAwareScrollView` inside it),
  changed.

⚠️ **If a future report says a field STILL hides under the keyboard/footer here, do not re-add a
padding `KeyboardAvoidingView`** — that is the exact regression this fix removed. Check instead
whether the new field is actually inside this `KeyboardAwareScrollView`, or whether it needs its own
`bottomOffset` tuning.

Not verified on a device. Smoke test: open a rollout, focus Rollout End Price, Add Down Payment, and
the "+ Nth Drop" field one at a time — each should stay fully visible above the keyboard with no
footer button overlapping it.

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

### REVUIUX-519: funding ownership is now the server's `calculatorId` (supersedes the device pin above)

Source: backend guide `FUNDING-CALCULATOR-OWNERSHIP-MOBILE.md`. `JobFunding` carries a nullable `calculatorId`; the server
claims it on `PUT /lead/v1/:leadId/funding`, moves it if no row is *settled* (charged card / collected cheque — an approved or
activated loan is NOT settled), and answers `409 data.code = FUNDING_SETTLED_ON_OTHER_CALCULATOR` otherwise.
- **Deleted `utils/funding-owner.ts` and every `Storage` `funding-owner:<leadId>` read/write.** Replaced by the pure
  `fundingBelongsToCalculator(record.calculatorId, calculatorId)` in `DynamicDealCenter/utils/funding.ts` (null = unclaimed = ours).
- **Send `calculatorId` on every write**: `useFunding.savePayments` adds `logCtx.calculatorId` (Result Lead sheet and My Deals edit);
  the offline queue (`saveOfflineFunding` body → `offlineLeadStore` `'funding'` step) carries it too.
- `FundingRecord.calculatorId` is typed; `FundingError.code` is read from `data.code`; the 409 is its own kind
  `settledOnOtherCalculator` (warning flash, **no refetch / no retry**). ⚠️ Match on the code, never the message; a bare 409 is still `stale`.
- ⚠️ **The hard block is gone.** `handleResultJob` no longer refuses a Sale when another calculator's funding is submitted (and the
  `fundingBlock` `ConfirmDialog`s were removed from both render branches). A same-owner / unclaimed submitted record opens on the
  Funding screen (collected money locked, financing swappable); a different owner opens the normal sheet unhydrated — the save then
  re-scopes, or the server's 409 text is shown in the sheet's save error.
- ⚠️ A re-scoping sheet starts from fresh rows (per the backend guide); it does not copy the other calculator's financing rows across.
- ⚠️ **Do NOT build the "money already collected" carry-over/refund flow** — product decision still open; the 409 is the placeholder.
Tests: `__tests__/utils/funding-owner.test.ts` (gitignored dir).

### Follow-up: collected money pins the lead to its calculator (fully-financed funding pins nothing)

Ticket: *all calculators fully financed → each may be resulted; once a down payment is received, only the calculator that took it may be resulted.*
`handleResultJob` (CRLF) now checks `fundingPinnedToOtherCalculator(record, calculatorId)` (`utils/funding.ts`: `record.calculatorId` is a
different calculator AND `hasCollectedMoney` = any row `charged || collected`, mirroring the server's `isSettled`) and shows the
`fundingBlock` `ConfirmDialog` ("Down payment already collected") instead of opening the sheet. Sale only; a lookup failure falls through.
⚠️ A lender decision / approved loan is NOT money, so financing never pins. ⚠️ The server still enforces it (409
`FUNDING_SETTLED_ON_OTHER_CALCULATOR`); this is the early, friendly gate. ⚠️ Funding is ONE record per lead (`JobFunding` unique on `leadId`):
financing resulted on calculator B *moves* the record from A rather than keeping two — true parallel funding per calculator needs a backend change.
Both render branches carry the dialog — keep them in step.

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

## REVUIUX-391: "How would the homeowner like the signed copy?" prompt before Generate Agreement

Ticket: the signed agreement went only to the rep's email although the lead had a phone and email. Asked for a screen (Email / Text, editable, pre-populated from the lead) shown at **Generate Agreement**, in person and remote alike.

- `AgreementDeliveryPrompt` (`widgets/modals/job-builder/`) reads `GET pdf-reports/v1/agreement/:leadId/delivery-preference`, and on **Send via Email/Text** PUTs the answer **to the lead**. Generation is gated on that save. The backend reads it at send time from both finalize paths (`PUT outcome` in person, `RemoteAgreementService` remote), so nothing is re-sent at signing.
- Rules are in pure `utils/agreement-delivery.ts` (reuses `remote-signer-contact` validators, so the prompt and Send Remotely agree on what is deliverable). A stored answer wins over lead data on a second Generate.
- Classic JB: `SummarySection.handleGenerateAgreement` now opens the prompt and the old body is `runGenerateAgreement`. Dynamic JB: `DynamicAgreementDialog` holds the preview request until `deliveryReady`.
- ⚠️ In the dynamic dialog the prompt is `inline` (absolute overlay), NOT a second native `Modal` - the dialog is already one. In `SummarySection` the method dialog is dismissed first (350 ms) before the prompt shows.
- ⚠️ Skipped offline / for an offline-minted lead (the PUT cannot succeed); the backend default (phone AND email) applies. Not queued - decide with product if that matters.
- ⚠️ The unused channel's contact is sent too (server fallback), but only if itself valid - the server 400s on a partial number even for the channel not chosen.
- No "Both" option (matches the design; backend question still open with the reporter). `agreementSent.fellBackToOtherChannel` is NOT surfaced: this app has no feedback screen reading `agreementSent`.
- ⚠️ Item 1 of the ticket (junk folder) is a comms-service SPF/DKIM/DMARC matter; nothing in the app fixes it.

### Follow-up: prompt restyled to the signing sheets; keyboard no longer covers the field

- Type scale/colours now match `AgreementRemoteSignModal` (green `#4CBB17`, ink `#1C252E`, 10px uppercase labels, 50px inputs, 54px buttons). ⚠️ The typed value is `fontWeight: 'normal'` (not bold) - do not "match" the sheet's 600 here.
- ⚠️ Keyboard: `KeyboardAvoidingView` with `behavior` undefined did nothing on Android, and a `Modal` is its own window so `adjustResize` does not reach it. The backdrop is padded by the `Keyboard` event height instead (works for both the Modal and the `inline` overlay).

## "How is this being paid?" is a 3-option dropdown

Ticket: the two radio cards truncated "Down Pay…". Now a `DropdownChoice` (`components/funding/DropdownChoice.tsx`, expands IN PLACE — never a nested Modal) with **No Down Payment / Down Payment / Paid in Full Upfront**, titles never truncated. Used by `ResultJobModal` and `DynamicDealEditScreen`; `SegmentedChoice` is no longer used by either.

- ⚠️ **"No Down Payment" is not a third wire structure.** It is `payMode === 'split'` plus a UI-only `noDown` flag (`PayStructure`, `payStructureOf` in `utils/funding.ts`): the Down Payment group is hidden, down rows are cleared to `''`, and the balance carries the whole contract. An entirely unfunded down row is already exempt in `confirmBlockers`, and `toUpsertRows` drops zero rows — so nothing downstream changed.
- On reopen, `inferNoDownPayment(record)` restores it for a saved split deal with no funded down row. The flag is not persisted.
- Once money has moved (`structureLocked`) the other options are disabled and explain why, same as before.
- `structureHint` takes a 4th `noDown` arg.

### Result Lead opens on "No Down Payment" (the Confirm warning was REMOVED)

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

## Lowe's leads see ALL payment plans; other leads never see Lowe's

Ticket: *"a Lowe's lead only shows the Lowe's payment plans — we need Lowe's plan, GreenSky and all other plans inside it; other leads must not show the Lowe's plan."*

- `buildPricing` (`DynamicDealCenter/hooks/useDealPricing.ts`): `relevant` is now every plan for a Lowe's lead and the non-Lowe's plans for everyone else (was Lowe's-only vs non-Lowe's-only). The empty-picker static fallback now triggers when the response has NO Lowe's plan (`!relevant.some(isLowesPlan)`), not when it is empty.
- ⚠️ The DOWN-PAYMENT methods (`outcomeDownPaymentMethods`) and the default (`lowes_ach`) stay Lowe's ACH / CC only for a Lowe's lead; only the financing picker widened. Do not widen those too.
- Static fallback (`utils/calculator/lowes-payment-util.ts`): `getRolloutPaymentCategories(true)` = Lowe's basics + "Lowe's Plan" + the standard GreenSky / Wells Fargo / Concora groups (standard "Basic Options" check/cards omitted); `getDropAddPlanCategories(true)` likewise. Non-Lowe's output is unchanged.

### Follow-up: last plan in the Payment Plan sheet sat under Android's nav bar

Ticket: *"the last plan name is merged with the bottom bar."* `PaymentPlanModal` (`DynamicDealCenter/components/RolloutView.tsx`) is a bottom sheet inside a native `Modal`, whose safe-area inset reads 0, so the scroll content ran under the three-button bar. Its `ScrollView` now pads `14 + useBottomInset()` at the bottom. ⚠️ Padding goes in `contentContainerStyle`, not `style`. `DropAddPlanModal` and the `CalculatorSummary` picker are centred cards and need no inset.

### Follow-up: focused job-builder field half hidden by the number pad

Ticket: *"the selected field is slightly hidden by the keyboard — it should go up a bit more."* The tab's `KeyboardAwareScrollView` (`widgets/components/dynamic-job-builder/DynamicTabRenderer.tsx`) used `bottomOffset={24}`, too little for a field's floating label + rounded border above the in-app number pad. Now `72`. ⚠️ Raise this number, don't add a second scroll mechanism; `DynamicDealEditScreen` keeps 24 (not reported). Not verified on device.

### Follow-up: raising `bottomOffset` did nothing — the number pad needs its own scroll-into-view

*"still same, the field is hidden."* Root cause: `KeyboardAwareScrollView` scrolls from KEYBOARD frame events, and the in-app number pad (`NumPadProvider`, in-flow) emits none — it only shrinks the scroll frame, so a field near the bottom stayed half under the pad whatever `bottomOffset` was (the 24 → 72 change above is cosmetic for the system keyboard only).
- New `hooks/useNumPadScrollIntoView.ts`: when a field takes the pad (`useNumPadTarget`, new context exported from `widgets/common/keyboard/NumPad`, identity changes per field), after 260 ms it measures the focused input (`TextInput.State.currentlyFocusedInput`) against the scroll view's window bottom and `scrollTo`s the shortfall + 24pt. The current offset comes from a `collapsable={false}` wrapper View around the scroll content (`contentRef`) vs the scroll view's window y — NOT `onScroll`, because `collapsingScrollProps` is spread last and may own `onScroll`.
- Wired into `DynamicTabRenderer` (job-builder tabs). ⚠️ Any other `KeyboardAwareScrollView` form with numeric fields has the same gap; reuse the hook (pass the content top padding) rather than tuning `bottomOffset`. Not verified on device.

### Follow-up: focused field still touching the pad's top edge

After the scroll-into-view hook the field scrolled up but its bordered box still touched the pad. The hook measures the TextInput, not the box around it (the box reaches ~40pt lower), so the default margin in `useNumPadScrollIntoView` went 24 → 64.

### Follow-up: blank gap under Cancel in the Remote Agreement sheet (keyboard up)

Ticket: *"extra space on the remote agreement screen."* `AgreementRemoteSignModal` shrinks the sheet above the keyboard with `KeyboardAvoidingView` AND its `KeyboardAwareScrollView` (insets mode) also extended the scrollable area by the keyboard height, so the keyboard's height was counted twice - a large empty strip under Cancel. The scroll view now takes `extraKeyboardSpace={-keyboardHeight}` (`useKeyboardState`), which cancels the reserved bottom space (the library only uses that prop for the reserved space; scroll-to-focus still reads the real keyboard height). ⚠️ Same double-count exists wherever a `KeyboardAvoidingView` wraps a `KeyboardAwareScrollView` (e.g. `CoCFormModal`, `RoofWaiverModal`); not changed - not reported. ⚠️ `keyboardHeight` is React state, so the first frame of the first keyboard show can still reserve the space briefly. Not verified on device (iOS).

### Follow-up: dead space between Next and the number pad (dynamic job builder)

Ticket: *"remove all the extra space between the Next button and the keyboard."* The `DynamicJobBuilderScreen` footer (Back / Next / Complete) kept `paddingBottom: insets.bottom + 16` while a keyboard or the in-app number pad was up, but they sit between that bar and the screen edge, so the nav-bar/home-indicator clearance was pure gap (~60pt on a three-button Android bar). The footer now uses `paddingBottom: 12` when `useNumPadActive() || useKeyboardState().isVisible`, else the original value. Same idea `CalculatorView` already uses for its tabs footer. ⚠️ The `isVisible` half covers the system keyboard (iOS, text fields). Not verified on device.

### Follow-up: the Remote Agreement gap came back on the FIRST open only

`extraKeyboardSpace={-keyboardHeight}` used `useKeyboardState`, which is still 0 when the keyboard first shows after the modal mounts, so the reserved space was not cancelled until the second open. `AgreementRemoteSignModal` now keeps a module-level `lastKeyboardHeight` (a `KeyboardEvents` `keyboardDidShow` listener registered at import, i.e. at app start) and uses `-(keyboardHeight || lastKeyboardHeight)`. ⚠️ If no keyboard has been shown yet in the session, the first open can still show the gap; different keyboard types (email vs phone) differ in height, so the cancel can be off by the difference. Not verified on device.

### Follow-up: remaining white strip under Cancel (Android, keyboard up)

The sheet's scroll content kept `paddingBottom: max(insets.bottom, 24)` while the keyboard was up; the nav-bar clearance sits under the keyboard, so it was dead space. `AgreementRemoteSignModal` now uses `12` while `useKeyboardState().isVisible || useNumPadActive()`, else the old value. ⚠️ Keep the unkeyboarded value: it is the real home-bar clearance.

### Follow-up: white band between the Result Lead card and the number pad

Ticket: *"remove the extra space between the keyboard and the outer box."* `ResultJobModal`'s card was centred (`justifyContent: 'center'`) in the column the in-flow number pad leaves, so it floated with a band above and below. A small `PadAwareCenter` host (inside the `<Modal>`) now uses `useNumPadActive()`: pad up => `justifyContent: 'flex-end'` + 8pt bottom, so the card sits on the pad; pad down => centred as before. ⚠️ The hook MUST run inside the Modal tree - the patched `Modal` has its own `NumPadProvider`, so a call in `ResultJobModal` itself would read the app-root provider and never fire. Not verified on device.

### Follow-up: the focused Down Payment amount box was half cut off by the number pad

`ResultJobModal`'s body was a plain `ScrollView`, which never scrolls for the in-app pad, so a field near the bottom stayed half under it. It is now `NumPadScrollView` (new, `widgets/common/NumPadScrollView.tsx`: a `ScrollView` + content wrapper + `useNumPadScrollIntoView`; see `app-wide.md`). ⚠️ It is a COMPONENT, not a hook call in the screen, because the hook reads the nearest `NumPadProvider` and the modal has its own - a hook in `ResultJobModal` itself would read the app root's and never fire. Reuse it for any other modal body with numeric fields. Not verified on device.

### Follow-up: Lowe's plan row — name overlapped the SELECTED badge and radio (drop "Secure This Price" modal)

A long plan name (`6M at 0% APR — Equal Payments`) plus the `SELECTED` badge sat on ONE non-wrapping row inside the `flex: 1` text column of the financing rows in `DropOutcomeModal` (`RolloutView.tsx`), so the badge was pushed under the radio. The name is now `flex: 1, flexShrink: 1` and may wrap to 2 lines; `SELECTED` moved to the price line (`$50 /mo [SELECTED]`), which has room. ⚠️ A text next to a badge in a row needs `flexShrink: 1` on the text and a non-shrinking badge. The basic-method row (lead's own method) keeps its badge on the label row: that row has `flexWrap: 'wrap'`, so it wraps instead of overlapping. Not verified on device.

### Follow-up: "+ 1st Drop" input hidden under the number pad

Ticket: *tapping the 1st drop shows the price input and the keyboard at once, but the input is under the keyboard until the rep scrolls.* The inline drop input (`autoFocus`, `NUMERIC_KEYBOARD`) uses the in-app number pad, which `KeyboardAwareScrollView` (keyboard-frame driven) never scrolls for. The rollout column in `RolloutView.tsx` now runs `useNumPadScrollIntoView` (scroll ref + a `collapsable={false}` wrapper around the quote card, content top 16) so the focused drop / end-price / down-payment input is scrolled clear of the pad. ⚠️ This screen is not inside a `Modal`, so the hook in the screen component reads the right (root) provider - unlike modal bodies (use `NumPadScrollView` there). The hook waits 260 ms, so an `autoFocus` field that mounts a frame after the tap is still caught (it re-runs when the target attaches). Not verified on device.

### Follow-up: rollout cards show "$0 /mo + method" for basic methods (web parity)

Web's In-Home Pre Order and 1 Year cards always show a monthly row - `$0 /mo` + the method label (`Check (Bank Fee: 0%)`) - when the method is not a financing plan. Mobile hid the In-Home monthly when it was 0 and showed the hint "Pick a financing plan to show a monthly" on the 1-Year card. Now: `RolloutView.tsx` In-Home card always renders `$X /mo` + `planLabelOf(plans, method)` (dark ink like web, was light blue); `OneYearMonthlyPlan.tsx` renders `$0 /mo` (green) + the resolved plan label instead of the hint, plus the web's helper line (`Mirrors In-Home selected plan · pencil overrides` / default / custom variants). ⚠️ NOT ported: web's "Set as Default" toggle on the 1-Year card (mobile has the `isDefault` field on `OneYearMonthlyValue` but no UI/persistence for it). ⚠️ `$0` here means "no financing term", not "nothing owed" - `rolloutResult.monthly` is still 0 for basic methods. Not verified on device.

### Follow-up: a 1-Year plan picked on "Default" becomes the LEAD's default for every calculator

Ticket: on the 1 Year Program card, with **Default** selected, the pencil pick should apply to all of the lead's calculators until the rep changes it, and stop applying where the rep changes it.
- `OneYearMonthlyPlan.tsx`: the pencil on Default now calls `commit('default', key, true)` => stored `{ mode: 'default', planKey, isDefault: true }` (pencil on Match/custom still stores `custom`). `RolloutView.leadOneYearDefault` = the plan of the first calculator with `oneYearMonthlyPlan.isDefault`; it is passed down as `leadDefault`.
- A calculator INHERITS it while it has nothing stored, or a bare `Default` (`mode: 'default'`, no `isDefault`): display uses `leadDefault.planKey` and an effect persists it (`onChange`) so a calculator added LATER, or one the rep has not opened, still carries it. Explicit **Match**, a **custom** pick, or its own default pick are the rep's decision for that calculator and are never overwritten; that is how the default "stops reflecting" there (clicking Match clears `isDefault`).
- ⚠️ The lead default is derived from the calculators themselves (no extra field, nothing on the user profile), so it lives and dies with the lead; if every `isDefault` calculator is changed, the default is gone. ⚠️ Only the CURRENTLY selected calculator renders, so other calculators' stored `monthlyPayment` is refreshed when each is opened (the effect only runs mounted); nothing else reads that field today. ⚠️ Unrelated to the profile-level "Set as Default" (payment method) toggle. Not verified on device.

### Calculator Summary: number-pad typing lag (`BufferedTextInput`)

Ticket: *"inside the calculator it still lags with the custom num pad."* The Summary's money inputs (End Price, pre-order Down Payment, Drop price, current Down Payment) wrote parent state on EVERY key (`priceText` / `dropValue` / `preOrderDownPayment` / `handleCurrentSetDownPayment`), re-rendering the 2.4k-line `CalculatorSummary` per digit and delaying the next tap. They now use `widgets/common/BufferedTextInput.tsx`: a local `value`, parent notified 180 ms after the last key and flushed on blur / submit / end-editing.
- ⚠️ **Blur/submit/endEditing handlers receive the flushed text as a 2nd arg** and must use it - parent state is still stale in that same tick (`handlePriceBlur(text?)`, drop `onSubmitEditing`/`onBlur`, pre-order down-payment `onBlur`). Reading `dropValue`/`priceText` there reintroduces a lost last digit.
- Parent value changes sync into the field only when no edit is pending. Live totals now trail typing by ~180 ms by design. The form fields (`InputField`, `PricingInputField`) already buffered locally. Not verified on device.

### Calculator form inputs: typed value flipped bold -> regular
Ticket: the quantity box (`InputField` in `dealcenter/SharedElements.tsx`, e.g. Gutter "5\" Gutter/DS/E") showed digits in Black weight while typing and in a regular weight once the number pad's `setNativeProps({ text })` / re-render landed, so the value visibly changed. The input is now `font-normal` (the value never needs bold); the label above it keeps `font-black`. ⚠️ Don't put a heavy `font-*` on a number-pad field: on Android the native-text write can resolve the face differently from the initial render. `PricingInputField` and the Summary price boxes were left as they were - change them the same way if they show the flip. Not verified on device.
- Applied: `InputField`'s `TextInput` className is now `flex-1 h-11 text-sm font-normal text-[#1C252E]` (was `font-black`); the floating label keeps `font-black`.

### Follow-up: quantity / price inputs pinned to Public Sans Regular
`font-normal` alone did not stop the typed digits showing bold on Android, so `InputField` and `PricingInputField` (`dealcenter/SharedElements.tsx`) now pass `REGULAR_INPUT_FONT` (`fontFamily: 'PublicSans-Regular'` + `fontWeight: 'normal'` - the pair `docs/claude/app-wide.md` requires) as an explicit style, and `font-black` is gone from `PricingInputField`. ⚠️ Keep the weight in `style`, not only a className: it is what the native text view reads when the digit is written. Labels stay bold. Not verified on device - if digits are STILL heavy, the cause is outside these two components (check the field is not another input).

### 1-Year monthly plan picker - "My default plan" UI
`OneYearMonthlyPlan.tsx` picker sheet extended using only the existing sheet tokens (green #4CBB17 + its tint, original 9-16px font sizes, 12px-radius cards, no new palette). While `mode === 'default'` it shows a **MY DEFAULT PLAN** card at the top (star, `provider + plan code · $X/mo`, `shortlabel`/`displayMonths`, **Change**, "Pre-selected on every new deal.") and a **MY DEFAULT** badge on the matching row (`effectiveDefaultKey`). `Change` only scrolls to the plan list - picking a row while on Default still calls `commit('default', key, true)`, so the lead-wide default behaviour is unchanged. The card is hidden in Match/custom mode (no default is being edited). Plan code = label text before `(`. Not verified on device.

Picker rows: ALL plan labels are bold (900) - the selected-only-bold variant was tried and reverted at the user's request. Selection is shown by border/tint only.

## Job Builder summary — header faded / half-collapsed on iPhone after an agreement or order sheet is submitted

Symptom (iOS only): after submitting an agreement or order sheet on the summary tab, the "Job Builder" title + step
tracker looked blurred (opacity ~0.35) and/or slid partly up, though the list was back at the top.

⚠️ **Cause (diagnosed from the symptom, not reproduced on device):** `useCollapsingHeader` only updates its `collapsed`
value from ScrollView scroll events. The summary re-render lands the list at y=0 on iOS **without emitting a scroll
event**, so `collapsed` kept the value from the earlier scroll-down (opacity interpolates 1 → 0.35 → 0 with it).
- **`hooks/useCollapsingHeader.ts`** now returns `reset()` (snap open) and adds `onContentSizeChange` to `scrollProps`
  (re-opens when content stops being scrollable — `fitsWithoutScrolling` in `utils/collapsing-header.ts`).
- **`DynamicJobBuilderScreen.tsx`**: an effect re-opens the header on any `jobState` change while on the summary tab.
- If it still reproduces, log `collapsed.value` at the moment it is stuck and find which re-render skips the scroll event.

## Duplicated calculator tab read `FWrap (LG)` / `FWrap (SM)` instead of `⚠️ FWrap ⚠️`

Tab titles disambiguate by `totals.retail` (`computeDerivedTitles`): equal price → `⚠️ base ⚠️` on both; different price →
`(SM)`/`(LG)`. A duplicate has the same entries, so it must price the same — but `handleDuplicateTab` gave the copy
`computeTotals(entries)` (and `createRemoteTab` preferred the server's `c.totals`), while the source tab carried the totals
it was actually shown/saved with. Any difference made the pair read `(LG)`/`(SM)`.
- **Fix (`hooks/useDynamicCalculators.ts`):** the duplicate takes a deep copy of **`source.totals`** — sent in the create
  payload, kept over the server's echo (`extra.totals ?? c.totals ?? totals`) and used on the local fallback.
- ⚠️ Diagnosed from the symptom (the two tabs' totals were not compared on device). If a pair still shows `(SM)/(LG)`
  after duplicating, log `source.totals.retail` vs the copy's. The first edit of either tab recomputes totals from entries,
  so a genuine difference then (e.g. a changed value) correctly produces `(SM)/(LG)` again.

### Follow-up — a duplicate keeps the source's size suffix: `⚠️ FWrap (LG) ⚠️`

The totals fix above made the pair tie, but a tie rendered `⚠️ FWrap ⚠️`, dropping the `(LG)` the source was showing.
`computeDerivedTitles` (`utils/tab-naming.ts`): a tied-price tab now takes its suffix from the price rank when the group
has more than one price level, otherwise **inherits the suffix already in a group member's stored title**
(`⚠️`/`📦` stripped, must match `${base} (…)`). So duplicating `FWrap (LG)` gives both tabs `⚠️ FWrap (LG) ⚠️`.
- ⚠️ This supersedes the earlier "same price reads plain `⚠️ … ⚠️`" rule when a suffix exists. A tie with no suffix
  history (two fresh identical tabs) still reads `⚠️ FWrap ⚠️`.
- Test: `__tests__/tab-naming-duplicate.test.ts` (gitignored dir, local only).

## Calculator (Deal Center) — focused numeric field cut off at the bottom by the number pad

`CalculatorView.tsx`'s body was a plain `ScrollView`, so a field near the bottom (e.g. `7" Versa`) stayed half under the
tab footer / in-app pad — the pad emits no keyboard events, so nothing scrolled for it. The body now runs
`useNumPadScrollIntoView(bodyScrollRef, bodyContentRef, 16)` with a `collapsable={false}` wrapper around the content
(same wiring as `RolloutView`; see `app-wide.md`). ⚠️ Not inside a `Modal`, so the hook in the screen reads the right
provider. Not verified on device.

### Follow-up — My Deals colour filter is back on (`combination-color-filter.ts`)

Continues "My Deals hides a combination whose colour was never picked" (above). Ticket: *My Deals LeafFilter tab should
show only combinations that received values from the Deal Center; a valueless one must not display.* An empty
`Combination #3` (seeded `Versa` only) was showing in the edit wizard.

`isComboHiddenInDealEdit` had been stubbed to `return false` (`c4896aa`, "free hand") and the comment cleanup dropped the
note on how to restore it. It is restored to `editMode && !combo[ADDED_IN_EDIT_KEY] && !comboHasSelectedColor(combo, fields)`.
- Full write-up and traps: **`deal-edit-addendums.md`** § "the My Deals hide rule is back ON".
- ⚠️ Display only and edit-mode only; the Deal Center CREATE flow is untouched. A combination added this edit session
  (`_addedInEdit`) still shows, so Add Combination works. This deliberately reverses `c4896aa`.

### Follow-up — one universal Add Combination in My Deals

`DynamicTabRenderer.tsx`: in edit mode a single `UniversalAddCombination` (with a picker of every combination section)
replaces the per-section buttons, so a deal with no finished combination from the Deal Center can still add one
(tagged `_addedInEdit`). Details and traps: `deal-edit-addendums.md`, "ONE universal Add Combination in My Deals".

⚠️ **Placement:** the universal button renders ABOVE the first simple section (the "Extras" card, i.e. after the Grand Total
card), or at the end of the tab when there is none. `universalAddPlaced` is a render-time flag flipped inside the
`sections.map` in `DynamicTabRenderer.tsx` — keep the end-of-list fallback or a tab without a simple section loses the button.

⚠️ **No picker (later update):** clicking the universal button adds the combination straight away (first addable section with
nothing showing, else first with room) instead of listing sections; see `deal-edit-addendums.md`.

⚠️ **Placement (corrected):** the universal button goes after the last combination section, not above the first simple
section — see `deal-edit-addendums.md`, "Placement update".

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

### Follow-up — field notice host

`FieldNoticeModal.tsx` › `FieldNoticeHost` (mounted at the root of `DynamicTabRenderer`) now presents the "Important Notice"; fields publish to it instead of owning a Modal. See `deal-edit-addendums.md`, "the notice is now presented by ONE host".

⚠️ **Field notice, second pass:** `FieldNoticeModal.tsx` also keeps the OPEN notice at module level (`activeNotice`) until the rep dismisses it, and a freshly
mounted `FieldNoticeHost` starts open when one is pending — so a tab re-mount right after the pick cannot swallow the popup. Dev log
`[FieldNotice] pick { field, picked, fires, hasHost }` fires on every pick of a notice-enabled field (no line = the pick never reached the
notice code; `fires:false` = trigger-text mismatch; `hasHost:false` = no host mounted). Not verified on device; details in `deal-edit-addendums.md`.

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

### Rollout — COST / PAR / RETAIL tiles wrapped large values

- Symptom: a 6-digit retail (`$152,583`) wrapped onto two lines and the three tiles looked uneven.
- Fix (`RolloutView.tsx`, tiles block): tiles are `flexBasis: 0, minWidth: 0` with 6px side padding; the value is `numberOfLines={1}` + `adjustsFontSizeToFit` (`minimumFontScale 0.6`), so it shrinks instead of wrapping. Not verified on device.
- Drop / Result Lead buttons: fixed `height: 56` clipped the stacked icon + label + price (price spilled past the border). Now `minHeight: 64` with padding, and the icon sits in a row beside the "Result Lead" label with the price below. Not verified on device.
- **Removed**: the "No Down Payment" `ConfirmDialog` (and `noDownWarn`, the `acknowledged` flag on `goFunding`) is gone by request — no warning on Confirm; it goes straight to funding. The `inline` ConfirmDialog notes above are historical. Do not re-add.

### Result Lead: archive only plans that have actually started (`swapRowMethod` / `restoreRowPlan`)

- Ticket: switching Check/AMEX on a fresh row filled "ARCHIVED METHODS" with plans nothing was ever sent for. Archive = a safety shelf for financing / cards that are LIVE (link sent, decision, activated, charged, collected) so they can be reused on any job scope later.
- Root cause: `swapRowMethod` archived on `showsChip(r)`, which is `r.auto || hasLenderState(r)` — the auto-balance row counted. Now gated on `hasLenderState(r)` only; `restoreRowPlan` likewise only shelves the outgoing plan when it has lender state.
- ⚠️ Do NOT widen the gate back to `showsChip` / `auto`. Rows archived before this fix are not cleaned up. Not verified on device.

### Result Lead payment rows: back to ONE line per payment, short labels, no bank fee (supersedes the "one card per payment" ticket above)

- Ticket: the stacked Amount / Payment-method cards ate the screen. `PaymentRowsGroup` panel layout is again `[amount box][method box][✕]` on one line. The amount box is sized to its digits (`flexShrink: 0`, `minWidth: 84`; the input width grows with the typed length) so a balance like `$2,863` is never truncated; the method box takes the remaining width.
- Labels use the Investment Center shorthand via `shortMethodLabel`: Check -> `CK`, MC/VISA -> `CC`, `AMEX`, financing -> `compactPlanLabel` (`GS2511, 0% APR, 6M`). `stripBankFee` removes "(Bank Fee: x%)" from the dropdown options and archived entries too. Display only — the plan key / label sent to the server is unchanged.
- ⚠️ Plain layout (My Deals mockup) untouched. Not verified on device.

- Result Lead: choosing **Down Payment** in the structure dropdown now seeds its first (empty) down row in `selectStructure` (inserted before the balance row), so the method box shows without tapping "Add payment method". Only when no down row exists; removing it with ✕ still leaves the group empty. Not verified on device.

### Follow-up — Result Lead: picking "Down Payment" seeds its first row (`selectStructure`, `ResultJobModal.tsx`)

- Ticket: after choosing Down Payment the group showed only "Add payment method"; the rep had to tap it to get the first amount + method line.
- Fix: `selectStructure` inserts one empty `kind: 'down'` row (before the first `bal` row, so order stays down -> bal) when no down row exists.
- ⚠️ The `PayStructure` value for Down Payment is `'split'` (not `'down'`) — see `payStructureOf` in `utils/funding.ts`. ⚠️ Only seeds when none exists: removing the row with ✕ deliberately leaves the group empty. Not verified on device.
- Follow-up: the green PANEL box holding the Pricing / payment groups had tight padding (`14 / 16 / 6`); now `paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16` (`ResultJobModal.tsx`, the `isSale` panel). Not verified on device.
- Follow-up: the white Down Payment / Balance cards sat too far in from the green panel. Panel `paddingHorizontal` is now **8** (top 20 / bottom 16 kept for breathing room) and the white card (`PaymentRowsGroup` panel layout) side padding is 10 (was 12), so the amount + method line gets the width back. ⚠️ Do not raise the panel side padding again without checking the balance amount still shows every digit. Not verified on device.
- Follow-up: a huge amount (`31223321`) squeezed the method box to "…". The amount box is now `flexShrink: 1, maxWidth: 55%` (input width estimated at 9px/digit, `maxWidth: 100%`; read-only amount uses `adjustsFontSizeToFit`), and the method box keeps `minWidth: 96`, so the method name always stays readable. ⚠️ A very long typed amount scrolls inside its box rather than widening it. Not verified on device.
- Follow-up: the CLOSED method box (after selecting) shows only the financing plan CODE (`GS2511`) via `shortMethodLabel(..., codeOnly)`; the option list still shows `GS2511, 0% APR, 6M`. CK / CC / AMEX unchanged. The Balance and Down Payment groups share this code, so both read the same. Not verified on device.
- Follow-up (REVERTED by request): shortening the Down Payment option list (`options` -> `o.label`) through `shortMethodLabel` was undone; that list shows the raw labels again, e.g. "Check (Bank Fee: 0%)". Balance's category list is still shortened. Do not re-apply unasked.
- Follow-up: the Balance (category) option list now shows the FULL plan label (`plan.label`, e.g. "Check (Bank Fee: 0%)") exactly like the Down Payment list, by request. Only the dropdown lists; the closed method box still shows the short form. Not verified on device.

### Dynamic calculator: "Add This Job to Job Tracker" button removed

A resulted sale is added to the Job Tracker automatically, so `CalculatorView` no longer renders `JobTrackerButton` under the Job Summary (the import is gone; `components/JobTrackerButton.tsx` is now unused). The body ScrollView `paddingBottom` dropped from 140 to 24 — the tabs footer is a sibling below the ScrollView, not an overlay, so the old 140 was only dead space under the button.

- ⚠️ Legacy `widgets/components/dealcenter/CalculatorForm.tsx` still has its own add / go-to-tracker buttons (the non-dynamic Deal Center) — untouched. Not verified on device.
- Follow-up (supersedes the code-only note): the closed method box shows the Investment Center string again — `GS2511, 0% APR, 6M` (`compactPlanLabel`), not just `GS2511`. One line with `adjustsFontSizeToFit` (min 0.8) so it is not cut. `codeOnly` on `shortMethodLabel` is now unused. Not verified on device.

### Follow-up — My Deals Gutters tab: a gutter and its downspout are one numbered pair

Ticket: *with no data from the Deal Center the Add Details screen showed the "Downspout & Accessories" heading above the Add Combination
button; it should only show once a gutter combination exists and awaits its downspout, and the gutter and its downspout must carry the
same "Combination #N".* Gutters tab, **edit mode only**; create flow and every other tab are untouched.

- `utils/dynamic-job-builder/engine/gutter-pairing.ts` (new, pure, tested in `__tests__/gutter-pairing.test.ts`): `getGutterPairSections`
  matches only a tab whose id ends `__gutters` (or label "Gutters") that has a section labelled `/downspout/i` plus another combination
  section — anything else returns null and renders exactly as before.
- The universal Add Combination alternates: gutter shown-count > downspout shown-count → the next press adds the **downspout**, else a new
  **gutter**. `DynamicTabRenderer.tsx` `UniversalAddCombination.onAdd` uses `nextPairAddTarget`.
- The "Downspout & Accessories" heading (`CombinationSectionBlock` `hideLabel`) shows when the downspout section has a card OR is the next
  target (`shouldShowDownspoutHeading`); it is hidden on an empty tab and right after a downspout is paired. ⚠️ Existing downspout cards keep
  their heading — only the empty slot loses it. Flip that rule in `shouldShowDownspoutHeading` if the heading should vanish entirely.
- Numbering restarts per section on a pair tab: `renumberTabCombinations(..., restartPerSection)` and `comboIndexOffsets` = 0, so gutter #1 and
  downspout #1 both read "Combination #1". ⚠️ Other tabs still number continuously across sections.
- Section detection is by id/label, not by the hardcoded `section_…` ids in `gutter-roofline-description-generator.ts`.
- Two tests in `combination-numbering.test.ts` (colour-filter "nothing hidden" cases) were already failing before this change.

⚠️ **Pair-tab cards always carry their chip.** The Gutters sections had `showCombinationLabel: false`, so the boxes showed no "Combination #N"
(only the Grand Total's `#1`). On a pair tab `CombinationSectionBlock` now forces the chip (`pairLabelPrefix`): gutter boxes read
"Combination #N", downspout boxes "Downspout Combination #N". Other tabs still honour `showCombinationLabel`.

### Follow-up — My Deals Soffit: one Add Combination PER heading (supersedes the colour-less-combination hide)

Ticket: *Soffit showed an empty "Combination #1" under Nailer Build Out with no value from the Deal Center — then, on review, "revert to this UI":
keep Vinyl Soffit / Porch Ceiling SqFT / Nailer Build Out headings (and the Nailer placeholder card) as they were, but give each heading its own Add
Combination button instead of the generic one.*
- ⚠️ **The "hide a combination in a colour-less section" attempt was reverted** (`combination-color-filter.ts` is back to colour-only) along with the
  edit-mode "hide an empty section's heading" rule. Do NOT re-add either; the placeholder under Nailer Build Out is intended.
- `gutter-pairing.ts` `usesPerSectionAdd(tab)` (Soffit tab only). In `DynamicTabRenderer.tsx` that tab, in edit mode, renders no
  `UniversalAddCombination`; each `CombinationSectionBlock` shows its own button (`ownAddInEdit`) under its heading and adds to THAT section.
- In edit mode `handleAddCombo` now adds a **blank** `_addedInEdit` combination (`createBlankCombinationItem`), as the universal button did, so
  nothing is pre-selected. Create flow unchanged.
- Every other tab keeps the single universal button; the Gutters pair logic above is unaffected.

### Follow-up — My Deals Soffit: one Add Combination PER heading (supersedes the colour-less-combination hide)

Ticket: *Soffit showed an empty "Combination #1" under Nailer Build Out with no value from the Deal Center — then, on review, "revert to this UI":
keep the Vinyl Soffit / Porch Ceiling SqFT / Nailer Build Out headings (and the Nailer placeholder card) as they were, but give each heading its own
Add Combination button instead of the generic one.*
- ⚠️ **The "hide a combination in a colour-less section" attempt was reverted** (`combination-color-filter.ts` is back to colour-only) along with the
  edit-mode "hide an empty section's heading" rule. Do NOT re-add either; the placeholder under Nailer Build Out is intended.
- `gutter-pairing.ts` `usesPerSectionAdd(tab)` (Soffit tab only). In `DynamicTabRenderer.tsx` that tab, in edit mode, renders no
  `UniversalAddCombination`; each `CombinationSectionBlock` shows its own button (`ownAddInEdit`) under its heading and adds to THAT section.
- In edit mode `handleAddCombo` now adds a **blank** `_addedInEdit` combination (`createBlankCombinationItem`), as the universal button did, so
  nothing is pre-selected. Create flow unchanged.
- Every other tab keeps the single universal button; the Gutters pair logic above is unaffected.

### Follow-up — My Deals Soffit: a combination shows only if the Deal Center sent values (refines the per-heading Add Combination)

Ticket: *show a combination only when it received values from the Deal Center; otherwise just the heading with its Add Combination below.*
- `combination-color-filter.ts` `isSoffitComboEmptyInDealEdit` (+ `comboHasNoEnteredValue`; `''`, `0`, `'0'`, empty arrays/objects = empty). Layered
  ON TOP of `isComboHiddenInDealEdit`, which stays colour-only. Used only when `usesPerSectionAdd(tab)` (Soffit): `isComboShown` in
  `DynamicTabRenderer` (numbering, Grand Total) and `isComboHidden` in `CombinationSectionBlock` (via `ownAddInEdit`). `_addedInEdit` always shows.
- ⚠️ This is the generic "hide empty in a colour-less section" idea that was reverted for ALL tabs — it is deliberately Soffit-only now. Do not
  widen it without a ticket.
- ⚠️ A seeded `defaultValue` in a section's `defaultItem` counts as a value, so such a placeholder would show. Nailer/Vinyl/Porch have none today.

### Follow-up — the Soffit rules now also apply to the Fascia tab

Ticket: *same logic in the Fascia tab.* `usesPerSectionAdd` (`gutter-pairing.ts`) matches `__soffit` and `__fascia` (or those labels), so Fascia gets
a per-section Add Combination and shows a combination only when the Deal Center sent values (or it was added in edit). Nothing else changed; the
other tabs (Gutters pair, LeafFilter, Lighting, Gutter Guards…) are not matched.

### Offline parity — every Deal Center log the online flow writes is now written offline (2026-10-14)

Ticket: *logs generated online are missing when the same screen is used offline* (e.g. calculator `create` / `view`).
Cause: the offline path is a different code path (device record, no request), and several logs were written by a
**server hook or a success branch the offline path never reaches**. Queue mechanics: `docs/claude/offline.md` (activity logs section).

| Log | Online source | Offline (was → now) |
|---|---|---|
| `calculator` view | effect, gated `isBackendId(tab.id)` | never logged for a `calc-…` tab → gate also accepts `isClientId` |
| `calculator` create, first tab | bootstrap after `createRemoteTab` | the offline `'mint'` seed logged nothing → logs `isFirstCalculator` |
| `calculator` create (+ payment-method inherited) | `handleAddTab` after `createRemoteTab` | offline fell to a `local-…` tab with no log (and a doomed request) → `deviceTabFrom` mints a `calc-…` tab, saves it to the device record, logs both |
| `calculator` duplicate | the SERVER writes it from `duplicateLog` | no request offline, so no log → `logEvent('duplicate', …)` + payment-method inherited |
| `auto_rename` | `flushSave` / `saveDisplacedSiblings` | `flushSave` skips non-server ids → same title comparison in `persistOffline` (baseline set at hydrate / create) |
| `funding` payments saved | `useFunding.savePayments` | `goFunding` offline path skipped the hook → `logFundingPaymentsSaved` |
| `funding` check collected | `useFunding.markCheckCollected` | `handleMarkCollected` offline → `logFundingCheckCollected` |
| `funding` submitted | `useFunding.submit` | queued submit in `handleBuild` → `logFundingSubmitted` |

Already fine offline (no connectivity gate): field entry, rename, clear section, rollout/drop (`RolloutView`), job-builder logs,
rollout summary, result-lead logs. The ids in these logs may be device ids; the activity-log queue holds each log until its
lead / appointment / calculator has a server id and swaps them (`setActivityLogIdResolver`).

- ⚠️ **Any new Deal Center log must be written by the UI handler, not by a service/server hook** — the offline branch of that
  handler is where it silently goes missing. When you add an online log, look at the offline branch of the same handler.
- ⚠️ Online funding link / card / loan / sync actions are not logged offline because the actions themselves are blocked offline (`useFunding.run`).

## REVUIUX-444 — the 1 Year Program default plan is REP-scoped (`defaultOneYearPaymentMethod`)

Contract: `REVUIUX-444-MOBILE-HANDOFF.md`. Backend adds `user.defaultOneYearPaymentMethod` (a plan key, sibling of `defaultPaymentMethod`), written via the
SAME `PUT /company/user/update-default-lf-calculator-settings` (`null` clears, omitted keys untouched, key NOT validated server-side), and stamps new
calculators with `oneYearMonthlyPlan = { mode: 'default', planKey: <rep key>, apr/monthlyPayment/grandTotal: 0, isDefault: false }`. The handoff's open
question (rep- vs lead-scoped) was settled by the ticket text: *"the plan a rep selects as default must reflect in ALL leads"* => **rep-scoped**.
- ⚠️ **Supersedes the lead-wide `isDefault` scan** (`RolloutView.leadOneYearDefault`, `InvestmentCenter` `leadOneYearDefaultKey`, `OneYearMonthlyPlan`
  `leadDefault`/`inherits`): all removed. The app never writes `isDefault: true` any more (always `false`); the user record is the source of truth.
  A legacy calculator saved with `isDefault: true` is re-stamped to `false` and follows the rep default; with no rep default it falls to the 9.99% chain.
- `utils/one-year-default.ts` (pure, `__tests__/utils/one-year-default.test.ts`): `resolveRepOneYearKey` (published FINANCING key or null — an unknown,
  unpublished or cash key is treated as no default), `resolveOneYearDefaultKey` (rep 1 Year default > In-Home default > 9.99% > any APR > first
  financing > method), `oneYearNeedsResync`. Used by `RolloutView` AND `InvestmentPanel` so the two screens cannot drift.
- Write path: `SettingsService.updateCalculatorsSetting` type + `offline-settings.ts` `FIELDS`/`PendingCalculatorSettings` gained the key, so the offline queue,
  optimistic merge (`useAuth` -> `applyPendingSettingsToUser`) and replay-on-reconnect work with no other change. `RolloutView.setOneYearDefault` goes through
  the existing `saveDefault` (queue -> flush -> `refreshUser`), exactly like the In-Home star.
- `OneYearMonthlyPlan.tsx`: `Default` mode is LIVE (`resolvedKey = defaultKey`), so changing the rep default moves every deal still on Default; Match / custom picks
  stay. A sync effect re-stamps a Default calculator whose `planKey`/monthly/total is stale (the backend stamp has monthly 0 — "the app recomputes on first render").
- ⚠️ **Fixes the two QA bugs.** Bug 1 (Match then Default lost the pick): `commit` no longer writes `isDefault` from the calculator. Bug 2 (could not set a default
  from Match): the **MY DEFAULT PLAN** card now shows in EVERY mode (or a dashed "No default set" hint) and each plan row has a **star** that sets / clears the rep default
  independent of mode. Picking a row is always a one-off `custom` pick; the star never switches the calculator's mode.
- ⚠️ Not done: the web Deal Center (own ticket per the handoff). The endpoint was not exercised over HTTP by the backend dev — check once on staging. Not verified on device.

## Scenario Simulator is back on the Funding screen (reverses its removal in `ea337a9`)

Ticket: *"un-comment the finance flow for the funding payment methods and the scenario simulator UI"* (client
message had hidden it). It was never commented out — `ea337a9` **deleted** `ScenarioSimulator.tsx`,
`FundingService.mockProvider` / `FundingEndpoints.mockProvider`, `useFunding.mockProvider` + `mockDisabled`,
and the `onSimulate` / `mockDisabled` props. All restored from that commit's parent, in the current style.

- `funding/ScenarioSimulator.tsx` renders under the attempt history in `FundingView` (Approve full / Approve
  partial / Decline for loans, "Homeowner saved their card" for cards; checks never appear). Copy now says
  **Refresh at the top** (the button was "Sync" when it was written).
- Wired through both Funding hosts: `ResultJobModal` and `DynamicDealEditScreen` pass
  `funding.mockProvider` as `onSimulate` and `funding.mockDisabled`.
- ⚠️ **`POST …/{pid}/mock-provider` only works when the server runs `FUNDING_PROVIDER=mock`**; otherwise it
  404s and the panel switches to "Unavailable". A tap RECORDS an outcome only — the rep must Refresh for it
  to land.
- ⚠️ The reason it was removed still stands: a tap writes an invented approval/decline onto a real funding
  record. `SCENARIO_SIMULATOR_ENABLED` in `utils/funding.ts` is the one switch — set it `false` (or tie it to
  `__DEV__`) before a build real reps get.
- Not verified on device; typecheck only.

### Follow-up: financing rows show the full stepper again; only the Submit gate stays bypassed

Ticket: the client wants the Link Sent → Approved → Activated → Funded stepper, **Send application link**
and the Scenario Simulator for financing rows, while Submit Funding must still not wait on the lender.
`FINANCING_BYPASS_ENABLED` is untouched (so `fundingBlockers` still ignores an unresolved `bank` row); a
second flag, `FINANCING_BYPASS_NOTICE_ENABLED` (`utils/funding.ts`, default `false`), now controls whether
`PaymentFundingCard` swaps the stepper/actions for `FinancingBypassNotice`. Set it `true` to get the
"Financed through …" notice back. ⚠️ A rep can now Submit with a financing link never sent — intended.

### REVUIUX-546 — the bypass is OFF; the mock lender rail replaced it (supersedes the "revert this" line above)

`FINANCING_BYPASS_ENABLED` is **`false`** as of REVUIUX-546. The backend (`feat/revuiux-546-mock-lender-page`,
`FUNDING_LENDER_PROVIDER=mock`, `MOCK_PAYMENT_PAGE_URL`) now lets a `bank` row send an application link and
resolve via `sync`, so the rail is no longer a dead end. With the flag off the stepper, rep actions, real
blocker sentences ("waiting on lender decision" / "loan not activated yet") and the Submit Funding gate all
return — nothing was rewritten, only un-skipped. `FINANCING_BYPASS_NOTICE_ENABLED` is now moot (notice is
never shown while the bypass is off). ⚠️ Delete the flags, `isFinancingBypassed`, `FinancingBypassNotice` and
the blocker arm once QA signs off. Full reload after flipping — the flag is read at module scope.
- The Scenario Simulator (restored earlier, `SCENARIO_SIMULATOR_ENABLED`) stays on at the client's request,
  although the backend note says decisions can come from the link's web page instead. If the server has
  no `mock-provider` route the panel just shows "Unavailable".
- Companion REVUIUX-304 (`REVUIUX-304-mobile-bank-decline.md`: Complete Job sends `result: 'Sale'` for a
  bank-declined job, `DynamicJobBuilderScreen.tsx` ~946) was NOT applied — that file isn't in the repo.

### REVUIUX-546 addendum — what was verified, and the pairing rule

- Mobile `fundingBlockers` is **deliberately stricter than the server's submit rule** (the server exempts
  lender STEPS since REVDSM-1156/1159; mobile blocks on each with its own sentence). Do NOT "align" it.
- ⚠️ **Pair:** mobile `fundedAmount` still counts an unapproved `bank` row at its requested amount; that is
  safe only because the step sentences fire first. If the step blockers are ever deleted, port the server's
  `if (p.type === 'bank') return p.approvedAmt ?? 0` in the same change. A legacy row with a `decision` but null
  `approvedAmt` is the one gap (mobile full, server zero -> 409); old data only.
- An unrun loan must block on "— link not sent yet", never on the server's "$X … still unassigned" 409.
- Tests: `__tests__/screens/DynamicDealCenter/financing-rail.test.ts` (flag off, step blockers, decline /
  partial / full + activate). Gitignored like every suite.

### Archive shelf: only plans with a recorded status, no duplicates (`swapRowMethod` / `restoreRowPlan`)

Ticket: a financing plan that only had a link generated landed in ARCHIVED METHODS; switching A -> C -> A -> C
listed the same plan again.
- `isArchivableRow(row)` = `decision || activated || charged || collected` (status came back on the Funding
  screen). **`linkSent` alone no longer archives** — swapping a link-only row just resets `linkSent`/`activated`/
  `decision` and drops the link. ⚠️ Supersedes the `hasLenderState` gate in the earlier "archive only plans that
  have actually started" ticket; do not widen back.
- The shelf holds ONE entry per plan key (`withoutPlan`): archiving replaces an older copy, selecting a plan
  (dropdown or restore) removes it from the shelf, and `PaymentRowsGroup` renders `visibleArchived(row)` deduped
  by key/label so the active plan never appears on its own shelf (also covers server-sent `archived` entries).
- Tests: `financing-rail.test.ts` ("archive shelf"). Not verified on device; server-side archiving is untouched.

### Funding screen: no "Attempt history"; Archived Methods only lists plans with a status

Ticket: the Funding screen listed every attempt (LINKSENT rows, partials) under ATTEMPT HISTORY; the client wants only
ARCHIVED METHODS, and only for plans that got a status back. `FundingView` no longer renders the attempt-history
block (`log` is now an optional, unused prop; `attemptLog()` is untouched). `visibleArchived` (`utils/funding.ts`)
also drops server-sent `archived` entries that carry no decision / approvedAmt / charged / collected / activated,
so a link-only plan never shows on the shelf. ⚠️ Do not re-add the history block without asking. Not verified on device.

### Archive shelf follow-up: keep every approved plan, hide any plan active on another row

Ticket: two approved plans but the shelf showed one; a plan re-selected on another row stayed listed.
- ⚠️ `swapRowMethod` bailed out on `!r.method`, so a row hydrated from the server (plan key unresolved, only
  `methodLabel`) never archived its approved plan. Now `!(r.method || r.methodLabel)`; `snapshotPlan` stores a
  label fallback as `planKey`.
- Dedupe is by **label as well as key** (`withoutPlan(shelf, key, plans)`): server entries only carry `method`
  (label), local ones a `planKey`.
- `visibleArchived(row, activeLabels, plans)`: `PaymentRowsGroup` passes the labels of every OTHER row's current
  method, so an approved plan already in use on a sibling row is not offered as archived. Not verified on device.

### Archive shelf follow-up: picking an archived plan hides it, never deletes it

Ticket: three approved plans on the shelf; picking GS2511 hid it (right) but moving on to another plan did not bring
it back. Cause: `swapRowMethod` / `restoreRowPlan` stripped the picked plan from `archived`, and a plan re-picked
without a new status is not archivable, so nothing re-added it. Now the shelf is only ever ADDED to (one entry per
plan, newest wins); `visibleArchived` hides whichever plan is active on the row (and on sibling rows). ⚠️ Do not
strip the picked plan from `row.archived` again. Not verified on device.

### REVUIUX-546 — rep decision buttons replace the Scenario Simulator

Ticket: the rep records what the lender told them — Approve full / Approve partial / Decline — and the card's
rail (Link Sent -> Approved -> Activated) moves. Spec: `REVUIUX-546-mobile-rep-decision-buttons.md`.
- `PaymentFundingCard` `DecisionButtons` ("Record the lender's decision") renders when `canRecordDecision(p)`:
  `type === 'bank' && linkSent && !decision` (`utils/funding.ts`). Each button calls `funding.recordDecision`
  (`POST /lead/v1/:leadId/funding/:pid/decision`, existing `FundingService.recordDecision`); `FundingView` passes
  `onRecordDecision(pid, decision, approvedAmt)`; both hosts (`ResultJobModal`, `DynamicDealEditScreen`) wire it.
- Partial: inline whole-dollar input, `parsePartialApproval(text, requested)` -> `short` only for `1 … requested-1`;
  an amount `>= requested` routes to **full** (never a 422). `approvedAmt` is sent only for `short`.
- The rail is NOT patched locally: `useFunding.run` applies the server's returned record, and `stateOf` derives
  step 2 (done / warn on open short / bad on decline) and step 3 from it. Server 409/422 wording reaches the rep
  through `run`'s existing error banner — do not replace it with a generic toast.
- ⚠️ **Removed** (do not bring back): `ScenarioSimulator.tsx`, `FundingService.mockProvider` + `mock-provider`
  endpoint, `useFunding.mockProvider`/`mockDisabled`, `SCENARIO_SIMULATOR_ENABLED`, `MOCK_PARTIAL_RATE`, the
  `onSimulate`/`mockDisabled` props. Supersedes "Scenario Simulator is back on the Funding screen".
- ⚠️ Mock lender page + rep buttons on the SAME row: the mock answer re-applies on every Sync (backend, mock rail
  only). QA: drive a loan one way, not both. A decision can be re-recorded (last entry wins). Open client
  questions: evidence for rep-entered approvals; recording without a sent link (needs a backend change).
- Needs `FINANCING_BYPASS_ENABLED = false` (done). Tests: `financing-rail.test.ts`. Not verified on device.

### Approved financing no longer locks; re-picking an approved archived plan restores it

Ticket: "This financing has already been activated, so its method is locked" blocked a rep from changing an
approved loan; and re-selecting an already-approved plan from the archive would have meant a new link + approval.
- `isMethodLockedRow` = `charged || collected` only — **`activated` no longer locks** (a loan can be swapped; its
  approval goes to Archived Methods). `lockedMethodNote`'s activated branch is now dead.
- `snapshotPlan` keeps `linkSent`/`activated`/`approvedAmt` for decided rows. `findApprovedArchive(row, key, plans)`
  finds a full/short entry for a plan; `swapRowMethod` (dropdown) and `restoreRowPlan` (Restore) then restore
  `decision`, `linkSent`, `activated`, amount instead of resetting — no new link, no re-approval, no re-activation;
  an activated plan stays activated, so `fundingBlockers` is empty and Submit Funding enables.
- `DynamicDealEditScreen.selectRowMethod`: a SERVER-sent approved entry goes through `funding.restoreArchivedPlan`.
- ⚠️ Local restore is UI state: `toUpsertRows` sends only pid/kind/method/type/amount and the server resets a row's
  steps when its method changes, so a restore of a not-yet-saved row can be undone by the next save. Whether the
  server lets an activated loan change method, and honours the restore, is a backend question. Not verified on device.

### Funding card layout polish (decision panel)

`DecisionButtons` (`PaymentFundingCard.tsx`): Approve full / Approve partial / Decline are one equal-width row
(`flex: 1`, `numberOfLines={1}` + `adjustsFontSizeToFit`, radius 12) instead of wrapping; the busy spinner moved
under the row so it can't push a button. The send-note panel and decision panel now share padding 14 / radius 14 /
marginTop 14, and the Sync row sits at marginTop 16. Layout only; not verified on device.
- Follow-up: the per-label `adjustsFontSizeToFit` made "Approve partial" render smaller than its neighbours, so it is
  removed — all three labels share one size, and the middle one reads "Approve part" to fit the row. Not verified on device.


### Merged with the offline Default toggles (`dev-qs-offline` ← `dev-v1-multi-tenat`)

The only conflict was the `toggleDefault` / `isLocked` / `toggleDefaultDiscount` block in
`PremiumQuoteCard`. `dev-qs-offline` had moved both Default switches onto `saveDefault`, which queues the
setting on the device first (`queueCalculatorSetting` → `flushCalculatorSettings`) so the switch holds
offline. This ticket's side still called `SettingsService.updateCalculatorsSetting` directly and had no
`toggleDefault`. Resolved as: this ticket's rule and comment (no `isLocked` gate on the discount Default),
with both toggles kept on `saveDefault`.

- ⚠️ **Don't take the direct `SettingsService` call back in a later merge.** The offline branch dropped
  that import, so it won't compile, and it would also restore the offline toggle that springs back.
- ⚠️ **`toggleDefault` (payment method) must survive.** The ticket side had no definition for it, but
  the Default payment method switch still calls it.

## Offline Deal Center: a SECOND offline session after a sync never uploaded

QA, on the Deal Center with the offline banner up: *"when i turn on the wifi by staying in this screen,
it syncs the previous lead data, and when again turn off the internet and fill the things offline and
again on the internet it will not sync the deal center data which i added."* Correct — reproduced by
driving the real `src/services/offlineLeadStore.ts` under jest with the network mocked.

### Cause: `uploaded` was a dead end

`uploadableWork` (`src/utils/offline-lead-work.ts`) drains only `status === 'draft'` records.
`saveOfflineDealCenter` re-arms `calculator` / `calculatorState` (`rearmStep`), but `rearmStep` only
edits `done` — so a record that had drained once stayed `uploaded` with pending steps. The drain
skipped it, and the pending banner (`activeWork`, which also skips `uploaded`) never mentioned it.

**Fix — `reopenIfPending`, applied inside `putOfflineWork`**, the store's only write: an `uploaded`
record whose `nextUploadStep` is non-null goes back to `draft`. Doing it at the write rather than in
`rearmStep` also covers a step that was never applicable before (a first Job Builder draft after a
Deal-Center-only sync), which `rearmStep` cannot see. ⚠️ `queueLeadWorkStart` and `queueLeadArchive`
already reset the status by hand; every other writer relied on nothing.

### Two more holes on the same path

- ⚠️ **An edit made while a PUT was in flight was marked sent.** `uploadOne` marked the step done
  against `latest(work)`; an edit during the `calculatorState` request re-armed nothing (the step was
  not in `done` yet), so it was recorded as uploaded while the request carried the old state. New
  **`stepPayloadChanged(sent, now, step)`** compares what the step sends (`calculators` / `outcome` /
  `customer` / `archive`); when it changed, the step is marked done (keeping ids it produced, so no
  duplicate calculator) and re-armed.
- ⚠️ **Re-opening the screen started a SECOND record.** `ensureOfflineWorkForLead` skipped `uploaded`
  records and called `adoptExistingWork`, losing the appointment and calculator server ids — the next
  drain filed a second appointment and a second calculator, and a door-created lead was re-adopted
  under its CLIENT id. It now reuses the live record, else the most recent drained one; safe because
  `reopenIfPending` reopens it on the next write.

### Follow-ons in `src/screens/DynamicDealCenter/hooks/useDynamicCalculators.ts`

- **`persistOffline` calls `runUpload()` when online.** The session stays on the device once it went
  offline (one writer), so an edit made after signal returned waited for the 60 s sweep — the
  reconnect edge had already fired.
- **`resolveOfflineDealCenterSource` gained `storedDrained`** (`src/utils/offline-deal-center.ts`).
  Reusing a drained record means its calculators are no longer proof of newer work: the rep may have
  kept quoting online since, which the snapshot records. A drained device copy now yields to a
  snapshot with rows (and is still used when there is none). ⚠️ Without this, reuse would paint a
  stale quote and PUT it back over the newer one.

### "Deal Center isn't configured yet" while offline

The screenshot's own screen. The four company configs (`useCalculatorSchema`,
`useDynamicCalculatorSchemas`, `useDealPricing`) are cached by `cachedFetch` only once read ONLINE, and
a sign-out clears them — so a device that had not opened the Deal Center online had no schema, and the
screen blamed the admin.

- **New `src/screens/DynamicDealCenter/hooks/useWarmDealCenterConfig.ts`**, mounted on the Leads list
  (`src/screens/Leads/index.tsx`) beside `warmLeadCalculators`. Same query keys as the Deal Center, so
  it costs nothing extra once warm.
- **`DynamicDealCenterScreen` shows an offline-specific empty state** ("isn't saved on this device
  yet") when the config is missing and `isOnline()` is false. ⚠️ Offline, "missing" means "never
  downloaded", never "not configured".

Tests: `__tests__/services/offline-deal-center-resync.test.ts` — offline → sync → offline → sync
sending both states to the same server calculator with one lead / appointment / calculator create;
re-open reusing the record; an in-flight edit sent afterwards; plus the pure rules. The three store
cases **fail against the pre-fix store**. `__tests__/utils/offline-deal-center.test.ts` covers
`storedDrained`.

⚠️ Needs a device check: on the Deal Center, offline → edit → Wi-Fi on (syncs) → Wi-Fi off → edit →
Wi-Fi on, and confirm a second `PUT /lfcalculators/{id}` with the new values and no new
`POST /appointments` or `POST …/lfcalculators`. Then sign out/in, open the Leads list on Wi-Fi, go
offline, and confirm the Deal Center opens instead of "isn't configured".

See also `lead-center.md` ▸ *Roof Waiver signed offline*: `queueOfflineConsent` / `addOfflineJobDocument`
now re-arm their per-item steps (`consent`, `documents`), and `stepPayloadOf` covers both by item
client ids — the same "marked done, never re-run" bug for forms and scanned documents.

See also `lead-center.md` ▸ *the queued form printed the lead's lat/long*: the `consent` step now swaps a
coordinates-only `address` for the lead's resolved one (or a geocode) before posting — `resolveFormAddress`
in `utils/offline-lead-location.ts`.

## Offline agreement: pinch-zoom did nothing on Android

Reported on an Android emulator: in **Generate Agreement** offline (the device-rendered
`DynamicAgreementGenerator`), pinching the document did nothing. iOS zoomed.

**Cause.** The generator's zoom and pan are a `react-native-gesture-handler` `GestureDetector`
(`Gesture.Simultaneous(pinch, pan)`), and `DynamicAgreementDialog` hosts it in a `Modal`. A `Modal` is its
own native view tree, so the app-root `GestureHandlerRootView` does not reach it, and on Android no gesture
inside it is ever delivered. This is the same trap as root-guide §6 and `pitch-book.md` (Pitch Book /
Roofline Deck). Online never showed it, because the server-rendered path uses `AgreementSignatureModal`
instead.

**Fix.** `DynamicAgreementDialog`'s modal content is now a `GestureHandlerRootView` (it took the
`styles.page` root `View`'s place; nothing else moved).

- ⚠️ **Keep the root on the DIALOG, not inside the generator.** The generator has no `Modal` of its own.
  If it were ever hosted outside a modal, a nested root would be harmless, but the dialog is the tree
  that needs one.
- The signature / initials pad (`AgreementSignatureCapture`, a separate transparent `Modal`) uses
  `PanResponder`, not gesture-handler, so it needs no root of its own. ⚠️ Add one if it is ever moved
  onto `GestureDetector`.
- `DynamicAgreementDialog.tsx` is **CRLF**.

No unit test: this is native gesture delivery inside a React Native `Modal`, which jest can't load (§6).

⚠️ Needs a device check on Android: offline → Generate Agreement → pinch in and out, then pan around the
zoomed document. Signing, Clear and Save Agreement should still work, and the saved PDF should be
unaffected by the zoom level.

## Offline agreement: a giant top-left crop on Android, fine on iOS

Reported with two screenshots of the SAME offline-created lead: on iOS the Agreement preview showed the
whole contract; on the Android emulator it showed a handful of enormous words — the document's top-left
corner blown up to fill the page ("Street #1 1, Texas, 123456", then "The customer(s) (individually or
collectively," — the first 35% of the first paragraph line).

**Cause — the generated PDF lied about the image's size.** The offline agreement is not a server PDF: the
device screenshots the rendered document (`DynamicAgreementGenerator`, `captureRef` at
`CAPTURE_WIDTH * CAPTURE_SCALE` = **1700 px** wide) and `convertJpegToPdfAsync` wraps that JPEG in a
one-page PDF. `buildPdfParts` wrote the PAGE size into the image XObject:

```
/Type /XObject /Subtype /Image /Width 595 /Height 842 ... /Filter /DCTDecode
```

595x842 is A4 in points — the page, not the image. An image XObject's `/Width` and `/Height` are the
image's own **pixel** dimensions; the page placement is the `cm` matrix in the content stream, which was
already correct. Declaring 595x842 for a 1700 px JPEG is invalid PDF, and the two renderers disagree
about it:

| Renderer | Behaviour |
|---|---|
| Quartz / PDFKit (iOS, macOS Preview) | re-reads the size from the JPEG's own frame header and draws all of it — looked perfect, which is why this survived |
| PDFium (Android, `react-native-pdf`) | believes the dictionary and cuts the decoded samples into 595-wide rows, using the first 842 — the top-left crop, stretched over the page |

⚠️ **This was never Android-only "bad rendering" to be worked around in the viewer.** `PdfPreviewModal`
passes no `scale`/`fitPolicy`, and nothing platform-specific belongs there — the file itself was wrong.

**Fix.** `readJpegSize` (`utils/jpeg-to-pdf.ts`) walks the JPEG's segments to the frame header (SOF0..SOF15,
skipping DHT/JPG/DAC, which share that marker range) and returns its real pixel size; `buildPdfParts` takes
it as a 4th argument and declares it. The page size, the `cm` matrix and the xref offsets are untouched, so
**the rendered output on iOS is byte-identical** (verified by rendering a 1700 px JPEG both ways through
Quartz — same PNG md5).

- The file-backed builder (`jpeg-to-pdf-native.ts`) must not decode the image, so it uses
  `readJpegSizeFromBase64`, which decodes only the first 64 KB of base64 — far more than any frame header
  needs. Both builders still produce byte-identical documents; do not let that drift.
- ⚠️ An unreadable / non-JPEG input falls back to the page size, i.e. exactly the old output. That keeps
  the change safe, but it also means a silently-wrong size is still possible — check `/Width` in the
  document if an Android crop ever comes back.
- **Three verbatim copies of this builder** (`screens/JobBuilder/index.tsx`,
  `widgets/components/LeadCenter/JobDocsSection.tsx`, `widgets/components/job-builder/SummarySection.tsx`)
  carried the same bug for every SCANNED document, not just the agreement. They now delegate to the shared
  util and their `base-64` imports are gone. ⚠️ Do not re-inline one.

Covered by `__tests__/utils/jpeg-to-pdf.test.ts` (8 cases: the frame reader past an APP0 segment, non-JPEG
and truncated input, the base64 head reader, the XObject's declared size vs the MediaBox, the page-size
fallback, and the xref offsets still pointing at their objects). The XObject case fails on the old builder.

⚠️ Needs a device check on Android: create a lead offline, complete the job, open **Agreement** from the
summary card — the whole contract should be there, fitted to the page, as on iOS. Then scan a document
through Lead Center and open it, for the three de-duplicated copies.


## "Generate" played two full-screen open animations

The rep taps **Generate** on the agreement card and watches a page slide up showing
"Generating agreement…", then a *second* page slide up over it carrying the contract. Two
presentations for one tap, which reads as the app opening two separate screens.

It is not a double-render. `DynamicAgreementDialog` is itself a full-screen `Modal`, and once the
server preview lands it renders `AgreementSignatureModal` — **another** full-screen `Modal`, as its
child — and that one also defaulted to `animationType="slide"`. Both animations were real and both
were correct in isolation.

**The fix** is not to remove a modal (the outer one has to open immediately, or the rep taps
Generate and watches an unchanged screen for the length of a network round trip). Instead
`AgreementSignatureModal` took an optional `animationType` prop, defaulting to `slide`, and the
dialog passes **`fade`** — so the contract cross-fades in over the spinner, in place, and the pair
reads as the one screen it logically is.

⚠️ **The default must stay `slide`.** The legacy Job Builder (`SummarySection.tsx:1897`) opens the
same modal straight from the screen, with a separate `<Modal transparent animationType="fade">`
for its spinner. It is NOT nested, so it must keep sliding. The rule: **`fade` when the modal is a
child of an already-open full-screen modal, `slide` when it is opened from a screen.**

⚠️ The staged teardown in `handleSignClose` is unaffected and must stay. It still drops the
signature modal a frame before the dialog (`setSignVisible(false)` → `onClose()` 350ms later),
because collapsing two native modals in one frame orphans a backdrop and leaves a blank black
screen. Nothing shows through the cross-fade either way: the dialog's loading shell already
renders `null` once `agreementData` exists, deliberately.

The OFFLINE path never had this problem and is untouched — `renderLocally` mounts
`DynamicAgreementGenerator` inline inside the dialog, with its own signature pads, so there is no
second modal at all.

⚠️ Not verified on a device — it needs a real online agreement generation. Both files are **CRLF**.

## Down payment typed in the Result Lead modal was thrown away on Build Job

QA: enter a Down Payment in the Result Lead modal, press **Build Job**, go back, reopen the modal —
it reads `$0.00`. The Balance reverts to the full contract price with it.

Two separate gaps, both needed fixing:

1. **Nothing persisted it.** `handleResultConfirm` (`DynamicDealCenterScreen`) put the whole outcome
   into `calculatorResultData`, which is screen state, and moved to the job builder. Leaving the
   screen dropped it. Meanwhile `initialDownPayment` is read back from the **saved calculator**, so
   the modal could only ever show a figure someone had written there — and nothing had.
   Fix: on a **sale**, `handleResultConfirm` now calls `handleSetDownPayment(currentCalculatorId, …)`.
   That marks the tab dirty, so it rides the same debounced `PUT /lfcalculators/{id}` as the rollout
   card's own down-payment input; `downPayment` was already in `buildPayload`
   (`useDynamicCalculators.ts:615`), the hydrate (`:223`) and `tabSignature` (`:270`), so the round
   trip needed no new plumbing. A demo has no down payment, so only a sale writes.
2. **The prefill read the wrong field even when a value existed.** `openResultChooser` seeded
   `chooseDown` from `activeDownPayment`, which is `acceptedDrop?.downPayment`. ⚠️ On the plain
   **Result Lead** path there are no drops — the common case, and exactly the QA repro — so that is
   always 0, and a down payment already saved on the calculator was ignored. New `resultDownPayment`
   falls back to `calculator.downPayment` when no drop is accepted. ⚠️ The accepted drop still wins
   when there is one: the deal is being resulted **at the drop**, and the drop carries its own down
   payment (`dropEntryToPayload`). Do not "simplify" the two into one.

⚠️ Do not move this write into `ResultJobModal` itself. It is mounted twice (calculator step and
rollout step) and is deliberately presentational — everything it captures leaves through `onConfirm`.
The persist belongs in the single `handleResultConfirm` both mounts share.

⚠️ The per-drop **Result** action (`setChooserDown(Number(d.downPayment) || 0)`) is untouched and must
stay drop-scoped — it is resulting that specific dropped price, not the rollout.

Not verified on a device. `tsc` 45 errors (unchanged baseline, none in either file), `eslint`
identical to HEAD for both (327 problems / 27 errors, all pre-existing), `jest` 542 pass. On device:
type a down payment in Result Lead, Build Job, back out, reopen — the figure and the Balance should
both be as left. Worth also checking the rollout card's own down-payment input still round-trips,
since both now write the same field.

## Confirming a rollout must arm the Investment Center unlock — see `investment-center-job-tracker.md`

`DynamicDealCenterScreen`'s `onConfirmRollouts` calls `markLeadRolloutsConfirmed` when the confirm
completes the whole set, and `RolloutView`'s `visibleCalculators` / `allConfirmed` now come from the
shared `utils/rollout-status.ts`. Both exist to keep the Lead Center's Investment Center tile in step
with this screen; the full reasoning, and the two ⚠️ traps, are in
[`investment-center-job-tracker.md`](investment-center-job-tracker.md) under *"Confirmed rollouts but
Investment Center not ready"*. Read that before touching either.

## Job Builder: the step timeline glides away on scroll (Instagram-style)

Ticket: *"have header of steps timeline glide away when scrolling down but re appear when scrolling
up… Keep allocation tracker always there."*

Scope, agreed with the requester: the **whole white header block** collapses — title, X button,
`VerticalTabBar` and `ProgressTracker` — in **both** the Job Builder and the Edit Deal flow.

The pieces:

- `utils/collapsing-header.ts` — the pure maths (`nextCollapseState`, `settleTarget`,
  `settleDuration`), tested in `__tests__/utils/collapsing-header.test.ts` (23 cases).
- `hooks/useCollapsingHeader.ts` — the animated value, the measurement, the gesture bookkeeping.
- `DynamicJobBuilderScreen` wraps its header in an `Animated.View` and threads `scrollProps` down.
- `DynamicTabRenderer` takes `collapsingScrollProps` for its field `ScrollView`, and forwards it to
  `VerticalSummaryTab` for the summary tab's own.

### ⚠️ Finger-tracked, NOT threshold-triggered

The first version tripped a threshold and then played a fixed animation open→closed. It was
reported back as *"hiding instantly… it should come softly and smooth"* — and correctly so: once
the animation starts, the rep's finger has no influence, so any duration reads as a snap. **Do not
reintroduce a threshold or an `Animated.timing` for the tracking phase.**

What it does instead is a running total of scroll delta, clamped to the header height:

```
collapsed = clamp(collapsed + (y - lastY), 0, headerHeight)
```

written straight to an `Animated.Value` with `setValue` on every scroll frame. Drag 30px, the header
is 30px shorter. Reverse and it comes back immediately, with nothing to overcome first. On release
`settleTarget` snaps the remainder to whichever end is nearer (⚠️ at 0.4, not 0.5 — once a rep has
pushed most of it away they meant to), over `settleDuration`, which is proportional to the distance
left so a nearly-shut header does not take as long as one that has barely moved.

`scrollEventThrottle` must stay at 16: the header is redrawn per event, so anything coarser is
visible as stepping rather than sliding.

### ⚠️ Only rep-driven scroll may move the header

Two device-found bugs, both from treating every `onScroll` as the rep scrolling:

1. **A feedback loop.** Collapsing the header shrinks the layout ABOVE the ScrollView, so the
   ScrollView grows and its `contentOffset.y` moves ON ITS OWN. Consumed as scroll it gives the
   header back, which shifts the offset again — the header BLINKS. This is inherent to animating the
   height; it cannot be tuned away.
2. **The iOS bottom bounce.** Over-scrolling past the end and settling back is a downward offset
   change with no finger involved, so it ate the header on release and gave it back as the bounce
   finished. `TOP_ZONE_PX` already covered the same effect at the top; `BOUNCE_SLOP_PX` is its
   mirror.

So `CollapseInput.userDriven` gates the whole thing, fed by the hook's
`onScrollBeginDrag`/`onScrollEndDrag`/`onMomentumScrollBegin`/`onMomentumScrollEnd`.

⚠️ A drag ending does **not** end the gesture — a fling hands over to momentum and the header must
keep tracking through it. Only `onMomentumScrollEnd` truly ends it, but a drag that stops without a
fling emits no momentum events, so `onScrollEndDrag` settles too and `onMomentumScrollBegin` reopens
the gesture (RN fires it after `onScrollEndDrag`).

⚠️ `settlingRef` additionally freezes input while the settle plays, because the layout shift lands
mid-animation and the finger may still be down.

⚠️ Non-driven samples still update `lastY`, so the next real sample takes its delta from the right
place rather than jumping.

### ⚠️ Other traps

**It animates HEIGHT, not `translateY`.** A translated header slides out over the content and leaves
a gap, because the content's layout does not move — the allocation tracker would stay put with a
white band above it. Height cannot be driven on the UI thread, so `useNativeDriver: false` is
correct; it is one small view.

**The header height is measured ONCE.** Its `onLayout` fires with ~0 as it collapses, and adopting
that leaves it unable to reopen.

**All tabs must be wired, and there are TWO scroll owners.** Every product tab (Gutter, LeafFilter,
Soffit, Fascia, Lighting, …) is the same `DynamicTabRenderer` re-keyed on `currentTab.id`, so one
wiring covers them all — but `tab.isSummary` returns `VerticalSummaryTab` **before** that ScrollView
is reached, and it owns its own. A new tab type with its own scroll container needs wiring too, or
the header freezes on that tab.

**`scrollProps` must be spread WHOLE.** Cherry-picking `onScroll` drops the touch/momentum handlers
and brings the blinking straight back — which is why the prop is `collapsingScrollProps` rather than
a bare handler.

**The header resets to open on a tab change** (`useCollapsingHeader(true, currentTab?.id)`). Without
it, advancing to the next step with the header collapsed lands the rep on a fresh tab scrolled to
the top with no timeline, recoverable only by scrolling down and back up.

**Only the field ScrollView and the summary ScrollView get it.** The pinned allocation grid and
accordion tracker sit ABOVE the field ScrollView and must never move — that is the second half of
the ticket.

Not verified on a device. If the feel needs tuning, the dials are `SETTLE_CLOSED_FRACTION`,
`SETTLE_MIN_MS` / `SETTLE_MAX_MS` and the opacity interpolation in the hook. `tsc` 45 errors
(unchanged baseline, none in the changed files), `eslint` identical to HEAD across all three existing
files (82 problems / 14 errors, all pre-existing) with zero findings from the two new ones, `jest`
574 pass / 38 suites (23 on the maths).

## Keyboard dismissed after the FIRST digit in a measurement grid

Client + QA: in Lighting ▸ Measurements, typing the first number closes the keyboard; every keystroke
after that is fine. Reproduces anywhere a `locationGrid` sits in a stack that carries a warning.

Not a keyboard bug — a **remount**. The cause is in the `stack` branch of `renderField`
(`DynamicTabRenderer`), which returned **two different JSX trees**:

```
no warning → <View>{labelNode}{stackContent}</View>            // stackContent at index 1
warning    → <View style={…}>{labelNode}{warningNode}{stackContent}</View>  // index 2
```

⚠️ **React reconciles unkeyed children BY INDEX.** Both branches render a `View` with the same
`key={field.id}`, so the container survives — but `stackContent` moves from slot 1 to slot 2, and
React tears that subtree down and builds a new one. The `TextInput` being edited is destroyed, so
the keyboard drops.

Why exactly once: typing the first digit takes the grid total from 0 to non-zero, which satisfies
"Allocate remaining footage", so the warning clears and the children shift. Every keystroke after
that is warning-off → warning-off; nothing moves.

Fix: ONE container, styled conditionally, with `labelNode` and `warningNode` rendered
**unconditionally**. A `null` child still occupies its slot, so `stackContent` is always at index 2.

⚠️ Do not collapse these back into `&&` short-circuits *placed in different trees*, and do not
reintroduce the early `return` for the unbordered case. (`{cond && <X/>}` inside a SINGLE tree is
fine — `false` holds the slot — which is why the `IncompleteWarning` branch above never had this
bug, and why `AccordionSection`'s `{contents}{warningBanner}` is safe: the conditional child is
LAST.)

⚠️ The rule to carry: in this renderer, **a conditional wrapper must never change a child's index.**
Anything that can toggle while a field has focus — a warning, a badge, a banner — goes after the
fields, or is rendered as a null-able node in a fixed slot.

Not verified on a device. `tsc` 45 errors (unchanged baseline, none in the file), `eslint` identical
to HEAD (24 problems / 12 errors, all pre-existing), `jest` 574 pass. On device: Lighting ▸
Measurements, tap a cell, type one digit — the keyboard should stay up and the amber warning should
clear underneath it.

## The gap above the pinned tracker now closes with the header

Follow-up on the collapsing header: with the header gone, the allocation tracker was left sitting
below a band of white, because its `paddingTop: 8` was static while everything above it had
collapsed. (`paddingBottom` was already 2 — the asymmetry existed, it just never animated.)

`useCollapsingHeader` gains `underHeaderStyle`, an animated `paddingTop` interpolated over the SAME
travel as the header (`UNDER_HEADER_PAD_OPEN` 8 → `UNDER_HEADER_PAD_COLLAPSED` 2), threaded down as
`collapsingUnderHeaderStyle` and applied to the tracker's container, which became an
`Animated.View`.

⚠️ The animated style must come LAST in the `style={[…]}` array. Spreading it before the static
object lets `paddingTop: 8` win and pins the gap open again.

⚠️ Interpolated over the collapse travel, NOT toggled on `hidden`. A toggle would snap the padding
at the moment the header passes the settle point, which is visible as a jump under a smoothly
sliding header.

⚠️ **Known limit:** only the allocation GRID gets this. When a tab has no allocation grid, the
accordion tracker is the block directly under the header — its padding is a symmetric 4, so the
stranded gap is barely there, and reusing the 8→2 interpolation would *increase* its resting gap
from 4 to 8. If it ever needs animating, give the hook a parameterised helper rather than reusing
this one.

Not verified on a device. `tsc` 45 errors (unchanged baseline), `eslint` identical to HEAD for both
existing files (73 problems / 14 errors, all pre-existing), `jest` 574 pass.

⚠️ Note for anyone checking line endings here: `file` reports `DynamicTabRenderer.tsx` as "CRLF, CR"
even on a byte-identical copy, while a byte scan confirms every CR is part of a CRLF. It is a `file`
heuristic false positive on this file, not a stray carriage return — verify with a byte count
(`d.count(b'\r') - d.count(b'\r\n')`) before "fixing" anything.

## Tab name stayed on the cleared products instead of returning to the customer

Ticket: *"deal center > tab naming not removed when the data is cleared ... when we remove all fields
with first tab, the lead name should be show default one"*. Screenshots showed the first tab still
reading `Labor` (iOS) / `LF Misc` (Android) on a calculator whose fields had all been emptied.

### Cause: the empty-calculator fallback read the LAST SAVED name

`computeDerivedTitles` (`utils/tab-naming.ts`) fell back to `storedTitle` when no values were entered —
the fallback added by the section above, which exists so a customer-named first calculator is not
renamed to `"1"` by the first `retitle` pass.

That fallback is right for a calculator that has *never* been filled, and wrong the moment one has:
`storedTitle` is `t.title`, which after any entry is a **derived** name (`Labor`, `G+S`) that was
written back to the calculator. So clearing every field fell back to the name of the products that had
just been deleted, and there was no way to get the customer's name back.

### Fix — a separate `originalTitle`

`TabNameInput` gained **`originalTitle`**: the name the calculator was CREATED with. The empty branch
now reads it instead of `storedTitle`, so clearing is symmetrical with entering — the tab returns to
exactly what it showed before anything was typed.

- New **`titleInputs(list)`** in `useDynamicCalculators.ts` builds the input for all three call sites
  (`resolveSafeTitle`, `retitle`, `saveDisplacedSiblings`). ⚠️ One place on purpose: two of those decide
  what gets PUT, so a list built differently in one would persist a name the tab does not show.
- `originalTitle` is `customerTitleOf(leadRef.current)` for **index 0 only**. New `leadRef` follows the
  existing `schemasRef` pattern so the callbacks stay stable.

⚠️ **Only the first calculator.** Every other one is created under a numeric placeholder and still
renders blank when emptied — deliberate: three empty tabs all reading the customer's name would be
worse than three blanks, because the rep could not tell them apart.

⚠️ **A manual rename is untouched** — `manualTitle` returns at the top of `computeDerivedTitles`,
before the fallback is reached.

⚠️ **`storedTitle` is still passed and still used** by the duplicate-title guard
(`getUniquePersistableTitles` / `lastSavedTitle`). It was not removed, only stopped being the fallback.

Tests: `__tests__/screens/DynamicDealCenter/tab-name-cleared.test.ts` (6) — **4 of them fail against
the pre-fix code**. `full-package-title.test.ts`'s "an empty calculator keeps its placeholder" case was
updated to carry the customer name on `originalTitle`; its intent is unchanged.

## A filled field scrolled out of view the instant "Done" closed the keyboard (Android)

Ticket: *"when i type in the field and press done, that field goes hide, it should be slide up a bit
so i can see what i filled."* Screenshots: a `locationGrid` stack (`# of Miters`, `# of End Caps`)
where the just-typed value (`# of End Caps (Lefts) = 2`) is the last thing visible above the
keyboard, and disappears above the fold the instant Done is tapped.

**Not a focus/remount bug** (that's the section above) — this is a scroll-position bug. The tab's
field `ScrollView` (`DynamicTabRenderer`, ~line 2065) relied on `automaticallyAdjustKeyboardInsets`
(iOS-only) plus the Android manifest's `adjustResize` and nothing else — there was no JS-level
"keep the focused input visible" logic at all. `adjustResize` only resizes the WINDOW when the
keyboard opens/closes; it does not touch the ScrollView's own offset. So when Done closes the
keyboard the window grows back to full height, the scroll offset is unchanged, and whatever content
used to sit just above the (now-gone) keyboard rides up out of view under the header — exactly the
"goes hide" the ticket describes. This is also the CLAUDE.md-level gotcha ("Scrolling forms use
`KeyboardAwareScrollView`… `automaticallyAdjustKeyboardInsets` is iOS-only") that this screen had
never actually picked up.

**Fix: swapped the plain `ScrollView` for `KeyboardAwareScrollView`** (`react-native-keyboard-controller`,
already used the same way in `DynamicDealEditScreen`'s Job Price / Addendum steps —
`keyboardShouldPersistTaps="handled"`, `keyboardDismissMode="interactive"`, `bottomOffset={24}`). It
tracks the focused input and keeps it clear of the keyboard continuously, including through the
close transition, instead of only reacting to the window resize. `KeyboardProvider` is already
mounted at `App.tsx` root, so no other wiring was needed.

⚠️ **`collapsingScrollProps` (`useCollapsingHeader`) is spread onto it unchanged.** Those are plain
`onScroll`/`onScrollBeginDrag`/`onScrollEndDrag`/`onMomentumScrollBegin`/`onMomentumScrollEnd`/
`scrollEventThrottle` props — `KeyboardAwareScrollView` forwards arbitrary `ScrollView` props to its
underlying `Animated.ScrollView` the same way, so the collapsing step-header keeps working exactly
as before. Spread it WHOLE, same warning as everywhere else this prop is handed down — see the prop's
own doc comment above `DynamicTabRendererProps`.

⚠️ `automaticallyAdjustKeyboardInsets` was removed along with the old `ScrollView` (it doesn't exist
on `KeyboardAwareScrollView` — the library's own keyboard-avoidance replaces it), and the now-unused
`Platform` import was dropped with it. Nothing else in this file used `Platform`.

Not verified on a device (this repo cannot render-test). On device: open a `locationGrid`/stack tab
(Lighting or the Gutter grid in the ticket's screenshot), type into the last visible field, tap Done,
and confirm the field stays in view instead of scrolling away.

## Job Builder step tracker: a LOCKED step read as red (an error), not neutral

Ticket: *"The Red lighting and additional services should be different color. Red means wrong. Maybe
gray would be best."* `ProgressTracker` (`widgets/components/dynamic-job-builder/ProgressTracker.tsx`)
painted a `locked` step (one this deal's config doesn't use — e.g. Lighting / Additional Services on a
build that has neither) in `#FE6644` (border, label, lock icon) over a `#FAD9D3` fill — the same
red/orange family used everywhere else in the app for an actual error state, which is exactly why a
step the rep never needed to touch read as something gone wrong.

**Locked is not an error — it's the same "not reached" neutral as an un-complete numbered step.**
Retinted to the palette that state already uses elsewhere in this component (`#94a3b8` label /
`#e2e8f0`-family border): fill `#F1F5F9`, border `#CBD5E1`, label + lock icon `#94a3b8`. Only the three
`locked` branches of `bgColor`/`borderColor`/`labelColor` and the lock `Icon`'s `color` prop changed —
`active` (blue `#0EA5E9`) and `complete` (green `#10b981`) are untouched, and the locked step's
press-through-disabled behavior (`handlePress`: `if (step.locked) return;`) is unchanged, since this
was a colour-only ticket.

## Job Builder Summary + Grand Total: font too small to read on device, can't zoom

Ticket: *"Sales Rep Job Builder Summary | Font too Small… The font is hard to read on mobile and
cannot zoom."* Screenshots: the Job Builder Summary screen's per-field label/value rows, and the
LeafFilter/Gutter "Grand Total - All Combinations" card, both reading at 8–10px.

**`widgets/components/dynamic-job-builder/VerticalSummaryTab.tsx`** — every size bumped one NativeWind
step (values roughly `text-[10px]` → `text-base`/16px, labels `text-[9-10px]` → `text-xs`/12px), same
relative label/value hierarchy kept:
- `SummaryFieldRow` value `text-sm` → `text-base`; its label `text-[10px]` → `text-xs`.
- `LocationRowsDisplay` story label + value `text-[10px]` → `text-xs`.
- `ExtrasList` label `text-[10px]` → `text-xs`.
- `CombinationSummaryItem`'s "Combination #N" chip `text-[9px]` → `text-xs`; its `summaryLine`
  `text-sm` → `text-base`.
- The card header bar (`section.tabLabel`, e.g. "GUTTER"), "No data entered", and every
  `group.sectionLabel` (combination-group / simple-section headings) `text-xs` → `text-sm`.
- The screen subtitle ("Review all configured…") `text-xs` → `text-sm`; the empty-state message
  `text-sm` → `text-base`.
- Title ("Job Builder Summary") was already `text-xl` and untouched.

**`widgets/components/dynamic-job-builder/GrandTotalCard.tsx`** — same treatment, both the
section-scoped card (`GrandTotalCard`) and the tab-level aggregate (`TabGrandTotalCard`) share this
styling so neither drifts from the other:
- Card title ("Grand Total - All Combinations" / the schema's `summaryField.label`) `text-[12px]` →
  `text-[15px]`.
- Footer total row: label `text-[14px]` → `text-base`, the total figure itself `text-[20px]` →
  `text-2xl` (the single most-important number on the card, so it got the largest bump).
- `ComboSummaryRow`'s `#N` chip and optional section sub-label `text-[10px]` → `text-xs`.
- Its per-field grid: label `text-[8px]` (the smallest text on either screen) → `text-[11px]`, value
  `text-[10px]` → `text-sm`.

⚠️ **The allocation tracker above the Grand Total card (`AllocatorBar`/`DynamicTabRenderer`'s "Avail /
Used / Left" + "Perfectly allocated!") was NOT touched** — it wasn't flagged in the ticket and already
renders at a readable size (its numbers are large/bold by design); only the combination rows below it
were reported as unreadable.

Purely visual — no layout, column widths, `%` grid math, or divider (`DIVIDER_STRONG`/
`DIVIDER_HAIRLINE`) logic changed in either file. Not verified on a device.

## Job Builder Summary: a combination rendered as a sentence, not rows

Ticket: *"Sales Rep Job Builder | Job Builder Summary — the right side for this whole summary should
be rows. Not a bounding text box"*, with the portal's own table as the reference
(`Gutter type | 6" K-Style`, `Partial | Yes`, …).

The Gutters combination rendered as `Gutter Type: 6" K-Style · Gutter Partial?: Yes · 49 Longest
Gutter Run · 6 # of Miters (Outside) · …` — one wrapped paragraph — while the Downspout section
directly beneath it, which is not combination-scoped, showed tidy label/value rows.

### Cause: combination fields were flattened into `parts`

`processSummaryFields` (`utils/dynamic-job-builder/engine/vertical-summary-utils.ts`) has two outputs:
`detailRows` (label/value pairs) and `parts` (strings). Under `summaryMode: 'combination'` **every**
field went to `parts`, which `buildCombinationEntry` joins with `" · "` into `summaryLine`.

The label was already known at that point — each branch was building it *into* the string
(`${field.label}: ${text}` for selections, `${text} ${field.label}` for numbers).

### Fix — emit `{ label, text }` instead

The `inCombination` branch now pushes to `detailRows`. No renderer change was needed:
`VerticalSummaryTab` already maps `comboFieldRows` through **`SummaryFieldRow`**, which lays out the
40%/60% label/value columns the ticket asks for.

- ⚠️ A **`number`** field's label becomes the ROW LABEL, dropping the `${value} ${label}` word order
  (`6 # of Miters (Outside)` → `# of Miters (Outside) | 6`). The label already reads as a noun.
- ⚠️ `LABELED_SELECTION_TYPES` was removed — it existed only to decide that inline word order.
- ⚠️ `summaryLine` and `parts` are **kept**, not deleted: container fields still merge into `parts`
  (`mergeSummaryContent`), and the renderer guards with `entry.summaryLine &&`, so a combination that
  produces none renders nothing. Do not "clean up" either as dead.
- ⚠️ `comboHasMeaningfulData` already tested `parts.length || detailRows.length || locationRows.length`.
  Had it tested `parts` alone, this change would have made every combination vanish from the summary.

⚠️ **`buildStackRowSummary` is a different mechanism and was left alone** — it deliberately merges a
bordered stack's paired children into ONE row (`Ground Spout | 4 · Black`), which is web parity
(commit 5a54070). That `" · "` join is intentional; this ticket was only about the combination line.

Tests: `__tests__/utils/vertical-summary-combination-rows.test.ts` (5) — **3 fail against the pre-fix
code**; the other two pin that a combination still renders and an empty one is still dropped.

### Follow-up — the measurement grid is a row too, and goes last

With the fields fixed, the story line became the odd one out: *"3rd Story  Left Side: 22ft is not
looking well, put it in the end of the row, like the client show it in the table"*.

`LocationRowsDisplay` (`VerticalSummaryTab.tsx`) had its **own** layout — a fixed `w-16` label in
smaller, lighter type — and was rendered inside the right-hand column BESIDE the "Combination #"
chip, above the field rows. So it floated on a grid of its own while everything under it lined up.

Renamed to **`LocationSummaryRows`** and now returns a fragment of plain `SummaryFieldRow`s, rendered
**after** `comboFieldRows` inside the same list — the stories land at the end, after Color, as the
portal's table has them.

- The run **total** is appended (`Left Side 63ft, Right Side 7ft, Front 50ft (120ft total)`), matching
  the portal. ⚠️ Only when there is more than one side — `Left Side 22ft (22ft total)` is noise, which
  is exactly the single-side case in the screenshot.
- ⚠️ Data arrives keyed by LOCATION (`Left Side` → per-story values) and the table is keyed by STORY,
  so it is inverted in the component. That inversion predates this change.
- ⚠️ Full location names are kept (`Left Side`, not `Left`). The client's mock abbreviates, but the
  name is what the rep picked and `Left` reads ambiguously beside `Rear`/`Garage`/`Other`.
- ⚠️ Do NOT give this component its own label width again — sharing `SummaryFieldRow` is the whole
  point, and is what keeps the label column aligned with the fields above it.

The guard is now `comboFieldRows?.length > 0 || locationRows?.length > 0`, so a combination that has
only a grid still renders its list.

### Follow-up (REVUIUX-391) — the delivery prompt offline

`widgets/modals/job-builder/AgreementDeliveryPrompt.tsx`, rule in
`utils/offline-agreement-delivery.ts`, queue in `services/offlineAgreementDelivery.ts`.
Endpoint: `PUT pdf-reports/v1/agreement/{leadId}/delivery-preference`.

⚠️ **This prompt BLOCKED THE SALE offline.** It gates Generate Agreement and only called
`onConfirmed()` after the PUT resolved, so with no signal the rep could not reach the agreement at
all — the worst place in the app to put a required network call, since the whole signing flow is
otherwise device-side.

Offline (or on a transport failure) the choice is queued and `onConfirmed()` fires immediately; the
drain replays it on reconnect, registered in `useAppInitialization`. The prompt also reopens on the
**queued** choice, so a rep who reopens it offline sees what they picked, not the lead's default.

⚠️ **Full-state PUT ⇒ one row per lead, replaced wholesale, no attempt counter.** Only the last
choice matters; replaying an older one would overwrite it.

⚠️ `e?.response?.data?.message` was read for the error text — `normalizeApiError` strips
`.response`, so that was always `undefined`. Now `e?.message`, and a transport failure never
reaches it (it queues instead). See [`notifications-chat.md`](notifications-chat.md) for the same
trap in chat.

### Follow-up — the prompt was SUPPRESSED offline, not just blocked

Queueing the PUT was not enough: offline the prompt never rendered, so the queue was unreachable.
Two independent gates excluded it, and both had to go.

| Call site | Was | Now |
|---|---|---|
| `DynamicAgreementDialog.tsx` | `visible={... && !renderLocally && ...}`, where `renderLocally = !isOnline() \|\| isClientId(leadId)` | `visible={visible && needsDelivery && !deliveryReady}` |
| `SummarySection.tsx:638` | `if (!isOnline() \|\| isClientId(leadId)) return runGenerateAgreement(...)` | `if (isClientId(leadId) \|\| !leadId) return ...` |

⚠️ **`renderLocally` conflates two things.** It is the right flag for "the DEVICE renders and signs
the agreement" (a genuinely separate code path), and the wrong flag for "skip the delivery
question" — the ticket's point is that the signed copy always has a destination, which is just as
true offline. Don't reuse it as an offline opt-out for anything else.

⚠️ **A client-id lead still skips the prompt**, and must: the server has no record to attach a
preference to, so queueing against that id would create a row that can never be replayed — the
counterfeit-record trap in [`offline.md`](offline.md).

⚠️ **The offline generator has to WAIT for the answer** —
`agreementConfig && (deliveryReady || !needsDelivery)`. Without that it renders behind the prompt,
and the rep sees the agreement through a sheet they have not answered yet.

### Follow-up — offline agreement parity: the Send prompt and the e-sign tick

Two gaps between the online and offline agreement paths, reported from a device.

**1. "Send Signed Agreement" never appeared offline.** `needsDelivery` was
`!!leadId && !isClientId(leadId)`, so a lead created at a door — the common offline case — skipped
the prompt entirely. My own earlier guard, and wrong: I reasoned there was no server record to
save a preference against, but the rep still has to choose, and the choice can ride with the
queued lead.

⚠️ **A client-id row must be RE-KEYED, not sent.** Replaying the preference against a client id
would file it on a lead the server has never heard of — the counterfeit-id trap. The delivery
queue now has `rekeyDeliveryPreference`, called beside `rekeyActivityLogs` in the `lead` sync step,
so the row follows the lead to its real id. Both call sites (`DynamicAgreementDialog` and
`SummarySection`) now gate on `!!leadId` alone.

**2. The e-sign consent tick was online-only.** `AgreementSignatureModal` (online) requires
"I agree to electronic signature" before Save Mark; `AgreementSignatureCapture` — the offline pad
hosted by `DynamicAgreementGenerator` — had no such gate, so an offline signature was captured
without the consent the online one records.

⚠️ **The tick resets every time a pad opens**, matching online: the initials and the signature are
each their own explicit agreement, and one tick must not carry to the next mark.

⚠️ **Save needs ink AND the tick** (`hasDrawing && agreedToESign`), and the guard is inside `save()`
as well as on the button — ticking alone must not save a blank pad.

### Follow-up — offline funding parity: Confirm now reaches the Funding step

Reported with three screenshots of the ONLINE flow: Result Lead ▸ "How is this being paid?" ▸ the
No Down Payment warning ▸ the **Funding** screen with its payment card and Submit Funding. Offline
the rep saw none of the third screen.

**The gap.** `goFunding` offline saved the split, flashed "Saved on this device" and called
`handleBuildRef.current?.()` — straight to Build Job. Online the same function ends at
`setScreen('funding')`. So offline the rep never saw the split read back to them, never pressed
Submit Funding, and the deal reached the office saved but unsubmitted.

**The cause of the cause.** The Funding screen renders from `funding.payments`, i.e. the SERVER
record returned by `savePayments`. With no server there is nothing to render, so skipping the
screen was the only thing that worked. `offlineFundingRecord(leadId, price, rows, payMode)` now
builds that same shape from the rows already on the device, and `payments` reads
`offlineRecord?.payments ?? funding.payments`.

⚠️ **Every step flag starts at rest** (`collected`/`charged`/`activated`/`linkSent` false,
`decision`/`approvedAmt`/`syncedAt` null). The cards gate each rep action on the server's own flag,
so a `true` invented here shows a job as collected that nobody has touched.

⚠️ **`status: 'pending'`, never submitted** — Submit Funding is still ahead of the rep. (The union
is `'pending' | 'submitted'`; there is no `'draft'`.)

⚠️ **Offline is a CHECK-ONLY board**, and that is what makes this safe to render locally.
`confirmBlockers` already refuses to confirm while any row needs a card or loan, because those
links are minted server-side. So no row here can be waiting on a third party.

**Two more writes behind Confirm.** Pressing Submit Funding offline used only to log, so the deal
arrived unsubmitted; and "Mark collected" on a down-payment cheque hit a dead button. Both are now
queued — see `offline.md` for the steps and their ordering.

⚠️ **`setOfflineRecord(null)` on Edit payments.** Going back to the rows makes the device-held
record stale; leaving it would render the previous split over the edited one.

⚠️ **`handleBuildRef` is gone.** It existed only so the offline path could jump to Build Job. Now
that offline ends on the Funding screen like online, writing it and never reading it was dead code.

### Follow-up — `useRefundApprovers` is warmed on an online open

`hooks/useRefundApprovers.ts` gained an optional third argument, `cachedFeed`, and its caller in
the deal-edit wizard now enables it on `needsRefund || online`.

⚠️ **It used to be gated on `needsRefund` alone, and that could never work offline.**
`needsRefund` is `refundDue > 0`, which only becomes true **after** the rep lowers the price — so
the approver list was fetched mid-session, on demand, with a connection assumed. A snapshot taken
when the screen opened would always have held `approvers: null`, and `refundBlockers` fails on
`!approverId`, so every offline refund would have been blocked however much of the rest worked.

⚠️ **Warming it is cheap, and the numbers are why it is acceptable:** `staleTime` is 5 minutes and
the query key is the **company**, not the lead — so it is one request per 5 minutes per session,
shared across every deal the rep opens, not one per open.

⚠️ **`cachedFeed` is served from inside the `queryFn`, not with `enabled: false`.** `isConfigured`
reads `query.isSuccess`; a disabled query never succeeds, so it would report "no approvers
configured" forever and block the refund it was meant to enable.

⚠️ **The cached/live distinction is in the query key.** Without it, a feed served from the
snapshot and one fetched live share a cache entry, and the first offline open would poison the
online result for the rest of the session.

Context, phases and the device checks still outstanding:
[`docs/MY-DEALS-OFFLINE-PLAN.md`](../MY-DEALS-OFFLINE-PLAN.md).

### Follow-up — the leads list now applies the offline RESULT overlay

`screens/Leads/index.tsx › sourceLeads › withWorkflow` gained
`.map((l) => applyOfflineResult(l, offlineWork))` ahead of the existing `applyOfflineWorkflow`.

A lead resulted at a door kept its server `status` (`selfGenerated`) until the submit uploaded,
so the card went on offering **"Resume Appointment"** for a sale the rep had already finished —
while Lead Center, which applies the overlay through `useLeadCenterData`, showed
**"Resulted — Sale"** on the same lead at the same moment.

⚠️ **Add overlays inside `withWorkflow`, never at the call sites.** It is the single funnel every
branch of `sourceLeads` passes through — rehash, archived, today, and the pending-offline path. A
call-site overlay is skipped by whichever branch someone adds next.

⚠️ **Order is load-bearing: result first, then workflow.** The workflow overlay carries the
check-in / resume marks; the result overlay has to supersede them once the lead is sold, or a
sold card can still read as in-progress.

Full ticket — why the overlay existed but was not being called, and the rule about two screens
disagreeing about one lead: [`offline.md`](offline.md).

### Follow-up — `addendumDraft` / `addendumRelease` steps (My Deals offline, Phase 2)

Two steps added to `utils/offline-lead-work.ts` (`UPLOAD_STEPS`, between `funding` and
`fundingCollect`) with their sync arms in `services/offlineLeadStore.ts`, plus
`saveOfflineAddendum(workClientId, { payload, contact, hasRefund })`.

| Step | Endpoint | Applicable when |
|---|---|---|
| `addendumDraft` | `POST lead/v1/{leadId}/job-builder-draft` | an addendum is queued and has no `addendumDraftId` yet |
| `addendumRelease` | `PATCH lead/v1/job-builder-draft/{draftId}/submit` | the draft landed **and `!hasRefund`** |

⚠️ **`addendumRelease` must never be applicable for a refund addendum.** The full consequence —
a signature silently dropped and the money never moving — is recorded in
[`offline.md`](offline.md). It has a test named for exactly that, so a future "simplification"
into one step fails loudly.

⚠️ **`addendumDraftId` is written by the draft step, not by the screen.** It is how the release
step addresses the right draft, and how a replay knows the create already landed.

⚠️ **Both default to `'guarded'` safety** via the fallthrough in `stepReplaySafety` — do not add
them to the `idempotent` list to quieten a retry. A repeat create files a second addendum.

⚠️ **The queued payload carries NO documents**, so `send()` never walks base64 in MMKV. The
offline gate refuses an addendum with attachments; Phase 4 lifts that.

⚠️ **The full-walk test excludes both steps deliberately** — an addendum belongs to a later visit
to an already-sold lead, not to the fixture that walks a lead from creation to submit.

### Follow-up — `addendumRefund` step (My Deals offline, Phase 3)

Third step added to the addendum chain in `utils/offline-lead-work.ts`, with its sync arm and
`saveOfflineAddendumRefund(...)` in `services/offlineLeadStore.ts`.

| Step | Endpoint | Applicable when |
|---|---|---|
| `addendumRefund` | `POST lead/v1/{leadId}/funding/{pid}/refund` | the draft landed **and** a cheque refund is queued |

Order is now `addendumDraft → addendumRefund → addendumRelease`.

⚠️ **It needs the draft's REAL id**, so it cannot run until `addendumDraft` has landed —
`isStepApplicable` requires `addendumDraftId`. The server's own check is only "valid ObjectId and
belongs to this lead", with no recency limit, so a refund raised minutes or days later still
links correctly.

⚠️ **`guarded`, and the retry READS first.** `isRefundAlreadyRaised(leadId, pid, draftId)` matches
on `draftId` before re-posting — a blind replay raises a **second** refund against the same
payment, which is real money.

⚠️ **`method: 'check'` is hard-coded in the step, not taken from the row.** The gate
(`addendumOfflineBlock`) already refuses to save a card refund offline, so anything that reaches
this step is a cheque by construction; writing the method through would invite a card refund in
by a route the gate never saw.

⚠️ **The release step stays skipped.** A lead with `addendumRefund` queued also has
`addendum.hasRefund === true`, so `addendumRelease` is still not applicable — the approver
releases it server-side. Do not "complete" the chain.

---

## Ticket — the consent sync step must leave a local trace behind it

Client: *"I submit the form and it's submitted successfully in online mode => I become offline =>
came back => and it's again allow me to submit the form."* A blank consent form on a lead that
already had one filed — a second signed customer record. Full diagnosis and the UI side:
[`lead-center.md`](lead-center.md).

The half that lives in this file is the **consent arm of the offline drain** (`runStep` →
`'consent'` in `services/offlineLeadStore.ts`). After `finalizeConsentUpload` succeeds it now also
calls `markConsentFiled(consentLeadId, form.kind)` from `services/consentFiledStore.ts`, beside the
existing `patchOfflineConsent(..., { uploadedAt })`.

⚠️ **The queue row is not a durable record of "already filed".** While a consent is queued,
`hasQueuedConsent` is the only offline proof it exists — but the row is cleaned up once the drain
succeeds, and `lead.generatedReports` (the other source) is server data that a cached lead taken
before the submission does not carry. Without the local log the form becomes offerable again on
the very next cached read, which is exactly the duplicate-signature bug. The drain must write the
fact down *before* it discards the evidence.

⚠️ Endpoints are unchanged — `user/consent/v1/mobile/create` (consent) and
`/lead/v1/{leadId}/mobile/waiver-form` (waiver), with `finalizeConsentUpload` skipped for a waiver
because that endpoint files its own `generatedReport` (REVDSM-1293). This change adds no request.

### Offline financing on the Result Lead sheet

Financing (`type: 'financing'`) is selectable offline; cards stay blocked (`methodAvailableOffline`). On the offline
Funding screen a loan row shows a "No signal" banner, the rep records Approve full / part / Decline and activates
(`handleRecordDecision` / `handleActivate` in `ResultJobModal` -> device record + queue). Sync / Send link are hidden
offline. Queue details and the link-stamping caveat: `offline.md` "Queues 9 and 10". Not verified on device.

### REVUIUX-519 (scope switch): collected money is reused or refunded, not blocked

Spec: `REVUIUX-519-mobile-scope-switch-addendum.md` (+ backend `e918bdd3`/`1deee65d`/`c166efcf`). Funding is lead-level; a
calculator switch on a lead with money held now asks the rep instead of refusing. Jira was NOT readable from this session
(no Jira tool) — built from the markdown only; the client's comments 30464 / 29849 / 30088 were not re-checked.
- **Contract:** `PUT /lead/v1/:leadId/funding` takes `settledAction: 'reuse' | 'refund' | 'reuseWithRefund'`
  (`FundingService.savePayments`, `useFunding.savePayments(price, rows, payMode, settledAction)`). `calculatorId` was already sent.
  Three 409s keyed on **`data.code`** (never the URL/message) become kinds `scopeNeedsDecision` / `scopeNeedsRefundApproval` /
  `scopeRefundFirst` with `settledAmount` / `overage` (`classifyFundingError`); `useFunding.report` shows no banner for them.
  `FUNDING_SCOPE_SWITCH_OVER_ALLOCATED` never shipped — do not add it.
- **UI:** `funding/ScopeSwitchPrompt.tsx`, an in-card overlay (never a nested Modal) rendered by `ResultJobModal` after Confirm:
  decision (re-use $X / refund $X, the re-use option warns when `overage` is present) -> `goFunding('reuse'|'refund')`;
  approval (server `message` verbatim, Yes -> `reuseWithRefund`, No -> nothing written); refund-first (message + OK).
  `refundDue` from the 200 shows as an amber "refund due" card on the Funding screen — it is NOT stored or re-read.
- ⚠️ **Settled rows are re-sent** (`withSettledRows` in `utils/funding.ts`): a row with `charged || collected` missing from the
  payload makes the server refuse the whole save ("Cannot remove $1,000 AMEX"). Keep their original pids.
- ⚠️ **`DynamicDealCenterScreen.handleResultJob` no longer pre-blocks** a Sale when another calculator holds collected money
  (`fundingPinnedToOtherCalculator` gate removed; the helper stays exported, the `fundingBlock` dialogs are now unreachable).
  Supersedes "collected money pins the lead to its calculator" and "Do NOT build the carry-over/refund flow".
- ⚠️ Blockers match the server (15 Oct wording): settled total above the price reads "$X more has been collected than the contract
  price — refund it to submit" (`scopeOverCollectedBlocker`); the old "more than the contract price is allocated" stays for
  un-collected over-allocation. Coverage is net of live refunds server-side; mobile `fundedAmount` is still gross — known gap.
- Not done: routing straight into the addendum/refund flow from `refundDue`; the My Deals edit wizard's own re-scope; offline
  (the queued `funding` step sends no `settledAction`, so a scope switch with money held still needs signal). Open with the
  client: whether the refund rule applies to a scope switch, and whether Submit may wait on approvals. Not verified on device.


## 1 Year plan sheet - `Change` opens a choose-default mode (star removed)

`OneYearMonthlyPlan.tsx`: the per-row star is gone. Tapping a row in the normal sheet only picks the plan for THIS deal (`commit('custom', key)`). The **Change** button on the MY DEFAULT PLAN card (and **Choose** on the no-default card) sets `chooseDefault`: a green "Choose your default plan / Done" banner replaces the card, rows show radios + a `CURRENT DEFAULT` badge, and tapping a non-default row opens a confirm sheet ("Set X as your default? / Replaces Y / Set as default / Cancel"). Confirm => `onSetRepDefault(key)` + `commit('custom', key)` + close. ⚠️ The confirm sheet is an absolute in-card overlay, NOT a second `Modal` (never stack native Modals). The default cannot be cleared from the sheet any more (`onSetRepDefault(null)` is still supported by the prop). Not verified on device.

`OneYearMonthlyPlan.tsx` `activeSeg`: the Match / Default toggle highlights what is DISPLAYED, not the stored `mode` - a `custom` pick equal to the rep default (checked first) or the In-Home plan lights that segment instead of leaving both blank; a plan matching neither still lights neither. The helper line still follows the stored mode. Not verified on device.

### 1 Year plan - activity logs + offline (follow-up to the choose-default sheet)

`RolloutView.logOneYearPlan` writes a `oneYearPlan` rollout log (`logRolloutChange` -> `logEvent`, so offline it joins the activity-log queue with its action-time key) for `1 year default plan set` / `cleared` (`setOneYearDefault`, only when the key really changes) and `1 year plan changed` (new `OneYearMonthlyPlan` prop `onPlanPicked`, fired from `commit` only). ⚠️ `onPlanPicked` must NOT fire from the Default re-stamp effect - that is not a rep action and would flood the log. Meta `offline` = connectivity at tap time. The default itself already queues via `saveDefault` -> `offline-settings.ts`; details in `offline.md` § "1 Year default plan - offline + activity logs". Not verified on device.

## Ticket 1308 — Forever Record tracks WHICH In-Home Pre Order discount was used

Client: *"Pls add in which in home pre order they're using. 15%, 20% or 25%. Use our same rules
with inheriting. Changed. etc."* The Forever Record showed the rollout price, payment method and
confirmation but never which pre-order discount produced the In-Home grand total, so a $333 total
on a $444 MSRP could not be explained from the log.

**Two moments, mirroring the payment-method rules** (`utils/activity-log/rollout-log-meta.ts`,
`logPreOrderDiscount`):

- **Seeded** — fired from `logEndPriceEntered` (`RolloutView.tsx`), i.e. when the rep commits the
  Rollout End Price, alongside the debounced `PUT /lfcalculators/:id`. The discount only means
  something once there is a price to apply it to, and the rep sees the entry while still on the
  screen. `oldValue` is empty; `action: 'in home pre order discount applied'`.
  ⚠️ **Not at Confirm Rollouts** — it was there in the first cut and was moved by request; do not
  move it back. Guarded by `seededDiscountRef` so editing the price again does not re-log an
  unchanged discount.
- **Changed** — fired from the chip's `onPress`, carrying old → new.
  `action: 'in home pre order discount changed'`.

Both go through `logRolloutChange`, so they inherit its `module_type: 'rollout_and_drop'` envelope,
tier prices and `percentageOfRollout` — the portal renders them with the existing rollout rows and
needs no new client.

- The value resolves the same way the UI does: `calculator.discountPercentage || pricing.defaultPreOrder`
  (`pricing.defaultPreOrder` comes from `useDealPricing`; the fallback is 25).
- `meta.isDefaultDiscount` records whether the figure came from the **rep's saved default** (the
  Default toggle writes `user.defaultPercentage`) rather than the company default — "15%" alone
  does not say which of the two it was.
- ⚠️ **`fieldCategory` is ALWAYS `'rollout'`**, before and after Confirm Rollouts. The first cut
  copied the payment-method logger's `isConfirmed ? 'drop' : 'rollout'` flip and was corrected by
  request: the discount is a property of the rollout itself, not of a drop, so a log written after
  confirming must read the same as one written before. The payment-method logger keeps its own
  flip — that one is deliberate. Do not re-add it here.
- ⚠️ **The chip logs BEFORE `onDiscountChange`.** `logDiscountChanged` reads `discountPct` for its
  `oldValue`, and the setter replaces it; calling them the other way round records old === new.
- ⚠️ **Early-returns on `next === discountPct`**, so re-tapping the active chip writes nothing.
- ⚠️ **A chip tap spends the seed** (`seededDiscountRef.current = true` in `logDiscountChanged`).
  A rep who picks a discount before typing a price has stated their choice; without this the later
  price entry would log the default *underneath* the change and the record would read 20% → 15%.
- **Offline is covered, and verified**: `rollout_and_drop` is not in `NON_QUEUEABLE_LOG_MODULES`
  (only `'system'` is), so `logEvent` holds these in the activity-log queue and replays them with
  the `occurredAt` taken when the rep acted, not when the request finally goes out. Nothing in
  `logEndPriceEntered` or `logDiscountChanged` awaits the network, so both run the same offline.
  `__tests__/utils/pre-order-discount-offline.test.ts` covers queueability, the action-time stamp,
  field survival through `stampOfflineLog`, and queue ordering behind the end-price log.
- ⚠️ `discountPct` can never be falsy (which would hit the `!opts.discountPercentage` early return):
  `calculator.discountPercentage || pricing.defaultPreOrder`, and `DISCOUNT_FALLBACK` in
  `useDealPricing.ts` guarantees `defaultPreOrder: 25` even when the discount config is missing —
  which is exactly the offline case.
- ⚠️ Both files are CRLF.
- Not verified on device, and not yet rendered in the portal: the backend/portal must display the
  two new actions.

---

## Ticket — `offlineResultOverlay` only knew about Sale and Demo

The three no-sale buttons in Job Docs (**No Demo**, **Not Hit**, **Reset**) now queue offline.
The UI side is in [`lead-center.md`](lead-center.md); the part that lives here is the queue model.

⚠️ **No new upload step was needed.** All three post the same shape to `submitJobBuilder` —
`leadData: { result, status, reason, timestamp }` — which is exactly what the existing `submit`
arm in `services/offlineLeadStore.ts` sends. `completeOfflineJobBuilder(workClientId, payload)`
is the writer, the same one `DynamicJobBuilderScreen` already uses for an offline Sale.

The gap was in `utils/offline-lead-work.ts`:

```
const result = String(leadData.result || '').toLowerCase();
if (result !== 'sale' && result !== 'demo') return null;   // ← Not Hit / No Demo / Reset dropped
```

So the work queued and would have uploaded correctly, but `applyOfflineResult` put **no overlay**
on the lead — the leads list showed it unresulted until the drain finished. ⚠️ **A rep who
results a lead and sees nothing change does it again**, which is how one door becomes two queued
results. The list is the only feedback they get.

`OFFLINE_RESULTABLE` now holds `sale`, `demo`, `nodemo`, `nothit`, `reset` (compared
lower-cased, since the payload uses camelCase).

⚠️ **`status` is a separate field from `result`.** The overlay used to return `status: result`.
A sale names its own status, but the no-sale outcomes carry a distinct `leadData.status`, and the
leads list and `LeadCard` colour-code on **status** — so reusing `result` mislabels the card. It
now returns `leadData.status || result`.

⚠️ **Keep the whitelist a whitelist.** An unrecognised result still returns `null` rather than
being passed through: an overlay built from a payload shape nobody has checked would show the rep
a status the server will never agree with.

⚠️ The overlay still stops at `status === 'uploaded'`, so once the row drains the server is the
truth again. Do not relax that — a stale overlay outranking real server data is the harder bug.

⚠️ **This `reset` is a lead RESULT, not `LeadService.resetLead`** (`lead/v1/{id}/reset`), which
deletes uploaded documents and stays online-only. Adding that one to this set would let a replay
destroy work the rep did after it.

### Follow-up — the Deal Center spinner on a weak line

The screen in the "one bar" client video (see `offline.md` for the connectivity side).

⚠️ **A bare spinner is a promise the screen cannot keep.** `isLoading` ORs three query flags and
gated the whole screen, so on a stalled line the rep got "Loading calculator…" with no message,
no progress and no way out — indistinguishable from a broken app.

`useSlowLoadHint(isLoading)` flips true after 4 s, and the spinner then names the problem and
offers **Work offline**.

⚠️ **`workFromDevice` exists because `isOnline()` is not enough.** `deviceIsAuthoritative` in
`useDynamicCalculators` was `!isOnline() || isClientId(...) || hasUnsyncedDealCenter(...)`. On one
bar `isOnline()` is **true**, so the cached quote already on the device was unreachable precisely
when it was needed. `preferDevice` forces that branch; the bootstrap key includes it
(`${leadId}:${device|net}`) so opting in re-runs the bootstrap rather than being swallowed by the
"already bootstrapped" guard.

⚠️ **Known, pre-existing: every hook in `DynamicDealCenterScreen` sits below an early return**
(`route?.params?.mode === 'edit'`, line ~63) — 28 `rules-of-hooks` errors, one of which is now
`useSlowLoadHint`. It is latent (the param does not change within a mount) but it is real, and
fixing it means splitting the edit mode into its own component. Worth a ticket; deliberately not
attempted inside a connectivity fix.

## Ticket — crash: "Rendered fewer hooks than expected" on View all

Reported from a client device with a red-box screenshot: pressing the **blue grid button**
(View all) in the Deal Center crashed the screen outright.

**The exact cause.** `DynamicDealCenterScreen` had an early return at the top —
`if (route?.params?.mode === 'edit') return <DynamicDealEditScreen/>` — placed after three
hooks and before the other ~40. React tolerated that only because `mode` never changes within
a mount. But it meant **every remaining hook in the file was formally conditional**, which the
linter had been reporting as 27 `rules-of-hooks` errors for a long time.

Two further early returns sit mid-body: `flowStep === 'jobBuilder'` and `flowStep === 'rollout'`.
`useSlowLoadHint` (added for the weak-connection ticket) landed *below* them. `flowStep` DOES
change at runtime — View all calls `setFlowStep('rollout')` — so:

| render | flowStep | hooks run |
|---|---|---|
| 1 | `calculator` | …N, including `useSlowLoadHint` |
| 2 | `rollout` | …N−1 — returns at the `rollout` branch first |

Fewer hooks on render 2 than render 1 is exactly what React refuses. Crash.

⚠️ **The 27 pre-existing errors were not noise — they were the loaded gun.** Any hook added
below those returns would have done this. A previous pass recorded them as "latent, worth a
ticket" and added a hook anyway; that was wrong, and this crash was the result.

**The fix, both halves:**
1. `useSlowLoadHint` hoisted above every early return.
2. Edit mode split into its own component. `DynamicDealCenterScreen` is now a two-line router
   (`mode === 'edit'` → `DynamicDealEditScreen`, else → `DynamicDealCenterCreate`), and all the
   create-flow hooks live in `DynamicDealCenterCreate` with nothing conditional above them.
   `rules-of-hooks` on this file: **28 → 0**.

⚠️ **Do not re-add an early return above the hooks in `DynamicDealCenterCreate`.** Route on a
prop in the wrapper and render a different component instead — that is what the wrapper is for.

**Swept the rest of the app.** The only other `rules-of-hooks` findings are
`DynamicTabRenderer.tsx` (10, behind `if (tab.isSummary)`) — safe in practice because it is
mounted with `key={currentTab.id}`, so a tab change remounts rather than re-rendering — and one
in `CalculatorSummary.tsx`, which is the naming rule on a Reanimated render prop, not
conditional ordering. Neither can produce this crash today; the TabRenderer one is the same
trap waiting for someone to add a hook below line 1297.

---

## Ticket — "Jobs Built — Back to Tools" stacked a second Lead Center

Pressing **Jobs Built — Back to Tools** landed on Lead Center, but pressing back from there went
to Lead Center *again* instead of the leads list — identically from the header arrow, the Android
hardware back and the iOS swipe, since all three simply pop.

`onRolloutsConfirmedDone` called:

```
navigation?.navigate('LeadCenter', { lead, tab: 'tools' });
```

⚠️ **`navigate` only REUSES an existing route when the params match.** With different params
React Navigation pushes a new copy, so the stack became
`Leads → LeadCenter → DynamicDealCenter → LeadCenter`.

⚠️ **A blind `goBack()` is NOT the fix.** `DynamicDealCenter` is opened from Lead Center,
Investment Center, Deal Detail, notifications and push routing. `goBack` would return to whichever
of those pushed it, and from a push there may be no Lead Center in the stack at all.

`utils/back-to-lead-center.ts` (pure, tested) plans it from `navigation.getState().routes`, and
`utils/navigate-back-to-lead-center.ts` applies it: **pop** when a Lead Center is already below,
**navigate** only when there is none.

⚠️ **The NEAREST Lead Center below the top, not the first.** A rep can legitimately be in
`LeadCenter(A) → DealCenter → LeadCenter(B) → DealCenter`; popping to A would throw away a screen
they still expect behind them.

⚠️ **A Lead Center on TOP of the stack is not a pop target** — popping zero screens would leave
the rep where they are with the button doing nothing.

⚠️ **The Tools tab is selected by a `SET_PARAMS` dispatch targeting the Lead Center route's
`key`.** A bare `navigation.setParams` writes to the route owning the navigation object — the Deal
Center being left — and would silently do nothing. It runs AFTER the pop and its failure is
swallowed: being on the right screen matters more than the right tab. (Popping restores Lead
Center as the rep left it, so without this a rep who had switched to Job Docs would return there.)

⚠️ Popping preserves the existing Lead Center's own params (`fromMyDeals`, appointment state);
re-navigating with fresh params would quietly reset them.

⚠️ Every step is defensive and falls back to the original `navigate`. This is a button pressed in
front of a customer — a navigation throw here would crash the app mid-deal.

Other screens that return to Lead Center (Investment Center, Deal Detail, Job Builder, RevRender)
already use `goBack()` and were correct; they are untouched.

---

## Ticket — Deal Center showed the calculator over a confirmed rollout on mobile data

> "I rolled out this lead, then opened Deal Center and it showed the calculator even though I
> rolled it out. After a few minutes when I got some internet it showed the rollout. Mostly
> these issues are coming in mobile data."

The rollout data was on the device the whole time. The bug was that the **online** loader in
`useDynamicCalculators.ts` never read the cache, and treated reads that never answered as
answers.

⚠️ **`isOnline()` is true on one bar of LTE, right up to the 15 s timeout.** So the branch that
runs for a rep with a weak cell signal is the *online* one — the branch with no snapshot
fallback. The offline branch below it was always correct (`resolveOfflineDealCenterSource`); it
simply never got the chance to run. **Do not "fix" a cache bug by only looking at the offline
path.**

Two separate failures, both of the same shape:

**1. A timed-out appointment lookup looked like "this lead has no appointment."**
`resolveAppointmentId` returned a bare `string | null`. It returns `null` when `getAppointments`
times out, `createAppointment` times out, *and* when the lead genuinely has none — three very
different facts collapsed into one value. The caller then did:

```
if (!apptId) { setLoading(false); return; }   // local-only mode → the blank `local-1` tab
```

It now returns `{ id, failed }`, and `failed` is set **only by a transport-level failure** —
⚠️ a 409 or any other 4xx is an *answer about this lead* and must not count as a failure, or a
lead that truly has no appointment would start borrowing a cached id.

**2. An empty read MINTED a calculator.** The `else` arm of `if (list.length)` called
`createRemoteTab` — a POST. A slow or partial empty response therefore created a real, empty
calculator on the server beside the rep's real one. This is the write-side version of the same
trap the Investment Center hit twice, and a likely contributor to **ticket 1310** (Forever
Record showing a confirmed rollout with no price): an extra empty calculator in the list.

### The rules, in `utils/deal-center-load.ts`

Pure module (CLAUDE.md §6 — `useDynamicCalculators.ts` imports React Native and cannot load
under jest). 19 tests in `__tests__/utils/deal-center-load.test.ts`.

- `readOutcome` — `answered-rows` / `answered-empty` / `unanswered`. ⚠️ A throw is `unanswered`
  **even when an empty array came with it**.
- `resolveOnlineLoadSource` — `server` / `cache` / `mint` / `hold`. ⚠️ **`mint` is the only
  outcome that writes**, and it is reachable from exactly one of the six input combinations:
  `answered-empty` **and** no cached rows. A test asserts that count directly, so widening it
  fails loudly.
- `hold` is deliberate: nothing proved and nothing cached means **leave the screen alone**
  rather than write a calculator we may be about to discover already exists.
- `resolveAppointmentFallback` — a *failed* lookup may fall back to the cached appointment id; a
  *successful* lookup that found nothing may not.
- `canUseLocalOnlyMode` — the blank-calculator path is now reachable only when the lookup
  answered **and** there is no snapshot.

⚠️ When the appointment id itself came from the cache (`source === 'cache'`), the loader does
**not** then call `getCalculators` — the lookup just proved the network is unreachable, so it
renders the snapshot and lets a later mount refresh. Adding that call back costs another 15 s
timeout for a result already known.

⚠️ `flowStep` still always starts at `'calculator'`; the rollout is reached through View-all.
That is unchanged and correct — the reported symptom was the *tabs* being blank, not the step.

### Follow-up - the Investment Center's calculator hook no longer overwrites the device record (2026-10-16)

`useDynamicCalculators` is mounted twice when a deal is completed from the Investment Center (its own copy plus the Deal Center it navigates to with
`resultOptIn`). The unmount cleanup always called `persistOffline()`, so the Investment Center's stale tabs replaced what the Deal Center had saved. It now flushes
only when `offlineDirty` (a change the debounce has not written). Details and the log side: `docs/claude/offline.md` (Investment Center follow-up).

- ⚠️ Any new write to the device record from this hook must go through `persistOffline` or set `offlineDirty`, or the unmount flush will skip it.

### Follow-up - Leads list offline check-in uses the shared rule (2026-10-16)

`screens/Leads/index.tsx` (`handleActionPress`, offline branch) decided the check-in log inline (`plan.logModule || (atTheDoor ? 'lead_check_in' : '')`). It now calls
`offlineCheckInModule(plan, atTheDoor)` from `utils/offline-lead-work.ts`, the same function the Zone Canvasser map uses, so the two entry points cannot drift.
Behaviour is unchanged. Details: `docs/claude/offline.md` (offline lead check-in follow-up).

- ⚠️ Keep the `lead_review` guard: it must not mark the lead checked in or queue a work-start.


## Duplicate calculator tab is optimistic online (no wait for the POST)

`useDynamicCalculators.handleDuplicateTab` used to `await createRemoteTab(...)` (a `POST /appointments/{id}/lfcalculators` carrying the full ~100+ entry array) BEFORE showing the copy, so Duplicate sat dead for the round trip. Now the online branch adds a `local-<ts>` copy (entries/totals/payment/discount cloned from the source) and selects it on the tap, then POSTs behind it and swaps the real id in (`tabsRef`, `setTabs`, `activeTabId` only if still on the temp, `cacheTabsSnapshotRef`).
- ⚠️ **The merge keeps the on-screen tab** (`{ ...created, ...latest, id, persisted: true }`), not the server's copy - the rep may already be typing into it. A `local-` tab is never saved (`flushSave` requires `persisted && isBackendId`), so if `entries`/`totals` changed while the POST was in flight the swap calls `markDirty(created.id)` to PUT them.
- ⚠️ **Deleted before the POST answered** => `deleteCalculator(created.id)` so no orphan server row. **POST failed** => the copy stays as the local-only tab the old fallback made. The `duplicate` log still rides the POST (`duplicateLog`); the payment-method-inherited log fires after the swap.
- Offline / device-authoritative duplicate (`deviceTabFrom`) was already instant and is untouched. Add (+) is still awaited - same pattern would apply. Not verified on device.


### Follow-up: the tab's three-dot menu opens instantly (`TabContextMenu`)

The Duplicate / Delete / Cancel menu's open state lived in `CalculatorView` (`menuIdx`), so tapping the dots re-rendered that whole screen - every tab, the field list, the footer - before the `Modal` could paint, and `animationType="fade"` added its duration on top. It is now `DynamicDealCenter/components/TabContextMenu.tsx`: a `memo`'d component that owns its own open state and is opened through a ref (`tabMenuRef.current?.open(idx)` from `HorizontalDraggableTabs.setMenuVisible`), with `animationType="none"`. ⚠️ Do NOT lift the open state back into `CalculatorView`. Delete still goes through the parent's confirmation (`onDeleteRequest` -> `setDeleteModal`); the classic `screens/DealCenter/index.tsx` menu is a separate copy and was not changed. Not verified on device.

## REVUIUX-557 - package tabs carry the SM / MD / LG rank (Deal Center + Investment Center)

Ticket: *"Add in our SM MD LG logic etc for packages"* (subtask of REVUIUX-518). `computeDerivedTitles` already ranks same-base calculators by price into `(SM)` / `(LG)` (`(SM)/(MD)/(LG)/(XL)...` from three levels up), but a FULL-PACKAGE tab renders only the box + `+extras` + ⓘ and never printed the title, so three packages quoted at different prices looked identical (the screenshot: three bare cube tabs).
- `tab-naming.ts` `getPackageSizeLabel(title)` returns the bare `SM`/`MD`/`LG`/`XL`/`XXL[-n]` from the title's trailing `(..)` (⚠️ markers stripped), else `''`. It reads the TITLE on purpose - the rank, tie handling and inherited-suffix logic are already decided there, so the badge cannot disagree with the name the portal sees. No ranking logic was duplicated or changed.
- Rendered as `(SM)` after the extras on: the calculator footer tabs (`CalculatorView.tabCalcs.packageSize` -> `HorizontalDraggableTabs`), and every `FullPackageTitle` that is handed a `title` (new optional `sizeLabel` prop, default `getPackageSizeLabel(title)`): the quote-card header, Result Job chooser/sheet, the rollout strip tabs (now pass `title={calc.title}`), the Investment Center tab row, and the Investment panel package heading (now passes `title`).
- ⚠️ Only shown when `isFullPackage` - non-package tabs already print their full name incl. the suffix. ⚠️ A package whose price TIES another keeps the portal title `⚠️ ... (SM) ⚠️`; the tab shows only the `(SM)` (the dynamic flow opts out of the classic duplicate-warning icon via `getIsDuplicate={() => false}`) - not changed here. A lone package (one price level) has no rank, so no suffix. Not verified on device.

---

## Ticket — the plus button must not create a second empty calculator

> "When we create a new calculator by pressing plus, disable the plus button until he adds
> something in that empty tab. If in the first tab he didn't add anything, the rep should be
> unable to create a new calculator. Show a splash message so the rep understands why."

Rules and 20 tests in `utils/calculator-tab-gate.ts` (pure — `CalculatorView` imports React
Native, CLAUDE.md §6).

### ⚠️ An "empty" tab is NOT a tab with no entries

This is the whole trap. `mergeFullEntries` seeds **every field in the schema** with
`inputValue: 0`, so a brand-new tab already carries a complete entries map.
`Object.keys(entries).length === 0` is therefore **never** true, and a gate written that way
silently never fires — it looks correct and does nothing. `hasAnyFieldValue` tests the
*values*, not the keys.

### ⚠️ What counts as "touched" is deliberately generous

`isTabEmpty` returns false for a typed quantity, non-zero totals, a price, a confirmed
rollout, a selected render **or** a drop. A tab can carry real work with no quantity typed on
it, and blocking the plus button in front of a customer because the app disagreed about what
work looks like is far worse than letting one extra tab through. When in doubt, allow.

⚠️ A **negative** value counts — a credit is an entry.

### ⚠️ The message never quotes the tab's title

First wording was `"2" is still empty`. A calculator is **named from what it contains**
(`G (LG)`, `G (SM)`), so a tab with nothing in it is *always* still on its placeholder: a bare
position number. Quoting that reads like a name the rep chose, points at a tab that exists
under no such name, and the number shifts as tabs are added, deleted or reordered.
`utils/rollout-status.ts` already encodes the same fact in `isPlaceholderCalculatorTitle` (an
all-digits title is a placeholder).

Two fixed strings instead, chosen by whether the empty tab is the one in view:

- `ADD_TAB_BLOCKED_MESSAGE` — "Add at least one item to this calculator before starting
  another one."
- `ADD_TAB_BLOCKED_MESSAGE_OTHER` — "One of your calculators is still empty. Add at least one
  item to it before starting another one."

`canAddCalculatorTab` takes `activeTabId` to pick between them. ⚠️ Tests assert the message
contains neither the placeholder number **nor** a real title — the rule is about the wording,
not about which titles happen to be safe.

### ⚠️ Gated on ANY empty tab, not the active one

The rep can add a tab, switch away and press plus again from elsewhere. Gating on
`activeTabId` alone would still leave blanks behind, which is the thing being prevented. The
message names the offending tab when there is more than one, so the rep knows where to go.

### ⚠️ No tabs at all is NOT blocked

`canAddCalculatorTab([])` allows. The first calculator is created by the screen itself; a gate
that refused here would leave a lead with no way to start. A test pins this.

### The button stays pressable

⚠️ It is dimmed (`opacity 0.4`) and carries `accessibilityState.disabled`, but it is **not** a
`disabled` TouchableOpacity. A disabled button swallows the tap and the rep learns nothing —
they press it again and then ask why the app is broken. It stays tappable and explains itself
with `FlashMessage.warning`.

### ⚠️ The regression this shipped with — a stale closure, not a stale rule

First version blocked the button **permanently** and showed **no message**, even after the rep
filled the tab. The gate logic was correct; its INPUT was stale.

`handleAddTab` is a `useCallback` whose dep array is **`tabs.length`, not `tabs`** — a
pre-existing optimisation, since adding a tab is the only thing that changes the length.
Typing a quantity does not, so the captured `tabs` stayed frozen at the empty state. The guard
read it, refused, and returned **before any UI ran**, which is why no flash appeared either.

Both halves are now read live:

- the hook reads **`tabsRef.current`**, the pattern that hook already uses elsewhere for
  exactly this reason — ⚠️ never the captured `tabs` prop;
- `CalculatorView` overlays the **active tab's live `entries` prop** over its copy in `tabs`,
  so the gate cannot lag one keystroke behind the field the rep is typing into.

⚠️ **The general lesson, which is not about this gate:** a predicate is only as fresh as what
you hand it, and adding a read to an existing callback silently inherits that callback's
staleness. Check the dep array before putting a new condition inside an old `useCallback`.

### ⚠️ The button is a `Pressable` with `hitSlop`, not a `TouchableOpacity`

Second report after the stale-closure fix: the button dimmed correctly, but tapping it showed
**no message**. Everything else checked out — the decision object carries both `title` and
`message` (printed for the real three-tab state), `FlashMessage.warning` works elsewhere in
this same file, and there is exactly one global flash host, mounted in `App.tsx`. The only
unproven link was the tap reaching the handler.

⚠️ **That add button sits in a 44pt row immediately beside `HorizontalDraggableTabs`**, and
this repo already records the trap: *a sibling `GestureDetector` swallows touches whatever its
`zIndex`* (CLAUDE.md §6). It is now a `Pressable` with `hitSlop={8}` and a pressed-state
opacity, which hit-tests more predictably next to a gesture handler and gives the rep visible
feedback that the press registered.

⚠️ **Its style is a plain OBJECT, never `Pressable`'s `({ pressed }) => ({...})` form.** The
first attempt used the callback form and the button rendered as a bare `+` icon with no grey
card behind it — the chrome was silently dropped. Same family as the `FlashMessage` trap in
CLAUDE.md §6: a style a library merges or re-evaluates loses keys. The style object is
byte-identical to the original `TouchableOpacity`, plus `opacity` for the blocked state, and
should stay that way.

⚠️ **Never give this button `disabled`.** A disabled button swallows the tap, so the
explanation — the entire point of the gate — can never fire. It stays pressable and refuses
out loud.

⚠️ The handler falls back to `ADD_TAB_BLOCKED_TITLE` / `ADD_TAB_BLOCKED_MESSAGE` rather than
passing `''`, so a decision missing its text can never produce a silent empty flash.

⚠️ **Not confirmed on device.** The gesture conflict is the most likely cause, not a proven
one. If the button visibly dims on press and there is still no message, the tap IS landing and
the flash is being swallowed instead — that is a different fix (a local `ModalFlashHost` on
this screen), not more work on the touch target.

### Both layers

`handleAddTab` (`useDynamicCalculators.ts`) re-checks and returns **quietly** — the UI owns the
message, and two flashes for one tap is worse than none. The hook is the only writer, so a
future caller that forgets the check still cannot create the blank tab.

⚠️ The gate reads only local tab state and never consults connectivity, so it behaves
identically offline and online. A test pins that too.

### Install calendar dims days no crew can take (REVDSM-1300)
`InstallDateCalendar` (this screen) and the calendar in `AppointmentSchedulerModal` call
`useInstallCalendarAvailability(month, leadId, enabled)`, which posts one month to
`installer/v1/installer-dispatch/availability/calendar` and dulls out (disables, `#e2e8f0` like Sundays and past
days) every day whose `available` is false. Lance's rule: a day with no crew for this job is not selectable.

- ⚠️ **Dim nothing unless it is certain.** `blockedDates` is empty when the call fails, the app is offline,
  `enforced` is false, or the user can override (managers book over a full day, Step 3). The per-day check
  (`useInstallAvailability`) still decides what a picked day offers, so a failed calendar call never blocks booking.
- Months already answered are kept per `leadId|yyyy-MM`; a failed month is asked again when it is next shown.
- A rep never sees which crew: this call carries no crew names.

### "Yes" books the time and assigns the crew (REVDSM-1300)
In the create flow (`!isEdit` with a `leadId`), **Yes** on *Does this time work for the customer?* calls
`bookInstallSlot` -> `POST installer/v1/installer-dispatch/availability/book`. The server re-checks the window
against the schedule as it is at that moment and assigns the crew it picks (first come, first served; sales only).
`SummaryFinalizeCards` now passes `leadId` to the modal, which also makes its availability checks job-aware.

- `taken` (409): "Time no longer available", the scheduler is asked again (`availabilityRefresh`) and the rep goes back to the calendar.
- `offline` (no response at all): "You need to be online to schedule this job." and the rep stays on the screen. Lance: scheduling requires a connection.
- Any other failure (`error`, 5xx, demo lead, nothing to assign) lets the booking continue as before; `submitJobBuilder` still tries to assign a lead that has no crew yet.
- ⚠️ Not done on the edit flow (`isEdit`, My Deals): rescheduling a job that already has a crew does not re-pick a crew.

### Create flow: availability is checked on "Yes" only (REVDSM-1300)
In `AppointmentSchedulerModal`, a NEW job with a lead (`!isEdit && leadId`, `checkOnYes`) no longer asks the scheduler when a date is picked (no per-day check, no calendar dimming). The one check is the **Yes** tap: the server checks that exact window (8-12 or 12-4) and assigns the crew. No crew -> a "No crew available" panel on the same screen with **Try <other window>** (only if it has not failed too) and **Pick Another Date**. Edit flows (`isEdit`) and callers without a `leadId` keep the earlier checks.
- A demo has its window checked too (409 if no crew) but no crew is assigned; only a sale is assigned.

## REVDSM-1300 - install scheduling on mobile: APIs, when they fire, and how availability is checked

Everything below is on the rep app; the rules themselves live in the backend (`InstallSchedulingService`,
`SchedulingEngine`). Code: `services/api/installAvailability.ts` (calls), `hooks/useInstallAvailability.ts`
(hooks), `widgets/modals/job-builder/AppointmentSchedulerModal.tsx` (create flow),
`screens/DynamicDealCenter/components/DynamicDealEditScreen.tsx` (My Deals edit wizard).

### APIs used (all need the rep's bearer token; base URL is `ENV.API_URL`)

| # | Method + path | Called from | Body | When it fires |
|---|---|---|---|---|
| 1 | `POST installer/v1/installer-dispatch/availability` | `fetchInstallAvailability` via `useInstallAvailability` | `{ date: 'yyyy-MM-dd', leadId? }` | Once a day is picked and the **time** step shows - **only** in flows that do not check on Yes (edit flows, and callers with no `leadId`). Re-asked if the date or `refreshKey` changes. Not sent while offline. |
| 2 | `POST installer/v1/installer-dispatch/availability/calendar` | `fetchInstallCalendarAvailability` via `useInstallCalendarAvailability` | `{ startDate, endDate, leadId? }` (one month; start is clamped to today) | When a calendar month is shown - in `DynamicDealEditScreen` (`InstallDateCalendar`) and in the scheduler modal **only** when it is not checking on Yes. One call per month, cached per `leadId|month|refreshKey`. |
| 3 | `POST installer/v1/installer-dispatch/availability/book` | `bookInstallSlot` in `handleAcceptSlot` | `{ leadId, date: 'yyyy-MM-dd', timeWindow: '8:00 AM - 12:00 PM', isSale }` | The rep taps **Yes** on "Does this time work for the customer?" - create flow only (`!isEdit && leadId`). |
| 4 | `POST lead/v1/{leadId}/job-builder` (`LeadService.submitJobBuilder`) | Complete Job | the job builder payload (existing) | Not new, but the backend now also tries to assign a crew here for a lead that still has none (safety net if Yes did not assign). |
| 5 | `POST` lead draft upsert (`LeadService.upsertLeadDraft`) | amendment flow | `{ scheduleTime }` (existing) | Edit flow with an amendment only. Unchanged by 1300. |

### Create flow (new job): the check is on "Yes" only
`checkOnYes = !isEdit && !!leadId`. Picking a date and moving between the two windows call **no** API. Tapping **Yes**:
1. `POST .../availability/book` with that date and exactly that window.
2. The server runs the scheduler for that one window (see "How the server decides"), and if a crew qualifies and the lead is a sale it creates the `InstallerAssignment`.
3. Result handling (`BookInstallResult`):

| Server answer | Result | What the rep sees |
|---|---|---|
| `200 { assigned: true/false }` | `booked` | Moves on to the success step. `assigned: false` (demo, switch off, manager override, already has a crew) is not an error. |
| `409` | `taken` | **"No crew available - No crew can take this job on <day> from <window>"** with **Try <other window>** (only if it has not failed too) and **Pick Another Date**. Nothing is booked. |
| no response at all (offline / timeout) | `offline` | Flash "Connection needed - You need to be online to schedule this job." Stays on the screen. |
| any other status (400/500) | `error` | Booking continues as before; `submitJobBuilder` retries the assignment. |

### How the server decides (same engine behind calls 1, 2 and 3)
- **Windows:** morning 8:00 AM - 12:00 PM, afternoon 12:00 PM - 4:00 PM.
- A crew qualifies for a window when **projected arrival <= window close - arrival buffer** (default 60 min: 11:00 AM / 3:00 PM).
- **Projected arrival:** a crew's first job of the day arrives at its start time (default 8:00 AM, or the window opening if later); every later job arrives at the previous job's end + drive time.
- **Eligibility:** within the crew's start/cutoff hours (default 8:00 AM / 8:00 PM, a hard stop - the rest of a long job carries to the next day), job duration from Global Estimates (or the crew's override, scaled for crew size), competencies, weekly availability and time off.
- **Choosing a crew:** earliest eligible arrival, then the tie-breaker (least drive time / lightest load / round-robin).
- **Drive time:** OpenRouteService matrix when the backend has `ORS_API_KEY`, otherwise a distance estimate; a crew's first job counts its warehouse leg only for tie-breaking and the saved `drive`.
- **Managers** (install dispatch / dispatch center / sales command center permission) can book a full window: calls 1-2 report `canOverride` and nothing is dimmed or blocked; call 3 assigns no crew for them.
- Call 2 reports, per day, whether any window has a qualifying crew; call 1 reports each window with its crew and arrival (crew names are for managers, not shown to reps).

### What never blocks a booking
Calls 1 and 2 resolve to `null` on any failure and the screens then offer everything; the offline case skips them entirely. Only a `409` (no crew) or being offline on **Yes** stops a rep.

## Ticket — duplicate calculator title strands an offline lead (409)

Client report: a lead stuck at **"Couldn't be uploaded — 1 of 3 uploaded"** with
*"LFCalculator title must be unique within this appointment for the current user"*. Pressing
**Try again** replays the same payload, so it fails forever.

`POST /appointments/{id}/lfcalculators` answers **409** when two calculators in one appointment
share a title for the same user. The rep gets there by **duplicating a tab**: `handleDuplicateTab`
(`hooks/useDynamicCalculators.ts`) deliberately copies the source's totals so both tabs price
identically, and `computeDerivedTitles` (`utils/tab-naming.ts`) ranks the size suffix **by price**
— equal price means no rank to separate them, so both land on the same name and the pair is
marked `⚠️ G ⚠️`. That marker was already the signal; nothing acted on it.

The guard is in `components/DynamicDealCenterScreen.tsx` on **`onViewAll`** (the blue button into
the rollout, and the only path to `setFlowStep('rollout')`): `hasTitleConflict(tabs)` blocks the
step and raises a `FlashMessage.warning` naming the duplicated title. Rules are pure in
`utils/calculator-title-conflict.ts` (26 tests).

⚠️ **Do NOT tell the rep to "rename" the tab — there is no rename in the UI.** `TabContextMenu`
offers Duplicate and Delete only (`onRenameTab` is plumbed through `CalculatorView` but never
reachable), and by the time the pair exists both tabs are usually rollout-confirmed and **locked**,
so editing is refused too. The first cut of this message said "long-press the tab to rename one",
which sent the rep hunting for a control that does not exist. A title is DERIVED from the products
and prices, so the only real fixes are **change the products/quantities on one** or **delete the
spare tab** — those are what the message now names.

⚠️ **Count the colliding group — it is not always a pair.** Duplicating twice gives THREE tabs
with one name; the first wording said "Two calculators" in front of three of them, which reads as
a different problem than the one on screen. `titleConflictMessage` now takes the count from the
group (`both` / `all`, and `the spare tab` / `the spare tabs`) and counts only the colliding
group, not every tab open.

⚠️ **The same rule runs online and offline, on purpose.** Online the 409 returns while the rep is
still on the screen; offline the POST is queued, the job is completed, and the 409 only surfaces
when the queue drains — too late to rename anything. Do not make this online-only: nothing should
reach the queue that the server is going to refuse.

⚠️ **Compare titles with the decorations STRIPPED.** `normalizeTitleForUniqueness` removes the
`⚠️` marks and the `📦 +` full-package prefix and lower-cases the rest, because `⚠️ G ⚠️` and `G`
are one title to the server. A comparison that kept them would miss the exact collision this
exists to catch.

⚠️ **An untitled tab is not a conflict.** A fresh tab has no derived name (`computeDerivedTitles`
falls back to its index), so empty titles are skipped — otherwise two new tabs would block the
rollout.

⚠️ **A lead already in the queue with this error is stuck and retrying cannot fix it.**
`describeQueueError` replaces the raw server string in `PendingLeadsBanner.tsx` and
`screens/PendingUploads/index.tsx` with wording that tells the rep to open the deal and rename.
It matches on **both** "lfcalculator" and "title must be unique" so an unrelated 409 passes
through untouched.

*Not done:* the rollout is blocked but the duplicate tab is not auto-renamed — the rep chooses the
name, since the two tabs are usually meant to be different scopes (that is why they duplicated).

### Follow-up — the offline payload sent the DISPLAY title (the real cause of the 409)

The guard above stops the rep reaching the rollout, but the question underneath was better:
**online, duplicating a tab succeeds; offline the same action 409s.** The payloads differ:

| | `title` sent to `POST /appointments/{id}/lfcalculators` |
|---|---|
| Online | `"2"` — the position placeholder |
| Offline | `"⚠️ S ⚠️"` — the **derived display title** |

⚠️ **The displayed title and the saved title are two different things.** `computeDerivedTitles`
gives two same-priced tabs one shared, decorated name so the rep can SEE the pair is ambiguous;
`getUniquePersistableTitles` then drops any title held by more than one tab, precisely so it is
never persisted. Both paths run that gate — what differed was the **fallback** in
`resolveSafeTitle` (`hooks/useDynamicCalculators.ts`):

```
persistable[tab.id] || lastSavedTitle.current[tab.id] || tab.title || '1'
```

Online, `lastSavedTitle` holds the title **the server confirmed** (`created.title`, i.e. `"2"`),
so the fallback was already unique and the bug was invisible. Offline nothing is ever confirmed —
and `persistOffline`'s `auto_rename` logging loop was writing the **derived** title into that same
map. The ambiguous name therefore looked "saved", the fallback returned it, and every queued copy
carried it. The 409 then could not be retried away.

Two changes:
- `utils/title-save-order.ts` gains `resolvePersistableTitle` + `isAmbiguousTitle` (pure, 12 tests,
  including a property test that a whole strip of identical tabs always resolves to distinct
  titles). It refuses an ambiguous title **even from `lastSaved`** and falls back to the position
  placeholder, which is what online sends.
- `persistOffline`'s logging loop now writes to its own `lastOfflineLoggedTitle` ref.

⚠️ **`lastSavedTitle` means "a title the SERVER acknowledged" — never write a local/derived title
into it.** It is load-bearing for uniqueness, not just for the `auto_rename` log. That conflation
is the whole bug.

⚠️ `utils/title-save-order.ts` is **pure ASCII** (CRLF) — the warning marks are written as
`'⚠️'` escapes. Do not paste the literal characters in.

### Follow-up — `tabFromServerCalculator` is a whitelist (`descriptionsByCategory`)

`lfcalculators` now returns `descriptionsByCategory` beside the flat `descriptions`, used by the
Investment Center to group its scope bullets under a `<categoryName> Installation:` heading (full
ticket: `docs/claude/investment-center-job-tracker.md`). `CalcTab` carries the field and
`tabFromServerCalculator` (`hooks/useDynamicCalculators.ts`) now copies it.

⚠️ **`tabFromServerCalculator` names every field it keeps — anything missing is silently dropped.**
The Investment Center takes its calculator from this hook, so a new API field that is not added to
that mapper never arrives: the consuming screen looks correct in code and renders nothing on
device, with no error anywhere. Add the field here when the API grows one.

### Follow-up — `queueLeadWorkEnd` accepts a client id

Full ticket: `docs/claude/lead-center.md` ("Leaving a lead: the pause LOG queued, the RELEASE did
not"). The queue-side change is here.

`queueLeadWorkEnd` (`services/offlineLeadStore.ts`) began `if (!id || isClientId(id)) return false`,
so the work-release for a lead created at the door was discarded — the normal case, not an edge
one. The rep stayed "ON SITE" on the portal after leaving the lead, while the pause log (which
does queue) arrived. It now attaches to the existing work item under that client id;
`beginOfflineWorkOnLead` cannot be used for this because it matches on `serverIds.leadId` only.

⚠️ **A client id is not a reason to drop queued work.** It means the lead has not been created
yet, which is precisely when the queue is needed — `workEnd` runs after `work` and after `lead`
in `UPLOAD_STEPS`, so the release replays against the real lead once the create lands.

### REVUIUX-569 - `utils/pdf-extract-jpeg.ts` and the summary tile pencil

`utils/pdf-extract-jpeg.ts` (`extractEmbeddedJpeg`, `countPdfPages`) is the inverse of `utils/jpeg-to-pdf.ts`: every order-sheet PDF this app writes is ONE page with the original JPEG embedded verbatim in one `/DCTDecode` XObject, so the scan is lifted straight out - no rasteriser. Non-conforming PDFs return `null`, never throw. ⚠️ **`convertJpegToPdf` must stay DETERMINISTIC** (same input -> identical base64; `tests/orderSheet/order-sheet-annotation.test.ts`): the backend correlates the office copy of an order sheet by hashing these bytes. `SummaryFinalizeCards` tiles get a pencil that opens the editor and re-reads the order sheets when the in-place job lands; see `lead-center.md` § "REVUIUX-569 - the backend contract".

- **Follow-up (REVUIUX-569):** `screens/DynamicDealCenter/utils/outcome-documents.ts` `LocalDocFile` / `resolveOutcomeDocRows` now carry `size` (`fileData.size`) and `annotation` for each order-sheet row, so the summary tiles can offer "Reset all changes" (see `deal-edit-addendums.md`). Additive: nothing that read the old fields changes.

## Description-of-Work templates: `[IF]` blocks + grid columns, and an agreement that works offline (Lighting)

Source: the backend hand-over `MOBILE-DESCRIPTION-TEMPLATE-CONDITIONALS.md` (branch `feature/description-template-conditionals`). The Lighting Footage line is ONE sentence whose storey clauses appear only when that storey was sold:
`1st Story: [lighting_1st_ft]'[IF lighting_2nd_ft > 0], 2nd Story: [lighting_2nd_ft]'[/IF][IF lighting_3rd_ft > 0], 3rd Story: ...[/IF] - Total: [lighting_total_ft]'`. The device renders Description of Work with its own copy of the evaluator and the SERVER renders the signed PDF with another; if the two disagree the customer reads one document and signs another (before this, `[IF ..]` markers vanished and the clauses always showed: `1st Story: ', 2nd Story: ', 3rd Story: '`).
- **Evaluator** (`utils/dynamic-job-builder/agreement/description-schema-evaluator.ts`, CRLF; tests `tests/agreement/description-conditionals.test.ts`): `[IF ref op value] .. [ELSE] .. [/IF]` (nests; `> >= < <= == !=`, aliases `=` / `<>`, words `isEmpty / isNotEmpty / exists`, a bare ref is a truthy test, `[IF Value > 0]` uses the line's own `valueReferenceId`) and `col:FIELDID:COLUMNKEY` = one column of a `locationGrid` summed over its rows.
- ⚠️ **`col:` is resolved in the CONTEXT layer** (`collect` / `getNumber` / `getText` / `getRaw`), not in `substitute()` - so one ref works in a merge token, a `condition.rules[].fieldId`, an `[IF]` and a calculated variable's `fields`. Don't fold it back into the merge.
- ⚠️ **The `[IF]` expression becomes a `SchemaRule` handed to `evaluateRule`** (new operator `truthy` for a bare ref) - the same function `condition.rules` use. A second comparison path would let "> 0" mean two things.
- ⚠️ **Conditionals resolve BEFORE the merge** (a token in a branch not taken is never read - tested with a `LEAK` value). ⚠️ **Forgiving on purpose:** an unclosed `[IF]` closes at the end; a stray `[ELSE]` / `[/IF]` is dropped, never printed on a signed document.
- ⚠️ **Variables are GLOBAL, `col:` refs are SCOPE-AWARE:** a calculated variable summing `col:grid:1st` totals ALL combination rows, a bare `[col:grid:1st]` in a combination-scoped line reads the CURRENT row. Deliberate (the live `Sum_Gutters` is "total across all rows"). A column selector on a scalar is ignored. `isEmpty` keeps its existing meaning (a numeric 0 variable is a value).
- ⚠️ **Keep the four evaluator copies in step** (backend job-scope, backend deal-centre, sales web, mobile) - the handover's 18-schema parity harness is not committed anywhere; rebuild it when touching any copy. The reference test here is the Lighting line (50' / 15' / total 65', 3rd storey absent).
- ⚠️ **The catalog may not be configured yet:** `lighting_1st_ft / 2nd / 3rd / total_ft` must exist as calculated variables in admin, or the line renders with unresolved tokens on EVERY surface incl. the PDF.

### Offline agreement - the configuration is data, so it must be SAVED while there is signal

The Lighting lines are config (`GET /sales-rep/v1/description-schema/:productId`, layout from `GET /sales-rep/v1/agreement-config`); offline the device evaluates the saved copy. Before, a schema was cached only after someone opened THAT product's agreement online, and the Investment Center's schema LIST was not cached at all.
- `hooks/useWarmDealCenterConfig` (mounted by the Leads screen) now also calls `useGetAgreementConfig`, `useGetDescriptionSchemas` (now through `cachedFetch`, new key `OFFLINE_CACHE.DESCRIPTION_SCHEMA_LIST`) and `useWarmDescriptionSchemas(agreementProductIds(verticals))` - one `useQueries` entry per product (`vertical.productId || vertical.id`, the id `VerticalSummaryTab` uses) sharing `descriptionSchemaQuery`, so warming and reading use the SAME key and cache entry.
- `DynamicAgreementDialog`: when the agreement is drawn LOCALLY and the schema fetch FAILED with nothing cached (`descriptionSchemaMissingOffline`, `utils/offline-agreement-config.ts`) it shows "This product's Description of Work hasn't been downloaded yet" instead of drawing. ⚠️ Without that the scope silently became "Project completion per summary details" on a document the customer signs. A product with NO schema configured (query succeeded with `null`) is not blocked.
- Not verified on device: sign in, open Leads online, go offline, generate a lighting agreement - the Lighting line shows only the storeys that were sold; a never-warmed product shows the message.

## Scanned order sheet / document looked stretched in the viewer

Opening a scanned Order Sheet (eye icon) showed the photo stretched to A4 proportions.

**Cause - the PDF itself.** `buildPdfParts` fixed the page at 595x842 and drew the image with
`595 0 0 842 0 0 cm`, i.e. forced to fill the page whatever its aspect. The viewer (`PdfPreviewModal`) was
faithfully showing a stretched page - nothing belongs there.

**Fix.** When the JPEG's real size is known, the page height is derived from it (`width * imgH / imgW`, width
kept), so the `cm` matrix scales uniformly. Unknown size still falls back to the passed page size.
Both builders (`convertJpegToPdf`, `convertJpegToPdfAsync`) share `buildPdfParts`.

- Only NEWLY generated PDFs are fixed; documents already filed stretched stay stretched. Re-scan to fix.
- Annotation re-wrap passes the original page size, but the page now follows the flattened image's aspect.
- Pages are no longer always A4 - do not re-introduce a fixed height.

## Ticket — Investment Center descriptions evaluated on device (2026-10-21)

Offline the "Includes the Following" panel showed bare category names ("Gutters"), and the scope
CHANGED once the lead synced — on the text a customer reads before signing.

The lines are rendered **server-side** inside `GET /appointments/:id/lfcalculators` and are **not
stored on the calculator**; no other endpoint returns them. So a calculator built offline has none
at all, and caching the calculator cannot help. They have to be evaluated on device.
Backend spec: `docs/MOBILE-DEAL-CENTER-DESCRIPTIONS-OFFLINE.md` (backend `staging`, 2026-10-21).
No backend change was needed.

⚠️ **TWO description-schema collections, same authoring UI, near-identical shapes:**

| endpoint | collection | input |
|---|---|---|
| `/sales-rep/v1/description-schema` | job builder | nested `verticalState` |
| `/company/v1/deal-center-description-schema` | **deal center** | flat calculator |

Caching the first does **not** give you the second. A first attempt cached the job-builder list
(`useGetDescriptionSchemas`) and the panel was unchanged. `useGetDealCenterDescriptionSchemas`
(`hooks/useDescriptionSchema.ts`) caches the right one; `DynamicDealCenterScreen` calls both purely
to **warm** them — it renders neither, and the Investment Center was otherwise the only screen
loading them, so a rep who never opened it had nothing cached.

`utils/deal-center-descriptions.ts` (pure, 36 tests) ports the backend evaluator.

⚠️ **`entries` has TWO shapes and both reach the evaluator.** The server sends an ARRAY; the app's
in-memory `CalcTab.entries` is a RECORD keyed by field id. The port checked `Array.isArray` alone,
so it flattened **nothing** for the on-device tab — every field looked absent, the presence gate
rejected every schema, and the panel fell back to category names. It failed by rendering the wrong
text rather than throwing, which is why it read as "the fix did not ship".

⚠️ **The presence gate inverts the usual reading of an empty condition.** A deal-center schema is
authored per product but an LFCalculator carries no product id, so every schema is evaluated
against every calculator and field presence keeps a Gutter schema silent on a Flooring one. A
mapping with **no condition at all is dropped** (it would print on every product), while inside the
evaluator an empty condition **passes**. Both are required — spec §4.

⚠️ **`mergeFullEntries` seeds every schema field with `inputValue: 0`, and `0` counts as PRESENT.**
So on device the gate matches every schema and the `> 0` rules do the real filtering. Two tests pin
the consequence: a fully seeded but empty calculator prints nothing, and a partly filled one prints
only the lines whose fields the rep filled.

⚠️ Other ported rules with tests: `entries[]` override same-named top-level keys (the backend's loop
runs after the spread); an object value is ABSENT (no grid support here); a numeric field of `0`
renders as `''`, not `"0"`; an unclosed `[IF]` closes at the end of the template while a stray
`[/IF]` is dropped; the flat and grouped lists dedupe **independently**; order is never sorted.

⚠️ **Server lines always win.** The local result only fills a gap and never overrides, so an online
deal renders exactly as before.

*Not done:* the panel does not re-evaluate when the rep edits a quantity on a calculator the server
HAS described (spec §8 suggests preferring local evaluation whenever values are dirty). Today it
keeps the server lines, which can be a snapshot from before the edit.

### Send Signed Agreement prompt - "Valid lead id is required" on a lead created offline, then reconnected

`widgets/modals/job-builder/AgreementDeliveryPrompt.tsx` gated its open-time `GET` and its Send (`PUT pdf-reports/v1/agreement/:leadId/delivery-preference`) on `isOnline()`. With signal back but the lead still keyed `lead-<ts>-<rand>`, a client id reached the server. Both now use `leadReachableOnServer(leadId)` (real id AND signal); otherwise the choice is queued (`queueDeliveryPreference`) and the agreement opens - the prompt must never hold the sale. A `LEAD_NOT_SYNCED` rejection queues too. ⚠️ Never gate a lead-scoped call on `isOnline()` alone. Full write-up and the app-wide guard: `docs/claude/offline.md` ("Unsynced lead"). Not verified on device.

### Lead card / Job docs: "Resulted - bank decline" now reads "Bank Decline"

`LeadCard.getLeadState` and `JobDocsSection.getStatusLabel` fell back to the raw `lead.status` ("bank decline") for any status without a hand-written label. The fallback now goes through `titleCaseStatus` (`utils/status-label.ts`, tested in `tests/offline/status-label.test.ts`): every word capitalised, `_`/`-` read as spaces. ⚠️ Known labels (`RESULTED_LABELS`, the Job-docs map) are untouched - add a label there rather than relying on the fallback. Not verified on device.

## Deal Center config warming now covers the deal-center description schemas (2026-10-22)

`hooks/useWarmDealCenterConfig.ts`, `hooks/useDescriptionSchema.ts` (`useGetDealCenterDescriptionSchemas`).
Endpoints: `/company/v1/deal-center-description-schema` (this one) vs `/sales-rep/v1/description-schema`
(job builder). Symptom, device evidence and the full table: [`investment-center-job-tracker.md`](investment-center-job-tracker.md)
§ *"Sometimes" the Investment Center scope was missing offline*.

Recorded here because both hooks are Deal Center paths. `useWarmDealCenterConfig` is the screen-agnostic
warmer (it runs from `screens/Leads`, not from the Deal Center) and it now fetches the DEAL CENTER
description schemas alongside the job-builder ones; `useGetDealCenterDescriptionSchemas` gained a
user-scoped query key and stopped caching an empty answer.

- ⚠️ **`DynamicDealCenterScreen` is NOT a warming point for anything a later screen needs.** Its comment
  says *"the Deal Center is always visited first"* - that assumption is false (a rep can go straight from a
  lead to the Investment Center) and it is per-user, so a second rep on the same handset got nothing. Put
  config warming in `useWarmDealCenterConfig`, which every session reaches.
- ⚠️ **The two description-schema collections are not interchangeable** - separate endpoints, separate
  unique `{companyId, productId}` indexes, same authoring UI. `useGetDescriptionSchemas` (job builder) and
  `useGetDealCenterDescriptionSchemas` must BOTH be warmed; caching one has already masked the other twice.
- ⚠️ **`.catch(() => [])` + a long `staleTime` makes a transient miss sticky.** The catch is right (it keeps
  the screen up), but the empty value must not be cached: `staleTime` is a function returning 0 when the
  list is empty, and `refetchOnReconnect` is on.
- ⚠️ **An owner-scoped MMKV cache needs an owner-scoped QUERY KEY too**, or the in-memory half is still
  shared between reps on one device.

## The Leads list's Today tab is day-scoped on BOTH halves (2026-10-22)

`screens/Leads/index.tsx` + `utils/offline-lead-work.ts` (`offlineLeadsForTab`, `isSameLocalDay`).
Full ticket, traps and tests: [`offline.md`](offline.md) § *The Today tab showed YESTERDAY's offline leads*.

Recorded here because `screens/Leads/**` is a Deal Center path: the list prepends queued offline leads to
the server list, and only the server half was day-filtered (`apiParams` sends `period: 'today'`). Every
un-uploaded lead therefore stayed pinned to Today until it synced.

- ⚠️ **`withWorkflow` is the single funnel for every overlay in this file** (rehash, archived, today,
  pending). The day filter sits on `offlineLeadsForTab`, i.e. on what is *fed into* that funnel - not at
  a call site - so no future path can skip it.
- ⚠️ **`todayAt` is optional and MUST stay omitted off the Today sub-tabs.** Archived / Sold / Rehash are
  not day-scoped; passing a stamp there would hide queued archived leads.
- ⚠️ **The lead is filtered from the TAB, never from the queue** - it still syncs and still shows on the
  pending-uploads banner.
