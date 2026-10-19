export const BANK_CHAIN_ID = 84532;
export const CUSD_DECIMALS = 6;
export const SIMULATED_FUNDS = 'TESTNET / SIMULATED FUNDS — cUSD is a demo token, not redeemable USD.';
export function units(value: string, decimals = CUSD_DECIMALS): bigint {
  if (!/^(0|[1-9]\d{0,12})(\.\d+)?$/.test(value)) throw new Error('Use a positive decimal amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`At most ${decimals} decimal places are supported.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}
export function displayUnits(value: bigint | string, decimals = CUSD_DECIMALS): string {
  const signed = BigInt(value),
    n = signed < 0n ? -signed : signed,
    base = 10n ** BigInt(decimals);
  const fraction = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${signed < 0n ? '-' : ''}${n / base}${fraction ? `.${fraction}` : ''}`;
}
export function centsToUnits(cents: number): bigint {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid cent amount.');
  return BigInt(cents) * 10_000n;
}
export function unitsToCents(value: bigint): number {
  if (value < 0n) throw new Error('Amount is out of range.');
  const cents = (value + 9_999n) / 10_000n;
  if (cents < 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is out of range.');
  return Number(cents);
}
export const explorer = (hash: string, kind: 'tx' | 'address' = 'tx') =>
  `https://sepolia.basescan.org/${kind}/${hash}`;
