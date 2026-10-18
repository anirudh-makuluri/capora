# Real capabilities

The default catalog uses live sources and computed tools. A purchase grants one invocation with the exact quoted input. Results are persisted and can be retrieved later by the purchasing agent, without another purchase. Payments still use PayPal Sandbox or the explicit local simulator.

| Capability                       | Input example                                                                                                          | Result                                                                              | Price |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- |
| Company Registry Search          | `{"company":"Microsoft","limit":5}`                                                                                    | Live GLEIF LEIs, legal names, jurisdictions, registration status, source links      | $0.20 |
| Research Metadata Search         | `{"query":"robotics","limit":5}`                                                                                       | Crossref titles, DOIs, authors, publishers, publication dates                       | $0.25 |
| World Bank Economic Indicators   | `{"country":"USA","indicator":"SP.POP.TOTL","startYear":2020,"endYear":2024}`                                          | Reported country/year observations, including null values                           | $0.10 |
| GitHub Repository Intelligence   | `{"repository":"cloudflare/workers-sdk"}`                                                                              | Current public repository metadata, license, stars, last push                       | $0.15 |
| Code Pattern Scan                | `{"code":"eval(req.body.code);"}`                                                                                      | Queued line-level findings for three deterministic rules                            | $3.00 |
| Document Fingerprint             | `{"text":"abc"}`                                                                                                       | SHA-256 digest, UTF-8 byte count, optional expected-digest comparison               | $0.10 |
| AWS Lambda Cost Estimate         | `{"region":"us-east-1","architecture":"arm64","monthlyRequests":1000000,"memoryMb":512,"averageBilledDurationMs":200}` | Monthly request/compute estimate, volume tiers, source rates and dates              | $0.10 |
| Brave Web Search                 | `{"query":"Cloudflare Workers documentation","limit":5}`                                                               | Up to ten web search titles, URLs and snippets                                      | $0.05 |
| Context.dev Page Extraction      | `{"url":"https://example.com"}`                                                                                        | One page as Markdown, capped at 40,000 characters with truncation reported          | $0.10 |
| Azure Maps Geocoding             | `{"query":"1 Microsoft Way, Redmond, WA","limit":3}`                                                                   | Up to five candidate addresses, coordinates, confidence and match codes             | $0.05 |
| SD-Artifacts Repository Analysis | `{"repository":"anirudh-makuluri/capora","packagePath":"apps/web","maxFiles":20}`                                      | Queued build plans, deployment briefing and actual build status                     | $1.00 |
| Riot Recent League Matches       | `{"gameName":"Hide on bush","tagLine":"KR1","region":"asia","count":5}`                                                | Compact champion, result, K/D/A, queue and timing summaries for up to ten LoL games | $0.10 |

All outputs include `synthetic: false`, `source`, `sourceUrl`, `observedAt`, `license`, `limitations` and `data`. `observedAt` is the retrieval/computation time, not the publication date of every record. Source record dates remain separate. An empty source result remains empty; source failures never fall back to fixtures.

## Authenticated APIs and hosted analysis

The authenticated listings demonstrate temporary access without buyer-managed upstream accounts or keys. All capabilities are for demonstration purposes only. Prices are prototype amounts in Capora's simulated/Sandbox ledger, not upstream rates or a commercial resale offering. Calls use real provider quota. Provider and source-content terms still apply.

Set the following operator-only values in root `.env` (never frontend `VITE_` variables):

| Capability   | Required settings                        |
| ------------ | ---------------------------------------- |
| Brave        | `BRAVE_SEARCH_API_KEY`                   |
| Context.dev  | `CONTEXT_DEV_API_KEY`                    |
| Azure Maps   | `AZURE_MAPS_KEY`                         |
| SD-Artifacts | `SD_API_BASE_URL`, `SD_API_BEARER_TOKEN` |
| Riot         | `RIOT_API_KEY`                           |

Run `pnpm setup:local` to copy populated settings to ignored `apps/worker/.dev.vars` and sync the catalog. Unrelated settings, including payment mode, are preserved. Empty or absent root values do not erase existing Worker values. Restart the local Worker after changing credentials. For deployment, provision these as Worker secrets and deploy the handlers before remote catalog sync; root `.env` is not deployed.

