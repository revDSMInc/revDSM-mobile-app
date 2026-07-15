# Dynamic Deal Center — Mobile ↔ Web Parity Audit & Implementation Plan

> Scope: end-to-end payload / validation / logging comparison of the mobile **Dynamic Deal Center →
> Rollout → Result → Job Builder** flow against the web source of truth
> (`mhalt-revDSM-sales-frontend`). Web is the source of truth. Generated 2026-07-15.
>
> Legend — Severity: **H** money/data-loss/pipeline · **M** config-dependent or shape drift · **L** cosmetic/analytics.
> Status: ✅ implemented + tested · 🟡 partial · ⏳ deferred (reason noted).

---

## Implementation status (2026-07-15)

All changes are covered by Jest (run with **Node 22**: `nvm use 22.11.0 && node ./node_modules/.bin/jest`).
Full suite: **628 passing**. New util modules are 100% unit-tested against web-derived expectations.

**Done:**
- **Phase 0** — harness repaired: `react-native-mmkv` mock, portable golden-fixture parity tests
  (`__tests__/fixtures/parity-golden.json` + guarded generator), `testMatch` restricted to `*.test.*`.
- **Phase 1 (pricing)** — 1.1 monthly $35 floor + label cases, 1.2 data-driven MSRP/programs + ≥100% clamp,
  1.3 screens, 1.4 WF-high $7,500 net, **1.5 company static fees now applied** (see the tier-derivation fix
  below), 1.6 down-pay cap, 1.7 strings. New tested modules: `utils/dynamic-discount.ts`,
  `utils/dynamic-rollout-pricing.ts`, `utils/pricing-config-util.ts`.
- **Tier derivation fix (2026-07-15, follow-up)** — the rollout COST/PAR/RETAIL tiles showed **$200** for PAR
  (and a wrong RETAIL) because the mobile schema read only explicit `price.{cost,par,retail}`; a portal schema
  that prices a field at retail only (par/cost blank) came through as 0 → floored to $200. **Root cause:** web
  fetches a company **pricing config** (`GET /company/v1/pricing-config/sales`) and bakes tier *derivation*
  (e.g. par = 65% of retail, cost = 50%) + static fees into each field price at load; mobile skipped it.
  **Fixed:** `useCalculatorSchema` now fetches + normalizes the pricing config and bakes derivation into every
  field (`bakeFieldPrice`), and `RolloutView` recomputes the tiles **live** from the schema field prices via
  `computeCalculatorTiers` (web `getCalculationResult` parity — not from stale stored `totals`), applying the
  config's static fees. Tested in `pricing-config-derivation.test.ts` (15 tests).
- **Phase 2 (outcome)** — 2.1 `LFCalculator`, 2.2 lead timeline progress, 2.3 demo `lastPriceQuoted`,
  2.4 sale balance-method validation, 2.5 drop `pricemarkup`/`dropedPrice` shape, 2.7 `selectedAppointmentId`,
  2.8 demo last-price gate, 2.9 versatile/pineapple, 2.10 reason apostrophe. New tested module:
  `utils/build-outcome-payload.ts`. ⏳ **2.6** (in-modal 2s autosave) — mobile persists at the JB step;
  the flow requires "Build Job" to advance.
- **Phase 3 (job builder)** — 3.1 documentation finalize gate (+ fixed the wrong comment), 3.2
  `autoFieldsLogged`, 3.4 in-flight guard + follow-up + unmount flush, 3.5 toggle/option/color deselect,
  3.7 demo doc rerouting, 3.8 `finalizeBlockedReason` hint. New tested module: `utils/finalize-gate.ts`.
  ⏳ **3.6** (enrichConfigWithProductColors) — cosmetic color chain (`normalizeProductRecord` +
  `getProductColorsForTab` + palettes) not on mobile. ⏳ **3.9** (jobBuilder-wrapper nesting) — low, backend-tolerant.
- **Phase 4 (calc save)** — 4.3 inherited discount/paymentMethod on create, 4.4 duplicate
  `originalCalculatorId` lineage, 4.5 reorder persistence (`PUT /lfcalculators/positions`), 4.7 `productName`
  source fix, 4.8 sanitize allowlist (pricemarkup/reason stay strings). ⏳ **4.1** (decouple bundled PUT) —
  risky refactor, backend `$set` merges the bundle harmlessly. ⏳ **4.2** (minimal bootstrap create) —
  low; title is re-derived live anyway. ⏳ **4.6** (hydration reseed) — low, not data-losing.
  ⏳ **4.9** (appt guard strictness) — mobile's `selfGenLeadId` permissiveness is arguably correct for its self-gen flow.
