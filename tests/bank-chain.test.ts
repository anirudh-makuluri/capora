import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  CaporaUSDAbi,
  PurchaseEscrowAbi,
  ManagedFundAbi,
  PublicChitAbi,
  TestMarketAbi,
} from '../packages/bank/src/abis';
import { catalogStatements } from '../scripts/seed-data';
import { chainKey } from '../apps/worker/src/bank/chain';
import { displayUnits } from '../packages/bank/src/index';
import { CAPORA_BANK_PROVIDER_ID } from '../packages/config/src/index';
import { saveMarketplaceFee } from '../apps/worker/src/services/marketplace-fees';
import type { Env } from '../apps/worker/src/env';
import type { Purchase, Quote, Invocation } from '../packages/types/src/index';
let node: ChildProcess,
  mf: Miniflare,
  cookie = '',
  userId = '',
  agentA = '',
  agentB = '',
  merchantProvider = '',
  merchantCapability = '';
let deployment: Record<string, Address>;
let captureCalls = 0,
  ordersCreated = 0;
let plannerProposal: unknown = {
  action: 'hold',
  reason: 'No fresh external signal; hold the bounded test position.',
};
const orders = new Map<string, { id: string; status: string; purchase_units: unknown[] }>();
const rpc = 'http://127.0.0.1:8546';
const chain = createPublicClient({ chain: baseSepolia, transport: http(rpc) }),
  signer = createWalletClient({ chain: baseSepolia, transport: http(rpc) });
