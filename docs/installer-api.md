# Installer app — API surface

Every endpoint the installer role touches, what calls it, and what it sends back.
Base URL: `src/config/env.ts` → `ENV.API_URL` (currently `https://dev-api.revdsm.com/`).
No `/api` prefix. Auth is the app-wide JWT bearer, attached by the axios request
interceptor (`src/services/api/index.ts`).

Paths are defined once in `InstallerEndpoints` (`src/services/api/installer.ts`) and
called only through `InstallerService` — no screen builds a URL.

Status reflects the repo as of **2026-07-29**.

---

## 1. Live endpoints

These are the ones the app actually depends on in the field.

| # | Method | Path | Called by |
|---|---|---|---|
| 1 | `GET` | `installer/v1/my-jobs?period=today\|tomorrow` | Dashboard list |
| 2 | `PUT` | `installer/v1/{jobId}/work` | Check-in / check-out |
| 3 | `PUT` | `installer/v1/{jobId}/reset` | Reset — reopen a job |
| 4 | `PUT` | `installer/v1/{jobId}/images` | Every photo capture (multipart) |
| 5a | `PUT` | `installer/v1/update/{jobId}` | Status transitions — start, result |
| 5b | `PATCH` | `installer/v1/update/{jobId}` | Step data + completion |
| 6 | `POST` | `url/v1/secure/multiple` | Rep photos + job packet (shared endpoint) |
| 7 | `POST` | `user-activity-log/v1/create` | Activity logging (shared endpoint) |

> **Retired:** `PUT installer/v1/update-job-status/{jobId}` is gone. Every transition —
> start, result, reset, complete — is now a top-level `status` on #4.

---

### 1 · Job list

```
GET installer/v1/my-jobs?period=today
```

The signed-in installer's schedule for a day. `period` is `today` or `tomorrow`.

**Response** `{ data: { jobs[], pagination, summaryCounts } }` — each row normalized by
`normalizeInstallerJob`. The list row carries identity, address, arrival window and
status; it does **not** carry `contractDetails`, `preInstallPhotos` or `productDetails`.

- Service: `InstallerService.getJobs(period)`
- Hook: `useInstallerJobs(period)` — TanStack Query, 5-min stale time, refetched on
  every return to the dashboard
- Screen: `src/screens/Installer/index.tsx`

---

### 2 · Check-in / check-out (work session)

```
PUT installer/v1/{jobId}/work          ← check-in, NO body
PUT installer/v1/{jobId}/work          ← check-out, { "workStartedBy": null }
```

Mirrors the sales side's `lead/v1/{leadId}/work`. On check-in the server stamps
`workStartedBy` from the bearer token, which is why the request carries no payload.

**Check-in response** is the full working job — `contractDetails`, `preInstallPhotos`,
`productDetails`, `submissionPdf`. Since `update-job-status` was retired this is the
**only** place that payload comes from, and the detail screen is rendered from it.

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
result or reset all count.

- Service: `InstallerService.startWork(jobId)` / `.endWork(jobId)`
- Screens: `src/screens/Installer/index.tsx` (in), `JobDetail.tsx` (out)

---

### 3 · Reset

```
PUT installer/v1/{jobId}/reset
{ "statusReason": "Manager reopened job for crew follow-up" }
```

Reopens a job so the crew can come back to it. The reason travels as **`statusReason`**,
not `reason` — this endpoint does not share the result actions' wording.

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
of it. Once it succeeds the app wipes the visit's work — locally and, via §5's reset
patch, on the server — and navigates back to the schedule. Ordering matters: a failed
reset leaves the recorded work untouched.

Reset is the one result action that is **not** a status transition; Can't Do Work and
Not Hit go through §5.

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
| `phase` | `pickup` \| `preExisting` \| `pre` \| `post` \| `return` |
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

### 5 · Step data, status transitions, completion

```
PUT   installer/v1/update/{jobId}    ← a transition, nothing else
PATCH installer/v1/update/{jobId}    ← step data (and the completion sign-off)
```

