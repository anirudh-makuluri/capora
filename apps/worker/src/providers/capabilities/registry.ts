import { builtinOutputSchema, validateSchemaDefinition } from '@capora/provider-sdk';
import { DomainError } from '@capora/types';
import { gleifEntities } from './gleif_entities';
import { crossrefResearch } from './crossref_research';
import { worldbankIndicators } from './worldbank_indicators';
import { githubRepository } from './github_repository';
import { codeScan } from './code_scan';
import { documentFingerprint } from './document_fingerprint';
import type { CapabilityDefinition } from './types';

export function createCapabilityRegistry(definitions: readonly CapabilityDefinition[]) {
  const byEndpoint = new Map<string, CapabilityDefinition>();
  for (const definition of definitions) {
    const { metadata } = definition;
    if (!/^[a-z][a-z0-9_]*$/.test(metadata.id))
      throw new Error(`Invalid built-in capability ID: ${metadata.id}`);
    const endpoint = `builtin://${metadata.id}`;
    if (byEndpoint.has(endpoint)) throw new Error(`Duplicate built-in capability ID: ${metadata.id}`);
    validateSchemaDefinition(metadata.schema);
    validateSchemaDefinition(builtinOutputSchema(metadata));
    byEndpoint.set(endpoint, definition);
  }
  return {
    metadata: definitions.map((definition) => definition.metadata),
    get(endpoint: string): CapabilityDefinition {
      const definition = byEndpoint.get(endpoint);
      if (!definition) throw new DomainError('ENDPOINT_NOT_ALLOWED', 'Unknown built-in capability.');
      return definition;
    },
  };
}

// Register each capability once. Catalog sync and paid execution use this list.
export const registeredCapabilities: readonly CapabilityDefinition[] = [
  gleifEntities,
  crossrefResearch,
  worldbankIndicators,
  githubRepository,
  codeScan,
  documentFingerprint,
];

const registry = createCapabilityRegistry(registeredCapabilities);
export const builtinCapabilities = registry.metadata;
export const getRegisteredCapability = registry.get;
