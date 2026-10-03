import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../apps/worker/src/services/policy';
import { DEFAULT_POLICY } from '../packages/config/src/index';
import { policySchema } from '../packages/types/src/index';
describe('Spending policy independent of payment processing', () => {
  it('automatically approves a $0.20 purchase', () =>
    expect(evaluatePolicy(DEFAULT_POLICY, 20, 0)).toBe('approved'));
  it('treats the $0.50 boundary inclusively', () =>
    expect(evaluatePolicy(DEFAULT_POLICY, 50, 0)).toBe('approved'));
  it('requires human approval for a $3 purchase', () =>
    expect(evaluatePolicy(DEFAULT_POLICY, 300, 0)).toBe('pending_approval'));
  it('requires humans when autonomous purchasing is disabled', () =>
    expect(evaluatePolicy({ ...DEFAULT_POLICY, autonomousEnabled: false }, 20, 0)).toBe('pending_approval'));
  it('rejects a transaction over its maximum', () =>
    expect(() => evaluatePolicy(DEFAULT_POLICY, 1001, 0)).toThrow('transaction limit'));
  it('rejects purchases over the daily budget including reservations', () =>
    expect(() => evaluatePolicy(DEFAULT_POLICY, 20, 2490)).toThrow('daily budget'));
  it('rejects fractional cents', () =>
    expect(() => evaluatePolicy(DEFAULT_POLICY, 0.2, 0)).toThrow('integer'));
  it('rejects negative spending policies', () =>
    expect(policySchema.safeParse({ ...DEFAULT_POLICY, dailyBudgetCents: -1 }).success).toBe(false));
  it('rejects auto-approval above maximum transaction', () =>
    expect(policySchema.safeParse({ ...DEFAULT_POLICY, autoApproveCents: 1001 }).success).toBe(false));
});
