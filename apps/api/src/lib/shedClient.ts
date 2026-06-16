import {
  type APIError,
  type CreateShedRequest,
  type ImagesResponse,
  type ProgressEvent,
  parseSSEStream,
  type SessionsResponse,
  type Shed,
} from '@shed-remote-agent/shared';
import { AppError } from './errors.js';
import { readBodyText, type SecureResponse, secureRequest } from './secureTransport.js';
import type { ServerTarget } from './shedConfig.js';

const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Streaming create can run for minutes (image pulls), so it gets a generous
 * idle timeout instead of the overall request deadline — the legacy fetch path
 * has no create-stream timeout at all, this just reaps a silently dead socket.
 */
const SSE_IDLE_TIMEOUT_MS = 120_000;

export type ShedCreateEvent =
  | { type: 'progress'; data: ProgressEvent }
  | { type: 'complete'; data: Shed }
  | { type: 'error'; data: APIError };

/**
 * Supplies (and on a 401 can refresh) the bearer control token for a secure
 * host. Kept behind an interface so the client never captures a token at
 * construction: in this commit it just re-reads the config seed, and the
 * minting provider drops in later without touching the client.
 */
export interface TokenSource {
  get(): Promise<string | undefined>;
  /** Invalidate `token` if it is still the cached one (CAS); no-op without a provider. */
  invalidate(token: string): void;
}

function upstreamTransportError(err: unknown, method: string, path: string): AppError {
  if (err instanceof AppError) return err;
  const aborted =
    err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
  const code = aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_TRANSPORT_ERROR';
  const message = aborted
    ? `Upstream request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`
    : `Upstream request failed: ${method} ${path} — ${err instanceof Error ? err.message : String(err)}`;
  return new AppError(code, message, 502);
}

function parseJsonText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Throw an AppError from a shed error-body (`{error:{code,message,details}}`). */
function throwApiError(data: unknown, status: number): never {
  const err = (data as APIError | null)?.error;
  throw new AppError(
    err?.code ?? 'SHED_SERVER_ERROR',
    err?.message ?? `HTTP ${status}`,
    status,
    err?.details as Record<string, unknown> | undefined,
  );
}

export class ShedClient {
  private readonly secureHost: string;
  private readonly securePort: number;

  constructor(
    private readonly target: ServerTarget,
    private readonly tokens: TokenSource,
  ) {
    // Parse the https host/port once for the pinned transport; legacy hosts
    // keep using the plain `baseUrl` over fetch.
    if (target.secure) {
      const u = new URL(target.baseUrl);
      this.secureHost = u.hostname;
      this.securePort = Number(u.port) || 443;
    } else {
      this.secureHost = target.host;
      this.securePort = 0;
    }
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.target.secure
      ? this.secureRequest<T>(method, path, body)
      : this.fetchRequest<T>(method, path, body);
  }

  // ---- secure (pinned TLS + bearer) ----------------------------------------

