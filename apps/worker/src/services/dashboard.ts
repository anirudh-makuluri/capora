import {
  drizzle,
  agents,
  purchases,
  invocations,
  capabilities,
  providers,
  users,
  jobs,
  activity,
  transactions,
} from '@capora/db';
import { eq, desc, and } from 'drizzle-orm';
import type { Dashboard, Agent } from '@capora/types';
import { getBudget } from './commerce';
import type { Env } from '../env';

export async function getDashboard(env: Env, userId: string): Promise<Dashboard> {
  const db = drizzle(env.DB);
  const [agentRows, purchaseRows, invocationRows, providerRows, capRows, activityRows, user] =
    await Promise.all([
      db.select().from(agents).where(eq(agents.userId, userId)),
      db
        .select({
          purchase: purchases,
          agentName: agents.name,
          capabilityName: capabilities.name,
          provider: providers.name,
        })
        .from(purchases)
        .innerJoin(agents, eq(purchases.agentId, agents.id))
        .innerJoin(capabilities, eq(purchases.capabilityId, capabilities.id))
        .innerJoin(providers, eq(capabilities.providerId, providers.id))
        .where(eq(agents.userId, userId))
        .orderBy(desc(purchases.createdAt))
        .limit(500),
      db
        .select({ invocation: invocations, capabilityName: capabilities.name, jobId: jobs.id })
        .from(invocations)
        .innerJoin(agents, eq(invocations.agentId, agents.id))
        .innerJoin(capabilities, eq(invocations.capabilityId, capabilities.id))
        .leftJoin(jobs, eq(jobs.invocationId, invocations.id))
        .where(eq(agents.userId, userId))
        .orderBy(desc(invocations.createdAt))
        .limit(500),
      db.select().from(providers).where(eq(providers.userId, userId)),
      db.select().from(capabilities),
      db
        .select()
        .from(activity)
        .where(eq(activity.userId, userId))
        .orderBy(desc(activity.createdAt))
        .limit(30),
      db.select().from(users).where(eq(users.id, userId)).get(),
    ]);
  const agentList: Agent[] = await Promise.all(
    agentRows.map(async (a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      createdAt: a.createdAt,
      budget: await getBudget(env, a.id),
      purchaseCount: purchaseRows.filter(
        (p) => p.purchase.agentId === a.id && p.purchase.status === 'purchased',
      ).length,
      invocationCount: invocationRows.filter((i) => i.invocation.agentId === a.id).length,
    })),
  );
  const publicPurchases = purchaseRows.map((p) => ({
    ...p.purchase,
    agentName: p.agentName,
    capabilityName: p.capabilityName,
    provider: p.provider,
  }));
  // No raw invocation inputs in the workspace activity feed. Results are retrieved through an owned detail route.
  const publicInvocations = invocationRows.map((i) => ({
    ...i.invocation,
    input: undefined,
    result: null,
    capabilityName: i.capabilityName,
    jobId: i.jobId,
  }));
  const succeeded = invocationRows.filter((i) => i.invocation.status === 'completed');
  const terminal = invocationRows.filter((i) => ['completed', 'failed'].includes(i.invocation.status));
  const totals = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN p.status='purchased' THEN p.amount_cents ELSE 0 END),0) total, COALESCE(SUM(CASE WHEN p.status='purchased' AND p.budget_day=? THEN p.amount_cents ELSE 0 END),0) today FROM purchases p JOIN agents a ON a.id=p.agent_id WHERE a.user_id=?`,
  )
    .bind(new Date().toISOString().slice(0, 10), userId)
    .first<{ total: number; today: number }>();
  const providerList = await Promise.all(
    providerRows.map(async (p) => {
      const revenue = await db
        .select({ amount: transactions.amountCents })
        .from(transactions)
        .where(and(eq(transactions.providerId, p.id), eq(transactions.status, 'completed')));
      const providerCaps = capRows.filter((c) => c.providerId === p.id);
      return {
        ...p,
        capabilityCount: providerCaps.length,
        invocationCount: providerCaps.reduce((sum, c) => sum + c.successCount + c.failureCount, 0),
        revenueCents: revenue.reduce((sum, t) => sum + t.amount, 0),
      };
    }),
  );
  return {
    agents: agentList,
    purchases: publicPurchases,
    invocations: publicInvocations,
    approvals: publicPurchases.filter((p) => p.status === 'pending_approval'),
    providers: providerList,
    activity: activityRows,
    stats: {
      spentTodayCents: totals?.today ?? 0,
      totalSpendCents: totals?.total ?? 0,
      executions: invocationRows.length,
      successRate: terminal.length ? Math.round((succeeded.length / terminal.length) * 100) : 0,
      avgLatencyMs: succeeded.length
        ? Math.round(succeeded.reduce((sum, i) => sum + (i.invocation.latencyMs ?? 0), 0) / succeeded.length)
        : 0,
    },
    paymentMode: env.PAYMENT_MODE === 'demo' ? 'demo' : 'sandbox',
    billingConnected: Boolean(user?.vaultEncrypted),
  };
}
