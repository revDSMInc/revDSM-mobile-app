# Notifications, push routing & chat

> Part of the repo guide — the index is the root `CLAUDE.md`. **Read this before changing:** `src/screens/Notifications/**`, `src/screens/ChatThreads/**`, `src/screens/ChatDetail/**`, `widgets/components/chat/**`, `hooks/usePushNotifications.ts`, `hooks/useNotifications.ts`, `utils/push-routing.ts`, `utils/notification-groups.ts`, `utils/job-change-summary.ts`.
>
> Each `##` section is one ticket: the ask, the root cause, the decision, and the ⚠️ traps that must not be
> "fixed" back. Newest follow-ups sit under their original ticket. Add new notes for this area HERE, not in the root file.

## The Notification Center rebuilt to the `notify-ui.txt` design

Ticket: *"this file contains the notification UI design … update the Notification UI according to this
design"*, with `notify-ui.txt` (an HTML/CSS mock, in the repo root) and two screenshots of the finished
list. The screen was a flat `FlatList` of hairline-separated rows on the app's plain white; it is now
the mock's layout — a warm paper ground, **day sections**, one bordered **card** per run of
notifications about the same lead, and repeats collapsed behind a disclosure.

| the design | how it is built |
|---|---|
| paper ground `#F6F5F0`, white cards, `#E6E3DA` rules | a `C` token block in the screen, copied from the mock's `:root` |
| `Today · Sep 7` / `Yesterday` / `2 days ago` headings | `SectionList` + `formatDayLabel` |
| ~~one card per lead, hairline between its rows~~ | **SUPERSEDED — one card per NOTIFICATION.** See the follow-up below |
| 3px pine rail + wash on an unread row | `styles.rail` + `itemUnread`, clipped by the card's `overflow` |
| 40px tinted bubble, four families | `describeNotification` now returns `{ icon, color, tint, family }` |
| monospace lead chip (`41PCDLG` / `SelfGen`) | `leadTagOf` |
| ~~`+1 more update on this lead` / `Show breakdown`~~ | **SUPERSEDED — removed.** See the follow-up below |
| `Unread ⑷` count pill | `unreadCount` from the existing badge query |
| `You're viewing the last 3 days` | `endHintFor` — **derived**, see below |

**Every rule lives in the pure `src/utils/notification-groups.ts`**, for the reason
`utils/addendum-drafts.ts` and `utils/inspection-photos.ts` exist: the screen pulls in React Native and
is untestable under jest here, and each of these fails **silently** — a row filed under the wrong day, a
mongo id printed as a lead tag, or two unrelated notifications merged into one card all read as a
styling quirk rather than an error.

### ~~The grouping is three passes, and each guard is load-bearing~~ — ALL REMOVED

> ⚠️ **SUPERSEDED in full by "…and then the grouping was reversed" below.** Everything in this
> subsection — the card runs, the stacking, the `lead-issued` aggregation and every guard on them — was
> deleted on request. It is left here only so a reader who finds `cardKeyOf` / `stackKeyOf` in the git
> history knows what they did and why they are gone. **Do not reintroduce any of it.**

1. **Day buckets**, then 2. **cards** — a RUN of *adjacent* rows sharing a card key, not a global
   group-by, so an hours-old row can never be pulled up beside a fresh one and read as though they
   happened together — then 3. **items**, where repeats of one event family collapse into the newest and
   the rest become the disclosure's sub-rows.

- ⚠️ **A row with no resolvable identity keys on its OWN id**, so it can never merge into a neighbour.
  Telling the rep two unrelated notifications concern the same lead is worse than an extra card.
- ⚠️ **`addendum-signed` carries its `outcome` in the stack key.** The title reads "Addendum signed" for
  a DECLINE too (the rule `push-routing.addendumOutcome` states), so collapsing the two would hide a
  refusal behind an approval.
- ⚠️ **A collapsed item is unread when ANY row behind it is.** The disclosure hides rows; a hidden
  unread would leave the bell counting something the rep has no way to reach. For the same reason the
  tap marks **every** `ids` entry read, not just the head.
- **`lead-issued` AGGREGATES** rather than collapsing — consecutive batches sum to
  `4 new leads issued to you` with `Show breakdown`, which is the design's own row. An absent `count`
  counts as **one, never zero**, which would erase the row from its own total.

### Dates are parsed as TEXT, and the day heading and the clock share that parse

⚠️ The repo's standing rule (`utils/job-change-summary.ts`) is that an offset ISO string shifts the
calendar day either side of midnight. The stronger reason here is **consistency**: `dayKeyOf` and
`formatClockTime` read the same `YYYY-MM-DDTHH:MM` prefix, so a row filed under "Yesterday" can never
print a time from today. Change one and you must change the other.

⚠️ **A future day is clamped to `Today`.** Reachable without any clock being wrong — `createdAt` can be
UTC while the rep is behind it — and "Tomorrow" on a notification that has already arrived is the worse
answer. `daysBetween` builds both sides through `Date.UTC` on the parsed components so neither can be
shifted by the device timezone.

### `leadTagOf` reads a FIXED key list and REJECTS a mongo id

The design's chips are `41PCDLG`, `41AK` and `SelfGen` — the lead's human number, or its `leadCode`
when the number is `"N/A"` (which is exactly what a self-gen lead stores; see `response-one.txt`).

⚠️ **The push payload's `leadId` is a mongo id while the lead RECORD's `leadId` is that human number.**
Both are read from the same key, and the 24-hex guard is the whole reason that is safe: whichever the
backend sends, the right one renders and the wrong one never does. Without it the chip would be filled
on every row with a database key that looks deliberate. `'N/A'`, the other placeholders, and anything
over 16 characters are rejected too, and an unrecognised payload yields `''` so the chip is simply
absent — the discipline `readDocumentGroup` sets.

### Two deliberate divergences from the mock

⚠️ **The heading is not a serif.** The mock loads Source Serif 4; this app bundles **Public Sans only**
(and naming an unbundled family drops that text straight back onto the device font — the rule the
app-wide font ticket records). The heading is carried by size and tighter tracking instead.

⚠️ **The unread wash is a FLAT tint, not the mock's gradient.** `rgba(30,92,67,0.06) → transparent` needs
a gradient library this repo does not ship, and pulling `react-native-svg` in behind every row to fake
one is not worth it. `#F1F6F2` is that tint flattened over white; the 3px pine rail is what actually
carries the signal.

⚠️ **`You're viewing the last 3 days` is DERIVED from the oldest row loaded**, not hardcoded, and only
shows once `hasMore` is false. The app has no retention window to quote, so a fixed number would be a
claim nothing backs. A list that only reaches today reads *"You're viewing today's notifications"*.

### Smaller decisions

- **The colour block is literals, not `useTheme()`.** The paper ground is not a colour the app's palette
  has; reading `colors.background` would put the cards on plain white and lose the separation the whole
  design rests on. The app is light-only today (`ThemeProvider` forces it) — give the block a dark twin
  if that changes.
- **`stickySectionHeadersEnabled={false}`** — a pinned day heading over a card list reads as a second
  header, and the design pins only the screen header.
- **`overflow: 'hidden'` on the card** clips the rail and the row wash to its corners. Safe only because
  the card carries no shadow; iOS drops a shadow on a view that sets it (the inspection-photo card note
  above).
- **Mark all read stays MOUNTED at zero**, dimmed and disabled, rather than being swapped for a spacer —
  the header no longer reflows the moment the last notification is read.
- The tap handler, `resolvePushRoute` branch for branch, and the "always fetch `all`, filter unread
  client-side" rule are **unchanged**; only the presentation moved.

Tests: `__tests__/utils/notification-groups.test.ts`.

⚠️ Needs a device check — this repo cannot render-test and the whole ticket is layout: the day headings,
the card grouping on a lead with several notifications, the disclosure expanding, and that the chip shows
a readable lead number rather than nothing. **If every chip is absent, the payload is naming no human
lead id** — add the key the backend actually sends to `LEAD_TAG_KEYS`; do not relax the mongo-id guard.

### …and then the grouping was reversed: ONE CARD PER NOTIFICATION

Follow-up on the same screen: *"currently you have implemented the group notification UI but i need a
separate notification for each notification like grouping in message, issued lead etc — convert it from
group to single."*

Every merging pass is **gone**. `buildNotificationSections` is now a mapping, not a grouping: day
sections, and inside each one **one card per history row**, in the order the API returned them.

