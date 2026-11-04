import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, closeDb, createUser } from './helpers';

let alice: { id: string; email: string };
let bob: { id: string; email: string };
let eve: { id: string; email: string }; // outsider
let ws: string;
let project: string;
let board: string;
let list: string;
let done: string;

async function card(title: string, extra: Record<string, unknown> = {}) {
  const cols = ['list_id', 'board_id', 'project_id', 'title', ...Object.keys(extra)];
  const vals = [list, list, list, title, ...Object.values(extra)];
  const ph = vals.map((_, i) => `$${i + 1}`).join(',');
  return as(alice.id, async (q) => (await q(`insert into cards (${cols.join(',')}) values (${ph}) returning *`, vals))[0]);
}

beforeAll(async () => {
  alice = await createUser('Alice');
  bob = await createUser('Bob');
  eve = await createUser('Eve');
  ws = await as(alice.id, async (q) => (await q(`select public.create_workspace('Team') as id`))[0].id);
  await admin(`insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'member')`, [ws, bob.id]);
  project = await as(alice.id, async (q) => (await q(`select public.create_project($1,'Ops','', 'private') as id`, [ws]))[0].id);
  await as(alice.id, (q) => q(`insert into project_members (project_id, user_id, role) values ($1,$2,'member')`, [project, bob.id]));
  await as(alice.id, async (q) => {
    board = (await q(`insert into boards (project_id, workspace_id, name) values ($1,$1,'B') returning id`, [project]))[0].id;
    list = (await q(`insert into lists (board_id, project_id, name, position) values ($1,$1,'Todo','a0') returning id`, [board]))[0].id;
    done = (await q(`insert into lists (board_id, project_id, name, position) values ($1,$1,'Done','a1') returning id`, [board]))[0].id;
  });
});
afterAll(closeDb);

describe('checklists', () => {
  it('nests items, completes children with the parent, and reopens the parent', async () => {
    const c = await card('With checklist');
    const ids = await as(alice.id, async (q) => {
      const cl = (await q(`insert into checklists (card_id, project_id, title) values ($1,$1,'Steps') returning id`, [c.id]))[0].id;
      const parent = (await q(`insert into checklist_items (checklist_id, card_id, project_id, title) values ($1,$1,$1,'Parent') returning id, card_id, project_id`, [cl]))[0];
      const child = (await q(`insert into checklist_items (checklist_id, card_id, project_id, parent_item_id, title, position) values ($1,$1,$1,$2,'Child','a1') returning id`, [cl, parent.id]))[0];
      expect(parent.card_id).toBe(c.id);
      expect(parent.project_id).toBe(project);
      return { parent: parent.id, child: child.id };
    });
    await as(bob.id, (q) => q(`update checklist_items set done = true where id = $1`, [ids.parent]));
    const after = await admin(`select id, done, done_by from checklist_items where id in ($1,$2)`, [ids.parent, ids.child]);
    expect(after.every((r) => r.done)).toBe(true);
    await as(bob.id, (q) => q(`update checklist_items set done = false where id = $1`, [ids.child]));
    const parent = await admin(`select done from checklist_items where id = $1`, [ids.parent]);
    expect(parent[0].done).toBe(false);
  });
});

