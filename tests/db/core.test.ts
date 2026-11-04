import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, closeDb, createUser } from './helpers';

/**
 * Phase 1 — collaborative core. Exercises the real migrations against a real
 * PostgreSQL server with Row Level Security active, using the same role and
 * JWT-claim mechanism that Supabase's PostgREST uses.
 */

let alice: { id: string; email: string };
let bob: { id: string; email: string };
let carol: { id: string; email: string }; // belongs to a different workspace
let ws: string;
let otherWs: string;
let project: string;
let board: string;
let todo: string;
let doing: string;

beforeAll(async () => {
  alice = await createUser('Alice');
  bob = await createUser('Bob');
  carol = await createUser('Carol');
  ws = await as(alice.id, async (q) => (await q(`select public.create_workspace('Office') as id`))[0].id);
  otherWs = await as(carol.id, async (q) => (await q(`select public.create_workspace('Elsewhere') as id`))[0].id);
  project = await as(alice.id, async (q) =>
    (await q(`select public.create_project($1, 'Research project', '', 'private') as id`, [ws]))[0].id,
  );
  await as(alice.id, async (q) => {
    board = (await q(`insert into boards (project_id, workspace_id, name) values ($1, $1, 'Main') returning id`, [project]))[0].id;
    todo = (await q(`insert into lists (board_id, project_id, name, position) values ($1, $1, 'To do', 'a0') returning id`, [board]))[0].id;
    doing = (await q(`insert into lists (board_id, project_id, name, position) values ($1, $1, 'Doing', 'a1') returning id`, [board]))[0].id;
  });
});

afterAll(closeDb);

describe('accounts and workspaces', () => {
  it('creates a profile for every new auth user', async () => {
    const rows = await admin('select display_name, email from profiles where id = $1', [alice.id]);
    expect(rows[0].display_name).toBe('Alice');
    expect(rows[0].email).toBe(alice.email);
  });

  it('makes the creator the workspace owner', async () => {
    const rows = await as(alice.id, (q) => q('select role from workspace_members where workspace_id = $1', [ws]));
    expect(rows).toEqual([{ role: 'owner' }]);
  });

  it('hides workspaces from non-members', async () => {
    const rows = await as(carol.id, (q) => q('select id from workspaces where id = $1', [ws]));
    expect(rows).toHaveLength(0);
  });

  it('refuses anonymous workspace creation', async () => {
    await expect(as(null, (q) => q(`select public.create_workspace('x')`))).rejects.toThrow();
  });

  it('protects the last owner from removal', async () => {
    await expect(
      as(alice.id, (q) => q('delete from workspace_members where workspace_id = $1 and user_id = $2', [ws, alice.id])),
    ).rejects.toThrow(/at least one owner/);
  });
});

describe('invitations', () => {
  it('lets a workspace admin invite and the invitee accept with matching email', async () => {
    const token = await as(alice.id, async (q) =>
      (await q(
        `insert into invitations (workspace_id, project_id, email, role, project_role) values ($1, $2, $3, 'member', 'member') returning token`,
        [ws, project, bob.email.toUpperCase()],
      ))[0].token,
    );
    const mine = await as(bob.id, (q) => q('select * from public.my_invitations()'));
    expect(mine).toHaveLength(1);
    await as(bob.id, (q) => q('select public.accept_invitation($1)', [token]));
    const roles = await as(bob.id, (q) => q('select public.project_role($1) as r', [project]));
    expect(roles[0].r).toBe('member');
  });

  it('rejects acceptance by a user with a different email', async () => {
    const token = await as(alice.id, async (q) =>
      (await q(`insert into invitations (workspace_id, email) values ($1, 'someone@else.test') returning token`, [ws]))[0].token,
    );
    await expect(as(carol.id, (q) => q('select public.accept_invitation($1)', [token]))).rejects.toThrow(
      /different email/,
    );
  });

  it('prevents a plain member from inviting', async () => {
    await expect(
      as(bob.id, (q) => q(`insert into invitations (workspace_id, email) values ($1, 'x@y.test')`, [ws])),
    ).rejects.toThrow();
  });
});

