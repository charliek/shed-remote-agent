import { describe, expect, it } from 'bun:test';
import { createRcRequestSchema } from '@shed-remote-agent/shared';
import {
  buildRcEnvArgs,
  isDuplicateSessionError,
  isMissingSessionError,
  parseListOutput,
  parseRcEnv,
  parseRcSession,
  RC_CREATED_BY,
  RC_SCHEMA_VERSION,
  RC_TOOL_NAME,
  type RcMetadata,
  rcMetaEnv,
} from '../rc.js';

const META: RcMetadata = {
  id: '9f1c0e7a-1111-4222-8333-444455556666',
  displayName: 'charliek/abc234',
  kind: 'agent',
  workdir: '/workspace',
  createdBy: 'shed-remote-agent/0.1.0',
  createdAt: '2026-06-13T19:20:00Z',
};

// Mimic `tmux show-environment` output for a set of raw key/value pairs.
const renderDump = (pairs: Array<[string, string]>): string =>
  pairs.map(([k, v]) => `${k}=${v}`).join('\n');

describe('rcMetaEnv / buildRcEnvArgs', () => {
  it('emits all required v1 keys with the schema version', () => {
    const pairs = rcMetaEnv(META);
    const keys = pairs.map(([k]) => k);
    expect(keys).toEqual([
      'SHED_RC_V',
      'SHED_RC_ID',
      'SHED_RC_DISPLAY_NAME',
      'SHED_RC_KIND',
      'SHED_RC_WORKDIR',
      'SHED_RC_CREATED_BY',
      'SHED_RC_CREATED_AT',
    ]);
    expect(Object.fromEntries(pairs).SHED_RC_V).toBe(String(RC_SCHEMA_VERSION));
  });

  it('includes SHED_RC_TARGET only when a target label is set', () => {
    expect(rcMetaEnv(META).some(([k]) => k === 'SHED_RC_TARGET')).toBe(false);
    const withTarget = rcMetaEnv({ ...META, target: 'shed:my-shed@host' });
    expect(Object.fromEntries(withTarget).SHED_RC_TARGET).toBe('shed:my-shed@host');
  });

  it('builds -e KEY=value argv with raw (un-escaped) values', () => {
    const args = buildRcEnvArgs({ ...META, displayName: 'Friday Bug Fix' });
    // Each key is preceded by a `-e` flag.
    expect(args.filter((a) => a === '-e')).toHaveLength(7);
    const nameArg = args.find((a) => a.startsWith('SHED_RC_DISPLAY_NAME='));
    // Raw value: run()'s shellQuote makes it a single argv element and tmux
    // stores it verbatim. Escaping here would be persisted literally.
    expect(nameArg).toBe('SHED_RC_DISPLAY_NAME=Friday Bug Fix');
  });

  it('rejects control characters in values (single-line grammar)', () => {
    expect(() => buildRcEnvArgs({ ...META, displayName: 'a\nb' })).toThrow();
    expect(() => buildRcEnvArgs({ ...META, workdir: '/tmp\tx' })).toThrow();
  });
});

describe('parseRcEnv', () => {
  it('parses SHED_RC_* lines, keeps values containing =, ignores others', () => {
    const env = parseRcEnv(
      ['SHED_RC_V=1', 'SHED_RC_WORKDIR=/a=b', '-SHED_RC_GONE', 'OTHER=x', 'noise'].join('\n'),
    );
    expect(env.get('SHED_RC_V')).toBe('1');
    expect(env.get('SHED_RC_WORKDIR')).toBe('/a=b');
    expect(env.has('SHED_RC_GONE')).toBe(false);
    expect(env.has('OTHER')).toBe(false);
  });
});

