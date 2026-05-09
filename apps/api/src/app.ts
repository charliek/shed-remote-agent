import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { errorHandler } from './middleware/error.js';
import { loggingMiddleware } from './middleware/logging.js';
import health from './routes/health.js';
import routes from './routes/index.js';
import machineRcAttach from './routes/machineRcAttach.js';
import rcAttach from './routes/rcAttach.js';

const app = new Hono();

app.onError(errorHandler);
app.use('*', loggingMiddleware);

// Mount the WS upgrade routes before the global CORS middleware. Hono's
// CORS middleware mutates response headers, but the upgrade response
// headers are immutable once the upgrade completes (honojs/hono#4090).
// Hono middleware is order-dependent: registering these routes ahead of
// `app.use('*', cors(...))` keeps CORS out of the upgrade chain.
app.route('/api/sheds', rcAttach);
app.route('/api/machines', machineRcAttach);

app.use(
  '*',
  cors({
    origin: config.corsOrigins,
    credentials: false,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

app.route('/health', health);
app.route('/api', routes);

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

export default app;
