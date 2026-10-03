import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { equalSecret } from '../lib/crypto';

export const demoProviders = new Hono<AppEnv>();
export function buildDemoResult(capabilityId: string, input: Record<string, unknown>) {
  const company = typeof input.company === 'string' ? input.company : 'Acme Robotics';
  const region = typeof input.region === 'string' ? input.region : 'Arizona';
  const common = {
    synthetic: true,
    disclaimer: 'Synthetic hackathon fixture. This is not verified intelligence about a real company.',
    source: capabilityId,
    observedAt: '2026-10-01',
  };
  if (['datapulse_headcount', 'companyintel_premium'].includes(capabilityId))
    return {
      ...common,
      company,
      region,
      confidence: capabilityId === 'datapulse_headcount' ? 0.94 : 0.99,
      data: {
        currentHeadcount: 187,
        previousHeadcount: 142,
        growthPercent: 31.7,
        regionalHeadcount: 38,
        regionalOpenRoles: 12,
        trend: [
          { month: '2026-07', employees: 142, regional: 21 },
          { month: '2026-08', employees: 163, regional: 29 },
          { month: '2026-09', employees: 187, regional: 38 },
        ],
        signals: [
          'Arizona headcount grew from 21 to 38 in three months.',
          '12 Arizona roles are listed in the synthetic hiring feed.',
          'Engineering and field operations account for most new roles.',
        ],
        ...(capabilityId === 'companyintel_premium'
          ? {
              corroboration: ['licensed payroll panel', 'provider-verified employment registry'],
              sampleSize: 187,
            }
          : { sampleSize: 94 }),
      },
    };
  if (capabilityId === 'securescan_advanced') {
    const code =
      typeof input.code === 'string'
        ? input.code
        : 'const query = `SELECT * FROM users WHERE id = ${req.query.id}`; eval(req.body.code);';
    const findings: { severity: string; rule: string; line: number; message: string; remediation: string }[] =
      [];
    code.split('\n').forEach((line, i) => {
      if (/\beval\s*\(/.test(line))
        findings.push({
          severity: 'critical',
          rule: 'unsafe-eval',
          line: i + 1,
          message: 'Dynamic code execution may accept untrusted input.',
          remediation: 'Remove eval and use an explicit, validated operation map.',
        });
      if (/SELECT|INSERT|UPDATE/i.test(line) && /\$\{|\+\s*(req|input)/.test(line))
        findings.push({
          severity: 'high',
          rule: 'sql-interpolation',
          line: i + 1,
          message: 'A SQL query contains interpolated values.',
          remediation: 'Use parameterized queries.',
        });
      if (/\b(password|secret|api_key)\s*[:=]\s*["'][^"']{6,}["']/i.test(line))
        findings.push({
          severity: 'high',
          rule: 'hardcoded-secret',
          line: i + 1,
          message: 'Possible credential embedded in source.',
          remediation: 'Rotate the credential and move it to a secret binding.',
        });
    });
    return {
      ...common,
      source: 'SecureScan rule scanner v1 (demo)',
      data: {
        repository: input.repository ?? 'provided code sample',
        filesAnalyzed: 1,
        linesAnalyzed: code.split('\n').length,
        findings,
        riskLevel: findings.length ? 'high' : 'low',
        limitations:
          'Small deterministic rule set, not a comprehensive security audit. Repository URLs use a fixture; supply code for analysis.',
      },
    };
  }
  const fixtures: Record<string, unknown> = {
    verifycorp: {
      company,
      registrationStatus: 'active',
      jurisdiction: 'Arizona',
      registryId: 'SYN-AZ-20491',
      verified: true,
    },
    legalarchive: {
      query: input.query,
      records: [
        {
          title: 'Commercial registration filing',
          date: '2026-08-11',
          jurisdiction: 'Arizona',
          documentId: 'SYN-LEGAL-107',
        },
      ],
      total: 1,
    },
    geointel: {
      region,
      locations: [
        { city: 'Phoenix', commercialActivityIndex: 78 },
        { city: 'Tucson', commercialActivityIndex: 62 },
      ],
      coverage: 'United States',
    },
    retail_demand: {
      query: input.query,
      demandIndex: 83,
      changePercent: 14.2,
      period: '2026-Q3',
      channels: ['specialty retail', 'online'],
    },
    documentverify: {
      document: input.document,
      valid: true,
      confidence: 0.98,
      checks: ['format', 'issuer consistency', 'document integrity'],
    },
    supplychain_radar: { company, suppliers: 17, riskIndex: 23, flaggedSuppliers: 2, region },
    patentlens: {
      query: input.query,
      patents: [
        { title: 'Adaptive robotic gripper system', jurisdiction: 'US', year: 2025, id: 'SYN-PAT-200' },
      ],
      total: 1,
    },
  };
  return {
    ...common,
    data: fixtures[capabilityId] ?? { input, message: 'Synthetic provider execution completed.' },
  };
}
demoProviders.post('/:capabilityId', async (c) => {
  if (
    !c.env.DEMO_PROVIDER_SECRET ||
    !(await equalSecret(c.req.header('Authorization') ?? '', `Bearer ${c.env.DEMO_PROVIDER_SECRET}`))
  )
    return c.json({ error: 'Unauthorized provider request' }, 401);
  const { input } = z
    .object({ input: z.record(z.string(), z.unknown()), invocationId: z.string() })
    .parse(await c.req.json());
  // Deterministic fault injection only on authenticated demo endpoints.
  if (input.demoFailure === true) return c.json({ error: 'Controlled demo provider failure' }, 503);
  const capabilityId = c.req.param('capabilityId');
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      capabilityId === 'companyintel_premium' ? 1100 : capabilityId === 'securescan_advanced' ? 1600 : 350,
    ),
  );
  return c.json(buildDemoResult(capabilityId, input));
});
