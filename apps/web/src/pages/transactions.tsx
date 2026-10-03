import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Download, ArrowUpRight, CreditCard, ArrowRight, ShieldCheck } from 'lucide-react';
import { money, type Purchase } from '@capora/types';
import { Button, Badge, Dialog, ErrorNotice, Empty, Status } from '../components/ui';
import { PurchaseActions } from '../components/purchase-actions';
import { api, useAction, useDashboard, time, latency } from '../lib/api';
import { Stat } from './overview';
export function Transactions() {
  const { data, error } = useDashboard();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Purchase>();
  const [params, setParams] = useSearchParams();
  const handled = useRef(false);
  const callback = useAction((purchase: Purchase) =>
    api(
      `/agents/${purchase.agentId}/purchases/${purchase.id}/${params.get('cancel') ? 'cancel' : 'reconcile'}`,
      { method: 'POST', body: {} },
    ),
  );
  useEffect(() => {
    const purchaseId = params.get('payment') ?? params.get('cancel');
    const purchase = data?.purchases.find((p) => p.id === purchaseId);
    if (purchase && !handled.current) {
      handled.current = true;
      setSelected(purchase);
      callback.mutate(purchase, { onSuccess: () => setParams({}) });
    }
  }, [data, params, callback, setParams]);
  const rows =
    data?.purchases.filter(
      (p) =>
        (!status || p.status === status) &&
        `${p.capabilityName} ${p.provider} ${p.agentName} ${p.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  const current = data?.purchases.find((p) => p.id === selected?.id) ?? selected;
  const exportCsv = () => {
    const csv = [
      [
        'Timestamp',
        'Agent',
        'Capability',
        'Provider',
        'Amount USD',
        'Status',
        'Payment mode',
        'PayPal order ID',
      ],
      ...rows.map((p) => [
        p.createdAt,
        p.agentName,
        p.capabilityName,
        p.provider,
        (p.amountCents / 100).toFixed(2),
        p.status,
        p.paymentMode,
        p.orderId ?? '',
      ]),
    ]
      .map((row) =>
        row
          .map((value) => {
            const text = String(value ?? '');
            const safe = /^[=+@\-\t\r\n]/.test(text) ? `'${text}` : text;
            return `"${safe.replaceAll('"', '""')}"`;
          })
          .join(','),
      )
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'capora-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EVERY PURCHASE HAS A PAPER TRAIL</div>
          <h1>Transactions</h1>
          <p>See what your agents bought, why they needed it, and what it returned.</p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>
          <Download size={16} /> Export CSV
        </Button>
      </div>
      <div className="stats-grid transaction-stats">
        <Stat
          icon={<CreditCard size={18} />}
          label="Total completed spend"
          value={money(data?.stats.totalSpendCents ?? 0)}
          note="Across your workspace"
        />
        <Stat
          icon={<ShieldCheck size={18} />}
          label="Spent today"
          value={money(data?.stats.spentTodayCents ?? 0)}
          note="Budget day resets at 00:00 UTC"
        />
        <Stat
          icon={<ArrowUpRight size={18} />}
          label="Completed purchases"
          value={String(data?.purchases.filter((p) => p.status === 'purchased').length ?? 0)}
          note={`${data?.approvals.length ?? 0} awaiting your approval`}
        />
      </div>
      <ErrorNotice error={error ?? callback.error} />
      <section className="panel transaction-panel">
        <div className="transaction-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search transactions"
              placeholder="Search transactions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter transaction status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {['purchased', 'pending_approval', 'payment_pending', 'rejected', 'failed', 'refunded'].map(
              (s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ')}
                </option>
              ),
            )}
          </select>
          <Badge tone="green">
            <span className="status-dot" />
            Live
          </Badge>
        </div>
        <div className="table-scroll">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Capability / provider</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Execution</th>
                <th>Date</th>
                <th className="align-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const inv = data?.invocations.find((i) => i.purchaseId === p.id);
                return (
                  <tr key={p.id} onClick={() => setSelected(p)}>
                    <td>
                      <button className="table-capability" onClick={() => setSelected(p)}>
                        {p.capabilityName}
                        <small>{p.provider}</small>
                      </button>
                    </td>
                    <td>
                      <span className="table-agent">
                        <span className="mini-avatar">A</span>
                        {p.agentName}
                      </span>
                    </td>
                    <td>
                      <Status status={p.status} />
                    </td>
                    <td>
                      {inv ? (
                        <span className="execution-cell">
                          {inv.status}
                          <small>{inv.latencyMs ? latency(inv.latencyMs) : 'In progress'}</small>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="table-date">{time(p.createdAt)}</span>
                    </td>
                    <td className="align-right">
                      <strong>{money(p.amountCents)}</strong>
                      <small className="payment-kind">
                        {p.paymentMode === 'demo' ? 'Simulated' : 'PayPal sandbox'}
                      </small>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Details for ${p.capabilityName}`}
                        onClick={() => setSelected(p)}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && data && (
          <Empty
            icon={<CreditCard size={28} />}
            title={query || status ? 'No matching transactions' : 'Your first purchase is a new possibility.'}
          >
            <p>
              {query || status
                ? 'Adjust your search or status filter.'
                : 'Acquire a capability and its payment and execution will appear here.'}
            </p>
            <Button variant="secondary" asChild>
              <Link to="/marketplace">
                Explore marketplace <ArrowRight size={15} />
              </Link>
            </Button>
          </Empty>
        )}
        <div className="table-footer">
          <span>
            {rows.length} {rows.length === 1 ? 'purchase' : 'purchases'}
          </span>
          <span>USD · {data?.paymentMode === 'demo' ? 'Local simulated payments' : 'PayPal Sandbox'}</span>
        </div>
      </section>
      {current && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelected(undefined);
          }}
          title={current.capabilityName ?? 'Purchase details'}
          description={`${current.provider} · ${time(current.createdAt)}`}
          wide
        >
          <div className="dialog-body">
            <div className="transaction-detail-summary">
              <div>
                <span>Amount</span>
                <strong>{money(current.amountCents)}</strong>
              </div>
              <Status status={current.status} />
            </div>
            <dl className="detail-facts">
              <div>
                <dt>Agent</dt>
                <dd>{current.agentName}</dd>
              </div>
              <div>
                <dt>Purchase</dt>
                <dd className="mono">{current.id}</dd>
              </div>
              <div>
                <dt>Quote</dt>
                <dd className="mono">{current.quoteId}</dd>
              </div>
              <div>
                <dt>Payment mode</dt>
                <dd>
                  {current.paymentMode === 'demo' ? 'Local simulator — no external charge' : 'PayPal Sandbox'}
                </dd>
              </div>
              <div>
                <dt>Order ID</dt>
                <dd className="mono">{current.orderId ?? 'Not created'}</dd>
              </div>
              <div>
                <dt>Capture ID</dt>
                <dd className="mono">{current.captureId ?? 'Not captured'}</dd>
              </div>
            </dl>
            {current.reason && (
              <div className="approval-reason">
                <span>Reason for purchase</span>
                <p>{current.reason}</p>
              </div>
            )}
            <PurchaseActions purchase={current} />
          </div>
        </Dialog>
      )}
    </>
  );
}
