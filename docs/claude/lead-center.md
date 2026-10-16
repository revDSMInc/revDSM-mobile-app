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

### First / Last Name auto-capitalize, same rule as Add New Lead

Ticket: *"can you do the same thing while we try to edit the first and last name?"* — following
`LeadCreate`'s auto-capitalize fix. Same `capitalizeFirst` shape (uppercase index 0 only, rest
untouched — a `.toLowerCase()` on the remainder would fight `McDonald`/`O'Brien`), applied at BOTH
places a name can be typed here:

- **Primary buyer** — inside the shared `renderField`'s `onChangeText`, gated the same way the
  existing phone-formatting branch already is: `label.toLowerCase().includes('name')`. ⚠️ This is
  `renderField`, not a per-field callback, so the check has to stay label-based to keep matching
  First Name / Last Name (co-buyers' too, since they call the same helper) without also matching
  Email or Phone Number — "phone" is checked first, and "name" does not appear in either of those
  labels.
- **Co-buyers** — inside `handleCoBuyerChange`, alongside the existing `field === 'phone'` branch,
  scoped to `field === 'firstName' || field === 'lastName'` (co-buyer address/email untouched).

Both feed the debounced field-change tracker (`trackFieldChange`/`trackedSetter`) the ALREADY
capitalized value, same as the phone formatter does today — the log and the saved payload can never
disagree about what was typed.

`autoCapitalize` on `renderField`'s `TextInput` is now `"words"` for Name fields, `"sentences"`
otherwise (previously unset app-wide) — a keyboard-level hint only; `capitalizeFirst` is what
guarantees the stored value regardless of IME behavior.

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

### Follow-up — Tools tab: Investment Center tile no longer spins on a brand-new lead

`widgets/components/LeadCenter/OperationalSections.tsx` (`ToolsSection`). A lead with no appointment/calculators sat on "Checking job status…" + a spinner
forever (root cause is in `useLeadCalculatorStatus`; full write-up in `investment-center-job-tracker.md`).
- `investmentStatusPending` is now `gate === 'unknown' || (isCalcStatusFetching && !allConfirmed && hasCalc)`: the background-refetch spinner only shows when
  jobs EXIST but are not confirmed (the post-confirm window). A lead with no calculators is a plain `locked` tile ("Please Fully Build ALL jobs first").
- ⚠️ Do not drop the `hasCalc` guard to "show activity" — it re-introduces the spinner on every visit to an empty lead. `unknown` (a lookup that THREW with nothing cached) still spins.

## The Tools ▸ revRender strip re-downloaded every render on each tab switch

Client report: "once the renders have been loaded they should be saved — it's still having them load
each time when I go in even though I already saw they were loaded the first time around." Reproduced
exactly as described: open Tools, let the two thumbnails paint, switch to Job docs, switch back —
both spin again.

⚠️ This is **not** the revRender picker fix in `app-wide.md`. That one is the photo grid inside the
revRender screen; this is the generated-render strip on the Lead Center Tools card, a different
component (`ImageWithLoader` in `widgets/components/LeadCenter/OperationalSections.tsx`) that had the
same shape of bug. Both reports read identically from outside; check which surface is meant.

Three things were wrong, and the tab switch made all of them visible — `screens/LeadCenter/index.tsx`
renders the section as `{activeTab === 'tools' && <ToolsSection … />}`, so leaving Tools unmounts it
and coming back is a **fresh mount**, not a re-show:

1. `ImageWithLoader` rendered the pre-signed S3 url directly. Those carry no cache headers, so the OS
   image cache won't store them — every mount is a fresh download. The card *was* warming a local
   file beside it (`prefetchToLocalCache`), but nothing ever read it back.
2. Worse than a plain cache miss: `useRevRenderRunsQuery` hands back **re-signed** urls, so even RN's
   in-memory cache misses on the way back. Only the file cache survives that, because
   `getLocalCachePath` strips the query.
3. `onLoadStart={() => setLoading(true)}` re-armed the spinner on every mount, over an image that was
   about to paint anyway.

Fix: `ImageWithLoader` seeds from `getWarmedLocalUri(uri)` synchronously, starts `loading` at
`!seeded`, and falls back to `warmToLocalCache`. The warm sweep over `orderedRuns` now calls
`warmToLocalCache` instead of `prefetchToLocalCache` — ⚠️ both write the same file, but **only
`warmToLocalCache` records it in the warmed-uri memo**, which is what lets the strip name the local
copy without an async hop. A bare `prefetchToLocalCache` leaves the reader to rediscover the file
every time, which looks exactly like no cache at all.

`CachedImage` in `widgets/modals/lead-center/RevRenderHistoryModal.tsx` got the same seeding. It
renders `null` until it knows its uri, so the async `fs.exists` meant the before/after gallery went
blank for a beat on every open and on every swipe back to a render already seen.

⚠️ `CachedImage`'s `onError` must call `forgetWarmedUri(uri)`, not unlink the path itself. Unlinking
alone leaves the memo pointing at a file that no longer exists and every later reader is handed a
dead `file://`. Anything else in the app that deletes a cached image needs the same treatment.

⚠️ Keep `CachedImage` painting the network url and warming underneath **without** swapping `sourceUri`
when the download lands — the original comment says changing the source mid-load trips native
image-loader hangs, and that still holds. The next mount picks the file up from the memo.

Not verified on a device. `tsc` 45 errors (unchanged baseline, none in either file), `eslint`
identical to HEAD for both files (55 problems / 8 errors, all pre-existing), `jest` 542 pass. On
device the check is: open Tools, wait for the thumbnails, go to Job docs and back — they should be
there immediately, with no spinner.

## The header buttons paused the session but never released it

DevTools showed `PUT lead/v1/{id}/work` with `{ workStartedBy: null }` going out when the rep left
via the screen's own back arrow, and **not** when they left via the green `MainHeader`. The pause LOG
fired on both.

Cause: the two halves of "the rep left" lived in different places.

- `LeadCenter.pauseLeadSession` filed the `lead_session` / `session_pause` log.
- `useLeadCenterData`'s **unmount cleanup** made the `endWorkLead` release.

⚠️ An unmount is not the only way the rep leaves a lead, and tying the release to one meant **no
route through the green `MainHeader` released at all** — the logo included, even though it lands back
on `Leads`. Confirmed on device: back arrow → pause log **and** `{ workStartedBy: null }`; logo →
pause log **only**. Do not reason about this from the navigator's pop/push behaviour, as a first pass
at this ticket did and got wrong; the network tab is the authority.

The bell, the chat icon and the account menu's Profile / Job Tracker / My Learning additionally PUSH
their screen on top, so Lead Center is not even unmounted on those. Either way the rep is left
`workStartedBy: <them>` on the server while ops has already read the pause — a rep who looks like
they are still standing in a customer's house they walked out of.

Fix — one exit path owns both halves:

- `pauseLeadSession` now calls `LeadService.endWorkLead` beside the log. Every route already goes
  through it (back arrow, hardware back, header, unmount backstop), so no route can pause without
  releasing.
- ⚠️ The release runs for a **deal** too (`fromMyDeals`). The Lead Center opens a work session on
  mount either way and it has to be given back; only the LOG stays suppressed, which is the web
  parity rule. The early `if (fromMyDeals) return` therefore moved to sit *after* the release.
- ⚠️ `useLeadCenterData`'s cleanup no longer releases. Do not add it back — two owners is exactly how
  these drifted apart. It still calls `clearLeadWorkSession` as the backstop.

### The resume half is not optional

⚠️ Releasing on pause **without** this would have been a worse bug than the one it fixed. On the push
routes the screen is only blurred, and the `workLead` call lives in a mount effect keyed on
`lead._id`/`user._id` — it does not re-run on the way back, so the rep would return from Notifications
to a lead the server thinks nobody is working.

`LeadCenter` gains a `useFocusEffect` that re-calls `workLead` and re-arms `beginLeadWorkSession`.

- Keyed on `hasLoggedPauseRef`, so it is a **no-op on the first focus** — the mount effect has already
  opened the session, and re-sending `workLead` there would stamp a second check-in for one arrival.
- It re-arms the killed-app record because the pause cleared it; without that a kill after a resume
  would leave the session dangling with nothing to sweep it.
- It runs for a deal too, mirroring the release.

⚠️ Both halves stay behind `AppState.currentState !== 'active'`, unchanged — the camera hand-off must
still not pause a rep mid-inspection (see the long comment on `pauseLeadSession`).

⚠️ **Unverified, and worth watching:** whether the backend treats a repeat `workLead` as a *new*
check-in (fresh timestamp, new session row, or a duplicate `lead_check_in`). If it does, a bell
round-trip will read as a second arrival on the portal timeline and the resume needs to send
something weaker. Check the Forever Record after tapping the bell and coming back before calling this
done. There is also a brief offline blip on the ops board across a push-navigation; debounce the
release on those routes if ops object.

Not verified on a device. `tsc` 45 errors (unchanged baseline, none in either file), `eslint`
identical to HEAD for both (43 problems / 18 errors, all pre-existing), `jest` 551 pass.

## Manage Photos: Move / Trash action buttons scaled down

Ticket: *"Scale down Trash and move icon."* `DynamicManagePhotosView`'s per-card action row
(`renderCard`, the `!selectMode && !isPending` block) shrunk uniformly: row height 32→26,
border radius 8→7, icon size 14→11 (Move) / 18→14 (Trash), Move label 11→10, row `gap`/`padding`
8→6. Purely cosmetic — no change to `canMove`/`moveTargetCount` gating, the move/delete handlers,
or the `busy`/pending states above them. `widgets/components/lead-center/` (lowercase, distinct
from `widgets/components/LeadCenter/`) added to this file's CLAUDE.md §8 row — it held the dynamic
inspection photo capture/manage/move components with nothing in §8 naming it until now.

## Cancelled banner missing from the Sold Leads route, and the pencil opening the wrong editor

Two reports against the same screen. Lead Center is reached from **Sold Leads** and from **My
Deals**, and both bugs were the same mistake: a deal-level fact gated on which route the rep came
in through.

### 1 · `JOB CANCELLED` only rendered from My Deals

`DealBanners` was rendered as `{fromMyDeals && <DealBanners lead={lead} />}`. A job cancelled from
the Sold Leads tab then showed **no cancelled state anywhere** on the screen — same deal, same
record, banner on one route only. The Sold card itself reads `Resulted — Cancelled`, so the rep saw
it in the list and then lost it on open.

⚠️ **The gate is removed, not widened.** Whether a job is cancelled is a fact about the DEAL, not
about the door the rep came through. `DealBanners` already returns `null` unless the status is
`cancelled`, so the normal lead path is still untouched — the `fromMyDeals` check was never what
protected it.

Status reaches the banner as `lead.result || lead.status`; the Sold list maps `status: 'cancelled'`
through `RESULTED_LABELS` (`widgets/components/LeadCard.tsx:124`), and the banner lowercases before
comparing, so both spellings land.

### 2 · The Contract Details pencil opened the inline modal on a dynamic deal

The pencil should launch the 4-step deal-edit wizard. It opened the old "Edit Contract Details —
select what to edit" modal instead, which reads as the wizard never having been wired up. **The
wiring was fine** (`JobDocsSection`'s `onEditContract` override is intact); the *detection* was
wrong.

### Correction, after the fix above did NOT work on device

The first fix swapped the hand-rolled `isDynamicDeal` for the canonical
`isDynamicJobBuilderData`. It helped some deals and the modal still appeared on others, which
exposed the real cause:

⚠️ **THE JOB BUILD IS NOT ON THE LEAD.** It is fetched from its own endpoint —
`getPortalJobBuilder`, with a calculator-outcome fallback — by `enrichJobBuilderProductData`,
which the wizard runs on the way in. **Lead Center never calls it.** Its `lead` payload carries
calculator ids and no build, so *no synchronous inspection of `lead` can answer "is this dynamic"*.
Every version of that guess returned false for real dynamic deals. Widening the predicate only
moved which deals guessed wrong.

**The pencil is now UNCONDITIONAL** — `onEditContract={handleEditDeal}`, no branch, and
`isDynamicDeal` is gone from this screen along with the `isDynamicJobBuilderData` import.

⚠️ **Do not reintroduce a dynamic-vs-legacy branch here**, however the predicate is
written. The data it would need is not on this screen.

Routing a legacy deal to the wizard is safe and is the better answer: `DynamicDealEditScreen`
resolves the build itself and renders *"This deal can't be edited here — this deal has no dynamic
job-builder data to edit"* with a Go Back (`DynamicDealEditScreen.tsx:2357`). That is an honest
answer **after** looking, where the old branch was a wrong guess **before** looking.

⚠️ Why this was worth chasing: **only the wizard raises an ADDENDUM**. The inline modal
edits the record directly, so every edit made through it changed a signed contract with **no
signing link sent to the customer**.

#### What the first attempt got right, and keep

The canonical detector is still the right one wherever this question IS answerable (inside the
wizard, which has the fetched build). The hand-rolled three-way check missed two real shapes:

- **ROOT-SERIALIZED state.** `utils/dynamic-job-builder/engine/dynamic-job-state-storage.ts:895`
  saves a build with the verticals **at the root** beside `_storageVersion` — there is no
  `dynamicJobState` key to find.
- `calculatorType: 'dynamic'` with no `isDynamic` flag.

⚠️ `_storageVersion` beside **only** `LEGACY_STATIC_PRODUCT_ROOT_KEYS` (`soffit`, `fascia`,
`gutter`, `lighting`…) is still **legacy**: those keys are excluded from the root-serialized scan,
so nothing remains to extract. A test fixture using `soffit` looks dynamic and is not — this cost
real debugging time and is pinned by a test.

Tests: `__tests__/utils/lead-center-dynamic-deal.test.ts` (8). It pins **why the branch cannot
exist** (a lead carrying only `calculatorId` reads as legacy) rather than asserting a predicate that
should no longer be called from this screen. ⚠️ It must `jest.mock` `services/api/leads` —
`enrich-job-builder-data.ts` imports `LeadService` for its fetchers, which drags in
axios → queryClient → connectivity → netinfo, and netinfo cannot load under jest here. The
detectors themselves are pure; splitting them into `src/utils/` would remove the need for the mock.

## My Deals showed "No leads found" offline

Reported with a screenshot: the offline banner across the top, and underneath it **"No leads
found"** on a list of deals the rep had already sold.

`screens/MyDeals/index.tsx` fetched `LeadService.getSalesDeals(...)` directly — no TanStack, no
cache — and its `catch` ran `if (isNewFilter) setLeads([])`. With no signal the request threw and
the list was emptied.

⚠️ **An empty list is indistinguishable from "you have no deals."** That is the worst available
reading of a connection problem, and the same anonymous-failure pattern recorded in
`offline-mode-client-qa.md` §Q10: the request threw, the catch swallowed it, and the rep was left
with a screen that quietly lied.

**Fix:** page 1 of each tab now goes through the established `cachedFetch` helper
(`utils/offline-query-cache.ts`), keyed `leads-list:my-deals:<all|scheduled|TBD>` and
owner-scoped. Shape handling moved to a pure `utils/my-deals-page.ts › toDealsPage` so it is
testable.

⚠️ **PAGE 1 ONLY.** Endless scroll is a convenience that can need a connection; the first
screenful is what decides whether the rep sees their deals or an empty state. Caching every page
would grow unbounded in MMKV, which rewrites its whole store per write.

⚠️ **`isEmpty: (p) => !p.leads.length`** — never let a transient empty response overwrite a good
offline copy.

⚠️ **`hasMore` must be ANDed with `isOnline()`.** Served from the cache there is nothing more to
fetch; without this the list pages forever against a network that is not there.

⚠️ **`toDealsPage` never throws.** It runs inside the offline fallback, so a shape surprise there
would produce exactly the empty list this change removes. Both envelope spellings
(`data.leads` / `leads`, `pagination` / `data.pagination`) are live on this endpoint.

With nothing cached at all, `cachedFetch` rethrows and the existing empty state shows — honest,
because there genuinely is nothing saved for that tab yet.

### Follow-up — the pencil no longer refuses to open a sold deal offline

`screens/LeadCenter/index.tsx › handleEditDeal` dropped its
`offlineBlockFor('addendum', isOnline())` guard.

Reported from a device: tapping the pencil on Contract Details with no signal flashed
*"Needs a connection — an addendum is raised on the server and texts the customer a signing
link"* and never navigated. The whole edit wizard was unreachable at a door.

⚠️ **The refusal MOVED, it did not disappear.** It now lives on **Submit**, in
`DynamicDealEditScreen`, which is the only place that can tell a plain build change (queueable)
from a refund or a new attachment (not). Blocking at the entry point meant refusing the 90% of
edits that queue perfectly well in order to stop the 10% that cannot.

⚠️ **Opening and editing are LOCAL work and must stay unblocked.** Nothing leaves the device
until Submit, so an entry-point gate can only ever be too blunt.

⚠️ **`offlineBlockFor` is still imported and still used for `chat`** — do not remove the import.

Queue mechanics and the refund-ordering rule: [`offline.md`](offline.md). Phases:
[`docs/MY-DEALS-OFFLINE-PLAN.md`](../MY-DEALS-OFFLINE-PLAN.md).

---

## Ticket — "Download all photos" works offline

Asked whether the gallery download could work offline from cache. It can, and it already had
everything it needed — it just never looked.

`usePrecacheLeadPhotos` (called at `LeadCenter/index.tsx:165`, the **same screen** that renders
`JobDocsSection`) warms every non-deleted `salesPhotos` entry into `imageFileCache` while the rep
is online. So by the time anyone taps Download, the bytes are on disk.

⚠️ **The cache key ignores the S3 signature.** `getLocalCachePath` does `url.split('?')[0]`, so a
re-signed pre-signed URL still resolves to the file fetched yesterday. Without this the feature
would be worthless — every re-sign would look like a cache miss. Do not "tidy" the full URL back
into the key.

The old `handleDownloadAllImages` sent any `http(s)` URI straight to
`ReactNativeBlobUtil.config(...).fetch('GET', mediaUri)`. Offline that throws for every photo and
the rep gets *"Failed to download photos. Please try again."* — standing on top of the exact
files it wanted.

### What changed

`resolveOnDevice` now runs before anything else, and it checks **two** places:

⚠️ `getWarmedLocalUri` alone is NOT enough. It is an in-memory map, so it only knows what the
current app session warmed — after a relaunch it is empty while the files are still on disk. The
authoritative check is `getLocalCachePath` + `fs.exists`, and it is what makes this survive the
rep closing the app. Dropping the second lookup would make the feature work only in the session
that happened to view the photos.

Offline, the split drives the message up front (`offlineDownloadNotice`) rather than letting each
photo fail individually into a misleading error.

⚠️ **Partial is offered, never refused.** A rep who can save six of eight photos wants those six.
Only a completely cold cache blocks. The closing count includes what was skipped
(`downloadResultMessage`), or the rep is told "3 of 3" when two never ran.

Rules live in `utils/photo-download-plan.ts` because `JobDocsSection` imports RN and blob-util and
cannot load under jest (CLAUDE.md §6).

⚠️ `JobDocsSection` already has `const isOnline = useIsOnline()` at ~line 227 — a **boolean**.
Importing the `isOnline` *function* from `services/connectivity` shadows into a confusing
`TS2349: This expression is not callable`. Use the component's reactive flag.

---

## Ticket — Investment Center re-locked itself after the rep had built the jobs

Client: confirmed all rollouts → Investment Center → filled the form → back to Deal Center on a
weak signal → the calculator would not show, and the Investment Center was **locked** again with
*"Please Fully Build ALL jobs first"*. Screenshots showed the same lead reading
*"Deal Center — All jobs built / Investment Center — Ready to present"* online and
*"Please Fully Build ALL jobs first"* offline.

**Nothing was ever lost. The app forgot how to ask, and read its own silence as a "no".**

### Root cause

`useLeadCalculatorStatus` had `catch { return resolve(EMPTY); }` on BOTH read paths, and `EMPTY`
is `{ hasCalculator: false, allConfirmed: false, count: 0 }`. A failed request therefore returned
a definite *"the jobs are not built"*, which `OperationalSections` turned into `locked`.

Two things made it bite exactly when it did:
- `OperationalSections` refetches in a `useFocusEffect`, so the read fires the instant the rep
  returns from the Investment Center — the precise moment described.
- The only defence was `LOCAL_CONFIRM_GRACE_MS = 60_000`: an **in-memory** `Map` that expired
  after sixty seconds and died on relaunch. Filling the form took longer than that.

### The rule

⚠️ **An unanswered question is not a negative answer.** A failed read must return the last thing
the server actually said, never a manufactured empty. Rules are in `utils/lead-calc-status.ts`
(pure — the hook imports TanStack and cannot load under jest, CLAUDE.md §6).

- `statusAfterFailedRead` returns the cached status, or `null` meaning **unknown** — never EMPTY.
- `markLeadRolloutsConfirmed` now **persists to MMKV before** touching the query cache. The rep's
  tap is the fact; the server response only acknowledges a fact that already happened. Caching
  only on success is what makes a weak signal look like lost work.
- `mergeStatus` lets a local confirmation **outrank** a server read that disagrees — a read racing
  the confirmation write returns `allConfirmed: false` and would re-lock under the rep's hand.
- `shouldPersistStatus` refuses to overwrite a confirmed row with an unconfirmed one, so the bug
  cannot come back from the write side.
- `initialData` seeds from disk, so the first render already knows; without it the card renders
  locked for a frame, which is the flash a rep reads as "my work is gone".

⚠️ **`unknown` must not lock, and must not silently swallow the tap either.** The first attempt
left the card unlocked but `onPress` still returned early on `investmentStatusPending` — the rep
taps and nothing happens, an invisible lock instead of a visible one. Only `gate === 'locked'`
refuses now; `unknown` lets the rep through and retries the status behind them. A wrong lock
costs a sale; a wrong unlock costs one tap.

⚠️ Only a deliberate reset may clear a confirmed row — `clearLeadCalcStatus`, never a failed read.

### Where else this shape lives

The pattern to grep for is any `catch` returning an empty/false/zero default that the UI then
**gates a feature on**. The Deal Center status line in the same screenshot went blank for the same
reason. Cache-first is right for display and gating state like this; it is deliberately NOT right
where the server is the only authority (card refunds, see `offline.md`).

---

## Ticket — a filed consent form was offered again offline (duplicate signature)

Client: *"I submit the form and it's submitted successfully in online mode => I become offline =>
came back => and it's again allow me to submit the form."* A blank Customer Consent Form for a
lead that already had one on file — i.e. a **second signed customer record**.

### Root cause

"Already filed" had only two sources, and BOTH miss this case:

1. `findReport('consent_form')` reads `lead.generatedReports` — **server data**. Offline the lead
   comes from cache, and a cached copy taken before the submission has no such report.
2. `queuedForms.consent` (`useQueuedConsentForms`) only ever knows about a form submitted
   **offline** and still queued. A form submitted **online** never enters that queue.

So an online submission left **no local trace whatsoever**: the only proof lived on the server the
app could no longer reach. `submitConsentForm` / `finalizeConsentUpload` wrote nothing to the
device on success.

### The fix — write the fact down the moment it becomes true

Same rule as the Investment Center lock above: do not rely on being able to ask the server later.

- `markConsentFiled(leadId, kind)` is called on **every** successful submission — the online
  mutations in `useLeadMutation.ts` AND the offline drain in `offlineLeadStore.ts`.
- ⚠️ The offline drain needs it too. The queue row is the only offline proof while it exists, but
  it is **removed after a successful drain** — without the log the form becomes offerable again on
  the next cached read.
- `consentAlreadyFiled({ serverFiled, queued, filedLocally })` ORs all three. ⚠️ **Never narrow
  this to one source** — each was, at some point, the only one that knew.

⚠️ **A reset must clear the log** (`useResetLeadMutation`). I missed this on the first pass and it
would have been a new bug: a rep who deliberately reset a lead could never re-collect consent,
because the log would outlive the thing it describes. A reset is the ONLY thing allowed to clear
it — never a failed read.

⚠️ `offline-cache:consent-filed` is in `SESSION_KEEP_PREFIXES`. Unlike the calculator status
(re-derivable from the server) this is **not** reconstructible offline, so clearing it on sign-out
would let the duplicate-signature bug straight back in. The envelope is owner-stamped, so another
rep on the same handset still cannot read it.

Rules in `utils/consent-filed-log.ts`, storage in `services/consentFiledStore.ts`, hook in
`hooks/useFiledConsents.ts` — pure/split because the callers import blob-util (CLAUDE.md §6).

### Follow-up — the SAME bug, reported again: the Investment Center screen had its own gate

Client, after the fix above shipped: *"submitted the form => become offline => went back => press
the investment center again => and it's allow me to submit the form again instead of showing
investment center."* The Lead Center card was by then correct — the screenshot showed **"Consent on
file — present quote"** and the **"Already Generated"** badge — while the screen behind it still
auto-opened a blank consent form.

⚠️ **The decision lived in two places and only one was fixed.** `screens/InvestmentCenter/index.tsx`
kept its own copy:

```
const consentSigned = localConsentSigned || consentQueued || hasSignedConsent(lead) || isLeadSold;
```

Every term fails the client's sequence: `localConsentSigned` is `useState(false)` and resets on
remount; `consentQueued` only knows forms submitted OFFLINE; `hasSignedConsent(lead)` reads
`lead.generatedReports`, absent on a lead re-read from a cache older than the submission. With all
three false the auto-open effect (`consentAutoOpenedRef`, ~line 257) raised the form again.

Both screens now call **`consentAlreadyFiled`** (`utils/consent-filed-log.ts`), which gained
`signedThisSession` and `leadSold` so the whole decision is one predicate with one set of tests.

⚠️ **Fixing a gate means fixing every copy of it.** `OperationalSections` (the card badge) and
`InvestmentCenter` (the screen) must agree, or the app contradicts itself in the worst possible
way: the badge says the consent is on file while the screen demands a second signature. When
changing this, grep `hasFiledConsentReport|hasQueuedConsent` and check each hit — anything using
them as a GATE belongs on `consentAlreadyFiled`.

⚠️ **`knownFiledBefore` is NOT one of these and must stay as it is.** In `offlineLeadStore.ts` it
feeds `isConsentAlreadyFiled`, a duplicate-replay guard that does a FRESH `getSalesDealById` read
before re-posting a queued form. It is deliberately server-truth, not device-truth; routing it
through the cached predicate would let a replay through.

### Follow-up 2 — the third entry point: the Job Docs form ROW

Reported again: the **Customer Consent Form** row in Job Docs showed the **"Already Generated"**
pill and still opened a blank form on tap.

⚠️ **Detection was never the problem in ANY of the three reports.** Each time the row rendered the
pill from the correct value while the tap path ignored it.

**Where the decision belongs.** `useLeadCenterModals`'s `onToolAction` ALREADY did the right
thing — open the filed PDF, or say *"Signed and filed. Viewing the PDF needs a connection."* when
offline. Its gap was only that `findReport` reads `lead.generatedReports` (server data, missing
from a lead re-read from an older cache) and `queuedForms` only knows forms submitted offline, so a
consent filed ONLINE and reopened OFFLINE matched neither and fell through to `toggleModal` — the
blank form. It now also consults `useFiledConsents` (the persisted local log).

⚠️ **A filed form NEVER re-opens the blank form.** The customer has already signed. The three
outcomes are `view-pdf`, `explain-offline`, `open-form`, decided by `consentPressAction` in
`utils/consent-filed-log.ts`; both the consent and waiver branches call it.

⚠️ **Do not add a second gate to `handleConsentPress` / `handleWaiverPress`.** An earlier attempt
put an "already signed — Sign again?" `Alert.alert` there. It was wrong twice over: it duplicated a
decision that already lives in `onToolAction`, and offering "Sign again" at all invites the second
signature this whole ticket exists to prevent. Those handlers dispatch and nothing more.

⚠️ `filedLocally.consent` / `.waiver` must stay in the `useCallback` dependency array, or the
callback captures a stale "nothing filed" and re-opens the form.

**The three entry points, for the record:**
1. Lead Center card badge (`OperationalSections`) — detection only.
2. Investment Center screen (`screens/InvestmentCenter/index.tsx`) — its own `consentSigned`.
3. This Job Docs row → `onToolAction` in `hooks/useLeadCenterModals.ts`.

The Investment Center's other two openers (the auto-open effect and the "Sign Consent Form"
button) sit inside the `!consentSigned` branch, so (2) covered them. Grep
`setShowConsent|onAction\('consent|onAction\('waiver` when touching this.

### Follow-up — `unknown` must not unlock a lead created OFFLINE

Reported from the field: *create a lead offline → open Lead Center → tap Investment Center* — and
it opened, on a lead with no rollouts built at all. The card showed **"Checking job status…"** and
let the rep straight through.

This was **over-application of the fix above**. That ticket's rule — *an unanswered question is
not a negative answer*, so `unknown` does not lock — is right for a lead that **might** have
confirmed rollouts on a server we cannot reach. It is wrong for a lead created offline: a
client-id lead has **no server record**, so the status read is guaranteed to fail, and "we could
not ask" silently became "come on in".

⚠️ **"We could not ask" only earns the benefit of the doubt when there is something to ask
ABOUT.** For a device-only lead the device holds the whole truth, and the whole truth is that
nothing has been confirmed. `calcGateState` now takes `isDeviceOnlyLead` (from `isClientId`) and
returns a definite `locked`.

⚠️ **Ordering matters — the `allConfirmed` check stays ABOVE the device-only check.** Rollouts can
legitimately be built offline: `markLeadRolloutsConfirmed` persists to MMKV keyed by the client
id, so a cached confirmation must still unlock. Reversing these two lines locks a rep out of the
presentation they just built at a door. A test pins both directions.

⚠️ The Investment Center screen itself has its own `visible.length === 0` fallback, so there is no
second gate to fix here — unlike the consent form, which needed all three.

---

## Ticket — "revRender generated in another lead"

Client screenshot: a gutter lead in Bradenton showing **50 Runs** of Christmas-light renders that
belonged to a different property. Online, full signal — nothing to do with offline mode.

### Root cause: a closure passed as a navigation param

`useLeadReports(lead, refetch)` is bound to ONE Lead Center, and its `handleStartRevRenders` is
handed to the RevRender screen as **navigation params**:

```
navigation.navigate('RevRender', { lead, onGenerate, onGenerateAll })
```

⚠️ **A function passed as a nav param is a closure over the screen that created it.** With two
Lead Centers in the stack — a push notification, the Notifications screen or chat opening lead B
while lead A is still below — RevRender called **lead A's** closure, and every render was filed
under lead A: the `rev_render_jobs_<id>` storage key (written in three places), the pre-gen run
fetch, and the final `['revrender-runs', id]` invalidation.

⚠️ **RevRender was already sending the right id and the caller dropped it.** It builds
`{ payloads, leadId, jobId }` (`screens/RevRender/index.tsx` ~line 719); `onGenerateAll` took only
`body.payloads`. The fix is to honour `body.leadId` — the information was never missing.

### The fix

`handleStartRevRenders(payloads, targetLeadId?)` resolves `renderLeadId` **once** at the top via
`renderTargetLeadId` (`utils/revrender-attribution.ts`, pure/tested) and every site uses it.

⚠️ **Resolve it once; do not leave a stray `lead?._id` among the five uses.** The job-list key is
written in three separate places, and one missed site re-creates the bug for half the flow —
jobs stored under one lead, invalidated under another.

⚠️ **`refetch` must NOT run for another lead's renders** (`shouldRefetchAfterRenders`). It is
bound to this hook's lead, so firing it refreshes a screen the results have nothing to do with
*and* leaves the lead that owns them stale.

⚠️ `targetLeadId` is optional and falls back to the hook's lead, so the ordinary single-lead flow
is byte-for-byte unchanged. Both call sites in `screens/LeadCenter/index.tsx` now pass it
(`body.leadId`, and `payload?.leadId` for the single-render path — every payload carries it).

⚠️ **This class of bug is not limited to revRender.** Any callback handed through
`navigation.navigate(...)` captures its creator's state. When adding one, pass the identifying id
in the call and honour it, rather than trusting the closure.

The back-stack fix in [`deal-center.md`](deal-center.md) removed one route into this (the
"Back to Tools" double-push) but not the others — push notifications, Notifications and chat can
all still stack a second Lead Center legitimately.

### Follow-up 2 — a brand-new ONLINE lead also slipped through

Third report of the Investment Center opening when it should not: create a lead, go straight to
Lead Center, tap Investment Center — on **WiFi**, with no rollouts built.

The previous follow-up only covered *offline-created* leads (`isDeviceOnlyLead`). This one is a
synced online lead, and it failed for a different reason — in a line from the fix above:

```
if (!apptId) return cached ?? null;   // ← returns "unknown", which does not lock
```

⚠️ **There are TWO "no appointment" cases and they are not the same fact:**

| what happened | what it means | what to return |
|---|---|---|
| `getAppointments` **threw** | we never got an answer | `onFailure()` — cached, else unknown |
| `getAppointments` **succeeded**, lead not in it | no appointment ⇒ no calculators ⇒ nothing confirmed | `land(EMPTY_CALC_STATUS)` — a definite **locked** |

A brand-new lead has no appointment yet, so the second case is its *normal* state. Returning
`null` there reported "don't know", and `unknown` deliberately does not lock. An `answered` flag
now records that the server actually replied.

⚠️ **This is the shape of all three reports: a successful-but-empty read being treated as an
absent one.** `unknown` must mean *"we could not ask"* and nothing else. Whenever a new exit is
added to this `queryFn`, decide which column it is in — there are exactly four exits now, two
`onFailure()` and two `land()`, and that split is the invariant worth preserving.

⚠️ `shouldPersistStatus` / `mergeStatus` still protect the other direction: an answered-empty read
can never clear a lead that is already confirmed. A test pins this, because the obvious
"simplification" — writing EMPTY straight through — re-creates the original bug.

Verified matrix: new online lead → locked; new offline lead → locked; confirmed online → unlocked;
confirmed offline from MMKV → unlocked; sold → unlocked; synced lead on a weak signal with nothing
cached → **unknown/open**, which is the original ticket above and must stay that way.

---

## Ticket — No Demo / Not Hit / Reset offline

The three no-sale buttons in Job Docs did nothing offline: `handleResultSubmit` called
`submitJobMutation.mutateAsync`, which threw, and the catch closed the modal and logged to the
console. The rep got **no error, no change, no record**.

⚠️ **All three are ORDINARY lead results, not separate endpoints.** A DevTools capture settled
this — tapping Reset posts

```
leadData: { result: "reset", reason: "Not Home", status: "reset", timestamp: … }
```

to `submitJobBuilder`, exactly like No Demo and Not Hit. That is the **same endpoint the queue's
`submit` step already calls**, so queueing them needed no new arm: just an offline branch calling
`completeOfflineJobBuilder(work.clientId, payload)`, the same writer the Job Builder's own offline
submit uses.

⚠️ **This Reset is NOT "Reset Job Docs."** `resetLeadMutation` → `LeadService.resetLead`
(`lead/v1/{id}/reset`) permanently deletes uploaded images and documents, and stays **online-only
on purpose**: a queued replay could land after work the rep did later and destroy it. The two
controls sit feet apart in the same component — do not merge their handling.

### The half that was easy to miss

Queueing alone was not enough. `offlineResultOverlay` accepted only `sale` and `demo`, so the
lead still showed as **unresulted** in the leads list until it synced — and a rep who results a
lead and sees nothing change assumes it failed and does it again. `OFFLINE_RESULTABLE` now
carries `sale`, `demo`, `nodemo`, `nothit`, `reset`.

⚠️ **`status` is not the same field as `result`.** The leads list and the lead card colour-code on
`status`, which the no-sale payloads set separately; the overlay previously reused `result` for
both. A test pins this.

⚠️ An unrecognised result still returns `null` rather than being guessed at, and the overlay stops
once `status === 'uploaded'` so the server becomes the truth again.

⚠️ When there is no offline work record for the lead (`ensureOfflineWorkForLead` returns null —
a server lead never opened offline) the rep is told plainly instead of the result vanishing.

### Follow-up — the result log has to fire on BOTH paths

The first cut of the offline branch above `return`ed before `handleResultSubmit`'s `logEvent`,
which sat after `mutateAsync`. So a No Demo / Not Hit / Reset taken at a door reached the server
on sync but left **no Forever Record entry** — the rep looked as though they had skipped a step.
That is ticket 1310 in a new place: not a lost log this time, but one that was never emitted.

The `logEvent('submit', …)` now sits **above** the online/offline branch, so both paths record
the same thing once.

⚠️ **Put shared telemetry before the branch, not in each arm.** Duplicating it is how the two
copies drift; returning past it is how one disappears. There is exactly one call now.

⚠️ `logEvent` does the offline handling itself — `lead_result_field_entry` is queueable, it is
held when `isOnline()` is false and stamped with `occurredAt` at the moment of the tap, so the
replay lands where the rep actually acted rather than at sync time. The caller must not
pre-empt that with its own queueing.

The other two logs in this flow (`click_build_job` and `change_lead_result_reason`, both in
`widgets/modals/lead-center/ResultLeadModal.tsx`) already fire unconditionally before
`onSubmit`, so the full trail — reason chosen → confirm → result submitted — survives offline.


### Lead preview photo loads from disk (`useLeadPreviewUrl`)

`hooks/useLeadPreviewUrl.ts` is shared by the chat header, the thread list and other lead thumbnails. For stored (bucket) photos it now persists the last resolved URL in MMKV (`leadPreviewUrl:<bucket/path>`) and returns the `warmToLocalCache` file, so a reopened lead shows the photo with no `getSecureUrls` call and offline. Full write-up and traps: `notifications-chat.md` § "Chat header / thread-list lead photo: slow to appear". ⚠️ Never route a `googleUrl` (street view) through that cache - its signature-less path is identical for every lead. Not verified on device.

### `useUploadImagesMutation` takes an idempotency key

Part of the photo-duplication fix (4 uploads became 9 on mobile data). Root cause, the key
format and the backend contract are in [`offline.md`](offline.md); what belongs here is that
this hook is the **second** path to `PUT demo/v1/leads/:leadId/images`.

⚠️ `utils/uploadQueue.ts` is not the only caller. `useUploadImagesMutation`
(`hooks/useLeadMutation.ts`) is used by `screens/ImageAnnotation/index.tsx` and was sending no
key, so it sat in the backend's "absent key = old behaviour" branch and was unprotected. It now
accepts an optional `idempotencyKey` and forwards it to `LeadService.uploadImages`.

⚠️ **Optional on purpose, but pass it wherever a stable per-image id exists.** Without one, an
upload that times out *after* the server stored the photo is re-sent and stored again — a
timeout tells you nothing about whether the write landed.

⚠️ The key for this path must come from the **rendered output**, not the source photo. See
`offline.md` for why: re-annotating the same photo is a deliberate new upload, and a
source-derived key would silently swallow it. `annotatedPhotoIdempotencyKey` handles this.

⚠️ `JobDocsSection.tsx` also holds a `useUploadImagesMutation()` instance (line ~189) but does
its photo uploads through `uploadQueueManager`. If anything ever starts uploading through that
mutation handle, it needs a key too.

### Follow-up — the SAME gate, the opposite bug: `unknown` unlocked a lead with nothing built

Client, on Android over mobile data: *"even I didn't confirm the rollout price it's allow me to open
the Investment Center."* The screenshot shows the offline banner and the tile reading
*"Checking job status…"* with a spinner, i.e. `gate === 'unknown'` — which deliberately does **not**
lock (see the rule above: *a wrong lock costs a sale; a wrong unlock costs one tap*).

**Why the existing guards missed it.** `isDeviceOnlyLead` already turns an offline-CREATED lead into
a definite `locked`. This lead was different: a real server lead (`SelfGen`, a mongo `_id`) that the
rep had **never opened online**, so nothing was ever cached. `statusAfterFailedRead(null)` → `null`
→ `unknown` → unlocked.

**The rule, narrowed by one axis.** `calcGateState` now takes `isOffline`, and `!status` resolves:

| | nothing cached | cached unconfirmed | cached confirmed |
|---|---|---|---|
| online | `unknown` (unlocks, refetches) | `locked` | `unlocked` |
| offline | **`locked`** | `locked` | `unlocked` |

- ⚠️ **The online half must stay `unknown`.** That is the re-lock fix: a transient read failure on a
  lead whose rollouts the rep really did confirm must not lock the screen in front of a customer,
  and the refetch behind the tap resolves it. Do not "simplify" both halves to `locked`.
- ⚠️ **Offline is different in kind, not degree**: the benefit of the doubt is only worth giving when
  the doubt can still be settled. Offline no later read can arrive, and an uncached lead has never
  shown this device a confirmed rollout.
- `isOffline` comes from `useIsOnline()` in `OperationalSections`, which counts `degraded` as offline
  (deliberate, see `offline.md`) — a one-bar line that cannot complete the read gates the same as no
  line at all.
- Covered by `__tests__/utils/investment-gate-edges.test.ts` (19 cases), which pins **both**
  directions: the three re-lock cases (cached-confirmed, failed-read-with-cache, local confirmation
  outranking a stale read) and the definite negatives, each run online and offline.

## Leaving a lead from a CHILD screen released nothing

`utils/lead-work-session.ts` (`endActiveLeadWorkSession`), `widgets/common/MainHeader.tsx`.
The two calls that end a lead session: the `lead_session` / `session_pause` activity log, and
`PUT lead/v1/{leadId}/work` with `{ workStartedBy: null }` (`LeadService.endWorkLead`).

Reported: both fire when the rep leaves from **Lead Center**, but not when they leave from a child
screen — Deal Center, Job Builder, the Pitch Book — using the header. The lead stayed open on the
server and the rep stayed live on the ops board.

⚠️ **`useFocusEffect` is the wrong lifecycle for "the rep left the lead".** Lead Center registers
its header handler inside one:

```ts
useFocusEffect(useCallback(() => {
  setHeaderActions({ onNavigate: (t) => { pauseLeadSessionRef.current(); navigation.navigate(t); } });
  return () => setHeaderActions({ onNavigate: null });   // <- runs on BLUR, not unmount
}, ...));
```

Opening any child screen blurs Lead Center, so the cleanup nulls `onNavigate` and the header falls
back to a plain `navigation.navigate`. The session is only released if the rep happens to leave
from Lead Center itself.

The fix is in `MainHeader`'s single `onNavigate`, which every header route goes through (home
logo, notification bell, chat). It calls `endActiveLeadWorkSession()`, which reads the session
from **MMKV rather than props**, so it needs no lead object and works from any screen.

