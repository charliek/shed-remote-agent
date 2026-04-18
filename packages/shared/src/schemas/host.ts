import { z } from 'zod';

export const hostSchema = z.object({
  name: z.string(),
  host: z.string(),
  httpPort: z.number().int().positive(),
  sshPort: z.number().int().positive(),
});

export const hostsResponseSchema = z.object({
  hosts: z.array(hostSchema),
});

export type Host = z.infer<typeof hostSchema>;
export type HostsResponse = z.infer<typeof hostsResponseSchema>;
