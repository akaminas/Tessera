import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, closeDb, createUser } from './helpers';
import { PROJECT_TEMPLATES } from '../../src/domain/templates';

let manager: { id: string; email: string };
let member: { id: string; email: string };
let accountant: { id: string; email: string };
let outsider: { id: string; email: string };
let ws: string;
let project: string;

beforeAll(async () => {
  manager = await createUser('Manager');
  member = await createUser('Member');
  accountant = await createUser('Accountant');
  outsider = await createUser('Outsider');
  ws = await as(manager.id, async (q) => (await q(`select public.create_workspace('Consortium office') as id`))[0].id);
  for (const u of [member, accountant]) await admin(`insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'member')`, [ws, u.id]);
  project = await as(manager.id, async (q) =>
    (await q(`select public.create_project($1,'Synthetic EU project','', 'private', '2026-09-01', '2028-08-31') as id`, [ws]))[0].id,
  );
  await as(manager.id, async (q) => {
    await q(`insert into project_members (project_id, user_id, role) values ($1,$2,'member')`, [project, member.id]);
    await q(`insert into project_members (project_id, user_id, role, finance_access) values ($1,$2,'collaborator','edit')`, [project, accountant.id]);
  });
});
afterAll(closeDb);

describe('project months', () => {
  it('maps project months to calendar dates and back', async () => {
    const r = await admin(`select public.project_month_start('2026-09-01', 1) s1, public.project_month_end('2026-09-01', 1) e1,
      public.project_month_end('2026-09-01', 24) e24, public.project_month_of('2026-09-01', '2027-03-31') m7,
      public.project_month_of('2026-09-01', '2026-08-31') before`);
    expect(r[0]).toEqual({ s1: '2026-09-01', e1: '2026-09-30', e24: '2028-08-31', m7: 7, before: null });
  });
});

describe('templates', () => {
  it('applies the EU template: work packages, lists, milestones, categories, periods', async () => {
    const eu = PROJECT_TEMPLATES.find((t) => t.id === 'eu')!;
    const p = await as(manager.id, async (q) => (await q(`select public.create_project($1,'From template','', 'private', '2027-01-01', '2028-12-31') as id`, [ws]))[0].id);
    await as(manager.id, (q) => q(`select public.apply_blueprint($1, $2, '2027-01-01')`, [p, JSON.stringify(eu.blueprint)]));
    const counts = await admin(
      `select (select count(*) from work_packages where project_id = $1)::int wps,
              (select count(*) from milestones where project_id = $1)::int ms,
              (select count(*) from cost_categories where project_id = $1)::int cats,
              (select count(*) from reporting_periods where project_id = $1)::int rps,
              (select count(*) from cards where project_id = $1)::int cards,
              (select due_date from milestones where project_id = $1 and code = 'MS1') ms1,
              (select funding ->> 'indirect_rate' from projects where id = $1) rate`,
      [p],
    );
    expect(counts[0]).toMatchObject({ wps: 4, ms: 4, cats: 7, rps: 4, ms1: '2027-03-31', rate: '0.25' });
    expect(counts[0].cards).toBeGreaterThan(3);
    const kickoff = await admin(`select start_date, due_date, schedule, work_package_id is not null as has_wp from cards where project_id = $1 and title = 'Kick-off meeting'`, [p]);
    expect(kickoff[0]).toMatchObject({ start_date: '2027-01-01', due_date: '2027-01-31', has_wp: true });
    // round-trip to a blueprint
    const bp = await as(manager.id, async (q) => (await q(`select public.project_to_blueprint($1) bp`, [p]))[0].bp);
    expect(bp.work_packages).toHaveLength(4);
    expect(bp.boards[0].lists.length).toBeGreaterThan(0);
  });

  it('applies every built-in template without errors', async () => {
    for (const t of PROJECT_TEMPLATES) {
      const p = await as(manager.id, async (q) => (await q(`select public.create_project($1,$2,'', 'private', '2026-11-01', '2027-12-31') as id`, [ws, t.name]))[0].id);
      await as(manager.id, (q) => q(`select public.apply_blueprint($1, $2, '2026-11-01')`, [p, JSON.stringify(t.blueprint)]));
    }
  });

  it('refuses template application by non-managers', async () => {
    await expect(as(member.id, (q) => q(`select public.apply_blueprint($1, '{"version":1,"boards":[]}', null)`, [project]))).rejects.toThrow(/managers/);
  });
});

