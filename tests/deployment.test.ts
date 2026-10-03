import { describe, expect, it } from 'vitest';
import { validateDeploymentConfig, type DeploymentConfig } from '../scripts/deployment-config';

const valid: DeploymentConfig = {
  name: 'capora',
  d1_databases: [
    { binding: 'DB', database_name: 'capora-db', database_id: '12345678-1234-1234-1234-123456789abc' },
  ],
  vars: {
    CAPORA_BASE_URL: 'https://capora.operator.workers.dev',
    DEV_MODE: 'false',
    PAYMENT_MODE: 'sandbox',
    PAYPAL_ENVIRONMENT: 'sandbox',
    DASHBOARD_USER_ID: 'user_demo',
  },
};

describe('Cloudflare deployment preflight', () => {
  it('accepts the provisioned Sandbox deployment', () => {
    expect(validateDeploymentConfig(valid).origin).toBe(valid.vars.CAPORA_BASE_URL);
  });
  it('blocks the local placeholder database before remote operations', () => {
    const config = structuredClone(valid);
    config.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000';
    expect(() => validateDeploymentConfig(config)).toThrow(/database ID/);
  });
  it.each([
    'http://localhost:5173',
    'https://localhost',
    'https://capora.example',
    'https://capora.operator.workers.dev/',
    'https://capora.operator.workers.dev/path',
    'https://user:password@capora.operator.workers.dev',
  ])('blocks unusable deployment origin %s', (CAPORA_BASE_URL) => {
    expect(() => validateDeploymentConfig({ ...valid, vars: { ...valid.vars, CAPORA_BASE_URL } })).toThrow(
      /HTTPS origin/,
    );
  });
  it.each([
    ['DEV_MODE', 'true'],
    ['PAYMENT_MODE', 'demo'],
    ['PAYPAL_ENVIRONMENT', 'live'],
  ])('blocks unsafe setting %s=%s', (key, value) => {
    expect(() => validateDeploymentConfig({ ...valid, vars: { ...valid.vars, [key]: value } })).toThrow(
      /Deploy with/,
    );
  });
});
