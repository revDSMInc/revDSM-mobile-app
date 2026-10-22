/**
 * Annotated appointment photos in the Messages picker (REVUIUX-563).
 *
 * "Messages - appt photos - the annotated ones should be clear they're annotated."
 *
 * An annotated photo is a derived copy the rep drew on top of, stored under the original's
 * subcategory with an "(Annotated)" suffix. In the picker it sits next to the clean shot it
 * came from, so the two tiles are otherwise IDENTICAL - same slot name, near-identical
 * thumbnail at grid size. The rep could not tell which one they were about to send.
 *
 * ⚠️ These were briefly FILTERED OUT of the picker instead. That is not what the ticket
 * asks for, and it removes a photo reps legitimately want to send - the annotation is usually
 * the whole point of sending it. Mark them; do not hide them.
 *
 * Kept pure (no React Native imports) so it can be tested - see CLAUDE.md §6.
 */

const ANNOTATED_RE = /\(annotated\)/i;

/** A derived copy drawn on top of another shot (`"<slot> (Annotated)"`). */
export const isAnnotatedSalesPhoto = (
  photo: { subcategory?: string | null } | null | undefined
): boolean => ANNOTATED_RE.test(String(photo?.subcategory ?? ''));

/**
 * The label SENT with the photo, which `ChatMessageBubble.getPhotoLabel` prints under it for
 * everyone in the thread.
 *
 * ⚠️ The grid tile shows the bare slot name ('Front') because the badge beside it already
 * says "annotated". A recipient has no badge - the text is all they get - so the suffix is kept
 * here. The two are deliberately different; don't "tidy" them into one.
 */
export const appointmentPhotoSendLabel = (
  photo: { subcategory?: string | null } | null | undefined,
  resolvedLabel: string
): string => {
  const base = String(resolvedLabel || '').trim();
  if (!isAnnotatedSalesPhoto(photo)) return base;
  if (ANNOTATED_RE.test(base)) return base; // already carries it; don't double it up
  return base ? `${base} (Annotated)` : 'Annotated';
};
