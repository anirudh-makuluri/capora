import { zeroAddress, type Address, type Hex } from 'viem';
import { ManagedFundAbi, LendingPoolAbi, PublicChitAbi, TestMarketAbi } from '@capora/bank/abis';
import { displayUnits, explorer, SIMULATED_FUNDS } from '@capora/bank';
import { DomainError } from '@capora/types';
import { accountIntent, balance } from './accounts';
import { configuration, assertChain } from './config';
import type { BankOperation } from './capabilities';
import type { Env } from '../env';
export const jsonSafe = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
export async function entityRecord(env: Env, address: Address, kind: 'fund' | 'chit') {
  const entity = await env.DB.prepare('SELECT * FROM bank_entities WHERE lower(address)=lower(?) AND kind=?')
    .bind(address, kind)
    .first<{ address: Address; kind: string; name: string; creator_agent_id: string; terms: string }>();
  if (!entity)
    throw new DomainError('BANK_ENTITY_NOT_FOUND', 'This is not an indexed Capora Bank contract.', 404);
  return entity;
}
export async function fundDetails(env: Env, address: Address, wallet: Address) {
  const entity = await entityRecord(env, address, 'fund'),
    c = await assertChain(env);
  const view = { address, abi: ManagedFundAbi } as const;
  const [
    nav,
    supply,
    shares,
    maxRedeem,
    maxWithdraw,
    strategy,
    manager,
    fee,
    allocation,
    maxTrade,
    daily,
    loss,
    paused,
    open,
  ] = await Promise.all([
    c.readContract({ ...view, functionName: 'totalAssets' }),
    c.readContract({ ...view, functionName: 'totalSupply' }),
    c.readContract({ ...view, functionName: 'balanceOf', args: [wallet] }),
    c.readContract({ ...view, functionName: 'maxRedeem', args: [wallet] }),
    c.readContract({ ...view, functionName: 'maxWithdraw', args: [wallet] }),
    c.readContract({ ...view, functionName: 'strategy' }),
    c.readContract({ ...view, functionName: 'manager' }),
    c.readContract({ ...view, functionName: 'managementFeeBps' }),
    c.readContract({ ...view, functionName: 'maxAllocationBps' }),
    c.readContract({ ...view, functionName: 'maxTrade' }),
    c.readContract({ ...view, functionName: 'dailyTradeLimit' }),
    c.readContract({ ...view, functionName: 'dailyLossBps' }),
    c.readContract({ ...view, functionName: 'paused' }),
    c.readContract({ ...view, functionName: 'subscriptionsOpen' }),
  ]);
  const cfg = configuration(env);
  const position = await c.readContract({
    address: cfg.riskToken,
    abi: (await import('@capora/bank/abis')).CaporaUSDAbi,
    functionName: 'balanceOf',
    args: [address],
  });
  const sharePrice = await c.readContract({
    address,
    abi: ManagedFundAbi,
    functionName: 'convertToAssets',
    args: [1000000000000n],
  });
  const [expenseLimit, expensesToday, schedule] = await Promise.all([
    c.readContract({ address, abi: ManagedFundAbi, functionName: 'dailyExpenseLimit' }),
    c.readContract({ address, abi: ManagedFundAbi, functionName: 'expensesToday' }),
    env.DB.prepare(
      'SELECT enabled,interval_seconds,allowed_capabilities,max_calls_per_day,calls_today,last_report FROM bank_strategy_schedules WHERE lower(fund_address)=lower(?)',
    )
      .bind(address)
      .first(),
  ]);
  return jsonSafe({
    ...entity,
    terms: JSON.parse(entity.terms),
    navUnits: nav,
    sharePriceUnits: sharePrice,
    totalShares: supply,
    shares,
    maxRedeem,
    maxWithdraw,
    strategy,
    manager,
    managementFeeBps: fee,
    maxAllocationBps: allocation,
    maxTrade,
    dailyTradeLimit: daily,
    dailyLossBps: loss,
    paused,
    subscriptionsOpen: open,
    positionUnits: position,
    dailyExpenseLimitUnits: expenseLimit,
    expensesTodayUnits: expensesToday,
    schedule,
    shareDecimals: 12,
    explorer: configuration(env).local ? null : explorer(address, 'address'),
  });
}
export async function chitDetails(env: Env, address: Address, wallet: Address) {
  const entity = await entityRecord(env, address, 'chit'),
    c = await assertChain(env);
  const [terms, count, round, completed, canceled, member, credit] = await Promise.all([
    c.readContract({ address, abi: PublicChitAbi, functionName: 'terms' }),
    c.readContract({ address, abi: PublicChitAbi, functionName: 'memberCount' }),
    c.readContract({ address, abi: PublicChitAbi, functionName: 'currentRound' }),
    c.readContract({ address, abi: PublicChitAbi, functionName: 'completed' }),
    c.readContract({ address, abi: PublicChitAbi, functionName: 'canceled' }),
    c.readContract({ address, abi: PublicChitAbi, functionName: 'membership', args: [wallet] }),
    c.readContract({ address, abi: PublicChitAbi, functionName: 'credits', args: [wallet] }),
  ]);
  const ledger = [];
  for (let i = 1; i <= round; i++)
    ledger.push({
      round: i,
      data: await c.readContract({ address, abi: PublicChitAbi, functionName: 'rounds', args: [BigInt(i)] }),
    });
  const members = [];
  for (let i = 0; i < Number(count); i++) {
    const w = await c.readContract({
      address,
      abi: PublicChitAbi,
      functionName: 'members',
      args: [BigInt(i)],
    });
    members.push({
      address: w,
      member: await c.readContract({ address, abi: PublicChitAbi, functionName: 'membership', args: [w] }),
      contributed:
        round > 0
          ? await c.readContract({
              address,
              abi: PublicChitAbi,
              functionName: 'contributed',
              args: [BigInt(round), w],
            })
          : false,
      commitment:
        round > 0
          ? await c.readContract({
              address,
              abi: PublicChitAbi,
              functionName: 'commitments',
              args: [BigInt(round), w],
            })
          : null,
      revealed:
        round > 0
          ? await c.readContract({
              address,
              abi: PublicChitAbi,
              functionName: 'revealed',
              args: [BigInt(round), w],
            })
          : false,
      bid:
        round > 0
          ? await c.readContract({
              address,
              abi: PublicChitAbi,
              functionName: 'bids',
              args: [BigInt(round), w],
            })
          : '0',
    });
  }
  return jsonSafe({
    ...entity,
    terms: {
      members: terms[0],
      installment: displayUnits(terms[1]),
      maxDiscountBps: terms[2],
      commissionBps: terms[3],
      contributionSeconds: terms[4],
      commitSeconds: terms[5],
      revealSeconds: terms[6],
      graceSeconds: terms[7],
      joinDeadline: terms[8],
    },
    memberCount: count,
    currentRound: round,
    completed,
    canceled,
    member,
    creditUnits: credit,
    members,
    ledger,
    explorer: configuration(env).local ? null : explorer(address, 'address'),
  });
}
export async function loanDetails(env: Env, id: Hex) {
  const cfg = configuration(env),
    c = await assertChain(env);
  const [loan, debt, health] = await Promise.all([
    c.readContract({ address: cfg.lending, abi: LendingPoolAbi, functionName: 'loans', args: [id] }),
    c.readContract({ address: cfg.lending, abi: LendingPoolAbi, functionName: 'debt', args: [id] }),
    c.readContract({ address: cfg.lending, abi: LendingPoolAbi, functionName: 'health', args: [id] }),
  ]);
  return jsonSafe({
    id,
    borrower: loan[0],
    principalUnits: loan[1],
    interestUnits: loan[2],
    collateralUnits: loan[3],
    lastAccrued: loan[4],
    maturity: loan[5],
    debtUnits: debt,
    healthBps: health,
  });
}
export async function bankRead(
  env: Env,
  agentId: string,
  op: BankOperation,
  input: Record<string, unknown>,
): Promise<unknown> {
  const account = await accountIntent(env, 'agent', agentId);
  if (op === 'get_accounts') return { accounts: [account], disclaimer: SIMULATED_FUNDS };
  if (op === 'get_transactions')
    return (
      await env.DB.prepare(
        'SELECT id,purpose,state,tx_hash,block_number,error,created_at FROM bank_transactions WHERE account_id=? ORDER BY created_at DESC LIMIT 100',
      )
        .bind(account.id)
        .all()
    ).results;
  if (op === 'get_balance') return balance(env, account);
  if (op === 'get_treasury_summary')
    return {
      account: await balance(env, account),
      policy: await env.DB.prepare('SELECT * FROM bank_policies WHERE agent_id=?').bind(agentId).first(),
      obligations: (await env.DB.prepare('SELECT * FROM bank_positions WHERE agent_id=?').bind(agentId).all())
        .results,
    };
  if (op === 'list_funds' || op === 'list_public_chits')
    return (
      await env.DB.prepare('SELECT * FROM bank_entities WHERE kind=? ORDER BY created_at DESC LIMIT 100')
        .bind(op === 'list_funds' ? 'fund' : 'chit')
        .all()
    ).results;
  const wallet = { ...account, address: account.address ?? zeroAddress };
  if (op === 'fund_details' || op === 'fund_performance') {
    const details = await fundDetails(env, input.address as Address, wallet.address);
    return op === 'fund_details'
      ? details
      : {
          details,
          snapshots: (
            await env.DB.prepare(
              'SELECT * FROM bank_snapshots WHERE lower(entity_address)=lower(?) ORDER BY created_at DESC LIMIT 100',
            )
              .bind(input.address)
              .all()
          ).results,
          disclosure:
            'NAV uses actual token positions and the disclosed controlled test-market price. No guaranteed return.',
        };
  }
  if (op === 'chit_status') return chitDetails(env, input.address as Address, wallet.address);
  if (op === 'loan_details') {
    const owned = await env.DB.prepare(
      "SELECT id FROM bank_positions WHERE agent_id=? AND onchain_id=? AND kind='loan'",
    )
      .bind(agentId, input.loan_id)
      .first();
    if (!owned) throw new DomainError('NOT_FOUND', 'Loan not found for this agent.', 404);
    return loanDetails(env, input.loan_id as Hex);
  }
  if (op === 'list_loans') {
    const positions = await env.DB.prepare(
      "SELECT onchain_id FROM bank_positions WHERE agent_id=? AND kind='loan'",
    )
      .bind(agentId)
      .all<{ onchain_id: Hex }>();
    return Promise.all(positions.results.map((p) => loanDetails(env, p.onchain_id)));
  }
  if (op === 'quote_loan') {
    const cfg = configuration(env),
      c = await assertChain(env),
      { units } = await import('@capora/bank');
    const price = await c.readContract({
      address: cfg.market,
      abi: TestMarketAbi,
      functionName: 'freshPrice',
    });
    return {
      maxBorrowUnits: ((units(String(input.collateral)) * price) / 1000000n / 2n).toString(),
      requestedUnits: units(String(input.amount)).toString(),
      aprBps: 800,
      liquidationLtvBps: 6500,
      spreadBps: 2000,
      maturity: input.maturity,
      collateralAsset: cfg.riskToken,
      priceModel: 'Artificial test market; price expires after one hour.',
    };
  }
  throw new DomainError('BANK_READ_NOT_ALLOWED', 'Unknown read operation.');
}
