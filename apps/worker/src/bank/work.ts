import type { Env } from '../env';

// Longer than the queue consumer's 15-minute maximum wall time. A terminated
// consumer cannot later write over a successor; the next cron recovers the lease.
export async function bankWork<T>(env: Env, name: string, action: () => Promise<T>, cooldownMs = 0) {
  const token = crypto.randomUUID();
  const now = Date.now();
  const acquired = await env.DB.prepare(
    `INSERT INTO bank_work_leases(name,token,expires_at) VALUES(?,?,?)
    ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
    WHERE bank_work_leases.expires_at<=? RETURNING token`,
  )
    .bind(name, token, now + 20 * 60_000, now)
    .first();
  if (!acquired) return { ran: false as const };
  let completed = false;
  try {
    const result = await action();
    completed = true;
    return { ran: true as const, result };
  } finally {
    if (completed && cooldownMs)
      await env.DB.prepare('UPDATE bank_work_leases SET expires_at=? WHERE name=? AND token=?')
        .bind(Date.now() + cooldownMs, name, token)
        .run();
    else
      await env.DB.prepare('DELETE FROM bank_work_leases WHERE name=? AND token=?').bind(name, token).run();
  }
}
