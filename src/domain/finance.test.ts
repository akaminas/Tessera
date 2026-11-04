import { describe, expect, it } from 'vitest';
import Big from 'big.js';
import { computeBudget, computeEffort, inferCategoryKind, minutesToPm, partnerIndirect, roundAmount, settingsFromFunding, toBig, type BudgetInput } from './finance';

const cats = [
  { id: 'pers', name: 'Direct Personnel', kind: 'personnel', indirect_base: true },
  { id: 'trav', name: 'Travel', kind: 'travel', indirect_base: true },
  { id: 'sub', name: 'Subcontracting', kind: 'subcontracting', indirect_base: false },
];

describe('rounding', () => {
  it('applies explicit modes', () => {
    expect(roundAmount(new Big('2.5'), 0, 'half_up').toString()).toBe('3');
    expect(roundAmount(new Big('2.5'), 0, 'half_even').toString()).toBe('2');
    expect(roundAmount(new Big('2.1'), 0, 'up').toString()).toBe('3');
    expect(roundAmount(new Big('2.9'), 0, 'down').toString()).toBe('2');
    expect(roundAmount(new Big('-2.5'), 0, 'half_up').toString()).toBe('-3');
    expect(roundAmount(new Big('0.125'), 2, 'half_even').toString()).toBe('0.12');
  });
  it('parses amounts exactly', () => {
    expect(toBig(0.1).plus(toBig(0.2)).toString()).toBe('0.3');
    expect(toBig('1 234,5').toString()).toBe('1234.5');
    expect(toBig(null).toString()).toBe('0');
  });
  it('reads settings from project funding with safe defaults', () => {
    const s = settingsFromFunding({ indirect_rate: '0.25', funding_rate: '0.7', rounding: 'partner', rounding_decimals: 0, rounding_mode: 'half_up', hours_per_pm: 133 });
    expect(s.indirectRate.toString()).toBe('0.25');
    expect(s.fundingRate.toString()).toBe('0.7');
    expect(s.rounding).toBe('partner');
    expect(s.hoursPerPm).toBe(133);
    const d = settingsFromFunding({});
    expect(d.indirectRate.toString()).toBe('0');
    expect(d.fundingRate.toString()).toBe('1');
    expect(d.rounding).toBe('none');
  });
});

describe('indirect costs under each rounding level', () => {
  // two personnel lines of 1 250 and 1 875 and travel 650 at 25 %
  const lines = [
    { id: 'a', category_id: 'pers', amount: '1250' },
    { id: 'b', category_id: 'pers', amount: '1875' },
    { id: 'c', category_id: 'trav', amount: '650.10' },
    { id: 'd', category_id: 'sub', amount: '999' },
  ];
  const base = new Set(['pers', 'trav']);
  const rate = new Big('0.25');
  it('none: exact', () => {
    expect(partnerIndirect(lines, base, rate, { rounding: 'none', decimals: 0, mode: 'half_up' }).official.toString()).toBe('943.775');
  });
  it('line: rounds every line', () => {
    // 312.5→313, 468.75→469, 162.525→163
    expect(partnerIndirect(lines, base, rate, { rounding: 'line', decimals: 0, mode: 'half_up' }).official.toString()).toBe('945');
  });
  it('category: rounds per category', () => {
    // personnel 781.25→781, travel 162.525→163
    expect(partnerIndirect(lines, base, rate, { rounding: 'category', decimals: 0, mode: 'half_up' }).official.toString()).toBe('944');
  });
  it('partner: rounds the total once', () => {
    expect(partnerIndirect(lines, base, rate, { rounding: 'partner', decimals: 0, mode: 'half_up' }).official.toString()).toBe('944');
  });
  it('excludes categories outside the base', () => {
    const r = partnerIndirect(lines, base, rate, { rounding: 'none', decimals: 2, mode: 'half_up' });
    expect(r.perLine.get('d')!.toString()).toBe('0');
  });
});

function input(over: Partial<BudgetInput> = {}): BudgetInput {
  return {
    categories: cats,
    partners: [
      { id: 'P1', name: 'Alpha', pm_rate: '5000' },
      { id: 'P2', name: 'Beta', pm_rate: '4000', funding_rate: '0.5' },
    ],
    lines: [
      { id: 'l1', partner_id: 'P1', work_package_id: 'W1', category_id: 'pers', financial_year: 2026, reporting_period_id: 'R1', amount: '10000', person_months: '2' },
      { id: 'l2', partner_id: 'P1', work_package_id: 'W2', category_id: 'trav', financial_year: 2027, reporting_period_id: 'R2', amount: '1250.50' },
      { id: 'l3', partner_id: 'P2', work_package_id: 'W2', category_id: 'sub', financial_year: 2027, reporting_period_id: 'R2', amount: '3000', forecast_amount: '3500' },
      { id: 'l4', partner_id: 'P2', work_package_id: 'W1', category_id: 'pers', financial_year: 2026, reporting_period_id: 'R1', amount: '8000', person_months: '2.5' },
    ],
    expenditures: [
      { id: 'e1', partner_id: 'P1', work_package_id: 'W1', category_id: 'pers', reporting_period_id: 'R1', spent_on: '2026-10-31', amount: '4000', status: 'actual', person_months: '0.8' },
      { id: 'e2', partner_id: 'P1', work_package_id: 'W2', category_id: 'trav', reporting_period_id: 'R2', spent_on: '2027-02-01', amount: '312.40', status: 'committed' },
      { id: 'e3', partner_id: 'P2', work_package_id: 'W2', category_id: 'sub', reporting_period_id: 'R2', spent_on: '2027-03-01', amount: '100', status: 'actual', deleted_at: '2027-03-02' },
    ],
    settings: settingsFromFunding({ indirect_rate: '0.25', funding_rate: '1', rounding: 'partner', rounding_decimals: 0, rounding_mode: 'half_up' }),
    ...over,
  };
}

