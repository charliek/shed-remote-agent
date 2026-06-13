import { createRcRequestSchema, DEFAULT_RC_KIND, type Host } from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { clientFor, clientForName } from '../lib/hostClients.js';
import {
  bootstrap,
  DEFAULT_WORKDIR,
  kill,
  listRcSessions,
  probeUntilReady,
  RC_PREFIX,
  toRcSession,
} from '../lib/rc.js';
import { parseJsonBody } from '../lib/requestBody.js';
import type { CommandTarget } from '../lib/ssh.js';

const rc = new Hono();

function shedCommandTarget(host: Host, shed: string): CommandTarget {
  return { kind: 'ssh', host: host.host, user: shed, port: host.sshPort };
}

function shedDisplayFallback(shed: string): (slug: string) => string {
  return (slug) => `${shed}/${slug}`;
}

rc.get('/:host/:name/rc', async (c) => {
  const { host, name } = c.req.param();
  const { host: h } = await clientForName(host);
  const raw = await listRcSessions({
    target: shedCommandTarget(h, name),
    displayNameFallback: shedDisplayFallback(name),
  });
  const sessions = raw.map((r) =>
    toRcSession(r, {
      target: { kind: 'shed', shed_name: name, host },
      defaultWorkdir: DEFAULT_WORKDIR,
    }),
  );
  return c.json({ rc_sessions: sessions });
});

rc.post('/:host/:name/rc', async (c) => {
  const { host, name } = c.req.param();
  const { host: h } = await clientForName(host);
  const body = createRcRequestSchema.parse(await parseJsonBody(c));
  const kind = body.kind ?? DEFAULT_RC_KIND;

  // Fail fast with a proper 404 if the shed doesn't exist, before paying an
  // SSH round-trip that would surface as a generic 500.
  await clientFor(h).getShed(name);

  const target = shedCommandTarget(h, name);
  const targetLabel = `shed:${name}@${host}`;
  const { slug, tmuxSession, displayName, workdir, id, createdBy, createdAt } = await bootstrap({
    target,
    slug: body.slug,
    displayName: body.display_name,
    displayNameFallback: shedDisplayFallback(name),
    workdir: body.workdir,
    kind,
    targetLabel,
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
    { target: { kind: 'shed', shed_name: name, host }, defaultWorkdir: workdir },
  );
  return c.json(session, 201);
});

rc.delete('/:host/:name/rc/:slug', async (c) => {
  const { host, name, slug } = c.req.param();
  const { host: h } = await clientForName(host);
  await kill({ target: shedCommandTarget(h, name), slug });
  return c.body(null, 204);
});

rc.get('/rc/_meta', (c) => c.json({ prefix: RC_PREFIX, default_workdir: DEFAULT_WORKDIR }));

export default rc;
