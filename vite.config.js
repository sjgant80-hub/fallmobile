import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'www',
  base: './',
  build: {
    outDir: '../www-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'www/index.html')
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
