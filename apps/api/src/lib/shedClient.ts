import {
  type APIError,
  type CreateShedRequest,
  type Host,
  type ImagesResponse,
  type ProgressEvent,
  parseSSEStream,
  type SessionsResponse,
  type Shed,
} from '@shed-remote-agent/shared';
import { AppError } from './errors.js';

const REQUEST_TIMEOUT_MS = 30_000;

export type ShedCreateEvent =
  | { type: 'progress'; data: ProgressEvent }
  | { type: 'complete'; data: Shed }
  | { type: 'error'; data: APIError };

function upstreamTransportError(err: unknown, method: string, path: string): AppError {
  const aborted =
    err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
  const code = aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_TRANSPORT_ERROR';
  const message = aborted
    ? `Upstream request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`
    : `Upstream request failed: ${method} ${path} — ${err instanceof Error ? err.message : String(err)}`;
  return new AppError(code, message, 502);
}

export class ShedClient {
  private baseUrl: string;

  constructor(host: Host) {
    this.baseUrl = `http://${host.host}:${host.httpPort}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
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

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const err = (data as APIError | null)?.error;
      throw new AppError(
        err?.code ?? 'SHED_SERVER_ERROR',
        err?.message ?? `HTTP ${res.status}`,
        res.status,
        err?.details as Record<string, unknown> | undefined,
      );
    }

    return data as T;
  }

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

  createShed(req: CreateShedRequest): Promise<Shed> {
    return this.request<Shed>('POST', '/api/sheds', req);
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
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/sheds`, {
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
      let err: APIError['error'] = { code: 'SHED_SERVER_ERROR', message: `HTTP ${res.status}` };
      try {
        const parsed = JSON.parse(text) as APIError;
        if (parsed?.error) err = parsed.error;
      } catch {
        // keep default
      }
      yield { type: 'error', data: { error: err } };
      return;
    }

    for await (const raw of parseSSEStream(res.body)) {
      const dispatched = dispatch(raw.event, raw.data);
      if (dispatched) yield dispatched;
    }
  }
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
