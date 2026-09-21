# Pitch Book & Roofline Deck (incl. fullscreen presentation)

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/Pitchbook/**`, `src/screens/RooflineDeck/**`, `widgets/components/pitchbook/**`, `widgets/components/InspectionPhotosPanel.tsx`, `widgets/common/ZoomableImage.tsx`, `hooks/usePitchBooks.ts`, `hooks/useTabStripAutoScroll.ts`, `utils/pitch-book.ts`, `utils/presentation-tutorial.ts`, `utils/zoom-transform.ts`.
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## Inspection photos were invisible in the Pitchbook / Roofline Deck

Ticket: *"images are not showing in inspection like web"* (`src/screens/Pitchbook/index.tsx`). The
tool drawer's **Inspection** tab rendered the "Property Inspection Photos" heading over **blank
space** — no photos, and not even the empty state.

Both screens matched photos against the **static** `IMAGE_CATEGORIES` list:

```ts
IMAGE_CATEGORIES.filter((s) => secureImages[s.name]?.length > 0)   // ← the bug
```

`useSecureUrls` keys its map by the photo's **raw `category`**, and the dynamic capture flow scopes
that per product — `useDynamicInspectionCapture.scopeCat` stores
`` `${productKey} — ${label}` ``, e.g. **`"Gutters/Roofline — HOME"`**. The static list only holds
`Home` / `Inspection` / `Measurements` / `Miscellaneous`, so **nothing matched** and every
dynamically-captured photo was invisible. Only the legacy flow (`JobDocsSection` / `TagPhotoModal`,
which pass a bare `section.name`) ever rendered.

⚠️ The empty state didn't fire either: it tested `Object.keys(secureImages).length === 0`, which is
**false** — the map was full, just under a key nothing looked up. That is why the tab looked broken
rather than empty.

Fixed the way web does it (`src/sections/pitch-book/components/pb-inspection-photos.js`): **derive
sections from each photo's own category, never from a fixed list.** Split across a pure
**`src/utils/inspection-photos.ts`** (grouping) and **`src/widgets/components/InspectionPhotosPanel.tsx`**
(rendering) — the split is deliberate: the panel imports `PhotoPeekPressable`, which pulls in
**reanimated**, and the repo has no reanimated mock, so anything importing the panel is **untestable
under jest**. Keep new logic in the util.

- **`sectionFromCategory(category)`** handles both storage formats — splits on the **em dash** for
  `"{product} — {TAB}"` → `Home`, else takes the name as-is. The **full** category string is the
  section id, so two products that both have a `HOME` tab stay separate accordions instead of merging.
- **`prettify`** title-cases the all-caps tab name, leaving already-cased legacy names
  (`"Roofline Observation"`) intact.
- **Deleted (`deletedAt`) and annotated photos are dropped**, which mobile never did — annotated
  copies belong to the annotation surface and were duplicating the originals here.
- **`buildInspectionSections(photos, secureImages)`** re-groups from the **raw `salesPhotos`** records
  (they carry category / subcategory / deletedAt / timestamp) and uses `secureImages` only as a
  flattened `s3url → signed url` lookup, falling back to `photo.secureUrl`. A photo with no
  resolvable url is skipped rather than rendering a blank tile.
- The count chip is now web's **"N photos"**. The old "N of M complete" derived M from the static
  category's `subCategories`, which a dynamically-captured section does not have.

**Both screens were byte-identical copies of this block**, so `Pitchbook` and `RooflineDeck` now
render the shared panel (each dropped its own `expandedCat` state and its `IMAGE_CATEGORIES` import;
the panel owns the accordion and takes an `onPreview` callback, since the preview `Modal` stays on the
parent). RooflineDeck was **not named in the ticket** but had the exact same defect — fixing only the
reported screen would have left it broken.

⚠️ **`useSecureUrls` was deliberately NOT changed.** Five call sites depend on its
category-keyed shape (`RooflineDeck`, `InvestmentPanel`, `LeadImagePickerModal`,
`DynamicManagePhotosView`, `Pitchbook`); the grouping is wrong only for *this* use, so it is undone
locally rather than by reshaping a shared hook.

⚠️ One deliberate divergence from web: web renders **one card per subcategory slot** with a `+N`
badge. Mobile renders **every** photo instead, so nothing hides behind a badge. Photos are still
grouped by slot (oldest first within a slot) so repeat shots sit together.

### Card design + instant preview (follow-up on the same ticket)

Follow-up: *"set the design like web and image show instantly while we press like we set in rev
render."*

**Design** now mirrors web's `ImageCard`: the group is one **white elevated card** holding both header
and grid (was a grey `#F4F6F8` bar with the photos loose underneath); tiles are **two per row**
(web `xs={6}`) at a **4/3** crop with a 2px border (were three per row, square); an **eye badge**
sits top-left; and the caption bar carries the subcategory on the left with the **capture time**
(`01:05 PM`) on the right. The time comes from `formatCaptureTime`, written **by hand rather than via
`toLocaleTimeString('en-US', …)`** (what web uses) so it cannot depend on Intl being compiled into the
JS engine.

⚠️ The grid uses `justifyContent: 'space-between'` with `width: '48%'`, **not** a pixel `gap` — two 48%
columns plus a fixed gap can exceed 100% on a narrow drawer and wrap to one card per row.

**Instant preview** reuses the existing revRender machinery rather than re-solving it: each tile is a
**`PhotoPeekPressable`**, so hold-to-peek warms a local `file://` copy through `imageFileCache` and the
enlarged image opens instantly instead of blanking for 2–3 s (see "Hold-to-peek previews" above for
why `Image.prefetch` cannot do this).

- **`PhotoPeekPressable.onPress` now receives the warmed uri** (`(peekUri?: string | null) => void`).
  The panel passes it straight to `onPreview`, so the parent's **tap** preview `Modal` renders the
  cached file too — previously only the hold-peek benefited. Backwards compatible: a `() => void`
  handler is assignable, so the other four call sites are untouched.
- Both drawers now wrap their tool `ScrollView` in **`PhotoPeekScrollLockProvider`** and use
  **`PeekAwareScrollView`** (the same pairing RevRender/RolloutView use). Without it a stray drag
  during the hold scrolls the list, steals the touch and dismisses the peek mid-hold.

### Card shadow + a pageable viewer (second follow-up)

Follow-up: *"add shadow on card like this also add slide left right option like web."*

**The shadow was already written and simply not rendering.** The group card carried both the shadow
and `overflow-hidden` on the SAME view, and **iOS clips a shadow when the view sets
`overflow: hidden`**. Now two nested Views: shadow on the outer wrapper, rounding/clipping on the
inner one. (Opacity/radius also raised to 0.16 / 10 with `elevation: 4` so it reads on Android.)

**New `InspectionPhotoViewer`** replaces the single-image preview with web's lightbox behaviour:
swipe or tap the chevrons to move through a section's photos, with the `"{Section} - {Subcategory}"`
title, the capture time, an **`n / total`** counter and a tappable **thumbnail strip** that keeps the
active thumb scrolled into view. A horizontal `FlatList` with `pagingEnabled` does the paging;
`getItemLayout` is **required** for `initialScrollIndex`/`scrollToIndex` to work on it.

- **The viewer lives INSIDE the panel, and that removed a duplicate.** Each screen previously carried
  **two identical** preview `Modal`s gated on `isFullscreen`, because the pitchbook renders its tool
  drawer either inside a fullscreen `Modal` or outside it. A `Modal` rendered from the panel nests
  correctly in **both** cases automatically, so the panel's `onPreview` prop and both screens'
  `previewImage` state + **four** dead modals are gone.
- **`useWarmedUris`** warms every photo of the open section through `imageFileCache`, so paging paints
  from `file://` instead of re-fetching a pre-signed S3 object per slide. It keys its effect on the
  **joined url string**, not the array identity — a fresh array each render would restart every
  download on every render. Downloads dedupe by cache path, so overlapping with the thumbnails' own
  warming costs nothing.

⚠️ RN has no `translateY(-50%)`: the chevrons use `top: '50%'` **plus `marginTop: -22`** (half their
height), otherwise their top edge — not their centre — sits on the midline.

⚠️ This supersedes the earlier note that mobile "cannot page a slot". It can now; the reason mobile
still renders every photo rather than web's one-card-per-slot `+N` is simply that nothing should hide
behind a badge.

## Dynamic (portal-authored) Pitch Books

Ticket: *"Portal | Dynamic Pitch Books — PDF Upload and Image Parsing… I think in Lead Center screen
(Pitch book card) there should be arrow down and up option which show the list of pitch, on selecting
the one we will take the id of that pitch book and show the data inside pitchbook accordingly."*

The portal half (bulk PDF upload → parse pages to images → sections → publish) is a separate repo;
this is the **rep-facing consumption** half. A manager can now publish several books, so the rep picks
one instead of always getting the bundled deck. **The web app has no pitch-book API client yet**
(`grep pitch-books` over `mhalt-revDSM-sales-frontend` is empty), so unusually there is **no web ref
to port from** — this was written against the documented endpoints and their sample payloads.

**Two endpoints, both company-scoped by the JWT and both PUBLISHED-only:**
- `GET /pitch-books/sales-rep[?documentType=pitch_book]` → `{ data: { books: [...] } }` — id, name,
  `slideCount`, and a `thumbnail: { filePath, bucketName }`.
- `GET /pitch-books/sales-rep/:bookId` → `{ data: { book, sections: [...] } }` — sections ordered by
  `sectionSortOrder`, each holding slides ordered by `sortOrder`.

⚠️ **Slides arrive as `{ filePath, bucketName }`, NOT urls.** They must be exchanged for pre-signed
urls via `LeadService.getSecureUrls` before an `<Image>` can render them.

Three new files:

- **`src/services/api/PitchBookService.ts`** — the two GETs, in the `InspectionService` house style.
- **`src/utils/pitch-book.ts`** (pure, zero imports) — `normalizePitchBookSections`,
  `collectSlideRefs`, `buildPitchBookDeck`, `normalizePitchBookList`. Split out for the same reason as
  `utils/inspection-photos.ts`: the hook and screen pull in RN, this doesn't, so the logic is testable.
- **`src/hooks/usePitchBooks.ts`** — `usePitchBooks()` (list + batched thumbnail signing) and
  `usePitchBookDeck(bookId)` (one book, slides signed in **one batched call** via `collectSlideRefs`).
  Both cache for **50 minutes** — pre-signed urls expire at 60, the same window `useSecureUrls` uses.

**The key design decision: a remote book is projected into the STATIC decks' shape** —
`categories: [{ id, label }]` + `images: { [categoryId]: { [slideName]: source } }`. `<Image source>`
takes both a `require()` number and `{ uri }`, so once the projection is done **every** downstream read
in `Pitchbook/index.tsx` (slide counts, `getGlobalPosition`, `getCurrentSlideName` analytics, the
fullscreen portrait AND landscape viewers) works against either deck with no per-site branching.

`Pitchbook/index.tsx` now takes **`bookId` / `bookName`** nav params (`RootStackParamList` updated).
With no `bookId` it behaves exactly as before — bundled LeafFilter deck, or the Green Rooflines
company deck. With one, `CATEGORIES` / `pitchBookImages` / `defaultCategoryId` come from the fetched
deck instead. Also:

- **Saved progress is keyed by book** (`pitchbook-progress-{leadId}-{bookId}`) — one shared key would
  restore a rep into a section that doesn't exist in the book they just opened. The default deck keeps
  the old un-suffixed key, so existing saved positions survive.
- **Two reconcile effects.** A remote deck's sections aren't known at mount, so `activeCategory` starts
  `''` and the first effect lands it on the saved-or-first tab once the fetch resolves. The second
  clamps `currentSlideIndex` into range. Both also cover a book **edited on the portal** since the rep
  last presented it (tab deleted / section trimmed) — otherwise the rep opens onto a blank frame with
  working arrows.
- **The persist effect skips an empty `activeCategory`**, or the first render of a remote deck would
  immediately overwrite the position saved on the previous visit.
- **One early return** handles loading / error (with Try Again) / nothing-published, placed after all
  hooks and before the main `return`. Gating the whole screen covers all four slide render sites at
  once; teaching each an empty state would be four chances to miss one.

`ToolsSection`'s Pitch Book `ToolCard` became **`PitchBookCard`** (same file): the familiar row plus a
**chevron-down/up** that expands the published list in place (thumbnail, name, `N slides`), each row
navigating with its `bookId`. `LeadCenter`'s `onShowPitchbook` now takes an optional book.

⚠️ **With nothing published — or a failed list read — one tap opens the bundled deck, exactly as
before.** The dynamic list is strictly additive; a company that hasn't configured any book, or a rep
with no signal, must never end up with no pitch book at all. Same reasoning inside the normalizer: a
slide whose url can't be signed falls back to the bare S3 url rather than being dropped.

Deliberate drops, both because a blank frame mid-pitch is worse than a shorter deck: a **section with
no slides** (a legitimate portal state — created, not filled) and a **slide with no `filePath`**.

⚠️ **Two slides in one section CAN share a `slotDisplayName`** — the portal derives it from the
uploaded file name, and two PDFs both yield "Page 1.jpg". The images map is keyed by name, so
`uniqueName()` suffixes duplicates (`Page 1.jpg (2)`); without it a page vanishes from the deck with
no error anywhere.

### Follow-up: a failed list read was indistinguishable from "none published"

QA: *"i don't know where do you make the changes, nothing showing here, i even i check api is not
calling here /pitch-books/sales-rep."* The card WAS the new one (its subtitle only exists in the new
code; the old `ToolCard` had none) — but it read **"Present the standard deck"**, which was the single
subtitle for *every* non-loading empty state.

That was a real defect in the fallback above: `data: books = []` swallows an error, so a **404 / 403 /
unreachable endpoint looked exactly like a correctly-working card for a company with nothing
published**, with no way to tell which — including for whoever is debugging it.

- **Three distinct subtitles now**: `Loading pitch books…` / `Couldn't load pitch books — tap ↻ to
  retry` (on `isError`) / `No pitch books published — standard deck`.
- **A retry button rendered OUTSIDE the row's press target**, so tapping the row still opens the
  bundled deck — a rep mid-pitch must never be blocked by a failed list read.
- **Both `queryFn`s log the failure in `__DEV__`** (`[pitchBooks] list FAILED <status> <body>`) and the
  list logs its count on success. The axios wrapper already prints `[API] → GET /pitch-books/sales-rep`
  for every request, so the pair isolates "never requested" from "requested and rejected".

Service layer verified separately (module callable, `/pitch-books/sales-rep`,
`?documentType=pitch_book`, and the `:bookId` detail path) — a failed import would present as "no
request", so that was ruled out explicitly.

## Pitch Book slides pinch, double-tap and drag to zoom (ticket 380)

Ticket: *"Pitch Book | need pinch and pull to zoom — you have to add zoom out zoom in
functionality which we normally have while pinching."* A slide was a plain `<Image>` with
`resizeMode="contain"`, so the fine print on a deck page (the confidential footer, a spec
table) could not be read on a phone and there was no way to get closer to it.

**New `src/widgets/common/ZoomableImage.tsx`** — a drop-in replacement for `<Image>` with
the standard photo-viewer gesture set: **pinch** (anchored to the fingers), **double-tap**
(toward the tapped point, and again to reset) and **drag** while zoomed. Wired into **all
three** places a slide is painted — the inline card, and the fullscreen viewer's **portrait
AND landscape** layouts — so the gesture is there wherever the rep sees the slide.

`source` is an `ImageSourcePropType`, so the bundled `require()` decks (LeafFilter, Green
Rooflines) and a **portal-authored `{ uri }` book** both work with no branching at the call
site — the same property that let the dynamic pitch books be projected into the static decks'
shape in the first place.

⚠️ **`RooflineDeck` was NOT named in the ticket and is fixed too.** Its three slide render
sites are the same code (differing only in `?.src` on the source), so fixing only the
reported screen would have left the other half of the presentation flow without the gesture —
the same reasoning as the inspection-photos ticket.

### The two things that had to be right

⚠️ **A `Modal` is its own native view tree on Android**, so the app-root
`GestureHandlerRootView` in `App.tsx` never reaches it and **none of the gestures fire in
fullscreen** — which is the surface the ticket's screenshot shows. Both fullscreen modals
now wrap their content in their own `GestureHandlerRootView` (`ImageGalleryModal` already
does this for the same reason). In `Pitchbook` it replaced the modal's existing root `View`;
`RooflineDeck` had no wrapper at all, so one was added.

**Pan is enabled ONLY while zoomed.** At 1× a drag still belongs to whatever surrounds the
image, so nothing this component does can swallow a scroll or a pager swipe. (The pitch book's
own slide area is not inside a scroll view — the main layout is a fixed flex column — but the
component is shared and must not depend on that.)

**`resetKey={`${activeCategory}:${currentSlideIndex}`}`** snaps back to 1× on every slide
change. Without it a rep advances mid-pitch and lands on the next slide already scrolled to
some corner of the previous one's zoom.

The wrapper **clips** (`overflow: 'hidden'`), so a zoomed slide can never paint over the page
counter, the ✕, the arrows or the category tabs — all of which are absolutely-positioned
siblings rendered after it, so they still take their taps first.

### The maths lives in the pure `src/utils/zoom-transform.ts`

`clampZoomScale` / `panBound` / `zoomOrigin` / `anchoredTranslate` / `doubleTapTranslate` /
`clampPan` — for the reason `utils/addendum-drafts.ts` and `utils/inspection-photos.ts` exist:
the component pulls in react-native + reanimated and cannot be loaded under jest here, and
these six expressions are the whole of what can be **silently** wrong. An anchor that drifts
or a bound that lets a zoomed slide be flung off screen both present as "the zoom feels
broken" and neither throws.

- **Coordinate system**: offsets are SCREEN pixels from the CENTRE of the image box, because
  that is how RN's `transform: [translateX, translateY, scale]` composes — the content scales
  about its own centre first, then translates in parent units. A point `origin` from the centre
  lands at `origin * scale + translate`, which is the identity every test asserts against.
- **Anchoring** solves that for `translate`: `t = focal − origin × scale`, with
  `origin = (focal − t_prev) / scale_prev` captured once at `onStart`. Capturing the origin from
  the PREVIOUS transform is what makes a second pinch — one that starts from an already-panned,
  already-zoomed state — stay under the fingers instead of jumping.
- **`panBound` is 0 at 1×**, which is what re-centres the slide when the rep pinches all the way
  out; no separate "snap back" branch is needed.

⚠️ **Every export carries the `'worklet'` directive** so the gesture callbacks can call it on
the UI thread; they stay ordinary functions on the JS thread, which is what keeps them testable.
**This is the repo's first cross-file worklet** (every other one is an inline closure the plugin
auto-workletizes), so it was verified rather than assumed: running the project's own babel
config over both files shows **6 worklets in the util and 7 in the component**, each component
callback capturing the helpers by name in its `__closure`. The plugin is present via
`nativewind/babel` → `react-native-css-interop/babel`, which registers
`react-native-worklets/plugin` unconditionally — it is **not** in `babel.config.js`, so don't
conclude from that file that worklets are unprocessed.

⚠️ Needs a device check for the gesture feel itself (this repo cannot render-test): pinch and
double-tap in **fullscreen portrait, fullscreen landscape and the inline card**, that the arrows
and ✕ still take their taps over a zoomed slide, and that advancing a slide resets the zoom.

## Pitch Book fullscreen opens with a gesture tutorial — and the gestures it teaches are NEW

Ticket: *"open the app, create a new lead, open the lead detail page, then go to the Tools section and
open the pitch book, then click on the full screen icon — when the full screen is open we need to
display these details"*, against a mock of a **QUICK TUTORIAL / Presentation Gestures** card with two
panels (**Tap Center**, **Swipe Edge-to-Edge**) and **Got It, Dismiss** / **Don't show me again**.

⚠️ **NEITHER GESTURE EXISTED.** Fullscreen had `ZoomableImage`'s pinch / double-tap / pan and the
chevron arrows, and nothing else — no centre tap, no edge swipe (`grep` for `PanResponder`,
`showControls`, `Gesture.Tap` in `screens/Pitchbook/index.tsx` was empty). Shipping the card alone would
have taught a rep two gestures that do nothing in front of a customer, so **both were implemented**;
the card's copy is the contract with them and must not outlive either.

| card | what it now does |
|---|---|
| **Tap Center** | single tap on the slide toggles the presentation chrome — counter, exit, arrows, tabs, tools tab |
| **Swipe Edge-to-Edge** | a horizontal swipe in either border strip changes slide |

### The tap had to go INSIDE `ZoomableImage`, not over it

New optional **`onSingleTap`** prop. A sibling detector over the middle of the slide would have
swallowed the pinch and double-tap that live there, so the tap is composed with them instead:

⚠️ **`Gesture.Exclusive(doubleTap, singleTap)`, never `Simultaneous`.** A double tap BEGINS with a
single one, so a parallel composition would fire the host's toggle on the first tap of every zoom — the
chrome flashing away each time a rep double-tapped into detail. Exclusive makes the single tap wait for
the double to fail, on the 250 ms `maxDuration` the component already sets. Absent the prop the
composition is byte-identical, so the inline pitch-book card and Roofline Deck are untouched.

### The swipe is two border STRIPS, which is what makes it safe

**`EdgeSwipeZones`** renders an 18 %-wide `Gesture.Pan` strip down each side.

⚠️ **Not full width.** The middle belongs to pinch and pan, and a full-width swipe handler would fight
panning a zoomed-in slide — the one gesture a rep uses while a customer is looking at detail. It is also
exactly what the card promises (*"near the screen borders"*), so copy and hit areas cannot drift apart.

⚠️ **`zIndex: 5`, below the chrome's 10.** The prev/next arrows sit at these very edges; a strip above
them would swallow the taps the tutorial never mentions but the rep still relies on.

⚠️ **Direction comes from the TRAVEL, not from which strip was touched** — keying it to the strip would
make a left-edge swipe-left go backwards. `swipeDirection` also requires `MIN_SWIPE_DISTANCE` of travel
**and** more horizontal than vertical movement; without the second test a slight drag while reaching for
an arrow changes slide mid sentence. An exact 45° drag is refused rather than guessed.

### Chrome gating, and the two buttons

The chrome is the run of siblings that FOLLOWS the image in each layout, so one `{chromeVisible && (<>…)}`
fragment gates each run rather than ten separate conditions; the portrait top bar and both tab strips are
flow children and are gated on their own.

⚠️ **`chromeVisible` resets to true on every fullscreen OPEN.** Leaving a presentation with the chrome
hidden must never strand the next one — the exit button is in there.

⚠️ **The centre tap is swallowed while the tutorial is up**, so the tap that dismisses it cannot also
hide the controls behind it: the rep would land on a bare slide having pressed a button that said
"Got It".

⚠️ **Only "Don't show me again" writes** (MMKV `pitchbook-gesture-tutorial-v1`). "Got It, Dismiss" closes
for now and the card returns next presentation — treating the two alike is the easy mistake and makes the
quieter button pointless. An unrecognised stored value SHOWS the tutorial: one time too many beats a rep
never learning the gestures.

⚠️ The overlay is `StyleSheet.absoluteFill` inside the EXISTING fullscreen `Modal`, rendered last — not a
modal of its own. Stacking native modals is unreliable on both platforms, the rule the CoC signature pad
and the funding sheet already follow. Its `BlurView` carries a near-opaque
`reducedTransparencyFallbackColor`, because with Reduce Transparency on there is no blur and the card is
unreadable over a bright slide.

⚠️ **Keyed on the fullscreen open, not on mount.** The inline card has neither gesture, so teaching them
where they do nothing would be worse than not teaching them.

⚠️ **Roofline Deck was NOT given this.** It shares the fullscreen viewer's shape, and the earlier
inspection-photos ticket did fix both — but that was a defect present in both, and this is a new feature
the ticket scoped to the pitch book. It is a two-line addition there if wanted, and it needs the same two
gestures first.

Rules live in the pure **`src/utils/presentation-tutorial.ts`**, for the reason `utils/addendum-drafts.ts`
exists: the screen pulls in React Native and is untestable under jest here, and a rule that gets this
wrong either nags a rep who asked to be left alone or silently never shows the tutorial.

Tests: `__tests__/utils/presentation-tutorial.test.ts`.

⚠️ Needs a device check (this repo cannot render-test): the card on the first fullscreen open, both
buttons' behaviour across a relaunch, the centre tap hiding and restoring the chrome without disturbing
double-tap zoom, an edge swipe changing slide while a mid-slide pinch still zooms, and the arrows still
tappable where the strips overlap them.

## Pitch Book fullscreen: ONE floating dock replaces the tabs bar and the Interactive Tools button

Ticket: *"update the bottom bar like this style … remove the interactive button and add that
functionality when pressing the new icon. Actually adding two new icons on the bottom: one is a layer
icon that will open the bottom bar in which LeafFilter Story, Problems & Risk, Rules & Elimination etc
are shown, and the other icon press shows the bar that is currently shown on pressing Interactive
Tools."*

**New `widgets/components/pitchbook/PresentationDock.tsx`** — a floating rounded bar with a leading
icon PAIR that chooses which half is showing:

| icon | mode | shows |
|---|---|---|
| **layers** ⬓ | `slides` | the deck's category tabs — LeafFilter Story, Problems & Risk, … |
| **wand** ✨ | `tools` | Inspection / Risk / Videos / Notes, over their content, with a ✕ |

### What it replaced

| gone | was |
|---|---|
| landscape `#111` category strip | a flow child under the image |
| landscape right-edge green tools tab | a vertical pill at the screen edge |
| portrait tabs bar + **Interactive Tools** button | a flow bar under the image |
| `{renderInteractiveTools()}` in fullscreen | a bottom sheet over the slide |

⚠️ **`renderInteractiveTools` itself STAYS** — it still serves the non-fullscreen drawer, which is a
themed bottom sheet and is unchanged. Only the fullscreen call site was removed.

⚠️ **The dock is rendered ONCE for both orientations**, outside the landscape/portrait branch, with only
its insets differing. The two bars it replaced had drifted into different designs already; one component
is what stops that recurring.

### The decisions

⚠️ **Both leading icons stay visible in BOTH modes.** They are the only way between the two halves, so
hiding either behind its own mode would strand the rep — which is exactly what the old right-edge tab
did once the tabs bar was gone.

⚠️ **The ✕ returns to `slides`; it does NOT dismiss the dock.** This bar is also how the rep changes
section, so a close that hid the whole thing would take the deck's navigation with it.

⚠️ **`dockMode` resets to `slides` on every fullscreen open**, alongside `chromeVisible`, for the same
reason: landing in `tools` would hide the navigation the rep opened the presentation to use.

⚠️ **The wand is not offered in Homeowner mode** (`showTools={viewMode === 'rep'}`) — the same gate the
old right-edge tab carried, so it cannot open an empty panel in front of a customer.

⚠️ **The tool panel is capped** (`maxToolHeight`, 52 % landscape / 46 % portrait) so it never swallows
the slide being presented.

### ⚠️ The tool bodies could NOT be shared with the drawer

The dock is dark by design; the drawer is a themed surface whose headings use `text-text-primary`, which
in LIGHT theme is near-black and **invisible** on the dock. So `renderDockToolContent` is a separate
renderer with explicit colours (`dockStyles`) for the copy this screen owns. The two shared panels —
`InspectionPhotosPanel` and `RiskContent` — draw their own cards and read correctly on either ground, so
they ARE reused; only the headings, the notes card and the videos empty state are restated.

`PhotoPeekScrollLockProvider` + `PeekAwareScrollView` come across with them: without the lock a stray
drag during a hold-to-peek scrolls the list, steals the touch and dismisses the peek mid-hold.

### It sits correctly with the gesture layer added in the ticket above

`zIndex: 20` — above `EdgeSwipeZones` (5) and the arrows (10), so dock taps are never swallowed by a
swipe strip. It is gated on `chromeVisible`, so the centre tap hides and restores it with the rest of
the chrome, which keeps the tutorial's *"toggle toolbar and presentation controls"* copy true. The
tutorial overlay is still rendered after it and so still covers it.

⚠️ Needs a device check (this repo cannot render-test): both icons switching halves in portrait AND
landscape, the ✕ returning to the tabs rather than closing, the active category still highlighted after
a swipe changes slide, the tool panel scrolling without dismissing a hold-to-peek, and Homeowner mode
showing the layers icon alone.

## Pitch Book: one top bar (✕ + page count) on every surface, and the tutorial hides the chrome

Two tickets on the same screen.

### 1. `PresentationTopBar` — a round ✕ left, the page count right

Ticket: *"add the cross button and the page number on the top in this format when the app is in full
screen mode or normal mode."*

**New `widgets/components/pitchbook/PresentationTopBar.tsx`**, used on all THREE surfaces, which had
drifted into three different treatments:

| surface | was |
|---|---|
| fullscreen landscape | a plain `2 / 77` pill top-left + a `contract` icon top-right |
| fullscreen portrait | a FLOW row that pushed the slide down by its own height |
| inline card | a green `1 of 8` chip beside a "Back to Map" button |

(The inline card takes the page count only — see the `showClose` note below.)

⚠️ **The page count is TWO `Text`s, not one string.** The design weights the current page and dims the
total, which is what makes the pair readable across a customer's living room.

⚠️ **`pointerEvents="box-none"` on the row.** It spans the full width of the slide, and without it the
row would swallow every tap and pinch landing between the two controls — including the centre tap that
toggles this very chrome.

⚠️ **The ✕ is FULLSCREEN-ONLY** (`showClose`). It shipped on the inline card too and was a control with
nothing of its own to do — that screen already has the toolbar's back arrow ABOVE the slide and a "Back
to Map" button directly beside it, so a third way out sat on the artwork earning nothing. Reported as
*"the cross button is also displayed here, that is useless."*

⚠️ **The inline card is `compact`.** The fullscreen pill is deliberately large — it has to be read from
across a customer's living room — and that same size on a 4:3 thumbnail reads as an oversized box, which
is the second half of the same report. Compact drops the pill to 26pt with 12/10.5 type.

⚠️ **The pill aligns its text `center`, NOT `baseline`.** The two numbers are different sizes, and
baseline alignment lines up their BASELINES rather than centring the pair — so inside the fixed-height
pill the text sat high. Baseline is the typographically "correct" pairing for mixed sizes and is exactly
wrong here: the pill is a fixed box, and what has to look centred is the block, not the type. Both Texts
also carry `includeFontPadding: false`, since Android reserves space for ascenders the string may not
use and pushes it off centre the same way.

⚠️ **With no ✕ the row switches to `justifyContent: 'flex-end'`.** One child under `space-between` parks
on the LEFT, and the count belongs on the right on every surface.

⚠️ **The inline one is NOT gated on `chromeShown`.** That flag belongs to the fullscreen centre tap,
and there is no centre tap out here to bring the controls back with.

⚠️ Portrait's bar became an overlay rather than a flow row, so both orientations now frame the slide
identically.

### 2. The tutorial hides the chrome — and that was an overlap BUG, not just tidiness

Ticket: *"when the gesture screen is displayed, no need to show the bottom bar also"*, with a
screenshot of the dock painted across the tutorial's two buttons.

⚠️ **The dock carries `zIndex: 20` and the tutorial's root carried none, and in React Native zIndex
beats document order among siblings** — so rendering the tutorial last was not enough and the dock drew
over it. New derived **`chromeShown = chromeVisible && !showGestureTutorial`** gates every fullscreen
chrome element, which fixes the overlap at its cause rather than starting a zIndex war, and leaves the
rep looking only at the card they are being asked to read. The tutorial teaches what that chrome does,
so there is nothing to demonstrate against while it is up — the same reason the centre tap is already
swallowed there.

The tutorial root also gained `zIndex: 60` as the belt to that braces, so a future control with a zIndex
of its own still cannot paint over the card.

### 3. ⚠️ `insets.top` is ZERO inside the fullscreen Modal — the chrome sat on the clock

Ticket: *"when this full screen is open, make sure the bar in which time, battery and other details are
shown is hidden, and also make sure the cross button and the numbering are not touching that bar."*
Two causes behind one screenshot.

**The status bar was only hidden in LANDSCAPE** (`hidden={isLandscape}`), so a portrait presentation
showed the clock, wifi and battery over the slide — in front of a customer. Now `hidden` outright, for
the whole fullscreen modal.

**And the safe-area inset resolved to 0.** A `Modal` is its own native view tree, so it sits outside the
`SafeAreaProvider`'s host view and `useSafeAreaInsets()` has no window to measure. `Math.max(insets.top
+ 8, 20)` therefore collapsed to a flat **20** and put the ✕ and the page count straight through the
notch and across the clock.

New **`fullscreenTopInset`** applies a floor: `Math.max(insets.top, isLandscape ? 12 : 44) + 8`.

⚠️ **44 is the NOTCH, not the status bar.** Hiding the status bar does not reclaim the notch or the
Dynamic Island — iOS still refuses to draw there — so the clearance is needed even with nothing left to
collide with. Landscape gets a much smaller floor because the cutout moves to the SIDE there and the top
inset really is near-zero; `insets.left` / `landscapeRightInset` guard the sides.

⚠️ A floor rather than a nested `SafeAreaProvider`: one number, and no new context inside a modal whose
other children read `insets` too and would all shift at once.

⚠️ **And the SIDES had it too — the camera cutout.** `Math.max(insets.left, 16)` resolved to **16** on
the first rotation, because the portrait side insets are `0`, which put the ✕ (or the page count,
depending which way the phone was turned) **underneath the camera module**; once the rotation settled
`insets` reported the real 44–59, which is why it looked right on the second attempt.
`fullscreenLeftInset` / `fullscreenRightInset` floor at **44** and feed the top bar, the arrows AND the
dock, so the three cannot disagree.

⚠️ **The side floor is SYMMETRIC.** Which side the cutout is on depends on the rotation DIRECTION, and
the only value that would tell us is the one that is unreliable here. On a device with no cutout it
costs a little of the black letterbox and nothing of the slide. The Android navigation bar still raises
the right side past the floor where it applies — `landscapeRightInset` keeps its own 48 minimum.

⚠️ **…and the modal's LAYOUT is stale across a rotation too, which is a different problem from the
stale values.** Reported: rotating portrait → landscape with fullscreen ALREADY OPEN left the chrome
clipped at the edge, while closing and reopening in landscape was correct. That asymmetry is the tell —
the numbers are right either way, so what is stale is the layout the modal is holding. A `Modal` is
presented by its own native controller and does not reliably re-measure its subtree on a rotation, so
the absolute chrome kept positions computed against the previous frame until the modal was torn down.
The fullscreen `GestureHandlerRootView` is therefore **keyed on the orientation**, which does that
teardown on every turn instead of waiting for the rep to do it by hand.

⚠️ That key resets the slide's ZOOM and the dock's scroll offset on rotation — acceptable, and arguably
right since the slide re-fits to the new frame anyway, but it is the cost: do not extend the key to
anything whose state must survive a turn. `chromeVisible`, `dockMode` and the tutorial flag all live on
the SCREEN, above it, and are untouched.

⚠️ **The dock had the same defect at the bottom** and is fixed in the same pass
(`fullscreenBottomInset`). Its floor is SMALLER, and not for symmetry: the home indicator is a thin bar
the OS draws over whatever is beneath it, not a region iOS refuses to render in. It needs clearing, not
avoiding.

### 4. …and in LANDSCAPE the inset was counted TWICE, with a stale value

Ticket: *"when we open the full screen and rotate, on the first attempt the cross button and the page
numbers are not shown in their place."* Two compounding causes, and the words "first attempt" name the
second one.

**The landscape root carried `paddingTop: insets.top`** and the bar inside it adds `fullscreenTopInset`
— which contains the same inset — so the chrome sat roughly **2× the inset** down the screen, about a
third of the way. That padding existed to hold content below the status bar, which is now hidden for
the whole presentation, so it is simply gone. The slide gets that height back too, which is why it was
letterboxed small in the report.

⚠️ **And LANDSCAPE now ignores `insets.top` entirely — a fixed 12, not a floor.** `insets` is re-read
across a rotation, and on the FIRST rotation it still holds the PORTRAIT top inset (~59); taking
`Math.max` of the two therefore inherited that stale number until something else forced a re-render.
That is exactly "on the first attempt". The landscape top inset is genuinely near-zero on every device
— the cutout moves to the SIDE — so a constant is both correct and immune to the staleness.

⚠️ **`flexShrink: 0` on both controls** of `PresentationTopBar`. The row is `space-between` across the
full width of the slide, and a narrow landscape frame squeezed the pill until it clipped its own total
to `2 / ⌐`.

### 5. Swipe and arrows on the INLINE card too

Ticket: *"user can change slides by swiping or tapping arrows — add this functionality also."*
Fullscreen had both; the inline card had **neither** — a rep presenting without going fullscreen could
only move with the buttons under the progress bar. It now carries the same `EdgeSwipeZones` and a new
shared **`SlideArrows`**.

### 6. ✅ ROOT CAUSE: the swipe STRIPS were eating the arrow taps — `EdgeSwipeZones` is deleted

Ticket: *"when I click on the arrow button the page does not move forward and backward, and when we try
to swipe, that is also not working perfectly."* **One cause, both symptoms.**

The swipe shipped as two 18 %-wide `GestureDetector` strips laid over the slide, on the reasoning that
the middle belonged to pinch. ⚠️ **A sibling `GestureDetector` swallows the touch whether or not its
gesture activates** — `zIndex` orders PAINTING, it does not hand the touch back — and the prev/next
arrows sit at `left: 12` / `right: 12`, i.e. **inside those very strips**. So the arrows were dead, and
swiping only worked in an 18 % band, which is "not working perfectly".

**The swipe moved INSIDE `ZoomableImage`'s own composition**, as new `onSwipe`:

```ts
const swipe = Gesture.Pan().enabled(!zoomed && !!onSwipe).activeOffsetX([-15, 15])…
const composed = Gesture.Simultaneous(pan, pinch, taps, swipe);
```

⚠️ **`.enabled(!zoomed)` is the exact COMPLEMENT of `pan`, which is `.enabled(zoomed)`.** The two are
never both live, so panning a zoomed-in slide to detail can never turn into a page change — which is
what a full-area swipe overlay could not have guaranteed. Composed here it arbitrates with pinch
properly and works across the WHOLE slide.

⚠️ **`activeOffsetX([-15, 15])`** keeps a vertical drag reaching a scrolling parent — needed for the
inline card, which lives in the pitch book's scrollable body.

⚠️ **`EdgeSwipeZones.tsx` is DELETED, and `presentationZone` / `EDGE_BAND_FRACTION` went with it. Do not
reintroduce an edge band.** It is recorded in `presentation-tutorial.ts` as the trap it was.

⚠️ **The tutorial's Swipe card body diverges from the design mock** (*"near the screen borders"*) and now
reads *"anywhere on the slide"* — a tutorial has to describe what the app does. The TITLE keeps the
mock's "Swipe Edge-to-Edge", which reads as the travel rather than the hit area.

⚠️ **`SlideArrows` disables at the ends rather than hiding.** An arrow that vanishes at slide 1 moves
the one beside it and makes the rep re-aim mid-sentence. Its vertical centring is `top: '50%'` plus a
negative half-height margin — RN has no `translateY(-50%)`, the same rule the inspection viewer's
chevrons record.

### 7. …and then all FOUR fullscreen arrows moved onto it, for two visual defects

⚠️ **The portrait pair carried NO `top` at all.** Two absolutely-positioned siblings with no vertical
anchor fall back to their static flow position inside a `justifyContent: 'center'` container, which is
why the forward arrow appeared off the slide entirely — *"the forward button should not be cut out."*

⚠️ **The landscape next arrow still offset itself by `landscapeRightInset + 48`** to clear the
right-edge Interactive Tools tab — a control deleted two tickets earlier. `SlideArrows` now takes
`leftInset` / `rightInset` separately, because in landscape the two sides are genuinely different: the
cutout is on one, the Android navigation bar on the other, and a single value either clips one arrow or
pushes both needlessly inward.

⚠️ **A disabled arrow dims only its GLYPH — the disc stays at full strength.** It first dimmed the
whole control to `opacity: 0.3`, and a near-black disc at 30 % over the fullscreen slide's BLACK
letterbox is invisible: on slide 1 the back arrow vanished and was reported as *"only one forward and
backward icon is displayed."* Dimming the chevron alone keeps the control present, which is the entire
reason it is disabled rather than hidden — an arrow that disappears at the ends moves the one beside it
and makes the rep re-aim mid-sentence.

⚠️ **The arrows are nearly OPAQUE with a light ring, not the translucent scrim the top bar uses.**
Reported: *"in portrait these forward and backward buttons are not displayed clearly, their background
colour merges into the white background page."* They sit ON the slide, and a slide is arbitrary
artwork — at `rgba(0,0,0,0.45)` a white chevron over a white table was invisible. The ✕ and the page
count get away with a scrim because they sit in the letterboxed BLACK margin with nothing behind them.
The ring carries it the other way: an almost-black disc on an almost-black slide would disappear just as
completely.

### 8. The chrome auto-hides after 3 s, and only a TAP brings it back

Ticket: *"the cross icon, page number, forward and backward buttons and also the bottom UI controls
automatically hide after 3 seconds, and when the user taps on the screen show all the controls and hide
automatically after 3 seconds — and make sure when the user uses the swipe gesture do not show it, show
only when the user taps."*

One effect drives it, re-armed by a `chromeNudge` counter that every deliberate interaction bumps:

```ts
useEffect(() => {
  if (!isFullscreen || !chromeVisible || showGestureTutorial || dockMode === 'tools') return;
  const timer = setTimeout(() => setChromeVisible(false), CHROME_AUTO_HIDE_MS);
  return () => clearTimeout(timer);
}, [isFullscreen, chromeVisible, showGestureTutorial, dockMode, chromeNudge]);
```

⚠️ **Held open while the TOOL panel is showing** (`dockMode === 'tools'`). That panel is content the rep
is reading — inspection photos, the risk report — and timing it out from under them is the one case
where hiding is destructive rather than tidy. It resumes on returning to the slide tabs.

⚠️ **The centre tap TOGGLES** (`toggleChrome`) — chrome up, a tap hides it immediately; chrome down, a
tap brings it back and re-arms the timer.

> ⚠️ **This REVERSES the first pass, which revealed only** (`revealChrome`), on the reasoning that a rep
> who taps while the controls happen to be up would get the opposite of what they asked for, since the
> chrome comes and goes by itself and they cannot know which state they are in. The reporter overruled
> it: *"when user tap UI is displayed, we know after 3 seconds automatically hide — but when user taps
> again the UI hides immediately, apply this also."* Waiting out the 3 s to clear the slide in front of a
> customer is the case that decided it. Do not restore the reveal-only form.

⚠️ **Two distinct helpers, and the split is still the requirement:**
- `toggleChrome` — hides when shown; shows AND re-arms when hidden. Only the slide's single tap calls it.
- `keepChromeAlive` — re-arms ONLY, never reveals or hides. The arrows, category tabs and dock icons call
  it, so a rep working the controls never loses them mid-reach — and, just as important, a tap on a
  CONTROL can never be read as the toggle and take the whole bar away mid-reach.

⚠️ **`handlePrev` / `handleNext` are shared with the SWIPE, so they must stay free of chrome behaviour
themselves.** That is why the arrows go through `handleArrowPrev` / `handleArrowNext` wrappers rather
than the raw handlers — putting the nudge inside the shared handler would put the controls back on every
swipe, which is exactly what the ticket rules out.

~~⚠️ **A swipe cannot reach `toggleChrome` at all**, and not by a check: the swipe is a `Gesture.Pan` with
`activeOffsetX`, and once a pan activates RNGH cancels the tap composed beside it.~~ **WRONG — a swipe DID
reach it, and brought the dock back on every page turn.** The composition is `Simultaneous`, which cancels
nothing; see *"…and a SWIPE still brought the dock back"* below.

⚠️ **Fullscreen only.** The inline card keeps its controls permanently — it is a scrolling page with no
centre tap to bring them back, so the same behaviour there would strand the rep. Its arrows therefore
keep the RAW handlers.

⚠️ **`StatusBar.setHidden(true)` imperatively, as WELL as `<StatusBar hidden />`.** The declarative one
does not reliably win inside a `Modal` — the modal is presented by its own native controller and the
component's value is applied against the screen's stack entry — so the clock and battery stayed over the
slide on device. Restored in the effect's cleanup rather than on unmount, so leaving fullscreen puts the
bar back while the screen behind stays mounted.

⚠️ Needs a device check (this repo cannot render-test): the ✕ and the count in fullscreen portrait,
fullscreen landscape and on the inline card; **no status bar in fullscreen either way, and neither
control touching the notch**; the dock clear of the home indicator; the inline ✕ leaving the pitch book
while the fullscreen one only leaves fullscreen; the centre tap still hiding and restoring the pair; and
the tutorial appearing over a bare slide with no dock, arrows or counter behind it; and on the INLINE
card, a swipe and the new arrows changing slide while a vertical drag still scrolls the page; and — the
regression this last pass fixed — **the fullscreen arrows actually responding**, with a swipe working
anywhere on the slide but NOT while it is zoomed in.

#### …and a SWIPE still brought the dock back — the tap had no movement limit

Ticket: *"the bottom bar should only be displayed by tapping on the screen, but currently when we swipe
the page back and forward the bottom bar is also displayed — show or hide it only on a tap, or hide it
after 3 s automatically."*

The screen side was already right and is unchanged: `handleSlideSwipe` → `handlePrev` / `handleNext`
carry no chrome behaviour, the arrows still go through their wrappers, and `toggleChrome` and the 3 s
auto-hide effect are untouched. **The leak was in `ZoomableImage`'s gesture composition.**

- "Once a pan activates RNGH cancels the tap beside it" holds for `Exclusive` / `Race` — **not** for
  `Gesture.Simultaneous(pan, pinch, taps, swipe)`, which is what lets pinch and the swipe coexist (§6).
- An RNGH `Tap` has **no movement limit unless one is set**: `_maxDistSq = NAN` in `RNTapHandler.m`,
  `MAX_VALUE_IGNORE` in `TapGestureHandler.kt` (checked in the installed 2.32.0).

So a quick swipe lifted inside the tap's default 500 ms `maxDuration` ALSO ended as a successful single
tap: the double tap timed out, the single tap fired, `toggleChrome` ran. With the dock hidden, every page
turn brought it back — and with it showing, a swipe hid it, the same bug from the other side.

Fixed with **`.maxDistance(TAP_MAX_DISTANCE)`** on the single tap. `TAP_MAX_DISTANCE = 10` and the
swipe's activation distance `SWIPE_ACTIVATE_DISTANCE = 15` (previously an inline
`activeOffsetX([-15, 15])`) now sit side by side in the pure `utils/zoom-transform.ts`:

| finger travel | what the touch is |
|---|---|
| up to 10 pt | a **tap** — toggles the chrome |
| 10 – 15 pt | neither |
| over 15 pt horizontally | a **swipe** — turns the page only past `MIN_SWIPE_DISTANCE` (40) |

⚠️ **Keep `TAP_MAX_DISTANCE` below `SWIPE_ACTIVATE_DISTANCE`** or the two overlap again. Pinned by
`__tests__/utils/tap-vs-swipe.test.ts`, which also checks that a tap-sized touch can never turn a page.

⚠️ **Do not "fix" this by making the composition `Exclusive`.** `Simultaneous` is what lets pinch
arbitrate with pan and swipe; the distance limit is the narrow fix and changes nothing else.

Scope: only the fullscreen portrait and landscape viewers pass `onSingleTap`, and without it the single
tap is not in the composition at all — so the inline card and Roofline Deck are unaffected (their
swipe threshold is the same 15). The **double tap was deliberately left without a limit**, so zoom
behaves as before. Intended side effect: a slow or vertical drag on the fullscreen slide no longer
toggles the chrome either — only a touch that stays put does. A swipe with the dock SHOWING now leaves it
alone, and the running 3 s timer takes it down as usual.

⚠️ Needs a device check: with the dock hidden, swipe forward and back repeatedly, fast and slow, in
portrait and landscape — **the dock must stay hidden**; a still tap shows it, a second tap hides it, and
it hides itself after 3 s; a double tap still zooms without flashing the dock; a zoomed slide still pans.

### 9. The four DOCK TOOL tabs are ONE width, not four

> ⚠️ **SUPERSEDED — the equal-width clamp below was REMOVED.** It rested on a misreading: the ticket's
> *"2 small and 2 large screen"* was about the tool **panels** (fixed in the follow-up right below, which
> is kept), not the tab pills. The clamp's 128pt `minWidth` + `flexGrow` left one pill hogging a phone's
> whole strip with the next title cut off, reported as *"the space between … is very extra"*. Tabs are
> content-sized again — see "…and compact tabs with edge arrows" under section 10. The rest of this
> subsection is history; do not reintroduce `TOOL_TAB_MIN_WIDTH`.

Ticket: *"make sure these four tabs have different screen view aspect — make it equal to each other, the
visual layout should be the same in the 4 tabs … I need to fix the width of each tab, currently it's not
looking good, 2 small and 2 large."*

`Inspection` / `Videos` rendered half again as wide as `Risk` / `Notes`, because every tab in
`PresentationDock` sized to its OWN label — which is right for the deck's category tabs (portal-authored,
any number, any length) and wrong for the tools row, which is a **fixed set of four** and reads as one
segmented control.

**`toolTab` is applied to the tool tabs only**: `minWidth: TOOL_TAB_MIN_WIDTH` + `flexGrow: 1` +
`justifyContent: 'center'`, with `flexGrow: 1` on the scroll content **in tools mode only**.

⚠️ **`minWidth` is what makes them equal; `flexGrow` only shares out what is left.** The min clamps every
tab to the SAME flex base — `Risk` is widened up to `Inspection`'s natural width — and equal grow factors
then split the remaining space evenly, so all four land on one number. `flexGrow` alone would preserve
the difference, since grow distributes free space on TOP of each tab's own content width.

⚠️ **`TOOL_TAB_MIN_WIDTH` (128) is the WIDEST label's natural width** — `Inspection` at 13.5pt semibold,
plus its 15pt icon, that icon's 6pt margin and the tab's padding, with a little allowance. A longer tool
label added to `DOCK_TOOLS` without widening it would exceed the clamp and grow past the other three,
which is the exact defect this fixes. The label is capped at `numberOfLines={1}` so a tablet's font
scaling truncates rather than reflowing the row.

⚠️ **The narrow case still reads correctly.** In portrait the four cannot fit, free space is negative and
`flexGrow` does nothing — but RN's default `flexShrink` is **0**, so each tab holds its 128 and the row
simply scrolls. Equal either way; the only difference is whether the set fills the bar (landscape) or
scrolls (portrait).

⚠️ **The CATEGORY tabs are deliberately untouched.** Their count and labels come from the portal, so a
shared width would either truncate a long section name or strand a deck of two categories across the
whole bar. `toolScrollContent`'s `flexGrow` is gated on `toolsMode` for the same reason, preserving the
existing rule that few categories left-align against the divider rather than stretching.

⚠️ Needs a device check (this repo cannot render-test): the four tabs equal in fullscreen LANDSCAPE
(filling the bar) and in PORTRAIT (equal, scrolling), with the active pill still reading as the selected
one and each tab's icon+label centred in it.

#### …and the PANEL each tab opens is one height too

Follow-up: *"the inspection and video tab view is same but the Risk and the notes are not equal to that
— make sure when user clicks on it, it contains the same space area as used for the inspection or video
tab."* The tabs were now equal; the **body** each one opened was not.

`toolPanel` carried **`maxHeight`**, so it sized to whatever the selected tool rendered and only stopped
at the cap. Inspection (a photo grid) and Videos (a 44pt icon over its empty state) both reach it; Risk
and Notes are short, so the dock **collapsed to their content** and the whole bar changed height as the
rep moved between tabs — four differently-sized screens from one control.

**`maxHeight` → `height`, and the prop renamed `maxToolHeight` → `toolHeight`.** The rename is the point:
it is no longer a cap, and a future reader passing a "max" would reintroduce exactly this.

⚠️ **The scroller had to be told to fill it** (`toolScroll: { flex: 1 }`). A `ScrollView` with no flex
inside a fixed-height parent still sizes to its OWN content, so Notes would have left dead panel beneath
it — visually right but deaf to a drag. `flexGrow: 1` on the content container keeps a short body at the
top of that area rather than stretching its card down the panel.

⚠️ **The height is unchanged** (52 % landscape / 46 % portrait) — this makes the short tools match the
tall ones, never the other way round, so the slide keeps exactly the room it had.

⚠️ **The non-fullscreen drawer is untouched.** It has its own `drawerHeight` and was already fixed at
70 % (portrait) — which is why this only ever read as wrong on the dock.

`Pitchbook/index.tsx` drops one `react-native/no-inline-styles` (the panel's `{ padding: 16 }` moved into
`dockStyles`) to 46 problems / 12 pre-existing errors; `PresentationDock.tsx` stays eslint-clean and tsc
is 49 with nothing in a pitch-book file.

⚠️ Needs a device check alongside the tabs: switching Inspection → Risk → Notes → Videos without the
dock resizing, and Inspection's photo grid still scrolling inside that area.

#### …and one typography scale for all four, with Risk's white bar finally dark

Follow-up: *"make sure the text used in these four tabs should use the same font, same colour and size —
heading text colour for all the tabs the same and the hint text colour also the same; and the Risk report
bar that gives the 1,2,3,4 years information is white, make sure this bar is in the black theme too."*

**The dock now has THREE named text roles** (`DOCK_TEXT`, exported from `screens/Pitchbook/index.tsx`) —
`heading` `#FFFFFF`, `body` `rgba(255,255,255,0.86)`, `hint` `rgba(255,255,255,0.55)` — plus `surface` /
`surfaceBorder` / `glyphWell` / `glyph` for anything the dock draws. Before this the four tabs carried
**two heading treatments and three different greys** between them: Notes' body was `0.86`, Videos' empty
state `0.55`, and Risk used themed NativeWind classes (`text-text-primary`, `text-slate-400`,
`text-slate-500`, `text-gray-400`) that resolve near-BLACK in light theme.

- `DOCK_HEADING_TEXT` / `DOCK_HINT_TEXT` are single objects spread into the styles that need a margin,
  so `heading` (stacked above a body) and `headingRow` (Risk's, in a row that already owns the gap)
  cannot drift in colour, size or weight.
- **Risk had no dock heading at all** — the other three each open with one. Its own `Report` title now
  takes `headingRow` on the dock, so all four read as the same typography.

**`RiskContent` takes a `dark` prop; it does NOT read the theme.** ⚠️ It is rendered from **two** call
sites in this screen — the dock (dark in BOTH app themes) and the non-fullscreen drawer (themed, usually
white) — so a theme test would get the drawer right and the dock wrong. `dark` defaults **false**, which
is byte-for-byte the drawer's previous look; only the dock passes it. Every colour goes through one `t`
token block: card fill and border, the glyph well and its alert icon, the `Risk Report` label, the
progress **track** (was `bg-slate-100`), the `%` and step captions, `Generated History`, and the history
rows (was `bg-white border-slate-100`).

**The reported white slab is the report card itself** — it painted `backgroundColor: colors.background`,
which is WHITE in light theme, so the bar carrying the year picker sat as a white block in the middle of
a dark panel in front of a customer.

**`YearDropdown` gained the same opt-in `dark`** (`widgets/components/YearDropdown.tsx`). ⚠️ It is
hardcoded white — trigger AND the popup panel — and has **three** callers (Lead Center, Roofline Deck,
Pitch Book), so the prop defaults to the light look and only the dock's Risk tab asks for dark. Its
`ChevronIcon` took a `color` prop for the same reason. The dropdown rows, their selected fill and the
panel border all move together, or the open list would be a white sheet over a dark trigger.

⚠️ **`InspectionPhotosPanel` is deliberately NOT darkened.** Its white cards are photo frames — dark-on-
white captions are correct against a photo, and the panel is shared with the light drawer and the
Roofline Deck. The rule that changed is the copy **the dock itself owns**.

⚠️ **`screens/RooflineDeck/index.tsx` has its own COPY of `RiskContent`** (and its own `YearDropdown`
call) and was left alone — it has no dock, so it is never on a dark ground. If a dock is ever added
there, that copy needs the same prop rather than a second set of colours.

⚠️ Noted, NOT changed: `YearDropdown`'s list is a native `Modal`, and on the dock it opens **inside** the
fullscreen presentation Modal — the stacked-native-modal hazard this file documents for the CoC signature
pad. It predates this ticket and is reached only by tapping the year picker; if it misbehaves on iOS, make
it an in-panel overlay rather than a Modal.

⚠️ Needs a device check: the Risk tab with **no** white anywhere — card, year picker, its open list, the
progress track and the history rows — and the four tabs' headings and hint text matching; then the
**drawer** (non-fullscreen Tools) and the Lead Center's own year picker confirmed unchanged and still light.

#### …and ONE empty state for every tool — Inspection's was a different font

Follow-up, with screenshots of both tabs on a new lead: *"the font used in the inspection photo tab and
the font used in the videos are still not the same — on inspection the font is bold but in the video tab
the font is regular; we need bold in both screens"*, then *"see the hint text"*.

⚠️ **The headings were already identical** (both `dockStyles.heading`) — the difference was the **empty
state**, which is all either tab shows on a lead with no photos. Two different ones were on screen:

| tab | empty state | title | hint |
|---|---|---|---|
| Inspection | `InspectionPhotosPanel`'s OWN block | **`font-bold`**, themed grey, whole block `opacity-50` | 10px, dimmer still |
| Videos | the dock's `emptyText` | *(none)* — a single **regular** line | — |

**New `DockEmptyState`** (screen-local, beside `dockStyles`): icon at `DOCK_TEXT.hint`, a **bold**
`emptyTitle` (`DOCK_TEXT.body`, 14 / `700`) and a regular `emptyText` hint (`DOCK_HINT_TEXT`, 13). Both
tabs render it, so the title weight and the hint colour/size cannot differ between them again.

⚠️ **The dock decides Inspection's emptiness itself** (`hasInspectionPhotos`, via the pure
`buildInspectionSections` the panel already uses) rather than letting the shared panel draw its own. The
panel's empty state is a light-theme block and the panel is shared with the light drawer and the Roofline
Deck, so restyling it there would have changed three screens to fix one. Same builder, so the dock and the
panel cannot disagree about whether there is anything to show; with photos, the panel renders exactly as
before.

⚠️ **Videos gained a title — `No videos available` — so it has a bold line to match.** Its existing
sentence (*"Video content goes here. This area is scrollable."*) is kept verbatim as the hint. That copy is
still placeholder text (there is no video source behind this tab at all); it was left alone because
rewriting it would be inventing product copy.

⚠️ Needs a device check: on a lead with no photos, Inspection and Videos showing the same bold title and
the same hint colour and size, neither dimmed; and on a lead WITH photos, the Inspection grid unchanged.

### 10. The tab strip follows the deck — `useTabStripAutoScroll`

Ticket: *"apply the auto scroll on the bar if user pass the pages, and the bottom bar also moves according
to the page number that is linked with the bottom bar … if the user is on page 15 but the bottom view is
still on the heading 1 from the bottom, that is wrong."*

⚠️ **The STATE was already correct — only the scroll position was wrong**, which is why this reads as a
navigation bug and is not one. `handleNext` advances `activeCategory` when the rep pages past a section's
last slide, so the right tab really was highlighted; the strip is a horizontal `ScrollView` and **nothing
ever moved it**, so on page 15 the live tab sat off-screen to the right while the bar still showed
section 1. Do not go looking in the paging handlers.

**New `src/hooks/useTabStripAutoScroll.ts`** returns `{ ref, onLayout, onContentSizeChange, onTabLayout }`;
each tab reports its own box through `onTabLayout(id)` and the hook scrolls the active one into view.

⚠️ **A hook rather than a copy in each bar, because there are TWO strips with this duty** — the fullscreen
dock and the inline card's category bar, which gained swipe and arrows in the pass above and therefore
rolls between sections exactly the same way. Two copies is precisely how the landscape and portrait
presentation bars drifted apart before the dock replaced them.

⚠️ **`scope` is not decoration.** The dock renders categories OR tools into the **same** scroller, so boxes
are keyed `cat:<id>` / `tool:<id>`; unprefixed, a tool could read a stale category's box on the frame after
a mode switch and scroll to an offset that means nothing in the row now on screen.

⚠️ **`onTabLayout` re-reveals when the ACTIVE tab measures**, and that is the half without which this
silently does nothing on arrival: at first paint (and after a set swap or a rotation) the effect has
already run for that `activeId` with no box recorded, and nothing re-runs it. That call is deliberately
**un-animated** — it is the resting position, not a move the rep should watch.

⚠️ **The centre is CLAMPED** to `[0, content − viewport]`, so the first and last tabs stay flush against
their ends instead of floating in from the edge. The clamp is skipped while the content width is still
unknown rather than clamping to `0`, which would pin every early call to the far left.

⚠️ The hook holds viewport/content widths in **refs, not state** — they are read during a scroll, never
rendered, and as state each layout pass would re-render the whole dock.

⚠️ Needs a device check: page forward through a whole section in fullscreen and watch the dock bar carry
the active tab along (and back again on reverse), the same on the inline card, the first and last sections
sitting flush rather than centred, and the tools row still landing on the selected tool after a mode switch.

#### …and compact tabs with edge arrows

Follow-up, with the portrait screenshots: *"the space between Inspection, Risk, Videos and Notes is very
extra — when we select any one the other title is not shown. Fix the size and space, and also add an
arrow so the user understands that some headings are also available on the back side or forward side."*
The active `Inspection` pill filled the strip and `Risk` was cut to `Risl`.

**The equal-width clamp is gone** (`TOOL_TAB_MIN_WIDTH`, `toolTab`, `toolScrollContent` deleted — see the
superseded note on section 9). Every tab, tool or category, is sized to its own label with the SAME tight
padding, so the gap between any two neighbours is identical and the selected tab's neighbours stay on
screen:

| | before | now |
|---|---|---|
| tab | 128pt min + grow, `paddingHorizontal: 14`, h 38, `marginRight: 4` | content-sized, `11`, h 34, `2` |
| label / icon | 13.5pt / 15pt, gap 6 | 13pt / 14pt, gap 5 |
| bar padding / divider margin / ✕ | 10 / 10 / 36 | 8 / 8 / 32 |

The chrome trims give the strip back ~12pt on a phone — which matters there, since the mode well,
divider and ✕ already take ~140pt of a ~366pt card in tools mode.

⚠️ **The CATEGORY tabs got the same size change**, deliberately — it is one `tab` style for one scroller,
and a slides row at the old size beside a tools row at the new one would be two designs in one bar.

**Edge arrows.** `useTabStripAutoScroll` now also returns `onScroll`, `step(direction)`,
`canScrollBack` and `canScrollForward`. A chevron sits over each end of the strip **only while the strip
can scroll that way**, so at either end — or when every tab fits, as in landscape — nothing claims there
is more. A tap moves 70% of the visible width (`STEP_FRACTION`): far enough to bring the hidden neighbour
fully in, not so far the rep loses their place.

- ⚠️ **The arrows are OVERLAYS, not flex siblings.** As siblings they would take width only while visible,
  so the strip would resize each time one appeared at an end — re-measuring the tabs mid-scroll and moving
  the target under the rep's finger. Their fill is the card's own colour, so a label passing beneath is
  hidden rather than showing through the chevron.
- ⚠️ **`onScroll` must be wired with `scrollEventThrottle`** or the two flags never leave their first
  value. The hook sets state **only when a flag flips** — it runs every scroll frame, and an
  unconditional `setState` there would re-render the whole dock ~60×/s during a drag.
- ⚠️ The flags use a 2pt `EDGE_EPSILON`, because a scroll offset at rest is rarely exactly `0` or exactly
  the maximum; without it an arrow could stay lit at the very end it points past.
- The inline card's category bar uses the same hook but **does not render arrows** — the ticket was the
  dock. It is two `TouchableOpacity`s away if wanted there.

⚠️ Needs a device check (portrait especially): the selected tool's neighbours visible beside it; the right
arrow present on first open and the left one absent; both arrows stepping the strip and disappearing at
their ends; no arrows at all in landscape when every tab fits; and the category row reading the same size.
