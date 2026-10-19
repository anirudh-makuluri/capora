import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { generateKeyPairSync } from 'node:crypto';
import { resolve } from 'node:path';
import { createPublicClient, http, keccak256, stringToHex, zeroAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  WalletFactoryAbi,
  AgentWalletAbi,
  PublicChitAbi,
  CaporaUSDAbi,
  PurchaseEscrowAbi,
} from '../packages/bank/src/abis';
import { deploymentSchema } from '../apps/worker/src/bank/config';
import { addPrivyConditionItem } from '../apps/worker/src/bank/privy';

const root = resolve(import.meta.dirname, '..');
const file = resolve(root, 'apps/worker/.dev.vars');
let contents = await readFile(file, 'utf8');
const values: Record<string, string> = {};
for (const [name, value] of Object.entries(parseEnv(contents))) if (value !== undefined) values[name] = value;
for (const name of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'PRIVY_WALLET_ID', 'BANK_DEPLOYMENT', 'BANK_RPC_URL'])
  if (!values[name]) throw new Error(`Missing local ${name}. No value was printed.`);
const deployment = deploymentSchema.parse(JSON.parse(values.BANK_DEPLOYMENT));
if (new URL(values.BANK_RPC_URL).protocol !== 'https:') throw new Error('Use an HTTPS Base Sepolia RPC.');
const client = createPublicClient({ chain: baseSepolia, transport: http(values.BANK_RPC_URL) });
if ((await client.getChainId()) !== 84532) throw new Error('Wrong chain.');
const api = async (path: string, method = 'GET', body?: unknown, idempotencyKey?: string) => {
  const response = await fetch(`https://api.privy.io/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${values.PRIVY_APP_ID}:${values.PRIVY_APP_SECRET}`).toString('base64')}`,
      'privy-app-id': values.PRIVY_APP_ID,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'privy-idempotency-key': idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Privy setup HTTP ${response.status}; secret values were not logged.`);
  }
  return (await response.json()) as Record<string, unknown>;
};
const wallet = await api(`/wallets/${encodeURIComponent(values.PRIVY_WALLET_ID)}`);
if (String(wallet.address).toLowerCase() !== deployment.executor.toLowerCase())
  throw new Error('Managed wallet/executor mismatch.');
if (!Array.isArray(wallet.policy_ids) || wallet.policy_ids.length !== 1)
  throw new Error('Expected exactly one existing Bank executor policy; no unrelated policies were changed.');
const policyId = String(wallet.policy_ids[0]);
const existingPolicy = await api(`/policies/${policyId}`);
if (!String(existingPolicy.name).startsWith('Capora Bank runtime') || existingPolicy.owner_id)
  throw new Error('Expected the app-managed Capora Bank runtime policy.');
const save = async (name: string, value: string) => {
  values[name] = value;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, 'gm');
  contents = pattern.test(contents)
    ? contents.replace(pattern, () => `${name}=${JSON.stringify(value)}`)
    : `${contents.trimEnd()}\n${name}=${JSON.stringify(value)}\n`;
  await writeFile(file, contents, { mode: 0o600 });
};
if (!values.PRIVY_ENROLLMENT_AUTHORIZATION_KEY) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  await save(
    'PRIVY_ENROLLMENT_AUTHORIZATION_KEY',
    keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  );
}
const { createPrivateKey, createPublicKey } = await import('node:crypto');
const publicKey = createPublicKey(
  createPrivateKey({
    key: Buffer.from(values.PRIVY_ENROLLMENT_AUTHORIZATION_KEY.replace(/^wallet-auth:/, ''), 'base64'),
    format: 'der',
    type: 'pkcs8',
  }),
)
  .export({ format: 'der', type: 'spki' })
  .toString('base64');
for (const [name, kind] of [
  ['BANK_PRIVY_WALLET_SET_ID', 'wallets'],
  ['BANK_PRIVY_CHIT_SET_ID', 'chits'],
] as const) {
  if (!values[name]) {
    const created = await api(
      '/condition_sets',
      'POST',
      { name: `Capora Base Sepolia registered ${kind}`, owner: { public_key: publicKey } },
      keccak256(stringToHex(`capora:${deployment.walletFactory}:${kind}`)),
    );
    if (!/^[a-z0-9]{24}$/.test(String(created.id))) throw new Error('Invalid condition set response.');
    await save(name, String(created.id));
  }
  await api(`/condition_sets/${values[name]}`);
}
if (values.BANK_PRIVY_WALLET_SET_ID === values.BANK_PRIVY_CHIT_SET_ID)
  throw new Error('Wallet and chit sets must be separate.');
