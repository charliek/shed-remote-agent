import { describe, expect, it } from 'bun:test';
import { buildInnerCommand } from '../rc.js';

describe('buildInnerCommand', () => {
  it('claude-broker uses claude remote-control with --spawn same-dir', () => {
    expect(buildInnerCommand('claude-broker', 'my-shed/abc123')).toBe(
      'claude remote-control --name my-shed/abc123 --spawn same-dir',
    );
  });

  it('claude-rc runs interactive claude with /rc as initial argv', () => {
    expect(buildInnerCommand('claude-rc', 'my-shed/abc123')).toBe(
      'claude --name my-shed/abc123 /rc',
    );
  });

  it('shell is a plain login bash, no display name leakage', () => {
    expect(buildInnerCommand('shell', 'my-shed/abc123')).toBe('bash -l');
  });

  it('quotes display names with spaces', () => {
    expect(buildInnerCommand('claude-broker', 'Friday Bug Fix')).toBe(
      "claude remote-control --name 'Friday Bug Fix' --spawn same-dir",
    );
    expect(buildInnerCommand('claude-rc', 'Friday Bug Fix')).toBe(
      "claude --name 'Friday Bug Fix' /rc",
    );
  });

  it('quotes display names with single quotes via POSIX backslash trick', () => {
    expect(buildInnerCommand('claude-broker', "it's mine")).toBe(
      "claude remote-control --name 'it'\\''s mine' --spawn same-dir",
    );
  });
});
