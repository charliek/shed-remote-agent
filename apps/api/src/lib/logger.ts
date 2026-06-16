import pino from 'pino';
import { config } from '../config.js';

// Defense-in-depth: even though auth/TLS errors carry sanitized messages, redact
// secret-bearing keys at top level and one level deep so an accidental
// `logger.info({ target })` / bundle log can never spill a token or cert pin.
const SECRET_KEYS = [
  'control_token',
  'controlToken',
  'tls_cert_fingerprint',
  'tlsCertFingerprint',
  'token',
  'authorization',
  'Authorization',
];
const redactPaths = SECRET_KEYS.flatMap((k) => [k, `*.${k}`]);

export const logger = pino({
  level: config.logLevel,
  redact: { paths: redactPaths, censor: '[redacted]' },
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        }
      : undefined,
  formatters: { level: (label) => ({ level: label }) },
});

export function logError(error: Error, context: Record<string, unknown> = {}) {
  logger.error(
    { error: { message: error.message, stack: error.stack, name: error.name }, ...context },
    `Error: ${error.message}`,
  );
}
