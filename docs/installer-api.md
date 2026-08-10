# Installer app — API surface

Every endpoint the installer role touches, what calls it, and what it sends back.
Base URL: `src/config/env.ts` → `ENV.API_URL` (currently `https://dev-api.revdsm.com/`).
No `/api` prefix. Auth is the app-wide JWT bearer, attached by the axios request
interceptor (`src/services/api/index.ts`).

Paths are defined once in `InstallerEndpoints` (`src/services/api/installer.ts`) and
called only through `InstallerService` — no screen builds a URL.

Status reflects the repo as of **2026-07-30**.

---

## 1. Endpoints the installer tab calls

Every one of these is wired and hit by the app. **Nothing is served from local storage** —
every screen, including a read-only review, is filled from a response.

| # | Method | Path | Called by |
|---|---|---|---|
| 1 | `GET` | `installer/v1/my-jobs?period=all\|tomorrow` | Dashboard list |
| 2 | `PUT` | `installer/v1/{jobId}/work` | Check-in / check-out — **and** loading a resulted job for review |
| 3 | `PUT` | `installer/v1/{jobId}/reset` | Reset — reopen a job |
| 4 | `PUT` | `installer/v1/{jobId}/images` | Photo capture (multipart) |
| 5 | `DELETE` | `installer/v1/{jobId}/images` | Removing a captured photo |
| 6a | `PUT` | `installer/v1/update/{jobId}` | Status transitions — start, Not Hit |
| 6b | `PATCH` | `installer/v1/update/{jobId}` | Step data + completion sign-off |
| 7 | `POST` | `installer/v1/{jobId}/status-requests` | **Can't Do Work** — files a stand-down request |
| 8 | `POST` | `url/v1/secure/multiple` | Rep photos + job packet (shared endpoint) |
| 9 | `POST` | `user-activity-log/v1/create` | Activity logging (shared endpoint) |

> **Retired:** `PUT installer/v1/update-job-status/{jobId}` is gone. Transitions are now
> a `status` on #6a, and Reset has its own endpoint (#3).

---

### 1 · Job list

```
GET installer/v1/my-jobs?period=all
```

The signed-in installer's schedule. `period` is `all` or `tomorrow` — **wire values, not
the tab labels**: the installer reads "Today" and "Tomorrow".

Which tab a job was tapped in does not decide whether it opens; its own `leadDate` does.
Today or earlier opens (subject to the geofence); a future date is refused with a
"not scheduled yet" message (`utils/installer-schedule.ts`).

**Response** `{ data: { jobs[], pagination, summaryCounts } }` — each row normalized by
`normalizeInstallerJob`. The list row carries identity, address, arrival window and
status; it does **not** carry `contractDetails`, `preInstallPhotos` or `productDetails`.

- Service: `InstallerService.getJobs(period)`
- Hook: `useInstallerJobs(period)` — TanStack Query, 5-min stale time, refetched on
  every return to the dashboard
- Screen: `src/screens/Installer/index.tsx`

---

### 2 · Work session — check-in, check-out, and review

```
PUT installer/v1/{jobId}/work     ← check-in
PUT installer/v1/{jobId}/work     ← check-out, { "workStartedBy": null }
```

Mirrors the sales side's `lead/v1/{leadId}/work`. The worker comes from the bearer token;
what the check-in body carries is **where the installer was standing**, so the server can
enforce the same geofence the app just applied:

```json
{
  "address": "Plot 161, Block F Phase 1 Johar Town, Lahore",
  "location": { "type": "Point", "coordinates": [74.29039, 31.46666] },
  "radius": 20
}
```

`coordinates` is the DEVICE's fix, GeoJSON `[longitude, latitude]` — not the job's own
point, which proves nothing about who is on site. Omitted entirely when no fix could be
produced and the gate allowed the check-in anyway, so a body-less PUT is still valid.

The radius comes from `CHECK_IN_RADIUS_METERS` (`utils/installer-geofence.ts`) — the one
place it is defined, on-device and on the wire.

