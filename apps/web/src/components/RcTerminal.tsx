import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const RECONNECT_KEY = 'reconnect';

type ConnState = 'connecting' | 'connected' | 'disconnected';

export interface RcTerminalProps {
  host: string;
  name: string;
  slug: string;
}

function buildAttachUrl(host: string, name: string, slug: string, cols: number, rows: number) {
  // VITE_API_URL is normally a relative '/api' path, in which case we resolve
  // against the current origin and switch http(s) → ws(s). When configured to
  // an absolute URL (e.g. for a separate domain) the same logic still holds.
  const params = new URLSearchParams({ cols: String(cols), rows: String(rows) });
  const path = `${API_BASE_URL}/sheds/${encodeURIComponent(host)}/${encodeURIComponent(
    name,
  )}/rc/${encodeURIComponent(slug)}/attach?${params.toString()}`;
  const base = path.startsWith('http') ? path : new URL(path, window.location.href).toString();
  return base.replace(/^http/, 'ws');
}

export function RcTerminal({ host, name, slug }: RcTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const [state, setState] = useState<ConnState>('connecting');
  const [reconnectKey, setReconnectKey] = useState(0);

  const sendResize = useCallback(() => {
    const term = termRef.current;
    const ws = wsRef.current;
    if (!term || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }, []);

  const fitAndMaybeResize = useCallback(() => {
    const fit = fitRef.current;
    if (!fit) return;
    try {
      fit.fit();
    } catch {
      // fit can throw if the container is hidden; ignore
      return;
    }
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
    }
    resizeTimerRef.current = window.setTimeout(() => {
      sendResize();
      resizeTimerRef.current = null;
    }, 100);
  }, [sendResize]);

  useEffect(() => {
    // Read the reconnect counter so this effect re-runs (and re-opens the
    // socket) every time the user clicks "Reconnect". The value itself
    // isn't otherwise meaningful.
    void reconnectKey;

    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      // 256-color theme that reads well in light & dark
      theme: {
        background: '#0b0d12',
        foreground: '#d6deeb',
        cursor: '#d6deeb',
      },
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(buildAttachUrl(host, name, slug, term.cols, term.rows));
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    setState('connecting');

    // React.StrictMode runs effects twice in dev; the first run's cleanup fires
    // ws.close() on a still-CONNECTING socket, and the asynchronous close/error
    // events arrive *after* the second run's setup has already begun. Without
    // this per-run flag, those stale events would clobber the live socket's
    // state (we'd render "Disconnected" while WS B is happily streaming).
    let stale = false;

    ws.addEventListener('open', () => {
      if (stale) return;
      setState('connected');
      // Re-send size in case fit() picked a different value than the URL params.
      sendResize();
      term.focus();
    });

    ws.addEventListener('message', (evt) => {
      if (stale) return;
      const data = evt.data;
      if (typeof data === 'string') {
        // biome-ignore lint/suspicious/noConsole: diagnostic for in-development feature
        console.info('[rc-attach] control frame', data);
        return;
      }
      if (data instanceof ArrayBuffer) {
        term.write(new Uint8Array(data));
      }
    });

    ws.addEventListener('close', (evt) => {
      if (stale) return;
      // biome-ignore lint/suspicious/noConsole: diagnostic for in-development feature
      console.info('[rc-attach] ws close', {
        code: evt.code,
        reason: evt.reason,
        wasClean: evt.wasClean,
      });
      setState('disconnected');
    });

    ws.addEventListener('error', (evt) => {
      if (stale) return;
      // biome-ignore lint/suspicious/noConsole: diagnostic for in-development feature
      console.warn('[rc-attach] ws error', evt);
    });

    const encoder = new TextEncoder();
    const inputDisp = term.onData((d) => {
      if (stale || ws.readyState !== WebSocket.OPEN) return;
      ws.send(encoder.encode(d));
    });

    const observer = new ResizeObserver(() => fitAndMaybeResize());
    observer.observe(container);

    const onWindowResize = () => fitAndMaybeResize();
    window.addEventListener('resize', onWindowResize);

    return () => {
      stale = true;
      window.removeEventListener('resize', onWindowResize);
      observer.disconnect();
      inputDisp.dispose();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
      try {
        term.dispose();
      } catch {
        // ignore
      }
      wsRef.current = null;
      termRef.current = null;
      fitRef.current = null;
    };
  }, [host, name, slug, reconnectKey, sendResize, fitAndMaybeResize]);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-[#0b0d12]">
      <div ref={containerRef} className="min-h-0 flex-1 [&_.xterm]:h-full [&_.xterm]:p-2" />
      {state !== 'connected' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
          <div className="pointer-events-auto rounded-md bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 shadow">
            {state === 'connecting' ? (
              <span>Connecting…</span>
            ) : (
              <span className="flex items-center gap-2">
                <span>Disconnected</span>
                <button
                  type="button"
                  className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600"
                  data-testid={RECONNECT_KEY}
                  onClick={() => setReconnectKey((k) => k + 1)}
                >
                  Reconnect
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
