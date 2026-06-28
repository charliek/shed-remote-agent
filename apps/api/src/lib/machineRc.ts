import {
  type RcKind,
  type RcSession,
  type RcSessionDto,
  rcSessionDtoSchema,
  rcSessionsDtoResponseSchema,
} from '@shed-remote-agent/shared';
import { AppError } from './errors.js';
import { RC_CREATED_BY, toRcSession } from './rc.js';
import { type CommandTarget, classifySSHError, run } from './ssh.js';

/**
 * Resolve the host binary to invoke on a machine. Precedence: the machine's
 * `rc_bin` (an absolute path, for SSH machines whose non-login PATH doesn't include
 * it), then the SHED_MACHINE_RC_BIN dev/proof override, then `shed-machine-rc` on
 * PATH. shed-machine-rc is the host-side sibling of the shed image's shed-ext-rc.
 */
export function machineRcBin(rcBin?: string): string {
  return rcBin || process.env.SHED_MACHINE_RC_BIN || 'shed-machine-rc';
}

/** Injectable command runner (defaults to the SSH `run`). */
export type Runner = typeof run;

/**
 * Map a non-zero `shed-machine-rc` invocation to an AppError. Two error layers meet
 * here: the binary's own exit codes (2/3/4 — domain) and the SSH transport (255
 * auth/unreachable, 127 missing binary, 124 timeout). 0 never reaches here.
 */
function rcError(result: { code: number; stdout: string; stderr: string }, bin: string): AppError {
  const detail = (result.stderr || result.stdout).trim();
  // Binary domain exit codes FIRST, so a domain message that happens to contain
  // "command not found"/"no such file" isn't misread as a missing binary.
  if (result.code === 3)
    return new AppError('RC_SLUG_TAKEN', detail || 'rc slug already taken', 409);
  if (result.code === 4) return new AppError('RC_NOT_FOUND', detail || 'rc session not found', 404);
  if (result.code === 2) return new AppError('RC_BAD_REQUEST', detail || 'invalid rc request', 400);
  // The binary couldn't be run: 127 = not found, 126 = found-but-not-executable.
  // On an SSH machine "not found" is most often a non-login PATH gap (or a bad
  // rc_bin), not a real absence — name the fix. Checked BEFORE classifySSHError so a
  // 126 "Permission denied" isn't misread as an SSH auth failure (401). The stderr
  // fallback is gated to non-transport exits so an SSH-layer "No such file" (e.g. a
  // missing identity file, which exits 255) isn't misread as a missing binary.
  const sshTransport = result.code === 255 || result.code === 124;
  if (
    result.code === 126 ||
    result.code === 127 ||
    (!sshTransport && /command not found|no such file/i.test(result.stderr))
  ) {
    return new AppError(
      'MACHINE_RC_MISSING',
      `${bin} could not be run on the machine (not found or not executable) — install it ` +
        `(\`brew install charliek/tap/shed-machine-rc\` or \`apt install shed-machine-rc\`). If it is ` +
        `installed but not on the machine's non-login SSH PATH (e.g. Apple-Silicon Homebrew under ` +
        `/opt/homebrew/bin), set \`rc_bin\` to its absolute path in the machine config.`,
      502,
    );
  }
  // SSH-transport / timeout (code 255 or 124).
  const cls = classifySSHError(result.stderr, result.code);
  if (cls === 'auth-denied') {
    return new AppError('SSH_AUTH_DENIED', `SSH authentication denied: ${detail}`, 401);
  }
  if (cls === 'host-unreachable' || cls === 'connection-refused' || cls === 'timeout') {
    return new AppError('SSH_UNREACHABLE', `SSH connection failed (${cls}): ${detail}`, 502);
  }
  return new AppError('RC_FAILED', detail || `shed-machine-rc exited ${result.code}`, 500);
}

/**
 * Decode the binary's stdout against a schema. A parse/shape failure is the binary's
 * contract violation (a stale/broken shed-machine-rc) → 502, NOT a client 400.
 */
