import { MAX_PAYLOAD_BYTES, R2_BUDGET } from '@capora/config';
import { DomainError } from '@capora/types';
import type { Env } from '../env';

async function reserveStorage(env: Env, writes: number, reads: number, bytes: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  // One conditional UPDATE serializes reservations across requests and isolates.
  // Keep reservations on failed/ambiguous R2 calls: refunding could undercount billable operations.
  const reserved = await env.DB.prepare(
    `
    UPDATE resource_usage SET
      usage_day = ?,
      writes = (CASE WHEN usage_day = ? THEN writes ELSE 0 END) + ?,
      reads = (CASE WHEN usage_day = ? THEN reads ELSE 0 END) + ?,
      reserved_bytes = reserved_bytes + ?
    WHERE resource = 'r2' AND blocked = 0 AND usage_day <= ?
      AND reserved_bytes + ? <= ?
      AND (CASE WHEN usage_day = ? THEN writes ELSE 0 END) + ? <= ?
      AND (CASE WHEN usage_day = ? THEN reads ELSE 0 END) + ? <= ?
    RETURNING resource
  `,
  )
    .bind(
      day,
      day,
      writes,
      day,
      reads,
      bytes,
      day,
      bytes,
      R2_BUDGET.retainedBytes,
      day,
      writes,
      R2_BUDGET.writesPerDay,
      day,
      reads,
      R2_BUDGET.readsPerDay,
    )
    .first();
  if (!reserved)
    throw new DomainError(
      'STORAGE_BUDGET_EXHAUSTED',
      'Workspace storage access is paused to stay within its usage budget. Contact the workspace operator.',
      503,
    );
}

export async function writeArtifact(env: Env, key: string, value: string): Promise<void> {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > MAX_PAYLOAD_BYTES)
    throw new DomainError('ARTIFACT_TOO_LARGE', 'A stored dataset or result cannot exceed 256 KiB.', 413);
  await reserveStorage(env, 1, 0, bytes);
  await env.ARTIFACTS.put(key, value, {
    storageClass: 'Standard',
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function readArtifact(env: Env, key: string): Promise<R2ObjectBody | null> {
  await reserveStorage(env, 0, 1, 0);
  return env.ARTIFACTS.get(key);
}

export async function getStorageUsage(env: Env) {
  const row = await env.DB.prepare(
    "SELECT usage_day,writes,reads,reserved_bytes,blocked FROM resource_usage WHERE resource='r2'",
  ).first<{ usage_day: string; writes: number; reads: number; reserved_bytes: number; blocked: number }>();
  if (!row) throw new DomainError('STORAGE_BUDGET_UNAVAILABLE', 'Storage budget is not configured.', 503);
  const day = new Date().toISOString().slice(0, 10);
  return {
    day,
    writes: row.usage_day === day ? row.writes : 0,
    reads: row.usage_day === day ? row.reads : 0,
    reservedBytes: row.reserved_bytes,
    blocked: Boolean(row.blocked),
    limits: R2_BUDGET,
  };
}
