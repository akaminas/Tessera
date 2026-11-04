import type { Connection } from './connection';
import type { Priority } from './parse';

export interface Destination {
  projectId: string;
  boardId: string;
  listId: string;
  /** shown in settings and notices, e.g. "Website › To do" */
  label: string;
}

export interface Context {
  user: string | null;
  workspaces: { id: string; name: string; can_create: boolean }[];
  projects: {
    id: string;
    name: string;
    workspace_id: string;
    personal: boolean;
    boards: { id: string; name: string; lists: { id: string; name: string }[] }[];
  }[];
}

export interface TaskPayload {
  ref: string;
  card_id?: string;
  title: string;
  description?: string;
  due?: string | null;
  start?: string | null;
  priority?: Priority;
  done?: boolean;
}

export interface SendResult {
  ref: string;
  card_id: string;
  created: boolean;
}

export interface CardStatus {
  id: string;
  status: 'open' | 'in_progress' | 'blocked' | 'done';
  title: string;
  due_date: string | null;
}

/** One HTTP call. In Obsidian this is `requestUrl`, which is not subject to browser CORS rules. */
export type Http = (req: { url: string; method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;

export class TesseraError extends Error {}

export class TesseraApi {
  constructor(
    private conn: Connection,
    private http: Http,
  ) {}

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let res;
    try {
      res = await this.http({
        url: `${this.conn.url}/rest/v1/rpc/${name}`,
        method: 'POST',
        // Only the public key goes in the header; the access key travels in the body.
        headers: { apikey: this.conn.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_token: this.conn.token, ...args }),
      });
    } catch {
      throw new TesseraError('Could not reach Tessera. Check your internet connection.');
    }
    let body: unknown = null;
    try {
      body = res.text ? JSON.parse(res.text) : null;
    } catch {
      /* not JSON */
    }
    if (res.status >= 200 && res.status < 300) return body as T;
    const message = (body as { message?: string } | null)?.message;
    if (res.status === 404) throw new TesseraError('Tessera does not have the plugin feature yet. Update the Tessera site, then try again.');
    throw new TesseraError(message || `Tessera answered with an error (${res.status}).`);
  }

  context() {
    return this.rpc<Context>('obsidian_context', {});
  }

  createProject(workspaceId: string, name: string, description = '') {
    return this.rpc<{ project_id: string; board_id: string; lists: { id: string; name: string }[] }>('obsidian_create_project', {
      p_workspace: workspaceId,
      p_name: name,
      p_description: description,
    });
  }

  async sendTasks(projectId: string, listId: string, tasks: TaskPayload[]): Promise<SendResult[]> {
    const out: SendResult[] = [];
    for (let i = 0; i < tasks.length; i += 200) {
      out.push(...(await this.rpc<SendResult[]>('obsidian_send_tasks', { p_project: projectId, p_list: listId, p_tasks: tasks.slice(i, i + 200) })));
    }
    return out;
  }

  async cardStatus(ids: string[]): Promise<CardStatus[]> {
    const out: CardStatus[] = [];
    for (let i = 0; i < ids.length; i += 500) out.push(...(await this.rpc<CardStatus[]>('obsidian_card_status', { p_ids: ids.slice(i, i + 500) })));
    return out;
  }
}

/** Every list the person can add tasks to, as one flat choice list. */
export function destinations(ctx: Context): Destination[] {
  const out: Destination[] = [];
  for (const p of ctx.projects) {
    const name = p.name;
    for (const b of p.boards) {
      for (const l of b.lists) {
        out.push({ projectId: p.id, boardId: b.id, listId: l.id, label: p.boards.length > 1 ? `${name} › ${b.name} › ${l.name}` : `${name} › ${l.name}` });
      }
    }
  }
  return out;
}
