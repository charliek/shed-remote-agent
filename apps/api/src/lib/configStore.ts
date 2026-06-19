import type { Host, Machine } from '@shed-remote-agent/shared';
import { config } from '../config.js';
import { type AppConfig, loadAppConfig, machinesFromConfig } from './appConfig.js';
import { ttlMemoize } from './cache.js';
import {
  hostsFromConfig,
  loadShedConfig,
  type ServerTarget,
  type ShedClientConfig,
  serverTargetFromConfig,
  serverTargetsFromConfig,
} from './shedConfig.js';

const shedMemo = ttlMemoize<'shed', ShedClientConfig>(5_000);
const appMemo = ttlMemoize<'app', AppConfig>(5_000);

export function getShedConfig(): Promise<ShedClientConfig> {
  return shedMemo('shed', () => loadShedConfig(config.shedConfigPath));
}

export function getAppConfig(): Promise<AppConfig> {
  return appMemo('app', () => loadAppConfig(config.appConfigPath));
}

export async function getHosts(): Promise<Host[]> {
  return hostsFromConfig(await getShedConfig());
}

export async function getHost(name: string): Promise<Host | null> {
  const hosts = await getHosts();
  return hosts.find((h) => h.name === name) ?? null;
}

/**
 * Server-side routing targets (with secret token/fingerprint material). Pure
 * selectors over the same 5s-memoized config as {@link getHosts}, so a token
 * refreshed on disk by the `shed` CLI is picked up within the TTL. For
 * `hostClients`/the token provider only — never expose these to a route.
 */
export async function getServerTargets(): Promise<ServerTarget[]> {
  return serverTargetsFromConfig(await getShedConfig());
}

export async function getServerTarget(name: string): Promise<ServerTarget | null> {
  return serverTargetFromConfig(await getShedConfig(), name);
}

export async function getMachines(): Promise<Machine[]> {
  return machinesFromConfig(await getAppConfig());
}

export async function getMachine(name: string): Promise<Machine | null> {
  const machines = await getMachines();
  return machines.find((m) => m.name === name) ?? null;
}
