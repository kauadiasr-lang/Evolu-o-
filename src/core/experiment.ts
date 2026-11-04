import { FitnessTracker, geneticSnapshot, regionDivergence, RegionDivergence, traitFrequencies } from './diagnostics';
import type { EnvChange } from './envchange';
import { G, GENE_COUNT, protocellGenome } from './genome';
import { Rng } from './rng';
import { develop } from './phenotype';
import { T, TR, deriveTraits } from './traits';
import { PG, PLANT_GENES } from './flora';
import { exportSave, importSave } from './serialize';
import { Simulation, SimConfig } from './simulation';

/**
 * Experimentos reproduzíveis: um mundo ESTÁVEL é executado até `changeAt`; nesse instante o estado é
 * bifurcado (save/load determinístico) em duas linhas do tempo idênticas. Na A nada muda; na B aplica-se uma
 * mudança ambiental documentada. Nada é injetado nos organismos: a diferença entre A e B é só o ambiente.
 */
export interface ScenarioSpec {
  seed: number;
  /** configuração do mundo (a flag `stable` é ligada por padrão) */
  cfg?: Partial<SimConfig>;
  changeAt: number;
  change?: Omit<EnvChange, 'tick' | 'applied'>;
  totalTicks: number;
  sampleEvery?: number;
  /** liga o rastreador de sobrevivência/reprodução por característica */
  track?: boolean;
}

export interface Sample {
  tick: number;
  pop: number;
  speciesAlive: number;
  speciesTotal: number;
  dominantShare: number;
  nicheVariance: number;
  morphVariance: number;
  dominantSpread: number;
  /** desempenho térmico médio (1 = perfeitamente ajustado) */
  tfMean: number;
  lowTf: number;
  meanTopt: number;
  meanSize: number;
  meanPhoto: number;
  meanPred: number;
  meanMotil: number;
  births: number;
  deaths: number;
  climateOffset: number;
  aridity: number;
  light: number;
  plants: number;
  /** média do gene de tolerância à seca das plantas vivas */
  plantDrought: number;
  cover: number;
  landWater: number;
  /** fração da superfície em deserto / pradaria / floresta (Etapa 3) */
  bDesert: number;
  bGrass: number;
  bForest: number;
  /** nº médio de estruturas especializadas expressas por organismo (complexidade morfológica) */
  complexity: number;
  /** fração da população que ainda pertence à linhagem fundadora (espécie 1) */
  founderShare: number;
  massDrift: number;
}

export interface ScenarioRun {
  label: string;
  seed: number;
  samples: Sample[];
  speciesExtinctAfter: string[];
  speciesBornAfter: string[];
  finalSpeciesAlive: number;
  massDrift: number;
  trackerSummary?: ReturnType<FitnessTracker['summary']>;
}

function sample(sim: Simulation, m0: number): Sample {
  const g = geneticSnapshot(sim);
  const h = sim.history;
  let pd = 0, pn = 0;
  if (sim.flora) {
    const p = sim.flora.pool;
    for (let i = 0; i < p.used; i++) if (p.alive[i]) { pd += p.genes[i * PLANT_GENES + PG.DROUGHT]; pn++; }
  }
  const last = (k: string) => (h.series[k]?.length ? h.series[k][h.series[k].length - 1] : 0);
  const tf = traitFrequencies(sim);
  return {
    complexity: Object.values(tf.structures).reduce((a, b) => a + b, 0),
    founderShare: g.pop ? (sim.species.list[0]?.count ?? 0) / g.pop : 0,
    tick: sim.tick,
    pop: g.pop,
    speciesAlive: g.speciesAlive,
    speciesTotal: sim.species.size,
    dominantShare: g.dominantShare,
    nicheVariance: g.nicheVariance,
    morphVariance: g.morphVariance,
    dominantSpread: g.dominantSpread,
    tfMean: last('tfMean'),
    lowTf: last('lowTf'),
    meanTopt: g.geneMean[G.TOPT],
    meanSize: g.geneMean[G.SIZE],
    meanPhoto: g.geneMean[G.PHOTO],
    meanPred: g.geneMean[G.PRED],
    meanMotil: g.geneMean[G.MOTIL],
    births: last('births'),
    deaths: last('deaths'),
    climateOffset: sim.planet.climateOffset,
    aridity: sim.planet.aridity,
    light: sim.planet.lightFactor,
    plants: sim.flora ? sim.flora.pool.count : 0,
    plantDrought: pn ? pd / pn : 0,
    cover: last('cover'),
    landWater: last('landWater'),
    bDesert: last('bDesert'),
    bGrass: last('bGrass'),
    bForest: last('bForest'),
    massDrift: (sim.totalMass() - m0) / m0,
  };
}

