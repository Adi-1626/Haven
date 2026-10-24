import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { setupMockServer } from './src/ui-mode/mock-server.js';

function havenUiTestModePlugin(): Plugin {
  return {
    name: 'haven-ui-test-mode',
    configureServer(server) {
      setupMockServer(server);

      // Clearly identify the active mode in terminal output
      server.httpServer?.once('listening', () => {
        setTimeout(() => {
          console.log('\n\x1b[35m' + '─'.repeat(65) + '\x1b[0m');
          console.log('\x1b[1m\x1b[35m  HAVEN 1.0 ZENITH — LOCAL UI TESTING MODE (ACTIVE)\x1b[0m');
          console.log('\x1b[36m  • Activation:\x1b[0m   Dedicated development command (npm run dev:ui)');
          console.log('\x1b[36m  • Local URL:\x1b[0m    http://127.0.0.1:5173/');
          console.log('\x1b[36m  • Mock User:\x1b[0m    Alex Mercer (@alex_zenith) [Pre-authenticated]');
          console.log('\x1b[36m  • Isolation:\x1b[0m    Zero external network (Supabase & APIs blocked)');
          console.log('\x1b[36m  • Production:\x1b[0m   Build-time isolated; excluded from production');
          console.log('\x1b[35m' + '─'.repeat(65) + '\x1b[0m\n');
        }, 100);
      });
    },
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        '<head>\n    <script type="module" src="/src/ui-mode/mock-client-setup.ts"></script>'
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), havenUiTestModePlugin()],
  // Identifies this dev-server run. The mock accounts live in its memory, so a browser-stored mock session from an
  // earlier run (signed out, or an account that no longer exists) must not decide how a fresh `npm run dev:ui` opens.
  define: {
    'import.meta.env.VITE_HAVEN_UI_RUN_ID': JSON.stringify(`${process.pid}-${Date.now().toString(36)}`),
  },
  resolve: {
    alias: [
      {
        find: '@haven/shared',
        replacement: path.resolve(__dirname, '../../packages/shared/src'),
      },
      {
        find: /^\.\/supabase(\.js)?$/,
        replacement: path.resolve(__dirname, 'src/supabase.mock.ts'),
      },
      {
        find: /.*\/supabase(\.js)?$/,
        replacement: path.resolve(__dirname, 'src/supabase.mock.ts'),
      },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
});
