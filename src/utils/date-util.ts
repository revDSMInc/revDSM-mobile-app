import { parseISO, isValid } from 'date-fns';

/**
 * Robust date parser that handles ISO strings, slash-formatted dates (M/D/YYYY),
 * and standard date parsing safely across all JS runtimes (including Hermes).
 */
export function parseSafeISO(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date(NaN);
  
  // Try parsing as ISO first (standard date-fns method)
  const parsedISO = parseISO(dateStr);
  if (isValid(parsedISO)) return parsedISO;

  // Check for M/D/YYYY or MM/DD/YYYY formats
  if (typeof dateStr === 'string' && dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const month = parseInt(parts[0], 10) - 1;
      const day = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
        const customDate = new Date(year, month, day);
        if (isValid(customDate)) return customDate;
      }
    }
  }

  // Fallback to native Date constructor
  const nativeDate = new Date(dateStr);
  return nativeDate;
}
