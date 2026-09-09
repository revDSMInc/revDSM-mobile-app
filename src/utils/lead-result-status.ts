/**
 * Has this lead already been RESULTED?
 *
 * Pure and react-native-free, for the reason `utils/push-routing.ts` is: the two
 * places that ask — the Notification Center row and the push banner's tap — are
 * both untestable under jest here, and they MUST answer identically. A row and
 * the banner that raised it landing on different screens is the exact failure the
 * shared routing module exists to prevent.
 */

/**
 * ⚠️ An ALLOWLIST of resulted statuses, not the `NON_RESULTED_STATUSES`
 * deny-list that `widgets/components/LeadCard.tsx` and `screens/DealDetail` use
 * (`['lfLead', 'selfGenerated', 'scheduled']`, web parity with `job-card.js`).
 *
 * The two are not interchangeable HERE. A deny-list reads a MISSING or unknown
 * status as "resulted" — and this rule now changes where a notification lands, so
 * that default would silently divert every status-less lead away from the Job
 * Builder. An allowlist fails the other way: anything unrecognised keeps the
 * behaviour the app already shipped.
 *
 * The values are `JobDocsSection.isResulted`'s (the Lead Center's own test), so
 * the screen this sends the rep to agrees about why they are there.
 */
const RESULTED_STATUSES: ReadonlySet<string> = new Set([
  'sale',
  'demo',
  'demonosale',
  'nodemo',
  'nothit',
  'nothome',
  'reset',
  'rescheduled',
  // Both spellings: the lead's own result is the double-l one, but the funding
  // backend already sends the single-l form for its terminal states.
  'cancelled',
  'canceled',
]);

/**
 * ⚠️ A FIXED key list, the discipline `readDocumentGroup` sets. `status` is what
 * the lead record actually carries (`"sale"` in the captured payload); the rest
 * are read because the outcome-shaped responses in this app spell it differently,
 * and an unrecognised shape must yield `false` rather than a guess.
 */
const STATUS_KEYS = ['status', 'result', 'resultStatus', 'leadStatus'];

/** Lower-cased with punctuation and spacing dropped: `Demo No Sale` → `demonosale`. */
export function normalizeResultStatus(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z]/g, '') : '';
}

export function isLeadResulted(lead: Record<string, any> | null | undefined): boolean {
  if (!lead || typeof lead !== 'object') return false;
  return STATUS_KEYS.some((key) => RESULTED_STATUSES.has(normalizeResultStatus(lead[key])));
}
