// Etapa 7 — testa o SITE PUBLICADO (ou o site montado localmente): página inicial, jogo, parâmetros de URL, toque,
// pausa/velocidade/reinício, grades diferentes, PWA (manifesto, instalabilidade, service worker, offline) e versões arquivadas.
//   node scripts/site-test.mjs                     → monta/serve site-dist em http://127.0.0.1:<porta>/Evolu-o-/ (precisa de `npm run build:site`)
//   node scripts/site-test.mjs https://usuario.github.io/Evolu-o-/   → testa o endereço público
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execFileSync('npm', ['root', '-g']).toString().trim() + '/playwright'); }
const { chromium, devices } = pw;

let BASE = process.argv[2];
let server = null;
if (!BASE) {
  const { start } = await import('./serve-site.mjs?local');
  const s = await start();
  server = s.srv;
  BASE = s.url;
}
if (!BASE.endsWith('/')) BASE += '/';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`# alvo: ${BASE}\n`);

const browser = await chromium.launch();
async function openPage(url, ctxOpts = { viewport: { width: 1280, height: 800 } }, wait = true) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [], failed = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/ai/.test(r.url())) failed.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => { if (!/\/api\/ai/.test(r.url())) failed.push(`falhou ${r.url()}`); });
  const resp = await page.goto(url, { waitUntil: 'load' });
  if (wait) await page.waitForFunction(() => window.__evolvere?.stats && window.__evolvere.renderer.frame, null, { timeout: 25000 });
  return { page, context, errors, failed, resp };
}
const tick = (page) => page.evaluate(() => window.__evolvere.stats.tick);

// ============================================================ página inicial
const reg = await (await fetch(BASE + 'versions.json')).json();
{
  const { page, context, errors, failed, resp } = await openPage(BASE, { viewport: { width: 1280, height: 800 } }, false);
  check('página inicial: responde 200 e tem título', resp.status() === 200 && /GS Evolução/.test(await page.title()));
  await page.waitForFunction(() => document.getElementById('cur-ver').textContent.startsWith('v'), null, { timeout: 8000 });
  const info = await page.evaluate(() => ({ ver: document.getElementById('cur-ver').textContent, ch: document.getElementById('cur-ch').textContent, n: document.querySelectorAll('#versions details.v').length, stages: document.querySelectorAll('#stages li').length, href: document.getElementById('open-game').href, issues: document.querySelectorAll('#issues .issue').length, foot: document.getElementById('foot-build').textContent }));
  check(`página inicial: mostra a versão atual (v${reg.current}) e o canal`, info.ver === 'v' + reg.current && ['estável', 'experimental', 'desenvolvimento'].includes(info.ch), `${info.ver} · ${info.ch}`);
  check(`página inicial: histórico lista as ${reg.versions.length} versões e ${reg.etapas.length} etapas`, info.n === reg.versions.length && info.stages === reg.etapas.length, `${info.n} versões, ${info.stages} etapas`);
  check('página inicial: botão "Abrir o jogo" aponta para jogo/ e problemas conhecidos são listados', /\/jogo\/$/.test(info.href) && info.issues > 0, info.href);
  check('página inicial: identifica o commit publicado', /commit/.test(info.foot) && reg.site?.commit && info.foot.includes(reg.site.commit), info.foot);
  check('página inicial: sem erros e sem recursos faltando', errors.length === 0 && failed.length === 0, [...errors, ...failed].slice(0, 3).join(' | '));
  await context.close();
  // celular
  const m = await openPage(BASE, { ...devices['Pixel 7'] }, false);
  await m.page.waitForFunction(() => document.getElementById('cur-ver').textContent.startsWith('v'), null, { timeout: 8000 });
  const mob = await m.page.evaluate(() => { const b = document.getElementById('open-game').getBoundingClientRect(); return { over: document.documentElement.scrollWidth > innerWidth, h: b.height, w: b.width, vis: b.width > 0, iw: innerWidth }; });
  check('página inicial no celular: sem rolagem horizontal e botão de abrir com área de toque ≥ 44 px', !mob.over && mob.h >= 44 && mob.vis, JSON.stringify(mob));
  await m.page.tap('a[href="#historico"]');
  await m.page.tap('#versions details.v >> nth=1 >> summary');
  const opened = await m.page.evaluate(() => document.querySelectorAll('#versions details.v[open]').length);
  check('página inicial no celular: toque abre os detalhes de uma versão', opened === 1);
  await m.context.close();
}