describe('recurrence', () => {
  it('computes next occurrences', async () => {
    const r = await admin(`select
      public.next_occurrence('2026-11-04', '{"freq":"daily","interval":2}') as d,
      public.next_occurrence('2026-11-04', '{"freq":"weekly","interval":1,"byweekday":[0,4]}') as w,
      public.next_occurrence('2026-11-06', '{"freq":"weekly","interval":1,"byweekday":[0,4]}') as w2,
      public.next_occurrence('2026-01-31', '{"freq":"monthly","interval":1}') as m,
      public.next_occurrence('2026-11-04', '{"freq":"daily","interval":1,"until":"2026-11-04"}') as u`);
    const fmt = (d: string | null) => d;
    // 2026-11-04 is a Wednesday. Next Friday (4) is 11-06; from Friday next is Monday 11-09.
    expect(fmt(r[0].d)).toBe('2026-11-06');
    expect(fmt(r[0].w)).toBe('2026-11-06');
    expect(fmt(r[0].w2)).toBe('2026-11-09');
    expect(fmt(r[0].m)).toBe('2026-02-28');
    expect(r[0].u).toBeNull();
  });

  it('creates the next occurrence with assignees and a fresh checklist when completed', async () => {
    const c = await card('Weekly report', { due_date: '2026-11-04', recurrence: { freq: 'weekly', interval: 1 } });
    await as(alice.id, async (q) => {
      await q(`insert into card_assignees (card_id, user_id, project_id) values ($1,$2,$1)`, [c.id, bob.id]);
      const cl = (await q(`insert into checklists (card_id, project_id) values ($1,$1) returning id`, [c.id]))[0].id;
      await q(`insert into checklist_items (checklist_id, card_id, project_id, title, done) values ($1,$1,$1,'Collect numbers', true)`, [cl]);
    });
    await as(bob.id, (q) => q(`update cards set status = 'done', list_id = $2 where id = $1`, [c.id, done]));
    const next = await admin(`select id, due_date, status, list_id from cards where recurrence_source_id = $1`, [c.id]);
    expect(next).toHaveLength(1);
    expect(next[0].due_date).toBe('2026-11-11');
    expect(next[0].status).toBe('open');
    expect(next[0].list_id).toBe(list);
    const assignees = await admin(`select user_id from card_assignees where card_id = $1`, [next[0].id]);
    expect(assignees.map((a) => a.user_id)).toEqual([bob.id]);
    const items = await admin(`select done from checklist_items where card_id = $1`, [next[0].id]);
    expect(items).toEqual([{ done: false }]);
    // completing again does not duplicate
    await as(bob.id, (q) => q(`update cards set status = 'open' where id = $1`, [c.id]));
    await as(bob.id, (q) => q(`update cards set status = 'done' where id = $1`, [c.id]));
    const again = await admin(`select count(*)::int n from cards where recurrence_source_id = $1`, [c.id]);
    expect(again[0].n).toBe(1);
  });
});

describe('notifications', () => {
  it('notifies assignees and mentioned users, never the actor, never outsiders', async () => {
    const c = await card('Notify me');
    await as(alice.id, (q) => q(`insert into card_assignees (card_id, user_id, project_id) values ($1,$2,$1)`, [c.id, bob.id]));
    const bobN = await as(bob.id, (q) => q(`select kind, title from notifications where card_id = $1`, [c.id]));
    expect(bobN).toEqual([{ kind: 'assigned', title: 'Alice assigned you to “Notify me”' }]);
    // Mention Eve (no access) and Alice (author) — neither is notified
    await as(alice.id, (q) =>
      q(`insert into comments (card_id, project_id, body, mentions) values ($1,$1,'hi',$2)`, [c.id, [eve.id, alice.id, bob.id]]),
    );
    const eveN = await admin(`select * from notifications where user_id = $1`, [eve.id]);
    expect(eveN).toHaveLength(0);
    const aliceN = await admin(`select * from notifications where user_id = $1 and card_id = $2`, [alice.id, c.id]);
    expect(aliceN).toHaveLength(0);
    const bobMention = await as(bob.id, (q) => q(`select kind from notifications where card_id = $1 order by created_at`, [c.id]));
    expect(bobMention.map((n) => n.kind)).toEqual(['assigned', 'mentioned']);
    // users cannot read others' notifications
    const peek = await as(eve.id, (q) => q(`select * from notifications where user_id = $1`, [bob.id]));
    expect(peek).toHaveLength(0);
  });

  it('respects notification preferences', async () => {
    await admin(`update profiles set preferences = '{"notifyOn":{"assigned":false}}' where id = $1`, [bob.id]);
    const c = await card('Quiet');
    await as(alice.id, (q) => q(`insert into card_assignees (card_id, user_id, project_id) values ($1,$2,$1)`, [c.id, bob.id]));
    const n = await admin(`select * from notifications where user_id = $1 and card_id = $2`, [bob.id, c.id]);
    expect(n).toHaveLength(0);
    await admin(`update profiles set preferences = '{}' where id = $1`, [bob.id]);
  });

  it('generates deduplicated due and overdue reminders', async () => {
    const soon = await card('Due soon', { due_date: new Date().toISOString().slice(0, 10) });
    const late = await card('Late', { due_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) });
    for (const c of [soon, late]) {
      await as(alice.id, (q) => q(`insert into card_assignees (card_id, user_id, project_id) values ($1,$2,$1)`, [c.id, bob.id]));
    }
    await admin(`select public.generate_due_notifications()`);
    await admin(`select public.generate_due_notifications()`);
    const n = await admin(`select kind, card_id from notifications where user_id = $1 and kind in ('due_soon','overdue')`, [bob.id]);
    expect(n.filter((x) => x.card_id === soon.id).map((x) => x.kind)).toEqual(['due_soon']);
    expect(n.filter((x) => x.card_id === late.id).map((x) => x.kind)).toEqual(['overdue']);
  });
});

