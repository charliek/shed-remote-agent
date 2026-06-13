import { DEFAULT_RC_KIND, type Machine, type RcKind } from '@shed-remote-agent/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { LocalDirPicker } from '@/components/LocalDirPicker';
import { RcCard } from '@/components/RcCard';
import { RcKindPicker } from '@/components/RcKindPicker';
import { Badge, Button, Card, EmptyState, PageShell } from '@/components/ui';
import { type APIError, api } from '@/lib/api';
import { toastForRcCreate } from '@/lib/rcCreateToast';

const ALLOWED_KINDS: RcKind[] = ['repl', 'shell'];

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

  const [rcKind, setRcKind] = useState<RcKind>(
    ALLOWED_KINDS.includes(DEFAULT_RC_KIND) ? DEFAULT_RC_KIND : ALLOWED_KINDS[0],
  );
  const [displayName, setDisplayName] = useState('');
  const [workdir, setWorkdir] = useState('');

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
            <div className="mb-3">
              <h2 className="font-semibold text-sm uppercase tracking-wide">
                Remote-control sessions
              </h2>
            </div>

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
            ) : (
              <EmptyState
                title="No remote-control sessions"
                description="Create one below to get started."
              />
            )}
          </section>

          <section className="mt-6">
            <div className="mb-3">
              <h2 className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                New session
              </h2>
            </div>

            <Card className="space-y-3 p-3">
              <div className="space-y-1">
                <label
                  htmlFor="rc-display-name"
                  className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
                >
                  Session name
                </label>
                <input
                  id="rc-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
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
                  allowedKinds={ALLOWED_KINDS}
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

              <div className="flex justify-end">
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
          </section>
        </>
      )}
    </PageShell>
  );
}
