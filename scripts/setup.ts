import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, '.local'), { recursive: true });
const credentialsPath = resolve(root, '.local/credentials.json');
let credentials: {
  agentToken: string;
  dashboardPassword: string;
  sessionSecret: string;
  encryptionKey: string;
  providerSecret: string;
};
try {
  credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch {
  credentials = {
    agentToken: `cap_${randomBytes(32).toString('base64url')}`,
    dashboardPassword: randomBytes(24).toString('base64url'),
    sessionSecret: randomBytes(32).toString('base64url'),
    encryptionKey: randomBytes(32).toString('base64url'),
    providerSecret: randomBytes(32).toString('base64url'),
  };
  await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}
const varsPath = resolve(root, 'apps/worker/.dev.vars');
try {
  await access(varsPath);
  console.log('Existing local Worker configuration preserved.');
} catch {
  await writeFile(
    varsPath,
    `DEV_MODE=true\nPAYMENT_MODE=demo\nCAPORA_BASE_URL=http://localhost:5173\nSESSION_SECRET=${credentials.sessionSecret}\nENCRYPTION_KEY=${credentials.encryptionKey}\nDEMO_PROVIDER_SECRET=${credentials.providerSecret}\n`,
    { mode: 0o600 },
  );
}
await mkdir(resolve(root, 'apps/web/dist'), { recursive: true });
console.log('Local credentials saved in .local/credentials.json (ignored by Git). No secrets printed.');
