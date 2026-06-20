import {
  DEFAULT_RC_KIND,
  hasControlChars,
  MIN_MANAGED_RC_VERSION,
  RC_SCHEMA_VERSION,
  type RcKind,
  type RcSession,
  type RcState,
  type RcTarget,
} from '@shed-remote-agent/shared';
import apiPkg from '../../package.json';
import { AppError } from './errors.js';
import { shellQuote } from './shell.js';
import { type CommandTarget, classifySSHError, run } from './ssh.js';

export const RC_PREFIX = 'rc-';
export const DEFAULT_WORKDIR = '/workspace';

/**
 * sh snippet (run as `sh -c <script> _ <workdir>`) that marks `<workdir>` trusted
 * in Claude Code's config so the first-run workspace-trust prompt never appears.
 * It merges (never clobbers, to preserve OAuth/MCP state) into
 * `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json` via jq, writing atomically. Verified
 * on claude 2.1.178. `\$` escapes keep these as shell/jq tokens, not TS interpolation.
 */
const PRESEED_TRUST_SCRIPT =
  `f="\${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"; d="$1"; ` +
  `mkdir -p "$(dirname "$f")" 2>/dev/null || true; tmp="$f.sra-tmp.$$"; ` +
  `if [ -s "$f" ]; then cat "$f"; else echo '{}'; fi | ` +
  `jq --arg d "$d" '.projects[$d].hasTrustDialogAccepted = true' > "$tmp" 2>/dev/null; ` +
  // Only install the temp if it's valid JSON — never replace .claude.json with
  // empty/partial output (POSIX sh has no pipefail to catch a failed `cat`).
  `if jq -e . "$tmp" >/dev/null 2>&1; then mv "$tmp" "$f"; else rm -f "$tmp" 2>/dev/null; fi`;

/** Re-export the convention schema version (owned by @shed-remote-agent/shared,
 * stamped into SHED_RC_V). v2 for the kind rename. */
export { RC_SCHEMA_VERSION };
/** Stable tool identifier for SHED_RC_CREATED_BY. MUST NOT contain '/'. */
export const RC_TOOL_NAME = 'shed-remote-agent';
/** `<tool>/<version>` provenance string. The version is read from this package's
 * own version field — NOT package.json `name`, which is "api". */
export const RC_CREATED_BY = `${RC_TOOL_NAME}/${apiPkg.version}`;

// Well-known SHED_RC_* session-env keys — the cross-tool RC Session Convention
// v1. The tmux session is the source of truth; any tool that can read these
// keys can discover, classify, attach to, and tear down a session.
const ENV = {
  v: 'SHED_RC_V',
  id: 'SHED_RC_ID',
  displayName: 'SHED_RC_DISPLAY_NAME',
  kind: 'SHED_RC_KIND',
  workdir: 'SHED_RC_WORKDIR',
  createdBy: 'SHED_RC_CREATED_BY',
  createdAt: 'SHED_RC_CREATED_AT',
  target: 'SHED_RC_TARGET',
} as const;
const ENV_PREFIX = 'SHED_RC_';

// Section markers for the batched list-and-probe script. Built from a random
// per-invocation nonce so neither arbitrary pane text nor metadata values
// (e.g. a display name of "---RC-PANE---") can collide with a delimiter and
// corrupt block parsing.
export interface ListMarkers {
  session: string;
  env: string;
  pane: string;
}
function rcListMarkers(nonce: string): ListMarkers {
  const base = `@@RC:${nonce}`;
  return { session: `${base}:S`, env: `${base}:E`, pane: `${base}:P` };
}

// RFC3339 UTC with a trailing Z (the shape Date.prototype.toISOString produces).
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

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

/** Enforce the convention's value grammar: single-line UTF-8, no control
 * characters. The list parser is line-oriented, so an embedded newline would
 * corrupt parsing of every session that follows. */
function assertEnvValue(key: string, value: string): string {
  if (hasControlChars(value)) {
    throw new AppError('BAD_REQUEST', `${key} must not contain control characters`, 400);
  }
  return value;
}

export interface RcMetadata {
  id: string;
  displayName: string;
  kind: RcKind;
  workdir: string;
  createdBy: string;
  createdAt: string;
  /** Optional, advisory target label (non-authoritative). */
  target?: string;
}

