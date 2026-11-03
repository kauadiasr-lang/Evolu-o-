/// <reference lib="webworker" />
import { GENE_COUNT, GENE_INFO } from '../core/genome';
import { develop } from '../core/phenotype';
import { computeTerrain } from '../core/biomes';
import { FORMS, PG, PLANT_GENES, maxHeight, plantForm, HK } from '../core/flora';
import { computeLayer, LayerKind } from '../core/layers';
import { exportSave, importSave } from '../core/serialize';
import { Simulation } from '../core/simulation';
import { takeSnapshot, visFromGenes, VIS } from '../core/snapshot';
import { T, TR } from '../core/traits';
import { EcoEventManager } from '../core/events';
import type { CellInfo, FromWorker, InspectInfo, PlantInfo, ToWorker } from './protocol';
import { buildStats, plantVis, structuresOf } from './summary';

const BASE_TPS = 20; // ticks por segundo a 1×
let sim: Simulation | null = null;
let manager = new EcoEventManager();
// parâmetros de desempenho (ajustados pela UI conforme o dispositivo)
let frameMs = 33;
let statsMs = 400;
let budgetMs = 16;
let visible = true;
let terrainTick = 0;
let speed = 1;
let acc = 0;
let last = performance.now();
let lastFrame = 0;
let lastStats = 0;
let inflight = 0;
let layer: LayerKind = 'ocean';
let layerSpecies = 0;
let dirty = true;
let tpsMeasured = 0;
let tpsWindowTicks = 0;
let tpsWindowStart = performance.now();
const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(m: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(m, transfer);
}

function sendFrame() {
  if (!sim) return;
  const snap = takeSnapshot(sim);
  const fs = sim.flora ? sim.flora.snapshot(sim.planet.w) : null;
  const lay = new Float32Array(sim.planet.n);
  const { min, max } = computeLayer(sim, layer, layerSpecies, lay);
  const depth = sim.planet.depth.slice();
  const vents = sim.planet.vents.slice();
  inflight++;
  post(
    { t: 'frame', plants: fs ? { n: fs.n, x: fs.x, y: fs.y, vis: fs.vis } : null, tick: sim.tick, n: snap.n, x: snap.x, y: snap.y, sp: snap.sp, vis: snap.vis, ang: snap.ang, layer: lay, lmin: min, lmax: max, layerKind: layer, depth, vents, tps: tpsMeasured },
    [snap.x.buffer, snap.y.buffer, snap.sp.buffer, snap.vis.buffer, snap.ang.buffer, lay.buffer, depth.buffer, vents.buffer, ...(fs ? [fs.x.buffer, fs.y.buffer, fs.vis.buffer] : [])],
  );
}

function sendTerrain() {
  if (!sim || !sim.stage3) return;
  const t = computeTerrain(sim);
  post({ t: 'terrain', w: t.w, h: t.h, biome: t.biome, land: t.land, cover: t.cover, hue: t.hue, height: t.height, moist: t.moist, temp: t.temp }, [t.biome.buffer, t.land.buffer, t.cover.buffer, t.hue.buffer, t.height.buffer, t.moist.buffer, t.temp.buffer]);
}

/** Trilha evolutiva: genoma médio da linhagem ao longo do tempo, incluindo ancestrais. */
function trailOf(id: number) {
  const s = sim!;
  const chain: { tick: number; genes: number[] }[] = [];
  let sp: ReturnType<typeof s.species.get> | undefined = s.species.get(id);
  let limit = Infinity;
  const parts: { tick: number; genes: number[] }[][] = [];
  while (sp) {
    parts.unshift(sp.trail.filter((e) => e.tick <= limit));
    limit = sp.bornTick;
    sp = sp.parentId ? s.species.get(sp.parentId) : undefined;
  }
  for (const p of parts) chain.push(...p);
  const cur = s.species.get(id);
  if (cur.extinctTick < 0 && cur.count > 0) chain.push({ tick: s.tick, genes: Array.from(cur.centroid) });
  const step = Math.max(1, Math.ceil(chain.length / 12));
  const items = chain.filter((_, i) => i % step === 0 || i === chain.length - 1).map((e) => {
    const vis = new Uint8Array(VIS);
    visFromGenes(e.genes, 0, vis, 0);
    return { tick: e.tick, vis: Array.from(vis) };
  });
  post({ t: 'trail', species: id, items });
}

