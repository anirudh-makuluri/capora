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
  LayoutGrid,
  List,
  X,
} from 'lucide-react';
import { Badge, Button, Empty, ErrorNotice, Skeleton } from '../components/ui';
import { ProviderIcon } from '../components/brand';
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
  const { data, error, isPending } = useCapabilities(params.toString());
  const { data: all } = useCapabilities();
  const capabilities = data?.filter((c) => !c.id.startsWith('bank_'));
  const categories = [...new Set(all?.filter((c) => !c.id.startsWith('bank_')).map((c) => c.category))];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE CAPABILITY ECONOMY</div>
          <h1>Marketplace</h1>
        </div>
        <Button variant="secondary" asChild>
          <Link to="/providers">
            <PlusIcon /> List a capability <ArrowUpRight size={16} />
          </Link>
        </Button>
      </div>
      <section className="catalog-section">
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
                  </div>
                  <h3>{c.name}</h3>
                  <p className="cap-description">{c.description}</p>
                  <div className="cap-category">{c.category}</div>
                  <div className="cap-metrics">
                    <span title="Reliability: measured after invocations; provider baseline before first execution">
                      <ShieldCheck size={13} />
                      <strong>
                        {c.successCount + c.failureCount || c.reliability
                          ? `${c.reliability}%`
                          : 'Unmeasured'}
                      </strong>{' '}
                      reliability
                    </span>
                    <span>
                      <Clock3 size={13} />
                      {latency(c.expectedLatencyMs)}
                    </span>
                    <span title="Capability ratings from verified usage">
                      <Star size={13} />
                      {c.reviewCount ? `${c.rating.toFixed(1)} (${c.reviewCount})` : 'Unrated'}
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
