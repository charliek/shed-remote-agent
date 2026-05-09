import type { RcSession } from '@shed-remote-agent/shared';
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
    case 'dead':
      toast.error(
        `Session ${s.slug} exited immediately. Is \`claude\` on the machine's PATH? (For nvm-installed claude, ensure ~/.bashrc adds it; we run with bash -ic for machines.)`,
        { duration: 8000 },
      );
      return;
    case 'needs-trust':
      toast.warning(
        `Session ${s.slug} created — workspace trust required. Open a shell, run \`claude\` in the workdir, accept the prompt, then create a new session.`,
        { duration: 8000 },
      );
      return;
    case 'needs-auth':
      toast.warning(
        `Session ${s.slug} created — claude auth required. Run \`claude auth login\` on the machine first.`,
        { duration: 8000 },
      );
      return;
  }
}
