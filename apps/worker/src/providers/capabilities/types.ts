import type { BuiltinCapability } from '@capora/provider-sdk';
import type { Env } from '../../env';

export interface CapabilityContext {
  signal: AbortSignal;
  env?: Partial<Env>;
}

export interface CapabilityExecution {
  data: Record<string, unknown>;
  source: string;
  sourceUrl?: string;
  license?: string;
}

export interface CapabilityDefinition {
  metadata: BuiltinCapability;
  /** Longer deadlines are allowed only for queued built-ins, capped at two minutes. */
  executionTimeoutMs?: number;
  validateInput?(input: Record<string, unknown>): void;
  execute(input: Record<string, unknown>, context: CapabilityContext): Promise<CapabilityExecution>;
}
