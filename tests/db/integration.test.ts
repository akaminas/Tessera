import { afterAll, describe, expect, it } from 'vitest';
import { admin, as, closeDb, createUser } from './helpers';

/**
 * Access keys let an outside tool (the Obsidian plugin) work as a person:
 * exactly their permissions, only a hash stored, revocable.
 */
afterAll(closeDb);

async function setup() {
  const alice = await createUser('Alice');
  const bob = await createUser('Bob');
  const ws = await as(alice.id, async (q) => (await q(`select public.create_workspace('Keys office') as id`))[0].id as string);
  const key = await as(alice.id, async (q) => (await q(`select public.create_integration_token('Laptop') as t`))[0].t as string);
  return { alice, bob, ws, key };
}

/** Call a plugin function the way the plugin does: no session, only the key. */
const call = <T = any>(sql: string, params: unknown[]) => as(null, async (q) => (await q(sql, params))[0].r as T);

describe('access keys', () => {
  it('stores only a hash, shows the key once and lists it for its owner only', async () => {
    const s = await setup();
    expect(s.key).toMatch(/^tsr_[0-9a-f]{64}$/);
    const rows = await admin('select token_hash, hint, name from integration_tokens where user_id = $1', [s.alice.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toContain(s.key);
    expect(rows[0].hint).toBe(s.key.slice(-4));
    expect(await as(s.alice.id, (q) => q('select name from integration_tokens'))).toHaveLength(1);
    expect(await as(s.bob.id, (q) => q('select name from integration_tokens'))).toHaveLength(0);
    // A person cannot write a hash of their own choosing.
    await expect(as(s.alice.id, (q) => q(`insert into integration_tokens (user_id, name, token_hash, hint) values ($1, 'x', 'abc', 'abcd')`, [s.alice.id]))).rejects.toThrow();
    // Anonymous visitors see nothing and cannot mint keys.
    await expect(as(null, (q) => q('select * from integration_tokens'))).rejects.toThrow();
    await expect(as(null, (q) => q(`select public.create_integration_token('x')`))).rejects.toThrow();
  });

  it('rejects unknown and deleted keys', async () => {
    const s = await setup();
    await expect(call('select public.obsidian_context($1) as r', ['tsr_nonsense'])).rejects.toThrow(/not valid/);
    await as(s.alice.id, (q) => q('delete from integration_tokens'));
    await expect(call('select public.obsidian_context($1) as r', [s.key])).rejects.toThrow(/not valid/);
  });

  it('is limited to ten keys per person', async () => {
    const eve = await createUser('Eve');
    await as(eve.id, async (q) => {
      for (let i = 0; i < 10; i++) await q(`select public.create_integration_token($1)`, [`key ${i}`]);
    });
    await expect(as(eve.id, (q) => q(`select public.create_integration_token('eleventh')`))).rejects.toThrow(/at most 10/);
  });
});

describe('the Obsidian functions', () => {
  it('creates a project from a note and shows it only to people who may edit it', async () => {
    const s = await setup();
    const made = await call<{ project_id: string; board_id: string; lists: { id: string; name: string }[] }>(
      `select public.obsidian_create_project($1, $2, 'From my vault', 'Notes about it') as r`,
      [s.key, s.ws],
    );
    expect(made.lists.map((l) => l.name)).toEqual(['To do', 'Doing', 'Done']);
    const [p] = await admin('select name, created_by from projects where id = $1', [made.project_id]);
    expect(p).toEqual({ name: 'From my vault', created_by: s.alice.id });
    expect(await admin('select count(*)::int as n from labels where board_id = $1', [made.board_id])).toEqual([{ n: 6 }]);

    const ctx = await call<any>(`select public.obsidian_context($1) as r`, [s.key]);
    const proj = ctx.projects.find((x: any) => x.id === made.project_id);
    expect(proj.boards[0].lists.map((l: any) => l.name)).toEqual(['To do', 'Doing', 'Done']);

    // Bob has his own key but no access to Alice's private project.
    const bobKey = await as(s.bob.id, async (q) => (await q(`select public.create_integration_token('Bob laptop') as t`))[0].t as string);
    const bobCtx = await call<any>(`select public.obsidian_context($1) as r`, [bobKey]);
    expect(bobCtx.projects.some((x: any) => x.id === made.project_id)).toBe(false);
    await expect(
      call(`select public.obsidian_send_tasks($1, $2, $3, '[{"ref":"1","title":"Sneaky"}]'::jsonb) as r`, [bobKey, made.project_id, made.lists[0].id]),
    ).rejects.toThrow(/cannot add tasks/);
    await expect(call(`select public.obsidian_create_project($1, $2, 'Nope') as r`, [bobKey, s.ws])).rejects.toThrow();
  });

  it('adds tasks in order, updates them when sent again, and attributes them to the key owner', async () => {
    const s = await setup();
    const made = await call<any>(`select public.obsidian_create_project($1, $2, 'Tasks from notes') as r`, [s.key, s.ws]);
    const list = made.lists[0].id as string;
    const tasks: Record<string, unknown>[] = [
      { ref: 'a', title: 'Draft budget', due: '2026-11-20', priority: 'high', description: 'From Obsidian note “Plan”' },
      { ref: 'b', title: 'Book venue', start: '2026-11-02' },
      { ref: 'c', title: 'Already done', done: true },
    ];
    const sent = await call<any[]>(`select public.obsidian_send_tasks($1, $2, $3, $4::jsonb) as r`, [s.key, made.project_id, list, JSON.stringify(tasks)]);
    expect(sent.map((x) => x.created)).toEqual([true, true, true]);

    const cards = await admin(`select title, status, priority, due_date, start_date, created_by, completed_at is not null as completed from cards where list_id = $1 order by position`, [list]);
    expect(cards.map((c) => c.title)).toEqual(['Draft budget', 'Book venue', 'Already done']);
    expect(cards[0]).toMatchObject({ priority: 'high', due_date: '2026-11-20', created_by: s.alice.id });
    expect(cards[1]).toMatchObject({ start_date: '2026-11-02', priority: 'none', status: 'open' });
    expect(cards[2]).toMatchObject({ status: 'done', completed: true });

    // Sending the same notes again changes the existing cards instead of duplicating them.
    const again: Record<string, unknown>[] = tasks.map((t, i) => ({ ...t, card_id: sent[i].card_id }));
    again[0] = { ...again[0], title: 'Draft the budget', due: '2026-12-01' };
    again[2] = { ...again[2], done: false };
    const second = await call<any[]>(`select public.obsidian_send_tasks($1, $2, $3, $4::jsonb) as r`, [s.key, made.project_id, list, JSON.stringify(again)]);
    expect(second.map((x) => x.created)).toEqual([false, false, false]);
    const after = await admin(`select title, status, due_date from cards where list_id = $1 order by position`, [list]);
    expect(after).toEqual([
      { title: 'Draft the budget', status: 'open', due_date: '2026-12-01' },
      { title: 'Book venue', status: 'open', due_date: null },
      { title: 'Already done', status: 'open', due_date: null },
    ]);
    // Activity records name the person, as if they had used the app.
    const act = await admin(`select count(*)::int as n from activity_log where project_id = $1 and actor_id = $2`, [made.project_id, s.alice.id]);
    expect(act[0].n).toBeGreaterThan(0);
  });

  it('keeps counting positions past the first 62 tasks in a list', async () => {
    const s = await setup();
    const made = await call<any>(`select public.obsidian_create_project($1, $2, 'Long list') as r`, [s.key, s.ws]);
    const list = made.lists[0].id as string;
    const mk = (from: number, n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ ref: String(from + i), title: `Task ${String(from + i).padStart(3, '0')}` })));
    await call(`select public.obsidian_send_tasks($1, $2, $3, $4::jsonb) as r`, [s.key, made.project_id, list, mk(0, 70)]);
    await call(`select public.obsidian_send_tasks($1, $2, $3, $4::jsonb) as r`, [s.key, made.project_id, list, mk(70, 70)]);
    const rows = await admin(`select title, position from cards where list_id = $1 order by position collate "C"`, [list]);
    expect(rows).toHaveLength(140);
    expect(rows.map((r) => r.title)).toEqual(Array.from({ length: 140 }, (_, i) => `Task ${String(i).padStart(3, '0')}`));
    expect(new Set(rows.map((r) => r.position)).size).toBe(140);
    expect(Math.max(...rows.map((r) => r.position.length))).toBeLessThanOrEqual(4);
  });

  it('reports the current state of tasks and hides ones the key owner cannot read', async () => {
    const s = await setup();
    const made = await call<any>(`select public.obsidian_create_project($1, $2, 'Status') as r`, [s.key, s.ws]);
    const sent = await call<any[]>(`select public.obsidian_send_tasks($1, $2, $3, '[{"ref":"x","title":"Finish me"}]'::jsonb) as r`, [s.key, made.project_id, made.lists[0].id]);
    await as(s.alice.id, (q) => q(`update cards set status = 'done' where id = $1`, [sent[0].card_id]));
    const st = await call<any[]>(`select public.obsidian_card_status($1, $2::uuid[]) as r`, [s.key, [sent[0].card_id]]);
    expect(st).toEqual([{ id: sent[0].card_id, status: 'done', title: 'Finish me', due_date: null }]);

    const bobKey = await as(s.bob.id, async (q) => (await q(`select public.create_integration_token('Bob') as t`))[0].t as string);
    expect(await call<any[]>(`select public.obsidian_card_status($1, $2::uuid[]) as r`, [bobKey, [sent[0].card_id]])).toEqual([]);
  });

  it('refuses a list that belongs to another project and malformed input', async () => {
    const s = await setup();
    const a = await call<any>(`select public.obsidian_create_project($1, $2, 'A') as r`, [s.key, s.ws]);
    const b = await call<any>(`select public.obsidian_create_project($1, $2, 'B') as r`, [s.key, s.ws]);
    await expect(
      call(`select public.obsidian_send_tasks($1, $2, $3, '[{"ref":"1","title":"x"}]'::jsonb) as r`, [s.key, a.project_id, b.lists[0].id]),
    ).rejects.toThrow(/list was not found/);
    await expect(call(`select public.obsidian_send_tasks($1, $2, $3, '{}'::jsonb) as r`, [s.key, a.project_id, a.lists[0].id])).rejects.toThrow(/list of tasks/);
  });
});
