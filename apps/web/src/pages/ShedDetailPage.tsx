import { DEFAULT_RC_KIND, type RcKind } from '@shed-remote-agent/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Play, Plus, Square, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RcCard } from '@/components/RcCard';
import { RcKindPicker } from '@/components/RcKindPicker';
import { TmuxSessionCard } from '@/components/TmuxSessionCard';
import { Badge, Button, Card, EmptyState, PageShell, StatusPill } from '@/components/ui';
import { type APIError, api } from '@/lib/api';
import { toastForRcCreate } from '@/lib/rcCreateToast';

const SHED_ALLOWED_KINDS: RcKind[] = ['repl', 'shell'];

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
  const [rcKind, setRcKind] = useState<RcKind>(
    SHED_ALLOWED_KINDS.includes(DEFAULT_RC_KIND) ? DEFAULT_RC_KIND : SHED_ALLOWED_KINDS[0],
  );
  const [displayName, setDisplayName] = useState('');
  const [showNewSession, setShowNewSession] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const closeNewSession = () => {
    setShowNewSession(false);
    setDisplayName('');
  };
  // Focus the name field when the form is revealed.
  useEffect(() => {
    if (showNewSession) nameInputRef.current?.focus();
  }, [showNewSession]);
  // Reset the inline create form when the route switches to a different shed —
  // react-router reuses this component instance across :host/:name changes, so
  // without this an open form / typed name would leak across navigations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on route change; setters are stable
  useEffect(() => {
    setShowNewSession(false);
    setDisplayName('');
  }, [host, name]);
  const newRcM = useMutation({
    mutationFn: () =>
      api.createRcSession(host, name, {
        kind: rcKind,
        display_name: displayName.trim() || undefined,
      }),
    onSuccess: (s) => {
      toastForRcCreate(s);
      setShowNewSession(false);
      setDisplayName('');
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
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-bold text-faint text-xs uppercase tracking-wider">
                Remote-control sessions
              </h2>
              {running && !showNewSession && (rc.data?.rc_sessions.length ?? 0) > 0 && (
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => setShowNewSession(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New session
                </Button>
              )}
            </div>

            {running && showNewSession && (
              <Card className="mb-3 animate-rise space-y-3 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">New session</h3>
                  <button
                    type="button"
                    onClick={closeNewSession}
                    aria-label="Cancel"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="rc-display-name"
                    className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
                  >
                    Session name
                  </label>
                  <input
                    id="rc-display-name"
                    ref={nameInputRef}
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') closeNewSession();
                    }}
                    placeholder={`${name}/<slug>`}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={newRcM.isPending}
                  />
                </div>
                <div className="space-y-1">
                  <span className="block font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Kind
                  </span>
                  <RcKindPicker
                    value={rcKind}
                    onChange={setRcKind}
                    disabled={newRcM.isPending}
                    allowedKinds={SHED_ALLOWED_KINDS}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={closeNewSession} disabled={newRcM.isPending}>
                    Cancel
                  </Button>
                  <Button disabled={newRcM.isPending} onClick={() => newRcM.mutate()}>
                    {newRcM.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Create
                  </Button>
                </div>
              </Card>
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
            ) : showNewSession ? null : (
              <EmptyState
                title="No remote-control sessions yet"
                description="Spin up a remote-control session to get started."
                action={
                  <Button onClick={() => setShowNewSession(true)}>
                    <Plus className="h-4 w-4" />
                    New session
                  </Button>
                }
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
