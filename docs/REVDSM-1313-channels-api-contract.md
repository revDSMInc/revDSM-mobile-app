# REVDSM-1313 — Team channels API contract (v3: own collections, REST reads and writes, sockets for live traffic)

Replaces `REVDSM-1313_Mobile_Handoff.md`. Channels no longer live in `chats`; they live in
`channelschat`, and their messages in `channelschatmessages`. **Stored data (list, history,
pending, replies, acks) and channel management (create, edit, reorder, archive) are HTTP.
Sockets carry only what happens while people are online.** Both paths run through
`ChannelChatService`, so the same rules apply and both broadcast `team-channel-*` to every
viewer — the HTTP response is only for the caller.

Lead chats are untouched: every lead-chat REST route and socket event keeps working as before.

> **For this app:** channels are created and managed **in the portal only** — managers and VPs work
> there, and the roles that use this app (sales rep, installer) do not create channels. The app reads
> the list, history and per-viewer `permissions`, posts messages, marks them seen and confirms reads.
> The create/edit/reorder/archive rows below are documented so the shared shapes are in one place, not
> because this app calls them. See `docs/claude/notifications-chat.md` for what the app actually does.


## Conventions

- HTTP base: `/api/v1/channels`, JWT `Authorization` header like every other route.
- HTTP envelope: `{ code, message, data }`. On refusal: `code` = HTTP status, `data.code` = machine code
  (e.g. `MANAGERS_ONLY`), plus extras (`retryAfterSeconds`).
- **Channel fields are snake_case** (below). **Message documents keep the lead-chat message shape**
  (`_id`, `chatId` = channel id, `senderId`, `senderDetails`, `message`, `replyTo`, `replyToDetails`,
  `taggedUsers`, `files`, `seenBy`, `reactions`, `isEdited`, `editHistory`, `approvalStatus`,
  `ackBy`, `createdAt`...) so one message renderer serves lead chats and channels.
- Socket envelope ids stay camelCase (`channelId`, `messageId`) as they always were.
- Socket client->server events take an optional **ack callback**: `socket.emit(event, payload, (res) => ...)`
  where `res` is `{ success: true, data? }` or `{ success: false, message, code, retryAfterSeconds? }`.
  Failures are also emitted as the usual `error` event `{ message, code }`.

## Channel object

```
id, company_id, office_id (primary office), office_ids (every office it belongs to),
name, description, icon_emoji, icon_url (signed URL or null), icon_key (S3 key),
sort_order,
post_permission ('everyone'|'managers'), slow_mode (0|30|60|300 seconds), allow_replies, allow_uploads,
allow_self_edit, require_approval, notify_on_post, require_ack, visible_to_reps,
retention ('forever'|'90d'|'30d'|'2m'),
archived_at, last_message_at, created_by, created_at, updated_at,
participants: [{ _id, userName, firstName, lastName, fullName, colorCode }],
permissions: { can_manage, can_post, can_reply, can_react, can_upload, can_edit_own, is_read_only },   // for the caller
unread_count, pending_count                                                                            // list only
```

A channel may belong to **several offices at once** and is then one shared conversation with one message
history: everyone who can see any of its offices sees the same channel. `office_ids` is the whole set and
`office_id` is its first entry, the **primary** office — which is the one the channel's `sort_order` is counted
in, and what `PUT /reorder` and `team-channels-reordered` name. Read `office_ids` and fall back to `office_id`
when it is empty: channels created before this field carry only `office_id` and were **not** backfilled.

**Read confirmations are asked of the channel's members.** `ackAudienceCount` and the `/acks` report both
count `participants`, so a channel shared by several offices still only waits on the people actually in it,
and the sender is excluded. The one exception is a channel whose `participants` list is **empty**, which means
"everyone who can see its offices": there the audience is the office roster, as before.

**Members follow the offices.** A channel is seeded with the owner's direct reports — one level only, never
the grandchildren — in every office it belongs to, and gaining an office seeds that office's people the same
way, by the *owner's* role rather than the editor's, so one channel keeps one audience. A channel whose
`participants` list is **empty** is the exception and is left alone: an empty list means "everyone who can see
its offices", so seeding into it would quietly narrow who can read the channel.

A manager of **any one** of a channel's offices may edit, reorder and archive it. An account restricted to no
office (the usual setup for a VP) manages every channel in the company, and `GET /office/list` — JWT only —
already answers with the offices a given caller may pick: their own, or every active company office when they
are restricted to none. The portal's picker offers an **All offices** row, which is a selection shortcut only:
it ticks every office on offer and the channel is saved with those concrete ids, so `office_ids` never carries
a wildcard and a channel does not silently follow the office list as offices are added later.

