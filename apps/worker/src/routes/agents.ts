import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle, agents, spendingPolicies, quotes } from '@capora/db';
import { eq } from 'drizzle-orm';
import { policySchema, quoteSchema, invokeSchema, DomainError } from '@capora/types';
import { createAgent, ownAgent, rateLimit } from '../services/auth';
import {
  getBudget,
  createQuote,
  purchaseQuote,
  settlePayment,
  getPurchase,
  cancelPurchase,
} from '../services/commerce';
import { invokeCapability, getJob, getInvocation } from '../services/execution';
import { hash, token } from '../lib/crypto';
import { audit } from '../lib/audit';
import type { AppEnv } from '../env';

export const agentRoutes = new Hono<AppEnv>();
agentRoutes.post('/', async (c) => {
  const { name } = z.object({ name: z.string().min(2).max(80) }).parse(await c.req.json());
  await rateLimit(c.env, `agent-create:${c.get('userId')}`, 20);
  return c.json(await createAgent(c.env, c.get('userId'), name), 201);
});
agentRoutes.use('/:id/*', async (c, next) => {
  await ownAgent(c.env, c.req.param('id'), c.get('userId'));
  await next();
});
agentRoutes.patch('/:id', async (c) => {
  await ownAgent(c.env, c.req.param('id'), c.get('userId'));
  const { name } = z.object({ name: z.string().min(2).max(80) }).parse(await c.req.json());
  await drizzle(c.env.DB)
    .update(agents)
    .set({ name })
    .where(eq(agents.id, c.req.param('id')));
  return c.json({ ok: true });
});
agentRoutes.post('/:id/token', async (c) => {
  const rawToken = token();
  await drizzle(c.env.DB)
    .update(agents)
    .set({ tokenHash: await hash(rawToken), status: 'active' })
    .where(eq(agents.id, c.req.param('id')));
  await audit(
    c.env,
    c.get('userId'),
    'token_rotated',
    'Agent token regenerated. Previous token revoked.',
    c.req.param('id'),
  );
  return c.json({ token: rawToken });
});
agentRoutes.post('/:id/revoke', async (c) => {
  await drizzle(c.env.DB)
    .update(agents)
    .set({ status: 'revoked' })
    .where(eq(agents.id, c.req.param('id')));
  await audit(c.env, c.get('userId'), 'token_revoked', 'Agent access revoked', c.req.param('id'));
  return c.json({ ok: true });
});
agentRoutes.put('/:id/policy', async (c) => {
  const policy = policySchema.parse(await c.req.json());
  const budget = await getBudget(c.env, c.req.param('id'));
  if (policy.dailyBudgetCents < budget.spentTodayCents + budget.reservedCents)
    throw new DomainError(
      'BUDGET_ALREADY_COMMITTED',
      'Daily budget cannot be lower than committed spending. Cancel pending requests first.',
    );
  // Conditional SQL prevents a concurrent reservation from being hidden by a policy update.
  const updated = await c.env.DB.prepare(
    `UPDATE spending_policies SET daily_budget_cents=?,auto_approve_cents=?,max_transaction_cents=?,autonomous_enabled=? WHERE agent_id=? AND ? >= COALESCE((SELECT SUM(amount_cents) FROM purchases WHERE agent_id=? AND budget_day=? AND status IN ('pending_approval','approved','payment_pending','purchased')),0) RETURNING agent_id`,
  )
    .bind(
      policy.dailyBudgetCents,
      policy.autoApproveCents,
      policy.maxTransactionCents,
      policy.autonomousEnabled ? 1 : 0,
      c.req.param('id'),
      policy.dailyBudgetCents,
      c.req.param('id'),
      budget.day,
    )
    .first();
  if (!updated)
    throw new DomainError('BUDGET_ALREADY_COMMITTED', 'Budget changed concurrently. Refresh and retry.');
  await audit(c.env, c.get('userId'), 'policy_updated', 'Agent spending policy updated', c.req.param('id'));
  return c.json(await getBudget(c.env, c.req.param('id')));
});
agentRoutes.get('/:id/budget', async (c) => c.json(await getBudget(c.env, c.req.param('id'))));
agentRoutes.post('/:id/quotes', async (c) => {
  const input = quoteSchema.parse(await c.req.json());
  return c.json(
    await createQuote(c.env, c.req.param('id'), input.capability_id, input.input, input.reason),
    201,
  );
});
agentRoutes.post('/:id/purchases', async (c) => {
  const { quote_id } = z.object({ quote_id: z.string() }).parse(await c.req.json());
  return c.json(await purchaseQuote(c.env, c.req.param('id'), quote_id));
});
agentRoutes.post('/:id/invocations', async (c) => {
  const { purchase_id, input } = invokeSchema.parse(await c.req.json());
  return c.json(await invokeCapability(c.env, c.req.param('id'), purchase_id, input));
});
agentRoutes.get('/:id/purchases/:purchaseId', async (c) =>
  c.json(await getPurchase(c.env, c.req.param('purchaseId'), c.req.param('id'))),
);
agentRoutes.get('/:id/purchases/:purchaseId/input', async (c) => {
  const purchase = await getPurchase(c.env, c.req.param('purchaseId'), c.req.param('id'));
  const quote = await drizzle(c.env.DB)
    .select({ input: quotes.input })
    .from(quotes)
    .where(eq(quotes.id, purchase.quoteId))
    .get();
  return c.json({ input: quote?.input });
});
agentRoutes.post('/:id/purchases/:purchaseId/reconcile', async (c) =>
  c.json(await settlePayment(c.env, c.req.param('purchaseId'), c.req.param('id'))),
);
agentRoutes.post('/:id/purchases/:purchaseId/cancel', async (c) =>
  c.json(await cancelPurchase(c.env, c.req.param('purchaseId'), c.req.param('id'))),
);
agentRoutes.get('/:id/jobs/:jobId', async (c) =>
  c.json(await getJob(c.env, c.req.param('jobId'), c.req.param('id'))),
);
agentRoutes.get('/:id/invocations/:invocationId', async (c) =>
  c.json(await getInvocation(c.env, c.req.param('invocationId'), c.req.param('id'))),
);
export { spendingPolicies };
