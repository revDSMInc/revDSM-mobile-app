export const LOG_MAX_STRING = 512;
export const LOG_MAX_ARRAY = 20;
export const LOG_MAX_DEPTH = 6;

export const sanitizeForLog = (value: any, depth = 0): any => {
  if (typeof value === 'string') {
    return value.length > LOG_MAX_STRING ? `<string ${value.length} chars>` : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (depth >= LOG_MAX_DEPTH) {
    return Array.isArray(value) ? `<array ${value.length}>` : '<object>';
  }
  if (Array.isArray(value)) {
    const head = value.slice(0, LOG_MAX_ARRAY).map((v) => sanitizeForLog(v, depth + 1));
    return value.length > LOG_MAX_ARRAY
      ? [...head, `…+${value.length - LOG_MAX_ARRAY} more`]
      : head;
  }
  const out: Record<string, any> = {};
  Object.keys(value).forEach((k) => {
    out[k] = sanitizeForLog(value[k], depth + 1);
  });
  return out;
};
