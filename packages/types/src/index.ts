import { z } from 'zod';

export const capabilityTypes = ['api', 'dataset', 'agent'] as const;
export const purchaseStatuses = [
  'quoted',
  'pending_approval',
  'approved',
  'payment_pending',
  'purchased',
  'rejected',
  'blocked',
  'failed',
  'refunded',
] as const;
export const jobStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type CapabilityType = (typeof capabilityTypes)[number];
export type PurchaseStatus = (typeof purchaseStatuses)[number];
export type JobStatus = (typeof jobStatuses)[number];
export type JsonSchema = Record<string, unknown>;
export type JsonInput = Record<string, unknown>;

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const dollarsToCents = (amount: number) => Math.round(amount * 100);

export const policySchema = z
  .object({
    dailyBudgetCents: z.number().int().min(0).max(100_000),
    autoApproveCents: z.number().int().min(0).max(100_000),
    maxTransactionCents: z.number().int().min(0).max(100_000),
    autonomousEnabled: z.boolean(),
  })
  .refine((p) => p.autoApproveCents <= p.maxTransactionCents, {
    message: 'Auto-approval cannot exceed the transaction limit.',
  });
export type SpendingPolicy = z.infer<typeof policySchema>;
export type Budget = SpendingPolicy & {
  spentTodayCents: number;
  reservedCents: number;
  remainingCents: number;
  day: string;
};

export const searchSchema = z.object({
  query: z.string().max(300).default(''),
  requirements: z.record(z.string(), z.unknown()).optional(),
  type: z.enum(capabilityTypes).optional(),
  category: z.string().max(80).optional(),
  max_budget: z.number().nonnegative().max(1000).optional(),
  min_reliability: z.number().min(0).max(100).optional(),
  min_reputation: z.number().min(0).max(5).optional(),
  max_latency_ms: z.number().nonnegative().optional(),
  sort: z.enum(['relevance', 'price', 'reputation', 'reliability', 'latency']).default('relevance'),
});
export type SearchInput = z.infer<typeof searchSchema>;
export const quoteSchema = z.object({
  capability_id: z.string().min(1).max(100),
  input: z.record(z.string(), z.unknown()),
  reason: z.string().max(1000).optional(),
});
export const invokeSchema = z.object({
  purchase_id: z.string().min(1).max(100),
  input: z.record(z.string(), z.unknown()),
});
export const capabilityRegistrationSchema = z.object({
  providerId: z.string().min(1),
  name: z.string().min(3).max(100),
  description: z.string().min(20).max(1500),
  type: z.enum(capabilityTypes),
  category: z.string().min(2).max(80),
  priceCents: z.number().int().min(1).max(100_000),
  pricingUnit: z.string().min(1).max(30).default('query'),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  endpoint: z.string().max(500),
  httpMethod: z.enum(['POST', 'GET']).default('POST'),
  secret: z.string().max(4000).optional(),
  authHeader: z.enum(['Authorization', 'X-API-Key']).default('Authorization'),
  expectedLatencyMs: z.number().int().min(50).max(120_000),
  async: z.boolean().default(false),
  tags: z.array(z.string().max(60)).max(20).default([]),
  documentationUrl: z.url().optional(),
  availability: z.number().min(0).max(1).default(0.99),
  enabled: z.boolean().default(true),
  datasetKey: z.string().max(200).optional(),
});
export type CapabilityRegistration = z.infer<typeof capabilityRegistrationSchema>;

export interface Capability {
  id: string;
  providerId: string;
  provider: string;
  name: string;
  description: string;
  type: CapabilityType;
  category: string;
  priceCents: number;
  currency: 'USD';
  pricingUnit: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  expectedLatencyMs: number;
  avgLatencyMs: number;
  reliability: number;
  reputation: number;
  successCount: number;
  failureCount: number;
  tags: string[];
  async: boolean;
  enabled: boolean;
  version: number;
  synthetic: boolean;
  documentationUrl: string | null;
  availability: number;
  approvalRequired?: boolean;
}
export interface Agent {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  createdAt: string;
  budget: Budget;
  purchaseCount: number;
  invocationCount: number;
}
export interface Quote {
  id: string;
  agentId: string;
  capabilityId: string;
  priceCents: number;
  currency: 'USD';
  input: JsonInput;
  reason: string | null;
  createdAt: string;
  expiresAt: string;
  provider: string;
  expectedLatencyMs: number;
  approvalRequired: boolean;
}
export interface Purchase {
  id: string;
  agentId: string;
  capabilityId: string;
  quoteId: string;
  amountCents: number;
  status: PurchaseStatus;
  createdAt: string;
  updatedAt: string;
  reason: string | null;
  paymentMode: 'demo' | 'sandbox';
  orderId: string | null;
  captureId: string | null;
  approvalUrl: string | null;
  error: string | null;
  capabilityName?: string;
  provider?: string;
  agentName?: string;
}
export interface Invocation {
  id: string;
  purchaseId: string;
  capabilityId: string;
  agentId: string;
  status: JobStatus;
  latencyMs: number | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  jobId: string | null;
  capabilityName?: string;
}
export interface Job {
  id: string;
  invocationId: string;
  status: JobStatus;
  progress: number;
  result: unknown;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface Provider {
  id: string;
  name: string;
  description: string;
  reputation: number;
  capabilityCount: number;
  invocationCount: number;
  revenueCents: number;
}
export interface Activity {
  id: string;
  kind: string;
  message: string;
  entityId: string | null;
  createdAt: string;
}
export interface Dashboard {
  agents: Agent[];
  purchases: Purchase[];
  invocations: Invocation[];
  approvals: Purchase[];
  providers: Provider[];
  activity: Activity[];
  stats: {
    spentTodayCents: number;
    totalSpendCents: number;
    executions: number;
    successRate: number;
    avgLatencyMs: number;
  };
  paymentMode: 'demo' | 'sandbox';
  billingConnected: boolean;
}
export interface Session {
  user: { id: string; name: string; email: string };
  localDemo: boolean;
  paymentMode: 'demo' | 'sandbox';
}
export interface ApiErrorBody {
  error: { code: string; message: string; correlationId?: string };
}

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
