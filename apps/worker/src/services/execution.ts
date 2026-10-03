import { drizzle, invocations, jobs, quotes, purchases, capabilities, agents } from '@capora/db';
import { and, eq, sql } from 'drizzle-orm';
import { DomainError, type Invocation, type JsonInput, type Job } from '@capora/types';
import { canonical, hash, id } from '../lib/crypto';
import { getPurchase } from './commerce';
import { getCapabilityRecord } from './catalog';
import { invokeProvider } from './gateway';
import { audit } from '../lib/audit';
import { readArtifact, writeArtifact } from './storage';
import type { Env } from '../env';

export interface JobMessage {
  jobId: string;
  invocationId: string;
}
export async function getInvocation(env: Env, invocationId: string, agentId: string): Promise<Invocation> {
  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(invocations)
    .where(and(eq(invocations.id, invocationId), eq(invocations.agentId, agentId)))
    .get();
  if (!row) throw new DomainError('NOT_FOUND', 'Invocation not found for this agent.', 404);
  const job = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.invocationId, row.id)).get();
  const result =
    row.artifactKey && row.status === 'completed'
      ? await (await readArtifact(env, row.artifactKey))?.json()
      : row.result;
  return { ...row, result: result ?? null, jobId: job?.id ?? null };
}
export async function invokeCapability(
  env: Env,
  agentId: string,
  purchaseId: string,
  input: JsonInput,
): Promise<Invocation> {
  const db = drizzle(env.DB);
  const purchase = await getPurchase(env, purchaseId, agentId);
  if (purchase.status !== 'purchased')
    throw new DomainError(
      'PURCHASE_REQUIRED',
      `Purchase is ${purchase.status}. Wait until payment is completed.`,
      409,
    );
  const quote = await db.select().from(quotes).where(eq(quotes.id, purchase.quoteId)).get();
  if (!quote || (await hash(canonical(input))) !== quote.inputHash)
    throw new DomainError(
      'INPUT_CHANGED',
      'Invocation input must exactly match the immutable quote. Request a new quote for different input.',
    );
  const existing = await db.select().from(invocations).where(eq(invocations.purchaseId, purchaseId)).get();
  if (existing) return getInvocation(env, existing.id, agentId);
  const capability = await getCapabilityRecord(env, purchase.capabilityId);
  if (capability.version !== quote.capabilityVersion)
    throw new DomainError(
      'CAPABILITY_CHANGED',
      'Capability changed after purchase. Contact the provider for a refund.',
    );
  const now = new Date().toISOString();
  const invocationId = id('inv');
  const jobId = id('job');
  const row = {
    id: invocationId,
    purchaseId,
    capabilityId: capability.id,
    agentId,
    status: 'queued' as const,
    input,
    createdAt: now,
  };
  // Quote binding validates the original schema; the gateway validates again before execution.
  if (capability.async) {
    await db
      .batch([
        db.insert(invocations).values(row).onConflictDoNothing(),
        db
          .insert(jobs)
          .values({ id: jobId, invocationId, status: 'queued', createdAt: now })
          .onConflictDoNothing(),
      ])
      .catch(async (error) => {
        const duplicate = await db
          .select()
          .from(invocations)
          .where(eq(invocations.purchaseId, purchaseId))
          .get();
        if (!duplicate) throw error;
      });
  } else await db.insert(invocations).values(row).onConflictDoNothing();
  const inserted = await db.select().from(invocations).where(eq(invocations.purchaseId, purchaseId)).get();
  if (!inserted) throw new DomainError('INTERNAL_ERROR', 'Invocation could not be persisted.', 500);
  if (inserted.id !== invocationId) return getInvocation(env, inserted.id, agentId);
  if (capability.async) {
    try {
      await env.INVOCATION_QUEUE.send({ invocationId, jobId });
    } catch {
      console.error(
        JSON.stringify({ event: 'queue_send_failed', invocationId, jobId }),
      ); /* Scheduled outbox recovery re-enqueues persisted jobs. */
    }
  } else await executeInvocation(env, invocationId);
  return getInvocation(env, invocationId, agentId);
}
export async function executeInvocation(env: Env, invocationId: string) {
  const db = drizzle(env.DB);
  const claimed = await db
    .update(invocations)
    .set({ status: 'running' })
    .where(and(eq(invocations.id, invocationId), eq(invocations.status, 'queued')))
    .returning()
    .get();
  if (!claimed) return; // At-least-once queue delivery does not repeat a provider invocation.
  const start = Date.now();
  await db.update(jobs).set({ status: 'running', progress: 20 }).where(eq(jobs.invocationId, invocationId));
  try {
    const capability = await getCapabilityRecord(env, claimed.capabilityId);
    const quote = await db
      .select({ capabilityVersion: quotes.capabilityVersion })
      .from(purchases)
      .innerJoin(quotes, eq(purchases.quoteId, quotes.id))
      .where(eq(purchases.id, claimed.purchaseId))
      .get();
    if (!quote || capability.version !== quote.capabilityVersion)
      throw new DomainError(
        'CAPABILITY_CHANGED',
        'Capability changed before execution. Contact the workspace operator.',
      );
    const result = await invokeProvider(env, capability, invocationId, claimed.input);
    const serialized = JSON.stringify(result);
    const latencyMs = Date.now() - start;
    const now = new Date().toISOString();
    const artifactKey = serialized.length > 16_000 ? `results/${claimed.agentId}/${invocationId}.json` : null;
    if (artifactKey) await writeArtifact(env, artifactKey, serialized);
    await db.batch([
      db
        .update(invocations)
        .set({
          status: 'completed',
          result: artifactKey ? null : result,
          artifactKey,
          latencyMs,
          completedAt: now,
        })
        .where(eq(invocations.id, invocationId)),
      db
        .update(jobs)
        .set({
          status: 'completed',
          progress: 100,
          result: artifactKey ? { artifact: true } : result,
          completedAt: now,
        })
        .where(eq(jobs.invocationId, invocationId)),
      db
        .update(capabilities)
        .set({
          successCount: sql`${capabilities.successCount}+1`,
          avgLatencyMs: sql`(${capabilities.avgLatencyMs}*${capabilities.successCount}+${latencyMs})/(${capabilities.successCount}+1)`,
        })
        .where(eq(capabilities.id, claimed.capabilityId)),
    ]);
    const agent = await db.select().from(agents).where(eq(agents.id, claimed.agentId)).get();
    if (agent)
      await audit(
        env,
        agent.userId,
        'invocation_completed',
        `${capability.name} returned a result in ${latencyMs}ms`,
        invocationId,
      );
  } catch (error) {
    const message =
      error instanceof DomainError
        ? `${error.code}: ${error.message}`
        : 'PROVIDER_FAILURE: Execution failed. Contact the workspace operator.';
    const now = new Date().toISOString();
    await db.batch([
      db
        .update(invocations)
        .set({ status: 'failed', error: message, latencyMs: Date.now() - start, completedAt: now })
        .where(eq(invocations.id, invocationId)),
      db
        .update(jobs)
        .set({ status: 'failed', error: message, completedAt: now })
        .where(eq(jobs.invocationId, invocationId)),
      db
        .update(capabilities)
        .set({ failureCount: sql`${capabilities.failureCount}+1` })
        .where(eq(capabilities.id, claimed.capabilityId)),
    ]);
    console.error(
      JSON.stringify({
        event: 'invocation_failed',
        invocationId,
        code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
      }),
    );
  }
}
export async function getJob(env: Env, jobId: string, agentId: string): Promise<Job> {
  const row = await drizzle(env.DB)
    .select({ job: jobs, invocation: invocations })
    .from(jobs)
    .innerJoin(invocations, eq(jobs.invocationId, invocations.id))
    .where(and(eq(jobs.id, jobId), eq(invocations.agentId, agentId)))
    .get();
  if (!row) throw new DomainError('JOB_NOT_FOUND', 'Job not found for this agent.', 404);
  const invocation = await getInvocation(env, row.invocation.id, agentId);
  return { ...row.job, result: invocation.result };
}
export async function recoverJobs(env: Env) {
  const rows = await drizzle(env.DB).select().from(jobs).where(eq(jobs.status, 'queued')).limit(50);
  if (rows.length)
    await env.INVOCATION_QUEUE.sendBatch(
      rows.map((row) => ({ body: { jobId: row.id, invocationId: row.invocationId } })),
    );
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const now = new Date().toISOString();
  const stale = await drizzle(env.DB)
    .update(invocations)
    .set({
      status: 'failed',
      error:
        'EXECUTION_INTERRUPTED: Provider outcome unknown; invocation quota consumed. Manual reconciliation required.',
      completedAt: now,
    })
    .where(and(eq(invocations.status, 'running'), sql`${invocations.createdAt}<${cutoff}`))
    .returning();
  for (const inv of stale)
    await drizzle(env.DB)
      .update(jobs)
      .set({ status: 'failed', error: inv.error, completedAt: now })
      .where(eq(jobs.invocationId, inv.id));
}