⚠️ **Both paths clear the stored session SYNCHRONOUSLY before any await**, which is what stops a
double-send: Lead Center's `pauseLeadSession` (guarded by `hasLoggedPauseRef`) and
`endActiveLeadWorkSession` can both run on the same tap, and whichever is second finds no session
and no-ops. Keep the `clearLeadWorkSession()` call before the `await` if either is refactored.

⚠️ **Fire-and-forget on purpose** — navigation must not wait on two network calls, and a rep
leaving a door often has no signal. The pause log queues offline (`QUEUEABLE_LOG_MODULES` includes
`lead_session`); `endWorkLead` is skipped for a client-id lead, whose queued work carries it.

The back button was already covered: popping Lead Center runs its unmount effect
(`return () => pauseLeadSessionRef.current()`), which fires even when the pop comes from a child
screen further up the stack.

### Follow-up — logout, and the account-popover routes

Two further exits were reported after the header fix.

**Account Settings / Job Tracker / My Learning must NOT end the session.** They are side trips a
rep takes from inside a lead and returns from — part of working it. `AccountPopover` is handed
`MainHeader`'s own `onNavigate`, so an earlier version of this fix ended the session on all three;
corrected to fire only on the home route. The session ends when the rep reaches the lead LIST,
whether they get there from Lead Center, a child screen, or one of these side trips.

