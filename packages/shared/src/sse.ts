export interface SSERawEvent {
  event: string;
  data: string;
}

/**
 * Parse a standards-ish SSE byte stream into `{event, data}` records.
 *
 * Matches the shed-server dialect (see shed/cmd/shed/client.go:249-338):
 *   - `event:` sets the event type for the next dispatch
 *   - `data:` lines concat with newlines
 *   - blank line dispatches the accumulated event
 *   - `:` lines are comments / keep-alive pings
 *   - a final record with no trailing blank line is still flushed
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSERawEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data = '';

  const apply = (line: string) => {
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) {
      const v = line.slice(5).trim();
      data = data ? `${data}\n${v}` : v;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: rotating newline index
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);

        if (line === '') {
          if (data) yield { event, data };
          event = '';
          data = '';
          continue;
        }
        apply(line);
      }
    }
    // Flush any pending incomplete UTF-8 bytes held by the streaming decoder.
    buffer += decoder.decode();
    // EOF flush: buffer may still hold a final line without a newline
    if (buffer) {
      apply(buffer.replace(/\r$/, ''));
      buffer = '';
    }
    if (data) yield { event, data };
  } finally {
    reader.releaseLock();
  }
}
