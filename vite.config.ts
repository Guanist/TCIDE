import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
      output: {
        manualChunks(id) {
          // Monaco 核心 → 独立 chunk
          if (id.includes('monaco-editor')) {
            return 'vendor-monaco-core';
          }
          // xterm.js → 独立 chunk
          if (id.includes('xterm') || id.includes('@xterm')) {
            return 'vendor-xterm';
          }
          // marked.js (markdown 渲染) → 独立 chunk
          if (id.includes('marked') && !id.includes('marked-terminal')) {
            return 'vendor-marked';
          }
        },
      },
    },
    target: 'es2022',
    minify: 'esbuild',
  },
  resolve: {
    alias: {}
  },
  server: {
    port: 5173
  }
});
