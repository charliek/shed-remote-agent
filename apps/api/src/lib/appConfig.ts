import { readFile } from 'node:fs/promises';
import type { Machine } from '@shed-remote-agent/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const localDirSchema = z.object({
  user: z.string(),
  path: z.string(),
});

// Empty/whitespace-only is meaningless and would smuggle past the bootstrap's
// `?? '~'` fallback as a real argument to `tmux -c`, so reject it at parse time.
const workdirSchema = z
  .string()
  .refine((v) => v.trim().length > 0, { message: 'workdir cannot be empty or whitespace' })
  .optional();

const sshMachineEntrySchema = z.object({
  type: z.literal('ssh'),
  name: z.string().min(1),
  host: z.string().min(1),
  user: z.string().min(1),
  ssh_port: z.number().int().positive().max(65535).optional(),
  workdir: workdirSchema,
});

const localMachineEntrySchema = z
  .object({
    type: z.literal('local'),
    name: z.string().min(1),
    // user is display-only for local; commands run as whatever user the API
    // process is running as.
    user: z.string().min(1).optional(),
    workdir: workdirSchema,
  })
  // Strict so accidentally adding host/ssh_port/etc. on a local entry errors
  // instead of silently dropping. Catches the common copy-paste mistake of
  // turning an ssh entry into a local one without removing the SSH fields.
  .strict();

// Default `type: 'ssh'` when absent so configs written before this field
// existed keep parsing. We do this with a preprocess so the rest of the schema
// can be a strict discriminated union (which rejects e.g. `host:` on a local
// entry).
const machineEntrySchema = z.preprocess(
  (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !('type' in v)) {
      return { ...(v as Record<string, unknown>), type: 'ssh' };
    }
    return v;
  },
  z.discriminatedUnion('type', [sshMachineEntrySchema, localMachineEntrySchema]),
);

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
  return (cfg.machines ?? []).map<Machine>((m) => {
    if (m.type === 'local') {
      return {
        type: 'local',
        name: m.name,
        user: m.user,
        workdir: m.workdir,
      };
    }
    return {
      type: 'ssh',
      name: m.name,
      host: m.host,
      user: m.user,
      sshPort: m.ssh_port ?? 22,
      workdir: m.workdir,
    };
  });
}
