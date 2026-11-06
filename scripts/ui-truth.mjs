// Etapa 6 — a interface mostra o MOTOR REAL? Compara o que o navegador exibe com uma execução independente do mesmo motor em Node.
// Requer: `npm run build && npx vite preview --port 4173` (ou PREVIEW_URL) e o pacote playwright (global).
//   node scripts/ui-truth.mjs
// Verifica: inicialização, fidelidade (população, espécies, biomassa, contagens por espécie, posição/espécie de CADA organismo desenhado),
// controles (pausar, continuar, passo, velocidade, reiniciar, novo mundo), seleção (ficha = dados do motor), série por espécie e
// que a velocidade/qualidade/tamanho de tela não alteram o estado (determinismo).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execFileSync('npm', ['root', '-g']).toString().trim() + '/playwright'); }
const { chromium, devices } = pw;
const URL_ = process.env.PREVIEW_URL || 'http://localhost:4173/';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** estado da referência: o mesmo Simulation, em Node, sem interface */
function reference(cfg, ticks) {
  const out = execFileSync('npx', ['tsx', 'scripts/ui-reference.ts', JSON.stringify(cfg), ticks.join(',')], { maxBuffer: 1 << 28 }).toString();
  return JSON.parse(out);
}
const uiCfg = (seed, w, h, pop, stage3, ecology) => ({ seed, width: w, height: h, initialPopulation: pop, maxOrganisms: w * h * 9, stage3, ecology, maxPlants: Math.round(w * h * 2.2) });
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const refHash = (orgs) => fnv(orgs.map((o) => `${o[0]}|${o[1]}|${o[2]}`).sort().join(';'));

/** lê o estado exibido (stats + quadro desenhado) */
const readUI = (page) => page.evaluate(() => {
  const e = window.__evolvere, st = e.stats, f = e.renderer.frame;
  const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  const trip = [];
  if (f) for (let i = 0; i < f.n; i++) trip.push(`${f.x[i]}|${f.y[i]}|${f.sp[i]}`);
  return {
    tick: st.tick, pop: st.pop, speciesAlive: st.speciesAlive, speciesTotal: st.speciesTotal, massOrganisms: st.mass.organisms,
    counts: st.species.map((s) => [s.id, s.count]), frameTick: f ? f.tick : -1, frameN: f ? f.n : -1, frameHash: f ? fnv(trip.sort().join(';')) : '',
    hud: { seed: document.getElementById('h-seed').textContent, pop: document.getElementById('h-pop').textContent, sp: document.getElementById('h-sp').textContent, state: document.getElementById('h-state').textContent, tick: document.getElementById('h-tick').textContent },
  };
});
const waitTick = (page, t, timeout = 20000) => page.waitForFunction((t) => { const e = window.__evolvere; return e?.stats?.tick === t && e.renderer.frame?.tick === t; }, t, { timeout });
const clickStep = async (page, n) => { for (let i = 0; i < n; i++) await page.click('#b-step'); };
const sameCounts = (a, b) => { const A = a.filter((c) => c[1] > 0).map((c) => c.join(':')).join(','), B = b.filter((c) => c[1] > 0).map((c) => c.join(':')).join(','); return A === B; };

async function openPage(browser, query, ctxOpts = { viewport: { width: 1480, height: 900 } }) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL_ + query);
  await page.waitForFunction(() => window.__evolvere?.stats && window.__evolvere.renderer.frame, null, { timeout: 20000 });
  return { page, context, errors };
}

const browser = await chromium.launch();

