import { encodeFunctionData, type Hex } from 'viem';
import { PurchaseEscrowAbi, CaporaUSDAbi, ManagedFundAbi } from '@capora/bank/abis';
import { centsToUnits } from '@capora/bank';
import { DomainError } from '@capora/types';
import { configuration, assertChain } from './config';
import { providerFeeBps } from '../services/marketplace-fees';
import { ensureAccount } from './accounts';
import { chainKey, walletTransaction, transaction, requireConfirmed } from './chain';
import type { Env } from '../env';
interface Escrow {
  purchase_id: string;
  escrow_key: Hex;
  buyer_account_id: string;
  seller_account_id: string;
  amount_units: string;
  fee_bps: number;
  deadline: number;
  state: string;
  result_hash: Hex | null;
}
export async function fundPurchase(
  env: Env,
  purchaseId: string,
  agentId: string,
  providerId: string,
  amountCents: number,
) {
  const cfg = configuration(env);
  const amount = centsToUnits(amountCents),
    now = new Date().toISOString(),
    key = chainKey(`purchase:${purchaseId}`);
  const quote = await env.DB.prepare(
    'SELECT q.escrow_fee_bps,q.capability_version,c.version FROM purchases p JOIN quotes q ON q.id=p.quote_id JOIN capabilities c ON c.id=p.capability_id WHERE p.id=?',
  )
    .bind(purchaseId)
    .first<{ escrow_fee_bps: number | null; capability_version: number; version: number }>();
  const existing = await env.DB.prepare('SELECT purchase_id FROM bank_escrows WHERE purchase_id=?')
    .bind(purchaseId)
    .first();
  if (!existing && quote && quote.capability_version !== quote.version)
    throw new DomainError('QUOTE_STALE', 'Capability changed after quoting. Request a new quote.', 409);
  const buyer = await ensureAccount(env, 'agent', agentId),
    seller = await ensureAccount(env, 'provider', providerId);
  const fee = quote?.escrow_fee_bps ?? (await providerFeeBps(env, providerId));
  // Serialize the version/owner check with the escrow intent. Catalog migration sees this
  // unresolved intent and defers ownership; if migration won the race, no funds can be sent.
  await env.DB.prepare(
    `INSERT INTO bank_escrows(purchase_id,buyer_account_id,seller_account_id,escrow_key,amount_units,fee_bps,fee_units,deadline,state,updated_at)
     SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS
       (SELECT 1 FROM purchases p JOIN quotes q ON q.id=p.quote_id JOIN capabilities c ON c.id=p.capability_id
        WHERE p.id=? AND c.version=q.capability_version AND c.provider_id=?)
     ON CONFLICT(purchase_id) DO NOTHING`,
  )
    .bind(
      purchaseId,
      buyer.id,
      seller.id,
      key,
      amount.toString(),
      fee,
      ((amount * BigInt(fee)) / 10000n).toString(),
      Math.floor(Date.now() / 1000) + 3600,
      'approved',
      now,
      purchaseId,
      providerId,
    )
    .run();
  const row = await env.DB.prepare('SELECT * FROM bank_escrows WHERE purchase_id=?')
    .bind(purchaseId)
    .first<Escrow>();
  if (!row)
    throw new DomainError('QUOTE_STALE', 'Capability changed after quoting. Request a new quote.', 409);
  if (row.state === 'escrow_funded') return;
  if (Math.floor(Date.now() / 1000) >= row.deadline)
    throw new DomainError('ESCROW_EXPIRED', 'Escrow funding deadline expired. Request a new quote.', 409);
  const expense = await env.DB.prepare(
    'SELECT e.fund_address FROM bank_fund_expenses e JOIN purchases p ON p.quote_id=e.quote_id WHERE p.id=? AND e.agent_id=?',
  )
    .bind(purchaseId, agentId)
    .first<{ fund_address: `0x${string}` }>();
  let tx;
  if (expense) {
    const { entityRecord } = await import('./read');
    await entityRecord(env, expense.fund_address, 'fund');
    tx = requireConfirmed(
      await walletTransaction(
        env,
        `escrow:${purchaseId}:fund`,
        'fund_intelligence_expense',
        buyer,
        expense.fund_address,
        encodeFunctionData({
          abi: ManagedFundAbi,
          functionName: 'buyIntelligence',
          args: [row.escrow_key, seller.address, amount, BigInt(row.deadline), row.fee_bps],
        }),
      ),
    );
  } else {
    requireConfirmed(
      await walletTransaction(
        env,
        `escrow:${purchaseId}:approve`,
        'escrow_token_approval',
        buyer,
        cfg.token,
        encodeFunctionData({ abi: CaporaUSDAbi, functionName: 'approve', args: [cfg.escrow, amount] }),
      ),
    );
    tx = requireConfirmed(
      await walletTransaction(
        env,
        `escrow:${purchaseId}:fund`,
        'escrow_funding',
        buyer,
        cfg.escrow,
        encodeFunctionData({
          abi: PurchaseEscrowAbi,
          functionName: 'fund',
          args: [row.escrow_key, seller.address, amount, BigInt(row.deadline), row.fee_bps],
        }),
      ),
    );
  }
  const c = await assertChain(env),
    onchain = await c.readContract({
      address: cfg.escrow,
      abi: PurchaseEscrowAbi,
      functionName: 'purchases',
      args: [row.escrow_key],
    });
  if (
    onchain[5] !== 1 ||
    onchain[0].toLowerCase() !== (expense?.fund_address ?? buyer.address).toLowerCase() ||
    onchain[1].toLowerCase() !== seller.address.toLowerCase() ||
    onchain[2] !== amount
  )
    throw new DomainError('ESCROW_MISMATCH', 'Confirmed escrow does not match the purchase.', 409);
  await env.DB.prepare(
    "UPDATE bank_escrows SET state='escrow_funded',funding_tx=?,fund_address=?,updated_at=? WHERE purchase_id=?",
  )
    .bind(tx.tx_hash, expense?.fund_address ?? null, new Date().toISOString(), purchaseId)
    .run();
}
export async function startEscrow(env: Env, purchaseId: string, invocationId: string) {
  const row = await env.DB.prepare('SELECT * FROM bank_escrows WHERE purchase_id=?')
    .bind(purchaseId)
    .first<Escrow>();
  if (!row) return;
  const cfg = configuration(env);
  requireConfirmed(
    await transaction(
      env,
      `escrow:${purchaseId}:start`,
      'escrow_execution_attestation',
      cfg.escrow,
      encodeFunctionData({ abi: PurchaseEscrowAbi, functionName: 'start', args: [row.escrow_key] }),
      row.buyer_account_id,
    ),
  );
  await env.DB.prepare(
    "UPDATE bank_escrows SET state='executing',invocation_id=?,updated_at=? WHERE purchase_id=?",
  )
    .bind(invocationId, new Date().toISOString(), purchaseId)
    .run();
}
export async function resolveEscrow(
  env: Env,
  purchaseId: string,
  outcome: 'fulfilled' | 'failed' | 'manual_review',
  resultHash?: Hex,
) {
  const row = await env.DB.prepare('SELECT * FROM bank_escrows WHERE purchase_id=?')
    .bind(purchaseId)
    .first<Escrow>();
  if (!row || ['released', 'refunded', 'manual_review'].includes(row.state)) return;
  const cfg = configuration(env);
  await env.DB.prepare('UPDATE bank_escrows SET state=?,result_hash=?,updated_at=? WHERE purchase_id=?')
    .bind(
      outcome === 'manual_review' ? 'manual_review_pending' : outcome,
      resultHash ?? null,
      new Date().toISOString(),
      purchaseId,
    )
    .run();
  const functionName = outcome === 'fulfilled' ? 'release' : outcome === 'failed' ? 'refund' : 'dispute';
  const data =
    functionName === 'release'
      ? encodeFunctionData({ abi: PurchaseEscrowAbi, functionName, args: [row.escrow_key, resultHash!] })
      : encodeFunctionData({ abi: PurchaseEscrowAbi, functionName, args: [row.escrow_key] });
  const tx = await transaction(
    env,
    `escrow:${purchaseId}:${functionName}`,
    `escrow_${functionName}`,
    cfg.escrow,
    data,
    row.buyer_account_id,
  );
  if (tx.state === 'confirmed') {
    const state = outcome === 'fulfilled' ? 'released' : outcome === 'failed' ? 'refunded' : 'manual_review';
    await env.DB.batch([
      env.DB.prepare('UPDATE bank_escrows SET state=?,resolution_tx=?,updated_at=? WHERE purchase_id=?').bind(
        state,
        tx.tx_hash,
        new Date().toISOString(),
        purchaseId,
      ),
      env.DB.prepare('UPDATE transactions SET status=?,type=?,updated_at=? WHERE purchase_id=?').bind(
        state,
        'cusd_escrow',
        new Date().toISOString(),
        purchaseId,
      ),
      ...(state === 'refunded'
        ? [
            env.DB.prepare("UPDATE purchases SET status='refunded',updated_at=? WHERE id=?").bind(
              new Date().toISOString(),
              purchaseId,
            ),
          ]
        : []),
    ]);
  }
}
export async function expireEscrow(env: Env, purchaseId: string) {
  const row = await env.DB.prepare('SELECT * FROM bank_escrows WHERE purchase_id=?')
    .bind(purchaseId)
    .first<Escrow>();
  if (!row || row.state !== 'escrow_funded') return;
  const started = await env.DB.prepare('SELECT id FROM invocations WHERE purchase_id=?')
    .bind(purchaseId)
    .first();
  if (started) return;
  const cfg = configuration(env),
    tx = await transaction(
      env,
      `escrow:${purchaseId}:expire`,
      'expired_escrow_refund',
      cfg.escrow,
      encodeFunctionData({ abi: PurchaseEscrowAbi, functionName: 'refund', args: [row.escrow_key] }),
      row.buyer_account_id,
    );
  if (tx.state === 'confirmed')
    await env.DB.batch([
      env.DB.prepare("UPDATE bank_escrows SET state='refunded',resolution_tx=? WHERE purchase_id=?").bind(
        tx.tx_hash,
        purchaseId,
      ),
      env.DB.prepare(
        "UPDATE purchases SET status='refunded',error='Uninvoked escrow expired and was refunded.' WHERE id=?",
      ).bind(purchaseId),
    ]);
}
export async function merchantEarnings(env: Env, userId: string) {
  return (
    await env.DB.prepare(
      `SELECT p.id,p.amount_cents,e.amount_units,e.fee_units,e.state,e.funding_tx,e.resolution_tx,e.invocation_id,s.address AS seller_wallet,c.name AS capability FROM bank_escrows e JOIN purchases p ON p.id=e.purchase_id JOIN capabilities c ON c.id=p.capability_id JOIN providers v ON v.id=c.provider_id JOIN bank_accounts s ON s.id=e.seller_account_id WHERE v.user_id=? ORDER BY p.created_at DESC LIMIT 100`,
    )
      .bind(userId)
      .all()
  ).results;
}
