# REVUIUX-483 — revRender Lighting: implementation plan

**Status:** PLAN ONLY — nothing built yet. Written 1 Oct 2026 for review before any code.
**Sources read:** the backend guide (`revrender-lighting-api-integration.md`), the 13-page UI/UX
handoff PDF (11 screen mockups, decoded and read), and the current screen
(`src/screens/RevRender/index.tsx`, 1594 lines, CRLF).

---

## 0. Read this first — two corrections to the brief

**① The backend guide's premise is false for this repo.** §0 says *"the UI layer is already built…
everything in `src/screens/RevRender/lighting/` and `src/utils/revrender-lighting/` is pure state and
rendering"* and §2 says `toBatchBody` *"already builds the render request correctly"*.

None of that exists here:

| Path the guide assumes | Reality |
|---|---|
| `src/screens/RevRender/lighting/` | **does not exist** |
| `src/utils/revrender-lighting/payload.ts` (`toBatchBody`) | **does not exist** |
| `src/constants/revrender-looks.json` (357 looks) | **does not exist** |

Checked on every local branch. The guide was written against a different working copy (likely the
web app, or a branch not shared with us). **The entire UI layer and the 357-look catalogue are ours
to build.** That is the bulk of this ticket — the API wiring it describes is the small part.

⚠️ This changes the estimate materially. Anyone reading only the backend guide will expect a
two-day wiring job.

**② The look catalogue data does not exist yet either.** The guide says it is "bundled in the app".
It is not, and the ticket references *"CSV with colors and pre sets"* that has not reached this
repo. **We cannot build the Seasons/Teams browser without it.** See §7 — this is the one true
blocker.

---

## 1. What the ticket asks for

> *"Do not change our current rev render flow. We are only adding onto it… We are NOT changing any
> of our core products (gutters, soffit, fascia, downspouts) this is an ADDITIONAL SECTION"*

So: a second configuration mode on the existing photo-config screen. Core Products keeps every
current behaviour, byte for byte. Roofline Lighting is a parallel panel that feeds the **same**
render queue and the **same** generate call.

---

## 2. What the design actually specifies (from the PDF)

The 11 mockups, in flow order:

1. **Core Products** (unchanged) with a new segmented toggle above the config card.
2. **Roofline Lighting** panel — "Each one you pick becomes its own render. Channel matches your
   existing trim, shown at dusk."
3. Favourites strip ("Hold a look to favorite") + **Recently Rendered** ("Last 2").
4. **Browse looks**: `Seasons | Teams | Custom` sub-tabs, with a count badge on Seasons.
5. Seasons tab: **EVERYDAY** (Warm White, Cool White, Multicolor) then **SEASONS & HOLIDAYS**
   "by month" — New Year's, Mardi Gras, Valentine's, St. Patrick's, Easter, Cinco de Mayo, Memorial
   Day, Patio Parties, Pride, Fourth of July, Purple Heart Day, NFL Kickoff, Breast Cancer
   Awareness, Halloween, Thanksgiving, Veterans Day, Christmas, Hanukkah.
6. **NOW / NEXT badges** on seasonal tiles (NFL Kickoff = NOW; Breast Cancer + Halloween = NEXT).
7. Teams tab: search field, **NEAR YOU** (Tampa, FL), then league sections with a "Browse all"
   sheet — NFL 32, MLB 30, NHL 32, NBA 30, MLS 29, WNBA 12, SEC 16, Big Ten 18, Big 12 16, ACC 18,
   plus "COLLEGE · MORE".
8. **Long-press → "Favorite"** tooltip over a tile.
9. Custom tab: "New custom look" dashed tile + explainer *"Presets stay locked so team and holiday
   colors stay accurate."*
10. Custom look sheet: name field, **dusk preview strip** ("pucks every 9 in"), **COLORS · UP TO 6**
    swatch row with a colour-wheel + brightness picker (`#FF3960`), Cancel / Save look.
