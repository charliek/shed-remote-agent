import { createRcRequestSchema, DEFAULT_RC_KIND, type RcSession } from '@shed-remote-agent/shared';
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

const rc = new Hono();

rc.get('/:host/:name/rc', async (c) => {
  const { host, name } = c.req.param();
  const { host: h } = await clientForName(host);
  const sessions = await listRcSessions({ host: h, shed: name });
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

  const { slug, tmuxSession, displayName, workdir } = await bootstrap({
    host: h,
    shed: name,
    slug: body.slug,
    displayName: body.display_name,
    workdir: body.workdir,
    kind,
  });

  const state = await probeUntilReady({ host: h, shed: name, slug, kind });

  const session: RcSession = {
    slug,
    tmux_session: tmuxSession,
    shed_name: name,
    host,
    display_name: displayName,
    workdir,
    kind,
    state: state.state,
    url: state.url,
  };
  return c.json(session, 201);
});

rc.delete('/:host/:name/rc/:slug', async (c) => {
  const { host, name, slug } = c.req.param();
  const { host: h } = await clientForName(host);
  await kill({ host: h, shed: name, slug });
  return c.body(null, 204);
});

rc.get('/rc/_meta', (c) => c.json({ prefix: RC_PREFIX, default_workdir: DEFAULT_WORKDIR }));

export default rc;
