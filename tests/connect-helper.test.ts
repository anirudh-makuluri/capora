import { beforeAll, describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let helper: {
  cents(value: string): number;
  setupInput(value: Record<string, string>): unknown;
  baseUrl(value: string): string;
};
beforeAll(async () => {
  helper = await import(pathToFileURL(resolve('apps/web/public/connect.mjs')).href);
});
describe('Connection helper input boundaries', () => {
  it('preserves exact cents and rejects rounded, negative and out-of-range amounts', () => {
    expect(helper.cents('7.25')).toBe(725);
    expect(helper.cents('0')).toBe(0);
    for (const value of ['0.001', '-1', 'NaN', '1e2', '1000.01', 'Infinity', ''])
      expect(() => helper.cents(value)).toThrow();
    expect(() =>
      helper.setupInput({ name: 'AI', 'daily-budget': '5', 'auto-approve': '4', 'max-transaction': '3' }),
    ).toThrow();
  });
  it('allows HTTPS and local development while rejecting unsafe connection URLs', () => {
    expect(helper.baseUrl('https://capora.example/')).toBe('https://capora.example');
    expect(helper.baseUrl('http://localhost:5173')).toBe('http://localhost:5173');
    for (const value of [
      'http://capora.example',
      'https://user:password@capora.example',
      'https://capora.example/mcp',
      'https://capora.example/?token=secret',
    ])
      expect(() => helper.baseUrl(value)).toThrow();
  });
});
