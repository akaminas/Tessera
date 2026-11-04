import { describe, expect, it, vi } from 'vitest';
import { TesseraApi, TesseraError, destinations, type Context, type Http } from './api';

const conn = { url: 'https://abc.supabase.co', anonKey: 'sb_publishable_xyz', token: 'tsr_secret', site: 'https://s' };

function api(handler: (req: Parameters<Http>[0]) => { status: number; body?: unknown }) {
  const http = vi.fn<Http>(async (req) => {
    const r = handler(req);
    return { status: r.status, text: r.body === undefined ? '' : JSON.stringify(r.body) };
  });
  return { api: new TesseraApi(conn, http), http };
}

describe('TesseraApi', () => {
  it('sends the access key in the body and only the public key in the headers', async () => {
    const { api: a, http } = api(() => ({ status: 200, body: [] }));
    await a.sendTasks('p1', 'l1', [{ ref: '1', title: 'x' }]);
    const req = http.mock.calls[0][0];
    expect(req.url).toBe('https://abc.supabase.co/rest/v1/rpc/obsidian_send_tasks');
    expect(req.headers).toEqual({ apikey: 'sb_publishable_xyz', 'Content-Type': 'application/json' });
    expect(JSON.parse(req.body!)).toMatchObject({ p_token: 'tsr_secret', p_project: 'p1', p_list: 'l1' });
    expect(JSON.stringify(req.headers)).not.toContain('tsr_secret');
  });

  it('splits large batches', async () => {
    const { api: a, http } = api((req) => ({
      status: 200,
      body: JSON.parse(req.body!).p_tasks.map((t: { ref: string }) => ({ ref: t.ref, card_id: 'c' + t.ref, created: true })),
    }));
    const tasks = Array.from({ length: 450 }, (_, i) => ({ ref: String(i), title: `t${i}` }));
    const res = await a.sendTasks('p', 'l', tasks);
    expect(res).toHaveLength(450);
    expect(http.mock.calls).toHaveLength(3);
  });

  it('turns server messages into readable errors', async () => {
    const { api: a } = api(() => ({ status: 400, body: { message: 'This access key is not valid. It may have been deleted in Tessera.' } }));
    await expect(a.context()).rejects.toThrow(/not valid/);
    const { api: b } = api(() => ({ status: 404, body: { message: 'Could not find the function' } }));
    await expect(b.context()).rejects.toBeInstanceOf(TesseraError);
    const down = new TesseraApi(conn, async () => {
      throw new Error('ENOTFOUND');
    });
    await expect(down.context()).rejects.toThrow(/internet connection/);
  });
});

describe('destinations', () => {
  const ctx: Context = {
    user: 'Alex',
    workspaces: [],
    projects: [
      { id: 'p1', name: 'Website', workspace_id: 'w', personal: false, boards: [{ id: 'b1', name: 'Tasks', lists: [{ id: 'l1', name: 'To do' }, { id: 'l2', name: 'Done' }] }] },
      {
        id: 'p2',
        name: 'Thesis',
        workspace_id: 'w',
        personal: false,
        boards: [
          { id: 'b2', name: 'Writing', lists: [{ id: 'l3', name: 'Ideas' }] },
          { id: 'b3', name: 'Reading', lists: [{ id: 'l4', name: 'Queue' }] },
        ],
      },
    ],
  };
  it('lists every list, naming the board only when a project has several', () => {
    expect(destinations(ctx).map((d) => d.label)).toEqual(['Website › To do', 'Website › Done', 'Thesis › Writing › Ideas', 'Thesis › Reading › Queue']);
  });
});
