/**
 * Excel workbook import/export for project plans and consortium budgets.
 *
 * Parsing recognises the *structure* of common office workbooks (work-package
 * sheets with an M1…Mn month grid coloured by state, a milestones sheet; a
 * consortium budget summary plus one sheet per partner) and produces the
 * payloads accepted by the import_plan / import_budget database functions,
 * together with a list of issues (with sheet!cell references) and a
 * reconciliation report. Nothing is silently corrected: differences between
 * source totals and recomputed totals are reported for the user to decide.
 */
import Big from 'big.js';
import type { Cell, Workbook, Worksheet } from 'exceljs';
import { defaultIndirectBase, inferCategoryKind, partnerIndirect, roundAmount, toBig, type CategoryKind, type RoundingLevel, type RoundingMode } from './finance';

export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue {
  level: IssueLevel;
  message: string;
  ref?: string;
}

/* ----------------------------------------------------------- cell helpers */

type Prim = string | number | boolean | Date | null;

export function cellValue(cell: Cell | undefined): Prim {
  if (!cell) return null;
  const v = cell.value as unknown;
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('result' in o) {
      const r = o.result as unknown;
      return r == null || typeof r === 'object' ? (r instanceof Date ? r : null) : (r as Prim);
    }
    if ('text' in o) return String(o.text);
    if ('error' in o) return null;
  }
  return null;
}

export function cellText(cell: Cell | undefined): string {
  const v = cellValue(cell);
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

export function cellNumber(cell: Cell | undefined): number | null {
  const v = cellValue(cell);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.replace(/[€$£\s]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
}

/** Fill colour as 6 hex digits (upper case), or null. */
export function cellFill(cell: Cell | undefined): string | null {
  const f = cell?.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
  if (!f || f.type !== 'pattern' || !f.pattern || f.pattern === 'none') return null;
  const argb = f.fgColor?.argb;
  if (!argb) return null;
  return argb.slice(-6).toUpperCase();
}

const ref = (ws: Worksheet, row: number, col: number) => `${ws.name}!${colLetter(col)}${row}`;
export function colLetter(col: number): string {
  let s = '';
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function findCell(ws: Worksheet, test: (text: string) => boolean, maxRow = ws.rowCount, maxCol = Math.min(ws.columnCount, 40)): { row: number; col: number; text: string } | null {
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const t = cellText(row.getCell(c));
      if (t && test(t)) return { row: r, col: c, text: t };
    }
  }
  return null;
}

function rightOf(ws: Worksheet, row: number, col: number): string {
  for (let c = col + 1; c <= col + 6; c++) {
    const t = cellText(ws.getRow(row).getCell(c));
    if (t) return t;
  }
  return '';
}

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

function parseDateLike(v: Prim): string | null {
  if (v instanceof Date) return iso(v);
  if (typeof v === 'string') {
    const s = v.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return iso(new Date(t));
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial date
    return iso(new Date(Date.UTC(1899, 11, 30) + v * 86400000));
  }
  return null;
}

export async function loadWorkbook(data: ArrayBuffer): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  return wb;
}

/* ------------------------------------------------------------- detection */

export type WorkbookKind = 'plan' | 'budget' | 'unknown';

export function detectWorkbookKind(wb: Workbook): WorkbookKind {
  let plan = 0;
  let budget = 0;
  for (const ws of wb.worksheets) {
    if (findCell(ws, (t) => /^cost category$/i.test(t), Math.min(ws.rowCount, 30))) budget += 2;
    if (findCell(ws, (t) => /^institution name$/i.test(t), Math.min(ws.rowCount, 40))) budget += 2;
    if (findCell(ws, (t) => /^M1$/i.test(t), Math.min(ws.rowCount, 15)) && findCell(ws, (t) => /^M2$/i.test(t), Math.min(ws.rowCount, 15))) plan += 2;
    if (/milestone/i.test(ws.name)) plan += 1;
  }
  if (budget > plan && budget >= 2) return 'budget';
  if (plan >= 2) return 'plan';
  return 'unknown';
}

/* ================================================================== PLAN */

export type MonthState = 'planned' | 'due' | 'done' | 'header';

export const DEFAULT_PLAN_LEGEND: Record<string, MonthState> = {
  '128A9A': 'planned',
  FFC000: 'due',
  '92D050': 'done',
  DCE6F1: 'header',
};

export interface PlanWp {
  code: string;
  name: string;
  lead: string;
  start_month: number;
  end_month: number;
  sheet: string;
}
export interface PlanRow {
  id: string;
  wp: string;
  kind: 'task' | 'activity';
  title: string;
  responsible: string;
  planned: number[];
  due: number[];
  done: number[];
  ref: string;
  include: boolean;
}
export type MilestoneStatus = 'planned' | 'on_track' | 'at_risk' | 'delayed' | 'done' | 'cancelled';
export interface PlanMilestone {
  id: string;
  code: string;
  title: string;
  wp: string;
  due_date: string | null;
  verification: string;
  status: MilestoneStatus;
  rawStatus: string;
  notes: string;
  kind: 'milestone' | 'deliverable' | 'report' | 'event' | 'control';
  ref: string;
  include: boolean;
}
export interface ParsedPlan {
  kind: 'plan';
  startDate: string | null;
  months: number;
  legend: Record<string, MonthState>;
  workPackages: PlanWp[];
  rows: PlanRow[];
  milestones: PlanMilestone[];
  issues: Issue[];
}

export const STATUS_MAP: Record<string, MilestoneStatus> = {
  planned: 'planned',
  'not started': 'planned',
  'on track': 'on_track',
  ongoing: 'on_track',
  'in progress': 'on_track',
  'at risk': 'at_risk',
  delayed: 'delayed',
  late: 'delayed',
  done: 'done',
  completed: 'done',
  complete: 'done',
  achieved: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};