// ============================================================ jogo (desktop)
let gameBuild;
{
  const q = '?seed=3&size=64x40&pop=300&stage3=0&paused=1';
  const { page, context, errors, failed } = await openPage(BASE + 'jogo/' + q);
  gameBuild = await (await fetch(BASE + 'jogo/gs-build.json')).json();
  const st = await page.evaluate(() => ({ tick: window.__evolvere.stats.tick, cfg: window.__evolvere.worldCfg, ver: document.getElementById('h-ver').textContent, seed: document.getElementById('h-seed').textContent, state: document.getElementById('h-state').textContent, title: document.title, w: window.__evolvere.renderer.w, h: window.__evolvere.renderer.h }));
  check('jogo: carrega, o Web Worker da simulação inicia e o mundo nasce no tick 0 pausado', st.tick === 0 && st.state === 'PAUSADO', JSON.stringify(st));
  const workerLoaded = await page.evaluate(() => performance.getEntriesByType('resource').some((r) => /sim\.worker.*\.js/.test(r.name)));
  check('jogo: o arquivo do Worker foi carregado do próprio site', workerLoaded);
  check('jogo: parâmetros de URL chegam ao motor (semente 3, grade 64×40, 300 organismos, Etapa 3 desligada)', st.cfg.seed === 3 && st.cfg.w === 64 && st.cfg.h === 40 && st.cfg.pop === 300 && st.cfg.stage3 === false && st.w === 64 && st.h === 40 && st.seed === '3', JSON.stringify(st.cfg));
  check(`jogo: a versão aparece no HUD (v${gameBuild.version} · ${gameBuild.channel === 'experimental' ? 'experimental' : gameBuild.channel})`, st.ver.includes('v' + gameBuild.version), st.ver);
  check('jogo: o título da página é "GS Evolução"', /GS Evolução/.test(st.title));
  check('jogo: sem erros no console e sem arquivos faltando', errors.length === 0 && failed.length === 0, [...errors, ...failed].slice(0, 3).join(' | '));
  // sobre
  await page.click('#h-ver');
  await page.waitForSelector('#dlg-about[open]');
  const about = await page.evaluate(() => document.getElementById('ab-kv').textContent);
  check('jogo: diálogo Sobre mostra versão, canal e commit', about.includes(gameBuild.version) && about.includes('experimental') && about.includes(gameBuild.commit.replace('+local', '')), about.slice(0, 120));
  const home = await page.evaluate(() => document.getElementById('ab-home').href);
  check('jogo: o diálogo Sobre leva de volta à página de versões', home === BASE, home);
  await page.keyboard.press('Escape');
  await context.close();
}

// ============================================================ jogo (celular emulado: toque, controles, grades)
{
  const { page, context, errors, failed } = await openPage(BASE + 'jogo/?seed=3&size=64x40&pop=300&stage3=0&speed=1', { ...devices['Pixel 7'] });
  await sleep(1500);
  let t0 = await tick(page);
  await page.tap('#b-play'); // pausa por toque
  await sleep(1200); const t1 = await tick(page); await sleep(1500); const t2 = await tick(page);
  check('celular (toque): pausar para o tempo', t2 === t1 && t1 >= t0, `${t0} → ${t1} → ${t2}`);
  await page.tap('#b-play'); await sleep(1800); const t3 = await tick(page);
  check('celular (toque): retomar faz o tempo avançar', t3 > t2 + 5, `${t2} → ${t3}`);
  const rate = async (sp) => { await page.selectOption('#speed-sel', String(sp)); await sleep(1500); const a = await tick(page); await sleep(6000); const b = await tick(page); return (b - a) / 6; }; // janela longa: no celular as estatísticas chegam a cada ~1 s
  const r1 = await rate(1), r5 = await rate(5);
  // em CI (runners lentos e variáveis) a razão de velocidades é só registrada; localmente e contra o endereço público é exigida
  check('celular: alterar a velocidade (1× → 5×) acelera a simulação ≈ 5×', process.env.CI ? r5 > r1 * 1.5 : r5 / r1 > 3.5 && r5 / r1 < 6.5, `1×=${r1.toFixed(1)} t/s · 5×=${r5.toFixed(1)} t/s`);
  // reiniciar pelo menu
  await page.tap('#b-menu'); await page.tap('#b-restart');
  await page.waitForFunction(() => window.__evolvere.stats.tick < 60, null, { timeout: 8000 });
  const tr = await tick(page);
  check('celular: Reiniciar volta ao início (mesma semente)', tr < 60 && (await page.evaluate(() => window.__evolvere.worldCfg.seed)) === 3, `tick ${tr}`);
  // novo mundo com grade maior (128×80) e depois menor (48×30) — sem erros
  await page.tap('#b-menu'); await page.tap('#b-new');
  await page.fill('#in-seed', '9'); await page.selectOption('#in-size', '128x80'); await page.tap('#new-ok');
  await page.waitForFunction(() => window.__evolvere.renderer.w === 128 && window.__evolvere.stats.tick < 100 && window.__evolvere.renderer.frame?.n > 0, null, { timeout: 25000 });
  const big = await page.evaluate(() => ({ w: window.__evolvere.renderer.w, h: window.__evolvere.renderer.h, n: window.__evolvere.renderer.frame.n, seed: document.getElementById('h-seed').textContent }));
  check('celular: carregar um mundo de grade diferente (128×80) funciona', big.w === 128 && big.h === 80 && big.n > 0 && big.seed === '9', JSON.stringify(big));
  await page.tap('#b-menu'); await page.tap('#b-new');
  await page.selectOption('#in-size', '64x40'); await page.tap('#new-ok');
  await page.waitForFunction(() => window.__evolvere.renderer.w === 64 && window.__evolvere.renderer.frame?.n > 0, null, { timeout: 25000 });
  check('celular: voltar para uma grade menor (64×40) funciona', true);
  // toque num organismo seleciona
  await page.tap('#mnav [data-m="map"]');
  await sleep(1200);
  check('celular: sem erros no console e sem arquivos faltando', errors.length === 0 && failed.length === 0, [...errors, ...failed].slice(0, 3).join(' | '));
  await context.close();
}

