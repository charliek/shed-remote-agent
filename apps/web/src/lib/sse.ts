import {
  type APIError,
  type ProgressEvent,
  parseSSEStream,
  type Shed,
} from '@shed-remote-agent/shared';

export type ShedCreateEvent =
  | { type: 'progress'; data: ProgressEvent }
  | { type: 'complete'; data: Shed & { host: string } }
  | { type: 'error'; data: APIError };

export async function* streamCreateShed(
  url: string,
  body: unknown,
): AsyncGenerator<ShedCreateEvent> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
  } catch (fetchErr) {
    yield {
      type: 'error',
      data: {
        error: {
          code: 'NETWORK_ERROR',
          message: fetchErr instanceof Error ? fetchErr.message : 'network request failed',
        },
      },
    };
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let err: APIError['error'] = { code: 'HTTP_ERROR', message: `HTTP ${res.status}` };
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

function dispatch(event: string, data: string): ShedCreateEvent | null {
  if (event !== 'progress' && event !== 'complete' && event !== 'error') return null;

  try {
    if (event === 'progress') return { type: 'progress', data: JSON.parse(data) };
    if (event === 'complete') return { type: 'complete', data: JSON.parse(data) };
    return { type: 'error', data: JSON.parse(data) };
  } catch {
    return {
      type: 'error',
      data: {
        error: {
          code: 'UPSTREAM_PARSE_ERROR',
          message: `malformed SSE payload for event "${event}"`,
        },
      },
    };
  }
}