**Response** is the full working job — `contractDetails`, `preInstallPhotos`,
`productDetails`, `submissionPdf`, plus the install record (`installerPickupPhotos`,
`preExistingConditions`, `jobScopeVerification`, …) that `installer-hydrate.ts` merges
back into the timeline. This is the **only** place that payload comes from.

**Reviewing a resulted job goes through here too.** A finished job — or tomorrow's
preview — opens read-only, and this is the call that fills it. Two differences from a
live check-in:

- **No geofence payload.** A review is not a claim to be standing at the job, so no fix
  is requested and no `location`/`radius` is sent.
- **No status transition.** The job is not flipped to `inProgress` (§6a is skipped).

The session it opens is closed again on the way out, like any other visit. If the call
fails — including a 409 from a colleague who never checked out — the review still opens on
the thin list row, because being locked out of *reading* a finished job would be the worse
outcome.

**403 — the server's own geofence refused.** It is the authority, so its verdict overrides
the on-device check that just passed, and its wording is what the installer sees.

**409 — already checked in**

```json
{
  "code": 409,
  "message": "This job is already checked in by another crew member. You can check in once they check out.",
  "data": { "alreadyCheckedIn": true, "workStartedBy": "693c2e500a10048761f9b823" }
}
```

- `workStartedBy` ≠ signed-in user → hard stop, the job does not open, the server's
  message is shown.
- `workStartedBy` = signed-in user → their own stale session (app killed before
  check-out). The job opens normally and check-out still fires on the way back.

Check-in fires on the dashboard card tap; check-out fires when the detail screen
unmounts — header back, hardware back, swipe gesture, and the `goBack()` after a
result, a reset or the completion sign-off all count.

- Service: `InstallerService.startWork(jobId, checkIn?)` / `.endWork(jobId)`
- Screens: `src/screens/Installer/index.tsx` (in + review), `JobDetail.tsx` (out)

---

### 3 · Reset

```
PUT installer/v1/{jobId}/reset
{ "statusReason": { "reason": "Manager reopened job for crew follow-up",
                    "images": [{ "s3url": "…", "bucketName": "np-revdsm-staging" }] } }
```

Reopens a job so the crew can come back to it. The reason travels as **`statusReason`** —
an object with `reason` plus optional `images[]`, not the bare string an earlier version
of this contract used.

**Response** is a summary, not the job:

```json
{
  "code": 200,
  "message": "Job status reset to inProgress successfully",
  "data": { "_id": "…", "leadId": "…", "jobNumber": "…",
            "previousStatus": "inProgress", "status": "inProgress" }
}
```

The server decides what the job returns to (`inProgress`), so nothing is read back out
of it. Once it succeeds the app wipes the visit's work — locally and, via §6b's reset
patch, on the server — and navigates back to the schedule. Ordering matters: a failed
reset leaves the recorded work untouched.

Reset is the one result action that is **not** a status transition; Can't Do Work and
Not Hit go through §6a.

- Service: `InstallerService.resetJob(jobId, statusReason)`
- Screen: `JobDetail.tsx` → `handleConfirmReset`

---

### 4 · Photo upload (multipart)

```
PUT installer/v1/{jobId}/images
```

Three form fields:

| Field | Contents |
|---|---|
| `phase` | `pickup` \| `preExisting` \| `pre` \| `post` \| `return` \| `coc` \| `result` |
| `files` | the binaries, one part per photo |
| `images` | JSON array of descriptors, index-aligned with `files` |

Descriptor shape per phase:

```
pickup / return  → { subcategory: <phase>, timestampTaken, coordinates }
preExisting      → { conditionLabel, subcategory, timestampTaken, coordinates }
pre / post       → { salesPhotoId, category, subcategory, timestampTaken, coordinates }
```

The server puts each file in S3, appends it to the job's array for that phase, and
answers with `appended` (just these) plus the full post-append list. The app stores
`appended[0].s3url` back onto the local photo — **the step-data PATCH can only
reference a photo that has one**.

