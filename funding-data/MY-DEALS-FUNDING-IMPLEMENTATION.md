# My Deals — Funding implementation (mobile)

**Branch:** `dev-v1-funding` · **As of:** 2026-08-25 · **Status:** built, unit-tested,
**not yet driven against a running server**

This is the rep-facing funding flow inside the **My Deals deal-edit wizard** — the
4-step "Edit Job Build" screen reached from the Deal pencil. It covers the two things
that landed together: the **Job Price step becoming the Deal Center's pricing + funding
flow**, and the **REVDSM-1160 API surface** underneath it.

Read alongside:

| doc | what it is |
|---|---|
| `Funding-my-deals-endpoint-data.md` | the backend's own API reference — the source of truth for shapes and status codes |
| `Funding-UI-Mokap-My-Deals-Code.txt` | the design mockup this screen reproduces (open it in a browser) |
| `FUNDING-MULTI-PAYMENT-FRONTEND-CHANGES.md` | the multi-method spec |
| `FUNDING-CHARGES-ENABLED-GATE-CLIENT-CHANGES.md` | the `charges_enabled` 409 |
| `CLAUDE.md` §"My Deals ▸ Job Price…" and §"REVDSM-1160…" | the same material with the full decision trail |

---

## 1. Where it lives

```
src/screens/DynamicDealCenter/
├─ components/
│  ├─ DynamicDealEditScreen.tsx        ← the 4-step wizard; step 2 is this feature
│  ├─ ResultJobModal.tsx               ← the SALE flow, shares every component below
│  └─ funding/
│     ├─ PaymentRowsGroup.tsx          ← the Down Payment / Balance line groups
│     ├─ FundingView.tsx               ← the funding screen body
│     ├─ PaymentFundingCard.tsx        ← one card per payment
│     ├─ FundingStepper.tsx            ← the per-row progress rail
│     ├─ SendLinkModal.tsx             ← QR / text / email send sheet
│     ├─ SegmentedChoice.tsx           ← Down Payment vs Upfront
│     ├─ CoverageBar.tsx               ← "does this add up"
│     ├─ BlockerList.tsx               ← why a button is off
│     └─ funding-theme.ts              ← the FUND palette
├─ hooks/useFunding.ts                 ← the single seam to the API
└─ utils/funding.ts                    ← every pure rule (testable, RN-free)

src/services/api/FundingService.ts     ← routes, types, error classification
src/utils/activity-log/funding-log.ts  ← the 20 funding events
```

**Tests** (`__tests__/screens/DynamicDealCenter/`): `funding.test.ts`,
`funding-multi-payment.test.ts`, `deal-edit-funding.test.ts`,
`funding-endpoints-1160.test.ts`. Plus `__tests__/utils/funding-log*.test.ts`.

> ⚠️ **Put new rules in `utils/funding.ts`, not in a component.** The components pull in
> React Native and cannot be loaded under jest in this repo. Every rule that can be
> *silently* wrong — coverage maths, what the chip may claim, when a row is removable —
> lives in the util for that reason.

---

## 2. The flow

Step 2 of the wizard (**Job Price**) is **two screens behind one step**, exactly as the
sale flow's `ResultJobModal` is:

```
Install Date → Job Build → ┌ Job Price ────────────┐ → Review & Submit → Submit Addendum
                           │ price ⇄ funding       │
                           └───────────────────────┘
```

| `priceScreen` | what it shows |
|---|---|
| `'price'` | PREVIOUS / NEW build tiers + Auto Adjust, the contract price, the **Down Payment** / **Balance** (or **Upfront**) groups, and the **Result** field |
| `'funding'` | `FundingView` — one card per payment, each driven to the end of its own life cycle |

- **Confirm →** `goFunding()`: validates `confirmGate`, `PUT`s the complete row list,
  and advances **only on success**.
- **Back / Edit payments / the header arrow** → `goPricing()`: folds any lender decision
  onto the rows via `applyDecisionsToRows`.
- **Next · Review →** advances the wizard to step 3.

⚠️ The header arrow is wired to `goPricing`, **not** `goBack`. It is the only path that
folds a decision back onto the rows; stepping past it would drop a decline the rep has
to price around.

