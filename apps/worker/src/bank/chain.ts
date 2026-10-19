import { encodeFunctionData, keccak256, stringToHex, BaseError, type Address, type Hex } from 'viem';
import { AgentWalletAbi } from '@capora/bank/abis';
import { DomainError } from '@capora/types';
import { canonical, id } from '../lib/crypto';
import { boundedJson } from '../lib/provider-http';
import { configuration, assertChain, bankRpcFailure } from './config';
import type { Env } from '../env';
import { ensureSignerTarget } from './signer-policy';
export const chainKey = (value: string) => keccak256(stringToHex(value));
export interface BankTransaction {
  id: string;
  account_id: string | null;
  purpose: string;
  target: Address;
  calldata: Hex;
  commitment: string;
  state: 'prepared' | 'submitting' | 'pending' | 'confirmed' | 'failed' | 'manual_review';
  tx_hash: Hex | null;
  block_number: string | null;
  block_hash: Hex | null;
  error: string | null;
  created_at: string;
}
export async function transaction(
  env: Env,
  operation: string,
  purpose: string,
  target: Address,
  calldata: Hex,
  accountId: string | null = null,
): Promise<BankTransaction> {
  const client = await assertChain(env),
    cfg = configuration(env);
  const commitment = chainKey(canonical({ target: target.toLowerCase(), calldata, purpose, accountId }));
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO bank_transactions(id,account_id,purpose,target,calldata,commitment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
  )
    .bind(operation, accountId, purpose, target, calldata, commitment, now, now)
    .run();
  const read = async () =>
    (await env.DB.prepare('SELECT * FROM bank_transactions WHERE id=?')
      .bind(operation)
      .first<BankTransaction>())!;
  let row = await read();
  if (row.commitment !== commitment)
    throw new DomainError(
      'IDEMPOTENCY_CONFLICT',
      'This operation ID is already bound to another action.',
      409,
    );
  if (['confirmed', 'failed', 'manual_review'].includes(row.state)) return row;
  const lease = id('chainlease');
  const claimed = await env.DB.prepare(
    'UPDATE bank_transactions SET lease_id=?,lease_until=? WHERE id=? AND lease_until<? RETURNING id',
  )
    .bind(lease, Date.now() + 90_000, operation, Date.now())
    .first();
  if (!claimed) return row;
  try {
    row = await read();
    if (!row.tx_hash) {
      if (
        accountId &&
        ![
          'verified_paypal_mint',
          'escrow_release',
          'escrow_refund',
          'escrow_dispute',
          'expired_escrow_refund',
          'provision_wallet',
        ].includes(purpose)
      ) {
        const invocationId = /^bank:(inv_[^:]+)/.exec(operation)?.[1];
        const delegation = invocationId
          ? await env.DB.prepare(
              'SELECT a.status FROM invocations i JOIN agents a ON a.id=i.agent_id WHERE i.id=?',
            )
              .bind(invocationId)
              .first<{ status: string }>()
          : await env.DB.prepare(
              'SELECT a.status FROM bank_accounts b JOIN agents a ON a.id=b.agent_id WHERE b.id=?',
            )
              .bind(accountId)
              .first<{ status: string }>();
        if (delegation && delegation.status !== 'active')
          throw new DomainError(
            'AGENT_REVOKED',
            'Agent delegation was revoked before signing. Pending financial actions are blocked.',
            403,
          );
      }
      if (
        row.state === 'submitting' &&
        !cfg.local &&
        Date.now() - Date.parse(row.created_at) > 23 * 60 * 60 * 1000
      ) {
        await env.DB.prepare(
          "UPDATE bank_transactions SET state='manual_review',error='Managed signer idempotency window is expiring. Recover the original chain hash before retrying.' WHERE id=?",
        )
          .bind(operation)
          .run();
        return read();
      }
      // An uncertain local send cannot be blindly replayed. Privy persists its idempotency key.
      if (row.state === 'submitting' && cfg.local) {
        await env.DB.prepare(
          "UPDATE bank_transactions SET state='manual_review',error='Local RPC send outcome unknown. Inspect chain events before recovery.' WHERE id=?",
        )
          .bind(operation)
          .run();
        return read();
      }
      if ((await client.getBalance({ address: cfg.executor })) === 0n)
        throw new DomainError(
          'TEST_ETH_REQUIRED',
          'The executor needs Base Sepolia test ETH for gas. No transaction was submitted.',
          503,
        );
      await ensureSignerTarget(env, target, calldata);
      if (!cfg.local && row.state === 'prepared') {
        try {
          await client.call({ account: cfg.executor, to: target, data: calldata, value: 0n });
        } catch (cause) {
          if (cause instanceof BaseError && cause.shortMessage.startsWith('Execution reverted')) {
            const message =
              'The Bank contract rejected this action before signing. Check its limits, deadline and available funds.';
            await env.DB.prepare(
              "UPDATE bank_transactions SET state='failed',error=?,updated_at=? WHERE id=? AND state='prepared'",
            )
              .bind(message, new Date().toISOString(), operation)
              .run();
            throw new DomainError('BANK_SIMULATION_REJECTED', message, 409);
          }
          throw cause;
        }
      }
      await env.DB.prepare(
        "UPDATE bank_transactions SET state='submitting',attempts=attempts+1,updated_at=? WHERE id=?",
      )
        .bind(now, operation)
        .run();
      let txHash: Hex;
      if (cfg.local) {
        const response = await fetch(cfg.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_sendTransaction',
            params: [{ from: cfg.executor, to: target, data: calldata, gas: '0x989680' }],
          }),
          signal: AbortSignal.timeout(20_000),
        });
        const body = (await boundedJson(response)) as { result?: Hex; error?: unknown };
        if (!body.result)
          throw new DomainError('CHAIN_SUBMISSION_FAILED', 'Local EVM rejected this transaction.', 502);
        txHash = body.result;
      } else {
        if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET || !env.PRIVY_WALLET_ID)
          throw new DomainError(
            'MANAGED_SIGNER_REQUIRED',
            'Configure a policy restricted Privy server wallet.',
            503,
          );
        const response = await fetch(
          `https://api.privy.io/v1/wallets/${encodeURIComponent(env.PRIVY_WALLET_ID)}/rpc`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`)}`,
              'privy-app-id': env.PRIVY_APP_ID,
              'privy-idempotency-key': chainKey(operation),
            },
            body: JSON.stringify({
              method: 'eth_sendTransaction',
              caip2: 'eip155:84532',
              params: { transaction: { to: target, data: calldata, value: '0x0', chain_id: 84532 } },
            }),
            signal: AbortSignal.timeout(20_000),
          },
        ).catch(() => {
          throw new DomainError(
            'SIGNER_UNAVAILABLE',
            'Managed signer submission requires reconciliation. Retry the same operation ID.',
            503,
          );
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new DomainError(
            'SIGNER_UNAVAILABLE',
            'Managed signer did not confirm the transaction. Retry with the same operation ID.',
            503,
          );
        }
        const body = (await boundedJson(response)) as { data?: { hash?: Hex } };
        if (!body.data?.hash)
          throw new DomainError('SIGNER_UNAVAILABLE', 'Managed signer returned no transaction hash.', 502);
        txHash = body.data.hash;
      }
      if (!/^0x[\da-fA-F]{64}$/.test(txHash))
        throw new DomainError('INVALID_TRANSACTION', 'Signer returned an invalid transaction hash.', 502);
      await env.DB.prepare(
        "UPDATE bank_transactions SET state='pending',tx_hash=?,error=NULL,updated_at=? WHERE id=?",
      )
        .bind(txHash, now, operation)
        .run();
      row = await read();
    }
    if (row.tx_hash) {
      try {
        await client.waitForTransactionReceipt({
          hash: row.tx_hash,
          confirmations: cfg.confirmations,
          timeout: 15_000,
          pollingInterval: cfg.local ? 500 : 1500,
        });
        // Refresh after waiting: Base preconfirmation receipts can have a zero block hash.
        const receipt = await client.getTransactionReceipt({ hash: row.tx_hash });
        const head = await client.getBlockNumber();
        if (head - receipt.blockNumber + 1n < BigInt(cfg.confirmations)) return read();
        const block = await client.getBlock({ blockNumber: receipt.blockNumber });
        if (block.hash !== receipt.blockHash) return read();
        await env.DB.prepare(
          'UPDATE bank_transactions SET state=?,block_number=?,block_hash=?,error=?,updated_at=? WHERE id=?',
        )
          .bind(
            receipt.status === 'success' ? 'confirmed' : 'failed',
            receipt.blockNumber.toString(),
            receipt.blockHash,
            receipt.status === 'success' ? null : 'On-chain transaction reverted. Inspect the receipt.',
            new Date().toISOString(),
            operation,
          )
          .run();
      } catch {
        /* A timeout is pending, never successful. Scheduled reconciliation retries the receipt. */
      }
    }
    return read();
  } catch (cause) {
    const error = bankRpcFailure(cause) ?? cause;
    await env.DB.prepare('UPDATE bank_transactions SET error=?,updated_at=? WHERE id=?')
      .bind(
        error instanceof DomainError ? error.message : 'Chain submission requires reconciliation.',
        new Date().toISOString(),
        operation,
      )
      .run();
    throw error;
  } finally {
    await env.DB.prepare('UPDATE bank_transactions SET lease_id=NULL,lease_until=0 WHERE id=? AND lease_id=?')
      .bind(operation, lease)
      .run();
  }
}
export async function walletTransaction(
  env: Env,
  operation: string,
  purpose: string,
  account: { id: string; address: Address },
  target: Address,
  calldata: Hex,
) {
  return transaction(
    env,
    operation,
    purpose,
    account.address,
    encodeFunctionData({
      abi: AgentWalletAbi,
      functionName: 'execute',
      args: [chainKey(operation), target, calldata],
    }),
    account.id,
  );
}
export function requireConfirmed(tx: BankTransaction) {
  if (tx.state !== 'confirmed')
    throw new DomainError(
      tx.state === 'failed' ? 'BANK_TRANSACTION_FAILED' : 'BANK_TRANSACTION_PENDING',
      tx.error ?? 'The action is awaiting chain confirmation. Reconcile using the same action ID.',
      409,
    );
  return tx;
}
