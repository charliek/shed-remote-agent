import { Hono } from 'hono';
import { AppError } from '../lib/errors.js';
import { machineSshTarget, requireMachine } from '../lib/machineClients.js';
import { listWorkspaces } from '../lib/workspaces.js';

const machineWorkspaces = new Hono();

machineWorkspaces.get('/:machine/workspaces', async (c) => {
  const { machine } = c.req.param();
  const m = await requireMachine(machine);
  if (!m.workdir) {
    throw AppError.badRequest(
      `machine '${m.name}' has no workdir configured; set machines[].workdir in app config`,
    );
  }
  return c.json(
    await listWorkspaces({
      ssh: machineSshTarget(m),
      root: m.workdir,
      user: m.user,
    }),
  );
});

export default machineWorkspaces;
