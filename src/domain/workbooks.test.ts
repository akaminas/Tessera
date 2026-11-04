import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import ExcelJS from 'exceljs';
import {
  buildBudgetPayload,
  buildBudgetWorkbook,
  buildPlanPayload,
  buildPlanWorkbook,
  budgetBlockers,
  detectWorkbookKind,
  loadWorkbook,
  parseBudgetWorkbook,
  parsePlanWorkbook,
  planBlockers,
  reconcileBudget,
  type BudgetExport,
} from './workbooks';

/* All organisations, amounts and texts below are synthetic. */

const fill = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${hex}` } });

function syntheticPlan(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ov = wb.addWorksheet('Overview');
  ov.getCell('A5').value = 'Duration:';
  ov.getCell('B5').value = '12 months · 01/03/2027 - 29/02/2028 (M1 = Mar 2027)';
  ov.getCell('A19').value = 'LEGEND';
  ov.getCell('A20').fill = fill('128A9A');
  ov.getCell('B20').value = 'Planned / ongoing activity in this month';
  ov.getCell('A21').fill = fill('FFC000');
  ov.getCell('B21').value = 'Milestone, deliverable or report due';
  ov.getCell('A22').fill = fill('92D050');
  ov.getCell('B22').value = 'Completed (mark when done)';
  ov.getCell('A23').fill = fill('DCE6F1');
  ov.getCell('B23').value = 'Task header row';

  const mk = (sheet: string, title: string, lead: string, rows: { t: string; r: string; header?: boolean; cells: [number, string][] }[]) => {
    const ws = wb.addWorksheet(sheet);
    ws.getCell('A3').value = title;
    ws.getCell('B3').value = `Lead: ${lead}`;
    ws.getCell('A5').value = 'TASK / ACTIVITY (deadline)';
    ws.getCell('B5').value = 'Responsible';
    for (let m = 1; m <= 12; m++) {
      ws.getRow(5).getCell(2 + m).value = `M${m}`;
      ws.getRow(6).getCell(2 + m).value = new Date(Date.UTC(2027, 1 + m, 1));
    }
    rows.forEach((row, i) => {
      const r = ws.getRow(7 + i);
      r.getCell(1).value = row.t;
      r.getCell(2).value = row.r;
      if (row.header) r.getCell(1).fill = fill('DCE6F1');
      for (const [m, hex] of row.cells) r.getCell(2 + m).fill = fill(hex);
    });
  };
  mk('WP1PM', 'WP1 - Coordination', 'ALPHA', [
    { t: 'TASK 1.1 Governance (M1–M12)', r: 'ALPHA', header: true, cells: [] },
    { t: 'Kick-off meeting', r: 'ALPHA + all', cells: [[1, '92D050']] },
    { t: 'Monthly calls', r: 'All', cells: [[1, '92D050'], [2, '128A9A'], [3, '128A9A']] },
    { t: 'Interim report (due M6)', r: 'ALPHA', cells: [[6, 'FFC000']] },
    { t: 'Odd colour cell', r: 'X', cells: [[4, 'FF0000']] },
  ]);
  mk('WP2', 'WP2 - Training', 'BETA', [
    { t: 'Design modules', r: 'BETA', cells: [[2, '128A9A'], [3, '128A9A']] },
    { t: 'Unscheduled idea', r: 'BETA', cells: [] },
  ]);
  const ms = wb.addWorksheet('Milestones');
  ms.getCell('A3').value = 'Example · Internal Milestones & Control Points';
  ['#', 'Milestone / control point', 'WP', 'Due date', 'Means of verification / evidence', 'Status', 'Notes'].forEach((t, i) => (ms.getRow(5).getCell(i + 1).value = t));
  const rows: [number, string, string, Date | null, string, string][] = [
    [1, 'Kick-off meeting held', 'WP1', new Date(Date.UTC(2027, 2, 20)), 'Minutes', 'Done'],
    [2, 'D1.1 Handbook', 'WP1', new Date(Date.UTC(2027, 4, 31)), 'Deliverable submitted', 'On track'],
    [3, 'Joint review', 'WP1/WP2', new Date(Date.UTC(2027, 8, 30)), 'Review notes', 'At risk'],
    [4, 'Mystery state', 'WP9', null, '', 'Unclear'],
  ];
  rows.forEach((r, i) => r.forEach((v, j) => (ms.getRow(6 + i).getCell(j + 1).value = v)));
  ms.getCell('B12').value = 'Done:';
  ms.getCell('C12').value = 1;
  return wb;
}

function syntheticBudget(opts: { broken?: boolean } = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const gi = wb.addWorksheet('General Information');
  gi.getCell('B2').value = 'Cost eligibility';
  const s = wb.addWorksheet('Total Consortium Budget');
  s.getCell('B3').value = 'Coordinator';
  s.getCell('C3').value = 'Alpha University';
  const H = 14;
  const head: [string, string, string?][] = [
    ['B', 'Institution Name'],
    ['C', 'Country'],
    ['D', '(A) Direct Personnel Costs (€)', '(a1)'],
    ['E', '(B) Subcontracting Costs (€)', '(b)'],
    ['F', '(C) Purchase Costs (€)', 'C1 . Travel & Subsistence (€)'],
    ['G', '', 'C2. Equipment (€)'],
    ['H', '', 'C3. Other Goods, Works & Services (€)'],
    ['I', '(D) Other Cost categories(€)', 'D.X ( specific cost category) (€)'],
    ['J', '(E) Indirect costs (€) =0.25(A)+(c1)+(c2)+(c3)+(d7)', 'E=25% (a1) +(c1)+(c2)+(c3)+(d7)'],
    ['K', '(F) Total Eligible costs (€)', 'h=(a1)+(b)+(c1)+(c2)+(c3)+(d)+€'],
    ['L', 'Funding Rate', '(u)'],
    ['M', 'Maximum EU Contribution', '(i)=(u)*(h)'],
    ['N', 'Requested EU contribution to Eligible Costs'],
  ];
  for (const [c, a, b] of head) {
    if (a) s.getCell(`${c}${H}`).value = a;
    if (b) s.getCell(`${c}${H + 1}`).value = b;
  }
  s.mergeCells(`F${H}:H${H}`);
  // Alpha: personnel 10 000 (2 PM @5 000), travel 1 250; indirect 25 % of 11 250 = 2 812.5 → summary shows 2 813
  // Beta: personnel 6 000 (2.4 PM @2 500), subcontracting 3 000, other 350; indirect 25 % of 6 350 = 1 587.5 → summary 1 589 (off by 1.5)
  const rowsS: (string | number)[][] = [
    ['Alpha University', 'Nowhere', 10000, 0, 1250, 0, 0, 0, 2813, 14063, 0, 0, 14063],
    ['Beta Institute', 'Elsewhere', 6000, 3000, 0, 0, 350, 0, 1589, 10939, 0, 0, 10939],
  ];
  rowsS.forEach((r, i) => r.forEach((v, j) => (s.getRow(H + 2 + i).getCell(2 + j).value = v)));
  const tot = ['Total', '', 16000, 3000, 1250, 0, 350, 0, 4402, 25002, 0, 0, 25002];
  tot.forEach((v, j) => (s.getRow(H + 4).getCell(2 + j).value = v));
  s.getCell('B28').value = 'Person Months per WP';
  ['Partner', 'WP1', 'WP2', 'TOTAL PMs'].forEach((t, i) => (s.getRow(30).getCell(2 + i).value = t));
  [['Alpha University', 1.5, 0.5, 2], ['Beta Institute', 0.4, opts.broken ? 1.9 : 2.0, 2.4]].forEach((r, i) => r.forEach((v, j) => (s.getRow(31 + i).getCell(2 + j).value = v)));
  s.getCell('B42').value = 'Work Packages';
  s.getCell('B44').value = 'ID (e.g. WP1)';
  s.getCell('C44').value = 'Title';
  s.getCell('B45').value = 'WP1';
  s.getCell('C45').value = 'Coordination';
  s.getCell('B46').value = 'WP2';
  s.getCell('C46').value = 'Training';

  const partner = (sheet: string, name: string, lines: (string | number | null)[][], pm: number[]) => {
    const ws = wb.addWorksheet(sheet);
    ws.getCell('B3').value = 'Partner Name';
    ws.getCell('C3').value = name;
    ws.getCell('B8').value = 'Please be advised that indirect costs (25%) do not apply to Subcontracting and Financial support to third parties costs';
    ['Cost Category', 'Cost (€)', 'Indirect costs (€)', 'Total Cost (€)', 'Year (2027, 2028)', 'Work Package', 'PMs (for personnel costs only)', 'Cost Explanation (roles; description)'].forEach(
      (t, i) => (ws.getRow(9).getCell(2 + i).value = t),
    );
    lines.forEach((l, i) => l.forEach((v, j) => (ws.getRow(10 + i).getCell(2 + j).value = v)));
    const r = 10 + lines.length + 2;
    ws.getCell(`B${r}`).value = 'Person Months per WPs';
    ['WP1', 'WP2', 'TOTAL PMs'].forEach((t, i) => (ws.getRow(r + 2).getCell(2 + i).value = t));
    pm.forEach((v, i) => (ws.getRow(r + 3).getCell(2 + i).value = v));
  };
  partner(
    'ALPHA Budget',
    'Alpha University',
    [
      ['Direct Personnel', 7500, 1875, 9375, 2027, 'WP1', 1.5, 'Project manager'],
      ['Direct Personnel', 2500, 625, 3125, 2028, 'WP2', 0.5, 'Trainer'],
      ['Travel and subsistence', 1250, 312.5, 1562.5, 2027, 'WP1', 0, 'Kick-off travel'],
    ],
    [1.5, 0.5, 2],
  );
  partner(
    'BETA Budget',
    'Beta Institute',
    [
      ['Direct Personnel', 1000, 250, 1250, 2027, 'WP1', 0.4, 'Researcher'],
      ['Direct Personnel', 5000, 1250, 6250, 2028, 'WP2', 2.0, 'Researcher'],
      ['Subcontracting', 3000, 0, 3000, 2028, 'WP2', 0, 'Evaluation'],
      ['Other goods and services', 350, opts.broken ? 90 : 87.5, 437.5, 2027, 'WP1', 0, 'Room hire'],
      ['Other goods and services', 'TBC', null, null, 2028, 'WP2', 0, 'Not yet costed'],
    ],
    [0.4, 2.0, 2.4],
  );
  return wb;
}

describe('workbook detection', () => {
  it('recognises plans and budgets', () => {
    expect(detectWorkbookKind(syntheticPlan())).toBe('plan');
    expect(detectWorkbookKind(syntheticBudget())).toBe('budget');
    expect(detectWorkbookKind(new ExcelJS.Workbook())).toBe('unknown');
  });
});

describe('plan workbook', () => {
  const p = parsePlanWorkbook(syntheticPlan());

  it('reads work packages, leads and the start month', () => {
    expect(p.startDate).toBe('2027-03-01');
    expect(p.months).toBe(12);
    expect(p.workPackages.map((w) => [w.code, w.name, w.lead, w.start_month, w.end_month])).toEqual([
      ['WP1', 'Coordination', 'ALPHA', 1, 6],
      ['WP2', 'Training', 'BETA', 2, 3],
    ]);
  });

  it('reads the month grid by colour and distinguishes task rows', () => {
    const byTitle = Object.fromEntries(p.rows.map((r) => [r.title, r]));
    expect(byTitle['TASK 1.1 Governance (M1–M12)'].kind).toBe('task');
    expect(byTitle['Kick-off meeting']).toMatchObject({ kind: 'activity', done: [1], planned: [], due: [] });
    expect(byTitle['Monthly calls']).toMatchObject({ done: [1], planned: [2, 3] });
    expect(byTitle['Interim report (due M6)'].due).toEqual([6]);
    expect(byTitle['Kick-off meeting'].ref).toBe('WP1PM!A8');
    expect(p.issues.some((i) => i.level === 'warning' && /colours not in the legend/.test(i.message) && /FF0000/.test(i.message))).toBe(true);
    expect(p.issues.some((i) => /“Unscheduled idea” has no months/.test(i.message))).toBe(true);
  });

  it('reads milestones with status mapping and reports problems', () => {
    expect(p.milestones.map((m) => [m.code, m.status, m.wp, m.due_date, m.kind])).toEqual([
      ['1', 'done', 'WP1', '2027-03-20', 'event'],
      ['2', 'on_track', 'WP1', '2027-05-31', 'deliverable'],
      ['3', 'at_risk', 'WP1', '2027-09-30', 'control'],
      ['4', 'planned', '', null, 'milestone'],
    ]);
    const msgs = p.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/shared by WP1, WP2/);
    expect(msgs).toMatch(/refers to WP9/);
    expect(msgs).toMatch(/Unknown status “Unclear”/);
    expect(msgs).toMatch(/no readable due date/);
  });

  it('builds the import payload honouring exclusions', () => {
    p.rows.find((r) => r.title === 'Odd colour cell')!.include = false;
    const payload = buildPlanPayload(p);
    expect(payload.rows).toHaveLength(p.rows.length - 1);
    expect(payload.work_packages[0]).toEqual({ code: 'WP1', name: 'Coordination', lead: 'ALPHA', start_month: 1, end_month: 6 });
    expect(planBlockers(p)).toEqual([]);
  });

  it('round-trips through the exported workbook', async () => {
    const payload = buildPlanPayload(p);
    const buf = await buildPlanWorkbook({
      projectName: 'Synthetic',
      startDate: payload.start_date!,
      months: payload.months,
      workPackages: payload.work_packages,
      rows: payload.rows,
      milestones: payload.milestones,
    });
    const again = parsePlanWorkbook(await loadWorkbook(buf));
    const p2 = buildPlanPayload(again);
    expect(p2.start_date).toBe(payload.start_date);
    expect(p2.work_packages).toEqual(payload.work_packages);
    expect(p2.rows).toEqual(payload.rows);
    expect(p2.milestones.map((m) => [m.title, m.status, m.due_date, m.wp])).toEqual(payload.milestones.map((m) => [m.title, m.status, m.due_date, m.wp]));
  });
});

describe('budget workbook', () => {
  it('reads partners, categories, lines, rates and settings', () => {
    const b = parseBudgetWorkbook(syntheticBudget());
    expect(b.partners.map((p) => [p.name, p.short_name, p.country, p.role, p.pm_rate])).toEqual([
      ['Alpha University', 'ALPHA', 'Nowhere', 'coordinator', '5000'],
      ['Beta Institute', 'BETA', 'Elsewhere', 'partner', '2500'],
    ]);
    expect(b.categories.map((c) => [c.name, c.kind, c.indirect_base])).toEqual([
      ['Direct Personnel', 'personnel', true],
      ['Travel and subsistence', 'travel', true],
      ['Subcontracting', 'subcontracting', false],
      ['Other goods and services', 'other', true],
    ]);
    expect(b.lines).toHaveLength(7);
    expect(b.lines[0]).toMatchObject({ amount: 7500, year: 2027, wp: 'WP1', person_months: 1.5, description: 'Project manager', ref: 'ALPHA Budget!B10' });
    expect(b.settings).toMatchObject({ indirect_rate: '0.25', funding_rate: '1', rounding: 'partner' });
    expect(b.workPackages).toEqual([
      { code: 'WP1', name: 'Coordination' },
      { code: 'WP2', name: 'Training' },
    ]);
    expect(b.issues.some((i) => /no numeric cost/.test(i.message) && i.ref === 'BETA Budget!C14')).toBe(true);
    expect(b.issues.some((i) => /requested amounts equal total eligible/.test(i.message))).toBe(true);
  });

  it('reconciles sheets with the summary and reports differences without fixing them', () => {
    const b = parseBudgetWorkbook(syntheticBudget());
    const rec = reconcileBudget(b);
    const find = (scope: string, check: RegExp) => rec.find((r) => r.scope === scope && check.test(r.check))!;
    expect(find('Alpha University', /Personnel: partner sheet vs summary/).status).toBe('ok');
    expect(find('Alpha University', /Indirect costs: recomputed vs summary$/)).toMatchObject({ status: 'ok', computed: '2813', source: '2813' });
    // Beta's summary indirect (1 589) is 1.5 above 25 % of 6 350 rounded per partner (1 588)
    expect(find('Beta Institute', /Indirect costs: recomputed vs summary$/)).toMatchObject({ status: 'difference', computed: '1588', source: '1589', difference: '-1' });
    expect(find('Consortium', /Indirect costs: recomputed vs summary total/).status).toBe('difference');
    expect(rec.filter((r) => /person-months/.test(r.check)).every((r) => r.status === 'ok')).toBe(true);
    // with rounding off, Alpha's indirect is exact 2 812.5 and differs from the summary
    const exact = reconcileBudget(b, { ...b.settings, rounding: 'none', rounding_decimals: 2 });
    expect(exact.find((r) => r.scope === 'Alpha University' && /recomputed vs summary$/.test(r.check))).toMatchObject({ computed: '2812.5', status: 'difference' });
  });

  it('flags inconsistent person-months and line arithmetic', () => {
    const b = parseBudgetWorkbook(syntheticBudget({ broken: true }));
    const rec = reconcileBudget(b);
    expect(rec.some((r) => r.scope === 'Beta Institute' && /WP2 person-months: lines vs summary table/.test(r.check) && r.status === 'difference')).toBe(true);
    expect(rec.some((r) => r.scope === 'Beta Institute' && /Line indirect ≠ 25 %/.test(r.check))).toBe(true);
    expect(rec.some((r) => /Line total ≠ cost \+ indirect/.test(r.check))).toBe(true);
  });

  it('builds the import payload with exact amounts', () => {
    const b = parseBudgetWorkbook(syntheticBudget());
    b.partners[1].include = false;
    const payload = buildBudgetPayload(b);
    expect(payload.partners).toHaveLength(1);
    expect(payload.lines.every((l) => l.partner === 'ALPHA Budget')).toBe(true);
    expect(payload.lines[2]).toMatchObject({ amount: '1250', person_months: '0', category: 'Travel and subsistence' });
    expect(payload.categories.map((c) => c.name)).toEqual(['Direct Personnel', 'Travel and subsistence']);
    expect(budgetBlockers(b, b.settings)).toEqual([]);
    expect(budgetBlockers(b, { ...b.settings, indirect_rate: '25' })[0]).toMatch(/between 0 and 1/);
  });

  it('round-trips through the exported budget workbook', async () => {
    const d: BudgetExport = {
      title: 'Synthetic budget',
      currency: 'EUR',
      coordinator: 'Gamma Lab',
      indirectRatePct: '25',
      workPackages: [{ code: 'WP1', name: 'Management' }],
      partners: [
        {
          name: 'Gamma Lab',
          short: 'GAMMA',
          country: 'Somewhere',
          groups: { personnel: '4000', subcontracting: '0', travel: '400', equipment: '0', other: '0', other_categories: '0' },
          indirect: '1100',
          total: '5500',
          fundingRate: '1',
          requested: '5500',
          pmByWp: { WP1: '1' },
          lines: [
            { category: 'Personnel', amount: '4000', indirect: '1000', total: '5000', year: 2027, wp: 'WP1', pms: '1', description: 'Coordinator' },
            { category: 'Travel', amount: '400', indirect: '100', total: '500', year: 2027, wp: 'WP1', pms: null, description: 'Meeting' },
          ],
        },
      ],
    };
    const wb = await loadWorkbook(await buildBudgetWorkbook(d));
    expect(detectWorkbookKind(wb)).toBe('budget');
    const b = parseBudgetWorkbook(wb);
    expect(b.partners[0]).toMatchObject({ name: 'Gamma Lab', country: 'Somewhere', role: 'coordinator', pm_rate: '4000' });
    expect(b.settings.indirect_rate).toBe('0.25');
    const rec = reconcileBudget(b);
    expect(rec.filter((r) => r.status === 'difference')).toEqual([]);
  });
});

/*
 * Optional checks against real office workbooks. They run only when the paths
 * are provided and never print or store organisation-level figures.
 *   TESSERA_REAL_BUDGET=/path/budget.xlsx TESSERA_REAL_PLAN=/path/plan.xlsx npx vitest run src/domain/workbooks.test.ts
 */
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const realBudget = env.TESSERA_REAL_BUDGET;
const realPlan = env.TESSERA_REAL_PLAN;
async function readLocal(path: string): Promise<ArrayBuffer> {
  const fs = await import(/* @vite-ignore */ 'node:' + 'fs');
  const buf = fs.readFileSync(path) as Uint8Array;
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe.skipIf(!realBudget)('real budget workbook (local only)', () => {
  it('parses and reconciles direct costs and person-months exactly', async () => {
    const wb = await loadWorkbook(await readLocal(realBudget!));
    expect(detectWorkbookKind(wb)).toBe('budget');
    const b = parseBudgetWorkbook(wb);
    const rec = reconcileBudget(b);
    const direct = rec.filter((r) => /partner sheet vs summary/.test(r.check));
    const pms = rec.filter((r) => /person-months/.test(r.check));
    const indirect = rec.filter((r) => /Indirect costs: recomputed vs summary$/.test(r.check) && r.status === 'difference');
    const maxIndirectDiff = Math.max(0, ...indirect.map((r) => Math.abs(Number(r.difference))));
    console.info(
      `[real budget] partners=${b.partners.length} lines=${b.lines.length} categories=${b.categories.length} ` +
        `directChecks=${direct.length} directDifferences=${direct.filter((r) => r.status !== 'ok').length} ` +
        `pmChecks=${pms.length} pmDifferences=${pms.filter((r) => r.status !== 'ok').length} ` +
        `indirectDifferences(partner rounding)=${indirect.length} maxIndirectDifference=${maxIndirectDiff}`,
    );
    expect(direct.every((r) => r.status === 'ok')).toBe(true);
    expect(pms.every((r) => r.status === 'ok')).toBe(true);
    expect(maxIndirectDiff).toBeLessThanOrEqual(2);
  });
});

describe.skipIf(!realPlan)('real plan workbook (local only)', () => {
  it('parses work packages, the month grid and milestones', async () => {
    const wb = await loadWorkbook(await readLocal(realPlan!));
    expect(detectWorkbookKind(wb)).toBe('plan');
    const p = parsePlanWorkbook(wb);
    console.info(
      `[real plan] start=${p.startDate} months=${p.months} wps=${p.workPackages.length} rows=${p.rows.length} ` +
        `tasks=${p.rows.filter((r) => r.kind === 'task').length} milestones=${p.milestones.length} ` +
        `issues=${p.issues.map((i) => i.level).join(',')}`,
    );
    expect(p.workPackages.length).toBeGreaterThan(0);
    expect(p.milestones.length).toBeGreaterThan(0);
    expect(planBlockers(p)).toEqual([]);
  });
});