describe('parseRcSession — round-trip', () => {
  it('recovers all v1 metadata written by rcMetaEnv', () => {
    const r = parseRcSession({
      tmuxSession: 'rc-abc234',
      envDump: renderDump(rcMetaEnv({ ...META, target: 'shed:s@h' })),
      pane: '',
    });
    expect(r.slug).toBe('abc234');
    expect(r.managed).toBe(true);
    expect(r.kind).toBe('agent');
    expect(r.display_name).toBe('charliek/abc234');
    expect(r.workdir).toBe('/workspace');
    expect(r.id).toBe(META.id);
    expect(r.created_by).toBe('shed-remote-agent/0.1.0');
    expect(r.created_at).toBe('2026-06-13T19:20:00Z');
    expect(r.target_label).toBe('shed:s@h');
  });

  it('round-trips values containing spaces and = signs', () => {
    const env = renderDump(
      rcMetaEnv({ ...META, displayName: 'Friday Bug Fix', workdir: '/a=b/c' }),
    );
    const r = parseRcSession({ tmuxSession: 'rc-x', envDump: env, pane: '' });
    expect(r.display_name).toBe('Friday Bug Fix');
    expect(r.workdir).toBe('/a=b/c');
  });
});

describe('parseRcSession — legacy / malformed / forward-compat', () => {
  it('treats a session with no SHED_RC_V as legacy with defaults', () => {
    const r = parseRcSession({
      tmuxSession: 'rc-legacy',
      envDump: '',
      pane: 'charliek@shed:/workspace$ ',
      displayNameFallback: (slug) => `my-shed/${slug}`,
    });
    expect(r.managed).toBe(false);
    expect(r.kind).toBe('agent'); // legacy default, NOT the create default (repl)
    expect(r.display_name).toBe('my-shed/legacy');
    expect(r.workdir).toBeUndefined();
    expect(r.id).toBeUndefined();
    expect(r.created_by).toBeUndefined();
    expect(r.created_at).toBeUndefined();
  });

  it('falls back to the slug when no display name or fallback is available', () => {
    const r = parseRcSession({ tmuxSession: 'rc-bare', envDump: '', pane: '' });
    expect(r.display_name).toBe('bare');
  });

  it('drops a malformed SHED_RC_CREATED_AT rather than surfacing it', () => {
    const env = renderDump([
      ['SHED_RC_V', '1'],
      ['SHED_RC_ID', META.id],
      ['SHED_RC_CREATED_AT', 'not-a-timestamp'],
    ]);
    const r = parseRcSession({ tmuxSession: 'rc-x', envDump: env, pane: '' });
    expect(r.managed).toBe(true);
    expect(r.created_at).toBeUndefined();
  });

  it('treats a non-integer SHED_RC_V as legacy and ignores stray metadata', () => {
    const r = parseRcSession({
      tmuxSession: 'rc-x',
      envDump: renderDump([
        ['SHED_RC_V', 'abc'],
        ['SHED_RC_KIND', 'shell'],
        ['SHED_RC_DISPLAY_NAME', 'spoof'],
        ['SHED_RC_WORKDIR', '/tmp'],
        ['SHED_RC_ID', META.id],
      ]),
      pane: '',
      displayNameFallback: (s) => `fb/${s}`,
    });
    expect(r.managed).toBe(false);
    // Unmanaged sessions get legacy defaults — the stray SHED_RC_* values are
    // not under a known version and must NOT be trusted.
    expect(r.kind).toBe('agent'); // not the stray 'shell'
    expect(r.display_name).toBe('fb/x'); // not 'spoof'
    expect(r.workdir).toBeUndefined(); // not '/tmp'
    expect(r.id).toBeUndefined(); // not the stray id
  });

  it('keeps a higher (future) SHED_RC_V as managed and ignores unknown keys', () => {
    const env = renderDump([
      ['SHED_RC_V', '2'],
      ['SHED_RC_ID', META.id],
      ['SHED_RC_KIND', 'repl'],
      ['SHED_RC_OWNER', 'user:charlie'],
      ['SHED_RC_FUTURE', 'whatever'],
    ]);
    const r = parseRcSession({ tmuxSession: 'rc-x', envDump: env, pane: '' });
    expect(r.managed).toBe(true);
    expect(r.kind).toBe('repl');
    // Unknown/reserved keys are not surfaced on the wire shape.
    expect(Object.keys(r)).not.toContain('owner');
  });
});

