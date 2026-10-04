# Publish a capability

Open **Provider console**, create a provider profile, then register a capability. The MVP supports `api`, `dataset`, and `agent` types, synchronous or queued execution, and fixed per-call USD pricing.

Provide a clear name and description that explain the access being sold: licensed data, an authenticated API, specialized tooling, or private infrastructure. A different generic LLM prompt alone is not a capability.

## HTTPS provider

An operator must first add the exact provider hostname to `PROVIDER_ALLOWED_HOSTS`. Use HTTPS on the standard port with no URL credentials. Redirects and private/literal IP targets are blocked. Enter an optional Bearer credential in the registration form; it is encrypted in D1 and only decrypted by Capora's gateway.

For a POST provider, the HTTP JSON body is the quoted capability input. A GET provider receives scalar input fields as query parameters. The response must be a JSON object matching the output schema. Calls time out after 25 seconds and bodies cannot exceed 256 KiB, so queue mode is appropriate for work within that execution bound that should not hold up an interactive agent. Longer external workflows would need a provider-side start/poll contract in a later version.

Example metadata:

```json
{
  "name": "Inventory Availability",
  "description": "Authenticated warehouse inventory inaccessible to public-web tools.",
  "type": "api",
  "category": "Operations",
  "endpoint": "https://inventory.example.com/check",
  "httpMethod": "POST",
  "priceCents": 20,
  "pricingUnit": "query",
  "expectedLatencyMs": 2000,
  "availability": 0.999,
  "tags": ["inventory", "warehouse"],
  "inputSchema": {
    "type": "object",
    "properties": { "sku": { "type": "string", "minLength": 1 } },
    "required": ["sku"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": { "available": { "type": "integer", "minimum": 0 } },
    "required": ["available"],
    "additionalProperties": false
  }
}
```

The console adds `providerId`, lets you select execution mode, and accepts the credential separately. Custom HTTP error bodies are not exposed verbatim to buyers; Capora returns a structured provider failure and records the invocation status.

## Uploaded dataset

Choose Dataset and upload a JSON object using the console's dataset control. It persists to R2 and fills an owned `r2://datasets/...` endpoint. Define an input schema (an empty object is valid for a complete dataset) and an output schema matching the stored object. Each paid call grants one retrieval; subscription licensing and partial-query engines are outside this MVP.

## Edits, disable, analytics

Edit a capability to change its price, schemas, endpoint, authentication, latency, tags, or execution mode. The version increments, invalidating old unpurchased quotes. Disable prevents new discovery/purchases and unstarted execution. Credentials are never displayed again; the console shows whether one is present.

The console reports actual purchase revenue, invocation success/failure counts, and average observed latency. Built-in listings start with unmeasured reliability and unrated reputation; once a capability runs, reliability is its measured success fraction. The displayed revenue is a marketplace ledger, not an executed provider payout. Availability is provider-declared metadata, not an independently verified SLA.

## SDK

`@capora/provider-sdk` exports capability metadata/request/result/job/error types and `validateSchemaDefinition` / `validatePayload`. Example:

```ts
import { validatePayload } from '@capora/provider-sdk';

const inputSchema = {
  type: 'object',
  properties: { sku: { type: 'string', minLength: 1 } },
  required: ['sku'],
  additionalProperties: false,
};
validatePayload(inputSchema, { sku: 'ACME-123' });
```

Use the same schema at registration and in your provider. The default catalog uses the source adapters and computed tools in `apps/worker/src/providers/live.ts`. See [real capabilities](real-capabilities.md) for supported inputs and source limitations. `demo://` endpoints remain for isolated fault-injection tests and old paid fixture purchases, and remain explicitly synthetic.
