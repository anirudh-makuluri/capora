import { decodeEventLog, type Address } from 'viem';
import {
  CaporaUSDAbi,
  PurchaseEscrowAbi,
  ManagedFundAbi,
  LendingPoolAbi,
  PublicChitAbi,
  BankFactoryAbi,
} from '@capora/bank/abis';
import { configuration, assertChain } from './config';
import { jsonSafe } from './read';
import type { Env } from '../env';
export async function indexBankEvents(env: Env) {
  const cfg = configuration(env),
    client = await assertChain(env),
    head = await client.getBlockNumber();
  if (head < BigInt(cfg.confirmations)) return;
  const through = head - BigInt(cfg.confirmations) + 1n;
  const cursor = await env.DB.prepare("SELECT * FROM bank_cursors WHERE source='bank:84532'").first<{
    block_number: string;
    block_hash: string;
  }>();
  let from = cursor ? BigInt(cursor.block_number) : cfg.startBlock ? BigInt(cfg.startBlock) : through;
  if (cursor) {
    const block = await client.getBlock({ blockNumber: BigInt(cursor.block_number) });
    if (block.hash !== cursor.block_hash) {
      await env.DB.prepare(
        "UPDATE bank_transactions SET state='manual_review',error='Indexer detected a chain reorganization. Check canonical event receipts.' WHERE CAST(block_number AS INTEGER)>=?",
      )
        .bind(Number(from > 6n ? from - 6n : 0n))
        .run();
    }
    from = from > 6n ? from - 6n : 0n;
  }
  const to = from + 999n < through ? from + 999n : through;
  if (from > to) return;
  const entities = (
    await env.DB.prepare('SELECT address FROM bank_entities ORDER BY created_at DESC LIMIT 24').all<{
      address: Address;
    }>()
  ).results;
  const addresses = [
    cfg.token,
    cfg.riskToken,
    cfg.escrow,
    cfg.lending,
    cfg.bankFactory,
    ...entities.map((e) => e.address),
  ];
  const logs = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
  const abi = [
    ...CaporaUSDAbi,
    ...PurchaseEscrowAbi,
    ...ManagedFundAbi,
    ...LendingPoolAbi,
    ...PublicChitAbi,
    ...BankFactoryAbi,
  ];
  // Re-read a small canonical overlap. Events from orphaned blocks are removed, then canonical logs are inserted.
  const statements = [
    env.DB.prepare(
      "DELETE FROM bank_events WHERE source='chain' AND CAST(block_number AS INTEGER) BETWEEN ? AND ?",
    ).bind(Number(from), Number(to)),
  ];
  for (const log of logs) {
    if (log.removed || log.logIndex === null || !log.transactionHash || !log.blockNumber || !log.blockHash)
      continue;
    let decoded: unknown;
    try {
      decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: false });
    } catch {
      decoded = { data: log.data, topics: log.topics };
    }
    statements.push(
      env.DB.prepare(
        'INSERT INTO bank_events(id,source,tx_hash,block_number,block_hash,data,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
      ).bind(
        `chain:84532:${log.transactionHash}:${log.logIndex}`,
        'chain',
        log.transactionHash,
        log.blockNumber.toString(),
        log.blockHash,
        JSON.stringify(jsonSafe({ address: log.address, ...(decoded as object) })),
        new Date().toISOString(),
      ),
    );
    if (log.address.toLowerCase() === cfg.escrow.toLowerCase()) {
      const event = decoded as {
        eventName?: string;
        args?: { id?: string; state?: number; resultHash?: string };
      };
      if (event.eventName === 'Resolved' && event.args?.id && [3, 4, 5].includes(Number(event.args.state))) {
        const state =
          Number(event.args.state) === 3
            ? 'released'
            : Number(event.args.state) === 4
              ? 'refunded'
              : 'manual_review';
        statements.push(
          env.DB.prepare(
            'UPDATE bank_escrows SET state=?,resolution_tx=?,result_hash=?,updated_at=? WHERE escrow_key=?',
          ).bind(
            state,
            log.transactionHash,
            event.args.resultHash ?? null,
            new Date().toISOString(),
            event.args.id,
          ),
        );
        statements.push(
          env.DB.prepare(
            'UPDATE transactions SET status=? WHERE purchase_id IN (SELECT purchase_id FROM bank_escrows WHERE escrow_key=?)',
          ).bind(state, event.args.id),
        );
        if (state === 'refunded')
          statements.push(
            env.DB.prepare(
              "UPDATE purchases SET status='refunded',updated_at=? WHERE id IN (SELECT purchase_id FROM bank_escrows WHERE escrow_key=?)",
            ).bind(new Date().toISOString(), event.args.id),
          );
      }
    }
  }
  const end = await client.getBlock({ blockNumber: to });
  statements.push(
    env.DB.prepare(
      "INSERT INTO bank_cursors(source,block_number,block_hash) VALUES('bank:84532',?,?) ON CONFLICT(source) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash",
    ).bind(to.toString(), end.hash),
  );
  // Bounded batches avoid D1 parameter limits while every event keeps a unique chain identity.
  for (let i = 0; i < statements.length; i += 40) await env.DB.batch(statements.slice(i, i + 40));
}
