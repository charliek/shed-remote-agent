import type { RcSession, RcState } from '@shed-remote-agent/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { type APIError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, Card } from './ui';

const stateInfo: Record<RcState, { label: string; tone: string; hint?: string }> = {
  starting: { label: 'starting', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  ready: { label: 'ready', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  reconnecting: {
    label: 'reconnecting',
    tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  },
  'needs-trust': {
    label: 'workspace trust needed',
    tone: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
    hint: 'Open a shell: `shed attach <name>`, cd to the workdir, run `claude` once to accept the trust prompt, then create a new remote-control session.',
  },
  'needs-auth': {
    label: 'claude auth needed',
    tone: 'bg-destructive/15 text-destructive',
    hint: 'Open a shell: `shed attach <name>` and run `claude auth login` in the shed before creating a session.',
  },
  dead: {
    label: 'dead',
    tone: 'bg-muted text-muted-foreground',
    hint: 'The tmux session is gone. Delete this entry or create a new session.',
  },
};

export function RcCard({ s }: { s: RcSession }) {
  const qc = useQueryClient();
  const info = stateInfo[s.state];

  const killM = useMutation({
    mutationFn: () => api.killRcSession(s.host, s.shed_name, s.slug),
    onSuccess: () => {
      toast.success('Session killed');
      qc.invalidateQueries({ queryKey: ['rc', s.host, s.shed_name] });
      qc.invalidateQueries({ queryKey: ['sessions', s.host, s.shed_name] });
    },
    onError: (e: APIError) => toast.error(e.message),
  });

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
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm">{s.display_name}</span>
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
            <div className="mt-2 break-all font-mono text-muted-foreground text-xs">{s.url}</div>
          )}

          {info.hint && <div className="mt-2 text-muted-foreground text-xs">{info.hint}</div>}

          {s.error && <div className="mt-2 text-destructive text-xs">{s.error}</div>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {s.url && (
          <>
            <a href={s.url} target="_blank" rel="noreferrer" className="contents">
              <Button>
                <ExternalLink className="h-4 w-4" />
                Open
              </Button>
            </a>
            <Button variant="secondary" onClick={copyUrl}>
              <Copy className="h-4 w-4" />
              {copied ? 'Copied' : 'Copy URL'}
            </Button>
          </>
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