// ======================================================= caso A: mundo padrão (Etapa 1/2), pausado desde o tick 0
{
  const L = 'A (mundo padrão 64×40, semente 3)';
  const cfg = uiCfg(3, 64, 40, 300, false, false);
  const ref = reference(cfg, [0, 250, 500]);
  const { page, context, errors } = await openPage(browser, '?seed=3&size=64x40&pop=300&stage3=0&paused=1');
  await waitTick(page, 0);
  let ui = await readUI(page);
  check(`[${L}] inicializa pausado no tick 0 com a semente pedida`, ui.tick === 0 && ui.hud.seed === '3' && ui.hud.state === 'PAUSADO', JSON.stringify(ui.hud));
  const cmp = (t, ui) => {
    const r = ref[t];
    check(`[${L}] tick ${t}: população, espécies e biomassa = motor`, ui.tick === t && ui.pop === r.pop && ui.speciesAlive === r.speciesAlive && Math.abs(ui.massOrganisms - r.massOrganisms) < 1e-9, `UI pop=${ui.pop} sp=${ui.speciesAlive} m=${ui.massOrganisms.toFixed(3)} | motor pop=${r.pop} sp=${r.speciesAlive} m=${r.massOrganisms.toFixed(3)}`);
    check(`[${L}] tick ${t}: contagem por espécie = motor`, sameCounts(ui.counts, r.counts));
    check(`[${L}] tick ${t}: os ${ui.frameN} organismos DESENHADOS são exatamente os do motor (posição e espécie de cada um)`, ui.frameN === r.pop && ui.frameHash === refHash(r.orgs), `quadro n=${ui.frameN} hash=${ui.frameHash} | motor n=${r.pop} hash=${refHash(r.orgs)}`);
    check(`[${L}] tick ${t}: o HUD exibe os mesmos números`, ui.hud.pop === (ui.pop >= 1e4 ? (ui.pop / 1e3).toFixed(0) + 'k' : ui.pop >= 1e3 ? (ui.pop / 1e3).toFixed(1) + 'k' : ui.pop >= 100 ? ui.pop.toFixed(0) : ui.pop >= 10 ? ui.pop.toFixed(1) : ui.pop.toFixed(2)) && ui.hud.tick === `tick ${t}`, JSON.stringify(ui.hud));
  };
  cmp(0, ui);
  await clickStep(page, 10); await waitTick(page, 250); ui = await readUI(page); cmp(250, ui);
  await clickStep(page, 10); await waitTick(page, 500); ui = await readUI(page); cmp(500, ui);

  // série por espécie: amostras reais
  const series = await page.evaluate(() => { const p = window.__evolvere.popSeries; return { ticks: p.ticks, data: [...p.data.entries()] }; });
  const i250 = series.ticks.indexOf(250), i500 = series.ticks.indexOf(500);
  check(`[${L}] série de população por espécie: amostras reais nos ticks 250 e 500`, i250 >= 0 && i500 >= 0 && series.data.every(([id, a]) => a.length === series.ticks.length), `ticks=${series.ticks.length}`);
  const okSeries = i250 >= 0 && i500 >= 0 && [250, 500].every((t) => { const i = series.ticks.indexOf(t); return ref[t].counts.every(([id, c]) => (series.data.find((d) => d[0] === id)?.[1][i] ?? 0) === c); });
  check(`[${L}] série por espécie = contagens do motor`, okSeries);

  // seleção de um organismo: a ficha mostra os dados reais
  const pick = await page.evaluate(() => { const e = window.__evolvere, f = e.renderer.frame, k = Math.floor(f.n / 2); const [sx, sy] = e.renderer.worldToScreen(f.x[k], f.y[k]); const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x + sx, y: r.y + sy }; });
  await page.mouse.click(pick.x, pick.y);
  await page.waitForFunction(() => /Organismo #\d+/.test(document.getElementById('pane-sp').textContent), null, { timeout: 8000 }).catch(() => {});
  const card = await page.evaluate(() => {
    const t = document.getElementById('pane-sp').textContent;
    const id = Number((t.match(/Organismo #(\d+)/) || [])[1]);
    const kv = (label) => { const spans = [...document.querySelectorAll('#pane-sp .kv span')]; const i = spans.findIndex((s) => s.textContent === label); return i >= 0 ? spans[i + 1].textContent : null; };
    const name = document.querySelector('#pane-sp .card .muted')?.textContent ?? '';
    return { id, name, gen: kv('Geração'), age: kv('Idade'), mass: kv('Massa'), energy: kv('Energia') };
  });
  const o = ref[500].orgs.find((q) => q[3] === card.id);
  check(`[${L}] seleção: a ficha do organismo #${card.id} corresponde ao organismo real do motor`, !!o && o[8] === card.name && String(o[7]) === card.gen && card.mass === o[4].toFixed(2) && card.energy === o[5].toFixed(2) && card.age?.startsWith(`${o[6]} /`), JSON.stringify(card) + ' | motor ' + JSON.stringify(o ? { name: o[8], gen: o[7], age: o[6], mass: +o[4].toFixed(2), energy: +o[5].toFixed(2) } : null));

  // ---------- controles
  const tickNow = () => page.evaluate(() => window.__evolvere.stats.tick);
  let t0 = await tickNow();
  await page.click('#b-step'); await sleep(600); let t1 = await tickNow();
  check(`[${L}] passo: avança exatamente 25 ticks e permanece pausado`, t1 - t0 === 25, `${t0} → ${t1}`);
  await sleep(1500); const t1b = await tickNow();
  check(`[${L}] pausado: o tempo não corre`, t1b === t1, `${t1} → ${t1b}`);
  await page.click('#b-play'); await sleep(2200); const t2 = await tickNow();
  check(`[${L}] continuar: os ticks voltam a avançar`, t2 > t1 + 20, `${t1} → ${t2}`);
  const rate = async (speed) => { await page.click(`#speeds button[data-s="${speed}"]`); await sleep(900); const a = await tickNow(); await sleep(2500); const b = await tickNow(); return (b - a) / 2.5; };
  const r1 = await rate(1), r5 = await rate(5), rh = await rate(0.5);
  check(`[${L}] velocidade: 1× ≈ 20 t/s, 5× ≈ 5× mais rápido, ½× ≈ metade`, r5 / r1 > 3.4 && r5 / r1 < 6.6 && rh / r1 > 0.35 && rh / r1 < 0.7, `½×=${rh.toFixed(1)} 1×=${r1.toFixed(1)} 5×=${r5.toFixed(1)} t/s`);
  await page.click('#b-play'); await sleep(600);
  // reiniciar (mesma semente/configuração) -> tick 0 e estado idêntico ao inicial
  await page.click('#b-menu', { timeout: 500 }).catch(() => {});
  await page.click('#b-restart');
  await waitTick(page, 0);
  ui = await readUI(page);
  check(`[${L}] reiniciar: volta ao tick 0 e recria exatamente o mesmo mundo (mesma semente)`, ui.tick === 0 && ui.pop === ref[0].pop && ui.frameHash === refHash(ref[0].orgs) && ui.hud.seed === '3', `pop=${ui.pop} hash=${ui.frameHash}`);
  // novo mundo com outra semente pelo diálogo
  await page.click('#b-new'); await page.fill('#in-seed', '7'); await page.click('#new-ok');
  const ref7 = reference(uiCfg(7, 96, 60, 700, true, false), [0]);
  await page.waitForFunction(() => window.__evolvere.stats.tick === 0 && document.getElementById('h-seed').textContent === '7' && window.__evolvere.renderer.frame?.tick === 0, null, { timeout: 15000 });
  ui = await readUI(page);
  check(`[${L}] novo planeta (semente 7, Etapa 3, 96×60): população e organismos = motor`, ui.pop === ref7[0].pop && ui.frameHash === refHash(ref7[0].orgs), `pop=${ui.pop}/${ref7[0].pop}`);
  check(`[${L}] sem erros no console`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

// ======================================================= caso B: Etapa 3 + ecologia (Etapa 5), pausado
{
  const L = 'B (continentes + ecologia 48×30, semente 5)';
  const cfg = uiCfg(5, 48, 30, 300, true, true);
  const ref = reference(cfg, [0, 300]);
  const { page, context, errors } = await openPage(browser, '?seed=5&size=48x30&pop=300&stage3=1&ecology=1&paused=1');
  await waitTick(page, 0);
  await clickStep(page, 12); await waitTick(page, 300);
  const ui = await readUI(page);
  const r = ref[300];
  check(`[${L}] tick 300: população, espécies, biomassa e organismos desenhados = motor`, ui.pop === r.pop && ui.speciesAlive === r.speciesAlive && Math.abs(ui.massOrganisms - r.massOrganisms) < 1e-9 && ui.frameHash === refHash(r.orgs) && sameCounts(ui.counts, r.counts), `pop ${ui.pop}/${r.pop}`);
  const wc = await page.evaluate(() => window.__evolvere.worldCfg);
  check(`[${L}] a opção "ecologia" chega ao motor (cfg.ecology)`, wc.ecology === true && wc.stage3 === true);
  check(`[${L}] sem erros no console`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

// ======================================================= caso C: determinismo — a velocidade, a qualidade e a tela não mudam o estado
{
  const L = 'C (30×, celular emulado)';
  const { page, context, errors } = await openPage(browser, '?seed=3&size=64x40&pop=300&stage3=0&speed=30', { ...devices['Pixel 7'] });
  await page.waitForFunction(() => window.__evolvere.stats.tick >= 900, null, { timeout: 60000 });
  await page.click('#b-play'); // pausa onde estiver
  await sleep(1500);
  const T = await page.evaluate(() => window.__evolvere.stats.tick);
  await page.waitForFunction((T) => window.__evolvere.renderer.frame?.tick === T, T, { timeout: 8000 }).catch(() => {});
  const ui = await readUI(page);
  const ref = reference(uiCfg(3, 64, 40, 300, false, false), [T]);
  const r = ref[T];
  check(`[${L}] parou no tick ${T} (qualquer um) e o estado é idêntico ao do motor isolado em ${T} ticks`, ui.tick === T && ui.pop === r.pop && ui.speciesAlive === r.speciesAlive && Math.abs(ui.massOrganisms - r.massOrganisms) < 1e-9 && sameCounts(ui.counts, r.counts), `pop ${ui.pop}/${r.pop}`);
  check(`[${L}] os organismos desenhados nesse instante = motor`, ui.frameTick === T && ui.frameHash === refHash(r.orgs), `quadro tick=${ui.frameTick}`);
  const hud = await page.evaluate(() => ({ visible: document.getElementById('hud').getBoundingClientRect().width > 0, seed: document.getElementById('h-seed').textContent, over: document.documentElement.scrollWidth > innerWidth }));
  check(`[${L}] HUD visível no celular, com a semente, sem rolagem horizontal`, hud.visible && hud.seed === '3' && !hud.over, JSON.stringify(hud));
  check(`[${L}] sem erros no console`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`);
process.exit(failed.length ? 1 : 0);