- [Brave](https://api-dashboard.search.brave.com/documentation/quickstart): one web query, optional country/freshness filters, no page scraping.
- [Context.dev](https://docs.context.dev/scrape/markdown): one public HTTPS URL, Markdown only, a 20-second upstream deadline, no crawl, login, browser actions or custom request headers. A failed Markdown output is a failure even when HTTP status is 200.
- [Azure Maps](https://learn.microsoft.com/en-us/rest/api/maps/search/get-geocoding): geocoding only, using API version `2025-01-01`; longitude/latitude and match confidence remain separate. This listing does not implement routes or nearby-place search.
- [SD-Artifacts](https://github.com/anirudh-makuluri/sd-artifacts): uses the operator's HTTPS base URL plus `/analyze/stream` with Bearer authentication, matching Smart Deploy. The service manages its own Bedrock, Supabase and build credentials; Capora needs only the base URL and bearer token for public repositories. Analysis may clone and build the repository in that service. Capora does not deploy infrastructure or accept private GitHub tokens. Queued calls consume bounded SSE progress and one final result within two minutes; service errors, truncated streams and timeouts fail explicitly. Build plans and actual failed/skipped/passed status are returned, while credential snapshots, raw logs and internal LLM traces are omitted. A Capora timeout does not guarantee cancellation of work already started upstream; there is no automatic retry.

The Riot capability resolves `gameName` and `tagLine` through Account-v1, requests the newest match IDs through Match-v5, and fetches only enough match details to summarize that player. `region` is required and accepts `americas` (NA/BR/LAN/LAS), `europe` (EUW/EUNE/TR/RU), `asia` (KR/JP), or `sea` (Southeast Asia/Oceania). `count` defaults to five and is limited to 1–10. It makes at most `count + 2` sequential upstream requests, with a shared 25-second deadline, and never fetches timelines. Empty history is returned honestly; failures do not fabricate or silently omit games. Development keys may expire and Riot rate limits still apply. See [Riot's routing documentation](https://developer.riotgames.com/docs/lol#routing-values).

All provider credentials stay in server-side headers. Missing configuration, authentication failures and exhausted quotas produce structured errors; upstream error bodies and network exception details are suppressed.

## Public sources and computed tools

Public-data prices cover Capora's retrieval and normalization service. Capora is the listed service provider, without implying affiliation with the upstream organizations. These listings do not claim exclusive access. Sources:

- [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api): public LEI data, CC0. Search matches are candidates, not a conclusive identity check; many businesses have no LEI.
- [Crossref API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/): public bibliographic metadata. No abstracts or full-text articles are distributed.
- [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures): attribution to World Bank, CC BY 4.0 subject to dataset-specific terms. Population, current-USD GDP and modeled unemployment are supported for the countries in the input schema; reported values may lag and may be revised.
- [GitHub API](https://docs.github.com/en/rest/repos/repos#get-a-repository): public metadata only. Repository code retains its own license. No private access or source-code cloning is provided.

- [AWS public price list files](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api-fetching-price-list-files-manually.html): public Lambda on-demand request and duration prices for `us-east-1`, `us-west-2`, `eu-west-1`, `ap-south-1` and `ap-southeast-1`, for x86_64 or arm64. No credentials or account access. Prices are informational and subject to AWS terms; the [Lambda pricing page](https://aws.amazon.com/lambda/pricing/) takes precedence. Capora is not affiliated with AWS.

The Lambda estimator calculates GB-seconds as `monthlyRequests * (memoryMb / 1024) * (averageBilledDurationMs / 1000)` and applies the source's marginal monthly tiers separately for requests and compute. Supply billable request units (including retries and async payload multipliers) and average **billed** duration, including initialization and billing rounding. Tiers start at zero for this workload; no existing function or AWS Organizations usage is assumed. The estimate excludes free tier, credits, Savings Plans, negotiated discounts, taxes, currency conversion, provisioned concurrency, managed instances, extra ephemeral storage, response streaming, transfer, CloudWatch and related services. It returns source SKUs, rate codes, effective dates, file version/publication date, source disclaimer and assumptions. No hardcoded prices replace unavailable or malformed AWS data. Monetary estimates round to six decimal places after calculation.

The scanner evaluates only the supplied code. Its three pattern rules are not a comprehensive security audit and may produce false positives or miss problems. It returns at most 100 findings, with `totalFindings` and `truncated` showing whether more were found. A document fingerprint detects content changes relative to a known digest; it does not establish authenticity or issuer identity.

## Setup and upgrade

Run `pnpm setup:local`. Existing local users, secrets, policies, payments and results are preserved. Migration `0004_real_capabilities.sql` retires the ten original fixture listings and adds the new catalog to an existing seeded workspace. On a fresh installation the normal seed creates the new catalog. The same migration is applied during an authorized deployment; no remote seed or credential rotation is required for an existing deployment.

Old paid fixture purchases keep their original, explicitly synthetic execution contract. They can still be invoked and read, but the retired listings cannot receive new quotes. New listings have separate IDs, so old quotes and receipts never silently acquire different meanings.

Built-in `builtin://` endpoints are a closed list, dispatched only through the paid gateway. API request hosts are fixed, except for the operator-configured SD base URL. Context.dev receives a validated public HTTPS target URL in its JSON body; it does not receive Capora credentials for the target site. Redirects on Capora's upstream requests are rejected. Source responses default to a 256 KiB bound and a 25-second deadline. SD analysis runs in a queue with a two-minute deadline and a 256 KiB total event-stream limit. AWS regional Lambda price files have a separate 2 MiB source bound; normalized results remain capped at 256 KiB for every capability. Public capabilities need no upstream keys; authenticated listings use operator keys. Source quotas apply; failures consume the execution entitlement and do not automatically refund a purchase. Other providers can be registered through approved HTTPS endpoints or owned R2 datasets.

New listings start with unmeasured reliability and unrated reputation. Execution counters provide observed reliability after calls; no fabricated ratings or measured SLA are seeded.

Each capability owns its metadata, input/output schemas, validation and handler in `apps/worker/src/providers/capabilities/`. The explicit [registry](../apps/worker/src/providers/capabilities/registry.ts) supplies execution lookup and the D1 catalog sync used by marketplace search and agent discovery. See [adding a built-in capability](providers.md#add-a-built-in-capability) for the extension workflow.

## Verification

`pnpm exec tsx scripts/verify-real-providers.ts` performs read-only network checks against the five live sources plus known scanner/fingerprint inputs. It makes no purchases, payments or database changes. `pnpm test:e2e` exercises the real HTTP/MCP purchase and invocation flow locally using simulated payments and a live GLEIF query. Isolated unit, Worker and browser tests use disposable storage and computed tools; legacy fixtures exist only to test prior-contract compatibility and controlled failures.

After building the Worker, run `pnpm exec tsx scripts/verify-aws-capability.ts` for a disposable local MCP discovery, quote, simulated purchase, live AWS invocation, persisted result, replay and budget check. It uses temporary local storage and no AWS credentials; it does not verify hosted PayPal Sandbox payments.

`node --env-file=.env --import=tsx scripts/verify-authenticated-providers.ts` explicitly consumes real quota for one Brave search, one Context extraction and one Azure geocode. Add `--include-sd` for one hosted public-repository analysis. It prints only safe summaries and writes `.local/authenticated-provider-check.json`; it creates no Capora purchases or payments. An authenticated SD health response proves credentials/connectivity, not a successful analysis.

After `pnpm build`, `node --env-file=.env --import=tsx scripts/verify-authenticated-mcp.ts` checks discovery, exact-input quotes, simulated purchases, real upstream results, persisted retrieval, replay and budget accounting in a disposable local Worker. The default checks Brave, Context.dev and Azure Maps; `--include-sd` also checks queued hosted analysis. It consumes real upstream quota but never uses the developer's wallet, existing database or payment credentials.

Use `node --env-file=.env --import=tsx scripts/verify-authenticated-mcp.ts --riot-only` to verify just the Riot capability with two recent games, simulated payments and real API data. This requires a currently valid `RIOT_API_KEY` and leaves existing accounts, tokens and history untouched.
