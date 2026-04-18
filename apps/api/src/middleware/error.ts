import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logError } from '../lib/logger.js';

export { AppError };

export const errorHandler: ErrorHandler = (error, c) => {
  logError(error as Error, {
    requestId: c.get('requestId'),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
  });

  if (error instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const p = issue.path.join('.');
      if (!details[p]) details[p] = [];
      details[p].push(issue.message);
    }
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } }, 400);
  }

  if (error instanceof AppError) {
    return c.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      error.statusCode as ContentfulStatusCode,
    );
  }

  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    500,
  );
};
