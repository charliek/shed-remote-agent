import { createRcRequestSchema, type RcSession } from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { AppError } from '../lib/errors.js';
import { clientFor, clientForName } from '../lib/hostClients.js';
import {
  bootstrap,
  DEFAULT_WORKDIR,
  kill,
  listRcSessions,
  probeUntilReady,
  RC_PREFIX,
} from '../lib/rc.js';

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

  const raw = await c.req.text();
  let parsed: unknown = {};
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw AppError.badRequest('Invalid JSON body');
    }
  }
  const body = createRcRequestSchema.parse(parsed);

  // Fail fast with a proper 404 if the shed doesn't exist, before paying an
  // SSH round-trip that would surface as a generic 500.
  await clientFor(h).getShed(name);

  const { slug, tmuxSession, displayName, workdir } = await bootstrap({
    host: h,
    shed: name,
    slug: body.slug,
    displayName: body.display_name,
    workdir: body.workdir,
  });

  const state = await probeUntilReady({ host: h, shed: name, slug });

  const session: RcSession = {
    slug,
    tmux_session: tmuxSession,
    shed_name: name,
    host,
    display_name: displayName,
    workdir,
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
