import { defineConfig } from 'vite';
import { gsInfo, gsPwa } from './scripts/vite-gs-plugin';

const info = gsInfo();

export default defineConfig({
  // caminhos relativos: o mesmo build funciona na raiz, em /Evolu-o-/jogo/, em /v/0.4.0/… (qualquer hospedagem estática)
  base: './',
  worker: { format: 'es' },
  define: { __GS__: JSON.stringify(info) },
  plugins: [gsPwa(info)],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
} as any);
