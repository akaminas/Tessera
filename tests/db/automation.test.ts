import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { admin, as, closeDb, createUser } from './helpers';

let manager: { id: string };
let member: { id: string };
let outsider: { id: string };
let ws: string;
let project: string;
let board: string;
let todo: string;
let doing: string;
let done: string;

const today = () => new Date().toISOString().slice(0, 10);
const daysFromToday = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function card(title: string, list = todo, extra: Record<string, unknown> = {}) {
  const cols = ['list_id', 'board_id', 'project_id', 'title', ...Object.keys(extra)];
  const vals = [list, list, list, title, ...Object.values(extra)];
  return as(member.id, async (q) => (await q(`insert into cards (${cols.join(',')}) values (${vals.map((_, i) => `$${i + 1}`).join(',')}) returning *`, vals))[0]);
}
async function rule(def: Record<string, unknown>) {
  const cols = Object.keys(def);
  const vals = Object.values(def).map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
  return as(member.id, async (q) => (await q(`insert into automation_rules (project_id, ${cols.join(',')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}) returning *`, [project, ...vals]))[0]);
}
const work = () => admin(`select public.process_automation_queue(100) n`);

beforeAll(async () => {
  manager = await createUser('Manager');
  member = await createUser('Member');
  outsider = await createUser('Outsider');
  ws = await as(manager.id, async (q) => (await q(`select public.create_workspace('Auto') as id`))[0].id);
  await admin(`insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'member')`, [ws, member.id]);
  project = await as(manager.id, async (q) => (await q(`select public.create_project($1,'Automated','', 'private') as id`, [ws]))[0].id);
  await as(manager.id, (q) => q(`insert into project_members (project_id, user_id, role) values ($1,$2,'member')`, [project, member.id]));
  await as(manager.id, async (q) => {
    board = (await q(`insert into boards (project_id, workspace_id, name) values ($1,$1,'Ops') returning id`, [project]))[0].id;
    todo = (await q(`insert into lists (board_id, project_id, name, position) values ($1,$1,'To do','a0') returning id`, [board]))[0].id;
    doing = (await q(`insert into lists (board_id, project_id, name, position) values ($1,$1,'Doing','a1') returning id`, [board]))[0].id;
    done = (await q(`insert into lists (board_id, project_id, name, position) values ($1,$1,'Done','a2') returning id`, [board]))[0].id;
  });
});
afterAll(closeDb);

