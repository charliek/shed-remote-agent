import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number).default('8787'),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  CORS_ORIGINS: z
    .string()
    .optional()
    .default('http://localhost:5173')
    .transform((val) => val.split(',').map((s) => s.trim())),
  SHED_CONFIG_PATH: z.string().optional(),
  APP_CONFIG_PATH: z.string().optional(),
});

const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:');
      for (const issue of error.issues) {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
      }
      process.exit(1);
    }
    throw error;
  }
};

const env = parseEnv();

const expandHome = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

export const config = {
  port: env.PORT,
  host: env.HOST,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGINS,
  shedConfigPath: expandHome(
    env.SHED_CONFIG_PATH ?? path.join(os.homedir(), '.shed', 'config.yaml'),
  ),
  appConfigPath: expandHome(
    env.APP_CONFIG_PATH ?? path.join(os.homedir(), '.config', 'shed-remote-agent', 'config.yaml'),
  ),
} as const;
