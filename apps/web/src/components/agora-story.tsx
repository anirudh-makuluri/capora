import { useEffect, useState, type RefObject } from 'react';
import { AgoraArt } from './agora-art';

export const tradeSteps = [
  {
    title: 'Discover',
    description: "The agent searches for something it doesn't have.",
    caption: 'The agent walks into the agora.',
  },
  {
    title: 'Compare',
    description: 'It weighs the provider, schema, quote, and tradeoffs.',
    caption: 'The merchant offers a capability scroll.',
  },
  {
    title: 'Request',
    description: 'Capora validates the quote and spending policy.',
    caption: 'The buyer inspects its new power.',
  },
  {
    title: 'Purchase',
    description: 'A sandbox payment proceeds or waits for approval.',
    caption: 'Coins change hands. Trade approved!',
  },
  {
    title: 'Acquire',
    description: 'The capability runs and the result returns to the task.',
    caption: 'CAPABILITY ACQUIRED! LEVEL UP!',
  },
];

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function AgoraStory({
  phase,
  epoch,
  playing,
  reducedMotion,
  sceneRef,
  onReplay,
  onSelect,
  onToggle,
}: {
  phase: number;
  epoch: number;
  playing: boolean;
  reducedMotion: boolean;
  sceneRef: RefObject<HTMLDivElement | null>;
  onReplay: () => void;
  onSelect: (phase: number) => void;
  onToggle: () => void;
}) {
  return (
    <div className="ag-hero-scene">
      <div
        ref={sceneRef}
        className={`ag-game ag-phase-${phase}`}
        id="game"
        role="group"
        aria-label="Five-step animated pixel-art trade between a robot and human merchant in an ancient Greek agora."
      >
        <AgoraArt key={epoch} />
        <div className="ag-game-tag">◈ AGORA / MARKET SQUARE</div>
        <div className="ag-game-tag ag-game-sandbox">● SANDBOX TRADE</div>
        <div className="ag-dialogue" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
          <small>{String(phase + 1).padStart(2, '0')} / 05</small>
          <strong>{tradeSteps[phase].caption}</strong>
          <button type="button" onClick={onReplay} aria-label="Replay animation" title="Replay">
            ↻
          </button>
        </div>
      </div>
      <div className="ag-game-foot">
        <div className="ag-dots" role="group" aria-label="Trade steps">
          {tradeSteps.map((step, i) => (
            <button
              type="button"
              key={step.title}
              aria-label={`Trade step ${i + 1}`}
              aria-current={phase === i ? 'step' : undefined}
              className={phase === i ? 'ag-active' : undefined}
              onClick={() => onSelect(i)}
            />
          ))}
        </div>
      </div>
      {!reducedMotion && (
        <button type="button" className="ag-playback" onClick={onToggle}>
          {playing ? 'Pause animation Ⅱ' : 'Play animation ▶'}
        </button>
      )}
    </div>
  );
}
