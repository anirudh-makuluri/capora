import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { catalogStatements } from './seed-data';
import type { Budget, Capability, Invocation, Purchase, Quote } from '../packages/types/src/index';

// Disposable local storage and simulated payments. The only external call reads public AWS pricing.
// Build the Worker first: pnpm build && pnpm exec tsx scripts/verify-aws-capability.ts
const secret = 'local-aws-verifier-only-secret-at-least-thirty-two-characters';
const token = 'cap_local-aws-verifier-only';
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: resolve('apps/worker/dist/index.js'),
    compatibilityDate: '2026-10-03',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['ARTIFACTS'],
    queueProducers: { INVOCATION_QUEUE: 'aws-verifier' },
    queueConsumers: { 'aws-verifier': { maxBatchTimeout: 0, maxBatchSize: 1 } },
    bindings: {
      DEV_MODE: 'true',
      PAYMENT_MODE: 'demo',
      PAYPAL_ENVIRONMENT: 'sandbox',
      CAPORA_BASE_URL: 'http://localhost:5173',
      SESSION_SECRET: secret,
      ENCRYPTION_KEY: secret,
      DEMO_PROVIDER_SECRET: secret,
      PROVIDER_ALLOWED_HOSTS: '',
    },
  }),
);
const client = new Client({ name: 'aws-capability-verifier', version: '1.0.0' });
try {
  const db = await worker.getD1Database('DB');
  const directory = resolve('packages/db/migrations');
  for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    const statements = (await readFile(resolve(directory, file), 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((sql) => sql.trim());
    for (const sql of statements) await db.prepare(sql).run();
  }
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)')
    .bind('aws_verifier', 'aws-verifier@capora.local', 'AWS verifier', now)
    .run();
  await db
    .prepare('INSERT INTO agents(id,user_id,name,token_hash,created_at) VALUES (?,?,?,?,?)')
    .bind(
      'aws_agent',
      'aws_verifier',
      'AWS verifier agent',
      createHash('sha256').update(token).digest('hex'),
      now,
    )
    .run();
  await db.prepare('INSERT INTO spending_policies(agent_id) VALUES (?)').bind('aws_agent').run();
  for (const sql of catalogStatements('aws_verifier', now)) await db.prepare(sql).run();
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (url, init) => {
        if (init?.body && typeof init.body !== 'string') throw new Error('Expected JSON request.');
        const response = await worker.dispatchFetch(String(url), {
          method: init?.method,
          headers: Object.fromEntries(new Headers(init?.headers)),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });
        return new Response(
          response.status === 202 || response.status === 204 ? null : await response.arrayBuffer(),
          { status: response.status, headers: Object.fromEntries(response.headers) },
        );
      },
    }),
  );
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    const content = result.content as { type: string; text?: string }[];
    return JSON.parse(content.find((item) => item.type === 'text')?.text ?? 'null') as T;
  }
  const options = await call<Capability[]>('search_capabilities', { query: 'AWS Lambda', max_budget: 1 });
  assert.ok(options.some((option) => option.id === 'aws_lambda_estimate'));
  const metadata = await call<Capability>('get_capability', { capability_id: 'aws_lambda_estimate' });
  assert.equal(metadata.priceCents, 10);
  const input = {
    region: 'us-east-1',
    architecture: 'arm64',
    monthlyRequests: 1_000_000,
    memoryMb: 512,
    averageBilledDurationMs: 200,
  };
  const quote = await call<Quote>('get_quote', { capability_id: metadata.id, input });
  const purchase = await call<Purchase>('purchase_capability', { quote_id: quote.id });
  assert.equal(purchase.status, 'purchased');
  assert.match(purchase.orderId ?? '', /^DEMO-/);
  const invocation = await call<Invocation>('invoke_capability', { purchase_id: purchase.id, input });
  assert.equal(invocation.status, 'completed', invocation.error ?? 'AWS invocation must complete.');
  const result = invocation.result as { synthetic: boolean; source: string; data: Record<string, unknown> };
  assert.equal(result.synthetic, false);
  assert.equal(result.source, 'AWS Price List');
  assert.ok(Number(result.data.estimatedMonthlyUsd) > 0);
  assert.ok(result.data.priceListVersion);
  assert.equal(
    (await call<Invocation>('invoke_capability', { purchase_id: purchase.id, input })).id,
    invocation.id,
  );
  const budget = await call<Budget>('get_budget', {});
  assert.equal(budget.spentTodayCents, 10);
  assert.equal(budget.reservedCents, 0);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM invocations').first('COUNT(*)'), 1);
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        flow: 'MCP discovery -> quote -> simulated purchase -> live AWS pricing -> persisted result -> idempotent retrieval',
        input,
        data: result.data,
        caporaSpentCents: budget.spentTodayCents,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await worker.dispose();
}