describe('event rules', () => {
  it('completes a task and notifies assignees when moved to Done', async () => {
    const r = await rule({
      name: 'Done list completes',
      kind: 'rule',
      trigger: { type: 'card.moved', list_id: done },
      actions: [{ type: 'set_status', status: 'done' }, { type: 'notify', to: 'assignees', title: '{card} was completed' }],
    });
    const c = await card('Write minutes');
    await as(member.id, (q) => q(`insert into card_assignees (card_id, user_id, project_id) values ($1,$2,$1)`, [c.id, manager.id]));
    await as(member.id, (q) => q(`update cards set list_id = $1 where id = $2`, [done, c.id]));
    await work();
    const row = await admin(`select status from cards where id = $1`, [c.id]);
    expect(row[0].status).toBe('done');
    const n = await admin(`select title from notifications where user_id = $1 and kind = 'automation' and card_id = $2`, [manager.id, c.id]);
    expect(n).toEqual([{ title: 'Write minutes was completed' }]);
    const runs = await as(member.id, (q) => q(`select status from automation_runs where rule_id = $1`, [r.id]));
    expect(runs).toEqual([{ status: 'success' }]);
    await as(member.id, (q) => q(`update automation_rules set enabled = false where id = $1`, [r.id]));
  });

  it('updates the parent task when a checklist is completed', async () => {
    await rule({ name: 'Checklist done → task done', kind: 'rule', trigger: { type: 'checklist.completed' }, actions: [{ type: 'complete' }] });
    const c = await card('With steps');
    const items = await as(member.id, async (q) => {
      const cl = (await q(`insert into checklists (card_id, project_id) values ($1,$1) returning id`, [c.id]))[0].id;
      return q(`insert into checklist_items (checklist_id, card_id, project_id, title) values ($1,$1,$1,'one'), ($1,$1,$1,'two') returning id`, [cl]);
    });
    await as(member.id, (q) => q(`update checklist_items set done = true where id = $1`, [items[0].id]));
    await work();
    expect((await admin(`select status from cards where id = $1`, [c.id]))[0].status).toBe('open');
    await as(member.id, (q) => q(`update checklist_items set done = true where id = $1`, [items[1].id]));
    await work();
    expect((await admin(`select status from cards where id = $1`, [c.id]))[0].status).toBe('done');
  });

  it('completes the parent when its last subtask is done and filters by condition', async () => {
    await rule({
      name: 'Close parent',
      kind: 'rule',
      trigger: { type: 'card.completed' },
      conditions: [{ field: 'is_subtask', op: 'is' }],
      actions: [{ type: 'complete_parent' }],
    });
    const parent = await card('Parent');
    const a = await card('Child A', todo, { parent_id: parent.id });
    const b = await card('Child B', todo, { parent_id: parent.id });
    await as(member.id, (q) => q(`update cards set status = 'done' where id = $1`, [a.id]));
    await work();
    expect((await admin(`select status from cards where id = $1`, [parent.id]))[0].status).toBe('open');
    await as(member.id, (q) => q(`update cards set status = 'done' where id = $1`, [b.id]));
    await work();
    expect((await admin(`select status from cards where id = $1`, [parent.id]))[0].status).toBe('done');
  });

  it('stops automation loops', async () => {
    const loopA = await rule({ name: 'Doing → To do', kind: 'rule', trigger: { type: 'card.moved', list_id: doing }, actions: [{ type: 'move_to_list', list_id: todo }] });
    const loopB = await rule({ name: 'To do → Doing', kind: 'rule', trigger: { type: 'card.moved', list_id: todo }, actions: [{ type: 'move_to_list', list_id: doing }] });
    const c = await card('Ping pong');
    await as(member.id, (q) => q(`update cards set list_id = $1 where id = $2`, [doing, c.id]));
    for (let i = 0; i < 6; i++) await work();
    const pending = await admin(`select count(*)::int n from automation_events where project_id = $1 and status = 'pending'`, [project]);
    expect(pending[0].n).toBe(0);
    const runs = await admin(`select count(*)::int n from automation_runs where rule_id in ($1,$2)`, [loopA.id, loopB.id]);
    expect(runs[0].n).toBeLessThanOrEqual(3);
    await as(member.id, (q) => q(`update automation_rules set enabled = false where id in ($1,$2)`, [loopA.id, loopB.id]));
  });

  it('logs failures and retries with backoff', async () => {
    const bad = await rule({ name: 'Broken', kind: 'rule', trigger: { type: 'card.created' }, actions: [{ type: 'move_to_list', list_id: '00000000-0000-0000-0000-000000000000' }] });
    await card('Trigger failure');
    await work();
    const runs = await admin(`select status, message from automation_runs where rule_id = $1`, [bad.id]);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].message).toMatch(/not found/);
    const ev = await admin(`select status, attempts, next_attempt_at > now() as later from automation_events where project_id = $1 and event_type = 'card.created' order by id desc limit 1`, [project]);
    expect(ev[0]).toMatchObject({ status: 'pending', attempts: 1, later: true });
    await as(member.id, (q) => q(`update automation_rules set enabled = false where id = $1`, [bad.id]));
  });
});

