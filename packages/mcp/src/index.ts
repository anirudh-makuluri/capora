import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  searchSchema,
  quoteSchema,
  invokeSchema,
  DomainError,
  type SearchInput,
  type JsonInput,
} from '@capora/types';
import { TOOL_DESCRIPTIONS } from './tools';
export { TOOL_DESCRIPTIONS } from './tools';

export interface MarketplaceTools {
  search(input: SearchInput): Promise<unknown>;
  capability(id: string): Promise<unknown>;
  quote(capabilityId: string, input: JsonInput, reason?: string): Promise<unknown>;
  purchase(quoteId: string): Promise<unknown>;
  invoke(purchaseId: string, input: JsonInput): Promise<unknown>;
  job(jobId: string): Promise<unknown>;
  budget(): Promise<unknown>;
  purchaseStatus(purchaseId: string): Promise<unknown>;
}
export async function handleMcp(
  request: Request,
  tools: MarketplaceTools,
  correlationId: string,
): Promise<Response> {
  const server = new McpServer(
    { name: 'Capora', version: '0.1.0' },
    {
      instructions:
        'Capora brokers real machine capabilities. Discover, inspect schemas, quote exact input, purchase under budget policy, then invoke after payment completes. Synthetic demo capabilities are explicitly labeled. All money is USD cents. Poll get_purchase_status for approvals and get_job for async execution.',
    },
  );
  const call = async (fn: () => Promise<unknown>) => {
    try {
      const data = await fn();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data) }],
        structuredContent: { result: data },
      };
    } catch (error) {
      const body =
        error instanceof DomainError
          ? { code: error.code, message: error.message, correlationId }
          : {
              code: 'INTERNAL_ERROR',
              message:
                'Capora could not complete this operation. Retry reads or check purchase status before retrying payment.',
              correlationId,
            };
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: body }) }] };
    }
  };
  server.registerTool(
    'search_capabilities',
    {
      description: TOOL_DESCRIPTIONS.search_capabilities,
      inputSchema: searchSchema,
      annotations: { readOnlyHint: true },
    },
    (input) => call(() => tools.search(input)),
  );
  server.registerTool(
    'get_capability',
    {
      description: TOOL_DESCRIPTIONS.get_capability,
      inputSchema: z.object({ capability_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    (input) => call(() => tools.capability(input.capability_id)),
  );
  server.registerTool(
    'get_quote',
    { description: TOOL_DESCRIPTIONS.get_quote, inputSchema: quoteSchema },
    (input) => call(() => tools.quote(input.capability_id, input.input, input.reason)),
  );
  server.registerTool(
    'purchase_capability',
    {
      description: TOOL_DESCRIPTIONS.purchase_capability,
      inputSchema: z.object({ quote_id: z.string() }),
      annotations: { idempotentHint: true },
    },
    (input) => call(() => tools.purchase(input.quote_id)),
  );
  server.registerTool(
    'invoke_capability',
    {
      description: TOOL_DESCRIPTIONS.invoke_capability,
      inputSchema: invokeSchema,
      annotations: { idempotentHint: true },
    },
    (input) => call(() => tools.invoke(input.purchase_id, input.input)),
  );
  server.registerTool(
    'get_job',
    {
      description: TOOL_DESCRIPTIONS.get_job,
      inputSchema: z.object({ job_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    (input) => call(() => tools.job(input.job_id)),
  );
  server.registerTool(
    'get_budget',
    {
      description: TOOL_DESCRIPTIONS.get_budget,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => call(() => tools.budget()),
  );
  server.registerTool(
    'get_purchase_status',
    {
      description: TOOL_DESCRIPTIONS.get_purchase_status,
      inputSchema: z.object({ purchase_id: z.string() }),
      annotations: { idempotentHint: true },
    },
    (input) => call(() => tools.purchaseStatus(input.purchase_id)),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}
