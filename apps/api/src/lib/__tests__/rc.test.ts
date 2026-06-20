import { describe, expect, it } from 'bun:test';
import { createRcRequestSchema, type RcState } from '@shed-remote-agent/shared';
import { classifyPane, probeUntilReady } from '../rc.js';
import type { CommandTarget } from '../ssh.js';

const TARGET: CommandTarget = { kind: 'ssh', host: 'h', user: 'shed', port: 2222 };

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

describe('probeUntilReady trust auto-accept', () => {
  const probeSeq = (states: Array<{ state: RcState; url?: string }>) => {
    let i = 0;
    return async () => states[Math.min(i++, states.length - 1)];
  };

  it('accepts the trust prompt once, then reaches ready', async () => {
    let accepts = 0;
    const r = await probeUntilReady({
      target: TARGET,
      slug: 'abc',
      kind: 'claude-rc',
      timeoutMs: 10_000,
      acceptTrust: async () => {
        accepts += 1;
      },
      probeFn: probeSeq([{ state: 'needs-trust' }, { state: 'ready', url: 'u' }]),
      sleep: async () => {},
    });
    expect(accepts).toBe(1);
    expect(r.state).toBe('ready');
  });

  it('surfaces needs-trust (accepting once) if the prompt never clears', async () => {
    let accepts = 0;
    const r = await probeUntilReady({
      target: TARGET,
      slug: 'abc',
      kind: 'claude-rc',
      timeoutMs: 10_000,
      acceptTrust: async () => {
        accepts += 1;
      },
      probeFn: async () => ({ state: 'needs-trust' as RcState }),
      sleep: async () => {},
    });
    expect(accepts).toBe(1);
    expect(r.state).toBe('needs-trust');
  });
});

describe('classifyPane(claude-broker, …)', () => {
  it('detects ready + URL', () => {
    const pane = `·✔︎· Connected · my-shed · main
    Capacity: 0/32 · New sessions will be created in the current directory

Continue coding in the Claude app or https://claude.ai/code?environment=env_01ABC
space to show QR code · w to toggle spawn mode`;
    const r = classifyPane('claude-broker', pane);
    expect(r.state).toBe('ready');
    expect(r.url).toBe('https://claude.ai/code?environment=env_01ABC');
  });

  it('detects reconnecting', () => {
    const r = classifyPane(
      'claude-broker',
      '·|· Reconnecting · retrying in 2.5s · disconnected 0s',
    );
    expect(r.state).toBe('reconnecting');
  });

  it('detects needs-trust', () => {
    const r = classifyPane(
      'claude-broker',
      'Error: Workspace not trusted. Please run `claude` ...',
    );
    expect(r.state).toBe('needs-trust');
  });

  it('detects needs-auth via subscription prompt', () => {
    const r = classifyPane('claude-broker', 'Remote Control requires a claude.ai subscription.');
    expect(r.state).toBe('needs-auth');
  });

  it('detects needs-auth via login hint', () => {
    const r = classifyPane('claude-broker', 'You are not logged in. Run claude auth login.');
    expect(r.state).toBe('needs-auth');
  });

  it('returns starting when no signals present', () => {
    const r = classifyPane('claude-broker', 'booting...');
    expect(r.state).toBe('starting');
    expect(r.url).toBeUndefined();
  });
});

describe('classifyPane(claude-rc, …)', () => {
  it('detects ready when /remote-control is active and URL present', () => {
    const pane = `❯ /remote-control
  ⎿  Remote Control connecting…

  /remote-control is active · Code in CLI or at https://claude.ai/code/session_01RCkTDrdZ2Rr12sD5dfMjgr

────────────────────────────────────── spike1 ──
❯
  ? for shortcuts                                                  Remote Control active`;
    const r = classifyPane('claude-rc', pane);
    expect(r.state).toBe('ready');
    expect(r.url).toBe('https://claude.ai/code/session_01RCkTDrdZ2Rr12sD5dfMjgr');
  });

  it('returns starting while Remote Control connecting and no URL yet', () => {
    const r = classifyPane('claude-rc', '❯ /remote-control\n  ⎿  Remote Control connecting…');
    expect(r.state).toBe('starting');
    expect(r.url).toBeUndefined();
  });

  it('still detects needs-trust', () => {
    const r = classifyPane('claude-rc', 'Error: Workspace not trusted. Please run `claude` ...');
    expect(r.state).toBe('needs-trust');
  });

  it('detects the first-time "Quick safety check" trust prompt', () => {
    const pane = `Accessing workspace:

 /home/charliek/projects

 Quick safety check: Is this a project you created or one you trust?

 ❯ 1. Yes, I trust this folder
   2. No, exit`;
    const r = classifyPane('claude-rc', pane);
    expect(r.state).toBe('needs-trust');
  });

  it('returns starting on a fresh REPL with no /rc yet', () => {
    const r = classifyPane('claude-rc', '❯ Try "fix typecheck errors"');
    expect(r.state).toBe('starting');
  });

  it('does not match the agent URL form', () => {
    const r = classifyPane(
      'claude-rc',
      'leftover banner: https://claude.ai/code?environment=env_01ABC',
    );
    // No `session_…` URL, no Remote Control text → starting.
    expect(r.state).toBe('starting');
    expect(r.url).toBeUndefined();
  });
});

describe('classifyPane(shell, …)', () => {
  it('returns ready when the pane has any non-whitespace', () => {
    const r = classifyPane('shell', 'charliek@shed:/workspace$ ');
    expect(r.state).toBe('ready');
    expect(r.url).toBeUndefined();
  });

  it('returns starting on an empty pane', () => {
    const r = classifyPane('shell', '   \n  \n');
    expect(r.state).toBe('starting');
  });

  it('does not surface auth/trust signals (those are claude-specific)', () => {
    // If a user happens to print these strings into a shell, we shouldn't
    // misclassify the kind=shell session.
    const r = classifyPane('shell', '$ echo "Workspace not trusted"');
    expect(r.state).toBe('ready');
  });
});
