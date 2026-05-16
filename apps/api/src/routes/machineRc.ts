import {
  createRcRequestSchema,
  DEFAULT_RC_KIND,
  type Machine,
  type RcSession,
} from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { machineSshTarget, requireMachine } from '../lib/machineClients.js';
import { bootstrap, kill, listRcSessions, probeUntilReady } from '../lib/rc.js';
import { parseJsonBody } from '../lib/requestBody.js';

const machineRc = new Hono();

function defaultWorkdir(m: Machine): string {
  return m.workdir ?? '~';
}

function machineDisplayFallback(m: Machine): (slug: string) => string {
  return (slug) => `${m.name}/${slug}`;
}

machineRc.get('/:machine/rc', async (c) => {
  const { machine } = c.req.param();
  const m = await requireMachine(machine);
  const raw = await listRcSessions({
    ssh: machineSshTarget(m),
    displayNameFallback: machineDisplayFallback(m),
  });
  const sessions: RcSession[] = raw.map((r) => ({
    slug: r.slug,
    tmux_session: r.tmux_session,
    display_name: r.display_name,
    // Prefer the workdir we stored at bootstrap; fall back to the
    // machine default for sessions created before SRA_WORKDIR was added.
    workdir: r.workdir ?? defaultWorkdir(m),
    kind: r.kind,
    state: r.state,
    url: r.url,
    target: { kind: 'machine', machine_name: m.name },
  }));
  return c.json({ rc_sessions: sessions });
});

machineRc.post('/:machine/rc', async (c) => {
  const { machine } = c.req.param();
  const m = await requireMachine(machine);
  const body = createRcRequestSchema.parse(await parseJsonBody(c));
  const kind = body.kind ?? DEFAULT_RC_KIND;

  const ssh = machineSshTarget(m);
  const { slug, tmuxSession, displayName, workdir } = await bootstrap({
    ssh,
    slug: body.slug,
    displayName: body.display_name,
    displayNameFallback: machineDisplayFallback(m),
    workdir: body.workdir ?? defaultWorkdir(m),
    kind,
    interactiveShell: true,
  });

  const state = await probeUntilReady({ ssh, slug, kind });

  const session: RcSession = {
    slug,
    tmux_session: tmuxSession,
    display_name: displayName,
    workdir,
    kind,
    state: state.state,
    url: state.url,
    target: { kind: 'machine', machine_name: m.name },
  };
  return c.json(session, 201);
});

machineRc.delete('/:machine/rc/:slug', async (c) => {
  const { machine, slug } = c.req.param();
  const m = await requireMachine(machine);
  await kill({ ssh: machineSshTarget(m), slug });
  return c.body(null, 204);
});

export default machineRc;
