import type { Host } from '@shed-remote-agent/shared';
import { config } from '../config.js';
import { type AppConfig, loadAppConfig } from './appConfig.js';
import { ttlMemoize } from './cache.js';
import { hostsFromConfig, loadShedConfig, type ShedClientConfig } from './shedConfig.js';

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
