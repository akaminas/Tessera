/**
 * Budget engine. All money arithmetic uses big.js (exact decimals); rounding is
 * explicit and configurable. Nothing here invents values: every figure is
 * derived from the budget lines, expenditures and settings passed in.
 *
 * Definitions (direct = cost before indirect costs):
 *   planned    Σ budget line amounts (direct)
 *   indirect   indirect rate × planned direct costs in categories that form the
 *              indirect base (subcontracting / third-party support usually excluded)
 *   eligible   planned + indirect
 *   requested  eligible × funding rate (partner override possible)
 *   committed  Σ committed expenditures (direct)
 *   actual     Σ actual expenditures (direct)
 *   forecast   max(Σ (line forecast ?? line amount), actual + committed)
 *   remaining  planned − actual − committed
 *   utilisation actual ÷ planned
 *   variance   forecast − planned (positive = projected overspend)
 */
import Big from 'big.js';
import type { ProjectFunding } from '@/data/types';

export type RoundingLevel = 'none' | 'line' | 'category' | 'partner';
export type RoundingMode = 'half_up' | 'half_even' | 'up' | 'down';
export type CategoryKind = 'personnel' | 'subcontracting' | 'travel' | 'equipment' | 'other' | 'third_party' | 'internal' | 'other_direct';

export interface FinanceSettings {
  indirectRate: Big;
  fundingRate: Big;
  rounding: RoundingLevel;
  decimals: number;
  mode: RoundingMode;
  hoursPerPm: number;
}

export const DEFAULT_SETTINGS: FinanceSettings = {
  indirectRate: new Big(0),
  fundingRate: new Big(1),
  rounding: 'none',
  decimals: 2,
  mode: 'half_up',
  hoursPerPm: 140,
};

export type Num = string | number | null | undefined | Big;

/** Convert database values (numeric arrives as string or number) to Big; null → 0. */
export function toBig(v: Num): Big {
  if (v == null || v === '') return new Big(0);
  if (v instanceof Big) return v;
  const s = typeof v === 'number' ? String(v) : v.trim().replace(/\s/g, '').replace(',', '.');
  try {
    return new Big(s);
  } catch {
    return new Big(0);
  }
}

export function isNumberLike(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string' || !v.trim()) return false;
  try {
    new Big(v.trim().replace(',', '.'));
    return true;
  } catch {
    return false;
  }
}

const RM: Record<RoundingMode, 0 | 1 | 2 | 3> = { down: 0, half_up: 1, half_even: 2, up: 3 };

/** Round to `decimals` places with the chosen mode (up/down are away from/towards zero). */
export function roundAmount(x: Big, decimals: number, mode: RoundingMode): Big {
  return x.round(Math.max(0, Math.min(6, decimals)), RM[mode]);
}

export function settingsFromFunding(f: ProjectFunding | null | undefined): FinanceSettings {
  const rate = (v: unknown, d: Big) => (isNumberLike(v) ? toBig(v as string) : d);
  const rounding = (['none', 'line', 'category', 'partner'] as const).includes(f?.rounding as RoundingLevel) ? (f!.rounding as RoundingLevel) : 'none';
  const mode = (['half_up', 'half_even', 'up', 'down'] as const).includes(f?.rounding_mode as RoundingMode) ? (f!.rounding_mode as RoundingMode) : 'half_up';
  return {
    indirectRate: rate(f?.indirect_rate, DEFAULT_SETTINGS.indirectRate),
    fundingRate: rate(f?.funding_rate, DEFAULT_SETTINGS.fundingRate),
    rounding,
    decimals: typeof f?.rounding_decimals === 'number' ? f.rounding_decimals : rounding === 'none' ? 2 : 0,
    mode,
    hoursPerPm: typeof f?.hours_per_pm === 'number' && f.hours_per_pm > 0 ? f.hours_per_pm : DEFAULT_SETTINGS.hoursPerPm,
  };
}

/* ------------------------------------------------------------------ inputs */

