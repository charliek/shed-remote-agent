import { describe, expect, it } from 'bun:test';
import { hostsFromConfig, parseShedConfig } from '../shedConfig.js';

describe('parseShedConfig', () => {
  it('parses a minimal config', () => {
    const raw = `servers:
    localhost-dev:
        host: localhost
        http_port: 8080
        ssh_port: 2222
        added_at: 2026-01-20T01:59:54.11619767-06:00
default_server: localhost-dev
sheds: {}
`;
    const cfg = parseShedConfig(raw);
    expect(cfg.default_server).toBe('localhost-dev');
    expect(cfg.servers['localhost-dev']).toEqual({
      host: 'localhost',
      http_port: 8080,
      ssh_port: 2222,
    });
  });

  it('defaults servers/sheds when missing', () => {
    const cfg = parseShedConfig('');
    expect(cfg.servers).toEqual({});
    expect(cfg.sheds).toEqual({});
  });

  it('hostsFromConfig returns Host[] with camelCase ports', () => {
    const cfg = parseShedConfig(`servers:
    a:
        host: 1.2.3.4
        http_port: 8080
        ssh_port: 2222
    b:
        host: box.tailnet
        http_port: 9090
        ssh_port: 2223
`);
    const hosts = hostsFromConfig(cfg);
    expect(hosts).toHaveLength(2);
    expect(hosts.find((h) => h.name === 'a')).toEqual({
      name: 'a',
      host: '1.2.3.4',
      httpPort: 8080,
      sshPort: 2222,
    });
  });
});
