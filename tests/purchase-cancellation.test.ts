import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { catalogStatements } from '../scripts/seed-data';
import { cancelPurchase, getBudget } from '../apps/worker/src/services/commerce';
import type { Env } from '../apps/worker/src/env';

let mf: Miniflare, db: Awaited<ReturnType<Miniflare['getD1Database']>>, env: Env;
const now = new Date().toISOString();
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      compatibilityDate: '2026-10-03',
      d1Databases: ['DB'],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of (await readdir('packages/db/migrations')).filter((f) => f.endsWith('.sql')).sort())
    for (const sql of (await readFile(`packages/db/migrations/${file}`, 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  await db
    .prepare(
      "INSERT INTO users(id,email,name,created_at) VALUES('user_demo','cancel@example.com','Cancel test',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO agents(id,user_id,name,token_hash,created_at) VALUES('cancel_agent','user_demo','Cancel agent','cancel-hash',?)",
    )
    .bind(now)
    .run();
  await db.prepare("INSERT INTO spending_policies(agent_id) VALUES('cancel_agent')").run();
  for (const sql of catalogStatements('user_demo', now)) await db.prepare(sql).run();
  await db
    .prepare(
      "INSERT INTO bank_accounts(id,user_id,agent_id,identity,created_at) VALUES('buyer','user_demo','cancel_agent','buyer-identity',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO bank_accounts(id,user_id,provider_id,identity,created_at) VALUES('seller','user_demo','provider_capora_bank','seller-identity',?)",
    )
    .bind(now)
    .run();
  env = { DB: db, PAYMENT_MODE: 'sandbox', BANK_ENABLED: 'true' } as Env;
});
beforeEach(async () => {
  for (const table of [
    'bank_transactions',
    'bank_escrows',
    'transactions',
    'approvals',
    'purchases',
    'quotes',
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
  await db
    .prepare(
      "INSERT INTO quotes(id,agent_id,capability_id,price_cents,input,input_hash,capability_version,created_at,expires_at) SELECT 'cancel_quote','cancel_agent',id,100,'{}','hash',version,?,? FROM capabilities WHERE id='sd_repo_analysis'",
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO purchases(id,quote_id,agent_id,capability_id,amount_cents,status,payment_mode,budget_day,error,created_at,updated_at) VALUES('cancel_purchase','cancel_quote','cancel_agent','sd_repo_analysis',100,'payment_pending','sandbox',?,'Escrow funding deadline expired. Request a new quote.',?,?)",
    )
    .bind(now.slice(0, 10), now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO bank_escrows(purchase_id,buyer_account_id,seller_account_id,escrow_key,amount_units,fee_bps,fee_units,deadline,state,updated_at) VALUES('cancel_purchase','buyer','seller','cancel-key','1000000',0,'0',?,'approved',?)",
    )
    .bind(Math.floor(Date.now() / 1000) - 3600, now)
    .run();
});
afterAll(async () => mf?.dispose());
async function intent(suffix: string, state: string, txHash: string | null = null) {
  await db
    .prepare(
      'INSERT INTO bank_transactions(id,account_id,purpose,target,calldata,commitment,state,tx_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      `escrow:cancel_purchase:${suffix}`,
      'buyer',
      suffix === 'approve' ? 'escrow_token_approval' : 'escrow_funding',
      '0x1111111111111111111111111111111111111111',
      '0x',
      `commitment-${suffix}`,
      state,
      txHash,
      now,
      now,
    )
    .run();
}
describe('Cancellation of unfunded escrow purchases', () => {
  it('rolls back purchase cancellation if the escrow update fails', async () => {
    await db
      .prepare(
        "CREATE TRIGGER fail_cancel BEFORE UPDATE OF state ON bank_escrows WHEN NEW.state='cancelled' BEGIN SELECT RAISE(ABORT,'test cancellation failure'); END",
      )
      .run();
    try {
      await expect(cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).rejects.toThrow();
      expect(
        await db.prepare("SELECT status FROM purchases WHERE id='cancel_purchase'").first('status'),
      ).toBe('payment_pending');
      expect((await getBudget(env, 'cancel_agent')).reservedCents).toBe(100);
    } finally {
      await db.prepare('DROP TRIGGER fail_cancel').run();
    }
  });
  it('cancels an expired unfunded purchase and releases its reservation idempotently', async () => {
    expect((await getBudget(env, 'cancel_agent')).reservedCents).toBe(100);
    expect((await cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).status).toBe('rejected');
    expect((await getBudget(env, 'cancel_agent')).reservedCents).toBe(0);
    expect((await cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).status).toBe('rejected');
    expect(
      await db.prepare("SELECT state FROM bank_escrows WHERE purchase_id='cancel_purchase'").first('state'),
    ).toBe('cancelled');
  });
  it('does not confuse a confirmed token allowance with funded escrow', async () => {
    await intent('approve', 'confirmed', '0xapproval');
    await intent('fund', 'failed');
    expect((await cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).status).toBe('rejected');
  });
  it('matches purchase ID underscores literally instead of using LIKE wildcards', async () => {
    await intent('fund', 'confirmed');
    await db.prepare("UPDATE bank_transactions SET id='escrow:cancelXpurchase:fund'").run();
    expect((await cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).status).toBe('rejected');
  });
  it('cancels an expired prepared funding transaction that was never submitted', async () => {
    await intent('fund', 'prepared');
    expect((await cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).status).toBe('rejected');
    expect(
      await db
        .prepare("SELECT state FROM bank_transactions WHERE id='escrow:cancel_purchase:fund'")
        .first('state'),
    ).toBe('failed');
  });
  it('requires reconciliation for a prepared funding attempt before its deadline', async () => {
    await db
      .prepare("UPDATE bank_escrows SET deadline=? WHERE purchase_id='cancel_purchase'")
      .bind(Math.floor(Date.now() / 1000) + 3600)
      .run();
    await intent('fund', 'prepared');
    await expect(cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).rejects.toMatchObject({
      code: 'PAYMENT_RECONCILIATION_REQUIRED',
    });
  });
  it.each(['submitting', 'pending', 'confirmed', 'manual_review'])(
    'retains the reservation for a %s funding intent',
    async (state) => {
      await intent('fund', state);
      await expect(cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).rejects.toMatchObject({
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect((await getBudget(env, 'cancel_agent')).reservedCents).toBe(100);
    },
  );
  it('does not cancel escrow already marked funded even if its transaction projection is missing', async () => {
    await db
      .prepare(
        "UPDATE bank_escrows SET state='escrow_funded',funding_tx='0xfunded' WHERE purchase_id='cancel_purchase'",
      )
      .run();
    await expect(cancelPurchase(env, 'cancel_purchase', 'cancel_agent')).rejects.toMatchObject({
      code: 'PAYMENT_RECONCILIATION_REQUIRED',
    });
  });
  it('checks ownership and always releases the payment lease after refusal', async () => {
    await expect(cancelPurchase(env, 'cancel_purchase', 'other_agent')).rejects.toMatchObject({
      code: 'PURCHASE_REQUIRED',
    });
    expect(
      await db
        .prepare("SELECT payment_lease_id FROM purchases WHERE id='cancel_purchase'")
        .first('payment_lease_id'),
    ).toBeNull();
  });
});
