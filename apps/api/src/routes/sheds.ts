import { createShedRequestSchema, type ShedWithHost } from '@shed-remote-agent/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getServerTargets } from '../lib/configStore.js';
import { AppError } from '../lib/errors.js';
import { clientFor, clientForName } from '../lib/hostClients.js';
import { RC_PREFIX } from '../lib/rc.js';
import { parseJsonBody } from '../lib/requestBody.js';

const sheds = new Hono();

sheds.get('/', async (c) => {
  const targets = await getServerTargets();
  const results = await Promise.allSettled(
    targets.map(async (t) => {
      const list = await clientFor(t).listSheds();
      return list.sheds.map<ShedWithHost>((s) => ({ ...s, host: t.name }));
    }),
  );

  const out: ShedWithHost[] = [];
  const errors: { host: string; error: { code: string; message: string } }[] = [];
  targets.forEach((t, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      out.push(...r.value);
    } else {
      const e = r.reason;
      const code = e instanceof AppError ? e.code : 'HOST_UNREACHABLE';
      // AppError messages are sanitized (no token/fingerprint); other errors
      // are network failures with no secret material.
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ host: t.name, error: { code, message } });
    }
  });

  return c.json({ sheds: out, errors: errors.length ? errors : undefined });
});

sheds.post('/:host', async (c) => {
  const { host } = c.req.param();
  const { client } = await clientForName(host);
  const body = createShedRequestSchema.parse(await parseJsonBody(c));

  return streamSSE(c, async (stream) => {
    let completed = false;
    try {
      for await (const ev of client.createShedSSE(body)) {
        if (ev.type === 'progress') {
          await stream.writeSSE({ event: 'progress', data: JSON.stringify(ev.data) });
        } else if (ev.type === 'complete') {
          completed = true;
          await stream.writeSSE({
            event: 'complete',
            data: JSON.stringify({ ...ev.data, host }),
          });
        } else {
          completed = true;
          await stream.writeSSE({ event: 'error', data: JSON.stringify(ev.data) });
        }
      }
      if (!completed) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: { code: 'STREAM_ENDED', message: 'upstream ended without a terminal event' },
          }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: { code: 'BACKEND_ERROR', message: msg } }),
      });
    }
  });
});

sheds.get('/:host/:name', async (c) => {
  const { host, name } = c.req.param();
  const { client } = await clientForName(host);
  const shed = await client.getShed(name);
  return c.json({ ...shed, host });
});

sheds.post('/:host/:name/start', async (c) => {
  const { host, name } = c.req.param();
  const { client } = await clientForName(host);
  const shed = await client.startShed(name);
  return c.json({ ...shed, host });
});

sheds.post('/:host/:name/stop', async (c) => {
  const { host, name } = c.req.param();
  const { client } = await clientForName(host);
  const shed = await client.stopShed(name);
  return c.json({ ...shed, host });
});

sheds.delete('/:host/:name', async (c) => {
  const { host, name } = c.req.param();
  const { client } = await clientForName(host);
  await client.deleteShed(name);
  return c.body(null, 204);
});

sheds.get('/:host/:name/sessions', async (c) => {
  const { host, name } = c.req.param();
  const { client } = await clientForName(host);
  const resp = await client.listSessions(name);
  return c.json({
    ...resp,
    sessions: resp.sessions.map((s) => ({
      ...s,
      is_remote_control: s.name.startsWith(RC_PREFIX),
    })),
  });
});

sheds.delete('/:host/:name/sessions/:session', async (c) => {
  const { host, name, session } = c.req.param();
  const { client } = await clientForName(host);
  await client.killSession(name, session);
  return c.body(null, 204);
});

export default sheds;
