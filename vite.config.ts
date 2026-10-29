import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@shared': path.resolve(rootDir, 'shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist/client',
  },
});