⚠️ The funding sub-screen **hides the stepper** — it is a sub-screen of Job Price, not a
fifth step, and showing the tracker there would claim the rep had advanced.

---

## 3. What the screen reads back from the sale

`funding.load()` fires **on mount**, not on reaching step 2 — it resolves long before
the rep walks Install Date → Job Build, so the hydrate can never land mid-typing.

`hydrateRowsFromRecord(record, plans)` turns the saved sale into editable rows:

- `method` ← `planKeyForLabel(plans, p.method)` — the record holds the catalogue **LABEL**,
  the rows hold a plan **KEY**
- a **decided** row shows what the lender GRANTED (`approvedAmt`), not what was asked
- the last undecided balance row is flagged **`auto`** — the remainder row
- `linkSent` / `activated` / `archived` / `baseline` / `liveUsage` / `drifted` are mirrored
  onto the row so the chip and the amount beside it can never describe two moments

⚠️ **`pid` is preserved.** It is the server's merge key — minting fresh ids on every open
would file a second set of rows for the same deal on the next save.

⚠️ **Held until `pricing.isLoading` is false.** `planKeyForLabel` maps labels back through
the company's catalogue, and the static fallback would map a dynamic company's financing
plans to nothing — the rows would come back methodless and read as a change the rep never
made.

⚠️ **The contract price is NOT taken from the funding record** (the sale sheet does prefer
it). Here `lead.originalContractPrice` is the figure the addendum is edited *from*, and
the Review step diffs against it.

---

## 4. The API

Base `/lead/v1/:leadId/funding`. Everything goes through **`useFunding`** — never call
`FundingService` from a component.

| verb | route | hook action |
|---|---|---|
| GET | `/` | `load` / `refetch` |
| GET | `/:pid` | `refreshPayment` |
| PUT | `/` | `savePayments` |
| POST | `/:pid/link` | `fetchLink` |
| POST | `/:pid/link-sent` | `markLinkSent` |
| POST | `/:pid/card-on-file` | `markCardOnFile` |
| POST | `/:pid/charge` | `chargeCard` |
| POST | `/:pid/decision` | `recordDecision` |
| POST | `/:pid/activate` | `activateLoan` |
| POST | `/:pid/reactivate` | `reactivateLoan` |
| POST | `/:pid/restore` | `restoreArchivedPlan` |
| POST | `/:pid/check-collected` | `markCheckCollected` |
| POST | `/:pid/sync` | `syncPayment` |
| POST | `/sync-all` | `syncAll` |
| POST | `/submit` | `submit` |
| POST | `/result` | `setResult` |
| GET | `/company/v1/down-payment-limit/sales` | `FundingService.getDownPaymentLimit` |

### Rules that are not obvious

- **Every response is the complete record.** `apply()` adopts it wholesale.
  ⚠️ **Never patch a field locally** — several endpoints move more than the one you asked
  about, and ⚠️ **no step is ever ticked in the UI** (spec rule 3).
- **Headers:** `companyid` (400 without it) **and `userId`**. Without the second, every
  action is attributed to *"RevDSM" (system)* in the API's own audit trail
  (`collectedBy`, `events[].by`) — a check marked collected loses the rep's name. It is
  read off `useFunding`'s `logCtx` so the logs and the API can never disagree about who.
- **`PUT` replaces `payments` wholesale** — send the full array; an omitted row is deleted.
  It also carries **`payMode`**, so the structure is stored rather than guessed
  (`inferPayMode` cannot tell a contract paid in full by one down row from an upfront one).
- **`sync-all` is ONE call, not a loop.** Every response carries the whole record, so a
  per-row loop leaves the screen describing several different moments as it goes, and one
  unreachable lender aborted the rest. Failures come back itemised in `problems[]` and are
  surfaced as **info, not an error** — the other rows really were refreshed.
- **`restore` is SYMMETRIC.** Whatever is current goes onto the shelf in exchange, so a
  restore can itself be undone. Addressed by `archivedId`, **never by position** — the
  shelf reorders on every swap.
- **`reactivate` guards**: bank rows only, a decision must exist, refused on a declined
  row, `409` when it already matches. The UI pre-empts all four.