describe('dependencies, links, custom fields', () => {
  it('rejects dependency cycles', async () => {
    const a = await card('A');
    const b = await card('B');
    const c = await card('C');
    await as(alice.id, async (q) => {
      await q(`insert into card_dependencies (project_id, predecessor_id, successor_id) values ($1,$1,$2)`, [a.id, b.id]);
      await q(`insert into card_dependencies (project_id, predecessor_id, successor_id) values ($1,$1,$2)`, [b.id, c.id]);
    });
    await expect(
      as(alice.id, (q) => q(`insert into card_dependencies (project_id, predecessor_id, successor_id) values ($1,$1,$2)`, [c.id, a.id])),
    ).rejects.toThrow(/cycle/);
  });

  it('validates custom field values by type', async () => {
    const c = await card('Fields');
    const fields = await as(alice.id, async (q) => ({
      num: (await q(`insert into custom_fields (board_id, project_id, name, type) values ($1,$1,'Hours','number') returning id`, [board]))[0].id,
      sel: (await q(`insert into custom_fields (board_id, project_id, name, type, options) values ($1,$1,'Phase','select','["A","B"]') returning id`, [board]))[0].id,
    }));
    await as(alice.id, (q) => q(`insert into card_field_values (card_id, field_id, project_id, value) values ($1,$2,$1,'3.5')`, [c.id, fields.num]));
    await expect(
      as(alice.id, (q) => q(`insert into card_field_values (card_id, field_id, project_id, value) values ($1,$2,$1,'"x"')`, [c.id, fields.sel])),
    ).rejects.toThrow(/not one of the options/);
  });
});

describe('attachments and storage', () => {
  it('restricts finance evidence to finance readers', async () => {
    await as(alice.id, (q) =>
      q(`insert into attachments (project_id, entity_type, kind, name, storage_path) values ($1,'expense','file','invoice.pdf',$2)`, [
        project,
        `${project}/finance/invoice.pdf`,
      ]),
    );
    const bobSees = await as(bob.id, (q) => q(`select id from attachments where entity_type = 'expense'`));
    expect(bobSees).toHaveLength(0);
    // Bob cannot upload into the finance folder either
    await admin(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [`${project}/finance/invoice.pdf`]);
    const obj = await as(bob.id, (q) => q(`select name from storage.objects where name like $1`, [`${project}/finance/%`]));
    expect(obj).toHaveLength(0);
    await expect(
      as(bob.id, (q) => q(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [`${project}/finance/x.pdf`])),
    ).rejects.toThrow(/row-level security/);
    // but may upload ordinary card files
    await as(bob.id, (q) => q(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [`${project}/cards/notes.txt`]));
    // and outsiders cannot read them
    const eveObj = await as(eve.id, (q) => q(`select name from storage.objects where bucket_id = 'attachments'`));
    expect(eveObj).toHaveLength(0);
  });

  it('rejects files stored outside the project folder', async () => {
    const c = await card('Files');
    await expect(
      as(alice.id, (q) =>
        q(`insert into attachments (project_id, card_id, kind, name, storage_path) values ($1,$1,'file','x','someone-else/x')`, [c.id]),
      ),
    ).rejects.toThrow(/project id/);
  });
});