| removed | what it used to do |
|---|---|
| `NotificationCard` + `cardKeyOf` | merged adjacent rows about the same lead into a shared card |
| `stackKeyOf` / `buildItem`'s stack | collapsed repeats of one event behind `+N more update on this lead` |
| `issuedCount` / the `lead-issued` aggregate | summed two batches into `4 new leads issued to you` |
| `stackNoun` / `plural` | the disclosure copy |
| `NotificationItem.ids` / `.stack` / `.moreLabel` / `.lessLabel` | the disclosure's data |
| `styles.itemDivided` / `stackMore` / `subList` / `subRow` | the in-card divider and the sub-rows |
| the screen's `expanded` state + `toggleStack` | which stack was open |

- **`NotificationSection.data` is now `NotificationItem[]`** — the card layer is gone entirely, so the
  screen's `renderItem` paints one row and `styles.card` picked up the `flexDirection: 'row'` the item
  used to carry. Each card is its own `TouchableOpacity`.
- **Mark-read is back to one id.** The tap cleared every `ids` entry precisely because a stack could
  hide unread rows; with nothing hidden, `row.id` is the whole of it.
- **`item.key` is the history id**, which is unique per notification and stable across a refetch, so a
  pressed row cannot swap identity under the rep.
- ⚠️ **Rows are still bucketed by day in ARRIVAL ORDER, not sorted.** An out-of-order list therefore
  renders two sections with the same label rather than silently rearranging the rep's notifications —
  the API returns them newest-first, and resorting here would hide a paging bug instead of showing it.
- ⚠️ **`CHAT_EVENTS` is no longer imported by the grouper** (nothing keys a card any more), so the note
  on the export names the three behaviours that remain. The export stays — it is still the one list, and
  the de-duplication it bought is what makes that true.

⚠️ The **day sections, the paper ground, the bubbles, the lead chip, the unread rail and wash, the tabs
and the derived end hint are all unchanged.** Only the merging was reversed; this is not a revert of the
redesign.

## A resulted lead's `agreement-signed` notification opens the LEAD, not the Job Builder

Ticket: *"when the lead is resulted and the user click on the signed agreement then do not move the user
to the agreement screen — user should move to the lead main screen."*

`agreement-signed` resolves to `{ kind: 'jobBuilder' }`, and the reasoning on that route is sound for
the normal case: signing the agreement is what **unblocks** submitting the job, so the rep's next action
is "Complete Job" and Job Docs is a detour. Once the lead is **resulted** that stops being true — the
deal lives on the Lead Center, which is where the agreement, the contract details and the addendums all
are — and dropping the rep into a builder for a job that is already done reads as though the app has
lost the submission.

**New pure `src/utils/lead-result-status.ts`** (`isLeadResulted` / `normalizeResultStatus`), for the
reason `utils/push-routing.ts` is pure: the two callers are both untestable under jest here and they
**must** answer identically.

⚠️ **BOTH tap paths changed, and that is the point.** The check runs in
`screens/Notifications/index.tsx` *and* in `hooks/usePushNotifications.ts`, against the same helper — a
row and the banner that raised it landing on different screens is the exact failure the shared routing
module exists to prevent. Changing one and not the other would be invisible until a rep noticed.

⚠️ **An ALLOWLIST of resulted statuses, NOT the `NON_RESULTED_STATUSES` deny-list** that
`widgets/components/LeadCard.tsx` and `screens/DealDetail` use (`['lfLead','selfGenerated','scheduled']`,
web parity with `job-card.js`). The two are not interchangeable here: a deny-list reads a **missing or
unknown** status as resulted, and since this rule now decides where a notification lands, that default
would silently divert every status-less lead away from the Job Builder. The allowlist fails the other
way — anything unrecognised keeps the behaviour the app already ships. Its values are
`JobDocsSection.isResulted`'s, so the screen the rep is sent to agrees about why they are there.

- **Placed FIRST in the branch**, above the `isDynamic === false` test and above `resolveBuildIds`, so a
  resulted lead also skips the calculator round trip. Resulted therefore outranks an explicitly dynamic
  push — the dynamic flag says the builder *exists*, not that it should be opened.
- **Navigated with no `tab`**, so the Lead Center opens on its own default (`job_docs`) — the lead's
  main view rather than a sub-tab chosen by a notification.
- **Statuses are normalized** (lower-cased, non-alpha stripped), so `Demo No Sale` → `demonosale`.
- ⚠️ Three other copies of the non-resulted rule exist (`LeadCard.tsx`, `DealDetail/index.tsx`,
  `utils/lead-activity-log.ts`). They were **left alone** — pointing a shared list at big unrelated
  screens is not something a notification ticket should carry — but they are the obvious next adopters.

Tests: `__tests__/utils/lead-result-status.test.ts`.

⚠️ Needs a device check: sign an agreement on a lead that is already resulted and confirm the banner and
the Notification Center row both open the Lead Center, and that a NOT-yet-resulted lead still opens the
Job Builder on its Summary step.

## `chat-reaction` — the tenth event type, and the duplicate list it exposed

Contract: **`CHAT-REACTION-NOTIFICATIONS.md`** (repo root, REVUIUX-97 QA item 5). A rep is not told when
someone reacts to their message. Reactions already exist and already broadcast over the socket
(`reaction-added`); what is missing is the push. §6 of that document says **the app must ship first, or
at least together** — if the backend sends `chat-reaction` to a build that does not know it,
`resolvePushRoute` returns `null` and every reaction is a banner whose tap does nothing and a list row
reading *"There is nothing more to open for this one."*

**This is the app half only. Nothing is sent yet**, and every edit below is INERT until the backend
adds `NotificationEventTypes.ChatReaction` — which is exactly why it is safe to land now.

| site | change |
|---|---|
| `PushEventType` (`utils/push-routing.ts`) | `'chat-reaction'` added to the union |
| `CHAT_EVENTS` (same file) | the event added — **and the set EXPORTED**, see below |
| `describeNotification` (`hooks/useNotifications.ts`) | `case 'chat-reaction'` → slate + `emoticon-happy-outline` |
| `NOTIFICATION_TYPES` (`services/api/notifications.ts`) | added, so `NotificationHistoryType` stays honest |
| `invalidationKeysFor` | **no case, deliberately** — now written down rather than assumed |
| `usePushNotifications` | untouched: it is generic over `isRenderable` / `channelForEvent` |

### ⚠️ Membership of `CHAT_EVENTS` is the whole implementation — and there were TWO copies

Adding the event to that one set gives it the destination (`resolvePushRoute`'s chat branch already
reads `chatId` and treats an absent `leadId` as a channel), the Android channel (`channelForEvent` →
`CHANNEL_MESSAGES`, so a rep who has muted chatter is not woken by a thumbs-up), and foreground
suppression — which matters more here than for a message, since reacting is cheap and usually happens
while both parties are looking at the thread.

⚠️ **The Notification Center redesign had quietly made a SECOND copy of that list.**
`utils/notification-groups.ts` declared its own `CHAT_EVENTS` for card keying, so the contract's
one-line change would have covered three of the four behaviours and silently missed the fourth: a
reaction would key on its `leadId` (or, on a channel, on its own row id) instead of `chat:<chatId>`,
and would sit in a card of its OWN beside the thread it belongs to. The set was **exported from
`push-routing` and imported** by the grouper. That import is now gone — the ungrouping follow-up above
deleted the card keying entirely, so nothing keys a card any more — but **the export stays**: it is the
one list, and keeping it that way is what stops the eleventh event type repeating this.

### The two places the contract's text had to be translated rather than copied

⚠️ **`describeNotification`'s suggested `color: '#0B6A85'` is stale.** That is the OLD chat tint,
written before the function moved to the redesign's four families; taking the hex literally would make
the reaction the one chat row painted a fifth colour. It uses **slate** (`#3E5C78`), that colour's
replacement, so a reaction still reads as chat. The document's actual instruction — *don't let it fall
to `default` and show a grey bell in an "Other" group next to correctly grouped chat rows* — is what is
honoured.

⚠️ ~~**The disclosure label could no longer say "on this lead".**~~ **Moot** — the ungrouping follow-up
above removed the disclosure, so a burst now renders as one row per reaction. §5's burst problem is
therefore the BACKEND's to solve (its "notify once, then stay silent for N minutes" option), not
something the list absorbs. Worth knowing if reps report a flooded Notification Center.

### Not done, and why