Fires on capture, not on step exit. A failed upload never throws: the photo stays on
screen marked `failed` and the installer is told to retake. 120s timeout (job-site
networks). Verb is one constant, `IMAGE_UPLOAD_METHOD`, if the backend registered it
as POST.

- Service: `InstallerService.uploadImages(jobId, phase, files, descriptors)`
- Hook: `useInstallerPhotoUpload` — also exposes `waitForUploads()`, which the step
  save drains first so no PATCH references an unuploaded shot

---

### 5 · Photo delete

```
DELETE installer/v1/{jobId}/images
{ "phase": "pickup", "s3urls": ["images/jobs/…/pickup-abc.jpeg"] }
```

Same path as the upload, different verb. `s3urls` are the bucket-relative keys the upload
returned — **not** displayable URLs; a signed URL resolved for rendering will not match.
Batched, so removing several shots is one request.

`phase` here is a superset of the upload phases: it also accepts `scope`, which nothing
uploads under.

Removing a photo does two things, in this order: this DELETE drops the stored object, then
the step-data PATCH (§6b) restates the set that is LEFT, dropping the reference. Neither
waits for the step to close — a deletion the installer can see happen should be a deletion
on the server before they walk away from signal.

- Service: `InstallerService.deleteImages(jobId, phase, s3urls)`

---

### 6 · Step data, status transitions, completion

```
PUT   installer/v1/update/{jobId}    ← a transition, nothing else
PATCH installer/v1/update/{jobId}    ← step data (and the completion sign-off)
```

One path, two verbs, and they are not interchangeable: **PUT moves the job, PATCH
writes its data.** This is the only write route for a job — it replaced the older
`PATCH installer/v1/{jobId}` (same fields, **flat**) and
`PUT installer/v1/update-job-status/{jobId}` (transitions).

#### 6a · Transitions — `PUT`

```json
{ "status": "inProgress" }                            ← job start
{ "status": "notHit",
  "statusReason": { "reason": "Customer was not home" } }
```

The status is a **wire code, not the button label**: the installer reads "Not Hit", the
request carries `notHit` (`RESULT_STATUS_CODE` maps them). The reason is
**`statusReason`** — an object with `reason` + optional `images[]`, the same shape as
Reset in §3.

> ⚠️ **Can't Do Work no longer comes through here.** It files a status request (§7)
> instead of transitioning the job. Sending `{ "status": "cantDoWork" }` as well would
> stand the job down before anyone had reviewed the request.

Workflow statuses: `scheduled | inProgress | completed | onHold`. Reset does **not**
come through here — §3. Starting a job is **not blocking**: if this fails, the job
still opens on the check-in payload from §2.

#### 6b · Step data — `PATCH`

Step fields sit inside `stepData`; only `status` joins them at the top level, and only
for the completion sign-off.

**On leaving any of the 7 steps** — whatever that step holds:

```json
{ "stepData": { "installerPickupPhotos": [ … ] } }
```

**On "Job Completed?" → Yes** — one request, all 7 steps merged, plus the transition:

```json
{ "status": "completed", "stepData": { …everything… } }
```

Stored keys (`INSTALLER_PATCH_FIELDS`), by step:

| Step | Key |
|---|---|
| 1 · Pickup | `installerPickupPhotos` |
| 2 · Pre-Existing Conditions | `preExistingConditions` |
| 3 · Pre-Install | `installerPreInstallPhotos` |
| 4 · Verify Job Scope | `jobScopeVerification` |
| 5 · Post-Install | `installerPostInstallPhotos` |
| 6 · CoC | — *no backend field exists* |
| 7 · Return | `materialReturnNothingToReturn`, `installerReturnPhotos` |

Rules:

- Photo arrays are sent as the step's **current full set**, never an increment. The
  upload already appended each shot; restating the set is what clears a retaken or
  deleted photo. This assumes the server treats these arrays as a replace.
