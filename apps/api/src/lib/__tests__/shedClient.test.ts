import { describe, expect, it } from 'bun:test';
import { parseSSEStream } from '@shed-remote-agent/shared';

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

  it('flushes a trailing event without a closing blank line', async () => {
    const body = ['event: progress\ndata: {"phase":"end","message":"done"}'];
    const events = await collect(streamFromChunks(body));
    expect(events).toEqual([{ event: 'progress', data: '{"phase":"end","message":"done"}' }]);
  });

  it('concatenates multi-line data with newlines', async () => {
    const body = ['event: x\ndata: line1\ndata: line2\n\n'];
    const events = await collect(streamFromChunks(body));
    expect(events).toEqual([{ event: 'x', data: 'line1\nline2' }]);
  });
});
