CREATE TABLE bank_accounts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), agent_id TEXT UNIQUE REFERENCES agents(id), provider_id TEXT UNIQUE REFERENCES providers(id),
 identity TEXT NOT NULL UNIQUE, address TEXT UNIQUE, chain_id INTEGER NOT NULL DEFAULT 84532 CHECK(chain_id=84532), state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 CHECK ((agent_id IS NOT NULL) != (provider_id IS NOT NULL))
);
CREATE INDEX bank_accounts_owner ON bank_accounts(user_id);
CREATE TABLE bank_policies (
 agent_id TEXT PRIMARY KEY REFERENCES agents(id), destinations TEXT NOT NULL DEFAULT '[]', max_investment_cents INTEGER NOT NULL DEFAULT 0,
 max_loan_cents INTEGER NOT NULL DEFAULT 0, max_chit_cents INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE bank_topups (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES bank_accounts(id), user_id TEXT NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 100 AND 100000),
 order_id TEXT UNIQUE, capture_id TEXT UNIQUE, state TEXT NOT NULL, approval_url TEXT, mint_intent TEXT NOT NULL UNIQUE, tx_hash TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE bank_transactions (
 id TEXT PRIMARY KEY, account_id TEXT REFERENCES bank_accounts(id), purpose TEXT NOT NULL, target TEXT NOT NULL, calldata TEXT NOT NULL, commitment TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'prepared', tx_hash TEXT UNIQUE, block_number TEXT, block_hash TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX bank_tx_recovery ON bank_transactions(state,updated_at);
CREATE TABLE bank_escrows (
 purchase_id TEXT PRIMARY KEY REFERENCES purchases(id), buyer_account_id TEXT NOT NULL REFERENCES bank_accounts(id), seller_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
 escrow_key TEXT NOT NULL UNIQUE, amount_units TEXT NOT NULL, fee_bps INTEGER NOT NULL CHECK(fee_bps BETWEEN 0 AND 1000), fee_units TEXT NOT NULL,
 deadline INTEGER NOT NULL, state TEXT NOT NULL, invocation_id TEXT UNIQUE REFERENCES invocations(id), result_hash TEXT, funding_tx TEXT, resolution_tx TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE bank_entities (
 id TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, creator_agent_id TEXT NOT NULL REFERENCES agents(id), name TEXT NOT NULL, terms TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bank_positions (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), entity_address TEXT NOT NULL, kind TEXT NOT NULL, onchain_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX bank_positions_agent ON bank_positions(agent_id);
CREATE TABLE bank_snapshots (
 id TEXT PRIMARY KEY, entity_address TEXT NOT NULL, block_number TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bank_events (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, tx_hash TEXT, block_number TEXT, block_hash TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bank_cursors (source TEXT PRIMARY KEY, block_number TEXT NOT NULL, block_hash TEXT NOT NULL);
CREATE TABLE bank_policy_decisions (
 purchase_id TEXT PRIMARY KEY REFERENCES purchases(id), agent_id TEXT NOT NULL REFERENCES agents(id), action TEXT NOT NULL, amount_units TEXT NOT NULL, decision TEXT NOT NULL, authorized_by TEXT, created_at TEXT NOT NULL
);
ALTER TABLE quotes ADD COLUMN escrow_fee_bps INTEGER;
