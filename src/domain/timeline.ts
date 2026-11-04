import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from 'date-fns';
import type { MonthSchedule } from '@/data/types';

const ISO = 'yyyy-MM-dd';
export const iso = (d: Date) => format(d, ISO);
const d = (s: string) => parseISO(s);

/* ============================================================ Project months */

/** First day of project month m (1-based). Mirrors SQL project_month_start(). */
export function monthStart(projectStart: string, m: number): string {
  return iso(addMonths(d(projectStart), m - 1));
}

/** Last day of project month m. Mirrors SQL project_month_end(). */
export function monthEnd(projectStart: string, m: number): string {
  return iso(addDays(addMonths(d(projectStart), m), -1));
}

/** Project month containing `date` (1-based), or null before the start. */
export function monthOf(projectStart: string, date: string): number | null {
  if (date < projectStart) return null;
  let m = differenceInCalendarMonths(d(date), d(projectStart)) + 1;
  while (m > 1 && date < monthStart(projectStart, m)) m--;
  while (date > monthEnd(projectStart, m)) m++;
  return m;
}

/** Number of project months spanned by [start, end]. */
export function monthCount(projectStart: string, projectEnd: string): number {
  return Math.max(1, monthOf(projectStart, projectEnd) ?? 1);
}

export interface MonthColumn {
  index: number;
  label: string;
  start: string;
  end: string;
  calendarLabel: string;
}

export function monthColumns(projectStart: string, count: number): MonthColumn[] {
  return Array.from({ length: count }, (_, i) => {
    const s = monthStart(projectStart, i + 1);
    return { index: i + 1, label: `M${i + 1}`, start: s, end: monthEnd(projectStart, i + 1), calendarLabel: format(d(s), 'MMM yy') };
  });
}

/* ======================================================= Month schedule cells */

export type CellState = 'planned' | 'due' | 'done' | null;
const CYCLE: CellState[] = [null, 'planned', 'due', 'done'];

/** State shown for month m: done wins over due, due over planned. */
export function cellState(s: MonthSchedule | null | undefined, m: number): CellState {
  if (!s) return null;
  if (s.done?.includes(m)) return 'done';
  if (s.due?.includes(m)) return 'due';
  if (s.planned?.includes(m)) return 'planned';
  return null;
}

/** Click a cell: none → planned → due → done → none. Returns null if the schedule becomes empty. */
export function cycleCell(s: MonthSchedule | null | undefined, m: number): MonthSchedule | null {
  const current = cellState(s, m);
  const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
  return setCell(s, m, next);
}

export function setCell(s: MonthSchedule | null | undefined, m: number, state: CellState): MonthSchedule | null {
  const strip = (a?: number[]) => (a ?? []).filter((x) => x !== m);
  const out: MonthSchedule = { planned: strip(s?.planned), due: strip(s?.due), done: strip(s?.done) };
  if (state) out[state] = [...out[state]!, m].sort((a, b) => a - b);
  const clean: MonthSchedule = {};
  if (out.planned!.length) clean.planned = out.planned;
  if (out.due!.length) clean.due = out.due;
  if (out.done!.length) clean.done = out.done;
  return Object.keys(clean).length ? clean : null;
}

/** Months mentioned in a schedule, and how many of them are done. */
export function scheduleProgress(s: MonthSchedule | null | undefined): { months: number; done: number } {
  if (!s) return { months: 0, done: 0 };
  const all = new Set([...(s.planned ?? []), ...(s.due ?? []), ...(s.done ?? [])]);
  return { months: all.size, done: new Set(s.done ?? []).size };
}

/** Date range covered by a schedule (first month start → last month end). */
export function scheduleRange(projectStart: string, s: MonthSchedule | null | undefined): { start: string; end: string } | null {
  if (!s) return null;
  const all = [...(s.planned ?? []), ...(s.due ?? []), ...(s.done ?? [])];
  if (!all.length) return null;
  return { start: monthStart(projectStart, Math.min(...all)), end: monthEnd(projectStart, Math.max(...all)) };
}

/* ================================================================== Scales */

export type Zoom = 'weeks' | 'months' | 'quarters';
export const DAY_WIDTH: Record<Zoom, number> = { weeks: 24, months: 5, quarters: 1.8 };

export interface DateScale {
  origin: string;
  days: number;
  dayWidth: number;
  width: number;
  x(date: string): number;
  /** date at pixel x (floored to a day) */
  dateAt(x: number): string;
}

