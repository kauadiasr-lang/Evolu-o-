import { GENE_COUNT } from '../core/genome';
import { develop } from '../core/phenotype';
import { computeTerrain } from '../core/biomes';
import { FORMS, PG, PLANT_GENES, plantForm } from '../core/flora';
import type { DiagnosticsReport } from '../core/diagnostics';
import type { Simulation } from '../core/simulation';
import { VIS, visFromGenes } from '../core/snapshot';
import type { FloraLineageInfo, FloraStats, SpeciesInfo, StatsPayload } from './protocol';

const STRUCT_NAMES: [keyof ReturnType<typeof develop>, string][] = [['segments', 'segmentos'], ['limbs', 'membros'], ['fins', 'nadadeiras'], ['eyes', 'olhos'], ['camo', 'camuflagem'], ['climb', 'escalada'], ['terr', 'adaptação terrestre'], ['antennae', 'antenas'], ['tail', 'cauda propulsora'], ['head', 'cefalização']];
export function structuresOf(genes: ArrayLike<number>, o: number): string[] {
  const ph = develop(genes, o);
  return STRUCT_NAMES.filter(([k]) => (ph[k] as number) > 0).map(([k, label]) => {
    const v = ph[k] as number;
    return k === 'segments' || k === 'limbs' || k === 'eyes' ? `${label} (${v})` : label;
  });
}

export function floraStats(s: Simulation): FloraStats {
  const f = s.flora!, p = f.pool;
  const sums = new Float64Array((f.lineages.length + 1) * PLANT_GENES), cnt = new Int32Array(f.lineages.length + 1);
  const forms: Record<string, number> = {};
  for (let i = 0; i < p.used; i++) {
    if (!p.alive[i]) continue;
    const l = p.lineage[i];
    cnt[l]++;
    for (let k = 0; k < PLANT_GENES; k++) sums[l * PLANT_GENES + k] += p.genes[i * PLANT_GENES + k];
    const fm = plantForm(p.genes, i * PLANT_GENES);
    forms[fm] = (forms[fm] ?? 0) + 1;
  }
  const lineages: FloraLineageInfo[] = f.lineages
    .filter((l) => l.extinctTick < 0 || l.peak >= 30)
    .map((l) => {
      const genes = cnt[l.id] > 0 ? Array.from({ length: PLANT_GENES }, (_, k) => sums[l.id * PLANT_GENES + k] / cnt[l.id]) : Array.from(l.anchor);
      return { id: l.id, name: l.name, parentId: l.parentId, bornTick: l.bornTick, extinctTick: l.extinctTick, count: cnt[l.id], peak: l.peak, form: plantForm(genes, 0), genes, vis: plantVis(genes, 1) };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
  let cover = 0, canopy = 0;
  const lc = s.planet.landCells;
  for (let k = 0; k < lc.length; k++) { cover += f.cover[lc[k]]; canopy += f.lai[lc[k]]; }
  return {
    colonized: f.colonized, plants: p.count, mass: f.totalMass(), lineagesAlive: f.lineages.filter((l) => l.extinctTick < 0).length, lineages,
    cover: lc.length ? cover / lc.length : 0, canopy: lc.length ? canopy / lc.length : 0, deaths: { ...f.deathsTotal }, forms,
  };
}

/** Bytes de aparência de uma planta (mesmo formato de FloraSnapshot.vis). */
export function plantVis(g: ArrayLike<number>, maturity: number): number[] {
  const q = (t: number) => Math.max(0, Math.min(255, Math.round(t * 255)));
  return [q(g[PG.HEIGHT]), q(g[PG.LEAF]), q(g[PG.DENSITY]), q(g[PG.ROOT]), q(g[PG.PIGMENT]), q(g[PG.SHADE]), q(g[PG.DROUGHT]), q(maturity), FORMS.indexOf(plantForm(g, 0))];
}


export function buildStats(s: Simulation, diag: DiagnosticsReport | null = null): StatsPayload {
  const mass = s.massBreakdown();
  const species: SpeciesInfo[] = s.species.list.map((sp) => {
    const vis = new Uint8Array(VIS);
    visFromGenes(sp.centroid, 0, vis, 0);
    return {
      id: sp.id, name: sp.name, parentId: sp.parentId, bornTick: sp.bornTick, extinctTick: sp.extinctTick, count: sp.count, peak: sp.peak,
      trophic: sp.trophic, cause: sp.cause, vis: Array.from(vis), centroid: Array.from(sp.centroid),
      src: [s.energySrc[sp.id * 3] ?? 0, s.energySrc[sp.id * 3 + 1] ?? 0, s.energySrc[sp.id * 3 + 2] ?? 0],
      structures: structuresOf(sp.centroid, 0), plan: develop(sp.centroid, 0).plan,
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
    stage3: s.stage3,
    flora: s.flora ? floraStats(s) : null,
    biomes: s.stage3 ? computeTerrain(s).areas : [],
    landFraction: s.planet.landCells.length / s.planet.n,
    diag,
    env: { aridity: s.planet.aridityTarget, light: s.planet.lightTarget, stable: s.planet.seasonAmp === 0 && !s.geologyOn },
  };
  return payload;
}

