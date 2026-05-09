import { describe, expect, it } from 'bun:test';
import { machinesFromConfig, parseAppConfig, resolveLocalDir } from '../appConfig.js';

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

describe('machinesFromConfig', () => {
  it('returns empty when config has no machines', () => {
    expect(machinesFromConfig(parseAppConfig(''))).toEqual([]);
  });

  it('defaults ssh_port to 22 and passes through workdir', () => {
    const cfg = parseAppConfig(`machines:
  - name: pop-os
    host: pop-os
    user: charliek
    workdir: /home/charliek/projects
  - name: explicit-port
    host: 10.0.0.5
    user: ops
    ssh_port: 2200
`);
    expect(machinesFromConfig(cfg)).toEqual([
      {
        name: 'pop-os',
        host: 'pop-os',
        user: 'charliek',
        sshPort: 22,
        workdir: '/home/charliek/projects',
      },
      { name: 'explicit-port', host: '10.0.0.5', user: 'ops', sshPort: 2200, workdir: undefined },
    ]);
  });
});
