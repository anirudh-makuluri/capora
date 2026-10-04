import { builtinCapabilities } from '../apps/worker/src/providers/capabilities/registry';
import { builtinOutputSchema } from '../packages/provider-sdk/src/builtins';

// Seeding, catalog sync and execution use the same registered definitions.
export { builtinCapabilities as seedCapabilities, builtinOutputSchema };
export const sqlValue = (value: unknown) =>
  value === null
    ? 'NULL'
    : `'${String(typeof value === 'object' ? JSON.stringify(value) : value).replace(/'/g, "''")}'`;

export function catalogStatements(ownerId: string, now: string): string[] {
  return builtinCapabilities.flatMap((capability) => {
    const providerId = `provider_${capability.id}`;
    const fields = {
      name: capability.name,
      description: capability.description,
      type: capability.type,
      category: capability.category,
      price_cents: capability.priceCents,
      pricing_unit: 'query',
      input_schema: capability.schema,
      output_schema: builtinOutputSchema(capability),
      expected_latency_ms: capability.latency,
      tags: capability.tags,
      async: capability.async ? 1 : 0,
      synthetic: 0,
      documentation_url: capability.documentationUrl,
    };
    const columns = Object.keys(fields);
    return [
      `INSERT INTO providers (id,user_id,name,description,reputation,created_at)
       VALUES (${sqlValue(providerId)},${sqlValue(ownerId)},'Capora',${sqlValue(capability.description)},0,${sqlValue(now)}) ON CONFLICT DO NOTHING;`,
      `INSERT INTO capabilities (id,provider_id,${columns.join(',')},endpoint,baseline_reliability,availability,created_at)
       VALUES (${sqlValue(capability.id)},${sqlValue(providerId)},${Object.values(fields).map(sqlValue).join(',')},${sqlValue(`builtin://${capability.id}`)},0,0,${sqlValue(now)})
       ON CONFLICT(id) DO UPDATE SET ${columns.map((column) => `${column}=excluded.${column}`).join(',')},version=capabilities.version+1
       WHERE capabilities.endpoint=excluded.endpoint AND capabilities.provider_id=excluded.provider_id
       AND EXISTS (SELECT 1 FROM providers WHERE id=excluded.provider_id AND user_id=${sqlValue(ownerId)})
       AND (${columns.map((column) => `capabilities.${column} IS NOT excluded.${column}`).join(' OR ')});`,
    ];
  });
}
