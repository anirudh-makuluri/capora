import { describe, it, expect } from 'vitest';
import { units, displayUnits, centsToUnits, unitsToCents } from '../packages/bank/src/index';
import { bankSchemas } from '../apps/worker/src/bank/capabilities';
import { configuration } from '../apps/worker/src/bank/config';
import type { Env } from '../apps/worker/src/env';
const address = '0x1111111111111111111111111111111111111111';
const manifest = {
  chainId: 84532,
  token: address,
  riskToken: address,
  walletFactory: address,
  escrow: address,
  market: address,
  lending: address,
  bankFactory: address,
  treasury: address,
  executor: address,
};
const env = {
  BANK_ENABLED: 'true',
  BANK_DEPLOYMENT: JSON.stringify(manifest),
  BANK_RPC_URL: 'https://rpc.example',
  CAPORA_BASE_URL: 'https://capora.example',
  DEV_MODE: 'false',
} as Env;
describe('financial precision and testnet configuration boundaries', () => {
  it('keeps cent and micro-unit values exact across the supported payment range', () => {
    for (const cents of [1, 10, 1999, 2000, 99999, 100000])
      expect(unitsToCents(centsToUnits(cents))).toBe(cents);
    expect(units('20')).toBe(20000000n);
    expect(displayUnits(units('999999999999.123456'))).toBe('999999999999.123456');
    expect(unitsToCents(1n)).toBe(1);
    expect(() => unitsToCents(-1n)).toThrow();
    expect(() => units('20.0000001')).toThrow();
    expect(() => units('2e1')).toThrow();
    expect(displayUnits(-1234567n)).toBe('-1.234567');
  });
  it('preserves twelve-decimal share minima without rounding them into token precision', () => {
    const input = { address, amount: '1', min_shares: '0.049850123456' };
    expect(bankSchemas.invest.parse(input)).toEqual(input);
    expect(units(input.min_shares, 12)).toBe(49850123456n);
    expect(() => bankSchemas.transfer.parse({ to: address, amount: '0.0000001' })).toThrow();
  });
  it('rejects mainnet manifests before any RPC or signer can be used', () => {
    expect(() =>
      configuration({ ...env, BANK_DEPLOYMENT: JSON.stringify({ ...manifest, chainId: 8453 }) }),
    ).toThrow('requires Base Sepolia');
    expect(() =>
      configuration({ ...env, BANK_DEPLOYMENT: JSON.stringify({ ...manifest, chainId: 1 }) }),
    ).toThrow('requires Base Sepolia');
  });
  it('allows unlocked loopback signing only in an explicitly local development configuration', () => {
    expect(() => configuration({ ...env, BANK_RPC_URL: 'http://127.0.0.1:8545' })).toThrow('HTTPS');
    expect(
      configuration({
        ...env,
        DEV_MODE: 'true',
        CAPORA_BASE_URL: 'http://localhost',
        BANK_RPC_URL: 'http://127.0.0.1:8545',
      }).local,
    ).toBe(true);
    expect(() =>
      configuration({
        ...env,
        DEV_MODE: 'true',
        CAPORA_BASE_URL: 'https://capora.example',
        BANK_RPC_URL: 'http://127.0.0.1:8545',
      }),
    ).toThrow('HTTPS');
  });
  it('fails closed when disabled and rejects fee policies above the contract maximum', () => {
    expect(() => configuration({ ...env, BANK_ENABLED: 'false' })).toThrow();
    expect(() => configuration({ ...env, BANK_MARKETPLACE_FEE_BPS: '1001' })).toThrow();
  });
});
