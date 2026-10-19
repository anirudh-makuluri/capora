import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { DomainError } from '../packages/types/src/index';
import { catalogStatements } from '../scripts/seed-data';
import { executeInvocation, invokeCapability } from '../apps/worker/src/services/execution';
import { canonical, hash } from '../apps/worker/src/lib/crypto';
import { invokeProvider } from '../apps/worker/src/services/gateway';
import { resolveEscrow } from '../apps/worker/src/bank/escrow';
import type { Env } from '../apps/worker/src/env';
import worker from '../apps/worker/src/index';
vi.mock('../apps/worker/src/services/gateway', () => ({ invokeProvider: vi.fn() }));
vi.mock('../apps/worker/src/bank/escrow', () => ({ startEscrow: vi.fn(), resolveEscrow: vi.fn() }));
let mf: Miniflare, db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const now = new Date().toISOString();
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch(){return new Response("ok")} }',
      compatibilityDate: '2026-10-03',
      d1Databases: ['DB'],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of (await readdir('packages/db/migrations')).filter((file) => file.endsWith('.sql')).sort())
    for (const sql of (await readFile(`packages/db/migrations/${file}`, 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  await db
    .prepare(
      "INSERT INTO users(id,email,name,created_at) VALUES('user_demo','retry@example.com','Retry test',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO agents(id,user_id,name,token_hash,status,created_at) VALUES('retry_agent','user_demo','Retry agent','retry-hash','active',?)",
    )
    .bind(now)
    .run();
  for (const sql of catalogStatements('user_demo', now)) await db.prepare(sql).run();
});
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  vi.clearAllMocks();
  await db.prepare('DELETE FROM jobs').run();
  await db.prepare('DELETE FROM invocations').run();
  await db.prepare('DELETE FROM purchases').run();
  await db.prepare('DELETE FROM quotes').run();
  await db
    .prepare(
      "INSERT INTO quotes(id,agent_id,capability_id,price_cents,input,input_hash,capability_version,created_at,expires_at) SELECT 'retry_quote','retry_agent',id,10,'{}','hash',version,?,? FROM capabilities WHERE id='document_fingerprint'",
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO purchases(id,quote_id,agent_id,capability_id,amount_cents,status,payment_mode,budget_day,created_at,updated_at) VALUES('retry_purchase','retry_quote','retry_agent','document_fingerprint',10,'purchased','sandbox','2026-10-19',?,?)",
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO invocations(id,purchase_id,capability_id,agent_id,status,input,created_at) VALUES('retry_invocation','retry_purchase','document_fingerprint','retry_agent','queued','{}',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO jobs(id,invocation_id,status,created_at) VALUES('retry_job','retry_invocation','queued',?)",
    )
    .bind(now)
    .run();
});
describe('enrollment failures preserve recoverable Bank invocations', () => {
  it.each([false, true])(
    'queues synchronous retries without duplicating a purchase (queue unavailable: %s)',
    async (unavailable) => {
      await db.prepare('DELETE FROM jobs').run();
      await db.prepare('DELETE FROM invocations').run();
      await db
        .prepare("UPDATE quotes SET input_hash=? WHERE id='retry_quote'")
        .bind(await hash(canonical({})))
        .run();
      const send = vi.fn().mockImplementation(async () => {
        if (unavailable) throw Error('Unavailable');
      });
      const env = { DB: db, INVOCATION_QUEUE: { send } } as unknown as Env;
      vi.mocked(invokeProvider)
        .mockRejectedValueOnce(new DomainError('BANK_RPC_UNAVAILABLE', 'Temporary outage', 503))
        .mockResolvedValueOnce({ verified: true });
      const invocation = await invokeCapability(env, 'retry_agent', 'retry_purchase', {});
      expect(invocation.status).toBe('queued');
      expect(send).toHaveBeenCalledWith(
        { invocationId: invocation.id, jobId: expect.any(String) },
        { delaySeconds: 10 },
      );
      await executeInvocation(env, invocation.id);
      expect((await invokeCapability(env, 'retry_agent', 'retry_purchase', {})).status).toBe('completed');
      expect((await db.prepare('SELECT id FROM invocations').all()).results).toHaveLength(1);
      expect(invokeProvider).toHaveBeenCalledTimes(2);
      expect(resolveEscrow).toHaveBeenCalledOnce();
    },
  );
  it('retries queued financial work promptly and acknowledges it only after completion', async () => {
    const message = {
      id: 'queue-test',
      timestamp: new Date(),
      body: { invocationId: 'retry_invocation', jobId: 'retry_job' },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = {
      queue: 'bank-test',
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    };
    vi.mocked(invokeProvider)
      .mockRejectedValueOnce(new DomainError('BANK_TRANSACTION_PENDING', 'Pending confirmation', 409))
      .mockResolvedValueOnce({ verified: true });
    await worker.queue(batch, { DB: db } as Env);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 10 });
    expect(message.ack).not.toHaveBeenCalled();
    await worker.queue(batch, { DB: db } as Env);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(await db.prepare("SELECT status FROM invocations WHERE id='retry_invocation'").first()).toEqual({
      status: 'completed',
    });
  });
  it.each([
    'SIGNER_ENROLLMENT_UNAVAILABLE',
    'SIGNER_ENROLLMENT_REQUIRED',
    'SIGNER_TARGET_PENDING',
    'BANK_RPC_UNAVAILABLE',
  ])('retries %s without consuming the purchase or recording provider failure', async (code) => {
    const env = { DB: db } as Env;
    vi.mocked(invokeProvider)
      .mockRejectedValueOnce(new DomainError(code, 'Enrollment pending', 503))
      .mockResolvedValueOnce({ verified: true });
    await executeInvocation(env, 'retry_invocation');
    expect(
      await db.prepare("SELECT status,error FROM invocations WHERE id='retry_invocation'").first(),
    ).toEqual({ status: 'queued', error: null });
    expect(await db.prepare("SELECT status FROM jobs WHERE id='retry_job'").first()).toEqual({
      status: 'queued',
    });
    expect(resolveEscrow).not.toHaveBeenCalled();
    await executeInvocation(env, 'retry_invocation');
    expect(await db.prepare("SELECT status FROM invocations WHERE id='retry_invocation'").first()).toEqual({
      status: 'completed',
    });
    expect(resolveEscrow).toHaveBeenCalledOnce();
    await executeInvocation(env, 'retry_invocation');
    expect(invokeProvider).toHaveBeenCalledTimes(2);
  });
  it('does not endlessly retry an unregistered destination', async () => {
    vi.mocked(invokeProvider).mockRejectedValueOnce(
      new DomainError('SIGNER_TARGET_NOT_REGISTERED', 'Invalid destination', 403),
    );
    await executeInvocation({ DB: db } as Env, 'retry_invocation');
    expect(await db.prepare("SELECT status FROM invocations WHERE id='retry_invocation'").first()).toEqual({
      status: 'failed',
    });
    expect(resolveEscrow).toHaveBeenCalledWith(expect.anything(), 'retry_purchase', 'manual_review');
  });
});
