import { describe, expect, it } from 'bun:test';
import { parseControlMessage } from '../rcAttach.js';

describe('parseControlMessage', () => {
  it('parses a valid resize frame', () => {
    const msg = parseControlMessage(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    expect(msg).toEqual({ type: 'resize', cols: 120, rows: 40 });
  });

  it('rejects malformed JSON', () => {
    expect(parseControlMessage('not json')).toBeNull();
    expect(parseControlMessage('')).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(parseControlMessage('null')).toBeNull();
    expect(parseControlMessage('"resize"')).toBeNull();
    expect(parseControlMessage('42')).toBeNull();
    expect(parseControlMessage('[]')).toBeNull();
  });

  it('rejects unknown type', () => {
    expect(parseControlMessage(JSON.stringify({ type: 'kill', cols: 80, rows: 24 }))).toBeNull();
  });

  it('rejects non-integer dimensions', () => {
    expect(
      parseControlMessage(JSON.stringify({ type: 'resize', cols: 80.5, rows: 24 })),
    ).toBeNull();
    expect(
      parseControlMessage(JSON.stringify({ type: 'resize', cols: '80', rows: 24 })),
    ).toBeNull();
    expect(parseControlMessage(JSON.stringify({ type: 'resize', cols: 80 }))).toBeNull();
  });

  it('rejects out-of-range dimensions', () => {
    expect(parseControlMessage(JSON.stringify({ type: 'resize', cols: 0, rows: 24 }))).toBeNull();
    expect(parseControlMessage(JSON.stringify({ type: 'resize', cols: 80, rows: -1 }))).toBeNull();
    expect(
      parseControlMessage(JSON.stringify({ type: 'resize', cols: 5000, rows: 24 })),
    ).toBeNull();
    expect(
      parseControlMessage(JSON.stringify({ type: 'resize', cols: 80, rows: 5000 })),
    ).toBeNull();
  });
});