  private doSecure(
    method: string,
    path: string,
    body: unknown,
    token: string | undefined,
    accept?: string,
  ): Promise<SecureResponse> {
    return secureRequest({
      host: this.secureHost,
      port: this.securePort,
      fingerprint: this.target.tlsCertFingerprint ?? '',
      method,
      path,
      token,
      accept,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async secureRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: SecureResponse;
    try {
      const token = await this.tokens.get();
      res = await this.doSecure(method, path, body, token);
      if (res.status === 401) {
        await res.body.cancel();
        // Stale token: invalidate + retry once with a freshly resolved token.
        if (token) {
          this.tokens.invalidate(token);
          const next = await this.tokens.get();
          if (next && next !== token) {
            res = await this.doSecure(method, path, body, next);
            // A second 401's body is never read below — drain it so the socket
            // is released rather than left dangling.
            if (res.status === 401) await res.body.cancel().catch(() => {});
          }
        }
        if (res.status === 401) throw AppError.authExpired();
      }
    } catch (err) {
      throw upstreamTransportError(err, method, path);
    }

    if (res.status === 204) {
      await res.body.cancel();
      return undefined as T;
    }
    const data = parseJsonText(await readBodyText(res.body));
    if (res.status < 200 || res.status >= 300) throwApiError(data, res.status);
    return data as T;
  }

  // ---- legacy (plain HTTP over fetch) --------------------------------------

  private async fetchRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.target.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw upstreamTransportError(err, method, path);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return undefined as T;

    const data = parseJsonText(await res.text());
    if (!res.ok) throwApiError(data, res.status);
    return data as T;
  }

  // ---- API surface (transport-agnostic) ------------------------------------

  async listSheds(): Promise<{ sheds: Shed[] }> {
    const resp = await this.request<{ sheds: Shed[] | null } | null>('GET', '/api/sheds');
    return { sheds: resp?.sheds ?? [] };
  }

  getShed(name: string): Promise<Shed> {
    return this.request<Shed>('GET', `/api/sheds/${encodeURIComponent(name)}`);
  }

  startShed(name: string): Promise<Shed> {
    return this.request<Shed>('POST', `/api/sheds/${encodeURIComponent(name)}/start`);
  }

  stopShed(name: string): Promise<Shed> {
    return this.request<Shed>('POST', `/api/sheds/${encodeURIComponent(name)}/stop`);
  }

  deleteShed(name: string): Promise<void> {
    return this.request<void>('DELETE', `/api/sheds/${encodeURIComponent(name)}`);
  }

  async listSessions(name: string): Promise<SessionsResponse> {
    const resp = await this.request<Partial<SessionsResponse> | null>(
      'GET',
      `/api/sheds/${encodeURIComponent(name)}/sessions`,
    );
    return { sessions: resp?.sessions ?? [], warnings: resp?.warnings };
  }

  killSession(shed: string, session: string): Promise<void> {
    return this.request<void>(
      'DELETE',
      `/api/sheds/${encodeURIComponent(shed)}/sessions/${encodeURIComponent(session)}`,
    );
  }

  async listImages(): Promise<ImagesResponse> {
    const resp = await this.request<Partial<ImagesResponse> | null>('GET', '/api/images');
    return { images: resp?.images ?? [] };
  }

  async *createShedSSE(req: CreateShedRequest): AsyncGenerator<ShedCreateEvent> {
    const stream = this.target.secure ? this.secureCreateStream(req) : this.fetchCreateStream(req);
    yield* stream;
  }

  private async *secureCreateStream(req: CreateShedRequest): AsyncGenerator<ShedCreateEvent> {
    let res: SecureResponse;
    try {
      const token = await this.tokens.get();
      res = await secureRequest({
        host: this.secureHost,
        port: this.securePort,
        fingerprint: this.target.tlsCertFingerprint ?? '',
        method: 'POST',
        path: '/api/sheds',
        token,
        accept: 'text/event-stream',
        body: JSON.stringify(req),
        idleTimeoutMs: SSE_IDLE_TIMEOUT_MS,
      });
    } catch (err) {
      const e = upstreamTransportError(err, 'POST', '/api/sheds');
      yield { type: 'error', data: { error: { code: e.code, message: e.message } } };
      return;
    }

    if (res.status < 200 || res.status >= 300) {
      let error: APIError['error'];
      if (res.status === 401) {
        // The 401 body isn't streamed — drain it so the socket is released.
        await res.body.cancel().catch(() => {});
        const e = AppError.authExpired();
        error = { code: e.code, message: e.message };
      } else {
        error = errorFromBody(parseJsonText(await readBodyText(res.body)), res.status);
      }
      yield { type: 'error', data: { error } };
      return;
    }

    for await (const raw of parseSSEStream(res.body)) {
      const dispatched = dispatch(raw.event, raw.data);
      if (dispatched) yield dispatched;
    }
  }

  private async *fetchCreateStream(req: CreateShedRequest): AsyncGenerator<ShedCreateEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.target.baseUrl}/api/sheds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(req),
      });
    } catch (err) {
      const e = upstreamTransportError(err, 'POST', '/api/sheds');
      yield { type: 'error', data: { error: { code: e.code, message: e.message } } };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', data: { error: errorFromBody(parseJsonText(text), res.status) } };
      return;
    }

    for await (const raw of parseSSEStream(res.body)) {
      const dispatched = dispatch(raw.event, raw.data);
      if (dispatched) yield dispatched;
    }
  }
}

/** The upstream error object verbatim (preserving `details`), or a synthesized one. */
function errorFromBody(data: unknown, status: number): APIError['error'] {
  const err = (data as APIError | null)?.error;
  return err ?? { code: 'SHED_SERVER_ERROR', message: `HTTP ${status}` };
}

function dispatch(event: string, data: string): ShedCreateEvent | null {
  if (event !== 'progress' && event !== 'complete' && event !== 'error') return null;

  try {
    if (event === 'progress') return { type: 'progress', data: JSON.parse(data) as ProgressEvent };
    if (event === 'complete') return { type: 'complete', data: JSON.parse(data) as Shed };
    return { type: 'error', data: JSON.parse(data) as APIError };
  } catch {
    return {
      type: 'error',
      data: {
        error: {
          code: 'UPSTREAM_PARSE_ERROR',
          message: `malformed SSE payload for event "${event}": ${data.slice(0, 200)}`,
        },
      },
    };
  }
}
