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
    <div className="fixed inset-0 flex flex-col bg-[#1b1713] text-[#f0e9df]">
      <header className="flex items-center gap-3 border-[#33291f] border-b px-3 py-2.5 text-sm">
        <Link
          to={`/machines/${encodeURIComponent(machine)}`}
          className="text-[#a99a86] transition-colors hover:text-[#f0e9df]"
          aria-label="Back to machine"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="truncate font-medium font-mono">{displayName}</span>
        {session?.state && (
          <span className="rounded-full bg-[#33291f] px-2 py-0.5 font-semibold text-[#d8cbb8] text-xs">
            {session.state}
          </span>
        )}
        <span className="ml-auto truncate font-mono text-[#8a7c68] text-xs">
          {machine} · {slug}
        </span>
      </header>
      <RcTerminal target={target} slug={slug} />
    </div>
  );
}
