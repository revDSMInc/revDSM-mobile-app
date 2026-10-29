import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  emptyPollDraft,
  filledPollOptions,
  pollDraftError,
} from '../../src/utils/poll-draft';

// REVUIUX-577: the Create-poll sheet's rules. The server re-checks every one of
// them (POLL_QUESTION_INVALID / POLL_OPTIONS_INVALID / POLL_OPTIONS_DUPLICATE in
// docs/team-channel-polls-backend.md), so these numbers have to stay in step --
// a draft the sheet accepts and the server refuses is a dead Send button.

describe('emptyPollDraft', () => {
  it('starts with two blank rows and a single answer', () => {
    const draft = emptyPollDraft();
    expect(draft.options).toHaveLength(POLL_MIN_OPTIONS);
    expect(draft.question).toBe('');
    expect(draft.allowMultiple).toBe(false);
  });

  it('is a fresh object each time, so closing the sheet cannot mutate the next draft', () => {
    const first = emptyPollDraft();
    first.options[0] = 'Monday';
    expect(emptyPollDraft().options[0]).toBe('');
  });
});

describe('filledPollOptions', () => {
  it('trims and drops the blank placeholder rows', () => {
    expect(filledPollOptions([' Monday ', '', '   ', 'Tuesday'])).toEqual(['Monday', 'Tuesday']);
  });

  it('is empty for an untouched draft', () => {
    expect(filledPollOptions(emptyPollDraft().options)).toEqual([]);
  });
});

describe('pollDraftError', () => {
  const draft = (over: Partial<ReturnType<typeof emptyPollDraft>> = {}) => ({
    ...emptyPollDraft(),
    ...over,
  });

  it('accepts a complete draft', () => {
    expect(pollDraftError(draft({ question: 'Which day?', options: ['Monday', 'Tuesday'] }))).toBeNull();
  });

  it('asks for a question first', () => {
    expect(pollDraftError(draft({ question: '   ', options: ['Monday', 'Tuesday'] }))).toMatch(/question/i);
  });

  it('asks for enough options, counting only the filled rows', () => {
    expect(pollDraftError(draft({ question: 'Q', options: ['Monday', '  '] }))).toMatch(
      new RegExp(`${POLL_MIN_OPTIONS} options`),
    );
  });

  it('refuses duplicates regardless of case or padding', () => {
    // The server answers POLL_OPTIONS_DUPLICATE for the same thing, so catching
    // it here only saves the round trip.
    expect(pollDraftError(draft({ question: 'Q', options: ['Monday', ' monday '] }))).toMatch(
      /different/i,
    );
  });

  it('accepts the maximum number of options', () => {
    const options = Array.from({ length: POLL_MAX_OPTIONS }, (_, i) => `Option ${i + 1}`);
    expect(pollDraftError(draft({ question: 'Q', options }))).toBeNull();
  });
});