**Logout was a real gap.** `useAuth.logout` already called `endInstallerWorkSession('logout')` for
an installer's job but had no equivalent for a rep's lead, so logging out mid-appointment left the
lead open on the server and the rep live on the ops board. `endActiveLeadWorkSession()` now runs
there too.

⚠️ **Ordered BEFORE `setSessionHeader(null)`.** Both the pause log and `endWorkLead` need the
bearer token; moving this call below the header reset makes them 401 silently.

⚠️ **It must never throw** — a failed release cannot be allowed to abort a logout, and a rep often
logs out with no signal. `endActiveLeadWorkSession` catches both calls internally and clears the
stored session first, so an offline logout still ends it locally and
`endStaleLeadWorkSession` tidies the server side on next launch.

⚠️ **The 401 auto-logout path (`services/api/index.ts`) is deliberately NOT wired up.** The token
is already invalid there, so `endWorkLead` would simply 401 again; the stale-session sweep on next
launch is the correct cleanup for that case.

## Three surfaces, three different photo counts

`utils/lead-photo-counts.ts` (the rule), `widgets/components/LeadCenter/JobDocsSection.tsx`.

Reported with a screenshot: the download modal said *"Successfully downloaded all 3 photos"* while
Manage Photos and Download Images both read **(1)** and the progress row read **1/46 slots** — for
the same lead, on the same screen.

