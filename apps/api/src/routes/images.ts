import { Hono } from 'hono';
import { clientForName } from '../lib/hostClients.js';

const images = new Hono();

images.get('/:host/images', async (c) => {
  const { host } = c.req.param();
  const { client } = await clientForName(host);
  return c.json(await client.listImages());
});

export default images;