describe('computeBudget', () => {
  const r = computeBudget(input());
  const p1 = r.byPartner.find((p) => p.partnerId === 'P1')!;
  const p2 = r.byPartner.find((p) => p.partnerId === 'P2')!;

  it('computes partner totals with the rounding rule and partner overrides', () => {
    // P1: direct 11 250.50, indirect 0.25 × 11 250.50 = 2 812.625 → 2 813
    expect(p1.planned.toString()).toBe('11250.5');
    expect(p1.indirect.toString()).toBe('2813');
    expect(p1.eligible.toString()).toBe('14063.5');
    expect(p1.requested.toString()).toBe('14064'); // rounded at partner level
    // P2: subcontracting excluded from base: indirect 0.25 × 8 000 = 2 000; funding 50 %
    expect(p2.indirect.toString()).toBe('2000');
    expect(p2.eligible.toString()).toBe('13000');
    expect(p2.requested.toString()).toBe('6500');
  });

  it('sums partners into the consortium total and shares', () => {
    expect(r.total.planned.toString()).toBe('22250.5');
    expect(r.total.indirect.toString()).toBe('4813');
    expect(r.total.eligible.toString()).toBe('27063.5');
    expect(r.total.requested.toString()).toBe('20564');
    expect((p1.share ?? 0) + (p2.share ?? 0)).toBeCloseTo(1, 5);
  });

  it('tracks committed, actual (ignoring deleted), remaining, utilisation and forecast', () => {
    expect(r.total.actual.toString()).toBe('4000');
    expect(r.total.committed.toString()).toBe('312.4');
    expect(r.total.remaining.toString()).toBe('17938.1');
    expect(p1.utilisation).toBeCloseTo(4000 / 11250.5, 6);
    // P2 forecast uses the line forecast (3 500 instead of 3 000)
    expect(p2.forecast.toString()).toBe('11500');
    expect(p2.variance.toString()).toBe('500');
    expect(r.total.forecast.toString()).toBe('22750.5');
  });

  it('breaks down by category, work package, year and period from the same records', () => {
    expect(r.byCategory.get('pers')!.planned.toString()).toBe('18000');
    expect(r.byWorkPackage.get('W2')!.planned.toString()).toBe('4250.5');
    expect(r.byYear.get('2027')!.planned.toString()).toBe('4250.5');
    expect(r.byYear.get('2026')!.actual.toString()).toBe('4000');
    expect(r.byPeriod.get('R2')!.committed.toString()).toBe('312.4');
    // line-level indirect differs from rounded partner totals by the rounding adjustment
    const lineSum = [...r.lines.values()].reduce((t, l) => t.plus(l.indirect), new Big(0));
    expect(lineSum.plus(r.roundingAdjustment).toString()).toBe(r.total.indirect.toString());
  });

  it('reconciles personnel cost with person-months × rate', () => {
    expect(p1.personnelBudget.toString()).toBe('10000');
    expect(p1.personnelFromRate!.toString()).toBe('10000');
    expect(p2.personnelFromRate!.toString()).toBe('10000'); // 2.5 × 4 000 vs 8 000 budgeted → mismatch visible
    expect(p2.personnelBudget.toString()).toBe('8000');
    expect(p1.plannedPm.toString()).toBe('2');
    expect(p1.actualPm.toString()).toBe('0.8');
  });

  it('handles an empty budget', () => {
    const e = computeBudget(input({ lines: [], expenditures: [], partners: [] }));
    expect(e.total.planned.toString()).toBe('0');
    expect(e.total.utilisation).toBeNull();
  });
});

describe('effort', () => {
  it('converts logged time to person-months and combines sources', () => {
    expect(minutesToPm(140 * 60, 140).toString()).toBe('1');
    const m = computeEffort({
      lines: [{ partner_id: 'P1', work_package_id: 'W1', person_months: '2' }],
      allocations: [{ partner_id: 'P1', work_package_id: 'W1', planned_pm: '1.5' }],
      reports: [{ partner_id: 'P1', work_package_id: 'W1', actual_pm: '0.5' }],
      time: [{ partner_id: 'P1', work_package_id: 'W1', minutes: 70 * 60 }],
      hoursPerPm: 140,
    });
    const c = m.get('P1|W1')!;
    expect(c.actualPm.toString()).toBe('1');
    expect(c.remainingPm.toString()).toBe('1');
  });
});

describe('category inference', () => {
  it('maps common names', () => {
    expect(inferCategoryKind('Direct Personnel')).toBe('personnel');
    expect(inferCategoryKind('Travel and subsistence')).toBe('travel');
    expect(inferCategoryKind('Other goods and services')).toBe('other');
    expect(inferCategoryKind('Subcontracting Costs')).toBe('subcontracting');
    expect(inferCategoryKind('Financial support to third parties')).toBe('third_party');
    expect(inferCategoryKind('Internally invoiced goods and services')).toBe('internal');
  });
});
