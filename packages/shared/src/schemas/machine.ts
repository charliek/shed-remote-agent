import { z } from 'zod';

// rc_bin: optional override for the shed-machine-rc binary on the machine — an
// absolute path, or a command name resolvable on the machine's PATH. Orchestrator
// commands run over SSH in a NON-login shell, so a binary that isn't on the default
// PATH reads as "missing" — most often an Apple-Silicon Homebrew install under
// /opt/homebrew/bin; point rc_bin at the absolute path in that case. The Linux .deb
// installs to /usr/local/bin (already on PATH), so apt and `type: local` machines
// rarely need it.
const sshMachineSchema = z.object({
  type: z.literal('ssh'),
  name: z.string(),
  host: z.string(),
  user: z.string(),
  sshPort: z.number().int().positive().max(65535),
  workdir: z.string().optional(),
  rc_bin: z.string().min(1).optional(),
});

const localMachineSchema = z.object({
  type: z.literal('local'),
  name: z.string(),
  user: z.string().optional(),
  workdir: z.string().optional(),
  rc_bin: z.string().min(1).optional(),
});

export const machineSchema = z.discriminatedUnion('type', [sshMachineSchema, localMachineSchema]);
export type Machine = z.infer<typeof machineSchema>;
export type SshMachine = z.infer<typeof sshMachineSchema>;
export type LocalMachine = z.infer<typeof localMachineSchema>;

export const machinesResponseSchema = z.object({
  machines: z.array(machineSchema),
});
export type MachinesResponse = z.infer<typeof machinesResponseSchema>;
