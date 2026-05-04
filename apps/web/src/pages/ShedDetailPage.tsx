import { DEFAULT_RC_KIND, type RcKind } from '@shed-remote-agent/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RcCard } from '@/components/RcCard';
import { RcKindPicker } from '@/components/RcKindPicker';
import { TmuxSessionCard } from '@/components/TmuxSessionCard';
import { Badge, Button, Card, EmptyState, PageShell, StatusPill } from '@/components/ui';
import { type APIError, api } from '@/lib/api';

export default function ShedDetailPage() {
  const { host = '', name = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const POLL_MS = 10_000;

  const shed = useQuery({
    queryKey: ['shed', host, name],
    queryFn: () => api.getShed(host, name),
    refetchInterval: POLL_MS,
  });

  const running = shed.data?.status === 'running';

  const sessions = useQuery({
    queryKey: ['sessions', host, name],
    queryFn: () => api.listSessions(host, name),
    refetchInterval: POLL_MS,
    enabled: running,
  });

  const rc = useQuery({
    queryKey: ['rc', host, name],
    queryFn: () => api.listRcSessions(host, name),
    refetchInterval: POLL_MS,
    enabled: running,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['shed', host, name] });
    qc.invalidateQueries({ queryKey: ['sessions', host, name] });
    qc.invalidateQueries({ queryKey: ['rc', host, name] });
    qc.invalidateQueries({ queryKey: ['sheds'] });
  };

  const startM = useMutation({
    mutationFn: () => api.startShed(host, name),
    onSuccess: () => {
      toast.success('Starting shed');
      invalidate();
    },
    onError: (e: APIError) => toast.error(e.message),
  });
  const stopM = useMutation({
    mutationFn: () => api.stopShed(host, name),
    onSuccess: () => {
      toast.success('Stopping shed');
      invalidate();
    },
    onError: (e: APIError) => toast.error(e.message),
  });
  const deleteM = useMutation({
    mutationFn: () => api.deleteShed(host, name),
    onSuccess: () => {
      toast.success('Shed deleted');
      qc.invalidateQueries({ queryKey: ['sheds'] });
      navigate('/');
    },
    onError: (e: APIError) => toast.error(e.message),
  });
  const [rcKind, setRcKind] = useState<RcKind>(DEFAULT_RC_KIND);
  const newRcM = useMutation({
    mutationFn: () => api.createRcSession(host, name, { kind: rcKind }),
    onSuccess: (s) => {
      toast.success(`Session ${s.slug} created`);
      qc.invalidateQueries({ queryKey: ['rc', host, name] });
      qc.invalidateQueries({ queryKey: ['sessions', host, name] });
    },
    onError: (e: APIError) => toast.error(`${e.code}: ${e.message}`),
  });

  if (shed.error) {
    return (
      <PageShell title={name}>
        <Card className="border-destructive p-4">
          <div className="font-medium text-destructive">Failed to load shed</div>
          <div className="mt-1 text-muted-foreground text-sm">{(shed.error as Error).message}</div>
          <div className="mt-4">
            <Link to="/">
              <Button variant="secondary">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
          </div>
        </Card>
      </PageShell>
    );
  }

  const s = shed.data;

  return (
    <PageShell
      title={
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="truncate">{name}</span>
          {s && <StatusPill status={s.status} />}
        </div>
      }
    >
      {shed.isLoading || !s ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">host</span>
              <Badge variant="outline" className="w-fit">
                {s.host}
              </Badge>

              {s.image && (
                <>
                  <span className="text-muted-foreground">image</span>
                  <span className="font-mono text-xs">{s.image}</span>
                </>
              )}
              {s.backend && (
                <>
                  <span className="text-muted-foreground">backend</span>
                  <span>{s.backend}</span>
                </>
              )}
              {s.repo && (
                <>
                  <span className="text-muted-foreground">repo</span>
                  <span className="break-all font-mono text-xs">{s.repo}</span>
                </>
              )}
              {s.local_dir && (
                <>
                  <span className="text-muted-foreground">local_dir</span>
                  <span className="break-all font-mono text-xs">{s.local_dir}</span>
                </>
              )}
              {s.ip_address && (
                <>
                  <span className="text-muted-foreground">ip</span>
                  <span className="font-mono text-xs">{s.ip_address}</span>
                </>
              )}
              <span className="text-muted-foreground">created</span>
              <span>{new Date(s.created_at).toLocaleString()}</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {running ? (
                <Button
                  variant="secondary"
                  disabled={stopM.isPending}
                  onClick={() => stopM.mutate()}
                >
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              ) : (
                <Button disabled={startM.isPending} onClick={() => startM.mutate()}>
                  <Play className="h-4 w-4" />
                  Start
                </Button>
              )}
              <Button
                variant="destructive"
                disabled={deleteM.isPending}
                onClick={() => {
                  if (confirm(`Delete shed "${name}"? This cannot be undone.`)) {
                    deleteM.mutate();
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </Card>

          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-sm uppercase tracking-wide">
                Remote-control sessions
              </h2>
              <Button disabled={!running || newRcM.isPending} onClick={() => newRcM.mutate()}>
                {newRcM.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                New
              </Button>
            </div>

            {running && (
              <div className="mb-3">
                <RcKindPicker value={rcKind} onChange={setRcKind} disabled={newRcM.isPending} />
              </div>
            )}

            {!running ? (
              <EmptyState
                title="Shed not running"
                description="Start the shed to create a remote-control session."
              />
            ) : rc.error ? (
              <Card className="border-destructive p-3 text-sm">
                <div className="font-medium text-destructive">Failed to list sessions</div>
                <div className="mt-1 text-muted-foreground text-xs">
                  {(rc.error as Error).message}
                </div>
              </Card>
            ) : rc.isLoading ? (
              <div className="text-muted-foreground text-sm">Loading…</div>
            ) : rc.data?.rc_sessions.length ? (
              <div className="space-y-2">
                {rc.data.rc_sessions.map((r) => (
                  <RcCard key={r.slug} s={r} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No remote-control sessions"
                description='Click "New" to bootstrap one.'
              />
            )}
          </section>

          {(() => {
            // Anything not in the curated rc list above — orphans, manually
            // started tmuxes, etc. Empty for the common case, so the whole
            // section is hidden until something actually shows up.
            const others = (sessions.data?.sessions ?? []).filter((t) => !t.is_remote_control);
            if (!running || others.length === 0) return null;
            return (
              <section className="mt-6">
                <h2 className="mb-2 font-semibold text-sm uppercase tracking-wide">
                  Other tmux sessions
                </h2>
                <div className="space-y-2">
                  {others.map((t) => (
                    <TmuxSessionCard key={t.name} host={host} shed={name} s={t} />
                  ))}
                </div>
              </section>
            );
          })()}
        </>
      )}
    </PageShell>
  );
}
