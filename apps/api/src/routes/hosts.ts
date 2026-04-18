import { Hono } from 'hono';
import { getHosts } from '../lib/configStore.js';

const hosts = new Hono();

hosts.get('/', async (c) => {
  const list = await getHosts();
  return c.json({ hosts: list });
});

export default hosts;
