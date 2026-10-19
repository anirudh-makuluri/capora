import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { catalogStatements, seedCapabilities } from '../scripts/seed-data';
import { CAPORA_BANK_PROVIDER_ID } from '../packages/config/src/index';
import { fundPurchase } from '../apps/worker/src/bank/escrow';
import type { Env } from '../apps/worker/src/env';
import * as accounts from '../apps/worker/src/bank/accounts';

let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const now = '2026-10-18T12:00:00.000Z';
function bankEnv(): Env {
  const address = '0x1111111111111111111111111111111111111111';
  return {
    DB: db,
    BANK_ENABLED: 'true',
    BANK_RPC_URL: 'https://unused-rpc.example',
    BANK_DEPLOYMENT: JSON.stringify({
      chainId: 84532,
      token: address,
      riskToken: address,
      walletFactory: address,
      escrow: address,
      market: address,
      lending: address,
      bankFactory: address,
      treasury: address,
      executor: address,
    }),
  } as Env;
}
async function sync(owner = 'user_demo') {
  for (const statement of catalogStatements(owner, now)) await db.prepare(statement).run();
}
async function migrate() {
  const sql = await readFile('packages/db/migrations/0010_bank_capability_ownership.sql', 'utf8');
  for (const statement of sql.split(';').filter((s) => s.trim())) await db.prepare(statement).run();
}
async function listing(id: string) {
  return db
    .prepare('SELECT provider_id,version,enabled,removed_at,success_count FROM capabilities WHERE id=?')
    .bind(id)
    .first();
}
async function escrow(capabilityId = 'document_fingerprint') {
  const provider = `provider_${capabilityId}`;
  await db
    .prepare(
      "INSERT INTO quotes(id,agent_id,capability_id,price_cents,escrow_fee_bps,input,input_hash,capability_version,created_at,expires_at) VALUES('old_quote','buyer',?,10,250,'{}','hash',1,?,?)",
    )
    .bind(capabilityId, now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO purchases(id,quote_id,agent_id,capability_id,amount_cents,status,payment_mode,budget_day,created_at,updated_at) VALUES('old_purchase','old_quote','buyer',?,10,'purchased','sandbox','2026-10-18',?,?)",
    )
    .bind(capabilityId, now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO bank_accounts(id,user_id,agent_id,identity,created_at) VALUES('buyer_account','user_demo','buyer','buyer_identity',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO bank_accounts(id,user_id,provider_id,identity,created_at) VALUES('seller_account','user_demo',?,'seller_identity',?)",
    )
    .bind(provider, now)
    .run();
  await db
    .prepare(
      "INSERT INTO bank_escrows(purchase_id,buyer_account_id,seller_account_id,escrow_key,amount_units,fee_bps,fee_units,deadline,state,updated_at) VALUES('old_purchase','buyer_account','seller_account','original_key','100000',250,'2500',1792400000,'escrow_funded',?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO transactions(id,purchase_id,provider_id,amount_cents,status,type,created_at,updated_at) VALUES('old_transaction','old_purchase',?,10,'escrow_funded','cusd_escrow',?,?)",
    )
    .bind(provider, now, now)
    .run();
}
beforeEach(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } }',
      compatibilityDate: '2026-10-03',
      d1Databases: ['DB'],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of (await readdir('packages/db/migrations'))
    .filter((f) => f.endsWith('.sql') && f < '0010')
    .sort())
    for (const statement of (await readFile(`packages/db/migrations/${file}`, 'utf8'))
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(statement).run();
  for (const user of ['user_demo', 'user_other'])
    await db
      .prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)')
      .bind(user, `${user}@test.example`, user, now)
      .run();
  await db
    .prepare(
      "INSERT INTO agents(id,user_id,name,token_hash,created_at) VALUES('buyer','user_demo','Buyer','unique_hash',?)",
    )
    .bind(now)
    .run();
  await sync();
  // Reconstruct the previous catalog without duplicating its schemas or hardcoding its size.
  for (const capability of seedCapabilities) {
    await db
      .prepare(
        "INSERT INTO providers(id,user_id,name,description,created_at) VALUES(?,'user_demo','Capora','Previous first-party seller',?)",
      )
      .bind(`provider_${capability.id}`, now)
      .run();
    await db
      .prepare('UPDATE capabilities SET provider_id=? WHERE id=?')
      .bind(`provider_${capability.id}`, capability.id)
      .run();
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await mf?.dispose();
});

