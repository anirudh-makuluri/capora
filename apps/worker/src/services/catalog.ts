import { capabilities, providers, reviews, drizzle } from '@capora/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DomainError, type Capability, type SearchInput } from '@capora/types';
import type { Env } from '../env';

// Archived bootstrap fixtures can fulfill old purchases, but are absent from new discovery/quotes.
export function isArchivedBootstrapFixture(row: typeof capabilities.$inferSelect) {
  return (
    row.synthetic &&
    row.endpoint === `demo://${row.id}` &&
    [
      'datapulse_headcount',
      'companyintel_premium',
      'verifycorp',
      'securescan_advanced',
      'legalarchive',
      'geointel',
      'retail_demand',
      'documentverify',
      'supplychain_radar',
      'patentlens',
    ].includes(row.id)
  );
}
export async function getExecutableCapabilityRecord(env: Env, capabilityId: string) {
  const row = await getCapabilityRecord(env, capabilityId, false);
  if (row.removedAt || (!row.enabled && !isArchivedBootstrapFixture(row)))
    throw new DomainError('CAPABILITY_UNAVAILABLE', 'This capability is unavailable.', 404);
  return row;
}

export function publicCapability(
  row: typeof capabilities.$inferSelect,
  provider: typeof providers.$inferSelect,
  stats: { rating: number; reviewCount: number } = { rating: 0, reviewCount: 0 },
): Capability {
  const total = row.successCount + row.failureCount;
  return {
    id: row.id,
    providerId: provider.id,
    provider: provider.name,
    name: row.name,
    description: row.description,
    type: row.type,
    category: row.category,
    priceCents: row.priceCents,
    currency: 'cUSD',
    pricingUnit: row.pricingUnit,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    expectedLatencyMs: row.expectedLatencyMs,
    avgLatencyMs: row.avgLatencyMs,
    reliability: total ? Math.round((row.successCount / total) * 1000) / 10 : row.baselineReliability,
    reputation: provider.reputation,
    rating: stats.rating,
    reviewCount: stats.reviewCount,
    successCount: row.successCount,
    failureCount: row.failureCount,
    tags: row.tags,
    async: row.async,
    enabled: row.enabled,
    version: row.version,
    synthetic: row.synthetic,
    documentationUrl: row.documentationUrl,
    availability: row.availability,
  };
}
export async function getCapabilityRecord(env: Env, capabilityId: string, enabled = true) {
  const row = await drizzle(env.DB)
    .select()
    .from(capabilities)
    .where(eq(capabilities.id, capabilityId))
    .get();
  if (!row || row.removedAt || (enabled && !row.enabled))
    throw new DomainError('CAPABILITY_UNAVAILABLE', 'This capability is unavailable.', 404);
  return row;
}
export async function getCapability(env: Env, capabilityId: string) {
  const row = await getCapabilityRecord(env, capabilityId);
  const provider = await drizzle(env.DB)
    .select()
    .from(providers)
    .where(eq(providers.id, row.providerId))
    .get();
  if (!provider) throw new DomainError('CAPABILITY_UNAVAILABLE', 'Provider is unavailable.', 404);
  const stats = await drizzle(env.DB)
    .select({
      rating: sql<number>`COALESCE(AVG(${reviews.rating}), 0)`,
      reviewCount: sql<number>`COUNT(*)`,
    })
    .from(reviews)
    .where(and(eq(reviews.capabilityId, capabilityId), isNotNull(reviews.invocationId)))
    .get();
  return publicCapability(row, provider, stats);
}
export function rankCapabilities(items: Capability[], input: SearchInput): Capability[] {
  const terms =
    input.query
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((t) => t.length > 2 && !['the', 'and', 'for', 'with', 'need', 'data'].includes(t)) ?? [];
  const scored = items
    .filter(
      (c) =>
        c.enabled &&
        (!input.type || c.type === input.type) &&
        (!input.category || c.category === input.category) &&
        (input.max_budget === undefined || c.priceCents <= Math.round(input.max_budget * 100)) &&
        (input.min_reliability === undefined || c.reliability >= input.min_reliability) &&
        (input.min_reputation === undefined || c.reputation >= input.min_reputation) &&
        (input.max_latency_ms === undefined || c.expectedLatencyMs <= input.max_latency_ms),
    )
    .map((c) => {
      const title = `${c.name} ${c.category} ${c.tags.join(' ')}`.toLowerCase();
      const desc = c.description.toLowerCase();
      const score = terms.reduce((n, t) => n + (title.includes(t) ? 3 : 0) + (desc.includes(t) ? 1 : 0), 0);
      return { c, score };
    })
    .filter(({ score }) => !terms.length || score > 0);
  scored.sort((a, b) => {
    switch (input.sort) {
      case 'price':
        return a.c.priceCents - b.c.priceCents;
      case 'reputation':
        return b.c.reputation - a.c.reputation;
      case 'reliability':
        return b.c.reliability - a.c.reliability;
      case 'latency':
        return a.c.expectedLatencyMs - b.c.expectedLatencyMs;
      default:
        return terms.length ? b.score - a.score || a.c.priceCents - b.c.priceCents : 0;
    }
  });
  return scored.map(({ c }) => c);
}
export async function searchCapabilities(env: Env, input: SearchInput, agentId?: string) {
  const rows = await drizzle(env.DB)
    .select({ capability: capabilities, provider: providers })
    .from(capabilities)
    .innerJoin(providers, eq(capabilities.providerId, providers.id));
  const ratings = await drizzle(env.DB)
    .select({
      capabilityId: reviews.capabilityId,
      rating: sql<number>`AVG(${reviews.rating})`,
      reviewCount: sql<number>`COUNT(*)`,
    })
    .from(reviews)
    .where(isNotNull(reviews.invocationId))
    .groupBy(reviews.capabilityId);
  const stats = new Map(ratings.map((rating) => [rating.capabilityId, rating]));
  const policy = agentId
    ? await env.DB.prepare(
        'SELECT auto_approve_cents, autonomous_enabled FROM spending_policies WHERE agent_id = ?',
      )
        .bind(agentId)
        .first<{ auto_approve_cents: number; autonomous_enabled: number }>()
    : null;
  return rankCapabilities(
    rows
      .filter(({ capability }) => !capability.removedAt)
      .map(({ capability, provider }) => ({
        ...publicCapability(capability, provider, stats.get(capability.id)),
        ...(policy
          ? {
              approvalRequired:
                !policy.autonomous_enabled || capability.priceCents > policy.auto_approve_cents,
            }
          : {}),
      })),
    input,
  );
}
