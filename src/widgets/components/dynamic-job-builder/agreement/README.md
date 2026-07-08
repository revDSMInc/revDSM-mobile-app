# Dynamic Job Builder — Agreement pipeline (RN port)

Client-side agreement generation for the dynamic Job Builder summary tab. Faithful
port of web `src/components/dynamic-job-builder/agreement/*`.

## ⚠️ Requires a native module + rebuild (currently blocked)

The generator rasterizes the agreement with **`react-native-view-shot`** (there is no
RN equivalent of web's `html2canvas`). It has been **declared in `package.json`
(`^4.0.3`) but NOT installed** — installing a native module and rebuilding is on hold
per the repo security note (tailwind history not yet clean; running metro/builds is
unsafe until it is).

Because `VerticalSummaryTab` transitively imports the generator, **the entire dynamic
Job Builder screen will not bundle until `react-native-view-shot` is installed and the
app is rebuilt.** Before this can run/verify:

1. Resolve the security hold (clean git history / tailwind.config).
2. `yarn install` (picks up react-native-view-shot).
3. `cd ios && pod install` (link the native module) and rebuild iOS/Android.
4. Verify on device: appointment → generate agreement → sign → save → complete.

## Files

Pure TS (no RN) — `src/utils/dynamic-job-builder/agreement/`:
- `description-schema-evaluator.ts` — `evaluateDescriptionSchema(schema, jobState, verticalState)` → Description-of-Work lines.
- `gutter-roofline-description-generator.ts`, `roofing-description-generator.ts` — legacy fallbacks (only used when `productKey === ''`).

Hooks — `src/screens/DynamicDealCenter/hooks/`:
- `useAgreementConfig.ts` (`GET /sales-rep/v1/agreement-config`), `useDescriptionSchema.ts` (`GET /sales-rep/v1/description-schema/:id`).

Components — this dir:
- `blocks/*` — 7 config-driven agreement blocks + `BLOCK_RENDERERS`.
- `DynamicAgreementGenerator.tsx` — renders the blocks and captures to a JPEG data-URI (view-shot).
- `AgreementSignatureCapture.tsx` — signature/initials drawing surface (react-native-svg), captured to a PNG data-URI.
- `DynamicAgreementDialog.tsx` — fullscreen modal: fetch config + schema, resolve details, host the generator.
- `SummaryFinalizeCards.tsx` — appointment + agreement + order-sheet cards for the summary tab.

## Rendering-layer approximations (no data/logic changes vs web)

- **Paragraph HTML** is stripped to plain text (`react-native-render-html` is not installed) — rich inline formatting is lost.
- **Signatures**: web's typed cursive signature is approximated with italic; drawn signatures/initials are captured to images.
- **Tables** are emulated with flexbox rows/cells (visually equivalent for capture, not pixel-identical to the DOM tables).

## Not verified on device

None of this has been run — it is a static port. The reskin/flow is faithful to the web
reference and the mobile modal contracts, but E2E verification is blocked on the native
rebuild above **and** the backend returning real config (`/agreement-config`,
`/description-schema/:id`, plus a configured dynamic job-builder + calculator schema).
