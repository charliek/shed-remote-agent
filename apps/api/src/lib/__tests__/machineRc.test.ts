import { describe, expect, it } from 'bun:test';
import { machineRcCreate, machineRcKill, machineRcList } from '../machineRc.js';
import type { CommandTarget, SSHResult } from '../ssh.js';

const TARGET: CommandTarget = { kind: 'ssh', host: 'h', user: 'charliek', port: 22 };

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
    display_name: 'mymac/abc234',
    workdir: '/Users/charliek/projects',
    url: 'https://claude.ai/code/session_01',
    id: 'id-1',
    ...over,
  });

const baseCreate = {
  target: TARGET,
  machine: 'mymac',
  kind: 'claude-rc' as const,
  slug: 'abc234',
  displayName: 'mymac/abc234',
  targetLabel: 'machine:mymac',
  defaultWorkdir: '~',
};

describe('machineRcCreate', () => {
  it('invokes `shed-machine-rc create --wait` and adapts the DTO with a machine target', async () => {
    const { runner, calls } = fakeRun({ code: 0, stdout: DTO() });
    const session = await machineRcCreate({ ...baseCreate, prompt: 'do it' }, runner);

    const argv = calls[0].argv;
    expect(argv[0]).toBe('shed-machine-rc');
    expect(argv).toEqual(
      expect.arrayContaining([
        'create',
        '--kind',
        'claude-rc',
        '--name',
        'mymac/abc234',
        '--slug',
        'abc234',
        '--target',
        'machine:mymac',
        '--wait',
        '--prompt-stdin',
      ]),
    );
    expect(calls[0].stdin).toBe('do it'); // prompt via stdin, not argv
    expect(argv).not.toContain('--workdir'); // omitted → binary resolves $HOME

    expect(session.slug).toBe('abc234');
    expect(session.target).toEqual({ kind: 'machine', machine_name: 'mymac' });
    expect(session.state).toBe('ready');
    expect(session.url).toContain('session_');
  });

  it('passes --workdir when set, and omits --prompt-stdin without a prompt', async () => {
    const { runner, calls } = fakeRun({ code: 0, stdout: DTO() });
    await machineRcCreate({ ...baseCreate, workdir: '/Users/charliek/projects' }, runner);
    const argv = calls[0].argv;
    expect(argv).toEqual(expect.arrayContaining(['--workdir', '/Users/charliek/projects']));
    expect(argv).not.toContain('--prompt-stdin');
    expect(calls[0].stdin).toBeUndefined();
  });

  it('uses a per-machine rc_bin override as the binary (the SSH non-login PATH case)', async () => {
    const { runner, calls } = fakeRun({ code: 0, stdout: DTO() });
    await machineRcCreate({ ...baseCreate, rcBin: '/opt/homebrew/bin/shed-machine-rc' }, runner);
    expect(calls[0].argv[0]).toBe('/opt/homebrew/bin/shed-machine-rc');
  });

  it('applies the <machine>/<slug> display fallback when the DTO omits a display name', async () => {
    const { runner } = fakeRun({
      code: 0,
      stdout: DTO({ display_name: undefined, managed: false }),
    });
    const session = await machineRcCreate(baseCreate, runner);
    expect(session.display_name).toBe('mymac/abc234');
  });

  it('maps a duplicate-slug exit (3) to 409 RC_SLUG_TAKEN', async () => {
    const { runner } = fakeRun({ code: 3, stderr: 'rc session already exists' });
    await expect(machineRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'RC_SLUG_TAKEN',
      statusCode: 409,
    });
  });

  it('keeps a domain exit (2) a 400 even when its message contains "no such file"', async () => {
    const { runner } = fakeRun({ code: 2, stderr: 'invalid arguments: workdir /x: no such file' });
    await expect(machineRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'RC_BAD_REQUEST',
      statusCode: 400,
    });
  });

  it('maps a missing binary (exit 127) to MACHINE_RC_MISSING with PATH/rc_bin guidance', async () => {
    const { runner } = fakeRun({ code: 127, stderr: 'bash: shed-machine-rc: command not found' });
    await expect(machineRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'MACHINE_RC_MISSING',
      statusCode: 502,
    });
  });

  it('maps a non-executable binary (exit 126) to MACHINE_RC_MISSING, not an SSH 401', async () => {
    const { runner } = fakeRun({
      code: 126,
      stderr: 'bash: /opt/x/shed-machine-rc: Permission denied',
    });
    await expect(machineRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'MACHINE_RC_MISSING',
      statusCode: 502,
    });
  });

  it('maps an SSH auth failure (255) to 401', async () => {
    const { runner } = fakeRun({ code: 255, stderr: 'Permission denied (publickey).' });
    await expect(machineRcCreate(baseCreate, runner)).rejects.toMatchObject({
      code: 'SSH_AUTH_DENIED',
      statusCode: 401,
    });
  });

  it('maps an SSH connection failure to 502', async () => {
    const { runner } = fakeRun({ code: 255, stderr: 'ssh: connect to host h: Connection refused' });
    await expect(machineRcCreate(baseCreate, runner)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('treats a non-JSON / invalid-shape DTO as a 502 (binary fault, not client 400)', async () => {
    await expect(
      machineRcCreate(baseCreate, fakeRun({ code: 0, stdout: 'not json' }).runner),
    ).rejects.toMatchObject({ code: 'RC_FAILED', statusCode: 502 });
    await expect(
      machineRcCreate(baseCreate, fakeRun({ code: 0, stdout: '{"slug":"x"}' }).runner),
    ).rejects.toMatchObject({ code: 'RC_FAILED', statusCode: 502 });
  });
});

describe('machineRcList', () => {
  it('decodes the DTO list and adapts each with the machine target + fallback', async () => {
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
    const sessions = await machineRcList(
      { target: TARGET, machine: 'mymac', defaultWorkdir: '~' },
      runner,
    );

    expect(calls[0].argv).toEqual(['shed-machine-rc', 'list']);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].display_name).toBe('mymac/abc234');
    // Unmanaged session: DTO omits display_name + workdir → app applies the fallbacks.
    expect(sessions[1].display_name).toBe('mymac/leg');
    expect(sessions[1].workdir).toBe('~');
    expect(sessions[1].target).toEqual({ kind: 'machine', machine_name: 'mymac' });
  });
});

describe('machineRcKill', () => {
  it('invokes `shed-machine-rc kill --slug` and resolves on success', async () => {
    const { runner, calls } = fakeRun({ code: 0 });
    await machineRcKill({ target: TARGET, slug: 'abc234' }, runner);
    expect(calls[0].argv).toEqual(['shed-machine-rc', 'kill', '--slug', 'abc234']);
  });

  it('surfaces a transport failure', async () => {
    const { runner } = fakeRun({ code: 255, stderr: 'no route to host' });
    await expect(machineRcKill({ target: TARGET, slug: 'x' }, runner)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