function inspectPlant(x: number, y: number): PlantInfo | null {
  const s = sim;
  if (!s?.flora) return null;
  const f = s.flora, pl = s.planet, p = f.pool;
  const cx = Math.floor(x), cy = Math.floor(y);
  let best = -1, bd = 1.1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= pl.h) continue;
      const c = yy * pl.w + (((cx + dx) % pl.w) + pl.w) % pl.w;
      for (let k = 0; k < f.cellCount[c]; k++) {
        const i = f.plantAt(c, k);
        const px = (c % pl.w) + ((p.id[i] * 0.6180339) % 1) * 0.7 + 0.15, py = ((c / pl.w) | 0) + ((p.id[i] * 0.7548776) % 1) * 0.7 + 0.15;
        const d = Math.hypot(px - x, py - y);
        if (d < bd) { bd = d; best = i; }
      }
    }
  }
  if (best < 0) return null;
  const i = best, o = i * PLANT_GENES, c = p.cell[i];
  const genes = Array.from(p.genes.subarray(o, o + PLANT_GENES));
  const lin = f.lineages[p.lineage[i] - 1];
  const hmax = maxHeight(p.genes, o);
  return {
    id: p.id[i], lineageId: lin.id, lineageName: lin.name, form: plantForm(p.genes, o), age: p.age[i], gen: p.gen[i], mass: p.mass[i],
    height: Math.min(hmax, HK * Math.sqrt(p.mass[i])), maxHeight: hmax, energy: p.energy[i], genes, vis: plantVis(genes, Math.min(1, (Math.sqrt(p.mass[i]) * HK) / hmax)),
    shade: 1 - f.understory[c], soilWater: pl.soilWater[c], temp: pl.temp[c], light: pl.light[c],
  };
}

function sendStats() {
  if (!sim) return;
  post({ t: 'stats', ...buildStats(sim) });
}

function inspect(x: number, y: number, tol = 1.2): InspectInfo | null {
  if (!sim) return null;
  const p = sim.pool, pl = sim.planet;
  let best = -1, bd = tol;
  for (let i = 0; i < p.used; i++) {
    if (!p.alive[i]) continue;
    let dx = Math.abs(p.x[i] - x);
    if (dx > pl.w / 2) dx = pl.w - dx;
    const d = Math.hypot(dx, p.y[i] - y);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return null;
  const i = best;
  const vis = new Uint8Array(VIS);
  visFromGenes(p.genes, i * GENE_COUNT, vis, 0);
  const c = p.cell[i];
  const topt = p.tr[i * TR + T.TOPT];
  const d = (pl.temp[c] - topt) / p.tr[i * TR + T.TWIDTH];
  return {
    id: p.id[i], speciesId: p.species[i], speciesName: sim.species.get(p.species[i]).name, age: p.age[i], lifespan: p.tr[i * TR + T.LIFESPAN],
    gen: p.gen[i], mass: p.mass[i], energy: p.energy[i], x: p.x[i], y: p.y[i], genes: Array.from(p.genes.subarray(i * GENE_COUNT, (i + 1) * GENE_COUNT)),
    vis: Array.from(vis), parent: p.parent[i], tempHere: pl.temp[c], tempOpt: topt, tf: Math.exp(-d * d),
    structures: structuresOf(p.genes, i * GENE_COUNT), plan: develop(p.genes, i * GENE_COUNT).plan,
    deviations: (() => {
      const cen = sim.species.get(p.species[i]).centroid;
      return GENE_INFO.map((gi, k) => ({ key: gi.key as string, label: gi.label, delta: p.genes[i * GENE_COUNT + k] - cen[k] }))
        .filter((d) => Math.abs(d.delta) > 0.02)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 5);
    })(),
  };
}