Each surface counted a different thing:

| Surface | Counted |
|---|---|
| Manage Photos / Download Images buttons | `filledSlots` — configured slots holding ≥1 photo |
| Progress row "N photos" | slot photos only, with annotated dropped by an explicit `return` |
| Download modal | every image in `sectionImages` — extras and annotated included |

⚠️ **An EXTRA can never raise `filledSlots`** — it has no configured slot to fill. An **ANNOTATED**
photo was skipped outright. Both are real photos the rep took and can see in Manage Photos, so a
rep who added one watched the number stay still and reasonably assumed the app had lost it.

`countLeadPhotos` is now the single rule: every distinct photo counts once, wherever it sits, and
each extra and annotation brings its own slot so the denominator grows with them. One slot photo +
one extra + one annotation on a 46-slot schema reads **3/48 slots · 3 photos**, with **(3)** on
both buttons — matching what Download Images actually saves.

⚠️ **Dedupe by photo identity (`s3url || uri || _id`), never by slot.** A shot lives in both the
server list and the upload queue for one refetch after it lands, and would otherwise count twice —
the same per-slot surplus trap recorded in [`offline.md`](offline.md).

⚠️ **The static (non-dynamic) path had the same annotated exclusion** and was fixed with it. Both
paths now agree.

The info icon left of the row explains why the total moves. It is an **in-card popover, not a
Modal** — this screen already stacks several, and iOS silently drops a presentation requested while
another is dismissing (CLAUDE.md §6).

