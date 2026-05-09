import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Look up env files relative to this config (not the cwd of whoever
  // invoked `vite`) and only load VITE_-prefixed vars to match Vite's
  // client-side env semantics.
  const env = loadEnv(mode, __dirname, 'VITE_');

  // VITE_HOST: 'true' → bind to all interfaces (server.host = true);
  // 'false' (or unset) → loopback only; anything else is treated as a
  // literal hostname/IP to bind to.
  const hostValue =
    env.VITE_HOST === 'true'
      ? true
      : env.VITE_HOST === 'false' || !env.VITE_HOST
        ? false
        : env.VITE_HOST;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: hostValue,
      allowedHosts: [
        'sra.local.stridelabs.ai',
        ...(env.VITE_EXTRA_ALLOWED_HOSTS?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? []),
      ],
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
