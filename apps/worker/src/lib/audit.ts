import { drizzle, activity } from '@capora/db';
import { id } from './crypto';
import type { Env } from '../env';
export async function audit(
  env: Env,
  userId: string,
  kind: string,
  message: string,
  entityId?: string,
  correlationId?: string,
) {
  console.log(JSON.stringify({ event: kind, entityId, correlationId, timestamp: new Date().toISOString() }));
  await drizzle(env.DB)
    .insert(activity)
    .values({
      id: id('act'),
      userId,
      kind,
      message,
      entityId,
      correlationId,
      createdAt: new Date().toISOString(),
    });
}
