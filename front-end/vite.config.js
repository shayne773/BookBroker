import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API base URL is compiled into the bundle from VITE_SERVER_ADDRESS, so every
// environment (local, preview, production) needs its own build with its own value.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  preview: {
    port: 3000
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    css: true
  }
});
