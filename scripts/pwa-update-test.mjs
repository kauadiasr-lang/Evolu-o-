// Etapa 7 — a atualização do PWA é segura? Publica a build A, abre o jogo, publica a build B por cima e verifica:
//   • o aviso aparece, mas a página e a simulação continuam na versão A (nada é trocado nem interrompido sozinho);
//   • A segue íntegra a partir do próprio cache mesmo depois de o servidor já não ter os arquivos de A (sem mistura de versões);
//   • "Depois" não troca; recarregar a página não troca; só "Atualizar" / "Salvar mundo e atualizar" troca, e apaga o cache de A;
//   • "Salvar mundo e atualizar" grava o mundo antes (IndexedDB).
//   node scripts/pwa-update-test.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execFileSync('npm', ['root', '-g']).toString().trim() + '/playwright'); }
const { chromium } = pw;
const { start } = await import('./serve-site.mjs?update');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = mkdtempSync(join(tmpdir(), 'gs-pwa-'));
const buildTo = (version, channel) => execFileSync('npx', ['vite', 'build', '--outDir', join(root, 'jogo'), '--emptyOutDir'], { env: { ...process.env, GS_VERSION: version, GS_CHANNEL: channel, GS_COMMIT: 'teste' }, stdio: 'ignore' });

buildTo('0.0.1-A', 'dev');
const { srv, url } = await start({ dir: root, port: 0, prefix: '/gs' });
const BASE = url + 'jogo/';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const ver = () => page.evaluate(() => document.getElementById('h-ver').textContent);
const tick = () => page.evaluate(() => window.__evolvere.stats.tick);
const cachesNow = () => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('gs-evolucao::')));
const barVisible = () => page.evaluate(() => !document.getElementById('update-bar').hidden);

await page.goto(BASE + '?seed=3&size=64x40&pop=300&stage3=0&speed=1');
await page.waitForFunction(() => window.__evolvere?.stats?.tick > 0, null, { timeout: 25000 });
await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
await page.reload();
await page.waitForFunction(() => window.__evolvere?.stats?.tick > 0 && navigator.serviceWorker.controller, null, { timeout: 25000 });
check('A: instalada e controlando a página', /0\.0\.1-A/.test(await ver()) && (await cachesNow()).length === 1, await ver());
const assetA = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /assets\/index-/.test(s)));
check('A: nenhum aviso de atualização enquanto não há versão nova', !(await barVisible()));

// ---- publica B por cima (o servidor deixa de ter os arquivos de A)
buildTo('0.0.2-B', 'dev');
const gone = await fetch(assetA, { cache: 'no-store' });
check('B publicada: o servidor já não serve os arquivos de A', gone.status === 404, `status ${gone.status}`);
await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
await page.waitForFunction(() => !document.getElementById('update-bar').hidden && /0\.0\.2-B/.test(document.getElementById('up-title').textContent), null, { timeout: 25000 });
check('aviso: aparece e informa a versão nova (0.0.2-B)', true, await page.evaluate(() => document.getElementById('up-title').textContent));
const t0 = await tick(); await sleep(3000); const t1 = await tick();
check('a simulação em andamento NÃO foi interrompida pela chegada da versão nova', t1 > t0 && /0\.0\.1-A/.test(await ver()), `${t0} → ${t1}, ainda ${await ver()}`);
const stillA = await page.evaluate(async (u) => (await fetch(u)).status, assetA);
check('sem mistura: os arquivos de A continuam saindo do cache de A (mesmo com o servidor sem eles)', stillA === 200);
check('os dois caches coexistem até a confirmação (A ativo, B em espera)', (await cachesNow()).length === 2, JSON.stringify((await cachesNow()).map((c) => c.split('::').pop())));

// ---- "Depois" e recarregar não trocam
await page.click('#up-later');
check('"Depois" esconde o aviso e mantém A', !(await barVisible()) && /0\.0\.1-A/.test(await ver()));
await page.reload();
await page.waitForFunction(() => window.__evolvere?.stats?.tick > 0 && !document.getElementById('update-bar').hidden, null, { timeout: 25000 });
check('recarregar a página NÃO troca de versão sozinho (continua A) e o aviso volta', /0\.0\.1-A/.test(await ver()) && (await barVisible()), await ver());

// ---- "Salvar mundo e atualizar"
await page.click('#up-save');
await page.waitForFunction(() => /0\.0\.2-B/.test(document.getElementById('h-ver')?.textContent || '') && window.__evolvere?.stats, null, { timeout: 30000 });
check('"Salvar mundo e atualizar": troca para B e recarrega', /0\.0\.2-B/.test(await ver()), await ver());
const saved = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('evolvere', 1); r.onsuccess = () => { const q = r.result.transaction('saves').objectStore('saves').getAllKeys(); q.onsuccess = () => res(q.result); }; r.onerror = () => res(null); }));
check('o mundo foi salvo antes de atualizar (IndexedDB)', Array.isArray(saved) && saved.some((k) => /antes da atualização — v0\.0\.1-A/.test(k)), JSON.stringify(saved));
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
const cs = await cachesNow();
check('depois de atualizar o cache de A foi apagado (só B)', cs.length === 1, JSON.stringify(cs.map((c) => c.split('::').pop())));
await sleep(2000);
check('B roda: simulação avança e sem erros de JavaScript', (await tick()) > 0 && errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
srv.close();
rmSync(root, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`);
process.exit(failed.length ? 1 : 0);
