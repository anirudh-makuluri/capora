import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeDeployData,
  encodeFunctionData,
  toFunctionSelector,
  type Address,
  type Abi,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
const local = process.argv.includes('--local');
const rpc = local ? (process.env.BANK_RPC_URL ?? 'http://127.0.0.1:8545') : process.env.BANK_RPC_URL;
if (!rpc) throw new Error('Set BANK_RPC_URL to an HTTPS Base Sepolia endpoint.');
const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
if ((await client.getChainId()) !== 84532) throw new Error('Only chain 84532 is permitted.');
if (!local && new URL(rpc).protocol !== 'https:') throw new Error('Testnet RPC requires HTTPS.');
if (local && !['127.0.0.1', 'localhost'].includes(new URL(rpc).hostname))
  throw new Error('Local deployment requires loopback RPC.');
const localWallet = createWalletClient({ chain: baseSepolia, transport: http(rpc) });
const executor = local
  ? (await localWallet.getAddresses())[0]
  : (process.env.BANK_EXECUTOR_ADDRESS as Address);
const admin = local ? executor : (process.env.BANK_ADMIN_ADDRESS as Address);
const treasury = local
  ? (await localWallet.getAddresses())[1]
  : (process.env.BANK_TREASURY_ADDRESS as Address);
if (!executor || !admin || !treasury)
  throw new Error('Set BANK_EXECUTOR_ADDRESS, BANK_ADMIN_ADDRESS and BANK_TREASURY_ADDRESS.');
if (!local && admin.toLowerCase() === executor.toLowerCase())
  throw new Error(
    'Choose a separate secured BANK_ADMIN_ADDRESS; the runtime executor must not retain administrator authority.',
  );