---

## Ticket — the rep returns to an open lead, but the board shows them paused

Context from the field: a lead stayed **ON SITE** on the ops board after the rep had gone, because
backgrounding or killing the app drops the socket and nothing released the lead. The backend fixed
that half by **pausing the work when the socket disconnects**.

That pause fires on a *plain background* too. A rep who glances at a text and returns five seconds
later is standing at the same door, looking at the same open lead — and the server has them paused.
Nothing re-asserted it: `useLeadCenterData`'s `LeadService.workLead` call is keyed on
`lead._id` / `user._id`, which do not change when the app comes back to the foreground.

`hooks/useResumeLeadOnForeground.ts` (mounted in `screens/LeadCenter/index.tsx` beside
`usePrecacheLeadPhotos`) re-claims it: `PUT` via `LeadService.workLead(leadId, userId)`, then
`SocketManager.joinLeadOnsiteWatch(leadId)` — the pause explicitly left that watch
(`logLeadSessionPause`), so it has to be rejoined. Decision rules are pure in
`utils/lead-session-resume.ts`.

⚠️ **It logs `lead_resume`, never `lead_check_in`.** The rep never left; a second check-in would
double-count the visit.

⚠️ **`inactive → active` is NOT a return.** iOS sends `inactive` for the app switcher, the
notification shade, permission sheets and incoming-call banners. Only `background → active`
counts, or the app fires a resume every time a banner appears.