- **The down-payment limit is advisory.** The server enforces it (that is the new `422` on
  `PUT`); reading it is only so the rep sees the ceiling instead of being refused.

### Errors — `classifyFundingError`

| status | kind | what to do |
|---|---|---|
| 400 | `bug` | ours; loud in dev, no retry offered |
| 402 | `cardDeclined` | nothing moved; `action` decides the next button |
| 404 | `notFound` | re-GET |
| 409 | `stale` | re-GET and re-render — the dead button usually comes alive |
| **409 on `/link` or `/link-sent`** | **`setupRequired`** | ⚠️ **terminal.** See below |
| 422 | `rule` | show the message; retrying identically cannot help |
| 502 / 503 | `delivery` / `noProvider` | **nothing was written** — the step has not advanced |

> ⚠️ **`setupRequired` is the one 409 that must NOT be retried.** The company's Stripe
> account is connected but `charges_enabled: false`. Nothing about the record is stale, so
> the documented "refresh and retry" rule **loops**. It is decided from the request url
> (`isLinkEndpointUrl`) rather than by each caller, held once company-wide on
> `paymentsSetupError`, rendered as one banner, and every send is *withdrawn* rather than
> left live to fail — a rep shown only an error retries until they call support.

> ⚠️ The backend doc says *"the swallowed 422 on save — fix that before anything else"*.
> **That does not apply to mobile.** 422 → `rule` → a warning flash; a refused Confirm has
> always said why here. That note is about the web client.

### Socket

`useFunding` subscribes to **`funding-updated`** and adopts the record it carries, so a
homeowner finishing a hosted page or a lender answering lands on screen without a Sync tap.

⚠️ **The event is COMPANY-scoped** (room `company:${companyId}`), so it fires for every
lead in the company. Without the **`leadId` filter** this screen would adopt a different
job's record over its own — and `apply` replaces wholesale, so the rep would be looking at
someone else's payments with no error anywhere. Compared as **strings**: the id arrives off
a socket payload and off a nav param, and those are not guaranteed to be the same type.

⚠️ The payload is tolerated three ways (`{ funding }`, `{ data: { funding } }`, or the
record itself) because `MOBILE-FUNDING-CATCHUP.md`, which the API doc names as the source
for its shape, **is not in this repo**. Guessing wrong would silently ignore every update.

---

## 5. The pricing screen

### Rows

One flat `rows: PaymentRow[]` holds **both** structures. ⚠️ **Every calculation runs on
`activeRows`**, never on `rows` — the inactive structure's lines are still in state and
counting them would double the contract.

```
kind: 'down' | 'bal'          split mode
kind: 'up'                    upfront mode (a client-side grouping; the wire only knows down/bal)
auto: true                    the remainder row — holds whatever is left of the contract
decision: 'full'|'short'|'declined'   a locked FACT, not an input
```

The **auto row** is what stops the two halves silently failing to add up. It can be
dismissed once it holds `$0`; if money later comes unassigned, the last undecided balance
row **takes the auto flag back** rather than a deleted row being restored.

### The four scalars are DERIVED

The addendum draft still carries `downPayment` / `paymentMethod` / `balance` /
`balancePaymentMethod`. They are computed from the rows — summed totals plus the first
funded row's plan key — with the full breakdown riding **alongside** in
`downPayments` / `balancePayments` (`paymentAllocations`).

⚠️ **Additive, never a replacement.** ~20 consumers read the flat names, and the
customer-facing agreement and amendment renderers would degrade *silently* rather than
error. An un-upgraded reader sees a LOSSY view — one method named for a job that used
three — never a wrong one.

⚠️ **Never a joined `"Check + AMEX"`.** Every consumer resolves the value against the
plan catalogue, and `resolveTierPaymentMethod` (`utils/dynamic-deal-pricing.ts:51`)
**substring-sniffs** it to pick the bank fee that grosses up the whole contract — a joined
string containing `amex` would silently reprice a signed deal.

### Two phantom-change rules the sale sheet does not need

The Review step **diffs** these values, which `ResultJobModal` never does:

1. ⚠️ **The mirror falls back to a named row holding $0.** A deal sold with $0 down and
   `paymentMethod: 'check'` seeds a down row with a method and no money; the sale sheet's
   strict "first FUNDED row" rule returns `''` against a baseline of `check`, and the
   review lists a **Down Pmt Method** edit on a wizard the rep opened and did not touch —
   with Submit enabled behind it.
2. ⚠️ **`downPaymentChanged` rounds BOTH sides.** The rows hold whole dollars, so a stored
   `500.50` could never equal the `500` the field can express.

⚠️ The old standalone `downPaymentError` ("cannot exceed the contract price") is **moved,
not dropped**. With N lines the honest question is whether they *together* add up —
`confirmBlockers` asks it and `CoverageBar` shows it live. A per-field ceiling could only
check one line and would read as satisfied on a job over-allocated across two.

---

## 6. The design

`PaymentRowsGroup` serves both flows through **`layout`**:

| | `'panel'` (default) | `'plain'` (My Deals) |
|---|---|---|
| heading | notched out of `FUND.PANEL` | bold text over free-standing lines |
| remove | ✕ icon | bordered **Remove** button |
| method | dropdown (+ status pill when locked) | dropdown, **or the lender chip** |
| add | lavender pill | green `+ Add payment method` |

⚠️ **A prop, not a fork.** The auto row's arithmetic, the below-minimum gate, when a row
may be removed and what the chip may claim are all shared; two components would give two
screens two different answers, which is the exact class of bug this module keeps hitting.

### The lender chip — `showsChip(row)`

Which lines draw it is **structural, not stateful**, and it mirrors the mockup: its
`autoRowHtml` draws the chip for the **remainder** row, `simpleRowHtml` draws a dropdown
for every other line. So Down Payment reads `$500 · MC/VISA ⌄ · Remove` while Balance
reads `$2,363 · GreenSky · Approved & activated · ⇄ Swap`. A **decided** row joins it
wherever it sits — a verdict does not belong behind a chevron.

> ⚠️ **This first shipped gated on `hasLenderState` alone and that was the "Swap is
> missing" bug.** A balance seeded from the sale has a method but no lender activity, so
> it fell through to a plain dropdown — and with the chip went **Swap** and the **archived
> shelf**, the only controls that can change the plan or restore an archived one. Swap
> opens the *same* catalogue the dropdown does, so nothing is unpickable.

`lenderState(row, financing?)` decides what it says:

| state | tone | sub |
|---|---|---|
| `decision: 'declined'` | red | Declined by lender |
| `decision: 'full'` + `activated` | green | Approved & activated |
| `decision: 'full'` | green | Approved |
| `decision: 'short'` | green | Approved in part |
| `linkSent` | amber | Pending lender decision |
| nothing, financing plan | amber | Not yet submitted |
| nothing, cash/check | grey | Not yet submitted |

⚠️ **Order matters.** `declined` outranks a sent link, and `activated` only ever qualifies
an *approval*. This is the only control on the screen reporting a **third party's**
position: getting it wrong does not read as a rendering bug, it reads as the lender having
said something they did not.

⚠️ The `financing` flag only changes the un-submitted case, and for a real reason: a
financing balance with no application out yet is genuinely outstanding — somebody has to
send it — where a check the install crew collects needs nothing from anyone.

### Drift

`baseline` is what the lender committed to; `liveUsage` is what the job needs now. An
addendum that moves the contract price does this **every time**, so it is this wizard's
normal case, not an edge one.

- pricing screen: `driftNote(row)` → `Prior $2,863` / `−$500` under the amount
- funding card: **PRIOR → NEW** with a delta badge over **Reactivate loan for $X**

⚠️ Both require a **real baseline**: a row carrying the flag without one would render
*"Prior $0"*, which reads as the lender having committed to nothing. The button is gated
on `drifted && decision !== 'declined' && baseline > 0 && liveUsage !== baseline`, because
`reactivate` refuses a declined row and 409s when the two already match.

### Deliberate deviations from the mockup

- **The funding screen's primary button is `Next · Review →`, not `Submit Funding`.** The
  wizard's terminal action is the addendum. The blocker checklist still renders but
  **reports, it does not block** — submitting an addendum has never required funding to be
  complete, and a company behind the `charges_enabled` gate could otherwise not send a
  change the customer still has to sign.
