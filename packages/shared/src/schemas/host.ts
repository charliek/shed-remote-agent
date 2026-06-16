import { z } from 'zod';

export const hostSchema = z.object({
  name: z.string(),
  host: z.string(),
  httpPort: z.number().int().positive().max(65535),
  sshPort: z.number().int().positive().max(65535),
  /**
   * True when the server is reached over HTTPS with a pinned cert + bearer token
   * (config has `api_url`). Wire-safe: a display flag only — the token and cert
   * fingerprint never cross this boundary (they live in the server-side
   * `ServerTarget`, not here).
   */
  secure: z.boolean(),
});

export const hostsResponseSchema = z.object({
  hosts: z.array(hostSchema),
});

export type Host = z.infer<typeof hostSchema>;
export type HostsResponse = z.infer<typeof hostsResponseSchema>;
