/**
 * Shrink an axios request/response body to something safe to `console.log`.
 *
 * ⚠️ PERFORMANCE, not tidiness. Document uploads carry a multi-MB base64 PDF in the
 * request body, the document-download responses carry `base64Data` per row, and the
 * My Deals list response embeds every deal's signed agreements as `data:` URIs —
 * a real one measured **31 MB for 12 deals, 99 % of it base64**. Logging that costs
 * three multi-MB operations on the JS thread (serialize, allocate, and — with React
 * Native DevTools attached — push the whole string across the CDP websocket), which
 * is seconds per call. Only `.length` is read here, so the big strings are never
 * copied or scanned.
 *
 * Lives in `utils/` rather than beside the axios instance so it is testable: importing
 * `services/api/index.ts` pulls in MMKV and fails under jest. It was inline there when
 * the depth bug below shipped, and that is exactly why it is out here now.
 */

export const LOG_MAX_STRING = 512;
export const LOG_MAX_ARRAY = 20;
export const LOG_MAX_DEPTH = 6;

export const sanitizeForLog = (value: any, depth = 0): any => {
  if (typeof value === 'string') {
    return value.length > LOG_MAX_STRING ? `<string ${value.length} chars>` : value;
  }
  if (!value || typeof value !== 'object') return value;
  // ⚠️ The depth cutoff MUST return a placeholder, never the subtree itself.
  // Returning `value` here handed the whole remaining branch to `console.log`
  // unvisited — and the payloads this function exists to tame keep their weight
  // BELOW depth 6 (`data.leads[i].jobBuilder.dynamicJobState.agreements[0].files[0].blob`),
  // so every base64 document survived it. Measured on a real My Deals response:
  // 31.14 MB in → 31.14 MB out, a 0 % reduction. With the placeholder: 83 kB.
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