describe('plan import', () => {
  it('creates work packages, a work-plan board with M1–Mn schedules and milestones', async () => {
    const payload = {
      start_date: '2026-09-01',
      months: 24,
      board_name: 'Work plan',
      work_packages: [
        { code: 'WP1', name: 'Coordination', start_month: 1, end_month: 24 },
        { code: 'WP2', name: 'Training', start_month: 2, end_month: 22 },
      ],
      rows: [
        { wp: 'WP1', kind: 'task', title: 'Task 1.1 Governance', responsible: 'Lead' },
        { wp: 'WP1', kind: 'activity', title: 'Kick-off meeting', responsible: 'Lead + all', done: [1] },
        { wp: 'WP1', kind: 'activity', title: 'Interim report 1', responsible: 'Lead', due: [7] },
        { wp: 'WP1', kind: 'activity', title: 'Monthly meetings', responsible: 'All', done: [1, 2], planned: [3, 4, 5] },
        { wp: 'WP2', kind: 'activity', title: 'Design courses', responsible: 'Partner B', planned: [2, 3] },
      ],
      milestones: [
        { code: '1', title: 'Kick-off held', wp: 'WP1', due_date: '2026-09-24', status: 'done', verification: 'Minutes' },
        { code: '2', title: 'Interim report submitted', wp: 'WP1', due_date: '2027-03-31', status: 'planned', kind: 'report' },
      ],
    };
    const res = await as(manager.id, async (q) => (await q(`select public.import_plan($1, $2) r`, [project, JSON.stringify(payload)]))[0].r);
    expect(res).toMatchObject({ work_packages: 2, cards: 5, milestones: 2 });
    const cards = await admin(
      `select title, status, start_date, due_date, parent_id is not null as child, schedule from cards where board_id = $1 order by position`,
      [res.board_id],
    );
    expect(cards.map((c) => [c.title, c.status, c.child])).toEqual([
      ['Task 1.1 Governance', 'open', false],
      ['Kick-off meeting', 'done', true],
      ['Interim report 1', 'open', true],
      ['Monthly meetings', 'in_progress', true],
      ['Design courses', 'open', false],
    ]);
    const report = cards.find((c) => c.title === 'Interim report 1');
    expect(report).toMatchObject({ start_date: '2027-03-01', due_date: '2027-03-31' });
    expect(report.schedule).toEqual({ due: [7] });
    const ms = await admin(`select title, status, actual_date, approval_status from milestones where project_id = $1 order by position`, [project]);
    expect(ms[0]).toMatchObject({ status: 'done', approval_status: 'not_required' });
    expect(ms[0].actual_date).not.toBeNull();
    expect(ms[1].approval_status).toBe('not_submitted');
  });

  it('rejects rows pointing at unknown work packages (nothing is written)', async () => {
    const before = await admin(`select count(*)::int n from boards where project_id = $1`, [project]);
    await expect(
      as(manager.id, (q) =>
        q(`select public.import_plan($1, $2)`, [project, JSON.stringify({ work_packages: [{ code: 'WP1', name: 'x' }], rows: [{ wp: 'WP9', kind: 'task', title: 'x' }] })]),
      ),
    ).rejects.toThrow(/unknown work package/);
    const after = await admin(`select count(*)::int n from boards where project_id = $1`, [project]);
    expect(after[0].n).toBe(before[0].n);
  });
});

