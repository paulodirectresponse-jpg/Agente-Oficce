import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@server': path.resolve(__dirname, 'server'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Rust keeps DLLs locked under target/ on Windows. Vite must never
      // traverse that directory or the watcher can crash with EBUSY.
      ignored: ['**/src-tauri/target/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
