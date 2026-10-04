import assert from 'node:assert/strict';
import { connect, call, rest, wait, baseUrl } from './mcp-client';
import type { Capability, Quote, Purchase, Invocation, Job, Budget } from '../packages/types/src/index';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname))
  throw new Error('The automated live verifier is restricted to a local Worker.');
const health = await rest<{ paymentMode: string }>('/health');
assert.equal(health.paymentMode, 'demo', 'Live verifier uses simulated payments only.');
const agent = await rest<{ id: string; token: string }>('/agents', {
  name: `E2E verifier ${new Date().toISOString()}`,
});
const client = await connect(agent.token);
try {
  assert.equal((await client.listTools()).tools.length, 8);
  const options = await call<Capability[]>(client, 'search_capabilities', {
    query: 'company registry',
    max_budget: 5,
  });
  assert.ok(options.length >= 1);
  assert.equal(
    (await call<Capability>(client, 'get_capability', { capability_id: 'gleif_entities' })).priceCents,
    20,
  );
  const input = { company: 'Microsoft', limit: 5 };
  const quote = await call<Quote>(client, 'get_quote', { capability_id: 'gleif_entities', input });
  const purchase = await call<Purchase>(client, 'purchase_capability', { quote_id: quote.id });
  assert.equal(purchase.status, 'purchased');
  assert.match(purchase.orderId ?? '', /^DEMO-/);
  assert.equal((await call<Purchase>(client, 'purchase_capability', { quote_id: quote.id })).id, purchase.id);
  const result = await call<Invocation>(client, 'invoke_capability', { purchase_id: purchase.id, input });
  assert.equal(result.status, 'completed', result.error ?? 'Live provider invocation must complete.');
  const providerResult = result.result as {
    synthetic: boolean;
    source: string;
    data: { entities: unknown[] };
  };
  assert.equal(providerResult.synthetic, false);
  assert.equal(providerResult.source, 'GLEIF');
  assert.ok(providerResult.data.entities.length > 0);
  assert.equal(
    (await call<Invocation>(client, 'invoke_capability', { purchase_id: purchase.id, input })).id,
    result.id,
  );
  const securityInput = { code: 'eval(req.body.code);' };
  const sq = await call<Quote>(client, 'get_quote', {
    capability_id: 'code_scan',
    input: securityInput,
  });
  const sp = await call<Purchase>(client, 'purchase_capability', { quote_id: sq.id });
  assert.equal(sp.status, 'pending_approval');
  assert.equal((await call<Budget>(client, 'get_budget')).reservedCents, 300);
  await rest(`/approvals/${sp.id}`, { approve: true });
  assert.equal(
    (await call<Purchase>(client, 'get_purchase_status', { purchase_id: sp.id })).status,
    'purchased',
  );
  const invocation = await call<Invocation>(client, 'invoke_capability', {
    purchase_id: sp.id,
    input: securityInput,
  });
  assert.ok(invocation.jobId);
  let job: Job;
  const deadline = Date.now() + 20_000;
  do {
    await wait(300);
    job = await call<Job>(client, 'get_job', { job_id: invocation.jobId });
  } while (['queued', 'running'].includes(job.status) && Date.now() < deadline);
  assert.equal(job.status, 'completed');
  const budget = await call<Budget>(client, 'get_budget');
  assert.equal(budget.spentTodayCents, 320);
  assert.equal(budget.remainingCents, 2180);
  assert.equal(budget.reservedCents, 0);
  console.log(
    'PASS: real HTTP MCP client → D1 quotes → simulated payment → live GLEIF source → human approval → Queue job → result → computed code scan → correct $3.20 spend.',
  );
} finally {
  await client.close();
  await rest(`/agents/${agent.id}/revoke`, {});
}
