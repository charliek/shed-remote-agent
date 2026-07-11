import { createRcRequestSchema, DEFAULT_RC_KIND, type Host } from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { clientForName } from '../lib/hostClients.js';
import { DEFAULT_WORKDIR, genSlug, RC_PREFIX } from '../lib/rc.js';
import { parseJsonBody } from '../lib/requestBody.js';
import { shedRcCreate, shedRcKill, shedRcList } from '../lib/shedRc.js';
import type { CommandTarget } from '../lib/ssh.js';

const rc = new Hono();

function shedCommandTarget(host: Host, shed: string): CommandTarget {
  return { kind: 'ssh', host: host.host, user: shed, port: host.sshPort };
}

rc.get('/:host/:name/rc', async (c) => {
  const { host, name } = c.req.param();
  const { host: h } = await clientForName(host);
  const { sessions, capabilities } = await shedRcList({
    target: shedCommandTarget(h, name),
    host,
    shed: name,
  });
  // capabilities is dropped from the JSON when undefined (old binary) — the same
  // optional-block tolerance the DTO envelope has.
  return c.json({ rc_sessions: sessions, capabilities });
});

rc.post('/:host/:name/rc', async (c) => {
  const { host, name } = c.req.param();
  const { host: h, client } = await clientForName(host);
  const body = createRcRequestSchema.parse(await parseJsonBody(c));
  const kind = body.kind ?? DEFAULT_RC_KIND;

  // Fail fast with a proper 404 if the shed doesn't exist, before paying an
  // SSH round-trip that would surface as a generic error.
  await client.getShed(name);

  // The app generates the slug so it can build its `<shed>/<slug>` display
  // convention; the binary accepts the caller-supplied slug. claude-broker has no
  // pane to type into, so its prompt is dropped here (the binary would 400 it).
  const slug = body.slug ?? genSlug();
  const displayName = body.display_name ?? `${name}/${slug}`;
  const prompt = kind === 'claude-broker' ? undefined : body.initial_prompt;

  const session = await shedRcCreate({
    target: shedCommandTarget(h, name),
    host,
    shed: name,
    kind,
    slug,
    displayName,
    workdir: body.workdir,
    targetLabel: `shed:${name}@${host}`,
    prompt,
  });
  return c.json(session, 201);
});

rc.delete('/:host/:name/rc/:slug', async (c) => {
  const { host, name, slug } = c.req.param();
  const { host: h } = await clientForName(host);
  await shedRcKill({ target: shedCommandTarget(h, name), slug });
  return c.body(null, 204);
});

rc.get('/rc/_meta', (c) => c.json({ prefix: RC_PREFIX, default_workdir: DEFAULT_WORKDIR }));

export default rc;
