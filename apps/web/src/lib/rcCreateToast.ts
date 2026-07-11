import { agentBinForKind, authHintForKind, type RcSession } from '@shed-remote-agent/shared';
import { toast } from 'sonner';

/**
 * Show the right toast for the state returned by POST /rc. The bootstrap
 * endpoint can return non-ready states (most commonly `dead` when the
 * inner command — typically `claude` — exits immediately, e.g. because
 * it's not on PATH); previously these all rendered as a success toast,
 * which left the user wondering where their session went.
 */
export function toastForRcCreate(s: RcSession): void {
  switch (s.state) {
    case 'ready':
    case 'starting':
    case 'reconnecting':
      toast.success(`Session ${s.slug} created`);
      return;
    case 'dead': {
      // Per-kind binary: each kind runs a different agent executable.
      const bin = agentBinForKind(s.kind);
      toast.error(
        bin
          ? `Session ${s.slug} exited immediately. Is \`${bin}\` on the machine's PATH? (For nvm-installed tools, ensure ~/.bashrc adds them; we run with bash -ic for machines.)`
          : `Session ${s.slug} exited immediately — the inner command exited.`,
        { duration: 8000 },
      );
      return;
    }
    case 'needs-trust': {
      const bin = agentBinForKind(s.kind);
      toast.warning(
        `Session ${s.slug} created — workspace trust required. Open a shell, run \`${bin ?? 'the agent'}\` in the workdir, accept the prompt, then create a new session.`,
        { duration: 8000 },
      );
      return;
    }
    case 'needs-auth':
      // Per-kind login remediation (each agent logs in differently).
      toast.warning(
        `Session ${s.slug} created — agent login required. In a terminal on the target, ${authHintForKind(s.kind)} first.`,
        { duration: 8000 },
      );
      return;
  }
}
