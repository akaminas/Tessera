import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';

const ROOT = resolve(__dirname, '../..');

const PG_BIN = join(ROOT, 'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe');

/** Stop test clusters left behind by an interrupted run (only our own data dirs). */
function cleanupStale() {
  const tmp = join(ROOT, '.tmp');
  if (!existsSync(tmp)) return;
  for (const d of readdirSync(tmp).filter((n) => n.startsWith('pgdata-'))) {
    const dir = join(tmp, d);
    if (process.platform === 'win32' && existsSync(PG_BIN) && existsSync(join(dir, 'postmaster.pid'))) {
      try {
        execFileSync(PG_BIN, ['stop', '-D', dir, '-m', 'immediate', '-w'], { stdio: 'ignore' });
      } catch {
        /* not running */
      }
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* still locked; ignored — a fresh directory and port are used below */
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === 'object' && addr ? resolvePort(addr.port) : reject(new Error('no port'))));
    });
  });
}

export default async function setup(project: TestProject) {
  cleanupStale();
  const PORT = await freePort();
  const dataDir = join(ROOT, '.tmp', `pgdata-${process.pid}`);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(join(ROOT, '.tmp'), { recursive: true });
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('tessera');
  const url = `postgres://postgres:postgres@localhost:${PORT}/tessera`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(readFileSync(join(ROOT, 'tests/db/supabase-shim.sql'), 'utf8'));
    const dir = join(ROOT, 'supabase/migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
  } catch (err) {
    await client.end();
    await server.stop();
    throw err;
  }
  await client.end();
  project.provide('dbUrl', url);
  return async () => {
    await server.stop();
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
