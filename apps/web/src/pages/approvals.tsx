import { Link } from 'react-router-dom';
import { Check, X, Inbox, ArrowRight, Bot, Clock3, ShieldCheck, Star } from 'lucide-react';
import { money, type Purchase } from '@capora/types';
import { Button, Badge, Empty, ErrorNotice } from '../components/ui';
import { ProviderIcon } from '../components/brand';
import { api, useAction, useDashboard, useCapabilities, latency, time } from '../lib/api';
export function Approvals() {
  const { data, error } = useDashboard();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">HUMAN IN THE LOOP</div>
          <h1>Your call.</h1>
          <p>Approve meaningful spending. Keep agents moving.</p>
        </div>
        <Badge tone={data?.approvals.length ? 'amber' : 'green'}>
          {data?.approvals.length ?? 0} pending requests
        </Badge>
      </div>
      <ErrorNotice error={error} />
      <div className="approval-explainer">
        <ShieldCheck size={20} />
        <p>
          These purchases exceed an agent’s automatic approval threshold. The funds are reserved, and nothing
          executes until you approve and payment completes.
        </p>
      </div>
      {data?.approvals.length ? (
        <div className="approval-grid">
          {data.approvals.map((p) => (
            <ApprovalCard key={p.id} purchase={p} />
          ))}
        </div>
      ) : (
        data && (
          <Empty icon={<Inbox size={28} />} title="You’re all caught up.">
            <p>When an agent needs to spend beyond its threshold, you’ll see the request here.</p>
            <Button variant="secondary" asChild>
              <Link to="/demo">
                Try the approval demo <ArrowRight size={15} />
              </Link>
            </Button>
          </Empty>
        )
      )}
    </>
  );
}
export function ApprovalCard({ purchase }: { purchase: Purchase }) {
  const { data: caps, error: capabilityError, isPending } = useCapabilities();
  const capability = caps?.find((c) => c.id === purchase.capabilityId);
  const resolve = useAction((approve: boolean) =>
    api<Purchase>(`/approvals/${purchase.id}`, { method: 'POST', body: { approve } }),
  );
  return (
    <article className="approval-card panel">
      <div className="section-heading">
        <Badge tone="amber">Approval required</Badge>
        <span className="muted small">{time(purchase.createdAt)}</span>
      </div>
      <div className="approval-capability">
        {capability && <ProviderIcon capability={capability} />}
        <div>
          <h3>{purchase.capabilityName ?? capability?.name}</h3>
          <span>{purchase.provider ?? capability?.provider}</span>
        </div>
        <strong>{money(purchase.amountCents)}</strong>
      </div>
      <p>
        {capability?.description ??
          (isPending
            ? 'Loading capability details…'
            : 'This capability is unavailable. Reject this request to release its reservation.')}
      </p>
      <div className="approval-reason">
        <span>
          <Bot size={15} /> {purchase.agentName ?? 'Research agent'} says
        </span>
        <p>“{purchase.reason || 'I need this capability to complete the current task.'}”</p>
      </div>
      <div className="approval-trust">
        <span>
          <Clock3 size={14} />
          {capability ? latency(capability.expectedLatencyMs) : '—'} expected
        </span>
        <span>
          <ShieldCheck size={14} />
          {capability ? `${capability.reliability}% reliability` : 'Reliability unavailable'}
        </span>
        <span>
          <Star size={14} />
          {capability ? `${capability.reputation.toFixed(1)} reputation` : 'Reputation unavailable'}
        </span>
      </div>
      <ErrorNotice error={resolve.error} />
      <ErrorNotice error={capabilityError} />
      <div className="approval-buttons">
        <Button busy={resolve.isPending} disabled={!capability} onClick={() => resolve.mutate(true)}>
          <Check size={16} /> Approve {money(purchase.amountCents)}
        </Button>
        <Button variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate(false)}>
          <X size={16} /> Reject
        </Button>
      </div>
    </article>
  );
}
