/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // Relative asset URLs: the portal is served under <Server.path>/admin/, whatever the path
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../dist/admin', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    // `npm run dev` serves the portal at / and proxies the API to a local AMW
    // server running with the sample.yml settings
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        rewrite: (path) => `/amw/admin${path}`
      }
    }
  },
  test: {
    environment: 'jsdom'
  }
});
