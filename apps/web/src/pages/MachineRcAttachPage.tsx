import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RcTerminal, type RcTerminalTarget } from '@/components/RcTerminal';
import { api } from '@/lib/api';

export default function MachineRcAttachPage() {
  const { machine = '', slug = '' } = useParams();
  const target = useMemo<RcTerminalTarget>(() => ({ kind: 'machine', machine }), [machine]);

  const rc = useQuery({
    queryKey: ['machineRc', machine],
    queryFn: () => api.listMachineRcSessions(machine),
    refetchInterval: 30_000,
  });

  const session = rc.data?.rc_sessions.find((s) => s.slug === slug);
  const displayName = session?.display_name ?? `${machine}/${slug}`;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b0d12] text-zinc-100">
      <header className="flex items-center gap-3 border-zinc-800 border-b px-3 py-2 text-sm">
        <Link
          to={`/machines/${encodeURIComponent(machine)}`}
          className="text-zinc-400 hover:text-zinc-100"
          aria-label="Back to machine"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="truncate font-mono">{displayName}</span>
        {session?.state && (
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-medium text-xs text-zinc-300">
            {session.state}
          </span>
        )}
        <span className="ml-auto truncate text-xs text-zinc-500">
          {machine} · {slug}
        </span>
      </header>
      <RcTerminal target={target} slug={slug} />
    </div>
  );
}
