import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invokeProvider } from '../apps/worker/src/services/gateway';
import { executeBank } from '../apps/worker/src/bank/actions';
import type { Env } from '../apps/worker/src/env';

vi.mock('../apps/worker/src/bank/actions', () => ({ executeBank: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ agent_id: 'test-agent' }) }) }) },
} as unknown as Env;
const capability = (operation: string) =>
  ({
    endpoint: `bank://${operation}`,
    providerId: 'provider_capora_bank',
    inputSchema: { type: 'object' },
    // Simulate the persisted pre-upgrade catalog during deployment rollout.
    outputSchema: { type: 'object' },
  }) as unknown as Parameters<typeof invokeProvider>[1];
describe('Bank gateway output contracts', () => {
  it.each(['get_transactions', 'list_funds', 'list_loans', 'list_public_chits'])(
    'accepts real array results for %s and rejects the wrong result shape',
    async (op) => {
      vi.mocked(executeBank).mockResolvedValueOnce([{ id: 'record' }]);
      expect(await invokeProvider(env, capability(op), 'inv_test', {})).toEqual([{ id: 'record' }]);
      expect(executeBank).toHaveBeenCalledWith(env, 'test-agent', 'inv_test', `bank://${op}`, {});
      vi.mocked(executeBank).mockResolvedValueOnce({});
      await expect(invokeProvider(env, capability(op), 'inv_test', {})).rejects.toMatchObject({
        code: 'INVALID_PROVIDER_OUTPUT',
      });
    },
  );
  it('keeps object contracts for account reads', async () => {
    vi.mocked(executeBank).mockResolvedValueOnce({ accounts: [] });
    expect(await invokeProvider(env, capability('get_accounts'), 'inv_test', {})).toEqual({ accounts: [] });
    vi.mocked(executeBank).mockResolvedValueOnce([]);
    await expect(invokeProvider(env, capability('get_accounts'), 'inv_test', {})).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_OUTPUT',
    });
  });
});
