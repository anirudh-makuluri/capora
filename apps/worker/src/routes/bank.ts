import { Hono } from 'hono';
import { z } from 'zod';
import { SIMULATED_FUNDS } from '@capora/bank';
import { DomainError } from '@capora/types';
import { ownAgent, rateLimit } from '../services/auth';
import { configuration } from '../bank/config';
import { ensureAccount, balance, accountIntent, type BankAccount } from '../bank/accounts';
import { createTopUp, ownedTopUp, reconcileTopUp, paypalWebhook } from '../bank/topups';
import { bankRead } from '../bank/read';
import { merchantEarnings } from '../bank/escrow';
import { bankKeeper } from '../bank/keeper';
import { audit } from '../lib/audit';
import { scheduleSchema, configureStrategy, runStrategy } from '../bank/strategy';
import { entityRecord } from '../bank/read';
import { isAddress, type Address } from 'viem';
import { assertChain } from '../bank/config';
import { transaction, type BankTransaction } from '../bank/chain';
import type { AppEnv } from '../env';
export const publicBankRoutes = new Hono<AppEnv>();
publicBankRoutes.post('/paypal/webhook', async (c) =>
  c.json(await paypalWebhook(c.env, c.req.raw.headers, await c.req.json())),
);
export const bankRoutes = new Hono<AppEnv>();
bankRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const agents = (
    await c.env.DB.prepare('SELECT id FROM agents WHERE user_id=?').bind(userId).all<{ id: string }>()
  ).results;
  const providers = (
    await c.env.DB.prepare('SELECT id FROM providers WHERE user_id=?').bind(userId).all<{ id: string }>()
  ).results;
  for (const agent of agents) await accountIntent(c.env, 'agent', agent.id);
  for (const provider of providers) await accountIntent(c.env, 'provider', provider.id);
  let configured = false,
    configurationError: string | null = null,
    contracts: unknown = null;
  try {
    const cfg = configuration(c.env);
    contracts = { ...cfg, rpc: undefined };
    configured = true;
  } catch (e) {
    configurationError = e instanceof DomainError ? e.message : 'Bank configuration is invalid.';
  }
  const accounts = await c.env.DB.prepare('SELECT * FROM bank_accounts WHERE user_id=?')
    .bind(userId)
    .all<BankAccount>();
  const balances = await Promise.all(
    accounts.results.map(async (a) => {
      if (!configured) return { ...a, balance: null };
      try {
        return await balance(c.env, a);
      } catch (e) {
        return {
          ...a,
          balance: null,
          error: e instanceof DomainError ? e.message : 'Balance could not be read from the chain.',
        };
      }
    }),
  );
  const [transactions, topups, entities, positions, policies, earnings] = await Promise.all([
    c.env.DB.prepare(
      'SELECT t.id,t.account_id,t.purpose,t.state,t.tx_hash,t.error,t.created_at FROM bank_transactions t JOIN bank_accounts a ON a.id=t.account_id WHERE a.user_id=? ORDER BY t.created_at DESC LIMIT 100',
    )
      .bind(userId)
      .all(),
    c.env.DB.prepare('SELECT * FROM bank_topups WHERE user_id=? ORDER BY created_at DESC LIMIT 30')
      .bind(userId)
      .all(),
    c.env.DB.prepare('SELECT * FROM bank_entities ORDER BY created_at DESC LIMIT 100').all(),
    c.env.DB.prepare('SELECT p.* FROM bank_positions p JOIN agents a ON a.id=p.agent_id WHERE a.user_id=?')
      .bind(userId)
      .all(),
    c.env.DB.prepare('SELECT p.* FROM bank_policies p JOIN agents a ON a.id=p.agent_id WHERE a.user_id=?')
      .bind(userId)
      .all(),
    merchantEarnings(c.env, userId),
  ]);
  let cashflow: { receivedUnits: string; sentUnits: string; indexedAt: string | null } | null = null;
  if (configured) {
    const cfg = configuration(c.env),
      owned = new Set(accounts.results.filter((a) => a.address).map((a) => a.address.toLowerCase()));
    const events = await c.env.DB.prepare(
      "SELECT data,created_at FROM bank_events WHERE source='chain' ORDER BY created_at DESC LIMIT 1000",
    ).all<{ data: string; created_at: string }>();
    let received = 0n,
      sent = 0n;
    for (const event of events.results) {
      const log = JSON.parse(event.data) as {
        address: string;
        eventName?: string;
        args?: { from?: string; to?: string; value?: string };
      };
      if (
        log.address.toLowerCase() !== cfg.token.toLowerCase() ||
        log.eventName !== 'Transfer' ||
        !log.args?.value
      )
        continue;
      const from = owned.has(log.args.from?.toLowerCase() ?? ''),
        to = owned.has(log.args.to?.toLowerCase() ?? '');
      if (to && !from) received += BigInt(log.args.value);
      if (from && !to) sent += BigInt(log.args.value);
    }
    cashflow = {
      receivedUnits: received.toString(),
      sentUnits: sent.toString(),
      indexedAt: events.results[0]?.created_at ?? null,
    };
  }
  return c.json({
    configured,
    configurationError,
    contracts,
    disclaimer: SIMULATED_FUNDS,
    accounts: balances,
    transactions: transactions.results,
    topups: topups.results,
    entities: entities.results,
    positions: positions.results,
    policies: policies.results,
    earnings,
    cashflow,
  });
});
bankRoutes.post('/agents/:id/provision', async (c) => {
  await ownAgent(c.env, c.req.param('id'), c.get('userId'));
  await rateLimit(c.env, `bank-wallet:${c.get('userId')}`, 20);
  return c.json(await ensureAccount(c.env, 'agent', c.req.param('id')));
});
bankRoutes.get('/agents/:id/:view', async (c) => {
  await ownAgent(c.env, c.req.param('id'), c.get('userId'));
  const view = z
    .enum([
      'fund_details',
      'fund_performance',
      'chit_status',
      'list_loans',
      'loan_details',
      'get_balance',
      'get_treasury_summary',
      'quote_loan',
    ])
    .parse(c.req.param('view'));
  return c.json(await bankRead(c.env, c.req.param('id'), view, c.req.query()));
});
bankRoutes.put('/agents/:id/policy', async (c) => {
  await ownAgent(c.env, c.req.param('id'), c.get('userId'));
  const { bankSchemas } = await import('../bank/capabilities');
  const input = bankSchemas.set_spending_policy.parse(await c.req.json());
  await c.env.DB.prepare(
    'INSERT INTO bank_policies(agent_id,destinations,max_investment_cents,max_loan_cents,max_chit_cents,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET destinations=excluded.destinations,max_investment_cents=excluded.max_investment_cents,max_loan_cents=excluded.max_loan_cents,max_chit_cents=excluded.max_chit_cents,updated_at=excluded.updated_at',
  )
    .bind(
      c.req.param('id'),
      JSON.stringify(input.destinations),
      input.max_investment_cents,
      input.max_loan_cents,
      input.max_chit_cents,
      new Date().toISOString(),
    )
    .run();
  await audit(
    c.env,
    c.get('userId'),
    'bank_policy_updated',
    'Owner updated financial limits and allowed recipients',
    c.req.param('id'),
  );
  return c.json({ policy: input });
});
bankRoutes.post('/topups', async (c) => {
  await rateLimit(c.env, `bank-topup:${c.get('userId')}`, 20);
  const input = z
    .object({
      agentId: z.string(),
      amountCents: z.number().int(),
      idempotencyKey: z.string().min(8).max(100),
    })
    .strict()
    .parse(await c.req.json());
  return c.json(
    await createTopUp(c.env, c.get('userId'), input.agentId, input.amountCents, input.idempotencyKey),
  );
});
bankRoutes.post('/topups/:id/reconcile', async (c) =>
  c.json(await reconcileTopUp(c.env, await ownedTopUp(c.env, c.get('userId'), c.req.param('id')))),
);
bankRoutes.post('/reconcile', async (c) => {
  await rateLimit(c.env, `bank-keeper:${c.get('userId')}`, 6);
  await bankKeeper(c.env);
  return c.json({ reconciled: true });
});
bankRoutes.put('/funds/:address/strategy', async (c) => {
  const address = z.string().refine(isAddress).parse(c.req.param('address')) as Address;
  return c.json(
    await configureStrategy(c.env, c.get('userId'), address, scheduleSchema.parse(await c.req.json())),
  );
});
bankRoutes.post('/funds/:address/run', async (c) => {
  const address = z.string().refine(isAddress).parse(c.req.param('address')) as Address,
    entity = await entityRecord(c.env, address, 'fund');
  await ownAgent(c.env, entity.creator_agent_id, c.get('userId'));
  return c.json(await runStrategy(c.env, address));
});
bankRoutes.post('/transactions/:id/recover', async (c) => {
  const { txHash } = z
    .object({ txHash: z.string().regex(/^0x[\da-fA-F]{64}$/) })
    .strict()
    .parse(await c.req.json());
  const row = await c.env.DB.prepare(
    'SELECT t.* FROM bank_transactions t JOIN bank_accounts a ON a.id=t.account_id WHERE t.id=? AND a.user_id=?',
  )
    .bind(c.req.param('id'), c.get('userId'))
    .first<BankTransaction>();
  if (!row) throw new DomainError('NOT_FOUND', 'Owned transaction intent not found.', 404);
  const client = await assertChain(c.env),
    cfg = configuration(c.env),
    chainTx = await client.getTransaction({ hash: txHash as `0x${string}` });
  if (
    chainTx.from.toLowerCase() !== cfg.executor.toLowerCase() ||
    chainTx.to?.toLowerCase() !== row.target.toLowerCase() ||
    chainTx.input !== row.calldata ||
    chainTx.value !== 0n
  )
    throw new DomainError(
      'TRANSACTION_MISMATCH',
      'The chain transaction does not match the recorded signing intent.',
      409,
    );
  await c.env.DB.prepare(
    "UPDATE bank_transactions SET state='pending',tx_hash=?,error=NULL WHERE id=? AND state<>'confirmed'",
  )
    .bind(txHash, row.id)
    .run();
  await audit(
    c.env,
    c.get('userId'),
    'bank_transaction_recovered',
    'Owner supplied a chain-verified hash matching the original intent',
    row.id,
  );
  const recovered = await transaction(c.env, row.id, row.purpose, row.target, row.calldata, row.account_id);
  const invocationId = /^bank:(inv_[^:]+)/.exec(row.id)?.[1];
  if (invocationId && recovered.state === 'confirmed')
    await c.env.DB.prepare(
      "UPDATE invocations SET status='queued',error=NULL,completed_at=NULL WHERE id=? AND status='failed' AND agent_id IN (SELECT id FROM agents WHERE user_id=?) AND capability_id IN (SELECT id FROM capabilities WHERE endpoint LIKE 'bank://%')",
    )
      .bind(invocationId, c.get('userId'))
      .run();
  return c.json(recovered);
});
