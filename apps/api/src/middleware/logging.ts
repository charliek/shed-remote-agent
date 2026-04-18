import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import { logger } from '../lib/logger.js';

export async function loggingMiddleware(c: Context, next: Next) {
  const requestId = randomUUID();
  const start = Date.now();
  c.set('requestId', requestId);

  const { method, url } = c.req;
  const pathname = new URL(url).pathname;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

  logger[level](
    { requestId, method, path: pathname, status, duration: `${duration}ms` },
    `${method} ${pathname} ${status} ${duration}ms`,
  );
}
