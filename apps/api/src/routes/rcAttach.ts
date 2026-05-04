import type { ServerWebSocket } from 'bun';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { clientForName } from '../lib/hostClients.js';
import { logger } from '../lib/logger.js';
import { type AttachHandle, openAttach, parseControlMessage } from '../lib/rcAttach.js';

export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_DIM = 1000;

function parseDim(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DIM) return fallback;
  return n;
}

const rcAttach = new Hono();

rcAttach.get(
  '/:host/:name/rc/:slug/attach',
  upgradeWebSocket(async (c) => {
    const { host, name, slug } = c.req.param();
    const cols = parseDim(c.req.query('cols'), DEFAULT_COLS);
    const rows = parseDim(c.req.query('rows'), DEFAULT_ROWS);
    const traceId = crypto.randomUUID().slice(0, 8);
    const log = logger.child({ traceId, host, name, slug });

    let resolvedHost: Awaited<ReturnType<typeof clientForName>>['host'] | null = null;
    let resolveError: unknown = null;
    try {
      resolvedHost = (await clientForName(host)).host;
    } catch (err) {
      resolveError = err;
    }

    let attach: AttachHandle | null = null;
    let bytesIn = 0;
    let bytesOut = 0;
    const openedAt = Date.now();

    return {
      onOpen(_evt, ws) {
        if (!resolvedHost) {
          const message = resolveError instanceof Error ? resolveError.message : 'host not found';
          log.warn({ message }, 'rc-attach reject: host not resolved');
          try {
            ws.send(JSON.stringify({ type: 'error', message }));
          } catch {
            // ignore
          }
          ws.close(1011, 'host-not-found');
          return;
        }

        log.info({ cols, rows }, 'rc-attach opened');

        attach = openAttach({
          host: resolvedHost,
          shed: name,
          slug,
          cols,
          rows,
          onData(bytes) {
            bytesOut += bytes.byteLength;
            try {
              ws.send(bytes);
            } catch (err) {
              log.warn({ err: String(err) }, 'rc-attach ws.send failed; closing attach');
              attach?.close();
              attach = null;
            }
          },
          onExit(code) {
            log.info(
              { code, bytesIn, bytesOut, durationMs: Date.now() - openedAt },
              'rc-attach ssh exited',
            );
            try {
              ws.send(JSON.stringify({ type: 'exit', code }));
            } catch {
              // ignore
            }
            try {
              ws.close(1000, 'attach-exited');
            } catch {
              // ignore
            }
          },
        });
      },

      onMessage(evt, _ws) {
        const data = evt.data;
        if (typeof data === 'string') {
          const msg = parseControlMessage(data);
          if (msg?.type === 'resize') {
            log.debug({ cols: msg.cols, rows: msg.rows }, 'rc-attach resize');
            attach?.resize(msg.cols, msg.rows);
          }
          return;
        }
        if (data instanceof ArrayBuffer) {
          bytesIn += data.byteLength;
          attach?.write(new Uint8Array(data));
          return;
        }
        if (data instanceof Uint8Array) {
          bytesIn += data.byteLength;
          attach?.write(data);
          return;
        }
        if (data instanceof Blob) {
          data
            .arrayBuffer()
            .then((buf) => {
              bytesIn += buf.byteLength;
              attach?.write(new Uint8Array(buf));
            })
            .catch(() => {});
        }
      },

      onClose(evt) {
        log.info(
          {
            code: evt.code,
            reason: evt.reason,
            wasClean: evt.wasClean,
            bytesIn,
            bytesOut,
            durationMs: Date.now() - openedAt,
          },
          'rc-attach ws closed',
        );
        attach?.close();
        attach = null;
      },

      onError(evt) {
        log.warn({ evt: String(evt) }, 'rc-attach websocket error');
        attach?.close();
        attach = null;
      },
    };
  }),
);

export default rcAttach;
