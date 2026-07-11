import {
  authHintForKind,
  type RcKind,
  type RcSession,
  type RcState,
} from '@shed-remote-agent/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Loader2, Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { type APIError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, Card } from './ui';

const kindInfo: Record<RcKind, { label: string; tone: string }> = {
  'claude-broker': { label: 'claude-broker', tone: 'bg-ochre-soft text-ochre' },
  'claude-rc': { label: 'claude-rc', tone: 'bg-primary-soft text-primary' },
  codex: { label: 'codex', tone: 'bg-primary-soft text-primary' },
  opencode: { label: 'opencode', tone: 'bg-primary-soft text-primary' },
  cursor: { label: 'cursor', tone: 'bg-primary-soft text-primary' },
  shell: { label: 'shell', tone: 'bg-secondary text-muted-foreground' },
};

// Unknown-kind policy: a session created by a newer client carries a kind this build
// doesn't know. Render it neutrally — the raw kind label, no kind-specific styling.
function kindBadge(kind: string): { label: string; tone: string } {
  return kindInfo[kind as RcKind] ?? { label: kind, tone: 'bg-secondary text-muted-foreground' };
}

const stateInfo: Record<RcState, { label: string; tone: string; hint?: string }> = {
  starting: { label: 'starting', tone: 'bg-ochre-soft text-ochre' },
  ready: { label: 'ready', tone: 'bg-sage-soft text-sage' },
  reconnecting: {
    label: 'reconnecting',
    tone: 'bg-ochre-soft text-ochre',
  },
  'needs-trust': {
    label: 'workspace trust needed',
    tone: 'bg-ochre-soft text-ochre',
    hint: 'Open a shell: `shed attach <name>`, cd to the workdir, run `claude` once to accept the trust prompt, then create a new remote-control session.',
  },
  'needs-auth': {
    label: 'agent login needed',
    tone: 'bg-destructive/12 text-destructive',
    // hint is per-kind (authHintForKind) — composed in the component below.
  },
  dead: {
    label: 'dead',
    tone: 'bg-secondary text-faint',
    hint: 'The tmux session is gone. Delete this entry or create a new session.',
  },
};

export function RcCard({ s }: { s: RcSession }) {
  const qc = useQueryClient();
  const info = stateInfo[s.state];
  const kind = kindBadge(s.kind);
  // needs-auth remediation is per-kind (each agent logs in differently); the other
  // states keep their static hints.
  const hint =
    s.state === 'needs-auth'
      ? `Open a terminal on the ${s.target.kind === 'machine' ? 'machine' : 'shed'} and ${authHintForKind(s.kind)}, then create a new session.`
      : info.hint;

  const killM = useMutation({
    mutationFn: () => {
      if (s.target.kind === 'machine') {
        return api.killMachineRcSession(s.target.machine_name, s.slug);
      }
      return api.killRcSession(s.target.host, s.target.shed_name, s.slug);
    },
    onSuccess: () => {
      toast.success('Session killed');
      if (s.target.kind === 'machine') {
        qc.invalidateQueries({ queryKey: ['machineRc', s.target.machine_name] });
      } else {
        qc.invalidateQueries({ queryKey: ['rc', s.target.host, s.target.shed_name] });
        qc.invalidateQueries({ queryKey: ['sessions', s.target.host, s.target.shed_name] });
      }
    },
    onError: (e: APIError) => toast.error(e.message),
  });

  const terminalHref =
    s.target.kind === 'machine'
      ? `/machines/${encodeURIComponent(s.target.machine_name)}/rc/${encodeURIComponent(s.slug)}/attach`
      : `/sheds/${encodeURIComponent(s.target.host)}/${encodeURIComponent(s.target.shed_name)}/rc/${encodeURIComponent(s.slug)}/attach`;

  const [copied, setCopied] = useState(false);
  const copyUrl = async () => {
    if (!s.url) return;
    try {
      await navigator.clipboard.writeText(s.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm">{s.display_name}</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide',
                kind.tone,
              )}
            >
              {kind.label}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs',
                info.tone,
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {info.label}
            </span>
          </div>

          {s.url && (
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block break-all font-mono text-muted-foreground text-xs hover:text-foreground"
            >
              {s.url}
            </a>
          )}

          {hint && <div className="mt-2 text-muted-foreground text-xs">{hint}</div>}

          {s.error && <div className="mt-2 text-destructive text-xs">{s.error}</div>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {s.url && (
          <>
            <Button asChild>
              <a href={s.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            </Button>
            <Button variant="secondary" onClick={copyUrl}>
              <Copy className="h-4 w-4" />
              {copied ? 'Copied' : 'Copy URL'}
            </Button>
          </>
        )}
        {s.state !== 'dead' && (
          <Button asChild variant="secondary">
            <Link to={terminalHref}>
              <TerminalIcon className="h-4 w-4" />
              Terminal
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          className="ml-auto text-destructive"
          disabled={killM.isPending}
          onClick={() => {
            if (confirm(`Kill remote-control session "${s.display_name}"?`)) killM.mutate();
          }}
        >
          {killM.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Kill
        </Button>
      </div>
    </Card>
  );
}
