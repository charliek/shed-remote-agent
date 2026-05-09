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
});
export type RcSession = z.infer<typeof rcSessionSchema>;

export const createRcRequestSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/)
    .optional(),
  display_name: z.string().min(1).max(100).optional(),
  workdir: z.string().optional(),
  kind: rcKindSchema.optional(),
});
export type CreateRcRequest = z.infer<typeof createRcRequestSchema>;

export const rcSessionsResponseSchema = z.object({
  rc_sessions: z.array(rcSessionSchema),
});
export type RcSessionsResponse = z.infer<typeof rcSessionsResponseSchema>;