11. **"N renders selected"** list — each row has thumbnail, name, "Alternating", a favourite star and
    an × — then `+ Add N Render Combos`.
12. **Render Queue** with per-item `CORE` and `LIGHTING` pills, and `Generate 4 Renders`.

Plus, from the ticket comment, **two first-time photo-guidance popups**:
- → Core Products: *"Get in close for best results"*, two close-up roofline examples.
- → Roofline Lighting: *"Zoom out for best results"*, one full-home example.
- Each with **"Got it"** and **"Got it, don't show me this again"**.

---

## 3. How it maps onto the existing screen

`RevRenderScreen` is a three-state machine — `status: 'grid' | 'config' | 'queue'` (line 316). The
whole feature lands inside `'config'` and adds rows to the existing `renderQueue`.

| Existing seam | Line | What changes |
|---|---|---|
| `renderConfig()` | 1090 | Add the mode toggle at the top; branch to the lighting panel |
| `INITIAL_CONFIG` | 165 | Untouched — lighting state is separate, not merged in |
| `handleAddToQueue` | ~495 | Gains a lighting path pushing one queue item **per selected look** |
| `renderQueue` | 321 | Items gain `kind: 'core' \| 'lighting'` |
| `handleGenerateAll` | 529 | Per-item payload branch (§5) |
| `renderQueueView()` | 1445 | CORE / LIGHTING pill; lighting rows show look + channel |
| `MATERIAL_SECTIONS` | 138 | **Untouched** |

**Nothing in the Core path is modified.** The toggle defaults to Core, so a rep who never touches
Lighting sees the current screen exactly as it is today.

### New files (keeping the 1594-line screen from growing unmanageably)

```
src/screens/RevRender/lighting/
  LightingPanel.tsx        — mode panel: favourites, recent, browse tabs
  LookGrid.tsx             — tile grid + NOW/NEXT badges + long-press favourite
  TeamsBrowser.tsx         — search, Near You, league sections, Browse-all sheet
  CustomLookSheet.tsx      — name, dusk preview, up-to-6 colours, wheel
  SelectedLooksList.tsx    — "N renders selected" rows
  PhotoGuidanceModal.tsx   — the two first-time popups
src/utils/revrender-lighting/
  payload.ts               — toBatchBody() — the name the backend guide expects
  looks.ts                 — allLooks(), grouping, NOW/NEXT, search
  season-window.ts         — pure date → NOW/NEXT (testable)
  favorites.ts             — MMKV-backed favourites + recents + custom looks
src/constants/revrender-looks.json   — the catalogue (BLOCKED, §7)
```

⚠️ **Jest cannot load React Native here.** So every rule that can be tested — NOW/NEXT windows,
payload construction, search/filtering, the 6-colour cap, hex validation — goes in
`src/utils/revrender-lighting/*.ts` and is tested there. The `.tsx` files stay presentational.
This is the pattern used throughout the part files and it is why `season-window.ts` is split out
from `looks.ts`.

---

## 4. State shape

Lighting state is **parallel to `config`, never merged into it** — that is what keeps the "do not
change the current flow" promise structurally rather than by care:

```ts
const [renderMode, setRenderMode] = useState<'core' | 'lighting'>('core');
const [selectedLooks, setSelectedLooks] = useState<Look[]>([]);   // order = queue order
const [lookTab, setLookTab] = useState<'seasons' | 'teams' | 'custom'>('seasons');
```

A `Look`:

```ts
type Look = {
  id: string;            // → lookId
  name: string;          // → lookName
  group: 'everyday' | 'season' | 'team' | 'theme' | 'custom';   // → lookGroup
  colors: string[];      // → colors, 1–6 hex
  league?: string;       // Teams grouping only
  month?: number;        // NOW/NEXT only
};
```

---

## 5. Payload — the one real correctness trap

Today every queue item is serialised by one `payloads.map` (line 550) that always sends
`textureImageUrls` and `sourceFileName` and **never sends `renderType`**.

