import { readFile } from 'node:fs/promises';
import type { Host } from '@shed-remote-agent/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const serverEntrySchema = z.object({
  host: z.string(),
  http_port: z.number().int().positive(),
  ssh_port: z.number().int().positive(),
});

const shedCacheSchema = z.object({
  server: z.string(),
  status: z.string().optional(),
});

const clientConfigSchema = z.object({
  servers: z.record(z.string(), serverEntrySchema).optional().default({}),
  default_server: z.string().optional(),
  sheds: z.record(z.string(), shedCacheSchema).optional().default({}),
});

export type ShedClientConfig = z.infer<typeof clientConfigSchema>;

export async function loadShedConfig(filePath: string): Promise<ShedClientConfig> {
  const raw = await readFile(filePath, 'utf8');
  return parseShedConfig(raw);
}

export function parseShedConfig(raw: string): ShedClientConfig {
  const doc = parseYaml(raw) ?? {};
  return clientConfigSchema.parse(doc);
}

export function hostsFromConfig(cfg: ShedClientConfig): Host[] {
  return Object.entries(cfg.servers ?? {}).map(([name, entry]) => ({
    name,
    host: entry.host,
    httpPort: entry.http_port,
    sshPort: entry.ssh_port,
  }));
}
