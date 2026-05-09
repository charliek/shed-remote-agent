import type { Machine } from '@shed-remote-agent/shared';
import { getMachine } from './configStore.js';
import { AppError } from './errors.js';
import type { SSHTarget } from './ssh.js';

export async function requireMachine(name: string): Promise<Machine> {
  const m = await getMachine(name);
  if (!m) throw AppError.notFound(`machine '${name}' not found in app config`);
  return m;
}

export function machineSshTarget(m: Machine): SSHTarget {
  return { host: m.host, user: m.user, port: m.sshPort };
}
