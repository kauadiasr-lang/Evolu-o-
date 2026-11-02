import { G, GENE_COUNT, protocellGenome } from '../src/core/genome';
import { Rng } from '../src/core/rng';
import { Simulation, SimConfig } from '../src/core/simulation';

export function smallSim(over: Partial<SimConfig> = {}): Simulation {
  return new Simulation({ width: 40, height: 24, maxOrganisms: 12000, initialPopulation: 250, seed: 7, ...over });
}

/** Mundo vazio e ambientalmente uniforme (sem vida inicial), útil para experimentos controlados. */
export function emptyWorld(over: Partial<SimConfig> = {}, depth = 0.2): Simulation {
  const sim = new Simulation({ width: 24, height: 16, maxOrganisms: 8000, initialPopulation: 0, seed: 11, ...over });
  sim.planet.depth.fill(depth);
  sim.planet.lat.fill(0);
  sim.planet.updateEnvironment(0);
  return sim;
}

export function genome(over: Partial<Record<keyof typeof G, number>> = {}, seed = 3): Float32Array {
  const g = new Float32Array(GENE_COUNT);
  protocellGenome(new Rng(seed), g, 0, 0);
  for (const [k, v] of Object.entries(over)) g[G[k as keyof typeof G]] = v as number;
  return g;
}

export function ensureSpecies(sim: Simulation, g: Float32Array): number {
  if (sim.species.size === 0) sim.species.create(null, g, 0, 0, sim.rng, 'Testus primus');
  return 1;
}

export function stateHash(sim: Simulation): string {
  let h = 0;
  const mix = (v: number) => {
    h = (Math.imul(h ^ (v * 1000003 | 0), 2654435761) + 0x9e3779b9) | 0;
  };
  mix(sim.tick);
  mix(sim.pool.count);
  for (let i = 0; i < sim.pool.used; i++) {
    if (!sim.pool.alive[i]) continue;
    mix(sim.pool.x[i] * 1e4); mix(sim.pool.mass[i] * 1e6); mix(sim.pool.energy[i] * 1e6); mix(sim.pool.species[i]);
  }
  for (let i = 0; i < sim.planet.n; i += 7) { mix(sim.planet.nutrient[i] * 1e6); mix(sim.planet.detritus[i] * 1e6); }
  return h.toString(16) + ':' + sim.species.size + ':' + sim.events.items.length;
}

/** Move massa do reservatório para o nutriente de uma célula (conserva o total). */
export function feed(sim: Simulation, x: number, y: number, amount: number): void {
  const c = Math.floor(y) * sim.planet.w + Math.floor(x);
  const a = Math.min(amount, sim.planet.reservoir);
  sim.planet.nutrient[c] += a;
  sim.planet.reservoir -= a;
}

import { visFromGenes, VIS } from '../src/core/snapshot';
import type { StatsPayload } from '../src/worker/protocol';

/** Reproduz o payload de estatísticas que o worker envia à interface/IA. */
export function statsOf(s: Simulation): StatsPayload {
  const species = s.species.list.map((sp) => {
    const vis = new Uint8Array(VIS);
    visFromGenes(sp.centroid, 0, vis, 0);
    return { id: sp.id, name: sp.name, parentId: sp.parentId, bornTick: sp.bornTick, extinctTick: sp.extinctTick, count: sp.count, peak: sp.peak, trophic: sp.trophic, cause: sp.cause, vis: Array.from(vis), centroid: Array.from(sp.centroid), src: [0, 0, 0] as [number, number, number] };
  });
  return {
    tick: s.tick, pop: s.pool.count, mass: s.massBreakdown(), speciesAlive: s.species.aliveCount(), speciesTotal: s.species.size, maxGen: s.maxGeneration,
    births: s.birthsTotal, mutations: s.mutationsTotal, deaths: { ...s.deathsTotal },
    planet: { climateTarget: s.planet.climateTarget, climateOffset: s.planet.climateOffset, pressure: s.planet.pressure, meanTemp: 20, season: 0 },
    species, history: { ticks: s.history.ticks, series: s.history.series }, events: s.events.items.slice(-50), eventCount: s.events.items.length,
    web: { nodes: [], edges: [] }, extinct: s.totalExtinct,
  };
}
