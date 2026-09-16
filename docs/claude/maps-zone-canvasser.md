# Map view header & Zone Canvasser (footsteps map)

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/MapDetail/**`, `src/navigation/index.tsx` (HeaderContext), `hooks/useZoneCanvasser.ts`, `services/api/zone-canvasser.ts`, `utils/zone-helpers.ts`, `widgets/components/ZoneCanvasser/**`.
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
