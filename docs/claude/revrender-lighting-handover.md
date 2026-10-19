# REVUIUX-483 — Roofline Lighting: mobile handover

**1 Oct 2026.** Everything below is already working against the local backend and
a physical device. Take the files as-is, or rebuild from this spec — the
decisions and gotchas are the parts worth reading either way.

Companion docs:
- `revrender-look-catalogue-api.md` — the catalogue endpoint
- `revrender-lighting-api-integration.md` — render + share endpoints

---

> ## ⚠️ Reconciled against this branch — 1 Oct, mobile
>
> This handover was written against its author's working copy. Checked item by
> item on `dev-qs-offline`; **the UI and logic files all exist and match**. Four
> things did not, and are now resolved:
>
> | Claim | Reality on this branch | Action |
> |---|---|---|
> | "`babel.config.js` … already fixed on the branch" | **The plugin was absent.** Reanimated 4.4.1 + worklets 0.9.1 installed, no plugin — exactly the launch SIGABRT the doc warns about | **Added** `react-native-worklets/plugin`, verified it transforms a `'worklet'` function |
> | Glow is "three absolutely-positioned translucent halos … works on both" | **Still iOS-only `shadowColor` + grey `elevation: 4`** | **Rewritten** to the three halos the doc specifies (3.2×0.10, 2.2×0.16, 1.5×0.30) |
> | Channel band ("the mock has it") | **Missing** | **Added**, absolutely positioned so it cannot affect layout |
> | `leads.ts` has `getRevRenderLooks` | **Not present.** `shareRevRenders` and `revokeRevRenderShare` are | Catalogue is still the bundled JSON — see below |
>
> **The catalogue endpoint is not wired.** §3's "catalogue load/cache/refresh",
> `hydrateFromCache()` and `refreshCatalogue()` do not exist in `catalog.ts`; it
> reads the bundled JSON synchronously and says so in its own header comment. The
> 357-look seed is therefore the only source, not a fallback. `allLooks()` is
> still the seam, as intended — nothing needs restructuring to add fetching.
>
> Also superseded since writing: the tile aspect in §4 is now **1.54** (strip
> height 64), and §7's "photo-guidance example images … still needed" is **done** —
> three images are bundled in `src/assets/images/revrender-guidance/`.

---

## 1. What this is

A second render mode inside revRender. The rep picks a **look** and nothing else:
no components, no cover type, no channel colour, no Lights Off, no time of day.
The channel matches the home's existing trim, the scene is always dusk.

**Core Products must stay pixel-identical.** The only change to it is the mode
switch above it, and a `CORE` tag on its queue rows.

---

## 2. Files

### Logic — `src/utils/revrender-lighting/` (pure TS, no RN imports)

| File | What it holds |
|---|---|
| `types.ts` | `Look`, `LookGroup`, `LookPattern`, `LookTab`, `CustomLook` |
| `catalog.ts` | catalogue load/cache/refresh, tab + category grouping, month ordering, Now/Next tags |
| `colors.ts` | hex helpers, the dark-colour rule, HSV ↔ hex for the wheel, `patternFor()` |
| `search.ts` | normalise + match for team search |
| `selection.ts` | selection, favourites, recents, Add-button state |
| `payload.ts` | render payload builder |

### UI — `src/screens/RevRender/lighting/`

| File | What it is |
|---|---|
| `ModeSwitch.tsx` | Core Products \| Roofline Lighting, under the photo |
| `LightStrip.tsx` | the mini light strip on every tile (+ unlit variant) |
| `LookTile.tsx` | one tile: strip, name, tick, star, Now/Next |
| `LightingPanel.tsx` | the whole config area — Quick picks, 4 tabs, selected box, Add |
| `CategorySheet.tsx` | league / category bottom sheet, with filter |
| `CustomLookSheet.tsx` | custom look builder (SVG colour wheel) |
| `ResultsPanel.tsx` | finished renders + send actions |
| `SendToHomeownerSheet.tsx` | text/email send sheet |
| `PhotoGuidanceModal.tsx` | the two first-time photo tips |

### Touched

- `src/screens/RevRender/index.tsx` — +~150 lines: mode state, panel mount, queue
  rows, results view, lighting branch in `handleGenerateAll`
