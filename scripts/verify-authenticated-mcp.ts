import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { catalogStatements } from './seed-data';
import { providerVariableNames } from './provider-env';
import type { Budget, Capability, Invocation, Job, Purchase, Quote } from '../packages/types/src/index';

// Disposable Worker/D1/R2/Queue, actual MCP transport and real upstream quota.
// Payments are always simulated; never imports the developer's payment/session credentials.
const token = 'cap_authenticated-provider-verifier-only';
const secret = 'authenticated-provider-verifier-only-secret-thirty-two-characters';
const checks: [string, Record<string, unknown>][] = [
  ['brave_search', { query: 'Cloudflare Workers documentation', limit: 2 }],
  ['context_scrape', { url: 'https://example.com' }],
  ['azure_maps_geocode', { query: '1 Microsoft Way, Redmond, WA', limit: 2 }],
];
if (process.argv.includes('--include-sd'))
  checks.push([
    'sd_repo_analysis',
    { repository: 'anirudh-makuluri/capora', packagePath: 'apps/web', maxFiles: 20 },
  ]);
if (process.argv.includes('--riot-only'))
  checks.splice(0, checks.length, [
    'riot_recent_matches',
    { gameName: 'Hide on bush', tagLine: 'KR1', region: 'asia', count: 2 },
  ]);
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: resolve('apps/worker/dist/index.js'),
    compatibilityDate: '2026-10-03',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['ARTIFACTS'],
    queueProducers: { INVOCATION_QUEUE: 'authenticated-verifier' },
    queueConsumers: { 'authenticated-verifier': { maxBatchTimeout: 0, maxBatchSize: 1 } },
    bindings: {
      ...Object.fromEntries(
        providerVariableNames.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
      ),
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
const client = new Client({ name: 'authenticated-capability-verifier', version: '1.0.0' });
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
    .bind('provider_verifier', 'provider-verifier@capora.local', 'Provider verifier', now)
    .run();
  await db
    .prepare('INSERT INTO agents(id,user_id,name,token_hash,created_at) VALUES (?,?,?,?,?)')
    .bind(
      'provider_agent',
      'provider_verifier',
      'Provider verifier',
      createHash('sha256').update(token).digest('hex'),
      now,
    )
    .run();
  await db
    .prepare('INSERT INTO spending_policies(agent_id,auto_approve_cents) VALUES (?,?)')
    .bind('provider_agent', 100)
    .run();
  for (const sql of catalogStatements('provider_verifier', now)) await db.prepare(sql).run();
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
          {
            status: response.status,
            headers: Object.fromEntries(response.headers),
          },
        );
      },
    }),
  );
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `MCP ${name} failed`);
    const content = result.content as { type: string; text?: string }[];
    return JSON.parse(content.find((item) => item.type === 'text')?.text ?? 'null') as T;
  }
  let spentCents = 0;
  for (const [id, input] of checks) {
    const metadata = await call<Capability>('get_capability', { capability_id: id });
    const options = await call<Capability[]>('search_capabilities', { query: metadata.name, max_budget: 5 });
    assert.ok(options.some((option) => option.id === id));
    const quote = await call<Quote>('get_quote', { capability_id: id, input });
    const purchase = await call<Purchase>('purchase_capability', { quote_id: quote.id });
    assert.equal(purchase.status, 'purchased');
    assert.match(purchase.orderId ?? '', /^DEMO-/);
    let invocation = await call<Invocation>('invoke_capability', { purchase_id: purchase.id, input });
    if (metadata.async) {
      assert.ok(invocation.jobId);
      const deadline = Date.now() + 125000;
      let job: Job;
      do {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        job = await call<Job>('get_job', { job_id: invocation.jobId });
      } while (['queued', 'running'].includes(job.status) && Date.now() < deadline);
      assert.equal(job.status, 'completed', 'Queued provider execution did not complete.');
      invocation = await call<Invocation>('invoke_capability', { purchase_id: purchase.id, input });
    }
    assert.equal(invocation.status, 'completed', invocation.error ?? 'Provider execution did not complete.');
    const result = invocation.result as { synthetic: boolean; data: Record<string, unknown> };
    assert.equal(result.synthetic, false);
    if (id === 'context_scrape')
      assert.ok(typeof result.data.markdown === 'string' && result.data.markdown.length > 0);
    else if (id === 'riot_recent_matches')
      assert.ok(
        Array.isArray(result.data.games) && result.data.games.length > 0 && result.data.games.length <= 2,
      );
    else if (id === 'sd_repo_analysis')
      assert.ok(result.data.commitSha && Array.isArray(result.data.deployUnits));
    else assert.ok(Array.isArray(result.data.results) && result.data.results.length > 0);
    assert.equal(
      (await call<Invocation>('invoke_capability', { purchase_id: purchase.id, input })).id,
      invocation.id,
    );
    spentCents += metadata.priceCents;
    const budget = await call<Budget>('get_budget', {});
    assert.equal(budget.spentTodayCents, spentCents);
    assert.equal(budget.reservedCents, 0);
    console.log(
      JSON.stringify({
        capability: id,
        status: 'PASS',
        payment: 'simulated',
        persisted: true,
        replayedWithoutExtraExecution: true,
        spentCents,
      }),
    );
  }
  assert.equal(await db.prepare('SELECT COUNT(*) FROM invocations').first('COUNT(*)'), checks.length);
} finally {
  await client.close();
  await worker.dispose();
}
