# Lead Center, My Deals & customer records

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/LeadCenter/**`, `src/screens/MyDeals/**`, `widgets/components/LeadCenter/**`, `widgets/components/lead-center/**`, `widgets/modals/lead-center/**`, `EditCustomerModal.tsx`, `services/api/leads.ts` (outcome endpoints).
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## My Deals detail IS the Lead Center screen (ticket: "My deals should match resulted lead page")

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

## The Deal screen's pending-signature status — ONE amber header, back to green on approval

Ticket: *"after submitting status should be show like this, in mobile this thing is missing"* (a web
screenshot of an amber **PENDING ADDENDUM - AWAITING CUSTOMER SIGNATURE** bar; mobile showed nothing
after submitting an addendum), then the design correction: *"a bit change in the design of the status,
it should be like above, and once the user approved it will come back to the same green"*.

**Final design (the rep's answer to a direct question, not an inference): the Contract Details card
header IS the deal's single pending indicator.** Amber
`SALE - PENDING CUSTOMER SIGNATURE` / *Awaiting Amendment Approval: • Contract Pricing* while a
signature is outstanding, flipping to the green `✓ <STATUS> - LEAD RESULTED` the moment the customer
approves. No second bar.

### What actually drives it

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

### `DealBanners` is now the CANCELLED bar only — a deliberate divergence from web

`src/widgets/components/LeadCenter/DealBanners.tsx` began as a faithful port of web
`src/sections/deal/components/deal-banners.js` (rendered from `job-capture-images-view.js` gated on
`isDeal`; `lead-center-tabs.js` places it *"under the tab bar and above every tab"*, which is why mobile
renders it after the **Job docs / Map / Tools** row and OUTSIDE the tab switch, gated on `fromMyDeals`).

⚠️ **Web's pending-addendum bar is deliberately NOT rendered.** Web shows two independent indicators for
one fact — that bar AND the card's own amber header — and on a phone the two sat within half a screen of
each other saying the same thing. Do not "restore parity" here; it was removed on request.

The **JOB CANCELLED** bar stays: nothing else on the screen reports it, and a cancelled deal would
otherwise still show a green *LEAD RESULTED* header.

### Draft status predicates live in `src/utils/addendum-drafts.ts`

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

### …and the Addendums list, in web's exact slot

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

## Result Lead ▸ Reset was missing "Not Home", and a reset lead showed no contract card at all

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

## Edit Customer accepted a phone number shorter than 10 digits

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

⚠️ **This file is CRLF.** Editing it with a script that reads and writes in text mode rewrites all 776
lines to LF and buries the change in a whole-file diff — that happened once here and had to be undone.
Use `newline=''` on both the read and the write (or an editor that preserves endings).

## Lead Center scanner: a filed document can't be deleted, and no longer renders blank

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

### …and that is why the blank tile had to be fixed in the same pass

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

## Down Payment Receipt upload is logged — with the `filePath` / `bucketName` web omits

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

✅ Confirmed on device.

## A CANCELLED addendum says so, instead of "once the customer approves it"

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

## Annotation zoom persists into Draw — on BOTH platforms now (ticket 420)

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

## ⛔ REMOVED APP-WIDE: the bare lead-scoped `lead/v1/{leadId}/outcome`

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

⚠️ **Needs device confirmation on the flows that changed shape**, since a calculator-scoped read can
legitimately return less than the lead-scoped one did: Lead Center auto-open Job Builder, Contract
Details edit + save, legacy Job Builder autosave / manual save, Deal Center "reset outcome", and the
Pitch Book / Roofline Deck notes + photos.

### The lead-scoped outcome mirror no longer re-uploads documents

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

## My Deals showed "No leads found" for ~10 s, and made a second API call web doesn't

Ticket: *"can you check it's taking time to open the lead, in web when open my lead only one api call
and it's open instantly, can you fix this issue?"* Device trace: `sales?page=1&limit=12` →
**15,719 kB, 10.69 s**, plus a second `sales?page=2&limit=12` → 0.1 kB, 308 ms. Web issues only the
first. Mid-load the screen showed the **empty state**, not a spinner.

Three separate causes; two are ours and are fixed, one is not.

### (a) The page-2 request — a ref that lagged state by one render

`onEndReached` was guarded by `loadingRef` / `hasMoreRef`, both mirrored from state via
`useEffect(() => { loadingRef.current = loading })` — which lands a render **LATE**. FlatList fires
`onEndReached` on mount whenever the content is shorter than the viewport, and an empty list always is,
so the guard was still `false` when it fired and page 2 went out under page 1.

- `inFlightRef` (renamed from `loadingRef`) and `hasMoreRef` are now written **synchronously** inside
  `fetchDeals`, never through an effect.
- `onEndReached` **returns early when the list is empty**. Pagination off a list with nothing in it is
  never meaningful, and this is the belt to the braces above.

### (b) The empty state during the load — one `loading` flag shared by two requests

This is what the rep actually saw. `showInitialLoader` is `loading && !refreshing && !leads.length`;
page 2's fast empty response hit `finally { setLoading(false) }` while page 1 was still downloading, so
the flag page 1 owned was cleared by a different request. `showInitialLoader` went false with `leads`
still `[]`, the `ListEmptyComponent` rendered, and My Deals sat on **"No leads found"** for the rest of
page 1's 10 s — then filled in.

Fixed with a **`requestIdRef` generation counter**: only the newest request may write state, and a
superseded one's `finally` clears nothing. A **new-filter/refresh** load is still allowed to start while
one is in flight (it supersedes), because blocking it would strand the screen on the previous tab's
results; only *pagination* is blocked.

### (c) ⚠️ The response is 99 % base64 — and that part is SERVER-side

Measured on the reporter's own capture: a 12-deal page is **31 MB, of which 30.9 MB (99 %) is
`data:` URIs** — every deal's signed agreements and order sheets inlined as
`jobBuilder.dynamicJobState.agreements[0].files[0].blob` / `.url` / `.displayUrl`. `limit=12` is already
the smallest page the screen uses.

**No client change makes this fast.** Web is quicker on the same payload only because the browser's JSON
parse is native and it has more headroom — it downloads the same bytes. The real fix is for the list
endpoint to stop embedding document blobs (send `filePath`/`bucketName` and let the client sign on
demand, as every other document surface already does). Until then the 10 s is the payload.

### ⚠️ …and the log sanitizer that was supposed to prevent this shrank it by 0 %

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

⚠️ **(a) and (b) still want a device check** — they are render-timing behaviours and the repo cannot
render-test (see the `ToolsSection` note above). Expect: ONE `sales?page=1` request, a spinner rather
than "No leads found" throughout, and page 2 only on an actual scroll to the bottom.

## Inspection slot tick moved INSIDE the label (ticket 384)

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

⚠️ **`DynamicInspectionRenderer.tsx` is a CRLF file** (927 lines). Editing it with a script that
reads/writes in text mode rewrites every line to LF and buries the change in a whole-file diff.
Use `newline=''` on both ends. (Same trap as `EditCustomerModal.tsx` and `dynamic-deal-diff.ts`;
check `file <path>` before and after — the diff here is 10 insertions / 1 deletion.)

## Co-buyers moved below Address, with a "Same address as primary buyer?" tick

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

⚠️ The file is CRLF — `newline=''` on both ends.

⚠️ Needs a device check (this repo cannot render-test): the new order, the tick filling and greying the
co-buyer Address, unticking restoring a typed one, and — the important one — that the address SURVIVES a
save and reopen.

## Edit Customer Details now logs opened / per-field change / saved

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

### …and the header phone is formatted the same way

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

### …and the change rows are DEBOUNCED off typing, not derived on save

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

#### Co-buyers are tracked by the same machinery

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

#### …and the co-buyer Address searches Places, like the primary one

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

Also in this pass, on request: **`floatingLabelText` dropped its `fontWeight: '600'`** so the input
titles render at normal weight, matching web. ⚠️ That weight predates the co-buyer ticket (it is
`'600'` at `58c577b^` too) — it was not a regression from moving the co-buyer block, so don't go
looking for one.

⚠️ Needs a device check (this repo cannot render-test): type in a field and confirm ONE `change` row
lands ~2 s later carrying the whole edit, that a burst across several fields flushes together, that
Save no longer emits a second copy of each row, and that removing co-buyer 1 does not attribute
co-buyer 2's next edit to the wrong person.

## The `inspection_photo` view log on "Start Taking Photos" is gone

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

## The Contract Details pencil opens the deal-edit wizard on BOTH entry points

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

⚠️ Needs a device check (this repo cannot render-test): the pencil on a resulted SALE from Sold Leads
landing on step 1 of the wizard, and a legacy deal still opening the inline modal rather than nothing.

## Lead Center pulls to refresh

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

## Pull-to-refresh / focus also refresh refund state

Ticket: *a refund received on a deal kept showing until the rep left My Deals and came back.* The refund
figures come from `['leadApprovals', leadId]` and `['leadApprovalsFunding', leadId]` (60 s `staleTime`), which
`handlePullToRefresh` and the focus effect did not touch — they only refetched the lead. Both now invalidate
these two keys; the pull awaits them so the spinner lasts until the new figures land.

## Funding / approvals surfaces arrived via the `dev-v1-funding` merge

`useLeadFunding.ts`, `useLeadApprovals.ts`, `LeadApprovalsCard.tsx`, `UserPickerModal.tsx` and the
`ContractDetailsCard` / `JobDocsSection` changes came in whole from `dev-v1-funding`; the offline branch
never touched them, so the merge took them wholesale rather than reconciling anything. Their behaviour is
documented where the feature lives — the funding stepper, coverage bar and refund approvals in
**`deal-center.md`**, the in-sheet flash host (`ModalFlashHost.tsx`) in **`app-wide.md`**. This note exists
so the next reader does not go looking for a missing ticket section here.

⚠️ **`react-native-qrcode-svg` is a NEW native dependency** (funding's `SendLinkModal`). It reached
`package.json` through the merge, but **`yarn.lock` is gitignored in this repo**, so it does not reach
another machine through a lockfile — a pull of this merge typechecks as `Cannot find module` until
`yarn install` runs, and iOS additionally needs `bundle exec pod install` (from `ios/`, never bare
`pod install`).

⚠️ **The two merge conflicts that were NOT one-sided are recorded in `deal-center.md`** — the Job
Builder outcome read (`outcomeExists` vs the device-copy fallback) and `handleResultConfirm`'s
`resultCalcId`. Both needed a union, and neither side compiled or behaved correctly alone. Read those two
merge notes before touching either site.

## Map job card & pins: sold-job categories (REVUIUX-439), recorded in `maps-zone-canvasser.md`

`LeadMap.tsx` and `MapJobCard.tsx` (under `widgets/components/LeadCenter/`) now colour pins by
`pinCategory`, show a legend, and render `displayJobNumber`, the pending-install date line,
`repDisplayName` and `products`. The full notes and traps are in
**`docs/claude/maps-zone-canvasser.md` › "Sales pins"**; read them before touching either file.

### Follow-up — pending-install pins drawn on top (`symbolSortKey`)

`LeadMap.tsx`'s `job-markers-symbols` layer now sets `symbolSortKey: PIN_SORT_KEY` (from
`pinSortKeyExpression()` in `utils/sales-pins.ts`). Without it, overlapping pins stack by screen Y, and
the 18 purple pending-install pins were hidden under the green clusters. ⚠️ A new pin `category` needs a
rank in `PIN_DRAW_ORDER`. Full notes: `maps-zone-canvasser.md` › "the purple pending-install pins were
painted over".

### Follow-up — Sales Map legend moved bottom-left behind a palette button

`LeadMap.tsx`'s pin-colour legend is now a bottom-left palette button that opens the card and turns into a
✕ (footsteps pattern, `MapLegendToggle`). The temporary boundary-lock bypass has been removed again. Full
notes and the Android touch trap: `maps-zone-canvasser.md` › "Sales Map pin legend: bottom-left…".

### Follow-up — pending-install pin recoloured yellow, installed matched to uploaded's green

`utils/sales-pins.ts`'s `PIN_CATEGORY_META` and the `marker-{pending,installed}{,@2x,@3x}.png` assets
changed colour twice this pass: `pendingInstall` purple → `#FFD400` yellow, and `installed` moved off its
signed-off spring-mint `#00FFA3` to match `uploaded`'s `#4CBB17` exactly (a deliberate reversal of the
mint decision — the premise it was picked under no longer holds). Then `marker-pending*` was rebuilt
entirely from `marker-green*`'s artwork (not just recoloured), because the pending pin's SHAPE — a thin
ring with a white dot — never matched uploaded's solid teardrop even after the colour matched. Full notes,
the ΔE history, the pixel-remap technique and its verification: `maps-zone-canvasser.md` › "Pending-install
pin: purple → yellow…" and the two follow-ups after it. ⚠️ `installed`'s shape (thin ring + checkmark)
was deliberately left as-is — only `pendingInstall`'s shape was rebuilt; see that file before assuming
they now match in every respect.

### Follow-up — legend merges Uploaded into Installed; two new on-map status toggles

Two more changes, same session as the colour/shape work above. (1) The legend's `PIN_CATEGORIES.map`
became `legendRows(pinCategoryCounts).map` — a new pure `legendRows()` in `utils/sales-pins.ts` collapses
Uploaded and Installed into one "Installed" row (count = both, summed), since the two are now visually
identical; `pendingInstall` is unaffected, and `PinCategory` itself stays three-valued everywhere else.
(2) `LeadMap.tsx`'s right-side toggle stack gained two `MapToggleSwitch` buttons, `IN` / `PD`, wired
through `onToggleFilter`'s widened union (`'installed' | 'pendingInstall'` added) to `MapDetail/index.tsx`,
which flips the SAME `filters.statusFilter` the filters-modal dropdown already writes — no new filtering
logic, and the two switches are mutually exclusive with each other only because `statusFilter` is one
field. Full notes: `maps-zone-canvasser.md` › "Sales Map legend: Uploaded merged into Installed" and
"On-map toggle switches for the pin-status filter".

⚠️ `LeadMap.tsx` is **CRLF** (now in the root guide's list) — `newline=''` on both ends.

### Follow-up — the `IN` / `PD` toggles now carry their OWN colour instead of the switch's default green

Same session, one more pass on the two toggles just added. `LeadMap.tsx`'s button array now passes
`activeColor: PIN_CATEGORY_META.installed.color` / `.pendingInstall.color` (plus a dark
`activeLabelColor` on `PD`, for contrast on its yellow) into `MapToggleSwitch`'s three new optional colour
props. Full notes and the "why the label colour isn't cosmetic" reasoning: `widgets/common` is app-wide,
so the component-level write-up is in `docs/claude/app-wide.md` › "`MapToggleSwitch` gained per-instance
colours…"; the ticket and the Sales-Map-specific side of it is in `maps-zone-canvasser.md` › "the two new
toggles were both the switch's default green". No change to `matchesPinStatusFilter` or the filtering
pipeline — this pass was presentational only.

⚠️ **The `IN` / `PD` active labels used above are stale** — renamed to `INS` / `PI` in the same session
(`maps-zone-canvasser.md` › "active-state labels renamed"). Trace this code by `type: 'installed'` /
`'pendingInstall'`, not by the two-letter label.

### Follow-up — `INS` no longer shares `statusFilter` with the modal dropdown; moved to top of its stack

Same session, one more pass. The "reuses `statusFilter`" design described two follow-ups up is
**superseded** — `INS` / `PI` now write two new independent `FilterState` booleans
(`isMapInstalledOnly` / `isMapPendingInstallOnly`) so `INS` can be STRICT (`pinCategory === 'installed'`
only, excluding uploaded), while the modal's own "Installed" dropdown option keeps its unrelated,
unchanged "not pending" meaning. `INS` also moved to the top of `LeadMap.tsx`'s right-side stack (was
5th, now 1st; the other five kept their order). Full reasoning, the three-way legend/dropdown/toggle
split this creates, and the device-check list: `maps-zone-canvasser.md` › "the on-map toggle now
STRICTLY excludes uploaded pins, and INS moved to the top of the stack".

⚠️ `MapFiltersModal.tsx` is **CRLF** (now in the root guide's list) — `newline=''` on both ends.

### Follow-up — stack repositioned top-right; `PI` grouped with `INS`; label capitalised; a status badge tried and reverted

Same session, closing passes. `LeadMap.tsx`'s right-side toggle stack moved from `bottom` to `top`
positioning (whole six-switch stack, not just the two pin-status ones), and `PI` joined `INS` at the top
of the array so the pair renders together. `sales-pins.ts`'s `PIN_CATEGORY_META.pendingInstall.label`
was capitalised to `'Pending Install'`, matching its siblings. A coloured status badge was added to
`MapJobCard.tsx` then immediately reverted — that file is back to byte-identical with its pre-session
state. Full notes, including the un-verified `top` offset guess and why the badge came back out:
`maps-zone-canvasser.md` › the three follow-ups after "the on-map toggle now STRICTLY excludes uploaded
pins…".

### Follow-up — the "· pending install" TEXT on the date line is gone; the badge revert alone wasn't the fix

The badge revert above didn't actually satisfy the "remove the status" request — the status the rep meant
was the pre-existing `getPinDateLabel` suffix (`"Sold {date} · pending install"`), not the badge. Fixed in
`utils/sales-pins.ts`, shared by both `MapJobCard.tsx` and `MapDetail`'s list-view row. Full notes and the
"do not reintroduce a status word here, colour is the channel" rule: `maps-zone-canvasser.md` › "still
status is on the card" follow-up, right after the badge-revert note.

## Risk report title/filename comes from `displayName` (REVUIUX-466)

Lead Center's `risk-preview` / `risk-download` (`hooks/useLeadCenterModals.ts`) hardcoded `'Risk Report'`; they now
use `reportDisplayName` from `utils/report-name.ts` (backend `displayName` -> `reportName` -> `'Risk Report'`).
`hooks/useLeadReports.ts` `handleDownloadRiskReport(url, report?)` takes an optional report (it has no callers today).
Full notes live in `pitch-book.md` ("Risk report uses the backend `displayName`").

- ⚠️ `findReport` returns the FIRST matching record, which may be an older report. When the url comes from a
  just-finished job the title is taken from the newest non-reset risk report instead.
- ⚠️ `reportName` is still the lookup key (`includes('risk')`) - do not read the title from it for matching.

## Lead Center header: ROWS, not two columns (long email broke the alignment)

`screens/LeadCenter/index.tsx` header was two independent `flex-col` stacks (Lead ID / name / phone / date on the left;
Lead Code / email / time on the right). A long email wrapped to 2-3 lines, made the right stack taller and pushed the
clock down while the date stayed put, so the pairs drifted apart.

It is now four rows (Lead ID | Lead Code, name, phone | email, date | time), each `flex-row items-start` with
`flex-1` cells and a 16pt gap between rows.

- ⚠️ Each row is a unit: the next row starts below the TALLEST cell, so date/time stay level however long the email is.
  Do not go back to per-column stacks.
- The email `Text` has `shrink` and NO `numberOfLines`, so the whole address stays readable (wraps inside its cell).
  The phone/mail icons carry `marginTop: 4` to sit on the first text line when the text wraps.

## Tools tab: every tile uses the same grey icon circle

`widgets/components/LeadCenter/OperationalSections.tsx`. The revRender tile drew its own 48pt WHITE SQUARE icon and a
16pt black subtitle, so it was the odd one out beside Deal Center / Investment Center / Pitch Book / Roofline Deck
(32pt grey circle, 12pt grey subtitle, 16pt gap to the title).

New local **`ToolIconCircle`** is the one badge; `ToolCard`, `PitchBookCard` and the revRender header all render it, and
revRender's subtitle now matches the other tiles' (`text-[12px]`, `#919EAB`) with `items-center` rows.

- ⚠️ Add any new tool tile through `ToolIconCircle` - do not hand-roll another icon box, that is how revRender drifted.

- ⚠️ `ToolCard` right-side pills ("Already Generated", SOLD) overlapped the status line: a `Text` inside a `flex-row` does NOT shrink, so "Consent on file - present quote" ran under the pill. The status Text now has `shrink`, the text column `minWidth: 0`, and the pills are 11pt, `flexShrink: 0` and `maxFontSizeMultiplier={1.1}` so Android font scaling cannot blow them up.
- ⚠️ `ToolCard` pills end flush with the card padding (`pillGap` is 0 unless a download button follows) so "Already Generated", the revRender "AI" badge and the Pitch Book chevron share one right edge. A fixed `mr-2` had pushed the pills 8pt short.
- ⚠️ Every Tools tile shares `TOOL_CARD_MIN_HEIGHT` (68) with 12pt padding and a 16pt bottom margin, so one-line tiles (Roofline Deck) are no shorter than two-line ones; `ToolCard`, `PitchBookCard` and the revRender header (68 minus its 24 of padding) all read it. The pills are now vertically centred like the AI badge (`self-start` removed). New tiles must use the same constant.

## RevRender history viewer: pinch zooms the PICTURE, not the whole card

`widgets/modals/lead-center/RevRenderHistoryModal.tsx` (the "Render #N" Before/After slider). `imageAnimStyle` (translate + scale) was on `styles.sliderContainer` itself, so a pinch or drag scaled and moved the whole card across the screen - frame, Before/After labels and handle included - instead of zooming within it.

The container is now a FIXED clip and a new inner `Reanimated.View` carries the transform around the images, mask and slider handle; the Before/After labels sit outside the zoom layer.

- ⚠️ Do not put `imageAnimStyle` back on the container. The compare handle lives INSIDE the zoom layer on purpose: the mask is in image coordinates, so it must scale with the picture or the split would drift off the pixels it describes (the handle circle also grows when zoomed - accepted).
- Pan is clamped to `(scale - 1) / 2` of the width and of the measured frame height (`boxHeight`, set in `onLayout`), so the picture cannot be flung out of the frame.
- Device check (this repo cannot render-test): pinch to zoom, drag while zoomed, and that the slider handle still drags at 1x and when zoomed.

## Tools tab: Pitch Book tile drops the "No pitch books published" line

Ticket: *remove the words under Pitch Book.* In `OperationalSections.tsx` the pitch-book tile subtitle is now empty (and the `<Text>` not rendered) when no books are published; the row still opens the bundled standard deck.

- ⚠️ Only the empty-state copy was removed. "N pitch books available", "Loading pitch books…" and the "Couldn't load — tap ↻ to retry" line stay, because a failed list read must not look like an empty one.

## RevRender gallery — lighting renders show their look

Ticket: a Roofline Lighting render must say what was rendered ("Christmas" + colour dots), like the
"Soffit: <colour>" chips on core renders. Component: `widgets/modals/lead-center/RevRenderHistoryModal.tsx`.
- `renderColors` has a first branch for runs carrying `selections.lookName` (or `run.lookName`): one chip,
  the look name plus one dot per entry of `selections.colors`. Core-product runs take the old branches unchanged.
- ⚠️ Field names mirror the request payload (`utils/revrender-lighting/payload.ts`); they are not verified
  against a real history response. If the chip is missing on a lighting render, log the run and check where
  the server echoes `selections`.
- ⚠️ The file is CRLF — edit with `newline=''`.

### Follow-up — gallery shows the look's month and the render date
- The chip reads `Name · Dec` for seasonal looks: the server does not echo `month`, so it is looked up with
  `findLook(selections.lookId)` from the catalogue. Everyday / team / theme looks have no month and show the name only.
- The "Rendered" line gains ` · 10/6/2026` (M/D/YYYY, no zero padding — was `Oct 6, 2026`) from `run.createdAt`, parsed as TEXT (YYYY-MM-DD) — ⚠️ never
  `new Date()`, which shifts the day across timezones. Hidden when `createdAt` is absent.

## `useLeadPhotosWithPending` — the lead's photos, queue included

`hooks/useLeadPhotosWithPending.ts`, merge rule in `utils/pending-inspection-photos.ts`.

The Pitch Book and the Roofline Deck both built their list as
`fullLeadData?.outcome?.salesPhotos || fullLeadData?.salesPhotos || lead?.salesPhotos || []` —
every branch the **server's** list. A photo shot at a door with no signal is not in it; it sits in
`uploadQueueManager` until it uploads. The rep captured three inspection photos, saw them in Manage
Photos marked "Saved on device", opened the Roofline Deck to present them, and got "No inspection
photos available".

⚠️ **This is a different layer from the blank-thumbnail work**, which was all url→bytes
resolution. Those fixes could not help, because the photo was never in the list to resolve.

⚠️ **For RENDERING only.** A queued photo has no `_id` and no `s3url`, so delete, move and
`useSecureUrls` must keep reading the SERVER list — passing the merged list to `useSecureUrls`
would also change its set key on every capture and re-fetch every url for nothing.

⚠️ One hook rather than the merge inlined per screen, deliberately: the two screens had drifted
once already, and this is the file to change when a third needs the same thing.

## Risk Report / revRender progress bars offline — "waiting", not "failed"

`hooks/useLeadReports.ts`, `widgets/components/LeadCenter/OperationalSections.tsx`, rule in
`utils/report-job-connectivity.ts`. Endpoints: `LeadService.getJobStatus` (risk poll),
`getRevRenderBatchStatus` (render poll), `generateWeatherReport` / `generateRevRender` (the starts).

`RiskJob` and the render job gained `waiting?: boolean`, set when a status poll dies on transport
and cleared by the first poll that reaches the server. The card then shows an amber bar, a
cloud-off icon in place of the `ActivityIndicator`, and `jobWaitState(...).label`.

⚠️ **`startMockProgress` is a TIMER, not a measurement.** It advances 0→20→67→80% on elapsed
seconds with no server contact, so offline it kept filling for a render that was never submitted.
It must return early while unreachable — re-labelling a bar that is still climbing fixes nothing.

⚠️ **`pollRiskStatus` deliberately keeps polling** and still returns `false` on a transport
failure. The job is running server-side; the interval is what notices it finished.

⚠️ **Three copies of this bar exist** — here, the Pitch Book sheet and the Roofline Deck sheet.
Separate JSX, not a shared component; the rule is shared, the markup is not.

Why waiting rather than failed, and the trap about keying off the error: [`offline.md`](offline.md).

## Roof Waiver form: fields hidden under the keyboard

Ticket: *"the UI is hidden under the keyboard inside the waiver form."* `RoofWaiverModal.tsx` is a centred card (`maxHeight: 88%`) in a native `Modal` with a plain `ScrollView`, so the keyboard covered its lower half and nothing scrolled. Same fix as `CoCFormModal`: the backdrop is now `react-native-keyboard-controller`'s `KeyboardAvoidingView behavior="padding"` (shrinks the card to the space above the keyboard) and the body is a `KeyboardAwareScrollView` (`bottomOffset={24}`) that brings the focused field into it; `body` gained `flexShrink: 1` so the scroll area can shrink inside the card. ⚠️ Use the keyboard-controller versions, not React Native's: `KeyboardProvider` makes the app edge-to-edge, so Android no longer resizes the window. ⚠️ File is CRLF. Not verified on device.

### Follow-up: waiver phone field (number pad) also scrolls into view

The waiver's Phone Number field uses the in-app number pad, which `KeyboardAwareScrollView` cannot scroll for. `RoofWaiverModal` now also calls `useNumPadScrollIntoView` (scroll ref + a `collapsable={false}` wrapper around the scroll content), same as `DynamicTabRenderer` (see `app-wide.md`). The pad is mounted by the patched `Modal` in `index.js`, so no extra provider is needed.

## Reports tab: Inspection and Roof Waiver no longer filed twice (REVDSM-1293)

Every inspection and roof waiver showed up as TWO generated reports (e.g. `inspection_report` +
`Inspection_N/A.pdf`, `Roof Waiver - <name>` + `waiver_form`). Both server endpoints already file their own
`generatedReport`, and the app then uploaded the same PDF again through `uploadGeneratedReport`.
- Inspection (`handleInspectionSubmit`, `LeadCenter/index.tsx`): the re-upload is gone. `/pdf-reports/v1/inspection/:leadId/generate`
  files `inspection_report` itself. The handler now invalidates `['leads']` and ends on the `inspectionDone` dialog (see the next section).
- Roof Waiver (`finalizeConsentUpload`, `services/api/consent-forms.ts`): returns early for `kind === 'waiver'`, which covers both
  the online flow and the offline drain (`offlineLeadStore.ts`). `/lead/v1/:leadId/mobile/waiver-form` files `Roof Waiver - {name}`,
  and `hasFiledConsentReport` still matches it on the `waiver` keyword.
- ⚠️ Do NOT remove the CONSENT upload: `user/consent/v1/mobile/create` files no report, so this upload is the only one.
- Only new submissions are affected. Duplicates already stored were deliberately left alone.

Where the backend (`mhalt-revDSM-backend/src`) creates each `generatedReport` row:

| Form | Mobile calls | Route | Handler, where the row is created | `reportName` stored |
|---|---|---|---|---|
| Inspection | `handleInspectionSubmit` → `POST /pdf-reports/v1/inspection/:leadId/generate` | `api/controllers/v1/reports/PdfReportController.ts` (`generateInspectionReport`) | `core/handlers/reports/PdfReportHandler.ts` → `generateInspectionReport`, `generatedReportDBService.create(...)` (~L535): renders the PDF, uploads it to S3 (`inspection_report/<leadCode>/...`), saves the row, emits `emitGeneratedReportsUpdate`, streams the PDF back | `inspection_report` |
| Roof Waiver | `handleWaiverSubmit` / offline drain → `POST /lead/v1/:leadId/mobile/waiver-form` | `api/controllers/v1/lead/LeadController.ts` (`submitWaiverFormMobile`) | `core/handlers/lead/LeadHandler.ts` → `submitWaiverFormMobile`, `generatedReportDBService.create(...)` (~L7589): renders the PDF, uploads it to S3, saves a `WaiverForm` and the report row together (one `Promise.all`, so a failed save fails the request), then a `JobBuilderDocument` (Docs tab), emits sockets, streams the PDF back | `Roof Waiver - {fullName}` |
| Consent Form | `submitConsentForm` → `POST /user/consent/v1/mobile/create` | `api/controllers/v1/consents/UserConsentController.ts` (`createConsentFormMobile`) | `core/handlers/consent/UserConsentHandler.ts` → `createUserConsentMobile`: renders the PDF but creates **no** report row | none (the mobile `finalizeConsentUpload` creates it) |

The duplicates came from the generic upload endpoint `POST /generated-reports/v1` (`LeadService.uploadGeneratedReport`):
`api/controllers/v1/reports/GeneratedReportController.ts` → `core/handlers/reports/GeneratedReportHandler.ts` → `createGeneratedReport`.
It stores the client's `reportName`, or falls back to the uploaded file's name (~L101): `Inspection_<jobNumber|leadId>.pdf`
for the inspection re-upload and `waiver_form` (from `waiver_form.pdf`) for the waiver one. Consent is now the only
mobile flow that still uses it.

## Inspection report: end on a dialog, not a toast

Ticket: *after the inspection report is generated a toast says "saved to Downloads", but the rep has no way to see the file and no navigation afterwards.* `LeadCenter/index.tsx` (inspection submit) now finishes with the app's own `ConfirmDialog` (`DynamicDealCenter/components/ConfirmDialog`, `tone="neutral"`, same look as Result Lead / Deal Center; state `inspectionDone`) - NOT a system `Alert` (follow-up: *"use the same dialog format already used in the app"*) - offering **View Report** (`FileViewer.open(pdfPath, { showOpenWithDialog: true })` on the local generated file) and **Done**. The text says what really happened: uploaded to the lead's Job docs, saved to Downloads as `Inspection Report.pdf` (Android) - or, if `downloadPdfToDevice` threw, that it is uploaded but NOT saved to the device (the old catch branch showed a green "success" for that). ⚠️ The local file is deleted only when it is not a valid PDF, so `pdfPath` is still there to open. ⚠️ `downloadPdfToDevice(..., false)` stays silent: don't re-enable its toast or the rep gets two messages. Not verified on device.

### Follow-up: the report dialog says WHERE the file is

Ticket: *tell the user the report is generated and saved on the phone — that navigation isn't described.* The `inspectionDone` dialog now carries a `note` (the `ConfirmDialog` tinted box) with the locations: Android `Files / My Files app > Downloads > Inspection Report.pdf`, iOS `Files app, in the location you chose in the share sheet`, plus `this lead > Job docs` in both; when the device save failed it only points to Job docs and View Report. ⚠️ Keep the path text in step with `downloadPdfToDevice` (`utils/download-utils.ts`: Android writes to the `Download` media collection as `<title>.pdf`; iOS goes through the share sheet, so the real location is the user's choice).

### Follow-up: no "View Report" button, no Job-docs pointer

*"Remove the view report button — we do not show the report inside the app."* The `inspectionDone` `ConfirmDialog` is now a single-button notice (`hideCancel`, confirm `OK`) that only says the report was saved and where (Android `Files / My Files > Downloads > Inspection Report.pdf`; iOS the share-sheet location). The `FileViewer.open` path, the `path` field and every "this lead > Job docs" pointer are gone, because the report is not viewable in-app. If the device save fails the message says to generate it again. ⚠️ Do not add a viewer button back unless the report becomes viewable in the app.
- `LeadCenter/index.tsx` no longer imports `react-native-file-viewer` (its only use was the removed View Report button); other screens that still open PDFs keep their own import.

## Lead Center "Download Images" result uses the app banner, not a native Alert

Ticket: after downloading photos the result was a stock Android `Alert.alert("Success", ...)` that ignored the app theme. `JobDocsSection.handleDownloadAllImages` now raises `FlashMessage.success` / `.warning` (partial) / `.error` instead (`config/message.ts`).

- ⚠️ Raised inside a `setTimeout(..., 450)`: the download progress `Modal` has only just been dismissed, and a banner shown under a dismissing modal is never seen (root CLAUDE.md §6). Do not move it back inline.
- Other `Alert.alert` calls in the file (permission, delete, reset confirms) are untouched. Not verified on device.

### Follow-up — the banner keeps the OFFLINE counts (merge `dev-v1-multi-tenat` → `dev-qs-offline-v2`)

Both branches had rewritten the same block in `JobDocsSection.handleDownloadAllImages` and the merge
conflicted: `dev-v1-multi-tenat` had the banner (above), `dev-qs-offline-v2` had the offline-aware
counts. The resolution keeps **both** — `downloadResultMessage` (`utils/photo-download-plan.ts`)
produces the title/message, `FlashMessage` delivers it, still inside the `setTimeout(..., 450)`.

- The counts must come from `downloadResultMessage(successCount, attempts.length, skippedOffline)`.
  Offline, `attempts` is `resolved.filter(r => r.local)` — only photos already on the device are tried
  — and `skippedOffline` is the remainder, which the message reports as "N need a connection."
- ⚠️ **Do not compare against `imagesToDownload.length`** (the pre-filter total), which is what the
  incoming version did. Offline that is always larger than `attempts.length`, so a run where every
  downloadable photo succeeded reported "Download failed" and never mentioned the skipped ones.
- Severity is derived from the same three cases the helper branches on: `successCount === 0` → `.error`,
  `successCount === attempts.length && skippedOffline === 0` → `.success`, otherwise `.warning`.
- ⚠️ The file is CRLF. Not verified on device: the case to check is airplane mode with a mix of
  on-device and remote photos — expect an amber "Partial Download … N need a connection."
