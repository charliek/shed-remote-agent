import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: env.VITE_HOST === 'true' ? true : env.VITE_HOST || false,
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
