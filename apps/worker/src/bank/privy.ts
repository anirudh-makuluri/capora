import { DomainError } from '@capora/types';
import { boundedJson } from '../lib/provider-http';
import type { Env } from '../env';

// Privy requires RFC 8785 ordering (UTF-16 code units), not locale-dependent sorting.
export function privyCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(privyCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${privyCanonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function privyAuthorizationSignature(
  key: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
) {
  const bytes = Uint8Array.from(atob(key.replace(/^wallet-auth:/, '')), (value) => value.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const payload = new TextEncoder().encode(
    privyCanonical({ version: 1, method: 'POST', url, body, headers }),
  );
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, payload),
  );
  if (raw.length !== 64) throw new Error('Invalid P-256 signature.');
  // Web Crypto uses IEEE P1363; Privy expects an ASN.1 DER sequence of two integers.
  const integer = (part: Uint8Array) => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start++;
    const value = [...part.slice(start)];
    if (value[0] & 0x80) value.unshift(0);
    return [2, value.length, ...value];
  };
  const sequence = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))];
  return btoa(String.fromCharCode(0x30, sequence.length, ...sequence));
}

async function appendPrivyConditionItem(
  env: Pick<Env, 'PRIVY_APP_ID' | 'PRIVY_APP_SECRET' | 'PRIVY_ENROLLMENT_AUTHORIZATION_KEY'>,
  setId: string,
  address: string,
  operation: string,
) {
  if (
    !env.PRIVY_APP_ID ||
    !env.PRIVY_APP_SECRET ||
    !env.PRIVY_ENROLLMENT_AUTHORIZATION_KEY ||
    !/^[a-z0-9]{24}$/.test(setId)
  )
    throw new DomainError(
      'SIGNER_ENROLLMENT_REQUIRED',
      'Configure the Bank signer enrollment key and condition sets.',
      503,
    );
  const url = `https://api.privy.io/v1/condition_sets/${setId}/condition_set_items`;
  const body = [{ value: address.toLowerCase() }];
  const headers = {
    'privy-app-id': env.PRIVY_APP_ID,
    'privy-idempotency-key': operation,
    'privy-request-expiry': String(Date.now() + 60_000),
  };
  let signature: string;
  try {
    signature = await privyAuthorizationSignature(env.PRIVY_ENROLLMENT_AUTHORIZATION_KEY, url, body, headers);
  } catch {
    throw new DomainError(
      'SIGNER_ENROLLMENT_REQUIRED',
      'The Bank enrollment authorization key is invalid.',
      503,
    );
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      Authorization: `Basic ${btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`)}`,
      'privy-authorization-signature': signature,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 400) {
      const error = await boundedJson(response, 16_384);
      if (error && typeof error === 'object' && 'code' in error && error.code === 'invalid_data') {
        // Concurrent enrollment and operator setup can both have inserted this address.
        // A rejected append is safe only after independently verifying actual membership.
        let cursor: string | undefined;
        const seen = new Set<string>();
        for (let page = 0; page < 20; page++) {
          const list = await fetch(cursor ? `${url}?cursor=${encodeURIComponent(cursor)}` : url, {
            headers: {
              'privy-app-id': env.PRIVY_APP_ID,
              Authorization: `Basic ${btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`)}`,
            },
            signal: AbortSignal.timeout(15_000),
          });
          if (!list.ok) {
            await list.body?.cancel();
            break;
          }
          const result = await boundedJson(list, 65_536);
          if (!result || typeof result !== 'object' || !('items' in result) || !Array.isArray(result.items))
            break;
          if (
            result.items.some(
              (item) =>
                item &&
                typeof item === 'object' &&
                item.condition_set_id === setId &&
                typeof item.value === 'string' &&
                item.value.toLowerCase() === address.toLowerCase(),
            )
          )
            return;
          if (
            !('next_cursor' in result) ||
            typeof result.next_cursor !== 'string' ||
            !result.next_cursor ||
            seen.has(result.next_cursor)
          )
            break;
          cursor = result.next_cursor;
          seen.add(cursor);
        }
      }
    } else await response.body?.cancel();
    throw new DomainError(
      'SIGNER_ENROLLMENT_UNAVAILABLE',
      'Signer enrollment is pending. Retry the same Bank operation.',
      503,
    );
  }
  const result = await boundedJson(response, 16_384);
  if (
    !Array.isArray(result) ||
    !result.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.value === 'string' &&
        item.value.toLowerCase() === address.toLowerCase() &&
        item.condition_set_id === setId,
    )
  )
    throw new DomainError('SIGNER_ENROLLMENT_UNAVAILABLE', 'Signer enrollment could not be verified.', 503);
}

export async function addPrivyConditionItem(...args: Parameters<typeof appendPrivyConditionItem>) {
  try {
    await appendPrivyConditionItem(...args);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'SIGNER_ENROLLMENT_REQUIRED') throw error;
    throw new DomainError(
      'SIGNER_ENROLLMENT_UNAVAILABLE',
      'Signer enrollment is pending. Retry the same Bank operation.',
      503,
    );
  }
}