function runFrom(sim: Simulation, m0: number, label: string, seed: number, from: number, to: number, every: number, extinctBefore: Set<number>, bornBefore: Set<number>, tracker?: FitnessTracker): ScenarioRun {
  const samples: Sample[] = [];
  for (let t = sim.tick; t < to; t++) {
    sim.step();
    if (sim.tick % every === 0) samples.push(sample(sim, m0));
  }
  return {
    label,
    seed,
    samples,
    speciesExtinctAfter: sim.species.list.filter((s) => s.extinctTick >= from && !extinctBefore.has(s.id)).map((s) => s.name),
    speciesBornAfter: sim.species.list.filter((s) => !bornBefore.has(s.id)).map((s) => s.name),
    finalSpeciesAlive: sim.species.aliveCount(),
    massDrift: (sim.totalMass() - m0) / m0,
    trackerSummary: tracker?.summary(),
  };
}

/** Deep copy do estado via serialização (nada é compartilhado entre as linhas do tempo). */
export function forkSimulation(sim: Simulation): Simulation {
  const save = exportSave(sim);
  return importSave({ ...save, meta: JSON.parse(JSON.stringify(save.meta)) });
}

export interface ForkResult {
  stable: ScenarioRun;
  altered: ScenarioRun;
  /** amostras da fase de estabelecimento (antes da bifurcação) */
  warmup: Sample[];
}

/** Executa o par (A estável, B alterado) a partir do MESMO estado em `changeAt`. */
export function runFork(spec: ScenarioSpec): ForkResult {
  const every = spec.sampleEvery ?? 200;
  const sim = new Simulation({ seed: spec.seed, stable: true, ...spec.cfg });
  const m0 = sim.totalMass();
  const warmup: Sample[] = [];
  while (sim.tick < spec.changeAt) {
    sim.step();
    if (sim.tick % every === 0) warmup.push(sample(sim, m0));
  }
  const twin = forkSimulation(sim);
  const extinct0 = new Set(sim.species.list.filter((s) => s.extinctTick >= 0).map((s) => s.id));
  const born0 = new Set(sim.species.list.map((s) => s.id));
  let trA: FitnessTracker | undefined, trB: FitnessTracker | undefined;
  if (spec.track) {
    trA = new FitnessTracker(sim);
    sim.tracker = trA;
    trB = new FitnessTracker(twin);
    twin.tracker = trB;
  }
  if (spec.change) twin.scheduleChange({ ...spec.change, tick: spec.changeAt });
  const stable = runFrom(sim, m0, 'A (estável)', spec.seed, spec.changeAt, spec.totalTicks, every, extinct0, born0, trA);
  const altered = runFrom(twin, m0, 'B (alterado)', spec.seed, spec.changeAt, spec.totalTicks, every, extinct0, born0, trB);
  return { stable, altered, warmup };
}

