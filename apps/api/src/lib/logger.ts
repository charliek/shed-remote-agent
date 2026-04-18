import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
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