- **Phase 5 (logging)** — 5.1 `calculator_field_entry` (new `logCalculatorFieldEntry` + wired in the save
  engine), 5.3 `rollout_and_drop_summary` on dynamic submit, 5.4 calculator create/rename. ⏳ **5.2**
  (fireRolloutLog family), **5.5** (payment inherited), **5.6** (auto_rename), **5.7** (view_all),
  dup/delete — analytics-only; need `leadId` threading + a calc shim into `RolloutView`. Call sites documented below.

New tests: `dynamic-rollout-pricing.test.ts` (21), `build-outcome-payload.test.ts`, `finalize-gate.test.ts`,
`calculator-field-entry.test.ts`, `sanitize-calculator-payload.test.ts`.

---

## 0. Test harness state (must fix first)

- Repo requires **Node 22** — `yarn` refuses under Node 20 (`engines >= 22.11.0`). Use `nvm use 22.11.0`.
- Baseline: `__tests__/utils/**` = **245 passing**; DynamicDealCenter suite = **107 passing**.
- **3 suites broken:**
  - `__tests__/Parity.test.ts` & `__tests__/ParityDiagnostic.test.ts` import the web calc util from a
    **dead hardcoded path** `/Users/apple/Downloads/mhalt-revDSM-sales-frontend-staging/...` → both fail at import.
  - `__tests__/screens/DynamicDealCenter/DynamicDealCenterScreen.test.tsx` crashes — **`react-native-mmkv`
    (Nitro) is not mocked** in `jest.setup.js`.

**Playwright note:** Playwright targets browsers; it does **not** apply to a React Native app, and the web
repo here has no server/test harness. The correct tool is **Jest** (already configured). Web payloads can be
pinned as checked-in golden JSON snapshots instead of live browser capture.

---

## Phase 1 — Pricing correctness (money-affecting) — HIGHEST

| # | Sev | Issue | Web ref | Mobile ref |
|---|-----|-------|---------|------------|
| 1.1 | **H** | Monthly payment missing `$35` floor + `3198/1529/1148/1019` label special-cases | `PremiumQuoteCard.js:25-49` | `useDealPricing.ts:292-297` (`calcMonthly`) |
| 1.2 | **H** | MSRP/programs/grand-totals hardcoded (pre-order + sr/vet only); web is data-driven off `includeInMsrp` + `programs[]`; no ≥100% clamp | `discount-config-util.js:41-88` | `RolloutView.tsx:568-577`, `useDealPricing.ts:191-206` |
| 1.3 | M | Screens (`number_of_screen`) ignored → `priceWithScreens`/MSRP understated | `PremiumQuoteCard.js:263-276` | `RolloutView.tsx:571-572` (hardcoded `screensCount=0`) |
| 1.4 | M | WF-high `$7,500` hardcoded safety-net removed; relies solely on `plan.minPrice` | `ViewAllCalculators.js:1490,666,1317` | `RolloutView.tsx:51-58,625-640` |
| 1.5 | M | Company `applyFeesToTier` fees not applied to COST/PAR/RETAIL | `calculation-results-util.js:93-95`, `pricing-config-util.js:60-75` | `useDynamicCalculators.ts:77-86`, `RolloutView.tsx:520-527` |
| 1.6 | L | Down-payment cap skipped when end price not re-typed this session (`priceNum=0`) | `PremiumQuoteCard.js:133-153` | `RolloutView.tsx:605-614` |
| 1.7 | L | `endPriceError` / plan-min strings differ; mobile labels plan min a "cost price" min (validates cost, web validates end price) | `payment-method-validation.js:34`, `ViewAllCalculators.js:988` | `RolloutView.tsx:54-56`, `useDealPricing.ts:311-318` |

**Confirmed at parity:** tier engine, `$200` floor per tier, bank-fee gross-up, `MARKUP_TO_TIER`
(`dynamic-deal-pricing.ts:99-101`).
**Latent trap:** monthly base is `preOrderGrandTotal − downPay` (`RolloutView.tsx:579`) — equal to web's
`rolloutPrice − downPayment` **only** while screens=0 and program links == MSRP set. Fixing 1.2/1.3 without
this line makes the monthly diverge.

---

## Phase 2 — Result / Outcome payload fidelity

