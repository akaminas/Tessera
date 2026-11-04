import { addDays, format } from 'date-fns';
import type { Priority } from '@/data/types';

export interface QuickParse {
  title: string;
  due_date: string | null;
  priority: Priority;
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PRIORITIES: Record<string, Priority> = {
  '!low': 'low',
  '!med': 'medium',
  '!medium': 'medium',
  '!high': 'high',
  '!urgent': 'urgent',
  '!!': 'high',
  '!!!': 'urgent',
};

/**
 * Parse shorthand at the end of a quick-add title:
 *   "Send report fri !high"   → due next Friday, high priority
 *   "Call Maria tomorrow"     → due tomorrow
 *   "Renew licence 2027-01-15"
 * Only trailing tokens are interpreted, so ordinary words inside a title are kept.
 */
export function parseQuickAdd(input: string, today: Date = new Date()): QuickParse {
  const tokens = input.trim().split(/\s+/);
  let due: string | null = null;
  let priority: Priority = 'none';
  while (tokens.length > 1) {
    const raw = tokens[tokens.length - 1];
    const t = raw.toLowerCase();
    if (priority === 'none' && PRIORITIES[t]) {
      priority = PRIORITIES[t];
    } else if (!due && (t === 'today' || t === 'tod')) {
      due = format(today, 'yyyy-MM-dd');
    } else if (!due && (t === 'tomorrow' || t === 'tmr' || t === 'tom')) {
      due = format(addDays(today, 1), 'yyyy-MM-dd');
    } else if (!due && WEEKDAYS.includes(t.slice(0, 3)) && /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/.test(t)) {
      const target = WEEKDAYS.indexOf(t.slice(0, 3)); // 0 = Monday
      const current = (today.getDay() + 6) % 7;
      let diff = (target - current + 7) % 7;
      if (diff === 0) diff = 7;
      due = format(addDays(today, diff), 'yyyy-MM-dd');
    } else if (!due && /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t))) {
      due = t;
    } else if (!due && /^\+\d{1,3}d$/.test(t)) {
      due = format(addDays(today, parseInt(t.slice(1), 10)), 'yyyy-MM-dd');
    } else {
      break;
    }
    tokens.pop();
  }
  return { title: tokens.join(' '), due_date: due, priority };
}
