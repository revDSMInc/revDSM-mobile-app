/**
 * REVDSM-1313: reading the offices a team channel belongs to.
 *
 * Channels are created and managed from the portal only — managers and VPs work
 * there, and the roles that use this app (sales rep, installer) never create
 * one. The app only has to READ the office scope, so that a channel shared by
 * several offices behaves like any other in the list.
 *
 * Pure on purpose, so it can be tested without React Native in the way
 * (tests/chat/team-channel-offices.test.ts).
 */

/**
 * Every office a channel belongs to. `office_ids` is the full set; a channel
 * saved before it existed carries only `office_id` and reads as that one
 * office. Mirrors `officeIdsOf` on the server.
 */
export function officeIdsOf(channel: any): string[] {
  const many: string[] = (channel?.office_ids || []).filter(Boolean).map(String);
  if (many.length) return many;

  return channel?.office_id ? [String(channel.office_id)] : [];
}

/** True when the channel is in this office, whichever shape it was saved in. */
export function channelInOffice(channel: any, officeId: any): boolean {
  if (!officeId) return false;

  return officeIdsOf(channel).includes(String(officeId));
}
