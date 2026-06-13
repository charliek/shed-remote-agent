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
    <div className="flex shrink-0 gap-1 overflow-x-auto border-[#33291f] border-t bg-[#1b1713] px-2 py-1.5 text-[#e8ddcd] [-webkit-overflow-scrolling:touch]">
      <button
        type="button"
        aria-pressed={ctrlArmed}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleCtrl}
        className={`shrink-0 rounded px-2.5 py-1.5 font-mono text-xs transition-colors ${
          ctrlArmed
            ? 'bg-[#e0916b] text-[#1b1713]'
            : 'bg-[#33291f] text-[#f0e9df] hover:bg-[#44382c]'
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
          className={`shrink-0 rounded bg-[#33291f] px-2.5 py-1.5 font-mono text-[#f0e9df] text-xs transition-colors hover:bg-[#44382c] ${
            k.wide ? 'min-w-12' : ''
          }`}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
