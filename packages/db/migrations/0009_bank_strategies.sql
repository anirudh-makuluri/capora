CREATE TABLE bank_strategy_schedules (
 fund_address TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), enabled INTEGER NOT NULL DEFAULT 0,
 interval_seconds INTEGER NOT NULL, allowed_capabilities TEXT NOT NULL DEFAULT '[]', max_calls_per_day INTEGER NOT NULL,
 planner_day TEXT NOT NULL DEFAULT '', calls_today INTEGER NOT NULL DEFAULT 0, next_run_at INTEGER NOT NULL DEFAULT 0,
 last_report TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE bank_fund_expenses (
 quote_id TEXT PRIMARY KEY REFERENCES quotes(id), fund_address TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES agents(id),
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE bank_escrows ADD COLUMN fund_address TEXT;
