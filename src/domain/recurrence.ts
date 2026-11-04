import { addDays, addMonths, addYears, format, parseISO } from 'date-fns';
import type { Recurrence } from '@/data/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function describeRecurrence(r: Recurrence): string {
  const n = r.interval ?? 1;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (r.freq === 'weekly' && r.byweekday?.length) text += ` on ${r.byweekday.map((d) => DAYS[d].slice(0, 3)).join(', ')}`;
  if (r.until) text += ` until ${format(parseISO(r.until), 'd MMM yyyy')}`;
  return text;
}

/**
 * Next occurrence after `from` (YYYY-MM-DD). Mirrors public.next_occurrence()
 * in the database so previews match what the server creates.
 */
export function nextOccurrence(from: string, r: Recurrence): string | null {
  const d = parseISO(from);
  const n = Math.max(1, r.interval ?? 1);
  let next: Date;
  if (r.freq === 'daily') next = addDays(d, n);
  else if (r.freq === 'monthly') next = addMonths(d, n);
  else if (r.freq === 'yearly') next = addYears(d, n);
  else {
    const days = [...(r.byweekday ?? [])].sort((a, b) => a - b);
    const dow = (d.getDay() + 6) % 7; // 0 = Monday
    if (!days.length) next = addDays(d, 7 * n);
    else {
      const later = days.find((x) => x > dow);
      if (later !== undefined) next = addDays(d, later - dow);
      else next = addDays(addDays(d, -dow), 7 * n + days[0]);
    }
  }
  const iso = format(next, 'yyyy-MM-dd');
  if (r.until && iso > r.until) return null;
  return iso;
}
