import { z } from 'zod';
import { createPublicClient, http, isAddress, zeroAddress, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { DomainError } from '@capora/types';
import type { Env } from '../env';
const address = z
  .string()
  .refine((v) => isAddress(v) && v.toLowerCase() !== zeroAddress)
  .transform((v) => v as Address);
export const deploymentSchema = z.object({
  chainId: z.literal(84532),
  token: address,
  riskToken: address,
  walletFactory: address,
  escrow: address,
  market: address,
  lending: address,
  bankFactory: address,
  treasury: address,
  executor: address,
  startBlock: z.string().regex(/^\d+$/).optional(),
});
export function marketplaceFeeBps(env: Env) {
  return z.coerce
    .number()
    .int()
    .min(0)
    .max(1000)
    .parse(env.BANK_MARKETPLACE_FEE_BPS ?? '250');
}
export function configuration(env: Env) {
  const result = deploymentSchema.safeParse(env.BANK_DEPLOYMENT ? JSON.parse(env.BANK_DEPLOYMENT) : null);
  if (env.BANK_ENABLED !== 'true' || !result.success || !env.BANK_RPC_URL)
    throw new DomainError(
      'BANK_CONFIGURATION_REQUIRED',
      'Capora Bank requires Base Sepolia contracts, RPC, and a configured managed signer. See docs/bank.md.',
      503,
    );
  const url = new URL(env.BANK_RPC_URL);
  const local =
    env.DEV_MODE === 'true' &&
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    ['127.0.0.1', 'localhost'].includes(new URL(env.CAPORA_BASE_URL).hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new DomainError('INVALID_BANK_RPC', 'Use an HTTPS Base Sepolia RPC.', 503);
  return {
    ...result.data,
    local,
    rpc: url.href,
    feeBps: marketplaceFeeBps(env),
    confirmations: local ? 1 : 3,
  };
}
export function chainClient(env: Env) {
  const cfg = configuration(env);
  return createPublicClient({
    chain: baseSepolia,
    transport: http(cfg.rpc, { timeout: 15_000, retryCount: 1 }),
  });
}
export async function assertChain(env: Env) {
  const client = chainClient(env);
  if ((await client.getChainId()) !== 84532)
    throw new DomainError('WRONG_CHAIN', 'Only Base Sepolia (84532) is permitted.', 503);
  return client;
}
