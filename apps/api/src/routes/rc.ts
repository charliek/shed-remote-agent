import {
  createRcRequestSchema,
  DEFAULT_RC_KIND,
  type Host,
  type RcSession,
} from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { clientFor, clientForName } from '../lib/hostClients.js';
import {
  bootstrap,
  DEFAULT_WORKDIR,
  kill,
  listRcSessions,
  probeUntilReady,
  RC_PREFIX,
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
  const sessions: RcSession[] = raw.map((r) => ({
    slug: r.slug,
    tmux_session: r.tmux_session,
    display_name: r.display_name,
    // Prefer the workdir we stored at bootstrap; fall back to the shed
    // default for sessions created before SRA_WORKDIR was added.
    workdir: r.workdir ?? DEFAULT_WORKDIR,
    kind: r.kind,
    state: r.state,
    url: r.url,
    target: { kind: 'shed', shed_name: name, host: host },
  }));
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
  const { slug, tmuxSession, displayName, workdir } = await bootstrap({
    target,
    slug: body.slug,
    displayName: body.display_name,
    displayNameFallback: shedDisplayFallback(name),
    workdir: body.workdir,
    kind,
  });

  const state = await probeUntilReady({ target, slug, kind });

  const session: RcSession = {
    slug,
    tmux_session: tmuxSession,
    display_name: displayName,
    workdir,
    kind,
    state: state.state,
    url: state.url,
    target: { kind: 'shed', shed_name: name, host: host },
  };
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
