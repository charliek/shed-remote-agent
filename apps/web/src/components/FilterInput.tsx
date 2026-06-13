import { Search } from 'lucide-react';

export function FilterInput({
  value,
  onChange,
  placeholder,
  ariaLabel = 'Filter',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-faint"
      />
      <input
        type="text"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-11 w-full rounded-xl border border-border bg-card pr-3 pl-10 text-foreground text-sm outline-none transition placeholder:text-faint focus-visible:border-primary/55 focus-visible:ring-4 focus-visible:ring-primary/10"
      />
    </div>
  );
}