- A photo joins its array only once its upload returned an `s3url`.
- Unknown keys are stripped before sending. If the server rejects one anyway
  (`400 Unsupported patch fields: X`), the request is retried once without the keys it
  named, so the rest of the step still saves. What was dropped is logged.
- Each step saves on the way out so a second installer signing in sees what has already
  been done. The completion PATCH restates everything, repairing any step whose save
  was dropped on a bad connection.
- **Deleting a photo saves immediately**, without waiting for the step to close: the
  PATCH carries the set that is LEFT (remove one of five → four are sent), which drops the
  reference after §5 dropped the object. Removing the *last* photo sends an empty array —
  the one case where an empty array is deliberate rather than "this step is untouched".

Also used by **Reset** (`buildResetPatch`), *after* §3 succeeds: every patchable field
back to its untouched value, including the four photo arrays emptied.

- Service: `InstallerService.setJobStatus(jobId, status, statusReason?)` → **PUT**;
  `InstallerService.updateJob(jobId, patch, { status? })` → **PATCH**;
  `InstallerService.completeJob(jobId, allSteps)` → PATCH with `status: 'completed'`
- Hooks: `useUpdateJobStatus`, `useSubmitInstallerResult`
- Builders: `src/utils/installer-step-data.ts`
- Contract reference: `Patch Data sending.txt` (repo root)

---

### 7 · Status requests — Can't Do Work

```
POST installer/v1/{jobId}/status-requests
```
```json
{ "reason": "Existing structure is unsafe.",
  "images": [
    { "s3url": "images/jobs/…/photo1.jpeg",
      "bucketName": "np-revdsm-staging",
      "timestampTaken": "2026-08-10T10:00:00.000Z",
      "coordinates": { "latitude": 40.7128, "longitude": -74.006 } }
  ] }
```

The **Can't Do Work** button. A *request* for the job to be stood down, not a
transition: the job's status is untouched until the office acts on it, which is why
this is its own collection and not a `status` on §6a. It replaced the
`{ "status": "cantDoWork", "statusReason": … }` PUT — do not send both.

`images` are the result photos the modal makes mandatory, after their upload (§4) has
returned an `s3url`. Richer than §6a's `statusReason.images`: each carries
**`timestampTaken`** and **`coordinates`** as well, because someone off-site has to
adjudicate the claim and needs to know when and where each shot was taken. Both come
straight off the `CapturedPhoto` (`takenAt` / `coordinates`) — nothing extra is
captured for this. `coordinates` is sent as `null`, not omitted, when the device could
not produce a fix.

Photo uploads are drained before the request goes out, so evidence lands with the
record. If every attached photo failed to upload the request is not sent at all — the
installer is asked to retake rather than filing an unevidenced claim.

- Service: `InstallerService.createStatusRequest(jobId, request)`
- Hook: `useSubmitStatusRequest`
- Caller: `handleSubmitResult` in `src/screens/Installer/JobDetail.tsx`

---

### 8 · Signed URLs (shared)

```
POST url/v1/secure/multiple
{ "filePaths": [{ "bucketName": "np-revdsm-staging", "filePath": "images/…" }] }
```

S3 objects are private, so every bucket-relative key must be exchanged for a signed URL
before anything can display it. Signed URLs live an hour; resolved ones are cached for
50 minutes.

Two installer uses:

- **Rep reference photos** — `useRepPhotoSections`, so the pre/post ghost-match grid can
  show the rep's shot behind the camera
- **Job packet PDF** — `resolvePacketUrl` (`src/utils/installer-packet.ts`), resolved on
  tap rather than on every job open

Service: `LeadService.getSecureUrls(filePaths)`

---

### 9 · Activity log (shared)

```
POST user-activity-log/v1/create
```

Every installer event — schedule viewed, job started, step opened/closed/completed,
photo uploaded/replaced/failed, result submitted, job completed. Sent through a
serialized queue so events arrive in order; called with a raw axios instance, not the
shared wrapper.

- Hook: `useInstallerActivityLog`
- Event builders: `src/utils/activity-log/installer-log.ts`
- Service: `logEvent` (`src/services/api/LoggerService.ts`)

