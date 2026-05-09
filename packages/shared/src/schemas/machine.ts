import { z } from 'zod';

export const machineSchema = z.object({
  name: z.string(),
  host: z.string(),
  user: z.string(),
  sshPort: z.number().int().positive().max(65535),
  workdir: z.string().optional(),
});
export type Machine = z.infer<typeof machineSchema>;

export const machinesResponseSchema = z.object({
  machines: z.array(machineSchema),
});
export type MachinesResponse = z.infer<typeof machinesResponseSchema>;
