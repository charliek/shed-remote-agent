import { z } from 'zod';

export const extensionHealthInfoSchema = z.object({
  guest: z.string(),
  host: z.string(),
});

// Mirrors config.Shed in shed/internal/config/types.go:73-89
export const shedSchema = z.object({
  name: z.string(),
  status: z.string(),
  created_at: z.string(),
  repo: z.string().optional(),
  container_id: z.string().optional(),
  backend: z.string().optional(),
  ip_address: z.string().optional(),
  cpus: z.number().int().optional(),
  memory_mb: z.number().int().optional(),
  pid: z.number().int().optional(),
  rootfs_path: z.string().optional(),
  local_dir: z.string().optional(),
  image: z.string().optional(),
  last_healthy: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  extensions: z.record(z.string(), extensionHealthInfoSchema).optional(),
});
export type Shed = z.infer<typeof shedSchema>;

// Our enriched shape (adds host + optional errored flag)
export const shedWithHostSchema = shedSchema.extend({
  host: z.string(),
});
export type ShedWithHost = z.infer<typeof shedWithHostSchema>;

export const hostErrorSchema = z.object({
  host: z.string(),
  error: z.object({ code: z.string(), message: z.string() }),
});
export type HostError = z.infer<typeof hostErrorSchema>;

export const shedsResponseSchema = z.object({
  sheds: z.array(shedWithHostSchema),
  errors: z.array(hostErrorSchema).optional(),
});
export type ShedsResponse = z.infer<typeof shedsResponseSchema>;

export const sessionSchema = z.object({
  name: z.string(),
  shed_name: z.string(),
  server_name: z.string().optional(),
  created_at: z.string(),
  attached: z.boolean(),
  window_count: z.number().int().optional(),
  // Added by our backend: true when the session name begins with the `rc-` prefix
  is_remote_control: z.boolean().optional(),
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionsResponseSchema = z.object({
  sessions: z.array(sessionSchema),
  warnings: z.array(z.string()).optional(),
});
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;

export const imageInfoSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  docker_ref: z.string().optional(),
  size_bytes: z.number().int().optional(),
  source: z.string(),
  cached: z.boolean(),
});
export type ImageInfo = z.infer<typeof imageInfoSchema>;

export const imagesResponseSchema = z.object({
  images: z.array(imageInfoSchema),
});
export type ImagesResponse = z.infer<typeof imagesResponseSchema>;

export const createShedRequestSchema = z.object({
  name: z.string().min(1),
  repo: z.string().optional(),
  image: z.string().optional(),
  no_provision: z.boolean().optional(),
  backend: z.string().optional(),
  cpus: z.number().int().positive().optional(),
  memory_mb: z.number().int().positive().optional(),
  local_dir: z.string().optional(),
});
export type CreateShedRequest = z.infer<typeof createShedRequestSchema>;

export const progressEventSchema = z.object({
  phase: z.string(),
  message: z.string(),
  warning: z.boolean().optional(),
});
export type ProgressEvent = z.infer<typeof progressEventSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type APIError = z.infer<typeof apiErrorSchema>;
