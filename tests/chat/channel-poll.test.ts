import {
  PollView,
  applyPollUpdate,
  getPollMeta,
  isPollMessage,
  messageWithPollUpdate,
  nextSelection,
  optimisticPoll,
  pollAfterVote,
  pollPercent,
} from '../../src/utils/channel-poll';

// REVUIUX-577. The server contract these mirror is docs/team-channel-polls-backend.md:
// a message carries `poll` with per-option counts, `totalVoters` is DISTINCT
// voters, and `myVotes` is per viewer -- broadcasts always send it empty.

const serverPoll = (over: any = {}) => ({
  question: 'Which day works?',
  allowMultiple: false,
  options: [
    { id: 'a', text: 'Monday', voteCount: 2 },
    { id: 'b', text: 'Tuesday', voteCount: 1 },
  ],
  totalVoters: 3,
  myVotes: ['a'],
  closed: false,
  closedAt: null,
  ...over,
});

const view = (over: Partial<PollView> = {}): PollView => ({
  ...(getPollMeta({ poll: serverPoll() }) as PollView),
  ...over,
});

describe('getPollMeta', () => {
  it('reads a poll off a message', () => {
    const poll = getPollMeta({ _id: 'm1', poll: serverPoll() })!;
    expect(poll.question).toBe('Which day works?');
    expect(poll.options.map((o) => o.id)).toEqual(['a', 'b']);
    expect(poll.totalVoters).toBe(3);
    expect(poll.myVotes).toEqual(['a']);
  });

  it('is null for every ordinary message', () => {
    expect(getPollMeta({ _id: 'm1', text: 'hello' })).toBeNull();
    expect(getPollMeta({ _id: 'm1', poll: null })).toBeNull();
    expect(getPollMeta(null)).toBeNull();
  });

  it('is null for a poll with no options rather than drawing an empty card', () => {
    expect(getPollMeta({ poll: { question: 'Q', options: [] } })).toBeNull();
  });

  it('does not require messageType, so an optimistic copy still renders', () => {
    expect(isPollMessage({ poll: serverPoll() })).toBe(true);
  });

  it('survives missing counts from an older payload', () => {
    const poll = getPollMeta({
      poll: { question: 'Q', options: [{ id: 'a', text: 'Monday' }] },
    })!;
    expect(poll.options[0].voteCount).toBe(0);
    expect(poll.totalVoters).toBe(0);
    expect(poll.myVotes).toEqual([]);
  });

  it('reads an option id sent as _id', () => {
    const poll = getPollMeta({ poll: { question: 'Q', options: [{ _id: 'x', text: 'Monday' }] } })!;
    expect(poll.options[0].id).toBe('x');
  });
});

describe('pollPercent', () => {
  it('is a share of voters', () => {
    expect(pollPercent(2, 4)).toBe(50);
    expect(pollPercent(1, 3)).toBe(33);
  });

  it('is zero before anyone votes, never a division by zero', () => {
    expect(pollPercent(0, 0)).toBe(0);
  });
});

describe('nextSelection', () => {
  it('replaces the choice on a single-answer poll', () => {
    expect(nextSelection(view({ myVotes: ['a'] }), 'b')).toEqual(['b']);
  });

  it('retracts when the chosen option is tapped again', () => {
    expect(nextSelection(view({ myVotes: ['a'] }), 'a')).toEqual([]);
  });

  it('adds and removes on a multi-answer poll', () => {
    const multi = view({ allowMultiple: true, myVotes: ['a'] });
    expect(nextSelection(multi, 'b')).toEqual(['a', 'b']);
    expect(nextSelection(view({ allowMultiple: true, myVotes: ['a', 'b'] }), 'a')).toEqual(['b']);
  });

  it('always answers the COMPLETE selection, so a replay is the same answer', () => {
    const multi = view({ allowMultiple: true, myVotes: [] });
    const once = nextSelection(multi, 'a');
    expect(nextSelection({ ...multi, myVotes: once }, 'a')).toEqual([]);
  });
});

describe('optimisticPoll', () => {
  it('moves the count on the tap', () => {
    const next = optimisticPoll(view({ myVotes: [] }), ['b']);
    expect(next.options.find((o) => o.id === 'b')!.voteCount).toBe(2);
    expect(next.myVotes).toEqual(['b']);
  });

  it('counts a new voter once, not once per option', () => {
    const multi = view({ allowMultiple: true, myVotes: [], totalVoters: 3 });
    expect(optimisticPoll(multi, ['a', 'b']).totalVoters).toBe(4);
  });

  it('leaves the voter count alone when someone switches option', () => {
    expect(optimisticPoll(view({ myVotes: ['a'], totalVoters: 3 }), ['b']).totalVoters).toBe(3);
  });

  it('drops the voter when they retract', () => {
    const next = optimisticPoll(view({ myVotes: ['a'], totalVoters: 3 }), []);
    expect(next.totalVoters).toBe(2);
    expect(next.options.find((o) => o.id === 'a')!.voteCount).toBe(1);
    expect(next.myVotes).toEqual([]);
  });

  it('never shows a negative count', () => {
    const empty = view({ myVotes: ['a'], totalVoters: 0, options: [{ id: 'a', text: 'Monday', voteCount: 0 }] });
    expect(optimisticPoll(empty, []).options[0].voteCount).toBe(0);
    expect(optimisticPoll(empty, []).totalVoters).toBe(0);
  });
});

