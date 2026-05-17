import { Hono } from 'hono';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { machineCommandTarget, requireMachine } from '../lib/machineClients.js';
import { type AttachHandle, openAttach, parseControlMessage } from '../lib/rcAttach.js';
import { upgradeWebSocket } from '../lib/wsServer.js';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_DIM = 1000;

function parseDim(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DIM) return fallback;
  return n;
}

function isOriginAllowed(origin: string | undefined): boolean {
  // Mirrors the same CSWSH-defense allowlist in routes/rcAttach.ts; see the
  // comment there for the full rationale.
  if (!origin) return true;
  if (config.corsOrigins.includes('*')) return true;
  return config.corsOrigins.includes(origin);
}

const machineRcAttach = new Hono();

machineRcAttach.use('/:machine/rc/:slug/attach', async (c, next) => {
  const origin = c.req.header('origin');
  if (!isOriginAllowed(origin)) {
    logger.warn(
      { origin, allowed: config.corsOrigins },
      'machine-rc-attach rejected: origin not allowed',
    );
    return c.text('forbidden origin', 403);
  }
  await next();
});

machineRcAttach.get(
  '/:machine/rc/:slug/attach',
  upgradeWebSocket(async (c) => {
    const { machine, slug } = c.req.param();
    const cols = parseDim(c.req.query('cols'), DEFAULT_COLS);
    const rows = parseDim(c.req.query('rows'), DEFAULT_ROWS);
    const traceId = crypto.randomUUID().slice(0, 8);
    const log = logger.child({ traceId, machine, slug });

    let resolvedMachine: Awaited<ReturnType<typeof requireMachine>> | null = null;
    let resolveError: unknown = null;
    try {
      resolvedMachine = await requireMachine(machine);
    } catch (err) {
      resolveError = err;
    }

    let attach: AttachHandle | null = null;
    let bytesIn = 0;
    let bytesOut = 0;
    const openedAt = Date.now();

    return {
      onOpen(_evt, ws) {
        if (!resolvedMachine) {
          const message =
            resolveError instanceof Error ? resolveError.message : 'machine not found';
          log.warn({ message }, 'machine-rc-attach reject: machine not resolved');
          try {
            ws.send(JSON.stringify({ type: 'error', message }));
          } catch {
            // ignore
          }
          ws.close(1011, 'machine-not-found');
          return;
        }

        log.info({ cols, rows }, 'machine-rc-attach opened');

        try {
          attach = openAttach({
            target: machineCommandTarget(resolvedMachine),
            slug,
            cols,
            rows,
            onData(bytes) {
              bytesOut += bytes.byteLength;
              try {
                ws.send(bytes);
              } catch (err) {
                log.warn({ err: String(err) }, 'machine-rc-attach ws.send failed; closing attach');
                attach?.close();
                attach = null;
              }
            },
            onExit(code) {
              log.info(
                { code, bytesIn, bytesOut, durationMs: Date.now() - openedAt },
                'machine-rc-attach ssh exited',
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
        } catch (err) {
          const message = err instanceof Error ? err.message : 'failed to open terminal attach';
          log.error({ err: String(err) }, 'machine-rc-attach failed to open');
          try {
            ws.send(JSON.stringify({ type: 'error', message }));
          } catch {
            // ignore
          }
          try {
            ws.close(1011, 'attach-open-failed');
          } catch {
            // ignore
          }
        }
      },

      onMessage(evt, _ws) {
        const data = evt.data;
        if (typeof data === 'string') {
          const msg = parseControlMessage(data);
          if (msg?.type === 'resize') {
            log.debug({ cols: msg.cols, rows: msg.rows }, 'machine-rc-attach resize');
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
          'machine-rc-attach ws closed',
        );
        attach?.close();
        attach = null;
      },

      onError(evt) {
        log.warn({ evt: String(evt) }, 'machine-rc-attach websocket error');
        attach?.close();
        attach = null;
      },
    };
  }),
);

export default machineRcAttach;