const artifact = async (name: string) =>
  JSON.parse(
    await readFile(
      new URL(
        `../artifacts/contracts/${name === 'WalletFactory' ? 'AgentWallet' : name === 'TestCollateral' ? 'CaporaUSD' : name}.sol/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { abi: Abi; bytecode: Hex };
let ordinal = 0;
const runId = process.env.BANK_DEPLOY_RUN_ID;
if (!local && !runId)
  throw new Error('Set a unique BANK_DEPLOY_RUN_ID; reuse it when retrying this deployment.');
async function send(to: Address | undefined, data: Hex) {
  let hash: Hex;
  if (local) hash = await localWallet.sendTransaction({ account: executor, to, data, gas: 16000000n });
  else {
    const { PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_WALLET_ID } = process.env;
    if (!PRIVY_APP_ID || !PRIVY_APP_SECRET || !PRIVY_WALLET_ID)
      throw new Error(
        'Configure Privy app credentials and managed server wallet ID in the process environment.',
      );
    const result = await fetch(`https://api.privy.io/v1/wallets/${encodeURIComponent(PRIVY_WALLET_ID)}/rpc`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`)}`,
        'privy-app-id': PRIVY_APP_ID,
        'privy-idempotency-key': `${runId}-${ordinal++}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'eth_sendTransaction',
        caip2: 'eip155:84532',
        params: { transaction: { ...(to ? { to } : {}), data, value: '0x0', chain_id: 84532 } },
      }),
    });
    if (!result.ok) throw new Error(`Managed deployment signer returned HTTP ${result.status}.`);
    const body = (await result.json()) as { data?: { hash: Hex } };
    if (!body.data?.hash) throw new Error('No deployment transaction hash.');
    hash = body.data.hash;
  }
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: local ? 1 : 3,
    timeout: 180000,
  });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}
const receipts: Record<string, Hex> = {};
async function deploy(name: string, args: readonly unknown[]) {
  const a = await artifact(name),
    receipt = await send(undefined, encodeDeployData({ ...a, args }));
  if (!receipt.contractAddress) throw new Error('Deployment returned no address.');
  receipts[name] = receipt.transactionHash;
  return receipt.contractAddress;
}
let configurationStep = 0;
async function write(address: Address, name: string, fn: string, args: readonly unknown[]) {
  const a = await artifact(name),
    receipt = await send(address, encodeFunctionData({ abi: a.abi, functionName: fn, args }));
  receipts[`configuration_${configurationStep++}_${fn}`] = receipt.transactionHash;
  return receipt;
}
const token = await deploy('CaporaUSD', [executor, executor]),
  riskToken = await deploy('TestCollateral', [executor, executor]);
const walletFactory = await deploy('WalletFactory', [executor, executor]);
const market = await deploy('TestMarket', [token, riskToken, executor]);
const escrow = await deploy('PurchaseEscrow', [token, executor, executor, treasury]);
const lending = await deploy('LendingPool', [token, market, treasury, admin]);
const bankFactory = await deploy('BankFactory', [token, market, walletFactory, treasury, escrow]);
await write(walletFactory, 'WalletFactory', 'setBankFactory', [bankFactory]);
const methods: Record<string, string[]> = {
  [token]: ['transfer(address,uint256)', 'approve(address,uint256)'],
  [riskToken]: ['approve(address,uint256)'],
  [escrow]: ['fund(bytes32,address,uint128,uint64,uint16)'],
  [lending]: [
    'open(bytes32,uint256,uint256,uint64)',
    'repay(bytes32,uint256)',
    'addCollateral(bytes32,uint256)',
    'withdrawCollateral(bytes32,uint256)',
    'liquidate(bytes32,uint256)',
    'invest(uint256,uint256)',
    'redeemWithMin(uint256,uint256)',
  ],
  [bankFactory]: [
    'createFund(bytes32,string,string,uint16,uint16,uint256,uint256,uint16,uint256)',
    'createChit(bytes32,(uint16,uint128,uint16,uint16,uint32,uint32,uint32,uint32,uint64))',
  ],
};
for (const [target, selectors] of Object.entries(methods))
  for (const signature of selectors)
    await write(walletFactory, 'WalletFactory', 'allow', [target, toFunctionSelector(signature), true]);
await write(market, 'TestMarket', 'setPrice', [2000000n]);
const { keccak256, stringToHex } = await import('viem');
await write(token, 'CaporaUSD', 'mintOnce', [
  keccak256(stringToHex('artificial-market-usd-inventory')),
  market,
  1000000000n,
]);
await write(riskToken, 'CaporaUSD', 'mintOnce', [
  keccak256(stringToHex('artificial-market-risk-inventory')),
  market,
  1000000000n,
]);
if (!local) {
  const role = `0x${'0'.repeat(64)}`;
  for (const [address, name] of [
    [token, 'CaporaUSD'],
    [riskToken, 'CaporaUSD'],
    [walletFactory, 'WalletFactory'],
    [market, 'TestMarket'],
    [escrow, 'PurchaseEscrow'],
  ] as const) {
    await write(address, name, 'grantRole', [role, admin]);
    await write(address, name, 'renounceRole', [role, executor]);
  }
}
const deployment = {
  chainId: 84532,
  token,
  riskToken,
  walletFactory,
  escrow,
  market,
  lending,
  bankFactory,
  treasury,
  executor,
  startBlock: (await client.getTransactionReceipt({ hash: receipts.CaporaUSD })).blockNumber.toString(),
};
const root = new URL('../../../.local/', import.meta.url);
await mkdir(root, { recursive: true });
const output = process.env.BANK_DEPLOY_OUTPUT ?? (local ? 'bank-local.json' : 'bank-sepolia.json');
if (!/^bank-[a-z-]+\.json$/.test(output))
  throw new Error('Deployment output must be a bank-*.json filename.');
await writeFile(
  new URL(output, root),
  JSON.stringify(
    {
      deployment,
      receipts,
      network: local ? 'LOCAL EVM (not hosted Base Sepolia)' : 'Base Sepolia',
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(deployment, null, 2));
console.log(
  local
    ? 'Local EVM contracts deployed. Run pnpm bank:configure:local, then pnpm dev.'
    : 'Base Sepolia contracts deployed. Save BANK_DEPLOYMENT as the deployment object, restrict Privy policy, and transfer administrator roles before enabling Bank.',
);
