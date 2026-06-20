import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rcSessionDtoSchema, rcSessionsDtoResponseSchema } from '@shed-remote-agent/shared';

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

  it('rejects a legacy kind value (no v1 aliases)', () => {
    expect(rcSessionDtoSchema.safeParse({ ...raw.rc_sessions[0], kind: 'repl' }).success).toBe(
      false,
    );
  });
});
