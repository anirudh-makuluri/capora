import { readFile, writeFile } from 'node:fs/promises';
const { deployment } = JSON.parse(await readFile('.local/bank-local.json', 'utf8'));
const path = 'apps/worker/.dev.vars';
let contents = await readFile(path, 'utf8');
const settings: Record<string, string> = {
  BANK_ENABLED: 'true',
  BANK_RPC_URL: 'http://127.0.0.1:8545',
  BANK_DEPLOYMENT: JSON.stringify(deployment),
  BANK_MARKETPLACE_FEE_BPS: '250',
};
for (const [key, value] of Object.entries(settings)) {
  contents = contents.replace(new RegExp(`^${key}=.*(?:\\r?\\n|$)`, 'gm'), '');
  contents += `\n${key}=${JSON.stringify(value)}\n`;
}
await writeFile(path, contents);
console.log('Configured only local Bank bindings. Existing secrets preserved. Restart the local Worker.');
