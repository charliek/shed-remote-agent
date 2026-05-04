import { Slot } from '@radix-ui/react-slot';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

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
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-9 px-4';
  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
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
    <div className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}>
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
    default: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-border text-muted-foreground',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs',
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
  const tone =
    s === 'running'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
      : s === 'stopped'
        ? 'bg-muted text-muted-foreground'
        : s === 'starting'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
          : s === 'error'
            ? 'bg-destructive/15 text-destructive'
            : 'bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs',
        tone,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current')} />
      {status}
    </span>
  );
}

export function PageShell({
  title,
  right,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {right}
      </header>
      {children}
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
    <div className="rounded-lg border border-border border-dashed bg-card/40 p-8 text-center">
      <div className="font-medium">{title}</div>
      {description && <div className="mt-1 text-muted-foreground text-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
