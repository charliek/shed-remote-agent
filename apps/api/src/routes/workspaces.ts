import { Hono } from 'hono';
import { resolveLocalDir } from '../lib/appConfig.js';
import { getAppConfig } from '../lib/configStore.js';
import { AppError } from '../lib/errors.js';
import { clientForName } from '../lib/hostClients.js';
import { isLocalHost, listWorkspaces } from '../lib/workspaces.js';

const workspaces = new Hono();

workspaces.get('/:host/workspaces', async (c) => {
  const { host } = c.req.param();
  const { host: h } = await clientForName(host);

  const appCfg = await getAppConfig();
  const local = resolveLocalDir(appCfg, h.name);
  if (!local) {
    throw AppError.badRequest(
      `no local_dir configured for host '${h.name}' (set defaults.local_dir or hosts.${h.name}.local_dir)`,
    );
  }

  return c.json(
    await listWorkspaces({
      // The shed-host can be loopback in dev — keep the local-shortcut.
      ssh: isLocalHost(h.host) ? null : { host: h.host, user: local.user, port: 22 },
      root: local.path,
      user: local.user,
    }),
  );
});

export default workspaces;
