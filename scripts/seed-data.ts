import { builtinCapabilities } from '../apps/worker/src/providers/capabilities/registry';
import { builtinOutputSchema } from '../packages/provider-sdk/src/builtins';
import { bankCatalogStatements } from '../apps/worker/src/bank/capabilities';
import { CAPORA_BANK_PROVIDER_ID } from '../packages/config/src/index';

// Seeding, catalog sync and execution use the same registered definitions.
export { builtinCapabilities as seedCapabilities, builtinOutputSchema };
export const sqlValue = (value: unknown) =>
  value === null
    ? 'NULL'
    : `'${String(typeof value === 'object' ? JSON.stringify(value) : value).replace(/'/g, "''")}'`;

export function catalogStatements(ownerId: string, now: string): string[] {
  return [
    ...bankCatalogStatements(ownerId, now, sqlValue),
    ...builtinCapabilities.flatMap((capability) => {
      const providerId = CAPORA_BANK_PROVIDER_ID;
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
        `INSERT INTO capabilities (id,provider_id,${columns.join(',')},endpoint,baseline_reliability,availability,created_at)
       SELECT ${sqlValue(capability.id)},id,${Object.values(fields).map(sqlValue).join(',')},${sqlValue(`builtin://${capability.id}`)},0,0,${sqlValue(now)} FROM providers WHERE id=${sqlValue(providerId)} AND user_id=${sqlValue(ownerId)}
       ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id,${columns.map((column) => `${column}=excluded.${column}`).join(',')},version=capabilities.version+1
       WHERE capabilities.endpoint=excluded.endpoint
       AND (capabilities.provider_id=excluded.provider_id OR
         (capabilities.provider_id=${sqlValue(`provider_${capability.id}`)} AND EXISTS
           (SELECT 1 FROM providers WHERE id=capabilities.provider_id AND user_id=${sqlValue(ownerId)} AND name='Capora')))
       AND (capabilities.provider_id=excluded.provider_id OR NOT EXISTS
         (SELECT 1 FROM bank_escrows e JOIN purchases p ON p.id=e.purchase_id
          WHERE p.capability_id=capabilities.id AND e.state NOT IN ('released','refunded')))
       AND (capabilities.provider_id IS NOT excluded.provider_id OR ${columns.map((column) => `capabilities.${column} IS NOT excluded.${column}`).join(' OR ')});`,
      ];
    }),
  ];
}
