export const SESSION_KEEP_KEYS: ReadonlySet<string> = new Set([
  'app:language',
  'pushDeviceToken',
  'mmkv_migration_v1_done',
  'session:ownerId',
  'accessToken',
  'offline-map-base-packs',

  'offline_lead_work',
  'upload_photo_queue',
  // Annotated photos waiting to be flattened + queued (services/annotationSaveService.ts); owner-stamped.
  'annotation_save_jobs',
  // Remembered ORIGINAL of an annotated order sheet (services/orderSheetAnnotation.ts) - the files live in DocumentDir.
  'order_sheet_originals',

  // Every OWNER-SCOPED queue belongs here. Each already filters by `ownerId` on replay, so
  // keeping it is safe for the next login, and clearing it DESTROYS work the rep did at a door.
  // This is how a held `lead_check_in` was lost: the rep started an appointment offline, came
  // back online, logged out before the drain ran, and the log was wiped, while the `work` PUT
  // survived (its queue WAS listed), so the lead read "Resume" with no check-in behind it.
  'offline_activity_logs',
  'offline_lead_workflow',
  'offline-photo-deletes',
  'offline-map-filters',
  'offline-agreement-delivery',

  // Installer before/after images. Each item carries an `ownerId` (legacy items without one belong
  // to whoever is signed in), and the files live in DocumentDir - clearing this key orphaned them.
  'offline_image_uploads',
]);

export const SESSION_KEEP_PREFIXES: readonly string[] = [
  'persist:',
  // Pending calculator defaults, stored PER OWNER (`offline_calculator_settings:<ownerId>`) so a
  // second rep on the handset can neither see nor flush the first rep's toggle.
  'offline_calculator_settings:',

  // ⚠️ The "this consent is already filed" log. The envelope is owner-stamped, so another rep
  // cannot read it, and clearing it would let the DUPLICATE-SIGNATURE bug back in after any
  // sign-out: the rep would be offered a blank consent form for a lead they had already signed.
  // Unlike the calculator status this is NOT re-derivable offline - keeping it is the fix.
  'offline-cache:consent-filed',
];

export const isSessionScopedKey = (key: string): boolean => {
  if (typeof key !== 'string' || !key) return false;
  if (SESSION_KEEP_KEYS.has(key)) return false;
  return !SESSION_KEEP_PREFIXES.some((p) => key.startsWith(p));
};

export const sessionKeysToClear = (allKeys: readonly string[] | null | undefined): string[] =>
  (allKeys || []).filter(isSessionScopedKey);

export const normalizeOwnerId = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && isFinite(value)) return String(value);
  return '';
};

export const isOwnedBy = (recordOwner: unknown, owner: unknown): boolean => {
  const me = normalizeOwnerId(owner);
  if (!me) return false;
  return normalizeOwnerId(recordOwner) === me;
};
