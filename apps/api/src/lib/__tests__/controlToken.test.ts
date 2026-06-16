import { describe, expect, it } from 'bun:test';
import {
  ControlTokenProvider,
  type MintedToken,
  type ProviderOptions,
  parseTokenBundle,
} from '../controlToken.js';
import type { ServerTarget } from '../shedConfig.js';

const PIN = `sha256:${'a'.repeat(64)}`;

function makeTarget(
  opts: { secure?: boolean; token?: string; expiresAtMs?: number } = {},
): ServerTarget {
  const { secure = true, token = 'seed-tok', expiresAtMs } = opts;
  return {
    name: 'sec',
    host: 'h',
    sshPort: 2222,
    httpPort: 8080,
    secure,
    baseUrl: 'https://h:8443',
    apiUrl: 'https://h:8443',
    tlsCertFingerprint: PIN,
    controlToken: token,
    controlTokenExpiresAt: expiresAtMs == null ? undefined : new Date(expiresAtMs).toISOString(),
  };
}

/** Run `fn` and return the thrown AppError code (or 'NO_THROW'). */
function thrownCode(fn: () => unknown): string {
  try {
    fn();
    return 'NO_THROW';
  } catch (e) {
    return (e as { code?: string }).code ?? 'NO_CODE';
  }
}

describe('parseTokenBundle', () => {
  const target = makeTarget();
  const EXP = '2026-06-17T00:00:00Z';
  const bundle = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ token: 'tok', scope: 'control', expires_at: EXP, ...over });

  it('accepts a valid control bundle', () => {
    const out = parseTokenBundle(bundle(), target);
    expect(out.token).toBe('tok');
    expect(out.expiresAt?.toISOString()).toBe('2026-06-17T00:00:00.000Z');
  });

  it('accepts a matching minted fingerprint', () => {
    expect(parseTokenBundle(bundle({ tls_cert_fingerprint: PIN }), target).token).toBe('tok');
  });

  it('rejects a non-control scope', () => {
    expect(thrownCode(() => parseTokenBundle(bundle({ scope: 'credentials' }), target))).toBe(
      'SHED_AUTH_EXPIRED',
    );
  });

  it('rejects a minted fingerprint that differs from the configured pin (no silent re-pin)', () => {
    expect(
      thrownCode(() =>
        parseTokenBundle(bundle({ tls_cert_fingerprint: `sha256:${'b'.repeat(64)}` }), target),
      ),
    ).toBe('SHED_TLS_PIN_MISMATCH');
  });

  it('rejects unparseable JSON', () => {
    expect(thrownCode(() => parseTokenBundle('not json', target))).toBe('SHED_AUTH_EXPIRED');
  });

  it('rejects an empty or whitespace-only token', () => {
    expect(thrownCode(() => parseTokenBundle(bundle({ token: '' }), target))).toBe(
      'SHED_AUTH_EXPIRED',
    );
    expect(thrownCode(() => parseTokenBundle(bundle({ token: '   ' }), target))).toBe(
      'SHED_AUTH_EXPIRED',
    );
  });

  it('rejects a missing or unparseable expiry (fails closed, never non-expiring)', () => {
    expect(
      thrownCode(() => parseTokenBundle(JSON.stringify({ token: 't', scope: 'control' }), target)),
    ).toBe('SHED_AUTH_EXPIRED');
    expect(thrownCode(() => parseTokenBundle(bundle({ expires_at: 'nope' }), target))).toBe(
      'SHED_AUTH_EXPIRED',
    );
  });
});

