import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Clock3,
  Star,
  Sparkles,
  LayoutGrid,
  List,
  X,
  Terminal,
  Zap,
} from 'lucide-react';
import { Badge, Button, Empty, ErrorNotice, Skeleton } from '../components/ui';
import { NetworkArt, ProviderIcon } from '../components/brand';
import { useCapabilities, latency } from '../lib/api';
import { money, type CapabilityType } from '@capora/types';

export function Marketplace() {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('relevance');
  const [filters, setFilters] = useState(false);
  const [maxPrice, setMaxPrice] = useState('');
  const [minReliability, setMinReliability] = useState('');
  const [view, setView] = useState('grid');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);
  const params = new URLSearchParams({ query: deferred, sort });
  if (type) params.set('type', type);
  if (category) params.set('category', category);
  if (maxPrice) params.set('max_budget', maxPrice);
  if (minReliability) params.set('min_reliability', minReliability);
  const { data: capabilities, error, isPending } = useCapabilities(params.toString());
  const { data: all } = useCapabilities();
  const categories = [...new Set(all?.map((c) => c.category))];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE CAPABILITY ECONOMY</div>
          <h1>Marketplace</h1>
          <p>Give your agents access to what they can’t do alone.</p>
        </div>
        <Button variant="secondary" asChild>
          <Link to="/providers">
            <PlusIcon /> List a capability <ArrowUpRight size={16} />
          </Link>
        </Button>
      </div>
      <section className="market-hero">
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <span className="tiny-orbit" /> INTELLIGENCE HAS NO CEILING
          </div>
          <h2>
            Let agents acquire
            <br />
            what they need<span>.</span>
          </h2>
          <p>
            Proprietary data. Powerful APIs. Specialized tools.
            <br />
            One marketplace. One MCP connection.
          </p>
          <Link to="/demo" className="hero-link">
            See an agent in action <ArrowRight size={17} />
          </Link>
        </div>
        <div className="hero-visual">
          <NetworkArt />
          <span className="hero-diagram-caption">
            <span /> DISCOVER <i>→</i> PURCHASE <i>→</i> EXECUTE
          </span>
        </div>
      </section>
      <div className="market-trust">
        <span>
          <Terminal size={15} /> MCP-native by design
        </span>
        <span>
          <ShieldCheck size={15} /> Human-controlled spending
        </span>
        <span>
          <Zap size={15} /> On-demand execution
        </span>
        <span className="trust-paypal">
          Payments via{' '}
          <strong>
            <i>PayPal</i>
          </strong>
          <Badge>Sandbox</Badge>
        </span>
      </div>
      <section className="catalog-section">
        <div className="section-heading">
          <div>
            <h2>Find your next capability</h2>
            <p>Real access. Clear pricing. Built for autonomous work.</p>
          </div>
          <span className="catalog-count">
            {all?.length ?? '—'} capabilities available <span className="status-dot" />
          </span>
        </div>
        <div className="search-toolbar">
          <div className="search-field">
            <Search size={19} />
            <input
              ref={searchRef}
              aria-label="Search capabilities"
              placeholder="Search capabilities, providers, or a task you need done…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={15} />
              </button>
            )}
            <kbd>⌘ K</kbd>
          </div>
          <Button
            variant="secondary"
            className={filters ? 'selected-filter' : ''}
            onClick={() => setFilters(!filters)}
          >
            <SlidersHorizontal size={16} />
            Filters{(category || maxPrice || minReliability) && <span className="filter-active-dot" />}
          </Button>
        </div>
        {filters && (
          <div className="filter-panel">
            <label>
              Category
              <select
                aria-label="Filter category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Maximum price ($)
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="Any price"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
            </label>
            <label>
              Minimum reliability
              <select value={minReliability} onChange={(e) => setMinReliability(e.target.value)}>
                <option value="">Any reliability</option>
                <option value="95">95% and above</option>
                <option value="99">99% and above</option>
              </select>
            </label>
            <Button
              variant="ghost"
              onClick={() => {
                setCategory('');
                setMaxPrice('');
                setMinReliability('');
              }}
            >
              Reset
            </Button>
          </div>
        )}
        <div className="catalog-controls">
          <div className="type-tabs" role="tablist" aria-label="Capability type">
            {[
              ['', 'All capabilities'],
              ['api', 'APIs'],
              ['dataset', 'Datasets'],
              ['agent', 'Agents'],
            ].map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={type === value}
                onClick={() => setType(value)}
                className={type === value ? 'active' : ''}
              >
                {label}
                {value === '' && <span>{capabilities?.length ?? 0}</span>}
              </button>
            ))}
          </div>
          <div className="sort-controls">
            <span>Sort by</span>
            <select aria-label="Sort capabilities" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="relevance">Recommended</option>
              <option value="price">Lowest price</option>
              <option value="reliability">Reliability</option>
              <option value="reputation">Reputation</option>
              <option value="latency">Fastest execution</option>
            </select>
            <div className="view-toggle">
              <button
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                className={view === 'grid' ? 'active' : ''}
                onClick={() => setView('grid')}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                aria-label="List view"
                aria-pressed={view === 'list'}
                className={view === 'list' ? 'active' : ''}
                onClick={() => setView('list')}
              >
                <List size={17} />
              </button>
            </div>
          </div>
        </div>
        <ErrorNotice error={error} />
        <div className={`capability-grid ${view === 'list' ? 'capability-list' : ''}`}>
          {isPending
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="card-skeleton" />)
            : capabilities?.map((c) => (
                <Link to={`/marketplace/${c.id}`} className="capability-card" key={c.id}>
                  <div className="cap-card-top">
                    <ProviderIcon capability={c} />
                    <Badge tone={c.type === 'agent' ? 'amber' : c.type === 'dataset' ? 'blue' : 'neutral'}>
                      {typeLabel(c.type)}
                    </Badge>
                    <ArrowUpRight size={17} className="card-open-icon" />
                  </div>
                  <div className="provider-line">
                    {c.provider}
                    <ShieldCheck size={12} />
                    {c.id === 'datapulse_headcount' && <span className="popular-label">POPULAR</span>}
                  </div>
                  <h3>{c.name}</h3>
                  <p className="cap-description">{c.description}</p>
                  <div className="cap-category">{c.category}</div>
                  <div className="cap-metrics">
                    <span title="Reliability: measured after invocations; provider baseline before first execution">
                      <ShieldCheck size={13} />
                      <strong>{c.reliability}%</strong> reliability
                    </span>
                    <span>
                      <Clock3 size={13} />
                      {latency(c.expectedLatencyMs)}
                    </span>
                    <span>
                      <Star size={13} />
                      {c.reputation.toFixed(1)}
                    </span>
                  </div>
                  <div className="cap-price-row">
                    <div>
                      <strong>{money(c.priceCents)}</strong>
                      <span> / {c.pricingUnit}</span>
                    </div>
                    <span className="card-action">
                      View capability <ArrowRight size={14} />
                    </span>
                  </div>
                </Link>
              ))}
        </div>
        {!isPending && !capabilities?.length && (
          <Empty icon={<Search size={25} />} title="No capabilities match that search">
            <p>Try a broader task or adjust your filters.</p>
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setType('');
                setCategory('');
                setMaxPrice('');
                setMinReliability('');
              }}
            >
              Clear filters
            </Button>
          </Empty>
        )}
        <div className="catalog-note">
          <Sparkles size={15} />
          <p>Your agent’s next breakthrough could be one capability away.</p>
          <Link to="/developers">
            Explore the MCP tools <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </>
  );
}
function PlusIcon() {
  return <span className="plus-text">+</span>;
}
export function typeLabel(type: CapabilityType) {
  return type === 'api' ? 'API' : type === 'dataset' ? 'Dataset' : 'Agent';
}
