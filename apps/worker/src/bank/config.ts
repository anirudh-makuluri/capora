import { z } from 'zod';
import {
  createPublicClient,
  http,
  isAddress,
  zeroAddress,
  BaseError,
  HttpRequestError,
  TimeoutError,
  LimitExceededRpcError,
  type Address,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { DomainError } from '@capora/types';
import type { Env } from '../env';
export function bankRpcFailure(error: unknown): DomainError | null {
  const transient = (value: unknown) =>
    value instanceof HttpRequestError ||
    value instanceof TimeoutError ||
    value instanceof LimitExceededRpcError;
  const cause = error instanceof BaseError ? error.walk(transient) : error;
  if (
    cause instanceof HttpRequestError ||
    cause instanceof TimeoutError ||
    cause instanceof LimitExceededRpcError
  ) {
    console.warn(
      JSON.stringify({
        event: 'bank_rpc_transport_error',
        name: cause.name,
        status: cause instanceof HttpRequestError ? cause.status : undefined,
        code: cause instanceof LimitExceededRpcError ? cause.code : undefined,
      }),
    );
  }
  return transient(cause)
    ? new DomainError(
        'BANK_RPC_UNAVAILABLE',
        'Base Sepolia RPC is temporarily unavailable. Retry the same Bank operation.',
        503,
      )
    : null;
}
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
    confirmations: local ? 1 : 3,
  };
}
export function chainClient(env: Env) {
  const cfg = configuration(env);
  return createPublicClient({
    chain: baseSepolia,
    // Hosted dashboards/snapshots read many fields together. Multicall3 avoids an RPC burst;
    // the isolated local chain deliberately has no hosted Multicall3 dependency.
    batch: cfg.local ? undefined : { multicall: { batchSize: 4096, wait: 10 } },
    transport: http(cfg.rpc, { timeout: 15_000, retryCount: 1 }),
  });
}
export async function assertChain(env: Env) {
  const client = chainClient(env);
  if ((await client.getChainId()) !== 84532)
    throw new DomainError('WRONG_CHAIN', 'Only Base Sepolia (84532) is permitted.', 503);
  return client;
}