- ⚠️ **Tapping does NOT scroll to the reacted message.** `messageId` is in the payload, but §3 files
  this as an open question and says it needs an optional `messageId` on the `chat` `PushRoute` **and**
  `ChatDetail` honouring it — the document's own words, *"a larger change than the rest of this
  document, and worth deciding separately"*. The tap opens the thread, which is the contract's baseline.
- **Every §5 decision is the backend's** — who is notified (proposal: the message author only, never
  self-reactions), the burst rule, never notifying on `remove-reaction`, and whether a reaction writes
  a history row at all. ⚠️ That last one has an app-side consequence: `isRenderable` currently ties
  display and history together, so **banner-only would be the first exception to it** and is not
  something the app can opt into per type today.

Tests: `__tests__/utils/chat-reaction.test.ts`.

⚠️ Nothing can be checked on device until the backend sends the event. `npm run test-push -- --user=<id>
--event=chat-reaction` (§6.4) is what fires a real payload without needing two accounts in a chat.

## `lead-issued` opens the Leads LIST, never one lead's screen

Ticket: *"when a lead is assigned and user click on the lead it will navigate the user to the lead
screen instead of the lead listing screen — fix this issue: when assign lead is clicked from the
notification it will move to the listing screen, not detail screen."*

One line in `resolvePushRoute`:

```ts
const issued = str(data?.issuedLeadId);
return issued ? { kind: 'lead', leadId: issued } : { kind: 'leadList' };   // ← the bug
```

`lead-issued` has **three shapes** and only the first can name a lead at all — single issue carries
`issuedLeadId`, while bulk issue and route dispatch carry `count` only. So the deep link fired on
exactly one of them, and **the same notification landed in two different places depending on how the
office happened to issue the work.** A rep told *"4 new leads issued to you"* got the list; a rep told
*"1 new lead issued to you"* got that lead's detail screen, with no sense of what else had come in.

Being issued work is a **queue** event, so the queue is the destination. The branch is now
unconditional `{ kind: 'leadList' }`.

⚠️ **`issuedLeadId` is no longer read here — do not "restore" the deep link for the single-lead case.**
That asymmetry IS the bug. (`utils/notification-groups.ts` still reads the key for the row's lead
chip, which is a LABEL, not a destination — and its mongo-id guard drops it anyway.)

⚠️ **Fixed in the shared pure router, so BOTH taps changed together** — the push banner
(`usePushNotifications`) and the Notification Center row (`screens/Notifications`) already had a
`leadList` branch navigating to `'Leads'`, so neither screen needed an edit. That is the whole reason
the routing lives in one module; had this been patched at a call site, the other surface would still
be opening the detail screen.

⚠️ **The other lead events are UNCHANGED and should be.** `lead-cancelled`, `appointment-issued` and
`addendum-signed` each name one specific lead the rep is being sent to read, so they still resolve to
`{ kind: 'lead' }`. Asserted, so a future sweep over this switch cannot flatten them by accident.

`channelForEvent` (`CHANNEL_LEADS`) and `invalidationKeysFor` are untouched.

Tests: `__tests__/utils/lead-issued-routing.test.ts`.

⚠️ Noted, NOT touched: three `__tests__/screens/DynamicDealCenter/` suites (`auto-adjust-cost-floor`,
`funding-settled-on-return`, `refund-hold-and-reminders`) fail to RUN here — they import
`screens/DynamicDealCenter/utils/funding`, which does not exist on this branch. They are stale local
files from another branch's checkout; `__tests__/` is gitignored, so nothing keeps them in step.

## Chat: the lead header photo had no preview, and message photos opened slowly

Ticket: *"Sales app - messages - should let me preview photo / image should open instantly like re
render and inspection photo"*, circling the **lead thumbnail in the chat header**.

Two separate gaps behind one sentence:

**1. The header thumbnail was inert.** `LeadHeaderThumbnail` (`widgets/components/chat/ChatHeader.tsx`)
rendered a bare `<Image>` with **no press handling at all** — there was no way to open it. It is now a
**`PhotoPeekPressable`**: HOLD peeks it enlarged (instant, warmed to a local `file://`), and a TAP
opens the same **`ImageGalleryModal`** the chat's image messages already use, so the two surfaces
behave alike. The tap gets its uri from `PhotoPeekPressable`'s **`onPress(peekUri)`** — added for the
inspection grid — so the gallery opens on the warmed file rather than re-fetching. The
home-outline placeholder branch is untouched: nothing to preview, nothing to press.

**2. Message photos already had a viewer, but it wasn't instant.** `ImageGalleryModal` rendered raw
urls with `cache: 'force-cache'`, which **buys nothing** on our pre-signed S3 links (no cache headers —
see "Hold-to-peek previews" above). It now resolves through the local-file cache, in both the pager and
the filmstrip.

⚠️ The gallery warms **only while `visible`**. It is mounted per message bubble, so warming on mount
would download every attachment in the thread on open.

The warming hook is now shared: **`src/hooks/useWarmedImageUris.ts`** (`{ [url]: fileUri }`, filling in
as downloads land), used by `ImageGalleryModal` and `InspectionPhotosPanel`. It was written for the
inspection viewer last ticket and moved out rather than copied on the second consumer. It keys its
effect on the **joined url string**, not the array identity — callers build the array inline, so
depending on identity would restart every download on every render.

⚠️ Reach for this hook (or `PhotoPeekPressable`, which warms its own) for **any** new full-size photo
view. `Image.prefetch` and `cache: 'force-cache'` do not work on these urls — that is the standing
gotcha in §6, and this ticket is the third surface to hit it.

Not changed: chat image **messages** were already previewable via `ImageGalleryModal` from
`ChatMessageBubble`, so only their speed needed fixing.

## Chat: job-change addendum lifecycle cards

Spec: **`SALES-APP-ADDENDUM-CHAT.md`** (repo root, 2026-08-12) — read it, it is the contract. The
lead chat now receives **general (sender-less) system messages** for the addendum lifecycle: the rep
proposed job changes, and the customer approved or declined them.

**Mobile emits nothing and calls no new endpoint to make these appear.** They ride the existing
`GET /chat/v1/:chatId/messages` and the existing `new-message` socket event; `ChatService.normalizeMessage`
spreads `...m`, so `metadata` already survives **both** paths with no service change. The entire ticket
is *rendering* plus the two View destinations.

⚠️ **There is no web ref to port from.** `grep -rl "JOB_CHANGE_ADDENDUM\|JobChangeMessageCard"` over
`mhalt-revDSM-sales-frontend` returns only `src/api/leads.js` — the sales web app has the two API
functions but not the chat card, so this was written against the spec. §8 of the spec names the web
files to mirror **once they land**.

**Three new files.**

- **`src/utils/job-change-summary.ts`** — pure, zero imports (no React, no RN, no date library).
  Detection (`getJobChangeMeta` / `isJobChangeAddendum` / `getJobChangeTitle` / `formatChatTime`) plus
  the whole diff (`buildJobChangeSummary`). Split out for the same reason as `utils/inspection-photos.ts`
  and `utils/pitch-book.ts`: the card and the modal both pull in RN and are untestable under jest here,
  so **every rule that can be got wrong lives in this file**.
- **`src/widgets/components/chat/JobChangeMessageCard.tsx`** — the row: round status icon, the
  server-authored line, outlined green **View**. ⚠️ The **timestamp sits ABOVE the card, centered**,
  not inside it — it reads as a chat time separator rather than card content, which is how web draws
  it. The first pass put it under the title inside the card and QA sent back the web screenshot.
  The card is a single vertically-centred row (icon | title | View), so the title wraps to two lines
  without pushing anything out of alignment.