describe('time-based rules', () => {
  it('runs a weekly scheduled rule that creates a coordination task', async () => {
    const r = await rule({
      name: 'Monday coordination',
      kind: 'scheduled',
      schedule: { freq: 'weekly', weekday: 0, time: '08:00', tz: 'UTC' },
      trigger: {},
      actions: [{ type: 'create_card', list_id: todo, title: 'Coordination call {date}', due_in_days: 0, checklist: ['Agenda', 'Minutes'] }],
    });
    expect(r.next_run_at).not.toBeNull();
    const next = new Date(r.next_run_at);
    expect(next.getUTCDay()).toBe(1); // Monday
    await admin(`update automation_rules set next_run_at = now() - interval '1 minute' where id = $1`, [r.id]);
    await admin(`select public.run_time_rules(now())`);
    const cards = await admin(`select id, title, due_date from cards where project_id = $1 and title like 'Coordination call%'`, [project]);
    expect(cards).toHaveLength(1);
    expect(cards[0].due_date).toBe(today());
    const items = await admin(`select count(*)::int n from checklist_items where card_id = $1`, [cards[0].id]);
    expect(items[0].n).toBe(2);
    const after = await admin(`select next_run_at > now() as future from automation_rules where id = $1`, [r.id]);
    expect(after[0].future).toBe(true);
  });

  it('notifies owners of overdue tasks exactly once per due date', async () => {
    const r = await rule({ name: 'Overdue', kind: 'due_date', trigger: { target: 'cards', offset_days: 1 }, actions: [{ type: 'notify', to: 'assignees', title: '{card} is overdue' }] });
    const c = await card('Late report', todo, { due_date: daysFromToday(-1) });
    await as(member.id, (q) => q(`insert into card_assignees (card_id, user_id, project_id) values ($1,$2,$1)`, [c.id, manager.id]));
    for (let i = 0; i < 2; i++) {
      await admin(`update automation_rules set next_run_at = now() - interval '1 minute' where id = $1`, [r.id]);
      await admin(`select public.run_time_rules(now())`);
    }
    const n = await admin(`select count(*)::int n from notifications where user_id = $1 and title = 'Late report is overdue'`, [manager.id]);
    expect(n[0].n).toBe(1);
  });

  it('requests evidence before a milestone deadline', async () => {
    const ms = await as(manager.id, async (q) =>
      (await q(`insert into milestones (project_id, title, due_date, verification, owner_id) values ($1,'Demo day',$2,'Event report and attendance list',$3) returning id`, [project, daysFromToday(7), member.id]))[0].id,
    );
    const r = await rule({ name: 'Evidence 7 days before', kind: 'due_date', trigger: { target: 'milestones', offset_days: -7 }, actions: [{ type: 'request_evidence' }] });
    await admin(`update automation_rules set next_run_at = now() - interval '1 minute' where id = $1`, [r.id]);
    await admin(`select public.run_time_rules(now())`);
    const ev = await admin(`select title, status from evidence_items where entity_id = $1`, [ms]);
    expect(ev).toEqual([{ title: 'Event report and attendance list', status: 'missing' }]);
    const n = await admin(`select count(*)::int n from notifications where user_id = $1 and title like 'Evidence needed%'`, [member.id]);
    expect(n[0].n).toBe(1);
  });

  it('reminds members about missing submissions when a reporting period ends', async () => {
    await admin(`insert into reporting_periods (project_id, code, name, start_date, end_date) values ($1,'RP1','M1–M6',$2,$3)`, [project, daysFromToday(-170), daysFromToday(10)]);
    const r = await rule({ name: 'Period ending', kind: 'due_date', trigger: { target: 'reporting_periods', offset_days: -10 }, actions: [{ type: 'notify_missing_submissions' }] });
    await admin(`update automation_rules set next_run_at = now() - interval '1 minute' where id = $1`, [r.id]);
    await admin(`select public.run_time_rules(now())`);
    const n = await admin(`select title from notifications where user_id = $1 and title like 'Reporting period ending%'`, [member.id]);
    expect(n[0].title).toMatch(/1 required item still missing/);
  });
});

