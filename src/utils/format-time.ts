import { format } from 'date-fns';

export function fDate(date: any, newFormat?: string) {
  const fm = newFormat || 'MM/dd/yyyy';
  return date ? format(new Date(date), fm) : '';
}

export function fDateTime(date: any, newFormat?: string) {
  const fm = newFormat || 'dd MMM yyyy p';
  return date ? format(new Date(date), fm) : '';
}

export const formatTime = (date: any, leadTime?: string) => {
  if (leadTime && typeof leadTime === 'string') {
    const timeStr = leadTime.toLowerCase().trim();
    const isPM = timeStr.includes('pm');
    const timeMatch = timeStr.match(/(\d+)/);

    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = 0;
      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;

      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
      return `${displayHours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')} ${period}`;
    }
  }

  if (!date) return 'N/A';
  try {
    return format(new Date(date), 'hh:mm a');
  } catch (error) {
    return 'N/A';
  }
};
