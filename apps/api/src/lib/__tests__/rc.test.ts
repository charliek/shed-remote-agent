import { describe, expect, it } from 'bun:test';
import { classifyPane } from '../rc.js';

describe('classifyPane', () => {
  it('detects ready + URL', () => {
    const pane = `·✔︎· Connected · my-shed · main
    Capacity: 0/32 · New sessions will be created in the current directory

Continue coding in the Claude app or https://claude.ai/code?environment=env_01ABC
space to show QR code · w to toggle spawn mode`;
    const r = classifyPane(pane);
    expect(r.state).toBe('ready');
    expect(r.url).toBe('https://claude.ai/code?environment=env_01ABC');
  });

  it('detects reconnecting', () => {
    const r = classifyPane('·|· Reconnecting · retrying in 2.5s · disconnected 0s');
    expect(r.state).toBe('reconnecting');
  });

  it('detects needs-trust', () => {
    const r = classifyPane('Error: Workspace not trusted. Please run `claude` ...');
    expect(r.state).toBe('needs-trust');
  });

  it('detects needs-auth via subscription prompt', () => {
    const r = classifyPane('Remote Control requires a claude.ai subscription.');
    expect(r.state).toBe('needs-auth');
  });

  it('detects needs-auth via login hint', () => {
    const r = classifyPane('You are not logged in. Run claude auth login.');
    expect(r.state).toBe('needs-auth');
  });

  it('returns starting when no signals present', () => {
    const r = classifyPane('booting...');
    expect(r.state).toBe('starting');
    expect(r.url).toBeUndefined();
  });
});