/**
 * Raw, unescaped SHED_RC_* key/value pairs in deterministic order. The single
 * source of truth for the metadata a managed RC session carries (v2).
 */
export function rcMetaEnv(meta: RcMetadata): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    [ENV.v, String(RC_SCHEMA_VERSION)],
    [ENV.id, meta.id],
    [ENV.displayName, meta.displayName],
    [ENV.kind, meta.kind],
    [ENV.workdir, meta.workdir],
    [ENV.createdBy, meta.createdBy],
    [ENV.createdAt, meta.createdAt],
  ];
  if (meta.target) pairs.push([ENV.target, meta.target]);
  return pairs;
}

/**
 * Build the `-e KEY=value …` argv fragment for `tmux new-session`, escaping each
 * value for tmux's internal parser. Pure — unit-tested without a real tmux.
 */
export function buildRcEnvArgs(meta: RcMetadata): string[] {
  const args: string[] = [];
  for (const [k, v] of rcMetaEnv(meta)) {
    // The value is passed raw. run() shell-quotes every token, so tmux receives
    // each KEY=value as a single argv element and stores it verbatim — no tmux
    // escaping needed. (Backslash-escaping here is stored literally; verified
    // against tmux 3.6.) assertEnvValue enforces the single-line grammar.
    args.push('-e', `${k}=${assertEnvValue(k, v)}`);
  }
  return args;
}

/**
 * Parse a `tmux show-environment` dump into SHED_RC_* key→value. tmux prints
 * `KEY=value` for set vars (and a bare `-KEY` for removed ones, which we skip).
 */
export function parseRcEnv(dump: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of dump.split('\n')) {
    if (!line.startsWith(ENV_PREFIX)) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return out;
}

function normalizeCreatedAt(raw: string | undefined): string | undefined {
  return raw && RFC3339_UTC.test(raw) ? raw : undefined;
}

/** A session is "managed" only when SHED_RC_V is a positive integer. Missing or
 * malformed versions are treated as legacy/unmanaged. A version higher than the
 * one we know is still managed (forward-compat): we render the fields we
 * understand and never drop the session. */
function isManagedVersion(raw: string | undefined): boolean {
  // Strictly a canonical positive integer — reject exotic numeric spellings
  // (1e3, 0x1, 1.0, +1) so foreign/hostile input matches the spec's grammar.
  // Managed iff >= the reader's floor: a v1 session (SHED_RC_V=1, old kind
  // grammar) is unmanaged/foreign; a version above the floor (incl. a future
  // one) is managed — known fields rendered, session never dropped.
  return raw !== undefined && /^\d+$/.test(raw) && Number(raw) >= MIN_MANAGED_RC_VERSION;
}

/** tmux refuses to create a session whose name already exists. A caller-supplied
 * slug that's already taken surfaces here — a 409 (conflict), not a 500. */
export function isDuplicateSessionError(stderr: string): boolean {
  return /duplicate session|already exists/i.test(stderr);
}

/** tmux kill-session returns non-zero when the session is already gone — either
 * the session name is unknown, or killing the last session stopped the server
 * entirely ("no server running on …"). Both mean "already gone", so treating
 * them as success keeps kill idempotent. */
export function isMissingSessionError(stderr: string): boolean {
  return /can't find session|no session|no server running/i.test(stderr);
}

/**
 * Builds the inner command the tmux session runs. Three shapes:
 *   claude-broker – the broker, hosts up to 32 cloud-driven sessions.
 *   claude-rc     – an interactive `claude` REPL with `/rc` enabled on top, so the
 *                   live conversation is what attachers see.
 *   shell         – a plain login bash; used for ad-hoc terminal access.
 *
 * When `interactiveShell` is true, the claude kinds are wrapped in `bash -ic` so
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
      case 'claude-broker':
        return `claude remote-control --name ${shellQuote(displayName)} --spawn same-dir`;
      case 'claude-rc':
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
  target: CommandTarget;
  /** Display name for the tmux session and `--name` flag. Defaults to slug. */
  displayName?: string;
  /** Optional fallback used when displayName is not provided; receives the
   * generated/passed slug so the caller can build e.g. `<shed>/<slug>`. */
  displayNameFallback?: (slug: string) => string;
  /** Working directory inside the tmux session. */
  workdir?: string;
  slug?: string;
  kind?: RcKind;
  /** Stable session id stored as SHED_RC_ID. Defaults to a generated UUIDv4. */
  id?: string;
  /** Provenance `<tool>/<version>` stored as SHED_RC_CREATED_BY. Defaults to
   * this tool's RC_CREATED_BY. */
  createdBy?: string;
  /** Creation timestamp (RFC3339 UTC) stored as SHED_RC_CREATED_AT. Defaults to
   * the current time. */
  createdAt?: string;
  /** Optional advisory target label stored as SHED_RC_TARGET (non-authoritative;
   * e.g. `shed:<name>@<host>` or `machine:<name>`). */
  targetLabel?: string;
  /** Wrap repl/agent commands with `bash -ic` so the user's ~/.bashrc runs
   * and PATH-mutating tools (nvm/asdf/pnpm) are picked up. Default false —
   * sheds bake claude into a system path so they don't need it. Set true
   * for native machines. */
  interactiveShell?: boolean;
}

