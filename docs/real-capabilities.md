# Real capabilities

The default catalog uses live sources and computed tools. A purchase grants one invocation with the exact quoted input. Results are persisted and can be retrieved later by the purchasing agent, without another purchase. Payments still use PayPal Sandbox or the explicit local simulator.

| Capability                     | Input example                                                                 | Result                                                                         | Price |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----- |
| Company Registry Search        | `{"company":"Microsoft","limit":5}`                                           | Live GLEIF LEIs, legal names, jurisdictions, registration status, source links | $0.20 |
| Research Metadata Search       | `{"query":"robotics","limit":5}`                                              | Crossref titles, DOIs, authors, publishers, publication dates                  | $0.25 |
| World Bank Economic Indicators | `{"country":"USA","indicator":"SP.POP.TOTL","startYear":2020,"endYear":2024}` | Reported country/year observations, including null values                      | $0.10 |
| GitHub Repository Intelligence | `{"repository":"cloudflare/workers-sdk"}`                                     | Current public repository metadata, license, stars, last push                  | $0.15 |
| Code Pattern Scan              | `{"code":"eval(req.body.code);"}`                                             | Queued line-level findings for three deterministic rules                       | $3.00 |
| Document Fingerprint           | `{"text":"abc"}`                                                              | SHA-256 digest, UTF-8 byte count, optional expected-digest comparison          | $0.10 |

All outputs include `synthetic: false`, `source`, `sourceUrl`, `observedAt`, `license`, `limitations` and `data`. `observedAt` is the retrieval/computation time, not the publication date of every record. Source record dates remain separate. An empty source result remains empty; source failures never fall back to fixtures.

Public-data prices cover Capora's retrieval and normalization service. Capora is the listed service provider, without implying affiliation with the upstream organizations. These listings do not claim exclusive access. Sources:

- [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api): public LEI data, CC0. Search matches are candidates, not a conclusive identity check; many businesses have no LEI.
- [Crossref API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/): public bibliographic metadata. No abstracts or full-text articles are distributed.
- [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures): attribution to World Bank, CC BY 4.0 subject to dataset-specific terms. Population, current-USD GDP and modeled unemployment are supported for the countries in the input schema; reported values may lag and may be revised.
- [GitHub API](https://docs.github.com/en/rest/repos/repos#get-a-repository): public metadata only. Repository code retains its own license. No private access or source-code cloning is provided.

The scanner evaluates only the supplied code. Its three pattern rules are not a comprehensive security audit and may produce false positives or miss problems. It returns at most 100 findings, with `totalFindings` and `truncated` showing whether more were found. A document fingerprint detects content changes relative to a known digest; it does not establish authenticity or issuer identity.

## Setup and upgrade

Run `pnpm setup:local`. Existing local users, secrets, policies, payments and results are preserved. Migration `0004_real_capabilities.sql` retires the ten original fixture listings and adds the new catalog to an existing seeded workspace. On a fresh installation the normal seed creates the new catalog. The same migration is applied during an authorized deployment; no remote seed or credential rotation is required for an existing deployment.

Old paid fixture purchases keep their original, explicitly synthetic execution contract. They can still be invoked and read, but the retired listings cannot receive new quotes. New listings have separate IDs, so old quotes and receipts never silently acquire different meanings.

Built-in `builtin://` endpoints are a closed list, dispatched only through the paid gateway. External URLs are constructed from fixed source hosts. Buyer input cannot select a host, redirects are rejected, and responses and normalized results are bounded to 256 KiB with a 25-second source deadline. No upstream API keys are required. Shared public API limits apply; failures consume the existing execution entitlement and do not automatically refund a purchase. Paid/private sources can still be registered through the provider console using approved HTTPS endpoints or owned R2 datasets.

New listings start with unmeasured reliability and unrated reputation. Execution counters provide observed reliability after calls; no fabricated ratings or measured SLA are seeded.

## Verification

`pnpm exec tsx scripts/verify-real-providers.ts` performs read-only network checks against the four live sources plus known scanner/fingerprint inputs. It makes no purchases, payments or database changes. `pnpm test:e2e` exercises the real HTTP/MCP purchase and invocation flow locally using simulated payments and a live GLEIF query. Isolated unit, Worker and browser tests use disposable storage and computed tools; legacy fixtures exist only to test prior-contract compatibility and controlled failures.