describe('parseListOutput', () => {
  // Production builds these from a random per-call nonce; tests use fixed ones.
  const MARKERS = { session: '@@RC:test:S', env: '@@RC:test:E', pane: '@@RC:test:P' };

  it('splits multiple sessions and derives state from each pane', () => {
    const stdout = [
      `${MARKERS.session} rc-aaa111`,
      MARKERS.env,
      ...rcMetaEnv(META).map(([k, v]) => `${k}=${v}`),
      MARKERS.pane,
      '·✔︎· Connected · my-shed · main',
      'https://claude.ai/code?environment=env_01ABC',
      `${MARKERS.session} rc-legacy`,
      MARKERS.env,
      MARKERS.pane,
      'charliek@shed:/workspace$ ',
    ].join('\n');

    const sessions = parseListOutput(stdout, MARKERS, (slug) => `fallback/${slug}`);
    expect(sessions).toHaveLength(2);

    const [managed, legacy] = sessions;
    expect(managed.slug).toBe('aaa111');
    expect(managed.managed).toBe(true);
    expect(managed.state).toBe('ready');
    expect(managed.url).toBe('https://claude.ai/code?environment=env_01ABC');
    expect(managed.display_name).toBe('charliek/abc234');
    expect(managed.id).toBe(META.id);

    expect(legacy.slug).toBe('legacy');
    expect(legacy.managed).toBe(false);
    expect(legacy.display_name).toBe('fallback/legacy');
    expect(legacy.state).toBe('starting');
  });

  it('is not fooled by marker-like text in metadata values or pane', () => {
    const stdout = [
      `${MARKERS.session} rc-evil`,
      MARKERS.env,
      'SHED_RC_V=1',
      `SHED_RC_ID=${META.id}`,
      // A display name equal to the pane-marker text must be kept as a value,
      // not treated as the delimiter (markers are matched as whole lines).
      `SHED_RC_DISPLAY_NAME=${MARKERS.pane}`,
      'SHED_RC_KIND=shell',
      MARKERS.pane,
      // Pane lines resembling the old static delimiter and a near-miss.
      '---RC-PANE---',
      `${MARKERS.pane}X`,
      'normal pane line',
    ].join('\n');

    const sessions = parseListOutput(stdout, MARKERS, (s) => `fb/${s}`);
    expect(sessions).toHaveLength(1); // pane/value text does not spawn a phantom
    expect(sessions[0].slug).toBe('evil');
    expect(sessions[0].display_name).toBe(MARKERS.pane); // preserved verbatim
    expect(sessions[0].kind).toBe('shell');
  });

  it('returns an empty array when no sessions are present', () => {
    expect(parseListOutput('', MARKERS, (s) => s)).toEqual([]);
  });
});

describe('tmux error predicates', () => {
  it('detects a duplicate-session error (→ 409 RC_SLUG_TAKEN)', () => {
    expect(isDuplicateSessionError('duplicate session: rc-demo')).toBe(true);
    expect(isDuplicateSessionError('something else')).toBe(false);
  });

  it('detects a missing-session error (→ idempotent kill)', () => {
    expect(isMissingSessionError("can't find session: rc-demo")).toBe(true);
    expect(isMissingSessionError('no session found')).toBe(true);
    // Killing the last session stops the server; a follow-up kill says this.
    expect(isMissingSessionError('no server running on /tmp/tmux-501/default')).toBe(true);
    expect(isMissingSessionError('connection refused')).toBe(false);
  });
});

describe('provenance constants', () => {
  it('uses the tool name, not the package.json name ("api")', () => {
    expect(RC_TOOL_NAME).toBe('shed-remote-agent');
    expect(RC_CREATED_BY.startsWith('shed-remote-agent/')).toBe(true);
    expect(RC_CREATED_BY.startsWith('api/')).toBe(false);
    expect(RC_SCHEMA_VERSION).toBe(1);
  });
});

describe('createRcRequestSchema.display_name', () => {
  it('accepts spaces but rejects control characters', () => {
    expect(createRcRequestSchema.safeParse({ display_name: 'Friday Bug Fix' }).success).toBe(true);
    expect(createRcRequestSchema.safeParse({ display_name: 'a\nb' }).success).toBe(false);
    expect(createRcRequestSchema.safeParse({ display_name: 'tab\there' }).success).toBe(false);
  });
});
