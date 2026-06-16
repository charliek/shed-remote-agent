import { z } from 'zod';
import { getServerTarget } from './configStore.js';
import { AppError } from './errors.js';
import type { TokenSource } from './shedClient.js';
import type { ServerTarget } from './shedConfig.js';
import { TLS_FINGERPRINT_RE } from './shedConfig.js';
import { run } from './ssh.js';

/**
 * Per-host bearer control-token provider. Mints/refreshes the token over the
 * reserved `_bootstrap` SSH user (the same authority the `shed` CLI uses) and
 * keeps it in memory only — it never writes `~/.shed/config.yaml`, so it can't
 * race the CLI. The config token is a seed used until the first mint.
 *
 * Design (mirrors shed-desktop's provider):
 *  - single-flight: concurrent callers share one in-flight mint.
 *  - proactive: refresh once the token is within the refresh window of expiry,
 *    but keep using a still-valid token if that refresh mint fails.
 *  - reactive: a 401 (`invalidate`) forces a fresh mint — the rejected token is
 *    never reused even if its clock-expiry hasn't passed.
 *  - cooldown: after a failed mint, suppress SSH for a backoff window so a poll
 *    loop can't storm an unreachable host.
 *  - the minted cert fingerprint must equal the configured pin (no silent re-pin).
 */

/** Reserved SSH user the shed server intercepts to mint an HTTP token bundle. */
const BOOTSTRAP_USER = '_bootstrap';
/** Advisory client-kind audit tag (the server records it; unknown kinds are fine). */
const CLIENT_KIND = 'shed-remote-agent';
const MINT_TIMEOUT_MS = 15_000;
/** Refresh when within 2h of expiry, plus a 5m clock-skew cushion. */
const DEFAULT_REFRESH_WINDOW_MS = 2 * 60 * 60_000 + 5 * 60_000;
/** Spread refreshes across hosts so a fleet doesn't mint in lockstep. */
const DEFAULT_JITTER_MS = 5 * 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;

export interface MintedToken {
  token: string;
  /** null = no known expiry (treat as non-expiring). */
  expiresAt: Date | null;
}

export type Minter = (target: ServerTarget) => Promise<MintedToken>;

const bundleSchema = z.object({
  token: z.string().min(1),
  scope: z.string(),
  tls_cert_fingerprint: z.string().optional(),
  // A real mint always carries an expiry; require it so a malformed bundle fails
  // closed rather than being cached as a never-expiring token.
  expires_at: z.string(),
});

/**
 * Validate an SSH bootstrap bundle (one JSON line) into a token, failing closed
 * on a bad scope, a missing/unparseable expiry, an empty token, or a minted
 * fingerprint that doesn't match the configured pin (a trust-model change we
 * refuse to make silently).
 */
export function parseTokenBundle(stdout: string, target: ServerTarget): MintedToken {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw AppError.authExpired();
  }
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) throw AppError.authExpired();
  const bundle = parsed.data;

  if (bundle.scope !== 'control') throw AppError.authExpired();

  const token = bundle.token.trim();
  if (!token) throw AppError.authExpired(); // reject whitespace-only tokens

  if (target.tlsCertFingerprint && bundle.tls_cert_fingerprint) {
    const minted = bundle.tls_cert_fingerprint.trim().toLowerCase();
    if (!TLS_FINGERPRINT_RE.test(minted) || minted !== target.tlsCertFingerprint) {
      throw AppError.tlsPinMismatch();
    }
  }

  const expiresAt = new Date(bundle.expires_at);
  if (Number.isNaN(expiresAt.getTime())) throw AppError.authExpired();
  return { token, expiresAt };
}

/** Mint a fresh control token over the `_bootstrap` SSH channel. */
export async function mintViaSSH(target: ServerTarget): Promise<MintedToken> {
  const res = await run(
    { kind: 'ssh', host: target.host, user: BOOTSTRAP_USER, port: target.sshPort },
    ['control', CLIENT_KIND],
    { timeoutMs: MINT_TIMEOUT_MS },
  );
  // Never surface SSH stdout/stderr (could echo token material) — log-and-fail.
  if (res.code !== 0) throw AppError.authExpired();
  return parseTokenBundle(res.stdout, target);
}

export interface ProviderOptions {
  /** Resolve the current config target (defaults to the 5s-memoized config). */
  resolve?: () => Promise<ServerTarget | null>;
  minter?: Minter;
  now?: () => number;
  refreshWindowMs?: number;
  cooldownMs?: number;
  jitterMs?: number;
}

export class ControlTokenProvider implements TokenSource {
  private cached: MintedToken | null = null;
  /** Transport identity the cached token was issued for; clears it on a change. */
  private cachedIdentity: string | null = null;
  private inflight: Promise<MintedToken> | null = null;
  private cooldownUntil = 0;
  private lastError: AppError | null = null;
  /** Set by a 401: force a mint even if the current token isn't clock-expired. */
  private mustMint = false;