export interface BootstrapResult {
  slug: string;
  tmuxSession: string;
  displayName: string;
  workdir: string;
  kind: RcKind;
  id: string;
  createdBy: string;
  createdAt: string;
  target?: string;
}

export async function bootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
  const slug = opts.slug ?? genSlug();
  const displayName = opts.displayName ?? opts.displayNameFallback?.(slug) ?? slug;
  const workdir = opts.workdir ?? DEFAULT_WORKDIR;
  const kind = opts.kind ?? DEFAULT_RC_KIND;
  const name = tmuxName(slug);
  const id = opts.id ?? crypto.randomUUID();
  const createdBy = opts.createdBy ?? RC_CREATED_BY;
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const target = opts.targetLabel;

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
  const envArgs = buildRcEnvArgs({ id, displayName, kind, workdir, createdBy, createdAt, target });
  const result = await run(
    opts.target,
    ['tmux', 'new-session', '-d', '-s', name, '-c', workdir, ...envArgs, inner],
    { timeoutMs: 10_000 },
  );

  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    const combined = `${result.stderr}\n${result.stdout}`.trim();
    // A caller-supplied slug that's already taken is a "stepped on each other"
    // case, not a server fault — surface it as a 409 so the caller can retry
    // with a fresh slug instead of seeing a generic 500.
    if (isDuplicateSessionError(result.stderr)) {
      throw new AppError('RC_SLUG_TAKEN', `RC session "${name}" already exists`, 409);
    }
    if (cls === 'auth-denied') {
      throw new AppError('SSH_AUTH_DENIED', `SSH authentication denied: ${combined}`, 401);
    }
    if (cls === 'host-unreachable' || cls === 'connection-refused' || cls === 'timeout') {
      throw new AppError('SSH_UNREACHABLE', `SSH connection failed (${cls}): ${combined}`, 502);
    }
    throw new AppError('BOOTSTRAP_FAILED', combined || `ssh exited ${result.code}`, 500);
  }

  return { slug, tmuxSession: name, displayName, workdir, kind, id, createdBy, createdAt, target };
}

