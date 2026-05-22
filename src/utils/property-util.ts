/**
 * Normalize property API responses to a single property record.
 * The /property/v1/properties endpoint returns an array of matches (web parity).
 */
export function normalizePropertyResponse(data: unknown): Record<string, any> | null {
  if (data == null) return null;

  if (Array.isArray(data)) {
    return (data[0] as Record<string, any>) ?? null;
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, any>;
    if (Array.isArray(obj.data)) {
      return (obj.data[0] as Record<string, any>) ?? null;
    }
    if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      return obj.data as Record<string, any>;
    }
    return obj;
  }

  return null;
}
