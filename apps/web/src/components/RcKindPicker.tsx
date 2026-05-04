import type { RcKind } from '@shed-remote-agent/shared';

const OPTIONS: { value: RcKind; label: string; hint: string }[] = [
  {
    value: 'agent',
    label: 'agent',
    hint: 'claude remote-control broker',
  },
  {
    value: 'repl',
    label: 'repl',
    hint: 'live claude REPL with /rc',
  },
  {
    value: 'shell',
    label: 'shell',
    hint: 'plain bash in /workspace',
  },
];

export function RcKindPicker({
  value,
  onChange,
  disabled,
}: {
  value: RcKind;
  onChange: (next: RcKind) => void;
  disabled?: boolean;
}) {
  const current = OPTIONS.find((o) => o.value === value);
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2 rounded-md border border-border bg-background p-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded px-3 py-1.5 font-medium text-sm transition-colors disabled:opacity-50 ${
              value === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {current && <div className="text-muted-foreground text-xs">{current.hint}</div>}
    </div>
  );
}
