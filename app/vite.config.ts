import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import type { PluginOption } from 'vite';
import { defineConfig } from 'vitest/config';

// The service worker plugin is build-time only; leave it out of the unit tests.
const plugins: PluginOption[] = [react()];
if (!process.env.VITEST) {
  plugins.push(
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'brand-mark.png'],
      manifest: {
        name: 'AMRAP',
        short_name: 'AMRAP',
        lang: 'sl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#000000',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  );
}

export default defineConfig({
  plugins,
  build: {
    rollupOptions: {
      output: {
        // Keep the vendor chunks apart so each stays under Vite's 500 kB warning limit.
        manualChunks(id) {
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
