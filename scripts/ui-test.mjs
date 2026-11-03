// Teste de interface (responsividade, toque, desempenho) em emulação de dispositivos.
// Requer um servidor em PREVIEW_URL (npm run build && npx vite preview --port 4173) e o pacote playwright
// (já presente globalmente no ambiente; ou `npm i -D playwright`).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium, devices } = pw;
const URL_ = process.env.PREVIEW_URL || 'http://localhost:4173/';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function open(browser, label, ctxOpts) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__evolvere?.stats?.tick > 0, null, { timeout: 15000 });
  return { page, context, errors, label };
}

const noOverflow = async (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
const rect = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vis: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' }; });

async function pinch(page, cx, cy, d0, d1) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const browser = await chromium.launch();

// ---------- celulares / tablet (toque)
for (const name of ['Pixel 7', 'Pixel 7 landscape', 'Galaxy S9+']) {
  const dev = devices[name];
  const { page, context, errors } = await open(browser, name, { ...dev });
  const vp = page.viewportSize();
  const tag = `[${name} ${vp.width}x${vp.height}]`;
  const o = await noOverflow(page);
  check(`${tag} sem rolagem horizontal`, o.sw <= o.iw + 1, `scrollWidth=${o.sw} innerWidth=${o.iw}`);
  check(`${tag} sem rolagem vertical da página`, o.sh <= o.ih + 1, `scrollHeight=${o.sh} innerHeight=${o.ih}`);
  check(`${tag} modo mobile ativo`, await page.evaluate(() => window.__evolvere.isMobile));
  for (const sel of ['#b-play', '#speed-sel', '#b-menu', '#mnav button[data-m=side]', '#mnav button[data-m=bottom]', '#mnav button[data-m=tools]', '#mnav button[data-m=layers]', '#z-in', '#z-out']) {
    const r = await rect(page, sel);
    check(`${tag} ${sel} visível e ≥40px (toque)`, r.vis && r.w >= 40 && r.h >= 40, `${r.w.toFixed(0)}x${r.h.toFixed(0)}`);
  }
  // indicadores do cabeçalho não podem se sobrepor
  const overlaps = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#top .readouts > div, #top .controls > *, #top #b-menu, #top .brand')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const rs = els.map((e) => e.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++;
    }
    return n;
  });
  check(`${tag} cabeçalho sem elementos sobrepostos`, overlaps === 0, `${overlaps} sobreposições`);
  // abrir/fechar folhas
  await page.tap('#mnav button[data-m=side]');
  await page.waitForTimeout(450);
  check(`${tag} folha "Dados" abre`, await page.evaluate(() => window.__evolvere.sheet === 'side') && (await rect(page, '#side')).vis);
  const sideR = await rect(page, '#side');
  if (vp.height > vp.width) {
    const st = await rect(page, '#stage');
    check(`${tag} mapa continua visível acima da folha`, st.h >= 120 && st.y + st.h <= sideR.y + 2, `mapa ${st.h | 0}px de altura, termina em ${(st.y + st.h) | 0}, folha começa em ${sideR.y | 0}`);
  }
  check(`${tag} folha cabe na tela`, sideR.x >= -1 && sideR.x + sideR.w <= vp.width + 1 && sideR.y >= 0 && sideR.y + sideR.h <= vp.height + 1, JSON.stringify({ x: sideR.x | 0, y: sideR.y | 0, w: sideR.w | 0, h: sideR.h | 0 }));
  await page.tap('#side-tabs [data-tab=ai]');
  await page.waitForTimeout(300);
  check(`${tag} aba IA acessível por toque`, await page.$eval('#pane-ai', (e) => e.classList.contains('on')));
  await page.tap('#side .sheet-x');
  await page.waitForTimeout(400);
  check(`${tag} folha fecha`, await page.evaluate(() => window.__evolvere.sheet === null));
  await page.tap('#mnav button[data-m=bottom]');
  await page.waitForTimeout(500);
  const bR = await rect(page, '#bottom');
  check(`${tag} folha "Gráficos" abre e cabe`, bR.vis && bR.y >= 0 && bR.y + bR.h <= vp.height + 1);
  await page.tap('#mnav button[data-m=map]');
  await page.waitForTimeout(400);
  // ferramentas e camadas
  await page.tap('#mnav button[data-m=tools]');
  check(`${tag} ferramentas aparecem`, (await rect(page, '#tools')).vis);
  const toolBtn = await rect(page, '#trow button');
  check(`${tag} botões de ferramenta ≥40px`, toolBtn.h >= 40, `${toolBtn.h | 0}px`);
  await page.tap('#mnav button[data-m=layers]');
  check(`${tag} camadas aparecem`, (await rect(page, '#layers')).vis);
  await page.tap('#layers [data-l=temp]');
  await page.waitForTimeout(500);
  check(`${tag} camada de temperatura troca por toque`, (await page.$eval('#lg-title', (e) => e.textContent)).includes('Temperatura'));
  // Etapa 3: camada de biomas e aba de flora acessíveis por toque
  await page.tap('#layers [data-l=biome]');
  await page.waitForTimeout(500);
  check(`${tag} camada de biomas por toque`, (await page.$eval('#lg-title', (e) => e.textContent)).includes('Biomas'));
  check(`${tag} chips de camadas Etapa 3 ≥40px`, (await rect(page, '#layers [data-l=vegetation]')).h >= 40);
  await page.tap('#mnav button[data-m=side]');
  await page.waitForTimeout(400);
  await page.tap('#side-tabs [data-tab=fl]');
  await page.waitForTimeout(500);
  check(`${tag} aba Flora abre por toque`, await page.$eval('#pane-fl', (e) => e.classList.contains('on')));
  await page.tap('#side .sheet-x');
  await page.waitForTimeout(300);
  await page.tap('#mnav button[data-m=tools]');
  check(`${tag} ferramenta "Semear plano corporal" disponível`, (await rect(page, '#trow [data-t=archetype]')).vis);
  await page.tap('#mnav button[data-m=map]');
  // menu ⋯
  await page.tap('#b-menu');
  check(`${tag} menu ⋯ mostra Salvar/Carregar/Novo/Gráficos`, (await rect(page, '#b-save')).vis && (await rect(page, '#b-gfx')).vis);
  await page.tap('#b-gfx');
  check(`${tag} diálogo de gráficos abre`, await page.$eval('#dlg-gfx', (d) => d.open));
  await page.selectOption('#in-quality', 'low');
  check(`${tag} qualidade baixa aplicada`, (await page.evaluate(() => window.__evolvere.quality)) === 'low');
  await page.keyboard.press('Escape');
  // pausa por seletor
  await page.selectOption('#speed-sel', '5');
  // pinça aumenta o zoom
  const z0 = await page.evaluate(() => window.__evolvere.renderer.zoom);
  const box = await page.$eval('#map', (e) => { const r = e.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
  await pinch(page, box.cx, box.cy, 60, 200);
  await page.waitForTimeout(200);
  const z1 = await page.evaluate(() => window.__evolvere.renderer.zoom);
  check(`${tag} pinça aumenta o zoom`, z1 > z0 * 1.5, `${z0.toFixed(1)} → ${z1.toFixed(1)}`);
  await pinch(page, box.cx, box.cy, 200, 60);
  await page.waitForTimeout(200);
  const z2 = await page.evaluate(() => window.__evolvere.renderer.zoom);
  check(`${tag} pinça inversa reduz o zoom`, z2 < z1 * 0.8, `${z1.toFixed(1)} → ${z2.toFixed(1)}`);
  // arrastar com um dedo move a câmera
  await page.evaluate(() => window.__evolvere.renderer.zoomAt(200, 200, 3));
  const c0 = await page.evaluate(() => [window.__evolvere.renderer.cx, window.__evolvere.renderer.cy]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.cx, y: box.cy }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.cx - i * 12, y: box.cy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  const c1 = await page.evaluate(() => [window.__evolvere.renderer.cx, window.__evolvere.renderer.cy]);
  check(`${tag} arrastar com um dedo move o mapa`, Math.abs(c1[0] - c0[0]) > 0.2, `${c0[0].toFixed(2)} → ${c1[0].toFixed(2)}`);
  // toque em célula vazia mostra dados (substitui hover)
  await page.evaluate(() => window.__evolvere.renderer.fit());
  await page.tap('#map', { position: { x: box.cx - (await page.$eval('#map', (e) => e.getBoundingClientRect().x)), y: box.cy - (await page.$eval('#map', (e) => e.getBoundingClientRect().y)) } });
  await page.waitForTimeout(900);
  const tipShown = await page.$eval('#tip', (e) => !e.hidden);
  const cardShown = await page.evaluate(() => window.__evolvere.sheet === 'side');
  check(`${tag} toque no mapa mostra a célula ou a ficha do organismo (sem hover)`, tipShown || cardShown, tipShown ? 'dados da célula' : 'ficha do organismo');
  check(`${tag} sem erros de console`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

// ---------- desktop
{
  const { page, context, errors } = await open(browser, 'Desktop', { viewport: { width: 1480, height: 900 } });
  const o = await noOverflow(page);
  check('[Desktop 1480x900] sem rolagem horizontal', o.sw <= o.iw + 1);
  check('[Desktop] não está em modo mobile', !(await page.evaluate(() => window.__evolvere.isMobile)));
  check('[Desktop] painel lateral e gráficos visíveis', (await rect(page, '#side')).vis && (await rect(page, '#bottom')).vis);
  check('[Desktop] barra de navegação mobile oculta', !(await rect(page, '#mnav')).vis);
  await page.hover('#map');
  await page.mouse.move(700, 400);
  await page.waitForTimeout(700);
  check('[Desktop] hover mostra dados da célula', await page.$eval('#tip', (e) => !e.hidden));
  check('[Desktop] sem erros de console', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}
// ---------- tablet retrato (largura 820 → modo folhas)
{
  const { page, context, errors } = await open(browser, 'iPad', { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  const o = await noOverflow(page);
  check('[Tablet 820x1180] sem rolagem horizontal', o.sw <= o.iw + 1);
  check('[Tablet] sem erros de console', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

// ---------- desempenho (celular emulado, CPU 4× mais lenta, simulação a 30×)
{
  const { page, context } = await open(browser, 'perf', { ...devices['Pixel 7'] });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
    window.__frames = 0;
    const f = () => { window.__frames++; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await page.selectOption('#speed-sel', '30');
  const tick0 = await page.evaluate(() => window.__evolvere.stats.tick);
  await page.waitForTimeout(12000);
  const r = await page.evaluate(() => ({ long: window.__long, frames: window.__frames, tick: window.__evolvere.stats.tick, pop: window.__evolvere.stats.pop, q: window.__evolvere.quality }));
  const worst = Math.max(0, ...r.long);
  const fps = r.frames / 12;
  console.log(`INFO  perf (Pixel 7 emulado, CPU 4× mais lenta, 30×): qualidade=${r.q} fps(rAF)=${fps.toFixed(0)} ticks/s=${((r.tick - tick0) / 12).toFixed(0)} pop=${r.pop} tarefas longas=${r.long.length} pior=${worst.toFixed(0)}ms`);
  check('[perf] thread principal sem travamento (>500ms)', worst < 500, `pior tarefa ${worst.toFixed(0)} ms`);
  check('[perf] a interface continua respondendo (≥ 10 fps)', fps >= 10, `${fps.toFixed(0)} fps`);
  check('[perf] a simulação avança em segundo plano da UI', r.tick - tick0 > 100, `${r.tick - tick0} ticks em 12 s`);
  // pausa/retomada responde
  await page.tap('#b-play');
  await page.waitForTimeout(2500); // deixa chegar o último pacote de estatísticas em trânsito
  const t1 = await page.evaluate(() => window.__evolvere.stats.tick);
  await page.waitForTimeout(2500);
  const t2 = await page.evaluate(() => window.__evolvere.stats.tick);
  check('[perf] pausar para a simulação', t2 - t1 === 0, `${t2 - t1} ticks após pausa`);
  await page.tap('#b-play');
  await page.waitForTimeout(1500);
  const t3 = await page.evaluate(() => window.__evolvere.stats.tick);
  check('[perf] retomar volta a avançar', t3 - t2 > 20, `${t3 - t2} ticks`);
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`);
process.exit(failed.length ? 1 : 0);