| # | Sev | Issue | Web ref | Mobile ref |
|---|-----|-------|---------|------------|
| 2.1 | **H** | `LFCalculator` (full calc snapshot) never sent on outcome/finalize saves | `result-lead-modal.js:897,904-907`; `JobBuilderContext.js:299-303` | `DynamicJobBuilderScreen.tsx:354-373,681-694` |
| 2.2 | **H** | Lead timeline progress never advanced (`salesProcess:completed`, `leadResulted:active`) | `ResultJobModal.js:88-119` | endpoint exists `leads.ts:285`, never called in DynamicDealCenter |
| 2.3 | **H** | Demo `lastPriceQuoted` dropped (`contractPrice:undefined` for demo) | `result-lead-modal.js:127-131,566` | `ResultJobModal.tsx:246-257` → `DynamicJobBuilderScreen.tsx:360` |
| 2.4 | M | Sale not required to have a balance payment method | `result-lead-modal.js:1377-1386` | `ResultJobModal.tsx:235-238` |
| 2.5 | M | Drop-entry shape drift: mobile omits `pricemarkup`+`_id`, adds non-web `price`; web uses `dropedPrice` only | `ViewAllCalculators.js:797-804` | `RolloutView.tsx:646-658`, `useDynamicCalculators.ts:563-566` |
| 2.6 | M | No in-modal 2s debounced outcome autosave — closing modal before Build Job loses everything | `result-lead-modal.js:797-858` | `ResultJobModal.tsx` (fires `onConfirm` only) |
| 2.7 | L | `selectedAppointmentId` omitted from outcome autosave (sent only at finalize) | `result-lead-modal.js:898` | `DynamicJobBuilderScreen.tsx:354-373` |
| 2.8 | L | Demo not gated on `lastPriceQuoted>0` | `result-lead-modal.js:1366-1369` | `ResultJobModal.tsx:237` |
| 2.9 | L | `versatile`/`pineapple` are mobile-only (no web schema); not written to calc-scoped outcome → don't rehydrate | (absent on web) | `ResultJobModal.tsx:211-212,255` |
| 2.10 | L | "Didn't Like" reason uses curly apostrophe (mobile) vs straight (web) → analytics mismatch | `result-lead-modal.js:58` | `ResultJobModal.tsx:24` |

---

## Phase 3 — Job Builder finalize

