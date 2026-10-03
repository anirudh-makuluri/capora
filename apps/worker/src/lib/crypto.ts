import { DomainError } from '@capora/types';
const encoder = new TextEncoder();
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64 = (str: string) =>
  Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export function token(): string {
  return `cap_${b64(crypto.getRandomValues(new Uint8Array(32)))}`;
}
export async function equalSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function encryptionKey(secret: string) {
  if (!secret || secret.length < 32)
    throw new DomainError('CONFIGURATION_REQUIRED', 'A strong encryption key is required.', 503);
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encoder.encode(secret)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function seal(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `${b64(iv)}.${b64(new Uint8Array(ciphertext))}`;
}
export async function unseal(value: string, secret: string): Promise<string> {
  const [iv, data] = value.split('.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) },
    await encryptionKey(secret),
    unb64(data),
  );
  return new TextDecoder().decode(plaintext);
}
async function signingKey(secret: string) {
  if (!secret || secret.length < 32)
    throw new DomainError('CONFIGURATION_REQUIRED', 'A strong session secret is required.', 503);
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}
export async function signSession(userId: string, secret: string): Promise<string> {
  const payload = b64(encoder.encode(JSON.stringify({ userId, expires: Date.now() + 12 * 60 * 60 * 1000 })));
  return `${payload}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload))))}`;
}
export async function verifySession(value: string, secret: string): Promise<string | null> {
  try {
    const [payload, sig] = value.split('.');
    if (
      !payload ||
      !sig ||
      !(await crypto.subtle.verify('HMAC', await signingKey(secret), unb64(sig), encoder.encode(payload)))
    )
      return null;
    const data: { userId: string; expires: number } = JSON.parse(new TextDecoder().decode(unb64(payload)));
    return data.expires > Date.now() && typeof data.userId === 'string' ? data.userId : null;
  } catch {
    return null;
  }
}
