import { agents, capabilities, drizzle, invocations, providers, reviews } from '@capora/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  DomainError,
  rateCapabilitySchema,
  type RatingRequest,
  type RateCapabilityInput,
} from '@capora/types';
import { audit } from '../lib/audit';
import { id } from '../lib/crypto';
import type { Env } from '../env';

export async function getRatingRequest(
  env: Env,
  invocation: Pick<typeof invocations.$inferSelect, 'id' | 'capabilityId' | 'status'>,
): Promise<RatingRequest | undefined> {
  if (!['completed', 'failed'].includes(invocation.status)) return undefined;
  const review = await drizzle(env.DB)
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.invocationId, invocation.id))
    .get();
  return {
    required: !review,
    tool: 'rate_capability',
    invocationId: invocation.id,
    capabilityId: invocation.capabilityId,
    instructions: review
      ? 'Rating submitted for this invocation. No further rating is required.'
      : 'You must call rate_capability with this invocation_id, an honest integer rating from 1 to 5, and optional feedback after evaluating this result or failure. Do not invent a successful result or submit a rating before execution finishes.',
  };
}

export async function rateCapability(env: Env, agentId: string, input: RateCapabilityInput) {
  const { invocation_id: invocationId, rating, body } = rateCapabilitySchema.parse(input);
  const db = drizzle(env.DB);
  const owned = await db
    .select({ invocation: invocations, userId: agents.userId, providerId: capabilities.providerId })
    .from(invocations)
    .innerJoin(agents, eq(agents.id, invocations.agentId))
    .innerJoin(capabilities, eq(capabilities.id, invocations.capabilityId))
    .where(and(eq(invocations.id, invocationId), eq(invocations.agentId, agentId)))
    .get();
  if (!owned) throw new DomainError('NOT_FOUND', 'Invocation not found for this agent.', 404);
  if (!['completed', 'failed'].includes(owned.invocation.status))
    throw new DomainError(
      'EXECUTION_NOT_FINISHED',
      'Wait until execution completes or fails before rating.',
      409,
    );

  // The unique invocation index and transactional batch prevent retries or races from
  // adding votes, and keep provider reputation consistent with persisted reviews.
  const [inserted] = await db.batch([
    db
      .insert(reviews)
      .values({
        id: id('review'),
        capabilityId: owned.invocation.capabilityId,
        userId: owned.userId,
        agentId,
        invocationId,
        rating,
        body: body || null,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: reviews.invocationId })
      .returning(),
    db
      .update(providers)
      .set({
        reputation: sql`(SELECT COALESCE(AVG(${reviews.rating}), 0) FROM ${reviews}
        INNER JOIN ${capabilities} ON ${reviews.capabilityId} = ${capabilities.id}
        WHERE ${capabilities.providerId} = ${owned.providerId} AND ${reviews.invocationId} IS NOT NULL)`,
      })
      .where(eq(providers.id, owned.providerId)),
  ]);
  const review = await db.select().from(reviews).where(eq(reviews.invocationId, invocationId)).get();
  if (!review) throw new DomainError('INTERNAL_ERROR', 'Rating could not be persisted.', 500);
  if (review.rating !== rating || review.body !== (body || null))
    throw new DomainError(
      'RATING_ALREADY_SUBMITTED',
      'This invocation already has a rating. Each invocation can be rated once.',
      409,
    );
  if (inserted.length)
    await audit(
      env,
      owned.userId,
      'capability_rated',
      `Capability rated ${rating}/5 after execution`,
      review.id,
    );
  return { ...review, ratingRequired: false };
}
