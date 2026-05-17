import { describe, expect, it } from 'bun:test';
import { run } from '../ssh.js';

describe('run({ kind: "local" }, …)', () => {
  it('executes a simple command and captures stdout', async () => {
    const res = await run({ kind: 'local' }, ['echo', 'hello world']);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('hello world');
    expect(res.stderr).toBe('');
  });

  it('preserves quoting parity with the SSH wire format', async () => {
    // Spaces and globs in a single argv element should reach the child
    // verbatim, not get re-tokenized by the local shell. Mirrors how
    // remote SSH gets these through pre-quoted argv.
    const res = await run({ kind: 'local' }, ['printf', '%s\n', 'a b * $HOME']);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('a b * $HOME\n');
  });

  it('returns the child exit code on failure', async () => {
    const res = await run({ kind: 'local' }, ['bash', '-c', 'exit 7']);
    expect(res.code).toBe(7);
  });

  it('pipes stdin when provided', async () => {
    const res = await run({ kind: 'local' }, ['cat'], { stdin: 'piped-input\n' });
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('piped-input\n');
  });

  it('returns code 124 with a timeout marker when the command outlives timeoutMs', async () => {
    const res = await run({ kind: 'local' }, ['sleep', '5'], { timeoutMs: 200 });
    expect(res.code).toBe(124);
    expect(res.stderr).toContain('operation timed out after');
  });
});
