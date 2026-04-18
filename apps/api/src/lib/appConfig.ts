import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const localDirSchema = z.object({
  user: z.string(),
  path: z.string(),
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
