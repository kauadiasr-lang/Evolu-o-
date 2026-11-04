import { Simulation, SimConfig } from './simulation';
import { SpeciesRegistry } from './species';
import { History, SimEvent } from './stats';
import { GENE_COUNT } from './genome';
import { TR } from './traits';
import { PLANT_GENES, type PlantLineage } from './flora';

export const SAVE_VERSION = 3;
/** versões que sabemos carregar (a 2 não tem os campos da Etapa 4, que têm padrões neutros) */
const LOADABLE = [2, 3];

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
    regionTemp: pl.regionTemp.slice(), deathBySpecies: sim.deathBySpecies.slice(),
    land: pl.land.slice(), elev: pl.elev.slice(), rain: pl.rain.slice(), soilWater: pl.soilWater.slice(), bgHue: pl.bgHue.slice(),
  };
  const fl = sim.flora;
  let floraMeta: any = null;
  if (fl) {
    const q = fl.pool, fu = q.used;
    Object.assign(arrays, {
      f_alive: q.alive.slice(0, fu), f_id: q.id.slice(0, fu), f_lineage: q.lineage.slice(0, fu), f_gen: q.gen.slice(0, fu), f_age: q.age.slice(0, fu),
      f_cell: q.cell.slice(0, fu), f_genes: q.genes.slice(0, fu * PLANT_GENES), f_mass: q.mass.slice(0, fu), f_energy: q.energy.slice(0, fu), f_free: q.exportFree(),
      f_slots: fl.slots.slice(), f_count: fl.cellCount.slice(), f_lai: fl.lai.slice(), f_under: fl.understory.slice(), f_cover: fl.cover.slice(),
      f_hue: fl.vegHue.slice(), f_height: fl.meanHeight.slice(), f_cmass: fl.cellMass.slice(),
    });
    floraMeta = {
      used: fu, nextId: q.nextId, colonized: fl.colonized, now: fl.now, births: fl.births, deathsTotal: fl.deathsTotal, rng: fl.rng.state,
      lineages: fl.lineages.map((l) => ({ ...l, anchor: Array.from(l.anchor), centroid: Array.from(l.centroid) })),
    };
  }
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
    env: {
      seasonAmp: pl.seasonAmp, climateRate: pl.climateRate, aridity: pl.aridity, aridityTarget: pl.aridityTarget, aridityRate: pl.aridityRate,
      lightFactor: pl.lightFactor, lightTarget: pl.lightTarget, lightRate: pl.lightRate, regionActive: pl.regionActive,
      geologyOn: sim.geologyOn, schedule: sim.schedule, deathsRecent: sim.deathsRecent,
    },
    stage3: { mrng: sim.mrng.state, flora: floraMeta, seen: [...sim.structuresSeen] },
  };
  return { version: SAVE_VERSION, meta, arrays };
}

export function importSave(data: SaveData): Simulation {
  if (!LOADABLE.includes(data.version)) throw new Error(`Versão de save incompatível: ${data.version}`);
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
  // ---- Etapa 4 (saves antigos não têm estes campos: ficam nos padrões neutros)
  if (m.env) {
    const e = m.env;
    Object.assign(pl, {
      seasonAmp: e.seasonAmp, climateRate: e.climateRate, aridity: e.aridity, aridityTarget: e.aridityTarget, aridityRate: e.aridityRate,
      lightFactor: e.lightFactor, lightTarget: e.lightTarget, lightRate: e.lightRate, regionActive: e.regionActive,
    });
    sim.geologyOn = e.geologyOn;
    sim.schedule = e.schedule;
    sim.deathsRecent = e.deathsRecent;
    pl.regionTemp.set(a.regionTemp as Float32Array);
    sim.deathBySpecies = Float64Array.from(a.deathBySpecies as Float64Array);
  }
  // ---- Etapa 3
  if (a.land) {
    pl.land.set(a.land as Uint8Array);
    pl.elev.set(a.elev as Float32Array);
    pl.rain.set(a.rain as Float32Array);
    pl.soilWater.set(a.soilWater as Float32Array);
    pl.bgHue.set(a.bgHue as Float32Array);
    pl.stage3 = !!m.cfg.stage3;
    const lc: number[] = [];
    for (let i = 0; i < pl.n; i++) if (pl.land[i]) lc.push(i);
    pl.landCells = Int32Array.from(lc);
  }
  if (m.stage3) {
    sim.mrng.state = m.stage3.mrng;
    sim.structuresSeen = new Set(m.stage3.seen);
    const fm = m.stage3.flora;
    const fl = sim.flora;
    if (fl && fm) {
      const q = fl.pool;
      q.used = fm.used;
      q.nextId = fm.nextId;
      q.alive.set(a.f_alive as Uint8Array);
      q.id.set(a.f_id as Uint32Array);
      q.lineage.set(a.f_lineage as Uint32Array);
      q.gen.set(a.f_gen as Uint32Array);
      q.age.set(a.f_age as Uint32Array);
      q.cell.set(a.f_cell as Int32Array);
      q.genes.set(a.f_genes as Float32Array);
      q.mass.set(a.f_mass as Float64Array);
      q.energy.set(a.f_energy as Float64Array);
      q.importFree(a.f_free as Int32Array);
      fl.slots.set(a.f_slots as Int32Array);
      fl.cellCount.set(a.f_count as Uint8Array);
      fl.lai.set(a.f_lai as Float32Array);
      fl.understory.set(a.f_under as Float32Array);
      fl.cover.set(a.f_cover as Float32Array);
      fl.vegHue.set(a.f_hue as Float32Array);
      fl.meanHeight.set(a.f_height as Float32Array);
      fl.cellMass.set(a.f_cmass as Float32Array);
      fl.colonized = fm.colonized;
      fl.now = fm.now;
      fl.births = fm.births;
      fl.deathsTotal = fm.deathsTotal;
      fl.rng.state = fm.rng;
      fl.lineages = fm.lineages.map((l: any): PlantLineage => ({ ...l, anchor: Float32Array.from(l.anchor), centroid: Float32Array.from(l.centroid) }));
    }
  }
  return sim;
}