- **`src/widgets/components/chat/JobChangeDetailsModal.tsx`** — the before/after, reading
  `LeadService.getDraftSummary` (`/lead/v1/job-builder-draft/{draftId}/public`, **no auth** — the same
  payload the customer's own consent page renders, which is the point).

`ChatDetail/index.tsx` wires them: **`renderMessage` short-circuits** to the card when
`getJobChangeMeta(props.currentMessage)` is non-null, and mounts `JobChangeDetailsModal` +
`PdfPreviewModal`. Both `GiftedChatAny` instances (iOS / Android branches) share that one
`renderMessage`, so a single change covers both.

⚠️ **Intercepting at `renderMessage` — before `<Message>` — is what drops the sender**, and that is the
whole failure mode the spec calls out. `senderId` is a *required, populated* user reference (so it can
never be a `"system"` sentinel), and **all three events carry the REP as the technical sender —
including the customer's approve/decline**, which arrives on a public no-auth endpoint where there is
no user at all. Rendering these through the normal path would draw
*"Customer has approved job changes"* as the rep's **own outgoing bubble**. Bypassing `<Message>` also
suppresses the avatar, me/them alignment, reactions, reply, edit, pin, the long-press menu and the
read-receipt row in one move, rather than teaching each of them an exception.

⚠️ **Gate on `metadata`, NEVER on the message text.** An unrecognised `metadata.type` (e.g.
`INSTALLER_JOB_STATUS_REQUEST`) returns `null` from `getJobChangeMeta`, so future event types degrade
to normal bubble rendering instead of rendering as a broken card.

**View is action-dependent, and deliberately so** (client-specified): `ACCEPTED` → the signed PDF
directly, no intermediate screen; `PROPOSED` / `DECLINED` → the changes screen. **Approved ⇒ PDF,
always** — including when the changes screen is opened from a `PROPOSED` card and the fetched draft
turns out to be `accepted` (the customer signed after the card was posted), which renders a short note
plus an "Open signed addendum PDF" button instead of change rows.

⚠️ **`addendumPdfPending` is BOTH the spinner and the double-tap guard.** `/amendment-pdf`
**generates the document on demand** for addendums approved before this feature existed, so two taps
mean two Puppeteer builds and two S3 uploads for one addendum. A `409` (draft not accepted) falls back
to the changes screen rather than dead-ending. The url is a short-lived pre-signed S3 link — fetched at
tap time, never cached.

⚠️ **The spinner is keyed on the MESSAGE id (`cardId`), not on `draftId`.** QA: *"when i try to view
approved changes loader should only show with approved card."* It shipped keyed on `draftId` and lit up
**two** cards. Not a rendering slip — one addendum posts up to three cards (proposed →
approved/declined) and **they all carry the same `draftId` by design** (§6), so the draft can never
identify which card was tapped. `addendumPdfPending` therefore holds `{ draftId, cardId }`: `draftId`
still de-duplicates the in-flight request (two taps on the two cards of one addendum ARE the same PDF,
so the second is correctly ignored) while `cardId` scopes the spinner. `JobChangeMessageCard` derives
`cardId` from `message._id` and hands it back through `onView(meta, cardId)`. The details modal has a
single button and no card to disambiguate, so it passes a `modal:<draftId>` sentinel and reads the
plain `pdfLoading` boolean.

⚠️ **Always `metadata.draftId` from the tapped card.** A lead can carry several addendums, each a
separate record with its own PDF, so *"the lead's addendum"* is never a valid lookup. Cards are **not
numbered** — the deal-details screen numbers them newest-first, so its numbering shifts whenever a new
one is raised and any numbering here would contradict it. Timestamps are the disambiguator. The server
de-duplicates per `(draftId, action)`, so no client-side dedupe is needed.

### The four formatting rules are not optional

The two sides of a draft are **written by different screens**, so a naive comparison reports unchanged
values as changes — phantom edits on a document a customer signs. All four live in
`job-change-summary.ts`:

1. **Compare the FORMATTED values, not the raw ones.** `current.scheduleTime.date` may be `"7/21/26"`
   while `proposed` holds `"2026-07-21T…"` for the same day; `"14000"` vs `14000` likewise.
2. **Parse ISO dates as TEXT** — `ISO_DATE` reads the `YYYY-MM-DD` prefix with a regex. ⚠️ The string
   carries a **timezone offset**, so building a local `Date` shifts the calendar day: verified that
   `new Date('2026-08-03T00:30:00+05:00')` is **Aug 2** in `America/New_York` while the text parse is
   **Aug 3**. This is a date a customer signs — never route it through a `Date`.
3. **Normalise the time window before comparing.** `morning → 8:00 AM - 12:00 PM`,
   `afternoon → 12:00 PM - 4:00 PM`, whitespace collapsed, unicode dashes folded. ⚠️ That dash class is
   written as the **escape sequence** `/[\u2010-\u2015\u2212]/` — U+2010–U+2015 and U+2212 are visually
   indistinguishable from `-` in a diff, so a literal class is unreviewable (same family of trap as the
   `SCOPE_SEP` NUL rule).
4. **Strip raw authored ids** out of `buildChangeSummary[].changes[].field` — split on `·`, drop any
   segment matching `^(field|section|tab)_\d{10,}[\w-]*$`, rejoin; `"Job Build"` if nothing survives.

Two guards beyond the spec, both to avoid inventing a change: the **Schedule row is only emitted when
the PROPOSED side actually carries a `scheduleTime`** (a pricing-only addendum leaves it absent, and
absent means unchanged, not "changed to `—`"), and **money/time formatting is hand-rolled** rather than
`toLocaleString`/`toLocaleTimeString` so it cannot depend on Intl being compiled into the JS engine —
the same precedent set by `formatCaptureTime` in `utils/inspection-photos.ts`.

Balance Method renders as `GreenSky — 2521`, taking the provider from the **same side** of the draft so
a provider change still reads as a change. Legacy addendums carry `buildChangeSummary: null` — valid,
pricing and schedule only. `/public` 404 means the draft was hard-deleted: an error state with Try
Again, never a crash.

⚠️ **`DealDetail`'s own `DraftComparison` (`screens/DealDetail/index.tsx:638`) implements NONE of these
four rules** — it compares raw values and prints `ch.field` verbatim. That screen is currently
unreachable (see the My Deals section above), which is why it wasn't touched, but if it is ever revived
it should be pointed at `buildJobChangeSummary` rather than re-deriving the diff.

## Recent Leads chat opens on "All", not "Unresulted Leads"

Ticket: *"by default it should be all when we land on this screen instead of Unresulted leads."*
`ChatThreads` seeded `statusFilter: 'unresultedleads'` / `selectedStatus: 'Unresulted Leads'`, so the
list opened already filtered and a rep with only resulted leads landed on **"No Leads Conversations
found"** — an empty screen that reads as broken rather than filtered.

Two seeds, now `'all'` / `'All'`. Nothing else changed: `useChatThreads` already treats `'all'` as "no
status constraint" on **both** sides — the server query (`else if (statusFilter !== 'all')` before it
sets `serverStatus`) and the client-side list filter.

⚠️ **The two seeds must stay in sync.** The dropdown derives the key from the label
(`opt.toLowerCase().replace(/ /g, '')`), so the pair has to be exactly what tapping the **All** row
produces — seeding only the label would leave the list filtered while the control claimed otherwise.

## Recent Leads rows are ordered by the lead's OWN time, not by chat recency

Ticket: *"if the lead is Issued Lead and getting the time with the lead, the lead should be assigned
according to time like 9am, 11am, 1pm, 3pm; if the lead is self-gen then displayed according to date
and time. Today / Yesterday and the other categories stay as they are."*

Under **TODAY** the rep saw `3pm`, `9am`, `1pm`, `11am` — every card naming a time, in an order that
matched none of them. `useChatThreads` sorts by `lastMessageAt || updatedAt || createdAt` descending
and `groupChatsByLeadDate` only bucketed that order into day sections, so the rows came out in
whatever order the backend last touched each chat. **Chat recency is the wrong axis for a list whose
rows are named after an appointment time.**

The rule now lives in `utils/lead-thread-order.ts` (pure, so it is testable —
`__tests__/utils/lead-thread-order.test.ts`) and is applied by `groupChatsByLeadDate`
(`widgets/components/chat/ThreadItems.tsx`) to each section's `data`:

- **issued lead** → `leadTime` ("9am", "1:30 PM") parsed to minutes, against `leadDate`.
- **self-gen** → `leadDatetime` / `createdAt`, i.e. when the rep created it. `leadTime: 'N/A'` IS the
  self-gen marker, the same test `isSelfGeneratedLead` uses in `utils/location-util.ts`.

Both kinds reduce to "what time of day is this?", so they **interleave on one chronological axis**
rather than being split into an issued block and a self-gen block.

⚠️ **Rows sort ASCENDING while sections stay newest-first.** A day reads forwards like a schedule
(9am → 3pm) under headers that run TODAY, YESTERDAY, SAT. That is the ticket's own example order; it
is one comparator flip in `sortLeadThreadsByLeadTime` if it is ever wanted the other way.

⚠️ **Dates are read as TEXT** (the `YYYY-MM-DD` / `THH:MM` prefix), never `new Date()` — the sort key
is `YYYYMMDD * 1440 + minutes`. An offset ISO string (`2026-09-14T23:00:00+05:00`) shifts the calendar
day through `new Date()`, which would sort a lead against the wrong day. Same rule as `dayKeyOf`
above.

