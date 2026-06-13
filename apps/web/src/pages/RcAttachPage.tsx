import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RcTerminal, type RcTerminalTarget } from '@/components/RcTerminal';
import { api } from '@/lib/api';

export default function RcAttachPage() {
  const { host = '', name = '', slug = '' } = useParams();
  const target = useMemo<RcTerminalTarget>(() => ({ kind: 'shed', host, name }), [host, name]);

  const rc = useQuery({
    queryKey: ['rc', host, name],
    queryFn: () => api.listRcSessions(host, name),
    refetchInterval: 30_000,
  });

  const session = rc.data?.rc_sessions.find((s) => s.slug === slug);
  const displayName = session?.display_name ?? `${name}/${slug}`;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#1b1713] text-[#f0e9df]">
      <header className="flex items-center gap-3 border-[#33291f] border-b px-3 py-2.5 text-sm">
        <Link
          to={`/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}`}
          className="text-[#a99a86] transition-colors hover:text-[#f0e9df]"
          aria-label="Back to shed"
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
          {host} · {name} · {slug}
        </span>
      </header>
      <RcTerminal target={target} slug={slug} />
    </div>
  );
}
