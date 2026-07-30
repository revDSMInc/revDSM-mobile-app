# Lead Chat — Mobile Integration Guide (Installer App)

**Audience:** mobile developers adding the chat modal to the Installer app.
**Status:** describes the API as it exists today. **No backend changes are required for the app to integrate** — every endpoint and event below is already live.

---

## TL;DR

**There is one chat per lead, and everybody shares it.** The sales rep, the ops/installer managers, the lead installer and the crew all talk in the same thread. Do **not** create an installer-only chat — the whole point is that the crew can ask the rep a question and the office can see it.

The chat is a **hybrid**: REST for history and file uploads, Socket.IO for everything live.

| Concern | Transport |
|---|---|
| Resolve/create the chat for a job | REST |
| Load message history (paged) | REST |
| Send a message **with attachments** | REST (multipart) |
| Send a **text-only** message | Socket (`send-message`) |
| Receive messages, typing, read receipts, edits, deletes | Socket |
| Unread badge / chat inbox | Socket (`get-all-lead-chats`) |

Work in this order:

| # | Step | Why |
|---|---|---|
| 1 | Resolve chat id from `leadId` | Everything else is keyed on `chatId` |
| 2 | Connect the socket **once per session** and reuse it | One connection per app, not per screen |
| 3 | `join-chat` on open, **and again on every reconnect** | Missing the re-join is the #1 "messages stopped arriving" bug |
| 4 | Load history via REST, **reverse it** | The API returns newest-first |
| 5 | Send + optimistic render + dedup on the `new-message` echo | `send-message` has no ack |
| 6 | `mark-messages-seen` for incoming messages while the screen is open | Otherwise unread counts never clear |

---

## 0. The job → lead → chat relationship

An installer job is an `InstallerAssignment` that points at a `leadId`. **The chat is keyed on the `leadId`, not on the job id.** Whatever job object the app is showing, pull `leadId` off it and use that.

The backend seeds the participant list automatically when the chat is first created: the lead's assigned sales rep, the assignment's `installerId`, `installerLeadId` and `installerMemberIds` (the crew), plus every user holding a regional-manager / ops-manager / installer-manager / installer-assistant-manager / VP-sales dashboard permission.

---

## 1. Auth

Same JWT the rest of the app uses.

**REST:** `Authorization: Bearer <token>` — standard.

**Socket:** the handshake accepts the token in any of four places, so use whichever your socket library makes easy:

```
auth: { token: "<token>" }                    ← preferred
headers: { Authorization: "Bearer <token>" }
query: { token: "<token>" }
query: { authorization: "Bearer <token>" }
```

The server decodes `userId` + `companyId` from the token and auto-joins you to a personal room `user:<userId>`. You do not join that room yourself — but you **do** receive events on it (tags, chat-list updates), so register those listeners globally, not per screen.

If the token is missing or invalid the connection is rejected with `Authentication failed: <reason>` — surface that as "reconnecting", not as a chat error.

---

## 2. REST endpoints

Base path: `/chat/v1`. All responses are wrapped as `{ status, message, data: { ... } }`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/chat/v1/lead/:leadId` | Get the chat for a lead. **404 = no chat yet** |
| `POST` | `/chat/v1/create` | Create it. Body `{ leadId, title?, participantIds? }` |
| `POST` | `/chat/v1/:chatId/participants` | Add yourself/someone. Body `{ userId }` |
| `GET` | `/chat/v1/:chatId/messages` | History. Query `page`, `limit`, `beforeDate` |
| `POST` | `/chat/v1/:chatId/messages` | Send (multipart for files, JSON for text) |
| `GET` | `/chat/v1/:chatId/unseen-count` | Unread count for one chat |
| `PUT` | `/chat/v1/messages/:messageId/seen` | Mark one message seen |
| `PUT` | `/chat/v1/messages/:messageId` | Edit. Body `{ message }` |
| `DELETE` | `/chat/v1/messages/:messageId` | Soft delete |
| `GET` | `/chat/v1/messages/:messageId/replies` | Thread replies |
| `GET` | `/chat/v1/messages/tagged` | Messages where you were @-tagged |

### 2.1 Opening a job's chat

```
GET /chat/v1/lead/:leadId
```

- **200** → `data.chat` with `id`, `participants[]`, `leadId`, `title`, `lastMessageAt`.
- **404** → no chat exists yet. Call `POST /chat/v1/create` with `{ leadId }`.

`POST /chat/v1/create` is safe to call even if a chat already exists — it returns the existing one and adds you as a participant (`data.joined: true`). So "404 → create" is a safe fallback, not a race.

**If you are not in `chat.participants`** (e.g. you were added to the crew after the chat was created), call `POST /chat/v1/:chatId/participants` with your own `userId`. Without it you can still read and post, but you get no unread badge, no list refresh and no push notifications.

### 2.2 History — ⚠️ returns newest-first

```
GET /chat/v1/:chatId/messages?limit=20
→ data.messages[]   (sorted createdAt DESC — newest at index 0)
   data.pagination { page, limit, total, totalPages }