- **The contract price is always editable; amber is "needs attention", not a lock** — an
  addendum exists to re-price the job.
- **Result is locked to `Sale` until a lender declines.** The switch goes through
  `funding.setResult`, which the server refuses without a logged decline. ⚠️ It sets the
  **funding record's** result only — the addendum draft still carries `lead.result`.
- **The mockup's archive/restore/swap *history* panel is not ported.** The deal center
  models the same fact already: a decided row locks with a pill, and
  `applyDecisionsToRows` opens the gap it left. A second parallel history is how "pending"
  comes to mean two things on one screen.
- **The mockup is visibly cramped at 390px** (the plan name truncates to `Gre…`, the status
  wraps under the button). Reproduced structurally, not pixel-for-pixel: on a chip row the
  amount column drops to 29%, the status may take two lines, and Swap is `flexShrink: 0`.

---

## 7. Activity logging

20 events, module **`funding`**, in `utils/activity-log/funding-log.ts`. Endpoint-driven
ones are fired **inside `useFunding`** — it is the only place the OUTCOME exists (a `sync`
message is what the lender actually said; a `402` is the difference between charged and
declined).

⚠️ Every event routes through a single `fire()`, which composes the **flow prefix** —
`resolveFundingSource({ lead, mode: 'edit' })` → `my_deals`, giving
`my_deals_funding_card_charged`. `module_type` stays `funding` for all three flows, so one
portal filter returns the whole money trail.

⚠️ **The hosted-page URL is never logged** — it is a bearer credential; anyone holding it
can complete that payment. `funding_link_copied` therefore takes no argument.

⚠️ **Failures are their own actions, not a flag** — a timeline showing only
`funding_card_charged` hides a run of declines.

---

## 8. Known gaps — read before picking this up

**Needs a device check (nothing here has been driven against a running server, and the
backend doc itself flags archive/restore, sync-all and the down-payment cap as
"unit-tested but never walked through HTTP"):**

- the Swap chip and archived shelf on a real approved row; **Restore**
- **Reactivate** on a genuinely drifted loan
- `sync-all`'s `problems[]`
- whether **`funding-updated` arrives without an explicit room join** — undocumented
- the split rows and pickers at real width; the Send Link sheet over the sticky footer
- the Review step listing **no** payment rows on a deal opened and left alone

**Not built server-side — do not design around it:** `funded` (the 4th financing step),
Card (Balance) → Charged, and **refunds/voids/reversals** (there is no path anywhere).

**Deliberately not implemented:**

- ⚠️ **`POST …/{pid}/mock-provider`.** The API doc lists it; it was removed from this repo
  on request because a tap wrote an invented approval onto a **real** funding record. A
  test asserts the route is absent. If a simulator is wanted again it belongs behind a
  build flag.
- `check-deposited` — a manager action at the office days later, not a rep-app screen.
- Spec **Stage 2 (per-row gross-up)** — blocked on a RevDSM decision. The landmine is not
  armed today only because the scalar mirror is one key and is never joined.

**Open with the backend:** whether funding is scoped to the **lead** or to a **calculator**
(it is lead-scoped today).

---

## 9. Verification baseline

| | |
|---|---|
| `npx tsc --noEmit` | **44 errors — all pre-existing.** Any 45th is yours |
| `npx jest` | **603 passing**, 1 pre-existing failure (`installer-card-state`, unrelated) |
| eslint | **0 errors.** `FundingService` / `utils/funding` / `useFunding` / `funding-log` are clean; the components carry only `react-native/no-inline-styles` |

⚠️ **This repo cannot render-test.** `@testing-library/react-native`'s `render` returns an
object with no queries (the React 19 shim in `__mocks__/test-renderer.js`), so component
tests are not possible — which is why every rule lives in a pure util and why §8 is a list
of device checks rather than a list of tests.

⚠️ Several files here are **CRLF** (`FundingService.ts`, `useFunding.ts`, `utils/funding.ts`,
`PaymentRowsGroup.tsx`, `PaymentFundingCard.tsx`, `funding-log.ts`). A script that reads and
writes in text mode rewrites every line and buries the change in a whole-file diff. Use
`newline=''` on both ends and check `file <path>` before and after.
