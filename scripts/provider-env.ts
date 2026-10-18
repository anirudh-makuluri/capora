import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export const providerVariableNames = [
  'BRAVE_SEARCH_API_KEY',
  'CONTEXT_DEV_API_KEY',
  'AZURE_MAPS_KEY',
  'SD_API_BASE_URL',
  'SD_API_BEARER_TOKEN',
  'RIOT_API_KEY',
] as const;

// Only these server-side settings cross from root .env into Wrangler's local configuration.
// Preserve all unrelated values, including the existing payment mode and wallet configuration.
export async function syncProviderEnvironment(
  rootEnvPath: string,
  workerVarsPath: string,
): Promise<string[]> {
  let source: ReturnType<typeof parseEnv>;
  try {
    source = parseEnv(await readFile(rootEnvPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let target = await readFile(workerVarsPath, 'utf8');
  const synced: string[] = [];
  for (const name of providerVariableNames) {
    const value = source[name]?.trim();
    if (!value) continue;
    const line = `${name}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, 'gm');
    target = pattern.test(target) ? target.replace(pattern, () => line) : `${target.trimEnd()}\n${line}\n`;
    synced.push(name);
  }
  if (synced.length) await writeFile(workerVarsPath, target, { mode: 0o600 });
  return synced;
}
