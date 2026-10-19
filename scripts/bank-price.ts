import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { TestMarketAbi } from '../packages/bank/src/abis';
import { deploymentSchema } from '../apps/worker/src/bank/config';

const root = resolve(import.meta.dirname, '..');
const env = parseEnv(await readFile(resolve(root, 'apps/worker/.dev.vars'), 'utf8'));
const deployment = deploymentSchema.parse(JSON.parse(env.BANK_DEPLOYMENT ?? '{}'));
if (!env.BANK_RPC_URL || new URL(env.BANK_RPC_URL).protocol !== 'https:')
  throw new Error('Configure HTTPS Base Sepolia RPC.');
const client = createPublicClient({ chain: baseSepolia, transport: http(env.BANK_RPC_URL) });
if ((await client.getChainId()) !== 84532) throw new Error('Only Base Sepolia is allowed.');
if (process.argv.includes('--check')) {
  const [price, updatedAt, block] = await Promise.all([
    client.readContract({ address: deployment.market, abi: TestMarketAbi, functionName: 'price' }),
    client.readContract({ address: deployment.market, abi: TestMarketAbi, functionName: 'updatedAt' }),
    client.getBlock(),
  ]);
  console.log(
    JSON.stringify({
      artificialPriceUnits: price.toString(),
      updatedAt: updatedAt.toString(),
      stale: block.timestamp > updatedAt + 3600n,
      expiresAt: new Date(Number(updatedAt + 3600n) * 1000).toISOString(),
    }),
  );
} else {
  const index = process.argv.indexOf('--price');
  const value = index < 0 ? '' : process.argv[index + 1];
  if (!value || !/^\d+(\.\d{1,6})?$/.test(value))
    throw new Error(
      'Specify an explicit artificial price: pnpm bank:price -- --price 2. No automatic price is selected.',
    );
  const price = parseUnits(value, 6);
  if (price < 10000n || price > 10000000000n)
    throw new Error('Artificial price is outside the contract range.');
  if (process.platform !== 'win32')
    throw new Error(
      'Use the secured administrator wallet on this Windows profile, or your own external signing workflow.',
    );
  const setup = JSON.parse(await readFile(resolve(root, '.local/bank-wallet-setup.json'), 'utf8')) as {
    admin: { address: string; protectedKeyFile: string };
  };
  const decrypted = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputText),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)))',
    ],
    { input: await readFile(setup.admin.protectedKeyFile, 'utf8'), encoding: 'utf8', windowsHide: true },
  );
  if (decrypted.status !== 0)
    throw new Error('Administrator key could not be unlocked on this Windows profile.');
  const record = JSON.parse(decrypted.stdout) as { privateKey: string; address: string };
  if (!/^0x[\da-f]{64}$/i.test(record.privateKey)) throw new Error('Invalid protected administrator key.');
  const account = privateKeyToAccount(record.privateKey as Hex);
  if (
    account.address.toLowerCase() !== env.BANK_ADMIN_ADDRESS?.toLowerCase() ||
    account.address.toLowerCase() !== setup.admin.address.toLowerCase() ||
    account.address.toLowerCase() === deployment.executor.toLowerCase()
  )
    throw new Error('Administrator identity mismatch.');
  if (
    !(await client.readContract({
      address: deployment.market,
      abi: TestMarketAbi,
      functionName: 'hasRole',
      args: [`0x${'0'.repeat(64)}`, account.address],
    }))
  )
    throw new Error('This wallet is not the market administrator.');
  const request = await client.simulateContract({
    account,
    address: deployment.market,
    abi: TestMarketAbi,
    functionName: 'setPrice',
    args: [price],
  });
  const signer = createWalletClient({ account, chain: baseSepolia, transport: http(env.BANK_RPC_URL) });
  const hash = await signer.writeContract(request.request);
  await client.waitForTransactionReceipt({ hash, confirmations: 3, timeout: 180000 });
  const receipt = await client.getTransactionReceipt({ hash });
  if (
    receipt.status !== 'success' ||
    receipt.blockHash !== (await client.getBlock({ blockNumber: receipt.blockNumber })).hash
  )
    throw new Error('Price update requires reconciliation.');
  console.log(
    JSON.stringify({
      artificialPriceUnits: price.toString(),
      hash,
      confirmed: true,
      expiresAfterSeconds: 3600,
    }),
  );
}
