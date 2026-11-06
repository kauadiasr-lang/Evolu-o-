// Etapa 6 — execução visual prolongada: detecta travamentos, vazamento de memória e perda de fidelidade com a interface sob carga.
//   node scripts/ui-soak.mjs [segundos=150]
// Roda 2 perfis (desktop com CPU 2× mais lenta; celular emulado com CPU 4× mais lenta), amostra a cada 5 s e, ao final,
// pausa e compara o estado exibido com o motor isolado no MESMO tick (determinismo sob carga).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execFileSync('npm', ['root', '-g']).toString().trim() + '/playwright'); }
const { chromium, devices } = pw;
const URL_ = process.env.PREVIEW_URL || 'http://localhost:4173/';
const SECONDS = Number(process.argv[2] || 150);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const uiCfg = (seed, w, h, pop, stage3, ecology) => ({ seed, width: w, height: h, initialPopulation: pop, maxOrganisms: w * h * 9, stage3, ecology, maxPlants: Math.round(w * h * 2.2) });

const profiles = [
  { name: 'desktop 1480×900, CPU 2× mais lenta, 5×', ctx: { viewport: { width: 1480, height: 900 } }, cpu: 2, query: '?seed=3&size=64x40&pop=300&stage3=0&speed=5', cfg: uiCfg(3, 64, 40, 300, false, false) },
  { name: 'Pixel 7 emulado, CPU 4× mais lenta, 5×', ctx: { ...devices['Pixel 7'] }, cpu: 4, query: '?seed=5&size=64x40&pop=300&stage3=1&ecology=1&speed=5', cfg: uiCfg(5, 64, 40, 300, true, true) },
];

