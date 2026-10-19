import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { encodeFunctionData } from 'viem';
import { AgentWalletAbi, PublicChitAbi } from '../packages/bank/src/abis';
import { privyAuthorizationSignature, privyCanonical } from '../apps/worker/src/bank/privy';
import { enrollSignerTarget, ensureSignerTarget } from '../apps/worker/src/bank/signer-policy';
import type { Env } from '../apps/worker/src/env';

const rpc = vi.hoisted(() => ({ getBlockNumber: vi.fn(), getCode: vi.fn(), readContract: vi.fn() }));
vi.mock('../apps/worker/src/bank/config', async (original) => ({
  ...(await original<object>()),
  assertChain: vi.fn(async () => rpc),
}));
const a = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const deployment = {
  chainId: 84532,
  token: a('1'),
  riskToken: a('2'),
  walletFactory: a('3'),
  escrow: a('4'),
  market: a('5'),
  lending: a('6'),
  bankFactory: a('7'),
  treasury: a('8'),
  executor: a('9'),
};
const walletA = a('a'),
  walletB = a('b'),
  chit = a('c');
const setId = 'abcdefghijklmnopqrstuvwx',
  chitSetId = 'zzzzzzzzzzzzzzzzzzzzzzzz';
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
let mf: Miniflare, db: Awaited<ReturnType<Miniflare['getD1Database']>>, env: Env;
const execute = encodeFunctionData({
  abi: AgentWalletAbi,
  functionName: 'execute',
  args: [`0x${'1'.repeat(64)}`, deployment.token, '0x12345678'],
});
const requests: { url: string; body: { value: string }[]; headers: Headers }[] = [];
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch(){return new Response("ok")} }',
      compatibilityDate: '2026-10-03',
      d1Databases: ['DB'],
    }),
  );
  db = await mf.getD1Database('DB');
  await db
    .prepare(
      'CREATE TABLE bank_events(id TEXT PRIMARY KEY,source TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL)',
    )
    .run();
});
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  vi.clearAllMocks();
  await db.prepare('DELETE FROM bank_events').run();
  requests.length = 0;
  env = {
    DB: db,
    BANK_ENABLED: 'true',
    BANK_RPC_URL: 'https://rpc.example',
    CAPORA_BASE_URL: 'https://capora.example',
    BANK_DEPLOYMENT: JSON.stringify(deployment),
    PRIVY_APP_ID: 'test-app',
    PRIVY_APP_SECRET: 'test-secret',
    PRIVY_ENROLLMENT_AUTHORIZATION_KEY: key,
    BANK_PRIVY_WALLET_SET_ID: setId,
    BANK_PRIVY_CHIT_SET_ID: chitSetId,
  } as Env;
  rpc.getBlockNumber.mockResolvedValue(100n);
  rpc.getCode.mockResolvedValue('0x1234');
  // Factory wallets(identity) must resolve the requested wallet, not a caller-controlled authority.
  rpc.readContract.mockImplementation(async ({ address, functionName, args }) => {
    if (functionName === 'isWallet' || functionName === 'chits') return true;
    if (functionName === 'authority' || functionName === 'registry') return deployment.walletFactory;
    if (functionName === 'identity') return `0x${(address === walletA ? 'a' : 'b').repeat(64)}`;
    if (functionName === 'wallets') return args[0] === `0x${'a'.repeat(64)}` ? walletA : walletB;
    throw new Error(`Unexpected read ${functionName}`);
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input),
      headers = new Headers(init?.headers),
      body = JSON.parse(String(init?.body));
    expect(init?.method).toBe('POST');
    const signedHeaders = Object.fromEntries(
      [...headers].filter(([name]) => name.startsWith('privy-') && name !== 'privy-authorization-signature'),
    );
    expect(
      verify(
        'sha256',
        Buffer.from(privyCanonical({ version: 1, method: 'POST', url, body, headers: signedHeaders })),
        keys.publicKey,
        Buffer.from(headers.get('privy-authorization-signature')!, 'base64'),
      ),
    ).toBe(true);
    expect(Number(headers.get('privy-request-expiry'))).toBeGreaterThan(Date.now());
    requests.push({ url, headers, body });
    return new Response(
      JSON.stringify(
        body.map((item: { value: string }) => ({
          ...item,
          condition_set_id: url.includes(setId) ? setId : chitSetId,
        })),
      ),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
});
afterEach(() => vi.restoreAllMocks());

