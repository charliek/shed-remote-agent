import { Hono } from 'hono';
import { AppError } from '../lib/errors.js';
import { requireMachine } from '../lib/machineClients.js';
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
  // Local machines run the listing in-process against the host filesystem;
  // ssh machines do it over the wire via the existing SSH path.
  const ssh = m.type === 'local' ? null : { host: m.host, user: m.user, port: m.sshPort };
  const displayUser = m.type === 'local' ? (m.user ?? '') : m.user;
  return c.json(
    await listWorkspaces({
      ssh,
      root: m.workdir,
      user: displayUser,
    }),
  );
});

export default machineWorkspaces;
