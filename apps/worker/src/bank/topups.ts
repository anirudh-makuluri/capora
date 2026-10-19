import { encodeFunctionData } from 'viem';
import { CaporaUSDAbi } from '@capora/bank/abis';
import { centsToUnits } from '@capora/bank';
import { DomainError } from '@capora/types';
import { PayPalSandbox, receiptFromOrder } from '../services/payments';
import { ensureAccount } from './accounts';
import { configuration, assertChain } from './config';
import { chainKey, transaction } from './chain';
import { audit } from '../lib/audit';
import type { Env } from '../env';
export interface TopUp {
  id: string;
  account_id: string;
  user_id: string;
  amount_cents: number;
  order_id: string | null;
  capture_id: string | null;
  state: string;
  approval_url: string | null;
  mint_intent: `0x${string}`;
  tx_hash: string | null;
  error: string | null;
  created_at: string;
}
export async function createTopUp(
  env: Env,
  userId: string,
  agentId: string,
  amountCents: number,
  key: string,
) {
  const owner = await env.DB.prepare("SELECT id FROM agents WHERE id=? AND user_id=? AND status='active'")
    .bind(agentId, userId)
    .first();
  if (!owner) throw new DomainError('NOT_FOUND', 'Active agent not found in your workspace.', 404);
  if (!Number.isSafeInteger(amountCents) || amountCents < 100 || amountCents > 100000)
    throw new DomainError('INVALID_AMOUNT', 'Sandbox top-ups must be between $1 and $1,000.');
  const account = await ensureAccount(env, 'agent', agentId),
    now = new Date().toISOString();
  const topupId = `topup_${chainKey(`${userId}:${key}`).slice(2)}`;
  await env.DB.prepare(
    'INSERT INTO bank_topups(id,account_id,user_id,amount_cents,state,mint_intent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(topupId, account.id, userId, amountCents, 'created', chainKey(topupId), now, now)
    .run();
  const row = await ownedTopUp(env, userId, topupId);
  if (row.account_id !== account.id || row.amount_cents !== amountCents)
    throw new DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Top-up key already used for another amount or wallet.',
      409,
    );
  return reconcileTopUp(env, row);
}
export async function ownedTopUp(env: Env, userId: string, topupId: string) {
  const row = await env.DB.prepare('SELECT * FROM bank_topups WHERE id=? AND user_id=?')
    .bind(topupId, userId)
    .first<TopUp>();
  if (!row) throw new DomainError('NOT_FOUND', 'Top-up not found.', 404);
  return row;
}
export async function reconcileTopUp(env: Env, topup: TopUp): Promise<TopUp> {
  if (['available', 'manual_review', 'reversed'].includes(topup.state)) return topup;
  const paypal = new PayPalSandbox(env),
    cfg = configuration(env);
  const read = () => ownedTopUp(env, topup.user_id, topup.id);
  try {
    if (!topup.capture_id) {
      if (!topup.order_id && Date.now() - Date.parse(topup.created_at) > 5 * 60 * 60 * 1000)
        throw new DomainError(
          'TOPUP_MANUAL_REVIEW',
          'An old PayPal create request requires manual reconciliation.',
          409,
        );
      let order = topup.order_id
        ? await paypal.getOrder(topup.order_id)
        : await paypal.createOrder(topup.id, topup.amount_cents, null, true);
      await env.DB.prepare('UPDATE bank_topups SET order_id=?,updated_at=? WHERE id=?')
        .bind(order.id, new Date().toISOString(), topup.id)
        .run();
      if (order.status === 'APPROVED') order = await paypal.captureOrder(order.id, topup.id);
      const receipt = receiptFromOrder(order, topup.id, topup.amount_cents);
      if (receipt.status !== 'completed') {
        await env.DB.prepare(
          "UPDATE bank_topups SET state='awaiting_approval',approval_url=?,updated_at=? WHERE id=?",
        )
          .bind(receipt.approvalUrl, new Date().toISOString(), topup.id)
          .run();
        return read();
      }
      await env.DB.prepare(
        "UPDATE bank_topups SET capture_id=?,state='mint_pending',approval_url=NULL,error=NULL,updated_at=? WHERE id=? AND (capture_id IS NULL OR capture_id=?)",
      )
        .bind(receipt.captureId, new Date().toISOString(), topup.id, receipt.captureId)
        .run();
      topup = await read();
    }
    const account = await env.DB.prepare('SELECT address FROM bank_accounts WHERE id=?')
      .bind(topup.account_id)
      .first<{ address: `0x${string}` }>();
    if (!account) throw new DomainError('ACCOUNT_REQUIRED', 'Top-up wallet is unavailable.', 409);
    const tx = await transaction(
      env,
      `mint:${topup.id}`,
      'verified_paypal_mint',
      cfg.token,
      encodeFunctionData({
        abi: CaporaUSDAbi,
        functionName: 'mintOnce',
        args: [topup.mint_intent, account.address, centsToUnits(topup.amount_cents)],
      }),
      topup.account_id,
    );
    if (tx.state === 'confirmed') {
      const client = await assertChain(env);
      const commitment = await client.readContract({
        address: cfg.token,
        abi: CaporaUSDAbi,
        functionName: 'mintIntents',
        args: [topup.mint_intent],
      });
      // Receipt, canonical block and replay-safe token commitment must all exist before availability.
      const { keccak256, encodeAbiParameters } = await import('viem');
      if (
        commitment !==
        keccak256(
          encodeAbiParameters(
            [{ type: 'address' }, { type: 'uint256' }],
            [account.address, centsToUnits(topup.amount_cents)],
          ),
        )
      )
        throw new DomainError('MINT_MISMATCH', 'The token mint commitment does not match this top-up.', 409);
    }
    const state =
      tx.state === 'confirmed'
        ? 'available'
        : ['failed', 'manual_review'].includes(tx.state)
          ? 'manual_review'
          : 'mint_pending';
    await env.DB.prepare('UPDATE bank_topups SET state=?,tx_hash=?,error=?,updated_at=? WHERE id=?')
      .bind(state, tx.tx_hash, tx.error, new Date().toISOString(), topup.id)
      .run();
    if (state === 'available')
      await audit(
        env,
        topup.user_id,
        'bank_topup_available',
        `${topup.amount_cents} Sandbox cents minted as demo cUSD`,
        topup.id,
      );
    return read();
  } catch (error) {
    await env.DB.prepare('UPDATE bank_topups SET error=?,updated_at=? WHERE id=?')
      .bind(
        error instanceof DomainError ? error.message : 'Top-up needs retry or manual reconciliation.',
        new Date().toISOString(),
        topup.id,
      )
      .run();
    throw error;
  }
}
export async function paypalWebhook(env: Env, headers: Headers, event: unknown) {
  if (
    ![
      'paypal-transmission-id',
      'paypal-transmission-time',
      'paypal-cert-url',
      'paypal-auth-algo',
      'paypal-transmission-sig',
    ].every((header) => headers.get(header))
  )
    throw new DomainError('INVALID_WEBHOOK_SIGNATURE', 'PayPal webhook signature headers are required.', 401);
  if (!env.PAYPAL_WEBHOOK_ID)
    throw new DomainError('WEBHOOK_NOT_CONFIGURED', 'Configure the Sandbox webhook ID.', 503);
  const paypal = new PayPalSandbox(env);
  const verification = (await paypal.request('/v1/notifications/verify-webhook-signature', 'POST', {
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_time: headers.get('paypal-transmission-time'),
    cert_url: headers.get('paypal-cert-url'),
    auth_algo: headers.get('paypal-auth-algo'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: event,
  })) as { verification_status?: string };
  if (verification.verification_status !== 'SUCCESS')
    throw new DomainError('INVALID_WEBHOOK_SIGNATURE', 'PayPal webhook signature was not verified.', 401);
  const { z } = await import('zod');
  const parsed = z
    .object({
      id: z.string(),
      event_type: z.string(),
      resource: z
        .object({
          id: z.string().optional(),
          supplementary_data: z
            .object({ related_ids: z.object({ order_id: z.string().optional() }) })
            .optional(),
        })
        .passthrough(),
    })
    .parse(event);
  const topup = parsed.resource.supplementary_data?.related_ids.order_id
    ? await env.DB.prepare('SELECT * FROM bank_topups WHERE order_id=?')
        .bind(parsed.resource.supplementary_data.related_ids.order_id)
        .first<TopUp>()
    : await env.DB.prepare('SELECT * FROM bank_topups WHERE capture_id=?')
        .bind(parsed.resource.id ?? '')
        .first<TopUp>();
  if (topup) {
    if (/REFUNDED|REVERSED|DENIED/.test(parsed.event_type))
      await env.DB.prepare(
        "UPDATE bank_topups SET state='manual_review',error='PayPal reversal/refund received. Tokens may already have moved; operator reconciliation required.',updated_at=? WHERE id=?",
      )
        .bind(new Date().toISOString(), topup.id)
        .run();
    else await reconcileTopUp(env, topup);
  }
  await env.DB.prepare(
    'INSERT INTO bank_events(id,source,data,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(
      `paypal:${parsed.id}`,
      'paypal',
      JSON.stringify({ type: parsed.event_type, topup: topup?.id ?? null }),
      new Date().toISOString(),
    )
    .run();
  return { received: true };
}
