import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AgoraStory, tradeSteps, useReducedMotion } from '../components/agora-story';
import { FeaturedStalls } from '../components/agora-stalls';
import { AgoraExplanation } from '../components/agora-explanation';
import './landing.css';
import './landing-hero.css';
import './landing-sections.css';

export function Landing() {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [motionPaused, setMotionPaused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = window.setInterval(() => setPhase((p) => (p + 1) % 5), 3200);
    return () => window.clearInterval(timer);
  }, [playing, reducedMotion, epoch]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  function replay() {
    setMotionPaused(false);
    setPhase(0);
    setEpoch((e) => e + 1);
    setPlaying(!reducedMotion);
  }
  function selectPhase(next: number) {
    setMotionPaused(false);
    setPlaying(false);
    setPhase(next);
  }
  function scrollToStory() {
    sceneRef.current?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center' });
  }
  function showTrade() {
    scrollToStory();
    replay();
  }
  return (
    <div className={`agora-landing ${motionPaused ? 'ag-motion-paused' : ''}`}>
      <a className="ag-skip" href="#top">
        Skip to content
      </a>

      <header>
        <div className="ag-wrap ag-top">
          <a className="ag-logo" href="#top" aria-label="Capora home">
            <span className="ag-logo-mark" aria-hidden="true">
              ‹
            </span>
            Capora<span className="ag-dot">.</span>
          </a>
          <nav
            id="agora-nav"
            className={menuOpen ? 'ag-open' : undefined}
            aria-label="Main navigation"
            onClick={() => setMenuOpen(false)}
          >
            <a href="#stalls">The marketplace</a>
            <a href="#how">How trade works</a>
            <a href="#guard">For humans</a>
            <Link className="ag-mobile-workspace" to="/overview">
              Open workspace ↗
            </Link>
          </nav>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            <Link className="ag-btn ag-btn-dark" to="/overview">
              Open workspace ↗
            </Link>
            <button
              className="ag-menu"
              ref={menuRef}
              id="agora-menu"
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
              aria-controls="agora-nav"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ☰
            </button>
          </div>
        </div>
      </header>
      <main id="top" tabIndex={-1}>
        <section className="ag-hero">
          <div className="ag-wrap ag-hero-grid">
            <div className="ag-hero-copy">
              <div className="ag-badge">
                <span className="ag-blink"></span> ANCIENT COMMERCE. NEW INTELLIGENCE.
              </div>
              <h1>
                An ancient idea.<em>A new kind of buyer.</em>
              </h1>
              <p>
                Welcome to Capora—the agora where AI agents discover, purchase, and acquire the capabilities
                they don't already possess.
              </p>
              <div className="ag-hero-actions">
                <Link className="ag-btn ag-btn-primary" to="/marketplace">
                  Explore the agora →
                </Link>
                <button className="ag-btn ag-btn-soft" id="watch" onClick={showTrade}>
                  ▶ Watch a trade
                </button>
              </div>
              <div className="ag-hero-proof">
                <span>ONE MCP CONNECTION</span>
                <span>HUMAN-SET BUDGETS</span>
                <span>PAYPAL SANDBOX</span>
              </div>
              <div className="ag-tiny-note">✦ FOR DEMONSTRATION PURPOSES ONLY</div>
            </div>
            <AgoraStory
              phase={phase}
              epoch={epoch}
              playing={playing}
              reducedMotion={reducedMotion}
              sceneRef={sceneRef}
              onReplay={replay}
              onSelect={selectPhase}
              onToggle={() => {
                setMotionPaused(playing);
                setPlaying(!playing);
              }}
            />
          </div>
        </section>
        <div className="ag-ticker" aria-hidden="true">
          <div className="ag-ticker-track">
            <span>DISCOVER</span>
            <b>✦</b>
            <span>COMPARE</span>
            <b>✦</b>
            <span>PURCHASE</span>
            <b>✦</b>
            <span>ACQUIRE</span>
            <b>✦</b>
            <span>DISCOVER</span>
            <b>✦</b>
            <span>COMPARE</span>
            <b>✦</b>
            <span>PURCHASE</span>
            <b>✦</b>
            <span>ACQUIRE</span>
            <b>✦</b>
          </div>
        </div>
        <section className="ag-section ag-stalls-section" id="stalls">
          <div className="ag-wrap">
            <div className="ag-section-head">
              <div>
                <span className="ag-eyebrow">THE AGORA IS OPEN</span>
                <h2>
                  Every stall holds
                  <br />a new possibility.
                </h2>
              </div>
              <p>
                Not imaginary personalities. Real data sources, APIs, and specialized tools—each with
                something valuable behind the counter.
              </p>
            </div>
            <FeaturedStalls />
          </div>
        </section>
        <section className="ag-section" id="how">
          <div className="ag-wrap ag-how-grid">
            <div className="ag-ledger">
              <div className="ag-ledger-label">✦ A RECORD OF ONE TRANSACTION</div>
              {tradeSteps.map((step, i) => (
                <button
                  type="button"
                  className={`ag-ledger-step ${phase === i ? 'ag-active' : ''}`}
                  key={step.title}
                  onClick={() => {
                    selectPhase(i);
                    scrollToStory();
                  }}
                  aria-current={phase === i ? 'step' : undefined}
                >
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.description}</p>
                  </div>
                </button>
              ))}
              <div className="ag-ledger-end">✓ ONE CONNECTION. A COMPLETE AUDIT TRAIL.</div>
            </div>
            <div className="ag-how-copy">
              <span className="ag-eyebrow">ONE CONNECTION. NEW POWERS.</span>
              <h2>A little more than a prompt can provide.</h2>
              <AgoraExplanation>
                <p>
                  Your agent is intelligent. But intelligence alone cannot conjure private credentials,
                  source-backed data, or specialized tools it doesn't already possess.
                </p>
                <div className="ag-stroke"></div>
                <div className="ag-how-note">MCP-NATIVE → POLICY-CHECKED → AUDITABLE</div>
                <p>
                  The buyer stays in its own workflow. Capora brokers the capability, secures the access, and
                  records the trade.
                </p>
                <a className="ag-btn ag-btn-soft" href="#guard">
                  See the human guardrails →
                </a>
              </AgoraExplanation>
            </div>
          </div>
        </section>
        <section className="ag-section ag-guard" id="guard">
          <div className="ag-wrap ag-guard-grid">
            <div>
              <span className="ag-eyebrow">POWER, WITH PERMISSION</span>
              <h2>The agent can trade. You hold the purse.</h2>
              <p>
                Give agents room to act within limits you control. A small purchase can happen automatically;
                a larger one waits for its human.
              </p>
              <div className="ag-guard-points">
                <span>DAILY BUDGETS</span>
                <span>PER-PURCHASE CEILINGS</span>
                <span>HUMAN APPROVALS & AUDIT HISTORY</span>
              </div>
            </div>
            <div className="ag-decree">
              <div className="ag-decree-top">
                SPENDING DECREE <span className="ag-stamp">OWNER SET</span>
              </div>
              <div className="ag-decree-row">
                <span>DAILY TREASURY</span>
                <strong>$25.00</strong>
              </div>
              <div className="ag-decree-row">
                <span>AUTO-APPROVE</span>
                <strong>≤ $0.50</strong>
              </div>
              <div className="ag-decree-row">
                <span>PER TRADE LIMIT</span>
                <strong>$10.00</strong>
              </div>
              <div className="ag-decree-foot">
                <span>◈ EXAMPLE POLICY · SET YOUR OWN</span>
                <b>● DEMO</b>
              </div>
            </div>
          </div>
        </section>
        <section className="ag-end">
          <div className="ag-wrap">
            <span className="ag-eyebrow" style={{ justifyContent: 'center' }}>
              YOUR NEXT QUEST AWAITS
            </span>
            <h2>
              The agora never
              <br />
              stops trading.
            </h2>
            <p>
              One connection to a growing world of capabilities. Your agent brings the reasoning; the
              marketplace brings the rest.
            </p>
            <div className="ag-end-actions">
              <Link className="ag-btn ag-btn-primary" to="/developers">
                Connect your agent ↗
              </Link>
              <button className="ag-btn ag-btn-soft" id="again" onClick={showTrade}>
                Replay the story ↻
              </button>
            </div>
            <small>CAPABILITIES FOR DEMONSTRATION PURPOSES ONLY</small>
          </div>
        </section>
      </main>
      <footer>
        <div className="ag-wrap ag-foot">
          <a href="#top" className="ag-logo">
            <span className="ag-logo-mark">‹</span>Capora<span className="ag-dot">.</span>
          </a>
          <p>Capability + Agora. An ancient idea, built for what comes next.</p>
          <a href="#top">BACK TO TOP ↑</a>
        </div>
      </footer>
    </div>
  );
}
