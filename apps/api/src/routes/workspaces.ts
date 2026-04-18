import { Hono } from 'hono';
import { clientForName } from '../lib/hostClients.js';
import { listWorkspaces } from '../lib/workspaces.js';

const workspaces = new Hono();

workspaces.get('/:host/workspaces', async (c) => {
  const { host } = c.req.param();
  const { host: h } = await clientForName(host);
  return c.json(await listWorkspaces(h));
});

export default workspaces;
