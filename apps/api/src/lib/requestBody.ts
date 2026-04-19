import type { Context } from 'hono';
import { AppError } from './errors.js';

/**
 * Read the request body as text and JSON-parse it. Empty body returns `{}`.
 * Invalid JSON throws a 400 AppError — used by POST routes that want the
 * body to be strictly-JSON but tolerate "no body at all" as an empty object.
 */
export async function parseJsonBody(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw AppError.badRequest('Invalid JSON body');
  }
}
