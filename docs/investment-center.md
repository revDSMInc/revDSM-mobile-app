# Investment Center — Developer Guide

> **Status:** shipped 2026-07-23 (commits `fdb8b56`, `92e8b15` "Investment Center fixes").
> **Platform:** React Native (this repo).
> **Web reference:** `../mhalt-revDSM-sales-frontend/src/sections/job/components/investment-center/`
> (`investment-panel.js`, `program-card.js`, `opt-in-confirm-modal.js`).
>
> The mobile app follows the web app for behaviour **except** where the client flagged a web bug —
> see [§7 The one deliberate divergence](#7-the-one-deliberate-divergence-from-web) (the "Includes the
> Following" job-scope list). Read that section before touching the scope matrix.

---

## 1. What the Investment Center is

The Investment Center is the **in-home presentation step**. After a rep has built and priced every
job in the **Dynamic** Deal Center, they open the Investment Center to *present the quote to the
customer*: the before/after RevRender images, a plain-English list of what the job includes, the
total investment (MSRP), and a side-by-side comparison of two purchase programs:

| Program | Meaning | On opt-in |
|---|---|---|
| **In-Home Pre-Order** (highlighted, green) | Buy now at the discounted pre-order price | Fires the real **Result Lead (Sale)** flow — this is a purchase |
| **1 Year Program** (dark, "PRICE LOCK") | A free 1-year price-lock quote (no discount) | Visual-only — just crosses off the In-Home card |

It sits between the Deal Center and the Job Builder in the sales funnel, and it is **gated on a signed
customer consent form**.

Entry point: **Lead Center → Tools → Investment Center** tile.

---

## 2. File map

Everything Investment-Center-specific lives in two places:

### The screen (`src/screens/InvestmentCenter/`)
| File | Lines | Role |
|---|---|---|
| [index.tsx](../src/screens/InvestmentCenter/index.tsx) | ~264 | Screen shell: consent gate, per-calculator tabs, opt-in handoff. `default export InvestmentCenterScreen` |
| [InvestmentPanel.tsx](../src/screens/InvestmentCenter/InvestmentPanel.tsx) | ~457 | One calculator's full presentation panel (renders, scope, totals, both program cards) |
| [ProgramCard.tsx](../src/screens/InvestmentCenter/ProgramCard.tsx) | ~145 | One program branch card (In-Home / 1-Year) |
| [OptInConfirmModal.tsx](../src/screens/InvestmentCenter/OptInConfirmModal.tsx) | ~116 | "Secure This Price" confirmation shown on In-Home opt-in |

### Supporting pieces in the Dynamic Deal Center (`src/screens/DynamicDealCenter/`)
| File | Role |
|---|---|
| [utils/investment-job-scope.ts](../src/screens/DynamicDealCenter/utils/investment-job-scope.ts) | **The scope-matrix builder** — the fix for the web bug (see §7) |
| [components/RevRenderSlots.tsx](../src/screens/DynamicDealCenter/components/RevRenderSlots.tsx) | "Add Renders" picker on the rollout card — writes `selectedRenders[]` that the panel reads |
| [components/OneYearMonthlyPlan.tsx](../src/screens/DynamicDealCenter/components/OneYearMonthlyPlan.tsx) | 1-Year monthly-plan selector on the rollout card — writes `oneYearMonthlyPlan{}` |
| [utils/dynamic-rollout-pricing.ts](../src/screens/DynamicDealCenter/utils/dynamic-rollout-pricing.ts) | `computeRolloutResult(...)` — the shared pricing engine the panel reuses so numbers match the rollout exactly |
| [hooks/useDealPricing.ts](../src/screens/DynamicDealCenter/hooks/useDealPricing.ts) | Backend-driven plans + discount config (`DealPricing`) |
| [hooks/useDynamicCalculators.ts](../src/screens/DynamicDealCenter/hooks/useDynamicCalculators.ts) | Calculator state + persistence (owns `selectedRenders` / `oneYearMonthlyPlan`) |

### Wiring points (files you touch to change entry/exit)
| File | What lives there |
|---|---|
| [src/navigation/index.tsx](../src/navigation/index.tsx) | Route registration `InvestmentCenter: { lead? }` (~L122, L207) + the `resultOptIn` param on `DynamicDealCenter` (~L113) |
| [src/screens/LeadCenter/index.tsx](../src/screens/LeadCenter/index.tsx) | `onShowInvestmentCenter={() => navigation.navigate('InvestmentCenter', { lead })}` (~L1358) |
| [src/widgets/components/LeadCenter/OperationalSections.tsx](../src/widgets/components/LeadCenter/OperationalSections.tsx) | The tile: lock/status/badge logic (~L169–186) |
| [src/hooks/useLeadCalculatorStatus.ts](../src/hooks/useLeadCalculatorStatus.ts) | `allConfirmed` gate that unlocks the tile |
| [src/screens/DynamicDealCenter/components/DynamicDealCenterScreen.tsx](../src/screens/DynamicDealCenter/components/DynamicDealCenterScreen.tsx) | Consumes `resultOptIn` → opens the Result Lead (Sale) modal (~L120–135) |

---

## 3. End-to-end flow

```
Lead Center (Tools tab)
      │  tile is LOCKED until every rollout is confirmed (useLeadCalculatorStatus.allConfirmed)
      ▼
InvestmentCenterScreen  (route: 'InvestmentCenter', param: { lead })
      │
      ├─ CONSENT GATE ──────────────────────────────────────────────
      │    hasSignedConsent(lead)?  ──no──▶ auto-open ConsentFormModal
      │         │                              (rep captures signature, PDF registered
      │         │                               as a consent_form report so the gate
      │         yes                            stays satisfied on reload)
      │         ▼
      ├─ TABS: one per priced calculator  (visible = named + confirmed/priced)
      │         ▼
      └─ InvestmentPanel (active calculator)
            • RevRender before/after images  (calculator.selectedRenders)
            • "Includes the Following:" DYNAMIC job-scope matrix   ◀── the §7 fix
            • TOTAL INVESTMENT = MSRP
            • 1 YEAR PROGRAM card  │  IN-HOME PRE-ORDER card
                   (opt-in = cross off)   (opt-in ▶ OptInConfirmModal)
                                                 │ "Secure This Price"
                                                 ▼
                            navigation.navigate('DynamicDealCenter',
                                { lead, resultOptIn: { calculatorId, price, paymentMethod, downPayment }})
                                                 │
                                                 ▼
                            DynamicDealCenterScreen reads resultOptIn (once),
                            selects that tab, opens the Result Lead (Sale) modal
                                                 │  "Build Job"
                                                 ▼
                                       Dynamic Job Builder
```

### Return path from the rollout
When the rep confirms all rollouts inside the Deal Center, the "Jobs Built — Back to Tools" button
navigates `LeadCenter, { lead, tab: 'tools' }` — the tile then shows unlocked/`Ready to present`.

---

## 4. The consent gate

The Investment Center cannot be presented until the customer has signed the digital consent form.

- **Check:** `hasSignedConsent(lead)` in [index.tsx](../src/screens/InvestmentCenter/index.tsx#L30)
  scans `generatedReports` across several lead shapes for a non-reset report whose type/name/path
  looks like `consent_form`. This mirrors `OperationalSections.findReport('consent_form')`.
- **Auto-open:** if unsigned, the `ConsentFormModal` opens automatically once per mount (via
  `consentAutoOpenedRef`) — the rep does not tap through a placeholder gate first.
- **Submit:** `handleConsentSubmit` calls:
  1. `useSubmitDigitalConsentMutation` → returns the generated PDF path (a string).
  2. `useFinalizeConsentUploadMutation({ leadId, pdfPath, reportType: 'consent_form' })` — registers
     the PDF as a consent report so the gate stays satisfied after a reload. (`.catch(() => {})` — a
     finalize failure must not block the rep; local `localConsentSigned` still unlocks the session.)
- **Exit:** closing the consent modal doesn't just dismiss — it raises `showExitConfirm`
  ("Exit consent form?"), and confirming returns to the Tools menu. Declining keeps the form open.
- **Header badge:** a green **SIGNED** pill shows once consent is on file.

> The **tile** in `OperationalSections` also shows a `SIGNED` badge and a "Consent on file — present
> quote" status when `allConfirmed && consentReport`, but the badge is cosmetic — the real gate is
> inside the screen.

---

## 5. The tile: lock + status logic

In [OperationalSections.tsx](../src/widgets/components/LeadCenter/OperationalSections.tsx#L169):

- **Gate:** `allConfirmed` from `useLeadCalculatorStatus(lead)` (web `allJobsConfirmed`) = at least one
  *real* calculator exists AND every real calculator has `isRolloutConfirmed`. A "real" calculator is
  one with a non-bare-number title (e.g. `G+LF`) or ≥1 entered value — bare-number placeholders like
  `"1"` don't count.
- **Locked state:** the tile stays **tappable** on purpose; tapping while locked shows
  `FlashMessage.warning('Investment Center', 'Please build and confirm all rollouts first.')` instead
  of navigating. (`ToolCard` never hard-disables on `locked`; only `isLoading` disables.)
- The status refetches on screen focus (`useFocusEffect`) so returning from the Deal Center reflects a
  newly confirmed rollout.

`useLeadCalculatorStatus` is **read-only** — unlike `useDynamicCalculators` it NEVER creates an
appointment or calculator; it only resolves an existing appointment (by `lead.appointmentId`, else by
matching human `leadId`/`selfGenLeadId` on the lead-date) and reads its calculators.

---

## 6. The panel: data sources & pricing

`InvestmentPanel` is rendered per **active calculator** (keyed by `active.id` so switching tabs
remounts clean state). Its inputs:

| Prop | Source | Purpose |
|---|---|---|
| `calculator` | `useDynamicCalculators(lead, verticals).tabs` (filtered to `visible`) | the priced calc: entries, price, drops, `selectedRenders`, `oneYearMonthlyPlan`, `paymentMethod`, `downPayment` |
| `pricing` | `useDealPricing(lead)` | plans, discount config, pre-order options, Sr+Vet %, default method |
| `verticals` | `useCalculatorSchema().configuredSchemas` | System-A calculator schemas (for tier prices, screen price, product names) |
| `pricingConfig` | `useCalculatorSchema().pricingConfig` | derived-tier resolution |
| `jobBuilderConfig` | `useDynamicCalculatorSchemas().config` | System-B config — needed by the scope builder |
| `descriptionSchemas` | `useGetDescriptionSchemas().schemas` | per-vertical agreement description schemas — the scope sentences |
| `lead` | route param | lowest-priority data source + `lowesLead` flag |

### Which price is presented
```
drops        = calculator.dropPrice (array)
acceptedDrop = drops.find(d => d.status === 'accepted')
endPrice     = acceptedDrop?.price || calculator.price      // a negotiated drop wins
hasDrop      = acceptedDrop exists AND differs from the confirmed price   // shows "Negotiated $X · was $Y"
```

### The math is the SAME engine as the rollout
The panel calls `computeRolloutResult(...)` from
[dynamic-rollout-pricing.ts](../src/screens/DynamicDealCenter/utils/dynamic-rollout-pricing.ts) — the
identical function the rollout quote card uses. This is deliberate: **the numbers the customer sees in
the Investment Center must exactly match what the rep locked in the rollout.** Do not re-derive MSRP or
program totals independently here.

Inputs to `computeRolloutResult`: `endPrice`, `screensCount` (from `number_of_screen` entry),
`screenUnitPrice` (live from schema), `discountConfig`, `discountPct`, `seniorVetPct`, `downPayment`,
`plan`. Outputs: `msrp`, `programs[]` (each with `grandTotal`, `isHighlighted`), `monthly`.

- **In-Home program** = `programs.find(isHighlighted)` — Total → −Sr+Vet% → −Discount% → Grand Total.
- **1-Year program** = the non-highlighted one — Total → −Sr+Vet% → Grand Total (no pre-order discount).
- **MSRP** is shown as **TOTAL INVESTMENT**.

### Live-adjustable during the presentation
The rep can tweak these in-panel and the cards recompute instantly (they are **local state**, not
persisted from the panel):

- **Pre-order discount %** (`discountPct`, seeded from `calculator.discountPercentage` /
  `pricing.defaultPreOrder`) — the tiles from `pricing.preOrderOptions`.
- **Down payment** — In-Home and 1-Year each have their **own independent** down-payment control
  (`renderDownEditor`), capped at that card's price.
- **Basic method badge** (CK / CC / ACH…) next to each Grand Total (`effectiveBadge`).

### The 1-Year monthly payment
Resolved from the saved `calculator.oneYearMonthlyPlan` selection (set on the rollout card via
`OneYearMonthlyPlan`):
- `mode: 'match'` → use the In-Home selected plan's key.
- `mode: 'custom'` → use `oneYearMonthlyPlan.planKey`.
- `mode: 'default'` / absent → `defaultOneYearKey` (first ~9.99% APR financing plan, else first
  financing plan).
Then `calcMonthly(plans, oneYearGrandTotal, oneYearKey)`.

### Renders
`calculator.selectedRenders` (before/after pairs the rep attached on the rollout card). Stored S3 URLs
may have expired, so the panel re-resolves fresh secure URLs via `useSecureUrls`
(`beforeUriOf`/`afterUriOf` fall back to stored → `resolveS3Url`). Tapping opens a full-screen preview.

---

## 7. The one deliberate divergence from web

> **This is the single most important thing to understand before editing the scope list.**

The "**Includes the Following:**" bullet list must be the **dynamic, per-product job-scope matrix** for
*this* calculator — NOT the web app's hardcoded `GUTTER_INCLUSIONS`.

**The web bug (flagged by the client):** the web `investment-panel.js` shows a fixed gutter bullet list
regardless of what products the calculator actually contains — so a
`Gutters + Versaguard + LeafFilter + Soffit + Fascia Wrap` job still showed only gutter bullets. Mobile
does **not** replicate that bug.

**How the correct matrix is built** — [investment-job-scope.ts](../src/screens/DynamicDealCenter/utils/investment-job-scope.ts) `buildInvestmentJobScope(...)`:

The real scope sentences come from the dynamic **agreement description-schema engine**
(`evaluateDescriptionSchema`), which is keyed by **job-builder** field/section ids. That is a
**different namespace** than the calculator's `entries` (which use **calculator-schema** ids). You
**cannot** feed calculator entries straight into the description evaluator. The bridge is the `dcField`
mapping baked into the job-builder config:

```
1. If the calc was already built → use its persisted dynamicJobState
   (richest; includes manually-entered job-builder fields):
       deserializeDynamicJobStateFromStorage(savedJobState, jobBuilderConfig) → verticalState

2. Otherwise reconstruct verticalState from the calculator's own entries (the always-available path):
       buildDealCenterData({ entries, schemas, lead })        // calc entries → dcData (keyed by dcField)
       → buildInitialJobState(jobBuilderConfig, dealCenterData) // dcData → job-builder verticalState

3. For every descriptionSchema:
       evaluateDescriptionSchema(schema, {}, verticalState) → sentences

4. stripScopeLine(sentence) on each:
       - strip FOOTAGES  (— 120', 12 sq, 4 ea, lf, hrs, sheets…)   ← "no footages"
       - drop unresolved [tokens] / empty parens (blank colors)     ← "no colors"
       - KEEP inch sizes (6")  — that's product size, not footage
   then dedupe (first-seen order), drop lines < 3 chars.
```

The requirement, verbatim: *"no footages, no colors, in order."*

**If you change how the scope is produced, keep this contract:** the list must reflect the actual
products in the calculator, and it must not print footages or blank color placeholders.

---

## 8. Persisted calculator fields the Investment Center depends on

Two fields were added to the calculator model specifically for this flow. They are set on the **rollout
card** and read back in the **Investment Center**. Both live in
[useDynamicCalculators.ts](../src/screens/DynamicDealCenter/hooks/useDynamicCalculators.ts) and persist
via the same debounced `PUT /lfcalculators/{id}` as every other calculator field.

| Field | Type | Set by | Read by | Setter |
|---|---|---|---|---|
| `selectedRenders` | `RenderPair[]` | `RevRenderSlots` on the rollout card | `InvestmentPanel` renders strip | `handleSetRenders` |
| `oneYearMonthlyPlan` | `{ mode, planKey?, apr?, monthlyPayment?, grandTotal?, isDefault? } \| null` | `OneYearMonthlyPlan` on the rollout card | `InvestmentPanel` 1-Year monthly | `handleSetOneYearMonthly` |

For each new field, the round-trip touches these spots (grep them if adding a third field):
`CalcTab` type · `buildPayload` (~L385) · hydrate from server (~L533) · `tabSignature`/`renderSig`
(~L138 — so a change marks the tab dirty and triggers a save) · the setter (~L895) · the return object
(~L1017).

**Sanitizer gotcha:** `sanitizeCalculatorPayload` in
[services/api/leads.ts](../src/services/api/leads.ts#L87) coerces empty values to `0` by default. Both
new fields carry string-valued descriptor sub-fields (S3 keys, plan labels, `mode`), so they are
**whitelisted** to keep `''` instead of being turned into `0`. If you add another string-bearing field,
whitelist it too or its labels will silently become zeros on save.

---

## 9. The opt-in handoff (In-Home → Sale)

Opting into **In-Home Pre-Order** is a real purchase. The flow:

1. `ProgramCard` In-Home `onOptIn` → `setShowConfirm(true)` → `OptInConfirmModal` ("Secure This Price",
   shows price + method badges + down/balance + monthly).
2. "Secure This Price" → `confirmInHome()` → `onOptIn(calculator.id, { price: endPrice, paymentMethod,
   downPayment })`.
3. The screen's `handleOptIn` navigates:
   ```ts
   navigation.navigate('DynamicDealCenter', {
     lead,
     resultOptIn: { calculatorId, price, paymentMethod, downPayment },
   });
   ```
4. `DynamicDealCenterScreen` reads `route.params.resultOptIn` **once** (guarded by
   `optInHandledRef` so it doesn't reopen after the rep closes the modal), waits for calculators to
   load, selects that tab, and opens the **Result Lead (Sale)** modal pre-filled with the secured
   price/plan/down payment (web parity: `TabbedCalculator.readPendingOptIn`).
5. From there the standard Result Lead → **Build Job** path runs, which completes the *Lead Resulted*
   milestone (`leadResulted: 'completed'`, `jobBuild: 'active'`) and enters the Job Builder.

The **1-Year Program** card's opt-in is visual only: `setSelectedProgram('oneyear')` just crosses off
the In-Home card (and vice-versa). Selecting one program renders a strikethrough overlay on the other;
tapping the overlay's ✕ (`onRevert`) clears the selection.

---

## 10. Gotchas & things to know

- **`key={active.id}` on the panel** — switching calculator tabs fully remounts `InvestmentPanel`, so
  all its local UI state (discount %, down payments, selected program) resets per calculator. Intended.
- **The panel's live tweaks (discount %, down payment) are NOT persisted from the Investment Center.**
  They seed from the calculator but only affect the presentation numbers in-session. The persisted
  values come from the rollout. If the client asks for the Investment Center to save discount/down
  changes back, you'd need to thread setters through like the rollout does.
- **`hasSignedConsent` reads several lead shapes** because the consent report can live under
  `generatedReports`, `outcomeData`, `leadData`, or `outcome` depending on how the lead was loaded.
  Keep all branches if you refactor.
- **Empty states** are explicit: unsigned consent, no priced calculators ("Confirm a rollout in the
  Deal Center first"), and empty scope ("Job scope will appear once products are configured").
- **Two normalization namespaces** — the scope builder is the one place calculator-schema ids and
  job-builder ids meet. Never assume an `entries` field id will resolve against the description schema
  directly; always go through the `dcField` bridge.
- **`useDealPricing` endpoints are ported from web but were not yet runtime-verified on the mobile demo
  API** at the time of writing (`/payment-plans/v1/sales/provider-plans`,
  `/company/v1/discount-config/sales`). There's a static fallback (`isDynamic` flags which path is
  live), so the UI works either way, but confirm the live values if numbers look off.
- **RevRender secure URLs expire** — always resolve fresh (`useSecureUrls`) rather than trusting the
  stored `s3UrlGenerated`/`s3UrlOriginal` on `selectedRenders`.

---

## 11. Related endpoints (all mirror web)

| Purpose | Endpoint | Hook |
|---|---|---|
| Calculator schemas (System A) | `GET /calculator-form-schemas/deal-center` | `useCalculatorSchema` |
| Job-builder config (System B) | `GET /company/v1/job-builder-products` | `useDynamicCalculatorSchemas` |
| Description schemas (scope sentences) | `GET /sales-rep/v1/description-schema` | `useGetDescriptionSchemas` |
| Payment plans | `GET /payment-plans/v1/sales/provider-plans` | `useDealPricing` |
| Discount config | `GET /company/v1/discount-config/sales` | `useDealPricing` |
| Calculators (read/create/update) | `GET/POST /appointments/{id}/lfcalculators`, `PUT/DELETE /lfcalculators/{id}` | `useDynamicCalculators` |
| RevRender runs (renders) | via `useRevRenderRunsQuery(leadId)` | `RevRenderSlots` |
| Digital consent | submit + finalize mutations | `useSubmitDigitalConsentMutation`, `useFinalizeConsentUploadMutation` |

---

## 12. Quick "how do I…" index

- **Change the entry gate** → `useLeadCalculatorStatus.allConfirmed` + the tile in `OperationalSections`.
- **Change what "included in the job" shows** → `buildInvestmentJobScope` / `stripScopeLine` (see §7).
- **Change the presented price/MSRP/programs** → `computeRolloutResult` in `dynamic-rollout-pricing.ts`
  (shared with the rollout — changes affect both).
- **Change the opt-in destination** → `handleOptIn` in `index.tsx` + `resultOptIn` handling in
  `DynamicDealCenterScreen`.
- **Add a new persisted per-calculator field for the panel** → follow the 6-spot checklist in §8.
- **Change the consent behaviour** → `handleConsentSubmit` / `hasSignedConsent` / `ConsentFormModal`.