export interface FCategory {
  id: string;
  name: string;
  kind: CategoryKind | string;
  indirect_base: boolean;
}
export interface FPartner {
  id: string;
  name: string;
  pm_rate?: Num;
  funding_rate?: Num;
  indirect_rate?: Num;
}
export interface FLine {
  id: string;
  partner_id: string | null;
  work_package_id: string | null;
  category_id: string;
  financial_year: number | null;
  reporting_period_id: string | null;
  amount: Num;
  person_months?: Num;
  forecast_amount?: Num;
}
export interface FExpenditure {
  id: string;
  partner_id: string | null;
  work_package_id: string | null;
  category_id: string;
  budget_line_id?: string | null;
  reporting_period_id: string | null;
  spent_on: string;
  amount: Num;
  status: 'committed' | 'actual';
  person_months?: Num;
  deleted_at?: string | null;
}

export interface BudgetInput {
  categories: FCategory[];
  partners: FPartner[];
  lines: FLine[];
  expenditures: FExpenditure[];
  settings: FinanceSettings;
}

/* ----------------------------------------------------------------- outputs */

export interface Totals {
  planned: Big;
  indirect: Big;
  eligible: Big;
  requested: Big;
  committed: Big;
  actual: Big;
  actualIndirect: Big;
  forecast: Big;
  remaining: Big;
  variance: Big;
  /** actual ÷ planned as a fraction, or null when nothing is planned */
  utilisation: number | null;
  plannedPm: Big;
  actualPm: Big;
}

interface Acc {
  planned: Big;
  indirect: Big;
  requested: Big;
  committed: Big;
  actual: Big;
  actualIndirect: Big;
  lineForecast: Big;
  plannedPm: Big;
  actualPm: Big;
}
const accZero = (): Acc => {
  const z = new Big(0);
  return { planned: z, indirect: z, requested: z, committed: z, actual: z, actualIndirect: z, lineForecast: z, plannedPm: z, actualPm: z };
};

function finish(a: Acc): Totals {
  const eligible = a.planned.plus(a.indirect);
  const spent = a.actual.plus(a.committed);
  const forecast = spent.gt(a.lineForecast) ? spent : a.lineForecast;
  return {
    planned: a.planned,
    indirect: a.indirect,
    eligible,
    requested: a.requested,
    committed: a.committed,
    actual: a.actual,
    actualIndirect: a.actualIndirect,
    forecast,
    remaining: a.planned.minus(spent),
    variance: forecast.minus(a.planned),
    utilisation: a.planned.gt(0) ? Number(a.actual.div(a.planned).toFixed(6)) : null,
    plannedPm: a.plannedPm,
    actualPm: a.actualPm,
  };
}

export interface LineResult {
  id: string;
  direct: Big;
  /** unrounded (or line-rounded) indirect attributable to this line */
  indirect: Big;
  total: Big;
  inBase: boolean;
}

export interface PartnerResult extends Totals {
  partnerId: string | null;
  /** share of total eligible costs (0–1) */
  share: number | null;
  /** personnel reconciliation: Σ planned PM × PM rate vs personnel lines */
  personnelBudget: Big;
  personnelFromRate: Big | null;
  pmRate: Big | null;
  indirectRate: Big;
  fundingRate: Big;
}

export interface BudgetResult {
  total: Totals;
  byPartner: PartnerResult[];
  byCategory: Map<string, Totals>;
  byWorkPackage: Map<string, Totals>; // key 'none' for unassigned
  byYear: Map<string, Totals>; // key 'none' when no year
  byPeriod: Map<string, Totals>;
  lines: Map<string, LineResult>;
  /** official indirect (after rounding rule) minus Σ line-level indirect; dimension breakdowns use line-level values */
  roundingAdjustment: Big;
}

/**
 * Indirect costs for one partner under the rounding rule.
 * Returns official total and per-line attributions (line-level values).
 */
