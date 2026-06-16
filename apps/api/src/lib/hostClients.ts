import type { Host } from '@shed-remote-agent/shared';
import { getServerTarget } from './configStore.js';
import { ControlTokenProvider } from './controlToken.js';
import { AppError } from './errors.js';
import { ShedClient } from './shedClient.js';
import type { ServerTarget } from './shedConfig.js';

interface CachedClient {
  /** Identity of the target the cached client was built for; rebuilt on change. */
  id: string;
  client: ShedClient;
}

const clients = new Map<string, CachedClient>();
// Token providers persist per host (independent of client rebuilds) so an
// in-memory minted token survives a transport-identity change. Each re-reads
// the 5s-memoized config itself, so it always sees the current target.
const providers = new Map<string, ControlTokenProvider>();

/** Immutable transport identity — a change (e.g. open↔secure) evicts the client. */
function identity(t: ServerTarget): string {
  return `${t.name}|${t.baseUrl}|${t.sshPort}|${t.tlsCertFingerprint ?? ''}`;
}

function providerFor(name: string): ControlTokenProvider {
  let provider = providers.get(name);
  if (!provider) {
    provider = new ControlTokenProvider(name);
    providers.set(name, provider);
  }
  return provider;
}

export function clientFor(target: ServerTarget): ShedClient {
  const id = identity(target);
  const cached = clients.get(target.name);
  if (cached && cached.id === id) return cached.client;
  const client = new ShedClient(target, providerFor(target.name));
  clients.set(target.name, { id, client });
  return client;
}

export async function requireServerTarget(name: string): Promise<ServerTarget> {
  const target = await getServerTarget(name);
  if (!target) throw AppError.notFound(`host '${name}' not found in shed config`);
  return target;
}

/** Wire-safe Host (no secrets) derived from a target, for the SSH-path callers. */
function hostFromTarget(t: ServerTarget): Host {
  return { name: t.name, host: t.host, httpPort: t.httpPort, sshPort: t.sshPort, secure: t.secure };
}

export async function clientForName(name: string): Promise<{ host: Host; client: ShedClient }> {
  const target = await requireServerTarget(name);
  return { host: hostFromTarget(target), client: clientFor(target) };
}
