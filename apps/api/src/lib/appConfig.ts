import { readFile } from 'node:fs/promises';
import type { Machine } from '@shed-remote-agent/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const localDirSchema = z.object({
  user: z.string(),
  path: z.string(),
});

const machineEntrySchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  user: z.string().min(1),
  ssh_port: z.number().int().positive().max(65535).optional(),
  // Empty/whitespace-only is meaningless and would smuggle past the
  // bootstrap's `?? '~'` fallback as a real argument to `tmux -c`, so
  // reject it at parse time.
  workdir: z
    .string()
    .refine((v) => v.trim().length > 0, { message: 'workdir cannot be empty or whitespace' })
    .optional(),
});

export const appConfigSchema = z.object({
  defaults: z
    .object({
      local_dir: localDirSchema.optional(),
    })
    .optional()
    .default({}),
  github: z
    .object({
      owners: z.array(z.string()).optional().default([]),
    })
    .optional()
    .default({}),
  hosts: z
    .record(
      z.string(),
      z.object({
        local_dir: localDirSchema.optional(),
      }),
    )
    .optional()
    .default({}),
  machines: z.array(machineEntrySchema).optional().default([]),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export async function loadAppConfig(filePath: string): Promise<AppConfig> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return parseAppConfig(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return appConfigSchema.parse({});
    }
    throw err;
  }
}

export function parseAppConfig(raw: string): AppConfig {
  const doc = parseYaml(raw) ?? {};
  return appConfigSchema.parse(doc);
}

export function resolveLocalDir(
  cfg: AppConfig,
  hostName: string,
): { user: string; path: string } | null {
  return cfg.hosts?.[hostName]?.local_dir ?? cfg.defaults?.local_dir ?? null;
}

export function machinesFromConfig(cfg: AppConfig): Machine[] {
  return (cfg.machines ?? []).map((m) => ({
    name: m.name,
    host: m.host,
    user: m.user,
    sshPort: m.ssh_port ?? 22,
    workdir: m.workdir,
  }));
}
