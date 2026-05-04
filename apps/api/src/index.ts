import app from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { websocket } from './routes/rcAttach.js';

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  // Disable idle timeout so long-running SSE streams and WS attaches aren't cut off.
  idleTimeout: 0,
  fetch: app.fetch,
  websocket,
});

logger.info(
  {
    env: config.nodeEnv,
    addr: `http://${server.hostname}:${server.port}`,
    shedConfigPath: config.shedConfigPath,
    appConfigPath: config.appConfigPath,
  },
  'shed-remote-agent API listening',
);

const shutdown = () => {
  logger.info('shutting down');
  server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
