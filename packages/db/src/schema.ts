import { sqliteTable, text, integer, real, index, uniqueIndex, customType } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { CapabilityType, PurchaseStatus, JobStatus, JsonSchema, JsonInput } from '@capora/types';

// Keep existing ISO text timestamps while exposing Date values to Better Auth.
const isoDate = customType<{ data: Date; driverData: string }>({
  dataType: () => 'text',
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value),
});
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  vaultEncrypted: text('vault_encrypted'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: isoDate('created_at').notNull(),
  updatedAt: isoDate('updated_at')
    .notNull()
    .default(sql`'1970-01-01T00:00:00.000Z'`),
});
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);
export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('auth_accounts_user_idx').on(t.userId),
    uniqueIndex('auth_accounts_provider_idx').on(t.providerId, t.accountId),
  ],
);
export const authVerifications = sqliteTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
);
export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('agents_user_idx').on(t.userId)],
);
export const spendingPolicies = sqliteTable('spending_policies', {
  agentId: text('agent_id')
    .primaryKey()
    .references(() => agents.id),
  dailyBudgetCents: integer('daily_budget_cents').notNull().default(2500),
  autoApproveCents: integer('auto_approve_cents').notNull().default(50),
  maxTransactionCents: integer('max_transaction_cents').notNull().default(1000),
  autonomousEnabled: integer('autonomous_enabled', { mode: 'boolean' }).notNull().default(true),
});
export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  description: text('description').notNull(),
  reputation: real('reputation').notNull().default(0),
  createdAt: text('created_at').notNull(),
});
export const capabilities = sqliteTable(
  'capabilities',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    name: text('name').notNull(),
    description: text('description').notNull(),
    type: text('type').$type<CapabilityType>().notNull(),
    category: text('category').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').$type<'USD' | 'cUSD'>().notNull().default('USD'),
    pricingUnit: text('pricing_unit').notNull(),
    inputSchema: text('input_schema', { mode: 'json' }).$type<JsonSchema>().notNull(),
    outputSchema: text('output_schema', { mode: 'json' }).$type<JsonSchema>().notNull(),
    endpoint: text('endpoint').notNull(),
    httpMethod: text('http_method').$type<'POST' | 'GET'>().notNull().default('POST'),
    secretEncrypted: text('secret_encrypted'),
    authHeader: text('auth_header').notNull().default('Authorization'),
    datasetKey: text('dataset_key'),
    expectedLatencyMs: integer('expected_latency_ms').notNull(),
    avgLatencyMs: integer('avg_latency_ms').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    baselineReliability: real('baseline_reliability').notNull().default(99),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    async: integer('async', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    removedAt: text('removed_at'),
    synthetic: integer('synthetic', { mode: 'boolean' }).notNull().default(false),
    version: integer('version').notNull().default(1),
    documentationUrl: text('documentation_url'),
    availability: real('availability').notNull().default(0.99),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('capabilities_category_idx').on(t.category, t.enabled),
    index('capabilities_provider_idx').on(t.providerId),
  ],
);
export const operatorSettings = sqliteTable('operator_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<string[] | number>().notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by')
    .notNull()
    .references(() => users.id),
});
export const quotes = sqliteTable(
  'quotes',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    capabilityId: text('capability_id')
      .notNull()
      .references(() => capabilities.id),
    priceCents: integer('price_cents').notNull(),
    escrowFeeBps: integer('escrow_fee_bps'),
    currency: text('currency').$type<'USD' | 'cUSD'>().notNull().default('USD'),
    input: text('input', { mode: 'json' }).$type<JsonInput>().notNull(),
    inputHash: text('input_hash').notNull(),
    capabilityVersion: integer('capability_version').notNull(),
    reason: text('reason'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('quotes_agent_idx').on(t.agentId)],
);
export const purchases = sqliteTable(
  'purchases',
  {
    id: text('id').primaryKey(),
    quoteId: text('quote_id')
      .notNull()
      .unique()
      .references(() => quotes.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    capabilityId: text('capability_id')
      .notNull()
      .references(() => capabilities.id),
    amountCents: integer('amount_cents').notNull(),
    status: text('status').$type<PurchaseStatus>().notNull(),
    paymentMode: text('payment_mode').$type<'demo' | 'sandbox'>().notNull(),
    orderId: text('order_id').unique(),
    captureId: text('capture_id').unique(),
    approvalUrl: text('approval_url'),
    error: text('error'),
    reason: text('reason'),
    budgetDay: text('budget_day').notNull(),
    paymentLeaseUntil: integer('payment_lease_until').notNull().default(0),
    paymentLeaseId: text('payment_lease_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('purchases_budget_idx').on(t.agentId, t.budgetDay, t.status)],
);
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  purchaseId: text('purchase_id')
    .notNull()
    .unique()
    .references(() => purchases.id),
  providerId: text('provider_id')
    .notNull()
    .references(() => providers.id),
  amountCents: integer('amount_cents').notNull(),
  type: text('type').notNull().default('capture'),
  status: text('status').notNull(),
  orderId: text('order_id'),
  captureId: text('capture_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const invocations = sqliteTable(
  'invocations',
  {
    id: text('id').primaryKey(),
    purchaseId: text('purchase_id')
      .notNull()
      .unique()
      .references(() => purchases.id),
    capabilityId: text('capability_id')
      .notNull()
      .references(() => capabilities.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    status: text('status').$type<JobStatus>().notNull(),
    input: text('input', { mode: 'json' }).$type<JsonInput>().notNull(),
    latencyMs: integer('latency_ms'),
    result: text('result', { mode: 'json' }).$type<unknown>(),
    artifactKey: text('artifact_key'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (t) => [index('invocations_agent_idx').on(t.agentId, t.createdAt)],
);
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  invocationId: text('invocation_id')
    .notNull()
    .unique()
    .references(() => invocations.id),
  status: text('status').$type<JobStatus>().notNull(),
  progress: integer('progress').notNull().default(0),
  result: text('result', { mode: 'json' }).$type<unknown>(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  purchaseId: text('purchase_id')
    .notNull()
    .unique()
    .references(() => purchases.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
});
export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    capabilityId: text('capability_id')
      .notNull()
      .references(() => capabilities.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    // Nullable for reviews created before verified agent ratings were introduced.
    agentId: text('agent_id').references(() => agents.id),
    invocationId: text('invocation_id').references(() => invocations.id),
    rating: integer('rating').notNull(),
    body: text('body'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('reviews_invocation_idx').on(t.invocationId),
    index('reviews_capability_idx').on(t.capabilityId),
  ],
);
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    entityId: text('entity_id'),
    correlationId: text('correlation_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('activity_user_idx').on(t.userId, t.createdAt)],
);
export const billingSetups = sqliteTable('billing_setups', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  setupTokenId: text('setup_token_id'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});
export const resourceUsage = sqliteTable('resource_usage', {
  resource: text('resource').primaryKey(),
  usageDay: text('usage_day').notNull().default(''),
  writes: integer('writes').notNull().default(0),
  reads: integer('reads').notNull().default(0),
  reservedBytes: integer('reserved_bytes').notNull().default(0),
  blocked: integer('blocked', { mode: 'boolean' }).notNull().default(false),
});
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const agentSetups = sqliteTable(
  'agent_setups',
  {
    id: text('id').primaryKey(),
    deviceCodeHash: text('device_code_hash').notNull().unique(),
    tokenHash: text('token_hash').notNull().unique(),
    userCode: text('user_code').notNull(),
    name: text('name').notNull(),
    dailyBudgetCents: integer('daily_budget_cents').notNull(),
    autoApproveCents: integer('auto_approve_cents').notNull(),
    maxTransactionCents: integer('max_transaction_cents').notNull(),
    status: text('status').$type<'pending' | 'approved' | 'denied'>().notNull().default('pending'),
    agentId: text('agent_id').notNull().unique(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('agent_setups_expiry_idx').on(t.expiresAt)],
);

// Chain balances are never stored here. These tables index identities, intents and confirmed receipts.
export const bankAccounts = sqliteTable(
  'bank_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    agentId: text('agent_id')
      .unique()
      .references(() => agents.id),
    providerId: text('provider_id')
      .unique()
      .references(() => providers.id),
    identity: text('identity').notNull().unique(),
    address: text('address').unique(),
    chainId: integer('chain_id').notNull().default(84532),
    state: text('state').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('bank_accounts_owner').on(t.userId)],
);
export const bankPolicies = sqliteTable('bank_policies', {
  agentId: text('agent_id')
    .primaryKey()
    .references(() => agents.id),
  destinations: text('destinations').notNull().default('[]'),
  maxInvestmentCents: integer('max_investment_cents').notNull().default(0),
  maxLoanCents: integer('max_loan_cents').notNull().default(0),
  maxChitCents: integer('max_chit_cents').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});
export const bankTopups = sqliteTable('bank_topups', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => bankAccounts.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  amountCents: integer('amount_cents').notNull(),
  orderId: text('order_id').unique(),
  captureId: text('capture_id').unique(),
  state: text('state').notNull(),
  approvalUrl: text('approval_url'),
  mintIntent: text('mint_intent').notNull().unique(),
  txHash: text('tx_hash'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const bankTransactions = sqliteTable(
  'bank_transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').references(() => bankAccounts.id),
    purpose: text('purpose').notNull(),
    target: text('target').notNull(),
    calldata: text('calldata').notNull(),
    commitment: text('commitment').notNull(),
    state: text('state').notNull().default('prepared'),
    txHash: text('tx_hash').unique(),
    blockNumber: text('block_number'),
    blockHash: text('block_hash'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    leaseId: text('lease_id'),
    leaseUntil: integer('lease_until').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('bank_tx_recovery').on(t.state, t.updatedAt)],
);
export const bankEscrows = sqliteTable('bank_escrows', {
  fundAddress: text('fund_address'),
  purchaseId: text('purchase_id')
    .primaryKey()
    .references(() => purchases.id),
  buyerAccountId: text('buyer_account_id')
    .notNull()
    .references(() => bankAccounts.id),
  sellerAccountId: text('seller_account_id')
    .notNull()
    .references(() => bankAccounts.id),
  escrowKey: text('escrow_key').notNull().unique(),
  amountUnits: text('amount_units').notNull(),
  feeBps: integer('fee_bps').notNull(),
  feeUnits: text('fee_units').notNull(),
  deadline: integer('deadline').notNull(),
  state: text('state').notNull(),
  invocationId: text('invocation_id')
    .unique()
    .references(() => invocations.id),
  resultHash: text('result_hash'),
  fundingTx: text('funding_tx'),
  resolutionTx: text('resolution_tx'),
  updatedAt: text('updated_at').notNull(),
});
export const bankEntities = sqliteTable('bank_entities', {
  id: text('id').primaryKey(),
  address: text('address').notNull().unique(),
  kind: text('kind').notNull(),
  creatorAgentId: text('creator_agent_id')
    .notNull()
    .references(() => agents.id),
  name: text('name').notNull(),
  terms: text('terms').notNull(),
  createdAt: text('created_at').notNull(),
});
export const bankPositions = sqliteTable(
  'bank_positions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    entityAddress: text('entity_address').notNull(),
    kind: text('kind').notNull(),
    onchainId: text('onchain_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('bank_positions_agent').on(t.agentId)],
);
export const bankSnapshots = sqliteTable('bank_snapshots', {
  id: text('id').primaryKey(),
  entityAddress: text('entity_address').notNull(),
  blockNumber: text('block_number').notNull(),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
});
export const bankEvents = sqliteTable('bank_events', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  txHash: text('tx_hash'),
  blockNumber: text('block_number'),
  blockHash: text('block_hash'),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
});
export const bankCursors = sqliteTable('bank_cursors', {
  source: text('source').primaryKey(),
  blockNumber: text('block_number').notNull(),
  blockHash: text('block_hash').notNull(),
});
export const bankPolicyDecisions = sqliteTable('bank_policy_decisions', {
  purchaseId: text('purchase_id')
    .primaryKey()
    .references(() => purchases.id),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  action: text('action').notNull(),
  amountUnits: text('amount_units').notNull(),
  decision: text('decision').notNull(),
  authorizedBy: text('authorized_by'),
  createdAt: text('created_at').notNull(),
});
export const bankStrategySchedules = sqliteTable('bank_strategy_schedules', {
  fundAddress: text('fund_address').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  enabled: integer('enabled').notNull().default(0),
  intervalSeconds: integer('interval_seconds').notNull(),
  allowedCapabilities: text('allowed_capabilities').notNull().default('[]'),
  maxCallsPerDay: integer('max_calls_per_day').notNull(),
  plannerDay: text('planner_day').notNull().default(''),
  callsToday: integer('calls_today').notNull().default(0),
  nextRunAt: integer('next_run_at').notNull().default(0),
  lastReport: text('last_report'),
  updatedAt: text('updated_at').notNull(),
});
export const bankFundExpenses = sqliteTable('bank_fund_expenses', {
  quoteId: text('quote_id')
    .primaryKey()
    .references(() => quotes.id),
  fundAddress: text('fund_address').notNull(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
});
