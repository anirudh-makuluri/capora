import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, ShieldCheck, Trash2, RotateCcw } from 'lucide-react';
import {
  money,
  type AdminProvider,
  type ManagedCapability,
  type ProviderHostSettings,
  type MarketplaceFeeSettings,
} from '@capora/types';
import { api, useAction, useSession, time } from '../lib/api';
import { Badge, Button, Dialog, Empty, ErrorNotice, Field, Skeleton } from '../components/ui';
import { CapabilityForm } from './providers';
import './admin.css';

export function Admin() {
  const { data: session } = useSession();
  return session?.isAdmin ? (
    <AdminDashboard />
  ) : (
    <Empty icon={<ShieldCheck size={28} />} title="Admin access required">
      <p>Sign in with an account approved by the Capora operator.</p>
      <Link className="text-link" to="/marketplace">
        Back to marketplace
      </Link>
    </Empty>
  );
}

function AdminDashboard() {
  const fee = useQuery({
    queryKey: ['admin', 'marketplace-fee'],
    queryFn: () => api<MarketplaceFeeSettings>('/admin/marketplace-fee'),
    refetchOnWindowFocus: false,
  });
  const hosts = useQuery({
    queryKey: ['admin', 'hosts'],
    queryFn: () => api<ProviderHostSettings>('/admin/provider-hosts'),
    refetchOnWindowFocus: false,
  });
  const caps = useQuery({
    queryKey: ['admin', 'capabilities'],
    queryFn: () => api<ManagedCapability[]>('/admin/capabilities'),
  });
  const providers = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: () => api<AdminProvider[]>('/admin/providers'),
  });
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [remove, setRemove] = useState<ManagedCapability>();
  const [message, setMessage] = useState('');
  const change = useAction(
    async ({ capability, restore }: { capability: ManagedCapability; restore: boolean }) => {
      await api(`/admin/capabilities/${capability.id}${restore ? '/restore' : ''}`, {
        method: restore ? 'POST' : 'DELETE',
        body: {},
      });
      setRemove(undefined);
      setMessage(`${capability.name} ${restore ? 'restored' : 'removed'}.`);
    },
  );
  const rows =
    caps.data?.filter((cap) =>
      `${cap.name} ${cap.provider} ${cap.id}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MARKETPLACE ADMINISTRATION</div>
          <h1>Admin dashboard</h1>
          <p>Set marketplace fees, approve provider hosts and manage capabilities.</p>
        </div>
        <Badge tone="green">
          <ShieldCheck size={14} /> Operator access
        </Badge>
      </div>
      <ErrorNotice error={fee.error ?? hosts.error ?? caps.error ?? providers.error} />
      {fee.isPending && <Skeleton className="detail-skeleton" />}
      {fee.data && <FeeEditor settings={fee.data} />}
      {hosts.isPending && <Skeleton className="detail-skeleton" />}
      {hosts.data && <HostEditor key={hosts.data.revision} settings={hosts.data} />}
      <section className="panel admin-catalog">
        <div className="panel-heading">
          <div>
            <h2>Capabilities</h2>
            <p className="muted">
              {caps.data?.filter((c) => !c.removedAt && c.enabled).length ?? 0} published ·{' '}
              {caps.data?.filter((c) => c.removedAt).length ?? 0} removed
            </p>
          </div>
          <Button onClick={() => setCreate(true)} disabled={!providers.data?.length}>
            <Plus size={16} /> Add capability
          </Button>
        </div>
        {providers.data?.length === 0 && (
          <p className="panel-padding muted">
            Create a provider in the{' '}
            <Link className="text-link" to="/providers">
              Provider console
            </Link>{' '}
            before adding a capability.
          </p>
        )}
        <div className="admin-search">
          <Search size={17} />
          <input
            aria-label="Search managed capabilities"
            placeholder="Search capabilities or providers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="admin-feedback" role="status">
          {message}
        </div>
        <ErrorNotice error={change.error} />
        {caps.isPending ? (
          <Skeleton className="detail-skeleton" />
        ) : (
          <div className="table-scroll">
            <table className="transactions-table admin-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Endpoint</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((cap) => (
                  <tr key={cap.id}>
                    <td>
                      <strong>{cap.name}</strong>
                      <small className="payment-kind">
                        {cap.provider} · v{cap.version}
                      </small>
                    </td>
                    <td>
                      <span className="admin-endpoint" title={cap.endpoint}>
                        {cap.endpoint}
                      </span>
                    </td>
                    <td>
                      {money(cap.priceCents)}
                      <small className="payment-kind">per {cap.pricingUnit}</small>
                    </td>
                    <td>
                      <Badge tone={cap.removedAt ? 'red' : cap.enabled ? 'green' : 'neutral'}>
                        {cap.removedAt ? 'Removed' : cap.enabled ? 'Published' : 'Disabled'}
                      </Badge>
                    </td>
                    <td>
                      {cap.removedAt ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          busy={change.isPending}
                          onClick={() => change.mutate({ capability: cap, restore: true })}
                        >
                          <RotateCcw size={14} /> Restore
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={change.isPending}
                          onClick={() => {
                            change.reset();
                            setRemove(cap);
                          }}
                        >
                          <Trash2 size={14} /> Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <Empty icon={<Search size={24} />} title="No capabilities found">
                <p>Try another search or add a capability.</p>
              </Empty>
            )}
          </div>
        )}
        <div className="table-footer">
          Removed capabilities stay in the audit history and cannot be republished by providers.
        </div>
      </section>
      {create && providers.data && (
        <CapabilityForm
          adminProviders={providers.data.map((p) => ({ id: p.id, name: `${p.name} · ${p.ownerName}` }))}
          onClose={() => setCreate(false)}
        />
      )}
      <Dialog
        open={Boolean(remove)}
        onOpenChange={(open) => {
          if (!open) setRemove(undefined);
        }}
        title="Remove capability?"
        description="This takes the capability out of the marketplace and blocks new purchases and execution. Existing records are retained."
      >
        <div className="dialog-body">
          <strong>{remove?.name}</strong>
          <p>
            Paid purchases that have not executed may need operator support. Removal does not issue a refund.
          </p>
          <ErrorNotice error={change.error} />
          <div className="action-row">
            <Button variant="secondary" onClick={() => setRemove(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              busy={change.isPending}
              onClick={() => remove && change.mutate({ capability: remove, restore: false })}
            >
              Remove capability
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function FeeEditor({ settings }: { settings: MarketplaceFeeSettings }) {
  // Keep the loaded revision with the draft. Background query updates must not
  // authorize overwriting a change made by another admin while this form is open.
  const [snapshot, setSnapshot] = useState(settings);
  const [value, setValue] = useState(String(settings.feeBps / 100));
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const percent = Number(value);
  const valid = /^\d+(\.\d{1,2})?$/.test(value) && percent >= 0 && percent <= 10;
  const feeBps = Math.round(percent * 100);
  const dirty = valid && (snapshot.source !== 'dashboard' || feeBps !== snapshot.feeBps);
  const apply = (updated: MarketplaceFeeSettings) => {
    client.setQueryData(['admin', 'marketplace-fee'], updated);
    setSnapshot(updated);
    setValue(String(updated.feeBps / 100));
  };
  const save = useAction(async () => {
    const updated = await api<MarketplaceFeeSettings>('/admin/marketplace-fee', {
      method: 'PUT',
      body: { feeBps, revision: snapshot.revision },
    });
    apply(updated);
    setSaved(true);
  });
  const reload = useAction(async () => {
    apply(await api<MarketplaceFeeSettings>('/admin/marketplace-fee'));
    save.reset();
    setSaved(false);
  });
  const busy = save.isPending || reload.isPending;
  return (
    <section className="panel admin-hosts admin-fees" aria-labelledby="marketplace-fee-heading">
      <div className="panel-heading">
        <div>
          <h2 id="marketplace-fee-heading">Marketplace transaction fee</h2>
          <p className="muted">Applies to new quotes for user-created capabilities.</p>
        </div>
        <Badge>{snapshot.feeBps / 100}% current fee</Badge>
      </div>
      <form
        className="panel-padding"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && dirty && !busy) save.mutate(undefined);
        }}
      >
        <Field
          label="Marketplace fee (%)"
          hint="Enter 0–10%, with up to two decimal places. Set 0 to waive the fee."
        >
          <input
            type="number"
            min="0"
            max="10"
            step="0.01"
            required
            value={value}
            disabled={busy}
            aria-invalid={!valid}
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <p className="muted admin-host-note">
          Capora Bank-owned capabilities remain fee-free. Existing quotes and escrow payments keep their
          original rate.
        </p>
        <ErrorNotice error={save.error ?? reload.error} />
        <div className="admin-host-footer">
          <span className="muted">
            {snapshot.source === 'dashboard'
              ? `Saved ${snapshot.updatedAt ? time(snapshot.updatedAt) : ''} · persists across deployments`
              : snapshot.source === 'environment'
                ? 'Using the deployment configuration until the first save.'
                : 'Using the default fee until the first save.'}
          </span>
          <div className="action-row">
            <Button
              type="button"
              variant="secondary"
              busy={reload.isPending}
              disabled={busy}
              onClick={() => reload.mutate(undefined)}
            >
              Reload fee
            </Button>
            <Button busy={save.isPending} disabled={!dirty || busy}>
              Save fee
            </Button>
          </div>
        </div>
        <div role="status">{saved && 'Marketplace fee saved. New quotes use this rate.'}</div>
      </form>
    </section>
  );
}

function HostEditor({ settings }: { settings: ProviderHostSettings }) {
  const [value, setValue] = useState(settings.hosts.join('\n'));
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const hosts = [
    ...new Set(
      value
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((host) => host.toLowerCase()),
    ),
  ].sort();
  const removed = settings.hosts.filter((host) => !hosts.includes(host));
  const dirty =
    settings.source === 'environment' || JSON.stringify(hosts) !== JSON.stringify([...settings.hosts].sort());
  const save = useAction(async () => {
    const updated = await api<ProviderHostSettings>('/admin/provider-hosts', {
      method: 'PUT',
      body: { hosts, revision: settings.revision },
    });
    client.setQueryData(['admin', 'hosts'], updated);
    return updated;
  });
  return (
    <section className="panel admin-hosts">
      <div className="panel-heading">
        <div>
          <h2>Approved provider hostnames</h2>
          <p className="muted">Changes apply to registration and execution immediately.</p>
        </div>
        <Badge>{settings.hosts.length} approved</Badge>
      </div>
      <form
        className="panel-padding"
        onSubmit={(event) => {
          event.preventDefault();
          if (removed.length) setConfirm(true);
          else save.mutate(undefined, { onSuccess: () => setSaved(true) });
        }}
      >
        <Field
          label="Provider hostnames"
          hint="One exact public hostname per line, for example api.yourcompany.com. No URLs, paths, wildcards, ports or IP addresses."
        >
          <textarea
            aria-label="Provider hostnames"
            rows={5}
            value={value}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
            placeholder="api.yourcompany.com"
          />
        </Field>
        <p className="muted admin-host-note">
          An empty list blocks all external provider endpoints. Built-in tools and owned datasets continue to
          work.
        </p>
        <ErrorNotice error={save.error} />
        <div className="admin-host-footer">
          <span className="muted">
            {settings.source === 'environment'
              ? 'Using the deployment configuration until the first save.'
              : `Saved ${settings.updatedAt ? time(settings.updatedAt) : ''} · persists across deployments`}
          </span>
          <div className="action-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setValue(settings.hosts.join('\n'));
                void client.invalidateQueries({ queryKey: ['admin', 'hosts'] });
              }}
            >
              Reload list
            </Button>
            <Button busy={save.isPending} disabled={!dirty}>
              Save hostnames
            </Button>
          </div>
        </div>
        <div role="status">{saved && 'Approved hostnames saved.'}</div>
      </form>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Revoke provider hostnames?"
        description="Capabilities on these hosts will fail validation until the hosts are approved again."
      >
        <div className="dialog-body">
          <ul>
            {removed.map((host) => (
              <li key={host}>{host}</li>
            ))}
          </ul>
          <ErrorNotice error={save.error} />
          <Button
            variant="destructive"
            busy={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  setConfirm(false);
                  setSaved(true);
                },
              })
            }
          >
            Revoke and save
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