Old -> new: `_id`->`id`, `title`->`name`, `channelConfig.icon`->`icon_emoji`, `channelConfig.iconUrl`->`icon_url`,
`channelConfig.order`->`sort_order`, `officeId`->`office_id` (+ `office_ids`), `settings.*`/`channelConfig.*` camelCase -> the flat
snake_case fields, `permissions.canPost`->`permissions.can_post` (etc.), `unreadCount`->`unread_count`,
`pendingCount`->`pending_count`, .

## HTTP

| Method + path | Who | Returns (`data`) |
|---|---|---|
| `GET /` | any | `{ channels: Channel[], total_unread_count }` (office-scoped, hidden ones removed, ordered by `sort_order`) |
| `POST /initialize` | any | same as list; seeds the caller's office with the 6 default channels once |
| `POST /icon` (multipart `icon`) | managers | `{ icon_url: <S3 key to save>, preview_url }` |
| `POST /` body `{ name, icon_emoji and/or icon_url, description?, office_ids?: [], office_id?, + any settings }` | managers | `{ channel }` — `office_ids` is the set to create it in, first entry primary; `office_id` is still accepted as one office, and a body with neither falls back to the caller's first office. Every office is checked: `OFFICE_REQUIRED` when none resolves, `OFFICE_FORBIDDEN` (+ `data.office_ids`) when one is not the caller's to use |
| `PUT /:channelId` body `{ name?, description?, icon_emoji?, icon_url?, office_ids?: [], + any settings }` | managers of any of its offices | `{ channel }` (as the caller sees it: their `permissions`, no counters). Sending `office_ids` moves the channel; offices the caller cannot manage are **kept**, so a local manager's edit never drops an office they could not see |
| `PUT /reorder` body `{ officeId?, channelIds: [] }` | managers | `{ office_id, channel_ids }` — fixed path, never read as a channel id. A channel shared with that office reorders from it too; there is one `sort_order` per channel, so the move applies in every office that has it |
| `DELETE /:channelId` | managers of that office | `{ id }` — archives, never hard deletes |
| `GET /:channelId/messages?limit=50&before=<messageId or ISO date>` | any who can see it | `{ messages: Message[] (newest first), pagination: { limit, has_more, next_before } }`. Pass `next_before` as `before` for the next older page. Applies retention for reps, hides posts in review (sender still sees own). Opening history marks messages seen and emits `message-seen`. |
| `POST /:channelId/messages` (multipart `message`, `replyTo`, `taggedUsers`, `files[]`) | any who may post | `{ message, pendingApproval }` — same rules as the socket send |
| `PUT /:channelId/seen` body `{ messageIds: [] }` | any | `{ id }` |
| `GET /:channelId/pending` | managers | `{ messages }` (approval queue, oldest first) |
| `GET /messages/:messageId/replies` | any | `{ replies }` |
| `GET /messages/:messageId/acks` | managers | `{ messageId, channelId, confirmed: [{userId, fullName, ackedAt}], pending: [...] }` — the audience is the channel's **members**, not everyone in its offices; the message's sender is never listed |
| `PUT /messages/:messageId` body `{ message }` | sender | `{ message, oldMessage }` |
| `DELETE /messages/:messageId` | sender | `{ id }` |

## Socket — client -> server

The four channel-management events below are **kept for the mobile app**; the portal writes
through the HTTP routes above. Either way the server runs the same `ChannelChatService` call
and broadcasts `team-channel-*` to every viewer.

| Event | Payload | Notes |
|---|---|---|
| `join-team-channel` | `channelId` (string) | after this you receive that channel's room events |
| `leave-team-channel` | `channelId` | |
| `create-team-channel` | `{ name, icon_emoji and/or icon_url, description?, office_ids?: [], office_id?, + any settings (snake_case) }` | managers; same office rules as `POST /` — HTTP: `POST /` |
| `update-team-channel` | `{ channelId, name?, description?, icon_emoji?, icon_url?, office_ids?: [], + any settings }` | managers of any of its offices — HTTP: `PUT /:channelId` |
| `reorder-team-channels` | `{ officeId?, channelIds: [] }` | managers — HTTP: `PUT /reorder` |
| `archive-team-channel` | `{ channelId }` | managers; never hard deletes — HTTP: `DELETE /:channelId` |
| `add-channel-participants` / `remove-channel-participants` | `{ channelId, userIds }` | |
| `send-channel-message` | `{ channelId, message, replyTo?, taggedUsers?, files? }` | |
| `edit-channel-message` | `{ messageId, message }` | replaces shared `edit-message` |
| `add-channel-reaction` / `remove-channel-reaction` | `{ messageId, emoji }` | replaces shared `add-reaction`/`remove-reaction` (toggle) |
| `mark-channel-messages-seen` | `{ channelId, messageIds }` | replaces `mark-messages-seen` |
| `review-channel-message` | `{ messageId, action: 'approve'|'reject' }` | managers |
| `acknowledge-channel-message` | `{ messageId }` | the "Read Ack" button |
| `channel-typing` | `{ channelId, isTyping }` | |

