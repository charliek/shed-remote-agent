import { createHash } from 'node:crypto';
import tls from 'node:tls';
import { AppError } from './errors.js';
import { TLS_FINGERPRINT_RE } from './shedConfig.js';

/**
 * Minimal HTTP/1.1 client over a TLS socket pinned to a self-signed cert by its
 * SHA-256(DER-of-leaf) fingerprint.
 *
 * Why hand-rolled: Bun's `fetch`/`https`/`http` cannot pin a self-signed cert —
 * `checkServerIdentity` never fires, a leaf passed as `ca` fails chain
 * validation, and `rejectUnauthorized:false` fails OPEN (silently trusts any
 * cert). The only primitive that exposes the peer cert is raw `tls.connect` +
 * `getPeerCertificate(true).raw`, so we pin there and speak HTTP/1.1 ourselves.
 *
 * The transport is intentionally strict and fail-closed: one request per socket
 * (`Connection: close`), HTTP/1.1 only (ALPN), no compression (we don't decode
 * it), the pin is verified BEFORE any request byte (incl. the bearer token) is
 * written, and every framing ambiguity is rejected rather than guessed.
 */

/** ms to complete TCP+TLS handshake (and pin check) before giving up. */
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
/** ms to receive the full status line + headers after the request is sent. */
const DEFAULT_HEADER_TIMEOUT_MS = 30_000;
/** ms of silence on the socket while a body is streaming before giving up. */
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

const MAX_HEAD_BYTES = 64 * 1024; // status line + all headers
const MAX_LINE_BYTES = 16 * 1024; // a single chunk-size / trailer line
const MAX_CHUNK_BYTES = 64 * 1024 * 1024; // a single chunk's declared size

export interface SecureRequestOptions {
  /** Host to dial + the pinned fingerprint. */
  host: string;
  port: number;
  /** `sha256:<64 hex>` pin for the leaf cert; required (this is the whole point). */
  fingerprint: string;
  method: string;
  /** Request path; must start with `/` and contain no CR/LF. */
  path: string;
  /** Bearer control token (omitted for unauthenticated probes like /api/info). */
  token?: string;
  /** Request body (JSON); sets Content-Type + Content-Length. */
  body?: string;
  /** Accept header (defaults to application/json). */
  accept?: string;
  connectTimeoutMs?: number;
  headerTimeoutMs?: number;
  /** Idle timeout while streaming the body; reset on each chunk. */
  idleTimeoutMs?: number;
  /** Abort the whole exchange (caller's overall deadline). */
  signal?: AbortSignal;
}

export interface SecureResponse {
  status: number;
  /** Lowercased single-valued headers. */
  headers: Record<string, string>;
  /** Decoded (de-chunked) body bytes; `cancel()` destroys the socket. */
  body: ReadableStream<Uint8Array>;
}