Decisions worth keeping:

- **Sorted in the grouping, not in `useChatThreads`.** The hook's recency order is left intact and
  becomes the **tiebreak** for two leads in one slot, because `Array.sort` is stable — so same-slot
  rows still lead with the one that moved last. It also means nothing outside this screen changes.
- A date-only self-gen (`"2026-09-13"`, no clock) sits at the **head** of its day rather than having a
  time invented for it; a row whose date cannot be read at all sorts **last** instead of being dropped.
- `getDateSectionLabel` / the section bucketing were NOT touched — the ticket asks for the categories
  to stay as they are.

⚠️ `widgets/components/chat/ThreadItems.tsx` is **CRLF** (it was missing from the root guide's list —
now added). A text-mode script rewrite buries the change in a whole-file diff.

**Known gap:** ordering keys off `leadTime`, which carries only an hour for most payloads
(`"9am"`); two leads in the same hour fall back to chat recency. Minutes are parsed when present
(`"1:30 PM"`), so a payload that starts sending them sorts finer with no change here.

## "Unable to chat on some leads" — create-on-404 never ran

`services/api/ChatService.ts` (`getChatByLeadId`, `createChatForLead`), helper in
`utils/network-error.ts`. Endpoints: `GET /chat/v1/lead/{leadId}` → `POST /chat/v1/create`.

Reported with Android and web DevTools side by side. On web the 404 is immediately followed by
`POST /chat/v1/create` and the thread opens. On mobile the 404 was the **last request** — nothing
followed — and the rep got an empty chat they could not use.

⚠️ **The fallback already existed and had never once executed.** It was guarded by
`err.response?.status === 404`, but `normalizeApiError` (`services/api/index.ts`) rejects with a
**plain object spread from the response body** — there is no `.response` on it at all. The
comparison was permanently `undefined === 404`. It reads like a working check, which is why it
survived review; `httpStatusOf` / `isHttpStatus` now exist so nobody writes it that way again.

⚠️ **`httpStatus`, never the body's own `code`/`status`.** This 404's body is literally
`{code: 404, message: "Chat not found for this lead", data: {}}`. Trusting a spread body's `code`
works here and silently misreads any endpoint whose 200 payload carries one. `normalizeApiError`
reserves `httpStatus` for the real transport status for exactly this reason.

⚠️ **404 is a normal answer, not an error.** A thread is opened by the start-appointment flow, so
any lead where that never ran — created offline, imported, or predating chat — has no thread until
someone asks. Web treats it the same way.

⚠️ **The same bug broke offline chat creation.** `offlineLeadStore.ts`'s `chat` sync step calls
`getChatByLeadId` too, so a lead created at a door synced and still ended up with no thread. Same
root cause, fixed once at the source.

Also hardened: a **200 carrying no chat id** now creates as well (same meaning as a 404), and a
failed create resolves `null` rather than throwing — every caller treats this as "open the chat",
so a rejection would take the screen down instead of degrading it. `createChatForLead` is safe to
call repeatedly; the backend returns the existing thread rather than duplicating. The temporary
`[ChatDiag]` logging added while chasing this is removed. `ChatDetail`'s addendum-PDF 409 check had
the same broken shape and now uses `isHttpStatus`.

### Still carrying the same broken pattern

`err.response?.status` is read in ~15 other places that receive normalized rejections — e.g.
`offline-lead-work.ts:823` (409), `useDynamicCalculators.ts:361` (409),
`autoConfirmManager.ts:112`, `offlinePhotoDeleteQueue.ts:180`. Each is a dead branch in the same
way. Only the chat ones were fixed here, deliberately: the rest change behaviour in unrelated
features and want their own testing. Migrate to `isHttpStatus` when touching them.

## Chat Members sheet — type and colour aligned with the "Seen By" / "Reactions" sheets

