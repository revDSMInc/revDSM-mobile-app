// Draft rules for the team-channel "Create poll" sheet. Pure so they can be tested under jest.
// The numbers mirror the server's limits in docs/team-channel-polls-backend.md - change both
// together, or the sheet accepts a draft the server then refuses and Send is a dead button.

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 5;
export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 100;

export interface PollDraft {
  question: string;
  options: string[];
  allowMultiple: boolean;
}

export const emptyPollDraft = (): PollDraft => ({ question: '', options: ['', ''], allowMultiple: false });

/** Trimmed, non-empty options. */
export const filledPollOptions = (options: string[]): string[] =>
  options.map((o) => o.trim()).filter(Boolean);

/** A reason the draft cannot be sent, or null when it is valid. */
export const pollDraftError = (draft: PollDraft): string | null => {
  if (!draft.question.trim()) return 'Add a question.';
  const filled = filledPollOptions(draft.options);
  if (filled.length < POLL_MIN_OPTIONS) return `Add at least ${POLL_MIN_OPTIONS} options.`;
  const lower = filled.map((o) => o.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Options must be different from each other.';
  return null;
};
