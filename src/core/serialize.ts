import { Simulation, SimConfig } from './simulation';
import { SpeciesRegistry } from './species';
import { History, SimEvent } from './stats';
import { GENE_COUNT } from './genome';
import { TR } from './traits';

export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  meta: any;
  arrays: Record<string, Float32Array | Float64Array | Uint32Array | Int32Array | Uint8Array>;
}

/** Serializa o estado completo (determinístico: continuar após carregar reproduz a mesma história). */
export function exportSave(sim: Simulation): SaveData {
  const p = sim.pool, pl = sim.planet, u = p.used;
  const arrays: SaveData['arrays'] = {
    depth: pl.depth.slice(), baseTemp: pl.baseTemp.slice(), temp: pl.temp.slice(), userTemp: pl.userTemp.slice(), light: pl.light.slice(),
    lat: pl.lat.slice(), nutrient: pl.nutrient.slice(), detritus: pl.detritus.slice(), vents: pl.vents.slice(),
    alive: p.alive.slice(0, u), id: p.id.slice(0, u), parent: p.parent.slice(0, u), species: p.species.slice(0, u), gen: p.gen.slice(0, u),
    born: p.born.slice(0, u), age: p.age.slice(0, u), x: p.x.slice(0, u), y: p.y.slice(0, u), vx: p.vx.slice(0, u), vy: p.vy.slice(0, u),
    mass: p.mass.slice(0, u), energy: p.energy.slice(0, u), cell: p.cell.slice(0, u),
    genes: p.genes.slice(0, u * GENE_COUNT), tr: p.tr.slice(0, u * TR), free: p.exportFree(),
    energySrc: sim.energySrc.slice(),
  };
  const meta = {
    cfg: sim.cfg,
    tick: sim.tick,
    rng: sim.rng.state,
    pool: { used: u, nextId: p.nextId },
    planet: { reservoir: pl.reservoir, climateOffset: pl.climateOffset, climateTarget: pl.climateTarget, season: pl.season, pressure: pl.pressure },
    species: sim.species.toJSON(),
    history: { ticks: sim.history.ticks, series: sim.history.series, stride: sim.history.stride },
    events: sim.events.items,
    counters: {
      births: sim.births, deathsInterval: sim.deathsInterval, deathsTotal: sim.deathsTotal, mutationsTotal: sim.mutationsTotal,
      birthsTotal: sim.birthsTotal, maxGeneration: sim.maxGeneration, totalExtinct: sim.totalExtinct,
    },
    predFlow: Array.from(sim.predFlow.entries()),
    internal: sim.exportInternal(),
  };
  return { version: SAVE_VERSION, meta, arrays };
}

export function importSave(data: SaveData): Simulation {
  if (data.version !== SAVE_VERSION) throw new Error(`Versão de save incompatível: ${data.version}`);
  const m = data.meta;
  const sim = new Simulation(m.cfg as SimConfig, false);
  const a = data.arrays;
  const p = sim.pool, pl = sim.planet;
  pl.depth.set(a.depth as Float32Array);
  pl.baseTemp.set(a.baseTemp as Float32Array);
  pl.temp.set(a.temp as Float32Array);
  pl.userTemp.set(a.userTemp as Float32Array);
  pl.light.set(a.light as Float32Array);
  pl.lat.set(a.lat as Float32Array);
  pl.nutrient.set(a.nutrient as Float64Array);
  pl.detritus.set(a.detritus as Float64Array);
  pl.vents = Int32Array.from(a.vents as Int32Array);
  Object.assign(pl, m.planet);
  p.used = m.pool.used;
  p.nextId = m.pool.nextId;
  p.alive.set(a.alive as Uint8Array);
  p.id.set(a.id as Uint32Array);
  p.parent.set(a.parent as Uint32Array);
  p.species.set(a.species as Uint32Array);
  p.gen.set(a.gen as Uint32Array);
  p.born.set(a.born as Uint32Array);
  p.age.set(a.age as Uint32Array);
  p.x.set(a.x as Float32Array);
  p.y.set(a.y as Float32Array);
  p.vx.set(a.vx as Float32Array);
  p.vy.set(a.vy as Float32Array);
  p.mass.set(a.mass as Float64Array);
  p.energy.set(a.energy as Float64Array);
  p.cell.set(a.cell as Int32Array);
  p.genes.set(a.genes as Float32Array);
  p.tr.set(a.tr as Float32Array);
  p.importFree(a.free as Int32Array);
  sim.tick = m.tick;
  sim.rng.state = m.rng;
  sim.species = SpeciesRegistry.fromJSON(m.species);
  const h = new History(sim.history.keys);
  h.ticks = m.history.ticks;
  h.series = m.history.series;
  h.stride = m.history.stride;
  sim.history = h;
  sim.events.items = m.events as SimEvent[];
  Object.assign(sim, {
    births: m.counters.births, deathsInterval: m.counters.deathsInterval, deathsTotal: m.counters.deathsTotal,
    mutationsTotal: m.counters.mutationsTotal, birthsTotal: m.counters.birthsTotal, maxGeneration: m.counters.maxGeneration,
    totalExtinct: m.counters.totalExtinct,
  });
  sim.predFlow = new Map(m.predFlow);
  sim.energySrc = Float64Array.from(a.energySrc as Float64Array);
  sim.importInternal(m.internal);
  return sim;
}