export function partnerIndirect(
  lines: { id: string; category_id: string; amount: Num }[],
  baseCategories: Set<string>,
  rate: Big,
  s: Pick<FinanceSettings, 'rounding' | 'decimals' | 'mode'>,
): { official: Big; perLine: Map<string, Big> } {
  const perLine = new Map<string, Big>();
  let official = new Big(0);
  const byCat = new Map<string, Big>();
  let base = new Big(0);
  for (const l of lines) {
    const inBase = baseCategories.has(l.category_id);
    let ind = inBase ? toBig(l.amount).times(rate) : new Big(0);
    if (s.rounding === 'line') ind = roundAmount(ind, s.decimals, s.mode);
    perLine.set(l.id, ind);
    if (inBase) {
      base = base.plus(toBig(l.amount));
      byCat.set(l.category_id, (byCat.get(l.category_id) ?? new Big(0)).plus(toBig(l.amount)));
    }
  }
  switch (s.rounding) {
    case 'none':
      official = base.times(rate);
      break;
    case 'line':
      for (const v of perLine.values()) official = official.plus(v);
      break;
    case 'category':
      for (const v of byCat.values()) official = official.plus(roundAmount(v.times(rate), s.decimals, s.mode));
      break;
    case 'partner':
      official = roundAmount(base.times(rate), s.decimals, s.mode);
      break;
  }
  return { official, perLine };
}

