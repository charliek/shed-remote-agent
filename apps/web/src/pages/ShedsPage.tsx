import type { Machine, ShedWithHost } from '@shed-remote-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Plus, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterInput } from '@/components/FilterInput';
import {
  Button,
  Card,
  EmptyState,
  PageShell,
  Panel,
  SectionLabel,
  Stat,
  StatStrip,
} from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

function statusTextClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'running' || s === 'ready') return 'text-sage';
  if (s === 'starting' || s === 'reconnecting') return 'text-ochre';
  if (s === 'error' || s === 'dead' || s === 'failed') return 'text-destructive';
  return 'text-faint';
}

export default function ShedsPage() {
  const [filter, setFilter] = useState('');
  const sheds = useQuery({
    queryKey: ['sheds'],
    queryFn: () => api.listSheds(),
    refetchInterval: 10_000,
  });
  const data = sheds.data;

  const machines = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.listMachines(),
    refetchInterval: 10_000,
  });

  const hosts = useQuery({ queryKey: ['hosts'], queryFn: () => api.listHosts() });

  // Show the page-level loading spinner / error / empty-state only when
  // both queries agree, so a slow `machines` fetch doesn't flash the empty
  // state and an error in either source isn't silently swallowed.
  const pageIsLoading = sheds.isLoading || machines.isLoading;
  const pageError = (sheds.error ?? machines.error) as Error | null;

  const allSheds = data?.sheds ?? [];
  const runningCount = allSheds.filter((s) => s.status.toLowerCase() === 'running').length;
  const stoppedCount = allSheds.length - runningCount;
  const hostCount = hosts.data?.hosts.length ?? new Set(allSheds.map((s) => s.host)).size;
  // Names of hosts reached over TLS + a bearer token, for the "secure" row badge.
  const secureHosts = new Set((hosts.data?.hosts ?? []).filter((h) => h.secure).map((h) => h.name));

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allSheds;
    return allSheds.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.image?.toLowerCase().includes(q) ||
        s.repo?.toLowerCase().includes(q) ||
        s.local_dir?.toLowerCase().includes(q),
    );
  }, [allSheds, filter]);

  const filteredMachines = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = machines.data?.machines ?? [];
    if (!q) return list;
    return list.filter((m) => {
      if (m.name.toLowerCase().includes(q)) return true;
      if (m.workdir?.toLowerCase().includes(q)) return true;
      if (m.type === 'local') return (m.user ?? '').toLowerCase().includes(q);
      return m.host.toLowerCase().includes(q) || m.user.toLowerCase().includes(q);
    });
  }, [machines.data, filter]);

  return (
    <PageShell
      action={
        <Button asChild>
          <Link to="/new">
            <Plus />
            New shed
          </Link>
        </Button>
      }
    >
      {!pageIsLoading && !pageError && data && (
        <StatStrip>
          <Stat n={runningCount} label="running" tone="sage" />
          <Stat n={stoppedCount} label="stopped" tone="faint" />
          <Stat n={hostCount} label={hostCount === 1 ? 'host' : 'hosts'} tone="primary" />
        </StatStrip>
      )}

      <div className="mb-6">
        <FilterInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter by name, host, image, repo…"
          ariaLabel="Filter sheds and machines"
        />
      </div>

      {data?.errors?.length ? (
        <Card className="mb-5 p-3.5">
          <div className="flex items-start gap-2.5 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ochre" />
            <div className="flex-1">
              <div className="font-semibold">Some hosts unreachable</div>
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

      {pageIsLoading && <SkeletonList />}

      {pageError && (
        <Card className="border-destructive/60 p-4">
          <div className="font-semibold text-destructive">Failed to load</div>
          <div className="mt-1 text-muted-foreground text-sm">{pageError.message}</div>
        </Card>
      )}

      {!pageIsLoading && !pageError && filtered.length === 0 && filteredMachines.length === 0 && (
        <EmptyState
          title={filter ? 'No sheds or machines match your filter' : 'No sheds or machines yet'}
          description={filter ? 'Try a different search term.' : 'Create one to get started.'}
          action={
            filter ? null : (
              <Button asChild>
                <Link to="/new">
                  <Plus />
                  New shed
                </Link>
              </Button>
            )
          }
        />
      )}

      {filtered.length > 0 && (
        <>
          <SectionLabel count={filtered.length}>Sheds</SectionLabel>
          <Panel>
            {filtered.map((s, i) => (
              <ShedRow
                key={`${s.host}/${s.name}`}
                shed={s}
                index={i}
                secure={secureHosts.has(s.host)}
              />
            ))}
          </Panel>
        </>
      )}

      {filteredMachines.length > 0 && (
        <section className="mt-7">
          <SectionLabel count={filteredMachines.length}>Machines</SectionLabel>
          <Panel>
            {filteredMachines.map((m, i) => (
              <MachineRow key={m.name} machine={m} index={i} />
            ))}
          </Panel>
        </section>
      )}
    </PageShell>
  );
}

const rowBase =
  'group grid grid-cols-[10px_1fr_auto] items-center gap-4 px-4 py-4 transition-colors hover:bg-secondary animate-rise';

function Chevron() {
  return (
    <ChevronRight className="h-[18px] w-[18px] shrink-0 text-faint opacity-50 transition-all group-hover:translate-x-0.5 group-hover:text-primary group-hover:opacity-100" />
  );
}

function ShedRow({ shed, index, secure }: { shed: ShedWithHost; index: number; secure?: boolean }) {
  const running = shed.status.toLowerCase() === 'running';
  const source = shed.repo
    ? shed.repo
    : shed.local_dir
      ? shed.local_dir
      : shed.image
        ? shed.image
        : null;

  return (
    <Link
      to={`/sheds/${encodeURIComponent(shed.host)}/${encodeURIComponent(shed.name)}`}
      className={rowBase}
      style={{ animationDelay: `${Math.min(index, 8) * 0.04}s` }}
    >
      <span
        className={cn(
          'h-2.5 w-2.5 rounded-full',
          running ? 'pulse-dot bg-sage shadow-[0_0_10px_hsl(var(--sage)/0.55)]' : 'bg-faint',
        )}
      />
      <div className="min-w-0">
        <div className="truncate font-bold text-[17px] tracking-tight">{shed.name}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 font-semibold text-muted-foreground text-xs">
            {secure && (
              <ShieldCheck className="h-3 w-3 text-sage" aria-label="secure (TLS + token)" />
            )}
            {shed.host}
          </span>
          {shed.backend && <span className="font-mono text-faint text-xs">{shed.backend}</span>}
          {source && (
            <span className="truncate font-mono text-muted-foreground text-xs">{source}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={cn('font-bold text-xs', statusTextClass(shed.status))}>{shed.status}</span>
        <Chevron />
      </div>
    </Link>
  );
}

function MachineRow({ machine, index }: { machine: Machine; index: number }) {
  const conn =
    machine.type === 'local'
      ? machine.user
        ? `${machine.user}@localhost`
        : 'localhost'
      : `${machine.user}@${machine.host}${machine.sshPort !== 22 ? `:${machine.sshPort}` : ''}`;

  return (
    <Link
      to={`/machines/${encodeURIComponent(machine.name)}`}
      className={rowBase}
      style={{ animationDelay: `${Math.min(index, 8) * 0.04}s` }}
    >
      <span className="h-2.5 w-2.5 rounded-full bg-ochre" />
      <div className="min-w-0">
        <div className="truncate font-bold text-[17px] tracking-tight">{machine.name}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-faint text-xs">{conn}</span>
          {machine.workdir && (
            <span className="truncate font-mono text-muted-foreground text-xs">
              {machine.workdir}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-ochre/15 px-2 py-0.5 font-bold text-[11px] text-ochre uppercase tracking-wide">
          {machine.type === 'local' ? 'local' : 'ssh'}
        </span>
        <Chevron />
      </div>
    </Link>
  );
}

function SkeletonList() {
  return (
    <Panel>
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[10px_1fr_auto] items-center gap-4 px-4 py-4">
          <span className="h-2.5 w-2.5 rounded-full bg-muted" />
          <div className="min-w-0">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-44 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </Panel>
  );
}
