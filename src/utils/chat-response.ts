/**
 * chat-response.ts — reading an id out of what the chat API answers.
 *
 * ⚠️ This is one line of logic in its own file for one reason: `services/api/ChatService.ts`
 * imports axios and cannot load under jest (CLAUDE.md §6), and this rule had already cost a
 * shipped bug. Keeping it here means it is actually tested.
 *
 * The chat endpoints do NOT answer in one shape. Observed, all three:
 *
 *     { data: { chat: { _id } } }     the documented one
 *     { data: { _id } }               `create` on this backend
 *     { _id }                         bare
 *
 * `GET /chat/v1/lead/{id}` accepted all three; `POST /chat/v1/create` read only the first. So a
 * create that SUCCEEDED returned `undefined`, the caller stored null, and the rep saw a chat that
 * would not open — a 200 indistinguishable from a failure. Both paths share this now.
 */

/** The chat id out of any shape the API answers in, or null if there is none. */
export const readChatId = (body: any): string | null => {
  const chat = body?.data?.chat || body?.data || body;
  if (typeof chat === 'string') return chat || null;
  const id = chat?.id || chat?._id;
  return typeof id === 'string' && id ? id : null;
};
