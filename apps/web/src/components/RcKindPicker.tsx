import type { RcKind } from '@shed-remote-agent/shared';
import { useEffect } from 'react';

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
  allowedKinds,
}: {
  value: RcKind;
  onChange: (next: RcKind) => void;
  disabled?: boolean;
  /** Optional whitelist. When provided, only these kinds are rendered, and
   * if the current `value` isn't in the list it's coerced to the first
   * allowed kind so the form doesn't sit on a hidden value. */
  allowedKinds?: RcKind[];
}) {
  const visible = allowedKinds ? OPTIONS.filter((o) => allowedKinds.includes(o.value)) : OPTIONS;

  useEffect(() => {
    if (allowedKinds && !allowedKinds.includes(value) && allowedKinds.length > 0) {
      onChange(allowedKinds[0]);
    }
  }, [allowedKinds, value, onChange]);

  const current = visible.find((o) => o.value === value);
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2 rounded-md border border-border bg-background p-1">
        {visible.map((opt) => (
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
