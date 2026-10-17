import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const apiTarget = process.env.VITE_API_URL || 'http://127.0.0.1:3001';

export default defineConfig({
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react()],
  resolve: {
    alias: {
      '@haven/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
