import {
  type RcCapabilities,
  type RcKind,
  type RcSession,
  type RcSessionDto,
  rcSessionDtoSchema,
  rcSessionsDtoResponseSchema,
} from '@shed-remote-agent/shared';
import { AppError } from './errors.js';
import { RC_CREATED_BY } from './rc.js';
import { type CommandTarget, classifySSHError, run } from './ssh.js';

// The RC Session Convention binaries — shed-ext-rc (guest, inside a shed) and
// shed-machine-rc (host, on a native machine) — share one create/list/kill flow,
// one exit-code → AppError mapping, and one DTO decode. This module owns all of
// that; shedRc.ts / machineRc.ts supply only the binary, the missing-binary error,
// and the DTO → wire adapter.

/** Injectable command runner (defaults to the SSH `run`). */
export type Runner = typeof run;

/** The transport identity of an RC-binary invocation: which binary to run, and the
 *  error to raise when it can't be run. */
export interface RcBin {
  /** Resolved binary name or absolute path to invoke. */
  bin: string;
  /** Error for a binary that couldn't be run (exit 127 not-found / 126 not-executable,
   *  or — off SSH transport — a "command not found"/"no such file" stderr). */
  missing: () => AppError;
}

/** An {@link RcBin} plus the adapter that wraps the neutral DTO the binary prints into
 *  the caller's wire RcSession (target shape + display fallback + workdir default). */
export interface RcBinClient extends RcBin {
  adapt: (dto: RcSessionDto) => RcSession;
}

/**
 * Map a non-zero invocation to an AppError. Binary domain codes (2/3/4) FIRST, so a
 * domain message that happens to contain "command not found"/"no such file" isn't
 * misread as a missing binary. Then the run() overall-timeout (124, ssh or local).
 * Then missing-binary: 127/126 always, plus — off the SSH-transport exit (255) — a
 * matching stderr, so an SSH-layer "No such file" (e.g. a missing identity file,
 * which exits 255) isn't misclassified. Then SSH transport. Code 0 never reaches here.
 */
function rcError(
  client: RcBin,
  result: { code: number; stdout: string; stderr: string },
): AppError {
  const detail = (result.stderr || result.stdout).trim();
  if (result.code === 3)
    return new AppError('RC_SLUG_TAKEN', detail || 'rc slug already taken', 409);
  if (result.code === 4) return new AppError('RC_NOT_FOUND', detail || 'rc session not found', 404);
  if (result.code === 2) return new AppError('RC_BAD_REQUEST', detail || 'invalid rc request', 400);

  // run() synthesizes 124 on its overall timeout for ssh OR local targets — a
  // slow/hung RC binary, not necessarily an SSH-connection problem; surface it as an
  // RC timeout rather than letting classifySSHError bucket it as SSH-unreachable.
  if (result.code === 124) {
    return new AppError('RC_FAILED', detail || `${client.bin} timed out`, 502);
  }
  if (
    result.code === 126 ||
    result.code === 127 ||
    (result.code !== 255 && /command not found|no such file/i.test(result.stderr))
  ) {
    return client.missing();
  }

  const cls = classifySSHError(result.stderr, result.code);
  if (cls === 'auth-denied') {
    return new AppError('SSH_AUTH_DENIED', `SSH authentication denied: ${detail}`, 401);
  }
  if (cls === 'host-unreachable' || cls === 'connection-refused' || cls === 'timeout') {
    return new AppError('SSH_UNREACHABLE', `SSH connection failed (${cls}): ${detail}`, 502);
  }
  // Any other non-zero exit is an upstream binary/transport failure (like a missing
  // binary or a DTO-contract failure) — 502, not a server-fault 500.
  return new AppError('RC_FAILED', detail || `${client.bin} exited ${result.code}`, 502);
}

/** Decode the binary's stdout against a schema. A parse/shape failure is the binary's
 *  contract violation (a stale/broken binary) → 502, NOT a client 400. */
function decode<T>(
  client: RcBin,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  stdout: string,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new AppError('RC_FAILED', `${client.bin} returned non-JSON output`, 502);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('RC_FAILED', `${client.bin} returned an invalid session DTO`, 502);
  }
  return result.data;
}

export interface RcCreateArgs {
  target: CommandTarget;
  kind: RcKind;
  slug: string;
  displayName: string;
  targetLabel: string;
  /** Explicit workdir; a literal "~" or empty is omitted so the binary resolves
   *  $SHED_WORKSPACE → $HOME (tmux can't expand "~"). */
  workdir?: string;
  /** Kickoff line, delivered via stdin (claude-rc: a prompt; shell: a command). */
  prompt?: string;
}

/**
 * Create a session by invoking `<bin> create --wait` over the target (the binary
 * resolves the workdir, pre-seeds trust, bootstraps, polls to ready, accepts trust,
 * and delivers the prompt), then adapt its DTO to the wire RcSession.
 */
export async function rcCreate(
  client: RcBinClient,
  args: RcCreateArgs,
  runner: Runner = run,
): Promise<RcSession> {
  const argv = [
    client.bin,
    'create',
    '--kind',
    args.kind,
    '--name',
    args.displayName,
    '--slug',
    args.slug,
    '--created-by',
    RC_CREATED_BY,
    '--target',
    args.targetLabel,
    '--wait',
  ];
  if (args.workdir && args.workdir !== '~') argv.push('--workdir', args.workdir);
  if (args.prompt) argv.push('--prompt-stdin');

  // --wait blocks up to ~20s on the target; give SSH headroom over that.
  const result = await runner(args.target, argv, { timeoutMs: 30_000, stdin: args.prompt });
  if (result.code !== 0) throw rcError(client, result);
  return client.adapt(decode(client, rcSessionDtoSchema, result.stdout));
}

/** An `rcList` result: the adapted sessions plus the capabilities block the binary
 *  embedded in the `list` envelope (undefined for an old binary's bare envelope). */
export interface RcListResult {
  sessions: RcSession[];
  capabilities?: RcCapabilities;
}

/** List a target's RC sessions via `<bin> list`, adapting each DTO and passing the
 *  embedded capabilities block through (one exec feeds both). */
export async function rcList(
  client: RcBinClient,
  target: CommandTarget,
  runner: Runner = run,
): Promise<RcListResult> {
  const result = await runner(target, [client.bin, 'list'], { timeoutMs: 15_000 });
  if (result.code !== 0) throw rcError(client, result);
  const { rc_sessions, capabilities } = decode(client, rcSessionsDtoResponseSchema, result.stdout);
  return { sessions: rc_sessions.map(client.adapt), capabilities };
}

/** Kill a session via `<bin> kill` (idempotent — the binary exits 0 for an
 *  already-gone session). */
export async function rcKill(
  client: RcBin,
  target: CommandTarget,
  slug: string,
  runner: Runner = run,
): Promise<void> {
  const result = await runner(target, [client.bin, 'kill', '--slug', slug], { timeoutMs: 10_000 });
  if (result.code !== 0) throw rcError(client, result);
}
