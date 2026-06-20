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

// RC Session Convention v2 kinds. `<tool>-<mode>` so the model can grow to other
// agents (opencode-rc, codex-rc) later; `shell` is tool-agnostic. The rename from
// v1's `agent|repl|shell` is a wire break — readers bump to v2 (see RC_SCHEMA_VERSION).
//   claude-rc     – interactive `claude` REPL with `/rc` (was `repl`)
//   claude-broker – the `claude remote-control` multiplexer/broker (was `agent`)
//   shell         – plain login bash
export const rcKindSchema = z.enum(['claude-broker', 'claude-rc', 'shell']);
export type RcKind = z.infer<typeof rcKindSchema>;

export const DEFAULT_RC_KIND: RcKind = 'claude-rc';

/**
 * RC Session Convention schema version, stamped into `SHED_RC_V` at create. Bumped
 * to 2 for the kind rename (a value-grammar break). See
 * docs/reference/rc-session-convention.md.
 */
export const RC_SCHEMA_VERSION = 2;

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
  kind: rcKindSchema,
  state: rcStateSchema,
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

export const createRcRequestSchema = z.object({
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
   * with Enter. For `claude-rc` it's a prompt; for `shell` it's a command to run.
   * Not used for `claude-broker` (no single live REPL). Single line — control chars
   * (incl. newlines) are rejected.
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

export const rcSessionsResponseSchema = z.object({
  rc_sessions: z.array(rcSessionSchema),
});
export type RcSessionsResponse = z.infer<typeof rcSessionsResponseSchema>;

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
});
export type RcSessionsDtoResponse = z.infer<typeof rcSessionsDtoResponseSchema>;