Per the backend guide §8, a Core-shaped payload sent for a look returns
**`400 lookId is required`**, and a lighting payload without `renderType` hits
`selections.fascia is a hex colour; send renderType…`.

So the map must **branch on the item kind**:

```ts
const payloads = renderQueue.map((item) =>
  item.kind === 'lighting'
    ? {
        renderType: 'look',
        houseImageUrl: extractS3Key(rawUrl),
        houseMimeType: 'image/jpeg',
        selections: {
          lookId: item.look.id,
          lookName: item.look.name,
          lookGroup: item.look.group,   // ⚠️ §5 of the guide — see below
          colors: item.look.colors,
        },
        viewLabel: item.viewLabel || item.photo?.label || '',
        leadId,
      }
    : { /* ...exactly today's object, untouched... */ }
);
```

⚠️ **Do NOT send** `prompt`, `houseDimensions`, `pattern`, `timeOfDay`, `channel`, `coverage`. The
last four are **400-rejected** if they differ from the server constants — deliberately, so a future
spec change cannot pass silently. `pattern` is derived server-side from the colour count, which is
why the UI can label a look "Alternating" without sending it.

⚠️ **Do not send `textureImageUrls` / `sourceFileName` on a lighting payload** — they are Core-only
and are what makes a lighting payload read as Core-shaped.

⚠️ **`lookGroup` must always be sent.** The backend withholds the look *name* from the image model
for `team`, `theme` and `custom` (team colours only — never logos or names; 483 §13 flags the 268
club names for legal review). An omitted group **fails safe to withholding**, so forgetting it
silently degrades `everyday`/`season` renders where the name is useful art direction. Showing the
name in our UI is correct and expected — this is only about the prompt.

**One look = one queue item = one render.** Three looks selected is three entries, never one entry
with three looks. Core and lighting payloads mix freely in one batch; the worker routes per job.

### Unchanged
`leadsApi.generateRevRender` (`src/services/api/leads.ts:325`) already posts to
`/rev-render/v1/batches` and passes the body through — **no new service method for rendering**.
Polling (`getRevRenderBatchStatus`) and the progress UI are identical to Core. The envelope
`{ payloads, leadId, jobId }` and the `onGenerateAll` callback into `LeadCenter`
(`src/screens/LeadCenter/index.tsx:1643`) do not change shape.

---

## 6. Build order

Each phase is independently shippable and leaves the Core flow working.

**Phase 1 — the toggle and the seam (no catalogue needed).**
Segmented control, `renderMode` state, lighting panel shell, `kind` on queue items, the branched
payload map, CORE/LIGHTING pills in the queue. Verifiable end-to-end with **three hardcoded
everyday looks** (Warm White, Cool White, Multicolor) — enough to prove a real render round-trips
before any catalogue exists. **This is the phase that de-risks the ticket and it is not blocked.**

**Phase 2 — photo-guidance popups.** Self-contained, no API. Needs the three example images from
design. Dismissal is device-local for TestFlight (§7).

**Phase 3 — Seasons tab + NOW/NEXT.** Needs the catalogue. `season-window.ts` is pure and testable.

**Phase 4 — Teams tab.** Search, league sections, Browse-all sheet. Needs the catalogue.
**"Near you" is excluded** — see §7.

**Phase 5 — Custom looks.** Sheet, colour wheel, up-to-6 cap, dusk preview, MMKV persistence.

**Phase 6 — Favourites + Recently Rendered.** Long-press to favourite, "Last 2" strip.

---

## 7. Blocked / open — decide before the phases that need them

