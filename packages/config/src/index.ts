export const DEFAULT_POLICY = {
  dailyBudgetCents: 2500,
  autoApproveCents: 50,
  maxTransactionCents: 1000,
  autonomousEnabled: true,
};
export const QUOTE_TTL_MS = 5 * 60 * 1000;
export const RESERVED_STATUSES = ['pending_approval', 'approved', 'payment_pending', 'purchased'] as const;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const PROVIDER_TIMEOUT_MS = 25_000;
export const DEFAULT_USER_ID = 'user_demo';
// Intentionally far below R2's account-wide free allowance. Do not raise without an operator cost review.
export const R2_BUDGET = {
  retainedBytes: 100_000_000,
  writesPerDay: 1_000,
  readsPerDay: 10_000,
};