- `src/services/api/leads.ts` — `getRevRenderLooks`, `shareRevRenders`, `revokeRevRenderShare`
- `src/constants/revrender-looks.json` — 357-look bundled **fallback seed**
- `src/widgets/modals/CustomCameraModal.tsx` — **temporary** gallery import (see §6)

---

## 3. Decisions worth keeping

**The catalogue accessors stay synchronous.** `catalog.ts` holds the looks in a
module-level value; `hydrateFromCache()` and `refreshCatalogue()` update it, and
the panel forces one re-render. Making `allLooks()` async would have rippled
through every consumer for no benefit.

**Keep the bundled JSON as a fallback.** On a rep's first ever open, with no
cache and a failed request, the alternative is an empty lighting screen.

**Tile previews are drawn, not images.** `LightStrip` renders coloured Views from
the look's hex values, so a new catalogue look gets a preview with no asset work.

**Send `lookGroup` on every render.** It decides whether the look's name reaches
the image model — team, theme and custom names must never, because the catalogue
carries 268 club names plus Marvel and DC. Omitting it makes the server withhold
the name, which is safe but loses seasonal art direction.

**`expandCombo` needs the current queue.** AC 5 (no duplicate Lights Off) is
enforced client-side only; omit the `existing` argument and the dedupe silently
does nothing. The backend does NOT dedupe — two identical payloads are two
renders and two charges.

**Pad partial grid rows.** `justify-between` spreads a 3-tile row across the full
width so it won't share columns with the 18-tile row below. Pad to a multiple of
the column count with invisible spacers.

---

## 4. Matching the mock

Measured off Lance's mock, these were wrong first time:

| | Value |
|---|---|
| Tiles per row | **3** (not 4) |
| Rows of lights per tile | **1** (not 2) |
| Tile aspect | **~1.87** — strip height 54 at 31% width |
| Section header | **"SEASONS & HOLIDAYS"** with a right-aligned **"by month"** hint |
| Channel band | a faint track behind the pucks with a lit top edge — the aluminium channel. Easy to miss; the mock has it |

---

## 5. Gotchas that cost time

**Glow does not work with shadows on Android.** `shadowColor` / `shadowOpacity` /
`shadowRadius` are iOS-only; Android has `elevation`, which is a grey drop shadow.
The glow is three absolutely-positioned translucent halos (3.2× @ 0.10, 2.2× @
0.16, 1.5× @ 0.30) behind each puck, so it works on both. They must not affect
layout — the dark gaps between pucks are the product.

**`babel.config.js` was missing the worklets plugin.** Reanimated 4 moved worklet
transformation into `react-native-worklets`, so the plugin renamed from
`react-native-reanimated/plugin`. Without it the app SIGABRTs on launch with
`getValueUnpacker: assertion failed`. Already fixed on the branch — don't drop it.

**`lightningcss` ships no platform binary after some installs.** Metro then fails
to start at all (NativeWind → react-native-css-interop → lightningcss). Fix:
`npm i lightningcss-linux-x64-gnu@<version> --no-save`.

**`src/screens/RevRender/index.tsx` is CRLF.** Any script that rewrites it must
preserve that, or git shows the whole 1600-line file as changed.

**`*.test.ts` is gitignored** in this repo, so the 36 tests I wrote don't travel
with the branch.

---

## 6. Temporary — remove before release

`CustomCameraModal.tsx` has a gallery-import button beside the shutter, behind:

```ts
const ALLOW_GALLERY_IMPORT = true;
```

It exists so QA can render against known photos rather than photographing real
houses. It is in the INSPECTION camera (shared by `DynamicInspectionView` and
`TagPhotoModal`), not revRender — revRender only selects existing photos. Flip
the flag to remove it from both.

---

## 7. Not built

- **"Near you"** — blocked, not unbuilt. 483 §10 needs a static team location
  table (lookId, league, venue lat/lng, state) and no such data exists.
- **Favourites / recents / custom looks persistence** — device-local; no endpoint
  yet, pending a product decision.
- **Photo-guidance popup example images** — Lance specified two close-ups for Core
  and one full-home for Lighting. The modal shows an icon; the images are still
  needed, and we have asked him which to use.
- **Per-rep-account popup dismissal** — Lance asked for it; needs a backend
  endpoint that doesn't exist.
