import type { Machine, ShedWithHost } from '@shed-remote-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, PageShell, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';

export default function ShedsPage() {
  const [filter, setFilter] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['sheds'],
    queryFn: () => api.listSheds(),
    refetchInterval: 10_000,
  });

  const machines = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.listMachines(),
    refetchInterval: 10_000,
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sheds = data?.sheds ?? [];
    if (!q) return sheds;
    return sheds.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.image?.toLowerCase().includes(q) ||
        s.repo?.toLowerCase().includes(q) ||
        s.local_dir?.toLowerCase().includes(q),
    );
  }, [data, filter]);

  const filteredMachines = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = machines.data?.machines ?? [];
    if (!q) return list;
    return list.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.host.toLowerCase().includes(q) ||
        m.user.toLowerCase().includes(q) ||
        m.workdir?.toLowerCase().includes(q),
    );
  }, [machines.data, filter]);

  return (
    <PageShell
      title="sheds"
      right={
        <Link to="/new">
          <Button>
            <Plus className="h-4 w-4" />
            New shed
          </Button>
        </Link>
      }
    >
      <div className="mb-4">
        <input
          type="text"
          inputMode="search"
          placeholder="Filter by name, host, image, repo…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {data?.errors?.length ? (
        <Card className="mb-4 p-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
            <div className="flex-1">
              <div className="font-medium">Some hosts unreachable</div>
              <ul className="mt-1 space-y-0.5 text-muted-foreground text-xs">
                {data.errors.map((e) => (
                  <li key={e.host}>
                    <span className="font-mono">{e.host}</span>: {e.error.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
      {error && (
        <Card className="border-destructive p-4">
          <div className="font-medium text-destructive">Failed to load sheds</div>
          <div className="mt-1 text-muted-foreground text-sm">{(error as Error).message}</div>
        </Card>
      )}
      {!isLoading && !error && filtered.length === 0 && filteredMachines.length === 0 && (
        <EmptyState
          title={filter ? 'No sheds or machines match your filter' : 'No sheds yet'}
          description={filter ? 'Try a different search term.' : 'Create one to get started.'}
          action={
            filter ? null : (
              <Link to="/new">
                <Button>
                  <Plus className="h-4 w-4" />
                  New shed
                </Button>
              </Link>
            )
          }
        />
      )}

      <div className="space-y-2">
        {filtered.map((s) => (
          <ShedRow key={`${s.host}/${s.name}`} shed={s} />
        ))}
      </div>

      {filteredMachines.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-semibold text-muted-foreground text-sm uppercase tracking-wide">
            Machines
          </h2>
          <div className="space-y-2">
            {filteredMachines.map((m) => (
              <MachineRow key={m.name} machine={m} />
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}

function MachineRow({ machine }: { machine: Machine }) {
  return (
    <Link to={`/machines/${encodeURIComponent(machine.name)}`} className="block">
      <Card className="p-4 transition-colors hover:border-primary/50 hover:bg-accent/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold">{machine.name}</h3>
              <Badge variant="outline">machine</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <span className="font-mono">
                {machine.user}@{machine.host}
                {machine.sshPort !== 22 ? `:${machine.sshPort}` : ''}
              </span>
            </div>
            {machine.workdir && (
              <div className="mt-2 truncate text-xs">
                <span className="text-muted-foreground">workdir:</span>{' '}
                <span className="font-mono">{machine.workdir}</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ShedRow({ shed }: { shed: ShedWithHost }) {
  const source = shed.repo
    ? { label: 'repo', value: shed.repo }
    : shed.local_dir
      ? { label: 'local', value: shed.local_dir }
      : null;

  return (
    <Link
      to={`/sheds/${encodeURIComponent(shed.host)}/${encodeURIComponent(shed.name)}`}
      className="block"
    >
      <Card className="p-4 transition-colors hover:border-primary/50 hover:bg-accent/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold">{shed.name}</h3>
              <StatusPill status={shed.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <Badge variant="outline">{shed.host}</Badge>
              {shed.image && <span className="font-mono">{shed.image}</span>}
              {shed.backend && <span>· {shed.backend}</span>}
            </div>
            {source && (
              <div className="mt-2 truncate text-xs">
                <span className="text-muted-foreground">{source.label}:</span>{' '}
                <span className="font-mono">{source.value}</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