describe('buttons and permissions', () => {
  it('runs a card button server-side and refuses outsiders', async () => {
    const btn = await rule({ name: 'Add review checklist', kind: 'card_button', trigger: {}, actions: [{ type: 'add_checklist', title: 'Review', items: ['Read', 'Approve'] }] });
    const c = await card('Needs review');
    const res = await as(member.id, async (q) => (await q(`select public.run_button($1,$2) r`, [btn.id, c.id]))[0].r);
    expect(res.actions).toBe(1);
    expect((await admin(`select count(*)::int n from checklist_items where card_id = $1`, [c.id]))[0].n).toBe(2);
    await expect(as(outsider.id, (q) => q(`select public.run_button($1,$2)`, [btn.id, c.id]))).rejects.toThrow(/Not allowed/);
  });

  it('keeps integration secrets visible to managers only', async () => {
    await as(manager.id, (q) => q(`insert into integrations (project_id, kind, name, url) values ($1,'webhook','Hook','https://example.org/hook')`, [project]));
    const m = await as(member.id, (q) => q(`select * from integrations where project_id = $1`, [project]));
    expect(m).toHaveLength(0);
    const g = await as(manager.id, (q) => q(`select secret from integrations where project_id = $1`, [project]));
    expect(g[0].secret).toHaveLength(48);
  });
});

describe('webhooks', () => {
  it('queues signed deliveries for subscribed events', async () => {
    const integ = (await admin(`select id, secret from integrations where project_id = $1`, [project]))[0];
    await admin(`update integrations set events = array['task.completed'] where id = $1`, [integ.id]);
    const c = await card('Ship it');
    await as(member.id, (q) => q(`update cards set status = 'done' where id = $1`, [c.id]));
    await work();
    const d = await admin(`select event, payload, signature, status from webhook_deliveries where integration_id = $1`, [integ.id]);
    expect(d).toHaveLength(1);
    expect(d[0].event).toBe('task.completed');
    expect(d[0].payload.data.title).toBe('Ship it');
    const body = (await admin(`select payload::text t from webhook_deliveries where integration_id = $1`, [integ.id]))[0].t;
    const expected = 'sha256=' + createHmac('sha256', integ.secret).update(body).digest('hex');
    expect(d[0].signature).toBe(expected);
  });

  it('reports clearly when pg_net is unavailable, and gives up after three attempts', async () => {
    const hasNet = (await admin(`select count(*)::int n from pg_extension where extname = 'pg_net'`))[0].n;
    if (hasNet) return;
    for (let i = 0; i < 3; i++) {
      await admin(`update webhook_deliveries set next_attempt_at = now() - interval '1 second' where project_id = $1`, [project]);
      await admin(`select public.deliver_webhooks(10)`);
    }
    const d = await admin(`select status, attempts, error from webhook_deliveries where project_id = $1`, [project]);
    expect(d[0]).toMatchObject({ status: 'failed', attempts: 3 });
    expect(d[0].error).toMatch(/pg_net/);
  });

  it('formats Slack messages as text', async () => {
    const hook = await as(manager.id, async (q) =>
      (await q(`insert into integrations (project_id, kind, name, url, events) values ($1,'slack','Team channel','https://hooks.slack.com/services/x', array['task.created']) returning id`, [project]))[0].id,
    );
    await card('Announce the call');
    await work();
    const d = await admin(`select payload from webhook_deliveries where integration_id = $1`, [hook]);
    expect(d[0].payload).toEqual({ text: 'New task: Announce the call' });
  });
});

describe('scheduler', () => {
  it('runs end to end and reports what it did', async () => {
    const r = (await admin(`select public.run_scheduler() r`))[0].r;
    expect(r).toHaveProperty('events');
    expect(r).toHaveProperty('webhooks');
  });

  it('serves a private calendar feed by token only', async () => {
    const token = (await admin(`select calendar_token from user_secrets where user_id = $1`, [manager.id]))[0].calendar_token;
    const rows = await admin(`select uid, title from public.calendar_feed($1)`, [token]);
    expect(rows.some((r) => r.uid.startsWith('card-'))).toBe(true);
    expect(rows.some((r) => r.uid.startsWith('milestone-'))).toBe(true);
    await expect(as(member.id, (q) => q(`select * from public.calendar_feed($1)`, [token]))).rejects.toThrow(/permission denied/);
  });
});
