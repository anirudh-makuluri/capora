import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, ErrorNotice } from './ui';
import { connectionPrompt } from '../lib/connect-prompt';

export function ConnectPrompt() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>();
  const prompt = connectionPrompt(window.location.origin);
  return (
    <div className="connect-prompt">
      <h3>Start with a prompt.</h3>
      <p>
        Paste this into your coding agent. It will ask for your agent’s name, daily budget, auto-approval
        threshold and maximum per purchase, then guide you through account authorization.
      </p>
      <Button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setError(undefined);
          } catch {
            setError(new Error('Could not copy. Expand the prompt below and copy it manually.'));
          }
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? 'Prompt copied' : 'Copy setup prompt'}
      </Button>
      <ErrorNotice error={error} />
      <details>
        <summary>Read setup prompt</summary>
        <pre>{prompt}</pre>
      </details>
      <p className="muted">
        No existing agent token needed. Sign in once to authorize the connection. Works with coding agents
        that can run local commands and configure MCP.
      </p>
    </div>
  );
}
