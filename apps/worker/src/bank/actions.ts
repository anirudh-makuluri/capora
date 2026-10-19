import { encodeFunctionData, encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import {
  AgentWalletAbi,
  CaporaUSDAbi,
  ManagedFundAbi,
  LendingPoolAbi,
  PublicChitAbi,
  TestMarketAbi,
  BankFactoryAbi,
} from '@capora/bank/abis';
import { units, unitsToCents, explorer, SIMULATED_FUNDS } from '@capora/bank';
import { DomainError } from '@capora/types';
import {
  bankInput,
  bankOperation,
  readOperations,
  humanOperations,
  type BankOperation,
} from './capabilities';
import { configuration, assertChain } from './config';
import { chainKey, walletTransaction, requireConfirmed } from './chain';
import { ensureAccount } from './accounts';
import { bankRead, entityRecord, jsonSafe } from './read';
import type { Env } from '../env';
const n = (input: Record<string, unknown>, key: string) => units(String(input[key]));
export async function validateBankQuoteDeadline(env: Env, input: Record<string, unknown>) {
  if (typeof input.deadline !== 'number') return;
  const client = await assertChain(env);
  const now = (await client.getBlock()).timestamp;
  const deadline = BigInt(input.deadline);
  if (deadline <= now || deadline > now + 600n)
    throw new DomainError(
      'INVALID_BANK_DEADLINE',
      'Choose a transaction deadline within the next ten minutes.',
    );
}
export interface FinancialPolicy {
  destinations: string;
  max_investment_cents: number;
  max_loan_cents: number;
  max_chit_cents: number;
}
export async function actionCost(
  env: Env,
  agentId: string,
  op: BankOperation,
  input: Record<string, unknown>,
): Promise<number> {
  if (readOperations.has(op) || humanOperations.has(op)) return 0;
  if (input.amount !== undefined && n(input, 'amount') === 0n)
    throw new DomainError('INVALID_AMOUNT', 'A financial action amount must be greater than zero.');
  const policy = await env.DB.prepare('SELECT * FROM bank_policies WHERE agent_id=?')
    .bind(agentId)
    .first<FinancialPolicy>();
  let value = 0n,
    limit: number | undefined;
  if (
    [
      'transfer',
      'claim_provider_earnings',
      'invest',
      'supply_liquidity',
      'open_collateralized_loan',
      'repay_loan',
      'liquidate_loan',
      'top_up_chit_bond',
    ].includes(op)
  )
    value = n(input, 'amount');
  if (
    op === 'transfer' &&
    !(JSON.parse(policy?.destinations ?? '[]') as string[]).some(
      (a) => a.toLowerCase() === String(input.to).toLowerCase(),
    )
  )
    throw new DomainError(
      'DESTINATION_NOT_ALLOWED',
      'The owner must explicitly allow this recipient in the Bank policy.',
      403,
    );
  if (['invest', 'supply_liquidity', 'rebalance_fund'].includes(op))
    limit = policy?.max_investment_cents ?? 0;
  if (op === 'rebalance_fund') {
    const cfg = configuration(env),
      c = await assertChain(env);
    value = input.buy
      ? n(input, 'amount')
      : (n(input, 'amount') *
          (await c.readContract({ address: cfg.market, abi: TestMarketAbi, functionName: 'freshPrice' }))) /
        1000000n;
  }
  if (['open_collateralized_loan', 'add_collateral'].includes(op)) limit = policy?.max_loan_cents ?? 0;
  if (['join_chit', 'contribute', 'top_up_chit_security', 'top_up_chit_bond'].includes(op)) {
    const address = input.address as Address;
    await entityRecord(env, address, 'chit');
    const c = await assertChain(env),
      terms = await c.readContract({ address, abi: PublicChitAbi, functionName: 'terms' });
    if (op === 'join_chit') value = terms[1] * BigInt(terms[0] + 1); // Bond plus the full future installment obligation.
    if (op === 'contribute') value = terms[1];
    limit = policy?.max_chit_cents ?? 0;
  }
  if (op === 'add_collateral' || op === 'top_up_chit_security') {
    const cfg = configuration(env),
      c = await assertChain(env);
    value =
      (n(input, 'amount') *
        (await c.readContract({ address: cfg.market, abi: TestMarketAbi, functionName: 'freshPrice' }))) /
      1000000n;
  }
  const cents = unitsToCents(value);
  if (limit !== undefined && (limit === 0 || cents > limit))
    throw new DomainError(
      'FINANCIAL_LIMIT_EXCEEDED',
      'The owner must authorize this investment, loan, or chit exposure in the Bank policy.',
      403,
    );
  return cents;
}
export async function executeBank(
  env: Env,
  agentId: string,
  invocationId: string,
  endpoint: string,
  raw: Record<string, unknown>,
) {
  const op = bankOperation(endpoint),
    input = bankInput(op, raw);
  const agent = await env.DB.prepare("SELECT id,user_id FROM agents WHERE id=? AND status='active'")
    .bind(agentId)
    .first<{ id: string; user_id: string }>();
  if (!agent) throw new DomainError('UNAUTHORIZED', 'Active agent ownership is required.', 401);
  if (readOperations.has(op)) return jsonSafe(await bankRead(env, agentId, op, input));
  // Revalidate current delegated policy immediately before constructing the typed transaction.
  await actionCost(env, agentId, op, input);
  const auth = await env.DB.prepare(
    'SELECT p.id,p.status,p.amount_cents,a.status AS approval,s.max_transaction_cents,s.auto_approve_cents,s.autonomous_enabled FROM invocations i JOIN purchases p ON p.id=i.purchase_id JOIN spending_policies s ON s.agent_id=p.agent_id LEFT JOIN approvals a ON a.purchase_id=p.id WHERE i.id=? AND p.agent_id=?',
  )
    .bind(invocationId, agentId)
    .first<{
      id: string;
      status: string;
      approval: string | null;
      amount_cents: number;
      max_transaction_cents: number;
      auto_approve_cents: number;
      autonomous_enabled: number;
    }>();
  if (!auth || auth.status !== 'purchased' || (humanOperations.has(op) && auth.approval !== 'approved'))
    throw new DomainError(
      'HUMAN_APPROVAL_REQUIRED',
      'This bank action requires its original owner-approved quote.',
      403,
    );
  if (
    auth.amount_cents > auth.max_transaction_cents ||
    ((!auth.autonomous_enabled || auth.amount_cents > auth.auto_approve_cents) &&
      auth.approval !== 'approved')
  )
    throw new DomainError(
      'POLICY_CHANGED',
      'Current spending limits no longer permit this action. Request a new quote and approval.',
      403,
    );
  if (op === 'set_spending_policy') {
    await env.DB.prepare(
      'INSERT INTO bank_policies(agent_id,destinations,max_investment_cents,max_loan_cents,max_chit_cents,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET destinations=excluded.destinations,max_investment_cents=excluded.max_investment_cents,max_loan_cents=excluded.max_loan_cents,max_chit_cents=excluded.max_chit_cents,updated_at=excluded.updated_at',
    )
      .bind(
        agentId,
        JSON.stringify(input.destinations),
        input.max_investment_cents,
        input.max_loan_cents,
        input.max_chit_cents,
        new Date().toISOString(),
      )
      .run();
    return { action: op, authorizedBy: agent.user_id, policy: input };
  }
  let account = await ensureAccount(env, 'agent', agentId);
  const ownedAgentAccount = account,
    cfg = configuration(env),
    client = await assertChain(env);
  const operation = `bank:${invocationId}`,
    actionKey = chainKey(operation);
  let target: Address = cfg.token,
    calldata: Hex;
  const approve = async (token: Address, spender: Address, amount: bigint, suffix: string) => {
    const data = encodeFunctionData({ abi: CaporaUSDAbi, functionName: 'approve', args: [spender, amount] });
    requireConfirmed(
      await walletTransaction(
        env,
        `${operation}:approve:${suffix}`,
        'bounded_token_approval',
        account,
        token,
        data,
      ),
    );
  };
  if (input.address)
    await entityRecord(
      env,
      input.address as Address,
      op.includes('chit') || op === 'contribute' ? 'chit' : 'fund',
    );
  switch (op) {
    case 'claim_provider_earnings': {
      const provider = await env.DB.prepare('SELECT id FROM providers WHERE id=? AND user_id=?')
        .bind(input.provider_id, agent.user_id)
        .first();
      if (!provider)
        throw new DomainError('NOT_FOUND', 'Provider earnings are not owned by this account.', 404);
      account = await ensureAccount(env, 'provider', String(input.provider_id));
      calldata = encodeFunctionData({
        abi: CaporaUSDAbi,
        functionName: 'transfer',
        args: [ownedAgentAccount.address, n(input, 'amount')],
      });
      break;
    }
    case 'transfer':
      calldata = encodeFunctionData({
        abi: CaporaUSDAbi,
        functionName: 'transfer',
        args: [input.to as Address, n(input, 'amount')],
      });
      break;
    case 'create_fund':
      target = cfg.bankFactory;
      calldata = encodeFunctionData({
        abi: BankFactoryAbi,
        functionName: 'createFund',
        args: [
          actionKey,
          String(input.name),
          String(input.strategy),
          Number(input.management_fee_bps),
          Number(input.max_allocation_bps),
          n(input, 'max_trade'),
          n(input, 'daily_trade_limit'),
          Number(input.daily_loss_bps),
          n(input, 'daily_expense_limit'),
        ],
      });
      break;
    case 'invest':
      target = input.address as Address;
      await approve(cfg.token, target, n(input, 'amount'), 'usd');
      calldata = encodeFunctionData({
        abi: ManagedFundAbi,
        functionName: 'invest',
        args: [n(input, 'amount'), units(String(input.min_shares), 12)],
      });
      break;
    case 'redeem':
      target = input.address as Address;
      calldata = encodeFunctionData({
        abi: ManagedFundAbi,
        functionName: 'redeemWithMin',
        args: [units(String(input.shares), 12), n(input, 'min_assets')],
      });
      break;
    case 'rebalance_fund':
      target = input.address as Address;
      calldata = encodeFunctionData({
        abi: ManagedFundAbi,
        functionName: 'rebalance',
        args: [
          Boolean(input.buy),
          n(input, 'amount'),
          n(input, 'min_output'),
          BigInt(Number(input.deadline)),
          String(input.explanation),
        ],
      });
      break;
    case 'fund_controls':
      target = input.address as Address;
      calldata = encodeFunctionData({
        abi: ManagedFundAbi,
        functionName: 'controls',
        args: [Boolean(input.paused), Boolean(input.subscriptions_open)],
      });
      break;
    case 'open_collateralized_loan':
      target = cfg.lending;
      await approve(cfg.riskToken, target, n(input, 'collateral'), 'collateral');
      calldata = encodeFunctionData({
        abi: LendingPoolAbi,
        functionName: 'open',
        args: [actionKey, n(input, 'collateral'), n(input, 'amount'), BigInt(Number(input.maturity))],
      });
      break;
    case 'repay_loan':
    case 'liquidate_loan':
      target = cfg.lending;
      await approve(cfg.token, target, n(input, 'amount'), 'usd');
      calldata = encodeFunctionData({
        abi: LendingPoolAbi,
        functionName: op === 'repay_loan' ? 'repay' : 'liquidate',
        args: [input.loan_id as Hex, n(input, 'amount')],
      });
      break;
    case 'add_collateral':
      target = cfg.lending;
      await approve(cfg.riskToken, target, n(input, 'amount'), 'collateral');
      calldata = encodeFunctionData({
        abi: LendingPoolAbi,
        functionName: 'addCollateral',
        args: [input.loan_id as Hex, n(input, 'amount')],
      });
      break;
    case 'withdraw_collateral':
      target = cfg.lending;
      calldata = encodeFunctionData({
        abi: LendingPoolAbi,
        functionName: 'withdrawCollateral',
        args: [input.loan_id as Hex, n(input, 'amount')],
      });
      break;
    case 'supply_liquidity':
      target = cfg.lending;
      await approve(cfg.token, target, n(input, 'amount'), 'usd');
      calldata = encodeFunctionData({
        abi: LendingPoolAbi,
        functionName: 'invest',
        args: [n(input, 'amount'), units(String(input.min_shares), 12)],
      });
      break;
    case 'redeem_liquidity':
      target = cfg.lending;
      {
        const shares = units(String(input.shares), 12),
          preview = await client.readContract({
            address: target,
            abi: LendingPoolAbi,
            functionName: 'previewRedeem',
            args: [shares],
          });
        if (preview < n(input, 'min_assets'))
          throw new DomainError('SLIPPAGE', 'Lending redemption is below your minimum.');
        calldata = encodeFunctionData({
          abi: LendingPoolAbi,
          functionName: 'redeemWithMin',
          args: [shares, n(input, 'min_assets')],
        });
        break;
      }
    case 'create_chit':
      target = cfg.bankFactory;
      calldata = encodeFunctionData({
        abi: BankFactoryAbi,
        functionName: 'createChit',
        args: [
          actionKey,
          {
            members: Number(input.members),
            installment: n(input, 'installment'),
            maxDiscountBps: Number(input.max_discount_bps),
            commissionBps: Number(input.commission_bps),
            contributionSeconds: Number(input.contribution_seconds),
            commitSeconds: Number(input.commit_seconds),
            revealSeconds: Number(input.reveal_seconds),
            graceSeconds: Number(input.grace_seconds),
            joinDeadline: BigInt(Number(input.join_deadline)),
          },
        ],
      });
      break;
    case 'join_chit':
      target = input.address as Address;
      {
        const terms = await client.readContract({
          address: target,
          abi: PublicChitAbi,
          functionName: 'terms',
        });
        await approve(cfg.token, target, terms[1], 'bond');
        if (n(input, 'security') > 0n) await approve(cfg.riskToken, target, n(input, 'security'), 'security');
        calldata = encodeFunctionData({
          abi: PublicChitAbi,
          functionName: 'join',
          args: [n(input, 'security')],
        });
        break;
      }
    case 'contribute':
      target = input.address as Address;
      {
        const terms = await client.readContract({
          address: target,
          abi: PublicChitAbi,
          functionName: 'terms',
        });
        await approve(cfg.token, target, terms[1], 'installment');
        calldata = encodeFunctionData({ abi: PublicChitAbi, functionName: 'contribute' });
        break;
      }
    case 'place_chit_bid':
      target = input.address as Address;
      {
        const round = await client.readContract({
          address: target,
          abi: PublicChitAbi,
          functionName: 'currentRound',
        });
        if (round !== Number(input.round))
          throw new DomainError('CHIT_ROUND_CHANGED', 'The quoted auction round has changed.');
        const commitment = keccak256(
          encodeAbiParameters(
            [
              { type: 'uint256' },
              { type: 'address' },
              { type: 'uint16' },
              { type: 'address' },
              { type: 'uint256' },
              { type: 'bytes32' },
            ],
            [84532n, target, round, account.address, n(input, 'discount'), input.salt as Hex],
          ),
        );
        calldata =
          input.phase === 'commit'
            ? encodeFunctionData({ abi: PublicChitAbi, functionName: 'commitBid', args: [commitment] })
            : encodeFunctionData({
                abi: PublicChitAbi,
                functionName: 'revealBid',
                args: [n(input, 'discount'), input.salt as Hex],
              });
        break;
      }
    case 'top_up_chit_security':
    case 'top_up_chit_bond':
      target = input.address as Address;
      await approve(
        op === 'top_up_chit_security' ? cfg.riskToken : cfg.token,
        target,
        n(input, 'amount'),
        'topup',
      );
      calldata = encodeFunctionData({
        abi: PublicChitAbi,
        functionName: op === 'top_up_chit_security' ? 'topUpSecurity' : 'topUpBond',
        args: [n(input, 'amount')],
      });
      break;
    case 'claim_chit_payout':
    case 'finalize_chit':
    case 'exit_chit':
    case 'cancel_unfilled_chit':
      target = input.address as Address;
      calldata = encodeFunctionData({
        abi: PublicChitAbi,
        functionName:
          op === 'claim_chit_payout'
            ? 'claim'
            : op === 'finalize_chit'
              ? 'finalize'
              : op === 'exit_chit'
                ? 'exit'
                : 'cancelUnfilled',
      });
      break;
    case 'recover_chit_default':
      target = input.address as Address;
      calldata = encodeFunctionData({
        abi: PublicChitAbi,
        functionName: 'recoverDefault',
        args: [input.member as Address, n(input, 'min_output'), BigInt(Number(input.deadline))],
      });
      break;
    default:
      throw new DomainError('BANK_ACTION_NOT_ALLOWED', 'Unsupported bank operation.');
  }
  const tx = requireConfirmed(await walletTransaction(env, operation, op, account, target, calldata));
  const now = new Date().toISOString();
  if (op === 'create_fund' || op === 'create_chit') {
    const address = await client.readContract({
      address: cfg.bankFactory,
      abi: BankFactoryAbi,
      functionName: 'entities',
      args: [actionKey],
    });
    await env.DB.prepare(
      'INSERT INTO bank_entities(id,address,kind,creator_agent_id,name,terms,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(
        operation,
        address,
        op === 'create_fund' ? 'fund' : 'chit',
        agentId,
        input.name,
        JSON.stringify(input),
        now,
      )
      .run();
    return {
      action: op,
      address,
      txHash: tx.tx_hash,
      network: cfg.local ? 'local_evm' : 'base_sepolia',
      explorer: cfg.local ? null : explorer(tx.tx_hash!),
      disclaimer: SIMULATED_FUNDS,
    };
  }
  if (op === 'open_collateralized_loan' || op === 'invest' || op === 'join_chit' || op === 'supply_liquidity')
    await env.DB.prepare(
      'INSERT INTO bank_positions(id,agent_id,entity_address,kind,onchain_id,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(
        operation,
        agentId,
        target,
        op === 'open_collateralized_loan'
          ? 'loan'
          : op === 'join_chit'
            ? 'chit'
            : op === 'invest'
              ? 'fund'
              : 'liquidity',
        actionKey,
        now,
      )
      .run();
  await env.DB.prepare(
    'INSERT INTO bank_events(id,source,tx_hash,block_number,block_hash,data,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(
      operation,
      'bank_action',
      tx.tx_hash,
      tx.block_number,
      tx.block_hash,
      JSON.stringify({ agentId, authorizedBy: agent.user_id, action: op, target, input }),
      now,
    )
    .run();
  if (op === 'invest' || op === 'rebalance_fund' || op === 'redeem') {
    const data = await bankRead(env, agentId, 'fund_details', { address: target });
    await env.DB.prepare(
      'INSERT INTO bank_snapshots(id,entity_address,block_number,data,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(operation, target, tx.block_number, JSON.stringify(data), now)
      .run();
  }
  // Bounded approvals are reset after partial repayments and liquidity-constrained operations.
  if (['repay_loan', 'liquidate_loan'].includes(op)) await approve(cfg.token, target, 0n, 'reset');
  return {
    action: op,
    loanId: op === 'open_collateralized_loan' ? actionKey : undefined,
    state: 'confirmed',
    txHash: tx.tx_hash,
    network: cfg.local ? 'local_evm' : 'base_sepolia',
    explorer: cfg.local ? null : explorer(tx.tx_hash!),
    disclaimer: SIMULATED_FUNDS,
  };
}
export async function walletAlreadyExecuted(env: Env, agentId: string, operation: string) {
  const account = await ensureAccount(env, 'agent', agentId),
    c = await assertChain(env);
  return c.readContract({
    address: account.address,
    abi: AgentWalletAbi,
    functionName: 'executed',
    args: [chainKey(operation)],
  });
}
