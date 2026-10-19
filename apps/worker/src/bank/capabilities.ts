import { z } from 'zod';
import { isAddress } from 'viem';
import { DomainError } from '@capora/types';
const amount = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/);
const shares = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,12})?$/);
const address = z.string().refine(isAddress, 'Use a valid contract or wallet address.');
const entity = { address };
const loan = { loan_id: z.string().regex(/^0x[\da-fA-F]{64}$/) };
const empty = z.object({}).strict();
export const bankSchemas = {
  get_accounts: empty,
  get_balance: empty,
  get_transactions: empty,
  get_treasury_summary: empty,
  transfer: z.object({ to: address, amount }).strict(),
  claim_provider_earnings: z.object({ provider_id: z.string().min(1).max(100), amount }).strict(),
  set_spending_policy: z
    .object({
      destinations: z.array(address).max(50),
      max_investment_cents: z.number().int().min(0).max(100000),
      max_loan_cents: z.number().int().min(0).max(100000),
      max_chit_cents: z.number().int().min(0).max(100000),
    })
    .strict(),
  create_fund: z
    .object({
      name: z.string().min(2).max(80),
      strategy: z.string().min(10).max(1000),
      management_fee_bps: z.number().int().min(0).max(500),
      max_allocation_bps: z.number().int().min(1).max(8000),
      max_trade: amount,
      daily_trade_limit: amount,
      daily_loss_bps: z.number().int().min(0).max(1000),
      daily_expense_limit: amount.default('0'),
    })
    .strict(),
  list_funds: empty,
  fund_details: z.object(entity).strict(),
  fund_performance: z.object(entity).strict(),
  invest: z.object({ ...entity, amount, min_shares: shares }).strict(),
  redeem: z.object({ ...entity, shares, min_assets: amount }).strict(),
  rebalance_fund: z
    .object({
      ...entity,
      buy: z.boolean(),
      amount,
      min_output: amount,
      deadline: z.number().int().positive(),
      explanation: z.string().min(5).max(500),
    })
    .strict(),
  fund_controls: z.object({ ...entity, paused: z.boolean(), subscriptions_open: z.boolean() }).strict(),
  list_loans: empty,
  quote_loan: z.object({ collateral: amount, amount, maturity: z.number().int().positive() }).strict(),
  open_collateralized_loan: z
    .object({ collateral: amount, amount, maturity: z.number().int().positive() })
    .strict(),
  repay_loan: z.object({ ...loan, amount }).strict(),
  add_collateral: z.object({ ...loan, amount }).strict(),
  withdraw_collateral: z.object({ ...loan, amount }).strict(),
  loan_details: z.object(loan).strict(),
  liquidate_loan: z.object({ ...loan, amount }).strict(),
  supply_liquidity: z.object({ amount, min_shares: shares }).strict(),
  redeem_liquidity: z.object({ shares, min_assets: amount }).strict(),
  create_chit: z
    .object({
      name: z.string().min(2).max(80),
      members: z.number().int().min(2).max(24),
      installment: amount,
      max_discount_bps: z.number().int().min(0).max(4000),
      commission_bps: z.number().int().min(0).max(500),
      contribution_seconds: z.number().int().min(60).max(2678400),
      commit_seconds: z.number().int().min(30).max(604800),
      reveal_seconds: z.number().int().min(30).max(604800),
      grace_seconds: z.number().int().min(30).max(604800),
      join_deadline: z.number().int().positive(),
    })
    .strict(),
  list_public_chits: empty,
  join_chit: z.object({ ...entity, security: amount }).strict(),
  contribute: z.object(entity).strict(),
  place_chit_bid: z
    .object({
      ...entity,
      round: z.number().int().min(1).max(24),
      phase: z.enum(['commit', 'reveal']),
      discount: amount,
      salt: z.string().regex(/^0x[\da-fA-F]{64}$/),
    })
    .strict(),
  chit_status: z.object(entity).strict(),
  claim_chit_payout: z.object(entity).strict(),
  top_up_chit_security: z.object({ ...entity, amount }).strict(),
  top_up_chit_bond: z.object({ ...entity, amount }).strict(),
  finalize_chit: z.object(entity).strict(),
  exit_chit: z.object(entity).strict(),
  cancel_unfilled_chit: z.object(entity).strict(),
  recover_chit_default: z
    .object({ ...entity, member: address, min_output: amount, deadline: z.number().int().positive() })
    .strict(),
} as const;
export type BankOperation = keyof typeof bankSchemas;
export const readOperations = new Set<BankOperation>([
  'get_accounts',
  'get_balance',
  'get_transactions',
  'get_treasury_summary',
  'list_funds',
  'fund_details',
  'fund_performance',
  'list_loans',
  'quote_loan',
  'loan_details',
  'list_public_chits',
  'chit_status',
]);
export const humanOperations = new Set<BankOperation>([
  'set_spending_policy',
  'create_fund',
  'create_chit',
  'fund_controls',
]);
export function bankOperation(endpoint: string): BankOperation {
  const name = endpoint.replace('bank://', '');
  if (!Object.hasOwn(bankSchemas, name))
    throw new DomainError('BANK_ACTION_NOT_ALLOWED', 'Unknown bank operation.');
  return name as BankOperation;
}
export function bankInput(operation: BankOperation, input: Record<string, unknown>): Record<string, unknown> {
  return bankSchemas[operation].parse(input);
}
export function bankCatalogStatements(ownerId: string, now: string, q: (v: unknown) => string) {
  const statements = [
    `INSERT INTO providers(id,user_id,name,description,reputation,created_at) VALUES('provider_capora_bank',${q(ownerId)},'Capora Bank','First-party Base Sepolia financial services. TESTNET / SIMULATED FUNDS.',0,${q(now)}) ON CONFLICT DO NOTHING;`,
  ];
  for (const [op, schema] of Object.entries(bankSchemas)) {
    const description = `Capora Bank: ${op.replaceAll('_', ' ')}. Base Sepolia only. cUSD is simulated USD, not redeemable. ${readOperations.has(op as BankOperation) ? 'Read-only, no service fee.' : 'Requires wallet ownership, an immutable quote and spending policy authorization. Contract fees are disclosed before execution.'}`;
    statements.push(
      `INSERT INTO capabilities(id,provider_id,name,description,type,category,price_cents,currency,pricing_unit,input_schema,output_schema,endpoint,expected_latency_ms,tags,async,created_at) VALUES(${q(`bank_${op}`)},'provider_capora_bank',${q(`bank.${op}`)},${q(description)},'agent','Capora Bank',0,'USD','action',${q(z.toJSONSchema(schema))},${q({ type: 'object' })},${q(`bank://${op}`)},1000,'["bank","testnet","cUSD"]',${readOperations.has(op as BankOperation) ? 0 : 1},${q(now)}) ON CONFLICT(id) DO UPDATE SET input_schema=excluded.input_schema,description=excluded.description,async=excluded.async WHERE capabilities.provider_id='provider_capora_bank';`,
    );
  }
  return statements;
}
