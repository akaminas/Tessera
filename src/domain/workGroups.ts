import { addDays, endOfWeek, format } from 'date-fns';

export type WorkBucket = 'overdue' | 'today' | 'week' | 'later' | 'nodate' | 'done';

export const BUCKET_LABEL: Record<WorkBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'Next 7 days',
  later: 'Later',
  nodate: 'No due date',
  done: 'Completed',
};

/** Group work items by due date relative to today (completed separately). */
export function bucketOf(item: { due_date: string | null; status: string }, today: Date = new Date()): WorkBucket {
  if (item.status === 'done') return 'done';
  if (!item.due_date) return 'nodate';
  const t = format(today, 'yyyy-MM-dd');
  if (item.due_date < t) return 'overdue';
  if (item.due_date === t) return 'today';
  if (item.due_date <= format(addDays(today, 7), 'yyyy-MM-dd')) return 'week';
  return 'later';
}

export function groupWork<T extends { due_date: string | null; status: string; priority?: string }>(items: T[], today: Date = new Date()) {
  const order: WorkBucket[] = ['overdue', 'today', 'week', 'later', 'nodate', 'done'];
  const map = new Map<WorkBucket, T[]>(order.map((b) => [b, []]));
  for (const it of items) map.get(bucketOf(it, today))!.push(it);
  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
  for (const [, list] of map)
    list.sort((a, b) => (a.due_date ?? '9999') .localeCompare(b.due_date ?? '9999') || (rank[a.priority ?? 'none'] - rank[b.priority ?? 'none']));
  return order.map((b) => ({ bucket: b, items: map.get(b)! })).filter((g) => g.items.length > 0);
}

export function endOfThisWeek(today: Date = new Date()) {
  return format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}
