import type { Host } from '@shed-remote-agent/shared';
import { getHost } from './configStore.js';
import { AppError } from './errors.js';
import { ShedClient } from './shedClient.js';

const clients = new Map<string, ShedClient>();

function key(h: Host) {
  return `${h.name}|${h.host}|${h.httpPort}`;
}

export function clientFor(host: Host): ShedClient {
  const k = key(host);
  const existing = clients.get(k);
  if (existing) return existing;
  const created = new ShedClient(host);
  clients.set(k, created);
  return created;
}

export async function requireHost(name: string): Promise<Host> {
  const host = await getHost(name);
  if (!host) throw AppError.notFound(`host '${name}' not found in shed config`);
  return host;
}

export async function clientForName(name: string): Promise<{ host: Host; client: ShedClient }> {
  const host = await requireHost(name);
  return { host, client: clientFor(host) };
}
