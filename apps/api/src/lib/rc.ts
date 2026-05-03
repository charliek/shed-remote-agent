import type { Host, RcSession, RcState } from '@shed-remote-agent/shared';
import { AppError } from './errors.js';
import { shellQuote } from './shell.js';
import { classifySSHError, run, type SSHTarget } from './ssh.js';

export const RC_PREFIX = 'rc-';
export const DEFAULT_WORKDIR = '/workspace';
const PANE_SEP = '---RC-PANE---';
const NAME_SEP = '---RC-NAME---';

function target(host: Host, shedName: string): SSHTarget {
  return { host: host.host, user: shedName, port: host.sshPort };
}

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

export async function bootstrap(opts: {
  host: Host;
  shed: string;
  slug?: string;
  displayName?: string;
  workdir?: string;
}): Promise<{ slug: string; tmuxSession: string; displayName: string; workdir: string }> {
  const slug = opts.slug ?? genSlug();
  const displayName = opts.displayName ?? `${opts.shed}/${slug}`;
  const workdir = opts.workdir ?? DEFAULT_WORKDIR;
  const name = tmuxName(slug);

  // Run tmux directly as the ssh command instead of wrapping in `bash -c`.
  // When tmux is a grandchild of sshd through a bash shell, the bash
  // process holds fd references that prevent the connection from closing
  // cleanly (and on shed images without lingering enabled, can also cause
  // the tmux server to be reaped on logout). Direct invocation lets sshd
  // hand off straight to tmux, which forks its server into its own
  // process group and returns immediately under -d.
  const inner = `claude remote-control --name ${shellQuote(displayName)} --spawn same-dir`;
  const result = await run(
    target(opts.host, opts.shed),
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

  return { slug, tmuxSession: name, displayName, workdir };
}

export async function kill(opts: { host: Host; shed: string; slug: string }): Promise<void> {
  const name = tmuxName(opts.slug);
  const result = await run(target(opts.host, opts.shed), ['tmux', 'kill-session', '-t', name], {
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
  host: Host;
  shed: string;
  slug: string;
}): Promise<{ state: RcState; url?: string }> {
  const name = tmuxName(opts.slug);
  // Run tmux directly without a `bash -c` wrapper. On shed images where the
  // user has no controlling terminal, tmux fails ("open terminal failed:
  // not a terminal") when invoked as a child of bash, but works fine when
  // sshd execs it directly. capture-pane already returns non-zero if the
  // session doesn't exist, so the previous has-session preflight is
  // redundant.
  const result = await run(
    target(opts.host, opts.shed),
    ['tmux', 'capture-pane', '-t', name, '-p', '-S', '-200'],
    { timeoutMs: 5_000 },
  );

  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    if (cls === 'ok' || cls === 'command-failed') return { state: 'dead' };
    throw new AppError('SSH_ERROR', `ssh ${cls}: ${result.stderr.trim()}`, 502);
  }
  return classifyPane(result.stdout);
}

export function classifyPane(pane: string): { state: RcState; url?: string } {
  const urlMatch = pane.match(/https?:\/\/claude\.ai\/code\?environment=(env_[A-Za-z0-9_-]+)/);
  const url = urlMatch?.[0];

  if (/Workspace not trusted/i.test(pane)) return { state: 'needs-trust', url };
  if (/requires a claude\.ai subscription|not logged in|claude auth login/i.test(pane)) {
    return { state: 'needs-auth', url };
  }
  if (/\bReconnecting\b/.test(pane)) return { state: 'reconnecting', url };
  if (/\bConnected\b/.test(pane) && url) return { state: 'ready', url };
  if (url) return { state: 'ready', url };
  return { state: 'starting' };
}

/**
 * Single-SSH list-and-probe: fetches all tmux session names and their panes
 * in one remote shell invocation so we don't pay N+1 SSH handshakes.
 */
export async function listRcSessions(opts: { host: Host; shed: string }): Promise<RcSession[]> {
  const script = `
names=$(tmux ls -F '#{session_name}' 2>/dev/null | grep '^${RC_PREFIX}' || true)
for n in $names; do
  echo "${PANE_SEP}${PANE_SEP} $n"
  echo "${NAME_SEP}$(tmux show-environment -t "$n" SRA_DISPLAY_NAME 2>/dev/null | sed -n 's/^SRA_DISPLAY_NAME=//p')"
  tmux capture-pane -t "$n" -p -S -200 2>/dev/null || true
done
`;
  // Pipe the script via stdin instead of `bash -lc`. On shed images where
  // the user has no controlling terminal, tmux invoked as a child of `bash
  // -c` fails with "open terminal failed: not a terminal", but works when
  // bash reads commands from stdin (the parent process layout differs).
  const result = await run(target(opts.host, opts.shed), ['bash'], {
    stdin: script,
    timeoutMs: 8_000,
  });

  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    if (cls === 'ok' || cls === 'command-failed') return [];
    throw new AppError('SSH_ERROR', `ssh ${cls}: ${result.stderr.trim()}`, 502);
  }

  const sections = result.stdout.split(`${PANE_SEP}${PANE_SEP} `).slice(1);
  return sections.map<RcSession>((section) => {
    const lines = section.split('\n');
    const tmuxSession = (lines[0] ?? '').trim();
    const slug = tmuxSession.slice(RC_PREFIX.length);

    let storedName = '';
    let paneStart = 1;
    if (lines[1]?.startsWith(NAME_SEP)) {
      storedName = lines[1].slice(NAME_SEP.length).trim();
      paneStart = 2;
    }

    const pane = lines.slice(paneStart).join('\n');
    const { state, url } = classifyPane(pane);
    return {
      slug,
      tmux_session: tmuxSession,
      shed_name: opts.shed,
      host: opts.host.name,
      display_name: storedName || `${opts.shed}/${slug}`,
      workdir: DEFAULT_WORKDIR,
      state,
      url,
    };
  });
}

export async function probeUntilReady(opts: {
  host: Host;
  shed: string;
  slug: string;
  timeoutMs?: number;
}): Promise<{ state: RcState; url?: string }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let last: { state: RcState; url?: string } = { state: 'starting' };
  while (Date.now() < deadline) {
    last = await probe({ host: opts.host, shed: opts.shed, slug: opts.slug });
    if (last.state !== 'starting') return last;
    await new Promise((r) => setTimeout(r, 750));
  }
  return last;
}
