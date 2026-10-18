import { useEffect, useState, type ReactNode } from 'react';

// Keep the complete explanation available without pushing the five steps off a phone screen.
export function AgoraExplanation({ children }: { children: ReactNode }) {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 780px)').matches);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 780px)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return (
    <details
      className="ag-how-details"
      open={!compact || expanded}
      onToggle={(event) => {
        if (compact) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>Why capabilities matter</summary>
      {children}
    </details>
  );
}
