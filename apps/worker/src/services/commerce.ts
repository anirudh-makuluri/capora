import {
  drizzle,
  agents,
  spendingPolicies,
  quotes,
  purchases,
  approvals,
  transactions,
  users,
} from '@capora/db';
import { eq, and, sql } from 'drizzle-orm';
import { DomainError, type Budget, type Quote, type Purchase, type JsonInput } from '@capora/types';
import { QUOTE_TTL_MS, RESERVED_STATUSES } from '@capora/config';
import { validatePayload } from '@capora/provider-sdk';
import { canonical, hash, id, unseal } from '../lib/crypto';
import { audit } from '../lib/audit';
import { getCapabilityRecord, getCapability } from './catalog';
import { evaluatePolicy } from './policy';
import { PaymentError, PayPalSandbox, receiptFromOrder } from './payments';
import type { Env } from '../env';
import { validateBuiltinInput } from '../providers/live';

export async function getBudget(env: Env, agentId: string): Promise<Budget> {
  const policy = await drizzle(env.DB)
    .select()
    .from(spendingPolicies)
    .where(eq(spendingPolicies.agentId, agentId))
    .get();
  if (!policy) throw new DomainError('NOT_FOUND', 'Spending policy not found.', 404);
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'purchased' THEN amount_cents ELSE 0 END),0) AS spent, COALESCE(SUM(CASE WHEN status IN ('pending_approval','approved','payment_pending') THEN amount_cents ELSE 0 END),0) AS reserved FROM purchases WHERE agent_id = ? AND budget_day = ?`,
  )
    .bind(agentId, day)
    .first<{ spent: number; reserved: number }>();
  return {
    ...policy,
    day,
    spentTodayCents: row?.spent ?? 0,
    reservedCents: row?.reserved ?? 0,
    remainingCents: Math.max(0, policy.dailyBudgetCents - (row?.spent ?? 0) - (row?.reserved ?? 0)),
  };
}
export async function createQuote(
  env: Env,
  agentId: string,
  capabilityId: string,
  input: JsonInput,
  reason?: string,
): Promise<Quote> {
  const capability = await getCapabilityRecord(env, capabilityId);
  validatePayload(capability.inputSchema, input);
  if (capability.endpoint.startsWith('builtin://')) validateBuiltinInput(capability.endpoint, input);
  const budget = await getBudget(env, agentId);
  const now = new Date();
  const row = {
    id: id('quote'),
    agentId,
    capabilityId,
    priceCents: capability.priceCents,
    currency: 'USD' as const,
    input,
    inputHash: await hash(canonical(input)),
    capabilityVersion: capability.version,
    reason: reason ?? null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
  };
  await drizzle(env.DB).insert(quotes).values(row);
  await audit(
    env,
    (await agentRecord(env, agentId)).userId,
    'quote_created',
    `Quote prepared for ${capability.name}`,
    row.id,
  );
  const publicCap = await getCapability(env, capabilityId);
  return {
    ...row,
    provider: publicCap.provider,
    expectedLatencyMs: capability.expectedLatencyMs,
    approvalRequired: !budget.autonomousEnabled || row.priceCents > budget.autoApproveCents,
  };
}
async function agentRecord(env: Env, agentId: string) {
  const agent = await drizzle(env.DB)
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.status, 'active')))
    .get();
  if (!agent) throw new DomainError('UNAUTHORIZED', 'Agent is not active.', 401);
  return agent;
}
export async function getPurchase(env: Env, purchaseId: string, agentId: string): Promise<Purchase> {
  const row = await drizzle(env.DB)
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, purchaseId), eq(purchases.agentId, agentId)))
    .get();
  if (!row) throw new DomainError('PURCHASE_REQUIRED', 'Purchase not found for this agent.', 404);
  return row;
}
export async function purchaseQuote(env: Env, agentId: string, quoteId: string): Promise<Purchase> {
  const agent = await agentRecord(env, agentId);
  const db = drizzle(env.DB);
  const quote = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.agentId, agentId)))
    .get();
  if (!quote) throw new DomainError('QUOTE_NOT_FOUND', 'Quote not found for this agent.', 404);
  const existing = await db.select().from(purchases).where(eq(purchases.quoteId, quote.id)).get();
  if (existing) return existing.status === 'approved' ? settlePayment(env, existing.id, agentId) : existing;
  if (Date.parse(quote.expiresAt) <= Date.now())
    throw new DomainError('QUOTE_EXPIRED', 'The quote expired. Request a new quote.');
  const capability = await getCapabilityRecord(env, quote.capabilityId);
  if (capability.version !== quote.capabilityVersion)
    throw new DomainError('QUOTE_STALE', 'Capability changed after quoting. Request a new quote.');
  const budget = await getBudget(env, agentId);
  const decision = evaluatePolicy(budget, quote.priceCents, budget.spentTodayCents + budget.reservedCents);
  const purchaseId = id('purchase');
  const now = new Date().toISOString();
  // A single SQLite statement serializes reservation and policy checks across concurrent requests.
  await env.DB.prepare(
    `INSERT INTO purchases (id, quote_id, agent_id, capability_id, amount_cents, status, payment_mode, reason, budget_day, created_at, updated_at)
    SELECT ?, q.id, q.agent_id, q.capability_id, q.price_cents,
      CASE WHEN p.autonomous_enabled = 1 AND q.price_cents <= p.auto_approve_cents THEN 'approved' ELSE 'pending_approval' END,
      ?, q.reason, ?, ?, ? FROM quotes q JOIN spending_policies p ON p.agent_id=q.agent_id JOIN agents a ON a.id=q.agent_id JOIN capabilities c ON c.id=q.capability_id
    WHERE q.id=? AND q.agent_id=? AND a.status='active' AND q.expires_at>? AND c.enabled=1 AND c.version=q.capability_version AND q.price_cents<=p.max_transaction_cents
    AND q.price_cents + COALESCE((SELECT SUM(amount_cents) FROM purchases WHERE agent_id=q.agent_id AND budget_day=? AND status IN ('pending_approval','approved','payment_pending','purchased')),0)<=p.daily_budget_cents
    ON CONFLICT(quote_id) DO NOTHING`,
  )
    .bind(purchaseId, env.PAYMENT_MODE, budget.day, now, now, quote.id, agentId, now, budget.day)
    .run();
  const purchase = await db.select().from(purchases).where(eq(purchases.quoteId, quote.id)).get();
  if (!purchase)
    throw new DomainError(
      'POLICY_CHANGED',
      'Quote, capability, or available budget changed. Request a new quote.',
    );
  if (purchase.status === 'pending_approval') {
    await db
      .insert(approvals)
      .values({
        id: id('approval'),
        purchaseId: purchase.id,
        userId: agent.userId,
        status: 'pending',
        createdAt: now,
      })
      .onConflictDoNothing();
    await audit(
      env,
      agent.userId,
      'approval_requested',
      `${agent.name} requested ${capability.name}`,
      purchase.id,
    );
    return purchase;
  }
  if (purchase.id === purchaseId)
    await audit(
      env,
      agent.userId,
      'purchase_approved',
      `${capability.name} approved ${decision === 'approved' ? 'under spending policy' : 'by current policy'}`,
      purchase.id,
    );
  return purchase.status === 'approved' ? settlePayment(env, purchase.id, agentId) : purchase;
}
async function acquirePaymentLease(env: Env, purchaseId: string): Promise<string | null> {
  const lease = id('lease');
  const row = await env.DB.prepare(
    'UPDATE purchases SET payment_lease_id=?, payment_lease_until=? WHERE id=? AND payment_lease_until < ? RETURNING id',
  )
    .bind(lease, Date.now() + 120_000, purchaseId, Date.now())
    .first();
  return row ? lease : null;
}
export async function settlePayment(env: Env, purchaseId: string, agentId: string): Promise<Purchase> {
  const initial = await getPurchase(env, purchaseId, agentId);
  if (!['approved', 'payment_pending'].includes(initial.status)) return initial;
  const lease = await acquirePaymentLease(env, purchaseId);
  if (!lease) return getPurchase(env, purchaseId, agentId);
  const db = drizzle(env.DB);
  try {
    let purchase = await getPurchase(env, purchaseId, agentId);
    if (!['approved', 'payment_pending'].includes(purchase.status)) return purchase;
    if (purchase.paymentMode !== env.PAYMENT_MODE)
      throw new DomainError(
        'PAYMENT_MODE_CHANGED',
        'Complete this purchase in its original payment environment.',
        409,
      );
    const agent = await agentRecord(env, agentId);
    const capability = await getCapabilityRecord(env, purchase.capabilityId);
    await db
      .update(purchases)
      .set({ status: 'payment_pending', updatedAt: new Date().toISOString() })
      .where(eq(purchases.id, purchaseId));
    if (env.PAYMENT_MODE === 'demo') {
      if (
        env.DEV_MODE !== 'true' ||
        !['localhost', '127.0.0.1'].includes(new URL(env.CAPORA_BASE_URL).hostname)
      )
        throw new DomainError(
          'DEMO_DISABLED',
          'Simulated payments are only available in local development.',
          503,
        );
      purchase = { ...purchase, orderId: `DEMO-${purchase.id}`, captureId: `DEMO-CAPTURE-${purchase.id}` };
      await recordPayment(env, purchase, capability.providerId, 'purchased');
    } else if (env.PAYMENT_MODE === 'sandbox') {
      const paypal = new PayPalSandbox(env);
      const user = await db.select().from(users).where(eq(users.id, agent.userId)).get();
      const vaultId = user?.vaultEncrypted ? await unseal(user.vaultEncrypted, env.ENCRYPTION_KEY) : null;
      if (!purchase.orderId && Date.now() - Date.parse(purchase.createdAt) > 5 * 60 * 60 * 1000)
        throw new PaymentError(
          'An older unconfirmed create request needs manual PayPal reconciliation. Automatic replay is disabled.',
          true,
        );
      let order = purchase.orderId
        ? await paypal.getOrder(purchase.orderId)
        : await paypal.createOrder(purchase.id, purchase.amountCents, vaultId);
      await db.update(purchases).set({ orderId: order.id }).where(eq(purchases.id, purchase.id));
      if (order.status === 'APPROVED') order = await paypal.captureOrder(order.id, purchase.id);
      const receipt = receiptFromOrder(order, purchase.id, purchase.amountCents);
      purchase = {
        ...purchase,
        orderId: receipt.orderId,
        captureId: receipt.captureId,
        approvalUrl: receipt.approvalUrl,
      };
      await recordPayment(
        env,
        purchase,
        capability.providerId,
        receipt.status === 'completed' ? 'purchased' : 'payment_pending',
      );
    } else throw new DomainError('CONFIGURATION_REQUIRED', 'Select sandbox or local demo payments.', 503);
    const result = await getPurchase(env, purchaseId, agentId);
    await audit(
      env,
      agent.userId,
      result.status === 'purchased' ? 'payment_completed' : 'payment_pending',
      `${capability.name}: ${result.status === 'purchased' ? 'payment completed' : 'waiting for PayPal'}`,
      purchaseId,
    );
    return result;
  } catch (error) {
    const current = await getPurchase(env, purchaseId, agentId);
    const uncertain =
      current.orderId !== null ||
      (error instanceof PaymentError && error.uncertain) ||
      !(error instanceof DomainError);
    const message = error instanceof DomainError ? error.message : 'Payment outcome requires reconciliation.';
    await db
      .update(purchases)
      .set({
        status: uncertain ? 'payment_pending' : 'failed',
        error: message,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(purchases.id, purchaseId));
    if (uncertain) return getPurchase(env, purchaseId, agentId);
    throw error;
  } finally {
    await db
      .update(purchases)
      .set({ paymentLeaseUntil: 0, paymentLeaseId: null })
      .where(and(eq(purchases.id, purchaseId), eq(purchases.paymentLeaseId, lease)));
  }
}
async function recordPayment(
  env: Env,
  purchase: Purchase,
  providerId: string,
  status: 'purchased' | 'payment_pending',
) {
  const db = drizzle(env.DB);
  const now = new Date().toISOString();
  await db.batch([
    db
      .update(purchases)
      .set({
        status,
        orderId: purchase.orderId,
        captureId: purchase.captureId,
        approvalUrl: purchase.approvalUrl,
        error: null,
        updatedAt: now,
      })
      .where(eq(purchases.id, purchase.id)),
    db
      .insert(transactions)
      .values({
        id: id('txn'),
        purchaseId: purchase.id,
        providerId,
        amountCents: purchase.amountCents,
        status: status === 'purchased' ? 'completed' : 'pending',
        orderId: purchase.orderId,
        captureId: purchase.captureId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: transactions.purchaseId,
        set: {
          status: status === 'purchased' ? 'completed' : 'pending',
          captureId: purchase.captureId,
          updatedAt: now,
        },
      }),
  ]);
}
export async function resolveApproval(env: Env, userId: string, purchaseId: string, approve: boolean) {
  const db = drizzle(env.DB);
  const row = await db
    .select({ purchase: purchases, agent: agents })
    .from(purchases)
    .innerJoin(agents, eq(purchases.agentId, agents.id))
    .where(and(eq(purchases.id, purchaseId), eq(agents.userId, userId)))
    .get();
  if (!row) throw new DomainError('NOT_FOUND', 'Purchase not found.', 404);
  if (row.purchase.status !== 'pending_approval') return row.purchase;
  if (approve) {
    await agentRecord(env, row.agent.id);
    await getCapabilityRecord(env, row.purchase.capabilityId);
    const budget = await getBudget(env, row.agent.id);
    const committed = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents),0) AS total FROM purchases WHERE agent_id=? AND budget_day=? AND status IN ('pending_approval','approved','payment_pending','purchased')`,
    )
      .bind(row.agent.id, row.purchase.budgetDay)
      .first<{ total: number }>();
    evaluatePolicy(budget, row.purchase.amountCents, (committed?.total ?? 0) - row.purchase.amountCents);
  }
  // Atomic conditional update prevents approve/reject races; reservations already exist.
  const now = new Date().toISOString();
  const changed = approve
    ? await env.DB.prepare(
        `UPDATE purchases SET status='approved',updated_at=? WHERE id=? AND status='pending_approval'
        AND EXISTS(SELECT 1 FROM spending_policies sp JOIN agents a ON a.id=sp.agent_id JOIN capabilities c ON c.id=purchases.capability_id JOIN quotes q ON q.id=purchases.quote_id
          WHERE sp.agent_id=purchases.agent_id AND a.status='active' AND c.enabled=1 AND c.version=q.capability_version AND purchases.amount_cents<=sp.max_transaction_cents
          AND COALESCE((SELECT SUM(p2.amount_cents) FROM purchases p2 WHERE p2.agent_id=purchases.agent_id AND p2.budget_day=purchases.budget_day AND p2.status IN ('pending_approval','approved','payment_pending','purchased')),0)<=sp.daily_budget_cents) RETURNING id`,
      )
        .bind(now, purchaseId)
        .first()
    : await db
        .update(purchases)
        .set({ status: 'rejected', updatedAt: now })
        .where(and(eq(purchases.id, purchaseId), eq(purchases.status, 'pending_approval')))
        .returning()
        .get();
  if (approve && !changed && (await getPurchase(env, purchaseId, row.agent.id)).status === 'pending_approval')
    throw new DomainError(
      'POLICY_CHANGED',
      'The capability or current spending policy no longer permits this purchase.',
    );
  if (changed) {
    await db
      .update(approvals)
      .set({ status: approve ? 'approved' : 'rejected', resolvedAt: now })
      .where(eq(approvals.purchaseId, purchaseId));
    await audit(
      env,
      userId,
      approve ? 'human_approved' : 'human_rejected',
      approve ? 'Purchase approved by workspace owner' : 'Purchase rejected by workspace owner',
      purchaseId,
    );
  }
  const current = await getPurchase(env, purchaseId, row.agent.id);
  return current.status === 'approved' ? settlePayment(env, purchaseId, row.agent.id) : current;
}
export async function cancelPurchase(env: Env, purchaseId: string, agentId: string) {
  const lease = await acquirePaymentLease(env, purchaseId);
  if (!lease) throw new DomainError('PAYMENT_BUSY', 'Payment is processing. Try again shortly.', 409);
  try {
    const purchase = await getPurchase(env, purchaseId, agentId);
    if (!['pending_approval', 'approved', 'payment_pending'].includes(purchase.status))
      throw new DomainError('INVALID_STATE', 'This purchase cannot be cancelled.');
    if (purchase.orderId && purchase.paymentMode === 'sandbox') {
      const order = await new PayPalSandbox(env).getOrder(purchase.orderId);
      if (!['CREATED', 'PAYER_ACTION_REQUIRED', 'VOIDED'].includes(order.status))
        throw new DomainError(
          'PAYMENT_RECONCILIATION_REQUIRED',
          'Reconcile this PayPal order before cancelling.',
          409,
        );
    } else if (purchase.status === 'payment_pending' && purchase.error)
      throw new DomainError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'Confirm the payment outcome before releasing the reservation.',
        409,
      );
    const now = new Date().toISOString();
    const db = drizzle(env.DB);
    await db.batch([
      db
        .update(purchases)
        .set({ status: 'rejected', approvalUrl: null, updatedAt: now })
        .where(eq(purchases.id, purchaseId)),
      db
        .update(approvals)
        .set({ status: 'rejected', resolvedAt: now })
        .where(eq(approvals.purchaseId, purchaseId)),
      db
        .update(transactions)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(transactions.purchaseId, purchaseId)),
    ]);
    return getPurchase(env, purchaseId, agentId);
  } finally {
    await env.DB.prepare(
      'UPDATE purchases SET payment_lease_until=0, payment_lease_id=NULL WHERE id=? AND payment_lease_id=?',
    )
      .bind(purchaseId, lease)
      .run();
  }
}
export async function expireApprovals(env: Env) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await drizzle(env.DB)
    .update(purchases)
    .set({
      status: 'rejected',
      error: 'Approval expired after 24 hours.',
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(purchases.status, 'pending_approval'), sql`${purchases.createdAt} < ${cutoff}`));
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?')
    .bind(Math.floor(Date.now() / 1000))
    .run();
}
export { RESERVED_STATUSES };
