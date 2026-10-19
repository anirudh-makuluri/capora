import { CAPORA_BANK_PROVIDER_ID } from '@capora/config';
import { DomainError, marketplaceFeeUpdateSchema, type MarketplaceFeeSettings } from '@capora/types';
import { marketplaceFeeBps } from '../bank/config';
import type { Env } from '../env';

const feeSchema = marketplaceFeeUpdateSchema.shape.feeBps;
export async function getMarketplaceFeeSettings(env: Env): Promise<MarketplaceFeeSettings> {
  const row = await env.DB.prepare(
    "SELECT value,revision,updated_at FROM operator_settings WHERE key='marketplace_fee_bps'",
  ).first<{ value: string; revision: number; updated_at: string }>();
  return row
    ? {
        feeBps: feeSchema.parse(JSON.parse(row.value)),
        source: 'dashboard',
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : {
        feeBps: marketplaceFeeBps(env),
        source: env.BANK_MARKETPLACE_FEE_BPS === undefined ? 'default' : 'environment',
        revision: 0,
        updatedAt: null,
      };
}
export async function providerFeeBps(env: Env, providerId: string) {
  return providerId === CAPORA_BANK_PROVIDER_ID ? 0 : (await getMarketplaceFeeSettings(env)).feeBps;
}
export async function saveMarketplaceFee(
  env: Env,
  userId: string,
  input: unknown,
): Promise<MarketplaceFeeSettings> {
  const { feeBps, revision } = marketplaceFeeUpdateSchema.parse(input);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO operator_settings(key,value,revision,updated_at,updated_by)
     SELECT 'marketplace_fee_bps',?,1,?,? WHERE ?=0
     ON CONFLICT(key) DO NOTHING RETURNING revision`,
  )
    .bind(JSON.stringify(feeBps), now, userId, revision)
    .first<{ revision: number }>();
  const updated =
    row ??
    (await env.DB.prepare(
      `UPDATE operator_settings SET value=?,revision=revision+1,updated_at=?,updated_by=?
     WHERE key='marketplace_fee_bps' AND revision=? AND ?>0 RETURNING revision`,
    )
      .bind(JSON.stringify(feeBps), now, userId, revision, revision)
      .first<{ revision: number }>());
  if (!updated)
    throw new DomainError(
      'SETTINGS_CHANGED',
      'Another admin changed the marketplace fee. Reload the fee before saving.',
      409,
    );
  return { feeBps, source: 'dashboard', revision: updated.revision, updatedAt: now };
}