describe('managed signer condition-set enrollment', () => {
  it('uses confirmed registration, exact factory authority and signed append requests', async () => {
    await ensureSignerTarget(env, walletA, execute);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`https://api.privy.io/v1/condition_sets/${setId}/condition_set_items`);
    expect(requests[0].body).toEqual([{ value: walletA }]);
    expect(rpc.readContract.mock.calls.every(([input]) => input.blockNumber === 98n)).toBe(true);
    expect(
      await db.prepare("SELECT id FROM bank_events WHERE source='signer_enrollment'").all(),
    ).toMatchObject({ results: [expect.anything()] });
    await ensureSignerTarget(env, walletA, execute);
    expect(requests).toHaveLength(1);
  });
  it('appends concurrent wallet creations independently without replacing a policy or list', async () => {
    await Promise.all([
      enrollSignerTarget(env, walletA, 'wallet'),
      enrollSignerTarget(env, walletB, 'wallet'),
    ]);
    expect(requests.map((request) => request.body[0].value).sort()).toEqual([walletA, walletB]);
    expect(requests[0].headers.get('privy-idempotency-key')).not.toBe(
      requests[1].headers.get('privy-idempotency-key'),
    );
    expect((await db.prepare('SELECT id FROM bank_events').all()).results).toHaveLength(2);
  });
  it('uses the same enrollment commitment for concurrent/retried requests for one wallet', async () => {
    await Promise.all([
      enrollSignerTarget(env, walletA, 'wallet'),
      enrollSignerTarget(env, walletA, 'wallet'),
    ]);
    expect(new Set(requests.map((request) => request.headers.get('privy-idempotency-key'))).size).toBe(1);
    expect((await db.prepare('SELECT id FROM bank_events').all()).results).toHaveLength(1);
  });
  it('keeps chit finalization in its own registered destination set', async () => {
    await ensureSignerTarget(env, chit, encodeFunctionData({ abi: PublicChitAbi, functionName: 'finalize' }));
    expect(requests[0].url).toContain(chitSetId);
    expect(requests[0].body).toEqual([{ value: chit }]);
  });
  it('verifies existing membership on a later page after a duplicate append', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'invalid_data' }), { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [{ value: walletB, condition_set_id: setId }], next_cursor: 'page two' }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ value: walletA.toUpperCase(), condition_set_id: setId }],
            next_cursor: null,
          }),
        ),
      );
    await enrollSignerTarget(env, walletA, 'wallet');
    expect(vi.mocked(fetch).mock.calls[2][0]).toContain('?cursor=page%20two');
    expect(
      new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get('privy-authorization-signature'),
    ).toBeNull();
    expect((await db.prepare('SELECT id FROM bank_events').all()).results).toHaveLength(1);
  });
  it.each(['missing', 'wrong-set', 'loop', 'unavailable', 'other-error'])(
    'does not cache rejected enrollment with %s membership evidence',
    async (scenario) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: scenario === 'other-error' ? 'policy_violation' : 'invalid_data' }),
          { status: 400 },
        ),
      );
      const value = {
        items: [
          {
            value: scenario === 'missing' ? walletB : walletA,
            condition_set_id: scenario === 'wrong-set' ? chitSetId : setId,
          },
        ],
        next_cursor: null as string | null,
      };
      if (scenario === 'loop') {
        value.items = [];
        value.next_cursor = 'same';
      }
      vi.mocked(fetch).mockImplementation(
        async () => new Response(JSON.stringify(value), { status: scenario === 'unavailable' ? 503 : 200 }),
      );
      await expect(enrollSignerTarget(env, walletA, 'wallet')).rejects.toMatchObject({
        code: 'SIGNER_ENROLLMENT_UNAVAILABLE',
      });
      expect((await db.prepare('SELECT id FROM bank_events').all()).results).toHaveLength(0);
      if (scenario === 'loop') expect(fetch).toHaveBeenCalledTimes(3);
    },
  );
  it('verifies concurrent duplicate appends independently and records one enrollment', async () => {
    vi.mocked(fetch).mockImplementation(
      async (_url, init) =>
        new Response(
          JSON.stringify(
            init?.method === 'POST'
              ? { code: 'invalid_data' }
              : { items: [{ value: walletA, condition_set_id: setId }], next_cursor: null },
          ),
          { status: init?.method === 'POST' ? 400 : 200 },
        ),
    );
    await Promise.all([
      enrollSignerTarget(env, walletA, 'wallet'),
      enrollSignerTarget(env, walletA, 'wallet'),
    ]);
    expect((await db.prepare('SELECT id FROM bank_events').all()).results).toHaveLength(1);
  });
  it.each(['network', 'invalid-json', 'oversized'])(
    'preserves enrollment for retry after %s failure',
    async (scenario) => {
      if (scenario === 'network')
        vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network unavailable'));
      else
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response(
            scenario === 'invalid-json' ? 'invalid' : JSON.stringify({ value: 'x'.repeat(20000) }),
          ),
        );
      await expect(enrollSignerTarget(env, walletA, 'wallet')).rejects.toMatchObject({
        code: 'SIGNER_ENROLLMENT_UNAVAILABLE',
      });
      expect((await db.prepare('SELECT id FROM bank_events').all()).results).toHaveLength(0);
      await enrollSignerTarget(env, walletA, 'wallet');
      expect((await db.prepare('SELECT id FROM bank_events').all()).results).toHaveLength(1);
    },
  );
  it.each(['isWallet', 'authority', 'wallets'])(
    'rejects forged wallet registration at %s before enrollment',
    async (field) => {
      const implementation = rpc.readContract.getMockImplementation()!;
      rpc.readContract.mockImplementation(async (input) =>
        input.functionName === field ? (field === 'isWallet' ? false : a('d')) : implementation(input),
      );
      await expect(enrollSignerTarget(env, walletA, 'wallet')).rejects.toMatchObject({
        code: 'SIGNER_TARGET_NOT_REGISTERED',
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('rejects unregistered chits, unknown calldata, missing sets and mainnet configurations', async () => {
    rpc.readContract.mockResolvedValue(false);
    await expect(enrollSignerTarget(env, chit, 'chit')).rejects.toMatchObject({
      code: 'SIGNER_TARGET_NOT_REGISTERED',
    });
    await expect(ensureSignerTarget(env, walletA, '0x12345678')).rejects.toMatchObject({
      code: 'SIGNER_TARGET_NOT_REGISTERED',
    });
    await expect(
      enrollSignerTarget({ ...env, BANK_PRIVY_WALLET_SET_ID: undefined }, walletA, 'wallet'),
    ).rejects.toMatchObject({ code: 'SIGNER_ENROLLMENT_REQUIRED' });
    await expect(
      enrollSignerTarget(
        { ...env, BANK_DEPLOYMENT: JSON.stringify({ ...deployment, chainId: 1 }) },
        walletA,
        'wallet',
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not cache a failed or mismatched response and retries with the same commitment', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('rejected', { status: 503 }));
    await expect(enrollSignerTarget(env, walletA, 'wallet')).rejects.toMatchObject({
      code: 'SIGNER_ENROLLMENT_UNAVAILABLE',
    });
    const first = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('privy-idempotency-key');
    expect((await db.prepare('SELECT id FROM bank_events').all()).results).toHaveLength(0);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ value: walletB, condition_set_id: setId }])),
    );
    await expect(enrollSignerTarget(env, walletA, 'wallet')).rejects.toMatchObject({
      code: 'SIGNER_ENROLLMENT_UNAVAILABLE',
    });
    await enrollSignerTarget(env, walletA, 'wallet');
    expect(requests[0].headers.get('privy-idempotency-key')).toBe(first);
  });
  it('does not contact Privy for isolated local signing or static policy destinations', async () => {
    await ensureSignerTarget(env, deployment.token, execute);
    await enrollSignerTarget(
      {
        ...env,
        DEV_MODE: 'true',
        CAPORA_BASE_URL: 'http://localhost',
        BANK_RPC_URL: 'http://127.0.0.1:8545',
      },
      walletA,
      'wallet',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('re-enrolls when an operator rotates the condition set ID', async () => {
    await enrollSignerTarget(env, walletA, 'wallet');
    await enrollSignerTarget({ ...env, BANK_PRIVY_WALLET_SET_ID: chitSetId }, walletA, 'wallet');
    expect(requests).toHaveLength(2);
  });
});

describe('Privy authorization interoperability', () => {
  it('produces DER signatures accepted by an independent P-256 verifier', async () => {
    expect(privyCanonical({ a: 1, _: 2, A: 3 })).toBe('{"A":3,"_":2,"a":1}');
    for (let i = 0; i < 16; i++) {
      const headers = { 'privy-app-id': 'test', 'privy-request-expiry': String(i) };
      const body = [{ value: walletA }],
        url = 'https://api.privy.io/v1/condition_sets/test/condition_set_items';
      const signature = await privyAuthorizationSignature(key, url, body, headers);
      const payload = Buffer.from(privyCanonical({ version: 1, method: 'POST', url, body, headers }));
      expect(verify('sha256', payload, keys.publicKey, Buffer.from(signature, 'base64'))).toBe(true);
      expect(
        verify('sha256', Buffer.from('tampered'), keys.publicKey, Buffer.from(signature, 'base64')),
      ).toBe(false);
    }
  });
});
