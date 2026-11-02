import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
} as any);
