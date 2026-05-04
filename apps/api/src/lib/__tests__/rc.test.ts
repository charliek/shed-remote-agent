import { describe, expect, it } from 'bun:test';
import { classifyPane } from '../rc.js';

describe('classifyPane(agent, …)', () => {
  it('detects ready + URL', () => {
    const pane = `·✔︎· Connected · my-shed · main
    Capacity: 0/32 · New sessions will be created in the current directory

Continue coding in the Claude app or https://claude.ai/code?environment=env_01ABC
space to show QR code · w to toggle spawn mode`;
    const r = classifyPane('agent', pane);
    expect(r.state).toBe('ready');
    expect(r.url).toBe('https://claude.ai/code?environment=env_01ABC');
  });

  it('detects reconnecting', () => {
    const r = classifyPane('agent', '·|· Reconnecting · retrying in 2.5s · disconnected 0s');
    expect(r.state).toBe('reconnecting');
  });

  it('detects needs-trust', () => {
    const r = classifyPane('agent', 'Error: Workspace not trusted. Please run `claude` ...');
    expect(r.state).toBe('needs-trust');
  });

  it('detects needs-auth via subscription prompt', () => {
    const r = classifyPane('agent', 'Remote Control requires a claude.ai subscription.');
    expect(r.state).toBe('needs-auth');
  });

  it('detects needs-auth via login hint', () => {
    const r = classifyPane('agent', 'You are not logged in. Run claude auth login.');
    expect(r.state).toBe('needs-auth');
  });

  it('returns starting when no signals present', () => {
    const r = classifyPane('agent', 'booting...');
    expect(r.state).toBe('starting');
    expect(r.url).toBeUndefined();
  });
});

describe('classifyPane(repl, …)', () => {
  it('detects ready when /remote-control is active and URL present', () => {
    const pane = `❯ /remote-control
  ⎿  Remote Control connecting…

  /remote-control is active · Code in CLI or at https://claude.ai/code/session_01RCkTDrdZ2Rr12sD5dfMjgr

────────────────────────────────────── spike1 ──
❯
  ? for shortcuts                                                  Remote Control active`;
    const r = classifyPane('repl', pane);
    expect(r.state).toBe('ready');
    expect(r.url).toBe('https://claude.ai/code/session_01RCkTDrdZ2Rr12sD5dfMjgr');
  });

  it('returns starting while Remote Control connecting and no URL yet', () => {
    const r = classifyPane('repl', '❯ /remote-control\n  ⎿  Remote Control connecting…');
    expect(r.state).toBe('starting');
    expect(r.url).toBeUndefined();
  });

  it('still detects needs-trust', () => {
    const r = classifyPane('repl', 'Error: Workspace not trusted. Please run `claude` ...');
    expect(r.state).toBe('needs-trust');
  });

  it('returns starting on a fresh REPL with no /rc yet', () => {
    const r = classifyPane('repl', '❯ Try "fix typecheck errors"');
    expect(r.state).toBe('starting');
  });

  it('does not match the agent URL form', () => {
    const r = classifyPane('repl', 'leftover banner: https://claude.ai/code?environment=env_01ABC');
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
