#!/usr/bin/env node
/**
 * One-shot backend setup for a Supabase project.
 *
 *   node scripts/setup-supabase.mjs [path/to/supabase.env]
 *
 * The env file (kept OUTSIDE the repository) must define:
 *   SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD
 * Optional: APP_URL (default https://akaminas.github.io/Tessera/)
 *
 * Steps: link + push migrations, configure auth URLs, deploy Edge Functions,
 * set function secrets. Secrets are never printed.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const file = process.argv[2] || join(homedir(), '.tessera', 'supabase.env');
const env = Object.fromEntries(
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
for (const k of ['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) {
  if (!env[k]) {
    console.error(`Missing ${k} in ${file}`);
    process.exit(1);
  }
}
const ref = env.SUPABASE_PROJECT_REF;
const appUrl = env.APP_URL || 'https://akaminas.github.io/Tessera/';
const childEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD };

function run(args, { allowFail = false } = {}) {
  console.log(`$ supabase ${args.filter((a) => a !== env.SUPABASE_DB_PASSWORD).join(' ')}`);
  const r = spawnSync('npx', ['supabase', ...args], { stdio: 'inherit', env: childEnv, shell: process.platform === 'win32' });
  if (r.status !== 0 && !allowFail) {
    console.error('Command failed.');
    process.exit(r.status ?? 1);
  }
  return r.status === 0;
}

async function api(method, path, body) {
  const res = await fetch(`https://api.supabase.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

console.log(`Project ${ref}`);
run(['link', '--project-ref', ref, '--password', env.SUPABASE_DB_PASSWORD]);
run(['db', 'push', '--password', env.SUPABASE_DB_PASSWORD, '--include-all']);

const base = appUrl.endsWith('/') ? appUrl : `${appUrl}/`;
await api('PATCH', `/v1/projects/${ref}/config/auth`, {
  site_url: base,
  uri_allow_list: [
    `${base}auth/callback`,
    `${base}auth/reset`,
    `${base}**`,
    'http://localhost:5173/Tessera/**',
    'http://localhost:4173/Tessera/**',
  ].join(','),
});
console.log('Auth redirect URLs configured.');

run(['functions', 'deploy', 'ical', '--no-verify-jwt', '--use-api', '--project-ref', ref]);
run(['functions', 'deploy', 'email-digest', '--no-verify-jwt', '--use-api', '--project-ref', ref]);
run(['secrets', 'set', `APP_URL=${base}`, '--project-ref', ref]);

const keys = await api('GET', `/v1/projects/${ref}/api-keys?reveal=false`);
const anon = keys.find((k) => k.name === 'anon' || k.type === 'publishable');
console.log(`Done. Public settings for the frontend build:\n  VITE_SUPABASE_URL=https://${ref}.supabase.co\n  VITE_SUPABASE_ANON_KEY=${anon ? '(available: ' + (anon.name || anon.type) + ')' : '(see dashboard)'}`);