export function computeBudget(input: BudgetInput): BudgetResult {
  const { settings: s } = input;
  const base = new Set(input.categories.filter((c) => c.indirect_base).map((c) => c.id));
  const partnerById = new Map(input.partners.map((p) => [p.id, p]));
  const personnelCats = new Set(input.categories.filter((c) => c.kind === 'personnel').map((c) => c.id));
  const exps = input.expenditures.filter((e) => !e.deleted_at);

  const rateFor = (pid: string | null) => {
    const p = pid ? partnerById.get(pid) : undefined;
    return {
      indirect: p && isNumberLike(p.indirect_rate as string) ? toBig(p.indirect_rate) : s.indirectRate,
      funding: p && isNumberLike(p.funding_rate as string) ? toBig(p.funding_rate) : s.fundingRate,
    };
  };

  // group lines by partner ('' = unassigned)
  const partnerKeys = new Set<string>([...input.partners.map((p) => p.id), ...input.lines.map((l) => l.partner_id ?? ''), ...exps.map((e) => e.partner_id ?? '')]);
  const lineResults = new Map<string, LineResult>();
  const partnerOfficial = new Map<string, Big>();
  let lineLevelIndirectSum = new Big(0);

  for (const key of partnerKeys) {
    const pl = input.lines.filter((l) => (l.partner_id ?? '') === key);
    const r = rateFor(key || null);
    const { official, perLine } = partnerIndirect(pl, base, r.indirect, s);
    partnerOfficial.set(key, official);
    for (const l of pl) {
      const ind = perLine.get(l.id) ?? new Big(0);
      lineLevelIndirectSum = lineLevelIndirectSum.plus(ind);
      lineResults.set(l.id, { id: l.id, direct: toBig(l.amount), indirect: ind, total: toBig(l.amount).plus(ind), inBase: base.has(l.category_id) });
    }
  }

  const dims = {
    category: new Map<string, Acc>(),
    wp: new Map<string, Acc>(),
    year: new Map<string, Acc>(),
    period: new Map<string, Acc>(),
    partner: new Map<string, Acc>(),
  };
  const get = (m: Map<string, Acc>, k: string) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = accZero()));
    return a;
  };
  const addLine = (a: Acc, l: FLine, lr: LineResult, fundingRate: Big) => {
    a.planned = a.planned.plus(lr.direct);
    a.indirect = a.indirect.plus(lr.indirect);
    a.requested = a.requested.plus(lr.total.times(fundingRate));
    a.lineForecast = a.lineForecast.plus(l.forecast_amount != null && l.forecast_amount !== '' ? toBig(l.forecast_amount) : lr.direct);
    a.plannedPm = a.plannedPm.plus(toBig(l.person_months));
  };
  const yearOf = (d: string) => d.slice(0, 4);

  for (const l of input.lines) {
    const lr = lineResults.get(l.id)!;
    const fr = rateFor(l.partner_id).funding;
    addLine(get(dims.category, l.category_id), l, lr, fr);
    addLine(get(dims.wp, l.work_package_id ?? 'none'), l, lr, fr);
    addLine(get(dims.year, l.financial_year != null ? String(l.financial_year) : 'none'), l, lr, fr);
    addLine(get(dims.period, l.reporting_period_id ?? 'none'), l, lr, fr);
    addLine(get(dims.partner, l.partner_id ?? ''), l, lr, fr);
  }
  const addExp = (a: Acc, e: FExpenditure) => {
    const amt = toBig(e.amount);
    if (e.status === 'committed') a.committed = a.committed.plus(amt);
    else {
      a.actual = a.actual.plus(amt);
      a.actualPm = a.actualPm.plus(toBig(e.person_months));
      if (base.has(e.category_id)) a.actualIndirect = a.actualIndirect.plus(amt.times(rateFor(e.partner_id).indirect));
    }
  };
  for (const e of exps) {
    addExp(get(dims.category, e.category_id), e);
    addExp(get(dims.wp, e.work_package_id ?? 'none'), e);
    addExp(get(dims.year, yearOf(e.spent_on)), e);
    addExp(get(dims.period, e.reporting_period_id ?? 'none'), e);
    addExp(get(dims.partner, e.partner_id ?? ''), e);
  }

  // Partner totals use the official (rounded) indirect.
  const byPartner: PartnerResult[] = [];
  let totalAcc = accZero();
  for (const key of partnerKeys) {
    const a = get(dims.partner, key);
    const official = partnerOfficial.get(key) ?? new Big(0);
    const r = rateFor(key || null);
    a.indirect = official;
    let requested = a.planned.plus(official).times(r.funding);
    if (s.rounding !== 'none') requested = roundAmount(requested, s.decimals, s.mode);
    a.requested = requested;
    const p = key ? partnerById.get(key) : undefined;
    const pmRate = p && isNumberLike(p.pm_rate as string) ? toBig(p.pm_rate) : null;
    const pl = input.lines.filter((l) => (l.partner_id ?? '') === key);
    const personnelBudget = pl.filter((l) => personnelCats.has(l.category_id)).reduce((t, l) => t.plus(toBig(l.amount)), new Big(0));
    const pms = pl.filter((l) => personnelCats.has(l.category_id)).reduce((t, l) => t.plus(toBig(l.person_months)), new Big(0));
    if (!key && pl.length === 0 && !exps.some((e) => !e.partner_id)) continue;
    byPartner.push({
      ...finish(a),
      partnerId: key || null,
      share: null,
      personnelBudget,
      personnelFromRate: pmRate ? roundAmount(pms.times(pmRate), 2, 'half_up') : null,
      pmRate,
      indirectRate: r.indirect,
      fundingRate: r.funding,
    });
    totalAcc = {
      planned: totalAcc.planned.plus(a.planned),
      indirect: totalAcc.indirect.plus(a.indirect),
      requested: totalAcc.requested.plus(a.requested),
      committed: totalAcc.committed.plus(a.committed),
      actual: totalAcc.actual.plus(a.actual),
      actualIndirect: totalAcc.actualIndirect.plus(a.actualIndirect),
      lineForecast: totalAcc.lineForecast.plus(a.lineForecast),
      plannedPm: totalAcc.plannedPm.plus(a.plannedPm),
      actualPm: totalAcc.actualPm.plus(a.actualPm),
    };
  }
  const total = finish(totalAcc);
  for (const p of byPartner) p.share = total.eligible.gt(0) ? Number(p.eligible.div(total.eligible).toFixed(6)) : null;
  // forecast per partner must be computed per partner (not summed) — finish() already did; total forecast is Σ of partner-level max()
  total.forecast = byPartner.reduce((t, p) => t.plus(p.forecast), new Big(0));
  total.variance = total.forecast.minus(total.planned);

  const finishMap = (m: Map<string, Acc>) => new Map([...m.entries()].map(([k, a]) => [k, finish(a)]));
  return {
    total,
    byPartner,
    byCategory: finishMap(dims.category),
    byWorkPackage: finishMap(dims.wp),
    byYear: finishMap(dims.year),
    byPeriod: finishMap(dims.period),
    lines: lineResults,
    roundingAdjustment: total.indirect.minus(lineLevelIndirectSum),
  };
}

/* ------------------------------------------------------------------ effort */

