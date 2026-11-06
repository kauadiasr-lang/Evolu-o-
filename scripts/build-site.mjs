// Monta o site publicável em site-dist/:
//   /                página inicial de versões (site/)         /jogo/   build ATUAL do jogo (vite, base relativa, PWA)
//   /v/<id>/         versões anteriores (releases/<id>/)       /versions.json  registro (versions/versions.json + dados da publicação)
//   uso:  node scripts/build-site.mjs [--out site-dist]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { join } from 'node:path';

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'site-dist';
const reg = JSON.parse(readFileSync('versions/versions.json', 'utf8'));
const git = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. jogo atual
execFileSync('npx', ['vite', 'build', '--outDir', join(out, 'jogo'), '--emptyOutDir'], { stdio: 'inherit' });
const build = JSON.parse(readFileSync(join(out, 'jogo', 'gs-build.json'), 'utf8'));

// 2. página inicial + ícones
cpSync('site', out, { recursive: true });
for (const f of ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) cpSync(join('public', f), join(out, f));
writeFileSync(join(out, '.nojekyll'), '');
writeFileSync(join(out, '404.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GS Evolução — página não encontrada</title><style>body{background:#060a14;color:#d8e4f5;font:16px system-ui;padding:24px}a{color:#4dd6c4}</style><h1>Página não encontrada</h1><p>Volte para a <a href="./">página de versões</a> ou <a href="./jogo/">abra o jogo</a>.</p>\n');

// 3. versões anteriores
const have = new Set();
if (existsSync('releases')) {
  for (const id of readdirSync('releases')) {
    if (!existsSync(join('releases', id, 'index.html'))) continue;
    cpSync(join('releases', id), join(out, 'v', id), { recursive: true });
    have.add(id);
  }
}

// 4. registro público
const versions = reg.versions.map((v) => ({ ...v, available: have.has(v.id) || v.id === reg.current, url: v.id === reg.current ? 'jogo/' : have.has(v.id) ? `v/${v.id}/` : null }));
const commit = process.env.GITHUB_SHA?.slice(0, 7) || git('git rev-parse --short HEAD') || 'local';
writeFileSync(join(out, 'versions.json'), JSON.stringify({ ...reg, versions, site: { commit, builtAt: new Date().toISOString(), build: build.build, branch: process.env.GITHUB_REF_NAME || git('git rev-parse --abbrev-ref HEAD') } }, null, 1));
console.log(`site montado em ${out}/: jogo atual v${build.version} (${build.channel}, build ${build.build}), ${have.size} versão(ões) arquivada(s): ${[...have].join(', ') || '—'}`);
