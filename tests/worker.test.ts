import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { seedCapabilities, outputSchema } from '../scripts/seed-data';
import type { Purchase, Quote, Invocation, Budget, Job } from '../packages/types/src/index';
import { R2_BUDGET } from '../packages/config/src/index';

let mf: Miniflare;
const agentToken = 'cap_test-token-only-for-isolated-integration-tests';
const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const tokenHash = createHash('sha256').update(agentToken).digest('hex');
async function request<T>(path: string, body?: unknown, method = 'POST') {
  const response = await mf.dispatchFetch(
    `http://localhost/api${path}`,
    body === undefined
      ? {}
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  return { status: response.status, data: (await response.json()) as T };
}
const quote = async (
  capabilityId = 'datapulse_headcount',
  input: Record<string, unknown> = { company: 'Acme Robotics' },
) => (await request<Quote>('/agents/agent_test/quotes', { capability_id: capabilityId, input })).data;
const buy = async (quoteId: string) =>
  request<Purchase>('/agents/agent_test/purchases', { quote_id: quoteId });

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: resolve('apps/worker/dist/index.js'),
      compatibilityDate: '2026-10-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      r2Buckets: ['ARTIFACTS'],
      queueProducers: { INVOCATION_QUEUE: 'invocations-test' },
      queueConsumers: { 'invocations-test': { maxBatchTimeout: 0, maxBatchSize: 1 } },
      bindings: {
        DEV_MODE: 'true',
        PAYMENT_MODE: 'demo',
        PAYPAL_ENVIRONMENT: 'sandbox',
        CAPORA_BASE_URL: 'http://localhost:5173',
        DASHBOARD_USER_ID: 'user_test',
        SESSION_SECRET: secret,
        ENCRYPTION_KEY: secret,
        DASHBOARD_PASSWORD: secret,
        DEMO_PROVIDER_SECRET: secret,
        PROVIDER_ALLOWED_HOSTS: 'api.provider.example',
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  const dir = resolve('packages/db/migrations');
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    const statements = (await readFile(resolve(dir, file), 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((s) => s.trim());
    for (const statement of statements) await db.prepare(statement).run();
  }
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)')
    .bind('user_test', 'test@capora.local', 'Test owner', now)
    .run();
  await db
    .prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)')
    .bind('user_other', 'other@capora.local', 'Other owner', now)
    .run();
  await db
    .prepare('INSERT INTO agents(id,user_id,name,token_hash,created_at) VALUES (?,?,?,?,?)')
    .bind('agent_test', 'user_test', 'Research test', tokenHash, now)
    .run();
  await db.prepare('INSERT INTO spending_policies(agent_id) VALUES (?)').bind('agent_test').run();
  await db
    .prepare('INSERT INTO agents(id,user_id,name,token_hash,created_at) VALUES (?,?,?,?,?)')
    .bind('agent_other', 'user_other', 'Other agent', 'other-hash', now)
    .run();
  await db.prepare('INSERT INTO spending_policies(agent_id) VALUES (?)').bind('agent_other').run();
  for (const c of seedCapabilities) {
    await db
      .prepare(
        'INSERT INTO providers(id,user_id,name,description,reputation,created_at) VALUES (?,?,?,?,?,?)',
      )
      .bind(`provider_${c.id}`, 'user_test', c.provider, c.description, c.reputation, now)
      .run();
    await db
      .prepare(
        'INSERT INTO capabilities(id,provider_id,name,description,type,category,price_cents,pricing_unit,input_schema,output_schema,endpoint,expected_latency_ms,baseline_reliability,tags,async,synthetic,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        c.id,
        `provider_${c.id}`,
        c.name,
        c.description,
        c.type,
        c.category,
        c.priceCents,
        c.pricingUnit,
        JSON.stringify(c.schema),
        JSON.stringify(outputSchema),
        `demo://${c.id}`,
        c.latency,
        c.reliability,
        JSON.stringify(c.tags),
        c.async ? 1 : 0,
        1,
        now,
      )
      .run();
  }
});
beforeEach(async () => {
  const db = await mf.getD1Database('DB');
  for (const table of [
    'jobs',
    'invocations',
    'transactions',
    'approvals',
    'purchases',
    'quotes',
    'activity',
    'rate_limits',
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
  await db
    .prepare(
      "UPDATE spending_policies SET daily_budget_cents=2500,auto_approve_cents=50,max_transaction_cents=1000,autonomous_enabled=1 WHERE agent_id='agent_test'",
    )
    .run();
  await db.prepare("UPDATE agents SET status='active' WHERE id='agent_test'").run();
  await db.prepare('UPDATE capabilities SET enabled=1,version=1,success_count=0,failure_count=0').run();
  await db
    .prepare(
      "UPDATE resource_usage SET usage_day='',writes=0,reads=0,reserved_bytes=0,blocked=0 WHERE resource='r2'",
    )
    .run();
});
afterAll(async () => {
  await mf?.dispose();
});

describe('Actual Worker, D1, R2, Queues, and MCP integration', () => {
  it('serves competing capability options without credentials', async () => {
    const result = await request<Record<string, unknown>[]>(
      '/capabilities?query=private%20company%20headcount',
    );
    expect(result.status).toBe(200);
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(result.data)).not.toMatch(/secretEncrypted|tokenHash|vaultEncrypted|demo:\/\//);
  });
  it('creates an expiring immutable quote', async () => {
    const q = await quote();
    expect(q.priceCents).toBe(20);
    expect(Date.parse(q.expiresAt) - Date.parse(q.createdAt)).toBe(300_000);
    expect(q.approvalRequired).toBe(false);
  });
  it('rejects expired quotes', async () => {
    const q = await quote();
    const db = await mf.getD1Database('DB');
    await db
      .prepare('UPDATE quotes SET expires_at=? WHERE id=?')
      .bind('2020-01-01T00:00:00.000Z', q.id)
      .run();
    const result = await buy(q.id);
    expect(result.status).toBe(400);
    expect(result.data).toMatchObject({ error: { code: 'QUOTE_EXPIRED' } });
  });
  it('charges once under concurrent purchase replay', async () => {
    const q = await quote();
    const results = await Promise.all([buy(q.id), buy(q.id), buy(q.id)]);
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    const final = await request<Purchase>(`/agents/agent_test/purchases/${results[0].data.id}/reconcile`, {});
    expect(final.data.status).toBe('purchased');
    const db = await mf.getD1Database('DB');
    expect(await db.prepare('SELECT count(*) count FROM transactions').first('count')).toBe(1);
    expect((await request<Budget>('/agents/agent_test/budget')).data.spentTodayCents).toBe(20);
  });
  it('atomically prevents two purchases from overspending', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE spending_policies SET daily_budget_cents=30 WHERE agent_id='agent_test'").run();
    const q1 = await quote();
    const q2 = await quote();
    const results = await Promise.all([buy(q1.id), buy(q2.id)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const budget = (await request<Budget>('/agents/agent_test/budget')).data;
    expect(budget.spentTodayCents).toBe(20);
    expect(budget.remainingCents).toBe(10);
  });
  it('reserves a human approval and executes only after approval', async () => {
    const input = { code: 'eval(req.body.code);' };
    const q = await quote('securescan_advanced', input);
    const p = (await buy(q.id)).data;
    expect(p.status).toBe('pending_approval');
    expect((await request<Budget>('/agents/agent_test/budget')).data.reservedCents).toBe(300);
    const early = await request('/agents/agent_test/invocations', { purchase_id: p.id, input });
    expect(early.status).toBe(409);
    const approved = await request<Purchase>(`/approvals/${p.id}`, { approve: true });
    expect(approved.data.status).toBe('purchased');
    const invocation = (
      await request<Invocation>('/agents/agent_test/invocations', { purchase_id: p.id, input })
    ).data;
    expect(invocation.jobId).toBeTruthy();
    await vi.waitFor(
      async () => {
        const job = (await request<Job>(`/agents/agent_test/jobs/${invocation.jobId}`)).data;
        expect(job.status).toBe('completed');
        expect(job.result).toMatchObject({ synthetic: true, data: { riskLevel: 'high' } });
      },
      { timeout: 10_000, interval: 200 },
    );
  });
  it('rejection releases a reservation without a transaction', async () => {
    const p = (await buy((await quote('securescan_advanced', {})).id)).data;
    expect((await request<Purchase>(`/approvals/${p.id}`, { approve: false })).data.status).toBe('rejected');
    expect((await request<Budget>('/agents/agent_test/budget')).data.remainingCents).toBe(2500);
    expect(
      await (await mf.getD1Database('DB')).prepare('SELECT COUNT(*) count FROM transactions').first('count'),
    ).toBe(0);
  });
  it('rechecks a lower transaction limit before human approval', async () => {
    const purchase = (await buy((await quote('securescan_advanced', {})).id)).data;
    await (
      await mf.getD1Database('DB')
    )
      .prepare("UPDATE spending_policies SET max_transaction_cents=100 WHERE agent_id='agent_test'")
      .run();
    const result = await request(`/approvals/${purchase.id}`, { approve: true });
    expect(result.data).toMatchObject({ error: { code: 'TRANSACTION_LIMIT_EXCEEDED' } });
    expect((await request<Budget>('/agents/agent_test/budget')).data.reservedCents).toBe(300);
    expect(
      await (await mf.getD1Database('DB')).prepare('SELECT count(*) count FROM transactions').first('count'),
    ).toBe(0);
  });
  it('rejects an edited capability during approval without charging', async () => {
    const purchase = (await buy((await quote('securescan_advanced', {})).id)).data;
    await (
      await mf.getD1Database('DB')
    )
      .prepare("UPDATE capabilities SET version=2 WHERE id='securescan_advanced'")
      .run();
    const result = await request(`/approvals/${purchase.id}`, { approve: true });
    expect(result.data).toMatchObject({ error: { code: 'POLICY_CHANGED' } });
    expect((await request<Purchase>(`/agents/agent_test/purchases/${purchase.id}`)).data.status).toBe(
      'pending_approval',
    );
  });
  it('blocks purchases over a transaction limit', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        "UPDATE spending_policies SET max_transaction_cents=10, auto_approve_cents=10 WHERE agent_id='agent_test'",
      )
      .run();
    const result = await buy((await quote()).id);
    expect(result.data).toMatchObject({ error: { code: 'TRANSACTION_LIMIT_EXCEEDED' } });
  });
  it('does not permit a different agent to buy a quote', async () => {
    const q = await quote();
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE quotes SET agent_id='agent_other' WHERE id=?").bind(q.id).run();
    expect((await buy(q.id)).data).toMatchObject({ error: { code: 'QUOTE_NOT_FOUND' } });
  });
  it('does not permit cross-workspace agent management', async () =>
    expect((await request('/agents/agent_other/token', {})).status).toBe(404));
  it('rejects a disabled capability before payment', async () => {
    const q = await quote();
    await (
      await mf.getD1Database('DB')
    )
      .prepare("UPDATE capabilities SET enabled=0 WHERE id='datapulse_headcount'")
      .run();
    expect((await buy(q.id)).data).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' } });
  });
  it('rejects a stale capability version', async () => {
    const q = await quote();
    await (
      await mf.getD1Database('DB')
    )
      .prepare("UPDATE capabilities SET version=2 WHERE id='datapulse_headcount'")
      .run();
    expect((await buy(q.id)).data).toMatchObject({ error: { code: 'QUOTE_STALE' } });
  });
  it('binds exact input and returns the same invocation on replay', async () => {
    const input = { company: 'Acme Robotics' };
    const p = (await buy((await quote('datapulse_headcount', input)).id)).data;
    const changed = await request('/agents/agent_test/invocations', {
      purchase_id: p.id,
      input: { company: 'Other' },
    });
    expect(changed.data).toMatchObject({ error: { code: 'INPUT_CHANGED' } });
    const first = await request<Invocation>('/agents/agent_test/invocations', { purchase_id: p.id, input });
    const second = await request<Invocation>('/agents/agent_test/invocations', { purchase_id: p.id, input });
    expect(first.data.status).toBe('completed');
    expect(first.data.result).toMatchObject({ synthetic: true, data: { regionalHeadcount: 38 } });
    expect(second.data.id).toBe(first.data.id);
  });
  it('validates invalid inputs before creating a quote', async () =>
    expect(
      (await request('/agents/agent_test/quotes', { capability_id: 'datapulse_headcount', input: {} })).data,
    ).toMatchObject({ error: { code: 'INVALID_CAPABILITY_INPUT' } }));
  it('records provider failure without inventing a refund', async () => {
    const input = { company: 'Acme', demoFailure: true };
    const p = (await buy((await quote('datapulse_headcount', input)).id)).data;
    const inv = (await request<Invocation>('/agents/agent_test/invocations', { purchase_id: p.id, input }))
      .data;
    expect(inv.status).toBe('failed');
    expect(inv.error).toContain('PROVIDER_FAILURE');
    expect((await request<Purchase>(`/agents/agent_test/purchases/${p.id}`)).data.status).toBe('purchased');
  });
  it('stores and serves an owned dataset from R2', async () => {
    const records = Array.from({ length: 2000 }, (_, index) => ({ id: index, region: 'Arizona' }));
    const dataset = (
      await request<{ endpoint: string }>('/providers/datasets', {
        data: { data: { privateRecords: records } },
      })
    ).data;
    const cap = (
      await request<{ id: string }>('/providers/capabilities', {
        providerId: 'provider_datapulse_headcount',
        name: 'Owned private dataset',
        description: 'An owned dataset stored in R2 for gateway execution.',
        type: 'dataset',
        category: 'Research',
        priceCents: 10,
        pricingUnit: 'query',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object', required: ['data'] },
        endpoint: dataset.endpoint,
        expectedLatencyMs: 100,
        tags: [],
      })
    ).data;
    const p = (await buy((await quote(cap.id, {})).id)).data;
    const inv = (
      await request<Invocation>('/agents/agent_test/invocations', { purchase_id: p.id, input: {} })
    ).data;
    expect(inv.result).toEqual({ data: { privateRecords: records } });
    const stored = await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT artifact_key, result FROM invocations WHERE id=?')
      .bind(inv.id)
      .first<{ artifact_key: string | null; result: string | null }>();
    expect(stored?.artifact_key).toMatch(/^results\/agent_test\//);
    expect(stored?.result).toBeNull();
  });
  it('reserves UTF-8 storage atomically when concurrent uploads reach the retained byte cap', async () => {
    const db = await mf.getD1Database('DB');
    const data = { marker: '🌵'.repeat(100) };
    const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    await db
      .prepare("UPDATE resource_usage SET reserved_bytes=? WHERE resource='r2'")
      .bind(R2_BUDGET.retainedBytes - bytes)
      .run();
    const uploads = await Promise.all(
      Array.from({ length: 8 }, () => request<{ key: string }>('/providers/datasets', { data })),
    );
    expect(uploads.filter((result) => result.status === 201)).toHaveLength(1);
    expect(uploads.filter((result) => result.status === 503)).toHaveLength(7);
    expect(
      await db.prepare("SELECT reserved_bytes,writes FROM resource_usage WHERE resource='r2'").first(),
    ).toMatchObject({ reserved_bytes: R2_BUDGET.retainedBytes, writes: 1 });
    expect(uploads.find((result) => result.status === 201)?.data.key).toMatch(/^datasets\/user_test\//);
  });
  it('blocks concurrent writes at the daily operation budget', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare("UPDATE resource_usage SET usage_day=?,writes=? WHERE resource='r2'")
      .bind(new Date().toISOString().slice(0, 10), R2_BUDGET.writesPerDay - 1)
      .run();
    const uploads = await Promise.all(
      Array.from({ length: 8 }, () => request('/providers/datasets', { data: { value: 1 } })),
    );
    expect(uploads.filter((result) => result.status === 201)).toHaveLength(1);
    expect(uploads.filter((result) => result.status === 503)).toHaveLength(7);
    expect(await db.prepare("SELECT writes FROM resource_usage WHERE resource='r2'").first('writes')).toBe(
      R2_BUDGET.writesPerDay,
    );
  });
  it('blocks concurrent artifact reads at the daily read budget', async () => {
    const db = await mf.getD1Database('DB');
    const data = { value: 'owned' };
    const dataset = (await request<{ key: string }>('/providers/datasets', { data })).data;
    const p = (await buy((await quote()).id)).data;
    const inv = (
      await request<Invocation>('/agents/agent_test/invocations', {
        purchase_id: p.id,
        input: { company: 'Acme Robotics' },
      })
    ).data;
    await db
      .prepare('UPDATE invocations SET artifact_key=?,result=NULL WHERE id=?')
      .bind(dataset.key, inv.id)
      .run();
    await db
      .prepare("UPDATE resource_usage SET usage_day=?,reads=? WHERE resource='r2'")
      .bind(new Date().toISOString().slice(0, 10), R2_BUDGET.readsPerDay - 1)
      .run();
    const reads = await Promise.all(
      Array.from({ length: 8 }, () => request<Invocation>(`/agents/agent_test/invocations/${inv.id}`)),
    );
    expect(reads.filter((result) => result.status === 200)).toHaveLength(1);
    expect(reads.find((result) => result.status === 200)?.data.result).toEqual(data);
    expect(reads.filter((result) => result.status === 503)).toHaveLength(7);
    expect(await db.prepare("SELECT reads FROM resource_usage WHERE resource='r2'").first('reads')).toBe(
      R2_BUDGET.readsPerDay,
    );
  });
  it('resets daily operation counters without resetting retained storage', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        "UPDATE resource_usage SET usage_day='2000-01-01',writes=?,reads=?,reserved_bytes=42 WHERE resource='r2'",
      )
      .bind(R2_BUDGET.writesPerDay, R2_BUDGET.readsPerDay)
      .run();
    const data = { value: 1 };
    expect((await request('/providers/datasets', { data })).status).toBe(201);
    expect(
      await db
        .prepare("SELECT usage_day,writes,reads,reserved_bytes FROM resource_usage WHERE resource='r2'")
        .first(),
    ).toMatchObject({
      usage_day: new Date().toISOString().slice(0, 10),
      writes: 1,
      reads: 0,
      reserved_bytes: 42 + new TextEncoder().encode(JSON.stringify(data)).byteLength,
    });
  });
  it('cannot rewind the budget day and reset already reserved operations', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE resource_usage SET usage_day='9999-01-01',writes=99 WHERE resource='r2'").run();
    expect((await request('/providers/datasets', { data: { value: 1 } })).status).toBe(503);
    expect(await db.prepare("SELECT writes FROM resource_usage WHERE resource='r2'").first('writes')).toBe(
      99,
    );
  });
  it('honors the operator storage kill switch', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE resource_usage SET blocked=1 WHERE resource='r2'").run();
    expect((await request('/providers/datasets', { data: { value: 1 } })).status).toBe(503);
    expect(
      await db.prepare("SELECT writes,reserved_bytes FROM resource_usage WHERE resource='r2'").first(),
    ).toMatchObject({ writes: 0, reserved_bytes: 0 });
  });
  it('shows the owner the enforced storage limits and reservations', async () => {
    await request('/providers/datasets', { data: { value: 1 } });
    const usage = await request('/storage/usage');
    expect(usage.status).toBe(200);
    expect(usage.data).toMatchObject({
      day: new Date().toISOString().slice(0, 10),
      writes: 1,
      reads: 0,
      blocked: false,
      reservedBytes: new TextEncoder().encode(JSON.stringify({ value: 1 })).byteLength,
      limits: R2_BUDGET,
    });
  });
  it('fails closed if the storage budget row is missing', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare("DELETE FROM resource_usage WHERE resource='r2'").run();
    try {
      expect((await request('/providers/datasets', { data: { value: 1 } })).status).toBe(503);
    } finally {
      await db.prepare("INSERT INTO resource_usage(resource) VALUES ('r2')").run();
    }
  });
  it('forbids non-approved and cross-workspace dataset endpoints', async () => {
    const body = {
      providerId: 'provider_datapulse_headcount',
      name: 'Bad dataset',
      description: 'A dataset that attempts to read another user.',
      type: 'dataset',
      category: 'Research',
      priceCents: 10,
      pricingUnit: 'query',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      endpoint: 'r2://datasets/user_other/data.json',
      expectedLatencyMs: 100,
    };
    expect((await request('/providers/capabilities', body)).status).toBe(400);
    expect(
      (
        await request('/providers/capabilities', {
          ...body,
          type: 'api',
          endpoint: 'https://127.0.0.1/admin',
        })
      ).status,
    ).toBe(400);
  });
  it('blocks cross-origin dashboard mutations', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'Bad agent' }),
    });
    expect(response.status).toBe(403);
  });
  it('rejects unauthenticated MCP requests', async () =>
    expect(
      (
        await mf.dispatchFetch('http://localhost/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401));
  it('runs the full tool loop using the official MCP client', async () => {
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${agentToken}` } },
      fetch: async (url, init) => {
        if (init?.body && typeof init.body !== 'string')
          throw new Error('MCP test transport expects JSON strings.');
        const response = await mf.dispatchFetch(String(url), {
          method: init?.method,
          headers: Object.fromEntries(new Headers(init?.headers)),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });
        return new Response(
          response.status === 202 || response.status === 204 ? null : await response.arrayBuffer(),
          { status: response.status, headers: Object.fromEntries(response.headers) },
        );
      },
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(8);
      const extract = <T>(result: Awaited<ReturnType<typeof client.callTool>>): T => {
        const content = result.content as { type: string; text?: string }[];
        return JSON.parse(content.find((c) => c.type === 'text')?.text ?? 'null') as T;
      };
      const options = extract<Record<string, unknown>[]>(
        await client.callTool({
          name: 'search_capabilities',
          arguments: { query: 'private company headcount', max_budget: 5 },
        }),
      );
      expect(options.length).toBeGreaterThanOrEqual(2);
      const q = extract<Quote>(
        await client.callTool({
          name: 'get_quote',
          arguments: { capability_id: 'datapulse_headcount', input: { company: 'Acme Robotics' } },
        }),
      );
      const p = extract<Purchase>(
        await client.callTool({ name: 'purchase_capability', arguments: { quote_id: q.id } }),
      );
      expect(p.status).toBe('purchased');
      const inv = extract<Invocation>(
        await client.callTool({
          name: 'invoke_capability',
          arguments: { purchase_id: p.id, input: { company: 'Acme Robotics' } },
        }),
      );
      expect(inv.status).toBe('completed');
      const budget = extract<Budget>(await client.callTool({ name: 'get_budget', arguments: {} }));
      expect(budget.spentTodayCents).toBe(20);
    } finally {
      await client.close();
    }
  });
});
