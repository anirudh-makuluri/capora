import { spawnSync } from 'node:child_process';
import { readDeploymentConfig, requiredSecrets, root, validateDeploymentConfig } from './deployment-config';

try {
  const config = await readDeploymentConfig();
  const url = validateDeploymentConfig(config);
  if (process.argv.includes('--secrets')) {
    const result = spawnSync(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['--filter', '@capora/worker', 'exec', 'wrangler', 'secret', 'list', '--format', 'json'],
      { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', timeout: 60_000 },
    );
    if (result.status !== 0)
      throw new Error(
        'Could not list Worker secrets. Check Cloudflare authentication, account, and Worker setup.',
      );
    const secrets: { name: string }[] = JSON.parse(result.stdout);
    const names = new Set(secrets.map((secret) => secret.name));
    const missing = requiredSecrets.filter((name) => !names.has(name));
    if (missing.length) throw new Error(`Configure these Cloudflare Worker secrets: ${missing.join(', ')}.`);
    console.log('All required Worker secret names are present; values were not read or validated.');
  }
  console.log(`Deployment configuration ready: ${config.name} at ${url.origin}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Deployment check failed.');
  process.exitCode = 1;
}
