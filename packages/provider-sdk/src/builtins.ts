import type { CapabilityType, JsonSchema } from '@capora/types';
const object = (properties: Record<string, unknown>, required: string[]): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export interface BuiltinCapability {
  id: string;
  name: string;
  description: string;
  type: CapabilityType;
  category: string;
  priceCents: number;
  async?: boolean;
  latency: number;
  tags: string[];
  documentationUrl: string;
  schema: JsonSchema;
  dataSchema: JsonSchema;
}

export function builtinOutputSchema(capability: BuiltinCapability): JsonSchema {
  return object(
    {
      synthetic: { type: 'boolean', enum: [false] },
      source: { type: 'string' },
      sourceUrl: { type: 'string' },
      observedAt: { type: 'string' },
      license: { type: 'string' },
      limitations: { type: 'string' },
      data: capability.dataSchema,
    },
    ['synthetic', 'source', 'sourceUrl', 'observedAt', 'license', 'limitations', 'data'],
  );
}
