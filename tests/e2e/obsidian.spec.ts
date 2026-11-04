import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, newSession, runId, type TestUser } from './helpers';
import { decodeConnection } from '../../integrations/obsidian/src/connection';
import { TesseraApi, type Http } from '../../integrations/obsidian/src/api';

/** What Obsidian's requestUrl does, using plain fetch. */
const http: Http = async ({ url, method, headers, body }) => {
  const res = await fetch(url, { method, headers, body });
  return { status: res.status, text: await res.text() };
};

test.describe.serial('Obsidian connection', () => {
  let olga: TestUser;
  test.beforeAll(async () => {
    olga = await createTestUser('Olga');
  });
  test.afterAll(async () => {
    if (olga) await deleteTestUser(olga.id);
  });

  test('a key made in Settings lets the plugin create a project and tasks, and deleting it cuts access', async ({ browser }) => {
    const { page, ctx } = await newSession(browser, olga);
    await page.getByLabel('Create a workspace').fill(`Olga ${runId}`);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

    await page.goto('settings/obsidian');
    await page.getByPlaceholder('Laptop vault').fill('Test vault');
    await page.getByRole('button', { name: 'Create key' }).click();
    const code = await page.getByLabel('Connection code').inputValue();
    const decoded = decodeConnection(code);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    // The plugin's own client, over the real network.
    const api = new TesseraApi(decoded.connection, http);
    const context = await api.context();
    expect(context.workspaces.map((w) => w.name)).toContain(`Olga ${runId}`);
    const made = await api.createProject(context.workspaces[0].id, `Vault project ${runId}`, 'From Obsidian note “Plan”.');
    const sent = await api.sendTasks(made.project_id, made.lists[0].id, [
      { ref: '1', title: 'Task from my notes', due: '2031-05-20', priority: 'high', description: 'From Obsidian note “Plan”.' },
      { ref: '2', title: 'Second task from my notes' },
    ]);
    expect(sent.map((s) => s.created)).toEqual([true, true]);

    // They appear on the board for the person who owns the key.
    await page.goto(`p/${made.project_id}`);
    const todo = page.getByRole('region', { name: 'List To do' });
    await expect(todo.getByText('Task from my notes', { exact: true })).toBeVisible();
    await expect(todo.getByText('Second task from my notes')).toBeVisible();

    // Finishing it in Tessera shows up in the plugin's status check.
    await todo.getByText('Task from my notes', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Mark as done' }).check();
    await expect(page.getByRole('checkbox', { name: 'Mark as not done' })).toBeChecked();
    await expect(page.locator('html[data-saving]')).toHaveCount(0);
    await expect.poll(async () => (await api.cardStatus([sent[0].card_id]))[0]?.status).toBe('done');
    await page.keyboard.press('Escape');

    // The key is listed (never in full) and can be deleted.
    await page.goto('settings/obsidian');
    await expect(page.getByText('Test vault')).toBeVisible();
    await expect(page.getByText(decoded.connection.token)).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete key Test vault' }).click();
    await page.getByRole('button', { name: 'Delete key', exact: true }).click();
    await expect(page.getByText('You have no access keys.')).toBeVisible();
    await expect(api.context()).rejects.toThrow(/not valid/);
    await ctx.close();
  });
});
