import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { bankWork } from '../apps/worker/src/bank/work';
import type { Env } from '../apps/worker/src/env';
import {
  enqueueMaintenance,
  runMaintenance,
  type MaintenanceMessage,
} from '../apps/worker/src/services/maintenance';
import { indexBankEvents } from '../apps/worker/src/bank/indexer';
vi.mock('../apps/worker/src/bank/indexer', () => ({ indexBankEvents: vi.fn().mockResolvedValue(true) }));
vi.mock('../apps/worker/src/bank/keeper', () => ({ bankKeeper: vi.fn() }));
vi.mock('../apps/worker/src/services/commerce', () => ({ expireApprovals: vi.fn() }));
vi.mock('../apps/worker/src/services/execution', () => ({ recoverJobs: vi.fn() }));
vi.mock('../apps/worker/src/lib/auth', () => ({ cleanupAuth: vi.fn() }));

let mf: Miniflare;
let env: Env;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  env = { DB: db } as Env;
  for (const file of (await readdir('packages/db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(`packages/db/migrations/${file}`, 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  }
});
afterAll(async () => {
  await mf?.dispose();
});
describe('bounded maintenance', () => {
  it('bounds index catch-up to five separately queued pages and omits Bank work when disabled', async () => {
    const pending: MaintenanceMessage[] = [];
    const send = vi.fn(async (body: MaintenanceMessage) => {
      pending.push(body);
    });
    const sendBatch = vi.fn();
    const queuedEnv = {
      ...env,
      BANK_ENABLED: 'true',
      INVOCATION_QUEUE: { send, sendBatch },
    } as unknown as Env;
    await enqueueMaintenance(queuedEnv);
    expect(sendBatch.mock.calls[0][0]).toEqual([
      { body: { maintenance: 'cleanup' } },
      { body: { maintenance: 'keeper' } },
      { body: { maintenance: 'index', remaining: 5 } },
    ]);
    pending.push({ maintenance: 'index', remaining: 5 });
    while (pending.length) await runMaintenance(queuedEnv, pending.shift()!);
    expect(indexBankEvents).toHaveBeenCalledTimes(5);
    expect(vi.mocked(indexBankEvents).mock.calls.every((call) => call[1] === 1)).toBe(true);
    expect(send).toHaveBeenCalledTimes(4);
    await enqueueMaintenance({ ...queuedEnv, BANK_ENABLED: 'false' });
    expect(sendBatch.mock.calls[1][0]).toEqual([{ body: { maintenance: 'cleanup' } }]);
    vi.mocked(indexBankEvents).mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(runMaintenance(queuedEnv, { maintenance: 'index', remaining: 5 })).rejects.toThrow(
      'RPC unavailable',
    );
    expect(send).toHaveBeenCalledTimes(4);
  });
  it('excludes overlapping consumers, releases failures, and recovers expired leases', async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = bankWork(env, 'index', async () => {
      enter();
      await released;
      return 1;
    });
    await entered;
    expect(await bankWork(env, 'index', async () => 2)).toEqual({ ran: false });
    release();
    expect(await first).toEqual({ ran: true, result: 1 });
    await expect(
      bankWork(env, 'index', async () => {
        throw new Error('RPC unavailable');
      }),
    ).rejects.toThrow('RPC unavailable');
    expect(await bankWork(env, 'index', async () => 3, 60_000)).toEqual({ ran: true, result: 3 });
    expect(await bankWork(env, 'index', async () => 4)).toEqual({ ran: false });
    await env.DB.prepare("UPDATE bank_work_leases SET expires_at=0 WHERE name='index'").run();
    expect(await bankWork(env, 'index', async () => 5)).toEqual({ ran: true, result: 5 });
  });
  it('uses the numeric block range index for event cleanup', async () => {
    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN DELETE FROM bank_events WHERE source='chain' AND CAST(block_number AS INTEGER) BETWEEN ? AND ?",
    )
      .bind(100, 200)
      .all();
    expect(JSON.stringify(plan.results)).toContain('bank_events_source_block_idx');
    expect(JSON.stringify(plan.results)).not.toContain('SCAN bank_events');
  });
});
