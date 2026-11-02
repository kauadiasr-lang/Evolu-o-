/// <reference lib="webworker" />
import { GENE_COUNT } from '../core/genome';
import { computeLayer, LayerKind } from '../core/layers';
import { exportSave, importSave } from '../core/serialize';
import { Simulation } from '../core/simulation';
import { takeSnapshot, visFromGenes, VIS } from '../core/snapshot';
import { T, TR } from '../core/traits';
import { applySuggestion } from '../core/validate';
import type { CellInfo, FromWorker, InspectInfo, SpeciesInfo, StatsPayload, ToWorker } from './protocol';

const BASE_TPS = 20; // ticks por segundo a 1×
let sim: Simulation | null = null;
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
  const lay = new Float32Array(sim.planet.n);
  const { min, max } = computeLayer(sim, layer, layerSpecies, lay);
  const depth = sim.planet.depth.slice();
  const vents = sim.planet.vents.slice();
  inflight++;
  post(
    { t: 'frame', tick: sim.tick, n: snap.n, x: snap.x, y: snap.y, sp: snap.sp, vis: snap.vis, ang: snap.ang, layer: lay, lmin: min, lmax: max, layerKind: layer, depth, vents, tps: tpsMeasured },
    [snap.x.buffer, snap.y.buffer, snap.sp.buffer, snap.vis.buffer, snap.ang.buffer, lay.buffer, depth.buffer, vents.buffer],
  );
}

function sendStats() {
  if (!sim) return;
  const s = sim;
  const mass = s.massBreakdown();
  const species: SpeciesInfo[] = s.species.list.map((sp) => {
    const vis = new Uint8Array(VIS);
    visFromGenes(sp.centroid, 0, vis, 0);
    return {
      id: sp.id, name: sp.name, parentId: sp.parentId, bornTick: sp.bornTick, extinctTick: sp.extinctTick, count: sp.count, peak: sp.peak,
      trophic: sp.trophic, cause: sp.cause, vis: Array.from(vis), centroid: Array.from(sp.centroid),
      src: [s.energySrc[sp.id * 3] ?? 0, s.energySrc[sp.id * 3 + 1] ?? 0, s.energySrc[sp.id * 3 + 2] ?? 0],
    };
  });
  const aliveSp = species.filter((x) => x.extinctTick < 0 && x.count > 0).sort((a, b) => b.count - a.count).slice(0, 18);
  const ids = new Set(aliveSp.map((x) => x.id));
  const edges: [number, number, number][] = [];
  for (const [k, v] of s.predFlow) {
    const pred = Math.floor(k / 1e6), prey = k % 1e6;
    if (ids.has(pred) && ids.has(prey) && v > 0.3) edges.push([pred, prey, v]);
  }
  let tsum = 0;
  for (let i = 0; i < s.planet.n; i++) tsum += s.planet.temp[i];
  const payload: StatsPayload = {
    tick: s.tick,
    pop: s.pool.count,
    mass,
    speciesAlive: s.species.aliveCount(),
    speciesTotal: s.species.size,
    maxGen: s.maxGeneration,
    births: s.birthsTotal,
    mutations: s.mutationsTotal,
    deaths: { ...s.deathsTotal },
    planet: { climateTarget: s.planet.climateTarget, climateOffset: s.planet.climateOffset, pressure: s.planet.pressure, meanTemp: tsum / s.planet.n, season: s.planet.season },
    species,
    history: { ticks: s.history.ticks, series: s.history.series },
    events: s.events.items.slice(-400),
    eventCount: s.events.items.length,
    web: { nodes: aliveSp.map((x) => ({ id: x.id, count: x.count, src: x.src })), edges },
    extinct: s.totalExtinct,
  };
  post({ t: 'stats', ...payload });
}

function inspect(x: number, y: number): InspectInfo | null {
  if (!sim) return null;
  const p = sim.pool, pl = sim.planet;
  let best = -1, bd = 1.2;
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
      acc = 0;
      dirty = true;
      post({ t: 'ready', w: sim.planet.w, h: sim.planet.h });
      sendStats();
      break;
    case 'load':
      sim = importSave(m.save);
      dirty = true;
      post({ t: 'ready', w: sim.planet.w, h: sim.planet.h });
      sendStats();
      break;
    case 'speed': speed = m.speed; break;
    case 'step': if (sim) { sim.run(m.n); dirty = true; sendStats(); } break;
    case 'layer': layer = m.layer; layerSpecies = m.species; dirty = true; break;
    case 'paint': if (sim) { sim.paint(m.mode, m.x, m.y, m.r); dirty = true; } break;
    case 'climate': if (sim) { sim.setClimate(m.dT); dirty = true; } break;
    case 'massExt': if (sim) { sim.massExtinction(m.f); dirty = true; } break;
    case 'seed': if (sim) { sim.seedPrimordialLife(200); dirty = true; } break;
    case 'inspect': post({ t: 'inspect', info: inspect(m.x, m.y) }); break;
    case 'cell': if (sim) post({ t: 'cell', info: cellInfo(m.x, m.y) }); break;
    case 'save': if (sim) { const save = exportSave(sim); post({ t: 'save', reqId: m.reqId, save }); } break;
    case 'suggest': if (sim) { const v = applySuggestion(sim, m.s); dirty = true; post({ t: 'verdict', reqId: m.reqId, ok: v.ok, reason: v.reason }); } break;
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
    while (acc >= 1 && performance.now() - t0 < 16) {
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
  if (sim && dirty && inflight < 2 && now - lastFrame > 33) {
    sendFrame();
    lastFrame = now;
    dirty = false;
  }
  if (sim && now - lastStats > 400) {
    sendStats();
    lastStats = now;
  }
  setTimeout(loop, speed > 0 ? 1 : 30);
}
loop();
