import { defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'amrap',
    compatibilityDate: '2026-09-21',
    workersDev: true,
    assets: {
      notFoundHandling: 'single-page-application',
    },
  },
});
