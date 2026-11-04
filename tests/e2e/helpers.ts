import { expect, type Browser, type Page } from '@playwright/test';

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';

export const runId = Date.now().toString(36);

export function requireBackend() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Set E2E_SUPABASE_URL and E2E_SERVICE_ROLE_KEY (see tests/e2e/README.md).');
}

export interface TestUser {
  email: string;
  password: string;
  name: string;
  id: string;
}

/** Create a confirmed test user through the Auth admin API. */
export async function createTestUser(name: string): Promise<TestUser> {
  requireBackend();
  const email = `e2e-${name.toLowerCase()}-${runId}@example.com`;
  const password = `E2e-${runId}-${Math.random().toString(36).slice(2, 10)}`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: `${name} Test` } }),
  });
  if (!res.ok) throw new Error(`Could not create user: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return { email, password, name: `${name} Test`, id: body.id };
}

export async function deleteTestUser(id: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

export async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto('login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' }).or(page.getByText('Create a workspace'))).toBeVisible();
}

export async function newSession(browser: Browser, user: { email: string; password: string }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, user);
  return { ctx, page };
}