function decode<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  stdout: string,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new AppError('RC_FAILED', 'shed-machine-rc returned non-JSON output', 502);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('RC_FAILED', 'shed-machine-rc returned an invalid session DTO', 502);
  }
  return result.data;
}

/** Adapt a binary DTO to the wire RcSession for this machine: apply the
 * `<machine>/<slug>` display fallback the binary can't know (it doesn't see the
 * orchestrator's machine name), then wrap with the machine target + workdir default. */
function adaptMachineDto(dto: RcSessionDto, machine: string, defaultWorkdir: string): RcSession {
  return toRcSession(
    { ...dto, display_name: dto.display_name ?? `${machine}/${dto.slug}` },
    { target: { kind: 'machine', machine_name: machine }, defaultWorkdir },
  );
}

export interface MachineCreateOptions {
  target: CommandTarget;
  /** Machine name — the {@link RcTarget} identifier and `<machine>/<slug>` fallback. */
  machine: string;
  /** Per-machine binary override (absolute path) for the non-login PATH case. */
  rcBin?: string;
  kind: RcKind;
  slug: string;
  displayName: string;
  /** Explicit workdir; omit to let the binary resolve $SHED_WORKSPACE → $HOME. */
  workdir?: string;
  targetLabel: string;
  /** Kickoff line, delivered via stdin (claude-rc: a prompt; shell: a command). */
  prompt?: string;
  /** Wire fallback for a legacy/unmanaged session with no SHED_RC_WORKDIR. */
  defaultWorkdir: string;
}

/**
 * Create a session by invoking `shed-machine-rc create --wait` on the machine (the
 * binary resolves the workdir, pre-seeds trust, bootstraps, polls to ready, accepts
 * trust, and delivers the prompt), then adapt its DTO to the wire RcSession.
 */
export async function machineRcCreate(
  opts: MachineCreateOptions,
  runner: Runner = run,
): Promise<RcSession> {
  const bin = machineRcBin(opts.rcBin);
  const args = [
    bin,
    'create',
    '--kind',
    opts.kind,
    '--name',
    opts.displayName,
    '--slug',
    opts.slug,
    '--created-by',
    RC_CREATED_BY,
    '--target',
    opts.targetLabel,
    '--wait',
  ];
  // Only pass --workdir for a real directory — never a literal "~" (tmux wouldn't
  // expand it); omitting it lets the binary resolve $SHED_WORKSPACE → $HOME.
  if (opts.workdir && opts.workdir !== '~') args.push('--workdir', opts.workdir);
  if (opts.prompt) args.push('--prompt-stdin');

  // --wait blocks up to ~20s on the machine; give SSH headroom over that.
  const result = await runner(opts.target, args, { timeoutMs: 30_000, stdin: opts.prompt });
  if (result.code !== 0) throw rcError(result, bin);

  const dto = decode(rcSessionDtoSchema, result.stdout);
  return adaptMachineDto(dto, opts.machine, opts.defaultWorkdir);
}

export interface MachineListOptions {
  target: CommandTarget;
  machine: string;
  rcBin?: string;
  defaultWorkdir: string;
}

/** List a machine's RC sessions via `shed-machine-rc list`, adapting each DTO. */
export async function machineRcList(
  opts: MachineListOptions,
  runner: Runner = run,
): Promise<RcSession[]> {
  const bin = machineRcBin(opts.rcBin);
  const result = await runner(opts.target, [bin, 'list'], { timeoutMs: 15_000 });
  if (result.code !== 0) throw rcError(result, bin);

  const { rc_sessions } = decode(rcSessionsDtoResponseSchema, result.stdout);
  return rc_sessions.map((dto) => adaptMachineDto(dto, opts.machine, opts.defaultWorkdir));
}

/** Kill a machine RC session via `shed-machine-rc kill` (idempotent — the binary
 * exits 0 for an already-gone session). */
export async function machineRcKill(
  opts: { target: CommandTarget; slug: string; rcBin?: string },
  runner: Runner = run,
): Promise<void> {
  const bin = machineRcBin(opts.rcBin);
  const result = await runner(opts.target, [bin, 'kill', '--slug', opts.slug], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) throw rcError(result, bin);
}
