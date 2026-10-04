import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowRight, Activity, DollarSign, Blocks, Pencil, Upload, Check, Network } from 'lucide-react';
import { money, type Capability, type CapabilityRegistration } from '@capora/types';
import { api, useAction, useDashboard, latency } from '../lib/api';
import { Button, Badge, Dialog, Field, ErrorNotice, Empty } from '../components/ui';
import { ProviderIcon } from '../components/brand';
import { Stat } from './overview';
type ProviderCapability = Capability & { endpoint: string; httpMethod: 'POST' | 'GET'; hasSecret: boolean };
export function Providers() {
  const { data: dashboard } = useDashboard();
  const { data: caps, error } = useQuery({
    queryKey: ['provider-capabilities'],
    queryFn: () => api<ProviderCapability[]>('/providers/capabilities'),
  });
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<ProviderCapability>();
  const [newProvider, setNewProvider] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [providerDescription, setProviderDescription] = useState('');
  const toggle = useAction(({ id, enabled }: { id: string; enabled: boolean }) =>
    api(`/providers/capabilities/${id}`, { method: 'PATCH', body: { enabled } }),
  );
  const addProvider = useAction(async () => {
    await api('/providers', {
      method: 'POST',
      body: { name: providerName, description: providerDescription },
    });
    setNewProvider(false);
    setProviderName('');
    setProviderDescription('');
  });
  const revenue = dashboard?.providers.reduce((s, p) => s + p.revenueCents, 0) ?? 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TURN YOUR ACCESS INTO OPPORTUNITY</div>
          <h1>Provider console</h1>
          <p>Publish a capability. Let agents discover what only you can offer.</p>
        </div>
        <div className="action-row">
          <Button variant="secondary" onClick={() => setNewProvider(true)}>
            <Network size={16} /> Add provider
          </Button>
          <Button onClick={() => setCreate(true)} disabled={!dashboard?.providers.length}>
            <Plus size={17} /> List capability
          </Button>
        </div>
      </div>
      <div className="stats-grid transaction-stats">
        <Stat
          icon={<DollarSign size={18} />}
          label="Completed revenue"
          value={money(revenue)}
          note={
            dashboard?.paymentMode === 'demo'
              ? 'Simulated revenue · not a payout'
              : 'Sandbox captures · not a payout'
          }
        />
        <Stat
          icon={<Blocks size={18} />}
          label="Published capabilities"
          value={String(caps?.filter((c) => c.enabled).length ?? 0)}
          note={`${caps?.length ?? 0} total listings`}
        />
        <Stat
          icon={<Activity size={18} />}
          label="Provider executions"
          value={String(dashboard?.providers.reduce((s, p) => s + p.invocationCount, 0) ?? 0)}
          note="Successful and failed invocations"
        />
      </div>
      <ErrorNotice error={error ?? toggle.error} />
      <section className="panel">
        <div className="panel-heading">
          <h2>Your capabilities</h2>
          <Badge>Operator-approved endpoints</Badge>
        </div>
        <div className="table-scroll">
          <table className="transactions-table provider-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Price</th>
                <th>Performance</th>
                <th>Execution</th>
                <th>Enabled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {caps?.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="provider-table-name">
                      <ProviderIcon capability={c} />
                      <div>
                        <strong>{c.name}</strong>
                        <small>
                          {c.provider} · v{c.version}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {money(c.priceCents)}
                    <small className="payment-kind">per {c.pricingUnit}</small>
                  </td>
                  <td>
                    {c.successCount + c.failureCount || c.reliability
                      ? `${c.reliability}% reliability`
                      : 'Reliability unmeasured'}
                    <small className="payment-kind">
                      {c.successCount + c.failureCount} runs ·{' '}
                      {latency(c.avgLatencyMs || c.expectedLatencyMs)}
                    </small>
                  </td>
                  <td>
                    <Badge tone={c.async ? 'amber' : 'neutral'}>{c.async ? 'Queued' : 'Synchronous'}</Badge>
                  </td>
                  <td>
                    <input
                      aria-label={`Enable ${c.name}`}
                      className="switch"
                      type="checkbox"
                      checked={c.enabled}
                      disabled={toggle.isPending}
                      onChange={(e) => toggle.mutate({ id: c.id, enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <Button variant="ghost" size="sm" onClick={() => setEdit(c)}>
                      <Pencil size={14} />
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {caps && !caps.length && (
          <Empty icon={<Blocks size={26} />} title="Publish your first capability">
            <p>
              Unique data, privileged tools, or specialized infrastructure — make your access available to
              agents.
            </p>
            <Button onClick={() => setCreate(true)}>
              List a capability <ArrowRight size={15} />
            </Button>
          </Empty>
        )}
        <div className="table-footer">
          <span>Secrets are encrypted at rest and never returned to buyers.</span>
          <span>HTTPS allowlist enforced</span>
        </div>
      </section>
      <section className="panel provider-history">
        <div className="panel-heading">
          <h2>Recent execution history</h2>
          <Badge>Workspace activity</Badge>
        </div>
        <div className="mini-history">
          {dashboard?.invocations.slice(0, 8).map((i) => (
            <div key={i.id}>
              <div>
                <strong>{i.capabilityName}</strong>
                <small className="mono">{i.id}</small>
              </div>
              <Badge tone={i.status === 'completed' ? 'green' : i.status === 'failed' ? 'red' : 'amber'}>
                {i.status} {i.latencyMs && `· ${latency(i.latencyMs)}`}
              </Badge>
            </div>
          ))}
        </div>
        {!dashboard?.invocations.length && (
          <p className="muted panel-padding">Provider invocations appear here after a capability executes.</p>
        )}
      </section>
      {(create || edit) && (
        <CapabilityForm
          initial={edit}
          onClose={() => {
            setCreate(false);
            setEdit(undefined);
          }}
        />
      )}
      <Dialog
        open={newProvider}
        onOpenChange={setNewProvider}
        title="Register a provider."
        description="A provider is the organization behind your capabilities."
      >
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            addProvider.mutate();
          }}
        >
          <Field label="Provider name">
            <input
              required
              minLength={2}
              maxLength={80}
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
            />
          </Field>
          <Field label="Description">
            <textarea
              required
              minLength={10}
              maxLength={1000}
              rows={3}
              value={providerDescription}
              onChange={(e) => setProviderDescription(e.target.value)}
            />
          </Field>
          <ErrorNotice error={addProvider.error} />
          <Button busy={addProvider.isPending}>
            Register provider <ArrowRight size={15} />
          </Button>
        </form>
      </Dialog>
    </>
  );
}
function CapabilityForm({ initial, onClose }: { initial?: ProviderCapability; onClose: () => void }) {
  const { data } = useDashboard();
  const [form, setForm] = useState({
    providerId: initial?.providerId ?? data?.providers[0]?.id ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    type: initial?.type ?? 'api',
    category: initial?.category ?? 'Company intelligence',
    price: String((initial?.priceCents ?? 20) / 100),
    pricingUnit: initial?.pricingUnit ?? 'query',
    endpoint: initial?.endpoint ?? '',
    httpMethod: initial?.httpMethod ?? 'POST',
    secret: '',
    latency: String(initial?.expectedLatencyMs ?? 2000),
    async: initial?.async ?? false,
    tags: initial?.tags.join(', ') ?? '',
    inputSchema: JSON.stringify(
      initial?.inputSchema ?? {
        type: 'object',
        properties: { company: { type: 'string' } },
        required: ['company'],
        additionalProperties: false,
      },
      null,
      2,
    ),
    outputSchema: JSON.stringify(
      initial?.outputSchema ?? {
        type: 'object',
        properties: { data: { type: 'object' } },
        required: ['data'],
      },
      null,
      2,
    ),
    documentationUrl: initial?.documentationUrl ?? '',
    enabled: initial?.enabled ?? true,
  });
  const [dataset, setDataset] = useState('');
  const [datasetError, setDatasetError] = useState<unknown>();
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const save = useAction(async () => {
    let inputSchema: Record<string, unknown>;
    let outputSchema: Record<string, unknown>;
    try {
      inputSchema = JSON.parse(form.inputSchema);
      outputSchema = JSON.parse(form.outputSchema);
    } catch {
      throw new Error('Input and output schemas must be valid JSON.');
    }
    const body: CapabilityRegistration = {
      providerId: form.providerId,
      name: form.name,
      description: form.description,
      type: form.type,
      category: form.category,
      priceCents: Math.round(Number(form.price) * 100),
      pricingUnit: form.pricingUnit,
      endpoint: form.endpoint,
      httpMethod: form.httpMethod,
      ...(form.secret ? { secret: form.secret } : {}),
      authHeader: 'Authorization',
      expectedLatencyMs: Number(form.latency),
      async: form.async,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      inputSchema,
      outputSchema,
      availability: 0.99,
      enabled: form.enabled,
      ...(form.documentationUrl ? { documentationUrl: form.documentationUrl } : {}),
    };
    await api(`/providers/capabilities${initial ? `/${initial.id}` : ''}`, {
      method: initial ? 'PUT' : 'POST',
      body,
    });
    onClose();
  });
  const upload = useAction(async () => {
    setDatasetError(undefined);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataset);
    } catch {
      throw new Error('Dataset must be a valid JSON object.');
    }
    const result = await api<{ endpoint: string }>('/providers/datasets', {
      method: 'POST',
      body: { data: parsed },
    });
    update('endpoint', result.endpoint);
    return result;
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={initial ? 'Edit capability.' : 'Make your capability discoverable.'}
      description="Publish machine-readable schemas and a price agents can reason about."
      wide
    >
      <form
        className="dialog-body capability-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="form-grid">
          <Field label="Provider">
            <select
              value={form.providerId}
              onChange={(e) => update('providerId', e.target.value)}
              disabled={Boolean(initial)}
            >
              {data?.providers.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={(e) => update('type', e.target.value as Capability['type'])}>
              <option value="api">API</option>
              <option value="dataset">Dataset</option>
              <option value="agent">Agent</option>
            </select>
          </Field>
        </div>
        <Field label="Capability name">
          <input
            required
            minLength={3}
            maxLength={100}
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </Field>
        <Field label="What unique access does it provide?">
          <textarea
            required
            rows={3}
            minLength={20}
            maxLength={1500}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Category">
            <input required value={form.category} onChange={(e) => update('category', e.target.value)} />
          </Field>
          <Field label="Tags (comma separated)">
            <input value={form.tags} onChange={(e) => update('tags', e.target.value)} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Price ($)">
            <input
              required
              type="number"
              min="0.01"
              max="1000"
              step="0.01"
              value={form.price}
              onChange={(e) => update('price', e.target.value)}
            />
          </Field>
          <Field label="Per">
            <input
              required
              maxLength={30}
              value={form.pricingUnit}
              onChange={(e) => update('pricingUnit', e.target.value)}
            />
          </Field>
          <Field label="Expected latency (ms)">
            <input
              required
              type="number"
              min="50"
              max="120000"
              value={form.latency}
              onChange={(e) => update('latency', e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Provider endpoint"
          hint="HTTPS hostnames require operator approval. Built-in tools use builtin:// identifiers. Datasets can use an uploaded R2 object."
        >
          <input
            required
            placeholder="https://approved-provider.com/api/query"
            value={form.endpoint}
            onChange={(e) => update('endpoint', e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="HTTP method">
            <select
              value={form.httpMethod}
              onChange={(e) => update('httpMethod', e.target.value as 'POST' | 'GET')}
            >
              <option>POST</option>
              <option>GET</option>
            </select>
          </Field>
          <Field
            label={
              initial?.hasSecret
                ? 'Replace provider authorization (optional)'
                : 'Provider authorization header value'
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Bearer provider-secret"
              value={form.secret}
              onChange={(e) => update('secret', e.target.value)}
            />
          </Field>
        </div>
        {form.type === 'dataset' && (
          <div className="dataset-upload">
            <Field label="Upload a JSON dataset to R2">
              <textarea
                rows={4}
                className="json-editor"
                placeholder={'{"data": {"records": []}}'}
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
              />
            </Field>
            <Button type="button" variant="secondary" busy={upload.isPending} onClick={() => upload.mutate()}>
              <Upload size={15} />
              {upload.isSuccess ? 'Uploaded to R2' : 'Upload dataset'}
            </Button>
            <ErrorNotice error={datasetError ?? upload.error} />
          </div>
        )}
        <div className="form-grid schema-grid">
          <Field label="Input JSON Schema">
            <textarea
              required
              rows={10}
              className="json-editor"
              value={form.inputSchema}
              onChange={(e) => update('inputSchema', e.target.value)}
            />
          </Field>
          <Field label="Output JSON Schema">
            <textarea
              required
              rows={10}
              className="json-editor"
              value={form.outputSchema}
              onChange={(e) => update('outputSchema', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Documentation URL (optional)">
          <input
            type="url"
            value={form.documentationUrl}
            onChange={(e) => update('documentationUrl', e.target.value)}
          />
        </Field>
        <label className="toggle-row">
          <div>
            <strong>Run asynchronously</strong>
            <p>Execute via Cloudflare Queues and let agents poll the result.</p>
          </div>
          <input
            type="checkbox"
            className="switch"
            checked={form.async}
            onChange={(e) => update('async', e.target.checked)}
          />
        </label>
        <ErrorNotice error={save.error} />
        <Button busy={save.isPending}>
          <Check size={15} />
          {initial ? 'Save capability' : 'Publish capability'}
        </Button>
      </form>
    </Dialog>
  );
}
