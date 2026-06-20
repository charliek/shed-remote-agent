import {
  type RcKind,
  type RcSession,
  rcSessionDtoSchema,
  rcSessionsDtoResponseSchema,
} from '@shed-remote-agent/shared';
import { AppError } from './errors.js';
import { DEFAULT_WORKDIR, RC_CREATED_BY, toRcSession } from './rc.js';
import { type CommandTarget, classifySSHError, run } from './ssh.js';

/**
 * Name (or path) of the guest binary. Defaults to `shed-ext-rc` (on PATH in the
 * shed `full` image). Overridable via SHED_EXT_RC_BIN for dev/proof, where the
 * binary is scp'd to e.g. /tmp/shed-ext-rc before it's baked into the image.
 */
export function rcBin(): string {
  return process.env.SHED_EXT_RC_BIN || 'shed-ext-rc';
}

/** Injectable command runner (defaults to the SSH `run`). */
export type Runner = typeof run;

/**
 * Map a non-zero `shed-ext-rc` invocation to an AppError. Two error layers meet
 * here: the binary's own exit codes (2/3/4 — domain) and the SSH transport
 * (255 auth/unreachable, 127 missing binary, 124 timeout). 0 never reaches here.
 */
function rcError(result: { code: number; stdout: string; stderr: string }): AppError {
  const detail = (result.stderr || result.stdout).trim();
  // Binary domain exit codes FIRST, so a domain message that happens to contain
  // "command not found"/"no such file" isn't misread as a missing binary.
  if (result.code === 3)
    return new AppError('RC_SLUG_TAKEN', detail || 'rc slug already taken', 409);
  if (result.code === 4) return new AppError('RC_NOT_FOUND', detail || 'rc session not found', 404);
  if (result.code === 2) return new AppError('RC_BAD_REQUEST', detail || 'invalid rc request', 400);
  // The remote shell couldn't find/run the binary at all (127 = command not found).
  if (result.code === 127 || /command not found/i.test(result.stderr)) {
    return new AppError(
      'SHED_EXT_RC_MISSING',
      'shed-ext-rc is not installed on this shed — update the shed image',
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
  return new AppError('RC_FAILED', detail || `shed-ext-rc exited ${result.code}`, 500);
}

/**
 * Decode the binary's stdout against a schema. A parse/shape failure is the guest
 * binary's contract violation (a stale/broken shed-ext-rc) → 502, NOT a client 400
 * (a bare Zod `.parse()` would be mapped to VALIDATION_ERROR by the global handler).
 */
function decode<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  stdout: string,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new AppError('RC_FAILED', 'shed-ext-rc returned non-JSON output', 502);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('RC_FAILED', 'shed-ext-rc returned an invalid session DTO', 502);
  }
  return result.data;
}

/** A managed/unmanaged session's `<shed>/<slug>` display fallback (applied app-side
 * because the binary, running inside the shed, doesn't know the shed alias). */
function shedFallback(shed: string): (slug: string) => string {
  return (slug) => `${shed}/${slug}`;
}

export interface ShedCreateOptions {
  target: CommandTarget;
  host: string;
  shed: string;
  kind: RcKind;
  slug: string;
  displayName: string;
  /** Explicit workdir; omit to let the binary resolve $SHED_WORKSPACE. */
  workdir?: string;
  targetLabel: string;
  /** Kickoff line, delivered via stdin (claude-rc: a prompt; shell: a command). */
  prompt?: string;
}

/**
 * Create a session by invoking `shed-ext-rc create --wait` over SSH (the binary
 * resolves the workdir, pre-seeds trust, bootstraps, polls to ready, accepts trust,
 * and delivers the prompt), then adapt its DTO to the wire RcSession.
 */
export async function shedRcCreate(
  opts: ShedCreateOptions,
  runner: Runner = run,
): Promise<RcSession> {
  const args = [
    rcBin(),
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
  if (opts.workdir) args.push('--workdir', opts.workdir);
  if (opts.prompt) args.push('--prompt-stdin');

  // --wait blocks up to ~20s inside the shed; give SSH headroom over that.
  const result = await runner(opts.target, args, { timeoutMs: 30_000, stdin: opts.prompt });
  if (result.code !== 0) throw rcError(result);

  const dto = decode(rcSessionDtoSchema, result.stdout);
  return toRcSession(
    { ...dto, display_name: dto.display_name ?? shedFallback(opts.shed)(dto.slug) },
    {
      target: { kind: 'shed', shed_name: opts.shed, host: opts.host },
      defaultWorkdir: DEFAULT_WORKDIR,
    },
  );
}

/** List a shed's RC sessions via `shed-ext-rc list`, adapting each DTO. */
export async function shedRcList(
  opts: { target: CommandTarget; host: string; shed: string },
  runner: Runner = run,
): Promise<RcSession[]> {
  const result = await runner(opts.target, [rcBin(), 'list'], { timeoutMs: 15_000 });
  if (result.code !== 0) throw rcError(result);

  const { rc_sessions } = decode(rcSessionsDtoResponseSchema, result.stdout);
  const fallback = shedFallback(opts.shed);
  return rc_sessions.map((dto) =>
    toRcSession(
      { ...dto, display_name: dto.display_name ?? fallback(dto.slug) },
      {
        target: { kind: 'shed', shed_name: opts.shed, host: opts.host },
        defaultWorkdir: DEFAULT_WORKDIR,
      },
    ),
  );
}

/** Kill a shed RC session via `shed-ext-rc kill` (idempotent — the binary exits 0
 * for an already-gone session). */
export async function shedRcKill(
  opts: { target: CommandTarget; slug: string },
  runner: Runner = run,
): Promise<void> {
  const result = await runner(opts.target, [rcBin(), 'kill', '--slug', opts.slug], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) throw rcError(result);
}
