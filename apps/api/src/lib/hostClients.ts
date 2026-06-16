import type { Host } from '@shed-remote-agent/shared';
import { getServerTarget } from './configStore.js';
import { AppError } from './errors.js';
import { ShedClient, type TokenSource } from './shedClient.js';
import type { ServerTarget } from './shedConfig.js';

interface CachedClient {
  /** Identity of the target the cached client was built for; rebuilt on change. */
  id: string;
  client: ShedClient;
}

const clients = new Map<string, CachedClient>();

/** Immutable transport identity — a change (e.g. open↔secure) evicts the client. */
function identity(t: ServerTarget): string {
  return `${t.name}|${t.baseUrl}|${t.sshPort}|${t.tlsCertFingerprint ?? ''}`;
}

/**
 * Token source backed by the config seed: re-reads the 5s-memoized config each
 * call (so a token the `shed` CLI refreshes on disk is picked up) and never
 * captures a token in the client. The minting provider replaces this later.
 */
function seedTokenSource(name: string): TokenSource {
  return {
    async get() {
      return (await getServerTarget(name))?.controlToken;
    },
    invalidate() {
      // No in-memory token to drop without the provider; a 401 surfaces directly.
    },
  };
}

export function clientFor(target: ServerTarget): ShedClient {
  const id = identity(target);
  const cached = clients.get(target.name);
  if (cached && cached.id === id) return cached.client;
  const client = new ShedClient(target, seedTokenSource(target.name));
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