⚠️ **Only re-claim the lead that is still on screen** (`skip-left-lead`). If the rep backgrounded
on lead A and came back having navigated away, re-asserting A puts them ON SITE at a door they are
not standing at — the exact bug this ticket is about, pointing the other way. The check runs
*before* the duration check so a wrong lead is never re-claimed on a technicality.

⚠️ **The resume is deliberately NOT queued on failure.** Being ON SITE is a statement about *right
now*; replaying it later would put the rep at a door they left hours ago. This is the opposite of
the rule for `endWorkLead`, which **is** queued (`setWorkReleaseQueue`) — releasing a lead late is
harmless, claiming one late is not.

⚠️ This does not conflict with `endStaleLeadWorkSession`: that runs only on **cold launch**
(`useAppInitialization`), so kill-and-relaunch releases the lead while background-and-return
re-claims it.

⚠️ Skipped for an offline lead (`isClientId`) and when offline — there is no server record to
re-claim, and the queued work carries the check-in.

## Ticket — crash on Lead Center while revRender was generating (`next[index]` undefined)

TestFlight crash, 3 devices across 1.1.0 and 1.1.1, reproduced locally: open Lead Center, start a
revRender, watch the strip. The app dies with no JS error in the debugger.

**The stack says JS, not native.** Frames 0-18 are all `hermesvm`, and frame 11 is
`Interpreter::caseIteratorBegin` — the `IteratorBegin` bytecode, i.e. a spread / `for...of` /
destructure. Above the JS boundary sit `RuntimeScheduler_Modern::runEventLoopTick` →
`Task::execute` → `jsi::Function::call`: a **scheduled callback**, not a component render. That
pair (Hermes iterator + no render frames) points at a `setTimeout` continuation, which is what the
revRender batch poll in `hooks/useLeadReports.ts` is.

**Root cause.** `runRender(job, index)` captures `index` in its closure and polls for minutes. Each
state write does `const next = [...prev]` and then `next[index].status = …`. Four of the fourteen
`next[index]` writes had **no `if (next[index])` guard** while the other ten did — guards had been
added only where a crash had previously been seen. When `prev` is shorter than the captured
`index`, the write throws.

`prev` gets shorter three ways, all normal rep behaviour:
- `setRevRenderJobs([])` in `finalizeQueue` — clears the array while other polls are still looping.
- The restore effect (`Storage.getItem('rev_render_jobs_<leadId>')`) replaces the array with a
  persisted one of a different length.
- That effect re-runs on `leadId` change — switching leads swaps the array under in-flight polls.

Fixed by guarding the four writes (`'running'` start, the no-`batchId` completion, the batch-done
completion, and the `catch` failure) exactly like their neighbours.

