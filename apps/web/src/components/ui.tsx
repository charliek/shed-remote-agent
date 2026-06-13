import { Slot } from '@radix-ui/react-slot';
import { Moon, Sun } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

const cardShadow = 'shadow-[0_1px_2px_hsl(var(--shadow)/0.04),0_8px_24px_hsl(var(--shadow)/0.05)]';

export function Button({
  variant = 'default',
  className,
  children,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'secondary' | 'destructive' | 'ghost';
  /**
   * When true, render the styles onto the single child element instead of
   * an inner <button>. Lets you write `<Button asChild><Link>...</Link></Button>`
   * without nesting a <button> inside an <a> (which is invalid HTML and
   * breaks accessibility).
   */
  asChild?: boolean;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-semibold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 px-4 [&_svg]:h-4 [&_svg]:w-4';
  const variants = {
    default:
      'bg-primary text-primary-foreground shadow-[0_4px_14px_hsl(var(--primary)/0.3)] hover:brightness-[1.06] hover:-translate-y-px hover:shadow-[0_8px_20px_hsl(var(--primary)/0.4)] active:translate-y-0',
    secondary:
      'border border-border-strong bg-secondary text-secondary-foreground hover:bg-accent hover:-translate-y-px',
    destructive:
      'bg-destructive text-destructive-foreground shadow-[0_4px_14px_hsl(var(--destructive)/0.28)] hover:brightness-[1.06] hover:-translate-y-px',
    ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
  } as const;
  if (asChild) {
    return (
      <Slot className={cn(base, variants[variant], className)} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button type="button" className={cn(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card text-card-foreground',
        cardShadow,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A bordered, rounded container whose direct children render as divided rows. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card',
        cardShadow,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  variant = 'default',
  className,
}: {
  children: ReactNode;
  variant?: 'default' | 'secondary' | 'outline';
  className?: string;
}) {
  const variants = {
    default: 'bg-primary-soft text-primary',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-border-strong text-muted-foreground',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 font-semibold text-xs',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const running = s === 'running' || s === 'ready';
  const warn =
    s === 'starting' || s === 'reconnecting' || s.includes('trust') || s.includes('auth');
  const bad = s === 'error' || s === 'dead' || s === 'failed';

  const tone = running
    ? 'bg-sage-soft text-sage'
    : warn
      ? 'bg-ochre-soft text-ochre'
      : bad
        ? 'bg-destructive/12 text-destructive'
        : 'bg-secondary text-faint';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold text-xs',
        tone,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', running && 'pulse-dot')} />
      {status}
    </span>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'inline-grid h-10 w-10 place-items-center rounded-xl border border-border-strong bg-card text-muted-foreground transition-all hover:-translate-y-px hover:border-primary/50 hover:text-primary',
        className,
      )}
    >
      {theme === 'dark' ? (
        <Sun className="h-[18px] w-[18px]" />
      ) : (
        <Moon className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}

/** Brand mark + wordmark (links home) on the left; theme toggle + optional action on the right. */
export function AppHeader({ action }: { action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-5">
      <Link to="/" className="group flex items-center gap-2.5" aria-label="Shed — home">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-ochre text-primary-foreground shadow-[0_6px_16px_hsl(var(--primary)/0.35)] transition-transform group-hover:-translate-y-px">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[22px] w-[22px]"
            aria-hidden="true"
          >
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
            <path d="M9 21v-6h6v6" />
          </svg>
        </span>
        <span className="font-extrabold text-2xl tracking-tight">Shed</span>
      </Link>
      <div className="flex items-center gap-2">
        {action}
        <ThemeToggle />
      </div>
    </div>
  );
}

export function PageShell({
  title,
  right,
  action,
  children,
}: {
  title?: ReactNode;
  right?: ReactNode;
  /** Rendered in the top app bar, next to the theme toggle (e.g. a primary action). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-20">
      <AppHeader action={action} />
      {title != null && (
        <header className="mb-5 flex items-center justify-between gap-4">
          <h1 className="min-w-0 font-bold text-xl tracking-tight">{title}</h1>
          {right}
        </header>
      )}
      {children}
    </div>
  );
}

export function SectionLabel({
  children,
  count,
  className,
}: {
  children: ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('mb-2.5 flex items-center gap-2 px-0.5', className)}>
      <h2 className="font-bold text-faint text-xs uppercase tracking-wider">{children}</h2>
      {count != null && (
        <span className="rounded-full bg-primary-soft px-2 py-0.5 font-bold text-[11px] text-primary">
          {count}
        </span>
      )}
    </div>
  );
}

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="mb-4 grid grid-cols-3 gap-2.5">{children}</div>;
}

export function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: 'sage' | 'faint' | 'primary';
}) {
  const dot =
    tone === 'sage'
      ? 'bg-sage shadow-[0_0_0_4px_hsl(var(--sage)/0.18)]'
      : tone === 'primary'
        ? 'bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]'
        : 'bg-faint shadow-[0_0_0_4px_hsl(var(--faint)/0.16)]';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
      <div className="min-w-0 leading-tight">
        <div className="font-extrabold text-2xl tabular-nums tracking-tight">{n}</div>
        <div className="font-semibold text-muted-foreground text-xs">{label}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border-strong border-dashed bg-card/50 p-8 text-center">
      <div className="font-semibold">{title}</div>
      {description && <div className="mt-1 text-muted-foreground text-sm">{description}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
