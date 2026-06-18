import { createRcRequestSchema, DEFAULT_RC_KIND, type Host } from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { clientForName } from '../lib/hostClients.js';
import {
  bootstrap,
  DEFAULT_WORKDIR,
  kill,
  listRcSessions,
  preseedTrust,
  probeUntilReady,
  RC_PREFIX,
  resolveShedWorkdir,
  sendTrustAccept,
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
  const { host: h, client } = await clientForName(host);
  const body = createRcRequestSchema.parse(await parseJsonBody(c));
  const kind = body.kind ?? DEFAULT_RC_KIND;

  // Fail fast with a proper 404 if the shed doesn't exist, before paying an
  // SSH round-trip that would surface as a generic 500.
  await client.getShed(name);

  const target = shedCommandTarget(h, name);
  const targetLabel = `shed:${name}@${host}`;
  // Recent sheds land in SHED_WORKSPACE (their home / project dir), not the old
  // static /workspace. An explicit body.workdir wins; fall back to DEFAULT_WORKDIR
  // when the shed predates the env var.
  const workdir = body.workdir ?? (await resolveShedWorkdir(target)) ?? DEFAULT_WORKDIR;

  // claude (repl/agent) gates on a first-run workspace-trust prompt. Pre-seed the
  // trust for the workdir before launch (best-effort), and arm a send-keys accept
  // as the fallback during probing, so a fresh session reaches `ready` unattended.
  const isClaudeKind = kind !== 'shell';
  if (isClaudeKind) await preseedTrust(target, workdir);

  const {
    slug,
    tmuxSession,
    displayName,
    workdir: resolvedWorkdir,
    id,
    createdBy,
    createdAt,
  } = await bootstrap({
    target,
    slug: body.slug,
    displayName: body.display_name,
    displayNameFallback: shedDisplayFallback(name),
    workdir,
    kind,
    targetLabel,
  });

  const state = await probeUntilReady({
    target,
    slug,
    kind,
    acceptTrust: isClaudeKind ? () => sendTrustAccept(target, tmuxSession) : undefined,
  });

  const session = toRcSession(
    {
      slug,
      tmux_session: tmuxSession,
      display_name: displayName,
      workdir: resolvedWorkdir,
      kind,
      state: state.state,
      url: state.url,
      id,
      created_by: createdBy,
      created_at: createdAt,
      target_label: targetLabel,
      managed: true,
    },
    { target: { kind: 'shed', shed_name: name, host }, defaultWorkdir: resolvedWorkdir },
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