const browser = await chromium.launch();
for (const pr of profiles) {
  const context = await browser.newContext(pr.ctx);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: pr.cpu });
  await cdp.send('Performance.enable');
  await page.addInitScript(() => {
    window.__soak = { frames: 0, gaps: [], longTasks: [], last: 0 };
    const loop = (t) => { const s = window.__soak; if (s.last) s.gaps.push(t - s.last); s.last = t; s.frames++; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__soak.longTasks.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch {}
  });
  await page.goto(URL_ + pr.query);
  await page.waitForFunction(() => window.__evolvere?.stats?.tick > 0, null, { timeout: 30000 });
  const heap = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1e6;
  const samples = [];
  const t0 = Date.now();
  let lastTick = 0;
  while ((Date.now() - t0) / 1000 < SECONDS) {
    await sleep(5000);
    // exercita a interface durante a execução: troca de aba e de camada (renderização de painéis/gráficos sob carga)
    const step = samples.length;
    await page.evaluate((k) => {
      const tabs = ['tl', 'spop', 'tree', 'web'], b = document.querySelector(`#bot-tabs [data-tab="${tabs[k % 4]}"]`); b && b.click();
      const layers = ['ocean', 'temp', 'nutrient', 'density']; const l = document.querySelector(`#layers [data-l="${layers[k % 4]}"]`); l && l.click();
    }, step);
    const s = await page.evaluate(() => { const e = window.__evolvere, z = window.__soak; return { tick: e.stats.tick, pop: e.stats.pop, sp: e.stats.speciesAlive, tps: e.renderer.frame ? e.renderer.frame.tps : 0, frames: z.frames, quality: e.quality }; });
    s.heap = await heap();
    s.t = (Date.now() - t0) / 1000;
    samples.push(s);
    lastTick = s.tick;
  }
  const z = await page.evaluate(() => ({ frames: window.__soak.frames, gaps: window.__soak.gaps, longTasks: window.__soak.longTasks }));
  const secs = (Date.now() - t0) / 1000;
  const gaps = [...z.gaps].sort((a, b) => a - b);
  const p95 = gaps[Math.floor(gaps.length * 0.95)] ?? 0, worst = gaps[gaps.length - 1] ?? 0;
  const lt = z.longTasks;
  const worstLt = Math.max(0, ...lt);
  console.log(`\n== ${pr.name}: ${secs.toFixed(0)} s, qualidade final ${samples.at(-1).quality}`);
  console.log('   t(s)  tick     pop   esp  t/s   heap(MB)');
  samples.forEach((s, i) => { if (i % 3 === 0 || i === samples.length - 1) console.log(`   ${s.t.toFixed(0).padStart(4)} ${String(s.tick).padStart(6)} ${String(s.pop).padStart(7)} ${String(s.sp).padStart(4)} ${s.tps.toFixed(0).padStart(4)}  ${s.heap.toFixed(1)}`); });
  console.log(`   quadros: ${(z.frames / secs).toFixed(1)} fps médios · intervalo p95 ${p95.toFixed(0)} ms · pior ${worst.toFixed(0)} ms · tarefas longas (>50 ms): ${lt.length}, pior ${worstLt.toFixed(0)} ms`);
  check(`[${pr.name}] a simulação avançou o tempo todo (ticks crescentes)`, samples.every((s, i) => i === 0 || s.tick > samples[i - 1].tick), `${samples[0].tick} → ${lastTick}`);
  check(`[${pr.name}] a interface não travou (nenhum quadro > 1,5 s, nenhuma tarefa longa > 1 s)`, worst < 1500 && worstLt < 1000, `pior quadro ${worst.toFixed(0)} ms, pior tarefa ${worstLt.toFixed(0)} ms`);
  const h0 = samples[Math.min(2, samples.length - 1)].heap, h1 = samples.at(-1).heap;
  check(`[${pr.name}] memória do JS estável (sem crescimento > 60% da 2ª amostra ao fim)`, h1 < h0 * 1.6 + 20, `${h0.toFixed(1)} → ${h1.toFixed(1)} MB`);
  check(`[${pr.name}] sem erros no console`, errors.length === 0, errors.slice(0, 2).join(' | '));

  // fidelidade sob carga: pausa e compara com o motor isolado no MESMO tick
  await page.click('#b-play');
  await sleep(2500);
  const fin = await page.evaluate(() => { const e = window.__evolvere, f = e.renderer.frame, st = e.stats; const trip = []; for (let i = 0; i < f.n; i++) trip.push(`${f.x[i]}|${f.y[i]}|${f.sp[i]}`); return { tick: st.tick, frameTick: f.tick, pop: st.pop, sp: st.speciesAlive, mass: st.mass.organisms, counts: st.species.map((s) => [s.id, s.count]), trip: trip.sort().join(';') }; });
  console.log(`   parou no tick ${fin.tick}; calculando o motor isolado até esse tick…`);
  let ref = JSON.parse(execFileSync('npx', ['tsx', 'scripts/ui-reference.ts', JSON.stringify(pr.cfg), `0,${fin.tick}`], { maxBuffer: 1 << 29 }).toString());
  const ref0 = ref[0];
  ref = ref[fin.tick];
  const refTrip = fnv(ref.orgs.map((o) => `${o[0]}|${o[1]}|${o[2]}`).sort().join(';'));
  check(`[${pr.name}] após ${secs.toFixed(0)} s sob carga: população, espécies e biomassa = motor isolado (${fin.tick} ticks)`, fin.pop === ref.pop && fin.sp === ref.speciesAlive && Math.abs(fin.mass - ref.massOrganisms) < 1e-6, `UI pop=${fin.pop} | motor pop=${ref.pop}; biomassa ${fin.mass.toFixed(4)} | ${ref.massOrganisms.toFixed(4)}`);
  check(`[${pr.name}] os organismos desenhados = motor (posição e espécie de cada um)`, fin.frameTick === fin.tick && fnv(fin.trip) === refTrip, `quadro tick ${fin.frameTick}`);
  check(`[${pr.name}] massa total do planeta conservada no motor isolado (tick 0 → ${fin.tick})`, Math.abs(ref.totalMass - ref0.totalMass) / ref0.totalMass < 1e-9, `${ref0.totalMass.toFixed(3)} → ${ref.totalMass.toFixed(3)}`);
  await context.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`);
process.exit(failed.length ? 1 : 0);
