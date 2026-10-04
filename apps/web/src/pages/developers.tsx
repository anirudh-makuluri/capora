import { Link } from 'react-router-dom';
import { ArrowRight, Code2, Copy, Check, LockKeyhole, Terminal, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { TOOL_DESCRIPTIONS } from '@capora/mcp/tools';
import { Button, Badge, CodeBlock } from '../components/ui';
export function Developers() {
  const [copied, setCopied] = useState(false);
  const endpoint = `${window.location.origin}/mcp`;
  const config = JSON.stringify(
    {
      mcpServers: { capora: { url: endpoint, headers: { Authorization: 'Bearer YOUR_CAPORA_AGENT_TOKEN' } } },
    },
    null,
    2,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE SERVER. A WORLD OF CAPABILITIES.</div>
          <h1>Built for your agent.</h1>
          <p>Connect through MCP. Discover, purchase, and execute at runtime.</p>
        </div>
        <Button variant="secondary" asChild>
          <Link to="/agents">
            Create an agent <ArrowRight size={15} />
          </Link>
        </Button>
      </div>
      <div className="developer-grid">
        <section className="panel docs-panel">
          <Badge tone="green">
            <Code2 size={13} /> STREAMABLE HTTP
          </Badge>
          <h2>Connect once. Acquire on demand.</h2>
          <p>
            Capora exposes one authenticated remote MCP server with a stable set of marketplace tools.
            Providers are capabilities, so your agent’s tool list stays small as the marketplace grows.
          </p>
          <div className="endpoint-box">
            <span>Endpoint</span>
            <code>{endpoint}</code>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy endpoint"
              onClick={async () => {
                await navigator.clipboard.writeText(endpoint);
                setCopied(true);
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
          <h3>MCP client configuration</h3>
          <p className="muted">
            Use this shape in clients supporting remote HTTP servers and custom authorization headers. Check
            your client’s configuration format.
          </p>
          <CodeBlock>{config}</CodeBlock>
          <div className="info-callout">
            <LockKeyhole size={19} />
            <p>
              Agent tokens use <code>Authorization: Bearer cap_…</code>. Tokens are hashed at rest, displayed
              once, and can be revoked from My agents.
            </p>
          </div>
          <h3>Official TypeScript client</h3>
          <CodeBlock>{`import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'research-agent', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(
  new URL('${endpoint}'),
  { requestInit: { headers: { Authorization: \`Bearer \${process.env.CAPORA_AGENT_TOKEN}\` } } }
));
const options = await client.callTool({
  name: 'search_capabilities',
  arguments: { query: 'company registry', max_budget: 5 }
});`}</CodeBlock>
          <a
            className="text-link"
            href="https://ts.sdk.modelcontextprotocol.io/"
            target="_blank"
            rel="noreferrer"
          >
            Official MCP SDK documentation <ExternalLink size={14} />
          </a>
        </section>
        <aside>
          <section className="panel docs-panel docs-flow">
            <h2>The capability loop</h2>
            {[
              ['01', 'Discover', 'Search for the access your agent is missing.'],
              ['02', 'Evaluate', 'Inspect schemas, cost, reliability, and latency.'],
              ['03', 'Purchase', 'Get a quote. Spend within policy. Await approval when required.'],
              ['04', 'Execute', 'Invoke the gateway. Poll an async job. Continue the original task.'],
            ].map(([n, title, desc]) => (
              <div className="docs-flow-step" key={n}>
                <span>{n}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              </div>
            ))}
            <Button variant="secondary" asChild className="full-width">
              <Link to="/demo">
                Try the agent playground <ArrowRight size={15} />
              </Link>
            </Button>
          </section>
          <section className="panel docs-panel docs-contract">
            <h3>Small, deliberate contracts</h3>
            <ul>
              <li>Money is integer USD cents.</li>
              <li>Quotes last five minutes.</li>
              <li>Exact quoted input is required.</li>
              <li>A purchase grants one invocation.</li>
              <li>Replayed purchases and invocations return the original record.</li>
              <li>Pending requests reserve daily budget.</li>
              <li>Budget days use UTC.</li>
              <li>Provider credentials stay in Capora.</li>
            </ul>
            <Badge tone="amber">Sandbox payments only</Badge>
          </section>
        </aside>
      </div>
      <section className="panel tool-surface">
        <div className="panel-heading">
          <h2>
            <Terminal size={20} /> Marketplace tools
          </h2>
          <Badge>{Object.keys(TOOL_DESCRIPTIONS).length} stable tools</Badge>
        </div>
        {Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => (
          <div className="tool-row" key={name}>
            <code>{name}</code>
            <p>{description}</p>
          </div>
        ))}
      </section>
    </>
  );
}
