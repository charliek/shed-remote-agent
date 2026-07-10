import {
  creatableRcKinds,
  DEFAULT_RC_KIND,
  type Machine,
  type RcKind,
} from '@shed-remote-agent/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { LocalDirPicker } from '@/components/LocalDirPicker';
import { RcCard } from '@/components/RcCard';
import { RcKindPicker } from '@/components/RcKindPicker';
import { Badge, Button, Card, EmptyState, PageShell } from '@/components/ui';
import { type APIError, api } from '@/lib/api';
import { toastForRcCreate } from '@/lib/rcCreateToast';

// claude-broker is excluded from this UI's picker regardless of capabilities (its
// input is a remote URL driven from claude.ai, not this UI's pane/prompt flow).
const PICKER_EXCLUDED: RcKind[] = ['claude-broker'];

export default function MachineDetailPage() {
  const { machine = '' } = useParams();
  const qc = useQueryClient();

  const POLL_MS = 10_000;

  const machines = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.listMachines(),
    refetchInterval: POLL_MS,
  });
  const m: Machine | undefined = machines.data?.machines.find((x) => x.name === machine);

  const rc = useQuery({
    queryKey: ['machineRc', machine],
    queryFn: () => api.listMachineRcSessions(machine),
    refetchInterval: POLL_MS,
    enabled: !!m,
  });

  // Kinds offered for create, gated on the machine binary's advertised capabilities
  // (carried in the rc list envelope): capabilities present → the kinds it reports
  // whose backing agent is installed; absent (old binary) → the pre-multi-agent set.
  // The picker coerces the selected value if the gate later drops it.
  const allowedKinds = creatableRcKinds(rc.data?.capabilities).filter(
    (k) => !PICKER_EXCLUDED.includes(k),
  );
  const [rcKind, setRcKind] = useState<RcKind>(DEFAULT_RC_KIND);
  const [displayName, setDisplayName] = useState('');
  const [workdir, setWorkdir] = useState('');
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
  // Reset the inline create form when the route switches to a different machine
  // (the component instance is reused across :machine changes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on route change; setters are stable
  useEffect(() => {
    setShowNewSession(false);
    setDisplayName('');
  }, [machine]);

  // Default workdir to the configured machine.workdir whenever the route
  // changes machines (the page component instance is re-used by react-router
  // when only the :machine param changes, so without resetting we'd carry
  // the previous machine's workdir over). m?.name is in deps to detect the
  // machine switch even when two machines share the same workdir.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (m?.workdir) setWorkdir(m.workdir);
  }, [m?.name, m?.workdir]);

  const newRcM = useMutation({
    mutationFn: () =>
      api.createMachineRcSession(machine, {
        kind: rcKind,
        display_name: displayName.trim() || undefined,
        workdir: workdir || undefined,
      }),
    onSuccess: (s) => {
      toastForRcCreate(s);
      setShowNewSession(false);
      setDisplayName('');
      qc.invalidateQueries({ queryKey: ['machineRc', machine] });
    },
    onError: (e: APIError) => toast.error(`${e.code}: ${e.message}`),
  });

  if (machines.error) {
    return (
      <PageShell title={machine}>
        <Card className="border-destructive p-4">
          <div className="font-medium text-destructive">Failed to load machines</div>
          <div className="mt-1 text-muted-foreground text-sm">
            {(machines.error as Error).message}
          </div>
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

  if (!machines.isLoading && !m) {
    return (
      <PageShell title={machine}>
        <Card className="border-destructive p-4">
          <div className="font-medium text-destructive">Machine not found</div>
          <div className="mt-1 text-muted-foreground text-sm">
            No machine named <span className="font-mono">{machine}</span> in app config.
          </div>
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

  return (
    <PageShell
      title={
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="truncate">{machine}</span>
          <Badge variant="outline">machine</Badge>
          {m?.type === 'local' && <Badge variant="secondary">local</Badge>}
        </div>
      }
    >
      {!m ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {m.type === 'local' ? (
                <>
                  <span className="text-muted-foreground">runs on</span>
                  <span className="font-mono text-xs">
                    orchestrator host (no ssh){m.user ? ` — ${m.user}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">ssh</span>
                  <span className="font-mono text-xs">
                    {m.user}@{m.host}
                    {m.sshPort !== 22 ? `:${m.sshPort}` : ''}
                  </span>
                </>
              )}
              {m.workdir && (
                <>
                  <span className="text-muted-foreground">workdir</span>
                  <span className="break-all font-mono text-xs">{m.workdir}</span>
                </>
              )}
            </div>
          </Card>

          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-bold text-faint text-xs uppercase tracking-wider">
                Remote-control sessions
              </h2>
              {!showNewSession && (rc.data?.rc_sessions.length ?? 0) > 0 && (
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

            {showNewSession && (
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
                    placeholder={`${machine}/<slug>`}
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
                    allowedKinds={allowedKinds}
                  />
                </div>

                <div className="space-y-1">
                  <span className="block font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Workdir
                  </span>
                  <LocalDirPicker
                    source={{ kind: 'machine', machine }}
                    value={workdir}
                    onChange={setWorkdir}
                    allowRoot
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={closeNewSession} disabled={newRcM.isPending}>
                    Cancel
                  </Button>
                  <Button disabled={newRcM.isPending || !workdir} onClick={() => newRcM.mutate()}>
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

            {rc.error ? (
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
        </>
      )}
    </PageShell>
  );
}
