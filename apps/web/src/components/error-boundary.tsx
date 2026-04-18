import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // biome-ignore lint/suspicious/noConsole: surfacing unhandled render errors
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-md space-y-2 rounded-lg border border-destructive bg-card p-6 text-card-foreground">
            <h1 className="font-semibold text-lg">Something went wrong</h1>
            <p className="text-muted-foreground text-sm">Please refresh and try again.</p>
            {import.meta.env.DEV && (
              <p className="break-all pt-2 font-mono text-muted-foreground text-xs">
                {this.state.error.message}
              </p>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
