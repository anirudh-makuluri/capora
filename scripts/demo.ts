import { connect, call, rest, wait, baseUrl } from './mcp-client';
import type { Capability, Budget, Quote, Purchase, Invocation, Job } from '../packages/types/src/index';
const client = await connect();
try {
  console.log('Capora: retrieve Microsoft legal entity records from GLEIF.');
  console.log('Live source data and computed tools. Payment mode is reported with each purchase.');
  const budget = await call<Budget>(client, 'get_budget');
  console.log(
    `Available: $${(budget.remainingCents / 100).toFixed(2)}. Auto-approve: $${(budget.autoApproveCents / 100).toFixed(2)}.`,
  );
  const options = await call<Capability[]>(client, 'search_capabilities', {
    query: 'company registry',
    max_budget: 5,
  });
  console.table(
    options.map((c) => ({
      capability: c.name,
      price: `$${(c.priceCents / 100).toFixed(2)}`,
      reliability: `${c.reliability}%`,
      latency: `${c.expectedLatencyMs}ms`,
    })),
  );
  const capability = await call<Capability>(client, 'get_capability', {
    capability_id: 'gleif_entities',
  });
  console.log(`Inspected runtime input schema for ${capability.name}.`);
  const input = { company: 'Microsoft', limit: 5 };
  const quote = await call<Quote>(client, 'get_quote', {
    capability_id: capability.id,
    input,
    reason: 'Need live company identity records from GLEIF.',
  });
  let purchase = await call<Purchase>(client, 'purchase_capability', { quote_id: quote.id });
  console.log(
    `Registry purchase: ${purchase.status}, mode: ${purchase.paymentMode}, order: ${purchase.orderId ?? 'pending'}`,
  );
  if (purchase.status !== 'purchased')
    throw new Error(
      `Complete approval/payment in ${baseUrl}/transactions and rerun. Saved PayPal payment setup is needed for autonomous sandbox payment.`,
    );
  const invocation = await call<Invocation>(client, 'invoke_capability', { purchase_id: purchase.id, input });
  console.log(JSON.stringify(invocation.result, null, 2));
  const securityInput = {
    code: 'const query = `SELECT * FROM users WHERE id = ${req.query.id}`;\neval(req.body.code);',
  };
  const securityQuote = await call<Quote>(client, 'get_quote', {
    capability_id: 'code_scan',
    input: securityInput,
    reason:
      'Before acquisition, specialized tooling should inspect the control-plane code. This exceeds my autonomous threshold.',
  });
  purchase = await call<Purchase>(client, 'purchase_capability', { quote_id: securityQuote.id });
  console.log(`Security purchase: ${purchase.status}. Approve at http://localhost:5173/approvals.`);
  if (process.argv.includes('--approve')) {
    if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname) || purchase.paymentMode !== 'demo')
      throw new Error(
        '--approve is restricted to local simulated payments. Use the dashboard for sandbox purchases.',
      );
    await rest(`/approvals/${purchase.id}`, { approve: true });
    console.log('Local demo owner approval submitted.');
  }
  const deadline = Date.now() + 180_000;
  while (purchase.status !== 'purchased' && Date.now() < deadline) {
    if (['failed', 'rejected', 'blocked'].includes(purchase.status))
      throw new Error(`Purchase ${purchase.status}`);
    await wait(1000);
    purchase = await call<Purchase>(client, 'get_purchase_status', { purchase_id: purchase.id });
  }
  if (purchase.status !== 'purchased')
    throw new Error('Still awaiting human/PayPal approval. The purchase remains visible in the dashboard.');
  const security = await call<Invocation>(client, 'invoke_capability', {
    purchase_id: purchase.id,
    input: securityInput,
  });
  let job: Job;
  do {
    await wait(500);
    job = await call<Job>(client, 'get_job', { job_id: security.jobId });
  } while (['queued', 'running'].includes(job.status) && Date.now() < deadline);
  console.log(`Security job: ${job.status}`);
  console.log(JSON.stringify(job.result, null, 2));
  console.log('Final budget:', await call<Budget>(client, 'get_budget'));
} finally {
  await client.close();
}
