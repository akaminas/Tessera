import { addMonths, format, parseISO, subDays } from 'date-fns';

/** Project month (1-based) containing `date`, mirroring public.project_month_of(). */
export function projectMonthOf(start: string | null, date: string | null): number | null {
  if (!start || !date || date < start) return null;
  const s = parseISO(start);
  const d = parseISO(date);
  let months = (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
  if (d.getDate() < s.getDate()) months -= 1;
  return months + 1;
}

/** First day of project month m. */
export function projectMonthStart(start: string, m: number): string {
  return format(addMonths(parseISO(start), m - 1), 'yyyy-MM-dd');
}

/** Last day of project month m. */
export function projectMonthEnd(start: string, m: number): string {
  return format(subDays(addMonths(parseISO(start), m), 1), 'yyyy-MM-dd');
}

/** "M3–M14" style label for a date range, or '' when no project start. */
export function monthRangeLabel(start: string | null, from: string | null, to: string | null): string {
  const a = projectMonthOf(start, from);
  const b = projectMonthOf(start, to);
  if (a == null && b == null) return '';
  if (a != null && b != null) return a === b ? `M${a}` : `M${a}–M${b}`;
  return a != null ? `from M${a}` : `to M${b}`;
}

export function fmtDate(d: string | null | undefined, pattern = 'd MMM yyyy'): string {
  return d ? format(parseISO(d), pattern) : '—';
}

/* ------------------------------------------------------------- Risk matrix */

/** Vellum "ember" gradient (light theme), low → high. */
export const EMBER_LIGHT = ['#F1EADC', '#E8CFB0', '#DDB38E', '#CF9777', '#BC7D67', '#A46662', '#87545D', '#664554', '#443941'];
export const EMBER_DARK = ['#3D372C', '#5B462B', '#7A5533', '#976344', '#B2745F', '#C98883', '#D99FA9', '#E2BBCB', '#E7D9E3'];

/** Map a 1–25 score onto the 9 ember steps (scores 1→step 0, 25→step 8). */
export function emberStep(score: number): number {
  const s = Math.max(1, Math.min(25, score));
  return Math.round(((s - 1) / 24) * 8);
}

/** Text colour that keeps contrast on a given ember step. */
export function emberText(step: number, dark: boolean): string {
  if (dark) return step >= 5 ? '#2A2520' : '#ECE7DF';
  return step >= 5 ? '#FFFFFF' : '#2A2825';
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export function riskLevel(score: number): RiskLevel {
  if (score >= 20) return 'critical';
  if (score >= 15) return 'high';
  if (score >= 8) return 'medium';
  return 'low';
}

/** Count items per (probability, impact) cell; returns matrix[impact-1][probability-1]. */
export function riskMatrix(items: { probability: number; impact: number }[]): number[][] {
  const m = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
  for (const r of items) {
    const p = Math.max(1, Math.min(5, Math.round(r.probability)));
    const i = Math.max(1, Math.min(5, Math.round(r.impact)));
    m[i - 1][p - 1] += 1;
  }
  return m;
}

/* -------------------------------------------------------- Milestone helpers */

export interface MilestoneLike {
  status: string;
  due_date: string | null;
}

export function isOverdue(m: MilestoneLike, today: string = format(new Date(), 'yyyy-MM-dd')): boolean {
  return Boolean(m.due_date) && m.due_date! < today && m.status !== 'done' && m.status !== 'cancelled';
}

export type EvidenceState = 'none' | 'missing' | 'submitted' | 'verified';

/** Overall evidence state of an entity from its evidence items. */
export function evidenceState(items: { required: boolean; status: string }[], required: boolean): EvidenceState {
  const req = items.filter((i) => i.required);
  if (!req.length) return required ? 'missing' : items.length ? (items.every((i) => i.status === 'verified') ? 'verified' : 'submitted') : 'none';
  if (req.some((i) => i.status === 'missing' || i.status === 'rejected')) return 'missing';
  if (req.every((i) => i.status === 'verified')) return 'verified';
  return 'submitted';
}

/** Group activity entries by calendar day (newest first). */
export function groupByDay<T extends { created_at: string }>(rows: T[]): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const r of rows) {
    const day = format(parseISO(r.created_at), 'yyyy-MM-dd');
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(r);
    else out.push({ day, items: [r] });
  }
  return out;
}

/** Minutes → "12.5 h" */
export function hours(minutes: number): string {
  const h = minutes / 60;
  return `${h.toLocaleString('en-GB', { maximumFractionDigits: 1 })} h`;
}

/** Integer cents → "1,234.56" (no float drift). */
export function formatCents(cents: number, currency?: string): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-GB');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '−' : ''}${currency ? currency + ' ' : ''}${whole}.${frac}`;
}
