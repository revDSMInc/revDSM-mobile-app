export const SESSION_KEEP_KEYS: ReadonlySet<string> = new Set([
  'app:language',
  'pushDeviceToken',
  'mmkv_migration_v1_done',
  'session:ownerId',
  'accessToken',
  'offline-map-base-packs',

  'offline_lead_work',
  'upload_photo_queue',
]);

export const SESSION_KEEP_PREFIXES: readonly string[] = [
  'persist:',
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
