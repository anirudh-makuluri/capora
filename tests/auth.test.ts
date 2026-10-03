import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

let mf: Miniflare;
const base = 'https://capora.test';
const password = 'auth-test-password-only-2026';
const secret = 'isolated-test-session-secret-at-least-32-characters';
async function send(path: string, body?: unknown, cookie = '', origin = base, ip = '192.0.2.1') {
  return mf.dispatchFetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'CF-Connecting-IP': ip,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookieOf(response: { headers: { getSetCookie(): string[] } }) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}
async function signup(email = 'alice@example.com') {
  const response = await send('/auth/sign-up/email', { email, password, name: 'Alice' });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string; email: string } };
  return { response, user: body.user, cookie: cookieOf(response) };
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: resolve('apps/worker/dist/index.js'),
      compatibilityDate: '2026-10-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      r2Buckets: ['ARTIFACTS'],
      queueProducers: { INVOCATION_QUEUE: 'auth-test' },
      bindings: {
        DEV_MODE: 'false',
        PAYMENT_MODE: 'demo',
        PAYPAL_ENVIRONMENT: 'sandbox',
        CAPORA_BASE_URL: base,
        SESSION_SECRET: secret,
        ENCRYPTION_KEY: secret,
        DEMO_PROVIDER_SECRET: secret,
        PROVIDER_ALLOWED_HOSTS: '',
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  const dir = resolve('packages/db/migrations');
  for (const file of (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(resolve(dir, file), 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(statement).run();
    if (file.startsWith('0000_'))
      await db
        .prepare('INSERT INTO users(id,email,name,vault_encrypted,created_at) VALUES (?,?,?,?,?)')
        .bind(
          'user_migration',
          'migration@example.com',
          'Preserved owner',
          'existing-encrypted-wallet',
          '2026-10-01T00:00:00.000Z',
        )
        .run();
  }
  expect(
    await db.prepare("SELECT name,vault_encrypted,updated_at FROM users WHERE id='user_migration'").first(),
  ).toMatchObject({
    name: 'Preserved owner',
    vault_encrypted: 'existing-encrypted-wallet',
    updated_at: '2026-10-01T00:00:00.000Z',
  });
});
beforeEach(async () => {
  const db = await mf.getD1Database('DB');
  for (const table of [
    'spending_policies',
    'agents',
    'providers',
    'auth_sessions',
    'auth_accounts',
    'auth_verifications',
    'users',
    'rate_limits',
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
});
afterAll(async () => {
  await mf?.dispose();
});

describe('Email/password authentication in the actual Worker and D1', () => {
  it('never lets public signup claim the existing seeded workspace', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)')
      .bind('user_demo', 'demo@capora.local', 'Existing owner', new Date().toISOString())
      .run();
    const response = await send('/auth/sign-up/email', {
      email: 'demo@capora.local',
      password,
      name: 'Another person',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      await db.prepare("SELECT COUNT(*) count FROM auth_accounts WHERE user_id='user_demo'").first(),
    ).toMatchObject({ count: 0 });
    expect(await db.prepare("SELECT name FROM users WHERE id='user_demo'").first()).toMatchObject({
      name: 'Existing owner',
    });
  });
  it('requires authentication on localhost too and rejects legacy shared-password login', async () => {
    expect((await mf.dispatchFetch('http://localhost/api/dashboard')).status).toBe(401);
    expect((await send('/auth/login', { password })).status).toBe(404);
    expect((await send('/auth/session')).status).toBe(401);
  });
  it('creates an account, stores a password hash, and uses secure HttpOnly cookies', async () => {
    const account = await signup();
    const cookies = account.response.headers.getSetCookie().join(';');
    expect(cookies).toMatch(/HttpOnly/i);
    expect(cookies).toMatch(/Secure/i);
    expect(cookies).toMatch(/SameSite=Lax/i);
    const db = await mf.getD1Database('DB');
    const credential = await db
      .prepare('SELECT password FROM auth_accounts WHERE user_id=?')
      .bind(account.user.id)
      .first<{ password: string }>();
    expect(credential?.password).not.toBe(password);
    expect(credential?.password).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    const session = await send('/auth/session', undefined, account.cookie);
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      user: { id: account.user.id, email: 'alice@example.com' },
      localDemo: false,
    });
    expect((await send('/dashboard', undefined, account.cookie)).status).toBe(200);
  });
  it('rejects wrong passwords, logs in with the right password, and revokes logout sessions', async () => {
    await signup();
    expect(
      (await send('/auth/sign-in/email', { email: 'alice@example.com', password: 'incorrect-password' }))
        .status,
    ).toBe(401);
    const login = await send('/auth/sign-in/email', { email: 'alice@example.com', password });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    expect((await send('/auth/sign-out', {}, cookie)).status).toBe(200);
    expect((await send('/dashboard', undefined, cookie)).status).toBe(401);
  });
  it('rejects expired, tampered, and old HMAC dashboard sessions', async () => {
    const account = await signup();
    expect((await send('/dashboard', undefined, account.cookie + 'changed')).status).toBe(401);
    expect((await send('/dashboard', undefined, 'capora_session=legacy.signature')).status).toBe(401);
    const db = await mf.getD1Database('DB');
    await db.prepare('UPDATE auth_sessions SET expires_at=0 WHERE user_id=?').bind(account.user.id).run();
    expect((await send('/dashboard', undefined, account.cookie)).status).toBe(401);
  });
  it('isolates accounts and prevents another user from modifying owned agents and providers', async () => {
    const alice = await signup();
    const agentResponse = await send('/agents', { name: 'Alice agent' }, alice.cookie);
    const agent = (await agentResponse.json()) as { id: string };
    expect(agentResponse.status).toBe(201);
    const providerResponse = await send(
      '/providers',
      { name: 'Alice provider', description: 'Private test provider owned by Alice.' },
      alice.cookie,
    );
    expect(providerResponse.status).toBe(201);
    const bob = await signup('bob@example.com');
    const dashboard = await send('/dashboard', undefined, bob.cookie);
    expect(await dashboard.json()).toMatchObject({
      agents: [],
      providers: [],
      purchases: [],
      billingConnected: false,
    });
    expect((await send(`/agents/${agent.id}/revoke`, {}, bob.cookie)).status).toBe(404);
    expect((await send(`/agents/${agent.id}/budget`, undefined, bob.cookie)).status).toBe(404);
    expect((await send('/providers/capabilities', undefined, bob.cookie)).status).toBe(200);
  });
  it('validates email and password, prevents duplicate accounts, and rejects cross-origin mutations', async () => {
    expect((await send('/auth/sign-up/email', { name: 'Alice', email: 'invalid', password })).status).toBe(
      400,
    );
    expect(
      (await send('/auth/sign-up/email', { name: 'Alice', email: 'alice@example.com', password: 'short' }))
        .status,
    ).toBe(400);
    await signup();
    const duplicate = await send('/auth/sign-up/email', {
      name: 'Alice',
      email: 'alice@example.com',
      password,
    });
    expect(duplicate.status).toBeGreaterThanOrEqual(400);
    expect(
      (
        await send(
          '/auth/sign-in/email',
          { email: 'alice@example.com', password },
          '',
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
  });
  it('enforces persistent rate limits across per-request auth instances', async () => {
    for (let i = 0; i < 10; i++) {
      const response = await send('/auth/sign-in/email', { email: 'nobody@example.com', password });
      expect(response.status).toBe(401);
    }
    expect((await send('/auth/sign-in/email', { email: 'nobody@example.com', password })).status).toBe(429);
    const db = await mf.getD1Database('DB');
    expect(
      await db.prepare("SELECT COUNT(*) count FROM rate_limits WHERE key LIKE 'auth:%'").first(),
    ).toMatchObject({ count: 1 });
  });
});
