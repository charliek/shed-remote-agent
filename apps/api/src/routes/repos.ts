import { Hono } from 'hono';
import { getAppConfig } from '../lib/configStore.js';
import { listReposForOwners } from '../lib/gh.js';

const repos = new Hono();

repos.get('/', async (c) => {
  const cfg = await getAppConfig();
  const owners = cfg.github?.owners ?? [];
  if (owners.length === 0) return c.json({ repos: [], owners: [] });
  const list = await listReposForOwners(owners);
  return c.json({ repos: list, owners });
});

export default repos;
