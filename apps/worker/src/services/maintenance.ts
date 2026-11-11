import type { Env } from '../env';
import { bankWork } from '../bank/work';
import { bankKeeper } from '../bank/keeper';
import { indexBankEvents } from '../bank/indexer';
import { expireApprovals } from './commerce';
import { recoverJobs } from './execution';
import { cleanupAuth } from '../lib/auth';

export type MaintenanceMessage = { maintenance: 'index' | 'keeper' | 'cleanup'; remaining?: number };
export async function enqueueMaintenance(env: Env) {
  const messages: MaintenanceMessage[] = [{ maintenance: 'cleanup' }];
  if (env.BANK_ENABLED === 'true')
    messages.push({ maintenance: 'keeper' }, { maintenance: 'index', remaining: 5 });
  await env.INVOCATION_QUEUE.sendBatch(messages.map((body) => ({ body })));
}
export async function runMaintenance(env: Env, message: MaintenanceMessage) {
  const started = Date.now();
  const outcome = await bankWork(env, `maintenance:${message.maintenance}`, async () => {
    if (message.maintenance === 'index') return indexBankEvents(env, 1);
    if (message.maintenance === 'keeper') {
      await bankKeeper(env);
      return false;
    }
    await Promise.all([expireApprovals(env), recoverJobs(env), cleanupAuth(env)]);
    return false;
  });
  const remaining = Math.min(5, Math.max(1, message.remaining ?? 1));
  if (outcome.ran && outcome.result && message.maintenance === 'index' && remaining > 1)
    await env.INVOCATION_QUEUE.send({
      maintenance: 'index',
      remaining: remaining - 1,
    } satisfies MaintenanceMessage);
  console.log(
    JSON.stringify({
      event: 'maintenance_completed',
      task: message.maintenance,
      ran: outcome.ran,
      durationMs: Date.now() - started,
    }),
  );
}
