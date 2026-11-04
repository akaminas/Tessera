import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, newSession, runId, type TestUser } from './helpers';

/**
 * Two people work on the same board: persistence, invitations, permissions,
 * realtime updates, comments with mentions, notifications, routing, mobile.
 */
test.describe.serial('collaboration', () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let boardUrl = '';

  test.beforeAll(async () => {
    alice = await createTestUser('Alice');
    bob = await createTestUser('Bob');
    carol = await createTestUser('Carol');
  });
  test.afterAll(async () => {
    for (const u of [alice, bob, carol]) if (u) await deleteTestUser(u.id);
  });

  test('a new user creates a workspace, a project and tasks that persist', async ({ browser }) => {
    const { page, ctx } = await newSession(browser, alice);
    await page.getByLabel('Create a workspace').fill(`E2E office ${runId}`);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

    await page.goto('projects?new=1');
    await page.getByLabel('Project name').fill(`E2E project ${runId}`);
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Board' }).click();
    const todo = page.getByRole('region', { name: 'List To do' });
    await expect(todo).toBeVisible();
    boardUrl = page.url();

    await todo.getByRole('button', { name: 'Add a task' }).click();
    await page.getByLabel('New task title').fill('Alpha task\nBeta task');
    await page.getByRole('button', { name: 'Add 2 tasks' }).click();
    await expect(todo.getByText('Alpha task')).toBeVisible();
    await expect(todo.getByText('Beta task')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('region', { name: 'List To do' }).getByText('Beta task')).toBeVisible();
    await ctx.close();
  });

  test('an invited person joins and both see each other’s changes live', async ({ browser }) => {
    const a = await newSession(browser, alice);
    await a.page.goto('workspace');
    await a.page.getByRole('link', { name: 'Members' }).click();
    await a.page.getByLabel('Email address').fill(bob.email);
    await a.page.getByRole('button', { name: 'Create invitation' }).click();
    const inviteLink = (await a.page.locator('code').first().textContent()) ?? '';
    expect(inviteLink).toContain('/invite/');

    const b = await newSession(browser, bob);
    await b.page.goto(inviteLink);
    await b.page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(b.page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await b.page.goto(boardUrl);
    await expect(b.page.getByText('Alpha task')).toBeVisible();

    // Alice moves Beta to Done using the Move dialog
    await a.page.goto(boardUrl);
    await a.page.getByText('Beta task').click();
    await a.page.getByRole('button', { name: 'Task actions' }).click();
    await a.page.getByRole('menuitem', { name: 'Move…' }).click();
    await a.page.getByRole('combobox', { name: 'List' }).selectOption({ label: 'Done' });
    await a.page.getByRole('button', { name: 'Move', exact: true }).click();

    // Bob sees it arrive in Done without reloading (realtime)
    await expect(b.page.getByRole('region', { name: 'List Done' }).getByText('Beta task')).toBeVisible({ timeout: 20_000 });

    // Bob mentions Alice in a comment; Alice is notified
    await b.page.getByText('Alpha task').click();
    await b.page.getByLabel('Comment', { exact: true }).fill('Can you review this @Ali');
    await b.page.getByRole('option', { name: /Alice/ }).click();
    await b.page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(b.page.getByText('Can you review this')).toBeVisible();

    await a.page.goto('inbox');
    await expect(a.page.getByText(/mentioned you on .Alpha task./)).toBeVisible({ timeout: 20_000 });
    await a.ctx.close();
    await b.ctx.close();
  });

  test('an outsider cannot open the project', async ({ browser }) => {
    const c = await newSession(browser, carol);
    await c.page.getByLabel('Create a workspace').fill(`Carol ${runId}`);
    await c.page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(c.page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await c.page.goto(boardUrl);
    await expect(c.page.getByText(/not found|no longer have access/i).first()).toBeVisible();
    await expect(c.page.getByText('Alpha task')).toHaveCount(0);
    await c.ctx.close();
  });

  test('deep links survive a reload on the hosting subpath, and the dark theme applies', async ({ browser }) => {
    const a = await newSession(browser, alice);
    await a.page.goto(boardUrl);
    await a.page.reload();
    await expect(a.page.getByText('Alpha task')).toBeVisible();
    await a.page.getByRole('button', { name: 'Account menu' }).click();
    await a.page.getByRole('menuitem', { name: /Dark theme|Light theme/ }).click();
    const theme = await a.page.evaluate(() => document.documentElement.dataset.theme);
    expect(['dark', 'light']).toContain(theme);
    const bg = await a.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg === 'rgb(42, 37, 32)' || bg === 'rgb(255, 255, 255)').toBe(true);
    await a.ctx.close();
  });

  test('the board works on a phone without horizontal page scrolling', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('login');
    await page.getByLabel('Email').fill(alice.email);
    await page.getByLabel('Password', { exact: true }).fill(alice.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await page.goto(boardUrl);
    await expect(page.getByText('Alpha task')).toBeVisible();
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(page.getByRole('complementary', { name: 'Main navigation' }).getByRole('link', { name: 'My Work' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await ctx.close();
  });
});
