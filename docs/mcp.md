# Connect an agent to Capora

Endpoint: `/mcp`. Transport: authenticated, stateless **Streamable HTTP** using the official `@modelcontextprotocol/sdk` Web Standard server transport.

Create an agent in My agents; save its one-time token in the client’s secret storage. Send `Authorization: Bearer cap_…` on every MCP request. The dashboard session cookie does not authenticate MCP. Tokens are SHA-256 hashes at rest and revoked immediately by rotation/revocation.

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'research-agent', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(process.env.CAPORA_MCP_URL!), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.CAPORA_AGENT_TOKEN}` } },
  }),
);
const capabilities = await client.callTool({
  name: 'search_capabilities',
  arguments: { query: 'company registry', max_budget: 5, sort: 'price' },
});
```

The generic config shown in the app works in remote-HTTP clients that accept `url` and `headers`. Some clients use `servers` instead of `mcpServers`, require an explicit `type: http`, or store tokens separately. Follow the specific client’s current settings; Capora’s authentication contract remains the same.

## Tool inputs

| Tool                  | Arguments                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | `query`; optional `requirements`, `type`, `category`, `max_budget` (USD dollars), `min_reliability` (0–100), `min_reputation` (0–5), `max_latency_ms`, `sort` |
| `get_capability`      | `capability_id`                                                                                                                                               |
| `get_quote`           | `capability_id`, `input` (exact JSON object), optional `reason`                                                                                               |
| `purchase_capability` | `quote_id`                                                                                                                                                    |
| `get_purchase_status` | `purchase_id`                                                                                                                                                 |
| `invoke_capability`   | `purchase_id`, `input` (same as quoted object)                                                                                                                |
| `get_job`             | `job_id`                                                                                                                                                      |
| `get_budget`          | none                                                                                                                                                          |

DTOs use camelCase (`priceCents`, `purchase.id`, `jobId`, `remainingCents`); tool arguments use the stable snake_case names above. All returned monetary fields are integer USD cents. `max_budget` is an explicit dollar-denominated search convenience. `requirements` carries contextual metadata for future search providers; it does not currently enforce input/coverage constraints. Verify coverage using returned schemas and metadata.

Results have JSON text content plus `structuredContent.result`. Tool errors have `isError: true` and text JSON `{ error: { code, message, correlationId } }`.

## Successful flow

1. Call `get_budget` and search competing providers.
2. Inspect `get_capability` to learn its JSON Schemas.
3. Call `get_quote` with the intended input. Quote TTL is five minutes.
4. Purchase the quote. If `pending_approval`, tell the human to review Approvals and poll `get_purchase_status`. If `payment_pending`, the human may need Sandbox checkout; do not invoke.
5. After `purchased`, invoke with the exact quoted input. Key ordering does not matter; changed values require a new quote/purchase.
6. A synchronous invocation returns its result immediately. An asynchronous invocation returns `jobId`; poll `get_job` to a terminal state.
7. Incorporate the returned data into the original task, retaining source links, observation times, licenses and limitations. Old fixture results retain their synthetic-data disclaimer.

`get_purchase_status` is the eighth tool because approvals/checkout outlive a single MCP request. It may reconcile/capture an existing approved Sandbox order; it is idempotent but not annotated as read-only. There are no per-provider MCP tools or dynamic tool injection.

Reference: [official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/).
