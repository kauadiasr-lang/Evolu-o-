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
  if (sim.flora) {
    mix(sim.flora.pool.count);
    mix(sim.flora.totalMass() * 1e6);
    for (let i = 0; i < sim.flora.pool.used; i++) if (sim.flora.pool.alive[i]) { mix(sim.flora.pool.mass[i] * 1e6); mix(sim.flora.pool.genes[i * 11] * 1e6); }
    for (let i = 0; i < sim.planet.n; i += 5) mix(sim.planet.soilWater[i] * 1e6);
  }
  return h.toString(16) + ':' + sim.species.size + ':' + sim.events.items.length;
}

/** Move massa do reservatório para o nutriente de uma célula (conserva o total). */
export function feed(sim: Simulation, x: number, y: number, amount: number): void {
  const c = Math.floor(y) * sim.planet.w + Math.floor(x);
  const a = Math.min(amount, sim.planet.reservoir);
  sim.planet.nutrient[c] += a;
  sim.planet.reservoir -= a;
}

import { buildStats } from '../src/worker/summary';

/** Mesmo payload de estatísticas que o worker envia à interface/IA. */
export const statsOf = (s: Simulation) => buildStats(s);

/** Mundo da Etapa 3 (continentes, flora, morfologia), pequeno para testes rápidos. */
export function stage3Sim(over: Partial<SimConfig> = {}): Simulation {
  return new Simulation({ width: 48, height: 30, maxOrganisms: 15000, initialPopulation: 300, seed: 7, stage3: true, maxPlants: 4000, ...over });
}

/** Retorna uma célula de água e uma de terra interna (para experimentos controlados). */
export function cells(sim: Simulation) {
  const pl = sim.planet;
  let water = -1, land = -1;
  for (let i = 0; i < pl.n; i++) {
    const x = i % pl.w, y = (i / pl.w) | 0;
    if (y < 3 || y > pl.h - 4 || x < 3 || x > pl.w - 4) continue;
    if (water < 0 && !pl.land[i] && !pl.land[i + 1] && !pl.land[i - 1] && pl.depth[i] < 0.5 && pl.temp[i] > 16 && pl.temp[i] < 28) water = i;
    if (land < 0 && pl.land[i] && pl.land[i + 1] && pl.land[i - 1] && pl.land[i + pl.w] && pl.land[i - pl.w]) land = i;
  }
  return { water, land, w: pl.w };
}
