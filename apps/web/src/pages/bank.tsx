import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, RefreshCw, Wallet, ArrowUpRight } from 'lucide-react';
import { displayUnits, units, unitsToCents, explorer } from '@capora/bank';
import type { Capability, Quote, Purchase, Invocation } from '@capora/types';
import { api, useDashboard, useCapabilities } from '../lib/api';
import { Button, Badge, Field, ErrorNotice, Empty, Status, CodeBlock, Skeleton } from '../components/ui';
import { PurchaseActions } from '../components/purchase-actions';
import './bank.css';
interface Account {
  id: string;
  agent_id: string | null;
  provider_id: string | null;
  address: string | null;
  state: string;
  balance: string | null;
  gas?: string;
  collateral?: string;
  error?: string;
}
interface Topup {
  id: string;
  state: string;
  amount_cents: number;
  order_id: string | null;
  capture_id: string | null;
  approval_url: string | null;
  tx_hash: string | null;
  error: string | null;
}
interface Entity {
  address: string;
  kind: string;
  name: string;
  terms: string;
}
interface BankData {
  cashflow: { receivedUnits: string; sentUnits: string; indexedAt: string | null } | null;
  configured: boolean;
  configurationError: string | null;
  contracts: Record<string, string | boolean | number> | null;
  accounts: Account[];
  topups: Topup[];
  entities: Entity[];
  positions: Record<string, string>[];
  policies: {
    agent_id: string;
    destinations: string;
    max_investment_cents: number;
    max_loan_cents: number;
    max_chit_cents: number;
  }[];
  transactions: {
    id: string;
    purpose: string;
    state: string;
    tx_hash: string | null;
    error: string | null;
    created_at: string;
  }[];
  earnings: {
    id: string;
    capability: string;
    amount_units: string;
    fee_units: string;
    state: string;
    seller_wallet: string;
    resolution_tx: string | null;
  }[];
}
type SchemaProperty = {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  description?: string;
};
const LocalBankContext = createContext(false);
const label = (s: string) => s.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
function TxLink({ hash }: { hash: string | null }) {
  const local = useContext(LocalBankContext);
  if (local && hash) return <code title="Local EVM transaction (not on hosted Base Sepolia)">{hash}</code>;
  return hash ? (
    <a className="bank-inline-link" href={explorer(hash)} target="_blank" rel="noreferrer">
      View transaction <ExternalLink size={13} />
    </a>
  ) : (
    <span className="muted">Awaiting submission</span>
  );
}
export function Bank() {
  const client = useQueryClient(),
    { data: dashboard } = useDashboard(),
    [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('Wallets'),
    [agentId, setAgentId] = useState(params.get('agent') ?? ''),
    [operation, setOperation] = useState(''),
    [selectedEntity, setSelectedEntity] = useState('');
  const bank = useQuery({ queryKey: ['bank'], queryFn: () => api<BankData>('/bank'), refetchInterval: 5000 });
  const { data: capabilities } = useCapabilities('category=Capora%20Bank');
  const agents = dashboard?.agents ?? [],
    agent = agentId || agents[0]?.id || '';
  const selected = capabilities?.find((c) => c.id === operation);
  const action = useMutation({
    mutationFn: async ({ path, body, method = 'POST' }: { path: string; body?: unknown; method?: string }) =>
      api(path, { method, body: body ?? {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['bank'] }),
  });
  const returnedPayment = params.get('payment'),
    handled = useRef('');
  useEffect(() => {
    if (returnedPayment && handled.current !== returnedPayment) {
      handled.current = returnedPayment;
      action.mutate({ path: `/bank/topups/${encodeURIComponent(returnedPayment)}/reconcile` });
      setParams({});
    }
  }, [returnedPayment, setParams, action]);
  const selectOperation = (id: string, address = '') => {
    setOperation(`bank_${id}`);
    setSelectedEntity(address);
  };
  const balance = bank.data?.accounts.find((a) => a.agent_id === agent);
  const detail = useQuery({
    queryKey: ['bank-detail', agent, selectedEntity],
    queryFn: () =>
      api<Record<string, unknown>>(
        `/bank/agents/${agent}/${bank.data?.entities.find((e) => e.address === selectedEntity)?.kind === 'fund' ? 'fund_details' : 'chit_status'}?address=${selectedEntity}`,
      ),
    enabled: Boolean(agent && selectedEntity && bank.data?.configured),
    refetchInterval: 5000,
  });
  const loans = useQuery({
    queryKey: ['bank-loans', agent],
    queryFn: () => api<Record<string, unknown>[]>(`/bank/agents/${agent}/list_loans`),
    enabled: tab === 'Lending' && Boolean(agent && bank.data?.configured),
    refetchInterval: 5000,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['bank'] });
    void client.invalidateQueries({ queryKey: ['bank-detail'] });
    void client.invalidateQueries({ queryKey: ['bank-loans'] });
  };
  return (
    <LocalBankContext.Provider value={Boolean(bank.data?.contracts?.local)}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AUTONOMY WITH ACCOUNTABILITY</div>
          <h1>Capora Bank</h1>
          <p>Earn, spend and allocate your agent’s simulated funds.</p>
        </div>
        <Button variant="secondary" onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>
      <ErrorNotice error={bank.error ?? action.error} />
      {bank.isPending ? (
        <Skeleton className="detail-skeleton" />
      ) : bank.data && !bank.data.configured ? (
        <div className="panel bank-notice">
          <h2>Bank setup required</h2>
          <p>{bank.data.configurationError}</p>
          <p>
            Balances and successful transactions appear after the contracts and managed signer are connected.
          </p>
        </div>
      ) : null}
      <div className="bank-toolbar">
        <Field label="Acting agent">
          <select
            value={agent}
            onChange={(e) => {
              setAgentId(e.target.value);
              setOperation('');
              setSelectedEntity('');
            }}
          >
            <option value="" disabled>
              Select an agent
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.status === 'revoked' ? ' (revoked)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Link to="/agents" className="bank-inline-link">
          <span>Manage agent budgets and approvals</span> <ArrowUpRight size={14} />
        </Link>
      </div>
      <nav className="bank-tabs" aria-label="Bank sections">
        {['Wallets', 'Funds', 'Lending', 'Public chits', 'Policy', 'Activity', 'Earnings'].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? 'page' : undefined}
            className={tab === t ? 'active' : ''}
            onClick={() => {
              setTab(t);
              setOperation('');
              setSelectedEntity('');
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {!agents.length && (
        <Empty icon={<Wallet />} title="Connect your first agent">
          Every agent receives its own bank account. Create an agent to get started.
        </Empty>
      )}
      {tab === 'Wallets' && (
        <>
          <CashflowChart cashflow={bank.data?.cashflow ?? null} />
          <section className="bank-grid">
            {(bank.data?.accounts ?? [])
              .filter((account) => account.agent_id)
              .map((account) => (
                <WalletCard
                  key={account.id}
                  account={account}
                  name={agents.find((a) => a.id === account.agent_id)?.name ?? 'Agent wallet'}
                  disabled={!bank.data?.configured}
                  busy={action.isPending}
                  onProvision={() => action.mutate({ path: `/bank/agents/${account.agent_id}/provision` })}
                />
              ))}
          </section>
          {agent && (
            <section className="panel bank-section">
              <h2>Top up with PayPal Sandbox</h2>
              <TopUpForm
                key={agent}
                agent={agent}
                enabled={Boolean(bank.data?.configured)}
                onRefresh={refresh}
              />
            </section>
          )}
          <section className="panel bank-section">
            <h2>Send cUSD</h2>
            <p>
              The recipient must be allowed by your Bank policy. Your agent’s daily and per-operation limits
              apply.
            </p>
            <Button disabled={!bank.data?.configured || !agent} onClick={() => selectOperation('transfer')}>
              Make a transfer
            </Button>
          </section>
          <section className="panel bank-section">
            <h2>Top-up receipts</h2>
            {!bank.data?.topups.length ? (
              <p>No Sandbox top-ups yet.</p>
            ) : (
              bank.data.topups.map((t) => (
                <div className="bank-receipt" key={t.id}>
                  <div className="bank-receipt-heading">
                    <strong>{(t.amount_cents / 100).toFixed(2)} cUSD</strong>
                    <Status status={t.state} />
                  </div>
                  <p>
                    Sandbox order: {t.order_id ?? 'Pending'} · capture: {t.capture_id ?? 'Pending'}
                  </p>
                  <div className="bank-receipt-actions">
                    <TxLink hash={t.tx_hash} />
                    {t.approval_url && (
                      <a className="button button-primary" href={t.approval_url}>
                        Continue with PayPal Sandbox
                      </a>
                    )}
                    <Button
                      variant="secondary"
                      busy={action.isPending}
                      onClick={() => action.mutate({ path: `/bank/topups/${t.id}/reconcile` })}
                    >
                      Reconcile top-up
                    </Button>
                  </div>
                  {t.error && <p role="alert">{t.error}</p>}
                </div>
              ))
            )}
          </section>
        </>
      )}
      {tab === 'Funds' && (
        <>
          <div className="bank-section">
            <h2>Managed funds</h2>
            <p>
              ERC-4626 shares backed by actual test-token positions. Trades use a controlled artificial test
              market, a price with a one-hour expiry, and enforced allocation, loss and trade limits.
              Redemptions depend on cUSD liquidity.
            </p>
            <Button onClick={() => selectOperation('create_fund')} disabled={!bank.data?.configured}>
              Create a fund
            </Button>
          </div>
          <EntityCards
            entities={(bank.data?.entities ?? []).filter((e) => e.kind === 'fund')}
            onSelect={(e) => setSelectedEntity(e.address)}
            empty="No funds have been created."
          />
          {selectedEntity && (
            <section className="panel bank-section">
              <h2>Fund details and positions</h2>
              <ErrorNotice error={detail.error} />
              {detail.isPending ? <Skeleton /> : <FinancialDetails value={detail.data} />}
              <div className="action-row">
                {['invest', 'redeem', 'rebalance_fund', 'fund_controls'].map((op) => (
                  <Button key={op} variant="secondary" onClick={() => selectOperation(op, selectedEntity)}>
                    {label(op)}
                  </Button>
                ))}
              </div>
              <Button variant="ghost" onClick={() => selectOperation('fund_performance', selectedEntity)}>
                View transaction-linked performance
              </Button>
              <StrategyForm key={selectedEntity} address={selectedEntity} onRefresh={refresh} />
            </section>
          )}
        </>
      )}
      {tab === 'Lending' && (
        <>
          <section className="panel bank-section">
            <h2>Collateralized cUSD loans</h2>
            <p>
              Borrow from depositor-funded liquidity. Maximum initial LTV 50%; liquidation threshold 65%;
              annual simple interest 8%; 20% of paid interest goes to the Bank. Liquidator incentive is capped
              at 5%. Collateral is the configured six-decimal test asset.
            </p>
            <div className="action-row">
              {[
                'quote_loan',
                'open_collateralized_loan',
                'supply_liquidity',
                'redeem_liquidity',
                'repay_loan',
                'add_collateral',
                'withdraw_collateral',
              ].map((op) => (
                <Button
                  key={op}
                  variant="secondary"
                  disabled={!bank.data?.configured || !balance?.address}
                  onClick={() => selectOperation(op)}
                >
                  {label(op)}
                </Button>
              ))}
            </div>
          </section>
          <section className="panel bank-section">
            <h2>Your loan obligations</h2>
            <ErrorNotice error={loans.error} />
            {!loans.data?.length ? (
              <p>No collateralized loans for this agent.</p>
            ) : (
              loans.data.map((l) => <FinancialDetails key={String(l.id)} value={l} />)
            )}
          </section>
        </>
      )}
      {tab === 'Public chits' && (
        <>
          <section className="bank-section">
            <h2>Public auction chits</h2>
            <p>
              Members pay fixed installments each round. The highest revealed discount wins, with join order
              breaking ties. Each member wins at most once and must continue contributions. A cUSD
              participation bond and test-asset security protect future obligations. Shortfalls pause payout.
            </p>
            <Button disabled={!bank.data?.configured} onClick={() => selectOperation('create_chit')}>
              Create a public chit
            </Button>
          </section>
          <EntityCards
            entities={(bank.data?.entities ?? []).filter((e) => e.kind === 'chit')}
            onSelect={(e) => setSelectedEntity(e.address)}
            empty="No public chits yet. Any registered agent can create one."
          />
          {selectedEntity && (
            <section className="panel bank-section">
              <h2>Terms, auction and public ledger</h2>
              <ErrorNotice error={detail.error} />
              <FinancialDetails value={detail.data} />
              <div className="action-row">
                {[
                  'join_chit',
                  'contribute',
                  'place_chit_bid',
                  'claim_chit_payout',
                  'top_up_chit_security',
                  'top_up_chit_bond',
                  'finalize_chit',
                  'recover_chit_default',
                  'exit_chit',
                  'cancel_unfilled_chit',
                ].map((op) => (
                  <Button key={op} variant="secondary" onClick={() => selectOperation(op, selectedEntity)}>
                    {label(op)}
                  </Button>
                ))}
              </div>
              <p>
                Keep the same discount, round and salt for commit and reveal. Reveals outside their window
                fail. Minutes-long rounds are supported; the keeper runs every five minutes, or a member can
                trigger finalization.
              </p>
            </section>
          )}
        </>
      )}
      {tab === 'Policy' && agent && (
        <PolicyForm
          key={agent}
          agent={agent}
          policy={bank.data?.policies.find((p) => p.agent_id === agent)}
          onRefresh={refresh}
        />
      )}
      {tab === 'Activity' && (
        <section className="panel bank-section">
          <h2>On-chain activity</h2>
          <p>
            Pending, failed and confirmed actions are shown separately. D1 is a workflow index; wallet
            balances come from the chain.
          </p>
          {!bank.data?.transactions.length ? (
            <p>No on-chain actions yet.</p>
          ) : (
            bank.data.transactions.map((t) => (
              <div className="bank-receipt" key={t.id}>
                <div className="bank-receipt-heading">
                  <strong>{label(t.purpose)}</strong> <Status status={t.state} />
                </div>
                <p>{new Date(t.created_at).toLocaleString()}</p>
                <TxLink hash={t.tx_hash} />
                {t.error && <p>{t.error}</p>}
              </div>
            ))
          )}
          <Button
            variant="secondary"
            busy={action.isPending}
            onClick={() => action.mutate({ path: '/bank/reconcile' })}
          >
            Reconcile pending actions
          </Button>
        </section>
      )}
      {tab === 'Earnings' && (
        <section className="panel bank-section">
          <h2>Merchant earnings</h2>
          <div className="bank-grid" aria-label="Provider wallets">
            {(bank.data?.accounts ?? [])
              .filter((account) => account.provider_id)
              .map((account) => (
                <WalletCard
                  key={account.id}
                  account={account}
                  name={
                    dashboard?.providers.find((p) => p.id === account.provider_id)?.name ?? 'Provider wallet'
                  }
                />
              ))}
          </div>
          <Button
            variant="secondary"
            disabled={!bank.data?.configured || !agent}
            onClick={() => selectOperation('claim_provider_earnings')}
          >
            Move provider earnings to this agent
          </Button>
          <p>
            Gross cUSD sales, exact platform fees and net receipts. Funds are available after escrow release
            to the provider wallet.
          </p>
          <EarningsChart rows={bank.data?.earnings ?? []} />
          <div className="table-scroll" role="region" aria-label="Merchant earnings history" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Gross</th>
                  <th>Fee</th>
                  <th>Net</th>
                  <th>Settlement</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {(bank.data?.earnings ?? []).map((e) => (
                  <tr key={e.id}>
                    <td>{e.capability}</td>
                    <td>{displayUnits(e.amount_units)} cUSD</td>
                    <td>{displayUnits(e.fee_units)} cUSD</td>
                    <td>{displayUnits(BigInt(e.amount_units) - BigInt(e.fee_units))} cUSD</td>
                    <td>
                      <Status status={e.state} />
                    </td>
                    <td>
                      <TxLink hash={e.resolution_tx} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!bank.data?.earnings.length && <p>No escrow sales yet.</p>}
        </section>
      )}
      {selected && agent && (
        <BankAction
          key={`${operation}:${selectedEntity}:${agent}`}
          capability={selected}
          agent={agent}
          address={selectedEntity}
          enabled={Boolean(bank.data?.configured)}
          onRefresh={refresh}
        />
      )}
    </LocalBankContext.Provider>
  );
}
function WalletCard({
  account,
  name,
  onProvision,
  disabled = false,
  busy = false,
}: {
  account: Account;
  name: string;
  onProvision?: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const local = useContext(LocalBankContext);
  return (
    <article
      className="panel bank-card"
      aria-label={`${name} ${account.provider_id ? 'provider' : 'agent'} wallet`}
    >
      <Wallet size={22} />
      <h2>{name}</h2>
      {account.provider_id && <p className="muted">Provider wallet</p>}
      <div className="bank-balance">
        {account.balance === null ? '—' : account.balance} <small>cUSD</small>
      </div>
      <div className="bank-wallet-actions">
        <Status status={account.state} />
        {!account.address && onProvision && (
          <Button disabled={disabled} busy={busy} onClick={onProvision}>
            Provision wallet
          </Button>
        )}
      </div>
      {account.address && (
        <>
          <div className="bank-address">
            <code>{account.address}</code>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Copy wallet address"
              onClick={() => {
                void navigator.clipboard.writeText(account.address!);
              }}
            >
              <Copy size={15} />
            </Button>
          </div>
          {local ? (
            <p>Local EVM wallet (not hosted Base Sepolia)</p>
          ) : (
            <a
              className="bank-inline-link"
              href={explorer(account.address, 'address')}
              target="_blank"
              rel="noreferrer"
            >
              View wallet <ExternalLink size={13} />
            </a>
          )}
          <p className="muted">
            {account.collateral ?? '—'} test collateral · {account.gas ?? '—'} test ETH. Executor sponsors
            transaction gas.
          </p>
        </>
      )}
      <ErrorNotice error={account.error ? new Error(account.error) : null} />
    </article>
  );
}
function TopUpForm({
  agent,
  enabled,
  onRefresh,
}: {
  agent: string;
  enabled: boolean;
  onRefresh: () => void;
}) {
  const [amount, setAmount] = useState('20'),
    key = useRef(crypto.randomUUID());
  const topup = useMutation({
    mutationFn: () =>
      api<Topup>('/bank/topups', {
        method: 'POST',
        body: { agentId: agent, amountCents: Number(units(amount, 2)), idempotencyKey: key.current },
      }),
    onSuccess: () => onRefresh(),
  });
  return (
    <form
      className="bank-form"
      onSubmit={(e) => {
        e.preventDefault();
        topup.mutate();
      }}
    >
      <Field label="Sandbox USD amount">
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            key.current = crypto.randomUUID();
            topup.reset();
          }}
        />
      </Field>
      <Button type="submit" disabled={!enabled} busy={topup.isPending}>
        Create Sandbox top-up
      </Button>
      <ErrorNotice error={topup.error} />
      {topup.data?.approval_url && (
        <a className="button button-primary" href={topup.data.approval_url}>
          Approve in PayPal Sandbox <ExternalLink size={14} />
        </a>
      )}
    </form>
  );
}
function PolicyForm({
  agent,
  policy,
  onRefresh,
}: {
  agent: string;
  policy: BankData['policies'][number] | undefined;
  onRefresh: () => void;
}) {
  const [destinations, setDestinations] = useState<string>(
    (JSON.parse(policy?.destinations ?? '[]') as string[]).join('\n'),
  );
  const [investment, setInvestment] = useState(String((policy?.max_investment_cents ?? 0) / 100)),
    [loan, setLoan] = useState(String((policy?.max_loan_cents ?? 0) / 100)),
    [chit, setChit] = useState(String((policy?.max_chit_cents ?? 0) / 100));
  const save = useMutation({
    mutationFn: () =>
      api(`/bank/agents/${agent}/policy`, {
        method: 'PUT',
        body: {
          destinations: destinations
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean),
          max_investment_cents: unitsToCents(units(investment)),
          max_loan_cents: unitsToCents(units(loan)),
          max_chit_cents: unitsToCents(units(chit)),
        },
      }),
    onSuccess: () => onRefresh(),
  });
  return (
    <section className="panel bank-section">
      <h2>Owner-controlled financial policy</h2>
      <p>
        Investment, loan and chit exposure starts disabled. These per-action limits supplement the agent’s
        overall daily and per-operation budget. Joining a chit reserves its bond plus the full installment
        commitment. Agents can propose policy changes through MCP; an owner must approve them.
      </p>
      <form
        className="bank-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Allowed transfer recipients (one address per line)">
          <textarea value={destinations} onChange={(e) => setDestinations(e.target.value)} rows={3} />
        </Field>
        {[
          ['Investment limit (cUSD)', investment, setInvestment],
          ['Loan exposure limit (cUSD)', loan, setLoan],
          ['Chit commitment limit (cUSD)', chit, setChit],
        ].map(([name, value, set]) => (
          <Field key={String(name)} label={String(name)}>
            <input
              inputMode="decimal"
              required
              value={String(value)}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
            />
          </Field>
        ))}
        <Button busy={save.isPending}>Save financial policy</Button>
        <ErrorNotice error={save.error} />
        {save.isSuccess && <p role="status">Financial policy saved.</p>}
      </form>
      <Link to="/agents">Set overall daily budgets, approval thresholds or revoke the agent</Link>
    </section>
  );
}
function EntityCards({
  entities,
  onSelect,
  empty,
}: {
  entities: Entity[];
  onSelect: (e: Entity) => void;
  empty: string;
}) {
  return entities.length ? (
    <div className="bank-grid">
      {entities.map((e) => (
        <article key={e.address} className="panel bank-card">
          <Badge>PUBLIC · TESTNET</Badge>
          <h2>{e.name}</h2>
          <FinancialDetails value={JSON.parse(e.terms)} />
          <Button variant="secondary" onClick={() => onSelect(e)}>
            View details
          </Button>
        </article>
      ))}
    </div>
  ) : (
    <div className="panel bank-section">
      <p>{empty}</p>
    </div>
  );
}
function FinancialDetails({ value }: { value: unknown }) {
  if (!value) return <p className="muted">Awaiting current chain data.</p>;
  const simple = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => typeof v !== 'object' && v !== undefined && v !== null,
  );
  return (
    <>
      <dl className="bank-metrics">
        {simple.map(([k, v]) => (
          <div key={k}>
            <dt>{label(k.replace(/([a-z])([A-Z])/g, '$1 $2'))}</dt>
            <dd>
              {/Units$/.test(k) && /^\d+$/.test(String(v))
                ? `${displayUnits(String(v))} cUSD / test-asset units`
                : String(v)}
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Complete terms, positions and ledger</summary>
        <CodeBlock>{JSON.stringify(value, null, 2)}</CodeBlock>
      </details>
    </>
  );
}
function BankAction({
  capability,
  agent,
  address,
  enabled,
  onRefresh,
}: {
  capability: Capability;
  agent: string;
  address: string;
  enabled: boolean;
  onRefresh: () => void;
}) {
  const props = capability.inputSchema.properties as Record<string, SchemaProperty>;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(props).map((k) => [k, k === 'address' ? address : ''])),
  );
  const [quote, setQuote] = useState<Quote>(),
    [purchase, setPurchase] = useState<Purchase>(),
    [invocation, setInvocation] = useState<Invocation>();
  const input = () =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        props[k].type === 'integer' || props[k].type === 'number'
          ? Number(v)
          : props[k].type === 'boolean'
            ? v === 'true'
            : props[k].type === 'array'
              ? JSON.parse(v)
              : v,
      ]),
    );
  const preview = useMutation({
    mutationFn: () =>
      api<Quote>(`/agents/${agent}/quotes`, {
        method: 'POST',
        body: { capability_id: capability.id, input: input(), reason: 'Owner initiated Capora Bank action' },
      }),
    onSuccess: (q) => setQuote(q),
  });
  const confirm = useMutation({
    mutationFn: async () => {
      const p = await api<Purchase>(`/agents/${agent}/purchases`, {
        method: 'POST',
        body: { quote_id: quote!.id },
      });
      setPurchase(p);
      if (p.status === 'purchased')
        setInvocation(
          await api<Invocation>(`/agents/${agent}/invocations`, {
            method: 'POST',
            body: { purchase_id: p.id, input: input() },
          }),
        );
      return p;
    },
    onSuccess: () => onRefresh(),
  });
  const progress = useQuery({
    queryKey: ['bank-action-progress', agent, invocation?.id],
    queryFn: () => api<Invocation>(`/agents/${agent}/invocations/${invocation!.id}`),
    enabled: Boolean(invocation?.id),
    refetchInterval: (q) =>
      q.state.data && ['completed', 'failed'].includes(q.state.data.status) ? false : 1500,
  });
  return (
    <section className="panel bank-section bank-action" aria-label="Bank action">
      <h2>{capability.name}</h2>
      <p>{capability.description}</p>
      <form
        className="bank-form"
        onSubmit={(e) => {
          e.preventDefault();
          preview.mutate();
        }}
      >
        {Object.entries(props).map(([k, p]) => (
          <Field
            key={k}
            label={`${label(k)}${/amount|collateral|security|discount|installment|max_trade|daily_trade_limit|min_output|min_assets/.test(k) ? ' (cUSD / test-token units)' : k.includes('shares') ? ' (12-decimal shares)' : ''}`}
            hint={p.description}
          >
            {p.enum || p.type === 'boolean' ? (
              <select
                required
                value={values[k]}
                onChange={(e) => {
                  setValues({ ...values, [k]: e.target.value });
                  setQuote(undefined);
                }}
              >
                <option value="" disabled>
                  Choose
                </option>
                {(p.enum ?? ['true', 'false']).map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {String(v)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                value={values[k]}
                type={p.type === 'integer' || p.type === 'number' ? 'number' : 'text'}
                min={p.minimum}
                max={p.maximum}
                onChange={(e) => {
                  setValues({ ...values, [k]: e.target.value });
                  setQuote(undefined);
                }}
              />
            )}
          </Field>
        ))}
        <Button busy={preview.isPending} disabled={!enabled}>
          Review action and fees
        </Button>
        <ErrorNotice error={preview.error ?? confirm.error} />
      </form>
      {quote && (
        <div className="bank-receipt">
          <h3>Confirm {capability.name}</h3>
          <p>
            Policy exposure: {(quote.priceCents / 100).toFixed(2)} cUSD. Bank catalog service fee: 0 cUSD.
            Principal moves only to the requested contract or recipient. Contract fees apply as disclosed in
            its immutable terms.
          </p>
          {capability.id.includes('fund') && (
            <p>
              Fund management fee: {values.management_fee_bps ?? 'see fund terms'} basis points annually, paid
              in shares. Controlled market swaps charge 30 basis points.
            </p>
          )}
          {capability.id.includes('loan') && (
            <p>
              Loan interest: 8% APR. Bank spread: 20% of paid interest. Liquidations may incur a 5% incentive.
            </p>
          )}
          {capability.id.includes('chit') && (
            <p>
              Chit commission: {values.commission_bps ?? 'see chit terms'} basis points of each round’s pool.
              Highest discount is divided equally; rounding remainder goes to the disclosed treasury.
            </p>
          )}
          <Badge tone={quote.approvalRequired ? 'amber' : 'green'}>
            {quote.approvalRequired ? 'Owner approval required' : 'Within delegated policy'}
          </Badge>
          <p>Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}.</p>
          <Button busy={confirm.isPending} disabled={Boolean(purchase)} onClick={() => confirm.mutate()}>
            Confirm action
          </Button>
        </div>
      )}
      {purchase && <PurchaseActions purchase={purchase} />}
      <ErrorNotice error={progress.error} />
      {(progress.data ?? invocation) && (
        <div className="bank-receipt">
          <Status status={(progress.data ?? invocation)!.status} />
          {(progress.data ?? invocation)!.error && <p role="alert">{(progress.data ?? invocation)!.error}</p>}
          <FinancialDetails value={(progress.data ?? invocation)!.result} />
        </div>
      )}
    </section>
  );
}
function EarningsChart({ rows }: { rows: BankData['earnings'] }) {
  const released = rows.filter((r) => r.state === 'released'),
    gross = released.reduce((s, r) => s + BigInt(r.amount_units), 0n),
    fees = released.reduce((s, r) => s + BigInt(r.fee_units), 0n);
  if (!gross) return <p className="muted">The earnings chart appears after the first confirmed release.</p>;
  return (
    <figure className="bank-chart">
      <figcaption>Confirmed gross sales: {displayUnits(gross)} cUSD</figcaption>
      <div
        role="img"
        aria-label={`Net earnings ${displayUnits(gross - fees)} cUSD; marketplace fees ${displayUnits(fees)} cUSD`}
      >
        <span style={{ width: `${Number(((gross - fees) * 10000n) / gross) / 100}%` }} />
        <span />
      </div>
      <p>
        Net {displayUnits(gross - fees)} cUSD · fees {displayUnits(fees)} cUSD
      </p>
    </figure>
  );
}
function CashflowChart({ cashflow }: { cashflow: BankData['cashflow'] }) {
  if (!cashflow?.indexedAt)
    return (
      <p className="muted">
        Confirmed wallet inflows and spending appear after the chain indexer processes your first transfer.
      </p>
    );
  const received = BigInt(cashflow.receivedUnits),
    sent = BigInt(cashflow.sentUnits),
    total = received + sent;
  return (
    <figure className="panel bank-section bank-chart">
      <figcaption>Confirmed indexed cUSD flows across your wallets</figcaption>
      {total > 0n && (
        <div
          role="img"
          aria-label={`${displayUnits(received)} cUSD received; ${displayUnits(sent)} cUSD sent`}
        >
          <span style={{ width: `${Number((received * 10000n) / total) / 100}%` }} />
          <span />
        </div>
      )}
      <p>
        Received {displayUnits(received)} cUSD · sent {displayUnits(sent)} cUSD. Inflows include top-ups and
        earnings; internal transfers are excluded.
      </p>
      <small>Refreshed {new Date(cashflow.indexedAt).toLocaleString()}.</small>
    </figure>
  );
}
function StrategyForm({ address, onRefresh }: { address: string; onRefresh: () => void }) {
  const [enabled, setEnabled] = useState(false),
    [interval, setInterval] = useState(''),
    [calls, setCalls] = useState(''),
    [analytics, setAnalytics] = useState('');
  const configure = useMutation({
    mutationFn: () =>
      api(`/bank/funds/${address}/strategy`, {
        method: 'PUT',
        body: {
          enabled,
          intervalSeconds: Number(interval),
          maxCallsPerDay: Number(calls),
          allowedCapabilities: analytics
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => onRefresh(),
  });
  const trigger = useMutation({
    mutationFn: () => api(`/bank/funds/${address}/run`, { method: 'POST', body: {} }),
    onSuccess: () => onRefresh(),
  });
  return (
    <details>
      <summary>AI strategy scheduling and operating expenses</summary>
      <p>
        The fund manager’s owner can enable a bounded planner. Model API calls may incur charges with the
        configured provider; choose the interval and daily call cap explicitly. Proposed trades and analytics
        purchases still require the manager’s spending policy. Analytics spend is paid from the vault through
        escrow and reduces NAV; the contract enforces its immutable daily expense cap.
      </p>
      <form
        className="bank-form"
        onSubmit={(e) => {
          e.preventDefault();
          configure.mutate();
        }}
      >
        <Field label="Strategy runs">
          <select value={String(enabled)} onChange={(e) => setEnabled(e.target.value === 'true')}>
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </Field>
        <Field label="Interval (seconds, minimum 300)">
          <input
            required
            type="number"
            min={300}
            max={604800}
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          />
        </Field>
        <Field label="Maximum model calls per UTC day">
          <input
            required
            type="number"
            min={1}
            max={24}
            value={calls}
            onChange={(e) => setCalls(e.target.value)}
          />
        </Field>
        <Field label="Allowed analytics capability IDs (comma separated)">
          <input value={analytics} onChange={(e) => setAnalytics(e.target.value)} />
        </Field>
        <Button busy={configure.isPending}>Save strategy authorization</Button>
      </form>
      <Button variant="secondary" busy={trigger.isPending} onClick={() => trigger.mutate()}>
        Run an eligible strategy now
      </Button>
      <ErrorNotice error={configure.error ?? trigger.error} />
      {Boolean(trigger.data) && <FinancialDetails value={trigger.data} />}
    </details>
  );
}
