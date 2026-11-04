import { afterAll, describe, expect, it } from 'vitest';
import { admin, as, closeDb, createUser } from './helpers';

/**
 * Deleting a person through Supabase Auth must succeed even when they are the
 * last owner of a workspace or the last manager of a project, without losing
 * other people's work.
 */
afterAll(closeDb);

async function setupShared() {
  const alice = await createUser('Alice');
  const bob = await createUser('Bob');
  const dave = await createUser('Dave');
  const ws = await as(alice.id, async (q) => (await q(`select public.create_workspace('Shared office') as id`))[0].id as string);
  await admin(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'admin')`, [ws, dave.id, bob.id]);
  const project = await as(alice.id, async (q) => (await q(`select public.create_project($1, 'Shared project', '', 'private') as id`, [ws]))[0].id as string);
  const solo = await as(alice.id, async (q) => (await q(`select public.create_project($1, 'Alice only', '', 'private') as id`, [ws]))[0].id as string);
  await admin(`insert into project_members (project_id, user_id, role) values ($1, $2, 'member')`, [project, dave.id]);
  const card = await as(alice.id, async (q) => {
    const board = (await q(`insert into boards (project_id, workspace_id, name) values ($1, $1, 'Main') returning id`, [project]))[0].id;
    const list = (await q(`insert into lists (board_id, project_id, name, position) values ($1, $1, 'To do', 'a0') returning id`, [board]))[0].id;
    return (await q(`insert into cards (list_id, project_id, board_id, title, position) values ($1, $1, $1, 'Keep me', 'a0') returning id`, [list]))[0].id as string;
  });
  return { alice, bob, dave, ws, project, solo, card };
}

describe('deleting a person', () => {
  it('passes a solely owned workspace and project to the most senior remaining member and keeps their work', async () => {
    const s = await setupShared();
    await admin('delete from auth.users where id = $1', [s.alice.id]);

    const ws = await admin(`select user_id, role from workspace_members where workspace_id = $1 order by role`, [s.ws]);
    expect(ws).toEqual(expect.arrayContaining([{ user_id: s.bob.id, role: 'owner' }, { user_id: s.dave.id, role: 'member' }]));
    expect(ws).toHaveLength(2);

    const pm = await admin(`select user_id, role from project_members where project_id = $1`, [s.project]);
    expect(pm).toEqual([{ user_id: s.dave.id, role: 'manager' }]);

    const [card] = await admin(`select title, created_by from cards where id = $1`, [s.card]);
    expect(card).toEqual({ title: 'Keep me', created_by: null });

    // A project nobody else had joined stays, and the new owner can still manage it.
    const role = await as(s.bob.id, async (q) => (await q(`select public.project_role($1) as r`, [s.solo]))[0].r);
    expect(role).toBe('manager');
  });

  it('removes a workspace whose only member is deleted', async () => {
    const eve = await createUser('Eve');
    const ws = await as(eve.id, async (q) => (await q(`select public.create_workspace('Solo office') as id`))[0].id as string);
    await as(eve.id, (q) => q(`select public.create_project($1, 'Solo project', '', 'private')`, [ws]));
    await admin('delete from auth.users where id = $1', [eve.id]);
    expect(await admin('select 1 from workspaces where id = $1', [ws])).toHaveLength(0);
    expect(await admin('select 1 from projects where workspace_id = $1', [ws])).toHaveLength(0);
  });

  it('still stops a living owner from leaving a workspace without an owner', async () => {
    const s = await setupShared();
    await expect(
      as(s.alice.id, (q) => q('delete from workspace_members where workspace_id = $1 and user_id = $2', [s.ws, s.alice.id])),
    ).rejects.toThrow(/at least one owner/);
    await expect(
      as(s.alice.id, (q) => q(`update project_members set role = 'member' where project_id = $1 and user_id = $2`, [s.project, s.alice.id])),
    ).rejects.toThrow(/at least one manager/);
  });
});