| # | Sev | Issue | Web ref | Mobile ref |
|---|-----|-------|---------|------------|
| 3.1 | **H** | Finalize NOT gated on required documentation (sale→agreement, demo→order-sheet); mobile comment claims web doesn't gate — **factually wrong** | `dynamic-job-builder.js:331-335,500-504` | `DynamicJobBuilderScreen.tsx:534-544` |
| 3.2 | M | Autosave omits `autoFieldsLogged` → auto-field logs can re-fire on reopen | `JobBuilderContext.js:291-298` | `DynamicJobBuilderScreen.tsx:366-372` |
| 3.3 | M | Autosave hand-picks fields instead of spreading full `formData` (drops versatile/pineapple/apptId in draft) | `JobBuilderContext.js:286-290` | `DynamicJobBuilderScreen.tsx:354-364` |
| 3.4 | M | System-B autosave has no in-flight guard / follow-up / unmount flush (System A got these; System B didn't) | `JobBuilderContext.js:309-345` | `DynamicJobBuilderScreen.tsx:305-381` |
| 3.5 | M | Toggle/option/color **deselect** missing (`AllowToggleDeselectContext`/`useCanDeselectSelection`) | `dynamic-job-builder.js:785`, `option-selector.js:39` | `OptionList.tsx:26`, `ToggleGroup.tsx:28`, `SwatchPicker.tsx:56` |
| 3.6 | M | Config normalize skips `enrichConfigWithProductColors` → product/tab colors diverge | `job-builder-products.js:37-41` | `useDynamicCalculatorSchemas.ts:64-66` |
| 3.7 | L | Demo doesn't reroute agreement-typed docs → `orderSheets` | `TabbedCalculator.js:831-836` | `DynamicJobBuilderScreen.tsx:706-727` |
| 3.8 | L | `finalizeBlockedReason` tooltip not implemented | `dynamic-job-builder.js:508-526` | — |
| 3.9 | L | Finalize nests `jobBuilder` wrapper inside `leadData` on the `/job-builder` POST (shape drift) | `TabbedCalculator.js:789-797` | `DynamicJobBuilderScreen.tsx:739-761` |

**Confirmed at parity:** jobState storage/serialize, default-combo pruning, allocation visibility/exclusion,
field-value validation, appointment-required gate, 2000ms debounce value.

---

## Phase 4 — Calculator save / hydrate / appointment

| # | Sev | Issue | Web ref | Mobile ref |
|---|-----|-------|---------|------------|
| 4.1 | **H** | Single bundled debounced PUT re-writes `title`+entire rollout/payment surface every keystroke; web keeps entries-save minimal + separate targeted PUTs | `DealCenterContext.js:165-179` | `useDynamicCalculators.ts:241-259` |
| 4.2 | **H** | Bootstrap create sends full ~100-entry seed + numeric title `'1'`; web sends `{title: customerName, price:0}` | `job-capture-images-view.js:1085,1111` | `useDynamicCalculators.ts:160-199,389` |
| 4.3 | M | New-tab create omits inherited `discountPercentage`/`paymentMethod`/`paymentMethodLabel` | `tab-action-utils.js:48-60` | `useDynamicCalculators.ts:466-479` |
| 4.4 | M | Duplicate omits `originalCalculatorId`, `price:''`, inherited plan/discount/down | `tab-action-utils.js:166-188` | `useDynamicCalculators.ts:481-501` |
| 4.5 | M | Tab reorder never persisted (no `PUT /lfcalculators/positions`) | `tab-action-utils.js:282-292` | `useDynamicCalculators.ts:537-547` (local only) |
| 4.6 | L | Hydration reseeds full schema (balloons next PUT; `pricingAtTimeOfEntry` from current not saved schema) | `DealCenterContext.js:85-92` | `useDynamicCalculators.ts:368-385,413-427` |
| 4.7 | L | `productName` on touched entries (web drops it) + internal source mismatch (`category.productName` vs `schema.name`) | `DealCenterContext.js:58-83` | `CalculatorView.tsx:185-191`, `build-all-entries.ts:39-54` |
| 4.8 | L | `sanitizeCalculatorPayload` coerces `''→0` for non-allowlisted keys (`pricemarkup`, top-level `price`) | (web never sanitizes) | `leads.ts:86-105` |
| 4.9 | L | Appointment guard more permissive (accepts `selfGenLeadId` alone; `String()` match vs strict `===`) | `job-capture-images-view.js:1047-1067` | `useDynamicCalculators.ts:127-158` |

**Endpoints all aligned** except reorder (4.5).

---

## Phase 5 — Activity logging (dynamic Calculator/Rollout/Drop/Result emit NOTHING)

The dynamic Job Builder step logs correctly (`useDynamicJobBuilderActivityLog.ts` is a faithful, wired port).
But `useDynamicCalculators.ts`, `RolloutView.tsx`, `ResultJobModal.tsx`, `CalculatorView.tsx` contain **zero
`logEvent` calls** — ~18 web events dropped. Most logger ports already exist (wired only into the *regular*
deal center) and just need threading in.

| # | Sev | Event(s) omitted | Web ref |
|---|-----|------------------|---------|
| 5.1 | **H** | `calculator_field_entry` (per field edit, `change`) | `DealCenterContext.js:218-234` |
| 5.2 | **H** | `fireRolloutLog` family: `end price entered`, `rollout confirmed`, `down payment entered`, `payment method changed`, `drop price plan selected/unselected/declined/secured`, auto-confirm | `ViewAllCalculators.js:1451,1556,1808,1352,736,836,952,1154,1264` |
| 5.3 | **H** | `rollout_and_drop_summary` on dynamic submit (port exists, wired only in regular JobBuilder) | `TabbedCalculator.js:923`, `rollout-drop-summary-log.js` |
| 5.4 | M | `calculator` create/duplicate/rename/delete + `calculator viewed` | `tab-action-utils.js:62,191,126,256`; `DealCenterContext.js:344` |
| 5.5 | M | `payment method inherited` (create/duplicate) | `tab-action-utils.js:77-89,209-221` |
| 5.6 | M | `calculator_auto_renamed` (no mobile logger exists at all) | `TabbedCalculator.js:296-304` |
| 5.7 | L | `view_all_calculators` click | `TabbedCalculator.js:535-540` |

> Note: `down payment entered` (5.2) and `payment method changed` are **unported everywhere** on mobile
> (even the regular flow) — new loggers needed, not just wiring.

---

## Recommended execution order

1. **Phase 0** (harness) — unblocks all testing. ~30 min.
2. **Phase 1** (pricing) — wrong dollars quoted today. Mostly pure functions → high test ROI.
3. **Phase 2** (outcome payload) — data integrity of resulted leads.
4. **Phase 3** (job builder finalize) — finalize gate is a correctness hole (rep can finalize sale w/o agreement).
5. **Phase 5** (logging) — mostly mechanical wiring of existing ports.
6. **Phase 4** (calc save) — 4.5/4.2 first; 4.1 (decouple bundled PUT) is the riskiest refactor, do last.

## Testing strategy (Jest)

- **Fix harness:** env-var/snapshot the web import in `Parity.test.ts`; add `react-native-mmkv` mock.
- **Pure-function tests** (highest ROI): monthly `$35` floor + label cases (1.1), data-driven MSRP/programs
  (1.2), screens (1.3), WF-high (1.4), fee tier (1.5) — extract the inline `RolloutView` math into a testable
  `dynamic-rollout-pricing.ts` and unit-test against web fixtures.
- **Payload-builder tests:** extract `buildPayload`/outcome/finalize builders into pure functions and
  snapshot-assert against checked-in golden web payloads (`LFCalculator`, drop shape, create/duplicate).
- **Validation tests:** `endPriceError`, sale-requires-balance-method, demo gates, documentation finalize gate.
- **Logging tests:** assert `logEvent` called with the web event name + meta for each wired event (mock `logEvent`).