export const STATUS_LABEL: Record<MilestoneStatus, string> = {
  planned: 'Planned',
  on_track: 'On track',
  at_risk: 'At risk',
  delayed: 'Delayed',
  done: 'Done',
  cancelled: 'Cancelled',
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function readLegend(wb: Workbook): Record<string, MonthState> | null {
  for (const ws of wb.worksheets.slice(0, 4)) {
    const at = findCell(ws, (t) => /^legend$/i.test(t), Math.min(ws.rowCount, 60), 6);
    if (!at) continue;
    const legend: Record<string, MonthState> = {};
    for (let r = at.row + 1; r <= at.row + 10; r++) {
      const row = ws.getRow(r);
      let fill: string | null = null;
      let desc = '';
      for (let c = 1; c <= 6; c++) {
        const cell = row.getCell(c);
        const f = cellFill(cell);
        if (f && !fill) fill = f;
        const t = cellText(cell);
        if (t && !desc) desc = t;
      }
      if (!fill || !desc) continue;
      const d = desc.toLowerCase();
      const state: MonthState | null = /complet|done|finished/.test(d)
        ? 'done'
        : /milestone|deliverable|report|due/.test(d)
          ? 'due'
          : /header|task row/.test(d)
            ? 'header'
            : /plan|ongoing|activity/.test(d)
              ? 'planned'
              : null;
      if (state) legend[fill] = state;
    }
    if (Object.keys(legend).length) return legend;
  }
  return null;
}

function inferMilestoneKind(title: string): PlanMilestone['kind'] {
  if (/^D\s?\d/i.test(title) || /deliverable/i.test(title)) return 'deliverable';
  if (/report/i.test(title)) return 'report';
  if (/meeting|kick-?off|day\b|event|workshop|conference/i.test(title)) return 'event';
  if (/control|check|review|evaluation/i.test(title)) return 'control';
  return 'milestone';
}

const WP_TITLE = /^(WP\s*\d+[A-Za-z]?)\s*[-–—:.]\s*(.+)$/i;
const normWp = (s: string) => s.replace(/\s+/g, '').toUpperCase();

export function parsePlanWorkbook(wb: Workbook): ParsedPlan {
  const issues: Issue[] = [];
  const legend = { ...DEFAULT_PLAN_LEGEND, ...(readLegend(wb) ?? {}) };
  const workPackages: PlanWp[] = [];
  const rows: PlanRow[] = [];
  let months = 0;
  let startDate: string | null = null;
  const unknownFills = new Set<string>();
  let rid = 0;

  for (const ws of wb.worksheets) {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') continue;
    const title = findCell(ws, (t) => WP_TITLE.test(t), Math.min(ws.rowCount, 6), 8);
    const header = findCell(ws, (t) => /^M1$/i.test(t), Math.min(ws.rowCount, 20));
    if (!title || !header) continue;
    const m = title.text.match(WP_TITLE)!;
    const code = normWp(m[1]);
    let name = m[2];
    let lead = '';
    const leadInTitle = name.match(/\s*\|\s*Lead:\s*(.+)$/i);
    if (leadInTitle) {
      lead = leadInTitle[1].trim();
      name = name.slice(0, leadInTitle.index).trim();
    } else {
      const row = ws.getRow(title.row);
      for (let c = 1; c <= 10; c++) {
        const t = cellText(row.getCell(c));
        const lm = t.match(/^Lead:\s*(.+)$/i);
        if (lm) lead = lm[1].trim();
      }
    }
    if (workPackages.some((w) => w.code === code)) {
      issues.push({ level: 'error', message: `Work package ${code} appears on more than one sheet`, ref: ref(ws, title.row, title.col) });
      continue;
    }
    // month columns
    const hdr = ws.getRow(header.row);
    const monthCols = new Map<number, number>();
    let titleCol = 1;
    let respCol = 0;
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = cellText(hdr.getCell(c));
      const mm = t.match(/^M\s?(\d{1,3})$/i);
      if (mm) monthCols.set(c, parseInt(mm[1], 10));
      else if (/task|activity/i.test(t)) titleCol = c;
      else if (/responsible|owner|lead/i.test(t)) respCol = c;
    }
    if (!respCol) respCol = titleCol + 1;
    const maxMonth = Math.max(0, ...monthCols.values());
    months = Math.max(months, maxMonth);
    // start date from a row of dates under the month header
    if (!startDate) {
      const dateRow = ws.getRow(header.row + 1);
      const firstCol = [...monthCols.entries()].find(([, mo]) => mo === 1)?.[0];
      if (firstCol) {
        const d = parseDateLike(cellValue(dateRow.getCell(firstCol)));
        if (d) startDate = d.slice(0, 8) + '01';
      }
    }
    let wpMin = Infinity;
    let wpMax = 0;
    for (let r = header.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const t = cellText(row.getCell(titleCol));
      if (!t) continue;
      const planned: number[] = [];
      const due: number[] = [];
      const done: number[] = [];
      for (const [c, mo] of monthCols) {
        const cell = row.getCell(c);
        const f = cellFill(cell);
        const state = f ? legend[f] : undefined;
        if (f && !state && f !== 'FFFFFF') unknownFills.add(`${f} (${ref(ws, r, c)})`);
        if (state === 'planned') planned.push(mo);
        else if (state === 'due') due.push(mo);
        else if (state === 'done') done.push(mo);
        else if (!f) {
          const v = cellText(cell).toLowerCase();
          if (v === 'x' || v === '✓' || v === 'p') planned.push(mo);
        }
      }
      const isTask = /^task\b/i.test(t) || legend[cellFill(row.getCell(titleCol)) ?? ''] === 'header';
      for (const mo of [...planned, ...due, ...done]) {
        wpMin = Math.min(wpMin, mo);
        wpMax = Math.max(wpMax, mo);
      }
      rows.push({
        id: `r${++rid}`,
        wp: code,
        kind: isTask ? 'task' : 'activity',
        title: t.slice(0, 500),
        responsible: cellText(row.getCell(respCol)).slice(0, 300),
        planned,
        due,
        done,
        ref: ref(ws, r, titleCol),
        include: true,
      });
    }
    workPackages.push({
      code,
      name: name.slice(0, 200),
      lead,
      start_month: Number.isFinite(wpMin) ? wpMin : 1,
      end_month: wpMax || maxMonth || 1,
      sheet: ws.name,
    });
  }
  if (unknownFills.size) {
    issues.push({
      level: 'warning',
      message: `Cells with colours not in the legend were ignored: ${[...unknownFills].slice(0, 6).join(', ')}${unknownFills.size > 6 ? ` and ${unknownFills.size - 6} more` : ''}`,
    });
  }

  // start date from overview text, e.g. "(M1 = Sep 2026)" or "01/09/2026 - 31/08/2028"
  if (!startDate) {
    for (const ws of wb.worksheets.slice(0, 3)) {
      const c = findCell(ws, (t) => /M1\s*=\s*[A-Za-z]{3}/i.test(t) || /\d{1,2}\/\d{1,2}\/\d{4}/.test(t), Math.min(ws.rowCount, 30), 6);
      if (!c) continue;
      const m1 = c.text.match(/M1\s*=\s*([A-Za-z]{3})[a-z]*\s+(\d{4})/i);
      if (m1 && MONTHS[m1[1].toLowerCase()]) {
        startDate = `${m1[2]}-${String(MONTHS[m1[1].toLowerCase()]).padStart(2, '0')}-01`;
        break;
      }
      const d = c.text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (d) {
        startDate = `${d[3]}-${d[2].padStart(2, '0')}-01`;
        break;
      }
    }
  }
  if (!startDate) issues.push({ level: 'warning', message: 'Could not find the project start (M1). Set it before importing.' });
  if (!workPackages.length) issues.push({ level: 'error', message: 'No work-package sheets were found (expected a title like "WP1 - Name" and a header row with M1, M2, …).' });

  // milestones
  const milestones: PlanMilestone[] = [];
  const wpCodes = new Set(workPackages.map((w) => w.code));
  for (const ws of wb.worksheets) {
    if (!/milestone|deliverable/i.test(ws.name)) continue;
    const h = findCell(ws, (t) => /milestone|control point|deliverable/i.test(t) && !/internal milestones/i.test(t) && t.length < 60, Math.min(ws.rowCount, 15));
    if (!h) continue;
    const hdr = ws.getRow(h.row);
    const col: Record<string, number> = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = cellText(hdr.getCell(c)).toLowerCase();
      if (!t) continue;
      if (/^(#|no\.?|id|code|ref)$/.test(t)) col.code ??= c;
      else if (/verification|evidence/.test(t)) col.verification ??= c;
      else if (/milestone|control point|title|deliverable/.test(t)) col.title ??= c;
      else if (/^wp$|work package/.test(t)) col.wp ??= c;
      else if (/due|date|deadline/.test(t)) col.due ??= c;
      else if (/status/.test(t)) col.status ??= c;
      else if (/note|comment/.test(t)) col.notes ??= c;
    }
    if (!col.title) continue;
    let mid = 0;
    for (let r = h.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const title = cellText(row.getCell(col.title));
      if (!title || /:$/.test(title)) continue;
      const codeRaw = col.code ? cellValue(row.getCell(col.code)) : null;
      const code = typeof codeRaw === 'number' ? String(Math.round(codeRaw * 100) / 100).replace(/\.0+$/, '') : String(codeRaw ?? '').trim();
      const wpRaw = col.wp ? cellText(row.getCell(col.wp)) : '';
      const wpTokens = wpRaw.split(/[/,&+\s]+/).map(normWp).filter((x) => /^WP\d/.test(x));
      const wp = wpTokens[0] ?? '';
      if (wpTokens.length > 1) issues.push({ level: 'info', message: `“${title}” is shared by ${wpTokens.join(', ')}; it is linked to ${wp}.`, ref: ref(ws, r, col.wp!) });
      if (wp && !wpCodes.has(wp)) issues.push({ level: 'warning', message: `“${title}” refers to ${wp}, which has no sheet; it will not be linked to a work package.`, ref: ref(ws, r, col.wp!) });
      const due = col.due ? parseDateLike(cellValue(row.getCell(col.due))) : null;
      if (!due) issues.push({ level: 'warning', message: `“${title}” has no readable due date.`, ref: col.due ? ref(ws, r, col.due) : undefined });
      const rawStatus = col.status ? cellText(row.getCell(col.status)) : '';
      let status = STATUS_MAP[rawStatus.toLowerCase()];
      if (!status) {
        if (rawStatus) issues.push({ level: 'warning', message: `Unknown status “${rawStatus}” for “${title}”; using Planned.`, ref: ref(ws, r, col.status!) });
        status = 'planned';
      }
      milestones.push({
        id: `m${++mid}`,
        code,
        title: title.slice(0, 300),
        wp: wp && wpCodes.has(wp) ? wp : '',
        due_date: due,
        verification: col.verification ? cellText(row.getCell(col.verification)) : '',
        status,
        rawStatus,
        notes: col.notes ? cellText(row.getCell(col.notes)) : '',
        kind: inferMilestoneKind(title),
        ref: ref(ws, r, col.title),
        include: true,
      });
    }
  }

  // sanity checks
  for (const r of rows) {
    if (r.kind === 'activity' && r.planned.length + r.due.length + r.done.length === 0) {
      issues.push({ level: 'info', message: `“${r.title}” has no months marked; it is imported without dates.`, ref: r.ref });
    }
  }
  return { kind: 'plan', startDate, months: months || 12, legend, workPackages, rows, milestones, issues };
}

export interface ImportPlanPayload {
  start_date: string | null;
  months: number;
  board_name: string;
  work_packages: { code: string; name: string; lead: string; start_month: number; end_month: number }[];
  rows: { wp: string; kind: 'task' | 'activity'; title: string; responsible: string; planned: number[]; due: number[]; done: number[] }[];
  milestones: { code: string; title: string; wp: string; due_date: string | null; verification: string; status: MilestoneStatus; notes: string; kind: string }[];
}

export function buildPlanPayload(p: ParsedPlan, boardName = 'Work plan'): ImportPlanPayload {
  const wps = p.workPackages;
  const codes = new Set(wps.map((w) => w.code));
  return {
    start_date: p.startDate,
    months: p.months,
    board_name: boardName,
    work_packages: wps.map(({ code, name, lead, start_month, end_month }) => ({ code, name, lead, start_month, end_month })),
    rows: p.rows
      .filter((r) => r.include && codes.has(r.wp))
      .map(({ wp, kind, title, responsible, planned, due, done }) => ({ wp, kind, title, responsible, planned, due, done })),
    milestones: p.milestones
      .filter((m) => m.include)
      .map(({ code, title, wp, due_date, verification, status, notes, kind }) => ({ code, title, wp, due_date, verification, status, notes, kind })),
  };
}

/** Blocking problems for a plan import (after user edits). */
export function planBlockers(p: ParsedPlan): string[] {
  const out: string[] = [];
  if (!p.startDate) out.push('Set the project start date (M1).');
  if (!p.workPackages.length) out.push('At least one work package is required.');
  const codes = p.workPackages.map((w) => w.code);
  if (new Set(codes).size !== codes.length) out.push('Work-package codes must be unique.');
  for (const w of p.workPackages) {
    if (!w.code.trim() || !w.name.trim()) out.push(`Every work package needs a code and a name (${w.sheet}).`);
    if (w.start_month < 1 || w.end_month < w.start_month) out.push(`${w.code}: the end month must be on or after the start month.`);
  }
  for (const r of p.rows) if (r.include && !r.title.trim()) out.push(`An included row has no title (${r.ref}).`);
  for (const m of p.milestones) if (m.include && !m.title.trim()) out.push(`An included milestone has no title (${m.ref}).`);
  return out;
}

/* ================================================================ BUDGET */

export type SummaryGroup = 'personnel' | 'subcontracting' | 'travel' | 'equipment' | 'other' | 'other_categories';
export const SUMMARY_GROUP_LABEL: Record<SummaryGroup, string> = {
  personnel: 'Personnel',
  subcontracting: 'Subcontracting',
  travel: 'Travel and subsistence',
  equipment: 'Equipment',
  other: 'Other goods, works and services',
  other_categories: 'Other cost categories',
};
export function groupOfKind(kind: CategoryKind | string): SummaryGroup {
  if (kind === 'personnel' || kind === 'subcontracting' || kind === 'travel' || kind === 'equipment' || kind === 'other') return kind;
  return 'other_categories';
}

export interface BudgetPartner {
  key: string;
  sheet: string;
  name: string;
  short_name: string;
  country: string;
  role: 'coordinator' | 'partner';
  pm_rate: string | null;
  include: boolean;
}
export interface BudgetCategory {
  name: string;
  kind: CategoryKind;
  indirect_base: boolean;
}
export interface BudgetLine {
  id: string;
  partner: string;
  category: string;
  amount: number;
  sourceIndirect: number | null;
  sourceTotal: number | null;
  year: number | null;
  wp: string | null;
  person_months: number | null;
  description: string;
  ref: string;
  include: boolean;
}
export interface SummaryRow {
  name: string;
  country: string;
  groups: Partial<Record<SummaryGroup, number>>;
  indirect: number | null;
  total: number | null;
  fundingRate: number | null;
  requested: number | null;
  ref: string;
}
export interface BudgetSettingsDraft {
  indirect_rate: string;
  funding_rate: string;
  rounding: RoundingLevel;
  rounding_decimals: number;
  rounding_mode: RoundingMode;
}
export interface ParsedBudget {
  kind: 'budget';
  partners: BudgetPartner[];
  categories: BudgetCategory[];
  lines: BudgetLine[];
  workPackages: { code: string; name: string }[];
  summary: SummaryRow[];
  summaryTotal: SummaryRow | null;
  /** person-months per WP from the summary table, by partner name */
  pmSummary: Record<string, Record<string, number>>;
  /** person-months per WP from each partner sheet's own block, by partner key */
  pmBlocks: Record<string, Record<string, number>>;
  settings: BudgetSettingsDraft;
  issues: Issue[];
}

function summaryGroupOfHeader(text: string): SummaryGroup | 'indirect' | 'total' | 'funding' | 'requested' | 'country' | 'name' | null {
  const t = text.toLowerCase();
  if (/institution name|partner name|^partner$|beneficiary/.test(t)) return 'name';
  if (/country/.test(t)) return 'country';
  if (/indirect/.test(t)) return 'indirect';
  if (/total eligible/.test(t)) return 'total';
  if (/funding rate/.test(t)) return 'funding';
  if (/requested/.test(t)) return 'requested';
  if (/maximum/.test(t)) return null;
  if (/personnel/.test(t)) return 'personnel';
  if (/subcontract/.test(t)) return 'subcontracting';
  if (/travel/.test(t)) return 'travel';
  if (/equipment/.test(t)) return 'equipment';
  if (/other goods/.test(t)) return 'other';
  if (/other\s*cost\s*categor|specific cost categor|third part|internally invoiced/.test(t)) return 'other_categories';
  return null;
}

function detectIndirectRate(wb: Workbook): string | null {
  for (const ws of wb.worksheets) {
    const c = findCell(ws, (t) => /indirect/i.test(t) && (/\d+(?:[.,]\d+)?\s*%/.test(t) || /=\s*0?[.,]\d+\s*\(/.test(t)), Math.min(ws.rowCount, 40));
    if (!c) continue;
    const p = c.text.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (p) return toBig(p[1]).div(100).toString();
    const f = c.text.match(/=\s*(0?[.,]\d+)\s*\(/);
    if (f) return toBig(f[1]).toString();
  }
  return null;
}

export function parseBudgetWorkbook(wb: Workbook): ParsedBudget {
  const issues: Issue[] = [];
  const partners: BudgetPartner[] = [];
  const lines: BudgetLine[] = [];
  const pmBlocks: Record<string, Record<string, number>> = {};
  const catNames = new Map<string, BudgetCategory>();
  let lid = 0;

  // --- summary sheet
  const summary: SummaryRow[] = [];
  let summaryTotal: SummaryRow | null = null;
  const pmSummary: Record<string, Record<string, number>> = {};
  const workPackages: { code: string; name: string }[] = [];
  let coordinator = '';
  for (const ws of wb.worksheets) {
    const h = findCell(ws, (t) => /^institution name$/i.test(t), Math.min(ws.rowCount, 60));
    if (!h) continue;
    const coord = findCell(ws, (t) => /^coordinator$/i.test(t), Math.min(ws.rowCount, 20));
    if (coord) coordinator = rightOf(ws, coord.row, coord.col);
    const cols: Record<number, ReturnType<typeof summaryGroupOfHeader>> = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = `${cellText(ws.getRow(h.row).getCell(c))} ${cellText(ws.getRow(h.row + 1).getCell(c))}`.trim();
      // merged header: prefer the sub-header for purchase-cost columns
      const sub = cellText(ws.getRow(h.row + 1).getCell(c));
      cols[c] = summaryGroupOfHeader(sub && /travel|equipment|other goods|specific/i.test(sub) ? sub : t);
    }
    const nameCol = h.col;
    for (let r = h.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = cellText(row.getCell(nameCol));
      if (!name) {
        if (summary.length) break;
        continue;
      }
      const hasNumber = Object.keys(cols).some((c) => cellNumber(row.getCell(Number(c))) != null && cols[Number(c)] && cols[Number(c)] !== 'country');
      if (!hasNumber) continue;
      const s: SummaryRow = { name, country: '', groups: {}, indirect: null, total: null, fundingRate: null, requested: null, ref: ref(ws, r, nameCol) };
      for (const [cStr, kind] of Object.entries(cols)) {
        const c = Number(cStr);
        if (!kind || kind === 'name') continue;
        if (kind === 'country') {
          s.country = cellText(row.getCell(c));
          continue;
        }
        const v = cellNumber(row.getCell(c));
        if (kind === 'indirect') s.indirect = v;
        else if (kind === 'total') s.total = v;
        else if (kind === 'funding') s.fundingRate = v;
        else if (kind === 'requested') s.requested = v;
        else s.groups[kind] = (s.groups[kind] ?? 0) + (v ?? 0);
      }
      if (/^total$/i.test(name)) {
        summaryTotal = s;
        break;
      }
      summary.push(s);
    }
    // person months per WP table
    const pm = findCell(ws, (t) => /^person months per wp/i.test(t));
    if (pm) {
      let hr = pm.row + 1;
      while (hr <= pm.row + 4 && !findWpHeader(ws, hr)) hr++;
      const wpCols = findWpHeader(ws, hr);
      if (wpCols) {
        for (let r = hr + 1; r <= ws.rowCount; r++) {
          const name = cellText(ws.getRow(r).getCell(pm.col));
          if (!name) break;
          const byWp: Record<string, number> = {};
          for (const [c, code] of wpCols) {
            const v = cellNumber(ws.getRow(r).getCell(c));
            if (v != null) byWp[code] = v;
          }
          pmSummary[name] = byWp;
        }
      }
    }
    // WP titles
    const wpt = findCell(ws, (t) => /^work packages$/i.test(t));
    if (wpt) {
      for (let r = wpt.row + 1; r <= Math.min(ws.rowCount, wpt.row + 40); r++) {
        const code = normWp(cellText(ws.getRow(r).getCell(wpt.col)));
        if (/^WP\d/.test(code)) workPackages.push({ code, name: rightOf(ws, r, wpt.col) });
      }
    }
    break;
  }

  // --- indirect rate
  const rateText = detectIndirectRate(wb);

  // --- partner sheets
  for (const ws of wb.worksheets) {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') continue;
    const h = findCell(ws, (t) => /^cost category$/i.test(t), Math.min(ws.rowCount, 40));
    if (!h) continue;
    const pn = findCell(ws, (t) => /^partner name$|^beneficiary$|^institution$/i.test(t), h.row);
    const name = pn ? rightOf(ws, pn.row, pn.col) : ws.name.replace(/\s*budget$/i, '');
    if (!pn) issues.push({ level: 'warning', message: `No “Partner Name” on sheet ${ws.name}; using the sheet name.`, ref: `${ws.name}!A1` });
    const key = ws.name;
    const hdr = ws.getRow(h.row);
    const col: Record<string, number> = { category: h.col };
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = cellText(hdr.getCell(c)).toLowerCase();
      if (!t || c === h.col) continue;
      if (/explanation|justification|description/.test(t)) col.desc ??= c;
      else if (/indirect/.test(t)) col.indirect ??= c;
      else if (/^total/.test(t)) col.total ??= c;
      else if (/^cost\b/.test(t) || /^amount/.test(t)) col.cost ??= c;
      else if (/year/.test(t)) col.year ??= c;
      else if (/work package|^wp$/.test(t)) col.wp ??= c;
      else if (/\bpms?\b|person.?months?/.test(t)) col.pm ??= c;
    }
    if (!col.cost) {
      issues.push({ level: 'error', message: `Sheet ${ws.name} has no cost column next to “Cost Category”.`, ref: ref(ws, h.row, h.col) });
      continue;
    }
    let blanks = 0;
    let pLines = 0;
    for (let r = h.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cat = cellText(row.getCell(col.category));
      if (!cat) {
        if (++blanks > 5) break;
        continue;
      }
      blanks = 0;
      if (/person months|^total/i.test(cat)) break;
      const amount = cellNumber(row.getCell(col.cost));
      if (amount == null) {
        issues.push({ level: 'warning', message: `Row skipped: “${cat}” has no numeric cost.`, ref: ref(ws, r, col.cost) });
        continue;
      }
      if (amount < 0) issues.push({ level: 'error', message: `Negative cost on sheet ${ws.name}.`, ref: ref(ws, r, col.cost) });
      if (!catNames.has(cat)) {
        const kind = inferCategoryKind(cat);
        catNames.set(cat, { name: cat, kind, indirect_base: defaultIndirectBase(kind) });
      }
      const yearV = col.year ? cellNumber(row.getCell(col.year)) : null;
      const wpRaw = col.wp ? normWp(cellText(row.getCell(col.wp))) : '';
      lines.push({
        id: `l${++lid}`,
        partner: key,
        category: cat,
        amount,
        sourceIndirect: col.indirect ? cellNumber(row.getCell(col.indirect)) : null,
        sourceTotal: col.total ? cellNumber(row.getCell(col.total)) : null,
        year: yearV != null && yearV > 1900 && yearV < 2200 ? Math.round(yearV) : null,
        wp: /^WP\d/.test(wpRaw) ? wpRaw : null,
        person_months: col.pm ? cellNumber(row.getCell(col.pm)) : null,
        description: col.desc ? cellText(row.getCell(col.desc)).slice(0, 2000) : '',
        ref: ref(ws, r, col.category),
        include: true,
      });
      pLines++;
      if (wpRaw && !/^WP\d/.test(wpRaw)) issues.push({ level: 'warning', message: `Unrecognised work package “${wpRaw}”.`, ref: ref(ws, r, col.wp!) });
    }
    if (!pLines) issues.push({ level: 'warning', message: `No budget lines found on sheet ${ws.name}.`, ref: ref(ws, h.row, h.col) });
    // partner PM block
    const pm = findCell(ws, (t) => /^person months per/i.test(t));
    if (pm) {
      for (let hr = pm.row + 1; hr <= pm.row + 4; hr++) {
        const wpCols = findWpHeader(ws, hr);
        if (wpCols) {
          const byWp: Record<string, number> = {};
          for (const [c, code] of wpCols) {
            const v = cellNumber(ws.getRow(hr + 1).getCell(c));
            if (v != null) byWp[code] = v;
          }
          pmBlocks[key] = byWp;
          break;
        }
      }
    }
    // PM rate: personnel cost ÷ PMs (must be consistent across lines)
    const personnel = lines.filter((l) => l.partner === key && catNames.get(l.category)?.kind === 'personnel' && l.person_months);
    let pmRate: string | null = null;
    if (personnel.length) {
      const rates = personnel.map((l) => toBig(l.amount).div(toBig(l.person_months!)));
      const sum = personnel.reduce((t, l) => t.plus(toBig(l.amount)), new Big(0));
      const pms = personnel.reduce((t, l) => t.plus(toBig(l.person_months!)), new Big(0));
      pmRate = roundAmount(sum.div(pms), 2, 'half_up').toString();
      const min = rates.reduce((a, b) => (a.lt(b) ? a : b));
      const max = rates.reduce((a, b) => (a.gt(b) ? a : b));
      if (max.minus(min).abs().gt(0.01)) {
        issues.push({ level: 'warning', message: `${name}: person-month rates differ between lines (${roundAmount(min, 2, 'half_up')} to ${roundAmount(max, 2, 'half_up')}); the average ${pmRate} is used.`, ref: `${ws.name}` });
      }
    }
    const s = summary.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (summary.length && !s) issues.push({ level: 'warning', message: `${name} (sheet ${ws.name}) is not listed in the consortium summary.`, ref: `${ws.name}` });
    partners.push({
      key,
      sheet: ws.name,
      name,
      short_name: ws.name.replace(/\s*budget$/i, '').trim().slice(0, 30),
      country: s?.country ?? '',
      role: coordinator && coordinator.toLowerCase() === name.toLowerCase() ? 'coordinator' : 'partner',
      pm_rate: pmRate,
      include: true,
    });
  }
  for (const s of summary) {
    if (!partners.some((p) => p.name.trim().toLowerCase() === s.name.trim().toLowerCase())) {
      issues.push({ level: 'warning', message: `${s.name} is in the consortium summary but has no partner sheet; its figures cannot be imported.`, ref: s.ref });
    }
  }
  if (!partners.length) issues.push({ level: 'error', message: 'No partner budget sheets were found (expected a “Cost Category” header).' });

  // WPs referenced by lines
  for (const l of lines) if (l.wp && !workPackages.some((w) => w.code === l.wp)) workPackages.push({ code: l.wp, name: '' });
  workPackages.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // indirect rate: explicit text, otherwise the ratio observed on the lines
  let indirect_rate = rateText;
  if (!indirect_rate) {
    const ratios = lines
      .filter((l) => l.sourceIndirect && l.amount > 0)
      .map((l) => toBig(l.sourceIndirect!).div(toBig(l.amount)).round(4).toString());
    const counts = new Map<string, number>();
    for (const r of ratios) counts.set(r, (counts.get(r) ?? 0) + 1);
    indirect_rate = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '0';
    issues.push({ level: 'info', message: `Indirect-cost rate inferred from the lines: ${toBig(indirect_rate).times(100).toString()} %. Check it in the settings.` });
  }
  // funding rate
  let funding_rate = '1';
  const rates = summary.map((s) => s.fundingRate).filter((v): v is number => v != null && v > 0);
  if (rates.length) {
    const r = rates[0] > 1 ? rates[0] / 100 : rates[0];
    funding_rate = String(r);
    if (new Set(rates).size > 1) issues.push({ level: 'warning', message: 'Funding rates differ between partners; set partner-specific rates after import.' });
  } else if (summary.length) {
    const allEqual = summary.every((s) => s.requested == null || s.total == null || Math.abs(s.requested - s.total) < 0.005);
    issues.push({
      level: allEqual ? 'info' : 'warning',
      message: allEqual
        ? 'The summary has no funding rate but requested amounts equal total eligible costs, so 100 % is assumed.'
        : 'The summary has no funding rate; 100 % is assumed. Check requested amounts.',
    });
  }

  return {
    kind: 'budget',
    partners,
    categories: [...catNames.values()],
    lines,
    workPackages,
    summary,
    summaryTotal,
    pmSummary,
    pmBlocks,
    settings: { indirect_rate, funding_rate, rounding: 'partner', rounding_decimals: 0, rounding_mode: 'half_up' },
    issues,
  };
}

function findWpHeader(ws: Worksheet, row: number): [number, string][] | null {
  const out: [number, string][] = [];
  const r = ws.getRow(row);
  for (let c = 1; c <= ws.columnCount; c++) {
    const t = normWp(cellText(r.getCell(c)));
    if (/^WP\d+[A-Z]?$/.test(t)) out.push([c, t]);
  }
  return out.length ? out : null;
}

/* ---------------------------------------------------------- reconciliation */

export interface ReconItem {
  scope: string;
  check: string;
  source: string | null;
  computed: string;
  difference: string | null;
  status: 'ok' | 'difference' | 'missing';
  ref?: string;
}

const MONEY_TOL = new Big('0.005');
const PM_TOL = new Big('0.0001');

function cmp(scope: string, check: string, source: number | null | undefined, computed: Big, tol: Big, refText?: string, dp = 2): ReconItem {
  if (source == null) return { scope, check, source: null, computed: computed.round(dp).toString(), difference: null, status: 'missing', ref: refText };
  const s = toBig(source);
  const diff = computed.minus(s);
  return {
    scope,
    check,
    source: s.round(dp).toString(),
    computed: computed.round(dp).toString(),
    difference: diff.round(dp).toString(),
    status: diff.abs().lte(tol) ? 'ok' : 'difference',
    ref: refText,
  };
}

/** Compare the partner sheets, the consortium summary and recomputed values. */
export function reconcileBudget(p: ParsedBudget, settings: BudgetSettingsDraft = p.settings): ReconItem[] {
  const items: ReconItem[] = [];
  const catByName = new Map(p.categories.map((c) => [c.name, c]));
  const rate = toBig(settings.indirect_rate);
  const base = new Set(p.categories.filter((c) => c.indirect_base).map((c) => c.name));
  let totDirect = new Big(0);
  let totIndirect = new Big(0);
  for (const partner of p.partners.filter((x) => x.include)) {
    const pl = p.lines.filter((l) => l.include && l.partner === partner.key);
    const s = p.summary.find((x) => x.name.trim().toLowerCase() === partner.name.trim().toLowerCase());
    // direct costs per summary group
    for (const g of Object.keys(SUMMARY_GROUP_LABEL) as SummaryGroup[]) {
      const sum = pl.filter((l) => groupOfKind(catByName.get(l.category)?.kind ?? 'other_direct') === g).reduce((t, l) => t.plus(toBig(l.amount)), new Big(0));
      const src = s?.groups[g];
      if (src == null && sum.eq(0)) continue;
      items.push(cmp(partner.name, `${SUMMARY_GROUP_LABEL[g]}: partner sheet vs summary`, s ? (src ?? 0) : null, sum, MONEY_TOL, s?.ref));
    }
    const direct = pl.reduce((t, l) => t.plus(toBig(l.amount)), new Big(0));
    const { official } = partnerIndirect(
      pl.map((l) => ({ id: l.id, category_id: l.category, amount: l.amount })),
      base,
      rate,
      { rounding: settings.rounding, decimals: settings.rounding_decimals, mode: settings.rounding_mode },
    );
    totDirect = totDirect.plus(direct);
    totIndirect = totIndirect.plus(official);
    const lineIndirect = pl.some((l) => l.sourceIndirect != null) ? pl.reduce((t, l) => t.plus(toBig(l.sourceIndirect)), new Big(0)) : null;
    if (lineIndirect != null) items.push(cmp(partner.name, 'Indirect costs: recomputed vs partner-sheet lines', Number(lineIndirect.toString()), official, MONEY_TOL, partner.sheet));
    items.push(cmp(partner.name, 'Indirect costs: recomputed vs summary', s ? s.indirect : null, official, MONEY_TOL, s?.ref));
    items.push(cmp(partner.name, 'Total eligible costs: recomputed vs summary', s ? s.total : null, direct.plus(official), MONEY_TOL, s?.ref));
    // per-line source arithmetic
    let badLine = 0;
    let badTotal = 0;
    const examples: string[] = [];
    for (const l of pl) {
      const expected = base.has(l.category) ? toBig(l.amount).times(rate) : new Big(0);
      if (l.sourceIndirect != null && expected.minus(toBig(l.sourceIndirect)).abs().gt(MONEY_TOL)) {
        badLine++;
        if (examples.length < 3) examples.push(l.ref);
      }
      if (l.sourceTotal != null && l.sourceIndirect != null && toBig(l.amount).plus(toBig(l.sourceIndirect)).minus(toBig(l.sourceTotal)).abs().gt(MONEY_TOL)) badTotal++;
    }
    if (badLine)
      items.push({ scope: partner.name, check: `Line indirect ≠ ${rate.times(100).toString()} % of cost on ${badLine} line(s)`, source: null, computed: '', difference: null, status: 'difference', ref: examples.join(', ') });
    if (badTotal) items.push({ scope: partner.name, check: `Line total ≠ cost + indirect on ${badTotal} line(s)`, source: null, computed: '', difference: null, status: 'difference', ref: partner.sheet });
    // person-months per WP: lines vs partner block vs summary table
    const wps = new Set<string>([...Object.keys(p.pmBlocks[partner.key] ?? {}), ...Object.keys(p.pmSummary[partner.name] ?? {}), ...pl.filter((l) => l.wp && l.person_months).map((l) => l.wp!)]);
    for (const wp of [...wps].sort()) {
      const fromLines = pl.filter((l) => l.wp === wp).reduce((t, l) => t.plus(toBig(l.person_months)), new Big(0));
      const block = p.pmBlocks[partner.key]?.[wp];
      const table = p.pmSummary[partner.name]?.[wp];
      if (block != null) items.push(cmp(partner.name, `${wp} person-months: lines vs partner sheet block`, block, fromLines, PM_TOL, partner.sheet, 4));
      if (table != null) items.push(cmp(partner.name, `${wp} person-months: lines vs summary table`, table, fromLines, PM_TOL, undefined, 4));
    }
  }
  if (p.summaryTotal) {
    const st = p.summaryTotal;
    items.push(cmp('Consortium', 'Indirect costs: recomputed vs summary total', st.indirect, totIndirect, MONEY_TOL, st.ref));
    items.push(cmp('Consortium', 'Total eligible costs: recomputed vs summary total', st.total, totDirect.plus(totIndirect), MONEY_TOL, st.ref));
    const sumOfRows = p.summary.reduce((t, s) => t.plus(toBig(s.indirect)), new Big(0));
    items.push(cmp('Consortium', 'Summary total row vs sum of partner rows (indirect)', st.indirect, sumOfRows, MONEY_TOL, st.ref));
  }
  return items;
}

export interface ImportBudgetPayload {
  replace: boolean;
  settings: Record<string, unknown>;
  work_packages: { code: string; name: string }[];
  partners: { key: string; name: string; short_name: string; country: string; pm_rate: string | null; role: string }[];
  categories: { name: string; kind: string; indirect_base: boolean; code: string }[];
  lines: { partner: string; category: string; amount: string; year: number | null; wp: string | null; person_months: string | null; description: string; source_ref: string }[];
}

export function buildBudgetPayload(p: ParsedBudget, settings: BudgetSettingsDraft = p.settings, replace = true): ImportBudgetPayload {
  const included = new Set(p.partners.filter((x) => x.include).map((x) => x.key));
  const lines = p.lines.filter((l) => l.include && included.has(l.partner));
  const usedCats = new Set(lines.map((l) => l.category));
  const usedWps = new Set(lines.map((l) => l.wp).filter(Boolean) as string[]);
  return {
    replace,
    settings: { ...settings },
    work_packages: p.workPackages.filter((w) => usedWps.has(w.code) || w.name).map((w) => ({ code: w.code, name: w.name })),
    partners: p.partners.filter((x) => x.include).map((x) => ({ key: x.key, name: x.name, short_name: x.short_name, country: x.country, pm_rate: x.pm_rate, role: x.role })),
    categories: p.categories.filter((c) => usedCats.has(c.name)).map((c) => ({ name: c.name, kind: c.kind, indirect_base: c.indirect_base, code: '' })),
    lines: lines.map((l) => ({
      partner: l.partner,
      category: l.category,
      amount: roundAmount(toBig(l.amount), 2, 'half_up').toString(),
      year: l.year,
      wp: l.wp,
      person_months: l.person_months != null ? roundAmount(toBig(l.person_months), 4, 'half_up').toString() : null,
      description: l.description,
      source_ref: l.ref,
    })),
  };
}

export function budgetBlockers(p: ParsedBudget, s: BudgetSettingsDraft): string[] {
  const out: string[] = [];
  if (!p.partners.some((x) => x.include)) out.push('Include at least one partner.');
  const r = toBig(s.indirect_rate);
  if (r.lt(0) || r.gt(1)) out.push('The indirect rate must be between 0 and 1 (for example 0.25 for 25 %).');
  const f = toBig(s.funding_rate);
  if (f.lt(0) || f.gt(1)) out.push('The funding rate must be between 0 and 1.');
  for (const l of p.lines) if (l.include && l.amount < 0) out.push(`Negative amount at ${l.ref}.`);
  for (const pt of p.partners) if (pt.include && !pt.name.trim()) out.push(`A partner has no name (${pt.sheet}).`);
  return out;
}

/* ================================================================= EXPORT */

export interface PlanExport {
  projectName: string;
  startDate: string;
  months: number;
  workPackages: { code: string; name: string; lead: string }[];
  rows: { wp: string; kind: 'task' | 'activity'; title: string; responsible: string; planned: number[]; due: number[]; done: number[] }[];
  milestones: { code: string; title: string; wp: string; due_date: string | null; verification: string; status: MilestoneStatus; notes: string }[];
}

const solid = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${hex}` } });

/** Build a plan workbook mirroring the office layout (re-importable). */
export async function buildPlanWorkbook(d: PlanExport): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tessera';
  const start = new Date(`${d.startDate}T00:00:00Z`);
  const ov = wb.addWorksheet('Overview');
  ov.getCell('A1').value = d.projectName;
  ov.getCell('A1').font = { bold: true, size: 14 };
  const monthName = start.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  ov.getCell('A3').value = 'Duration:';
  ov.getCell('B3').value = `${d.months} months (M1 = ${monthName} ${start.getUTCFullYear()})`;
  ov.getCell('A5').value = 'LEGEND';
  ov.getCell('A5').font = { bold: true };
  const legend: [string, string][] = [
    ['128A9A', 'Planned / ongoing activity in this month'],
    ['FFC000', 'Milestone, deliverable or report due'],
    ['92D050', 'Completed'],
    ['DCE6F1', 'Task header row'],
  ];
  legend.forEach(([hex, text], i) => {
    ov.getCell(`A${6 + i}`).fill = solid(hex);
    ov.getCell(`B${6 + i}`).value = text;
  });
  ov.getColumn(2).width = 48;

  for (const wp of d.workPackages) {
    const ws = wb.addWorksheet(wp.code.slice(0, 31));
    ws.getCell('A1').value = `${wp.code} - ${wp.name}`;
    ws.getCell('A1').font = { bold: true, size: 12 };
    ws.getCell('B1').value = wp.lead ? `Lead: ${wp.lead}` : '';
    const hdr = ws.getRow(3);
    hdr.getCell(1).value = 'TASK / ACTIVITY';
    hdr.getCell(2).value = 'Responsible';
    const dates = ws.getRow(4);
    for (let m = 1; m <= d.months; m++) {
      hdr.getCell(2 + m).value = `M${m}`;
      dates.getCell(2 + m).value = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m - 1, 1));
      dates.getCell(2 + m).numFmt = 'mmm yy';
      ws.getColumn(2 + m).width = 6;
    }
    hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hdr.eachCell((c) => (c.fill = solid('1F3864')));
    ws.getColumn(1).width = 60;
    ws.getColumn(2).width = 22;
    let r = 5;
    for (const row of d.rows.filter((x) => x.wp === wp.code)) {
      const xr = ws.getRow(r++);
      xr.getCell(1).value = row.title;
      xr.getCell(2).value = row.responsible;
      if (row.kind === 'task') {
        xr.getCell(1).fill = solid('DCE6F1');
        xr.getCell(2).fill = solid('DCE6F1');
        xr.font = { bold: true };
      }
      for (const m of row.planned) if (m >= 1 && m <= d.months) xr.getCell(2 + m).fill = solid('128A9A');
      for (const m of row.due) if (m >= 1 && m <= d.months) xr.getCell(2 + m).fill = solid('FFC000');
      for (const m of row.done) if (m >= 1 && m <= d.months) xr.getCell(2 + m).fill = solid('92D050');
    }
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];
  }

  const ms = wb.addWorksheet('Milestones');
  ms.getCell('A1').value = 'Internal milestones and control points';
  ms.getCell('A1').font = { bold: true };
  const h = ms.getRow(3);
  ['#', 'Milestone / control point', 'WP', 'Due date', 'Means of verification / evidence', 'Status', 'Notes'].forEach((t, i) => (h.getCell(i + 1).value = t));
  h.font = { bold: true };
  d.milestones.forEach((m, i) => {
    const r = ms.getRow(4 + i);
    r.getCell(1).value = m.code || String(i + 1);
    r.getCell(2).value = m.title;
    r.getCell(3).value = m.wp;
    if (m.due_date) {
      r.getCell(4).value = new Date(`${m.due_date}T00:00:00Z`);
      r.getCell(4).numFmt = 'dd mmm yyyy';
    }
    r.getCell(5).value = m.verification;
    r.getCell(6).value = STATUS_LABEL[m.status];
    r.getCell(7).value = m.notes;
  });
  [6, 50, 8, 14, 50, 12, 40].forEach((w, i) => (ms.getColumn(i + 1).width = w));
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export interface BudgetExportPartner {
  name: string;
  short: string;
  country: string;
  groups: Record<SummaryGroup, string>;
  indirect: string;
  total: string;
  fundingRate: string;
  requested: string;
  pmByWp: Record<string, string>;
  lines: { category: string; amount: string; indirect: string; total: string; year: number | null; wp: string | null; pms: string | null; description: string }[];
}
export interface BudgetExport {
  title: string;
  currency: string;
  coordinator: string;
  indirectRatePct: string;
  partners: BudgetExportPartner[];
  workPackages: { code: string; name: string }[];
}

/** Build a consortium budget workbook (summary + one sheet per partner), re-importable. */
export async function buildBudgetWorkbook(d: BudgetExport): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tessera';
  const fmt = '#,##0.00';
  const sum = wb.addWorksheet('Consortium budget');
  sum.getCell('A1').value = d.title;
  sum.getCell('A1').font = { bold: true, size: 13 };
  sum.getCell('A3').value = 'Coordinator';
  sum.getCell('B3').value = d.coordinator;
  sum.getCell('A4').value = 'Currency';
  sum.getCell('B4').value = d.currency;
  const groups: SummaryGroup[] = ['personnel', 'subcontracting', 'travel', 'equipment', 'other', 'other_categories'];
  const header = [
    'Institution Name',
    'Country',
    '(A) Direct personnel costs',
    '(B) Subcontracting costs',
    '(C1) Travel and subsistence',
    '(C2) Equipment',
    '(C3) Other goods, works and services',
    '(D) Other cost categories',
    `(E) Indirect costs (${d.indirectRatePct} %)`,
    '(F) Total eligible costs',
    'Funding rate',
    'Requested contribution',
  ];
  const hr = sum.getRow(6);
  header.forEach((t, i) => (hr.getCell(i + 1).value = t));
  hr.font = { bold: true };
  hr.alignment = { wrapText: true, vertical: 'top' };
  let r = 8;
  for (const p of d.partners) {
    const row = sum.getRow(r++);
    row.getCell(1).value = p.name;
    row.getCell(2).value = p.country;
    groups.forEach((g, i) => (row.getCell(3 + i).value = Number(p.groups[g])));
    row.getCell(9).value = Number(p.indirect);
    row.getCell(10).value = Number(p.total);
    row.getCell(11).value = Number(p.fundingRate);
    row.getCell(12).value = Number(p.requested);
  }
  const tr = sum.getRow(r);
  tr.getCell(1).value = 'Total';
  tr.font = { bold: true };
  for (let c = 3; c <= 12; c++) {
    if (c === 11) continue;
    const L = colLetter(c);
    tr.getCell(c).value = { formula: `SUM(${L}8:${L}${r - 1})`, result: d.partners.reduce((t, p) => t + (c <= 8 ? Number(p.groups[groups[c - 3]]) : c === 9 ? Number(p.indirect) : c === 10 ? Number(p.total) : Number(p.requested)), 0) };
  }
  for (let c = 3; c <= 12; c++) sum.getColumn(c).numFmt = c === 11 ? '0%' : fmt;
  sum.getColumn(1).width = 44;
  for (let c = 2; c <= 12; c++) sum.getColumn(c).width = 16;
  // PM table
  r += 3;
  sum.getCell(`A${r}`).value = 'Person Months per WP';
  sum.getCell(`A${r}`).font = { bold: true };
  r += 1;
  const wpCodes = d.workPackages.map((w) => w.code);
  const pmh = sum.getRow(r++);
  pmh.getCell(1).value = 'Partner';
  wpCodes.forEach((w, i) => (pmh.getCell(2 + i).value = w));
  pmh.getCell(2 + wpCodes.length).value = 'TOTAL PMs';
  pmh.font = { bold: true };
  for (const p of d.partners) {
    const row = sum.getRow(r++);
    row.getCell(1).value = p.name;
    let t = 0;
    wpCodes.forEach((w, i) => {
      const v = Number(p.pmByWp[w] ?? 0);
      t += v;
      row.getCell(2 + i).value = v;
    });
    row.getCell(2 + wpCodes.length).value = Math.round(t * 10000) / 10000;
  }
  r += 2;
  sum.getCell(`A${r}`).value = 'Work Packages';
  sum.getCell(`A${r}`).font = { bold: true };
  r += 1;
  sum.getRow(r).getCell(1).value = 'ID';
  sum.getRow(r).getCell(2).value = 'Title';
  r += 1;
  for (const w of d.workPackages) {
    sum.getRow(r).getCell(1).value = w.code;
    sum.getRow(r++).getCell(2).value = w.name;
  }

  const used = new Set<string>();
  for (const p of d.partners) {
    let name = `${(p.short || p.name).slice(0, 24)} Budget`.replace(/[\\/?*[\]:]/g, ' ');
    while (used.has(name)) name = name.slice(0, 28) + '_' + used.size;
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.getCell('A2').value = 'Partner Name';
    ws.getCell('B2').value = p.name;
    ws.getCell('A3').value = 'Currency';
    ws.getCell('B3').value = d.currency;
    const h = ws.getRow(5);
    ['Cost Category', 'Cost', 'Indirect costs', 'Total Cost', 'Year', 'Work Package', 'PMs (personnel only)', 'Cost Explanation'].forEach((t, i) => (h.getCell(i + 1).value = t));
    h.font = { bold: true };
    let rr = 6;
    for (const l of p.lines) {
      const row = ws.getRow(rr++);
      row.getCell(1).value = l.category;
      row.getCell(2).value = Number(l.amount);
      row.getCell(3).value = Number(l.indirect);
      row.getCell(4).value = Number(l.total);
      row.getCell(5).value = l.year;
      row.getCell(6).value = l.wp;
      row.getCell(7).value = l.pms != null ? Number(l.pms) : null;
      row.getCell(8).value = l.description;
    }
    [2, 3, 4].forEach((c) => (ws.getColumn(c).numFmt = fmt));
    ws.getColumn(1).width = 30;
    ws.getColumn(8).width = 60;
    rr += 2;
    ws.getCell(`A${rr}`).value = 'Person Months per WPs';
    ws.getCell(`A${rr}`).font = { bold: true };
    rr += 1;
    const ph = ws.getRow(rr);
    wpCodes.forEach((w, i) => (ph.getCell(1 + i).value = w));
    ph.getCell(1 + wpCodes.length).value = 'TOTAL PMs';
    const pv = ws.getRow(rr + 1);
    let t = 0;
    wpCodes.forEach((w, i) => {
      const v = Number(p.pmByWp[w] ?? 0);
      t += v;
      pv.getCell(1 + i).value = v;
    });
    pv.getCell(1 + wpCodes.length).value = Math.round(t * 10000) / 10000;
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