One path, two verbs, and they are not interchangeable: **PUT moves the job, PATCH
writes its data.** This is the only write route for a job — it replaced the older
`PATCH installer/v1/{jobId}` (same fields, **flat**) and
`PUT installer/v1/update-job-status/{jobId}` (transitions).

#### 5a · Transitions — `PUT`

```json
{ "status": "inProgress" }                                    ← job start
{ "status": "cantDoWork", "statusReason": "Site unsafe" }     ← result
{ "status": "notHit", "statusReason": "Customer was not home" } ← result
```

The status is a **wire code, not the button label**: the installer reads "Can't Do
Work", the request carries `cantDoWork` (`RESULT_STATUS_CODE` maps them). The reason
key is **`statusReason`**, matching Reset in §3.

Workflow statuses: `scheduled | inProgress | completed | onHold`. Reset does **not**
come through here — §3. Starting a job is **not blocking**: if this fails, the job
still opens on the check-in payload from §2.

#### 5b · Step data — `PATCH`

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
  PATCH carries the set that is LEFT (remove one of five → four are sent), which is what
  performs the delete. Removing the *last* photo sends an empty array — the one case
  where an empty array is deliberate rather than "this step is untouched".

Also used by **Reset** (`buildResetPatch`), *after* §3 succeeds: every patchable field
back to its untouched value, including the four photo arrays emptied.

- Service: `InstallerService.setJobStatus(jobId, status, statusReason?)` → **PUT**;
  `InstallerService.updateJob(jobId, patch, { status? })` → **PATCH**;
  `InstallerService.completeJob(jobId, allSteps)` → PATCH with `status: 'completed'`
- Hooks: `useUpdateJobStatus`, `useSubmitInstallerResult`
- Builders: `src/utils/installer-step-data.ts`
- Contract reference: `Patch Data sending.txt` (repo root)

---

### 6 · Signed URLs (shared)

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

### 7 · Activity log (shared)

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

## 2. Provisional endpoints — defined but NOT live

These paths exist in `InstallerEndpoints` so the shape was settled ahead of the backend,
but they are gated behind `INSTALLER_USE_MOCKS = true` in
`src/services/api/installer.ts`. **Confirm the final paths with the backend before
flipping that flag** — nothing here has been verified against a running server.

| Method | Path | Service | Reality today |
|---|---|---|---|
| `GET` | `installer/v1/jobs/{jobId}` | `getJob` | Returns mock data. `useInstallerJob` is not called by any screen — the detail screen takes its job from nav params. |
| `PUT` | `installer/v1/jobs/{jobId}/progress` | `saveProgress` | No-op. Timeline progress lives in MMKV (`useInstallProgress`). |
| `POST` | `installer/v1/jobs/{jobId}/result` | `submitResult` | Not called. Results go through the `status` + `reason` of §5 (or §3 for Reset) instead — the result actions *are* status transitions. |
| `POST` | `installer/v1/jobs/{jobId}/discrepancy` | `reportDiscrepancy` | Mocked. Called from Verify Job Scope when a product is flagged; the discrepancy is also written into `jobScopeVerification` via §5, which is the path that actually persists. |

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
   field may exist server-side — worth confirming, then wiring into §5.
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
src/services/api/installer.mock.ts   placeholder jobs for the provisional endpoints
src/config/types/installer.ts        request/response types + INSTALLER_PATCH_FIELDS
src/utils/installer-step-data.ts     stepData builders, one per timeline step
src/utils/installer-upload.ts        multipart descriptors + the upload itself
src/utils/installer-packet.ts        packet key → signed URL
src/utils/installer-hydrate.ts       server install record → local InstallProgress
src/hooks/useInstallerJobs.ts        list / status / discrepancy queries
src/hooks/useInstallerPhotoUpload.ts capture → S3, and waitForUploads()
src/hooks/useInstallProgress.ts      local timeline state (MMKV)
src/screens/Installer/index.tsx      dashboard — list, check-in, start
src/screens/Installer/JobDetail.tsx  timeline, step saves, completion, check-out
revdsm-installer.postman_collection.json   collection (my-jobs + the provisional set)
Patch Data sending.txt               §5 contract, verbatim
```
