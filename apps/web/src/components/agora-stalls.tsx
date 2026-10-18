import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { money, type Capability } from '@capora/types';
import { useCapabilities } from '../lib/api';

// Select the reference's three stalls from the same public catalog as /marketplace.
// Missing or disabled listings stay unavailable; sample prices never replace API data.
const featured = [
  { id: 'gleif_entities', symbol: '▤', label: 'DATA · PUBLIC SOURCE' },
  { id: 'sd_repo_analysis', symbol: '⚒', label: 'AGENT · REPOSITORY ANALYSIS' },
  { id: 'code_scan', symbol: '⌘', label: 'AGENT · QUEUED' },
];

function StallDetails({ capability }: { capability: Capability }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="ag-inspect">Inspect stall ↗</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="agora-landing ag-modal-overlay" />
        <div className="agora-landing ag-modal-frame">
          <Dialog.Content className="ag-modal-card">
            <Dialog.Close className="ag-modal-close" aria-label="Close details">
              ×
            </Dialog.Close>
            <span className="ag-eyebrow">FROM THE AGORA</span>
            <Dialog.Title asChild>
              <h3>{capability.name}</h3>
            </Dialog.Title>
            <Dialog.Description asChild>
              <p>{capability.description}</p>
            </Dialog.Description>
            <div className="ag-modal-info">
              <div>
                <small>TRADE VALUE</small>
                <strong>{money(capability.priceCents)}</strong>
              </div>
              <div>
                <small>CATEGORY</small>
                <strong>{capability.type.toUpperCase()}</strong>
              </div>
              <div>
                <small>EXECUTION</small>
                <strong>{capability.async ? 'QUEUED' : 'SYNC'}</strong>
              </div>
            </div>
            <div className="ag-modal-disclaimer">
              ◈ FOR DEMONSTRATION PURPOSES ONLY. INSPECTION DOES NOT PURCHASE ACCESS.
            </div>
            <Link className="ag-btn ag-btn-primary" to={`/marketplace/${capability.id}`}>
              View capability & schema →
            </Link>
            <Dialog.Close className="ag-modal-return">Return to the agora →</Dialog.Close>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function FeaturedStalls() {
  const { data, isPending, error, refetch } = useCapabilities();
  const rail = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  function showStall(next: number) {
    const el = rail.current;
    const card = el?.children[next] as HTMLElement | undefined;
    if (!el || !card) return;
    el.scrollTo({
      left: card.offsetLeft - (el.firstElementChild as HTMLElement).offsetLeft,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
  return (
    <>
      <div
        className="ag-stalls"
        ref={rail}
        role="region"
        aria-label="Featured capability stalls"
        tabIndex={0}
        aria-busy={isPending}
        onScroll={() => {
          const el = rail.current;
          if (!el) return;
          const first = el.children[0] as HTMLElement;
          const second = el.children[1] as HTMLElement;
          const stride = second.offsetLeft - first.offsetLeft;
          if (stride) setIndex(Math.min(featured.length - 1, Math.round(el.scrollLeft / stride)));
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            showStall(
              Math.max(0, Math.min(featured.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))),
            );
          }
        }}
      >
        {featured.map((item, i) => {
          const capability = data?.find((c) => c.id === item.id && c.enabled);
          return (
            <article className="ag-stall" key={item.id}>
              <div className="ag-stall-art" aria-hidden="true">
                <div className="ag-pot" />
                <div className="ag-pot ag-right" />
                <div className="ag-artifact">{item.symbol}</div>
              </div>
              <div className="ag-stall-main">
                <div className="ag-stall-kicker">
                  <span>{item.label}</span>
                  {String(i + 1).padStart(2, '0')}
                </div>
                <h3>{capability?.name ?? (isPending ? 'Loading stall…' : 'Stall unavailable')}</h3>
                <p>
                  {capability?.description ??
                    (isPending
                      ? 'Fetching current capabilities from the agora.'
                      : 'Visit the marketplace for currently available capabilities.')}
                </p>
                <div className="ag-stall-bottom">
                  <div className="ag-stall-price">
                    {capability ? money(capability.priceCents) : '—'}
                    <small>{capability ? `sandbox / ${capability.pricingUnit}` : 'No quote available'}</small>
                  </div>
                  {capability ? (
                    <StallDetails capability={capability} />
                  ) : (
                    <Link to="/marketplace">Browse agora ↗</Link>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="ag-stall-navigation" aria-label="Browse featured stalls">
        <button
          type="button"
          aria-label="Previous stall"
          disabled={index === 0}
          onClick={() => showStall(index - 1)}
        >
          ←
        </button>
        <span aria-live="polite">
          Stall {index + 1} of {featured.length}
        </span>
        <button
          type="button"
          aria-label="Next stall"
          disabled={index === featured.length - 1}
          onClick={() => showStall(index + 1)}
        >
          →
        </button>
      </div>
      {error && (
        <p className="ag-catalog-notice" role="status">
          The catalog could not be loaded.{' '}
          <button type="button" onClick={() => void refetch()}>
            Try again
          </button>
        </p>
      )}
    </>
  );
}