/** Linear day scale starting at `from` (inclusive) to `to` (inclusive). */
export function dateScale(from: string, to: string, dayWidth: number): DateScale {
  const days = Math.max(1, differenceInCalendarDays(d(to), d(from)) + 1);
  return {
    origin: from,
    days,
    dayWidth,
    width: days * dayWidth,
    x: (date) => differenceInCalendarDays(d(date), d(from)) * dayWidth,
    dateAt: (x) => iso(addDays(d(from), Math.floor(x / dayWidth))),
  };
}

/** Align a range outward to the zoom's natural boundaries. */
export function alignRange(from: string, to: string, zoom: Zoom): { from: string; to: string } {
  const start = zoom === 'weeks' ? startOfWeek(d(from), { weekStartsOn: 1 }) : zoom === 'months' ? startOfMonth(d(from)) : startOfQuarter(d(from));
  const endBase = zoom === 'weeks' ? addDays(startOfWeek(d(to), { weekStartsOn: 1 }), 6) : zoom === 'months' ? addDays(addMonths(startOfMonth(d(to)), 1), -1) : addDays(addMonths(startOfQuarter(d(to)), 3), -1);
  return { from: iso(start), to: iso(endBase) };
}

export interface HeaderCell {
  label: string;
  start: string;
  end: string;
}

/** Column headers for a calendar-mode zoom. */
export function headerCells(from: string, to: string, zoom: Zoom): HeaderCell[] {
  const out: HeaderCell[] = [];
  let cur = d(from);
  const last = d(to);
  while (cur <= last) {
    let next: Date;
    let label: string;
    if (zoom === 'weeks') {
      next = addDays(cur, 7);
      label = format(cur, 'd MMM');
    } else if (zoom === 'months') {
      next = addMonths(cur, 1);
      label = format(cur, 'MMM yyyy');
    } else {
      next = addMonths(cur, 3);
      label = `Q${Math.floor(cur.getMonth() / 3) + 1} ${format(cur, 'yyyy')}`;
    }
    out.push({ label, start: iso(cur), end: iso(addDays(next, -1)) });
    cur = next;
  }
  return out;
}

/**
 * Month-column scale: each project month occupies `colWidth` pixels; dates
 * map proportionally within their month. Used in project-month mode.
 */
export function monthScale(projectStart: string, count: number, colWidth: number): DateScale {
  const end = monthEnd(projectStart, count);
  const x = (date: string) => {
    if (date < projectStart) return 0;
    const m = monthOf(projectStart, date)!;
    if (m > count) return count * colWidth;
    const s = monthStart(projectStart, m);
    const len = differenceInCalendarDays(d(monthEnd(projectStart, m)), d(s)) + 1;
    return (m - 1) * colWidth + (differenceInCalendarDays(d(date), d(s)) / len) * colWidth;
  };
  return {
    origin: projectStart,
    days: differenceInCalendarDays(d(end), d(projectStart)) + 1,
    dayWidth: colWidth / 30.44,
    width: count * colWidth,
    x,
    dateAt: (px) => {
      const m = Math.min(count, Math.max(1, Math.floor(px / colWidth) + 1));
      const s = monthStart(projectStart, m);
      const len = differenceInCalendarDays(d(monthEnd(projectStart, m)), d(s)) + 1;
      const frac = Math.max(0, Math.min(0.9999, (px - (m - 1) * colWidth) / colWidth));
      return iso(addDays(d(s), Math.floor(frac * len)));
    },
  };
}

/* =========================================================== Bar dragging */

export type DragMode = 'move' | 'start' | 'end';

/**
 * Apply a drag of `deltaDays` to a bar. A task with only a due date moves as
 * a single day. Resizing never lets the end precede the start.
 */
export function dragDates(start: string | null, due: string | null, mode: DragMode, deltaDays: number): { start_date: string | null; due_date: string | null } {
  const shift = (s: string) => iso(addDays(d(s), deltaDays));
  if (!start && !due) return { start_date: null, due_date: null };
  if (mode === 'move') return { start_date: start ? shift(start) : null, due_date: due ? shift(due) : null };
  const s = start ?? due!;
  const e = due ?? start!;
  if (mode === 'start') {
    const ns = shift(s);
    return { start_date: ns > e ? e : ns, due_date: e };
  }
  const ne = shift(e);
  return { start_date: start ? s : start, due_date: ne < s ? s : ne };
}

export function daysBetween(a: string, b: string): number {
  return differenceInCalendarDays(d(b), d(a));
}

export function addDaysIso(a: string, n: number): string {
  return iso(addDays(d(a), n));
}
