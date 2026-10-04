import assert from 'node:assert/strict';
import { invokeBuiltin } from '../apps/worker/src/providers/live';

// Read-only network checks. No credentials, purchases, payments or database writes.
const checks: [string, Record<string, unknown>, string][] = [
  ['gleif_entities', { company: 'Microsoft', limit: 2 }, 'entities'],
  ['crossref_research', { query: 'robotics', limit: 2 }, 'works'],
  [
    'worldbank_indicators',
    { country: 'USA', indicator: 'SP.POP.TOTL', startYear: 2020, endYear: 2024 },
    'observations',
  ],
  ['github_repository', { repository: 'cloudflare/workers-sdk' }, 'repository'],
  ['code_scan', { code: 'eval(req.body.code);' }, 'findings'],
  ['document_fingerprint', { text: 'abc' }, 'sha256'],
];
for (const [id, input, key] of checks) {
  const result = await invokeBuiltin(`builtin://${id}`, input);
  assert.equal(result.synthetic, false);
  assert.ok(result.observedAt);
  assert.ok(result.data[key]);
  if (Array.isArray(result.data[key]))
    assert.ok(result.data[key].length > 0, `${id} must return source records.`);
  console.log(
    `PASS ${id}: ${Array.isArray(result.data[key]) ? result.data[key].length + ' records' : 'computed result'} from ${result.source}`,
  );
}