export function minutesToPm(minutes: number, hoursPerPm: number): Big {
  if (!minutes || hoursPerPm <= 0) return new Big(0);
  return new Big(minutes).div(60).div(hoursPerPm);
}

export interface EffortInput {
  /** planned PM from budget lines (per partner/WP) */
  lines: { partner_id: string | null; work_package_id: string | null; person_months?: Num }[];
  allocations: { partner_id: string | null; work_package_id: string | null; planned_pm: Num; user_id?: string | null }[];
  reports: { partner_id: string | null; work_package_id: string | null; actual_pm: Num; user_id?: string | null }[];
  /** logged minutes already mapped to partner/WP */
  time: { partner_id: string | null; work_package_id: string | null; minutes: number }[];
  hoursPerPm: number;
}

export interface EffortCell {
  budgetPm: Big;
  allocatedPm: Big;
  reportedPm: Big;
  loggedPm: Big;
  /** reported + logged */
  actualPm: Big;
  remainingPm: Big;
}

/** Person-month matrix keyed `${partner}|${wp}` ('' for unassigned). */
export function computeEffort(input: EffortInput): Map<string, EffortCell> {
  const m = new Map<string, EffortCell>();
  const cell = (p: string | null, w: string | null) => {
    const k = `${p ?? ''}|${w ?? ''}`;
    let c = m.get(k);
    if (!c) {
      const z = new Big(0);
      c = { budgetPm: z, allocatedPm: z, reportedPm: z, loggedPm: z, actualPm: z, remainingPm: z };
      m.set(k, c);
    }
    return c;
  };
  for (const l of input.lines) {
    if (l.person_months == null || l.person_months === '') continue;
    const c = cell(l.partner_id, l.work_package_id);
    c.budgetPm = c.budgetPm.plus(toBig(l.person_months));
  }
  for (const a of input.allocations) {
    const c = cell(a.partner_id, a.work_package_id);
    c.allocatedPm = c.allocatedPm.plus(toBig(a.planned_pm));
  }
  for (const r of input.reports) {
    const c = cell(r.partner_id, r.work_package_id);
    c.reportedPm = c.reportedPm.plus(toBig(r.actual_pm));
  }
  for (const t of input.time) {
    const c = cell(t.partner_id, t.work_package_id);
    c.loggedPm = c.loggedPm.plus(minutesToPm(t.minutes, input.hoursPerPm));
  }
  for (const c of m.values()) {
    c.actualPm = c.reportedPm.plus(c.loggedPm);
    const plan = c.budgetPm.gt(0) ? c.budgetPm : c.allocatedPm;
    c.remainingPm = plan.minus(c.actualPm);
  }
  return m;
}

/* -------------------------------------------------------------- formatting */

export function money(v: Big | number | null | undefined, currency = 'EUR', decimals = 2): string {
  if (v == null) return '—';
  const n = typeof v === 'number' ? v : Number(v.toFixed(decimals));
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      .format(n)
      .replace('-', '−');
  } catch {
    return `${n.toFixed(decimals)} ${currency}`;
  }
}

export function num(v: Big | number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  const n = typeof v === 'number' ? v : Number(v.toFixed(decimals));
  return n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: decimals }).replace('-', '−');
}

export function pct(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(decimals)} %`;
}

/** Infer a category kind from a free-text name (used by imports). */
export function inferCategoryKind(name: string): CategoryKind {
  const n = name.toLowerCase();
  if (/personnel|staff|salar/.test(n)) return 'personnel';
  if (/subcontract/.test(n)) return 'subcontracting';
  if (/travel|subsistence|mission/.test(n)) return 'travel';
  if (/equipment|depreciation/.test(n)) return 'equipment';
  if (/third part|financial support/.test(n)) return 'third_party';
  if (/internal|invoiced/.test(n)) return 'internal';
  if (/other goods|goods|services|consumable/.test(n)) return 'other';
  return 'other_direct';
}

/** Conventional indirect-base membership: everything except subcontracting and support to third parties. */
export function defaultIndirectBase(kind: CategoryKind | string): boolean {
  return kind !== 'subcontracting' && kind !== 'third_party';
}