describe('budget import and finance permissions', () => {
  const payload = {
    replace: true,
    settings: { indirect_rate: '0.25', funding_rate: '1', rounding: 'partner', rounding_decimals: 0, rounding_mode: 'half_up' },
    work_packages: [{ code: 'WP1' }, { code: 'WP2' }],
    partners: [
      { key: 'A', name: 'Alpha University', short_name: 'ALPHA', country: 'Nowhere', pm_rate: '5000', role: 'coordinator' },
      { key: 'B', name: 'Beta Institute', short_name: 'BETA', country: 'Elsewhere', pm_rate: '4000' },
    ],
    categories: [
      { name: 'Direct Personnel', kind: 'personnel', indirect_base: true },
      { name: 'Travel and subsistence', kind: 'travel', indirect_base: true },
      { name: 'Subcontracting', kind: 'subcontracting', indirect_base: false },
    ],
    lines: [
      { partner: 'A', category: 'Direct Personnel', amount: '10000', year: 2026, wp: 'WP1', person_months: '2', source_ref: 'A!10' },
      { partner: 'A', category: 'Travel and subsistence', amount: '1250.50', year: 2027, wp: 'WP2', source_ref: 'A!11' },
      { partner: 'B', category: 'Subcontracting', amount: '3000', year: 2027, wp: 'WP2', source_ref: 'B!10' },
    ],
  };

  it('requires finance edit access', async () => {
    await expect(as(member.id, (q) => q(`select public.import_budget($1,$2)`, [project, JSON.stringify(payload)]))).rejects.toThrow(/finance edit/);
  });

  it('imports partners, rates, categories and lines; replacing does not duplicate', async () => {
    await as(accountant.id, (q) => q(`select public.import_budget($1,$2)`, [project, JSON.stringify(payload)]));
    const r = await as(accountant.id, async (q) => (await q(`select public.import_budget($1,$2) r`, [project, JSON.stringify(payload)]))[0].r);
    expect(r).toMatchObject({ partners: 2, categories: 3, lines: 3 });
    const sums = await admin(`select sum(amount)::text total, count(*)::int n, sum(person_months)::text pm from budget_lines where project_id = $1`, [project]);
    expect(sums[0]).toEqual({ total: '14250.50', n: 3, pm: '2.0000' });
  });

  it('hides money from members without finance access but shows effort and partners', async () => {
    const lines = await as(member.id, (q) => q(`select * from budget_lines where project_id = $1`, [project]));
    const rates = await as(member.id, (q) => q(`select * from partner_finance where project_id = $1`, [project]));
    const partners = await as(member.id, (q) => q(`select short_name from project_partners where project_id = $1 order by position`, [project]));
    expect(lines).toHaveLength(0);
    expect(rates).toHaveLength(0);
    expect(partners.map((p) => p.short_name)).toEqual(['ALPHA', 'BETA']);
    const cat = (await admin(`select id from cost_categories where project_id = $1 limit 1`, [project]))[0].id;
    await expect(
      as(member.id, (q) =>
        q(`insert into expenditures (project_id, category_id, spent_on, description, amount) values ($1, $2, '2027-01-10', 'x', 10)`, [project, cat]),
      ),
    ).rejects.toThrow(/row-level security/);
    const outsiderLines = await as(outsider.id, (q) => q(`select * from budget_lines`));
    expect(outsiderLines).toHaveLength(0);
  });

  it('lets finance viewers read but not write, and audits changes', async () => {
    await as(manager.id, (q) => q(`update project_members set finance_access = 'view' where project_id = $1 and user_id = $2`, [project, member.id]));
    const lines = await as(member.id, (q) => q(`select amount from budget_lines where project_id = $1`, [project]));
    expect(lines).toHaveLength(3);
    const upd = await as(member.id, (q) => q(`update budget_lines set amount = 1 where project_id = $1 returning id`, [project]));
    expect(upd).toHaveLength(0);
    await as(accountant.id, (q) =>
      q(`insert into expenditures (project_id, partner_id, category_id, spent_on, description, amount, status)
         select $1, pp.id, cc.id, '2027-02-01', 'Train tickets', 312.40, 'actual'
         from project_partners pp, cost_categories cc where pp.project_id = $1 and pp.short_name = 'ALPHA' and cc.project_id = $1 and cc.kind = 'travel'`, [project]),
    );
    const audit = await as(member.id, (q) => q(`select table_name, op from finance_audit where project_id = $1 and table_name = 'expenditures'`, [project]));
    expect(audit).toEqual([{ table_name: 'expenditures', op: 'insert' }]);
    const memberActivity = await as(member.id, (q) => q(`select summary from activity_log where project_id = $1 and summary like '%312%'`, [project]));
    expect(memberActivity).toHaveLength(0);
    await as(manager.id, (q) => q(`update project_members set finance_access = 'none' where project_id = $1 and user_id = $2`, [project, member.id]));
  });

  it('rejects finance rows that reference another project', async () => {
    const other = await as(accountant.id, async (q) => (await q(`select public.create_project($1,'Other')  as id`, [ws]))[0].id);
    await expect(
      as(manager.id, (q) =>
        q(`insert into budget_lines (project_id, category_id, amount) select $1, id, 5 from cost_categories where project_id = $2 limit 1`, [other, project]),
      ),
    ).rejects.toThrow(/another project/);
  });
});

