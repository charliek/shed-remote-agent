import { createRcRequestSchema, DEFAULT_RC_KIND, type Machine } from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { machineCommandTarget, requireMachine } from '../lib/machineClients.js';
import { bootstrap, kill, listRcSessions, probeUntilReady, toRcSession } from '../lib/rc.js';
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
    target: machineCommandTarget(m),
    displayNameFallback: machineDisplayFallback(m),
  });
  const sessions = raw.map((r) =>
    toRcSession(r, {
      target: { kind: 'machine', machine_name: m.name },
      defaultWorkdir: defaultWorkdir(m),
    }),
  );
  return c.json({ rc_sessions: sessions });
});

machineRc.post('/:machine/rc', async (c) => {
  const { machine } = c.req.param();
  const m = await requireMachine(machine);
  const body = createRcRequestSchema.parse(await parseJsonBody(c));
  const kind = body.kind ?? DEFAULT_RC_KIND;

  const target = machineCommandTarget(m);
  const targetLabel = `machine:${m.name}`;
  const { slug, tmuxSession, displayName, workdir, id, createdBy, createdAt } = await bootstrap({
    target,
    slug: body.slug,
    displayName: body.display_name,
    displayNameFallback: machineDisplayFallback(m),
    workdir: body.workdir ?? defaultWorkdir(m),
    kind,
    targetLabel,
    interactiveShell: true,
  });

  const state = await probeUntilReady({ target, slug, kind });

  const session = toRcSession(
    {
      slug,
      tmux_session: tmuxSession,
      display_name: displayName,
      workdir,
      kind,
      state: state.state,
      url: state.url,
      id,
      created_by: createdBy,
      created_at: createdAt,
      target_label: targetLabel,
      managed: true,
    },
    { target: { kind: 'machine', machine_name: m.name }, defaultWorkdir: workdir },
  );
  return c.json(session, 201);
});

machineRc.delete('/:machine/rc/:slug', async (c) => {
  const { machine, slug } = c.req.param();
  const m = await requireMachine(machine);
  await kill({ target: machineCommandTarget(m), slug });
  return c.body(null, 204);
});

export default machineRc;
