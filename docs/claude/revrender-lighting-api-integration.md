# REVUIUX-483 — revRender Lighting: API Integration Guide

**For:** mobile developer · **From:** backend · **Written:** 1 Oct 2026
**Backend branch:** `feature/ticket-483-revrender-lighting` (committed, not yet pushed)

---

## 0. Read this first

Two things that will save you time:

1. **The UI layer is already built and does not call anything yet.** Everything in
   `src/screens/RevRender/lighting/` and `src/utils/revrender-lighting/` is pure
   state and rendering. This guide is about wiring it to the API.
2. **`src/utils/revrender-lighting/payload.ts` already builds the render request
   correctly.** For the render flow you mostly need to call it and post the result.

Endpoints are grouped below by whether they **exist today** or **do not exist yet** —
check §6 before building anything against an assumption.

---

## 1. What changed vs Core Products

Lighting reuses the *same* endpoints as Core. The only difference is the payload.

| | Core | Lighting |
|---|---|---|
| `renderType` | omitted (defaults to `roofline`) | **`"look"`** |
| `selections` | surfaces + colour names + types | a look: id, name, group, colours |
| Who builds the prompt | backend | backend |
| Who sets dimensions | backend | backend |

`leadsApi.generateRevRender` (`src/services/api/leads.ts:325`) already works for
lighting — it posts to `/rev-render/v1/batches` and passes the body through. **No new
service method is needed for rendering.**

---

## 2. Generate renders

### `POST /rev-render/v1/batches`

One queue item = one payload = one render = one job. Three looks selected means three
entries, not one entry with three looks.

```jsonc
{
  "payloads": [
    {
      "renderType": "look",
      "houseImageUrl": "images/rev-render/<lead>_<date>/<file>.jpg",
      "houseMimeType": "image/jpeg",
      "selections": {
        "lookId":    "nfl-tampa-bay-buccaneers",
        "lookName":  "Tampa Bay Buccaneers",
        "lookGroup": "team",
        "colors":    ["#D50A0A", "#FF7900"]
      },
      "viewLabel": "Front",
      "leadId": "…",
      "jobId": "…"
    }
  ],
  "leadId": "…",
  "jobId": "…"
}
```

**Response `202`:**

```jsonc
{ "success": true, "batchId": "…", "total": 3 }
```

Core and Lighting payloads can be mixed in one batch — each carries its own
`renderType` and the worker routes per job. That is what the `CORE` / `LIGHTING`
queue tags correspond to.

### Building it

Already done for you:

```ts
import { toBatchBody } from '../../utils/revrender-lighting/payload';

const body = toBatchBody(looks, {
  houseImageUrl: extractS3Key(photo.s3url || photo.uri),
  viewLabel: photo.viewLabel ?? photo.label ?? '',
  leadId,
});
await leadsApi.generateRevRender(body);
```

### Field rules

| Field | Rules |
|---|---|
| `lookId` | **required** |
| `lookName` | shown in queue rows; only reaches the image model when `lookGroup` allows (§5) |
| `lookGroup` | `everyday` \| `season` \| `team` \| `theme` \| `custom`. **Send it.** Omitted ⇒ name withheld |
| `colors` | **required**, 1–6 hex |
| `houseImageUrl` | full URL **or** a bare S3 key — the backend presigns a key for you |

### Do not send

`prompt`, `houseDimensions`, `pattern`, `timeOfDay`, `channel`, `coverage`.

The last four are constants under 483 and are **rejected with a 400** if you send a
different value — deliberately, so a future spec change cannot pass unnoticed.
`pattern` is derived from the colour count server-side regardless of what you send.

---

## 3. Poll the batch

### `GET /rev-render/v1/batches/:batchId`

`leadsApi.getRevRenderBatchStatus(batchId)` already exists.

```jsonc
{
  "batchId": "…",
  "status": "running",          // "running" | "done"
  "total": 3,
  "done": 1,
  "succeeded": 1,
  "failed": 0,
  "cancelled": 0,
  "jobIds": ["…"],
  "jobs": [
    { "jobId": "…", "status": "succeeded", "runId": "…", "viewLabel": "Front" },
    { "jobId": "…", "status": "running" },
    { "jobId": "…", "status": "failed", "error": "…" }
  ],
  "createdAt": "…",
  "finishedAt": "…"
}
```

Job status: `queued` | `running` | `succeeded` | `failed` | `cancelled`.

Poll until `done === total`. Identical to Core — the existing progress UI needs no
changes. A `runId` appears on a job once it succeeds; that is what you use to fetch
the image and to share it.

---

## 4. Fetch the rendered images

### `GET /rev-render/v1/runs?leadId=…&limit=20&skip=0`

Each item:

```jsonc
{
  "runId": "…",
  "leadId": "…",
  "jobId": "…",
  "viewLabel": "Front",
  "createdAt": "…",
  "deletedAt": null,
  "originalUrl": "https://…",      // signed
  "generatedUrl": "https://…",     // signed — this is the render
  "selections": {
    "lookId": "oct", "lookName": "Halloween", "lookGroup": "season",
    "colors": ["#FF6A00", "#7B2FBE"], "pattern": "alternating",
    "renderType": "look"            // ← tells you which product produced it
  },
  "textureImageUrls": null
}
```

`selections.renderType` is stamped server-side. Use it to decide whether to render a
Core row or a Lighting row in history — a Core run has `"roofline"`.

Also available: `GET /rev-render/v1/runs/:runId` and
`GET /rev-render/v1/leads/:leadId/runs`.

---

## 5. Look names and the image model