```

**Reverse the array before rendering.** Live messages arriving over the socket must be appended to the end, so history has to be oldest → newest to match. (This exact bug shipped in the installer web app — history appeared upside-down.)

This endpoint **also marks the returned messages as seen server-side**, so you do not need a separate seen call after loading history.

For pagination, either bump `limit` or use `beforeDate` (ISO timestamp of your oldest loaded message) — `beforeDate` is cheaper.

### 2.3 Sending

**Text only** — prefer the socket (§3). REST works as a fallback when the socket is down:

```
POST /chat/v1/:chatId/messages
Content-Type: application/json
{ "message": "on site now", "replyTo": "<messageId>", "taggedUsers": ["<userId>"] }
```

**With attachments** — must be REST, multipart. The socket cannot carry binaries.

```
POST /chat/v1/:chatId/messages
Content-Type: multipart/form-data
  message: "before photos"      (required — send a single space if caption is empty)
  files: <binary>               (repeat, max 10)
```

Either way, the server persists the message and **broadcasts it back over the socket** to everyone in the room including you. Do not append the REST response *and* the socket echo — dedup (see §4).

---

## 3. Socket events

Connect to the API origin (the same host as `HOST_API`). Namespace is the default `/`. Allow both `websocket` and `polling` transports.

### 3.1 Emit (app → server)

| Event | Payload | Notes |
|---|---|---|
| `join-chat` | `chatId` *(plain string)* | Required to receive `new-message`. **Re-emit on every reconnect** |
| `leave-chat` | `chatId` *(plain string)* | On screen close |
| `send-message` | `{ chatId, message, replyTo?, taggedUsers?, files? }` | Text only. No ack — wait for the echo |
| `mark-messages-seen` | `{ chatId, messageIds: [...] }` | **Bulk. Use this one** |
| `mark-message-seen` | `messageId` *(plain string)* | Single. ⚠️ takes a **string**, not an object |
| `typing` | `{ chatId, isTyping }` | Throttle to ~1/sec |
| `get-messages` | `{ chatId, page?, limit?, beforeDate? }` | Socket alternative to the REST history call |
| `get-all-lead-chats` | `{ page?, limit?, status? }` | Chat inbox + unread counts |
| `edit-message` | `{ messageId, message }` | |
| `add-reaction` / `remove-reaction` | `{ messageId, emoji }` | Toggles |
| `get-replies` | `{ messageId, chatId }` | |

> ⚠️ `mark-message-seen` takes a bare string. Passing `{ chatId, messageIds }` to it silently does nothing — the web app has this bug. Use `mark-messages-seen` (plural) with the object form.

### 3.2 Listen (server → app)

| Event | Payload | Use it for |
|---|---|---|
| `new-message` | `{ message, chatId, isReply }` | Append to the thread |
| `message-seen` | `{ messageId, userId, seenBy[] }` | Update read receipts |
| `message-edited` | `{ messageId, chatId, message, oldMessage, editedBy }` | Replace in place |
| `message-deleted` | `{ chatId, messageId }` | Remove / tombstone |
| `user-typing` | `{ userId, fullName, chatId, isTyping }` | Typing indicator |
| `user-joined` | `{ userId, chatId }` | Refresh participants |
| `new-reply` | `{ reply, originalMessage, chatId, replySender }` | Sent to the **original sender's** personal room |
| `reply-count-updated` | `{ messageId, replyCount, chatId }` | Thread counter |
| `reaction-added` / `reaction-removed` | `{ messageId, emoji, userId, reactions[], chatId }` | |
| `tagged-in-message` | `{ message, chatId }` | Personal room — in-app tag alert |
| `all-lead-chats-response` | `{ chats[], totalUnreadCount, pagination }` | **Inbox + global unread badge** |
| `messages-response` | `{ chatId, messages, pagination }` | Reply to `get-messages` |
| `error` | `{ message }` | Always bind this |

**`all-lead-chats-response` is pushed, not just requested.** Whenever anything changes in a chat you participate in — new message, edit, delete, seen — the server recomputes your list and pushes it to `user:<yourId>`. Bind it once at app level and drive the unread badge off `totalUnreadCount`. You do not need to poll.

---

## 4. The send flow, precisely

`send-message` has **no acknowledgement callback**. The confirmation is the `new-message` echo that comes back to the room, including to the sender.

1. Render the message optimistically with a local `tempId` and no `_id`.
2. Emit `send-message`.
3. On `new-message`, look for a local message that has a `tempId`/no `_id`, the same trimmed text, the same sender, and the same "has attachments" flag — replace it with the server copy.
4. If no optimistic match, dedup by `_id` before appending.
5. On send failure, drop the optimistic message and show a retry affordance.

Same flow for the multipart path — the REST response and the socket echo describe the same message, so pick one source of truth (the echo) and dedup.

---

## 5. Read receipts

- Loading history via REST marks those messages seen automatically.
- While the chat screen is **open and focused**, emit `mark-messages-seen` for each incoming message from another user.
- Do **not** mark seen when the app is backgrounded or the message arrives on a screen the user isn't looking at.
- `seenBy` on a message is an array of objects — `{ userId, seenAt, firstName, lastName, fullName, profilePicture }` — **not** an array of ids. Filter yourself out before rendering "seen by N".

---

## 6. Message object shape

```jsonc
{
  "_id": "…", "id": "…",          // both present — pick one and be consistent
  "chatId": "…",
  "senderId": "…",
  "senderDetails": { "_id", "userName", "firstName", "lastName", "email", "profilePicture" },
  "message": "text",
  "files": [ { "fileName", "fileType", "mimeType", "fileSize", "bucketName", "filePath", "s3url" } ],
  "seenBy": [ { "userId", "seenAt", "firstName", "lastName", "fullName" } ],
  "reactions": [ { "emoji", "count", "users": [ { "userId", "reactedAt", "fullName" } ] } ],
  "replyTo": "<messageId|null>",
  "replyToDetails": { … },
  "taggedUsers": [ { "_id", "userName", "firstName", "lastName", "fullName" } ],
  "isEdited": false, "editedAt": null, "editHistory": [ … ],
  "isDeleted": false,
  "createdAt": "2026-07-29T14:03:11-04:00"
}
```

⚠️ **Timestamps are already converted to the user's configured timezone by the server** and returned as offset-bearing ISO strings. Render them as-is. Do **not** re-convert to device local time — you will double-shift.

### Attachments

`files[].filePath` is an S3 key, not a URL. Exchange it for a signed URL through the app's existing secure-link endpoint (`bucketName` + `filePath`), same as every other image in the app. `s3url` is only populated for photos shared from an existing gallery.

---

## 7. Push notifications

Already wired server-side — nothing to build, just handle the payload:

- **@-tag:** title `"You were tagged in a chat"`, `data.eventType = ChatTagged`, with `chatId`, `messageId`, `leadId`, `senderId`.
- Deep-link that into the job's chat screen using `leadId` → resolve `chatId` → open.

---

## 8. Gotchas

| # | Gotcha |
|---|---|
| 1 | **Re-`join-chat` after every reconnect.** Room membership is not restored automatically. This is the most common silent failure |
| 2 | **History is newest-first.** Reverse it |
| 3 | **Timestamps are server-timezone-formatted.** Don't re-convert |
| 4 | **One socket per app session**, not per screen. Multiple connections multiply every broadcast and burn battery |
| 5 | `mark-message-seen` takes a **string**; `mark-messages-seen` takes an **object**. Easy to mix up |
| 6 | Messages carry both `_id` and `id`. Compare defensively |
| 7 | Attachments cannot go over the socket — REST multipart only |
| 8 | The server checks **company**, not participant membership, on read/write. Don't rely on the API to hide a chat the user shouldn't see — gate it in the app |
| 9 | One chat per lead. Never create a second one for the same lead |
| 10 | `new-message` also fires for **your own** messages. Dedup, or you'll render everything twice |

---

## 9. Integration checklist

- [ ] Socket connects once per session, reconnects with backoff, exposes `isConnected`
- [ ] `join-chat` on screen open **and** on `connect` (reconnect)
- [ ] `leave-chat` on screen close
- [ ] History loaded, reversed, paginated with `beforeDate`
- [ ] Optimistic send + dedup against the `new-message` echo
- [ ] Attachments via multipart; signed URLs resolved for display
- [ ] `mark-messages-seen` while the screen is focused only
- [ ] `seenBy` rendered from objects, self excluded
- [ ] Typing emitted (throttled) and rendered
- [ ] `all-lead-chats-response` bound at app level → unread badge
- [ ] `error` event bound and surfaced
- [ ] Tag push notification deep-links into the right chat
- [ ] Verified against the web app: send from the portal, confirm it lands on the device live, and vice versa

---

## 10. Reference implementation

The installer **web** app implements this exact contract and is the closest thing to a working reference:

- `mhalt-revDSM-installers-frontend/src/context/socket-context.js` — one shared connection
- `mhalt-revDSM-installers-frontend/src/components/chat-module/ChatModule.js` — join/leave, send, seen, typing, edit, delete

Server side: `src/core/services/chat/ChatSocketService.ts` (all socket events), `src/core/handlers/chat/ChatHandler.ts` (all REST endpoints).
