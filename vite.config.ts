import { defineConfig } from 'vite';
import { resolve } from 'path';

const PET_CSS = `
/* ── TCIDE Pixel Pet v3 ── */
.tcide-pet{display:flex;align-items:center;gap:5px;padding:0 8px 0 4px;cursor:pointer;position:relative;z-index:20;flex-shrink:0;height:100%;transition:opacity .3s}
.pet-canvas{width:36px;height:36px;image-rendering:pixelated;image-rendering:crisp-edges;flex-shrink:0;border-radius:2px}
.pet-label{font-size:10px;font-family:monospace;white-space:nowrap;transition:color .3s}
#status-bar .pet-label{color:#FFE0B2}
.pet-idle{}.pet-thinking{color:#FFD700!important}.pet-tool{color:#3498DB!important}.pet-success{color:#2ECC71!important}.pet-error{color:#E74C3C!important}
.pet-speech{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);background:#2d2d2d;color:#eee;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:4px 10px;font-size:11px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .2s,bottom .2s;box-shadow:0 3px 12px rgba(0,0,0,0.5);z-index:9999}
.pet-speech::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#2d2d2d}
.pet-speech.show{opacity:1;bottom:46px}
@keyframes pet-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}
.tcide-pet:hover .pet-canvas{animation:pet-bob 1.5s ease-in-out infinite}
`;

const petPlugin = {
  name: 'inject-pet-css',
  transformIndexHtml(html: string) {
    return html.replace('</head>', '<style id="tcide-pet-styles">' + PET_CSS + '</style></head>');
  },
  closeBundle() {
    // Copy pet-window.html to dist after build
    const fs = require('fs');
    const path = require('path');
    const src = path.join(__dirname, 'src', 'renderer', 'pet-window.html');
    const dst = path.join(__dirname, 'dist', 'renderer', 'pet-window.html');
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  },
};

export default defineConfig({
  optimizeDeps: { include: ['@emmetio/expand-abbreviation'] },
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
      output: {
        manualChunks: {
          'vendor-monaco-core': ['monaco-editor'],
          'vendor-xterm': ['xterm', 'xterm-addon-fit'],
        },
      },
    },
    chunkSizeWarningLimit: 4000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [petPlugin],
});
