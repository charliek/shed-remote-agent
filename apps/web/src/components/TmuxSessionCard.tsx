import type { Session } from '@shed-remote-agent/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { type APIError, api } from '@/lib/api';
import { Badge, Button, Card } from './ui';

export function TmuxSessionCard({ host, shed, s }: { host: string; shed: string; s: Session }) {
  const qc = useQueryClient();
  const killM = useMutation({
    mutationFn: () => api.killSession(host, shed, s.name),
    onSuccess: () => {
      toast.success(`Session ${s.name} killed`);
      qc.invalidateQueries({ queryKey: ['sessions', host, shed] });
      qc.invalidateQueries({ queryKey: ['rc', host, shed] });
    },
    onError: (e: APIError) => toast.error(e.message),
  });

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm">{s.name}</span>
            {s.is_remote_control && <Badge variant="secondary">rc</Badge>}
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {s.window_count ?? 0} window(s) · {s.attached ? 'attached' : 'detached'}
          </div>
        </div>
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={killM.isPending}
          onClick={() => {
            if (confirm(`Kill tmux session "${s.name}"?`)) killM.mutate();
          }}
        >
          {killM.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Kill
        </Button>
      </div>
    </Card>
  );
}