| Item | State | Consequence |
|---|---|---|
| **Look catalogue (357 looks)** | ❌ **not in the repo.** The ticket's CSV has not reached us | **Blocks phases 3 and 4.** Phase 1 proceeds with three hardcoded looks |
| **"Near you"** | ❌ **blocked, not merely unbuilt.** 483 §10 specifies it against a static table of `lookId` / league / venue lat-lng / state. **That table does not exist** — the catalogue CSV has no coordinates | Ship Teams **without** Near You. The mockup shows it, so this needs saying out loud to the client, not quietly dropping |
| **Guidance-popup dismissal** | ❌ no endpoint. Lance specified **"per rep account"**, which device-local MMKV does not satisfy | Device-local for TestFlight, flagged as a known divergence. A reinstall or a second device re-shows it |
| **Favourites / Recents / Custom looks** | ❌ no endpoint; 483 §13 leaves per-rep vs per-office open | Device-local. ⚠️ **A rep who builds five high-school palettes loses them on reinstall** — worth confirming that is acceptable for TestFlight |
| **Recently Rendered** | Derivable from `GET /runs` (distinct `selections.lookId`, newest first) | Prefer deriving it — it also settles 483's "record at Add or at Generate?" question for free, and survives reinstall |
| **Prompt RR-PL-001 v1.5** | Two paragraphs provisional pending sign-off | Payload contract is unaffected; integrate now, but **renders made before sign-off are not final** — do not use them for client approval |
| **Three guidance images** | Needed from design | Blocks phase 2 only |

---

## 8. Things that will bite (traps for whoever builds this)

- ⚠️ **`src/screens/RevRender/index.tsx` is CRLF.** Scripted edits must read *and* write binary, or
  the whole file reflows to LF and buries the change in a whole-file diff.
- ⚠️ **The colour wheel needs a library decision.** Nothing in the repo draws one today. A new
  native dep means a pod install and an Android rebuild — and `yarn.lock` is gitignored here, so
  the version does not reach other machines through a lockfile. Prefer a JS/SVG wheel
  (`react-native-svg` is already a dependency) over a native module.
- ⚠️ **Never stack native `Modal`s.** The custom-look sheet opens from inside the config screen and
  the colour picker opens from inside *that*. iOS silently drops a presentation requested while
  another modal is dismissing. The picker must be an **in-card overlay**, not a second `Modal`.
- ⚠️ **A flash raised from inside a `Modal` renders behind it** — the "Saved and selected" toast in
  mockup 10 must use `ModalFlashHost`, not a bare `FlashMessage`.
- ⚠️ **`useSafeAreaInsets()` reads 0 or stale inside a `Modal`** — apply floors in the sheets.
- ⚠️ **Dusk preview tiles are decorative.** They are gradient+dot drawings, not renders. They must
  not imply the output; the strip already says "Dusk preview · pucks every 9 in".
- ⚠️ **NOW/NEXT must be computed, never stored.** A stored badge goes stale silently. Derive from
  the device date in `season-window.ts`, and test the boundaries (a NEXT that never becomes NOW is
  the failure mode).
- ⚠️ **Offline.** `handleGenerateAll` already refuses offline via `offlineBlockFor('revrender', …)`.
  Lighting inherits that, but **browsing the catalogue and building custom looks should still work
  offline** — the catalogue is bundled and favourites are local. Only generate is gated.
- ⚠️ **The 6-colour cap is a server 400** (`at most 6 colours`), so enforce it in the UI *and* keep
  the server message visible if it ever slips through.
- ⚠️ **Photo orientation and prompt building are server-side.** Do not send `houseDimensions` — a
  client reading EXIF-tagged dimensions reports the stored size, which is the original bug.

---

## 9. What I need from you before building

1. **The look catalogue CSV** (357 looks: id, name, group, colours, league). Phases 3–4 cannot start
   without it. ← *the one hard blocker*
2. **Confirmation that "Near you" ships disabled** in the first TestFlight, since the location table
   does not exist. The mockup shows it, so the client will look for it.
3. **The three guidance images** (two close-up roofline, one full-home).
4. **Accepted for TestFlight?** — favourites, custom looks and popup dismissal are device-local and
   lost on reinstall, against Lance's "per rep account".

With phase 1 unblocked, I can have the toggle, the queue split and a real lighting render working
end-to-end before the catalogue lands.
