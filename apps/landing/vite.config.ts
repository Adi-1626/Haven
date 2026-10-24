import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The planetary background is the authentication screen's own WebGL scene, imported from the web app
// rather than copied, so the website and the app can never drift apart.
const orbital = fileURLToPath(new URL('../web/src/orbital', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@orbital': orbital }
  },
  server: {
    port: 5174,
    strictPort: true,
    host: '127.0.0.1'
  },
  preview: {
    port: 5174,
    strictPort: true,
    host: '127.0.0.1'
  }
});
