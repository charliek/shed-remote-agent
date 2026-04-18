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

export const rcSessionSchema = z.object({
  slug: z.string(),
  tmux_session: z.string(),
  shed_name: z.string(),
  host: z.string(),
  display_name: z.string(),
  workdir: z.string(),
  state: rcStateSchema,
  url: z.string().optional(),
  error: z.string().optional(),
});
export type RcSession = z.infer<typeof rcSessionSchema>;

export const createRcRequestSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]?$/)
    .optional(),
  display_name: z.string().min(1).max(100).optional(),
  workdir: z.string().optional(),
});
export type CreateRcRequest = z.infer<typeof createRcRequestSchema>;

export const rcSessionsResponseSchema = z.object({
  rc_sessions: z.array(rcSessionSchema),
});
export type RcSessionsResponse = z.infer<typeof rcSessionsResponseSchema>;
