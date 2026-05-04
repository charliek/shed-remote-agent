import type { Host } from '@shed-remote-agent/shared';
import { RC_PREFIX } from './rc.js';
import { shellQuote } from './shell.js';

export interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

const MAX_TERM_DIM = 1000;

export function parseControlMessage(text: string): ResizeMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== 'resize') return null;
  const { cols, rows } = obj;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  const c = cols as number;
  const r = rows as number;
  if (c < 1 || c > MAX_TERM_DIM) return null;
  if (r < 1 || r > MAX_TERM_DIM) return null;
  return { type: 'resize', cols: c, rows: r };
}

export interface OpenAttachOptions {
  host: Host;
  shed: string;
  slug: string;
  cols: number;
  rows: number;
  onData: (bytes: Uint8Array<ArrayBuffer>) => void;
  onExit: (code: number | null) => void;
}

export interface AttachHandle {
  write(data: Uint8Array | string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

const SSH_BASE_FLAGS = [
  '-tt',
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=accept-new',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
];

export function openAttach(opts: OpenAttachOptions): AttachHandle {
  const tmuxName = `${RC_PREFIX}${opts.slug}`;
  const remoteCmd = ['tmux', 'attach', '-t', tmuxName].map(shellQuote).join(' ');
  const args = [
    ...SSH_BASE_FLAGS,
    '-p',
    String(opts.host.sshPort),
    `${opts.shed}@${opts.host.host}`,
    '--',
    remoteCmd,
  ];

  let exited = false;

  const proc = Bun.spawn(['ssh', ...args], {
    terminal: {
      cols: opts.cols,
      rows: opts.rows,
      data(_term, data) {
        opts.onData(data);
      },
    },
  });

  proc.exited
    .then((code) => {
      if (exited) return;
      exited = true;
      opts.onExit(code ?? null);
    })
    .catch(() => {
      if (exited) return;
      exited = true;
      opts.onExit(null);
    });

  return {
    write(data) {
      try {
        proc.terminal?.write(data);
      } catch {
        // PTY may already be closed; safe to swallow.
      }
    },
    resize(cols, rows) {
      try {
        proc.terminal?.resize(cols, rows);
      } catch {
        // ditto
      }
    },
    close() {
      try {
        proc.terminal?.close();
      } catch {
        // ditto
      }
      try {
        proc.kill();
      } catch {
        // ditto
      }
    },
  };
}