**Removed** (use HTTP instead): `initialize-team-channels`, `get-team-channels` / `team-channels-response`,
`get-pending-channel-messages`, `get-message-acks`,
`get-messages`/`get-replies` for channels.

## Socket — server -> client

To a person (`user:<id>`, every device):
- `team-channel-created` `{ channel }` and `team-channel-updated` `{ channel }` — the channel **as that person sees it** (their own `permissions`). Upsert it into the list by `id`; it carries no `unread_count`/`pending_count`, keep your own.
- `team-channel-archived` `{ channelId, hidden? }` — remove from the list (also sent when a channel becomes hidden from reps).
- `team-channels-reordered` `{ officeId, channelIds }` — re-sort the office's channels by that order.
- `team-channel-activity` `{ channelId, officeId, officeIds, lastMessageAt, senderId }` — a post landed in a channel; if it is not the open one, `unread_count += 1`.
- `channel-pending-updated` `{ channelId, pendingCount }` (managers) — queue badge.
- `channel-message-reviewed` `{ messageId, channelId, status }` (the sender and the reviewer).
- `new-channel-message` `{ message, channelId, channelType, isReply, pendingApproval? }` — `pendingApproval:true` goes to the sender only.
- `new-channel-reply`, `tagged-in-channel-message`, `added-to-channel`, `removed-from-channel`.

To the channel room (after `join-team-channel`):
- `new-channel-message`, `channel-reply-count-updated` `{ messageId, replyCount, channelId }`, `message-edited`, `message-deleted` `{ chatId, messageId }`,
  `message-seen` `{ messageId, userId, seenBy }`, `reaction-added`/`reaction-removed` `{ messageId, emoji, userId, userDetails, reactions }`,
    `channel-message-acknowledged` `{ messageId, channelId, userId, ackCount }`,
  `team-channel-settings-updated` `{ channelId, settings: { post_permission, slow_mode, ... } }`,
  `team-channel-archived`, `user-typing-channel`, `user-joined-channel`, `channel-participants-updated`.

## Error codes (socket `error` / ack / HTTP `data.code`)

`MANAGERS_ONLY`, `SLOW_MODE` (+`retryAfterSeconds`), `UPLOADS_DISABLED`, `REPLIES_DISABLED`, `EDIT_DISABLED`,
`ACK_NOT_REQUIRED`, `FORBIDDEN`, `CHANNEL_NOT_FOUND`, `OFFICE_REQUIRED`, `OFFICE_FORBIDDEN`, `ICON_REQUIRED`, `NAME_REQUIRED`,
`MESSAGE_REQUIRED`, `REPLY_TARGET_INVALID`, `TAGGED_USERS_NOT_FOUND`, `ALREADY_REVIEWED`, `INVALID_EMOJI`,
`MESSAGE_NOT_FOUND`, `USER_IDS_REQUIRED`, `CHANNEL_IDS_REQUIRED`, `CHANNEL_ID_REQUIRED`, `INVALID_PARTICIPANTS`.

## Hybrid flow a client should follow

1. Open the channel tab: `GET /` (and `POST /initialize` when the list is empty), render.
2. Keep the list live from `team-channel-*`, `team-channels-reordered`, `team-channel-activity`.
3. Manage channels over HTTP: `POST /`, `PUT /:channelId`, `PUT /reorder`, `DELETE /:channelId`.
   Apply the response to your own list (it carries no unread/pending counters — keep yours); the
   same change reaches everyone else, and you a second time, through the broadcast.
4. Open a channel: `emit join-team-channel`, `GET /:id/messages` for history (older pages on scroll with `before`).
5. From then on only socket events change the open channel (new/edited/deleted messages, reactions, seen, acks).
6. On socket reconnect, refetch the list and the open channel's latest page once (anything missed while offline).
