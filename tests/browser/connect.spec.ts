import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
test('copied prompt creates an agent through browser authorization and verifies real MCP tools', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const home = await mkdtemp(join(tmpdir(), 'capora-connect-test-'));
  // Keep this test's signup independent of the five-account auth browser regression.
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'CF-Connecting-IP': '192.0.2.55' },
    }),
  );
  const helper = resolve('apps/web/public/connect.mjs');
  const env = { ...process.env, CAPORA_HOME: home };
  async function run(...args: string[]) {
    const result = await exec(process.execPath, [helper, ...args], { env });
    return JSON.parse(result.stdout);
  }
  const started = await run(
    'start',
    '--base-url',
    'http://localhost:5174',
    '--name',
    'Prompt browser agent',
    '--daily-budget',
    '7.25',
    '--auto-approve',
    '0.40',
    '--max-transaction',
    '3.50',
  );
  expect(started).not.toHaveProperty('token');
  expect(started).not.toHaveProperty('deviceCode');
  const resumed = await run(
    'start',
    '--base-url',
    'http://localhost:5174',
    '--name',
    'Prompt browser agent',
    '--daily-budget',
    '7.25',
    '--auto-approve',
    '0.40',
    '--max-transaction',
    '3.50',
  );
  expect(resumed.id).toBe(started.id);
  expect((await run('finish', '--connection', started.connection)).status).toBe('pending');
  await page.goto(started.verificationUrl);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Prompt owner');
  await page.getByLabel('Email', { exact: true }).fill(`connect-${crypto.randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('prompt-browser-password-only-2026');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(started.verificationUrl);
  await expect(page.getByLabel('Connection code')).toHaveText(started.userCode);
  await expect(page.locator('.setup-limits')).toContainText('Prompt browser agent');
  await expect(page.locator('.setup-limits')).toContainText('$7.25');
  await expect(page.locator('.setup-limits')).toContainText('$0.40');
  await expect(page.locator('.setup-limits')).toContainText('$3.50');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/screenshots/connect-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Create and connect agent' }).click();
  await expect(page.getByRole('heading', { name: 'Your agent is ready.' })).toBeVisible();
  const finished = await run('finish', '--connection', started.connection);
  expect(finished.status).toBe('connected');
  expect(finished.tools).toHaveLength(8);
  expect(finished.budget).toMatchObject({
    dailyBudgetCents: 725,
    autoApproveCents: 40,
    maxTransactionCents: 350,
    spentTodayCents: 0,
    reservedCents: 0,
  });
  expect(finished).not.toHaveProperty('token');
  const privateState = JSON.parse(await readFile(finished.credentialsFile, 'utf8'));
  expect(JSON.stringify(finished)).not.toContain(privateState.token);
  const headers = await run('headers', '--connection', started.connection);
  expect(headers.Authorization).toBe(`Bearer ${privateState.token}`);
  const configFile = join(home, 'isolated-codex.toml');
  const original = 'model = "test-model"\n[mcp_servers.existing]\nurl = "https://existing.example/mcp"\n';
  await writeFile(configFile, original);
  const configured = await run(
    'configure-codex',
    '--connection',
    started.connection,
    '--config-file',
    configFile,
  );
  expect(configured.status).toBe('configured');
  const config = await readFile(configFile, 'utf8');
  expect(config.startsWith(original)).toBe(true);
  expect(config).toContain(`Authorization = "Bearer ${privateState.token}"`);
  expect(JSON.stringify(configured)).not.toContain(privateState.token);
  await run('configure-codex', '--connection', started.connection, '--config-file', configFile);
  expect(await readFile(configFile, 'utf8')).toBe(config);
  expect((await run('finish', '--connection', started.connection)).agentId).toBe(finished.agentId);
  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: 'Prompt browser agent', exact: true })).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: /Connect an agent/ }).click();
  await page.getByRole('button', { name: 'Copy setup prompt', exact: true }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('First ask me for these four values');
  expect(prompt).toContain('http://localhost:5174/connect.mjs');
  expect(prompt).not.toContain(privateState.token);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.goto('/developers');
  await expect(page.getByRole('button', { name: 'Copy setup prompt' })).toBeVisible();
  const download = await page.request.get('/connect.mjs');
  expect(download.ok()).toBe(true);
  expect(await download.text()).toContain('export async function main');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: '.local/screenshots/connect-developers.png', fullPage: true });
  expect(errors).toEqual([]);
});
