// REVUIUX-577: reading and updating a poll that arrived on a team-channel message.
// Pure so it can be tested under jest - the card that draws it cannot be.
// The server contract is in docs/team-channel-polls-backend.md.

export interface PollOptionView {
  id: string;
  text: string;
  voteCount: number;
}

export interface PollView {
  question: string;
  allowMultiple: boolean;
  options: PollOptionView[];
  /** Distinct people who voted - NOT the sum of voteCount once allowMultiple is on. */
  totalVoters: number;
  /** This device's own selection. Broadcasts always carry [], so never take it from one. */
  myVotes: string[];
  closed: boolean;
  closedAt: string | null;
  /**
   * The server write this poll was computed from, counting up by one per vote.
   * Two people voting in the same instant can have one of them served a reply
   * computed before the other's write, and this is how that reply is told
   * apart from a current one. 0 when the payload carries none, which is what a
   * server older than REVUIUX-577's ordering fix sends.
   */
  rev: number;
}

/**
 * The poll on a message, or null when it is an ordinary one.
 *
 * Shape-checked rather than trusted: `messageType` is not required, because an
 * optimistic copy or an older payload may carry the poll without it, and the
 * poll object itself is the thing being rendered.
 */
export const getPollMeta = (message: any): PollView | null => {
  const poll = message?.poll;
  if (!poll || typeof poll !== 'object' || !Array.isArray(poll.options) || poll.options.length === 0) {
    return null;
  }
  return {
    question: String(poll.question ?? message?.text ?? message?.message ?? ''),
    allowMultiple: poll.allowMultiple === true,
    options: poll.options.map((o: any) => ({
      id: String(o?.id ?? o?._id ?? ''),
      text: String(o?.text ?? ''),
      voteCount: Number(o?.voteCount) || 0,
    })),
    totalVoters: Number(poll.totalVoters) || 0,
    myVotes: (Array.isArray(poll.myVotes) ? poll.myVotes : []).map(String),
    closed: poll.closed === true,
    closedAt: poll.closedAt ?? null,
    rev: Number(poll.rev) || 0,
  };
};

export const isPollMessage = (message: any): boolean => getPollMeta(message) !== null;

/** Share of voters who picked this option, 0-100. */
export const pollPercent = (voteCount: number, totalVoters: number): number =>
  totalVoters > 0 ? Math.round((voteCount / totalVoters) * 100) : 0;

/**
 * The selection to send after tapping `optionId`, WhatsApp-style:
 *
 * - multiple answers: the option goes in or out of the set;
 * - single answer: tapping another option replaces the choice, and tapping the
 *   one already chosen takes the vote back.
 *
 * The result is always the COMPLETE selection, which is what the vote endpoint
 * expects - so a retry sends the same answer rather than toggling it again.
 */
export const nextSelection = (poll: PollView, optionId: string): string[] => {
  const id = String(optionId);
  const chosen = poll.myVotes.includes(id);
  if (poll.allowMultiple) {
    return chosen ? poll.myVotes.filter((v) => v !== id) : [...poll.myVotes, id];
  }
  return chosen ? [] : [id];
};

/**
 * This device's own poll after a vote it has not heard back about yet, so the
 * tick and the bars move on the tap instead of after the round trip. The server
 * response replaces it, so a refusal simply un-does this.
 */
export const optimisticPoll = (poll: PollView, selection: string[]): PollView => {
  const chosen = new Set(selection.map(String));
  const had = poll.myVotes.length > 0;
  const has = selection.length > 0;
  return {
    ...poll,
    myVotes: [...chosen],
    options: poll.options.map((o) => {
      const was = poll.myVotes.includes(o.id);
      const now = chosen.has(o.id);
      if (was === now) return o;
      return { ...o, voteCount: Math.max(0, o.voteCount + (now ? 1 : -1)) };
    }),
    // One voter joining or leaving the poll; switching between options is neither.
    totalVoters: Math.max(0, poll.totalVoters + (!had && has ? 1 : had && !has ? -1 : 0)),
  };
};

/**
 * Counts from a `team-channel-poll-updated` broadcast folded into the poll on
 * screen. The broadcast is one payload for the whole room and so carries no
 * `myVotes` - this device's own selection is kept, never read from it.
 */
export const applyPollUpdate = (poll: PollView, update: any): PollView => {
  const incoming = Number(update?.rev);

  // Older than, or the same as, what is already drawn - so it has nothing to
  // add and applying it would walk the counts backwards. A payload with no
  // revision at all cannot be ordered and is applied as it always was, which
  // is what keeps this app working against a server without the counter.
  if (Number.isFinite(incoming) && incoming <= poll.rev) return poll;

  const counts = new Map<string, number>(
    (update?.options || []).map((o: any) => [String(o?.id), Number(o?.voteCount) || 0]),
  );
  return {
    ...poll,
    options: poll.options.map((o) => (counts.has(o.id) ? { ...o, voteCount: counts.get(o.id) as number } : o)),
    totalVoters: Number(update?.totalVoters) || 0,
    closed: update?.closed === true,
    rev: Number.isFinite(incoming) ? incoming : poll.rev,
  };
};

/**
 * What to draw once the vote endpoint answers this device's own tap.
 *
 * The reply is the only payload carrying `myVotes`, but it was computed when
 * the vote was written - so if someone else voted in the meantime, a broadcast
 * of THEIR write may already be on screen with higher counts. Taking the reply
 * whole would undo it. So a reply that lost the race contributes only this
 * device's own ticks and leaves the fresher counts alone.
 */
export const pollAfterVote = (current: PollView | null, confirmed: PollView): PollView => {
  if (!current) return confirmed;

  // Equal revisions are kept, not dropped: this device also receives the
  // broadcast of its OWN vote, which carries the same revision and often
  // arrives first - and it has no `myVotes` to restore the tick from.
  if (confirmed.rev < current.rev) return { ...current, myVotes: confirmed.myVotes };

  return confirmed;
};

/** The same update written back onto a raw message, for the socket handler. */
export const messageWithPollUpdate = (message: any, update: any): any => {
  const poll = getPollMeta(message);
  if (!poll) return message;
  return { ...message, poll: applyPollUpdate(poll, update) };
};
