export interface SSHTarget {
  host: string;
  user: string;
  port: number;
}

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
  /** Extra ssh flags prepended before the target. */
  sshArgs?: string[];
}

/**
 * Run a command over SSH. Uses BatchMode so it never prompts; adds
 * accept-new hostkey handling so fresh hosts don't fail but known-host
 * mismatches still error.
 */
export async function run(
  target: SSHTarget,
  argv: string[],
  opts: RunOptions = {},
): Promise<SSHResult> {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `ConnectTimeout=${Math.max(2, Math.floor((opts.timeoutMs ?? 10_000) / 1000))}`,
    '-p',
    String(target.port),
    ...(opts.sshArgs ?? []),
    `${target.user}@${target.host}`,
    '--',
    ...argv,
  ];

  const proc = Bun.spawn(['ssh', ...args], {
    stdin: opts.stdin ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (opts.stdin && proc.stdin) {
    const writer = proc.stdin as unknown as { write: (c: string) => void; end: () => void };
    writer.write(opts.stdin);
    writer.end();
  }

  const timeout = opts.timeoutMs ?? 15_000;
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
