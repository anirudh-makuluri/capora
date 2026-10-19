import { encodeFunctionData, zeroAddress, type Address } from 'viem';
import { WalletFactoryAbi, CaporaUSDAbi } from '@capora/bank/abis';
import { displayUnits, explorer } from '@capora/bank';
import { DomainError } from '@capora/types';
import { configuration, assertChain } from './config';
import { chainKey, transaction, requireConfirmed } from './chain';
import type { Env } from '../env';
export interface BankAccount {
  id: string;
  user_id: string;
  agent_id: string | null;
  provider_id: string | null;
  identity: `0x${string}`;
  address: Address;
  state: string;
}
export async function accountIntent(
  env: Env,
  kind: 'agent' | 'provider',
  entityId: string,
): Promise<BankAccount> {
  const table = kind === 'agent' ? 'agents' : 'providers';
  const owner = await env.DB.prepare(`SELECT user_id FROM ${table} WHERE id=?`)
    .bind(entityId)
    .first<{ user_id: string }>();
  if (!owner) throw new DomainError('NOT_FOUND', 'Account owner not found.', 404);
  const accountId = `${kind}:${entityId}`;
  await env.DB.prepare(
    `INSERT INTO bank_accounts(id,user_id,agent_id,provider_id,identity,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
  )
    .bind(
      accountId,
      owner.user_id,
      kind === 'agent' ? entityId : null,
      kind === 'provider' ? entityId : null,
      chainKey(`capora:84532:${kind}:${entityId}`),
      new Date().toISOString(),
    )
    .run();
  return (await env.DB.prepare('SELECT * FROM bank_accounts WHERE id=?')
    .bind(accountId)
    .first<BankAccount>())!;
}
export async function ensureAccount(
  env: Env,
  kind: 'agent' | 'provider',
  entityId: string,
): Promise<BankAccount> {
  const account = await accountIntent(env, kind, entityId);
  const cfg = configuration(env),
    client = await assertChain(env);
  let address = await client.readContract({
    address: cfg.walletFactory,
    abi: WalletFactoryAbi,
    functionName: 'wallets',
    args: [account.identity],
  });
  if (address === zeroAddress) {
    requireConfirmed(
      await transaction(
        env,
        `wallet:${account.id}`,
        'provision_wallet',
        cfg.walletFactory,
        encodeFunctionData({ abi: WalletFactoryAbi, functionName: 'create', args: [account.identity] }),
        account.id,
      ),
    );
    address = await client.readContract({
      address: cfg.walletFactory,
      abi: WalletFactoryAbi,
      functionName: 'wallets',
      args: [account.identity],
    });
  }
  if (address === zeroAddress || !(await client.getCode({ address })))
    throw new DomainError('WALLET_NOT_CONFIRMED', 'Wallet deployment is not yet confirmed.', 409);
  await env.DB.prepare("UPDATE bank_accounts SET address=?,state='active' WHERE id=?")
    .bind(address, account.id)
    .run();
  return { ...account, address, state: 'active' };
}
export async function balance(env: Env, account: BankAccount) {
  const cfg = configuration(env),
    client = await assertChain(env);
  if (!account.address) return { ...account, balance: null, gas: null };
  const [token, gas, collateral] = await Promise.all([
    client.readContract({
      address: cfg.token,
      abi: CaporaUSDAbi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
    client.getBalance({ address: account.address }),
    client.readContract({
      address: cfg.riskToken,
      abi: CaporaUSDAbi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ]);
  return {
    ...account,
    balance: displayUnits(token),
    balanceUnits: token.toString(),
    gas: displayUnits(gas, 18),
    collateral: displayUnits(collateral),
    network: cfg.local ? 'local_evm' : 'base_sepolia',
    explorer: cfg.local ? null : explorer(account.address, 'address'),
  };
}