const common = [
  { field_source: 'ethereum_transaction', field: 'chain_id', operator: 'eq', value: '84532' },
  { field_source: 'ethereum_transaction', field: 'value', operator: 'eq', value: '0' },
];
const rule = (
  name: string,
  value: string | string[],
  abi: readonly { type: string; name?: string }[],
  methods: string[],
  dynamic = false,
) => ({
  name,
  method: 'eth_sendTransaction',
  action: 'ALLOW',
  conditions: [
    ...common,
    {
      field_source: 'ethereum_transaction',
      field: 'to',
      operator: dynamic ? 'in_condition_set' : 'in',
      value,
    },
    {
      field_source: 'ethereum_calldata',
      field: 'function_name',
      operator: 'in',
      value: methods,
      abi: abi.filter((item) => item.type === 'function' && methods.includes(item.name ?? '')),
    },
  ],
});
const next = {
  name: 'Capora Bank runtime - Base Sepolia only',
  rules: [
    rule('Provision registered account wallets', [deployment.walletFactory], WalletFactoryAbi, ['create']),
    rule('Mint bounded demo assets', [deployment.token, deployment.riskToken], CaporaUSDAbi, ['mintOnce']),
    rule('Attest or resolve purchases', [deployment.escrow], PurchaseEscrowAbi, [
      'start',
      'release',
      'refund',
      'dispute',
    ]),
    rule(
      'Execute registered account wallets',
      values.BANK_PRIVY_WALLET_SET_ID,
      AgentWalletAbi,
      ['execute'],
      true,
    ),
    rule(
      'Finalize registered public chits',
      values.BANK_PRIVY_CHIT_SET_ID,
      PublicChitAbi,
      ['finalize'],
      true,
    ),
  ],
};
// Preserve the existing Bank revenue destination before switching the policy.
const identity = keccak256(stringToHex('capora:84532:provider:provider_capora_bank'));
const revenue = await client.readContract({
  address: deployment.walletFactory,
  abi: WalletFactoryAbi,
  functionName: 'wallets',
  args: [identity],
});
if (revenue !== zeroAddress) {
  if (
    !(await client.readContract({
      address: deployment.walletFactory,
      abi: WalletFactoryAbi,
      functionName: 'isWallet',
      args: [revenue],
    }))
  )
    throw new Error('Unregistered revenue wallet.');
  await addPrivyConditionItem(
    values,
    values.BANK_PRIVY_WALLET_SET_ID,
    revenue,
    keccak256(stringToHex(`initial-bank-revenue:${values.BANK_PRIVY_WALLET_SET_ID}:${revenue}`)),
  );
}
await mkdir(resolve(root, '.local'), { recursive: true });
await writeFile(
  resolve(root, '.local/bank-policy-before-enrollment.json'),
  JSON.stringify(existingPolicy, null, 2),
);
await api(`/policies/${policyId}`, 'PATCH', next);
const actual = await api(`/policies/${policyId}`);
const normalized = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === 'string' && /^0x[\da-f]{40}$/i.test(item) ? item.toLowerCase() : item,
    ),
  );
const { isDeepStrictEqual } = await import('node:util');
const actualRules = actual.rules as { name: string; method: string; action: string; conditions: unknown }[];
if (
  actualRules.length !== next.rules.length ||
  !next.rules.every((expected) => {
    const found = actualRules.find((item) => item.name === expected.name);
    return (
      found &&
      isDeepStrictEqual(normalized(found.conditions), normalized(expected.conditions)) &&
      found.method === expected.method &&
      found.action === expected.action
    );
  })
)
  throw new Error('Runtime policy verification failed. Keep Bank disabled.');
await writeFile(
  resolve(root, '.local/bank-condition-set-policy.json'),
  JSON.stringify(
    {
      policyId,
      walletSetId: values.BANK_PRIVY_WALLET_SET_ID,
      chitSetId: values.BANK_PRIVY_CHIT_SET_ID,
      policy: actual,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  'Verified Base Sepolia runtime policy with separate append-only wallet/chit condition sets. Enrollment key saved only to ignored local configuration. Bank activation unchanged.',
);
