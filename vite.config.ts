import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite configuration.
 *
 * - `basicSsl()` gives us an HTTPS dev server on the LAN so `getUserMedia`
 *   works when testing on a phone over Wi-Fi.
 * - `base` is relative-friendly for GitHub Pages / Cloudflare Pages.
 */
export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH ?? './',
  plugins: [basicSsl()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    https: {},
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: command === 'build' ? false : true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three') || id.includes('mind-ar')) return 'three';
            if (id.includes('@mediapipe')) return 'mediapipe';
            if (id.includes('peerjs')) return 'rtc';
            if (id.includes('fontsource')) return 'fonts';
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['mind-ar'],
  },
  // The semantic-search worker dynamically imports the optional embedding
  // model, which requires ES module output (IIFE workers cannot be code-split).
  worker: {
    format: 'es',
  },
}));