describe('boards, lists and cards', () => {
  it('allows project members to create and move cards; versions increase', async () => {
    const card = await as(bob.id, async (q) =>
      (await q(`insert into cards (list_id, board_id, project_id, title, position) values ($1, $1, $1, 'Draft outline', 'a0') returning id, version, created_by`, [todo]))[0],
    );
    expect(card.version).toBe(1);
    expect(card.created_by).toBe(bob.id);
    const moved = await as(alice.id, (q) =>
      q(`update cards set list_id = $1, position = 'a5' where id = $2 and version = 1 returning version, board_id, project_id`, [doing, card.id]),
    );
    expect(moved[0]).toMatchObject({ version: 2, board_id: board, project_id: project });
    // Stale write (version 1 again) affects no rows → client detects conflict
    const stale = await as(bob.id, (q) => q(`update cards set title = 'x' where id = $1 and version = 1 returning id`, [card.id]));
    expect(stale).toHaveLength(0);
  });

  it('derives project ids from the parent list, so rows cannot be smuggled into other projects', async () => {
    // Carol owns her own project; she tries to insert into Alice's list claiming her own project id.
    const carolProject = await as(carol.id, async (q) =>
      (await q(`select public.create_project($1, 'Carol project') as id`, [otherWs]))[0].id,
    );
    await expect(
      as(carol.id, (q) =>
        q(`insert into cards (list_id, board_id, project_id, title) values ($1, $2, $2, 'sneaky')`, [todo, carolProject]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('isolates cards from users outside the project', async () => {
    const rows = await as(carol.id, (q) => q('select id from cards where project_id = $1', [project]));
    expect(rows).toHaveLength(0);
    const upd = await as(carol.id, (q) => q(`update cards set title = 'hacked' where project_id = $1 returning id`, [project]));
    expect(upd).toHaveLength(0);
  });

  it('sets completed_at when status becomes done and clears it when reopened', async () => {
    const id = await as(bob.id, async (q) =>
      (await q(`insert into cards (list_id, board_id, project_id, title) values ($1,$1,$1,'Finish') returning id`, [todo]))[0].id,
    );
    const done = await as(bob.id, (q) => q(`update cards set status = 'done' where id = $1 returning completed_at`, [id]));
    expect(done[0].completed_at).not.toBeNull();
    const reopened = await as(bob.id, (q) => q(`update cards set status = 'open' where id = $1 returning completed_at`, [id]));
    expect(reopened[0].completed_at).toBeNull();
  });

  it('refuses labels from another board', async () => {
    const otherBoard = await as(alice.id, async (q) =>
      (await q(`insert into boards (project_id, workspace_id, name) values ($1,$1,'Second') returning id`, [project]))[0].id,
    );
    const label = await as(alice.id, async (q) =>
      (await q(`insert into labels (board_id, project_id, name) values ($1,$1,'Other') returning id`, [otherBoard]))[0].id,
    );
    const card = await as(alice.id, async (q) =>
      (await q(`insert into cards (list_id, board_id, project_id, title) values ($1,$1,$1,'L') returning id`, [todo]))[0].id,
    );
    await expect(
      as(alice.id, (q) => q(`insert into card_labels (card_id, label_id, project_id) values ($1,$2,$1)`, [card, label])),
    ).rejects.toThrow(/does not belong/);
  });

  it('only assigns users who can access the project', async () => {
    const card = await as(alice.id, async (q) =>
      (await q(`insert into cards (list_id, board_id, project_id, title) values ($1,$1,$1,'Assign') returning id`, [todo]))[0].id,
    );
    await as(alice.id, (q) => q(`insert into card_assignees (card_id, user_id, project_id) values ($1,$2,$1)`, [card, bob.id]));
    await expect(
      as(alice.id, (q) => q(`insert into card_assignees (card_id, user_id, project_id) values ($1,$2,$1)`, [card, carol.id])),
    ).rejects.toThrow(/not a member/);
  });
});

describe('comments, activity and change feed', () => {
  it('forces the comment author to the caller and records activity', async () => {
    const card = await as(alice.id, async (q) =>
      (await q(`insert into cards (list_id, board_id, project_id, title) values ($1,$1,$1,'Discuss') returning id`, [todo]))[0].id,
    );
    const c = await as(bob.id, async (q) =>
      (await q(`insert into comments (card_id, project_id, author_id, body) values ($1,$1,$2,'Looks good') returning author_id`, [card, alice.id]))[0],
    );
    expect(c.author_id).toBe(bob.id);
    // Alice (manager) can read it, Bob cannot edit someone else's comment
    const acts = await as(alice.id, (q) => q(`select summary, actor_id from activity_log where card_id = $1 order by id`, [card]));
    expect(acts.map((a) => a.summary)).toEqual(['created card “Discuss”', 'commented on “Discuss”']);
    expect(acts[1].actor_id).toBe(bob.id);
  });

  it('writes a change-feed row visible only to project readers', async () => {
    const before = await admin(`select count(*)::int as n from change_feed where project_id = $1`, [project]);
    await as(bob.id, (q) => q(`insert into cards (list_id, board_id, project_id, title) values ($1,$1,$1,'Feed') returning id`, [todo]));
    const after = await admin(`select count(*)::int as n from change_feed where project_id = $1`, [project]);
    expect(after[0].n).toBeGreaterThan(before[0].n);
    const carolSees = await as(carol.id, (q) => q(`select id from change_feed where project_id = $1`, [project]));
    expect(carolSees).toHaveLength(0);
  });

  it('does not let clients write the activity log directly', async () => {
    await expect(
      as(bob.id, (q) => q(`insert into activity_log (project_id, action, entity_type) values ($1, 'x', 'y')`, [project])),
    ).rejects.toThrow();
  });
});

describe('roles and finance permissions', () => {
  it('gives managers finance edit rights and members none by default', async () => {
    const a = await as(alice.id, (q) => q('select public.finance_access($1) as f', [project]));
    const b = await as(bob.id, (q) => q('select public.finance_access($1) as f', [project]));
    expect(a[0].f).toBe('edit');
    expect(b[0].f).toBe('none');
  });

  it('lets viewers read but not edit', async () => {
    await as(alice.id, (q) => q(`update project_members set role = 'viewer' where project_id = $1 and user_id = $2`, [project, bob.id]));
    const read = await as(bob.id, (q) => q('select id from boards where project_id = $1', [project]));
    expect(read.length).toBeGreaterThan(0);
    await expect(
      as(bob.id, (q) => q(`insert into cards (list_id, board_id, project_id, title) values ($1,$1,$1,'no')`, [todo])),
    ).rejects.toThrow(/row-level security/);
    await as(alice.id, (q) => q(`update project_members set role = 'member' where project_id = $1 and user_id = $2`, [project, bob.id]));
  });

  it('keeps private projects hidden from other workspace members', async () => {
    const dave = await createUser('Dave');
    await admin(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [ws, dave.id]);
    const rows = await as(dave.id, (q) => q('select id from projects where id = $1', [project]));
    expect(rows).toHaveLength(0);
    // but a workspace-visible project is readable and editable
    const open = await as(alice.id, async (q) => (await q(`select public.create_project($1, 'Open project') as id`, [ws]))[0].id);
    const role = await as(dave.id, (q) => q('select public.project_role($1) as r', [open]));
    expect(role[0].r).toBe('member');
  });

  it('keeps guests out of workspace-visible projects they were not added to', async () => {
    const guest = await createUser('Guest');
    await admin(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'guest')`, [ws, guest.id]);
    const rows = await as(guest.id, (q) => q('select id from projects where workspace_id = $1', [ws]));
    expect(rows).toHaveLength(0);
    await expect(as(guest.id, (q) => q(`select public.create_project($1, 'Guest project')`, [ws]))).rejects.toThrow();
  });
});