describe('ControlTokenProvider', () => {
  const FAR = 10_000_000;

  function setup(opts: {
    now: () => number;
    target: () => ServerTarget;
    mint: () => Promise<MintedToken>;
    refreshWindowMs?: number;
    cooldownMs?: number;
  }) {
    let mintCalls = 0;
    const providerOpts: ProviderOptions = {
      resolve: async () => opts.target(),
      minter: async () => {
        mintCalls += 1;
        return opts.mint();
      },
      now: opts.now,
      refreshWindowMs: opts.refreshWindowMs ?? 1000,
      cooldownMs: opts.cooldownMs ?? 60_000,
      jitterMs: 0,
    };
    return { provider: new ControlTokenProvider('sec', providerOpts), calls: () => mintCalls };
  }

  it('returns undefined for a legacy (non-secure) host', async () => {
    const { provider, calls } = setup({
      now: () => 1000,
      target: () => makeTarget({ secure: false }),
      mint: async () => ({ token: 'minted', expiresAt: null }),
    });
    expect(await provider.get()).toBeUndefined();
    expect(calls()).toBe(0);
  });

  it('uses the config seed without minting when it is fresh', async () => {
    const now = 1_000_000;
    const { provider, calls } = setup({
      now: () => now,
      target: () => makeTarget({ expiresAtMs: now + FAR }),
      mint: async () => ({ token: 'minted', expiresAt: new Date(now + FAR) }),
    });
    expect(await provider.get()).toBe('seed-tok');
    expect(calls()).toBe(0);
  });

  it('proactively mints when the token is within the refresh window', async () => {
    const now = 1_000_000;
    const { provider, calls } = setup({
      now: () => now,
      // expires in 500ms, inside the 1000ms refresh window (but not yet expired).
      target: () => makeTarget({ expiresAtMs: now + 500 }),
      mint: async () => ({ token: 'minted', expiresAt: new Date(now + FAR) }),
    });
    expect(await provider.get()).toBe('minted');
    expect(calls()).toBe(1);
  });

  it('keeps a still-valid token when a proactive mint fails', async () => {
    const now = 1_000_000;
    const { provider } = setup({
      now: () => now,
      target: () => makeTarget({ expiresAtMs: now + 500 }),
      mint: async () => {
        throw new Error('ssh down');
      },
    });
    expect(await provider.get()).toBe('seed-tok');
  });

  it('mints when the seed is expired, and throws if that mint fails', async () => {
    let now = 1_000_000;
    let healthy = false;
    const { provider } = setup({
      now: () => now,
      target: () => makeTarget({ expiresAtMs: now - 1 }), // already expired
      mint: async () => {
        if (!healthy) throw new Error('ssh down');
        return { token: 'minted', expiresAt: new Date(now + FAR) };
      },
    });
    await expect(provider.get()).rejects.toMatchObject({ code: 'SHED_AUTH_EXPIRED' });
    healthy = true;
    now += 120_000; // past the cooldown
    expect(await provider.get()).toBe('minted');
  });

  it('collapses concurrent mints into one (single-flight)', async () => {
    const now = 1_000_000;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { provider, calls } = setup({
      now: () => now,
      target: () => makeTarget({ expiresAtMs: now - 1 }),
      mint: async () => {
        await gate;
        return { token: 'minted', expiresAt: new Date(now + FAR) };
      },
    });
    const a = provider.get();
    const b = provider.get();
    release();
    expect(await a).toBe('minted');
    expect(await b).toBe('minted');
    expect(calls()).toBe(1);
  });

  it('forces a fresh mint on invalidate (a 401), not the rejected token', async () => {
    const now = 1_000_000;
    const { provider, calls } = setup({
      now: () => now,
      target: () => makeTarget({ expiresAtMs: now + FAR }), // seed is clock-valid
      mint: async () => ({ token: 'minted', expiresAt: new Date(now + FAR) }),
    });
    expect(await provider.get()).toBe('seed-tok');
    provider.invalidate('seed-tok');
    expect(await provider.get()).toBe('minted');
    expect(calls()).toBe(1);
  });

  it('does not re-SSH within the cooldown after a failed mint', async () => {
    let now = 1_000_000;
    const { provider, calls } = setup({
      now: () => now,
      target: () => makeTarget({ expiresAtMs: now - 1 }),
      mint: async () => {
        throw new Error('ssh down');
      },
    });
    await expect(provider.get()).rejects.toMatchObject({ code: 'SHED_AUTH_EXPIRED' });
    now += 1000; // still inside the 60s cooldown
    await expect(provider.get()).rejects.toMatchObject({ code: 'SHED_AUTH_EXPIRED' });
    expect(calls()).toBe(1); // the second get() never invoked the minter
  });

  it('ignores a stale 401 for a token it has already rotated past', async () => {
    const now = 1_000_000;
    const { provider, calls } = setup({
      now: () => now,
      target: () => makeTarget({ expiresAtMs: now + 500 }), // seed near expiry → proactive mint
      mint: async () => ({ token: 'minted', expiresAt: new Date(now + FAR) }),
    });
    expect(await provider.get()).toBe('minted'); // rotated seed → minted
    provider.invalidate('seed-tok'); // a late 401 for the old seed token
    expect(await provider.get()).toBe('minted'); // not force-minted over the valid token
    expect(calls()).toBe(1);
  });

  it('drops the cached token when the host transport identity changes', async () => {
    const now = 1_000_000;
    let fp = `sha256:${'a'.repeat(64)}`;
    const { provider, calls } = setup({
      now: () => now,
      target: () => ({ ...makeTarget({ expiresAtMs: now - 1 }), tlsCertFingerprint: fp }),
      mint: async () => ({ token: `minted-${fp.slice(7, 11)}`, expiresAt: new Date(now + FAR) }),
    });
    const first = await provider.get(); // mints for identity A
    fp = `sha256:${'b'.repeat(64)}`; // host re-keyed under the same name
    const second = await provider.get(); // must drop A's token and mint for B
    expect(second).not.toBe(first);
    expect(calls()).toBe(2);
  });
});