- ⚠️ **Why nothing appears in the debugger.** The throw is inside a React state updater passed to
  `setRevRenderJobs`, which runs outside the poll loop's own `try/catch (pollErr)`. It is not a
  catchable JS error at that point — it aborts the VM, so the console stays empty and only the
  native crash log survives. Do not conclude "no error in Metro" means "not a JS bug".
- ⚠️ **Never dereference `next[index]` unguarded in this file.** Any new state write in `runRender`
  needs the same guard; the array can always be shorter than the closure's `index`.
- ⚠️ The file is CRLF.
- Fix verified statically; the crash path itself was not re-run on device from this session.

### Follow-up — why the guard is safe (asked before merging)

Checked explicitly, because a skipped state write looks like it could strand a batch or disturb the
offline queues. It cannot:

- **The in-range path is unchanged.** Running the old and new updater side by side on an in-range
  `index` gives byte-identical output. The guard only engages where the old code threw, so there is
  no working behaviour to regress.
- ⚠️ **Completion does NOT depend on these writes.** `completedCount` is a closure variable
  incremented *before* each `updateJobStateAndPersistence` call, and `finalizeQueue()` fires on
  `completedCount === total`, never on array contents. A skipped UI write cannot leave a batch
  hanging — do not "simplify" this by deriving completion from `revRenderJobs`, which would couple
  it to exactly the array that can be cleared mid-poll.
- **No offline coupling.** `useLeadReports.ts` imports nothing from the offline system (no
  `offline*`, `uploadQueue`, `connectivity` or `session-scope`). It owns `risk_job_<leadId>` and
  `rev_render_jobs_<leadId>` in MMKV, and neither key appears in `utils/session-scope.ts`, so
  neither is in a queue, a drain order, or the logout-survival list.
- **Consumers are index-safe.** `OperationalSections` reads the array only through `.some()`,
  `.reduce()`, `.length` and `.map()`, with a `revRenderJobs = []` prop default. Nothing indexes
  into it, so a shorter array renders correctly.

### Follow-up 2 — the real hole: "never asked" was being read as "don't know"

The `isOffline` narrowing above was not enough. Client, on **mobile data, iOS TestFlight**: *"even
though I created the new lead, opened the lead center, somehow I am able to open the Investment
Center even I didn't confirm the rollout price"* — repeatedly.

**Why the offline rule missed it.** Mobile data is **online**, so `isOffline` was false. The lead is
a real server lead, so `isDeviceOnlyLead` was false. `useLeadCalculatorStatus` seeds `initialData`
from the MMKV cache, and a brand-new lead has nothing cached — so the first render has
`data === undefined` while the read is still in flight. That fell through to `unknown`, which does
not lock, and the rep could tap through **before the first answer ever arrived**.

**The distinction that was missing.** `unknown` conflated two different situations:

| | meaning | deserves benefit of the doubt? |
|---|---|---|
| asked, reply lost | the rep may well have confirmed | **yes** — a wrong lock costs a sale |
| never asked | no answer has ever arrived for this lead | **no** — there is no evidence of anything |

`calcGateState` now takes `hasAnswered` (TanStack `isSuccess` from the hook). With no status:
`!hasAnswered` → `locked`; otherwise the `isOffline` rule above applies.

- ⚠️ **`hasAnswered` is about the READ, not the data.** A successful read that says "no calculators"
  sets it true and produces a definite `locked` through the normal path. It must come from
  `isSuccess`, not from `!!data`.
- ⚠️ **The default is now SAFE**: `calcGateState(undefined)` with no options returns `locked`, not
  `unknown`. A new call site that forgets to pass `hasAnswered` fails closed.
- ⚠️ The re-lock ticket still holds and is pinned by tests: asked-before-and-lost stays `unknown`
  online, a confirmed cache unlocks offline, and a local confirmation still outranks a stale read.
- ⚠️ **TestFlight builds lag the branch.** The first `isOffline` fix was not in the build this was
  reported against; check the build's commit before concluding a gate fix did not work.
- `__tests__/utils/investment-gate-edges.test.ts` — 26 cases across `{status} x {offline} x
  {answered}`, pinning both directions.

### revRender runs appearing on a lead that never had any (the READ side)

> Screenshots: Job Docs showing **"0/46 slots · 0 photos"**, and revRender on the same lead
> showing **"13 Runs"** with other leads' images.

⚠️ **This is NOT the same bug as the attribution fix** recorded under `useLeadReports`
(`renderTargetLeadId`). That one fixes which lead a render is filed against when it is
GENERATED. This one is which runs a lead DISPLAYS when read back — the earlier fix could not
have addressed it, so "already fixed" was wrong.

Two independent causes, both now closed, in `utils/revrender-attribution.ts`:

**1. ⚠️ A device-only lead asked the server about itself.** An offline-created lead's `_id` is
a client id (`lead-1760...`). `useRevRenderRunsQuery` was `enabled: !!leadId`, so it still sent
`GET /rev-render/v1/runs?leadId=lead-1760...`. A server that ignores or fails to match an
unknown `leadId` answers with *something*, and whatever came back was rendered as this lead's
history. **The lead cannot have server-side runs, so the request must not be made at all** —
`canFetchRenderRuns(leadId)` now gates both `enabled` and the `queryFn`.

**2. ⚠️ Nothing verified that a returned run belonged to this lead.** `buildRevRenderPairs`
(`OperationalSections.tsx`) **drops each run's `leadId`** while mapping, so a bad response could
not be detected downstream — and `cachedFetch` then wrote it into
`offline-cache:revrender-runs:<leadId>`, where it survived restarts. `runsBelongingToLead` now
filters **inside the `queryFn`, before the write**, so the cache cannot be poisoned.

⚠️ **A run with NO lead id is KEPT.** Older runs predate the field and dropping them would
silently erase real render history — the opposite failure and the harder one to notice. Only a
run that positively names a *different* lead is rejected.

⚠️ **`orderedRuns` filters a second time on purpose.** A cache written before this fix still
holds another lead's runs on real devices, and a device-only lead must show none whatever is on
disk. Since `buildRevRenderPairs` discards `leadId`, that memo is the last point where
ownership can still be checked. Do not "simplify" it away as redundant.

The other two consumers (`DynamicDealCenter/components/RevRenderSlots.tsx`,
`InvestmentCenter/InvestmentPanel.tsx`) go through the same hook and are covered by the
query-level guard; they need no filter of their own.

### Inspection photos: a stuck spinner, and a count that goes backwards

> "Back was uploaded before and the loader is still showing... sometimes the loader keeps
> showing even though it will be done."
> "During uploading the number changes - I uploaded 4 images, during uploading it becomes 3,
> and then after a second it becomes 4 again."

⚠️ **One shape of bug behind both: the count and the spinner are each derived from two sources
that briefly disagree** — the server's `salesPhotos` and the device upload queue. On Wi-Fi the
disagreement lasts milliseconds; on 4G it is long enough for the rep to watch. Rules and 20
tests in `utils/photo-upload-progress.ts`.

**The stuck spinner.** `uploadingKeys[key]` (`useDynamicInspectionCapture.ts`) is an optimistic
flag set at capture, and it was cleared in exactly **one** place: the effect keyed on
`salesPhotosSignature`. If that refetch returned stale data, failed, or the photo came back
under a slightly different subcategory, the signature never changed and **nothing else ever
cleared the flag** — the slot span for the rest of the session.

⚠️ **A spinner must never depend on a single success path.** The queue listener now clears the
flag too: an item that has left the queue is not uploading, whatever the server says. Both
paths clear it and neither is required. ⚠️ That effect must stay **below** the
`uploadingKeys` / `pendingUploadKeyRef` declarations — it calls `sync()` synchronously on
mount, so placed above them it throws on the TDZ, and tsc does **not** catch it.

**The count dip.** `dynamicCounts` (`JobDocsSection.tsx`) is `server photos + queued items`.
The queue item is dropped the instant its PUT resolves; the server list only changes when a
refetch lands. In between the photo is in **neither** set and the number falls.

Two complementary fixes — ⚠️ they are not alternatives:

1. `uploadQueue.ts` **awaits** `refetchQueries` before `removeItem`. ⚠️ Do not make this
   fire-and-forget to "speed up the drain" — the await *is* the fix.
2. A refetch can still resolve without the new row (read-after-write lag), so the manager
   records `recentlyCompleted` slots and `dynamicCounts` counts them as `settling`.
   ⚠️ Recorded **before** `removeItem`, because `removeItem` notifies listeners and one
   running in between would see the very dip being fixed. ⚠️ A settling slot stops counting as
   soon as the server row appears, or the count flickers *upward* instead, and it is bounded
   by `RECENTLY_COMPLETED_TTL_MS` so a row that never arrives is not claimed forever.

