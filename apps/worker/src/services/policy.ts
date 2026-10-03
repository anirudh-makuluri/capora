import { DomainError, type SpendingPolicy } from '@capora/types';
export type PolicyDecision = 'approved' | 'pending_approval';
export function evaluatePolicy(
  policy: SpendingPolicy,
  amountCents: number,
  committedCents: number,
): PolicyDecision {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
    throw new DomainError('INVALID_AMOUNT', 'Amount must be a positive integer in cents.');
  if (amountCents > policy.maxTransactionCents)
    throw new DomainError(
      'TRANSACTION_LIMIT_EXCEEDED',
      'This purchase exceeds the agent’s transaction limit.',
    );
  if (committedCents + amountCents > policy.dailyBudgetCents)
    throw new DomainError('INSUFFICIENT_BUDGET', 'There is not enough unreserved daily budget.');
  return policy.autonomousEnabled && amountCents <= policy.autoApproveCents ? 'approved' : 'pending_approval';
}