describe('Bank capability ownership migration and catalog synchronization', () => {
  it('consolidates trusted built-ins, preserves moderation and usage, and is idempotent', async () => {
    await db
      .prepare(
        "UPDATE capabilities SET enabled=0,removed_at=?,success_count=7 WHERE id='document_fingerprint'",
      )
      .bind(now)
      .run();
    await migrate();
    for (const c of seedCapabilities)
      expect(await listing(c.id)).toMatchObject({ provider_id: CAPORA_BANK_PROVIDER_ID, version: 2 });
    expect(await listing('document_fingerprint')).toMatchObject({
      enabled: 0,
      removed_at: now,
      success_count: 7,
    });
    await migrate();
    await sync();
    expect(await listing('document_fingerprint')).toMatchObject({
      version: 2,
      enabled: 0,
      removed_at: now,
      success_count: 7,
    });
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM providers WHERE id LIKE 'provider_%' AND id!='provider_capora_bank'",
        )
        .first('n'),
    ).toBe(seedCapabilities.length);
  });
  it('also consolidates legacy listings during catalog sync and inserts new listings under the Bank', async () => {
    await db.prepare("DELETE FROM capabilities WHERE id='document_fingerprint'").run();
    await sync();
    expect(await listing('document_fingerprint')).toMatchObject({
      provider_id: CAPORA_BANK_PROVIDER_ID,
      version: 1,
    });
    for (const c of seedCapabilities.filter((c) => c.id !== 'document_fingerprint'))
      expect(await listing(c.id)).toMatchObject({ provider_id: CAPORA_BANK_PROVIDER_ID, version: 2 });
    await sync();
    expect(await listing('github_repository')).toMatchObject({ version: 2 });
  });
  it('leaves independently owned and repurposed listings untouched', async () => {
    await db
      .prepare("UPDATE providers SET user_id='user_other' WHERE id='provider_document_fingerprint'")
      .run();
    await db
      .prepare("UPDATE capabilities SET endpoint='https://user.example/tool' WHERE id='github_repository'")
      .run();
    await migrate();
    await sync();
    expect(await listing('document_fingerprint')).toMatchObject({
      provider_id: 'provider_document_fingerprint',
      version: 1,
    });
    expect(await listing('github_repository')).toMatchObject({
      provider_id: 'provider_github_repository',
      version: 1,
    });
    expect(await listing('code_scan')).toMatchObject({ provider_id: CAPORA_BANK_PROVIDER_ID });
  });
  it("does not let catalog sync use another workspace's reserved Bank provider", async () => {
    await db.prepare("DELETE FROM capabilities WHERE id='document_fingerprint'").run();
    const before = await listing('github_repository');
    await sync('user_other');
    expect(await listing('document_fingerprint')).toBeNull();
    expect(await listing('github_repository')).toEqual(before);
    expect(
      await db
        .prepare('SELECT user_id FROM providers WHERE id=?')
        .bind(CAPORA_BANK_PROVIDER_ID)
        .first('user_id'),
    ).toBe('user_demo');
  });
  it('creates the Bank provider for an existing bootstrap database without touching user-created providers', async () => {
    await db.prepare("DELETE FROM capabilities WHERE endpoint LIKE 'bank://%'").run();
    await db.prepare('DELETE FROM providers WHERE id=?').bind(CAPORA_BANK_PROVIDER_ID).run();
    await migrate();
    expect(await listing('document_fingerprint')).toMatchObject({ provider_id: CAPORA_BANK_PROVIDER_ID });
    expect(
      await db.prepare('SELECT name,user_id FROM providers WHERE id=?').bind(CAPORA_BANK_PROVIDER_ID).first(),
    ).toEqual({ name: 'Capora Bank', user_id: 'user_demo' });
  });
  it('defers unresolved escrow, then transfers future ownership while retaining the original settlement', async () => {
    await escrow();
    const original = await db.prepare("SELECT * FROM bank_escrows WHERE purchase_id='old_purchase'").first();
    await migrate();
    await sync();
    expect(await listing('document_fingerprint')).toMatchObject({
      provider_id: 'provider_document_fingerprint',
      version: 1,
    });
    expect(await db.prepare("SELECT * FROM bank_escrows WHERE purchase_id='old_purchase'").first()).toEqual(
      original,
    );
    await db.prepare("UPDATE bank_escrows SET state='released' WHERE purchase_id='old_purchase'").run();
    await sync();
    expect(await listing('document_fingerprint')).toMatchObject({
      provider_id: CAPORA_BANK_PROVIDER_ID,
      version: 2,
    });
    expect(
      await db
        .prepare(
          "SELECT seller_account_id,fee_bps,fee_units FROM bank_escrows WHERE purchase_id='old_purchase'",
        )
        .first(),
    ).toEqual({ seller_account_id: 'seller_account', fee_bps: 250, fee_units: '2500' });
    expect(
      await db
        .prepare("SELECT provider_id FROM transactions WHERE id='old_transaction'")
        .first('provider_id'),
    ).toBe('provider_document_fingerprint');
  });
  it('rejects an old approved but unfunded quote after ownership changes, before any wallet transaction', async () => {
    await escrow();
    await db.prepare("DELETE FROM bank_escrows WHERE purchase_id='old_purchase'").run();
    await db.prepare("UPDATE purchases SET status='approved' WHERE id='old_purchase'").run();
    await migrate();
    await expect(
      fundPurchase(bankEnv(), 'old_purchase', 'buyer', CAPORA_BANK_PROVIDER_ID, 10),
    ).rejects.toMatchObject({ code: 'QUOTE_STALE' });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM bank_escrows').first('n')).toBe(0);
  });
  it('atomically rejects funding when ownership migrates during wallet provisioning', async () => {
    await escrow();
    await db.prepare("DELETE FROM bank_escrows WHERE purchase_id='old_purchase'").run();
    vi.spyOn(accounts, 'ensureAccount').mockImplementation(async (_env, kind, entityId) => {
      if (kind === 'agent') await migrate();
      return {
        id: kind === 'agent' ? 'buyer_account' : 'seller_account',
        user_id: 'user_demo',
        agent_id: kind === 'agent' ? entityId : null,
        provider_id: kind === 'provider' ? entityId : null,
        identity: `0x${'1'.repeat(64)}`,
        address: '0x1111111111111111111111111111111111111111',
        state: 'active',
      };
    });
    await expect(
      fundPurchase(bankEnv(), 'old_purchase', 'buyer', 'provider_document_fingerprint', 10),
    ).rejects.toMatchObject({ code: 'QUOTE_STALE' });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM bank_escrows').first('n')).toBe(0);
  });
});
