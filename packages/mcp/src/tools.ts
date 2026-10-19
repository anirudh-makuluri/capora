export const TOOL_DESCRIPTIONS = {
  search_capabilities:
    'Discover APIs, datasets, and specialized agents, including Capora Bank wallet, fund, collateralized loan and public auction chit capabilities. Compare prices in cUSD cents (simulated USD), latency and human-approval requirements. Bank reads have no service fee. Use category Capora Bank to discover financial operations. requirements is contextual metadata; filters enforce type/category/budget/trust/latency.',
  get_capability:
    'Inspect a capability, its JSON input/output schemas, pricing, SLA, and provider. Provider credentials are never returned.',
  get_quote:
    'Create an immutable five-minute quote bound to the exact proposed input. Include reasoning for the human approver.',
  purchase_capability:
    'Purchase a quote once. Returns purchased, pending_approval, or payment_pending. Repeating a quote does not charge twice. Do not invoke before purchased.',
  invoke_capability:
    'Use a completed purchase exactly once with the same input as the quote. Repeated calls return the original invocation. Async results include a jobId. After execution completes or fails, you must evaluate the outcome and call rate_capability using the returned invocation id.',
  get_job:
    'Poll an async job until completed or failed. Returns structured results and timestamps. Once finished, you must evaluate the outcome and call rate_capability using invocationId; follow ratingRequest.',
  get_budget:
    'Inspect daily spending, reservations, remaining budget, auto-approval threshold, and transaction limit. Currency values are integer cUSD cents (simulated USD); budget days use UTC. Financial policies additionally restrict recipients and investment, loan and chit exposure.',
  get_purchase_status:
    'Poll a pending purchase after human approval or cUSD escrow funding. Reconciles its existing chain intent without charging twice. PayPal Sandbox is only used for human top-ups. Invoke only when status is purchased; settlement tracks escrow funding, execution, release, refund or manual review.',
  rate_capability:
    'Required after using a capability: submit an honest integer rating from 1 (poor) to 5 (excellent), with optional feedback up to 2000 characters. Pass the invocation_id from invoke_capability or get_job. Only your own completed or failed invocation is eligible. Each invocation can be rated once; identical retries return the original review.',
} as const;
