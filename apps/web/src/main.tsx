import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { ErrorBoundary } from './components/error-boundary';
import { queryClient } from './lib/query-client';
import { ThemeProvider, useTheme } from './lib/theme';
import './index.css';

// Lives inside ThemeProvider so toasts track the app's (explicit) theme rather
// than the OS, which can disagree after a manual toggle.
function AppToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} toastOptions={{ className: 'font-sans' }} />;
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <App />
          <AppToaster />
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
