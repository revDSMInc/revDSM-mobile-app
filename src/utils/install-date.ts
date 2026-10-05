/**
 * install-date.ts — the Approximate Start Date as it is printed on the agreement.
 *
 * One rule, one place, because two surfaces read the same value and disagreeing about it puts a
 * different start date on the copy the rep sees and the copy the customer signs:
 * `DynamicAgreementDialog` (which formats it into the payment block, for the server template AND
 * for the offline device-rendered document) and `blocks/PricingTableBlock` (which draws the cell).
 *
 * ⚠️ `new Date(string)` IS THE BUG THIS FILE EXISTS TO PREVENT, and it bit twice.
 *
 * The value arriving here is `jobState.scheduleTime.date`, which `AppointmentSchedulerModal` writes
 * as `format(selectedDate, 'M/d/yyyy')` — `9/11/2026` — or the literal `'TBD'`. Two things then go
 * wrong if it is round-tripped through a Date:
 *
 *   1. **The app runs on Hermes, not V8.** Hermes implements the ES Date Time String Format (ISO
 *      8601) plus the shapes `Date.prototype.toString()` emits; a slash-separated `9/11/2026` is
 *      none of those, so `new Date('9/11/2026')` is **Invalid Date** — while the same expression in
 *      Node, in a browser, and in any test runner parses it perfectly. That is why the agreement
 *      printed **TBD** on a job the rep had just scheduled, and why it looked fine everywhere the
 *      code was read.
 *   2. **An ISO string carries an offset**, so building a local Date from it can move the calendar
 *      day either side of midnight — the rule `utils/job-change-summary.ts` already records. This
 *      is a date on a document being signed; it does not get to drift by a day.
 *
 * So a value that is ALREADY a US date is reformatted as text and never parsed, and an ISO string
 * is read by its `YYYY-MM-DD` prefix. `new Date` survives only as the last resort for a shape we
 * did not anticipate, where returning `TBD` outright would be worse.
 */

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

const pad = (n: string | number): string => String(n).padStart(2, '0');

/** The literal the whole app uses for a job with no date yet. */
export const INSTALL_DATE_TBD = 'TBD';

/**
 * `MM/DD/YYYY`, or `'TBD'`.
 *
 * ⚠️ Never returns `'Invalid Date'`. It used to: `PricingTableBlock` printed exactly that on an
 * unscheduled job, and the `|| 'TBD'` at its call site could not catch it, because
 * `"Invalid Date"` is a perfectly truthy string.
 */
export const formatInstallDate = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === '') return INSTALL_DATE_TBD;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return INSTALL_DATE_TBD;
    return `${pad(raw.getMonth() + 1)}/${pad(raw.getDate())}/${raw.getFullYear()}`;
  }

  const text = String(raw).trim();
  if (!text || text.toUpperCase() === INSTALL_DATE_TBD) return INSTALL_DATE_TBD;

  const us = US_DATE.exec(text);
  if (us) return `${pad(us[1])}/${pad(us[2])}/${us[3]}`;

  const iso = ISO_DATE.exec(text);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  // Something we have not seen. Parsing is a guess, but a wrong-looking date the rep can spot
  // beats a silent TBD on a job that is scheduled.
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return INSTALL_DATE_TBD;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
};