---

## 2. Defined but NOT called

Paths that exist in `InstallerEndpoints` but nothing in the tab hits. The three write
ones are still behind `INSTALLER_USE_MOCKS = true` — which now guards only no-ops, since
no job payload is served from mocks any more.

| Method | Path | Service | Reality today |
|---|---|---|---|
| `GET` | `installer/v1/jobs/{jobId}` | `getJob` | Live and normalized, but not called: a review reads the job from §2 instead, which is the endpoint that actually answers with the working payload. Kept because a plain read that opens no work session is the shape this eventually wants. |
| `PUT` | `installer/v1/jobs/{jobId}/progress` | `saveProgress` | No-op. Timeline progress lives in MMKV (`useInstallProgress`) and syncs through §6b. |
| `POST` | `installer/v1/jobs/{jobId}/result` | `submitResult` | Not called. Results go through §6a (or §3 for Reset) — the result actions *are* status transitions. |
| `POST` | `installer/v1/jobs/{jobId}/discrepancy` | `reportDiscrepancy` | Mocked. Called from Verify Job Scope when a product is flagged; the discrepancy is also written into `jobScopeVerification` via §6b, which is the path that actually persists. |

---

## 3. Shared app endpoints the installer also hits

Not installer-specific, but part of any installer session:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `company/login` | Login |
| `GET` | `company` | Profile / permissions — `installer_dashboard` is what routes a user to the installer dashboard (`useUserRole`) |

A 401 on any call triggers the global logout + "Session Expired" flash
(`src/services/api/index.ts`).

---

## 4. Known gaps

1. **Step 6 · CoC has no backend field.** Scanned Certificate-of-Completion pages stay
   on the device. The check-in response does show an `installerCocPhotos` array, so the
   field may exist server-side — worth confirming, then wiring into §6b.
2. **Matched pre/post shots hydrate only via `salesPhotoId`.** The check-in record is
   merged back into local progress on open (`src/utils/installer-hydrate.ts`), which is
   what lets a second installer — or a reinstall — see work already done. Pickup, return,
   CoC, conditions and scope all map cleanly. Matched pre/post shots need
   `salesPhotoId` to find their slot, because the stored `subcategory` is written as the
   tag *label* by the upload and as the tag *id* by the step PATCH; a shot without a
   `salesPhotoId` (a free "extra") cannot be placed and is skipped.
3. **No "had material on truck" flag for Pickup.** Only Return has a skip flag
   (`materialReturnNothingToReturn`), so a skipped pickup PATCHes nothing.
4. **`installerPickupPhotos` / `installerReturnPhotos` acceptance is unconfirmed.** The
   older endpoint's allow-list didn't include them; the new contract lists them. The
   retry-without-rejected-fields path in `updateJob` covers it either way, and logs what
   the server refused.

---

## 5. Where things live

```
src/services/api/installer.ts        InstallerEndpoints + InstallerService (+ mocks switch)
src/config/types/installer.ts        request/response types + INSTALLER_PATCH_FIELDS
src/utils/installer-step-data.ts     stepData builders, one per timeline step
src/utils/installer-upload.ts        multipart descriptors + the upload itself
src/utils/installer-packet.ts        packet key → signed URL
src/utils/installer-hydrate.ts       server install record → local InstallProgress
src/utils/installer-geofence.ts      check-in radius gate + distance maths
src/utils/installer-card-state.ts    dashboard card label + colour per workflowState
src/hooks/useInstallerJobs.ts        list / status / discrepancy queries
src/hooks/useInstallerPhotoUpload.ts capture → S3, and waitForUploads()
src/hooks/useInstallProgress.ts      local timeline state (MMKV)
src/screens/Installer/index.tsx      dashboard — list, check-in, review, start
src/screens/Installer/JobDetail.tsx  timeline, step saves, completion, check-out
revdsm-installer.postman_collection.json   collection
Patch Data sending.txt               §6b contract, verbatim
```
