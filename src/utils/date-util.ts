import { parseISO, isValid } from 'date-fns';

export function parseSafeISO(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date(NaN);
  
  const parsedISO = parseISO(dateStr);
  if (isValid(parsedISO)) return parsedISO;

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

  const nativeDate = new Date(dateStr);
  return nativeDate;
}
