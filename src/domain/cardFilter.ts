import { addDays, endOfMonth, endOfWeek, format } from 'date-fns';
import type { CardStatus, Priority } from '@/data/types';

export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'month' | 'none' | 'has';

export interface CardFilter {
  text?: string;
  /** user ids; 'me' = current user; 'none' = unassigned */
  assignees?: string[];
  labels?: string[];
  due?: DueFilter;
  status?: CardStatus[];
  priority?: Priority[];
  workPackages?: string[];
  /** include completed tasks (default true on boards) */
  showDone?: boolean;
  match?: 'all' | 'any';
}

export interface FilterableCard {
  title: string;
  description?: string;
  status: CardStatus;
  priority: Priority;
  due_date: string | null;
  work_package_id?: string | null;
  card_assignees: { user_id: string }[];
  card_labels: { label_id: string }[];
}

export function isFilterActive(f: CardFilter): boolean {
  return Boolean(
    f.text?.trim() ||
      f.assignees?.length ||
      f.labels?.length ||
      (f.due && f.due !== 'any') ||
      f.status?.length ||
      f.priority?.length ||
      f.workPackages?.length ||
      f.showDone === false,
  );
}

function dueMatches(due: string | null, mode: DueFilter, today: Date, done: boolean): boolean {
  const t = format(today, 'yyyy-MM-dd');
  switch (mode) {
    case 'any':
      return true;
    case 'none':
      return !due;
    case 'has':
      return Boolean(due);
    case 'overdue':
      return Boolean(due) && due! < t && !done;
    case 'today':
      return due === t;
    case 'week':
      return Boolean(due) && due! >= t && due! <= format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    case 'month':
      return Boolean(due) && due! >= t && due! <= format(endOfMonth(today), 'yyyy-MM-dd');
  }
}

/** Apply a filter. Facets combine with AND; values within a facet with OR (or AND when match = 'all'). */
export function matchesFilter(card: FilterableCard, f: CardFilter, me: string, today: Date = new Date()): boolean {
  if (f.showDone === false && card.status === 'done') return false;
  const text = f.text?.trim().toLowerCase();
  if (text) {
    const hay = `${card.title} ${card.description ?? ''}`.toLowerCase();
    if (!text.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (f.assignees?.length) {
    const ids = card.card_assignees.map((a) => a.user_id);
    const wanted = f.assignees.map((a) => (a === 'me' ? me : a));
    const test = (w: string) => (w === 'none' ? ids.length === 0 : ids.includes(w));
    if (!(f.match === 'all' ? wanted.every(test) : wanted.some(test))) return false;
  }
  if (f.labels?.length) {
    const ids = card.card_labels.map((l) => l.label_id);
    const test = (w: string) => (w === 'none' ? ids.length === 0 : ids.includes(w));
    if (!(f.match === 'all' ? f.labels.every(test) : f.labels.some(test))) return false;
  }
  if (f.due && f.due !== 'any' && !dueMatches(card.due_date, f.due, today, card.status === 'done')) return false;
  if (f.status?.length && !f.status.includes(card.status)) return false;
  if (f.priority?.length && !f.priority.includes(card.priority)) return false;
  if (f.workPackages?.length) {
    const wp = card.work_package_id ?? 'none';
    if (!f.workPackages.includes(wp)) return false;
  }
  return true;
}

export type DueState = 'done' | 'overdue' | 'today' | 'soon' | 'later' | 'none';

/** Classify a due date for display. "soon" = within the next 2 days. */
export function dueState(due: string | null, status: CardStatus, today: Date = new Date()): DueState {
  if (!due) return 'none';
  if (status === 'done') return 'done';
  const t = format(today, 'yyyy-MM-dd');
  if (due < t) return 'overdue';
  if (due === t) return 'today';
  if (due <= format(addDays(today, 2), 'yyyy-MM-dd')) return 'soon';
  return 'later';
}

export type SortKey = 'manual' | 'due' | 'priority' | 'title' | 'created' | 'updated' | 'status';
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const STATUS_RANK: Record<CardStatus, number> = { blocked: 0, in_progress: 1, open: 2, done: 3 };

export function sortCards<T extends FilterableCard & { position?: string; created_at?: string; updated_at?: string }>(
  cards: T[],
  key: SortKey,
  dir: 'asc' | 'desc' = 'asc',
): T[] {
  const m = dir === 'asc' ? 1 : -1;
  const cmp = (a: T, b: T): number => {
    switch (key) {
      case 'manual':
        return (a.position ?? '') < (b.position ?? '') ? -1 : (a.position ?? '') > (b.position ?? '') ? 1 : 0;
      case 'due':
        if (a.due_date === b.due_date) return 0;
        if (!a.due_date) return 1 * m; // undated last regardless of direction
        if (!b.due_date) return -1 * m;
        return a.due_date < b.due_date ? -1 : 1;
      case 'priority':
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      case 'status':
        return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      case 'title':
        return a.title.localeCompare(b.title);
      case 'created':
        return (a.created_at ?? '').localeCompare(b.created_at ?? '');
      case 'updated':
        return (a.updated_at ?? '').localeCompare(b.updated_at ?? '');
    }
  };
  return [...cards].sort((a, b) => cmp(a, b) * m);
}
