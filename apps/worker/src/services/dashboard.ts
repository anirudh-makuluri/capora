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
import { eq, desc, and, sql, inArray, getTableColumns } from 'drizzle-orm';
import type { Dashboard, Agent, TransactionPage, WorkspaceSummary } from '@capora/types';
import { getBudget } from './commerce';
import type { Env } from '../env';

// Do not fetch/decode stored input and result JSON for list views.
const { input: _input, result: _result, ...invocationColumns } = getTableColumns(invocations);
void _input;
void _result;
const invocationSummary = {
  ...invocationColumns,
  result: sql<null>`NULL`,
  capabilityName: capabilities.name,
  jobId: jobs.id,
};
const purchaseSummary = {
  purchase: purchases,
  agentName: agents.name,
  capabilityName: capabilities.name,
  provider: providers.name,
};

export async function getWorkspace(env: Env, userId: string): Promise<WorkspaceSummary> {
  const db = drizzle(env.DB);
  const [rows, count, ownedProviders] = await Promise.all([
    db
      .select({ id: agents.id, name: agents.name, status: agents.status })
      .from(agents)
      .where(eq(agents.userId, userId)),
    db
      .select({ value: sql<number>`count(*)` })
      .from(purchases)
      .innerJoin(agents, eq(agents.id, purchases.agentId))
      .where(and(eq(agents.userId, userId), eq(purchases.status, 'pending_approval')))
      .get(),
    db.select({ id: providers.id, name: providers.name }).from(providers).where(eq(providers.userId, userId)),
  ]);
  return {
    agents: await Promise.all(
      rows.map(async (agent) => ({ ...agent, budget: await getBudget(env, agent.id) })),
    ),
    approvalCount: count?.value ?? 0,
    providers: ownedProviders,
    paymentMode: env.PAYMENT_MODE === 'demo' ? 'demo' : 'sandbox',
  };
}

export async function getApprovals(env: Env, userId: string) {
  const rows = await drizzle(env.DB)
    .select(purchaseSummary)
    .from(purchases)
    .innerJoin(agents, eq(agents.id, purchases.agentId))
    .innerJoin(capabilities, eq(capabilities.id, purchases.capabilityId))
    .innerJoin(providers, eq(providers.id, capabilities.providerId))
    .where(and(eq(agents.userId, userId), eq(purchases.status, 'pending_approval')))
    .orderBy(desc(purchases.createdAt));
  return { approvals: rows.map(({ purchase, ...labels }) => ({ ...purchase, ...labels })) };
}

export async function getTransactionPage(
  env: Env,
  userId: string,
  page: number,
  search: string,
  status: string,
): Promise<TransactionPage> {
  const db = drizzle(env.DB);
  const pattern = `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const rows = await db
    .select(purchaseSummary)
    .from(purchases)
    .innerJoin(agents, eq(agents.id, purchases.agentId))
    .innerJoin(capabilities, eq(capabilities.id, purchases.capabilityId))
    .innerJoin(providers, eq(providers.id, capabilities.providerId))
    .where(
      and(
        eq(agents.userId, userId),
        status ? eq(purchases.status, status as typeof purchases.$inferSelect.status) : undefined,
        search
          ? sql`(${capabilities.name} || ' ' || ${providers.name} || ' ' || ${agents.name} || ' ' || ${purchases.id}) LIKE ${pattern} ESCAPE ${'\\'}`
          : undefined,
      ),
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .limit(26)
    .offset(page * 25);
  const selected = rows.slice(0, 25);
  const [executionRows, totals] = await Promise.all([
    selected.length
      ? db
          .select(invocationSummary)
          .from(invocations)
          .innerJoin(capabilities, eq(capabilities.id, invocations.capabilityId))
          .leftJoin(jobs, eq(jobs.invocationId, invocations.id))
          .where(
            inArray(
              invocations.purchaseId,
              selected.map((r) => r.purchase.id),
            ),
          )
      : [],
    db
      .select({
        totalSpendCents: sql<number>`coalesce(sum(case when ${purchases.status}='purchased' then ${purchases.amountCents} else 0 end),0)`,
        spentTodayCents: sql<number>`coalesce(sum(case when ${purchases.status}='purchased' and ${purchases.budgetDay}=${new Date().toISOString().slice(0, 10)} then ${purchases.amountCents} else 0 end),0)`,
        completedCount: sql<number>`count(case when ${purchases.status}='purchased' then 1 end)`,
        approvalCount: sql<number>`count(case when ${purchases.status}='pending_approval' then 1 end)`,
      })
      .from(purchases)
      .innerJoin(agents, eq(agents.id, purchases.agentId))
      .where(eq(agents.userId, userId))
      .get(),
  ]);
  return {
    purchases: selected.map(({ purchase, ...labels }) => ({ ...purchase, ...labels })),
    invocations: executionRows,
    hasMore: rows.length > 25,
    stats: { totalSpendCents: totals?.totalSpendCents ?? 0, spentTodayCents: totals?.spentTodayCents ?? 0 },
    completedCount: totals?.completedCount ?? 0,
    approvalCount: totals?.approvalCount ?? 0,
  };
}

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
        .select({ invocation: invocationColumns, capabilityName: capabilities.name, jobId: jobs.id })
        .from(invocations)
        .innerJoin(agents, eq(invocations.agentId, agents.id))
        .innerJoin(capabilities, eq(invocations.capabilityId, capabilities.id))
        .leftJoin(jobs, eq(jobs.invocationId, invocations.id))
        .where(eq(agents.userId, userId))
        .orderBy(desc(invocations.createdAt))
        .limit(500),
      db.select().from(providers).where(eq(providers.userId, userId)),
      // Provider totals need counters, not every capability's schemas and descriptions.
      db
        .select({
          providerId: capabilities.providerId,
          successCount: capabilities.successCount,
          failureCount: capabilities.failureCount,
        })
        .from(capabilities)
        .innerJoin(providers, eq(providers.id, capabilities.providerId))
        .where(eq(providers.userId, userId)),
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
        .select({ amount: sql<number>`coalesce(sum(${transactions.amountCents}),0)` })
        .from(transactions)
        .where(
          and(eq(transactions.providerId, p.id), sql`${transactions.status} IN ('completed','released')`),
        );
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
