import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { CapabilityType, PurchaseStatus, JobStatus, JsonSchema, JsonInput } from '@capora/types';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  vaultEncrypted: text('vault_encrypted'),
  createdAt: text('created_at').notNull(),
});
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
    currency: text('currency').$type<'USD'>().notNull().default('USD'),
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
    currency: text('currency').$type<'USD'>().notNull().default('USD'),
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
    rating: integer('rating').notNull(),
    body: text('body'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('reviews_user_capability_idx').on(t.userId, t.capabilityId)],
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
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
