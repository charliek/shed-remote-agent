import type { ServerWebSocket } from 'bun';
import { createBunWebSocket } from 'hono/bun';

// Shared between every WebSocket route. `Bun.serve()` accepts a single
// `websocket` handler, so multiple route modules (shed RC attach, machine
// RC attach, ...) must use the same upgrade primitive — otherwise messages
// for one tree silently go nowhere.
export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();
