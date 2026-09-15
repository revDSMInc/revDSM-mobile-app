# Installer app (My Installs, job steps, CoC)

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/Installer/**`, `widgets/components/installer/**`, `widgets/modals/installer/**`, `services/api/installer.ts`, `utils/installer-*.ts`.
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## CoC Paper Fallback scans upload under `phase: 'cocPaperFallback'`

Ticket: the paper-fallback upload should use `PUT /installer/v1/{jobId}/images` with
`phase=cocPaperFallback`. The endpoint and method were already right (`IMAGE_UPLOAD_METHOD` is
`'put'`), so the whole change is the phase.

- `'cocPaperFallback'` added to `InstallerImagePhase` (`config/types/installer.ts`) and to
  `PHASE_ARRAY_KEY` (`services/api/installer.ts`), where it maps to **`installerCocPhotos`** — the
  array `installer-hydrate` already reads, so a scanned page still comes back onto the step.
  `InstallerDeletePhase` is derived from the union, so the delete route inherits it (no CoC delete
  call site exists today).
- `useInstallerPhotoUpload.uploadCoc` sends the new phase; **`uploadCocSignature` stays on `'coc'`**.
  That split is the point of the ticket: the phase is now what tells a SCANNED paper certificate from
  one SIGNED on the device. Both still send `subcategory: 'coc'` (`cocDescriptor` is shared), so
  within a phase only the file distinguishes them, exactly as before.
- ⚠️ `uploadCoc` is reached ONLY from the Paper Fallback pill — `CoCStep.startScan` has no other
  caller (`handlePaperFallback` is its one entry point, by design: *"its only entry point is the
  form's own Paper Fallback pill"*). That is what makes retagging the whole function safe.
- ⚠️ **The BACKEND does not know this phase yet.** `InstallerHandler.uploadJobImages` normalises the
  form field through a ternary chain whose fallback is **`'pre'`**, so until it learns
  `cocpaperfallback` the scans land in `installerPreInstallPhotos` and vanish from the CoC step.
  Ship the backend arm first, or with this.

### …and a scanned certificate now FILLS THE FORM

Ticket: *"when user scan the paper than the backend provide the JSON response against the paper
scan… place the value directly to the boxes according to the JSON response. make sure in the case of
paper Scan the Job number and date also get from the paper, and if user add the details directly than
the date and job number should be getting Automatically."*

The scan already went up under `phase: 'cocPaperFallback'` (above) and the response was thrown away
past its `s3url`. It now carries the certificate the backend read off the page, and that reopens
`CoCFormModal` with the paper's own values in it.

**The chain, one link per file:**

| where | what |
|---|---|
| `utils/installer-coc-scan.ts` (new, pure) | `extractCocScanFields(body)` → `CocScanFields \| null` |
| `services/api/installer.ts` | `normalizeImageUploadResult` runs it — **gated on the phase** |
| `utils/installer-upload.ts` | `UploadOutcome.scan` |
| `hooks/useInstallerPhotoUpload.ts` | `run` now resolves to **`{ patch, scan }`** (`InstallerUploadResult`) |
| `screens/Installer/JobDetail.tsx` | `handleCocPage` RETURNS that read |
| `steps/CoCStep.tsx` | awaits it, holds it in `scannedFields`, reopens the form |
| `modals/installer/CoCFormModal.tsx` | new `scanned` prop seeds every box |

⚠️ **`run`'s return type changed** — it was the patch, it is now `{ patch, scan }`. Its one consumer
that reads the value (`handleCocSignature`) takes `result?.patch`; every other caller ignores it.

**Job # and Date.** Both stay READ-ONLY; only their SOURCE changed. A scan wins
(`scanned?.jobNumber || job.jobNumber || …`, `scanned?.date || todayMMDDYYYY()`), because the paper
carries its own number and its own date and the customer has already signed against them. Typed in
directly, nothing is scanned and both are derived exactly as before — which is the second half of the
ticket, and needed no change.

⚠️ **`??`, not `||`, on the three tick boxes.** A box the page reports as UNTICKED is `false` and must
stay unticked; `||` would fall through to the filed certificate and tick it back on — an attestation
nobody made. `undefined` (the page did not say) is the only case that falls through.

### ✅ The live response — and the reason NOTHING was populating

A device trace (`PUT installer/v1/{jobId}/images`, 2026-08-31) settled both halves. The extraction
arrives as **`data.extraction`**:

```json
{ "jobNumber": "090078601", "date": "31-8-2026",
  "homeowner": false, "spouse": false, "other": true, "relationToHomeowner": "Brother",
  "age18OrOlder": true, "homeownerOrAuthorized": true, "installationStatusCompleted": true }
```

⚠️ **THE BUG WAS UPSTREAM OF THE EXTRACTOR: this response carries NO `appended` array.** It answers
with ONE image on `data` itself — `s3url` / `bucketName` at the root plus a `data.cocPaperFallback`
block — while `normalizeImageUploadResult` only ever read `data.appended`. So
`uploadInstallerPhoto` read `appended[0]` as undefined, declared a perfectly good upload **FAILED**,
flashed *"Couldn't upload page 1 of the CoC"*, stored no `s3url` on the page (nothing for the
step-data PATCH to reference) — and the hook's failure branch returns `null`, which threw the
certificate away with it. `normalizeImageUploadResult` now synthesizes the single row when there is no
`appended`. ⚠️ It takes the id from the `data[phase]` block, **never `data._id`** — on this shape that
is the JOB's id, and storing it as the image's `serverId` would point every scanned page at the job.

Three key-name corrections fell out of the same payload — `age18OrOlder`, `installationStatusCompleted`
and `relationToHomeowner` were all absent from the lists, so three of the six boxes would have stayed
empty even once the read arrived.

⚠️ **The relationship is THREE TICK BOXES, not a word** (`homeowner` / `spouse` / `other` + the
`relationToHomeowner` write-in). The boxes win over the word; at least TWO of the three must be present
as booleans before any is read, because `other` on its own is far too common a key to treat as an
answer to "who signed"; and `relationshipOther` is only ever set for `other`, so a name cannot ride
into the payload on a homeowner certificate.

⚠️ **`31-8-2026` is DAY-first.** The extraction hyphenates and writes the day first, while a SLASHED
date is the US month-first form this app prints everywhere else — so the separator decides, and a
component over 12 settles it either way. Reading it month-first turns 31 August into an invalid month
(the old rule produced `31/08/2026`).

The extractor still reads FIXED key lists out of a bounded breadth-first walk, the same discipline as
`readDocumentGroup`: nothing is guessed, an unknown shape yields `null`, and the step then behaves
exactly as it did before this existed — pages filed, result screen, no form.

⚠️ **`jobId` / `_id` / `leadId` are deliberately NOT job-number keys**, and `installDate` is not a date
key. This endpoint's response root carries the job's mongo id, and a 24-character id in the Job # box
would look plausible enough to file.

⚠️ **The date is parsed as TEXT**, never through `new Date(...)` — an offset ISO string shifts the
calendar day either side of midnight, and this is the date on a signed document (the rule
`utils/job-change-summary.ts` records).

⚠️ **The FIRST page that reads back a certificate wins.** A multi-page scan is one document and the
fields sit on the page carrying the signatures, so a later page that read nothing must not blank it.

⚠️ **The two SIGNATURES are still required to submit.** The paper's signatures live in the scanned
image, and nothing weakens `canSubmit` — a legal control was not loosened on the way past. If the crew
should be able to submit a scanned certificate without re-signing on the device, that is a deliberate
change to `canSubmit` and needs asking for.

The read is a round trip behind the scanner closing, so the step raises a small blocking
**"Reading the scanned certificate…"** card (`installer.cocReadingScan`) while it runs — the form is
down at that moment and the crew would otherwise have no reason to think anything was still happening.
`logCocFormOpened` gained a `'scan'` source so the portal can tell that open from the other three.

### …and once it is SUBMITTED the step shows the PDF, not the form

Ticket: *"when the installer submit their COC form than we receive the updated PDF document in the
response after submit. when user reopen the tab than there is no option to edit the form once
submitted — after submission you can use the pdf from the response and display that pdf in the COC
tab."*

`PATCH installer/v1/update/{jobId}` (`stepData.coc`) answers with the generated certificate, and the
CoC step now renders it: a green **Certificate submitted** card holding the document, tap to open it
full screen in the app-wide `PdfPreviewModal`, and **no way back into the form**.

| where | what |
|---|---|
| `utils/installer-coc-pdf.ts` (new, pure) | `extractCocPdf(raw)` → `JobPacket \| null` |
| `services/api/installer.ts` | `normalizeInstallerJob` → **`job.cocPacket`** |
| `screens/Installer/JobDetail.tsx` | `sendStepData` now RETURNS the patched job; `handleCocSignOff` stores the document on the sign-off |
| `steps/CoCStep.tsx` | new `document` prop — the PDF card, and the edit button gone |

⚠️ **`sendStepData`'s return type changed** — it was `void`, it is now `Promise<InstallerJob \| null>`
(`null` for every path that did not reach the server: no job, empty patch, unchanged step, or a
failure, which is reported to the installer rather than thrown). Nothing else reads it.

⚠️ **The document is stored on `CocSignOff`, not only on the job.** Progress is persisted, so it
survives a relaunch and a job re-fetched from the LIST — which does not carry the certificate. The
step reads `progress.cocSignOff?.document ?? job.cocPacket`, device copy first. It is written from the
`signOff` object that was just filed, never re-read from progress, so the two cannot drift.

⚠️ **`submissionPdf` is NOT a certificate key, and the generic names (`pdf`, `document`, `url`) are
only read inside a `coc`-scoped container.** The rep's job packet lives on the same job; showing it as
the certificate the customer signed would be a plausible-looking lie rather than a visible failure.

⚠️ **`url` is classified, not assumed.** This API puts a bucket-relative KEY in a field called `url`
(`submissionPdf.url`), so a value is only treated as ready-to-open when it actually starts `http`.
Handing a key to the PDF viewer draws a blank sheet instead of failing.

⚠️ **The inline preview is `pointerEvents="none"`.** `react-native-pdf` handles its own pan and pinch,
and inside the step's `ScrollView` the two fight — the tab stops scrolling past the document. Deaf to
touch it is a picture, and the press wrapping it opens the real viewer.

⚠️ **The edit button is hidden on the DOCUMENT, not on the sign-off.** A submitted certificate whose
PDF could not be read (an older job, or a deployment that does not generate one) keeps the button —
hiding it there would leave the crew a step with nothing on it. Gate it on `signOff` instead if the
rule is meant to hold even with no document.

⚠️ **The response's key name is NOT confirmed against a real submit.** The reader walks a FIXED list of
containers and key names, the discipline `readDocumentGroup` sets, so an unrecognised payload yields
`null` and the step behaves exactly as it did before — signed card, edit button. Pin the list against a
captured response before calling this done.

### ⚠️ iOS: Paper Fallback froze the app — never present the scanner mid-transition

Ticket: *"the paper fallback is not working on the IOS device, it works on the android perfectly. when
we click on the paper fallback from the IOS device it blocks me and stuck the whole app."*

`RNDocumentScanner.scanDocument` presents VisionKit on **`RCTPresentedViewController()`** with a bare
`self.viewController?.present(...)` and **no error path** (`node_modules/react-native-document-scanner-plugin/ios/DocumentScanner.swift`).
So a presentation UIKit refuses calls NONE of its three handlers — not success, not error, not cancel —
and the JS promise **never settles**.

`handlePaperFallback` used to `setShowForm(false)` and call the scanner in the same tick, which asks
iOS to present while `CoCFormModal` is still dismissing. UIKit drops exactly that case, so the scanner
never appeared, the `await` never returned, and the step was left with NO surface on screen: the
sub-screen is gated on `hasResult`, which is false on a first scan. Android launches an Activity, which
has no such rule — hence "perfect on Android".

**The form now STAYS UP across the whole scan.** Nothing is transitioning when the scanner is asked
for, on either platform, and the scanner covers the form while it runs. On the way back:

| outcome | what happens |
|---|---|
| pages + a certificate read | `openForm('scan')` — REMOUNTS the form (bumps `formSession`) without closing it, so the values appear in a modal that never went away |
| pages, nothing read | `setShowForm(false)` → the result view, as before |
| cancelled, something already captured | `setShowForm(false)` → the result view |
| cancelled, nothing captured | the form stays exactly as it was |

⚠️ **There is no dismiss/present PAIR left anywhere in this flow**, and that is the point — not the
platform branch it replaced. Do not "tidy" this by closing the form first again.

⚠️ **The "Reading the scanned certificate…" indicator is no longer a `Modal`.** It was a third native
modal raised over the step's own, which is the same hazard on iOS and is against this repo's standing
rule (the signature pad and the exit prompt in this very file are in-card overlays for that reason).
It is now `CoCFormModal`'s **`busyLabel`** prop — an absolute overlay inside the card, carrying the
`zIndex` + `elevation` pair the note on `sigOverlay` explains.

⚠️ Still outstanding, same class: the certificate `PdfPreviewModal` in `CoCStep` is a native modal
rendered while `InstallerSubScreen`'s own modal is up. It is only reached by tapping the document card,
so it is not in this ticket's path, but on iOS it is the same shape of risk — hoist it to `JobDetail`
if it ever misbehaves.

## Pre-install: the big pane shows the INSTALLER'S shot once there is one

Ticket: *"inside the pre install phase… first time when user open the pre install phase and there is no
image from the sale side then show the house placeholder, and when installer click the image then show
that image on the front screen… if the pre install received images from the sale side then show that
image on the front screen unless installer not capture the image; when user capture the image then
show that image on the front, and when user click on tap to review the flow should be the same for the
image comparison."*

`PhotoMatchStep`'s hero pane rendered `selectedRef` — the REFERENCE — and nothing else, so a tag kept
showing the rep's sale photo (or the line-art house) even after the installer had shot it. The only
place their own shot appeared was the review modal.

One expression now decides the pane:

```ts
const capturedUri = selected ? matched[selected.id]?.uri : undefined;
const heroUri = capturedUri ?? selectedRef;   // own shot › reference › HouseGhost
```

| state | pane |
|---|---|
| no rep photo, nothing shot | `HouseGhost` (unchanged) |
| rep photo, nothing shot | the rep's photo (unchanged) |
| shot taken, either way | **the installer's own photo** |

⚠️ **The chip had to follow.** It read `REP PHOTO • Back-Left` over whatever was on screen; showing the
installer's own work under that label tells them their shot IS the reference they are supposed to be
matching. New `installer.yourPhoto` (`YOUR PHOTO` / `TU FOTO`) is used whenever `capturedUri` is set.

⚠️ **Nothing about the review or the re-shoot changed**, which is the ticket's own requirement:
`MATCHED — tap to review` still opens `ReviewPair` with `referenceUri(tag)` beside the shot, and the
ghost camera still ghosts against `referenceUri` — so the comparison is against the rep's photo exactly
as before. Only the resting pane moved.

⚠️ **This applies to the POST pass too**, deliberately — the rule is written on `capturedUri`, not on a
`phase` branch. Post ghosts against the installer's own pre-install shot, so the same sentence describes
it: the reference holds the pane until there is a shot. Gate it with `phase === 'pre' &&` if it is ever
wanted on pre only.

## Pre-Install references drop the rep's ANNOTATED copies

Ticket: *"inside the installer when user open the lead and go to the step pre install photos, at that
point show us only actual photos — if any photo is having the Annotated tag then don't show that
photo."*

`RepPhoto` has declared `isAnnotated?: boolean` since the type was written and **nothing ever read
it**, so an annotated row went into the tagger like any other. `repPhotoOf` took the first non-installer
photo in the slot, and the annotated copy is filed AFTER the shot it marks up — so whenever the rep
annotated a photo, its marked-up duplicate became the reference and the crew was asked to ghost-match
against arrows and circles drawn over the house.

**New `isAnnotatedRepPhoto` + `actualPhotosOf` in `utils/installer-photo-sections.ts`**; `repPhotoOf`
and the `reference` fallback both read the filtered list.

⚠️ **Three spellings, because three parts of the app write it**: `isAnnotated: true` (what the installer
payload declares), `category: 'annotated'`, and a `"<slot> (Annotated)"` subcategory — the latter pair
is what `screens/ImageAnnotation` files its copy under, and what `utils/inspection-photos.ts` and
`screens/RevRender` already exclude on. `RepPhoto` declares neither of the last two, so they are read
off the raw row.

⚠️ **`category` must EQUAL `annotated`, not merely contain it** (the subcategory test is a `includes`
on the parenthesised suffix). A real category could legitimately be named for what it documents —
"Annotated Damage Notes" is a photo of a house, not a markup layer. Tested both ways.

⚠️ **The fallback is filtered too.** `reference = rep ?? actualPhotosOf(slot)[0]` — a slot the rep
skipped, whose only other row is a marked-up duplicate, still has no reference to pair with, and the
`repPhotoId` the matched shot uploads under must never be the annotated row's.

⚠️ A slot holding ONLY an annotated copy now reads as a slot the rep never shot, so its category is
omitted entirely (`buildRepPhotoSections` already skips a category with no rep photo in it). That is
the same treatment a skipped category gets and is deliberate — there is nothing to match against.

## The install-request status moved onto the ACTION BUTTON, and greys the whole card

Ticket: *"these status are shown on top on the installer side but we need to show these status on the
button instead of shown on the top … you can display these status on the button where we currently
show the location icon Resume Appointment"*, then five corrections — *"also pick the colour of the text
for the button"*, *"the button should not be transparent type, the button's look should be same as the
previous"*, *"lead card color, button and the text colour should be same according to the status text
colors"*, *"use the same colour for the card that is used for the RESULTED lead — no need to use the
yellow, blue and other colour"*, and finally, against a resulted card, *"the can't do work status is
still displayed on the top instead of shown on the button"*.

`InstallerJobCard` rendered `installStatusPhrase(job)` as its own chip row above the Lead ID and the
button as `📍 Resume Appointment`. The phrase is now the button's LABEL, **the chip row is gone
entirely**, and the card wears `JOB_CARD_COLORS.RESULTED` grey while it carries one.

| | before | now (phrase present) |
|---|---|---|
| chip row above Lead ID | always, when a phrase exists | **never — removed** |
| button | `📍 Resume Appointment` | `Pending Install Reset` — solid, white label, no pin |
| button, RESULTED job | `Resulted - Cant Do Work!` | `Install Can't Do Work` — the phrase wins |
| border / wash / arrival time / address pin / button | `state.color` (green resume, orange start) | **`#9e9e9e`** |

⚠️ **The row was not free.** "Pending Install Can't Do Work" is nearly thirty characters, which is why
the chip needed a row of its own rather than the arrival-window slot — so removing it takes a whole row
off a card that already carries five, and the button gives the phrase the full width the chip was
competing for.

### A RESULTED job is no exception — `workflowState` outranks the outcome label

The chip first survived there, on the reasoning that a resulted button is spoken for by its outcome —
and that is precisely the card the reporter came back on: an `INSTALL CAN'T DO WORK` chip sitting
directly above a `Resulted - Cant Do Work!` button, the same sentence twice. Then, on the follow-up
(*"get the button status from this object — `workflowState: "Install Can't Do Work"`"*), the phrase was
made to win the BUTTON on those cards too.

So `showPhraseOnAction` is **`!!workflowPhrase && !loading`** — no `!resulted` arm — and such a card
reads `Install Can't Do Work` rather than `Resulted - Cant Do Work!`.

⚠️ **The two labels are not interchangeable.** The phrase is composed SERVER-side from where the
*request* has got to; `resultedActionLabel` is derived HERE from `job.status`. Dropping the
`Resulted - ` prefix loses nothing, because the card already carries the **RESULTED** badge top-right.

`resultedActionLabel` still answers every resulted job carrying no phrase, which is most of them —
`installStatusPhrase` returns null for a `resulted` `workflowState`.

⚠️ **The card's resulted TREATMENT is untouched by this.** Its `#F4F6F8` ground, `0.85` opacity and the
RESULTED badge are all still keyed on `job.resulted`, not on the phrase — only the button's words
change. And `accent` is the same grey either way, since `state.color` for a resulted job already IS
`JOB_CARD_COLORS.RESULTED`.

`showPhraseChip` and the whole `workflowPhraseColor` helper went with the chip; the top-right
**RESULTED** badge is a different element and is untouched.

### The colour: one grey, not three tones

`accent` is now `showPhraseOnAction ? JOB_CARD_COLORS.RESULTED : state.color`, and every consumer
follows for free — border, the `+ '1A'` wash, the arrival time, the address pin, `actionBg`/`actionFg`.

⚠️ **Four designs were sent back getting here. Do not re-derive them.**
1. **Button on the card accent, white label** — the status read as an ordinary green Resume card.
2. **Button as a tone WASH** (`tone + '33'` behind `tone`, i.e. the chip widened to the row) — rejected
   as *"transparent type"*: it reads as a disabled or secondary control, and this button is neither,
   since the tap still starts or resumes the visit.
3. **The whole card in the phrase's tone** (amber pending / red `cantDoWork` / blue `rescheduled*`) —
   rejected outright: a list where every card is a different hue is a list with no signal in it.
4. **Keeping the chip for resulted jobs** — the duplicate above; the phrase now takes their button.

What the final answer rests on is that these jobs all share the one fact that matters — **the office is
holding them, so they are not the crew's ordinary work** — and `JOB_CARD_COLORS` already has the word
for that.

⚠️ **Grey the COLOUR, not the resulted TREATMENT.** The card keeps its ordinary `+ '1A'` wash and full
opacity; the resulted card's `#F4F6F8` ground and `0.85` dim say *this visit is over*, which a
pending-reset job flatly is not — its button still starts or resumes the job.

⚠️ **`solidAction = !isPreview || showPhraseOnAction`.** A phrase button stays SOLID even on a preview
card, so the wash is reserved for a genuine preview. The preview signal is not lost: such a card still
resolves to `UPCOMING`, so it still drops the accent bar, and its tap still explains why it will not
open.

### Smaller decisions

⚠️ **The location pin is dropped with the label** (`showActionIcon`) — the pin belongs to an action that
takes the installer somewhere, and a status report doesn't go anywhere. Same reasoning that dropped it
from the resulted bar. The text's `ml-2` is therefore keyed on the spinner/pin **actually being there**
(`loading || showActionIcon`) rather than on `resulted`, or a phrase button would inherit a margin that
pushes its centred label off centre.

⚠️ The phrase renders **verbatim, not `.toUpperCase()`** as the chip did: at the button's 16 px
`font-medium` a thirty-character phrase in caps would hit `numberOfLines={1}` and truncate, and the
button's own typography is what makes it read as a label rather than a badge.

⚠️ **`loading` is the one state that keeps the phrase book** — the button is a spinner + "Starting Job…"
for that instant.

⚠️ **Nothing was changed in `utils/installer-card-state.ts`.** `installStatusPhrase` /
`resolveJobCardState` are untouched — a phrase in `workflowState` still falls through
`BY_WORKFLOW_STATE` to `isJobInProgress(job)`. Only `state.color` is overridden, so the accent bar still
draws for the two live states and the tap still starts vs resumes exactly as before; the card just says
it in grey.

⚠️ `workflowPhrase` / `showPhraseOnAction` **moved UP** the file, above `accent`, which now derives from
them. `actionBg` / `actionFg` stayed with `isPreview`.

⚠️ Needs a device check (this repo cannot render-test): no status chip anywhere, a phrase card fully
grey including its border and arrival time with a solid grey button and a white label, a RESULTED job
carrying a phrase reading `Install Can't Do Work` on its button while keeping its dimmed ground and its
RESULTED badge, and a phrase card still opening the job on tap.

## My Installs flashed a pull-to-refresh spinner every time the crew came back from a job

Ticket: *"when i came back from the lead it shows me a loader on top some time, or some times shows me
the white space — fix this UI glitch"*, with a screenshot of the green refresh spinner sitting above
the first card and the list pushed down.

`screens/Installer/index.tsx` bound the control straight to the query's own refetch flag:

```tsx
const { …, refreshing, refresh } = useInstallerJobs(period);   // refreshing = isRefetching
…
<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
```

⚠️ **`isRefetching` is true for EVERY refetch, not just a pull** — and this screen refetches on every
return by design (`useFocusEffect` → `refresh()`, because a job's status changes while the crew is
inside it and `my-jobs` is the only thing that knows). So walking back from a job set
`RefreshControl.refreshing` **programmatically**, which on iOS inserts the control at the top of the
list and pushes the content down: the stray spinner AND the band of white space, both from the same
line, for a gesture nobody made.

Fixed with a **`pullRefreshing` state that only `handleRefresh` sets** — exactly the flag, and the
reasoning, the Lead Center's own pull-to-refresh already documents. The focus refetch still runs; it
just does so silently, which is what it was always meant to do.

⚠️ `handleRefresh` became `async` and releases the flag in a **`finally`**: on a failed read the
spinner would otherwise stick forever and the list would look frozen with no way to clear it.

⚠️ `refreshing` is no longer destructured from `useInstallerJobs` — the hook still returns it, and it
is a fine thing to read for a *quiet* indicator, just never for `RefreshControl.refreshing`.

⚠️ **Not the cause, and not changed:** `loading` (`isLoading`) is false throughout, because
`staleInstallerJobs` invalidates with `refetchType: 'none'` and TanStack keeps the cached rows — so
there is no empty-list flash, and the full-screen spinner is reserved for a genuinely dataless key
(which is what a Today ⇄ Tomorrow switch is).

⚠️ Needs a device check (this repo cannot render-test): open a job, come back, and confirm the list
paints in place with no spinner and no gap — while a real pull still spins and still re-reads.

## The sold scope renders as SECTIONS and COMBINATIONS, not one bullet list

Ticket: *"inside the installer when we open the lead and go to the bottom we see the products section
— now i want to show the products like these combinations … because backend already share the data in
the sections; also show the products as a section wise in the step of verify job scope, update the UI
according to screenshots"*, against six screenshots of the sales build card (Gutter / LeafFilter /
Soffit / Fascia / Lighting / Additional Services).

`normalizeProductDetails` collapsed the whole build into `SoldProduct.lines: string[]` and both
surfaces — Job Reference ▸ Products and Verify Job Scope — drew it as one flat run of bullets. The
backend has always sent it as structure:

```
productDetails.products[].subcategories[].sections[].combinations[].fields[]{ label, value }
```

so flattening threw away the two facts an installer needs most on site: **which measurement belongs to
which run, and how many runs there are.** A gutter job sold as two runs read as one list of numbers.

**New pure `src/utils/installer-product-scope.ts`** (`measurementRows` / `fieldRows` /
`flattenScopeSections` / `rowText` / `normalizeProductDetails`) — the parsing MOVED here out of
`services/api/installer.ts`, which pulls in the axios wrapper (and MMKV through it) and cannot be
loaded under jest, the same reason `utils/installer-coc-scan.ts` and `utils/installer-coc-pdf.ts`
exist. `SoldProduct` gained `sections?: ScopeSection[]` (`ScopeSection` → `ScopeCombination` →
`ScopeFieldRow`, all in `config/types/installer.ts`).

**New `src/widgets/components/installer/ProductScopeCard.tsx`** draws it, and **both surfaces now share
it** — Verify Job Scope passes its confirm / discrepancy controls as `children`. They were
byte-identical spec lists before and had already begun to drift (two copies of the bullet geometry, two
different title weights, one with an icon and one without); one component is what stops the same
product looking like two different jobs on two screens.

| screenshot | what drives it |
|---|---|
| product name + coloured glyph | `productIcon(name)` / `productColor(idx, color, name)` |
| section heading ("Vinyl Soffit") | a section with a HUMAN label that holds combinations |
| tinted `Combination #N` block | one per combination, numbered from the payload's own `index` |
| bold headline (`5" K-Style`) | the combination's UNLABELLED fields, joined with ` · ` |
| `label ⟷ value` rows | its labelled fields, in config order |
| tinted `Extras` block | a section with a human label and NO combinations |
| a loose bullet list | a section with an auto label and no combinations |

⚠️ **A `locationGrid` is stored location-first and read storey-first.** `{"Left Side":{"1st":5}}`
renders `1st Story ⟷ Left Side: 5`, because that is the layout the sales card the installer is
comparing against uses; reading it as stored puts the SIDE in the label column, and on a two-storey job
that reads as two products. Blank and zero cells are dropped — an 18-cell grid of zeroes buries the one
measurement that matters — and an unparseable value is shown verbatim rather than dropped.

⚠️ **" Story" is appended for DISPLAY only, and only to a bare ordinal** (`/^\d+(st|nd|rd|th)$/`). A
column a config already spells out ("1st Story") fails that test, as does one named anything else, and
both print exactly as authored.

⚠️ **A label matching `^(section_|field_|selection_)` is an auto-generated schema id and is dropped** —
that rule predates this ticket. What is new is where the value then goes: a field with no human label
is a bare selection, so its VALUE is hoisted into the combination's headline rather than given a column
with an empty label beside it.

⚠️ **`SoldProduct.lines` is KEPT**, derived from the same walk, and is the render FALLBACK when
`sections` comes out empty — a payload shape we have not seen still shows what was sold. Nothing else
reads it: `installer-step-data.ts` and the activity log take only `id` and `name`, and **`id` is what
`scopeItems` is keyed by**, so the reshape cannot move a discrepancy onto the wrong product.

⚠️ **A subcategory-less product still gets a card**, empty. It IS on the job; a missing card reads as
"not sold" rather than "nothing entered".

⚠️ `productColor` gained a THIRD optional `name` argument rather than a second function — an explicit
API colour still wins, then the name, then the palette rotation. `RepPhotoCard` passes no name and is
unaffected.

⚠️ Needs a device check — this repo cannot render-test, and the whole ticket is layout: the section
headings, one block per combination, and the `Extras` block reading as a block rather than a heading.

### …and the number is the CARD's, not the section's

Follow-up, with a screenshot of a LeafFilter card reading **Combination #1** three times over three
different gutter widths: *"the same combination number is displayed on every combination — make it auto
increment according to the receiving combination, if 4 received then show #1, #2, #3, #4. These should
be for every case of combinations."*

⚠️ **`combo.index` RESTARTS AT 1 IN EVERY SECTION, and a subcategory is routinely authored as several
one-combination sections** — LeafFilter arrives as four, one per gutter width (this file already records
that, under the addendum-review ticket). So trusting the payload's own index was guaranteed to print
`#1` once per section. New **`renumberScopeCombinations`** assigns the number by position across the
whole card once its sections are built, and `toCombination` no longer reads `index` at all.

That is also what the sales card does — Soffit: *Vinyl Soffit* #1, *Porch Ceiling SqFT* #2, *Nailer
Build Out* #3 — so the two surfaces now agree on what "Combination #2" refers to.

⚠️ **An empty combination is dropped BEFORE numbering**, so a card whose first combination held nothing
still starts at #1 rather than #2. Numbers name what is on screen; a gap invites the installer to look
for a run that was never sold.

⚠️ **`flattenScopeSections` counts the CARD too** (`countCombinations`), not the section it is walking.
Left per-section, four one-combination sections would each have read as a lone *unnumbered* run while
the cards above them numbered 1–4.

### …and an Extras colour is folded into the quantity it belongs to

Follow-up, with a screenshot of the Extras block: *"make sure when we receive the Ground Spout value
then append with the colour also, like in the image"* — `Ground Spout ⟷ 3 · Black`,
`Replace Corner Miter ⟷ 3 · Cream`, while `Wedges` / `Straps` / `Modify Height` stay bare.

**The colour is a SEPARATE field with its own id**, immediately following the quantity it belongs to.
Settled from `payload for testing extras.txt` (`section_1781685061809__extras`), which stores exactly
that alternation:

```
field_1781873407628_9hhi0__textvalue-3      2            ← Ground Spout
field_1781873462203_n44h8__color            "Black"      ← its colour
field_1781873537058_tk016__textvalue-uuu1l  2
field_1781873540360_ny9fm__color-gem7v      "Forest Green"
```

⚠️ **The pairing is POSITIONAL, and it has to be**: the colour carries nothing linking it back — no
`dcField`, no parent id, a different field id from its quantity. The authoring convention is the only
link there is, and `utils/dynamic-job-builder/engine/locked-color-defaults.ts` leans on the same one on
the sales side, for the same absence.

⚠️ **A colour folds ONLY into a QUANTITY** — `isQuantityValue`, a bare number and nothing else. That
single guard is what makes the rule safe, and it is deliberately strict:

| the field before the swatch | folds? | why |
|---|---|---|
| `Ground Spout: 3` | ✅ | a count, and the swatch is its colour |
| `Gutter Partial?: Yes` | ❌ | a SELECTION — folding it reads as though "Yes" was measured in Musket Brown |
| `Size: 1 x 4`, `Footage: 111'`, `6"` | ❌ | contains a number; is not one |
| `Measurements` (a grid) | ❌ | expands to several rows; never a fold target |
| another colour (`Track Color` → `Wire Color`) | ❌ | falls out of the same test — a colour's value is not a number |

⚠️ **A swatch authored with NO label arrives as its schema KEY** (`color`, `color_gem7v`,
`color-uq368`) — the portal's own fallback — so a standalone one is displayed as **`Color`**
(`BARE_COLOR_KEY`). An authored label is kept verbatim, so `LeafFilter Color` and `Track Color` are
untouched. A folded colour shows no label at all, being part of its quantity's value.

`buildFieldRows` runs the pass over BOTH a section's loose fields and a combination's, so a folded
colour rides into the combination headline too (`5 · Clay`) where the quantity was unlabelled.
