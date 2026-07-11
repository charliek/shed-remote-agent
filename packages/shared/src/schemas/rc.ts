import { z } from 'zod';

export const rcStateSchema = z.enum([
  'starting',
  'ready',
  'reconnecting',
  'needs-trust',
  'needs-auth',
  'dead',
]);
export type RcState = z.infer<typeof rcStateSchema>;

/**
 * Read-path state schema. A newer binary may emit a state token this build doesn't
 * know; per the convention an unknown `state` maps to `starting` rather than failing
 * the whole DTO decode (which would surface as RC_FAILED/502 and drop the session
 * list). The output type stays {@link RcState}, so consumers' exhaustive per-state
 * handling keeps working. Known states pass through untouched.
 */
export const rcStateValueSchema = z
  .string()
  .transform(
    (s): RcState =>
      (rcStateSchema.options as readonly string[]).includes(s) ? (s as RcState) : 'starting',
  );

// RC Session Convention kinds — the multi-agent set. Every kind the guest/host
// binary (shed-ext-rc / shed-machine-rc) can create, in the pinned wire order that
// matches the capabilities `kinds` list:
//   claude-broker – the `claude remote-control` multiplexer/broker
//   claude-rc     – interactive `claude` REPL with `/rc` (the create-time default)
//   codex         – the `codex` TUI
//   opencode      – the `opencode` TUI
//   cursor        – the `cursor-agent` TUI
//   shell         – plain login bash (tool-agnostic)
// This is the KNOWN-kinds enum: it gates create requests and the kind picker. The
// READ path (a session/DTO emitted by the binary) is intentionally more tolerant —
// see {@link rcKindValueSchema} and the unknown-kind policy below.
export const RC_KINDS = [
  'claude-broker',
  'claude-rc',
  'codex',
  'opencode',
  'cursor',
  'shell',
] as const;
export const rcKindSchema = z.enum(RC_KINDS);
export type RcKind = z.infer<typeof rcKindSchema>;

/**
 * Preserve-raw kind schema for the READ path (session/DTO decode). Per the
 * unknown-kind policy, a reader that sees a `SHED_RC_KIND` it doesn't recognize (a
 * session created by a newer client) **keeps the raw string verbatim** and renders it
 * neutrally — it is never rejected and never aliased to `claude-broker`. So the DTO's
 * `kind` accepts any non-empty single-line string; known kinds still autocomplete via
 * the {@link RcKindValue} union. Create requests, by contrast, use the strict
 * {@link rcKindSchema} — you can only create a kind the binary offers.
 */
export type RcKindValue = RcKind | (string & {});
export const rcKindValueSchema = z.string().min(1) as unknown as z.ZodType<RcKindValue>;

export const DEFAULT_RC_KIND: RcKind = 'claude-rc';

/**
 * RC Session Convention **metadata** schema version, stamped into `SHED_RC_V` at
 * create — the on-session tmux-env schema (the `SHED_RC_*` keys). Still **2**:
 * multi-agent support did NOT change the session metadata shape, so this stays put.
 * Deliberately decoupled from {@link RC_CAPABILITY_VERSION} (the capability/protocol
 * version) — a client learns what a shed's binary can do from `rc_version` + the
 * feature list, not from this metadata schema. See
 * docs/reference/rc-session-convention.md.
 */
export const RC_SCHEMA_VERSION = 2;

/**
 * Capability/protocol version advertised by the binary's `capabilities` verb and the
 * `capabilities` block embedded in the `list` envelope (the `rc_version` field).
 * Currently **3**. Bumped when the capability shape or a feature contract changes;
 * **not** tied to {@link RC_SCHEMA_VERSION} (`SHED_RC_V`, still 2).
 */
export const RC_CAPABILITY_VERSION = 3;

/**
 * Lowest `SHED_RC_V` a reader still understands. A managed session is one with
 * `SHED_RC_V >= MIN_MANAGED_RC_VERSION`; below it (a v1 `agent`/`repl` session) is
 * legacy/unmanaged. Deliberately **decoupled** from {@link RC_SCHEMA_VERSION} (what
 * we write): a future *additive* bump raises the write version without raising this
 * floor, so v2 sessions keep being read — honoring the convention's "higher version
 * is still managed, never dropped" rule. Raise this only on a real grammar break.
 */
export const MIN_MANAGED_RC_VERSION = 2;

export const rcTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('shed'),
    shed_name: z.string(),
    host: z.string(),
  }),
  z.object({
    kind: z.literal('machine'),
    machine_name: z.string(),
  }),
]);
export type RcTarget = z.infer<typeof rcTargetSchema>;