// ------------------------------------------------------------------ comparação
export interface Comparison {
  seed: number;
  /** população média nos 1000 ticks anteriores à mudança */
  popBefore: number;
  /** menor população relativa à anterior, depois da mudança */
  minPopRatioA: number;
  minPopRatioB: number;
  /** população relativa ao final */
  finalPopRatioA: number;
  finalPopRatioB: number;
  /** pior desempenho térmico médio após a mudança */
  minTfA: number;
  minTfB: number;
  /** deslocamento do gene de temperatura ótima (final − antes) */
  toptShiftA: number | null;
  toptShiftB: number | null;
  /** a vida desapareceu por completo? (e quando) */
  totalExtinctionA: boolean;
  totalExtinctionB: boolean;
  extinctionTickB: number | null;
  /** deslocamento esperado se a população acompanhasse a mudança (ΔT/50) */
  expectedToptShift: number;
  /** primeiro instante (ticks após a mudança) em que B deslocou ≥ 50% do esperado; null = não houve */
  responseTicks: number | null;
  /** primeiro instante em que a população de B voltou a ≥ 90% da anterior após o mínimo; null = não voltou */
  recoveryTicks: number | null;
  extinctA: number;
  extinctB: number;
  speciesAliveA: number;
  speciesAliveB: number;
  nicheVarA: number;
  nicheVarB: number;
  droughtShiftA: number | null;
  droughtShiftB: number | null;
  /** vegetação e biomas ao final (Etapa 3) */
  coverA: number;
  coverB: number;
  landWaterA: number;
  landWaterB: number;
  desertA: number;
  desertB: number;
  plantsA: number;
  plantsB: number;
  massDriftMax: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function compareRuns(res: ForkResult, changeAt: number, deltaT = 0): Comparison {
  const pre = res.warmup.filter((s) => s.tick > changeAt - 1000);
  const popBefore = mean(pre.map((s) => s.pop)) || 1;
  const toptBefore = mean(pre.map((s) => s.meanTopt));
  const droughtBefore = mean(pre.map((s) => s.plantDrought));
  const ratio = (r: ScenarioRun) => r.samples.map((s) => s.pop / popBefore);
  const rA = ratio(res.stable), rB = ratio(res.altered);
  const last = <T,>(a: T[]) => a[a.length - 1];
  /** último instante com vida (evita médias de "ninguém") */
  const lastAlive = (r: ScenarioRun) => [...r.samples].reverse().find((s) => s.pop > 0) ?? null;
  const aliveA = lastAlive(res.stable), aliveB = lastAlive(res.altered);
  const expected = deltaT / 50;
  let response: number | null = null;
  if (Math.abs(expected) > 1e-9) {
    for (let i = 0; i + 1 < res.altered.samples.length; i++) {
      const sh = (s: Sample) => (s.meanTopt - toptBefore) * Math.sign(expected);
      if (sh(res.altered.samples[i]) >= 0.5 * Math.abs(expected) && sh(res.altered.samples[i + 1]) >= 0.5 * Math.abs(expected)) { response = res.altered.samples[i].tick - changeAt; break; }
    }
  }
  let recovery: number | null = null;
  const minIdx = rB.indexOf(Math.min(...rB));
  for (let i = minIdx; i < rB.length; i++) if (rB[i] >= 0.9) { recovery = res.altered.samples[i].tick - changeAt; break; }
  const drifts = [...res.warmup, ...res.stable.samples, ...res.altered.samples].map((s) => Math.abs(s.massDrift));
  return {
    seed: res.stable.seed,
    popBefore,
    minPopRatioA: Math.min(...rA),
    minPopRatioB: Math.min(...rB),
    finalPopRatioA: last(rA),
    finalPopRatioB: last(rB),
    minTfA: Math.min(...res.stable.samples.map((s) => s.tfMean)),
    minTfB: Math.min(...res.altered.samples.map((s) => s.tfMean)),
    toptShiftA: aliveA ? aliveA.meanTopt - toptBefore : null,
    toptShiftB: aliveB && last(res.altered.samples).pop > 0 ? aliveB.meanTopt - toptBefore : null,
    totalExtinctionA: last(res.stable.samples).pop === 0,
    totalExtinctionB: last(res.altered.samples).pop === 0,
    extinctionTickB: res.altered.samples.find((s) => s.pop === 0)?.tick ?? null,
    expectedToptShift: expected,
    responseTicks: response,
    recoveryTicks: recovery,
    extinctA: res.stable.speciesExtinctAfter.length,
    extinctB: res.altered.speciesExtinctAfter.length,
    speciesAliveA: res.stable.finalSpeciesAlive,
    speciesAliveB: res.altered.finalSpeciesAlive,
    nicheVarA: aliveA ? aliveA.nicheVariance : 0,
    nicheVarB: aliveB && last(res.altered.samples).pop > 0 ? aliveB.nicheVariance : 0,
    droughtShiftA: aliveA && aliveA.plants > 0 ? aliveA.plantDrought - droughtBefore : null,
    droughtShiftB: aliveB && last(res.altered.samples).plants > 0 ? last(res.altered.samples).plantDrought - droughtBefore : null,
    coverA: last(res.stable.samples).cover,
    coverB: last(res.altered.samples).cover,
    landWaterA: last(res.stable.samples).landWater,
    landWaterB: last(res.altered.samples).landWater,
    desertA: last(res.stable.samples).bDesert,
    desertB: last(res.altered.samples).bDesert,
    plantsA: last(res.stable.samples).plants,
    plantsB: last(res.altered.samples).plants,
    massDriftMax: Math.max(...drifts),
  };
}

// ------------------------------------------------------------------ isolamento (barreira térmica)
export interface IsolationSpec {
  seed: number;
  cfg?: Partial<SimConfig>;
  ticks: number;
  /** ΔT aplicado às bacias oeste (−) e leste (+) quando há seleção diferencial */
  dT: number;
  /** largura da faixa-barreira (letal) em células */
  barrierWidth?: number;
  differential: boolean;
}

export interface IsolationResult {
  differential: boolean;
  divergence: RegionDivergence;
  speciesAlive: number;
  speciationEvents: number;
  massDrift: number;
  /** cada população (oeste/leste) é grande o bastante para a comparação? */
  nWest: number;
  nEast: number;
}

/**
 * Duas bacias oceânicas separadas por uma faixa térmica letal. Em `differential`, cada bacia recebe uma
 * temperatura diferente (seleção divergente); no controle, as duas são iguais (só isolamento). A especiação
 * NÃO é garantida: o resultado mostra se (e quão rápido) as duas populações divergem.
 */
export function runIsolation(spec: IsolationSpec): IsolationResult {
  const sim = new Simulation({ seed: spec.seed, stable: true, ...spec.cfg });
  const m0 = sim.totalMass();
  const pl = sim.planet;
  const bw = spec.barrierWidth ?? 4;
  const mid = Math.floor(pl.w / 2);
  // barreira vertical letal (temperatura extrema) e a outra no "meridiano" de costura (cilindro)
  for (const bx of [mid, 0]) sim.setRegionTemp(bx - Math.floor(bw / 2), 0, bx + Math.ceil(bw / 2) - 1, pl.h - 1, 28);
  if (spec.differential) {
    sim.setRegionTemp(Math.ceil(bw / 2), 0, mid - Math.ceil(bw / 2) - 1, pl.h - 1, -spec.dT, false);
    sim.setRegionTemp(mid + Math.ceil(bw / 2), 0, pl.w - Math.ceil(bw / 2) - 1, pl.h - 1, +spec.dT, false);
  }
  sim.run(spec.ticks);
  const west = (c: number) => { const x = c % pl.w; return x > bw && x < mid - bw ? 0 : x > mid + bw && x < pl.w - bw ? 1 : -1; };
  const div = regionDivergence(sim, west);
  return {
    differential: spec.differential,
    divergence: div,
    speciesAlive: sim.species.aliveCount(),
    speciationEvents: sim.events.items.filter((e) => e.type === 'speciation').length,
    massDrift: (sim.totalMass() - m0) / m0,
    nWest: div.nA,
    nEast: div.nB,
  };
}

// ------------------------------------------------------------------ viabilidade de intermediários terrestres
export interface ViabilityRow {
  terr: number;
  limbs: number;
  /** pares de membros e adaptação terrestre REALMENTE expressos */
  limbsExpressed: number;
  terrExpressed: number;
  /** consegue entrar em terra (membros + integumento expressos)? */
  capable: boolean;
  /** balanço líquido de energia (energia + 2·massa) por tick, no mar e em terra (null = bloqueado) */
  sea: number;
  land: number | null;
  seaAlive: boolean;
  landAlive: boolean | null;
}

export interface ViabilityReport {
  seed: number;
  ticks: number;
  coast: { landTemp: number; soilWater: number; seaTemp: number } | null;
  rows: ViabilityRow[];
}

/**
 * Mede se formas intermediárias entre vida marinha e terrestre são viáveis NA FÍSICA do simulador:
 * o mesmo genótipo é colocado no mar e numa costa de terra úmida. Só observa (não altera nada fora de
 * mundos de teste isolados).
 */
export function landViability(seed = 3, ticks = 80, wMin = 0.25, wMax = 1): ViabilityReport {
  const mk = () => new Simulation({ width: 64, height: 40, initialPopulation: 0, seed, stage3: true, maxOrganisms: 4000 });
  const probe = mk();
  const pl = probe.planet;
  let land = -1, sea = -1;
  for (let i = 1; i < pl.n - 1 && land < 0; i++) {
    const x = i % pl.w, y = (i / pl.w) | 0;
    if (y < 5 || y > pl.h - 6 || x < 3 || x > pl.w - 4) continue;
    if (pl.land[i] && !pl.land[i - 1] && pl.depth[i - 1] < 0.5 && pl.temp[i] > 14 && pl.temp[i] < 30 && pl.soilWater[i] >= wMin && pl.soilWater[i] <= wMax) { land = i; sea = i - 1; }
  }
  if (land < 0) return { seed, ticks, coast: null, rows: [] };
  const coast = { landTemp: pl.temp[land], soilWater: pl.soilWater[land], seaTemp: pl.temp[sea] };
  const balance = (cell: number, genes: Float32Array) => {
    const sim = mk();
    const p = sim.planet;
    const mv = Math.min(60, p.reservoir);
    p.nutrient[cell] += mv;
    p.reservoir -= mv;
    const i = sim.addOrganism(genes, 0, (cell % p.w) + 0.5, ((cell / p.w) | 0) + 0.5, 3, 9);
    const v0 = sim.pool.energy[i] + 2 * sim.pool.mass[i];
    for (let t = 0; t < ticks; t++) {
      sim.step();
      if (!sim.pool.alive[i]) return { dE: -v0 / ticks, alive: false };
    }
    return { dE: (sim.pool.energy[i] + 2 * sim.pool.mass[i] - v0) / ticks, alive: true };
  };
  const rows: ViabilityRow[] = [];
  for (const terr of [0, 0.15, 0.3, 0.6, 0.9]) {
    for (const limbs of [0, 0.4, 0.8]) {
      const g = new Float32Array(GENE_COUNT);
      protocellGenome(new Rng(1), g, 0, 0);
      const set: Partial<Record<keyof typeof G, number>> = { SIZE: 0.3, MOTIL: 0.3, SENSE: 0.2, PHOTO: 0.6, OSMO: 0.3, PRED: 0, META: 0.3, TTOL: 0.6, LIMBS: limbs, LIMBLEN: 0.5, TERR: terr, MUT: 0 };
      for (const [k, v] of Object.entries(set)) g[G[k as keyof typeof G]] = v as number;
      g[G.TOPT] = (coast.landTemp + 5) / 50;
      const tr = new Float32Array(TR);
      deriveTraits(g, 0, tr, 0, true);
      const ph = develop(g, 0);
      const capable = tr[T.TERR] > 0 && tr[T.LSPEED] > 0;
      const s = balance(sea, g);
      const l = capable ? balance(land, g) : null;
      rows.push({ terr, limbs, limbsExpressed: ph.limbs, terrExpressed: ph.terr, capable, sea: s.dE, land: l ? l.dE : null, seaAlive: s.alive, landAlive: l ? l.alive : null });
    }
  }
  return { seed, ticks, coast, rows };
}
