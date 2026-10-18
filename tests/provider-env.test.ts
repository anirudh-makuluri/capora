import { mkdtemp, readFile, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { expect, it } from 'vitest';
import { syncProviderEnvironment } from '../scripts/provider-env';

it('copies only populated provider settings and preserves local payment/session configuration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capora-provider-env-'));
  try {
    const source = join(dir, '.env');
    const target = join(dir, '.dev.vars');
    await writeFile(
      source,
      'BRAVE_SEARCH_API_KEY="new$secret"\nSD_API_BEARER_TOKEN=\nPAYMENT_MODE=demo\nUNRELATED_SECRET=never-copy\n',
    );
    await writeFile(
      target,
      'PAYMENT_MODE=sandbox\nSESSION_SECRET=keep-session\nBRAVE_SEARCH_API_KEY=old\nSD_API_BEARER_TOKEN=keep-token\n',
    );
    expect(await syncProviderEnvironment(source, target)).toEqual(['BRAVE_SEARCH_API_KEY']);
    expect(parseEnv(await readFile(target, 'utf8'))).toEqual({
      PAYMENT_MODE: 'sandbox',
      SESSION_SECRET: 'keep-session',
      BRAVE_SEARCH_API_KEY: 'new$secret',
      SD_API_BEARER_TOKEN: 'keep-token',
    });
    await syncProviderEnvironment(source, target);
    expect((await readFile(target, 'utf8')).match(/^BRAVE_SEARCH_API_KEY=/gm)).toHaveLength(1);
  } finally {
    await rm(join(dir, '.env'), { force: true });
    await rm(join(dir, '.dev.vars'), { force: true });
    await rmdir(dir);
  }
});
