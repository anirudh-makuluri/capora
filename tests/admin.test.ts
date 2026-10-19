import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashPassword } from '../apps/worker/src/lib/password';
import { isAdminEmail } from '../apps/worker/src/lib/admin';
import { catalogStatements } from '../scripts/seed-data';
import type {
  CapabilityRegistration,
  ManagedCapability,
  ProviderHostSettings,
} from '../packages/types/src/index';

let mf: Miniflare;
let admin = '';
let member = '';
const base = 'http://localhost:5173';
const secret = 'admin-integration-test-secret-at-least-32-characters';
const registration: CapabilityRegistration = {
  providerId: 'provider_member',
  name: 'Warehouse lookup',
  description: 'Authenticated warehouse inventory lookup for an exact product identifier.',
  type: 'api',
  category: 'Operations',
  priceCents: 20,
  pricingUnit: 'query',
  endpoint: 'https://api.seed.com/query',
  httpMethod: 'POST',
  authHeader: 'Authorization',
  inputSchema: {
    type: 'object',
    properties: { sku: { type: 'string' } },
    required: ['sku'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object', properties: { available: { type: 'integer' } }, required: ['available'] },
  expectedLatencyMs: 2000,
  async: false,
  tags: [],
  availability: 0.99,
  enabled: true,
};
async function send(path: string, cookie = admin, method = 'GET', body?: unknown, origin = base) {
  return mf.dispatchFetch(`${base}/api${path}`, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}
async function read<T>(path: string, cookie = admin) {
  return (await (await send(path, cookie)).json()) as T;
}
async function save(hosts: string[], revision = 0) {
  return send('/admin/provider-hosts', admin, 'PUT', { hosts, revision });
}
async function create(overrides: Partial<CapabilityRegistration> = {}, cookie = admin) {
  const response = await send(
    cookie === admin ? '/admin/capabilities' : '/providers/capabilities',
    cookie,
    'POST',
    { ...registration, ...overrides },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
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
      queueProducers: { INVOCATION_QUEUE: 'admin-tests' },
      bindings: {
        DEV_MODE: 'true',
        PAYMENT_MODE: 'demo',
        BANK_LEGACY_PAYMENT_FIXTURE: 'true',
        PAYPAL_ENVIRONMENT: 'sandbox',
        CAPORA_BASE_URL: base,
        SESSION_SECRET: secret,
        ENCRYPTION_KEY: secret,
        DEMO_PROVIDER_SECRET: secret,
        PROVIDER_ALLOWED_HOSTS: 'api.seed.com',
        ADMIN_EMAILS: '  ADMIN@capora.local , second@capora.local  ',
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('packages/db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(resolve('packages/db/migrations', file), 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(statement).run();
  }
  for (const name of ['admin', 'member']) {
    await db
      .prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)')
      .bind(name, `${name}@capora.local`, name, new Date().toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password,created_at,updated_at) VALUES (?,?,?,'credential',?,?,?)",
      )
      .bind(name, name, name, await hashPassword(secret), Date.now(), Date.now())
      .run();
    const login = await send('/auth/sign-in/email', '', 'POST', {
      email: `${name}@capora.local`,
      password: secret,
    });
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    if (name === 'admin') admin = cookie;
    else member = cookie;
  }
  await db
    .prepare('INSERT INTO providers(id,user_id,name,description,created_at) VALUES (?,?,?,?,?)')
    .bind('provider_member', 'member', 'Warehouse', 'Private warehouse provider', new Date().toISOString())
    .run();
  for (const sql of catalogStatements('member', new Date().toISOString())) await db.prepare(sql).run();
});
beforeEach(async () => {
  const db = await mf.getD1Database('DB');
  for (const table of [
    'reviews',
    'jobs',
    'invocations',
    'transactions',
    'approvals',
    'purchases',
    'quotes',
    'activity',
    'operator_settings',
    'rate_limits',
    'spending_policies',
    'bank_accounts',
    'agents',
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
  await db.prepare("DELETE FROM capabilities WHERE id LIKE 'cap_%'").run();
  await db.prepare('UPDATE capabilities SET enabled=1,removed_at=NULL,version=1').run();
});
afterAll(async () => {
  await mf?.dispose();
});

describe('Admin authorization and runtime marketplace management', () => {
  it('fails closed for missing configuration and uses exact normalized email matches', () => {
    expect(isAdminEmail({ ADMIN_EMAILS: '' }, 'admin@capora.local')).toBe(false);
    expect(
      isAdminEmail({ ADMIN_EMAILS: ' ADMIN@capora.local,second@capora.local ' }, 'admin@capora.local'),
    ).toBe(true);
    expect(isAdminEmail({ ADMIN_EMAILS: 'admin@capora.local' }, 'eviladmin@capora.local')).toBe(false);
  });
  it('requires admin sessions on every route, rejects agents and cross-origin mutations', async () => {
    for (const [path, method] of [
      ['/provider-hosts', 'GET'],
      ['/provider-hosts', 'PUT'],
      ['/providers', 'GET'],
      ['/capabilities', 'GET'],
      ['/capabilities', 'POST'],
      ['/capabilities/missing', 'DELETE'],
      ['/capabilities/missing/restore', 'POST'],
    ]) {
      expect((await send(`/admin${path}`, '', method)).status).toBe(401);
      expect((await send(`/admin${path}`, member, method)).status).toBe(403);
    }
    const agent = (await (
      await send('/agents', admin, 'POST', { name: 'Admin-owned test agent' })
    ).json()) as { token: string };
    const tokenRequest = await mf.dispatchFetch(`${base}/api/admin/provider-hosts`, {
      headers: { Authorization: `Bearer ${agent.token}` },
    });
    expect(tokenRequest.status).toBe(401);
    expect((await read<{ isAdmin: boolean }>('/auth/session')).isAdmin).toBe(true);
    expect((await read<{ isAdmin: boolean }>('/auth/session', member)).isAdmin).toBe(false);
    expect(
      (await send('/admin/provider-hosts', admin, 'PUT', { hosts: [], revision: 0 }, 'https://evil.com'))
        .status,
    ).toBe(403);
  });
  it('reserves unused configured admin emails from public signup', async () => {
    const response = await send('/auth/sign-up/email', '', 'POST', {
      name: 'Impostor',
      email: 'Second@capora.local',
      password: secret,
    });
    expect(response.status).toBe(403);
    expect(
      await (
        await mf.getD1Database('DB')
      )
        .prepare("SELECT id FROM users WHERE lower(email)='second@capora.local'")
        .first(),
    ).toBeNull();
    expect(
      (
        await send('/auth/sign-up/email', '', 'POST', {
          name: 'Ordinary signup',
          email: 'ordinary@capora.local',
          password: secret,
        })
      ).status,
    ).toBe(200);
  });
  it('saves normalized hosts, detects concurrent updates, and lets an empty list revoke the environment', async () => {
    expect(await read('/admin/provider-hosts')).toMatchObject({
      hosts: ['api.seed.com'],
      source: 'environment',
      revision: 0,
    });
    expect((await save([' API.NEW.com ', 'api.new.com'])).status).toBe(200);
    expect(await read('/admin/provider-hosts')).toMatchObject({
      hosts: ['api.new.com'],
      source: 'dashboard',
      revision: 1,
    });
    expect((await save(['stale.com'])).status).toBe(409);
    expect((await save([], 1)).status).toBe(200);
    expect(await read('/admin/provider-hosts')).toMatchObject({
      hosts: [],
      source: 'dashboard',
      revision: 2,
    });
    expect((await send('/providers/capabilities', member, 'POST', registration)).status).toBe(400);
    const db = await mf.getD1Database('DB');
    expect(
      await db.prepare("SELECT updated_by FROM operator_settings WHERE key='provider_allowed_hosts'").first(),
    ).toEqual({ updated_by: 'admin' });
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) count FROM activity WHERE kind='provider_hosts_updated' AND user_id='admin'",
        )
        .first(),
    ).toEqual({ count: 2 });
  });
  it('rejects URLs, wildcard hosts, IPs, private names and malformed labels without updating settings', async () => {
    for (const host of [
      'https://api.com',
      '*.api.com',
      'api.com/path',
      'api.com:443',
      '127.0.0.1',
      '[::1]',
      'foo.local',
      'foo.internal',
      'localhost',
      'foo..com',
      '-bad.com',
      'api.com.',
      'api.com?x=1',
    ])
      expect((await save([host])).status, host).toBe(400);
    expect((await read<ProviderHostSettings>('/admin/provider-hosts')).revision).toBe(0);
  });
  it('adds capabilities for another provider without exposing credentials and enforces provider-owned datasets', async () => {
    expect((await read<{ id: string }[]>('/admin/providers')).some((p) => p.id === 'provider_member')).toBe(
      true,
    );
    const id = await create({ secret: 'Bearer private-provider-secret' });
    const caps = await read<ManagedCapability[]>('/admin/capabilities');
    expect(caps.find((c) => c.id === id)).toMatchObject({
      providerId: 'provider_member',
      hasSecret: true,
      removedAt: null,
    });
    expect(JSON.stringify(caps)).not.toContain('private-provider-secret');
    const publicCaps = JSON.stringify(await read('/capabilities'));
    expect(publicCaps).not.toContain('api.seed.com');
    expect(publicCaps).not.toContain('private-provider-secret');
    expect(
      (
        await send('/admin/capabilities', admin, 'POST', {
          ...registration,
          type: 'dataset',
          endpoint: 'r2://datasets/admin/stolen.json',
        })
      ).status,
    ).toBe(400);
    expect(
      (await send('/admin/capabilities', admin, 'POST', { ...registration, providerId: 'missing' })).status,
    ).toBe(404);
  });
  it('removes and restores listings while blocking provider bypass and preserving catalog sync moderation', async () => {
    const id = await create({}, member);
    expect((await send(`/admin/capabilities/${id}`, admin, 'DELETE')).status).toBe(200);
    expect((await send(`/capabilities/${id}`)).status).toBe(404);
    expect((await read<{ id: string }[]>('/capabilities')).some((c) => c.id === id)).toBe(false);
    expect((await send(`/providers/capabilities/${id}`, member, 'PATCH', { enabled: true })).status).toBe(
      409,
    );
    expect((await send(`/providers/capabilities/${id}`, member, 'PUT', registration)).status).toBe(409);
    await send('/admin/capabilities/document_fingerprint', admin, 'DELETE');
    const db = await mf.getD1Database('DB');
    for (const sql of catalogStatements('member', new Date().toISOString())) await db.prepare(sql).run();
    expect(
      await db.prepare("SELECT enabled,removed_at FROM capabilities WHERE id='document_fingerprint'").first(),
    ).toMatchObject({ enabled: 0, removed_at: expect.any(String) });
    await save([]);
    expect((await send(`/admin/capabilities/${id}/restore`, admin, 'POST')).status).toBe(400);
    await save(['api.seed.com'], 1);
    expect((await send(`/admin/capabilities/${id}/restore`, admin, 'POST')).status).toBe(200);
    expect((await send(`/capabilities/${id}`)).status).toBe(200);
  });
  it('rechecks revoked hosts at execution and retains paid purchase records after capability removal', async () => {
    const id = await create();
    const agentResponse = await send('/agents', member, 'POST', { name: 'Admin regression buyer' });
    const agent = (await agentResponse.json()) as { id: string };
    const quote = await send(`/agents/${agent.id}/quotes`, member, 'POST', {
      capability_id: id,
      input: { sku: 'A' },
    });
    const quoteId = ((await quote.json()) as { id: string }).id;
    const purchase = await send(`/agents/${agent.id}/purchases`, member, 'POST', { quote_id: quoteId });
    const paid = (await purchase.json()) as { id: string; status: string };
    expect(paid.status).toBe('purchased');
    await save([]);
    const invocation = await send(`/agents/${agent.id}/invocations`, member, 'POST', {
      purchase_id: paid.id,
      input: { sku: 'A' },
    });
    expect(await invocation.json()).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('operator-approved'),
    });
    await send(`/admin/capabilities/${id}`, admin, 'DELETE');
    const db = await mf.getD1Database('DB');
    expect(await db.prepare('SELECT status FROM purchases WHERE id=?').bind(paid.id).first()).toEqual({
      status: 'purchased',
    });
    expect(
      (await send(`/agents/${agent.id}/quotes`, member, 'POST', { capability_id: id, input: { sku: 'A' } }))
        .status,
    ).toBe(404);
  });
});
