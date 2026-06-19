import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { parseSSEStream } from '@shed-remote-agent/shared';
import { certFingerprint } from '../secureTransport.js';
import { ShedClient, type ShedCreateEvent, type TokenSource } from '../shedClient.js';
import type { ServerTarget } from '../shedConfig.js';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: Array<{ event: string; data: string }> = [];
  for await (const ev of parseSSEStream(stream)) out.push(ev);
  return out;
}

describe('parseSSEStream', () => {
  it('parses progress + complete, ignores comment keep-alives', async () => {
    const body = [
      ': keep-alive\n',
      'event: progress\n',
      'data: {"phase":"image","message":"pulling"}\n\n',
      'event: complete\n',
      'data: {"name":"a","status":"running"}\n\n',
    ];
    const events = await collect(streamFromChunks(body));
    expect(events).toEqual([
      { event: 'progress', data: '{"phase":"image","message":"pulling"}' },
      { event: 'complete', data: '{"name":"a","status":"running"}' },
    ]);
  });

  it('reassembles events split across chunks', async () => {
    const chunks = [
      'event: prog',
      'ress\ndata: {"phase":"x","message":"y"}',
      '\n\n',
      'event: complete\ndata: {"name":"a"}\n\n',
    ];
    const events = await collect(streamFromChunks(chunks));
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('progress');
    expect(events[1].event).toBe('complete');
  });
});

// ---- ShedClient transport routing ------------------------------------------

const noToken: TokenSource = { get: async () => undefined, invalidate() {} };

const legacyTarget: ServerTarget = {
  name: 'legacy',
  host: 'shed.host',
  sshPort: 2222,
  httpPort: 8080,
  secure: false,
  baseUrl: 'http://shed.host:8080',
};

describe('ShedClient legacy (plain HTTP)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('GETs over http with no Authorization header', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ sheds: [{ name: 'a', status: 'running' }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const client = new ShedClient(legacyTarget, noToken);
    const res = await client.listSheds();

    expect(res.sheds).toHaveLength(1);
    expect(seen?.url).toBe('http://shed.host:8080/api/sheds');
    const headers = new Headers(seen?.init?.headers);
    expect(headers.has('authorization')).toBe(false);
  });

  it('maps an upstream error body to an AppError', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 'NOPE', message: 'no shed' } }), {
        status: 404,
      })) as unknown as typeof fetch;
    const client = new ShedClient(legacyTarget, noToken);
    await expect(client.getShed('x')).rejects.toMatchObject({ code: 'NOPE', statusCode: 404 });
  });
});

// ---- ShedClient secure (pinned TLS + bearer) -------------------------------

let CERT!: Buffer;
let KEY!: Buffer;
let FINGERPRINT!: string;
let certDir!: string;

beforeAll(() => {
  certDir = mkdtempSync(join(tmpdir(), 'shed-client-tls-'));
  const certPath = join(certDir, 'cert.pem');
  const keyPath = join(certDir, 'key.pem');
  const r = Bun.spawnSync([
    'openssl',
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '3650',
    '-nodes',
    '-subj',
    '/CN=shed-server-test',
  ]);
  if (r.exitCode !== 0) throw new Error(`openssl failed: ${r.stderr.toString()}`);
  CERT = readFileSync(certPath);
  KEY = readFileSync(keyPath);
  FINGERPRINT = certFingerprint(Buffer.from(new X509Certificate(CERT).raw));
});

afterAll(() => {
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

interface TestServer {
  port: number;
  auths: string[];
  close: () => Promise<void>;
}

function startServer(respond: (req: string) => string): Promise<TestServer> {
  const auths: string[] = [];
  const server = tls.createServer({ cert: CERT, key: KEY }, (socket) => {
    let buf: Buffer = Buffer.alloc(0);
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.indexOf('\r\n\r\n') < 0) return;
      const req = buf.toString('utf8');
      const m = /Authorization: (.+)\r\n/.exec(req);
      auths.push(m?.[1] ?? '');
      socket.write(respond(req));
      socket.end();
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, auths, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function jsonResponse(status: number, statusText: string, obj: unknown): string {
  const body = JSON.stringify(obj);
  return `HTTP/1.1 ${status} ${statusText}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

let active: TestServer | null = null;
afterEach(async () => {
  await active?.close();
  active = null;
});

function secureTarget(port: number): ServerTarget {
  return {
    name: 'sec',
    host: 'localhost',
    sshPort: 2222,
    httpPort: 8080,
    secure: true,
    baseUrl: `https://localhost:${port}`,
    apiUrl: `https://localhost:${port}`,
    tlsCertFingerprint: FINGERPRINT,
    controlToken: 'shed_control_seed',
  };
}

describe('ShedClient secure (pinned TLS + bearer)', () => {
  it('forwards the bearer token and parses the body', async () => {
    active = await startServer(() => jsonResponse(200, 'OK', { sheds: [{ name: 't1' }] }));
    const client = new ShedClient(secureTarget(active.port), {
      get: async () => 'shed_control_live',
      invalidate() {},
    });
    const res = await client.listSheds();
    expect(res.sheds[0]?.name).toBe('t1');
    expect(active.auths[0]).toBe('Bearer shed_control_live');
  });

  it('maps a 401 to SHED_AUTH_EXPIRED', async () => {
    active = await startServer(() =>
      jsonResponse(401, 'Unauthorized', { error: { code: 'UNAUTHORIZED', message: 'no token' } }),
    );
    const client = new ShedClient(secureTarget(active.port), {
      get: async () => 'shed_control_live',
      invalidate() {},
    });
    await expect(client.listSheds()).rejects.toMatchObject({ code: 'SHED_AUTH_EXPIRED' });
  });

  it('create-SSE on a 401 yields a single authExpired error event', async () => {
    active = await startServer(() =>
      jsonResponse(401, 'Unauthorized', { error: { code: 'UNAUTHORIZED', message: 'x' } }),
    );
    const client = new ShedClient(secureTarget(active.port), {
      get: async () => 'shed_control_live',
      invalidate() {},
    });
    const events: ShedCreateEvent[] = [];
    for await (const ev of client.createShedSSE({} as Parameters<ShedClient['createShedSSE']>[0])) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      data: { error: { code: 'SHED_AUTH_EXPIRED' } },
    });
  });
});
