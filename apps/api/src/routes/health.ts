import { Hono } from 'hono';

const health = new Hono();

health.get('/', (c) =>
  c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }),
);

export default health;
