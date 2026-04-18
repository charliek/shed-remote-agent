const SAFE = /^[A-Za-z0-9_./-]+$/;

/**
 * Single-quote a string for safe interpolation into a POSIX shell command.
 * Skips quoting when the value contains only characters safe to leave bare.
 */
export function shellQuote(s: string): string {
  if (SAFE.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
