# REVUIUX-483 — Favourites, Recents & Custom looks: now per rep account

**For:** mobile developer · **From:** backend · **1 Oct 2026**

---

## Why this exists

Lance asked for favourites to be **per rep account**, not per device, so a rep who
changes phone keeps their work.

There is also a bug to fix at the same time. Today favourites, recents and custom
looks live in one piece of React state:

```ts
const [lighting, setLighting] = useState<LightingState>(emptyState());
```

That is component state. It resets **every time the screen unmounts** — so a rep
who builds a custom palette, backs out to Lead Center and returns has already
lost it. Not on reinstall; within a single session. These endpoints fix that.

---

## The endpoints

### `GET /rev-render/v1/preferences`

Everything for the signed-in rep, in one call. Call it when the lighting screen
mounts.

```jsonc
{
  "success": true,
  "favouriteLookIds": ["oct", "nfl-tampa-bay-buccaneers"],   // newest first
  "recentLookIds":    ["jul", "warm-white", "dec"],          // newest first, derived
  "customLooks":      [],                                    // not written yet — see §4
  "guidanceDismissed": []                                    // not written yet — see §4
}
```

### `POST /rev-render/v1/preferences/favourites/toggle`

```jsonc
{ "lookId": "oct" }
→ { "success": true, "favouriteLookIds": ["oct", ...] }      // the new full list
```

**Send one tap, get the new list back.** Deliberately a toggle rather than a
whole-list write: if two devices each sent their full list, the later one would
silently wipe the other's change.

### `PUT /rev-render/v1/preferences/favourites`

```jsonc
{ "favouriteLookIds": ["a", "b"] }
→ { "success": true, "favouriteLookIds": ["a", "b"] }
```

Replaces the list. Only use this to reconcile favourites made while offline — a
normal tap should use the toggle.

Errors: `400 lookId is required`, `400 at most 200 favourites`,
`400 favouriteLookIds must be an array`.

---

## Recently Rendered is derived — don't store it

`recentLookIds` is computed from the rep's actual render history, not from
anything the app writes:

```
runs for this user, renderType 'look', newest first → distinct lookIds
```

A run row only exists once a render **completed**, which answers 483 §13's open
question ("record at Add or at Generate?") by construction. There is no write to
get wrong, nothing to keep in sync, and it is already correct on a brand-new
device.

**So delete `recordRendered()` from the client.** It is no longer needed, and
keeping it would mean two sources of truth.

### One thing to keep

The server does **not** filter favourites out of `recentLookIds`. Keep doing that
client-side in `recentsToShow()` — filtering at display time is what makes
unfavouriting a look bring it straight back into Recents. Filtering server-side
would make that irreversible.

---

## What to change

`selection.ts` keeps its shape; the state is just no longer the source of truth.

```ts
// on mount
const { data } = await LeadService.getRevRenderPreferences();
setState((s) => ({ ...s, fav: data.favouriteLookIds, recent: data.recentLookIds }));

// on long-press / star tap — optimistic, then confirm
setState((s) => toggleFavourite(s, lookId));                    // instant feedback
const { data } = await LeadService.toggleRevRenderFavourite(lookId);
setState((s) => ({ ...s, fav: data.favouriteLookIds }));        // server wins
```

Suggested service methods:

```ts
getRevRenderPreferences: () => api.get('/rev-render/v1/preferences'),
toggleRevRenderFavourite: (lookId: string) =>
  api.post('/rev-render/v1/preferences/favourites/toggle', { lookId }),
setRevRenderFavourites: (favouriteLookIds: string[]) =>
  api.put('/rev-render/v1/preferences/favourites', { favouriteLookIds }),
```

**Toggle optimistically.** A favourite is a single tap and should feel instant;
waiting on a round trip to fill the star will feel broken. Revert on failure.

---

## Custom looks — read this before wiring them

`customLooks` and `guidanceDismissed` come back in the GET and are **always empty
today**: the fields exist, nothing writes to them yet.

I stopped short deliberately. Custom looks hold real content rather than ids, so
they need decisions nobody has made:

- what happens when a rep edits one that is already used by a render
- whether the name is unique per rep
- whether they sync across devices or stay local

Until that is settled, **keep custom looks in device storage** rather than
component state — that at least stops them vanishing when the screen unmounts,
which is the bug that matters most to a rep right now.

Shout when you want the write endpoints and I will add them to the same route.

---

## Summary

| | Where it lives now | After this |
|---|---|---|
| Favourites | component state, lost on unmount | **server, per rep account** |
| Recently rendered | component state, lost on unmount | **derived from runs, server-side** |
| Custom looks | component state, lost on unmount | device storage (interim) |
| Photo-guidance dismissal | component state | device storage (interim) |

The first two are the ones Lance asked for and they are ready to wire.