  private readonly resolve: () => Promise<ServerTarget | null>;
  private readonly minter: Minter;
  private readonly now: () => number;
  private readonly refreshWindowMs: number;
  private readonly cooldownMs: number;
  private readonly jitter: number;

  constructor(
    private readonly name: string,
    opts: ProviderOptions = {},
  ) {
    this.resolve = opts.resolve ?? (() => getServerTarget(name));
    this.minter = opts.minter ?? mintViaSSH;
    this.now = opts.now ?? Date.now;
    this.refreshWindowMs = opts.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.jitter = nameJitter(name, opts.jitterMs ?? DEFAULT_JITTER_MS);
  }

  async get(): Promise<string | undefined> {
    const target = await this.resolve();
    if (!target?.secure) return undefined; // legacy host: no bearer token
    const now = this.now();

    // If the host's transport identity changed under the same name (e.g. a
    // re-key or open→secure flip), the in-memory token belongs to a different
    // endpoint — drop it so we never send it to the new target.
    const id = targetIdentity(target);
    if (this.cached && this.cachedIdentity !== id) {
      this.cached = null;
      this.cachedIdentity = null;
      this.mustMint = false;
    }

    // Reactive: a prior 401 means the current token is rejected — mint, and do
    // not fall back to it. A failed mint (incl. cooldown) surfaces as auth error.
    if (this.mustMint) {
      const minted = await this.mint(target, now);
      if (minted) {
        this.mustMint = false;
        return minted.token;
      }
      throw this.lastError ?? AppError.authExpired();
    }

    // In-memory minted token is authoritative; the config token is a seed.
    const current = this.cached ?? this.seedToken(target);
    if (current && !this.expired(current, now)) {
      // Proactive refresh near expiry — best-effort, keep the valid token on fail.
      if (this.needsRefresh(current, now)) {
        const minted = await this.mint(target, now);
        if (minted) return minted.token;
      }
      // Adopt the seed as the in-memory token, tagged with the current identity.
      if (!this.cached) {
        this.cached = current;
        this.cachedIdentity = id;
      }
      return current.token;
    }

    // No usable token: mint or fail.
    const minted = await this.mint(target, now);
    if (minted) return minted.token;
    throw this.lastError ?? AppError.authExpired();
  }

  invalidate(token: string): void {
    // Ignore a 401 for a token we've already rotated past — otherwise a late
    // 401 from an older request would force-mint over a fresh, valid token.
    if (this.cached && this.cached.token !== token) return;
    this.cached = null;
    this.mustMint = true;
  }

  /** Single-flight mint with a failure cooldown. Returns null on (or during) failure. */
  private async mint(target: ServerTarget, now: number): Promise<MintedToken | null> {
    if (now < this.cooldownUntil) return null;
    if (!this.inflight) {
      const p = this.doMint(target);
      this.inflight = p;
      // Free the slot when this mint settles; swallow here since every awaiter
      // observes the rejection via `await this.inflight`.
      p.finally(() => {
        if (this.inflight === p) this.inflight = null;
      }).catch(() => {});
    }
    try {
      return await this.inflight;
    } catch {
      // Side effects (cooldown, lastError) are recorded once inside doMint.
      return null;
    }
  }

  /** The shared mint body — records cache/cooldown/error exactly once per attempt. */
  private async doMint(target: ServerTarget): Promise<MintedToken> {
    try {
      const minted = await this.minter(target);
      this.cached = minted;
      this.cachedIdentity = targetIdentity(target);
      this.lastError = null;
      return minted;
    } catch (err) {
      this.cooldownUntil = this.now() + this.cooldownMs;
      this.lastError = err instanceof AppError ? err : AppError.authExpired();
      throw err;
    }
  }

  private seedToken(target: ServerTarget): MintedToken | null {
    if (!target.controlToken) return null;
    const expiresAt = target.controlTokenExpiresAt ? new Date(target.controlTokenExpiresAt) : null;
    return {
      token: target.controlToken,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    };
  }

  private expired(t: MintedToken, now: number): boolean {
    return t.expiresAt != null && now >= t.expiresAt.getTime();
  }

  private needsRefresh(t: MintedToken, now: number): boolean {
    if (t.expiresAt == null) return false;
    return now >= t.expiresAt.getTime() - this.refreshWindowMs - this.jitter;
  }
}

/** Transport identity a token is bound to; a change must invalidate the token. */
function targetIdentity(t: ServerTarget): string {
  return `${t.host}|${t.sshPort}|${t.baseUrl}|${t.tlsCertFingerprint ?? ''}`;
}

/** Deterministic per-name jitter in [0, maxMs) — stable across restarts, no RNG. */
function nameJitter(name: string, maxMs: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h) % Math.max(1, maxMs);
}