`ParticipantsModal` (`widgets/components/chat/ChatModals.tsx`) used `font-black` everywhere, a 10px `tracking-widest`
email at `opacity-40` (unreadable grey) and a hash-coloured square avatar. It now matches the Seen By sheet in
`ChatMessageBubble.tsx`: title `text-xl font-bold`, count badge `text-xs font-bold`, 32px close button, 44px round avatar
from `getAvatarProps` (honours the user's `colorCode`, same colour as everywhere else in chat), name `15px font-bold`,
email `12px` in `colors.textSecondary`. ⚠️ Keep the three sheets visually in step; don't reintroduce `font-black`
(Public Sans has no 900 face — Android synthesises it) or opacity-dimmed text.

## Chat activity log: `meta.files[]` to match web

Ticket: *"currently while we are sending the appointment photo, we are generating the log with the
below payload … we have to change the payload same like the web, you can see filepath and some other
keys are include, do the same thing in my log as well"* — and the same for a plain image send.

Mobile logged a flattened `fileName` string only, so the portal knew a photo had been sent but not
WHICH object: no `filePath`, no `bucketName`, no `category`/`subcategory`.

### The shared mapper

New **`src/utils/activity-log/chat-log-files.ts`** → `buildChatLogFiles(files)`, emitting the six keys
web sends per row: `fileName`, `bucketName`, `filePath`, `fileType`, `category`, `subcategory`.

Pure and RN-free for the usual reason — `hooks/useChatLogic.ts` imports React Native and cannot load
under jest. Used by all three file-bearing sends so they cannot drift.

Also aligned with web on all three: `message: ' '` (was `''`) and `resetCycle: 0`.

### ⚠️ Two of the three logs had to MOVE, and this is the point of the ticket

| Send | Files are | Log fires |
|---|---|---|
| `sendAppointmentPhotos` | already in S3 (posts references) | **after** it (see `fileSize` below) |
| `sendGalleryAssets` | uploaded by this request | **after** it |
| `sendImageAsMessage` | uploaded by this request | **after** it |
| `handleDocumentAttach` | uploaded by this request | **after** it |
| `handleSendVoiceNote` | uploaded by this request | **after** it |

All five file-bearing sends now carry `files[]`. The only `logEvent('send')` calls without it are the
two `messageType: 'text'` ones, which have no files.

⚠️ **`filePath` is an S3 object path that does not exist until the server has stored the file.**
Logging an upload before the request could only ever have recorded a local `file://` uri, which is
useless to the portal. So `ChatService.sendFileMessage` / `sendFilesMessage` now **return** the stored
message (they were `Promise<void>`, discarding it) and the log reads `stored.files`.

⚠️ **Never log a signed URL as `filePath`.** It expires within the hour, so the record would carry a
dead link — the same trap as the image cache (`app-wide.md`).

⚠️ A failed upload now logs NOTHING, which is correct: nothing was sent. Previously it logged a send
that never happened.

⚠️ `fileSize` on the single-image log was a hard-coded **12000**. Web sends the file COUNT here, not a
byte size, so it is now `1` — a fabricated 12000 read as a real measurement.

⚠️ In `buildChatLogFiles`, `type` is checked LAST for `fileType`: an optimistic bubble carries
`type: 'image'` (the GiftedChat kind, not a mime type), so a real `fileType`/`mimeType` must win.

Tests: `__tests__/utils/chat-log-files.test.ts` (8), including the ticket's exact web row.

### Follow-up — the document and voice sends

`handleDocumentAttach` was the case in the second report (`messageType: 'pdf'`, no `files[]`).

- ⚠️ It logged only **`docs[0]`**, so a rep attaching three files logged one. Each document is its own
  request, so the stored rows are now gathered from every response (`storedDocs.flatMap`), and
  `fileName` joins all of them.
- ⚠️ `fileSize` was the picker's **BYTE size** (142786 in the report). Web sends the file COUNT in that
  field, so it is now `docs.length` — consistent with the other sends.

`handleSendVoiceNote` keeps two things the others do not, deliberately:

- **`duration`** (`recordingTime`), which the portal shows.
- **A real `fileSize`**, because a voice note's size is actually measured (`RNFS.stat`) rather than
  guessed. ⚠️ The `12000` still in that function is only the fallback when the `stat` throws.

Its `fileName`/`fileSize` are computed inside the `user?._id` guard before the send (the `stat` is
worth doing once) and carried to the post-send log in `voiceLogMeta`.

### Follow-up — `fileSize` per file row, as a real byte count

*"put the fileSize inside files array, and it should be the actual size of the file like 142786 …
you have to do it for all the other logs as well"*.

`meta.fileSize` (the file COUNT) stays where it is; each row in `meta.files[]` now also carries its
own **byte** size. New `normalizeLogFileSize` reads it from whichever key the source used.

⚠️ **Three spellings, because three sources disagree.** The server sends `size` / `fileSize` /
`file_size` — the same spread `ChatService.normalizeFileSize` already handles for display — the image
picker sends `fileSize`, and the document picker sends `size`. Reading only one silently logs 0.

Where each send's real size comes from:

| Send | Size source |
|---|---|
| `handleDocumentAttach` | document picker's `size` |
| `sendGalleryAssets` | image picker's `fileSize` — ⚠️ it was being DROPPED in `handleAttach`'s `asset` map and is now carried through |
| `handleSendVoiceNote` | the `RNFS.stat` it already performed |
| `sendImageAsMessage` | a new best-effort `RNFS.stat` of the local upload path |
| `sendAppointmentPhotos` | **the server only** |

⚠️ **`sendAppointmentPhotos` had to move to a post-send log too**, which is not obvious: its S3 PATH
was known up front (it posts references), but the per-file BYTE SIZE is not — the device never
downloads these photos. So `ChatService.sendAppointmentPhotos` now returns the stored message like the
upload methods, and the log reads its rows. It falls back to the sent payload (path and category
intact, size 0) when the response carries none.

⚠️ `normalizeLogFileSize` returns **0, never undefined**, so the key is always present — and a genuine
0-byte file is preserved rather than being treated as missing.

## Chat header / thread-list lead photo: slow to appear (street view or uploaded)

`useLeadPreviewUrl` showed the home placeholder until `LeadService.getSecureUrls` answered (module-memory cache only, so EVERY cold start), then the `<Image>` downloaded the pre-signed S3 file (which defeats the native image cache). Now, for stored (bucket) photos only: the last resolved URL is persisted in MMKV (`leadPreviewUrl:<bucket/path>`), and `warmToLocalCache` maps it to the on-disk file (`getLocalCachePath` drops the signature, so an expired URL still finds the file). A reopened chat paints from disk with no API call and no network; first open resolves the URL, shows it, and warms it to disk. The thread list uses the same hook, so its thumbnails pre-warm the header's. ⚠️ Never warm a `googleUrl` (street view) through this cache: its signature-less path has no per-lead part, so every lead would share one file. Google URLs still load directly. A changed photo changes `bucket/filePath`, hence the key. Not verified on device.


## REVUIUX-552 - job number in Messages opens the deal (My Deals flow)

Ticket (Lance): from Messages, for jobs **Pending Rehash / Pending Install / Installing Today**, the job number goes straight to the My Deals flow. The element the ticket circles (IMG_8370) is the **title in the open chat's header**, not only the list row. Backend is done (`Pending Rehash` socket filter, payload already carries `leadDetails._id / leadId / installationDate / isRehashed`). Mobile handoff: `REVUIUX-552-mobile-handoff.md`.
- **Rule:** `screens/ChatThreads/utils/deal-link.ts` (`canOpenDeal` = `isPendingRehash || isPendingInstall || isInstallingToday`), tests `tests/chat/deal-link.test.ts` (`tests/` is tracked, `__tests__/` is not). Already Installed is deliberately excluded. The filter list AND every tap target read the same predicates so they cannot drift.
- **Filter:** `Pending Rehash` under `Unresulted Leads` in `STATUS_OPTIONS` (installers keep their own list). ⚠️ The slug (`pendingrehash`) must be mapped in BOTH switches in `hooks/useChatThreads.ts` - the server mapping and the client re-filter; only the first leaves the list silently empty.
- **Destination:** `navigation.navigate('LeadCenter', { lead, fromMyDeals: true })` (same as `MyDeals.openDeal`). It takes a WHOLE lead object, so the header refetches with `LeadService.getLeadDetailsById`.
- **List row is deliberately NOT a link.** The handoff's list-row tap target (heading / `Lead ID:` -> deal) was built and then removed at the product owner's request: the deal opens ONLY from the chat header. Do not re-add `onOpenDeal` to `LeadChatThreadItem`.
- **Chat header:** `ChatHeader` gets `leadId` and fetches the lead itself (`['chatDealLead', leadId]`, online only), because `ChatDetail` is navigated with scalars and push / notification entries pass no lead data at all. ⚠️ Gate on LEAD STATE (`canOpenDeal`), not on the filter the rep arrived from - inside a chat the filter is invisible. The title `Pressable`'s `hitSlop` is deliberately tighter than the Back button's 20px one, which reaches into the title row.
- Known, preserved quirks (not fixed on purpose): `isInstallingToday` compares a UTC date string and does not require `status === 'sale'` (the backend bucket does). Offline, the header link is absent (no lead to evaluate).
- Not verified on device: header tap -> `Deal`; back returns to the chat; Already Installed header not tappable; push-opened chat gets the link; a real Pending Rehash lead (`isRehashed: true`, unresulted).

### Follow-up - in-chat link was dead for Pending Install / Installing Today

Report: tapping the lead title inside the chat opened the deal for **Pending Rehash** but did nothing for **Pending Install** and **Installing Today**.

- **Cause:** `f55b9263` rewrote the two install predicates to read `leadDetails.installBucket`, which is correct for the Messages LIST - the backend computes that field into the `all-lead-chats-response` socket payload. The chat HEADER has no socket lead: it is reached from pushes and notifications too, so it refetches with `LeadService.getLeadDetailsById` (`lead/v1/details/:id`), a generic lead read that **does not return `installBucket` at all**. Both predicates therefore returned false and the title rendered unlinked. Pending Rehash survived only because `isRehashed` / `status` DO come back from that endpoint.
- **Fix, two halves:**
  1. `deal-link.installBucketOf(leadDetails)` resolves the bucket: the server's `installBucket` when present, otherwise derived from `installationDate` + `status` (the pre-`f55b9263` rule, kept as a FALLBACK ONLY). `isPendingInstall` / `isInstallingToday` both go through it, so the list and the header still share one rule.
  2. The list hands its bucket over the navigation (`ChatThreads.navigateToChat` -> `ChatDetail` route param -> `ChatHeader installBucket` prop), and the header merges it onto the refetched lead. When the list knows, nothing is re-derived. The param is declared on `ChatDetail` in `RootStackParamList` (`src/navigation/index.tsx`) - that file is otherwise Zone Canvasser territory, so the note lives here with the rest of the chat work.
- ⚠️ **The server's bucket always wins** - it is resolved off the job builder and the date arithmetic here cannot reproduce that. The fallback exists for the entries that carry no bucket (push / notification), not to second-guess the backend.
- ⚠️ The install day is compared as **TEXT** (`CLAUDE.md` §6). `new Date(iso)` shifts the calendar day by the device's timezone offset, which would call tomorrow's install "today" for any rep west of UTC.
- Tests: `tests/chat/deal-link.test.ts` (18) covers each derived bucket, server-wins precedence, and the timezone-drift case.
- Not verified on device: open a chat from the **Pending Install** filter and from **Installing Today** - the title should be underlined and open `Deal`; an **Already Installed** chat must stay unlinked; a push-opened chat for a sold job with a future install date should still link.


### Follow-up - the appointment-photo picker's "Send N photo(s)" bar sat under the Android nav bar

`LeadImagePickerModal` (the "Appointment Photos" sheet opened from chat) is a `Modal`, so its safe-area insets read 0 / stale and the Android 3-button / gesture bar covered the Send bar. The sheet now carries `paddingBottom = max(useBottomInset(), 48 on Android)` - the same floor `CategorySheet` uses (see `app-wide.md`). ⚠️ The padding is on the SHEET, not the Send bar, so the photo grid's last row also clears the bar when nothing is selected. Don't swap it back to a fixed padding. Not verified on device: 3-button and gesture navigation on Android, and iOS home indicator.

- ~~**Originals only.**~~ **Superseded - see REVUIUX-563 below.** `LeadImagePickerModal.leadPhotos` briefly dropped any photo whose `subcategory` contains `(Annotated)`. That is not what the ticket asked for and it hid photos reps want to send; annotated copies are shown and badged instead. ⚠️ If you do ever need to filter this list again, note that the tabs, the per-tab counts, the "N photos for this lead" line and the selection all derive from `leadPhotos`, so filter there and not at the render site.


## REVUIUX-563 - Messages appt photos: make the annotated ones obvious

Ticket: "Messages - appt photos - the annotated ones should be clear they're annotated." An annotated photo is a derived copy stored under the original's subcategory with an `(Annotated)` suffix, so in the picker it sits directly beside the shot it was drawn from - **same slot name, near-identical thumbnail at grid size**. The rep could not tell which of the two they were about to send (the reporter drew the word "Annotated" onto their screenshot to point at the tile that needed marking).

- **Rule:** `utils/appointment-photo-labels.ts` - `isAnnotatedSalesPhoto` (badge predicate) and `appointmentPhotoSendLabel` (the label that goes out with the photo). Pure, no RN imports, so it is testable: `tests/chat/appointment-photo-labels.test.ts`.
- **Picker tile** (`widgets/components/chat/LeadImagePickerModal.tsx`): an `ANNOTATED` pill (pencil icon, amber) on the **title row, right after the slot name** - `Back-Right  [ANNOTATED]`. ⚠️ It is NOT on the thumbnail: it was first placed bottom-left over the image and that covers part of what the rep is trying to look at. ⚠️ The title `Text` takes `flexShrink: 1` and the pill `flexShrink: 0`, so on a half-screen tile a long slot name truncates instead of pushing the pill off the row.
- ⚠️ **Two different labels, deliberately.** The grid tile shows the bare slot name (`Front`), because that is what a rep scans the grid for and the badge beside it already says "annotated". The label SENT with the photo keeps the suffix (`Front (Annotated)`), because `ChatMessageBubble.getPhotoLabel` prints it under the photo for **everyone in the thread** and a recipient has no badge to look at. Don't "tidy" these into one.
- ⚠️ **They are NOT filtered out.** An earlier pass at this ticket hid annotated copies from the picker; the annotation is usually the whole reason a rep is sending the photo. Mark them, don't hide them.
- Selection is keyed by `_id` / `s3url`, not by the label, so the clean shot and its annotated twin select independently even though both read `Front`.
- Not verified on device: a lead with both an original and an annotated copy of the same slot - the badge should sit on the annotated tile only, both should be selectable separately, and the sent message should read `Front (Annotated)` for the recipient.


### Follow-up - tapping the chat header's street-view picture spun for a long time on iOS

Report: opening the header thumbnail (a Google street view) showed a black screen with a spinner for a long time on iPhone; Android was fine.
- **Cause:** the gallery (`ImageGalleryModal`) ran the street-view url through `useWarmedImageUris` -> `warmToLocalCache`, i.e. a SECOND download of a picture the header had already fetched, started from the tap, with a spinner until it landed and another when the source swapped to the local copy. Worse, `getLocalCachePath` dropped the query, and a Google Maps url has no per-lead path - so every lead's street view mapped to ONE cache file.
- **Fix:** (1) `utils/imageFileCache.getLocalCachePath` keeps the QUERY in the hash for `maps.googleapis.com` / `maps.google.com` (the query IS the identity there), so those urls can be cached safely. (2) `useLeadPreviewUrl(leadDetails, { warmGoogle: true })` - ONLY the chat header passes it - warms the street view to disk and returns the local file, so the gallery opens on a `file://` with no network. ⚠️ Don't turn it on in the thread list: it would download one picture per row. (3) `ImageGalleryModal.ZoomablePage` only shows its spinner for a remote uri.
- ⚠️ The iOS 18.4 SIMULATOR fails every `maps.googleapis.com` request over HTTP/3 (CLAUDE.md §6): if the street view never loads there, test on an 18.5+ simulator or a device before blaming this code.
- Not verified on device: open a lead whose preview is a street view, tap the header picture - it should open at once; two different leads must show their own street views.

- **Second follow-up - still a black screen after that (iOS 26 simulator), no spinner.** With the picture already local the gallery drew nothing: `ZoomablePage` parked the image at `opacity 0` until `onLoadEnd`, and its `onError` just set opacity 1 over a failed image - i.e. a silent black screen. Now (`widgets/modals/ImageGalleryModal.tsx`): a LOCAL file starts at full opacity (only a remote image fades in); if a local copy errors, `onError` drops it (`forgetWarmedUri`) and draws the REMOTE original (`fallbackUri`); if that fails too it shows "Could not load this photo" instead of black. Google Maps urls are loaded plainly - no `cache: 'force-cache'`, no `progressiveRenderingEnabled` - exactly like the header thumbnail that already worked. ⚠️ Don't reintroduce "opacity 0 until an event" for local files, and don't let `onError` end in a blank view. The root cause on iOS was not reproduced from code alone; if a street view still fails, log the `onError` nativeEvent here first.

- **Follow-up - the appointment-photo picker also floors its bottom padding on iOS** (`LeadImagePickerModal`): `max(useBottomInset(), 48 on Android / 20 on iOS)`. A `Modal`'s insets can read 0 / stale on iOS too, which would put the Send bar on the home indicator. Not verified on device.

### REVDSM-1313 - a channel can belong to several offices (the app only READS this)

API contract (shapes, routes, socket events, error codes): `docs/REVDSM-1313-channels-api-contract.md`.

Channels are created and managed **in the portal only**: managers and VPs work there, and the roles that use this app (sales rep, installer) do not create channels. The "New Channel" button in `ChatThreads/index.tsx` is commented out and `CreateChannelModal` is unreachable dead code from this ticket — ⚠️ do NOT build onto it (an office picker was added there and reverted for exactly this reason). If channel management is ever wanted on mobile, decide that as its own ticket; the modal is also missing the icon picker and the ten per-channel settings the portal has.
- **One channel, several offices.** The channel document keeps `office_id` as its PRIMARY office and adds `office_ids` with the whole set. Everyone who can see any office in the set shares the same conversation and one message history. `utils/team-channel-offices.ts` (`officeIdsOf`, `channelInOffice`) is the only reader: `office_ids` when it has entries, else `office_id`. ⚠️ A channel created before this ticket carries ONLY `office_id` - nothing was backfilled, so never read `office_ids` directly or those channels vanish.
- **Nothing here filters by office.** `GET /api/v1/channels/` is already scoped per viewer on the server, so the list is taken as given — the app never decides what a rep may see.
- **`team-channels-reordered` matches on the whole set** (`channelInOffice`), not on `office_id` alone. A manager reordering from office B emits `officeId: B`, but a channel shared with B may have A as its primary — matching the primary only would silently skip it and leave the rep's list in the old order. There is one `sort_order` per channel, so the move applies in every office that has it.
- Not verified on device: a rep in a shared channel's second office sees it in the list and can post; a manager reordering from that second office moves it in the rep's list too; an older single-office channel is unaffected.

- **Merge note - `ChatDetail/index.tsx` conflicted when REVDSM-1313 landed on `dev-v1-multi-tenat`.** Both sides edited the same two lines at the top of `ChatDetailScreen`: HEAD had added `installBucket: routeInstallBucket` to the `route.params` destructure, REVDSM-1313 had added `const navigation = useNavigation<any>()` and destructured without `installBucket`. **Resolved by keeping BOTH** - HEAD's destructure is a strict superset of the branch's, so nothing from REVDSM-1313 is lost. ⚠️ Both are load-bearing and dropping either compiles-but-breaks: `routeInstallBucket` is passed on at the installer photo preview, and `navigation.goBack()` is used in the channel-permission effect. If this file conflicts again, check the destructure line is still the superset rather than taking one side wholesale.

## Chat GIF picker (REVDSM-575)

Ticket: add GIFs to chat. The attach menu (`+`) gets a **GIF** row that opens a bottom sheet — search pill, 3-column grid with 2px gaps — fed by the **GIPHY REST API** (Tenor's API was shut down 30 Jun 2026, and GIPHY's RN SDK adds native code with unverified RN 0.84 support).

| piece | where |
|---|---|
| GIPHY client (`trending` / `search`, paged) | `services/api/giphy.ts` |
| debounced infinite query | `hooks/useGifSearch.ts` |
| picker sheet | `widgets/modals/chat/GifPickerModal.tsx` |
| inline bubble renderer | `widgets/components/chat/GifMessage.tsx` |
| detection + aspect ratio (pure, tested) | `utils/gif-message.ts` |
| send | `useChatLogic.sendGif` → `sendTextMessage` |
| key | `GIPHY_API_KEY` in `.env` → `config/env.ts` (optional) |

- **A GIF is a TEXT message whose whole body is a `media*.giphy.com` / `i.giphy.com` `.gif|.webp` URL.** The backend has no GIF type, so web and older builds show the link and nothing needed a server change. `isGifMessageText` is an exact-match on the trimmed body — ⚠️ do not loosen it to "contains": a sentence with a link in it must stay text.
- ⚠️ **GIPHY is called with plain `fetch`, never the axios wrapper** — that attaches the revDSM bearer token to every request.
- The sent URL is the `downsized` rendition with its query string stripped; the grid uses `fixed_width_small`. Rating is capped at `pg-13`.
- **No key ⇒ the picker shows "not set up", the app does not throw** (`GIPHY_API_KEY` is deliberately not in `required()`). Production needs GIPHY's upgraded key and the "Powered by GIPHY" line, which the sheet renders.
- The picker opens through `selectAttachmentOption`, so it waits for the attach menu to finish dismissing (never stack native Modals). It lifts itself by the keyboard height rather than using `KeyboardAvoidingView`, and caps its height from the window so iPad landscape fits.
- Reply previews show `GIF` and the thread list shows `Sent a GIF` instead of the raw URL.
- Tests: `__tests__/utils/gif-message.test.ts`. ⚠️ Needs a device check on iOS and Android: GIFs animate in the grid and bubble, the sheet sits above the keyboard, long-press on a GIF bubble opens the reaction bar, and a failed load falls back to the link.

- **Android showed GIFs as a still frame (REVDSM-575 follow-up).** Root cause: React Native 0.84 does **not** bundle Fresco's animated decoders (`node_modules/react-native/gradle/libs.versions.toml` lists only `fresco`, `middleware`, `imagepipeline-okhttp3`, `ui-common`), so the stock `<Image>` decodes only the first frame on Android while iOS animates natively. Fix is in `android/app/build.gradle`: `animated-gif`, `animated-webp` and `webpsupport` at the SAME version as RN's `fresco`. ⚠️ Needs a **native rebuild** (`yarn android`) — Metro reload does nothing — and the three versions must be bumped together with every RN upgrade. This also makes any other animated GIF/WebP `<Image>` in the app animate on Android.

- **GIF messages never expose their url (REVDSM-575 follow-up).** The long-press menu preview shows the GIF (not the link), and **Copy** and **Edit** are hidden for a GIF — Edit was the leak: it loaded the url into the composer. A reply to a GIF shows a thumbnail in the composer reply bar (`ChatBars.tsx`) and in the quoted bubble (`ChatMessageBubble`'s reply quote), not the url or a bare "GIF" label. All keyed on `isGifMessageText`. The pinned list (`PinnedMessagesArea` in `ChatModals.tsx`) shows the GIF as the row thumbnail with the label `GIF`. ⚠️ Message search still matches the raw url text; check on a device. Not device-verified.

### Pinned messages list not showing (lead chat)

- **Two defects fixed, not reproduced on device:** (1) `PinnedMessagesArea` returned `null` for an empty list, so the pin sheet was an invisible card and the pin icon seemed dead - it now shows a "No pinned messages yet" state. (2) `useChatSession` sent a second `get-pinned-messages` with `{ chatId, channelId }` on top of the plain-id request `SocketManager.joinRoom` already makes (and the web sends); removed, so there is one request shape. Whether the server answered the object form with an empty list is **unverified** - if the list is still missing, log `pinned-messages-response` payloads next.
- ⚠️ Channels deliberately have no pinning (REVDSM-1313): `!isChannel` gates the header icon, the modal and the socket listeners. Do NOT re-add it as part of this.

### GIF bubble: play twice, freeze under a GIF badge, full screen while animating

- **Behaviour (WhatsApp-style):** the bubble animates for TWO plays, then swaps to a still frame under a translucent grey circle with a bold "GIF" (no scrim over the picture). Tap a frozen GIF = replay (two more plays). Tap an ANIMATING GIF = full-screen viewer (black, `contain`, loops, close X / tap / back). A frozen GIF never opens full screen - tapping it replays instead (requested).
- **Why this shape:** React Native cannot pause or loop-count an animated `<Image>`. `utils/gif-playback.ts` (pure, `__tests__/utils/gif-playback.test.ts`) reads one play's length from the file's own frame delays (GIF GCE delays / animated-WebP ANMF durations); `GifMessage` starts the clock on `onLoad`, and at `2 x loop` (clamped 1-60 s, 3 s loop assumed if unreadable) unmounts the animated `<Image>` and shows the still. Replay remounts the `<Image>` (`key={runId}`), which restarts from frame 1.
- ⚠️ The still is GIPHY's `_s` rendition of the same path (`giphy-downsized.gif` -> `giphy-downsized_s.gif`, `gifStillUrl`). If a url has no such convention (e.g. `i.giphy.com/<id>.gif`) or it 404s, the bubble shows a dark box under the badge instead - it never keeps animating behind it.
- ⚠️ The length is fetched with `XMLHttpRequest` `arraybuffer` (RN's `FileReader` has no reliable `readAsArrayBuffer`), plain and unauthenticated - never the axios wrapper (bearer token). Cached per url; the picture itself is downloaded a second time by `<Image>` (HTTP cache usually serves it).
- The full-screen `Modal` is its own native tree: insets floored, `StatusBar.setHidden` imperative (CLAUDE.md §6). It opens only from a bubble, so it never stacks on another Modal. Not device-verified on iOS or Android.

### Pinned messages not showing / removed on reopen (lead chat)

- **Root cause (mobile side, fixed):** `normalizeMessage` only read `m.isPinned`, so a backend that serialises the flag as `pinned` / `is_pinned` / `pinnedMessage` made every message look unpinned, and `pinnedMessages` was populated only from the socket's `pinned-messages-response` (which could be empty) - so the sheet stayed empty and pins vanished on reopen.
- **Fixes:** (1) `ChatService.normalizeMessage` accepts `isPinned || pinned || is_pinned || pinnedMessage`. (2) `handlePin` updates `pinnedMessages` optimistically, so the sheet shows the pin immediately instead of waiting for the socket echo. (3) `message-pinned` / `message-unpinned` handlers now also handle a full message in the payload (covers pins outside the current page) and guard against a missing id. (4) A `useEffect` reconciles `pinnedMessages` with `messages` after every render: current-page pins come from `messages.isPinned`, older-page pins are retained, and an unpinned message is dropped - so an empty `pinned-messages-response` can no longer wipe the list. (5) `loadMessages` resets `pinnedMessages` first, so switching chats can't leak pins.
- ⚠️ **Backend contract check:** mobile follows the web contract (`pin-message` / `unpin-message` with `{ messageId, chatId }` for lead chat, events `message-pinned` / `message-unpinned` / `pinned-messages-response`). If pins still disappear on reopen after this, verify the backend still persists `isPinned` on the message and broadcasts `message-pinned` - compare with the web portal, which uses the same events. Mobile no longer sends the `{ chatId, channelId }` object form of `get-pinned-messages` that the server may have answered differently.
- Not device-verified.

- **Follow-up - pins vanish on reopen / list empty:** the web lead chat NEVER sends `get-pinned-messages` and trusts each message's `isPinned`; only mobile asks for the list and used to REPLACE `pinnedMessages` (and set every other message `isPinned: false`) with whatever `pinned-messages-response` carried - so a short/empty reply wiped pins the message history already showed, and the REST page load could in turn drop older pins the socket reply had. Both paths now MERGE (`mergePins` in `useChatSession.ts`); removal is only the `message-unpinned` event / the Unpin button. Logs to read on a device: `[pins] REST page: N messages, M isPinned` and `[pins] pinned-messages-response: K pinned`. ⚠️ If a pin made and then re-opened shows `M = 0` AND `K = 0`, the BACKEND did not persist `pin-message` - nothing in the app can fix that; check the `pin-message` handler / the message's `isPinned` field. Not device-verified.

### Pin icon in the chat header went back on the first tap
- **Root cause:** the "Back to Leads/Channels" `Pressable` in `ChatHeader.tsx` was a full-width row with `hitSlop` 20 and `zIndex: 9999`. Its invisible bottom slop (20px) was larger than the `mb-4` gap (16px) to the title row, so the top of the pin icon sat inside the Back button's hit area and the first tap navigated back; tapping lower opened the pin list.
- **Fix:** the Back row now hugs its content (`alignSelf: 'flex-start'`), the `zIndex` is gone and the bottom slop is 8px (inside the gap). ⚠️ Don't restore a full-width Back row or a bottom slop over 16px - it will swallow taps on the pin/participants icons again. Not device-verified.
