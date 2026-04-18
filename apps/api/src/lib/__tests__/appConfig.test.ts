import { describe, expect, it } from 'bun:test';
import { parseAppConfig, resolveLocalDir } from '../appConfig.js';

describe('parseAppConfig', () => {
  it('applies empty defaults when file is empty', () => {
    const cfg = parseAppConfig('');
    expect(cfg.defaults).toEqual({});
    expect(cfg.github.owners).toEqual([]);
    expect(cfg.hosts).toEqual({});
  });

  it('parses defaults.local_dir and github.owners', () => {
    const cfg = parseAppConfig(`defaults:
  local_dir:
    user: charliek
    path: /home/charliek/projects
github:
  owners: [charliek]
`);
    expect(cfg.defaults.local_dir).toEqual({
      user: 'charliek',
      path: '/home/charliek/projects',
    });
    expect(cfg.github.owners).toEqual(['charliek']);
  });
});

describe('resolveLocalDir', () => {
  it('prefers per-host override over defaults', () => {
    const cfg = parseAppConfig(`defaults:
  local_dir: { user: a, path: /a }
hosts:
  macbook:
    local_dir: { user: b, path: /b }
`);
    expect(resolveLocalDir(cfg, 'macbook')).toEqual({ user: 'b', path: '/b' });
    expect(resolveLocalDir(cfg, 'other')).toEqual({ user: 'a', path: '/a' });
  });

  it('returns null when neither defaults nor host override set', () => {
    const cfg = parseAppConfig('');
    expect(resolveLocalDir(cfg, 'any')).toBeNull();
  });
});