⚠️ `countInFlightPhotos` dedupes by **slot**, so a queued item and its server row during the
overlap are one photo. A monotonic-sequence test asserts the count stays 4 through all six
stages of the handover — that is the regression to protect.

### Follow-up - "Photo tagging needs to sync first" uses the app's dialog (2026-10-16)

The offline notice for a lead whose photo categories were never downloaded (`inspectionSchemaUnavailable`) was a native `Alert.alert`, which
ignores the app theme. `widgets/components/LeadCenter/JobDocsSection.tsx` now shows `DynamicDealCenter/components/ConfirmDialog`
(`tone="warn"`, `hideCancel`, `confirmLabel="OK"`) from `showSchemaSyncNotice`, raised by both `handleStartTakingPhotos` and `openLegacyTagModal`.

- ⚠️ `ConfirmDialog` is its own native `Modal`: raise it only when no other modal is presenting (CLAUDE.md §6, never stack native Modals).
  Both call sites run before the tag / capture modal opens and return straight after.
- Other `Alert.alert` calls in this file (delete failed, permission denied, no photos...) are still native.

### Follow-up - photo-delete log uses `meta.occurredAt` (2026-10-16)

`widgets/components/lead-center/useDynamicInspectionCapture.ts` (the `deleted_image` log, module `inspection_photo` / `annotated_photos`) wrote the
photo's capture time as `meta.timestamp`. Every activity log now carries ONE action-time key, `meta.occurredAt` (see `docs/claude/offline.md`), and a
delete's action time is when the rep deleted it, so it is now `new Date().toISOString()` under `occurredAt`. `imageData.timestampTaken` still
holds the photo's own capture time.

- ⚠️ Do not put the capture time back into the log's time key: the portal reads `occurredAt` as "when this happened".


## REVUIUX-559 - Image Annotation: shapes (arrow / line / circle / box) + two export bugs

Ticket: *"Add in shape functionality - where I can adjust size and color: arrows, straight lines, circles, squares/rectangles."* New **Shapes** tool beside Zoom / Draw / Text (`screens/ImageAnnotation/index.tsx`, `widgets/components/LeadCenter/AnnotationCanvas.tsx`, pure maths in `utils/annotation-shapes.ts`, tests `__tests__/utils/annotation-shapes.test.ts`).
- **Model:** `AnnotationShape { id, kind, p1, p2, color, width }`, points NORMALISED like strokes/texts. Circle = centre `p1` + an edge point `p2` (a true circle; radius in px from the canvas aspect). `shapesMap[photoId]` sits beside `strokesMap` / `textsMap`.
- **Drawing / editing** (all in the existing PanResponder, so zoom correction `dx / zoomScale` and Zoom-mode gesture isolation are unchanged): drag on empty canvas draws; a NEW shape is auto-selected; touching a selected shape's end HANDLE resizes it, its OUTLINE moves it (interiors are deliberately not hit, so a box can be drawn inside another); a tap selects the shape under the finger or clears the selection (a drag shorter than `MIN_SHAPE_DRAG_PX` never leaves a zero-size shape). Colour / size buttons set the next shape's defaults AND restyle the selected one; **Delete shape** removes it. The toolbar width was re-budgeted (tool buttons `w-12`, undo group `w-10`) so four tools + undo/redo/reset fit a 402pt phone.
- **Undo/redo:** history entries `{ type: 'shape', id, before, after }` (add = before null, delete = after null, restyle/move/resize = both) via `commitShapeChange`; `applyShapeChange` keeps draw order. ⚠️ **Cancel (X) restores shapes AND the pre-mode history/redo stacks** - Draw's cancel does not do this for its history; do not "align" Shapes down to it.
- **Live preview** goes through a ref + one rAF push (`subscribeLiveShape`), like the pen, so a drag never re-renders the screen. Handles are drawn at constant on-screen size (`8 / zoom`). The text-note layer is `pointerEvents="none"` in Shapes mode so a drag starting over a note still draws.
- **Export** (hidden WebView): shapes are drawn after the ink and before text. ⚠️ **The arrow-head maths is duplicated in the WebView script string** (a function can't be shipped - Hermes has no source text); `arrowGeometry` in the util is the reference, change BOTH. The script is inside a template literal: no backticks or `${` in it.
- **Two pre-existing export bugs fixed while verifying "everything works":** (1) the **eraser** used `destination-out` on the PHOTO canvas, punching transparent holes in the picture (JPEG = black) instead of rubbing out only the pen marks as the preview does - ink is now drawn on its own offscreen layer and composited; (2) **text `fontStyle` and `opacity` were never sent** to the WebView, so Bold / Italic / Opacity set in the style panel were flattened to regular, opaque text in the saved photo. Both now sent / honoured.
- Save All, the unsaved-changes prompt and Reset all count / clear shapes. Not done: filled shapes, rotating a shape, shapes on the classic (non-dynamic) photo flow beyond what shares this screen. Not verified on device - needs a check that the saved JPEG matches the preview for each kind, with and without zoom.


## REVUIUX-558 - Re-edit an already-annotated photo (in place)

Ticket (Lance): *"Not letting me annotate an existing annotated photo. I know on web we had this worked out."* One annotated photo per base photo, but it must be re-editable. **No backend change** - these endpoints already exist and the web app uses them. Files: `utils/annotation-restore.ts` (pure, tests `__tests__/utils/annotation-restore.test.ts`), `services/api/leads.ts`, `screens/ImageAnnotation/index.tsx`, `widgets/components/lead-center/DynamicManagePhotosView.tsx`.
- **Endpoints:** `GET demo/v1/leads/:id/annotations` (`{ data: [{ salesPhotoId: <annotated copy _id>, annotationData }] }`) and `PATCH demo/v1/leads/:id/images/:annotatedId/annotation` (multipart `file` + `annotationData` JSON) which OVERWRITES the annotated image in place. New annotations still `PUT images`, now with the web's `annotations` field (`[{ salesPhotoId: <original _id>, annotationData }]`, aligned with `images`).
- **Mobile's own JSON.** The backend stores `annotationData` opaquely; web writes Konva JSON. Mobile writes `{ format: 'revdsm-mobile-annotation', version, originalId, strokes, texts, shapes }` (normalised points, as on screen). ⚠️ The `format` marker is how the two are told apart - do not drop it. A mobile doc restores editable marks over the CLEAN ORIGINAL; a web doc / no doc / missing original falls back to drawing on top of the flattened annotated copy (old marks cannot be edited there). Web cannot restore a mobile-written doc either - unverified whether it errors; check on the web app.
- **Flow:** in Manage Photos select mode the "+ ANNOTATED" cards are now selectable; the BASE photo stays locked (`alreadyAnnotated`), which keeps one annotated photo per base. `openAnnotationForSelection` hands the screen `existingAnnotationId`, `salesPhotoId`, `initialMarks`, `staleUris`. Original is found by the doc's recorded id, else the single non-annotated photo with the same category + base subcategory (`findOriginalPhoto`).
- **Screen:** seeds `strokesMap/textsMap/shapesMap` from `initialMarks`; `seededMarks.count` is the "unchanged" baseline so opening a photo is not "unsaved work". A re-edit is saved only if touched (counts differ or undo history non-empty) - and still saved if every mark was removed (that restores the clean photo). Re-edits PATCH (no idempotency key: a replay writes the same bytes), new ones PUT.
- ⚠️ **Stale cache after an overwrite:** the s3url and file name do not change, and `getLocalCachePath` ignores the query string, so the old bytes would keep showing. The screen calls `forgetWarmedUri` on the annotated copy's url and invalidates `['secureUrls']` + the lead.
- Not done / not verified: the classic (non-dynamic) `ManagePhotosModal` flow is untouched; restored text / stroke sizes are in px so a different screen size draws them proportionally off; offline re-edit fails with a flash (annotation saves were never queued). Needs a device check: annotate -> re-open -> marks restored -> move/delete one -> save -> same single photo updated, no duplicate.

- **Follow-up - only the latest annotated copy shows.** Device test: after a re-edit "+ ANNOTATED" listed TWO Front-Right cards, the older one failing to load ("Tap to retry"). `getAnnotatedFor` (`useDynamicInspectionCapture.ts`) now passes through `latestAnnotatedPerBase`: one annotated copy per category + base subcategory, newest `timestampTaken` (later row on a tie / unknown time). ⚠️ This HIDES the stale row, it does not delete it, and the cause is unconfirmed - if the PATCH really leaves a second row on the server (or moves the s3url and orphans the old one) that is backend behaviour to check; the web app would show the same duplicate. Do not "fix" it by deleting rows client-side without that answer.