export async function kill(opts: { target: CommandTarget; slug: string }): Promise<void> {
  const name = tmuxName(opts.slug);
  const result = await run(opts.target, ['tmux', 'kill-session', '-t', name], {
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
  if (isMissingSessionError(result.stderr)) return;

  throw new AppError('KILL_FAILED', result.stderr.trim() || `ssh exited ${result.code}`, 502);
}

export async function probe(opts: {
  target: CommandTarget;
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
  const result = await run(opts.target, ['tmux', 'capture-pane', '-t', name, '-p', '-S', '-200'], {
    timeoutMs: 5_000,
  });

  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    if (cls === 'ok' || cls === 'command-failed') return { state: 'dead' };
    throw new AppError('SSH_ERROR', `ssh ${cls}: ${result.stderr.trim()}`, 502);
  }
  return classifyPane(opts.kind, result.stdout);
}

/**
 * Resolve a shed's RC working directory from the live `SHED_WORKSPACE` env var
 * (the shed's landing dir — `/home/shed` or `/home/shed/<proj>` for a
 * repo/local-dir shed). Recent sheds no longer have a static `/workspace`.
 *
 * Returns the dir, or `undefined` when the var is unset (an old shed → the
 * caller falls back to {@link DEFAULT_WORKDIR}). A *transport* failure (we
 * couldn't reach the shed at all) throws rather than silently misplacing the
 * session in a `/workspace` that may not exist. `runner` is injectable for tests.
 */
export async function resolveShedWorkdir(
  target: CommandTarget,
  runner: typeof run = run,
): Promise<string | undefined> {
  const res = await runner(target, ['printenv', 'SHED_WORKSPACE'], { timeoutMs: 5_000 });
  if (res.code === 0) {
    const dir = res.stdout.trim();
    // Empty or control-char-laden value: ignore and fall back rather than feed
    // garbage into `tmux -c` / `SHED_RC_WORKDIR`.
    return dir && !hasControlChars(dir) ? dir : undefined;
  }
  // `printenv VAR` exits with EXACTLY 1 when the var is unset — that's an old
  // shed, not an error, so fall back. Any other non-zero code is an SSH/transport
  // failure (255 connection closed, 124 timeout, …) which we must NOT mistake for
  // "old shed" — otherwise we'd silently place the session in a `/workspace` that
  // doesn't exist on a recent shed. Surface it (auth→401 like bootstrap, else 502).
  if (res.code === 1) return undefined;
  const cls = classifySSHError(res.stderr, res.code);
  if (cls === 'auth-denied') {
    throw new AppError('SSH_AUTH_DENIED', 'ssh auth denied resolving shed workspace', 401);
  }
  throw new AppError('SSH_UNREACHABLE', `could not resolve shed workspace (${cls})`, 502);
}

/**
 * Best-effort: pre-accept Claude Code's workspace-trust for `workdir` before
 * launch, so a fresh repl/agent reaches `ready` without the manual trust step.
 * Never throws — if the merge fails (no `jq`, odd config layout, …) the
 * send-keys fallback in {@link probeUntilReady} still accepts the prompt.
 */
export async function preseedTrust(
  target: CommandTarget,
  workdir: string,
  runner: typeof run = run,
): Promise<void> {
  try {
    await runner(target, ['sh', '-c', PRESEED_TRUST_SCRIPT, '_', workdir], { timeoutMs: 5_000 });
  } catch {
    // ignore — the interactive accept covers any pre-seed failure.
  }
}

/**
 * Accept the first-run trust prompt by pressing Enter (the "1. Yes, I trust this
 * folder" option is pre-selected). Best-effort — used as `probeUntilReady`'s
 * `acceptTrust` fallback when the pre-seed didn't take.
 */
export async function sendTrustAccept(
  target: CommandTarget,
  tmuxSession: string,
  runner: typeof run = run,
): Promise<void> {
  try {
    await runner(target, ['tmux', 'send-keys', '-t', tmuxSession, 'Enter'], { timeoutMs: 5_000 });
  } catch {
    // best-effort; probeUntilReady surfaces needs-trust if it didn't clear.
  }
}

/**
 * Type a kickoff line into a ready `claude-rc` (prompt) or `shell` (command) session
 * and submit it. Best-effort — the session is the deliverable; a failed send must not
 * fail the create. `-l` sends it literally (not as tmux key names); Enter submits.
 */
export async function sendInitialPrompt(
  target: CommandTarget,
  tmuxSession: string,
  prompt: string,
  runner: typeof run = run,
): Promise<void> {
  try {
    await runner(target, ['tmux', 'send-keys', '-t', tmuxSession, '-l', prompt], {
      timeoutMs: 5_000,
    });
    await runner(target, ['tmux', 'send-keys', '-t', tmuxSession, 'Enter'], { timeoutMs: 5_000 });
  } catch {
    // best-effort.
  }
}

function extractUrl(kind: RcKind, pane: string): string | undefined {
  if (kind === 'claude-broker') {
    return pane.match(/https?:\/\/claude\.ai\/code\?environment=env_[A-Za-z0-9_-]+/)?.[0];
  }
  if (kind === 'claude-rc') {
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

  if (kind === 'claude-broker') {
    const url = extractUrl('claude-broker', pane);
    if (/\bReconnecting\b/.test(pane)) return { state: 'reconnecting', url };
    if (/\bConnected\b/.test(pane) && url) return { state: 'ready', url };
    if (url) return { state: 'ready', url };
    return { state: 'starting' };
  }

  if (kind === 'claude-rc') {
    const url = extractUrl('claude-rc', pane);
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
  if (raw === 'claude-broker' || raw === 'claude-rc' || raw === 'shell') return raw;
  // Unrecognized kind value (an old `agent`/`repl`, or anything foreign) under
  // v2: default to `claude-broker` — the renamed analog of the pre-convention
  // default (sessions were all brokers). Intentionally different from the
  // create-time default (DEFAULT_RC_KIND = 'claude-rc').
  return 'claude-broker';
}

export interface RawRcSession {
  slug: string;
  tmux_session: string;
  display_name: string;
  /** The workdir captured at bootstrap (via SHED_RC_WORKDIR). Undefined for
   * legacy/unmanaged sessions; callers fall back to their target default. */
  workdir?: string;
  kind: RcKind;
  state: RcState;
  url?: string;
  /** Stable session id (SHED_RC_ID). Undefined for legacy/unmanaged sessions. */
  id?: string;
  created_by?: string;
  created_at?: string;
  /** Advisory target label (SHED_RC_TARGET); non-authoritative. Matches the
   * wire field name so {@link toRcSession} can copy it through. */
  target_label?: string;
  /** True when SHED_RC_V is present (created under the convention). */
  managed: boolean;
}

/**
 * Project the target-agnostic {@link RawRcSession} onto the wire
 * {@link RcSession}. This is the single place the metadata field set crosses to
 * the wire, so a new SHED_RC_* field added to RawRcSession reaches every route
 * (list and create, shed and machine) without editing each mapper.
 */
export function toRcSession(
  raw: RawRcSession,
  opts: { target: RcTarget; defaultWorkdir: string },
): RcSession {
  return {
    ...raw,
    // Legacy/unmanaged sessions don't carry a workdir; fall back to the
    // caller's target-specific default.
    workdir: raw.workdir ?? opts.defaultWorkdir,
    target: opts.target,
  };
}

export interface ParseRcSessionInput {
  tmuxSession: string;
  /** A `tmux show-environment` dump filtered to SHED_RC_* lines. */
  envDump: string;
  pane: string;
  /** Used when a session has no SHED_RC_DISPLAY_NAME. Receives the slug. */
  displayNameFallback?: (slug: string) => string;
}

/**
 * Reconstruct one RC session's wire-shape from its tmux env dump + pane. Pure
 * (no SSH/tmux) so it can be unit-tested directly. State/url stay derived from
 * the pane via the classifier; they are never stored.
 */
export function parseRcSession(input: ParseRcSessionInput): RawRcSession {
  const env = parseRcEnv(input.envDump);
  const slug = input.tmuxSession.slice(RC_PREFIX.length);

  // Legacy/unmanaged: no valid SHED_RC_V (>= 2). Any stray SHED_RC_* values are
  // not under a known schema version, so ignore them and apply legacy defaults
  // (kind=claude-broker, fallback display name, caller's target-default workdir).
  if (!isManagedVersion(env.get(ENV.v)?.trim())) {
    const kind: RcKind = 'claude-broker';
    const { state, url } = classifyPane(kind, input.pane);
    return {
      slug,
      tmux_session: input.tmuxSession,
      display_name: input.displayNameFallback?.(slug) || slug,
      kind,
      state,
      url,
      managed: false,
    };
  }

  const kind = parseKind((env.get(ENV.kind) ?? '').trim());
  const { state, url } = classifyPane(kind, input.pane);
  const storedName = env.get(ENV.displayName)?.trim();
  const storedWorkdir = env.get(ENV.workdir)?.trim();
  return {
    slug,
    tmux_session: input.tmuxSession,
    display_name: storedName || input.displayNameFallback?.(slug) || slug,
    workdir: storedWorkdir || undefined,
    kind,
    state,
    url,
    id: env.get(ENV.id)?.trim() || undefined,
    created_by: env.get(ENV.createdBy)?.trim() || undefined,
    created_at: normalizeCreatedAt(env.get(ENV.createdAt)?.trim()),
    target_label: env.get(ENV.target)?.trim() || undefined,
    managed: true,
  };
}

/**
 * Split the batched list script's stdout into per-session blocks and parse each.
 * Pure — paired with {@link listRcSessions} which produces the stdout.
 */
export function parseListOutput(
  stdout: string,
  markers: ListMarkers,
  displayNameFallback?: (slug: string) => string,
): RawRcSession[] {
  const blocks = stdout.split(`${markers.session} `).slice(1);
  return blocks.map((block) => {
    // Match markers as whole lines (not substrings): an env value like
    // `SHED_RC_DISPLAY_NAME=...:E` can't be mistaken for the env marker line,
    // and the random nonce keeps pane text from matching either.
    const lines = block.split('\n');
    const tmuxSession = (lines[0] ?? '').trim();
    const envAt = lines.indexOf(markers.env);
    const paneAt = lines.indexOf(markers.pane);
    const envDump =
      envAt === -1 ? '' : lines.slice(envAt + 1, paneAt === -1 ? undefined : paneAt).join('\n');
    const pane = paneAt === -1 ? '' : lines.slice(paneAt + 1).join('\n');

    return parseRcSession({ tmuxSession, envDump, pane, displayNameFallback });
  });
}

/**
 * Single-SSH list-and-probe: fetches every rc-* session's metadata env and pane
 * in one remote shell invocation so a page load doesn't pay N+1 SSH handshakes.
 * One `show-environment` dump per session (filtered to SHED_RC_*) keeps it to a
 * single tmux call per session even as the key set grows.
 *
 * Returns target-agnostic data; callers wrap with shed/machine identifiers and a
 * workdir default.
 */
export async function listRcSessions(opts: {
  target: CommandTarget;
  /** Used when a tmux session has no SHED_RC_DISPLAY_NAME (e.g. a legacy or
   * foreign rc-* session). Receives the slug. */
  displayNameFallback?: (slug: string) => string;
}): Promise<RawRcSession[]> {
  const markers = rcListMarkers(crypto.randomUUID());
  const script = `
names=$(tmux ls -F '#{session_name}' 2>/dev/null | grep '^${RC_PREFIX}' || true)
for n in $names; do
  echo "${markers.session} $n"
  echo "${markers.env}"
  tmux show-environment -t "$n" 2>/dev/null | grep '^${ENV_PREFIX}' || true
  echo "${markers.pane}"
  tmux capture-pane -t "$n" -p -S -200 2>/dev/null || true
done
`;
  // Pipe the script via stdin instead of `bash -lc`. On shed images where the
  // user has no controlling terminal, tmux invoked as a child of `bash -c`
  // fails with "open terminal failed: not a terminal", but works when bash
  // reads commands from stdin (the parent process layout differs).
  const result = await run(opts.target, ['bash'], {
    stdin: script,
    timeoutMs: 8_000,
  });

  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    if (cls === 'ok' || cls === 'command-failed') return [];
    throw new AppError('SSH_ERROR', `ssh ${cls}: ${result.stderr.trim()}`, 502);
  }

  return parseListOutput(result.stdout, markers, opts.displayNameFallback);
}

export async function probeUntilReady(opts: {
  target: CommandTarget;
  slug: string;
  kind: RcKind;
  timeoutMs?: number;
  /**
   * Called once if the workspace-trust prompt appears, to accept it (the route
   * sends `tmux send-keys Enter`). The fallback for when the pre-seed didn't take.
   */
  acceptTrust?: () => Promise<void>;
  /** Injectable for tests. */
  probeFn?: (o: { target: CommandTarget; slug: string; kind: RcKind }) => Promise<{
    state: RcState;
    url?: string;
  }>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ state: RcState; url?: string }> {
  const probeOnce = opts.probeFn ?? probe;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let last: { state: RcState; url?: string } = { state: 'starting' };
  let trustAccepted = false;
  while (Date.now() < deadline) {
    last = await probeOnce({ target: opts.target, slug: opts.slug, kind: opts.kind });
    // Auto-accept the first-run trust prompt once, then keep polling so claude
    // can proceed to `ready`. If it never clears, we fall through and surface
    // `needs-trust` as before.
    if (last.state === 'needs-trust' && opts.acceptTrust && !trustAccepted) {
      trustAccepted = true;
      await opts.acceptTrust();
      // Keep `last` as needs-trust (don't mask it as starting): the `continue`
      // already skips the return below, and if the deadline expires during the
      // accept/sleep we correctly surface needs-trust rather than starting.
      await sleep(750);
      continue;
    }
    if (last.state !== 'starting') return last;
    await sleep(750);
  }
  return last;
}
