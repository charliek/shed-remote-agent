import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { parseSSEStream } from '@shed-remote-agent/shared';
import {
  BodyDecoder,
  certFingerprint,
  chooseBodyMode,
  parseHead,
  readBodyText,
  secureRequest,
} from '../secureTransport.js';

// Generate a throwaway self-signed cert per run rather than committing a private
// key. No SAN: pinning is hostname-agnostic, so the cert only needs a subject.
let CERT!: Buffer;
let KEY!: Buffer;
let FINGERPRINT!: string;
let certDir!: string;

beforeAll(() => {
  certDir = mkdtempSync(join(tmpdir(), 'shed-tls-test-'));
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
  if (r.exitCode !== 0) {
    throw new Error(`openssl failed to generate a test cert: ${r.stderr.toString()}`);
  }
  CERT = readFileSync(certPath);
  KEY = readFileSync(keyPath);
  FINGERPRINT = certFingerprint(Buffer.from(new X509Certificate(CERT).raw));
});

afterAll(() => {
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

// ---- pure helpers ----------------------------------------------------------

describe('parseHead', () => {
  it('parses status line + lowercased headers', () => {
    const h = parseHead('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2');
    expect(h.status).toBe(200);
    expect(h.headers['content-type']).toBe('application/json');
    expect(h.headers['content-length']).toBe('2');
  });

  it('records duplicate header values', () => {
    const h = parseHead('HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 2');
    expect(h.multi.get('content-length')).toEqual(['1', '2']);
  });

  it('throws on a malformed status line', () => {
    expect(() => parseHead('220 ftp ready\r\n')).toThrow(/status line/);
  });

  it('throws on a malformed header line', () => {
    expect(() => parseHead('HTTP/1.1 200 OK\r\nnocolon')).toThrow(/header line/);
  });
});

describe('chooseBodyMode', () => {
  const head = (raw: string) => parseHead(raw);

  it('length mode from Content-Length', () => {
    expect(chooseBodyMode('GET', head('HTTP/1.1 200 OK\r\nContent-Length: 5'))).toEqual({
      kind: 'length',
      length: 5,
    });
  });

  it('chunked mode from Transfer-Encoding', () => {
    expect(chooseBodyMode('GET', head('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked'))).toEqual({
      kind: 'chunked',
    });
  });

  it('empty for 204 / 304 / HEAD even with Content-Length', () => {
    expect(chooseBodyMode('GET', head('HTTP/1.1 204 No Content')).kind).toBe('empty');
    expect(chooseBodyMode('GET', head('HTTP/1.1 304 Not Modified')).kind).toBe('empty');
    expect(chooseBodyMode('HEAD', head('HTTP/1.1 200 OK\r\nContent-Length: 9')).kind).toBe('empty');
  });

  it('close-delimited when no framing headers', () => {
    expect(chooseBodyMode('GET', head('HTTP/1.1 200 OK')).kind).toBe('close');
  });

  it('rejects Transfer-Encoding + Content-Length', () => {
    expect(() =>
      chooseBodyMode(
        'GET',
        head('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 5'),
      ),
    ).toThrow(/both Transfer-Encoding and Content-Length/);
  });

  it('rejects conflicting duplicate Content-Length', () => {
    expect(() =>
      chooseBodyMode('GET', head('HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 2')),
    ).toThrow(/duplicate Content-Length/);
  });

  it('rejects a compressed (non-identity) body', () => {
    expect(() =>
      chooseBodyMode('GET', head('HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 5')),
    ).toThrow(/content-encoding/);
  });

  it('rejects an unsupported transfer-encoding', () => {
    expect(() => chooseBodyMode('GET', head('HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip'))).toThrow(
      /unsupported transfer-encoding/,
    );
  });

  it('rejects gzip+chunked split across duplicate Transfer-Encoding lines', () => {
    expect(() =>
      chooseBodyMode(
        'GET',
        head('HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip\r\nTransfer-Encoding: chunked'),
      ),
    ).toThrow(/unsupported transfer-encoding/);
  });

  it('rejects non-numeric Content-Length values (0x10, 1e3, 5.0, empty)', () => {
    for (const cl of ['0x10', '1e3', '5.0', '', ' -1', '+5']) {
      expect(() => chooseBodyMode('GET', head(`HTTP/1.1 200 OK\r\nContent-Length: ${cl}`))).toThrow(
        /Content-Length/,
      );
    }
  });

  it('rejects duplicate Content-Length headers even when identical', () => {
    expect(() =>
      chooseBodyMode('GET', head('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 5')),
    ).toThrow(/duplicate Content-Length/);
  });
});

function collect(d: BodyDecoder, chunks: Buffer[]): { body: string; done: boolean } {
  const out: Buffer[] = [];
  for (const c of chunks) for (const b of d.push(c)) out.push(b);
  return { body: Buffer.concat(out).toString('utf8'), done: d.done };
}

describe('BodyDecoder', () => {
  it('length mode reassembles across split reads', () => {
    const d = new BodyDecoder({ kind: 'length', length: 5 });
    const r = collect(d, [Buffer.from('he'), Buffer.from('ll'), Buffer.from('o!!')]);
    expect(r.body).toBe('hello'); // only 5 bytes consumed
    expect(r.done).toBe(true);
  });

  it('length mode throws if the socket ends early', () => {
    const d = new BodyDecoder({ kind: 'length', length: 5 });
    d.push(Buffer.from('he'));
    expect(() => d.end()).toThrow(/before the response body completed/);
  });

  it('chunked mode decodes a simple body', () => {
    const d = new BodyDecoder({ kind: 'chunked' });
    const r = collect(d, [Buffer.from('5\r\nhello\r\n0\r\n\r\n')]);
    expect(r.body).toBe('hello');
    expect(r.done).toBe(true);
  });

  it('chunked mode handles size + data split across reads', () => {
    const d = new BodyDecoder({ kind: 'chunked' });
    const r = collect(d, [
      Buffer.from('3'),
      Buffer.from('\r\nfo'),
      Buffer.from('o\r\n'),
      Buffer.from('0\r\n\r\n'),
    ]);
    expect(r.body).toBe('foo');
    expect(r.done).toBe(true);
  });

  it('chunked mode ignores chunk extensions and trailers', () => {
    const d = new BodyDecoder({ kind: 'chunked' });
    const r = collect(d, [Buffer.from('5;ext=1\r\nhello\r\n0\r\nTrailer: x\r\n\r\n')]);
    expect(r.body).toBe('hello');
    expect(r.done).toBe(true);
  });

  it('chunked mode rejects a non-hex size', () => {
    const d = new BodyDecoder({ kind: 'chunked' });
    expect(() => d.push(Buffer.from('zz\r\n'))).toThrow(/invalid chunk size/);
  });

  it('chunked mode rejects a missing CRLF after a chunk', () => {
    const d = new BodyDecoder({ kind: 'chunked' });
    expect(() => d.push(Buffer.from('5\r\nhelloXX'))).toThrow(/missing CRLF/);
  });

  it('close mode emits everything and completes on end', () => {
    const d = new BodyDecoder({ kind: 'close' });
    const r = collect(d, [Buffer.from('abc'), Buffer.from('def')]);
    expect(r.body).toBe('abcdef');
    expect(r.done).toBe(false);
    d.end();
    expect(d.done).toBe(true);
  });

  it('empty mode is done immediately and ignores bytes', () => {
    const d = new BodyDecoder({ kind: 'empty' });
    expect(d.done).toBe(true);
    expect(d.push(Buffer.from('garbage'))).toEqual([]);
  });
});

// ---- pinned-TLS integration against an in-test self-signed server ----------

type Responder = (reqText: string) => string | Buffer | null;

interface TestServer {
  port: number;
  requests: string[];
  /** Total bytes the server ever received (to prove a wrong pin sends nothing). */
  stats: { bytes: number };
  close: () => Promise<void>;
}

function startServer(respond: Responder): Promise<TestServer> {
  const requests: string[] = [];
  const stats = { bytes: 0 };
  const server = tls.createServer({ cert: CERT, key: KEY }, (socket) => {
    let buf: Buffer = Buffer.alloc(0);
    socket.on('data', (d: Buffer) => {
      stats.bytes += d.length;
      buf = Buffer.concat([buf, d]);
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0 || requests.length > 0) return;
      const reqText = buf.toString('utf8');
      requests.push(reqText);
      const resp = respond(reqText);
      if (resp == null) return; // simulate a hung server (no response)
      socket.write(resp);
      socket.end();
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        requests,
        stats,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function chunk(s: string): string {
  return `${Buffer.byteLength(s).toString(16)}\r\n${s}\r\n`;
}

let active: TestServer | null = null;
afterEach(async () => {
  await active?.close();
  active = null;
});

describe('secureRequest (pinned TLS)', () => {
  it('GET with the correct pin returns status + Content-Length body', async () => {
    active = await startServer(() => 'HTTP/1.1 200 OK\r\nContent-Length: 13\r\n\r\n{"ok":"true"}');
    const res = await secureRequest({
      host: 'localhost',
      port: active.port,
      fingerprint: FINGERPRINT,
      method: 'GET',
      path: '/api/info',
    });
    expect(res.status).toBe(200);
    expect(await readBodyText(res.body)).toBe('{"ok":"true"}');
  });

  it('forwards the bearer token in the Authorization header', async () => {
    active = await startServer(() => 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}');
    await secureRequest({
      host: 'localhost',
      port: active.port,
      fingerprint: FINGERPRINT,
      method: 'GET',
      path: '/api/sheds',
      token: 'shed_control_xyz',
    }).then((r) => readBodyText(r.body));
    expect(active.requests[0]).toContain('Authorization: Bearer shed_control_xyz');
    expect(active.requests[0]).toContain('Accept-Encoding: identity');
    expect(active.requests[0]).toContain('Connection: close');
  });

  it('fails closed on a wrong pin WITHOUT sending the request (or token)', async () => {
    active = await startServer(() => 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}');
    const wrong = `sha256:${'0'.repeat(64)}`;
    await expect(
      secureRequest({
        host: 'localhost',
        port: active.port,
        fingerprint: wrong,
        method: 'GET',
        path: '/api/sheds',
        token: 'shed_control_secret',
      }),
    ).rejects.toMatchObject({ code: 'SHED_TLS_PIN_MISMATCH' });
    // The pin check happens before any byte is written: the server saw zero
    // application bytes (not just zero complete request lines).
    expect(active.requests).toHaveLength(0);
    expect(active.stats.bytes).toBe(0);
  });

  it('decodes a chunked body', async () => {
    active = await startServer(
      () =>
        `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${chunk('hello ')}${chunk('world')}0\r\n\r\n`,
    );
    const res = await secureRequest({
      host: 'localhost',
      port: active.port,
      fingerprint: FINGERPRINT,
      method: 'GET',
      path: '/api/sheds',
    });
    expect(await readBodyText(res.body)).toBe('hello world');
  });

  it('streams a chunked SSE body into parseSSEStream', async () => {
    const sse = 'event: progress\ndata: {"phase":"x"}\n\nevent: complete\ndata: {"name":"a"}\n\n';
    active = await startServer(
      () =>
        `HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n${chunk(sse)}0\r\n\r\n`,
    );
    const res = await secureRequest({
      host: 'localhost',
      port: active.port,
      fingerprint: FINGERPRINT,
      method: 'POST',
      path: '/api/sheds',
      accept: 'text/event-stream',
      body: '{"name":"a"}',
    });
    const events: Array<{ event: string; data: string }> = [];
    for await (const ev of parseSSEStream(res.body)) events.push(ev);
    expect(events.map((e) => e.event)).toEqual(['progress', 'complete']);
  });

  it('returns a 204 with an empty body', async () => {
    active = await startServer(() => 'HTTP/1.1 204 No Content\r\n\r\n');
    const res = await secureRequest({
      host: 'localhost',
      port: active.port,
      fingerprint: FINGERPRINT,
      method: 'DELETE',
      path: '/api/sheds/x',
    });
    expect(res.status).toBe(204);
    expect(await readBodyText(res.body)).toBe('');
  });

  it('rejects a CRLF-injected path before connecting', async () => {
    await expect(
      secureRequest({
        host: 'localhost',
        port: 1,
        fingerprint: FINGERPRINT,
        method: 'GET',
        path: '/api/sheds\r\nX-Evil: 1',
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_PROTOCOL_ERROR' });
  });

  it('rejects a malformed fingerprint as a missing pin', async () => {
    await expect(
      secureRequest({
        host: 'localhost',
        port: 1,
        fingerprint: 'not-a-pin',
        method: 'GET',
        path: '/api/info',
      }),
    ).rejects.toMatchObject({ code: 'SHED_TLS_PIN_MISSING' });
  });

  it('times out when the server never responds', async () => {
    active = await startServer(() => null); // accept, read, but never reply
    await expect(
      secureRequest({
        host: 'localhost',
        port: active.port,
        fingerprint: FINGERPRINT,
        method: 'GET',
        path: '/api/info',
        headerTimeoutMs: 150,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });
});