// ============================================================ PWA
{
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + 'jogo/?seed=3&size=64x40&pop=300&stage3=0');
  await page.waitForFunction(() => window.__evolvere?.stats, null, { timeout: 25000 });
  const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return { url: l.href, status: r.status, ct: r.headers.get('content-type'), json: await r.json() }; });
  const m = man.json;
  check('PWA: manifesto válido (nome GS Evolução, standalone, escopo e start_url relativos)', man.status === 200 && m.name === 'GS Evolução' && m.short_name === 'GS Evolução' && m.display === 'standalone' && m.scope === './' && m.start_url.startsWith('./'), `${m.name} / ${m.display} / ${m.start_url}`);
  const iconRes = await Promise.all(m.icons.map(async (i) => { const r = await fetch(new URL(i.src, man.url)); return { src: i.src, ok: r.status === 200, purpose: i.purpose, sizes: i.sizes }; }));
  check('PWA: ícones 192, 512 e maskable existem', iconRes.every((i) => i.ok) && iconRes.some((i) => i.sizes === '192x192') && iconRes.some((i) => i.sizes === '512x512' && i.purpose === 'any') && iconRes.some((i) => i.purpose === 'maskable'), iconRes.map((i) => i.src + ':' + (i.ok ? 'ok' : 'FALTA')).join(' '));
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
  await page.reload();
  await page.waitForFunction(() => window.__evolvere?.stats && navigator.serviceWorker.controller, null, { timeout: 25000 });
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r.scope, active: !!r.active, caches: (await caches.keys()).filter((k) => k.startsWith('gs-evolucao::')), state: r.active?.state }; });
  check('PWA: service worker ativo e controlando a página, com escopo da pasta do jogo', sw.active && sw.scope === BASE + 'jogo/' && sw.caches.length === 1, JSON.stringify(sw));
  const cdp = await context.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  check('PWA: o Chrome não aponta nenhum erro de instalabilidade', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
  // offline
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__evolvere?.stats?.tick >= 0 && window.__evolvere.renderer.frame, null, { timeout: 25000 });
  await sleep(2500);
  const off = await page.evaluate(async () => {
    // prova de que a rede está mesmo fora do ar: um arquivo que NÃO está no cache precisa falhar
    const netDown = await fetch('versions.json?nocache=' + Date.now(), { cache: 'no-store' }).then(() => false, () => true);
    return { netDown, tick: window.__evolvere.stats.tick, ver: document.getElementById('h-ver').textContent, controlled: !!navigator.serviceWorker.controller };
  });
  check('PWA: sem internet o jogo abre do cache e a simulação roda (Worker incluído)', off.netDown && off.controlled && off.tick > 0, JSON.stringify(off));
  await context.setOffline(false);
  check('PWA: sem erros de JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

// ============================================================ versões arquivadas
for (const v of reg.versions.filter((x) => x.id !== reg.current && x.available !== false)) {
  const url = BASE + (v.url ?? `v/${v.id}/`);
  const { page, context, errors, failed } = await openPage(url + '?seed=3', { viewport: { width: 1280, height: 800 } }, false);
  await page.waitForSelector('canvas#map', { timeout: 15000 }).catch(() => {});
  const ok = await page.waitForFunction(() => window.__evolvere?.stats?.tick > 0 || document.querySelector('#r-pop')?.textContent !== '—', null, { timeout: 25000 }).then(() => true).catch(() => false);
  const badge = await page.evaluate(() => (document.querySelector('[role=note]')?.textContent || '') + (document.getElementById('h-ver')?.textContent || ''));
  check(`versão arquivada v${v.id}: abre, o Worker responde e a versão é identificável`, ok && badge.includes(v.id), `${badge.slice(0, 70)}`);
  check(`versão arquivada v${v.id}: sem erros de JavaScript nem arquivos faltando`, errors.length === 0 && failed.length === 0, [...errors, ...failed].slice(0, 2).join(' | '));
  await context.close();
}

await browser.close();
server?.close();
const failedN = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedN.length}/${results.length} verificações passaram`);
process.exit(failedN.length ? 1 : 0);