export const rcSessionSchema = z.object({
  slug: z.string(),
  tmux_session: z.string(),
  display_name: z.string(),
  workdir: z.string(),
  // Read path: preserve an unrecognized kind verbatim (unknown-kind policy) rather
  // than rejecting it — a session from a newer client stays listable/killable.
  kind: rcKindValueSchema,
  // Read path: an unknown state from a newer binary maps to 'starting' (convention)
  // instead of failing the decode.
  state: rcStateValueSchema,
  url: z.string().optional(),
  error: z.string().optional(),
  target: rcTargetSchema,
  // RC Session Convention v2 metadata (read from the tmux session's SHED_RC_*
  // env). Optional on the wire so legacy/unmanaged sessions still parse.
  /** Stable session id (SHED_RC_ID). Absent on legacy/unmanaged sessions. */
  id: z.string().optional(),
  /** Provenance `<tool>/<version>` (SHED_RC_CREATED_BY). */
  created_by: z.string().optional(),
  /** Creation time, RFC3339 UTC (SHED_RC_CREATED_AT). */
  created_at: z.string().optional(),
  /** Advisory target label (SHED_RC_TARGET); non-authoritative. */
  target_label: z.string().optional(),
  /** True when SHED_RC_V is present (created under the convention). */
  managed: z.boolean().optional(),
});
export type RcSession = z.infer<typeof rcSessionSchema>;

// Convention values must be single-line (no control chars): the cross-tool
// list parser is line-oriented, so a newline in a display name would corrupt it.
// Exported so the API's bootstrap-time guard enforces the same grammar.
export const hasControlChars = (s: string): boolean => {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
};

// .strict(): an unsupported field (e.g. a permission_mode this build doesn't offer
// yet, or a typo'd key) fails validation with a 400 rather than being silently
// stripped and succeeding with defaults — the caller learns immediately.
export const createRcRequestSchema = z.strictObject({
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/)
    .optional(),
  display_name: z
    .string()
    .min(1)
    .max(100)
    .refine((s) => !hasControlChars(s), {
      message: 'display_name must not contain control characters',
    })
    .optional(),
  workdir: z.string().optional(),
  kind: rcKindSchema.optional(),
  /**
   * Optional kickoff line typed into the session once it's ready, then submitted
   * with Enter. For an agent kind (`claude-rc`/`codex`/`opencode`/`cursor`) it's a
   * prompt; for `shell` it's a command to run. Not used for `claude-broker` (its
   * input is the remote URL, not the pane). Single line — control chars (incl.
   * newlines) are rejected.
   */
  initial_prompt: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((s) => !hasControlChars(s), {
      message: 'initial_prompt must be a single line (no control characters)',
    })
    .optional(),
});
export type CreateRcRequest = z.infer<typeof createRcRequestSchema>;

// --- Capabilities (discovery) ----------------------------------------------------
// The capability/protocol block the binary advertises via its `capabilities` verb
// and embeds in the `list` envelope. It replaces error-string sniffing: a client
// reads what a shed's binary can do (kinds, installed agents, feature tokens,
// per-kind UI hints) instead of probing by triggering failures.

/** One agent's install probe under `capabilities.agents`. `version` is omitted when
 *  the agent isn't installed or its version couldn't be read. */
export const rcAgentInfoSchema = z.object({
  installed: z.boolean(),
  version: z.string().optional(),
});
export type RcAgentInfo = z.infer<typeof rcAgentInfoSchema>;

/** Per-kind UI hints under `capabilities.kind_features`. `post_input` = a typed line
 *  can be delivered to the pane; `approvals` = where approvals happen (v1 agents are
 *  TUI-only → `"tui"`). */
export const rcKindFeaturesSchema = z.object({
  post_input: z.boolean(),
  approvals: z.string(),
});
export type RcKindFeatures = z.infer<typeof rcKindFeaturesSchema>;

/**
 * The `capabilities` payload — standalone (`capabilities` verb) and embedded in the
 * `list` envelope. `agents`/`kind_features` are open maps (agents keyed by tool
 * token, kind_features by kind) so an unknown agent/kind from a newer binary decodes
 * without loss. Known feature tokens today: `generic-perm` (the default|auto|skip
 * permission tri-state), `plan-stdin`, `prompt-b64`.
 */
export const rcCapabilitiesSchema = z.object({
  /** Capability/protocol version — {@link RC_CAPABILITY_VERSION} (3), decoupled from
   *  `SHED_RC_V`. */
  rc_version: z.number(),
  /** Every kind this binary offers, in the pinned wire order. */
  kinds: z.array(rcKindValueSchema),
  /** Per-tool install probe, keyed by tool token (`claude`, `codex`, …). */
  agents: z.record(z.string(), rcAgentInfoSchema),
  /** Stable feature tokens (a token is appended in the same change that ships it). */
  features: z.array(z.string()),
  /** Per-kind UI hints (`claude-broker` and `shell` are omitted). */
  kind_features: z.record(z.string(), rcKindFeaturesSchema),
});
export type RcCapabilities = z.infer<typeof rcCapabilitiesSchema>;

/**
 * The app's own `GET …/rc` list response: the adapted wire sessions plus, when the
 * target's binary reported one, the pass-through {@link rcCapabilitiesSchema
 * capabilities} block (absent for an old binary — same tolerance as the DTO
 * envelope).
 */
