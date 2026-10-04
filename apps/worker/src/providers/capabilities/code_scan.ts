import type { CapabilityDefinition } from './types';
import { object, array } from './shared';

export const codeScan: CapabilityDefinition = {
  metadata: {
    id: 'code_scan',
    name: 'Code Pattern Scan',
    type: 'agent',
    category: 'Security',
    description:
      'Run deterministic rules on your supplied code for eval, interpolated SQL and possible embedded credentials. Returns actual line-level findings and remediation. A limited pattern scanner with false positives and false negatives. It does not execute code or audit repositories.',
    priceCents: 300,
    async: true,
    latency: 1000,
    tags: ['security', 'code', 'analysis', 'tool'],
    documentationUrl: '/developers',
    schema: object(
      { code: { type: 'string', minLength: 1, maxLength: 100000, default: 'eval(req.body.code)' } },
      ['code'],
    ),
    dataSchema: object(
      {
        linesAnalyzed: { type: 'integer', minimum: 1 },
        findings: array,
        totalFindings: { type: 'integer', minimum: 0 },
        truncated: { type: 'boolean' },
        rules: { type: 'array', items: { type: 'string' } },
      },
      ['linesAnalyzed', 'findings', 'totalFindings', 'truncated', 'rules'],
    ),
  },

  async execute(input) {
    const code = String(input.code);
    const findings: Record<string, unknown>[] = [];
    code.split('\n').forEach((line, i) => {
      if (/\beval\s*\(/.test(line))
        findings.push({
          severity: 'high',
          rule: 'unsafe-eval',
          line: i + 1,
          message: 'Dynamic code execution may accept untrusted input.',
          remediation: 'Use an explicit validated operation map.',
        });
      if (/SELECT|INSERT|UPDATE/i.test(line) && /\$\{|\+\s*(req|input)/.test(line))
        findings.push({
          severity: 'high',
          rule: 'sql-interpolation',
          line: i + 1,
          message: 'Possible interpolated SQL.',
          remediation: 'Use parameterized queries.',
        });
      if (/\b(password|secret|api_key)\s*[:=]\s*["'][^"']{6,}["']/i.test(line))
        findings.push({
          severity: 'high',
          rule: 'hardcoded-secret',
          line: i + 1,
          message: 'Possible embedded credential.',
          remediation: 'Rotate the credential and use secret storage.',
        });
    });
    const data = {
      linesAnalyzed: code.split('\n').length,
      findings: findings.slice(0, 100),
      totalFindings: findings.length,
      truncated: findings.length > 100,
      rules: ['unsafe-eval', 'sql-interpolation', 'hardcoded-secret'],
    };
    const source = 'Capora code pattern scanner v1';

    return { data, source };
  },
};