function cellInfo(x: number, y: number): CellInfo {
  const s = sim!, pl = s.planet;
  const cx = Math.min(pl.w - 1, Math.max(0, Math.floor(x))), cy = Math.min(pl.h - 1, Math.max(0, Math.floor(y)));
  const c = cy * pl.w + cx;
  let count = 0, biomass = 0;
  const bySp = new Map<number, number>();
  for (let i = 0; i < s.pool.used; i++) {
    if (s.pool.alive[i] && s.pool.cell[i] === c) {
      count++;
      biomass += s.pool.mass[i];
      bySp.set(s.pool.species[i], (bySp.get(s.pool.species[i]) ?? 0) + 1);
    }
  }
  const top = [...bySp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ name: s.species.get(id).name, n }));
  return { x: cx, y: cy, temp: pl.temp[c], light: pl.light[c], depth: pl.depth[c], nutrient: pl.nutrient[c], detritus: pl.detritus[c], count, biomass, top };
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.t) {
    case 'init':
      sim = new Simulation(m.cfg);
      manager = new EcoEventManager();
      acc = 0;
      dirty = true;
      post({ t: 'ready', w: sim.planet.w, h: sim.planet.h });
      sendStats();
      sendTerrain();
      break;
    case 'load':
      sim = importSave(m.save);
      manager = new EcoEventManager();
      dirty = true;
      post({ t: 'ready', w: sim.planet.w, h: sim.planet.h });
      sendStats();
      sendTerrain();
      break;
    case 'speed': speed = m.speed; break;
    case 'step': if (sim) { sim.run(m.n); dirty = true; sendStats(); } break;
    case 'layer': layer = m.layer; layerSpecies = m.species; dirty = true; break;
    case 'paint': if (sim) { sim.paint(m.mode, m.x, m.y, m.r, m.kind); dirty = true; sendTerrain(); } break;
    case 'climate': if (sim) { sim.setClimate(m.dT); dirty = true; } break;
    case 'massExt': if (sim) { sim.massExtinction(m.f); dirty = true; } break;
    case 'seed': if (sim) { sim.seedPrimordialLife(200); dirty = true; } break;
    case 'inspect': {
      const info = inspect(m.x, m.y, m.r);
      post({ t: 'inspect', info, plant: info ? null : inspectPlant(m.x, m.y) });
      break;
    }
    case 'trail': if (sim) trailOf(m.species); break;
    case 'terrain': sendTerrain(); break;
    case 'cell': if (sim) post({ t: 'cell', info: cellInfo(m.x, m.y) }); break;
    case 'save': if (sim) { const save = exportSave(sim); post({ t: 'save', reqId: m.reqId, save }); } break;
    case 'perf': frameMs = m.frameMs; statsMs = m.statsMs; budgetMs = m.budgetMs; break;
    case 'visible': visible = m.v; dirty = true; break;
    case 'suggest': if (sim) { const v = manager.submit(sim, m.s, { bypassRate: !m.auto }); dirty = true; post({ t: 'verdict', reqId: m.reqId, ok: v.ok, reason: v.reason }); } break;
    case 'ack': inflight = Math.max(0, inflight - 1); break;
  }
};

function loop() {
  const now = performance.now();
  const dt = Math.min(100, now - last);
  last = now;
  if (sim && speed > 0) {
    acc += (dt / 1000) * BASE_TPS * speed;
    const t0 = performance.now();
    let steps = 0;
    // orçamento de tempo: a simulação nunca bloqueia o envio de quadros
    while (acc >= 1 && performance.now() - t0 < budgetMs) {
      sim.step();
      acc -= 1;
      steps++;
    }
    if (acc > 3) acc = 3; // não acumula atraso infinito
    tpsWindowTicks += steps;
    dirty = dirty || steps > 0;
  }
  if (now - tpsWindowStart > 1000) {
    tpsMeasured = (tpsWindowTicks * 1000) / (now - tpsWindowStart);
    tpsWindowTicks = 0;
    tpsWindowStart = now;
  }
  if (sim && visible && dirty && inflight < 2 && now - lastFrame > frameMs) {
    sendFrame();
    lastFrame = now;
    dirty = false;
  }
  if (sim && now - lastStats > statsMs) {
    manager.tick(sim);
    if (visible) {
      sendStats();
      if (++terrainTick % 3 === 1) sendTerrain();
    }
    lastStats = now;
  }
  setTimeout(loop, speed > 0 ? 1 : 30);
}
loop();
