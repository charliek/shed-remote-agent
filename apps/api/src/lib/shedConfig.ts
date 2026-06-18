import { readFile } from 'node:fs/promises';
import type { Host } from '@shed-remote-agent/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** A pinned cert fingerprint: `sha256:` + 64 lowercase hex chars (DER of the leaf). */
export const TLS_FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * One `servers:` entry in `~/.shed/config.yaml`. Legacy entries carry only
 * host/ports; "secure" entries (the new shed default) add `api_url`
 * (https://host:8443), a bearer `control_token`, and a `tls_cert_fingerprint`
 * to pin the self-signed cert. The `.superRefine` keeps those three coherent so
 * a half-configured secure server fails loudly at parse time, not mid-request.
 */
const serverEntrySchema = z
  .object({
    host: z.string(),
    // Optional: only a plain-HTTP (no api_url) server needs it. Secure servers
    // reach the API via api_url, so http_port may be omitted there.
    http_port: z.number().int().positive().max(65535).optional(),
    ssh_port: z.number().int().positive().max(65535),
    api_url: z.string().optional(),
    control_token: z
      .string()
      .transform((s) => s.trim())
      .optional(),
    control_token_expires_at: z.string().optional(),
    tls_cert_fingerprint: z
      .string()
      .transform((s) => s.trim().toLowerCase())
      .optional(),
  })
  .superRefine((e, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const hasApiUrl = !!e.api_url;
    const isHttps = hasApiUrl && /^https:\/\//i.test(e.api_url ?? '');

    // An `api_url` means secure mode and must be https — a plain-HTTP server is
    // reached via host + http_port, never api_url. Accepting a http:// api_url
    // would let a plaintext, unauthenticated endpoint masquerade as "secure".
    if (hasApiUrl && !isHttps) {
      fail(
        `api_url must be a https:// URL — use http_port for a plain-HTTP server (got "${e.api_url}")`,
      );
    }
    if (isHttps) {
      // control_token is trimmed above, so an empty/whitespace token is falsy here.
      if (!e.control_token) fail('a https api_url requires a non-empty control_token');
      if (!e.tls_cert_fingerprint)
        fail('a https api_url requires tls_cert_fingerprint (cert pinning)');
    }
    // A pin or token without a https api_url would send credentials in the clear.
    if (e.control_token && !isHttps) fail('control_token set without a https api_url');
    if (e.tls_cert_fingerprint && !isHttps)
      fail('tls_cert_fingerprint set without a https api_url');
    if (e.tls_cert_fingerprint && !TLS_FINGERPRINT_RE.test(e.tls_cert_fingerprint)) {
      fail(
        `tls_cert_fingerprint must match "sha256:<64 lowercase hex>" (got "${e.tls_cert_fingerprint}")`,
      );
    }
    // A plain-HTTP server has no api_url, so http_port is the only way to reach it.
    if (!hasApiUrl && e.http_port == null) {
      fail('http_port is required for a plain-HTTP server (one with no api_url)');
    }
  });

const shedCacheSchema = z.object({
  server: z.string(),
  status: z.string().optional(),
});

const clientConfigSchema = z.object({
  servers: z.record(z.string(), serverEntrySchema).optional().default({}),
  default_server: z.string().optional(),
  sheds: z.record(z.string(), shedCacheSchema).optional().default({}),
});

export type ShedClientConfig = z.infer<typeof clientConfigSchema>;

/**
 * Server-side routing target for the shed HTTP client. Unlike the wire {@link Host},
 * this carries the secret material needed to reach a secure server.
 *
 * NEVER SERIALIZE / NEVER return from a route: `controlToken` and
 * `tlsCertFingerprint` must not cross the browser boundary. Only `hostClients`
 * (and the token provider) should ever hold one.
 */
export interface ServerTarget {
  name: string;
  host: string;
  sshPort: number;
  /** Plain-HTTP port; absent for secure servers that only expose `api_url`. */
  httpPort?: number;
  /** True when reached over a pinned HTTPS `api_url` with a bearer token. */
  secure: boolean;
  /** Base URL for the shed HTTP API: `api_url` if set, else `http://host:http_port`. */
  baseUrl: string;
  apiUrl?: string;
  /** Normalized `sha256:<hex>` pin for the self-signed cert (secure only). */
  tlsCertFingerprint?: string;
  /** Bearer control token seed from config (secure only); may be stale/expired. */
  controlToken?: string;
  /** RFC3339 expiry of `controlToken` (secure only). */
  controlTokenExpiresAt?: string;
}

export async function loadShedConfig(filePath: string): Promise<ShedClientConfig> {
  const raw = await readFile(filePath, 'utf8');
  return parseShedConfig(raw);
}

export function parseShedConfig(raw: string): ShedClientConfig {
  const doc = parseYaml(raw) ?? {};
  return clientConfigSchema.parse(doc);
}

function serverTarget(name: string, e: ShedClientConfig['servers'][string]): ServerTarget {
  const secure = !!e.api_url;
  // Legacy (no api_url) entries are guaranteed an http_port by the schema refine.
  const baseUrl = e.api_url ?? `http://${e.host}:${e.http_port}`;
  return {
    name,
    host: e.host,
    sshPort: e.ssh_port,
    ...(e.http_port != null ? { httpPort: e.http_port } : {}),
    secure,
    baseUrl,
    apiUrl: e.api_url,
    tlsCertFingerprint: e.tls_cert_fingerprint,
    controlToken: e.control_token,
    controlTokenExpiresAt: e.control_token_expires_at,
  };
}

/** Server-side targets (with secrets). For `hostClients`/token provider only. */
export function serverTargetsFromConfig(cfg: ShedClientConfig): ServerTarget[] {
  return Object.entries(cfg.servers ?? {}).map(([name, e]) => serverTarget(name, e));
}

export function serverTargetFromConfig(cfg: ShedClientConfig, name: string): ServerTarget | null {
  const e = cfg.servers?.[name];
  return e ? serverTarget(name, e) : null;
}

/** Wire-safe host list for the browser: never includes token/fingerprint/api_url. */
export function hostsFromConfig(cfg: ShedClientConfig): Host[] {
  return Object.entries(cfg.servers ?? {}).map(([name, entry]) => ({
    name,
    host: entry.host,
    // Omit the key entirely (rather than `undefined`) when a secure server has
    // no http_port, so the wire shape stays clean.
    ...(entry.http_port != null ? { httpPort: entry.http_port } : {}),
    sshPort: entry.ssh_port,
    secure: !!entry.api_url,
  }));
}
