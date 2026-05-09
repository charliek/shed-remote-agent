import { DEFAULT_RC_KIND, type RcKind, type RcState } from '@shed-remote-agent/shared';
import { AppError } from './errors.js';
import { shellQuote } from './shell.js';
import { classifySSHError, run, type SSHTarget } from './ssh.js';

export const RC_PREFIX = 'rc-';
export const DEFAULT_WORKDIR = '/workspace';
const PANE_SEP = '---RC-PANE---';
const NAME_SEP = '---RC-NAME---';
const KIND_SEP = '---RC-KIND---';

// Alphabet chosen to avoid visually-confusable characters so short slugs
// survive a human reading a QR or typed URL.
function genSlug(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

function tmuxName(slug: string): string {
  return `${RC_PREFIX}${slug}`;
}

// tmux's command parser re-tokenizes the argument to `-e` on whitespace
// and interprets a small set of meta characters even after the outer
// shell has handed it a single argv element. A multi-word value like
// "Friday Bug Fix" would silently abort the new session. Backslash-escape
// the meta chars so tmux's internal parser preserves the original value.
function tmuxArgEscape(s: string): string {
  return s.replace(/[\\$"' \t]/g, '\\$&');
}

/**
 * Builds the inner command the tmux session runs. Three shapes:
 *   agent  – the today's broker, hosts up to 32 cloud-driven sessions.
 *   repl   – an interactive `claude` REPL with `/rc` enabled on top, so the
 *            live conversation is what attachers see.
 *   shell  – a plain login bash; used for ad-hoc terminal access.
 *
 * When `interactiveShell` is true, repl/agent are wrapped in `bash -ic` so
 * the user's ~/.bashrc runs and PATH-mutating tools like nvm/asdf/pnpm are
 * picked up before claude is exec'd. Needed on native machines where claude
 * lives under e.g. ~/.nvm/.../bin/claude rather than /usr/local/bin.
 */
export function buildInnerCommand(
  kind: RcKind,
  displayName: string,
  opts?: { interactiveShell?: boolean },
): string {
  const cmd = (() => {
    switch (kind) {
      case 'agent':
        return `claude remote-control --name ${shellQuote(displayName)} --spawn same-dir`;
      case 'repl':
        return `claude --name ${shellQuote(displayName)} /rc`;
      case 'shell':
        return 'bash -l';
    }
  })();
  if (opts?.interactiveShell && kind !== 'shell') {
    return `bash -ic ${shellQuote(cmd)}`;
  }
  return cmd;
}

export interface BootstrapOptions {
  ssh: SSHTarget;
  /** Display name for the tmux session and `--name` flag. Defaults to slug. */
  displayName?: string;
  /** Optional fallback used when displayName is not provided; receives the
   * generated/passed slug so the caller can build e.g. `<shed>/<slug>`. */
  displayNameFallback?: (slug: string) => string;
  /** Working directory inside the tmux session. */
  workdir?: string;
  slug?: string;
  kind?: RcKind;
  /** Wrap repl/agent commands with `bash -ic` so the user's ~/.bashrc runs
   * and PATH-mutating tools (nvm/asdf/pnpm) are picked up. Default false —
   * sheds bake claude into a system path so they don't need it. Set true
   * for native machines. */
  interactiveShell?: boolean;
}

export async function bootstrap(opts: BootstrapOptions): Promise<{
  slug: string;
  tmuxSession: string;
  displayName: string;
  workdir: string;
  kind: RcKind;
}> {
  const slug = opts.slug ?? genSlug();
  const displayName = opts.displayName ?? opts.displayNameFallback?.(slug) ?? slug;
  const workdir = opts.workdir ?? DEFAULT_WORKDIR;
  const kind = opts.kind ?? DEFAULT_RC_KIND;
  const name = tmuxName(slug);

  // Run tmux directly as the ssh command instead of wrapping in `bash -c`.
  // When tmux is a grandchild of sshd through a bash shell, the bash
  // process holds fd references that prevent the connection from closing
  // cleanly (and on shed images without lingering enabled, can also cause
  // the tmux server to be reaped on logout). Direct invocation lets sshd
  // hand off straight to tmux, which forks its server into its own
  // process group and returns immediately under -d.
  const inner = buildInnerCommand(kind, displayName, {
    interactiveShell: opts.interactiveShell,
  });
  const result = await run(
    opts.ssh,
    [
      'tmux',
      'new-session',
      '-d',
      '-s',
      name,
      '-c',
      workdir,
      '-e',
      `SRA_DISPLAY_NAME=${tmuxArgEscape(displayName)}`,
      '-e',
      `SRA_KIND=${kind}`,
      inner,
    ],
    { timeoutMs: 10_000 },
  );

  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    const combined = `${result.stderr}\n${result.stdout}`.trim();
    if (cls === 'auth-denied') {
      throw new AppError('SSH_AUTH_DENIED', `SSH authentication denied: ${combined}`, 401);
    }
    if (cls === 'host-unreachable' || cls === 'connection-refused' || cls === 'timeout') {
      throw new AppError('SSH_UNREACHABLE', `SSH connection failed (${cls}): ${combined}`, 502);
    }
    throw new AppError('BOOTSTRAP_FAILED', combined || `ssh exited ${result.code}`, 500);
  }

  return { slug, tmuxSession: name, displayName, workdir, kind };
}

export async function kill(opts: { ssh: SSHTarget; slug: string }): Promise<void> {
  const name = tmuxName(opts.slug);
  const result = await run(opts.ssh, ['tmux', 'kill-session', '-t', name], {
    timeoutMs: 5_000,
  });
  if (result.code === 0) return;

  const cls = classifySSHError(result.stderr, result.code);
  if (cls === 'auth-denied') {
    throw new AppError(
      'SSH_AUTH_DENIED',
      `SSH authentication denied: ${result.stderr.trim()}`,
      401,
    );
  }
  if (cls === 'host-unreachable' || cls === 'connection-refused' || cls === 'timeout') {
    throw new AppError('SSH_UNREACHABLE', `SSH ${cls}: ${result.stderr.trim()}`, 502);
  }
  // tmux kill-session returns non-zero when the session doesn't exist — idempotent success.
  if (/can't find session|no session/i.test(result.stderr)) return;

  throw new AppError('KILL_FAILED', result.stderr.trim() || `ssh exited ${result.code}`, 502);
}

export async function probe(opts: {
  ssh: SSHTarget;
  slug: string;
  kind: RcKind;
}): Promise<{ state: RcState; url?: string }> {
  const name = tmuxName(opts.slug);
  // Run tmux directly without a `bash -c` wrapper. On shed images where the
  // user has no controlling terminal, tmux fails ("open terminal failed:
  // not a terminal") when invoked as a child of bash, but works fine when
  // sshd execs it directly. capture-pane already returns non-zero if the
  // session doesn't exist, so the previous has-session preflight is
  // redundant.
  const result = await run(opts.ssh, ['tmux', 'capture-pane', '-t', name, '-p', '-S', '-200'], {
    timeoutMs: 5_000,
  });

  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    if (cls === 'ok' || cls === 'command-failed') return { state: 'dead' };
    throw new AppError('SSH_ERROR', `ssh ${cls}: ${result.stderr.trim()}`, 502);
  }
  return classifyPane(opts.kind, result.stdout);
}

function extractUrl(kind: RcKind, pane: string): string | undefined {
  if (kind === 'agent') {
    return pane.match(/https?:\/\/claude\.ai\/code\?environment=env_[A-Za-z0-9_-]+/)?.[0];
  }
  if (kind === 'repl') {
    return pane.match(/https?:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/)?.[0];
  }
  return undefined;
}

export function classifyPane(kind: RcKind, pane: string): { state: RcState; url?: string } {
  // Trust + auth heuristics apply to both kinds that run claude (the strings
  // come from claude itself, not from `claude remote-control` specifically).
  if (kind !== 'shell') {
    if (/Workspace not trusted/i.test(pane)) {
      return { state: 'needs-trust', url: extractUrl(kind, pane) };
    }
    // First-time trust prompt: claude shows an interactive
    // "Quick safety check: Is this a project you created or one you trust?"
    // prompt the first time it enters a workspace. The session stays alive
    // (waiting on input) so the URL pattern never appears — surface it as
    // needs-trust so the UI nudges the user instead of spinning forever.
    if (/Quick safety check/i.test(pane) || /Yes,\s*I trust this folder/i.test(pane)) {
      return { state: 'needs-trust', url: extractUrl(kind, pane) };
    }
    if (/requires a claude\.ai subscription|not logged in|claude auth login/i.test(pane)) {
      return { state: 'needs-auth', url: extractUrl(kind, pane) };
    }
  }

  if (kind === 'agent') {
    const url = extractUrl('agent', pane);
    if (/\bReconnecting\b/.test(pane)) return { state: 'reconnecting', url };
    if (/\bConnected\b/.test(pane) && url) return { state: 'ready', url };
    if (url) return { state: 'ready', url };
    return { state: 'starting' };
  }

  if (kind === 'repl') {
    const url = extractUrl('repl', pane);
    if (/Remote Control connecting/i.test(pane) && !url) return { state: 'starting' };
    if (/Remote Control active/i.test(pane) && url) return { state: 'ready', url };
    if (url) return { state: 'ready', url };
    return { state: 'starting' };
  }

  // shell
  if (pane.trim().length > 0) return { state: 'ready' };
  return { state: 'starting' };
}

function parseKind(raw: string): RcKind {
  if (raw === 'agent' || raw === 'repl' || raw === 'shell') return raw;
  // Pre-feature sessions never set SRA_KIND; default to today's behavior.
  return 'agent';
}

export interface RawRcSession {
  slug: string;
  tmux_session: string;
  display_name: string;
  /** Workdir is not recoverable from tmux; callers fill in their default. */
  kind: RcKind;
  state: RcState;
  url?: string;
}

/**
 * Single-SSH list-and-probe: fetches all tmux session names and their panes
 * in one remote shell invocation so we don't pay N+1 SSH handshakes.
 *
 * Returns target-agnostic data; callers wrap with shed/machine identifiers
 * and a workdir default.
 */
export async function listRcSessions(opts: {
  ssh: SSHTarget;
  /** Used when a tmux session has no SRA_DISPLAY_NAME stored (e.g. created
   * before the env var was added). Receives the slug. */
  displayNameFallback?: (slug: string) => string;
}): Promise<RawRcSession[]> {
  const script = `
names=$(tmux ls -F '#{session_name}' 2>/dev/null | grep '^${RC_PREFIX}' || true)
for n in $names; do
  echo "${PANE_SEP}${PANE_SEP} $n"
  echo "${NAME_SEP}$(tmux show-environment -t "$n" SRA_DISPLAY_NAME 2>/dev/null | sed -n 's/^SRA_DISPLAY_NAME=//p')"
  echo "${KIND_SEP}$(tmux show-environment -t "$n" SRA_KIND 2>/dev/null | sed -n 's/^SRA_KIND=//p')"
  tmux capture-pane -t "$n" -p -S -200 2>/dev/null || true
done
`;
  // Pipe the script via stdin instead of `bash -lc`. On shed images where
  // the user has no controlling terminal, tmux invoked as a child of `bash
  // -c` fails with "open terminal failed: not a terminal", but works when
  // bash reads commands from stdin (the parent process layout differs).
  const result = await run(opts.ssh, ['bash'], {
    stdin: script,
    timeoutMs: 8_000,
  });

  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    if (cls === 'ok' || cls === 'command-failed') return [];
    throw new AppError('SSH_ERROR', `ssh ${cls}: ${result.stderr.trim()}`, 502);
  }

  const sections = result.stdout.split(`${PANE_SEP}${PANE_SEP} `).slice(1);
  return sections.map<RawRcSession>((section) => {
    const lines = section.split('\n');
    const tmuxSession = (lines[0] ?? '').trim();
    const slug = tmuxSession.slice(RC_PREFIX.length);

    let storedName = '';
    let kind: RcKind = 'agent';
    let paneStart = 1;
    if (lines[1]?.startsWith(NAME_SEP)) {
      storedName = lines[1].slice(NAME_SEP.length).trim();
      paneStart = 2;
    }
    if (lines[paneStart]?.startsWith(KIND_SEP)) {
      kind = parseKind(lines[paneStart].slice(KIND_SEP.length).trim());
      paneStart += 1;
    }

    const pane = lines.slice(paneStart).join('\n');
    const { state, url } = classifyPane(kind, pane);
    return {
      slug,
      tmux_session: tmuxSession,
      display_name: storedName || opts.displayNameFallback?.(slug) || slug,
      kind,
      state,
      url,
    };
  });
}

export async function probeUntilReady(opts: {
  ssh: SSHTarget;
  slug: string;
  kind: RcKind;
  timeoutMs?: number;
}): Promise<{ state: RcState; url?: string }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let last: { state: RcState; url?: string } = { state: 'starting' };
  while (Date.now() < deadline) {
    last = await probe({ ssh: opts.ssh, slug: opts.slug, kind: opts.kind });
    if (last.state !== 'starting') return last;
    await new Promise((r) => setTimeout(r, 750));
  }
  return last;
}