**Team, theme and custom look names never reach the image model. Only their colours do.**

| `lookGroup` | Name sent to the model? |
|---|---|
| `everyday`, `season` | yes — "Halloween" is useful art direction |
| `team`, `theme`, `custom` | **no** |
| missing / unknown | **no** — fails safe |

The rule is team **colours** only, never logos or team names. The catalogue ships 268
club names plus Marvel and DC, which 483 §13 flags for legal review. Custom looks are
excluded too, because a rep can type a club name into one.

Showing the name in the app UI and in queue rows is correct and expected. This is only
about what goes into the prompt. **Send `lookGroup` and the backend handles it.**

---

## 6. Send renders to the homeowner

New endpoints, built for the Results / Send screens.

### `POST /rev-render/v1/shares` — create and send

```jsonc
{
  "leadId": "…",
  "runIds": ["…", "…"],          // the renders the rep ticked
  "channel": "sms",              // "sms" | "email"
  "recipientName": "Jane Homeowner",
  "recipientPhone": "(813) 555-0123"   // or recipientEmail for channel: "email"
}
```

**Response `200`:**

```jsonc
{
  "success": true,
  "shareId": "…",
  "link": "https://…/my-renders/<token>",
  "expiresAt": "2027-10-01T…",
  "sent": true
}
```

**Delivery failure does not fail the request.** You get `200` with:

```jsonc
{ "success": true, "shareId": "…", "link": "…", "sent": false, "deliveryError": "carrier rejected" }
```

The share exists and the link works — show the rep the error and offer retry or copy,
rather than treating it as a total failure.

Phone numbers are normalised server-side, so `(813) 555-0123` is fine to send as typed.

### `GET /rev-render/v1/public/shares/:token` — what the homeowner opens

**No auth.** This is the page behind the link. You do not call it from the app; it is
listed so you know what the customer sees.

```jsonc
{
  "success": true,
  "expiresAt": "…",
  "renders": [
    { "runId": "…", "viewLabel": "Front", "imageUrl": "https://…", "selections": {…}, "createdAt": "…" }
  ]
}
```

Deliberately narrow — no lead, rep, company or pricing. `404` for unknown or revoked,
`410` for expired.

### `POST /rev-render/v1/shares/:shareId/revoke`

Kills a link before it expires. `200` on success, `404` if unknown or already revoked.

### Errors

| Message contains | Cause |
|---|---|
| `runIds is required` | nothing ticked |
| `channel must be 'sms' or 'email'` | bad channel |
| `recipientPhone is required to send by text` | missing number |
| `recipientEmail is required to send by email` | missing address |
| `none of the requested renders are available to share` | runIds not owned by this company, or deleted |

---

## 7. What does NOT exist yet

Do not build against these — there is no endpoint. Hold the state locally for now and
we will wire it when the decisions land.

| Feature | Status |
|---|---|
| **Favourites persistence** | ❌ no endpoint. 483 §13 leaves per-rep / per-office / sync as an open Product decision. Device-local is fine for TestFlight |
| **Recently Rendered persistence** | ❌ no endpoint — though it is derivable from `GET /runs` (distinct `selections.lookId`, newest first), which would also settle 483's "record at Add or at Generate?" question for free |
| **Custom looks persistence** | ❌ no endpoint. A rep who builds five high-school palettes loses them on reinstall today |
| **Photo-guidance popup dismissal** | ❌ no endpoint. Lance specified "per rep account", so it cannot stay on device — but the endpoint is not built |
| **Look catalogue** | Bundled in the app (`src/constants/revrender-looks.json`, 357 looks). Not served. `allLooks()` is the seam if that changes |
| **"Near you"** | ❌ **blocked, not just unbuilt.** 483 §10 specifies it against a static team location table of `lookId`, league, venue lat/lng and state. **That table does not exist** — the catalogue CSV has no coordinates. Nobody can build this until the data is produced |

---

## 8. Errors — render flow

All validation failures return `400 { "error": "…" }` naming the field.

| Message contains | Cause |
|---|---|
| `lookId is required` | missing lookId — also what a Core-shaped payload hits |
| `colors must contain at least one hex colour` | empty palette. Every look is lit; there is no Lights Off under 483 |
| `at most 6 colours` | more than six |
| `lookGroup must be one of` | typo in the group |
| `is fixed at '…'` | tried to override `timeOfDay`, `channel` or `coverage` |
| `renderType must be 'roofline', 'lighting' or 'look'` | typo in renderType |
| `selections.fascia is a hex colour; send renderType…` | a 482-era lighting payload without `renderType` |

---

## 9. Two things you do not need to handle

**Photo orientation.** The backend bakes EXIF rotation into the pixels and derives the
true display size itself. A phone photo stored landscape with a "rotate 90" tag used to
produce a sideways or squashed render; that is fixed server-side. Do not send
`houseDimensions` — a client reading EXIF-tagged dimensions reports the stored size,
which is the bug.

**Prompt construction.** The backend builds it from your `selections`. Anything you
send in a `prompt` field is ignored.

⚠️ Note: two paragraphs of the lighting prompt are **provisional** pending sign-off
(RR-PL-001 v1.5). The payload contract below does not change when that lands, so you
can integrate now — but renders produced before it should not be treated as final.

---

## 10. Testing

`revrender-lighting-collection.json` in the backend repo root is a Postman collection
with 40 requests — every endpoint above, plus every validation guard, so you can see
the exact error for each mistake.

Needs: `baseUrl`, `token` (user JWT), `leadId`, `houseImageKey`.

⚠️ The share requests send **real** texts and emails. Use contact details you own.