describe('applyPollUpdate', () => {
  it('takes the counts from the broadcast', () => {
    const next = applyPollUpdate(view(), {
      options: [{ id: 'a', voteCount: 7 }, { id: 'b', voteCount: 2 }],
      totalVoters: 9,
      closed: false,
    });
    expect(next.options.map((o) => o.voteCount)).toEqual([7, 2]);
    expect(next.totalVoters).toBe(9);
  });

  it('keeps this device own selection, which a broadcast never carries', () => {
    // The broadcast goes to the whole room; taking myVotes from it would give
    // every viewer the voter's ticks.
    const next = applyPollUpdate(view({ myVotes: ['a'] }), {
      options: [{ id: 'a', voteCount: 7 }],
      totalVoters: 7,
      myVotes: [],
    });
    expect(next.myVotes).toEqual(['a']);
  });

  it('leaves an option the broadcast did not mention alone', () => {
    const next = applyPollUpdate(view(), { options: [{ id: 'a', voteCount: 5 }], totalVoters: 5 });
    expect(next.options.find((o) => o.id === 'b')!.voteCount).toBe(1);
  });

  it('keeps the question and the options text', () => {
    const next = applyPollUpdate(view(), { options: [], totalVoters: 0 });
    expect(next.question).toBe('Which day works?');
    expect(next.options.map((o) => o.text)).toEqual(['Monday', 'Tuesday']);
  });

  it('ignores a broadcast older than what is on screen', () => {
    const shown = view({ rev: 9, totalVoters: 9 });
    expect(applyPollUpdate(shown, { options: [{ id: 'a', voteCount: 1 }], totalVoters: 1, rev: 8 })).toBe(
      shown,
    );
  });

  it('ignores a repeat of the broadcast it already applied', () => {
    const shown = view({ rev: 9 });
    expect(applyPollUpdate(shown, { options: [{ id: 'a', voteCount: 4 }], totalVoters: 4, rev: 9 })).toBe(
      shown,
    );
  });

  it('applies a newer broadcast and moves the revision up with it', () => {
    const next = applyPollUpdate(view({ rev: 9 }), {
      options: [{ id: 'a', voteCount: 4 }],
      totalVoters: 4,
      rev: 10,
    });
    expect(next.options.find((o) => o.id === 'a')!.voteCount).toBe(4);
    expect(next.rev).toBe(10);
  });

  it('still applies a broadcast from a server that sends no revision', () => {
    // Nothing to order by, so this must behave exactly as it did before the
    // counter existed, or the app breaks against an undeployed backend.
    const next = applyPollUpdate(view({ rev: 9 }), { options: [{ id: 'a', voteCount: 4 }], totalVoters: 4 });
    expect(next.options.find((o) => o.id === 'a')!.voteCount).toBe(4);
    expect(next.rev).toBe(9);
  });
});

describe('pollAfterVote', () => {
  it('takes the reply whole when nothing has overtaken it', () => {
    const confirmed = view({ rev: 6, myVotes: ['b'], totalVoters: 4 });
    expect(pollAfterVote(view({ rev: 5 }), confirmed)).toBe(confirmed);
  });

  it('takes the reply when its own broadcast arrived first, at the same revision', () => {
    // This device receives the broadcast of its OWN vote. It carries the same
    // revision and no myVotes, so dropping the reply here would lose the tick.
    const confirmed = view({ rev: 6, myVotes: ['b'] });
    expect(pollAfterVote(view({ rev: 6, myVotes: [] }), confirmed)).toBe(confirmed);
  });

  it('keeps the newer counts but still takes this device own ticks', () => {
    // Two people voted at once: the reply was computed before the other write,
    // whose broadcast is already drawn.
    const onScreen = view({ rev: 7, totalVoters: 9, options: [{ id: 'a', text: 'Monday', voteCount: 8 }] });
    const confirmed = view({ rev: 6, totalVoters: 4, myVotes: ['b'] });

    const next = pollAfterVote(onScreen, confirmed);
    expect(next.totalVoters).toBe(9);
    expect(next.options.find((o) => o.id === 'a')!.voteCount).toBe(8);
    expect(next.myVotes).toEqual(['b']);
  });

  it('takes the reply when there is nothing on screen to order against', () => {
    const confirmed = view({ rev: 3 });
    expect(pollAfterVote(null, confirmed)).toBe(confirmed);
  });
});

describe('messageWithPollUpdate', () => {
  it('writes the update back onto the message', () => {
    const message = { _id: 'm1', poll: serverPoll() };
    const next = messageWithPollUpdate(message, { options: [{ id: 'a', voteCount: 9 }], totalVoters: 9 });
    expect(next.poll.options[0].voteCount).toBe(9);
    expect(next._id).toBe('m1');
  });

  it('leaves an ordinary message untouched', () => {
    const message = { _id: 'm1', text: 'hello' };
    expect(messageWithPollUpdate(message, { options: [], totalVoters: 0 })).toBe(message);
  });
});