export const rcSessionsResponseSchema = z.object({
  rc_sessions: z.array(rcSessionSchema),
  capabilities: rcCapabilitiesSchema.optional(),
});
export type RcSessionsResponse = z.infer<typeof rcSessionsResponseSchema>;

// --- Per-kind agent identity (tool token / binary / auth remediation) -------------
// Mirrors the reference implementation's agent registry (internal/ext/rc/agents.go):
// each kind maps to the tool that backs it (the key under capabilities.agents), the
// binary probed for install, and the human login remediation for needs-auth
// (AuthHintFor). claude backs both claude-broker and claude-rc; shell has no agent.

const AGENT_BY_KIND: Record<string, { tool: string; bin: string; authHint: string } | undefined> = {
  'claude-broker': { tool: 'claude', bin: 'claude', authHint: 'run `claude` → /login' },
  'claude-rc': { tool: 'claude', bin: 'claude', authHint: 'run `claude` → /login' },
  codex: {
    tool: 'codex',
    bin: 'codex',
    authHint: 'run `codex` and complete login (`codex login`)',
  },
  opencode: { tool: 'opencode', bin: 'opencode', authHint: 'run `opencode auth login`' },
  cursor: { tool: 'cursor', bin: 'cursor-agent', authHint: 'run `cursor-agent login`' },
  // shell: no agent — omitted (agentToolForKind/agentBinForKind return undefined).
};

/** The tool token backing a kind (the key under `capabilities.agents`), or undefined
 *  for `shell` and unknown kinds. */
export function agentToolForKind(kind: string): string | undefined {
  return AGENT_BY_KIND[kind]?.tool;
}

/** The executable a kind's session runs (what must be on PATH), or undefined for
 *  `shell` and unknown kinds. */
export function agentBinForKind(kind: string): string | undefined {
  return AGENT_BY_KIND[kind]?.bin;
}

/** Per-agent login remediation for a kind's `needs-auth` state (what to run in a
 *  terminal), with a neutral fallback for `shell`/unknown kinds. Mirrors the
 *  reference implementation's AuthHintFor. */
export function authHintForKind(kind: string): string {
  return AGENT_BY_KIND[kind]?.authHint ?? 'log in to the agent in a terminal';
}

/**
 * The kinds a client should OFFER for create against a target, derived from the
 * target's advertised {@link RcCapabilities} the same way other clients derive it:
 * the binary's `kinds` list intersected with this build's known kinds, keeping only
 * kinds whose backing agent is installed (`shell` has no agent and is always
 * creatable). With **no** capabilities (an old binary's bare list envelope), fall
 * back to the pre-multi-agent set — `claude-broker`/`claude-rc`/`shell` — the only
 * kinds such a binary accepts.
 */
export function creatableRcKinds(caps?: RcCapabilities): RcKind[] {
  if (!caps) return ['claude-broker', 'claude-rc', 'shell'];
  return RC_KINDS.filter((k) => {
    if (!caps.kinds.includes(k)) return false;
    const tool = agentToolForKind(k);
    if (!tool) return true; // shell — nothing to install
    return caps.agents[tool]?.installed === true;
  });
}

/**
 * The neutral, target-agnostic session shape emitted by the `shed-ext-rc` guest
 * binary on stdout (RC Session Convention v2). The binary runs *inside* a shed, so
 * it cannot know the orchestrator's host alias, shed name, or {@link RcTarget} —
 * it reports only what it can observe (the tmux session + its `SHED_RC_*` env +
 * pane-derived state). Each app adapts this into its own wire model:
 * shed-remote-agent wraps it with a {@link RcTarget} (see `toRcSession`);
 * shed-desktop injects host/shed and maps `id`→`rc_id`.
 *
 * This is the cross-tool interop contract — a golden fixture of it is asserted to
 * decode here AND in shed-desktop's Swift `Codable`. Optional fields are *omitted*
 * (not null) when unknown.
 *
 * Derived from {@link rcSessionSchema} (the app wire shape = this DTO + the caller's
 * `target`) so the shared fields have a single source of truth: drop the
 * caller-context fields the binary can't know (`target`, `error`), make
 * `display_name`/`workdir` optional (omitted when the session stored none), and make
 * `managed` required.
 */
export const rcSessionDtoSchema = rcSessionSchema.omit({ target: true, error: true }).extend({
  managed: z.boolean(),
  display_name: z.string().optional(),
  workdir: z.string().optional(),
});
export type RcSessionDto = z.infer<typeof rcSessionDtoSchema>;

export const rcSessionsDtoResponseSchema = z.object({
  rc_sessions: z.array(rcSessionDtoSchema),
  /**
   * The capability/discovery block, embedded so a single `list` exec feeds both the
   * session list and capability discovery. **Optional**: an old binary emits the bare
   * `{ "rc_sessions": [...] }` envelope (no capabilities), which still decodes — a
   * consumer tolerates the absence and simply has no capability data for that shed.
   */
  capabilities: rcCapabilitiesSchema.optional(),
});
export type RcSessionsDtoResponse = z.infer<typeof rcSessionsDtoResponseSchema>;
