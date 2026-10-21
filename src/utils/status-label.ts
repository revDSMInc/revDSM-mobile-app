/**
 * A lead status the app has no hand-written label for is shown from its raw value ("bank decline", "not_interested").
 * Capitalise every word so it reads "Bank Decline", never "bank decline". Known labels are untouched.
 */
export const titleCaseStatus = (raw?: string | null): string =>
  String(raw ?? '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)([a-z])/g, (_m, space, ch) => `${space}${ch.toUpperCase()}`);
