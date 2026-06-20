import { describe, expect, it } from 'bun:test';
import { shedRcCreate, shedRcKill, shedRcList } from '../shedRc.js';
import type { CommandTarget, SSHResult } from '../ssh.js';

const TARGET: CommandTarget = { kind: 'ssh', host: 'h', user: 'demo', port: 2222 };

// A fake `run()` recording argv + stdin and returning a canned SSHResult.
function fakeRun(result: Partial<SSHResult> & { code: number }) {
  const calls: { argv: string[]; stdin?: string }[] = [];
  const runner = (async (_t: CommandTarget, argv: string[], opts?: { stdin?: string }) => {
    calls.push({ argv, stdin: opts?.stdin });
    return { code: result.code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }) as unknown as typeof import('../ssh.js').run;
  return { runner, calls };
}

const DTO = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    slug: 'abc234',
    tmux_session: 'rc-abc234',
    kind: 'claude-rc',
    state: 'ready',
    managed: true,
    display_name: 'demo/abc234',
    workdir: '/home/shed',
    url: 'https://claude.ai/code/session_01',
    id: 'id-1',
    ...over,
  });

const baseCreate = {
  target: TARGET,
  host: 'h',
  shed: 'demo',
  kind: 'claude-rc' as const,
  slug: 'abc234',
  displayName: 'demo/abc234',
  targetLabel: 'shed:demo@h',
};

describe('shedRcCreate', () => {
  it('invokes `shed-ext-rc create --wait` and adapts the DTO with a shed target', async () => {
    const { runner, calls } = fakeRun({ code: 0, stdout: DTO() });
    const session = await shedRcCreate({ ...baseCreate, prompt: 'do it' }, runner);

    const argv = calls[0].argv;
    expect(argv[0]).toBe('shed-ext-rc');
    expect(argv).toEqual(
      expect.arrayContaining([
        'create',
        '--kind',
        'claude-rc',
        '--name',
        'demo/abc234',
        '--slug',
        'abc234',
        '--wait',
        '--prompt-stdin',
      ]),
    );
    expect(calls[0].stdin).toBe('do it'); // prompt via stdin, not argv
    expect(argv).not.toContain('--workdir'); // omitted → binary resolves $SHED_WORKSPACE

    expect(session.slug).toBe('abc234');
    expect(session.target).toEqual({ kind: 'shed', shed_name: 'demo', host: 'h' });
    expect(session.state).toBe('ready');
    expect(session.url).toContain('session_');
  });

  it('passes --workdir when set, and omits --prompt-stdin without a prompt', async () => {
    const { runner, calls } = fakeRun({ code: 0, stdout: DTO() });
    await shedRcCreate({ ...baseCreate, workdir: '/home/shed/proj' }, runner);
    const argv = calls[0].argv;
    expect(argv).toEqual(expect.arrayContaining(['--workdir', '/home/shed/proj']));
    expect(argv).not.toContain('--prompt-stdin');
    expect(calls[0].stdin).toBeUndefined();
  });

  it('applies the <shed>/<slug> display fallback when the DTO omits a display name', async () => {
    const { runner } = fakeRun({
      code: 0,
      stdout: DTO({ display_name: undefined, managed: false }),
    });
    const session = await shedRcCreate(baseCreate, runner);
    expect(session.display_name).toBe('demo/abc234');
  });

  it('maps a duplicate-slug exit (3) to 409 RC_SLUG_TAKEN', async () => {
    const { runner } = fakeRun({ code: 3, stderr: 'rc session already exists' });
    await expect(shedRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'RC_SLUG_TAKEN',
      statusCode: 409,
    });
  });

  it('maps a bad-args exit (2) to 400', async () => {
    const { runner } = fakeRun({ code: 2, stderr: 'kind does not accept a prompt' });
    await expect(shedRcCreate(baseCreate, runner)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('maps a missing binary (exit 127) to a clear "not installed" 502', async () => {
    const { runner } = fakeRun({ code: 127, stderr: 'bash: shed-ext-rc: command not found' });
    await expect(shedRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'SHED_EXT_RC_MISSING',
      statusCode: 502,
    });
  });

  it('maps an SSH auth failure (255) to 401', async () => {
    const { runner } = fakeRun({ code: 255, stderr: 'Permission denied (publickey).' });
    await expect(shedRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'SSH_AUTH_DENIED',
      statusCode: 401,
    });
  });

  it('maps an SSH connection failure to 502', async () => {
    const { runner } = fakeRun({ code: 255, stderr: 'ssh: connect to host h: Connection refused' });
    await expect(shedRcCreate(baseCreate, runner)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('keeps a domain exit (2) a 400 even when its message contains "no such file"', async () => {
    // Domain codes are classified before the missing-binary heuristic.
    const { runner } = fakeRun({ code: 2, stderr: 'invalid arguments: workdir /x: no such file' });
    await expect(shedRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'RC_BAD_REQUEST',
      statusCode: 400,
    });
  });

  it('treats a non-JSON / invalid-shape DTO as a 502 (binary fault, not client 400)', async () => {
    await expect(
      shedRcCreate(baseCreate, fakeRun({ code: 0, stdout: 'not json' }).runner),
    ).rejects.toMatchObject({
      code: 'RC_FAILED',
      statusCode: 502,
    });
    // Valid JSON, wrong shape (missing required fields) → still 502.
    await expect(
      shedRcCreate(baseCreate, fakeRun({ code: 0, stdout: '{"slug":"x"}' }).runner),
    ).rejects.toMatchObject({ code: 'RC_FAILED', statusCode: 502 });
  });
});

describe('shedRcList', () => {
  it('decodes the DTO list and adapts each with the shed target + fallback', async () => {
    const stdout = JSON.stringify({
      rc_sessions: [
        JSON.parse(DTO()),
        {
          slug: 'leg',
          tmux_session: 'rc-leg',
          kind: 'claude-broker',
          state: 'starting',
          managed: false,
        },
      ],
    });
    const { runner, calls } = fakeRun({ code: 0, stdout });
    const sessions = await shedRcList({ target: TARGET, host: 'h', shed: 'demo' }, runner);

    expect(calls[0].argv).toEqual(['shed-ext-rc', 'list']);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].display_name).toBe('demo/abc234');
    // Unmanaged session: DTO omits display_name → app applies <shed>/<slug>.
    expect(sessions[1].display_name).toBe('demo/leg');
    expect(sessions[1].target).toEqual({ kind: 'shed', shed_name: 'demo', host: 'h' });
  });
});

describe('shedRcKill', () => {
  it('invokes `shed-ext-rc kill --slug` and resolves on success', async () => {
    const { runner, calls } = fakeRun({ code: 0 });
    await shedRcKill({ target: TARGET, slug: 'abc234' }, runner);
    expect(calls[0].argv).toEqual(['shed-ext-rc', 'kill', '--slug', 'abc234']);
  });

  it('surfaces a transport failure', async () => {
    const { runner } = fakeRun({ code: 255, stderr: 'no route to host' });
    await expect(shedRcKill({ target: TARGET, slug: 'x' }, runner)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
