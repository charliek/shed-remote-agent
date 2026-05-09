// On-screen helper keys for the in-browser terminal — the soft keyboard on
// phones/tablets has no ESC/TAB/CTRL/arrows, so without this the terminal
// is unusable on mobile (tmux pane, vim, claude REPL all become read-only).
//
// CTRL is a sticky modifier: tap CTRL, then tap any [a-zA-Z] key (on the
// soft keyboard or with a chip below) and that character gets sent as its
// control code (\x01..\x1a). Tapping CTRL again disarms.

interface TerminalKeysProps {
  /** Send raw bytes to the terminal as if the user typed them. */
  onSend: (bytes: string) => void;
  /** Whether sticky CTRL is currently armed. */
  ctrlArmed: boolean;
  onToggleCtrl: () => void;
}

interface KeyDef {
  label: string;
  bytes: string;
  /** Optional aria label for screen readers. */
  ariaLabel?: string;
  /** Wider chip when label is long. */
  wide?: boolean;
}

const ROW: KeyDef[] = [
  { label: 'Esc', bytes: '\x1b' },
  { label: 'Tab', bytes: '\t' },
  { label: '↑', bytes: '\x1b[A', ariaLabel: 'Up arrow' },
  { label: '↓', bytes: '\x1b[B', ariaLabel: 'Down arrow' },
  { label: '←', bytes: '\x1b[D', ariaLabel: 'Left arrow' },
  { label: '→', bytes: '\x1b[C', ariaLabel: 'Right arrow' },
  { label: '^C', bytes: '\x03', ariaLabel: 'Control C' },
  { label: '^D', bytes: '\x04', ariaLabel: 'Control D' },
  { label: '^L', bytes: '\x0c', ariaLabel: 'Control L' },
  { label: 'PgUp', bytes: '\x1b[5~', wide: true },
  { label: 'PgDn', bytes: '\x1b[6~', wide: true },
  { label: 'Home', bytes: '\x1b[H', wide: true },
  { label: 'End', bytes: '\x1b[F', wide: true },
];

export function TerminalKeys({ onSend, ctrlArmed, onToggleCtrl }: TerminalKeysProps) {
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-zinc-800 border-t bg-[#0b0d12] px-2 py-1.5 text-zinc-200 [-webkit-overflow-scrolling:touch]">
      <button
        type="button"
        aria-pressed={ctrlArmed}
        onClick={onToggleCtrl}
        className={`shrink-0 rounded px-2.5 py-1.5 font-mono text-xs transition-colors ${
          ctrlArmed ? 'bg-amber-500 text-zinc-900' : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
        }`}
      >
        Ctrl{ctrlArmed ? ' •' : ''}
      </button>
      {ROW.map((k) => (
        <button
          key={k.label}
          type="button"
          aria-label={k.ariaLabel ?? k.label}
          onMouseDown={(e) => {
            // Prevent the terminal from losing focus when tapping a chip;
            // otherwise the next real keystroke goes nowhere on iOS.
            e.preventDefault();
          }}
          onClick={() => onSend(k.bytes)}
          className={`shrink-0 rounded bg-zinc-800 px-2.5 py-1.5 font-mono text-xs text-zinc-100 transition-colors hover:bg-zinc-700 ${
            k.wide ? 'min-w-12' : ''
          }`}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
