import { PublicChitAbi } from '@capora/bank/abis';
import { encodeFunctionData, type Address } from 'viem';
import { configuration, assertChain } from './config';
import { transaction, type BankTransaction } from './chain';
import { reconcileTopUp, type TopUp } from './topups';
import { resolveEscrow, expireEscrow } from './escrow';
import type { Env } from '../env';
async function safely(action: () => Promise<unknown>) {
  try {
    await action();
  } catch {
    /* Durable intents retain safe retry or manual-review status. */
  }
}
export async function bankKeeper(env: Env) {
  if (env.BANK_ENABLED !== 'true') return;
  configuration(env);
  await safely(async () => {
    const { indexBankEvents } = await import('./indexer');
    return indexBankEvents(env);
  });
  const pending = await env.DB.prepare(
    "SELECT * FROM bank_transactions WHERE state='pending' AND tx_hash IS NOT NULL ORDER BY updated_at LIMIT 20",
  ).all<BankTransaction>();
  for (const tx of pending.results)
    await safely(() => transaction(env, tx.id, tx.purpose, tx.target, tx.calldata, tx.account_id));
  const topups = await env.DB.prepare(
    "SELECT * FROM bank_topups WHERE state IN ('created','awaiting_approval','mint_pending') ORDER BY updated_at LIMIT 10",
  ).all<TopUp>();
  for (const topup of topups.results) await safely(() => reconcileTopUp(env, topup));
  const escrows = await env.DB.prepare(
    "SELECT purchase_id,state,result_hash FROM bank_escrows WHERE state IN ('fulfilled','failed','manual_review_pending') LIMIT 20",
  ).all<{ purchase_id: string; state: string; result_hash: `0x${string}` | null }>();
  for (const escrow of escrows.results)
    await safely(() =>
      resolveEscrow(
        env,
        escrow.purchase_id,
        escrow.state === 'fulfilled' ? 'fulfilled' : escrow.state === 'failed' ? 'failed' : 'manual_review',
        escrow.result_hash ?? undefined,
      ),
    );
  const expired = await env.DB.prepare(
    "SELECT purchase_id FROM bank_escrows WHERE state='escrow_funded' AND deadline<? LIMIT 20",
  )
    .bind(Math.floor(Date.now() / 1000))
    .all<{ purchase_id: string }>();
  for (const e of expired.results) await safely(() => expireEscrow(env, e.purchase_id));
  const queued = await env.DB.prepare(
    "SELECT id FROM invocations WHERE status='queued' ORDER BY created_at LIMIT 20",
  ).all<{ id: string }>();
  if (queued.results.length)
    await env.INVOCATION_QUEUE.sendBatch(
      queued.results.map((i) => ({ body: { invocationId: i.id, jobId: `recover:${i.id}` } })),
    );
  const chits = await env.DB.prepare("SELECT address FROM bank_entities WHERE kind='chit' LIMIT 24").all<{
    address: Address;
  }>();
  const client = await assertChain(env);
  for (const chit of chits.results)
    await safely(async () => {
      const [round, complete, canceled, deadline] = await Promise.all([
        client.readContract({ address: chit.address, abi: PublicChitAbi, functionName: 'currentRound' }),
        client.readContract({ address: chit.address, abi: PublicChitAbi, functionName: 'completed' }),
        client.readContract({ address: chit.address, abi: PublicChitAbi, functionName: 'canceled' }),
        client.readContract({ address: chit.address, abi: PublicChitAbi, functionName: 'revealDeadline' }),
      ]);
      if (!complete && !canceled && round > 0 && BigInt(Math.floor(Date.now() / 1000)) > deadline) {
        // Simulate first: default/security shortfalls leave the round paused without spending gas.
        const data = encodeFunctionData({ abi: PublicChitAbi, functionName: 'finalize' });
        await client.call({ to: chit.address, data });
        await transaction(
          env,
          `keeper:chit:${chit.address}:${round}`,
          'permissionless_chit_finalization',
          chit.address,
          data,
        );
      }
    });
  const strategies = await env.DB.prepare(
    'SELECT fund_address FROM bank_strategy_schedules WHERE enabled=1 AND next_run_at<=? LIMIT 3',
  )
    .bind(Date.now())
    .all<{ fund_address: Address }>();
  for (const strategy of strategies.results)
    await safely(async () => {
      const { runStrategy } = await import('./strategy');
      return runStrategy(env, strategy.fund_address);
    });
  // Audit recent finalized projections against canonical blocks; never silently accept a reorg.
  const recent = await env.DB.prepare(
    "SELECT id,block_number,block_hash FROM bank_transactions WHERE state='confirmed' ORDER BY updated_at DESC LIMIT 20",
  ).all<{ id: string; block_number: string; block_hash: string }>();
  for (const tx of recent.results)
    await safely(async () => {
      const block = await client.getBlock({ blockNumber: BigInt(tx.block_number) });
      if (block.hash !== tx.block_hash)
        await env.DB.prepare(
          "UPDATE bank_transactions SET state='manual_review',error='Canonical block changed after confirmation. Reconcile on-chain events before recovery.' WHERE id=?",
        )
          .bind(tx.id)
          .run();
    });
}
