import pg from 'pg';
import { inject } from 'vitest';
import { randomUUID } from 'node:crypto';

export type Db = pg.Pool;

// Return DATE columns as 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (v: string) => v);

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: inject('dbUrl'), max: 4 });
  return pool;
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = null;
}

/** Create an auth user (as the platform would) and return its id. */
export async function createUser(name: string): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${name.toLowerCase()}-${id.slice(0, 8)}@example.test`;
  await db().query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    id,
    email,
    { display_name: name },
  ]);
  return { id, email };
}

/**
 * Run statements as an authenticated user, inside a transaction with the
 * `authenticated` role and JWT claims set exactly as PostgREST does.
 */
export async function as<T>(userId: string | null, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }),
    ]);
    await client.query(userId ? 'set local role authenticated' : 'set local role anon');
    const q: Query = async (sql, params) => (await client.query(sql, params)).rows;
    const result = await fn(q);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type Query = <R = any>(sql: string, params?: unknown[]) => Promise<R[]>;

/** Run as superuser/service (bypasses RLS) — for assertions only. */
export async function admin<R = any>(sql: string, params?: unknown[]): Promise<R[]> {
  return (await db().query(sql, params)).rows;
}
