import type { Repo } from '@shed-remote-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { FilterInput } from './FilterInput';

export function RepoPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (nameWithOwner: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['repos'],
    queryFn: () => api.listRepos(),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const repos = data?.repos ?? [];
    if (!q) return repos;
    return repos.filter(
      (r) => r.nameWithOwner.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
    );
  }, [data, filter]);

  if (error) {
    return (
      <Card className="border-destructive p-3 text-sm">
        <div className="font-medium text-destructive">Failed to load repos</div>
        <div className="mt-1 text-muted-foreground text-xs">{(error as Error).message}</div>
      </Card>
    );
  }

  if (!isLoading && data && data.owners.length === 0) {
    return (
      <Card className="p-3 text-sm">
        <div className="font-medium">No GitHub owners configured</div>
        <div className="mt-1 text-muted-foreground text-xs">
          Add <code className="font-mono">github.owners</code> to your config file.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <FilterInput value={filter} onChange={setFilter} placeholder="Search repos…" />
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {isLoading && <div className="text-muted-foreground text-xs">Loading…</div>}
        {filtered.map((r) => (
          <RepoRow
            key={r.nameWithOwner}
            repo={r}
            selected={value === r.nameWithOwner}
            onSelect={() => onChange(r.nameWithOwner)}
          />
        ))}
        {!isLoading && filtered.length === 0 && (
          <div className="text-muted-foreground text-xs">No matches.</div>
        )}
      </div>
    </div>
  );
}

function RepoRow({
  repo,
  selected,
  onSelect,
}: {
  repo: Repo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full rounded-md border p-2 text-left transition-colors ${
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-primary/40 hover:bg-accent/30'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-sm">{repo.nameWithOwner}</span>
          {repo.isPrivate && (
            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
              <Lock className="h-2.5 w-2.5" /> private
            </Badge>
          )}
        </div>
      </div>
      {repo.description && (
        <div className="mt-1 truncate text-muted-foreground text-xs">{repo.description}</div>
      )}
    </button>
  );
}
