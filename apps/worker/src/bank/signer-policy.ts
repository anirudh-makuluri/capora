import { decodeFunctionData, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { AgentWalletAbi, WalletFactoryAbi, PublicChitAbi } from '@capora/bank/abis';
import { DomainError } from '@capora/types';
import { assertChain, configuration } from './config';
import { addPrivyConditionItem } from './privy';
import type { Env } from '../env';

export async function enrollSignerTarget(env: Env, target: Address, kind: 'wallet' | 'chit') {
  const cfg = configuration(env);
  if (cfg.local) return;
  const setId = kind === 'wallet' ? env.BANK_PRIVY_WALLET_SET_ID : env.BANK_PRIVY_CHIT_SET_ID;
  if (!setId || !/^[a-z0-9]{24}$/.test(setId))
    throw new DomainError('SIGNER_ENROLLMENT_REQUIRED', 'Configure the Bank signer condition sets.', 503);
  const operation = keccak256(
    stringToHex(
      `bank-enrollment:${cfg.walletFactory.toLowerCase()}:${kind}:${setId}:${target.toLowerCase()}`,
    ),
  );
  // Successful membership is durable. Changing the set ID invalidates the cache.
  // Operator removal is not silently undone by a later transaction retry.
  if (
    await env.DB.prepare("SELECT id FROM bank_events WHERE id=? AND source='signer_enrollment'")
      .bind(operation)
      .first()
  )
    return;
  const client = await assertChain(env);
  const head = await client.getBlockNumber();
  if (head < BigInt(cfg.confirmations))
    throw new DomainError('SIGNER_TARGET_PENDING', 'The Bank destination needs chain confirmations.', 409);
  const blockNumber = head - BigInt(cfg.confirmations - 1);
  const deny = () =>
    new DomainError(
      'SIGNER_TARGET_NOT_REGISTERED',
      'The signer destination is not a confirmed registered Bank contract.',
      403,
    );
  if (!(await client.getCode({ address: target, blockNumber }))) throw deny();
  const registered = await client.readContract({
    address: cfg.walletFactory,
    abi: WalletFactoryAbi,
    functionName: kind === 'wallet' ? 'isWallet' : 'chits',
    args: [target],
    blockNumber,
  });
  if (!registered) throw deny();
  if (kind === 'wallet') {
    const authority = await client.readContract({
      address: target,
      abi: AgentWalletAbi,
      functionName: 'authority',
      blockNumber,
    });
    const identity = await client.readContract({
      address: target,
      abi: AgentWalletAbi,
      functionName: 'identity',
      blockNumber,
    });
    const canonical = await client.readContract({
      address: cfg.walletFactory,
      abi: WalletFactoryAbi,
      functionName: 'wallets',
      args: [identity],
      blockNumber,
    });
    if (
      authority.toLowerCase() !== cfg.walletFactory.toLowerCase() ||
      canonical.toLowerCase() !== target.toLowerCase()
    )
      throw deny();
  } else {
    const registry = await client.readContract({
      address: target,
      abi: PublicChitAbi,
      functionName: 'registry',
      blockNumber,
    });
    if (registry.toLowerCase() !== cfg.walletFactory.toLowerCase()) throw deny();
  }
  // Append one item, never replace a shared policy/list. Concurrent creations cannot lose entries.
  await addPrivyConditionItem(env, setId, target, operation);
  await env.DB.prepare(
    'INSERT INTO bank_events(id,source,data,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(
      operation,
      'signer_enrollment',
      JSON.stringify({
        target: target.toLowerCase(),
        kind,
        setId,
        registry: cfg.walletFactory,
        blockNumber: blockNumber.toString(),
      }),
      new Date().toISOString(),
    )
    .run();
}

export async function ensureSignerTarget(env: Env, target: Address, calldata: Hex) {
  const cfg = configuration(env);
  if (cfg.local) return;
  if (
    [cfg.token, cfg.riskToken, cfg.walletFactory, cfg.escrow].some(
      (address) => address.toLowerCase() === target.toLowerCase(),
    )
  )
    return;
  let kind: 'wallet' | 'chit';
  try {
    const method = decodeFunctionData({
      abi: [...AgentWalletAbi, ...PublicChitAbi],
      data: calldata,
    }).functionName;
    if (method === 'execute') kind = 'wallet';
    else if (method === 'finalize') kind = 'chit';
    else throw new Error('Unsupported signer method');
  } catch {
    throw new DomainError(
      'SIGNER_TARGET_NOT_REGISTERED',
      'Only registered wallets and chit finalization are permitted signer destinations.',
      403,
    );
  }
  await enrollSignerTarget(env, target, kind);
}
