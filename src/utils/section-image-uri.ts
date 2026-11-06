/**
 * Resolving the URI a Lead Center section image is DISPLAYED and DOWNLOADED from.
 *
 * ⚠️ THE BUG. `useLeadCenterData`'s secure-url effect rebuilt every section image as
 * `uri: secured?.secureUrl || resolveS3Url(photo.s3url)`. `resolveS3Url(undefined)` returns `''`,
 * so a photo that has not uploaded yet - no `s3url`, only a local `file://` uri - was rebuilt with
 * EVERY identifying field blank.
 *
 * That is what produced, after going online while staying on the screen:
 *   - "Manage Photos (0)" beside a Lead Center button reading (3);
 *   - "There are no photos to download" - the handler tests `img.uri || img.s3url`, and both were
 *     falsy;
 *   - an empty grid, because there was no uri to render.
 *
 * The effect's `else` branch deliberately PRESERVES device-only photos, but the `if` branch above
 * it runs whenever the server list is non-empty and overwrote them - the two halves of one effect
 * disagreeing about whether a local photo counts.
 *
 * The rule: prefer the secure URL, then the resolved S3 URL, and fall back to the photo's OWN
 * local uri. The local file is on disk and renders fine.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

export interface SectionPhotoLike {
  s3url?: string | null;
  uri?: string | null;
  [key: string]: unknown;
}

/**
 * The display uri for one photo.
 *
 * @param secureUrl the secure URL the API returned for this photo, if any
 * @param resolvedS3 the result of `resolveS3Url(photo.s3url)` - `''` when there is no `s3url`
 * @param photo the photo record itself, which may carry a local `uri`
 */
export const sectionImageUri = (
  secureUrl: string | null | undefined,
  resolvedS3: string | null | undefined,
  photo: SectionPhotoLike | null | undefined
): string => String(secureUrl || resolvedS3 || photo?.uri || '');

/** A photo is only worth asking the secure-url API about when it is actually on S3. */
export const needsSecureUrl = (
  photo: SectionPhotoLike | null | undefined,
  alreadyHave: ReadonlySet<string>
): boolean => !!photo?.s3url && !alreadyHave.has(photo.s3url);

/** Does this record have anything a grid can draw or a download can fetch? */
export const isDisplayable = (photo: SectionPhotoLike | null | undefined): boolean =>
  !!(photo?.uri || photo?.s3url);
