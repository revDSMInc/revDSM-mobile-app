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

### Sales Map boundary lock: test bypass added, then REMOVED

A temporary `UNLOCK_MAP_BOUNDS_FOR_TESTING` switch in `LeadMap.tsx` (no `maxBounds`, `isWithinMapBounds`
always true) and a "frame every pin on load" `fitBounds` were used to reach the Lahore test pins. Both
are **gone**: `Camera` is `maxBounds={MAP_BOUNDS}` again and `isWithinMapBounds` is the original box check
(North America, SW `[-180, 15]` / NE `[-40, 85]`, web parity). ⚠️ Don't reintroduce a global switch for
this; if a debug unlock is needed again, keep it out of committed code. Consequence: the Lahore test pins
(and the legend's Pending count for them) are counted but not reachable on the map, by design.

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
  **⚠️ Superseded for `marker-pending*` by the follow-up directly below — that recolour kept the OLD
  thin-ring-and-white-dot shape, which turned out to be the actual complaint. `marker-installed*` still
  IS this in-place recolour and is unaffected.**

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

### Follow-up — Sales Map legend: Uploaded merged into Installed

Ticket: *"remove the Uploaded title, merge the pins into the Installed title, because both pins are
the same — installed and uploaded."* Fair, once the two design-match follow-ups above landed: the legend
still had three rows (Uploaded, Installed, Pending install) explaining a distinction the rep could no
longer see on the map — Uploaded and Installed pins are colour- and shape-identical now.

New pure `legendRows(counts)` in `utils/sales-pins.ts` returns exactly the two rows the legend renders:
`installed` (label/colour from `PIN_CATEGORY_META.installed`, count = `uploaded + installed`) and
`pendingInstall` unchanged. `LeadMap.tsx`'s legend now maps over `legendRows(pinCategoryCounts)` instead
of `PIN_CATEGORIES`.

⚠️ **This merges the LEGEND DISPLAY only.** `PinCategory` stays three-valued everywhere else —
`getPinCategory`, `countPinCategories`, `PIN_DRAW_ORDER`, the GeoJSON `category` on each pin feature, all
untouched, and none of them call `legendRows`. Safe to merge only the display because the status filter
already treated them as one bucket (`matchesPinStatusFilter`: `installed` = `!== pendingInstall`, i.e.
uploaded OR installed) — the legend was the last place still splitting them.

No test change: `PIN_CATEGORIES` / `PIN_CATEGORY_META` are untouched and still exported (nothing else
in the codebase imports `PIN_CATEGORIES` outside this legend, confirmed by grep, but the constant stays —
it is still the correct enumeration of the three underlying categories, just not what the legend iterates).

⚠️ Needs a device check: the legend now shows 2 rows, Installed's count is uploaded+installed summed
correctly, and Pending install is unaffected.

### Follow-up — the two new toggles were both the switch's default green

Ticket: *"all the toggles [look] same, make it different for pending install and installed — and make
sure Installed shows all pins that are installed OR uploaded."*

**The second half was already true and needed no code change** — confirmed by reading
`matchesPinStatusFilter`: `filter === 'installed'` returns `!isPending`, which is `true` for BOTH
`'uploaded'` and `'installed'` categories (only `'pendingInstall'` sets `isPending`). The `IN` switch
already showed uploaded + installed together from the follow-up above; this ticket only asked to make
sure, so nothing there was touched.

**The first half was real.** `MapToggleSwitch` hardcoded its ON colour to green (`#4CBB17`) — every one
of the six switches (heatmap, my jobs, referral, favorite, and the two new ones) turned the SAME green
when active, so `IN` and `PD` were indistinguishable from each other and from the four unrelated filters
without reading the two-letter label.

`MapToggleSwitch` gained three optional props — `activeColor`, `activeDotColor`, `activeLabelColor` —
each defaulting to the ORIGINAL hardcoded literal (`#4CBB17` / `#4ade80` / `white`), so heatmap / my jobs
/ referral / favorite render byte-identical to before; only `IN` and `PD` in `LeadMap.tsx`'s button array
pass anything:

- **`IN`** — `activeColor: PIN_CATEGORY_META.installed.color` (`#4CBB17`, same green as its pin).
- **`PD`** — `activeColor: PIN_CATEGORY_META.pendingInstall.color` (`#FFD400`, same yellow as its pin),
  plus `activeDotColor: '#FFF176'` and `activeLabelColor: '#1C252E'`.

⚠️ **`activeLabelColor` is not cosmetic — it fixes a real contrast bug the default would have shipped.**
White text (the switch's default `labelActive` colour) on `#FFD400` is illegible; `PD` is the only switch
that overrides it, to a dark near-black that reads clearly on yellow.

⚠️ **The idle track outline is now DERIVED from `activeColor`, not a second hardcoded literal.**
`` `${activeColor}33` `` reproduces the original `#4CBB1733` exactly when no colour is passed, and gives
`PD` a matching faint yellow outline while off, with no second prop needed.

⚠️ **Colour comes from `PIN_CATEGORY_META`, not a hand-picked hex.** A toggle for a pin category is
always this: `activeColor: PIN_CATEGORY_META.<category>.color`. Hand-picking a "close enough" colour here
is exactly how a legend/toggle/pin trio drifts apart over separate tickets — the failure mode most of this
file's ΔE and pixel-verification work exists to prevent.

No filtering-logic change, no test change — this is presentational, and `matchesPinStatusFilter` (already
covered by `sales-pins.test.ts`) was the thing being verified, not modified.

⚠️ Needs a device check: `INS` turns Installed-green, `PI` turns Pending-yellow (labels renamed in the
follow-up below — the colours and behaviour here are unchanged), both read clearly against the other four
(still plain green) and against each other; `PI`'s dark label text is legible on the yellow track; the
idle (OFF) state of all six is still visually consistent as one family of switches.

### Follow-up — active-state labels renamed: `IN` → `INS`, `PD` → `PI`

Ticket: *"pending install toggle name should be PI, installed toggle should be INS."* Label-only change
in `LeadMap.tsx`'s button array (`active: 'INS'` / `active: 'PI'`); the `id`s (`IN-4` / `PD-5`), the
`type`s (`'installed'` / `'pendingInstall'`), the colours and the filtering behaviour are all untouched.
`INS` is 3 characters, same width the switch's existing `DEF` inactive label already proved fits at this
font size — no layout change needed.

⚠️ Every mention of `IN` / `PD` as the active label in the sections above this one is now stale — they
describe the labels AS THEY WERE for that ticket, not what ships today. Match on `type: 'installed'` /
`'pendingInstall'` or on `PIN_CATEGORY_META`, never on the two-letter label, when tracing this code.

### Follow-up — On-map toggle switches for the pin-status filter (Installed / Pending install)

Ticket: *"add a toggle button for the pending install pins and the installed pins, make sure the filter
works properly, and make sure the toggle is the same as already appended on the map."* The status filter
already existed — `MapFiltersModal`'s dropdown (`FilterState.statusFilter: 'all' | 'pendingInstall' |
'installed'`, applied in `MapDetail`'s `baseFilteredLeads` via `matchesPinStatusFilter`) — but reaching it
meant opening the filters modal. The right-side vertical stack of quick toggles (heatmap / my jobs /
referral / favorite, `MapToggleSwitch`) didn't have one.

**Two new toggle switches, `IN` (Installed) / `PD` (Pending install), added to that same stack** —
literally the same `MapToggleSwitch` component, same button-array pattern, so they read as identical
controls to the four already there ("the toggle should be same as already appended in the map").

~~**No new filtering logic — both switches write the SAME `statusFilter` field the modal's dropdown
already writes**, so `matchesPinStatusFilter` needed no change and the two ways of setting it (dropdown,
on-map toggle) can never disagree:~~

```
// SUPERSEDED — see the follow-up "the on-map toggle now STRICTLY excludes uploaded pins" below.
// Kept for history: this is what the two switches wrote at first.
else if (type === 'installed') next = { ...prev, statusFilter: prev.statusFilter === 'installed' ? 'all' : 'installed' };
else if (type === 'pendingInstall') next = { ...prev, statusFilter: prev.statusFilter === 'pendingInstall' ? 'all' : 'pendingInstall' };
```

⚠️ **SUPERSEDED.** The two are mutually exclusive with EACH OTHER, but independent of heatmap / my jobs /
referral / favorite — that part still holds. ~~`statusFilter` is a single string, so switching one ON is
automatically OFF for the other~~ — see below for how mutual exclusion is enforced now that they no
longer share `statusFilter`. `LeadMap.tsx` still only receives two booleans (`isInstalledOnlyFilter` /
`isPendingInstallOnlyFilter`) and forwards taps through `onToggleFilter`, whose union still has the same
two members (`'installed' | 'pendingInstall'`) — only what `MapDetail` derives those booleans FROM, and
what the handler writes TO, changed. Tapping the active switch again still clears it.

⚠️ **`LeadMap`'s local-mode fallback (`activeFilters`, used when no `onToggleFilter` is passed — the
embedded preview map in `OperationalSections.tsx`) has no analog for these two; both default `false`
there.** A pin-status filter is moot on a single-lead preview with no pin list to filter.

Logged the same way the other four switches are — `toggleMeta.installed` / `.pendingInstall` added to the
existing `module_type: 'heat_map_filter'` toggle-event map in `MapDetail`'s `onToggleFilter` handler (yes,
that module_type name covers the whole right-side stack, not just heatmap — kept for consistency with the
other four rather than introduced fresh). The modal's own `pin_status_filter` log (fired on Apply) is
unaffected and still fires when the rep uses the dropdown instead.

No test change: this is UI wiring over an already-tested filter (`matchesPinStatusFilter` in
`sales-pins.test.ts`), not new filtering logic.

⚠️ Needs a device check: tapping Installed shows only uploaded+installed pins and the legend counts still
foot; tapping Pending shows only the yellow pins; tapping the active one again returns to all pins; opening
the filters modal afterward reflects the same selection in its dropdown (the modal's `useEffect` re-syncs
`localFilters` from `filters` on every change, so this should already hold); "Clear filters" resets both.

### Follow-up — Pending-install pin now uses the UPLOADED pin's shape, not just its colour

Ticket: *"the pending install pins and the uploaded pins design should be the same — currently the
pending install pin is slightly different on the map, design-wise."*

The colour follow-up above recoloured `marker-pending*.png`'s EXISTING artwork purple → yellow, but
that artwork was never the same design as `marker-green*` (uploaded) to begin with — REVUIUX-439 built
`installed` and `pending` as a visually distinct sub-style: a thin ring outline with a white glyph inside
(check for installed, dot for pending), against uploaded's solid teardrop with a normal-weight outline and
no glyph. Measured directly (`@3x`, before this fix): uploaded — 137 black-outline px, 0 white px;
pending — 18 black-outline px, 128 white px. Recolouring the fill alone (the follow-up above) could never
close that gap; the shapes themselves had to converge.

Fixed by discarding `marker-pending*`'s artwork and rebuilding it from **`marker-green*` itself** —
same recolour technique, fill `#4CBB17` → `#FFD400` (the constant was already right; only the base
artwork was wrong) — so the result isn't merely "close", it now shares uploaded's alpha silhouette
**pixel-for-pixel** at all three sizes (verified: every alpha byte compared equal between the two files),
with the same outline weight and no glyph.

~~⚠️ **`installed` was deliberately left out of this fix.**~~ **DONE — see the follow-up near the end of
this section ("installed pin now shares uploaded's design too").** The ticket named only pending vs.
uploaded at the time; `marker-installed*` carried the old thin-ring-plus-checkmark design (colour matched
to uploaded per the follow-up above, shape not) until a later ticket asked for the same treatment.

⚠️ **Do not "restore" the dot glyph or thin ring on pending believing it was intentional signalling** —
that shape was never a deliberate status affordance, it was leftover REVUIUX-439 artwork nobody was asked
to change until this ticket. `PIN_CATEGORY_META.pendingInstall.color` is untouched (`#FFD400`); this was
a base-artwork swap, not a colour change.

No code or test change — `LeadMap.tsx` / `SalesLeadPins.tsx` already resolve `pendingInstall` to
`marker-pending.png` by name, and `sales-pins.test.ts` asserts behaviour, not pixels.

⚠️ Needs a device check: pending and uploaded pins side by side at a few zoom levels, confirming they now
read as "the same pin, different colour" rather than two different pin styles.

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

### Follow-up — the on-map toggle now STRICTLY excludes uploaded pins, and INS moved to the top of the stack

Ticket: *"in the installed toggle only installed pins display, uploaded pins should not display in this
toggle — and move that toggle from very bottom to top side in their position."*

**Part 1 — strict filter.** The follow-up above deliberately reused `statusFilter` so the on-map toggle
and the modal's dropdown could never disagree. That reuse is exactly what this ticket is against:
`statusFilter === 'installed'` means "not pending" (uploaded counts as a historical install — the
REVUIUX-439 web-parity rule at the top of this section), so the `INS` toggle was showing uploaded pins
too. Fixed by giving the on-map toggles their OWN state, entirely independent of `statusFilter`:

- Two new fields on `FilterState` (`MapFiltersModal.tsx`): `isMapInstalledOnly` / `isMapPendingInstallOnly`
  — booleans, not a shared enum, matching the file's existing style for the other on-map-only toggles
  (`isHeatMap` / `myJobsOnly` / `isReferralOnly`). Not counted in `countAppliedMapFilters`, not persisted
  via `savedFiltersToFilterState`, same as those three.
- `MapDetail`'s `baseFilteredLeads` gets a SECOND, independent pin-status check, after the existing
  `matchesPinStatusFilter` line: `if (filters.isMapInstalledOnly && getPinCategory(item) !== 'installed')
  return false;` (and the `pendingInstall` mirror). A STRICT `pinCategory` match, not "not pending".
- `onToggleFilter`'s handler now flips these two booleans directly, enforcing mutual exclusion BETWEEN
  THEM explicitly (turning one on sets the other to `false`) rather than getting it for free from sharing
  one field.
- `MapFiltersModal`'s dropdown — `statusFilter`, `matchesPinStatusFilter`, `PIN_STATUS_FILTER_LABELS` —
  is **completely untouched** and keeps its documented "installed = everything else" web-parity meaning.

⚠️ **This is now a deliberate three-way split, not two views of one rule:** the LEGEND still shows a
merged "Installed" count (uploaded + installed, from the earlier follow-up); the MODAL's "Installed"
dropdown option still means "not pending" (uploaded + installed); the on-map **`INS` toggle** means
ONLY `pinCategory === 'installed'`. A rep CAN see the legend say "Installed: 289" while `INS` shows only
2 pins — that is correct given this ticket, not a bug to reconcile. If a future ticket asks why the
counts don't match, point here rather than "fixing" one to match the other.

⚠️ **`PD` / `PI`'s actual filtering behaviour did not change** — `pendingInstall` was always a strict
`pinCategory === 'pendingInstall'` match under `matchesPinStatusFilter` too (only `installed` had the
"everything else" broadening), so `isMapPendingInstallOnly` produces identical results to the old
`statusFilter === 'pendingInstall'` path. It moved to the new field anyway, for ONE reason the toggle
writes to, not two independent mechanisms that happen to agree today by coincidence.

**Part 2 — reorder.** `INS` moved from 5th position (just before `PI`) to 1st in `LeadMap.tsx`'s button
array, which is top-to-bottom render order in the vertical stack. The other five keep their relative
order; only `INS` was asked to move. ⚠️ **This is a REORDER WITHIN the existing bottom-right stack, not a
relocation to a different part of the screen** — "top side" was read as "top of that list," matching how
the ticket names one specific toggle rather than "the whole control area." If the intent was actually to
move the entire six-switch stack to a different screen position, that is a one-line change to the
`View`'s `style.bottom` in the "Right Side Vertical Controls" block — say so and it's quick to redo.

No test change: `getPinCategory` / `matchesPinStatusFilter` (both covered by `sales-pins.test.ts`) are
unmodified; the new predicate is inline `MapDetail`/React-Native screen code, which per this repo's
testing rule (§6 of the root guide) cannot be loaded under jest, so it was verified by inspection against
the already-tested `getPinCategory`.

⚠️ `MapFiltersModal.tsx` is **CRLF** (not yet in the root guide's list — add it).

⚠️ Needs a device check: `INS` now shows ONLY freshly-completed installs (fewer pins than before, and
fewer than the legend's merged count); `PI` unchanged; the two stay mutually exclusive; `INS` renders as
the FIRST (topmost) switch in the stack with the other five below it in their old relative order; the
modal's "Installed" dropdown option still returns the old broader set.

### Follow-up — `PI` grouped with `INS`, and the WHOLE stack moved from bottom-right to top-right

Two more requests, same session. *"Pending install toggle also move from bottom to top"* — `PI` moved
from 6th (last) to 2nd in `LeadMap.tsx`'s button array, right after `INS`, so the two pin-status toggles
are grouped together at the top rather than split across the stack; `HM`/`MJ`/`RF`/`FV` keep their
relative order, now 3rd-6th. Then *"change the toggle position from bottom to top"* — the container
`View`'s positioning style changed from `bottom: Platform.OS === 'android' ? 120 + insets.bottom : 120`
to `top: Platform.OS === 'android' ? 100 + insets.top : 100`, moving the entire six-switch stack (not
just the two pin-status ones) to top-right.

⚠️ **The `100` top offset is a reasonable guess, not measured against the screen's header overlay.**
`MapDetail` claims `HeaderContext` actions (`onFilterPress` / `onListPress`, rendered by the globally-
mounted `widgets/common/MainHeader.tsx` — the stack's navigator has `headerShown: false`, so this is the
ONLY header any `MapDetail`-family screen gets) and `LeadMap.tsx` also renders its own back button at
`top-5 left-5`. `100` was chosen to clear both plus the status bar via `insets.top`, but was not verified
against `MainHeader`'s actual rendered height on device — this is the thing most likely to need a small
number tweak after the device check below, not a redesign.

No filtering, colour, or label change in this follow-up — purely two `View`/array positions.

⚠️ Needs a device check: the whole stack sits clear of the back button and any header icons in both
orientations; `INS` and `PI` render as the first two (topmost) switches with the other four below them.

### Follow-up — legend label capitalised: "Pending install" → "Pending Install"

Ticket: *"change the spell Pending install to Pending Install."* `PIN_CATEGORY_META.pendingInstall.label`
(`utils/sales-pins.ts`) was `'Pending install'` — inconsistent with its own siblings `'Uploaded'` /
`'Installed'` (both already capitalised) and with `PIN_STATUS_FILTER_LABELS.pendingInstall` (the modal
dropdown's label), which was already correctly `'Pending Install'`. Now matches both.

⚠️ **Do NOT also capitalise `getPinDateLabel`'s `'pending install'`** (the `Sold {date} · pending install`
job-card caption, and its bare `'Pending install'` fallback with no sale date). That one is SENTENCE CASE
— a lowercase word inside a longer phrase — not a standalone label, and `sales-pins.test.ts` asserts it
lowercase. The two look similar in a `grep` but serve different roles; only the legend/toggle-family label
was the ticket.

### Follow-up — a pin-status badge on the tapped-pin card was tried, then reverted

Ticket: *"when we click on the pin, these details open — at this point we do not show the pin status,
either pending install, installed, or uploaded."* A small coloured pill (dot + `PIN_CATEGORY_META` label,
same colour as the pin/legend/toggle) was added to `MapJobCard.tsx` under the Job# heading. Immediately
reversed: *"I want to remove this highlighted status from the pin card."* `MapJobCard.tsx` is back to
byte-identical with its pre-ticket committed state — no import, no derived value, no badge left behind.
Noted here only so a future session doesn't re-add the same badge believing the request was never tried.

⚠️ **That revert alone did NOT satisfy the request.** The next message, with a screenshot: *"still status
is on the card — pending install — I want to remove the status from the card."* The "status" was never
the badge (which by then didn't exist) — it was the PRE-EXISTING `· pending install` suffix on the date
line (`"Sold 09/25/2026 · pending install"`), unrelated to anything built this session. Fixed in
`getPinDateLabel` (`utils/sales-pins.ts`): the sold-date branch is now just `` `Sold ${sold}` ``, and the
no-date-at-all fallback returns `''` instead of the bare word `'Pending install'`. The pin's status is
still communicated — by COLOUR alone (the pin, the legend, `INS`/`PI`) — this line is a date and no longer
also says the status in words.

⚠️ **This function is SHARED** — `MapDetail/index.tsx`'s list-view row (`renderItem`'s `dateStr`) reads
`getPinDateLabel` too, so the list view lost the same suffix for free, with no separate edit there.

⚠️ **Do not reintroduce a status word on this line, in any form — text suffix or badge.** Two independent
attempts at showing status IN WORDS on this card were both explicitly rejected in the same session. Colour
is the established channel for it on this card.

Test updated: `sales-pins.test.ts` › `'pending: scheduled install, else JUST the sold date, else empty —
no status word'` now asserts `'Sold 09/20/2026'` (no suffix) and `''` (was `'Pending install'`).

### Follow-up — installed pin now shares uploaded's DESIGN too, exactly as flagged above

Ticket: *"make sure the installed pin design and the uploaded pin design [are not different] — we can use
the uploaded pin design for both types."* This is precisely the follow-up flagged two sections up when
`marker-pending*` was rebuilt from `marker-green*`'s artwork: installed and uploaded were colour-identical
(`#4CBB17`, both) since the earlier colour-merge ticket, but installed still carried the OLD thin-ring-
plus-checkmark shape while uploaded is a solid teardrop with a normal outline and no glyph — the same
shape gap that pending had, now asked about installed too.

Fixed the same way pending was — rebuild from `marker-green*` — except **no colour remap was needed at
all**, since the two hexes were already equal: `assets/images/map/marker-installed{,@2x,@3x}.png` are now
literally **byte-for-byte copies** of `marker-green{,@2x,@3x}.png` (verified: full-file byte comparison
equal at all three sizes, not just the alpha silhouette). Installed and uploaded pins are now, for the
first time, the exact same image.

⚠️ **Still two separate FILES, not one shared `require()`.** Same reasoning as the colour-merge ticket:
independent files that happen to render identically are easier to diverge again later (a future "tell them
apart" ticket touches one clearly-named file) than untangling a shared image reference used by two
different `iconImage` categories in both `LeadMap.tsx` and `SalesLeadPins.tsx`. Neither file needed any
code change — both already resolve `installed` → `marker-installed.png` by name.

⚠️ **`pendingInstall` is now the ONLY pin with its own distinct shape** (still the solid-teardrop design,
just yellow — see the earlier follow-up). Uploaded and installed are visually and now byte-level identical;
only the legend/toggle/dropdown-level distinction between them (documented in the follow-ups above) still
exists in DATA, not in anything visible on the map itself.

No code, colour constant, or test change — `PIN_CATEGORY_META.installed.color` was already `'#4CBB17'`.

⚠️ Needs a device check: an Installed pin and an Uploaded pin, side by side, are visually indistinguishable
on the map (which is now correct per this ticket) — confirm no stray thin-ring/checkmark artwork survives
on any cached/bundled asset.

## Add New Lead form: one type scale, and the address no longer cuts off

`widgets/modals/LeadCreate/index.tsx`. The form mixed 12pt regular inputs (`CustomInput`) with a 14pt BOLD address
box, a 4pt-indented label (`CustomInput` hardcodes `ml-1`) beside flush ones, and doubled gaps (`gap-5` on top of each
input's own 16pt `marginBottom`).

- Every input is 14pt via a new `INPUT_FONT_SIZE`; labels are `text-sm font-semibold` and flush (`flushLabel`).
- The address field is now `multiline` and GROWS (`minHeight` 50, same box style as the other fields), because the
  single-line 56pt box clipped the tail of a full Google address ("...FL 33880, USA"). `scrollEnabled={false}` +
  `submitBehavior="blurAndSubmit"` so Return still dismisses instead of inserting a newline.
- Spacing is now one 16pt rhythm: parent `gap-5` removed; the Lowe's, address and classification blocks carry `mb-4`.

- ⚠️ `CustomInput` re-applies its style through `setNativeProps` in an effect, which replaced any `style` fontSize with
  its own 12 after mount. It therefore got dedicated `fontSize` / `flushLabel` props (see `app-wide.md`); do not size
  it through `style`.
- Page rhythm: the scroll content carries the 24pt gutter (`contentContainerStyle`, matching the header's `p-6`; it was `px-6 py-6` on the ScrollView's own style, which shrinks the frame), the close button has `marginRight: -8` to cancel its own `p-2` so the x sits on the same right edge as the fields, every block is separated by 16pt, and the LF-lead box is `mb-4` (was `mb-6`) with the submit button's extra `marginTop: 12` removed.

## Zone Canvasser: draw toolbar hidden under the nav bar / zoom stack

Ticket: Cancel / Undo / Save Zone were hidden on Android (behind the three-button navigation bar) and on iOS and
Android alike "Save Zone" sat underneath the zoom buttons.

- `widgets/modals/ZoneCanvasserMap.tsx`: a `bottomInset` spacer ends the map ABOVE the system bar. It is
  `max(insets.bottom, screen height - window height)` on Android. ⚠️ The map is a `statusBarTranslucent` Modal, which
  draws under the navigation bar while the app-level `insets.bottom` can still be 0; the screen-minus-window height is
  the bar's real height in that case (and 0 when the window is already edge-to-edge, where `insets.bottom` is right).
- `widgets/components/ZoneCanvasser/DrawingToolbar.tsx`: the three buttons share the width (`flex-1`) inside
  `left: 16, right: 72`, so they stop short of the right control column (44pt + 16 margin). They were centred at full width.
  `bottom: 48` clears the Mapbox logo/attribution, which is kept on (`logoEnabled`) - do not hide it.
- ⚠️ If a new control is added to the right column, keep the toolbar's `right: 72` in step with its width.
- Top-row alignment: the back button's left margin was 20 against 16 on the right-hand draw tools (and the bottom controls), so it is now 16 everywhere. While DRAWING the search bar is hidden, so `MapDrawTools` moves from `top: 76` to `top: 20` and lines up with the back button; the pentagon icon is 20pt like the rectangle.
- ⚠️ The toolbar first used `bottom: 48` to clear the Mapbox logo, which left it floating ABOVE the zoom stack's bottom edge. The logo/attribution stay visible (Mapbox terms: `logoEnabled` / `attributionEnabled` must remain true) but live under the back button now, so the toolbar and the controls share one bottom line.
- Right-hand column: every control is 44pt wide on the same `right-4` axis. The PINS toggle (32pt wide) sat on a narrower container, so its centre was ~5pt off the column; it now has a fixed `width: 44`. Draw buttons are `rounded-xl` like the zoom stack, and the stack's gaps are 8 (was 12) to match the draw buttons'.
- Add New Lead, Issued Lead's **Lead ID** asked for `NUMERIC_KEYBOARD` (the DECIMAL pad), which on Android shows blank keys plus `. - ,` - the client's complaint. It is a whole-number field, so it uses `NUMBER_PAD_KEYBOARD` (clean 0-9) and `onChangeText` strips non-digits. iPad is unchanged (both constants resolve to `numbers-and-punctuation` there). The Appointment Date field stays a text keyboard because it needs `/`.
- Add New Lead used TWO keyboards: Phone Number was `phone-pad` (letters + `* + #`) and Lead ID `number-pad`. Both digit fields now use `NUMBER_PAD_KEYBOARD`, so the form shows one layout; the phone formatter supplies the `+1 ( ) -` punctuation. Do not point a digit field here back at `phone-pad`.

## Zone Canvasser: Mapbox logo and info (i) button removed

Ticket: *remove the Mapbox logo and the information button from the footsteps map.* `MapCanvas.tsx` `<MapView>` now has `logoEnabled={false}` and `attributionEnabled={false}` (both were `true`).

- ⚠️ Mapbox terms normally require the wordmark/attribution to stay visible; this was an explicit product request. If the attribution must come back, surface it elsewhere (e.g. a Profile/About screen) rather than re-enabling the on-map (i).

### Merge note: Add Lead submit combines the pin-coordinate rule with the offline flow (`dev-qs-offline`)

`widgets/modals/LeadCreate/index.tsx` had three conflicts. The merged submit does, in order: (1) `resolveSyncAddress` settles the filed address (`submitAddress`; a rep-typed address always wins over a reverse-geocode); (2) `leadLocation` = the stored GPS/picked-suggestion `location`, else the coordinates inside a `📍` placeholder address, else — ONLINE only — `geocodeAddress(submitAddress)`; (3) both payloads (`selfGen` and `lfLead`) use `submitAddress` and `leadLocation`. Offline it parks the payload via `enqueueOfflineLead`.

- ⚠️ `leadLocation` must keep driving the pin (`location.coordinates` AND the zone `latitude`/`longitude`) — the earlier fix that stopped a typed address being saved on the rep's own GPS position (the Davenport-on-Lahore bug) still holds because `handleAddressSearch` clears `location` when the rep types.
- ⚠️ `geocodeAddress` is a network call, so it is gated on `isOnline()`; ungated it would stall or fail an offline submit.
- Keyboard: this branch's `NUMBER_PAD_KEYBOARD` stays; the offline branch's `NUMERIC_KEYBOARD` import was unused and dropped.

## Lead Create: custom number pad (pilot)

`widgets/modals/LeadCreate/index.tsx` is the first screen wrapped in `NumPadProvider` (full notes and traps in
`app-wide.md` -> "Custom in-app number pad"). Lead ID and Phone use the in-app pad; Name, Email, Lead Code and
Address keep the system keyboard.

- ⚠️ **The provider wraps the ScrollView, the RN flash message and sits INSIDE `GlobalKeyboardAvoidingView`**, so the pad
  is a bottom sibling and the ScrollView shrinks (RN `ScrollView` has `flexShrink: 1`). Do not move it outside the `Modal`
  or turn it into an overlay.
- ⚠️ The phone field's `formatUSPhoneNumber` + `maxLength={17}` is why the pad edits at the END of the text only.
- ⚠️ Lead Create now passes `mode="inflow"` explicitly: the pad is app-wide (the patched `Modal` also mounts a default pan provider around it), and the NEAREST provider wins, so this one keeps the form-shrinks-above-the-pad layout. Its `GlobalKeyboardAvoidingView` is turned off via `onActiveChange` because it sits ABOVE this provider and cannot see it through `useNumPadActive`.
- Follow-up: Lead Create's provider is now `<NumPadProvider layoutAnimated onActiveChange=...>` (the default mode became `inflow`, so `mode="inflow"` is implicit). ⚠️ It must NOT pass `fill`: its parent is the content-sized `modalContainer` (`maxHeight: '90%'`), where a `flex: 1` wrapper collapses. `layoutAnimated` keeps the smooth form resize this modal had before the app-wide rollout.
- No further Lead Create change: `widgets/modals/LeadCreate/index.tsx` only had its provider props adjusted (`layoutAnimated`, no `fill`) when the pad's default mode became in-flow - see the follow-up above and `app-wide.md`.

## Add New Lead: submit button pinned, no dead space under the form

Ticket: *the Save & Submit button is clipped at the bottom of Add New Lead with a band of white under it.* `widgets/modals/LeadCreate/index.tsx`.
- The button was the LAST item of the `ScrollView` with `paddingBottom: 80`, so any shrink of the viewport (the sheet is `maxHeight: 90%`, the
  keyboard-avoiding view and in-flow pad take space) cut it and left the 80 of padding as dead white. It is now a **pinned footer outside the scroll**
  (top hairline, `paddingBottom: footerBottom`), and the scroll's bottom padding is 16.
- `footerBottom = max(insets.bottom, Android ? 48 : 20)` — ⚠️ insets read 0/stale inside a Modal, hence the floor (Android 3-button bar ≈ 48dp).
- Not changed: `GlobalKeyboardAvoidingView` (`flex: 1`, `padding` on Android modals). ⚠️ If a white band still shows under the footer after the keyboard
  closes on Android, suspect that stale `padding` lift (adjustResize + KAV doubling) before touching the form. Needs a device check.

⚠️ **Follow-up — footer padding collapses while the keyboard / in-app pad is up.** The 48 floor (nav-bar clearance) sat as a dead band between the
keyboard and the button. `footerBottom` is now 12 when `keyboardOpen` (Keyboard `keyboardDidShow`/`Hide`) or `numPadActive`, and the nav-bar floor
otherwise. The `numPadActive` hook is also how the Android "Done"-less in-flow pad is covered, since it fires no Keyboard events.
- ⚠️ `footerBottom` reads `keyboardOpen` and `numPadActive`, so it must be declared AFTER both `useState`s in `LeadCreate/index.tsx` (a block-scoped
  use-before-declare is a TS error and a runtime TDZ crash on open).

### Follow-up — Add New Lead: ONE keyboard behaviour for the system keyboard and the in-app pad

Ticket: *system keyboard (Email) hid "Save & Submit Lead" under it while the in-app pad (Phone) left it visible — two behaviours.* `LeadCreate/index.tsx`.
- Root cause: `KeyboardProvider` (App.tsx) makes the app edge-to-edge, so Android no longer resizes the window; RN's `KeyboardAvoidingView`
  (via `GlobalKeyboardAvoidingView`) and a hand-measured `marginBottom` lift (tried, removed) both missed the real keyboard.
- Now the same pair `RoofWaiverModal` / `CoCFormModal` use: `react-native-keyboard-controller` `KeyboardAvoidingView behavior="padding"` as the dimmed
  overlay (`enabled={!numPadActive}` — the pad sizes the form itself) shrinks the sheet to the space above the keyboard, and `KeyboardAwareScrollView`
  (`bottomOffset 24`) brings the focused field into it. The pinned footer therefore rides directly on either keyboard.
- ⚠️ `modalContainer` MUST keep `flex: 1` (it used to come from `GlobalKeyboardAvoidingView`): `NumPadProvider`'s `flex: 1` wrapper collapses to 0
  height in a content-sized sheet and the "+" button then shows only the dim overlay. Never make the sheet content-sized.
- ⚠️ `scrollViewRef` is `useRef<any>` (keyboard-controller's scroll view); the `scrollTo` calls are unchanged. `footerBottom` still collapses to 12 while a keyboard is up.

### Follow-up — merge conflict with `dev-qs-offline`'s address resolution, both kept

Merging `dev-v1-multi-tenat` into `dev-qs-offline` conflicted in `LeadCreate/index.tsx`'s submit
handler: this ticket's `leadLocation = location || (await geocodeAddress(form.address))` (the
Lahore-pin fix above) against `dev-qs-offline`'s own, unrelated `resolveSyncAddress`/`reverseGeocode`
offline flow for the ADDRESS TEXT (a rep-typed address must never be replaced by a geocode — see that
util's own doc comment). **Both are needed, and don't overlap**: one resolves `fullAddress` (the
string), the other resolves `location` (the coordinates payload) — resolved by keeping both blocks
and computing `submitAddress` and `leadLocation` side by side, then using `leadLocation` consistently
in the LF-lead branch's `location` field (HEAD's conflict side had a stray `location` there instead of
`leadLocation`, inconsistent with the unconflicted Self-Gen branch two cases below it — fixed to match).

⚠️ **Correction — this DID change offline behavior, caught in a follow-up audit.** `dev-v1-multi-tenat`
had never gone through the offline work at all (confirmed: it is literally the merge-base commit, with
no commits of its own — the "merge" carried in nothing new), so `geocodeAddress` unguarded is what
`LeadCreate` looked like *before* `dev-qs-offline` existed. Carrying it back in via the conflict
resolution reintroduced an **un-gated network call inside `handleSubmit`, ahead of the `!isOnline()`
queue-and-park branch** — every OTHER network call this offline work added
(`handleGetCurrentLocation`'s reverse-geocode, `handleAddressSearch`'s autocomplete, the
`reverseGeocode` call just above this one) is `isOnline()`-gated; this one was not. Not a crash or a
lost lead (`geocodeAddress` swallows its own errors to `null`, so offline it still resolves to
`location || null` and the lead still queues via `enqueueOfflineLead`), but it added a doomed network
attempt to every offline submit with no GPS fix, and — in a currently-unreachable but fragile
combination (see the placeholder-fill guards this file already has) — could forward-geocode a
`"📍 lat, lng"` placeholder string instead of parsing it back to coordinates.

**Fixed**: `leadLocation` now tries `parseCoordsPlaceholder(form.address)` before falling to a geocode,
and the geocode itself is gated `isOnline() ? await geocodeAddress(form.address) : null` — same
discipline as every other network call in this handler, and the "geocode failure sends NO location"
rule above is unchanged (still `null`, never a stale `location` fallback).

## First / Last Name auto-capitalize on Add New Lead

Ticket: *"Auto CAP first letter of first and last name."* `onChangeText` for both fields now runs the
typed text through a local `capitalizeFirst` (uppercases index 0 only, leaves the rest untouched — a
`.toLowerCase()` on the remainder would fight a rep typing `McDonald` or `O'Brien`), paired with
`autoCapitalize="words"` on the underlying `TextInput` as a keyboard-level hint (`CustomInput` defaults
to `autoCapitalize="none"`; the prop passed here overrides it). Cosmetic only — no change to validation,
payload shape, or the offline queue.

## Map list view: Price `$` sign matched to the amount's colour, no gap

Ticket: *"make the dollar color black and also remove the space between dollar and number."*
`MapDetailScreen`'s list-view job card (`renderItem` inside the `FlatList`, the Price column) had the
`$` in green (`text-[#2EDE56]`) with a `mr-1` gap before the amount, which read as disconnected from
the black/slate price figure beside it. `$` now shares the amount's own class
(`text-slate-800 dark:text-zinc-200 font-bold`, same as the number) and `mr-1` is dropped so the two
sit flush. Cosmetic only — the Date/Rep rows below it, which use the SAME green, are untouched (only
the Price row's `$` was in scope).

## Sales List: distance (filter + per-result)

Ticket: *"Sales Rep | Sales List | Distance — filter by distance. Results should also have
distance."*

### The rules live in `utils/sales-pins.ts`

`getJobCoords`, `distanceInMiles` (haversine), `getJobDistanceMiles`, `formatDistanceMiles`,
`compareByDistance` — pure and RN-free, so they are testable; `MapDetail` pulls in React Native.

⚠️ **`location.coordinates` is GeoJSON `[longitude, latitude]`** — the opposite order from every
`{ latitude, longitude }` object in the app. Read the obvious way round, a Florida job (27.95,
-82.46) lands at -82.46, 27.95 in the Southern Ocean: wrong by thousands of miles rather than
visibly broken. Same trap as `offline-lead-location.ts`.

⚠️ **An unknown distance is `null`, never `0`.** A job with no coordinates is not "0 miles away" —
0 would sort it to the top of the distance order and print as the nearest door on the card. It
renders as `—` and `compareByDistance` sends it to the END of the list in either direction.

⚠️ **`MapDetail`'s own `getDistanceInMiles` / `toRad` were deleted.** They were a second definition
of the same maths; the radius filter now calls the shared helper. Do not reintroduce a local copy.

### The filter was silently doing nothing without a searched address

The modal has had a **"Select Distance"** radius picker all along, but the filter was gated on
`filters.centerCoords && filters.radius > 0` — so choosing a radius did **nothing** unless the rep
had *also* searched a location. A filter that silently no-ops is worse than one that is absent,
because the rep believes the list is filtered.

It now centres on `filters.centerCoords || userLocation` — the searched location when there is one,
otherwise the rep's own GPS fix.

⚠️ **Skipped entirely when there is no origin at all** (no search AND no fix yet). Filtering against
nothing would empty the list until the GPS lock lands, which reads as "no jobs near me".

⚠️ `userLocation` is now a dependency of `baseFilteredLeads`. Without it the list would not
re-filter when the fix arrives.

### The list

- **Order By ▸ Distance** — a fifth sort option. With no fix yet every comparison is 0, so the list
  keeps its incoming order rather than shuffling when the fix lands.
- **A Distance field on each card**, sharing a two-column row with Rep. ⚠️ Distance keeps its own
  column when the rep is not the job owner (no Rep block), rather than jumping to the left edge.
- `formatDistanceMiles`: one decimal under 100 miles, none above it — a tenth of a mile matters when
  choosing the next door and is false precision at three digits.

Tests: `__tests__/utils/sales-pins-distance.test.ts` (19), including the axis order and the
positionless-job ordering.

### Follow-up: split into Distance Ascending / Distance Descending

Ticket: *"instead of Distance it should be Distance Ascending and Distance Descending like the
other [options], and then leads should show accordingly."* The single "Distance" entry didn't match
the Price/Date options, which each have an explicit direction, and there was no way to see the
farthest jobs first.

- `compareByDistance(a, b, origin, descending?)` gained a fourth, optional `descending` param
  (default `false`, so every existing caller/test is unaffected) that flips `da - db` to `db - da`.
  The ⚠️ null-handling (positionless jobs always sort to the END, in EITHER direction) is unchanged —
  only checked at the end, after both nulls are ruled out.
- `MapDetail`'s `sortOption` type/state and `sortLabels` map split `'distance'` into
  `'distance_asc'` ("Distance Ascending") and `'distance_desc'` ("Distance Descending"), matching the
  `price_asc`/`price_desc` and `date_asc`/`date_desc` naming already used there.

---

## Ticket — `offline-cache:consent-filed` is session-KEPT

`utils/session-scope.ts` decides what survives a sign-out. `SESSION_KEEP_PREFIXES` gained
`'offline-cache:consent-filed'`, the local record of which consent forms / roof waivers have
already been filed for a lead (written by `services/consentFiledStore.ts`; rules in
`utils/consent-filed-log.ts`). Background: [`lead-center.md`](lead-center.md).

⚠️ **This one is NOT re-derivable, which is why it is kept.** Most offline-cache rows are a
convenience — the server can rebuild them, so clearing them on sign-out costs a refetch. This row
cannot be rebuilt without a connection, and losing it re-opens the duplicate-signature bug: the rep
is offered a blank consent form for a lead the customer has already signed. Compare
`lead-calc-status:*`, which is deliberately NOT kept precisely because the server can answer for it.

⚠️ **Keeping it does not leak it between reps.** The value goes through the owner-stamped envelope
(`utils/offline-cache-envelope.ts`), and `decodeEnvelope` returns null when `parsed.userId` does not
match the caller's owner — so a second rep on the same handset reads nothing. Keeping a key and
scoping a key are separate mechanisms; do not "fix" one by removing the other.

⚠️ `SESSION_KEEP_PREFIXES` is matched with `startsWith`, so the entry covers every
`offline-cache:consent-filed:<ownerId>` key without listing owners.

---

## Profile — the connection diagnostics card

`<ConnectionDiagnosticsCard />` sits in `screens/Profile/index.tsx` between the **OFFLINE DATA**
card and `<PendingUploadsCard />`, in the same maintenance stack as the offline map packs. The
component is `widgets/components/ConnectionDiagnosticsCard.tsx`; the reasoning and the
connectivity bug behind it are in [`offline.md`](offline.md).

Why it is in Profile: the client's complaints cluster on mobile data and none of them reproduce on
office WiFi, so the rep needs something they can read out. It shows status, radio generation
(LTE vs 5G), NetInfo's reachability verdict, **the url reachability is testing**, time since the
last successful `/health` and how long it took, the pending sync count and a badly-skewed device
clock — with *Check now* and *Share*.

⚠️ **It is a read-out, not a control.** Everything on it is display-only except *Check now*
(`recheckNetworkNow`). Nothing here may become load-bearing: `getLastHealthSuccessAt` /
`getLastHealthDurationMs` exist for this card alone and must never feed a decision.

⚠️ **Do not drop the url line.** NetInfo's default `reachabilityUrl` pointed at
`clients3.google.com` for the life of the app and nothing printed it, which is exactly why the
false-offline reports went unexplained. That line is the one that makes a wrong target visible.

⚠️ It calls `NetInfo.fetch()` and subscribes on mount for the radio details (`type`,
`details.cellularGeneration`) — `useNetworkStatus` alone does not carry them.

⚠️ `Profile/index.tsx` is **CRLF**; keep `newline=''` on both read and write when scripting edits
to it (CLAUDE.md §6).

## Ticket — Add New Lead: the address box is READ-ONLY offline (GPS only)

Client: *"in offline mode we don't allow user to add the address manually (make sure only in
offline), reason google places not worked in offline. Only default user will go with the lat long
which we are getting from GPS."*

`widgets/modals/LeadCreate/index.tsx`. One derived flag, `addressLockedOffline = !online`
(`useIsOnline`, so a `degraded` one-bar line counts as offline too), drives four things:

- `editable={!fromZone && !addressLockedOffline}` — the same shape the zone-canvasser lock already
  used, so the two locks compose instead of fighting.
- The placeholder becomes *"Tap the pin to capture your GPS position"* instead of a street address.
- The disabled grey (`#EDEDED`) that `fromZone` already used, so the box reads as locked.
- The hint no longer invites typing: it now says the street address is filled in on reconnect.

- ⚠️ **Typing offline also DESTROYED the GPS fix.** `handleAddressSearch` does `setLocation(null)`
  on every keystroke (correct online — the typed text supersedes the pin). Offline there is no
  Places call to produce a replacement, so a rep who typed one character lost the only position the
  device had. The read-only field removes that path entirely; do not "allow typing but keep the
  coordinates" without rewriting that handler.
- The GPS pin button stays enabled offline (`disabled={fromZone}` only) — it is the one way to fill
  the field, and the new placeholder points at it.
- The ✕ clear button still works offline and deliberately leaves `location` set: it blanks the box
  so the pin reappears and the rep can re-capture. Without it a wrong fix would be unfixable.
- Submit validation (`!form.address`) is unaffected — offline the box holds the coordinate string,
  which is non-empty.
- ⚠️ **Online behaviour is untouched**, as asked: Places autocomplete, free typing and the
  suggestion list all behave exactly as before.
- ⚠️ The file has MIXED CRLF and LF endings; match the surrounding block when editing.
- Not verified on device.
