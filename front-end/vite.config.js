import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API base URL is compiled into the bundle from VITE_SERVER_ADDRESS: production
// and preview builds get /api (same origin) from .env.production, local development
// sets it in .env.local.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js'
  }
});