/** `sha256:` + lowercase hex of the DER bytes of a leaf certificate. */
export function certFingerprint(der: Buffer): string {
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

interface ParsedHead {
  status: number;
  headers: Record<string, string>;
  /** All values seen for each header name (to detect conflicting Content-Length). */
  multi: Map<string, string[]>;
}

/** Parse the raw status line + header block (everything before the blank line). */
export function parseHead(headText: string): ParsedHead {
  const lines = headText.split('\r\n');
  const statusLine = lines.shift() ?? '';
  const m = /^HTTP\/1\.[01] (\d{3})\b/.exec(statusLine);
  if (!m) throw protocolError(`malformed status line: ${truncate(statusLine)}`);
  const status = Number(m[1]);

  const headers: Record<string, string> = {};
  const multi = new Map<string, string[]>();
  for (const line of lines) {
    if (line === '') continue;
    const idx = line.indexOf(':');
    if (idx <= 0) throw protocolError(`malformed header line: ${truncate(line)}`);
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[name] = value;
    const seen = multi.get(name);
    if (seen) seen.push(value);
    else multi.set(name, [value]);
  }
  return { status, headers, multi };
}

type BodyMode =
  | { kind: 'empty' }
  | { kind: 'length'; length: number }
  | { kind: 'chunked' }
  | { kind: 'close' };

/**
 * Decide how the response body is framed, rejecting every RFC-7230 ambiguity:
 * a body-less status, Transfer-Encoding + Content-Length together, conflicting
 * duplicate Content-Lengths, a non-`identity` content encoding we can't decode,
 * or an unsupported transfer coding.
 */
export function chooseBodyMode(method: string, head: ParsedHead): BodyMode {
  const { status, headers, multi } = head;
  // Combine repeated Transfer-Encoding lines so `gzip\r\n...chunked` can't slip
  // through as a bare `chunked` (the single-valued `headers` map keeps only the
  // last line).
  const teValues = multi.get('transfer-encoding');
  const te = teValues?.join(',');
  const clValues = multi.get('content-length');

  if (te && clValues) {
    throw protocolError('response has both Transfer-Encoding and Content-Length');
  }

  // A non-identity content-encoding would mean the body is compressed; we send
  // `Accept-Encoding: identity` and refuse to decode anything else.
  const ce = headers['content-encoding'];
  if (ce && ce.toLowerCase() !== 'identity') {
    throw protocolError(`unexpected content-encoding: ${truncate(ce)}`);
  }

  const bodyless =
    method.toUpperCase() === 'HEAD' ||
    status === 204 ||
    status === 304 ||
    (status >= 100 && status < 200);
  if (bodyless) return { kind: 'empty' };

  if (te) {
    // Only the final coding matters; we support `chunked` (optionally the
    // redundant `identity` before it). Anything else (gzip, etc.) is rejected.
    const codings = te
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const last = codings.at(-1);
    if (last !== 'chunked' || codings.slice(0, -1).some((c) => c !== 'identity')) {
      throw protocolError(`unsupported transfer-encoding: ${truncate(te)}`);
    }
    return { kind: 'chunked' };
  }

  if (clValues) {
    if (clValues.length > 1) throw protocolError('duplicate Content-Length headers');
    const raw = clValues[0].trim();
    // Digits only — reject `0x10`, `1e3`, `5.0`, empty, signs, whitespace gaps
    // that `Number()` would otherwise accept.
    if (!/^\d+$/.test(raw)) throw protocolError(`invalid Content-Length: ${truncate(raw)}`);
    const length = Number(raw);
    if (!Number.isSafeInteger(length)) throw protocolError('Content-Length out of range');
    return { kind: 'length', length };
  }

  // No framing headers + `Connection: close` ⇒ body runs until EOF.
  return { kind: 'close' };
}

/**
 * Incremental body decoder. `push` returns the decoded bytes to emit (and may
 * throw on a protocol violation); `end` (socket EOF) throws if the body was
 * truncated. `done` flips true once the framing says the body is complete.
 */
export class BodyDecoder {
  done = false;
  private remaining = 0; // length mode: bytes left
  // Annotated `: Buffer` (the default `ArrayBufferLike` generic) so reassigning
  // `subarray()`/`concat()` results doesn't trip the stricter `ArrayBuffer` type
  // tsc infers from the `alloc(0)` initializer.
  private buf: Buffer = Buffer.alloc(0); // chunked mode: unparsed bytes
  private state: 'size' | 'data' | 'after-data' | 'trailers' = 'size';
  private chunkRemaining = 0;

  constructor(private readonly mode: BodyMode) {
    if (mode.kind === 'empty') this.done = true;
    if (mode.kind === 'length') {
      this.remaining = mode.length;
      if (this.remaining === 0) this.done = true;
    }
  }

  push(chunk: Buffer): Buffer[] {
    if (this.done || chunk.length === 0) return [];
    switch (this.mode.kind) {
      case 'empty':
        return [];
      case 'close':
        return [chunk];
      case 'length': {
        const take = Math.min(this.remaining, chunk.length);
        const out = chunk.subarray(0, take);
        this.remaining -= take;
        if (this.remaining === 0) this.done = true;
        return out.length ? [out] : [];
      }
      case 'chunked':
        return this.pushChunked(chunk);
    }
  }

  end(): void {
    if (this.done) return;
    if (this.mode.kind === 'close') {
      this.done = true;
      return;
    }
    throw protocolError('connection closed before the response body completed');
  }

  private pushChunked(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Buffer[] = [];

    for (;;) {
      if (this.state === 'size') {
        const nl = this.buf.indexOf('\r\n');
        if (nl < 0) {
          if (this.buf.length > MAX_LINE_BYTES) throw protocolError('chunk size line too long');
          break;
        }
        // Bound the line even once its CRLF has arrived (a single read can carry
        // a complete, oversized extension list).
        if (nl > MAX_LINE_BYTES) throw protocolError('chunk size line too long');
        // Strip any chunk extensions after `;`, parse the hex size.
        const sizeField = this.buf.subarray(0, nl).toString('latin1').split(';', 1)[0].trim();
        if (!/^[0-9a-fA-F]+$/.test(sizeField))
          throw protocolError(`invalid chunk size: ${truncate(sizeField)}`);
        const size = Number.parseInt(sizeField, 16);
        if (!Number.isFinite(size) || size > MAX_CHUNK_BYTES)
          throw protocolError('chunk size out of range');
        this.buf = this.buf.subarray(nl + 2);
        if (size === 0) {
          this.state = 'trailers';
        } else {
          this.chunkRemaining = size;
          this.state = 'data';
        }
      } else if (this.state === 'data') {
        if (this.buf.length === 0) break;
        const take = Math.min(this.chunkRemaining, this.buf.length);
        out.push(this.buf.subarray(0, take));
        this.buf = this.buf.subarray(take);
        this.chunkRemaining -= take;
        if (this.chunkRemaining === 0) this.state = 'after-data';
      } else if (this.state === 'after-data') {
        if (this.buf.length < 2) break;
        if (this.buf[0] !== 0x0d || this.buf[1] !== 0x0a)
          throw protocolError('missing CRLF after chunk');
        this.buf = this.buf.subarray(2);
        this.state = 'size';
      } else {
        // trailers: consume header-ish lines until a blank line ends the body.
        const nl = this.buf.indexOf('\r\n');
        if (nl < 0) {
          if (this.buf.length > MAX_LINE_BYTES) throw protocolError('chunk trailer too long');
          break;
        }
        if (nl > MAX_LINE_BYTES) throw protocolError('chunk trailer too long');
        const line = this.buf.subarray(0, nl);
        this.buf = this.buf.subarray(nl + 2);
        if (line.length === 0) {
          this.done = true;
          break;
        }
      }
    }
    return out;
  }
}

/**
 * Perform one pinned HTTPS request. Resolves once the status + headers are read,
 * with the body exposed as a decoded stream. Fails closed: a cert that doesn't
 * match `fingerprint` is rejected before the request (and token) is ever sent.
 */
export function secureRequest(opts: SecureRequestOptions): Promise<SecureResponse> {
  const {
    host,
    port,
    fingerprint,
    method,
    path,
    token,
    body,
    accept = 'application/json',
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    headerTimeoutMs = DEFAULT_HEADER_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    signal,
  } = opts;

  // Validate every value interpolated into the request line/headers so none can
  // smuggle a second request line or split headers (defense-in-depth: these come
  // from our own config/code, not the browser).
  if (!TLS_FINGERPRINT_RE.test(fingerprint)) {
    return Promise.reject(AppError.tlsPinMissing());
  }
  if (!/^[A-Za-z]+$/.test(method)) {
    return Promise.reject(protocolError('invalid request method'));
  }
  if (!path.startsWith('/') || /[\r\n]/.test(path)) {
    return Promise.reject(protocolError('invalid request path'));
  }
  if (/[\r\n]/.test(host) || /[\r\n]/.test(accept) || (token && /[\r\n]/.test(token))) {
    return Promise.reject(protocolError('invalid request header value'));
  }
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise<SecureResponse>((resolve, reject) => {
    let resolved = false;
    let phase: 'head' | 'body' | 'done' = 'head';
    let headBuf: Buffer = Buffer.alloc(0);
    let decoder: BodyDecoder | null = null;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTimers = () => {
      for (const t of [connectTimer, headerTimer, idleTimer]) if (t) clearTimeout(t);
    };

    const socket = tls.connect({
      host,
      port,
      servername: host,
      // We pin the exact leaf below; the default CA chain check is irrelevant
      // for a self-signed cert (and would reject it before we can pin).
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      ALPNProtocols: ['http/1.1'],
    });

    /** Fatal error: before resolve → reject the promise; after → error the stream. */
    const fatal = (err: unknown) => {
      clearTimers();
      if (!resolved) {
        resolved = true;
        reject(err);
      } else {
        controller?.error(err);
      }
      socket.destroy();
    };

    const onAbort = () => fatal(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });

    connectTimer = setTimeout(() => fatal(timeoutError('TLS handshake')), connectTimeoutMs);

    socket.once('secureConnect', () => {
      if (connectTimer) clearTimeout(connectTimer);
      // Pin the leaf cert by exact fingerprint BEFORE writing anything.
      const cert = socket.getPeerCertificate(true) as { raw?: Buffer };
      if (!cert || !Buffer.isBuffer(cert.raw)) {
        fatal(AppError.tlsPinMismatch());
        return;
      }
      if (certFingerprint(cert.raw) !== fingerprint) {
        fatal(AppError.tlsPinMismatch());
        return;
      }

      const lines = [
        `${method} ${path} HTTP/1.1`,
        `Host: ${host}`,
        'Connection: close',
        'Accept-Encoding: identity',
        `Accept: ${accept}`,
      ];
      if (token) lines.push(`Authorization: Bearer ${token}`);
      if (body != null) {
        lines.push('Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n${body ?? ''}`);
      headerTimer = setTimeout(() => fatal(timeoutError('response headers')), headerTimeoutMs);
    });

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fatal(timeoutError('response body')), idleTimeoutMs);
    };

    const feedBody = (chunk: Buffer) => {
      if (!decoder || !controller) return;
      let out: Buffer[];
      try {
        out = decoder.push(chunk);
      } catch (err) {
        fatal(err);
        return;
      }
      for (const b of out) controller.enqueue(new Uint8Array(b));
      if (decoder.done) {
        clearTimers();
        controller.close();
        phase = 'done';
        socket.destroy();
      } else if (controller.desiredSize != null && controller.desiredSize <= 0) {
        socket.pause(); // backpressure: resumed from the stream's pull()
      }
    };

    socket.on('data', (chunk: Buffer) => {
      if (phase === 'done') return;
      armIdle();

      while (phase === 'head') {
        headBuf = headBuf.length ? Buffer.concat([headBuf, chunk]) : chunk;
        chunk = Buffer.alloc(0);
        if (headBuf.length > MAX_HEAD_BYTES) {
          fatal(protocolError('response headers too large'));
          return;
        }
        const sep = headBuf.indexOf('\r\n\r\n');
        if (sep < 0) return; // need more bytes

        let head: ParsedHead;
        let mode: BodyMode;
        try {
          head = parseHead(headBuf.subarray(0, sep).toString('latin1'));
          // Skip 1xx informational responses (e.g. 100 Continue) and keep reading.
          if (head.status >= 100 && head.status < 200 && head.status !== 101) {
            headBuf = headBuf.subarray(sep + 4);
            continue;
          }
          mode = chooseBodyMode(method, head);
        } catch (err) {
          fatal(err);
          return;
        }

        if (headerTimer) clearTimeout(headerTimer);
        const rest = headBuf.subarray(sep + 4);
        decoder = new BodyDecoder(mode);
        phase = 'body';

        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
          pull() {
            socket.resume();
          },
          cancel() {
            // Mark done so any already-queued 'data' event short-circuits instead
            // of enqueuing into the now-cancelled controller.
            phase = 'done';
            clearTimers();
            socket.destroy();
          },
        });

        resolved = true;
        resolve({ status: head.status, headers: head.headers, body: stream });
        armIdle();
        feedBody(rest);
        return;
      }

      if (phase === 'body') feedBody(chunk);
    });

    socket.on('end', () => {
      if (phase === 'head') {
        fatal(protocolError('connection closed before response headers'));
        return;
      }
      if (phase === 'body' && decoder && controller) {
        try {
          decoder.end();
          clearTimers();
          controller.close();
          phase = 'done';
        } catch (err) {
          fatal(err);
        }
      }
    });

    socket.on('error', (err) => fatal(transportError(err)));
    socket.on('close', () => {
      clearTimers();
      signal?.removeEventListener('abort', onAbort);
      if (!resolved) reject(transportError(new Error('connection closed')));
    });
  });
}

/** Read a decoded body stream fully into a string, capped at `maxBytes`. */
export async function readBodyText(
  body: ReadableStream<Uint8Array>,
  maxBytes = 16 * 1024 * 1024,
): Promise<string> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw protocolError('response body exceeded size limit');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  // Buffer.concat accepts Uint8Array[] directly — no per-part Buffer copy needed.
  return Buffer.concat(parts).toString('utf8');
}

function truncate(s: string): string {
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function protocolError(message: string): AppError {
  return new AppError('UPSTREAM_PROTOCOL_ERROR', `malformed shed response: ${message}`, 502);
}

function timeoutError(stage: string): AppError {
  return new AppError('UPSTREAM_TIMEOUT', `shed request timed out waiting for ${stage}`, 504);
}

function transportError(err: unknown): AppError {
  const msg = err instanceof Error ? err.message : String(err);
  return new AppError('UPSTREAM_TRANSPORT_ERROR', `shed connection failed: ${msg}`, 502);
}

function abortError(): AppError {
  return new AppError('UPSTREAM_ABORTED', 'shed request aborted', 499);
}
