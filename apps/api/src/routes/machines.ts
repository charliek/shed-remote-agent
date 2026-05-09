import { Hono } from 'hono';
import { getMachines } from '../lib/configStore.js';

const machines = new Hono();

machines.get('/', async (c) => {
  const list = await getMachines();
  return c.json({ machines: list });
});

export default machines;
