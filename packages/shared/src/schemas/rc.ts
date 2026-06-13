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

export const rcKindSchema = z.enum(['agent', 'repl', 'shell']);
export type RcKind = z.infer<typeof rcKindSchema>;

export const DEFAULT_RC_KIND: RcKind = 'repl';

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
  // RC Session Convention v1 metadata (read from the tmux session's SHED_RC_*
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
});
export type CreateRcRequest = z.infer<typeof createRcRequestSchema>;

export const rcSessionsResponseSchema = z.object({
  rc_sessions: z.array(rcSessionSchema),
});
export type RcSessionsResponse = z.infer<typeof rcSessionsResponseSchema>;