async function api<T>(path: string, body?: unknown, method = 'POST', cookieOverride = cookie) {
  const response = await mf.dispatchFetch(`http://localhost/api${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: { Cookie: cookieOverride, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json()) as T;
  if (!response.ok) throw Object.assign(new Error(JSON.stringify(data)), { status: response.status });
  return data;
}
async function action(
  agentId: string,
  operation: string,
  input: Record<string, unknown>,
  approve = false,
): Promise<Invocation> {
  const q = await api<Quote>(`/agents/${agentId}/quotes`, { capability_id: `bank_${operation}`, input });
  let p = await api<Purchase>(`/agents/${agentId}/purchases`, { quote_id: q.id });
  if (p.status === 'pending_approval' && approve)
    p = await api<Purchase>(`/approvals/${p.id}`, { approve: true });
  expect(p.status, JSON.stringify(p)).toBe('purchased');
  const invocation = await api<Invocation>(`/agents/${agentId}/invocations`, { purchase_id: p.id, input });
  for (let i = 0; i < 150; i++) {
    const current = await api<Invocation>(`/agents/${agentId}/invocations/${invocation.id}`);
    if (['completed', 'failed'].includes(current.status)) {
      expect(current.error, JSON.stringify(current)).toBeNull();
      return current;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Invocation did not settle: ${invocation.id}`);
}
async function write(
  address: Address,
  abi: typeof CaporaUSDAbi | typeof TestMarketAbi | typeof PurchaseEscrowAbi,
  fn: string,
  args: readonly unknown[],
) {
  const hash = await signer.sendTransaction({
    account: deployment.executor,
    to: address,
    data: encodeFunctionData({ abi, functionName: fn, args } as never),
    gas: 10000000n,
  });
  expect((await chain.waitForTransactionReceipt({ hash })).status).toBe('success');
  return hash;
}
async function advance(seconds: number) {
  await fetch(rpc, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [seconds] }),
  });
  await fetch(rpc, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'evm_mine', params: [] }),
  });
}
beforeAll(async () => {
  node = spawn(
    process.execPath,
    [resolve('node_modules/tsx/dist/cli.mjs'), resolve('packages/bank/scripts/local-node.ts')],
    {
      cwd: resolve('packages/bank'),
      env: { ...process.env, CAPORA_LOCAL_CHAIN_PORT: '8546' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (let i = 0; i < 200; i++) {
    try {
      if ((await chain.getChainId()) === 84532) break;
    } catch {
      /* Wait for the isolated local EVM. */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise<void>((done, reject) => {
    const child = spawn(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), resolve('packages/bank/scripts/deploy.ts'), '--local'],
      {
        env: { ...process.env, BANK_RPC_URL: rpc, BANK_DEPLOY_OUTPUT: 'bank-test.json' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let error = '';
    child.stderr?.on('data', (d) => (error += String(d)));
    child.once('exit', (code) => (code === 0 ? done() : reject(new Error(error))));
  });
  deployment = JSON.parse(await readFile('.local/bank-test.json', 'utf8')).deployment;
  const secret = 'bank-isolated-test-secret-thirty-two-characters';
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: resolve('apps/worker/dist/index.js'),
      compatibilityDate: '2026-10-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      r2Buckets: ['ARTIFACTS'],
      queueProducers: { INVOCATION_QUEUE: 'bank-test' },
      queueConsumers: { 'bank-test': { maxBatchTimeout: 0, maxBatchSize: 1 } },
      bindings: {
        DEV_MODE: 'true',
        PAYMENT_MODE: 'demo',
        PAYPAL_ENVIRONMENT: 'sandbox',
        CAPORA_BASE_URL: 'http://localhost',
        SESSION_SECRET: secret,
        ENCRYPTION_KEY: secret,
        DEMO_PROVIDER_SECRET: secret,
        PROVIDER_ALLOWED_HOSTS: '',
        BANK_ENABLED: 'true',
        BANK_RPC_URL: rpc,
        BANK_DEPLOYMENT: JSON.stringify({ ...deployment, chainId: 84532 }),
        BANK_MARKETPLACE_FEE_BPS: '250',
        PAYPAL_CLIENT_ID: 'isolated-paypal-double',
        PAYPAL_CLIENT_SECRET: 'isolated-paypal-double',
        PAYPAL_WEBHOOK_ID: 'isolated-webhook',
        BANK_PLANNER_API_KEY: 'isolated-planner-double',
        BANK_PLANNER_MODEL: 'isolated-planner-double',
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.hostname === 'api.anthropic.com')
          return new Response(
            JSON.stringify({
              content: [{ type: 'tool_use', name: 'propose_action', input: { proposal: plannerProposal } }],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        if (url.hostname !== 'api-m.sandbox.paypal.com') {
          const payload = request.method === 'POST' ? await request.text() : undefined;
          try {
            const result = await fetch(request.url, {
              method: request.method,
              headers: { 'Content-Type': 'application/json' },
              ...(payload ? { body: payload } : {}),
            });
            const text = await result.text();
            if (text.includes('"error"')) console.error('LOCAL_RPC_ERROR', text.slice(0, 500));
            return new Response(text, {
              status: result.status,
              headers: { 'Content-Type': 'application/json' },
            });
          } catch (error) {
            console.error('LOCAL_RPC_TRANSPORT', error instanceof Error ? error.message : 'unknown');
            throw error;
          }
        }
        const body = request.method === 'POST' ? await request.text() : '';
        const result = (data: unknown) =>
          new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
        if (url.pathname.endsWith('/oauth2/token')) return result({ access_token: 'isolated-access-token' });
        if (url.pathname.endsWith('verify-webhook-signature'))
          return result({
            verification_status:
              JSON.parse(body).transmission_sig === 'valid-test-signature' ? 'SUCCESS' : 'FAILURE',
          });
        if (url.pathname === '/v2/checkout/orders') {
          const input = JSON.parse(body),
            id = `ORDER-${input.purchase_units[0].reference_id}`,
            order = { id, status: 'APPROVED', purchase_units: input.purchase_units };
          orders.set(id, order);
          ordersCreated++;
          return result(order);
        }
        const id = decodeURIComponent(url.pathname.split('/')[4]),
          order = orders.get(id);
        if (!order) return new Response('{}', { status: 404 });
        if (url.pathname.endsWith('/capture')) {
          captureCalls++;
          order.status = 'COMPLETED';
          const unit = order.purchase_units[0] as { reference_id: string; amount: unknown };
          order.purchase_units = [
            {
              ...unit,
              payments: {
                captures: [{ id: `CAPTURE-${unit.reference_id}`, status: 'COMPLETED', amount: unit.amount }],
              },
            },
          ];
        }
        return result(order);
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const f of (await readdir('packages/db/migrations')).filter((f) => f.endsWith('.sql')).sort())
    for (const sql of (await readFile(`packages/db/migrations/${f}`, 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  const signup = await mf.dispatchFetch('http://localhost/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: JSON.stringify({ name: 'Bank tester', email: 'bank@test.example', password: secret }),
  });
  expect(signup.status, await signup.clone().text()).toBe(200);
  cookie = signup.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  userId = ((await signup.json()) as { user: { id: string } }).user.id;
  for (const statement of catalogStatements(userId, new Date().toISOString()))
    await db.prepare(statement).run();
  // A user-chosen display name must not grant the reserved Bank seller's fee exemption.
  merchantProvider = (
    await api<{ id: string }>('/providers', {
      name: 'Capora Bank',
      description: 'An independently registered dataset seller for integration tests.',
    })
  ).id;
  const dataset = await api<{ endpoint: string }>('/providers/datasets', {
    data: { answer: 'Actual independently uploaded dataset' },
  });
  merchantCapability = (
    await api<{ id: string }>('/providers/capabilities', {
      providerId: merchantProvider,
      name: 'Independent dataset',
      description: 'A user-created capability with independently owned provider proceeds.',
      type: 'dataset',
      category: 'Testing',
      priceCents: 10,
      pricingUnit: 'query',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
      endpoint: dataset.endpoint,
      expectedLatencyMs: 100,
    })
  ).id;
  agentA = (await api<{ id: string }>('/agents', { name: 'Bank buyer' })).id;
  agentB = (await api<{ id: string }>('/agents', { name: 'Bank investor' })).id;
  for (const id of [agentA, agentB])
    await api(
      `/agents/${id}/policy`,
      {
        dailyBudgetCents: 100000,
        autoApproveCents: 100000,
        maxTransactionCents: 100000,
        autonomousEnabled: true,
      },
      'PUT',
    );
}, 120000);
afterAll(async () => {
  await mf?.dispose();
  node?.kill();
});
describe('Bank vertical slices on a real isolated local EVM; PayPal is an explicit test double', () => {
  it('provisions distinct wallets, validates a $20 capture, mints exactly once and rejects cross-owner access', async () => {
    const a = await api<{ address: Address }>(`/bank/agents/${agentA}/provision`, {}),
      b = await api<{ address: Address }>(`/bank/agents/${agentB}/provision`, {});
    expect(a.address).not.toBe(b.address);
    const key = crypto.randomUUID();
    const topup = await api<{ id: string; state: string; tx_hash: string }>('/bank/topups', {
      agentId: agentA,
      amountCents: 2000,
      idempotencyKey: key,
    });
    expect(topup.state).toBe('available');
    expect(topup.tx_hash).toMatch(/^0x/);
    await Promise.all([
      api(`/bank/topups/${topup.id}/reconcile`, {}),
      api('/bank/topups', { agentId: agentA, amountCents: 2000, idempotencyKey: key }),
    ]);
    expect(
      await chain.readContract({
        address: deployment.token,
        abi: CaporaUSDAbi,
        functionName: 'balanceOf',
        args: [a.address],
      }),
    ).toBe(20000000n);
    expect(captureCalls).toBe(1);
    expect(ordersCreated).toBe(1);
    await expect(api(`/bank/agents/${agentA}/provision`, {}, 'POST', '')).rejects.toMatchObject({
      status: 401,
    });
    const event = {
      id: 'replayed-event',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { supplementary_data: { related_ids: { order_id: `ORDER-${topup.id}` } } },
    };
    for (let i = 0; i < 2; i++) {
      const r = await mf.dispatchFetch('http://localhost/api/bank/paypal/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'paypal-transmission-sig': 'valid-test-signature' },
        body: JSON.stringify(event),
      });
      expect(r.status, await r.text()).toBe(200);
    }
    expect(
      await chain.readContract({
        address: deployment.token,
        abi: CaporaUSDAbi,
        functionName: 'balanceOf',
        args: [a.address],
      }),
    ).toBe(20000000n);
  }, 30000);
  it('pays the full built-in purchase to the Bank revenue wallet exactly once without a marketplace fee', async () => {
    const input = { text: 'Actual Capora Bank escrow test' },
      q = await api<Quote>(`/agents/${agentA}/quotes`, { capability_id: 'document_fingerprint', input });
    expect(q.provider).toBe('Capora Bank');
    expect(q.escrowFeeBps).toBe(0);
    const purchase = await api<Purchase>(`/agents/${agentA}/purchases`, { quote_id: q.id });
    expect(purchase.status, JSON.stringify(purchase)).toBe('purchased');
    const a = await api<Invocation>(`/agents/${agentA}/invocations`, { purchase_id: purchase.id, input }),
      b = await api<Invocation>(`/agents/${agentA}/invocations`, { purchase_id: purchase.id, input });
    expect(a.id).toBe(b.id);
    expect(a.status).toBe('completed');
    const db = await mf.getD1Database('DB'),
      escrow = await db
        .prepare('SELECT * FROM bank_escrows WHERE purchase_id=?')
        .bind(purchase.id)
        .first<{ state: string; seller_account_id: string; fee_bps: number; fee_units: string }>();
    expect(escrow?.state).toBe('released');
    expect(escrow?.seller_account_id).toBe(`provider:${CAPORA_BANK_PROVIDER_ID}`);
    expect(escrow?.fee_bps).toBe(0);
    expect(escrow?.fee_units).toBe('0');
    const seller = await db
      .prepare('SELECT address FROM bank_accounts WHERE id=?')
      .bind(escrow!.seller_account_id)
      .first<{ address: Address }>();
    expect(
      await chain.readContract({
        address: deployment.token,
        abi: CaporaUSDAbi,
        functionName: 'balanceOf',
        args: [seller!.address],
      }),
    ).toBe(100000n);
    expect(
      await chain.readContract({
        address: deployment.token,
        abi: CaporaUSDAbi,
        functionName: 'balanceOf',
        args: [deployment.treasury],
      }),
    ).toBe(0n);
    expect(captureCalls).toBe(1);
  }, 30000);
  it('holds a user-created purchase in escrow and pays its provider net proceeds plus the treasury fee', async () => {
    const input = {},
      q = await api<Quote>(`/agents/${agentA}/quotes`, { capability_id: merchantCapability, input });
    expect(q.escrowFeeBps).toBe(250);
    const p = await api<Purchase>(`/agents/${agentA}/purchases`, { quote_id: q.id });
    expect(p.status).toBe('purchased');
    const db = await mf.getD1Database('DB'),
      seller = (await db
        .prepare('SELECT address FROM bank_accounts WHERE provider_id=?')
        .bind(merchantProvider)
        .first<{ address: Address }>())!;
    const balance = (address: Address) =>
      chain.readContract({
        address: deployment.token,
        abi: CaporaUSDAbi,
        functionName: 'balanceOf',
        args: [address],
      });
    expect(await balance(seller.address)).toBe(0n);
    expect(await balance(deployment.escrow)).toBe(100000n);
    const first = await api<Invocation>(`/agents/${agentA}/invocations`, { purchase_id: p.id, input });
    expect(first.status).toBe('completed');
    expect(first.result).toEqual({ answer: 'Actual independently uploaded dataset' });
    expect((await api<Invocation>(`/agents/${agentA}/invocations`, { purchase_id: p.id, input })).id).toBe(
      first.id,
    );
    expect(await balance(seller.address)).toBe(97500n);
    expect(await balance(deployment.treasury)).toBe(2500n);
    expect(await balance(deployment.escrow)).toBe(0n);
    const bank = (await db
      .prepare('SELECT address FROM bank_accounts WHERE provider_id=?')
      .bind(CAPORA_BANK_PROVIDER_ID)
      .first<{ address: Address }>())!;
    expect(await balance(bank.address)).toBe(100000n);
    expect(seller.address.toLowerCase()).not.toBe(bank.address.toLowerCase());
    expect(captureCalls).toBe(1);
  }, 30000);
  it('settles snapshotted fees on chain after a dashboard fee change and supports a zero fee', async () => {
    const db = await mf.getD1Database('DB'),
      env = { DB: db } as Env;
    const quote = () =>
      api<Quote>(`/agents/${agentA}/quotes`, { capability_id: merchantCapability, input: {} });
    const original = await quote();
    expect(original.escrowFeeBps).toBe(250);
    let settings = await saveMarketplaceFee(env, userId, { feeBps: 500, revision: 0 });
    try {
      const changed = await quote();
      expect(changed.escrowFeeBps).toBe(500);
      const seller = (await db
        .prepare('SELECT address FROM bank_accounts WHERE provider_id=?')
        .bind(merchantProvider)
        .first<{ address: Address }>())!;
      const balance = (address: Address) =>
        chain.readContract({
          address: deployment.token,
          abi: CaporaUSDAbi,
          functionName: 'balanceOf',
          args: [address],
        });
      for (const [q, fee] of [
        [original, 2500n],
        [changed, 5000n],
      ] as const) {
        const beforeSeller = await balance(seller.address),
          beforeTreasury = await balance(deployment.treasury);
        const p = await api<Purchase>(`/agents/${agentA}/purchases`, { quote_id: q.id });
        expect(p.status).toBe('purchased');
        expect(
          (await api<Invocation>(`/agents/${agentA}/invocations`, { purchase_id: p.id, input: {} })).status,
        ).toBe('completed');
        expect((await balance(seller.address)) - beforeSeller).toBe(100000n - fee);
        expect((await balance(deployment.treasury)) - beforeTreasury).toBe(fee);
      }
      settings = await saveMarketplaceFee(env, userId, { feeBps: 0, revision: settings.revision });
      const zero = await quote();
      expect(zero.escrowFeeBps).toBe(0);
      const beforeSeller = await balance(seller.address),
        beforeTreasury = await balance(deployment.treasury);
      const p = await api<Purchase>(`/agents/${agentA}/purchases`, { quote_id: zero.id });
      expect(
        (await api<Invocation>(`/agents/${agentA}/invocations`, { purchase_id: p.id, input: {} })).status,
      ).toBe('completed');
      expect((await balance(seller.address)) - beforeSeller).toBe(100000n);
      expect(await balance(deployment.treasury)).toBe(beforeTreasury);
    } finally {
      await saveMarketplaceFee(env, userId, { feeBps: 250, revision: settings.revision });
    }
  }, 30000);
  it('enforces recipient limits and routes owner policy changes through approval', async () => {
    const wallet = await api<{ address: Address }>(`/bank/agents/${agentB}/provision`, {});
    await expect(action(agentA, 'transfer', { to: wallet.address, amount: '1' })).rejects.toMatchObject({
      status: 403,
    });
    const policy = {
      destinations: [wallet.address],
      max_investment_cents: 50000,
      max_loan_cents: 50000,
      max_chit_cents: 50000,
    };
    const q = await api<Quote>(`/agents/${agentA}/quotes`, {
      capability_id: 'bank_set_spending_policy',
      input: policy,
    });
    expect(q.approvalRequired).toBe(true);
    const p = await api<Purchase>(`/agents/${agentA}/purchases`, { quote_id: q.id });
    expect(p.status).toBe('pending_approval');
    await api(`/approvals/${p.id}`, { approve: true });
    await api<Invocation>(`/agents/${agentA}/invocations`, { purchase_id: p.id, input: policy });
    // The queued approval executes before the subsequent read; wait for policy projection.
    for (let i = 0; i < 100; i++) {
      const db = await mf.getD1Database('DB');
      if (await db.prepare('SELECT agent_id FROM bank_policies WHERE agent_id=?').bind(agentA).first()) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await api(`/bank/agents/${agentB}/policy`, policy, 'PUT');
    await action(agentA, 'transfer', { to: wallet.address, amount: '10' });
    expect(
      await chain.readContract({
        address: deployment.token,
        abi: CaporaUSDAbi,
        functionName: 'balanceOf',
        args: [wallet.address],
      }),
    ).toBe(10000000n);
  }, 30000);
  it('creates a fund, issues shares, makes actual bounded test-token swaps, records NAV and redeems', async () => {
    const created = await action(
      agentA,
      'create_fund',
      {
        name: 'Bounded test fund',
        strategy: 'Buy a bounded controlled test-market position, then unwind.',
        management_fee_bps: 100,
        max_allocation_bps: 6000,
        max_trade: '2',
        daily_trade_limit: '10',
        daily_loss_bps: 100,
        daily_expense_limit: '0.2',
      },
      true,
    );
    const address = (created.result as { address: Address }).address;
    await action(agentB, 'invest', { address, amount: '5', min_shares: '4.9' });
    const shares = await chain.readContract({ address, abi: ManagedFundAbi, functionName: 'totalSupply' });
    expect(shares).toBe(5000000000000n);
    const deadline = Number((await chain.getBlock()).timestamp) + 300;
    await action(agentA, 'rebalance_fund', {
      address,
      buy: true,
      amount: '2',
      min_output: '0.99',
      deadline,
      explanation: 'Enter a policy-bounded test-token position',
    });
    const risk = await chain.readContract({
      address: deployment.riskToken,
      abi: CaporaUSDAbi,
      functionName: 'balanceOf',
      args: [address],
    });
    expect(risk).toBe(997000n);
    await action(agentA, 'rebalance_fund', {
      address,
      buy: false,
      amount: '0.997',
      min_output: '1.97',
      deadline,
      explanation: 'Unwind to make investor cUSD liquid',
    });
    await action(agentB, 'redeem', { address, shares: '5', min_assets: '4.98' });
    const db = await mf.getD1Database('DB');
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM bank_snapshots WHERE entity_address=?')
          .bind(address)
          .first<{ n: number }>()
      )?.n,
    ).toBe(4);
  }, 30000);
  it('funds lending liquidity, opens a collateral-backed obligation, repays and returns collateral', async () => {
    const wallet = await api<{ address: Address }>(`/bank/agents/${agentB}/provision`, {});
    await write(deployment.riskToken, CaporaUSDAbi, 'mintOnce', [
      chainKey('loan-collateral'),
      wallet.address,
      20000000n,
    ]);
    await action(agentA, 'supply_liquidity', { amount: '3', min_shares: '2.99' });
    const opened = await action(agentB, 'open_collateralized_loan', {
      collateral: '2',
      amount: '1',
      maturity: Number((await chain.getBlock()).timestamp) + 3600,
    });
    const loanId = (opened.result as { loanId: Hex }).loanId;
    expect(loanId).toMatch(/^0x/);
    await action(agentB, 'repay_loan', { loan_id: loanId, amount: '1.01' });
    await action(agentB, 'withdraw_collateral', { loan_id: loanId, amount: '2' });
    const details = await api<{ debtUnits: string }>(`/bank/agents/${agentB}/loan_details?loan_id=${loanId}`);
    expect(details.debtUnits).toBe('0');
  }, 30000);
  it('runs a complete public two-agent commit/reveal chit with highest-discount payout and no repeat winner', async () => {
    const a = await api<{ address: Address }>(`/bank/agents/${agentA}/provision`, {}),
      b = await api<{ address: Address }>(`/bank/agents/${agentB}/provision`, {});
    await write(deployment.riskToken, CaporaUSDAbi, 'mintOnce', [
      chainKey('chit-collateral-a'),
      a.address,
      20000000n,
    ]);
    const created = await action(
      agentA,
      'create_chit',
      {
        name: 'Public accelerated auction',
        members: 2,
        installment: '1',
        max_discount_bps: 4000,
        commission_bps: 100,
        contribution_seconds: 60,
        commit_seconds: 30,
        reveal_seconds: 30,
        grace_seconds: 30,
        join_deadline: Number((await chain.getBlock()).timestamp) + 3600,
      },
      true,
    );
    const address = (created.result as { address: Address }).address;
    await action(agentA, 'join_chit', { address, security: '2' });
    await action(agentB, 'join_chit', { address, security: '2' });
    await action(agentA, 'contribute', { address });
    await action(agentB, 'contribute', { address });
    const salt = chainKey('test-chit-salt');
    await action(agentA, 'place_chit_bid', { address, round: 1, phase: 'commit', discount: '0.2', salt });
    await action(agentB, 'place_chit_bid', { address, round: 1, phase: 'commit', discount: '0.3', salt });
    await advance(91);
    await action(agentA, 'place_chit_bid', { address, round: 1, phase: 'reveal', discount: '0.2', salt });
    await action(agentB, 'place_chit_bid', { address, round: 1, phase: 'reveal', discount: '0.3', salt });
    await advance(31);
    await action(agentA, 'finalize_chit', { address });
    const first = await chain.readContract({
      address,
      abi: PublicChitAbi,
      functionName: 'rounds',
      args: [1n],
    });
    expect(first[3].toLowerCase()).toBe(b.address.toLowerCase());
    expect(first[5]).toBe(1680000n);
    await action(agentA, 'contribute', { address });
    await action(agentB, 'contribute', { address });
    await advance(121);
    await action(agentA, 'finalize_chit', { address });
    expect(await chain.readContract({ address, abi: PublicChitAbi, functionName: 'completed' })).toBe(true);
    await action(agentA, 'claim_chit_payout', { address });
    await action(agentB, 'claim_chit_payout', { address });
    await action(agentA, 'exit_chit', { address });
    await action(agentB, 'exit_chit', { address });
    expect(
      await chain.readContract({
        address: deployment.token,
        abi: CaporaUSDAbi,
        functionName: 'balanceOf',
        args: [address],
      }),
    ).toBe(0n);
  }, 60000);
  it('composes earned provider income, a vault deposit and another external capability purchase', async () => {
    for (let i = 0; i < 2; i++) {
      const input = {},
        q = await api<Quote>(`/agents/${agentA}/quotes`, { capability_id: merchantCapability, input });
      const p = await api<Purchase>(`/agents/${agentA}/purchases`, { quote_id: q.id });
      await api(`/agents/${agentA}/invocations`, { purchase_id: p.id, input });
    }
    await action(agentB, 'claim_provider_earnings', {
      provider_id: merchantProvider,
      amount: '0.2925',
    });
    const db = await mf.getD1Database('DB'),
      fund = await db
        .prepare("SELECT address FROM bank_entities WHERE kind='fund' LIMIT 1")
        .first<{ address: Address }>();
    const expected = await chain.readContract({
      address: fund!.address,
      abi: ManagedFundAbi,
      functionName: 'previewDeposit',
      args: [100000n],
    });
    await action(agentB, 'invest', {
      address: fund!.address,
      amount: '0.1',
      min_shares: displayUnits((expected * 99n) / 100n, 12),
    });
    const input = { text: 'Income earned, some invested, remainder buys this capability' },
      q = await api<Quote>(`/agents/${agentB}/quotes`, { capability_id: 'document_fingerprint', input });
    const p = await api<Purchase>(`/agents/${agentB}/purchases`, { quote_id: q.id });
    expect(
      (await api<Invocation>(`/agents/${agentB}/invocations`, { purchase_id: p.id, input })).status,
    ).toBe('completed');
  }, 30000);
  it('funds a bounded AI-selected analytics purchase through the same marketplace escrow', async () => {
    const fund = (await (
      await mf.getD1Database('DB')
    )
      .prepare("SELECT address FROM bank_entities WHERE kind='fund' LIMIT 1")
      .first<{ address: Address }>())!;
    const expected = await chain.readContract({
      address: fund.address,
      abi: ManagedFundAbi,
      functionName: 'previewDeposit',
      args: [1000000n],
    });
    await action(agentA, 'invest', {
      address: fund.address,
      amount: '1',
      min_shares: displayUnits((expected * 99n) / 100n, 12),
    });
    await api(
      `/bank/funds/${fund.address}/strategy`,
      {
        enabled: true,
        intervalSeconds: 300,
        allowedCapabilities: ['document_fingerprint'],
        maxCallsPerDay: 2,
      },
      'PUT',
    );
    plannerProposal = {
      action: 'analytics',
      capabilityId: 'document_fingerprint',
      input: { text: 'Actual paid fund analytics input' },
      reason: 'Purchase a bounded source-content integrity check before trading.',
    };
    const report = await api<{ result: Invocation }>(`/bank/funds/${fund.address}/run`, {});
    expect(report.result.status).toBe('completed');
    expect(
      await chain.readContract({ address: fund.address, abi: ManagedFundAbi, functionName: 'expensesToday' }),
    ).toBe(100000n);
    const db = await mf.getD1Database('DB');
    expect(
      (
        await db
          .prepare('SELECT state,fund_address FROM bank_escrows WHERE purchase_id=?')
          .bind(report.result.purchaseId)
          .first<{ state: string; fund_address: string }>()
      )?.fund_address,
    ).toBe(fund.address);
    await expect(api(`/bank/funds/${fund.address}/run`, {})).rejects.toMatchObject({ status: 429 });
  }, 30000);
  it('refunds a known provider failure exactly once and keeps signed webhook failures from minting', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        `INSERT INTO capabilities(id,provider_id,name,description,type,category,price_cents,currency,pricing_unit,input_schema,output_schema,endpoint,expected_latency_ms,tags,created_at) VALUES('bank_test_failure',?,'Test provider failure','Isolated existing protected demo provider','api','Testing',10,'USD','query',?,?,'demo://datapulse_headcount',100,'[]',?)`,
      )
      .bind(
        merchantProvider,
        JSON.stringify({
          type: 'object',
          properties: { company: { type: 'string' }, demoFailure: { type: 'boolean' } },
          required: ['company'],
        }),
        JSON.stringify({ type: 'object' }),
        new Date().toISOString(),
      )
      .run();
    const input = { company: 'Failure test', demoFailure: true },
      q = await api<Quote>(`/agents/${agentA}/quotes`, { capability_id: 'bank_test_failure', input }),
      p = await api<Purchase>(`/agents/${agentA}/purchases`, { quote_id: q.id });
    const invocation = await api<Invocation>(`/agents/${agentA}/invocations`, { purchase_id: p.id, input });
    expect(invocation.status).toBe('failed');
    expect((await api<Purchase>(`/agents/${agentA}/purchases/${p.id}`)).status).toBe('refunded');
    expect(
      (
        await db
          .prepare('SELECT state FROM bank_escrows WHERE purchase_id=?')
          .bind(p.id)
          .first<{ state: string }>()
      )?.state,
    ).toBe('refunded');
    const forged = await mf.dispatchFetch('http://localhost/api/bank/paypal/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paypal-transmission-sig': 'invalid' },
      body: JSON.stringify({ id: 'forged', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }),
    });
    expect(forged.status).toBe(401);
  }, 30000);
  it('indexes canonical escrow expiry refunds and wallet cash flows without duplicate events', async () => {
    const input = { text: 'Never invoked: eligible timeout refund' };
    const q = await api<Quote>(`/agents/${agentA}/quotes`, { capability_id: 'document_fingerprint', input });
    const p = await api<Purchase>(`/agents/${agentA}/purchases`, { quote_id: q.id });
    expect(p.status).toBe('purchased');
    await advance(3700);
    await write(deployment.escrow, PurchaseEscrowAbi, 'refund', [chainKey(`purchase:${p.id}`)]);
    await api('/bank/reconcile', {});
    expect((await api<Purchase>(`/agents/${agentA}/purchases/${p.id}`)).status).toBe('refunded');
    const db = await mf.getD1Database('DB'),
      count = await db
        .prepare("SELECT COUNT(*) AS n FROM bank_events WHERE source='chain'")
        .first<{ n: number }>();
    expect(count!.n).toBeGreaterThan(0);
    await api('/bank/reconcile', {});
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM bank_events WHERE source='chain'").first<{ n: number }>())!
        .n,
    ).toBe(count!.n);
    const overview = await api<{
      configured: boolean;
      cashflow: { receivedUnits: string; sentUnits: string };
      accounts: { balance: string | null }[];
    }>('/bank');
    expect(overview.configured).toBe(true);
    expect(BigInt(overview.cashflow.receivedUnits)).toBeGreaterThan(0n);
    expect(BigInt(overview.cashflow.sentUnits)).toBeGreaterThan(0n);
    expect(overview.accounts.filter((a) => a.balance !== null).length).toBeGreaterThanOrEqual(3);
  }, 30000);
});
