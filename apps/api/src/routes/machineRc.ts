import { createRcRequestSchema, DEFAULT_RC_KIND, type Machine } from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { machineCommandTarget, requireMachine } from '../lib/machineClients.js';
import { machineRcCreate, machineRcKill, machineRcList } from '../lib/machineRc.js';
import { genSlug } from '../lib/rc.js';
import { parseJsonBody } from '../lib/requestBody.js';

const machineRc = new Hono();

// Wire fallback for a legacy/unmanaged session that carries no SHED_RC_WORKDIR.
// Display-only — never passed to the binary as --workdir (that stays a real dir or
// omitted, so the binary resolves $HOME).
function defaultWorkdir(m: Machine): string {
  return m.workdir ?? '~';
}

machineRc.get('/:machine/rc', async (c) => {
  const { machine } = c.req.param();
  const m = await requireMachine(machine);
  const { sessions, capabilities } = await machineRcList({
    target: machineCommandTarget(m),
    machine: m.name,
    rcBin: m.rc_bin,
    defaultWorkdir: defaultWorkdir(m),
  });
  // capabilities is dropped from the JSON when undefined (old binary) — the same
  // optional-block tolerance the DTO envelope has.
  return c.json({ rc_sessions: sessions, capabilities });
});

machineRc.post('/:machine/rc', async (c) => {
  const { machine } = c.req.param();
  const m = await requireMachine(machine);
  const body = createRcRequestSchema.parse(await parseJsonBody(c));
  const kind = body.kind ?? DEFAULT_RC_KIND;

  // The app generates the slug so it can build its `<machine>/<slug>` display
  // convention; the binary accepts the caller-supplied slug. claude-broker has no
  // pane to type into, so its prompt is dropped here (the binary would 400 it).
  const slug = body.slug ?? genSlug();
  const displayName = body.display_name ?? `${m.name}/${slug}`;
  const prompt = kind === 'claude-broker' ? undefined : body.initial_prompt;

  const session = await machineRcCreate({
    target: machineCommandTarget(m),
    machine: m.name,
    rcBin: m.rc_bin,
    kind,
    slug,
    displayName,
    // A real directory or undefined — never the "~" wire fallback.
    workdir: body.workdir ?? m.workdir,
    targetLabel: `machine:${m.name}`,
    prompt,
    defaultWorkdir: defaultWorkdir(m),
  });
  return c.json(session, 201);
});

machineRc.delete('/:machine/rc/:slug', async (c) => {
  const { machine, slug } = c.req.param();
  const m = await requireMachine(machine);
  await machineRcKill({ target: machineCommandTarget(m), slug, rcBin: m.rc_bin });
  return c.body(null, 204);
});

export default machineRc;
