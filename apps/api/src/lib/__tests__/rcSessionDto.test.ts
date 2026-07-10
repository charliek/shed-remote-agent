import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRcRequestSchema,
  rcSessionDtoSchema,
  rcSessionsDtoResponseSchema,
} from '@shed-remote-agent/shared';

// The cross-tool interop contract. THIS exact JSON is also committed to
// shed-desktop and asserted to decode in its Swift `Codable` — keep the two in
// sync. It is the single guard that the `shed-ext-rc` binary's stdout decodes
// identically in both apps. The path resolves to the canonical fixture in the
// shared package (the source of truth).
const GOLDEN_PATH = join(
  import.meta.dir,
  '../../../../../packages/shared/src/schemas/rcSessionDto.golden.json',
);

describe('RcSessionDTO golden fixture (cross-tool contract)', () => {
  const raw = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

  it('decodes the list response shape', () => {
    const parsed = rcSessionsDtoResponseSchema.parse(raw);
    expect(parsed.rc_sessions).toHaveLength(2);
  });

  it('decodes the embedded capabilities block (list envelope)', () => {
    const parsed = rcSessionsDtoResponseSchema.parse(raw);
    const caps = parsed.capabilities;
    expect(caps).toBeDefined();
    expect(caps?.rc_version).toBe(3);
    // Every multi-agent kind, in the pinned wire order.
    expect(caps?.kinds).toEqual([
      'claude-broker',
      'claude-rc',
      'codex',
      'opencode',
      'cursor',
      'shell',
    ]);
    expect(caps?.features).toEqual(['generic-perm', 'plan-stdin', 'prompt-b64']);
    expect(caps?.agents.claude).toEqual({ installed: true, version: '2.1.206' });
    // Not installed → version omitted (absent, not null).
    expect(caps?.agents.cursor).toEqual({ installed: false });
    expect(caps?.kind_features.codex).toEqual({ post_input: true, approvals: 'tui' });
  });

  it('still decodes a bare envelope with no capabilities (old binary)', () => {
    const parsed = rcSessionsDtoResponseSchema.parse({ rc_sessions: raw.rc_sessions });
    expect(parsed.capabilities).toBeUndefined();
  });

  it('decodes a fully-populated managed session (all optional fields present)', () => {
    const dto = rcSessionDtoSchema.parse(raw.rc_sessions[0]);
    expect(dto.kind).toBe('claude-rc');
    expect(dto.state).toBe('ready');
    expect(dto.managed).toBe(true);
    expect(dto.id).toBe('9f1c0e7a-1111-4222-8333-444455556666');
    expect(dto.url).toContain('session_');
    expect(dto.target_label).toBe('shed:t1@localmac-dev');
  });

  it('decodes a minimal unmanaged session (optionals omitted, not null)', () => {
    const dto = rcSessionDtoSchema.parse(raw.rc_sessions[1]);
    expect(dto.kind).toBe('claude-broker');
    expect(dto.managed).toBe(false);
    // Optional fields are *absent*, not null — assert undefined.
    expect(dto.display_name).toBeUndefined();
    expect(dto.workdir).toBeUndefined();
    expect(dto.url).toBeUndefined();
    expect(dto.id).toBeUndefined();
  });

  it('preserves an unknown kind verbatim (unknown-kind policy — no aliasing)', () => {
    // A session created by a newer client carries a kind this reader doesn't know.
    // Per the unknown-kind policy it is kept raw and rendered neutrally — never
    // rejected, never aliased to claude-broker (nor a v1 value translated).
    const parsed = rcSessionDtoSchema.safeParse({ ...raw.rc_sessions[0], kind: 'gemini-rc' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe('gemini-rc');
    // A retired v1 value is likewise just an unrecognized string now (no aliasing).
    const legacy = rcSessionDtoSchema.safeParse({ ...raw.rc_sessions[0], kind: 'repl' });
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.kind).toBe('repl');
  });

  it('maps an unknown state to starting (convention) instead of failing the decode', () => {
    // A newer binary may emit a state token this build doesn't know. Rejecting it
    // would fail the whole list decode (RC_FAILED/502); per the convention it maps
    // to `starting`. Known states pass through untouched.
    const parsed = rcSessionDtoSchema.safeParse({ ...raw.rc_sessions[0], state: 'hibernating' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.state).toBe('starting');
    const known = rcSessionDtoSchema.parse({ ...raw.rc_sessions[0], state: 'needs-auth' });
    expect(known.state).toBe('needs-auth');
  });
});

describe('createRcRequestSchema (strict)', () => {
  it('rejects unknown fields instead of silently stripping them', () => {
    // e.g. a permission_mode this build doesn't support yet, or a typo'd key —
    // the caller gets a 400 rather than a create that ignored their intent.
    const res = createRcRequestSchema.safeParse({ kind: 'codex', permission_mode: 'skip' });
    expect(res.success).toBe(false);
  });

  it('still accepts the supported field set', () => {
    const res = createRcRequestSchema.safeParse({
      kind: 'codex',
      display_name: 'demo',
      initial_prompt: 'fix the tests',
    });
    expect(res.success).toBe(true);
  });
});
