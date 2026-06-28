import { describe, expect, it } from 'bun:test';
import { createRcRequestSchema } from '@shed-remote-agent/shared';

// The inline RC engine lib/rc.ts once held (classifyPane / probeUntilReady / the
// SHED_RC_* metadata parsing + inner-command builder) now lives in the shed-ext-rc /
// shed-machine-rc Go binaries; its coverage moved to shed-extensions' internal/rc
// (ClassifyPane, TestInnerCommand, TestBuildEnvArgsRoundTrip). What remains app-side
// and worth a unit test is the create-request schema's prompt validation.

describe('createRcRequestSchema initial_prompt', () => {
  it('accepts and trims a single-line prompt', () => {
    expect(createRcRequestSchema.parse({ initial_prompt: '  do a thing  ' }).initial_prompt).toBe(
      'do a thing',
    );
  });

  it('rejects a prompt with control chars (e.g. a newline)', () => {
    expect(() => createRcRequestSchema.parse({ initial_prompt: 'line1\nline2' })).toThrow();
  });

  it('is optional', () => {
    expect(createRcRequestSchema.parse({}).initial_prompt).toBeUndefined();
  });
});
