# Map view header & Zone Canvasser (footsteps map)

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/MapDetail/**`, `src/navigation/index.tsx` (HeaderContext), `hooks/useZoneCanvasser.ts`, `services/api/zone-canvasser.ts`, `utils/zone-helpers.ts`, `widgets/components/ZoneCanvasser/**`, `utils/sales-pins.ts`, `widgets/modals/MapFiltersModal.tsx`, `widgets/components/LeadCenter/{LeadMap,MapJobCard}.tsx`.
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## The map's filter / list icons were missing until you tapped another header icon

Ticket: *"when i open the lead details and then open the map, this is the first view of the map
screen — but when i click on the notification icon or message icon then the map's other icons are
displayed. Fix this: display the icons when we open the map screen, no need to click on any icon."*

The header's filter + list icons are gated on handlers a screen publishes into `HeaderContext`
(`widgets/common/MainHeader.tsx`), and `MapDetail` published them from a **single `useFocusEffect`** —
a one-shot handshake fired the instant the screen focused. Anything that emptied the shared store after
that moment left the screen with no way to notice, and the icons stayed gone until the rep tapped the
bell or the chat icon, which **navigates away and back** and re-fires the handshake.

Two changes, and the ticket needed BOTH — the first alone shipped (`12e5d10`) and did not fix it.

### 1. `setHeaderActions` MERGES instead of replacing

`RootNavigator` handed the raw `useState` setter out, so every call replaced the whole object. Two
screens write to it:

| screen | on focus | on blur |
|---|---|---|
| `LeadCenter` | `{ onNavigate }` | `{ onNavigate: null }` |
| `MapDetail` | `{ onFilterPress, onListPress, filterCount }` | all three nulled |

⚠️ **The two effects belong to DIFFERENT screens and React Navigation does not promise which runs
first.** Leaving Lead Center for the map, a replace meant Lead Center's blur cleanup landing after Map
Detail's focus setup wiped `onFilterPress` / `onListPress` with it.

A `useCallback` wrapper now does `setHeaderActionsState((prev) => ({ ...prev, ...actions }))`, so each
screen's cleanup touches only the keys it owns and no screen can clear another's. An explicit `null`
still clears, so the blur contract is unchanged. ⚠️ It must stay referentially **stable** (`useCallback`
with no deps) — consumers list it in effect dependency arrays.

### 2. …and `MapDetail`'s claim is SELF-HEALING, which is the half that actually fixed it

Merging makes the two writers' keys disjoint, so the race above can no longer explain a missing icon —
and the icons were still missing. The remaining hole is that the store is **shared mutable state owned
by a component that can re-mount** (a navigator remount, or a Fast Refresh of `navigation/index.tsx`,
resets it to `{}`), while `useFocusEffect` re-runs **only on a focus transition**. A screen that is
already focused when the store is emptied never re-registers.

So the registration moved to `useIsFocused()` + `useEffect`, with a **`headerHasMapActions` boolean** in
its dependency list:

```ts
const headerHasMapActions = !!headerCtx.onFilterPress;
useEffect(() => {
  if (!isFocused) return;
  setHeaderActions({ onFilterPress: …, onListPress: …, filterCount: activeFilterCount });
}, [isFocused, headerHasMapActions, activeFilterCount, setHeaderActions]);
```

The moment the header reports it is NOT holding them, this re-claims — whatever emptied it, and
whenever.

⚠️ **A BOOLEAN, never the handler itself.** The handlers are new closures every render, so depending on
their identity would re-register forever. As a boolean it flips at most once per claim, so the effect
settles in exactly one extra pass.

⚠️ **Release is its OWN effect, keyed on `isFocused` alone.** Folding it into the claim would null the
actions every time the applied-filter count changed — a visible flicker of the two icons while the rep
is using the very filter modal that changes it. On blur the release nulls them, which flips
`headerHasMapActions` false and re-runs the claim, whose `if (!isFocused) return` is what stops it
re-claiming a screen the rep has left.

⚠️ Only `LeadCenter` and `MapDetail` write to this context today (`grep setHeaderActions(`). A third
screen gets the merge semantics for free, but MUST null its own keys on blur — under a merge, keys it
never clears now outlive it.

⚠️ Needs a device check (this repo cannot render-test): Lead Center ▸ map should paint the funnel and
list icons on the FIRST frame, the filter badge should carry its applied count, and going back to Lead
Center should drop both icons again.

## Footsteps map (Zone Canvasser): address search bar, zone delete / archive / unarchive, create parity

Ticket: *"add the new functionality on the footsteps map … make sure the functionality is same … use the
accurate end points that is used in the web — zone creating, the search bar on the map, zone archive
and unarchive, and zone delete."* Web source is `REVDSM-1037` (`22ee0c0d`, `77e50164`, `c61b6283`) plus
`467141cd` (address bar): `src/api/zone-canvasser.js`, `src/utils/axios.js` › `endpoints.zoneCanvasser`,
`src/utils/zone-helpers.js`, and `src/sections/map/zone-canvasser/{zone-canvasser-map,zone-stats-popup,
archived-zones-panel}.js`, `src/components/zone-canvasser-search/*`.

**Before this, mobile had zone create and a search modal, and NOTHING else** — the stats popup was
read-only and there was no way to remove or archive a zone at all.

### Endpoints — web's, path and method (`services/api/zone-canvasser.ts` › `ZONE_ENDPOINTS`)

| action | method | route |
|---|---|---|
| active zones | GET | `/revzones/v1/sales-rep/my-revzones` |
| archived zones | GET | `/revzones/v1/sales-rep/my-revzones?archived=true` |
| create | POST | `/revzones/v1/sales-rep/create` |
| update (ported, unused — as on web) | PUT | `/revzones/v1/{zoneId}` |
| delete | DELETE | `/revzones/v1/sales-rep/{zoneId}` |
| archive | PUT, no body | `/revzones/v1/sales-rep/{zoneId}/archive` |
| unarchive | PUT, no body | `/revzones/v1/sales-rep/{zoneId}/archive?unarchive=true` |

⚠️ **Delete goes through the SALES-REP route**, not web's older admin `delete: /revzones/v1/{id}` —
web switched in `22ee0c0d`. ⚠️ **Unarchive is the archive route plus a flag**; without `?unarchive=true`
the API 400s *"already archived"*. The hook no longer calls `api` directly for zones; every zone request
goes through the service.

### Delete vs archive is decided by knock history, and exactly one is offered

`getZoneStats` (`utils/zone-helpers.ts`, web `getZoneStats`) returns `canDelete = homesKnocked === 0`
and `canArchive = homesKnocked > 0`. So an unknocked zone shows a red **Delete Zone**, a knocked one an
amber **Archive Zone** — never both, never neither — and the stats popup's old **Close** button is gone
(web has only the ✕). Each asks first with web's copy verbatim (*"This will permanently remove the zone.
This action cannot be undone."* / *"…Your knock history will be preserved."*). On success the popup
closes, the zones refetch (archive refetches the archived list too), and the button spins meanwhile.

⚠️ **Confirms are native `Alert`s, not a second Modal.** The stats popup is already a Modal inside the
map's full-screen Modal; stacking native modals is unreliable on both platforms.

⚠️ **The success Alert after delete/archive is raised 400 ms after the popup closes.** An Alert
presented while a native Modal is still dismissing is dropped on iOS.

⚠️ `isZoneActionSuccess` accepts `code: 200` OR `success: true` — web's unarchive handler does, because
the archive route documents `success: true` while the other zone routes return `code: 200`. Mobile uses
it for archive as well (web checks only `code` there, which would silently swallow a `success`-shaped
answer). A non-success 2xx shows the API message rather than doing nothing, as web does.

### Archived zones panel (`ArchivedZonesPanel.tsx`)

A bottom-left archive toggle above the legend palette: the list (`REV-...0042`, `N homes · N knocked`),
an **Unarchive** per row behind web's confirm (*"… will move back to your active map. Its knock history
stays intact."*), the row spinner scoped by `unarchivingZoneId`, other rows dimmed while one is in
flight. Opening it closes the legend and vice versa (`toggleArchivedOpen` / `openLegend`), and a map
tap dismisses it (web's `ClickAwayListener`, via `handleMapPress`).

⚠️ **The card is IN FLOW above the buttons, never an absolute popover off its own button — and
`MapLegend` was split into `MapLegendCard` + `MapLegendToggle` for the same reason.** Android does not
deliver a touch to a child drawn outside its parent's bounds, so as a popover every Unarchive button
would have rendered and been dead. The top search row follows the same rule (its suggestions grow DOWN
inside it).

⚠️ The list's height cap sits on the `ScrollView` itself; a `maxHeight` on the card alone does not
reliably make Yoga shrink the list.

### Address search bar (`ZoneSearchBar.tsx`, replaces `SearchLocationModal`)

Always on the map, in a top row with the back button; `MapDrawTools` moved down to `top: 76`. The
header funnel now just focuses it (it used to open the modal). Web's contract, kept:

- Places Autocomplete restricted to **`types=address`** (web `options={{ types: ['address'] }}`) — so
  unlike the old modal a bare city/ZIP is not offered, and there is no `country:us` filter.
- **Picking a suggestion COMMITS it immediately** — the map pans to **zoom 17** and drops the red pin
  on the tap, and the keyboard closes. ⚠️ **Deliberate divergence from web**, which only fills the box
  and waits for its Search button. It shipped that way first and was reported straight back: *"when we
  click on the location the map [does] not move to that point"* — on a phone the tap reads as doing
  nothing. Search (button or keyboard submit) still re-centres on the picked place and stays dimmed
  until one is picked. A place that can't be resolved raises *"Location not found"* instead of a silent
  no-op.
- ⚠️ The pick arms `skipSearchRef` **only when the written address differs from the box's text** — if
  it's identical the search effect never runs to consume the flag, and the rep's next keystroke would
  be swallowed.
- **Tapping the pin toggles a callout with the address** (web's mapbox `Popup`); it starts closed on
  every new search. It is part of the `MarkerView`'s own content, pin last, so the bottom anchor stays
  on the pin's tip whether open or not.
- **Emptying the box, or ✕, clears the search and removes the pin** — the old modal left the pin behind.
- **Closing the map clears it too** (web `closeZoneMap`). ⚠️ The map `Modal` stays MOUNTED while hidden,
  so without the `!visible` reset in both the hook and the bar the last pin reappeared next time.

⚠️ **Also divergent:** editing the text after picking drops the picked place. Web keeps it, so Search
pans to a place the box no longer names.

⚠️ **No suggestions on the iOS 18.4 SIMULATOR is an environment bug, not this component.** Every
request to `maps.googleapis.com` from that runtime fails over HTTP/3 (`-1017`, *cannot parse
response*, after a completed TLS handshake) — so EVERY Google address lookup in the app is dead there,
Edit Customer and Add New Lead included. Proven A/B with one startup `fetch` from the same Debug build:
iOS 18.4 sim *Network request failed*, iOS 18.5 sim `200 OK` with 5 predictions. Test the search on an
iOS 18.5 / 26 simulator or a device. Not verified on a physical 18.4 iPhone.

Tests: `__tests__/widgets/zone-search-bar.test.tsx`.

`utils/places.ts` gained an optional `{ types }` on `fetchPlacePredictions` (existing callers unchanged)
and **`resolvePlace(placeId)`**, which returns the formatted address alongside the coordinates — web's
`place_changed` needs both and ignores a place missing either.

### Zone create brought to web's `handleZoneCreated`

The payload is now built by the pure port of web `createZonePayload` / `validateZonePayload`, and:

- **`coordinates` drops the duplicate CLOSING vertex** (`toZoneCoordinates`). The rectangle tool closes
  its own loop, so a rectangle used to reach the API as five corners where web sends four. The geoJSON
  ring is still closed.
- **No client-side "No Buildings Found" stop any more.** Web sends the zone and the API answers
  *"Cannot create revzone without a building"*, shown as *"No building data available for this area.
  Failed to create zone."* (`resolveZoneCreateError`, message for message). Validation failures read
  `Validation failed: …`, and success is `response.code === 200` with *"Zone REV-… created with N
  buildings"*.
- **A failed Overpass read now yields NO buildings instead of aborting** (web `fetchBuildingsInPolygon`),
  and the create error is prefixed *"Failed to fetch buildings."* in ONE alert — web raises two
  snackbars, but a native Alert queued behind another is easy to miss.
- ⚠️ **The two Overpass mirrors are KEPT** (mobile-only). Same query and mapping as web; a field rep on a
  weak connection trips the primary's rate limit far more often than a desk browser does.

Rules live in the pure **`src/utils/zone-helpers.ts`**, for the reason `utils/addendum-drafts.ts` exists:
the hook and every Zone Canvasser widget pull in RN / Mapbox and cannot be loaded under jest.

Tests: `__tests__/services/zone-canvasser-endpoints.test.ts`, `__tests__/utils/zone-helpers.test.ts`.
⚠️ `useZoneCanvasser.ts`, `MapCanvas.tsx` and
`ZoneCanvasserMap.tsx` are **CRLF** — `newline=''` on both ends.

⚠️ Needs a device check (this repo cannot render-test): Delete on an unknocked zone and Archive on a
knocked one (each confirm, the spinner, the success alert actually appearing after the popup closes);
the archived list scrolling and Unarchive restoring the zone to the map **on Android**; search → pick →
Search panning with the pin, the pin callout toggling, ✕ removing the pin; and the top row not colliding
with the draw tools on a small phone.

## Canvasser lead coordinates go to the backend as `[lng, lat]` — a 500 west of -90 longitude

Ticket (`TAYYAB-CANVASSER-LEAD-GEO-COORDS.md`): creating a building lead from the footsteps map
**500s in Los Angeles and "works" in Florida**. One bug, two symptoms.

`buildingDetails.position` was posted in the map's own `[lat, lng]` order, but the backend puts a
**2dsphere index** on that field (`SalesRepLeadEntity.ts:100`, `CanvasserLeadEntity.ts:114`), and a
2dsphere index reads a bare 2-element array as a legacy pair in **`[longitude, latitude]`** order. So
Mongo takes the *second* element as the latitude:

| Zone | Sent `[lat, lng]` | Mongo reads latitude as | Result |
|---|---|---|---|
| Florida | `[27.9, -82.4]` | `-82.4` — in range | inserts at lng 27.9 / lat -82.4, **the Southern Ocean** |
| Los Angeles | `[34.27, -118.48]` | `-118.48` — out of range | `16755` `Can't extract geo keys`, caught as a **500** |

US latitudes (25-49) are always valid as a longitude, so latitude never trips the check — the dividing
line is roughly **-90 longitude**: the East Coast appears to work, everything west of Texas 500s.
⚠️ **The Florida half is the worse one**: those rows were stored at a garbage location, so
`CanvasserLeadDBService.ts:317`'s `$nearSphere` (which correctly queries `[longitude, latitude]`) has
never matched them.

Fixed by swapping at the **API boundary** — `withGeoPosition` in `services/api/zone-canvasser.ts`,
applied by all three lead writes (`createBuildingLead`, `updateBuildingLead`, `updateSalesRepLead`).
Those three are the only callers of `/sales-rep/lead/v1/create`, `/canvasser/lead/v1/update/:id` and
`/sales-rep/lead/v1/update/:id`, so one helper covers every path and a future call site cannot miss it.
Web's `src/api/zone-canvasser.js` carries the byte-equivalent function — **keep the two diffable.**

⚠️ **The swap is unconditional and must stay that way.** A heuristic (`if (Math.abs(p[1]) > 90) swap()`)
cannot tell the orders apart in the ambiguous case — Florida's `lat 27 / lng -82` are both inside
+/-90 — so Florida and LA would take different branches, which is precisely the region-dependent
behaviour being fixed. Every value reaching the helper comes from zone building data, which is
`[lat, lng]` without exception. The guard only skips a payload with no 2-element `position` at all, and
the payload is rebuilt rather than mutated.

⚠️ **Do NOT flip anything else**, all three checked when this landed:

- `handleActionSubmit` (`useZoneCanvasser.ts:724`) keeps passing `selectedBuilding.position` through
  as-is — the swap belongs at the boundary, not in the payload builder.
- `zone.buildingDetails[].position` stays `[lat, lng]`: that is what the backend generates
  (`MapHelper.ts:784`, `[element.center.lat, element.center.lon]`) and what every marker renders from.
  Only the **lead's copy** flips.
- **No marker moves.** Leads are matched to buildings by `buildingDetails.id`
  (`useZoneCanvasser.ts:245`), never by coordinates; nothing reads the lead's stored position for
  display. Its only consumer is the `$nearSphere` query, which this makes correct for the first time.

⚠️ **Existing rows are still stored reversed** on `salesrepleads` and `canvasserleads`. The backfill
that swaps them must run **only after every client is on the new order** — run it earlier and it swaps
the newly-correct rows back into the broken state. ⚠️ The backend validators still label `position.0`
"Latitude" (`SalesRepLeadValidator.ts:17`, same in `CanvasserLeadValidator.ts`); those comments are
wrong and are being corrected separately — don't follow them.

**Not verified on device yet:** LA zone -> tap a building -> Not Interested -> Submit saves with no
500/`16755`; a Florida zone still saves and now stores the real location; and a *Go Back* lead edit
(the `updateSalesRepLead` path) saves too.

## Sales pins: sold jobs, category colours, status filter, legend (REVUIUX-439)

Ticket spec: `TAYYAB-SALES-PINS.md`. The backend (`feature/ticket-439-mobile-board`) made every job a
company pin: CSV uploads, plus a pin created when a lead is marked **Sale** (`pendingInstall` until the
installer completes it, then `installed`; undoing the sale removes it). `POST /job/v1/find` returns both,
and **the request did not change**. New fields per pin: `pinCategory` (`uploaded` / `pendingInstall` /
`installed`, always present), `source`, `status`, `displayJobNumber`, `repDisplayName`,
`installationDate` (null while pending), `scheduledInstallDate`, `saleDate`, `leadOrigin`.
`salesRepId` may be null (CSV rep with no account); the `isJobOwner` fallbacks already handle that.

Every rule lives in the pure **`src/utils/sales-pins.ts`** (the map widgets pull in RN / Mapbox and
can't load under jest). Tests: `__tests__/utils/sales-pins.test.ts`.

| Where | Change |
|---|---|
| `LeadMap.tsx` | GeoJSON `category` = `searched` › `favorite` › pin category (`uploaded` stays `default` green). `iconImage` match adds `installed` → `markerInstalled`, `pendingInstall` → `markerPending`. Legend with per-category counts: bottom-LEFT, behind a palette button (see the follow-up below). Search highlighting also matches `displayJobNumber`. |
| `SalesLeadPins.tsx` (Zone Canvasser) | Same category colours (no search/favorite tints there). No legend. |
| `MapFiltersModal.tsx` | `FilterState.statusFilter: 'all' \| 'pendingInstall' \| 'installed'`, a dropdown below the date range; counted by `countAppliedMapFilters` when not `all`; logged as `pin_status_filter`. |
| `MapDetail/index.tsx` | `DEFAULT_MAP_FILTERS.statusFilter = 'all'`; applied in `baseFilteredLeads`; text search + exact-jump match `displayJobNumber` as well as `jobNumber`; sort + date range use `getPinSortDate` (install → **sale** → created); list card uses the helpers below. |
| `MapJobCard.tsx` + list | `displayJobNumber`; date line = "Install scheduled {d}" / "Sold {d} · pending install" / install date; rep = `repDisplayName` first; **`products`** (the card read `job.product`, which doesn't exist, so it always said N/A). |

Pin images `assets/images/map/marker-{installed,pending}{,@2x,@3x}.png` are generated from
`marker-green*`: the teardrop recoloured to `#0B6E4F` (installed — later changed to `#00FFA3`, see the
"Installed pin colour" follow-up) / `#7B2FF7`, its see-through centre filled solid, and a white check / dot
drawn in (same sizes and anchor as the existing pins).

⚠️ **The status filter is CLIENT-side (web's approach), not `/find`'s `pinStatus`.** Pending =
`pinCategory === 'pendingInstall'`; installed = **everything else**, because uploaded pins are
historical installs. Keeping it on the device means the query key and the request are unchanged. It is
**not** written to `savedFilters` (web's saved shape has no such field), so it resets to "All" on a
fresh open.

⚠️ **Never format a null date.** `installationDate` is null while a sold job is pending, and `new
Date(null)` prints 01/01/1970. `formatPinDate` returns null for that, and reads a calendar date
(`YYYY-MM-DD`, or that at UTC midnight) as **text**, so an install date no longer slips back a day in US
timezones. A real timestamp (e.g. `createdAt`) is still shown in local time.

⚠️ **The legend is `position: 'absolute'` with a FIXED width inside the rail container.** Absolute keeps
it from shifting the toggles. The fixed width is needed because an absolute child is measured against
the narrow toggle column, which truncates the labels. It is display-only (`pointerEvents="none"`), so
Android's rule against touches outside the parent's bounds doesn't apply. It hides with the pins in
heatmap mode.

⚠️ `searched` / `favorite` must keep winning over the category (web does the same). A searched sold job
is red, not purple.

⚠️ Needs a device check (this repo cannot render-test) — the spec's smoke test: mark a lead Sale → a
purple pin appears; dispatch → the card shows "Install scheduled …" and the `T…` job number; complete →
dark green with a check; back to Demo → the pin disappears; 5-mile radius → only nearby pins. Also check
that the legend doesn't collide with the toggles on the 420 px Lead Center map.

### Follow-up — the purple pending-install pins were painted over

*"the legend says Pending install 18 in purple, but we can't find them on the map."* The pins were being
drawn, just underneath the green ones. Every pin is in ONE SymbolLayer with `iconAllowOverlap`, and with no
`symbolSortKey` Mapbox stacks overlapping symbols by **screen Y** (`symbolZOrder: auto`). The 18 sold
jobs sit inside the same dense Tampa/Orlando clusters as ~2,500 uploaded pins, so green pins covered
them.

- **`PIN_DRAW_ORDER`** + **`pinSortKeyExpression()`** (`utils/sales-pins.ts`): `default`/`uploaded` 0 ›
  `installed` 1 › `pendingInstall` 2 › `favorite` 3 › `searched` 4. Higher is drawn later, so it sits on top.
  Applied as `symbolSortKey` on BOTH pin layers: `LeadMap.tsx` (`job-markers-symbols`) and
  `SalesLeadPins.tsx` (Zone Canvasser). The expression is built once at module level (`PIN_SORT_KEY`),
  because a new array every render re-sends the layer style.
- ⚠️ **Order is by the feature's `category` property**, so a new pin category needs a rank here, or it
  falls back to 0 and is buried again.
- ⚠️ `symbolSortKey` sorts within a tile. A pin exactly on a tile edge can still be overlapped by one from
  the next tile. It hasn't been seen at the density involved here, but a separate top layer would be the
  complete fix.
- Test: `__tests__/utils/sales-pins.test.ts` (draw-order block).
- **The actual reason the purple pins were missing from Florida: they are in Lahore.** Read from the
  device log: all 18 `pendingInstall` jobs (`SG-…`, `source: 'sale'`) have
  `location.coordinates ≈ [74.2904, 31.4667]` (Lahore, Pakistan), in correct `[lng, lat]` order. They are
  test sales: the jobs' own `address` is "Plot 161, Block F Phase 1 Johar Town, Lahore" (self-generated leads
  by reps "Mike R" / "Oliver Mateo", `geocodeFailed: false`), so backend geocoding is correct too. The uploaded pins are in
  Florida (`[-82.06, 28.11]`). The code is correct, so don't "fix" it by swapping coordinates. Before assuming a
  rendering bug, check where the pins actually are: `adb logcat | grep ReactNativeJS` shows JS logs from
  the dev build.

### TEMPORARY — Sales Map boundary lock lifted for testing

To let the team see the Lahore test pins, `LeadMap.tsx` has `UNLOCK_MAP_BOUNDS_FOR_TESTING = true`.
While it's on (and only in a `__DEV__` build, via `MAP_BOUNDS_UNLOCKED`):
- `Camera` gets no `maxBounds` (spread in, never a present `undefined`);
- `isWithinMapBounds` returns `true`, so the office centring, "locate me" and the startup fix will centre
  on a location outside North America too. On a device in Lahore, "locate me" now flies there.

⚠️ **Set it back to `false` when testing is done.** The North America box (`MAP_BOUNDS`, SW
`[-180, 15]` / NE `[-40, 85]`) is deliberate web parity. The `__DEV__` gate means a release build keeps
the lock regardless, but a debug build handed to QA would not.

### Follow-up — Sales Map pin legend: bottom-left, palette button + ✕ (footsteps pattern)

The legend (Uploaded / Installed / Pending install + counts) sat permanently above the right toggle rail.
It now behaves like the footsteps map's building-status legend (`ZoneCanvasserMap.tsx` + `MapLegend.tsx`):

- **Bottom-left**, mirroring the GPS/zoom cluster on the right (`left-6`, same `bottom`).
- Closed by default. The reused **`MapLegendToggle`** (`ZoneCanvasser/MapLegend.tsx`) shows a palette
  icon; tapping it opens the card, and the same button becomes a dark **✕** that closes it. State is
  `legendOpen` in `LeadMap` (`useState(false)`).
- ⚠️ **The card renders IN FLOW above the button, inside a `box-none` container** — not an absolute
  popover off the button. Android doesn't deliver touches to a child drawn outside its parent's bounds,
  which would leave the ✕ untappable. Same reason the footsteps map does it.
- Hidden together with the pins in heatmap mode (button included).
- `MapLegendCard` (the footsteps card) is deliberately NOT reused: it renders building-status markers;
  this card is category dots + counts (`PIN_CATEGORY_META`, `countPinCategories`).

### Follow-up — Pending-install pin: purple → yellow, and installed now MATCHES uploaded (reverses the mint decision above)

Ticket: *"change the pin colour for Pending Install from purple to yellow — it should show up properly
on the map — and the uploaded pin and the installed pin colour should be same, use the uploaded pin's
green."* This is a deliberate reversal of the follow-up directly above: that one moved `installed` to
mint specifically so it would NOT read as the same green as `uploaded`. The premise changed — the user
now wants the two to look like the same pin colour — so the mint decision and its "don't re-litigate"
warning no longer apply going forward; both are struck through above rather than deleted, so the reasoning
that led to mint is still there if a future ticket asks to tell them apart again.

- **`pendingInstall` is now `#FFD400`** (was `#7B2FF7`). A saturated, high-lightness yellow chosen to
  read clearly next to the Favorite pin's dark goldenrod `#BB8C17` (same hue family, ~43° vs ~50°, but
  far apart on lightness/saturation — `#BB8C17` is a muted, dark "gold", `#FFD400` a bright, fully
  saturated "yellow") and to stay out of every other pin's hue (green `#4CBB17`, red `#BB1717`, the
  heatmap ramp).
- **`installed` is now `#4CBB17` — literally `PIN_CATEGORY_META.uploaded.color`'s value, not a
  new "close" green.** The two constants happen to hold the same string; see the code comment on why they
  are still two separate lines rather than one aliasing the other.

Changed in the same four places the mint follow-up changed, mirrored:

- `PIN_CATEGORY_META.pendingInstall.color` / `.installed.color` (`utils/sales-pins.ts`) — the legend dot
  in `LeadMap`.
- The six PNGs `assets/images/map/marker-{pending,installed}{,@2x,@3x}.png`, **recoloured in place, not
  redrawn** — same technique as the mint follow-up: every pixel classified against the ORIGINAL fill as
  pure fill / blended-toward-black (outline) / blended-toward-white (check), each class remapped by the
  same proportion onto the new fill, so the black outline and white check are pixel-identical before and
  after. Verified per file: total non-transparent pixel count unchanged at every size, the white check
  pixel count exactly unchanged, and zero pixels left with a residual cast of the old hue.

⚠️ **`marker-installed*.png` was recoloured, not re-pointed at `marker-green*.png`.** The two categories
keep independent asset files that now happen to render identically. A future "make installed distinct
again" ticket then touches one clearly-named asset rather than untangling a shared `require()` used by
two different `iconImage` categories in both `LeadMap.tsx` and `SalesLeadPins.tsx`. Neither of those two
files needed any change — both already resolve `installed` → `marker-installed.png` and `pendingInstall`
→ `marker-pending.png` by name, so recolouring the file was the whole fix.

⚠️ **`PIN_DRAW_ORDER` was left unchanged** (`pendingInstall: 2` still above `installed: 1`, `uploaded: 0`).
Nothing about which pins can hide behind which changed — `installed` and `uploaded` just look the same
now, and draw order between two identically-coloured layers is moot; `pendingInstall` staying on top still
matters, since a handful of yellow pins can still sit inside a dense green cluster exactly as the purple
ones once did.

No test change: `sales-pins.test.ts`'s 22 tests assert behaviour (which pin is found, sort order), not
hex values, so all pass unchanged. Two present-tense comments that said "purple" (the doc comment on
`findPendingInstallPinForLead` and one test description) were reworded; the PAST-TENSE narrative in the
`PIN_DRAW_ORDER` comment above (*"the handful of purple pending-install pins sat inside..."*) was left
alone — it is describing the historical bug that justified the draw order, not the pin's current colour.

⚠️ Needs a device check (this repo cannot render-test): the legend dot and map pins for both categories
in Florida (dense clusters) and on an isolated sale, on satellite AND street map, at cluster and pin zoom;
confirm the yellow doesn't get lost inside a favourite-heavy area and that installed truly reads as the
same green as uploaded rather than "close but not quite" at a glance.

### Follow-up — Installed pin colour: dark green → spring-mint `#00FFA3`

*"The installed pin and the uploaded pin colours are matched with each other — change the green shade of
the installed pin so it is clearly visible on the map."* The installed pin was a dark forest green
(`#0B6E4F`), which sank into satellite terrain / tree cover and read as the same "green" as the lime
uploaded pin (`#4CBB17`) at cluster zoom.

- **Installed is spring-mint `#00FFA3`** — a cooler, lighter hue than the yellow-green uploaded pin, legible
  on satellite (dark green / brown) and on the street map (the pin's dark outline carries it on light
  backgrounds). It went through four colours; **`#00FFA3` is the one the user signed off** (*"the 2nd last
  colour shade is perfect"*), so treat it as final:
  `#0B6E4F` → `#00E676` → **`#00FFA3`** → magenta `#FF00C8` (reverted).
- ~~⚠️ **Do NOT "fix" it back to magenta or another hue.**~~ **SUPERSEDED below — the premise changed.**
  Magenta `#FF00C8` was built and measured as the mathematically best option — the only hue no other layer
  uses, ≥ 57 ΔE from every other pin and ≥ 98 from every basemap background — and the user rejected it for
  the mint at the time. That warning assumed installed and uploaded had to stay distinguishable; the ticket
  below asks for the opposite. If a future ticket wants them apart again, `#FF00C8` is still the free hue,
  and `#00E5A0` the same-family option with a crisper check — see this file's git history for the full ΔE
  table.
- **Measured, not eyeballed** (CIELAB ΔE against nine basemap backgrounds — satellite forest / grass / brown /
  roof / water, street beige / park / water / road — and against the other pin colours): `#00FFA3` is **≈ 52
  from the nearest background, ≈ 42 from lime**; `#00E676` was 55 / 29 (too close to lime); the original
  `#0B6E4F` was 22 / 65 — distinct from lime but invisible on terrain, which was the real problem.
- Changed in **two places that must stay in step**: the three PNGs `assets/images/map/marker-installed{,@2x,@3x}.png`
  (used by `LeadMap` and `SalesLeadPins` through the `markerInstalled` image) and
  `PIN_CATEGORY_META.installed.color` (`utils/sales-pins.ts`, the legend dot in `LeadMap`).
- ⚠️ The PNGs were **recoloured, not redrawn**: the fill and its anti-aliased blends with the black outline /
  white check are remapped to the new fill, so size, anchor, outline and check are the same shape (1180 fill
  pixels at @3x before and after). Always remap from the **original `#0B6E4F` files** (`git show
  <commit-before-this-change>:src/assets/images/map/marker-installed@3x.png`), not from the current ones —
  each hop through a lighter or darker fill loses a little anti-aliasing accuracy — and change
  `PIN_CATEGORY_META` too, or the legend dot stops matching the pin. (`pngjs` is already in `node_modules`;
  no new dependency is needed.)
- The draw order is unchanged (`installed` = 1, above uploaded, below pending), so a more prominent installed
  pin is no more likely to hide the purple pending ones.

### Follow-up — a new pending-install pin did not appear until the map cache aged out

*"I create a new lead that is pending install but it is not shown on the map. A pending-install lead
(purple) should automatically display when the map is opened."* Then, mid-investigation: *"if I enter the
exact location in a search, that lead is displayed."* That second fact is the diagnosis: the pin **exists,
has valid coordinates and passes every client filter**; the map was simply showing an old copy of
`POST /job/v1/find`.

- **Cause.** `MapDetail`'s `['mapJobs', ...]` query had `staleTime: 5 min` and nothing on the device
  invalidates it when a lead is marked Sale — the pending pin is created by the **backend** (see the top of
  this ticket), so no client mutation ever knew to. The Leads screen and Lead Center also `prefetchQuery`
  `['mapJobs', 'all']` with the same 5 min, so a cache seeded when the rep opened Leads was served as-is.
  Typing a location + radius changes the query key (`['mapJobs', lat, lng, radius]`), which is a cache miss and
  therefore a live request — that is why searching "found" it. Only report generation (`useLeadReports`) and
  `OFFLINE_UPLOAD_SUCCESS` ever invalidated `mapJobs`.
- **Fix** (`screens/MapDetail/index.tsx`, the query + one effect): `refetchOnMount: 'always'`, so every open
  asks the server; and a `wasFocusedRef` effect that `refetchQuery()`s on a **focus** transition, because
  returning to a map that never unmounted (open a lead from it, make a sale, go back) is not a mount. Cached
  pins still paint immediately and `isLoading` stays false (there is data), so there is no spinner; the fresh
  pins arrive when the request lands.
- ⚠️ **Do not "optimise" this back to `staleTime` alone, and do not switch to invalidating at the sale-submit
  sites.** A sale made on the web, an installer completing a job (pending → installed) or another rep's sale
  never runs any code on this device, so only a revalidation on open catches them. Leave the Leads / Lead
  Center prefetches as they are — they make the first paint instant; `refetchOnMount: 'always'` is what
  keeps them honest.
- ⚠️ **`screens/MapDetail/index.tsx` is CRLF** — edited with `newline=''` on read and write (diff is +14).
- `SalesLeadPins` (Zone Canvasser) was **not** changed: `useSalesMapPins` fetches once per hook mount
  (`fetchedRef`). It is inside the Zone Canvasser modal, which should remount per open, but that is unverified.
  If a pending pin is ever missing on the footsteps map only, look there first.
- ⚠️ **Not verified on device.** Smoke test: create a lead → mark Sale → open the Sales Map **without**
  searching → the purple pin is there (and `Pending install` in the legend counts it). Two things this fix
  cannot cure, both already recorded above: a sale whose address geocodes far from the rep (the Lahore test
  leads) draws its pin there, not where the map opens, and the North America bounds lock stops a release build
  from panning to it.

### Follow-up — opening the map from a lead lands on its pending-install pin

*"1234 Island Slough Ln, Davenport, FL 33837 is my lead and it is not listed on the map, but if I search that
address it is displayed. If the lead is created and the status is pending install, show it directly."*
Follow-up to the stale-cache fix above; this is the **other half** — the pin can be in the data and still be
off-screen. The full map opens on the rep's **GPS** (`focusUserLocationOnOpen`, QA ticket 321 — a plain lead
open deliberately does NOT suppress it), so a lead ~50 mi from the rep is a needle in the Tampa–Orlando cluster
until an address search flies the camera there (and drops the app's own **red** search marker — `LeadMap`
"Location-search center marker" — which is easy to mistake for the lead).

Decision (asked, not assumed — it partly reverses ticket 321): the user picked *"open on that lead's pin when the
map is opened from the lead"*, via the Lead Center **Map** tab / **Expand Map** (both pass `currentLead: lead`).

- **`findPendingInstallPinForLead(jobs, lead)`** (`utils/sales-pins.ts`, pure, tested in
  `sales-pins.test.ts`): a pin belongs to a lead when `_id` / `leadId` matches the lead's `_id` / `id` / `leadId`,
  **or** the job number matches — a sold job's own `jobNumber` IS the lead number (`SG-XXXXXX` for a
  self-generated lead, per the spec), and `displayJobNumber` (installer `T…`) is compared too. Text compare,
  trimmed. Only a **`pendingInstall`** pin **with coordinates** counts: an uploaded / installed pin with the same
  number is history, and a pin with no location can't be framed.
- **`MapDetail`**: `leadPendingPin` is looked up in `baseFilteredLeads` (a pin the active filters hide is never
  jumped to) and handed to the existing `focusLead` machinery (`setJumpLead`) from the same effect that already
  jumps to a searched job number. `LeadMap` then flies to it at zoom 14, selects it (card popup), and — because
  `focusLead` counts as a search target — the one-shot GPS re-centre stands down.
- ⚠️ **One-shot per lead** (`openedOnLeadPinRef`, keyed by lead id). A refetch hands back a new pin object; without
  the latch the effect would re-jump on every refetch (including the focus refetch) and snatch the camera back from
  wherever the rep has panned. Keyed by id so a second lead opened into the same screen instance still jumps.
- ⚠️ **Only when opened from a lead.** The header map icon passes no lead, so it still opens on the GPS —
  ticket 321 stands. An address / job-number search and a saved location filter (`centerCoords`) both take
  precedence (they are earlier branches of that effect).
- ⚠️ **It waits for the pin.** The jump fires when the pin is in the list — the cached list on open, or the
  fresh one once the `refetchOnMount: 'always'` request lands — so the camera may sit on the GPS for a moment
  first and then fly. If the backend has not created the pin, nothing jumps (never fabricate a pin client-side:
  the sale can be undone, and the installer flips it to `installed`).
- ⚠️ **Not verified on device.** The match hinges on the lead's `jobNumber` equalling the pin's `jobNumber`
  (spec-derived). If a fresh sale still doesn't frame, log `lead.jobNumber` / `lead._id` next to the pending
  pins' `jobNumber` / `displayJobNumber` from `[MapDetail DEBUG]` and fix the key here, not the camera.
  Smoke test: create a lead (e.g. the Davenport address) → mark Sale → Lead Center → Map → the camera flies to
  a purple pin with its card, without searching. Zone Canvasser is untouched.

### Follow-up — "Pending install 3" but only one purple pin: the leads were pinned on the rep's GPS, not their address

*"The legend says 3 pending-install pins but I only see two pins on the map — one is missing."* Legend counts
every pin in the list (`pinCategoryCounts`, same set as the GeoJSON), including ones far off-screen, so a
count that beats what you can see means a pin is somewhere ELSE. Measured, not guessed: a temporary `__DEV__`
log of the non-uploaded pins, read over `adb logcat -d -s ReactNativeJS` (device attached, Metro hot-reloads
the edit), showed 291 pins = 287 + 1 + 3, and:

| pin | coordinates `[lng, lat]` | where |
|---|---|---|
| `96314` pending | `-82.52, 28.18` | north Tampa — the one purple pin on screen |
| `SG-FB9788` pending | `74.2903789, 31.4667283` | **Lahore, Pakistan** |
| `SG-FCA16F` pending | `74.2903854, 31.46672` | **Lahore, Pakistan** (≈ 1 m from the other) |
| `6925417` installed | `-82.68, 28.32` | near Spring Hill — the mint pin on screen |

So nothing was hidden by the renderer: two pins were 7,000 miles away. The 1 m jitter between the two `SG-` pins
is a **GPS fix**, not a geocoded address (an address geocodes to identical coordinates every time).

- **Root cause — `widgets/modals/LeadCreate/index.tsx`.** On open the form silently fills *Full Address* from
  the phone's GPS (`handleGetCurrentLocation(true)`: reverse-geocode → `form.address` **and**
  `setLocation(gps)`). `handleAddressSearch` (the address `onChangeText`) changed only the text, so a rep who
  overtyped the address and did NOT tap a suggestion saved `fullAddress: "1234 Island Slough Ln, Davenport, FL"`
  with `location.coordinates` = their own GPS (Lahore). The backend builds the sale's pin from the lead's
  `location`, so the pin followed the coordinates, not the address. A picked suggestion whose Place-Details call
  failed silently (`console.warn` only) did the same.
- **Fix.** (1) `handleAddressSearch` now `setLocation(null)` — coordinates belong to the address they were
  captured for, so editing the text drops them (`handleSelectSuggestion` sets the picked place's; programmatic
  address fills — the GPS pin icon — don't fire `onChangeText`, so they keep theirs). (2) At submit,
  `leadLocation = location || (await geocodeAddress(form.address))` and the payload (both the Issued and
  Self-Gen branches, and the zone `latitude`/`longitude`) uses `leadLocation`. **`geocodeAddress`** is new in
  `utils/places.ts` (`geocode/json?address=`; null on no result / network error, never throws; tested in
  `__tests__/utils/places.test.ts`).
- ⚠️ **Geocode failure sends NO location — never a fallback to the GPS.** No coordinates is a lead the backend
  can still handle; wrong coordinates is a pin in the wrong country with no error anywhere. Don't "make it
  robust" by falling back to `location`/the device fix.
- ⚠️ **Zone leads are unaffected**: their address is `editable={!fromZone}` and `prefilledCoords` are the
  building's, so `handleAddressSearch` never fires for them. `EditCustomerModal` already keeps its own
  `addressCoords` (picked place → `geocodePlaceId`), so it does not have this bug.
- ⚠️ **The two existing Lahore pins are bad DATA and this fix does not move them** — they were saved with the GPS
  coordinates. Correct them by re-saving the address (Edit Customer) if the backend re-derives the job pin from
  the lead, or fix them in the database; don't add a client-side coordinate override on the map. In a release build
  they are also unreachable (North America `MAP_BOUNDS`), which is why the legend count and the visible pins can
  disagree until the data is fixed. Only a `__DEV__` build (`MAP_BOUNDS_UNLOCKED`) can pan to Lahore.
- **Debugging recipe worth keeping:** to find where counted pins really are, add a temporary `__DEV__`
  `console.log` of `activeLeads.filter(j => getPinCategory(j) !== 'uploaded')` (category, `jobNumber`,
  `location.coordinates`, `geocodeFailed`) in the `queryLeads` sync effect of `MapDetail`, then read it with
  `adb logcat -d -s ReactNativeJS`. Remove it afterwards.
- ⚠️ **Not verified on device.** Smoke test: Add New Lead → overtype the auto-filled address with a Florida one
  WITHOUT tapping a suggestion → create → mark Sale → the pending pin is in Florida (log line
  `location.coordinates` ≈ `[-81.x, 28.x]`), not at the rep's position.

### TEMPORARY (test mode) — the camera frames every pin on load

While `MAP_BOUNDS_UNLOCKED` is on, `LeadMap` calls `cameraRef.fitBounds(ne, sw, 60, 800)` once
(`didFrameAllPinsRef`) when the map is ready and there are ≥ 2 pins, so far-away test pins (Lahore) are on
screen without hunting for them — unlocking `maxBounds` alone only made them reachable. It overrides
the office/Tampa opening view, which is intended for testing. It goes away with the unlock: set
`UNLOCK_MAP_BOUNDS_FOR_TESTING = false` before release.
