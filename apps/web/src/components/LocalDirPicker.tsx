import type { Workspace } from '@shed-remote-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { Folder, FolderGit } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { FilterInput } from './FilterInput';

export function LocalDirPicker({
  host,
  value,
  onChange,
}: {
  host: string;
  value: string;
  onChange: (path: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspaces', host],
    queryFn: () => api.listWorkspaces(host),
    staleTime: 30_000,
    enabled: Boolean(host),
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = data?.workspaces ?? [];
    if (!q) return list;
    return list.filter((w) => w.name.toLowerCase().includes(q));
  }, [data, filter]);

  if (error) {
    return (
      <Card className="border-destructive p-3 text-sm">
        <div className="font-medium text-destructive">Failed to list directories</div>
        <div className="mt-1 text-muted-foreground text-xs">{(error as Error).message}</div>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {data && (
        <div className="text-muted-foreground text-xs">
          Browsing{' '}
          <span className="font-mono">
            {data.user}@{host}:{data.root}
          </span>
        </div>
      )}
      <FilterInput value={filter} onChange={setFilter} placeholder="Search directories…" />
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {isLoading && <div className="text-muted-foreground text-xs">Loading…</div>}
        {filtered.map((w) => (
          <DirRow
            key={w.path}
            ws={w}
            selected={value === w.path}
            onSelect={() => onChange(w.path)}
          />
        ))}
        {!isLoading && filtered.length === 0 && (
          <div className="text-muted-foreground text-xs">No directories.</div>
        )}
      </div>
    </div>
  );
}

function DirRow({
  ws,
  selected,
  onSelect,
}: {
  ws: Workspace;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = ws.is_git_repo ? FolderGit : Folder;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors ${
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-primary/40 hover:bg-accent/30'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-sm">{ws.name}</span>
      {ws.is_git_repo && <span className="ml-auto text-[10px] text-muted-foreground">git</span>}
    </button>
  );
}
