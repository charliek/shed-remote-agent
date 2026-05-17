import { z } from 'zod';

const sshMachineSchema = z.object({
  type: z.literal('ssh'),
  name: z.string(),
  host: z.string(),
  user: z.string(),
  sshPort: z.number().int().positive().max(65535),
  workdir: z.string().optional(),
});

const localMachineSchema = z.object({
  type: z.literal('local'),
  name: z.string(),
  user: z.string().optional(),
  workdir: z.string().optional(),
});

export const machineSchema = z.discriminatedUnion('type', [sshMachineSchema, localMachineSchema]);
export type Machine = z.infer<typeof machineSchema>;
export type SshMachine = z.infer<typeof sshMachineSchema>;
export type LocalMachine = z.infer<typeof localMachineSchema>;

export const machinesResponseSchema = z.object({
  machines: z.array(machineSchema),
});
export type MachinesResponse = z.infer<typeof machinesResponseSchema>;
