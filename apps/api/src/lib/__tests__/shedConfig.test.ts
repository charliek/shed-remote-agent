import { describe, expect, it } from 'bun:test';
import {
  hostsFromConfig,
  parseShedConfig,
  serverTargetFromConfig,
  serverTargetsFromConfig,
} from '../shedConfig.js';

const PIN = `sha256:${'a'.repeat(64)}`;

const SECURE_RAW = `servers:
    sec:
        host: box.tailnet
        http_port: 8080
        ssh_port: 2222
        api_url: https://box.tailnet:8443
        control_token: shed_control_secret
        control_token_expires_at: 2026-06-17T00:00:00-05:00
        tls_cert_fingerprint: ${PIN}
    legacy:
        host: 1.2.3.4
        http_port: 9090
        ssh_port: 2223
`;

describe('parseShedConfig', () => {
  it('parses a minimal (legacy) config', () => {
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
    // `added_at` and any unknown keys are stripped; only the known shape remains.
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

  it('hostsFromConfig returns Host[] with camelCase ports and secure=false for legacy', () => {
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
      secure: false,
    });
  });

  it('parses secure entries and normalizes the fingerprint to lowercase', () => {
    const cfg = parseShedConfig(`servers:
    sec:
        host: box.tailnet
        http_port: 8080
        ssh_port: 2222
        api_url: https://box.tailnet:8443
        control_token: shed_control_secret
        tls_cert_fingerprint: SHA256:${'A'.repeat(64)}
`);
    expect(cfg.servers.sec.tls_cert_fingerprint).toBe(`sha256:${'a'.repeat(64)}`);
  });

  it('rejects a https api_url without a fingerprint', () => {
    expect(() =>
      parseShedConfig(`servers:
    s:
        host: h
        http_port: 8080
        ssh_port: 2222
        api_url: https://h:8443
        control_token: t
`),
    ).toThrow(/requires tls_cert_fingerprint/);
  });

  it('rejects a https api_url without a control_token', () => {
    expect(() =>
      parseShedConfig(`servers:
    s:
        host: h
        http_port: 8080
        ssh_port: 2222
        api_url: https://h:8443
        tls_cert_fingerprint: ${PIN}
`),
    ).toThrow(/requires a non-empty control_token/);
  });

  it('rejects a http:// api_url (no plaintext endpoint masquerading as secure)', () => {
    expect(() =>
      parseShedConfig(`servers:
    s:
        host: h
        http_port: 8080
        ssh_port: 2222
        api_url: http://h:8443
        control_token: t
        tls_cert_fingerprint: ${PIN}
`),
    ).toThrow(/api_url must be a https:\/\/ URL/);
  });

  it('rejects a whitespace-only control_token on a secure server', () => {
    expect(() =>
      parseShedConfig(`servers:
    s:
        host: h
        http_port: 8080
        ssh_port: 2222
        api_url: https://h:8443
        control_token: "   "
        tls_cert_fingerprint: ${PIN}
`),
    ).toThrow(/requires a non-empty control_token/);
  });

  it('rejects a control_token / fingerprint without a https api_url (no plaintext creds)', () => {
    expect(() =>
      parseShedConfig(`servers:
    s:
        host: h
        http_port: 8080
        ssh_port: 2222
        control_token: t
`),
    ).toThrow(/without a https api_url/);
  });

  it('rejects a malformed fingerprint', () => {
    expect(() =>
      parseShedConfig(`servers:
    s:
        host: h
        http_port: 8080
        ssh_port: 2222
        api_url: https://h:8443
        control_token: t
        tls_cert_fingerprint: sha256:nothex
`),
    ).toThrow(/sha256:<64 lowercase hex>/);
  });
});

describe('serverTargetsFromConfig', () => {
  it('builds secure + legacy targets with the right baseUrl and secrets', () => {
    const cfg = parseShedConfig(SECURE_RAW);
    const sec = serverTargetFromConfig(cfg, 'sec');
    expect(sec).toEqual({
      name: 'sec',
      host: 'box.tailnet',
      sshPort: 2222,
      httpPort: 8080,
      secure: true,
      baseUrl: 'https://box.tailnet:8443',
      apiUrl: 'https://box.tailnet:8443',
      tlsCertFingerprint: PIN,
      controlToken: 'shed_control_secret',
      controlTokenExpiresAt: '2026-06-17T00:00:00-05:00',
    });

    const legacy = serverTargetFromConfig(cfg, 'legacy');
    expect(legacy?.secure).toBe(false);
    expect(legacy?.baseUrl).toBe('http://1.2.3.4:9090');
    expect(legacy?.controlToken).toBeUndefined();
    expect(legacy?.tlsCertFingerprint).toBeUndefined();

    expect(serverTargetsFromConfig(cfg)).toHaveLength(2);
    expect(serverTargetFromConfig(cfg, 'nope')).toBeNull();
  });
});

describe('wire safety', () => {
  it('hostsFromConfig never leaks token / fingerprint / api_url to the wire', () => {
    const cfg = parseShedConfig(SECURE_RAW);
    const hosts = hostsFromConfig(cfg);
    const json = JSON.stringify(hosts);
    expect(json).not.toContain('shed_control_secret');
    expect(json).not.toContain(PIN);
    expect(json).not.toContain('api_url');
    expect(json).not.toContain('8443');
    expect(hosts.find((h) => h.name === 'sec')).toEqual({
      name: 'sec',
      host: 'box.tailnet',
      httpPort: 8080,
      sshPort: 2222,
      secure: true,
    });
  });
});
