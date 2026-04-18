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

export type ShedCreateEvent =
  | { type: 'progress'; data: ProgressEvent }
  | { type: 'complete'; data: Shed }
  | { type: 'error'; data: APIError };

export class ShedClient {
  private baseUrl: string;

  constructor(host: Host) {
    this.baseUrl = `http://${host.host}:${host.httpPort}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

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
    const res = await fetch(`${this.baseUrl}/api/sheds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(req),
    });

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
  try {
    if (event === 'progress') return { type: 'progress', data: JSON.parse(data) as ProgressEvent };
    if (event === 'complete') return { type: 'complete', data: JSON.parse(data) as Shed };
    if (event === 'error') return { type: 'error', data: JSON.parse(data) as APIError };
  } catch {
    if (event === 'error') {
      return { type: 'error', data: { error: { code: 'PARSE_ERROR', message: data } } };
    }
  }
  return null;
}
