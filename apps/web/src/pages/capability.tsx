import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  ShieldCheck,
  Star,
  Code2,
  Check,
  LockKeyhole,
  ExternalLink,
} from 'lucide-react';
import { money, type Capability, type Quote, type Purchase } from '@capora/types';
import { Button, Badge, CodeBlock, ErrorNotice, Field, Skeleton, Status } from '../components/ui';
import { ProviderIcon } from '../components/brand';
import { PurchaseActions } from '../components/purchase-actions';
import { api, useDashboard, useAction, exampleInput, latency } from '../lib/api';
import { typeLabel } from './marketplace';

export function CapabilityDetail() {
  const { id } = useParams();
  const {
    data: capability,
    error,
    isPending,
  } = useQuery({ queryKey: ['capability', id], queryFn: () => api<Capability>(`/capabilities/${id}`) });
  const [tab, setTab] = useState('overview');
  if (isPending) return <Skeleton className="detail-skeleton" />;
  if (!capability) return <ErrorNotice error={error} />;
  return (
    <>
      <Link className="back-link" to="/marketplace">
        <ArrowLeft size={16} /> Back to marketplace
      </Link>
      <div className="capability-detail-heading">
        <ProviderIcon capability={capability} large />
        <div>
          <div className="detail-provider">
            {capability.provider} <ShieldCheck size={14} /> <Badge>{typeLabel(capability.type)}</Badge>
          </div>
          <h1>{capability.name}</h1>
          <p>{capability.category}</p>
        </div>
      </div>
      <div className="detail-layout">
        <div>
          <div className="detail-trust">
            <span>
              <ShieldCheck size={18} />
              <strong>{capability.reliability}%</strong>
              <small>Reliability</small>
            </span>
            <span>
              <Star size={18} />
              <strong>{capability.reputation.toFixed(1)} / 5</strong>
              <small>Provider reputation</small>
            </span>
            <span>
              <Clock3 size={18} />
              <strong>{latency(capability.expectedLatencyMs)}</strong>
              <small>Expected latency</small>
            </span>
            <span>
              <Check size={18} />
              <strong>{capability.successCount}</strong>
              <small>Successful executions</small>
            </span>
          </div>
          <div className="type-tabs detail-tabs">
            {['overview', 'input schema', 'output schema'].map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="panel detail-panel">
            {tab === 'overview' ? (
              <>
                <h2>A capability your agent can acquire.</h2>
                <p>{capability.description}</p>
                <h3>How it works</h3>
                <div className="how-steps">
                  {[
                    'Inspect the input schema and prepare arguments.',
                    'Request a fixed-price quote, valid for five minutes.',
                    'Purchase under your agent’s spending policy.',
                    `Invoke securely ${capability.async ? 'and poll the asynchronous job' : 'and receive a structured result'}.`,
                  ].map((step, i) => (
                    <div key={step}>
                      <span>{i + 1}</span>
                      <p>{step}</p>
                    </div>
                  ))}
                </div>
                <div className="tag-list">
                  {capability.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
                {capability.synthetic && (
                  <div className="info-callout">
                    <Badge tone="amber">Synthetic demo data</Badge>
                    <p>
                      This provider runs a working demo endpoint. Its output is a hackathon fixture and makes
                      no real-world claims. Reliability uses the provider baseline until the first execution,
                      then reflects observed results.
                    </p>
                  </div>
                )}
                {capability.documentationUrl && (
                  <a
                    className="text-link"
                    href={capability.documentationUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Provider documentation <ExternalLink size={14} />
                  </a>
                )}
                <div className="detail-security">
                  <LockKeyhole size={17} />
                  <span>Provider credentials stay inside Capora. Your agent receives only the result.</span>
                </div>
              </>
            ) : (
              <>
                <div className="section-heading">
                  <h2>{tab === 'input schema' ? 'Input' : 'Output'} · JSON Schema</h2>
                  <Badge>Draft 7</Badge>
                </div>
                <CodeBlock>
                  {JSON.stringify(
                    tab === 'input schema' ? capability.inputSchema : capability.outputSchema,
                    null,
                    2,
                  )}
                </CodeBlock>
              </>
            )}
          </div>
        </div>
        <AcquirePanel capability={capability} />
      </div>
    </>
  );
}
function AcquirePanel({ capability }: { capability: Capability }) {
  const { data } = useDashboard();
  const [agentId, setAgentId] = useState('agent_research');
  const [input, setInput] = useState(JSON.stringify(exampleInput(capability), null, 2));
  const [reason, setReason] = useState(`I need ${capability.name} to complete the user's task.`);
  const [quote, setQuote] = useState<Quote>();
  const [purchase, setPurchase] = useState<Purchase>();
  const [parseError, setParseError] = useState<unknown>();
  const activeAgents = data?.agents.filter((a) => a.status === 'active') ?? [];
  const selectedAgent = activeAgents.find((a) => a.id === agentId) ?? activeAgents[0];
  const currentPurchase = data?.purchases.find((p) => p.id === purchase?.id) ?? purchase;
  const quoteAction = useAction(async () => {
    setParseError(undefined);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error('Enter valid JSON arguments.');
    }
    if (!selectedAgent) throw new Error('Create an active agent first.');
    const result = await api<Quote>(`/agents/${selectedAgent.id}/quotes`, {
      method: 'POST',
      body: { capability_id: capability.id, input: parsed, reason },
    });
    setQuote(result);
    return result;
  });
  const buyAction = useAction(async () => {
    if (!quote || Date.parse(quote.expiresAt) <= Date.now())
      throw new Error('Quote expired. Request a new quote.');
    const result = await api<Purchase>(`/agents/${quote.agentId}/purchases`, {
      method: 'POST',
      body: { quote_id: quote.id },
    });
    setPurchase(result);
    return result;
  });
  return (
    <aside className="acquire-panel panel">
      <Badge tone="green">ON-DEMAND ACCESS</Badge>
      <div className="detail-price">
        {money(capability.priceCents)}
        <span> / {capability.pricingUnit}</span>
      </div>
      <p className="muted">Fixed price. One purchase, one invocation.</p>
      <div className="panel-rule" />
      {currentPurchase ? (
        <>
          <div className="section-heading">
            <h3>Your purchase</h3>
            <Status status={currentPurchase.status} />
          </div>
          <p className="muted mono small">{currentPurchase.id}</p>
          <PurchaseActions purchase={currentPurchase} />
          <Button
            variant="ghost"
            className="full-width"
            onClick={() => {
              setPurchase(undefined);
              setQuote(undefined);
              quoteAction.reset();
              buyAction.reset();
            }}
          >
            Start a new purchase
          </Button>
        </>
      ) : (
        <>
          <Field label="Purchasing agent">
            <select
              value={selectedAgent?.id ?? ''}
              onChange={(e) => {
                setAgentId(e.target.value);
                setQuote(undefined);
              }}
              disabled={Boolean(quote)}
            >
              {activeAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          {selectedAgent && (
            <div className="budget-inline">
              <ShieldCheck size={15} />
              <span>
                {money(selectedAgent.budget.remainingCents)} available ·{' '}
                {money(selectedAgent.budget.autoApproveCents)} auto-approval
              </span>
            </div>
          )}
          <Field label="Invocation arguments" hint="Input is validated against the provider’s schema.">
            <textarea
              className="json-editor"
              rows={8}
              value={input}
              disabled={Boolean(quote)}
              onChange={(e) => {
                setInput(e.target.value);
                setQuote(undefined);
              }}
            />
          </Field>
          <Field label="Reason for purchase">
            <textarea
              rows={2}
              value={reason}
              disabled={Boolean(quote)}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <ErrorNotice error={parseError ?? quoteAction.error ?? buyAction.error} />
          {quote ? (
            <>
              <div className="quote-summary">
                <span>
                  Quoted price <strong>{money(quote.priceCents)}</strong>
                </span>
                <span>
                  Approval{' '}
                  <Badge tone={quote.approvalRequired ? 'amber' : 'green'}>
                    {quote.approvalRequired ? 'Human required' : 'Automatic'}
                  </Badge>
                </span>
                <small>
                  Expires{' '}
                  {new Date(quote.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </small>
              </div>
              <Button className="full-width" busy={buyAction.isPending} onClick={() => buyAction.mutate()}>
                Purchase capability <ArrowRight size={16} />
              </Button>
              <Button
                variant="ghost"
                className="full-width"
                onClick={() => {
                  setQuote(undefined);
                  buyAction.reset();
                }}
              >
                Edit / refresh quote
              </Button>
            </>
          ) : (
            <Button
              className="full-width"
              busy={quoteAction.isPending}
              disabled={!selectedAgent}
              onClick={() => {
                setParseError(undefined);
                quoteAction.mutate();
              }}
            >
              Get a quote <ArrowRight size={16} />
            </Button>
          )}
          <div className="sandbox-note">
            {data?.paymentMode === 'demo'
              ? 'Local payment simulator · no PayPal charge'
              : 'PayPal Sandbox · no real money'}
          </div>
        </>
      )}
      <div className="mcp-acquire-note">
        <Code2 size={16} />
        <Link to="/developers">Your agent can do this through MCP.</Link>
      </div>
    </aside>
  );
}
