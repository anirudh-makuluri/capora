export function connectionPrompt(origin: string) {
  return `Set up Capora for this AI client so I can discover, purchase and use machine capabilities through MCP.

First ask me for these four values together, and wait for my answers:
1. Agent name (2–80 characters).
2. Daily budget in cUSD (simulated USD) (resets at midnight UTC).
3. Auto-approval threshold in cUSD (simulated USD) (purchases at or below this amount can proceed automatically).
4. Maximum per purchase in cUSD (simulated USD) (a hard limit, even with human approval).
Explain that purchases above the auto-approval threshold require my approval in Capora. Do not silently choose defaults. Amounts must be between $0 and $1,000 with at most two decimal places, and auto-approval <= maximum per purchase <= daily budget. Clarify invalid answers before proceeding.

After I answer:
1. Check for Node.js 22+ and identify the AI client. Download ${origin}/connect.mjs to a temporary directory and inspect it before running it. Use argument arrays or proper shell quoting for my answers; never interpolate them as executable shell code.
2. Run the helper's start command with --base-url ${origin}, --name NAME, --daily-budget USD, --auto-approve USD, and --max-transaction USD. It creates local credentials outside the project, sends only their hashes, and returns a connection handle, verification URL and code. Keep the handle so interrupted setup can resume.
3. Show me the verification URL and code. Ask me to open it, sign in or create my Capora account, compare the code and authorize the displayed agent and limits. Wait for me to finish. Do not ask for my password, read browser cookies or authorize on my behalf. No dashboard agent-creation form or existing agent token is needed.
4. Run the same helper with finish --connection HANDLE. If pending, wait for my authorization instead of creating another request. If denied or expired, stop and explain. The helper creates no purchases; it checks MCP discovery and the exact spending policy. It stores the agent token locally and never prints it.
5. Register the returned endpoint under the returned serverName, preserving existing client configuration and connections. For Codex, run the returned helperPath with configure-codex --connection HANDLE. This appends a distinct connection to the user-level config, sets the Authorization header privately, and leaves existing connections untouched. Do not read or print the config, credentialsFile or headers subcommand output into chat: they contain secrets. For another client, consult its current official MCP setup instructions and securely configure the Authorization header from credentialsFile without printing the token or putting it in project files. Explain if this client cannot support the connection.
6. Tell me if I need to restart the client or start a fresh session. Once available, call get_budget through the client's actual Capora MCP tools and confirm my agent name and all three limits. Distinguish the helper's successful HTTP checks from tools actually loaded into this chat. Do not claim this chat is connected until it can call the tools.

Do not purchase or invoke capabilities during setup. Do not change existing agents or their budgets. Each agent has its own custodial Base Sepolia wallet. PayPal Sandbox is only for human top-ups; paid capability purchases settle in demo cUSD escrow. If a wallet needs provisioning or funds, direct me to Capora Bank. Financial mutations use the same quote, purchase and invoke tools with bank capabilities; never change policy or destinations without explicit owner approval. Never include tokens, passwords or credential-file contents in your replies.`;
}
