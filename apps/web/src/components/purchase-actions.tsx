import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Play, RefreshCw, Clock3 } from 'lucide-react';
import type { Purchase, Invocation, Job, JsonInput } from '@capora/types';
import { Button, ErrorNotice, CodeBlock, Badge } from './ui';
import { api, useAction, useDashboard } from '../lib/api';

export function PurchaseActions({ purchase }: { purchase: Purchase }) {
  const [result, setResult] = useState<Invocation>();
  const { data } = useDashboard();
  const existing = data?.invocations.find((i) => i.purchaseId === purchase.id);
  const detail = useQuery({
    queryKey: ['invocation', existing?.id],
    queryFn: () => api<Invocation>(`/agents/${purchase.agentId}/invocations/${existing!.id}`),
    enabled: Boolean(existing),
    refetchInterval: existing && ['queued', 'running'].includes(existing.status) ? 1000 : false,
  });
  const execute = useAction(async () => {
    const { input } = await api<{ input: JsonInput }>(
      `/agents/${purchase.agentId}/purchases/${purchase.id}/input`,
    );
    const res = await api<Invocation>(`/agents/${purchase.agentId}/invocations`, {
      method: 'POST',
      body: { purchase_id: purchase.id, input },
    });
    setResult(res);
    return res;
  });
  const reconcile = useAction(() =>
    api<Purchase>(`/agents/${purchase.agentId}/purchases/${purchase.id}/reconcile`, {
      method: 'POST',
      body: {},
    }),
  );
  const cancel = useAction(() =>
    api(`/agents/${purchase.agentId}/purchases/${purchase.id}/cancel`, { method: 'POST', body: {} }),
  );
  const current = detail.data ?? result;
  const job = useQuery({
    queryKey: ['job', current?.jobId],
    queryFn: () => api<Job>(`/agents/${purchase.agentId}/jobs/${current!.jobId}`),
    enabled: Boolean(current?.jobId),
    refetchInterval: (q) => (['completed', 'failed'].includes(q.state.data?.status ?? '') ? false : 1000),
  });
  return (
    <div className="purchase-actions">
      <ErrorNotice error={execute.error ?? reconcile.error ?? cancel.error ?? detail.error ?? job.error} />
      {purchase.status === 'pending_approval' && (
        <p className="muted">
          <Clock3 size={16} /> Waiting for workspace owner approval. Check Approvals.
        </p>
      )}
      {['approved', 'payment_pending'].includes(purchase.status) && (
        <div className="action-row">
          {purchase.approvalUrl && (
            <Button asChild>
              <a href={purchase.approvalUrl}>
                Continue with PayPal <ExternalLink size={15} />
              </a>
            </Button>
          )}
          <Button variant="secondary" busy={reconcile.isPending} onClick={() => reconcile.mutate()}>
            <RefreshCw size={15} /> Check payment
          </Button>
          <Button variant="ghost" busy={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel purchase
          </Button>
        </div>
      )}
      {purchase.status === 'purchased' && !current && (
        <Button busy={execute.isPending} onClick={() => execute.mutate()}>
          <Play size={15} /> Invoke capability
        </Button>
      )}
      {current && (
        <div className="result-panel">
          <div className="result-panel-title">
            <strong>Execution result</strong>
            <Badge
              tone={current.status === 'completed' ? 'green' : current.status === 'failed' ? 'red' : 'amber'}
            >
              {job.data?.status ?? current.status}
            </Badge>
          </div>
          {current.error && <ErrorNotice error={new Error(current.error)} />}
          <CodeBlock>
            {JSON.stringify(
              job.data?.result ?? current.result ?? { status: current.status, jobId: current.jobId },
              null,
              2,
            )}
          </CodeBlock>
        </div>
      )}
      {purchase.error && <ErrorNotice error={new Error(purchase.error)} />}
    </div>
  );
}