describe('copy, duplicate, search, my work', () => {
  it('copies a card with checklists and labels', async () => {
    const c = await card('Original');
    await as(alice.id, async (q) => {
      const lb = (await q(`insert into labels (board_id, project_id, name) values ($1,$1,'Key') returning id`, [board]))[0].id;
      await q(`insert into card_labels (card_id, label_id, project_id) values ($1,$2,$1)`, [c.id, lb]);
      const cl = (await q(`insert into checklists (card_id, project_id) values ($1,$1) returning id`, [c.id]))[0].id;
      await q(`insert into checklist_items (checklist_id, card_id, project_id, title) values ($1,$1,$1,'step')`, [cl]);
    });
    const copy = await as(bob.id, async (q) => (await q(`select public.copy_card($1,$2,'Copy') as id`, [c.id, done]))[0].id);
    const rows = await admin(
      `select (select count(*) from card_labels where card_id = $1)::int l, (select count(*) from checklist_items where card_id = $1)::int i, (select title from cards where id = $1) t`,
      [copy],
    );
    expect(rows[0]).toEqual({ l: 1, i: 1, t: 'Copy' });
  });

  it('duplicates a board with lists and cards', async () => {
    const id = await as(alice.id, async (q) => (await q(`select public.duplicate_board($1,'Copy of B', true) as id`, [board]))[0].id);
    const counts = await admin(
      `select (select count(*) from lists where board_id = $1)::int l, (select count(*) from cards where board_id = $1)::int c,
              (select count(*) from cards where board_id = $2 and archived_at is null and deleted_at is null)::int orig`,
      [id, board],
    );
    expect(counts[0].l).toBe(2);
    expect(counts[0].c).toBe(counts[0].orig);
  });

  it('searches only within accessible projects', async () => {
    await card('Quarterly evidence collection');
    const mine = await as(bob.id, (q) => q(`select kind, title from public.search_all('evidence')`));
    expect(mine.some((r) => r.title === 'Quarterly evidence collection')).toBe(true);
    const outsider = await as(eve.id, (q) => q(`select kind, title from public.search_all('evidence')`));
    expect(outsider).toHaveLength(0);
  });

  it('lists my assigned work', async () => {
    const work = await as(bob.id, (q) => q(`select title, source from public.my_work()`));
    expect(work.length).toBeGreaterThan(0);
    expect(work.every((w) => typeof w.title === 'string')).toBe(true);
  });

  it('moves a list to another board in the same project and re-parents its cards', async () => {
    const target = await as(alice.id, async (q) => (await q(`insert into boards (project_id, workspace_id, name) values ($1,$1,'Target') returning id`, [project]))[0].id);
    const l2 = await as(alice.id, async (q) => (await q(`insert into lists (board_id, project_id, name) values ($1,$1,'Mover') returning id`, [board]))[0].id);
    await as(alice.id, (q) => q(`insert into cards (list_id, board_id, project_id, title) values ($1,$1,$1,'travels')`, [l2]));
    await as(alice.id, (q) => q(`select public.move_list_to_board($1,$2)`, [l2, target]));
    const c = await admin(`select board_id from cards where list_id = $1`, [l2]);
    expect(c[0].board_id).toBe(target);
  });
});

describe('time entries', () => {
  it('computes minutes from a stopped timer and allows only one running timer per user', async () => {
    const c = await card('Timed');
    await as(bob.id, (q) => q(`insert into time_entries (project_id, card_id, started_at) values ($1,$1, now() - interval '25 minutes')`, [c.id]));
    await expect(
      as(bob.id, (q) => q(`insert into time_entries (project_id, card_id, started_at) values ($1,$1, now())`, [c.id])),
    ).rejects.toThrow(/duplicate key/);
    const stopped = await as(bob.id, (q) =>
      q(`update time_entries set ended_at = now() where user_id = $1 and ended_at is null returning minutes, project_id`, [bob.id]),
    );
    expect(stopped[0].minutes).toBe(25);
    expect(stopped[0].project_id).toBe(project);
  });
});

describe('personal inbox', () => {
  it('creates one private inbox per user that even admins cannot see', async () => {
    const first = await as(bob.id, (q) => q(`select * from public.ensure_personal_inbox($1)`, [ws]));
    const second = await as(bob.id, (q) => q(`select * from public.ensure_personal_inbox($1)`, [ws]));
    expect(first[0]).toEqual(second[0]);
    expect(first[0].list_id).toBeTruthy();
    const adminView = await as(alice.id, (q) => q(`select id from projects where id = $1`, [first[0].project_id]));
    expect(adminView).toHaveLength(0);
    await expect(
      as(bob.id, (q) => q(`insert into project_members (project_id, user_id) values ($1,$2)`, [first[0].project_id, alice.id])),
    ).rejects.toThrow();
  });
});
