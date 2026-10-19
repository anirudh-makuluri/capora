import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { HttpRequestError, ExecutionRevertedError } from 'viem';
import { transaction } from '../apps/worker/src/bank/chain';
import { indexBankEvents } from '../apps/worker/src/bank/indexer';
import type { Env } from '../apps/worker/src/env';
const rpc = vi.hoisted(() => ({
  call: vi.fn(),
  getBalance: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
}));
vi.mock('../apps/worker/src/bank/config', async (original) => ({
  ...(await original<object>()),
  assertChain: vi.fn(async () => rpc),
}));
const address = '0x1111111111111111111111111111111111111111';
const hash = `0x${'a'.repeat(64)}`,
  blockHash = `0x${'b'.repeat(64)}`;
let mf: Miniflare, db: Awaited<ReturnType<Miniflare['getD1Database']>>, env: Env;
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
  await db
    .prepare(
      'CREATE TABLE bank_events(id TEXT PRIMARY KEY,source TEXT,tx_hash TEXT,block_number TEXT,block_hash TEXT,data TEXT,created_at TEXT)',
    )
    .run();
  await db.prepare('CREATE TABLE bank_entities(address TEXT,created_at TEXT)').run();
  await db
    .prepare('CREATE TABLE bank_cursors(source TEXT PRIMARY KEY,block_number TEXT,block_hash TEXT)')
    .run();
  await db
    .prepare(
      "CREATE TABLE bank_transactions(id TEXT PRIMARY KEY,account_id TEXT,purpose TEXT,target TEXT,calldata TEXT,commitment TEXT,state TEXT DEFAULT 'prepared',tx_hash TEXT,block_number TEXT,block_hash TEXT,error TEXT,attempts INTEGER DEFAULT 0,lease_id TEXT,lease_until INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT)",
    )
    .run();
});
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  vi.clearAllMocks();
  await db.prepare('DELETE FROM bank_transactions').run();
  await db.prepare('DELETE FROM bank_cursors').run();
  env = {
    DB: db,
    BANK_ENABLED: 'true',
    BANK_RPC_URL: 'https://rpc.example',
    CAPORA_BASE_URL: 'https://capora.example',
    PRIVY_APP_ID: 'app',
    PRIVY_APP_SECRET: 'secret',
    PRIVY_WALLET_ID: 'wallet',
    BANK_DEPLOYMENT: JSON.stringify({
      chainId: 84532,
      token: address,
      riskToken: address,
      walletFactory: address,
      market: address,
      escrow: address,
      lending: address,
      bankFactory: address,
      executor: address,
      treasury: address,
    }),
  } as Env;
  rpc.getBalance.mockResolvedValue(1000000000000000n);
  rpc.call.mockResolvedValue({ data: '0x' });
  rpc.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
    blockNumber: 100n,
    blockHash: `0x${'0'.repeat(64)}`,
  });
  rpc.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 100n, blockHash });
  rpc.getBlock.mockResolvedValue({ hash: blockHash });
  rpc.getBlockNumber.mockResolvedValue(102n);
  rpc.getLogs.mockResolvedValue([]);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { hash } })));
});
afterEach(() => vi.restoreAllMocks());
const run = () => transaction(env, 'durable-operation', 'verified_paypal_mint', address, '0x12345678');
describe('managed Bank transaction recovery', () => {
  it('catches up confirmed logs in at most five 200-block pages with canonical overlap', async () => {
    env.BANK_DEPLOYMENT = JSON.stringify({ ...JSON.parse(env.BANK_DEPLOYMENT!), startBlock: '1' });
    rpc.getBlockNumber.mockResolvedValue(1000n);
    await indexBankEvents(env);
    expect(rpc.getLogs).toHaveBeenCalledTimes(5);
    for (const [range] of rpc.getLogs.mock.calls)
      expect(BigInt(range.toBlock) - BigInt(range.fromBlock) + 1n).toBeLessThanOrEqual(200n);
    expect(await db.prepare('SELECT block_number FROM bank_cursors').first()).toEqual({
      block_number: '972',
    });
    await indexBankEvents(env);
    expect(rpc.getLogs).toHaveBeenCalledTimes(6);
    expect(await db.prepare('SELECT block_number FROM bank_cursors').first()).toEqual({
      block_number: '998',
    });
    expect(rpc.getLogs.mock.calls[5][0].fromBlock).toBe(966n);
  });
  it('rejects a contract revert before signing and persists a terminal failure', async () => {
    rpc.call.mockRejectedValueOnce(new ExecutionRevertedError({ message: 'execution reverted: DEADLINE' }));
    await expect(run()).rejects.toMatchObject({ code: 'BANK_SIMULATION_REJECTED' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.prepare('SELECT state,tx_hash FROM bank_transactions').first()).toEqual({
      state: 'failed',
      tx_hash: null,
    });
    expect((await run()).state).toBe('failed');
    expect(rpc.call).toHaveBeenCalledOnce();
  });
  it('keeps an RPC rate-limited read prepared and retries without an earlier signature', async () => {
    rpc.getBalance.mockRejectedValueOnce(new HttpRequestError({ url: 'https://rpc.example', status: 429 }));
    await expect(run()).rejects.toMatchObject({ code: 'BANK_RPC_UNAVAILABLE', status: 503 });
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.prepare('SELECT state,tx_hash,attempts FROM bank_transactions').first()).toEqual({
      state: 'prepared',
      tx_hash: null,
      attempts: 0,
    });
    expect((await run()).state).toBe('confirmed');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('refreshes a Base preconfirmation receipt before persisting canonical success', async () => {
    const row = await run();
    expect(row).toMatchObject({ state: 'confirmed', block_hash: blockHash, tx_hash: hash });
    expect(rpc.getTransactionReceipt).toHaveBeenCalledWith({ hash });
    await run();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps reorged or insufficiently confirmed receipts pending without rebroadcast', async () => {
    rpc.getBlock.mockResolvedValueOnce({ hash: `0x${'c'.repeat(64)}` });
    expect((await run()).state).toBe('pending');
    rpc.getBlockNumber.mockResolvedValueOnce(101n);
    expect((await run()).state).toBe('pending');
    expect((await run()).state).toBe('confirmed');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('recovers an uncertain managed submission using the same signing idempotency key', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network interrupted'));
    await expect(run()).rejects.toMatchObject({ code: 'SIGNER_UNAVAILABLE' });
    expect(await db.prepare('SELECT state,tx_hash FROM bank_transactions').first()).toEqual({
      state: 'submitting',
      tx_hash: null,
    });
    expect((await run()).state).toBe('confirmed');
    const keys = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => new Headers(init?.headers).get('privy-idempotency-key'));
    expect(keys[0]).toBe(keys[1]);
    expect(rpc.call).toHaveBeenCalledOnce(); // Never re-simulate an uncertain send that may already have executed.
  });
});
