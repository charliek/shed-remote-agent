import { shellQuote } from './shell.js';

export interface SSHTarget {
  host: string;
  user: string;
  port: number;
}

/**
 * Target for {@link run} and the RC primitives. SSH talks to a remote host;
 * `local` runs the same command on the orchestrator host with no SSH hop
 * (used for `type: local` machines, where Tailscale SSH can't loop back).
 */
export type CommandTarget = ({ kind: 'ssh' } & SSHTarget) | { kind: 'local' };

export interface SSHResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type SSHErrorClass =
  | 'ok'
  | 'auth-denied'
  | 'host-unreachable'
  | 'connection-refused'
  | 'timeout'
  | 'command-failed';

export function classifySSHError(stderr: string, code: number): SSHErrorClass {
  if (code === 0) return 'ok';
  if (code === 124) return 'timeout';
  const s = stderr.toLowerCase();
  if (s.includes('permission denied') || s.includes('publickey')) return 'auth-denied';
  if (s.includes('no route to host') || s.includes('could not resolve hostname')) {
    return 'host-unreachable';
  }
  if (s.includes('connection refused')) return 'connection-refused';
  if (s.includes('timed out') || s.includes('operation timed out')) return 'timeout';
  return 'command-failed';
}

export interface RunOptions {
  timeoutMs?: number;
  stdin?: string;
  /** Extra ssh flags prepended before the target. Ignored for local targets. */
  sshArgs?: string[];
}

/**
 * Run a command against the given target. For ssh, uses BatchMode so it never
 * prompts and accept-new hostkey handling so fresh hosts don't fail but
 * known-host mismatches still error. For local, spawns the same wire command
 * via `bash -c` so quoting behaves identically to the remote path (the remote
 * shell re-parses ssh's joined argv, so we pre-quote each token).
 */
export async function run(
  target: CommandTarget,
  argv: string[],
  opts: RunOptions = {},
): Promise<SSHResult> {
  // The ssh client joins multi-arg commands with single spaces and the
  // remote shell re-parses the result, stripping any quoting we put in
  // argv. Pre-quote each token so the remote shell reconstructs the
  // intended argv exactly, and pass the joined string as a single
  // positional arg so ssh has nothing to re-join. We feed the same quoted
  // string to `bash -c` locally so behavior matches across kinds.
  const wireCmd = argv.map(shellQuote).join(' ');
  const timeout = opts.timeoutMs ?? 15_000;

  const spawnArgs =
    target.kind === 'ssh'
      ? [
          'ssh',
          '-o',
          'BatchMode=yes',
          '-o',
          'StrictHostKeyChecking=accept-new',
          '-o',
          `ConnectTimeout=${Math.max(2, Math.floor(timeout / 1000))}`,
          '-p',
          String(target.port),
          ...(opts.sshArgs ?? []),
          `${target.user}@${target.host}`,
          '--',
          wireCmd,
        ]
      : ['bash', '-c', wireCmd];

  const proc = Bun.spawn(spawnArgs, {
    stdin: opts.stdin ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (opts.stdin && proc.stdin) {
    const writer = proc.stdin as unknown as { write: (c: string) => void; end: () => void };
    writer.write(opts.stdin);
    writer.end();
  }

  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {}
  }, timeout);

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(killer);

  if (timedOut) {
    return {
      code: 124,
      stdout,
      stderr: `${stderr}\noperation timed out after ${timeout}ms`.trim(),
    };
  }
  return { code: code ?? 1, stdout, stderr };
}