describe('milestones, evidence, risks, meetings, progress', () => {
  it('lets only managers approve deliverables and records history', async () => {
    const ms = await as(member.id, async (q) =>
      (await q(`insert into milestones (project_id, title, kind, due_date, approval_status) values ($1,'D1 Plan','deliverable','2026-12-31','not_submitted') returning id`, [project]))[0].id,
    );
    await as(member.id, (q) => q(`update milestones set approval_status = 'submitted' where id = $1`, [ms]));
    await expect(as(member.id, (q) => q(`update milestones set approval_status = 'approved' where id = $1`, [ms]))).rejects.toThrow(/managers/);
    await as(manager.id, (q) => q(`update milestones set approval_status = 'approved', status = 'done' where id = $1`, [ms]));
    const row = await admin(`select approved_by, actual_date from milestones where id = $1`, [ms]);
    expect(row[0].approved_by).toBe(manager.id);
    expect(row[0].actual_date).not.toBeNull();
    const hist = await as(member.id, (q) => q(`select summary from activity_log where entity_id = $1 order by id`, [ms]));
    expect(hist.map((h) => h.summary).join(' | ')).toMatch(/approval approved/);
  });

  it('tracks required evidence and who verified it', async () => {
    const ms = (await admin(`select id from milestones where project_id = $1 limit 1`, [project]))[0].id;
    const ev = await as(member.id, async (q) =>
      (await q(`insert into evidence_items (project_id, entity_type, entity_id, title) values ($1,'milestone',$2,'Signed minutes') returning id, status`, [project, ms]))[0],
    );
    expect(ev.status).toBe('missing');
    const sub = await as(member.id, async (q) => (await q(`update evidence_items set url = 'https://example.org/minutes' where id = $1 returning status, submitted_by`, [ev.id]))[0]);
    expect(sub).toMatchObject({ status: 'submitted', submitted_by: member.id });
    await expect(as(member.id, (q) => q(`update evidence_items set status = 'verified' where id = $1`, [ev.id]))).rejects.toThrow(/managers/);
    await as(manager.id, (q) => q(`update evidence_items set status = 'verified' where id = $1`, [ev.id]));
  });

  it('scores risks and summarises the project', async () => {
    await as(member.id, (q) => q(`insert into risks (project_id, title, probability, impact) values ($1,'Delay',4,4), ($1,'Minor',1,2)`, [project]));
    const s = await as(member.id, async (q) => (await q(`select * from public.project_summary($1)`, [project]))[0]);
    expect(s.risks_high).toBe(1);
    expect(s.tasks_total).toBeGreaterThan(0);
  });

  it('turns meeting actions into tasks and keeps them in sync', async () => {
    const list = (await admin(`select id from lists where project_id = $1 limit 1`, [project]))[0].id;
    const action = await as(member.id, async (q) => {
      const m = (await q(`insert into meetings (project_id, title, starts_at) values ($1,'Monthly call', now()) returning id`, [project]))[0].id;
      await q(`insert into meeting_decisions (meeting_id, project_id, text) values ($1,$1,'Adopt the plan')`, [m]);
      return (await q(`insert into meeting_actions (meeting_id, project_id, title, owner_id, due_date) values ($1,$1,'Circulate minutes',$2,'2026-12-01') returning id`, [m, member.id]))[0].id;
    });
    const card = await as(member.id, async (q) => (await q(`select public.action_to_card($1,$2) id`, [action, list]))[0].id);
    const assignees = await admin(`select user_id from card_assignees where card_id = $1`, [card]);
    expect(assignees).toEqual([{ user_id: member.id }]);
    await as(member.id, (q) => q(`update cards set status = 'done' where id = $1`, [card]));
    const a = await admin(`select status, card_id from meeting_actions where id = $1`, [action]);
    expect(a[0]).toEqual({ status: 'done', card_id: card });
  });

  it('computes work-package progress from tasks', async () => {
    const rows = await as(member.id, (q) => q(`select * from public.work_package_progress($1)`, [project]));
    const wp1 = rows.find((r) => r.tasks_total === 4);
    expect(wp1).toBeTruthy();
    expect(Number(wp1.actual_progress)).toBeCloseTo(25, 1); // kick-off done of 4 WP1 tasks
  });

  it('generates reporting periods across the project', async () => {
    const n = await as(manager.id, async (q) => (await q(`select public.generate_reporting_periods($1, 6) n`, [project]))[0].n);
    expect(n).toBe(4);
    const rp = await admin(`select code, name, start_date, end_date from reporting_periods where project_id = $1 order by start_date`, [project]);
    expect(rp[0]).toEqual({ code: 'RP1', name: 'M1–M6', start_date: '2026-09-01', end_date: '2027-02-28' });
    expect(rp[3]).toMatchObject({ name: 'M19–M24', end_date: '2028-08-31' });
  });
});

describe('KPIs', () => {
  it('records measurements and computes the current value; only managers verify', async () => {
    const k = await as(member.id, async (q) =>
      (await q(`insert into kpis (project_id, code, name, unit, baseline, target, aggregation) values ($1,'K1','Start-ups supported','start-ups',0,20,'sum') returning id`, [project]))[0].id,
    );
    await as(member.id, (q) => q(`insert into kpi_measurements (kpi_id, project_id, measured_on, value) values ($1,$1,'2027-03-01',5), ($1,$1,'2027-09-01',7)`, [k]));
    await expect(as(member.id, (q) => q(`update kpi_measurements set verification_status = 'verified' where kpi_id = $1`, [k]))).rejects.toThrow(/managers/);
    const s = await as(member.id, async (q) => (await q(`select * from public.kpi_status($1) where kpi_id = $2`, [project, k]))[0]);
    expect(Number(s.current_value)).toBe(12);
    expect(s.measurements).toBe(2);
  });
});
