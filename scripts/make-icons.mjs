// Gera os PNG do ícone (192, 512, maskable 512, apple-touch 180) a partir de public/icon.svg, usando o Chromium do Playwright.
//   node scripts/make-icons.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execFileSync('npm', ['root', '-g']).toString().trim() + '/playwright'); }
const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await pw.chromium.launch();
const page = await browser.newPage();
const render = async (size, file, { maskable = false } = {}) => {
  // maskable: fundo sangrando até a borda e conteúdo reduzido para a zona segura (80%)
  const inner = maskable ? svg.replace('<rect width="512" height="512" rx="96" fill="url(#bg)"/>', '<rect width="512" height="512" fill="url(#bg)"/>').replace('<g transform="translate(256 252)">', '<g transform="translate(256 252) scale(.78)">') : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${inner}`);
  writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('ok', file);
};
await render(192, 'public/icon-192.png');
await render(512, 'public/icon-512.png');
await render(512, 'public/icon-512-maskable.png', { maskable: true });
await render(180, 'public/apple-touch-icon.png');
await browser.close();
