import { BASE_GENES, G, GENE_COUNT, GENE_INFO, geneDistance } from './genome';
import { Rng } from './rng';
import type { DeathCause, Simulation, Tracker } from './simulation';
import { P } from './params';
import { SplitInfo, updateSpecies, VERDICT_TEXT } from './species';
import { T, TR } from './traits';

/**
 * Instrumentação (somente leitura): ajuda a entender O QUE aconteceu sem alterar a simulação nem
 * apresentar hipóteses como fatos. Tudo aqui descreve estados medidos; interpretações ficam rotuladas.
 */

const NICHE: number[] = [G.SIZE, G.PHOTO, G.OSMO, G.PRED, G.TOPT, G.MOTIL, G.DEFENSE, G.TTOL];

// ------------------------------------------------------------------ diversidade genética
export interface GeneticSnapshot {
  tick: number;
  pop: number;
  speciesAlive: number;
  dominantShare: number;
  /** variância por gene (população inteira) */
  geneVar: number[];
  geneMean: number[];
  /** soma das variâncias dos genes de nicho (tamanho, fotossíntese, predação, temperatura…) */
  nicheVariance: number;
  /** soma das variâncias dos genes morfológicos (Etapa 3) */
  morphVariance: number;
  /** distância média ao centroide da espécie dominante (amostra de até 3000 indivíduos) */
  dominantSpread: number;
  /** mutações por nascimento (cumulativo) */
  mutationsPerBirth: number;
}

export function geneticSnapshot(sim: Simulation): GeneticSnapshot {
  const pool = sim.pool;
  const sum = new Float64Array(GENE_COUNT), sq = new Float64Array(GENE_COUNT);
  let n = 0;
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    n++;
    for (let k = 0; k < GENE_COUNT; k++) {
      const v = pool.genes[i * GENE_COUNT + k];
      sum[k] += v;
      sq[k] += v * v;
    }
  }
  const geneVar = Array.from(sum, (_, k) => (n ? Math.max(0, sq[k] / n - (sum[k] / n) ** 2) : 0));
  const geneMean = Array.from(sum, (s) => (n ? s / n : 0));
  let dom = null as null | (typeof sim.species.list)[number];
  for (const s of sim.species.list) if (s.extinctTick < 0 && s.count > (dom?.count ?? 0)) dom = s;
  let spread = 0, cnt = 0;
  if (dom) {
    const step = Math.max(1, Math.floor(dom.count / 3000));
    let seen = 0;
    for (let i = 0; i < pool.used; i++) {
      if (!pool.alive[i] || pool.species[i] !== dom.id) continue;
      if (seen++ % step) continue;
      spread += geneDistance(pool.genes, i * GENE_COUNT, dom.centroid, 0);
      cnt++;
    }
  }
  return {
    tick: sim.tick,
    pop: n,
    speciesAlive: sim.species.aliveCount(),
    dominantShare: dom && n ? dom.count / n : 0,
    geneVar,
    geneMean,
    nicheVariance: NICHE.reduce((a, k) => a + geneVar[k], 0),
    morphVariance: geneVar.slice(BASE_GENES).reduce((a, b) => a + b, 0),
    dominantSpread: cnt ? spread / cnt : 0,
    mutationsPerBirth: sim.birthsTotal ? sim.mutationsTotal / sim.birthsTotal : 0,
  };
}

// ------------------------------------------------------------------ frequência de características
export interface TraitFrequencies {
  pop: number;
  /** fração da população que expressa cada estrutura */
  structures: Record<string, number>;
  /** valores médios (0..1) dos genes principais */
  means: Record<string, number>;
  onLand: number;
}

const STRUCT: [string, number][] = [
  ['segmentos', T.SEG], ['membros', T.LIMBS], ['nadadeiras', T.FINS], ['olhos', T.EYES], ['camuflagem', T.CAMO],
  ['escalada', T.CLIMB], ['adaptação terrestre', T.TERR], ['antenas', T.ANT], ['cauda', T.TAIL], ['cefalização', T.HEAD],
];
const MEAN_GENES: [string, number][] = [['tamanho', G.SIZE], ['fotossíntese', G.PHOTO], ['detritos', G.OSMO], ['predação', G.PRED], ['motilidade', G.MOTIL], ['defesa', G.DEFENSE], ['T ótima', G.TOPT], ['tolerância T', G.TTOL]];

export function traitFrequencies(sim: Simulation): TraitFrequencies {
  const pool = sim.pool;
  const cnt = STRUCT.map(() => 0), mean = MEAN_GENES.map(() => 0);
  let n = 0, onLand = 0;
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    n++;
    STRUCT.forEach(([, k], j) => { if (pool.tr[i * TR + k] > 0) cnt[j]++; });
    MEAN_GENES.forEach(([, g], j) => { mean[j] += pool.genes[i * GENE_COUNT + g]; });
    if (sim.stage3 && sim.planet.land[pool.cell[i]]) onLand++;
  }
  const structures: Record<string, number> = {};
  STRUCT.forEach(([name], j) => (structures[name] = n ? cnt[j] / n : 0));
  const means: Record<string, number> = {};
  MEAN_GENES.forEach(([name], j) => (means[name] = n ? mean[j] / n : 0));
  return { pop: n, structures, means, onLand };
}

// ------------------------------------------------------------------ pressões ambientais atuantes
export interface PressureItem {
  key: string;
  label: string;
  /** indicador 0..1 (quanto maior, mais intensa a pressão medida) */
  level: number;
  detail: string;
}
export interface PressureReport {
  tick: number;
  items: PressureItem[];
  /** pressão com maior indicador (apenas descritivo) */
  dominant: string | null;
  /** alterações ambientais em curso */
  environment: string[];
}

export function pressureReport(sim: Simulation): PressureReport {
  const pl = sim.planet, pool = sim.pool;
  let n = 0, tfSum = 0, low = 0;
  const occ = new Map<number, number>();
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    n++;
    const d = (pl.temp[pool.cell[i]] - pool.tr[i * TR + T.TOPT]) / pool.tr[i * TR + T.TWIDTH];
    const tf = Math.exp(-d * d);
    tfSum += tf;
    if (tf < 0.5) low++;
    occ.set(pool.cell[i], (occ.get(pool.cell[i]) ?? 0) + 1);
  }
  const rec = sim.deathsRecent;
  const totalRec = Object.values(rec).reduce((a, b) => a + b, 0) || 1;
  let nut = 0, water = 0;
  for (let i = 0; i < pl.n; i++) if (!(sim.stage3 && pl.land[i])) { nut += pl.nutrient[i]; water++; }
  const nutMean = water ? nut / water : 0;
  const items: PressureItem[] = [];
  items.push({ key: 'thermal', label: 'Temperatura (desajuste térmico)', level: n ? 1 - tfSum / n : 0, detail: n ? `desempenho térmico médio ${(tfSum / n).toFixed(2)}; ${((low / n) * 100).toFixed(0)}% dos indivíduos abaixo de 0,5` : 'sem organismos' });
  items.push({ key: 'food', label: 'Alimento (fome)', level: rec.starve / totalRec, detail: `${((rec.starve / totalRec) * 100).toFixed(0)}% das mortes recentes por fome; nutriente dissolvido médio ${nutMean.toFixed(1)}` });
  items.push({ key: 'predation', label: 'Predação', level: rec.predation / totalRec, detail: `${((rec.predation / totalRec) * 100).toFixed(0)}% das mortes recentes por predação` });
  const crowd = occ.size ? [...occ.values()].reduce((a, b) => a + b, 0) / occ.size : 0;
  items.push({ key: 'competition', label: 'Competição (aglomeração)', level: Math.min(1, crowd / (2 * P.CROWD_SOFT)), detail: `${crowd.toFixed(1)} indivíduos por célula ocupada (aglomeração leve acima de ${P.CROWD_SOFT})` });
  items.push({ key: 'thermal_death', label: 'Estresse térmico (mortes)', level: rec.thermal / totalRec, detail: `${((rec.thermal / totalRec) * 100).toFixed(0)}% das mortes recentes por estresse térmico` });
  if (sim.stage3 && sim.flora) {
    let w = 0;
    for (const i of pl.landCells) w += pl.soilWater[i];
    const mw = pl.landCells.length ? w / pl.landCells.length : 0;
    const fd = sim.flora.deathsTotal;
    const fdt = fd.drought + fd.starve + fd.age + fd.grazed + fd.thermal || 1;
    items.push({ key: 'water', label: 'Água do solo (plantas)', level: Math.max(0, 1 - mw / 0.5), detail: `umidade média do solo ${(mw * 100).toFixed(0)}%; ${((fd.drought / fdt) * 100).toFixed(0)}% das mortes de plantas acumuladas por seca` });
    let cov = 0;
    for (const i of pl.landCells) cov += sim.flora.cover[i];
    items.push({ key: 'light_veg', label: 'Luz sob o dossel (plantas)', level: pl.landCells.length ? Math.min(1, (cov / pl.landCells.length) * 1.2) : 0, detail: `cobertura vegetal média ${((cov / Math.max(1, pl.landCells.length)) * 100).toFixed(0)}% (mais cobertura → mais sombra no chão)` });
  }
  const env: string[] = [];
  if (Math.abs(pl.climateOffset) > 0.05 || pl.climateTarget !== 0) env.push(`clima ${pl.climateOffset >= 0 ? '+' : ''}${pl.climateOffset.toFixed(1)} °C (alvo ${pl.climateTarget >= 0 ? '+' : ''}${pl.climateTarget})`);
  if (pl.aridity !== 1 || pl.aridityTarget !== 1) env.push(`chuvas ${(pl.aridity * 100).toFixed(0)}% (alvo ${(pl.aridityTarget * 100).toFixed(0)}%)`);
  if (pl.lightFactor !== 1 || pl.lightTarget !== 1) env.push(`luz ${(pl.lightFactor * 100).toFixed(0)}% (alvo ${(pl.lightTarget * 100).toFixed(0)}%)`);
  if (pl.regionActive) env.push('zonas climáticas regionais ativas');
  const pend = sim.schedule.filter((c) => !c.applied).length;
  if (pend) env.push(`${pend} mudança(s) programada(s) pendente(s)`);
  if (!sim.geologyOn || pl.seasonAmp === 0) env.push('ambiente estável (sem estações/erupções naturais)');
  const top = [...items].sort((a, b) => b.level - a.level)[0];
  return { tick: sim.tick, items, dominant: top && top.level > 0.05 ? top.key : null, environment: env };
}

// ------------------------------------------------------------------ divergência entre populações
export interface RegionDivergence {
  /** distância (RMS dos genes) entre os centroides das duas populações */
  D: number;
  withinA: number;
  withinB: number;
  /** D / max(dispersões internas) */
  ratio: number;
  nA: number;
  nB: number;
  /** genes que mais diferem entre as populações */
  topGenes: { key: string; label: string; delta: number }[];
}

/** Compara duas populações definidas por `label(cell)` (0 = A, 1 = B, outro = ignorar). */
export function regionDivergence(sim: Simulation, label: (cell: number) => number): RegionDivergence {
  const pool = sim.pool;
  const sums = [new Float64Array(GENE_COUNT), new Float64Array(GENE_COUNT)];
  const cnt = [0, 0];
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    const g = label(pool.cell[i]);
    if (g !== 0 && g !== 1) continue;
    cnt[g]++;
    for (let k = 0; k < GENE_COUNT; k++) sums[g][k] += pool.genes[i * GENE_COUNT + k];
  }
  const cen = sums.map((s, g) => Float32Array.from(s, (v) => (cnt[g] ? v / cnt[g] : 0)));
  const within = [0, 0];
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    const g = label(pool.cell[i]);
    if (g !== 0 && g !== 1) continue;
    within[g] += geneDistance(pool.genes, i * GENE_COUNT, cen[g], 0);
  }
  const wA = cnt[0] ? within[0] / cnt[0] : 0, wB = cnt[1] ? within[1] / cnt[1] : 0;
  const D = cnt[0] && cnt[1] ? geneDistance(cen[0], 0, cen[1], 0) : 0;
  const topGenes = GENE_INFO.map((gi, k) => ({ key: gi.key as string, label: gi.label, delta: cen[1][k] - cen[0][k] }))
    .filter((x) => Math.abs(x.delta) > 0.01)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);
  return { D, withinA: wA, withinB: wB, ratio: D / Math.max(1e-9, Math.max(wA, wB)), nA: cnt[0], nB: cnt[1], topGenes };
}

// ------------------------------------------------------------------ especiação: por que dividiu / não dividiu
export interface SpeciationDiagnosis extends SplitInfo {
  name: string;
  explanation: string;
}

/**
 * Avalia o critério de especiação para cada espécie viva SEM alterar nada (dry-run) e explica o veredito.
 * Usa um RNG descartável: a sequência aleatória da simulação não é consumida.
 */
export function speciationReport(sim: Simulation): SpeciationDiagnosis[] {
  const reg = sim.species;
  const snap = reg.list.map((s) => ({ c: s.centroid.slice(), n: s.count, t: s.trophic }));
  const out: SpeciationDiagnosis[] = [];
  updateSpecies(reg, sim.pool, sim.tick, new Rng(1), undefined, undefined, (info) => {
    const sp = reg.get(info.id);
    let explanation = VERDICT_TEXT[info.verdict];
    if (info.ratio !== undefined) explanation += ` (separação ${info.D!.toFixed(3)} · dispersão interna ${Math.max(info.wA!, info.wB!).toFixed(3)} · razão ${info.ratio.toFixed(2)} / limiar ${P.SPECIATION_GAP})`;
    if (info.verdict === 'homogeneous') explanation += ` (maior afastamento ${info.spread!.toFixed(3)})`;
    out.push({ ...info, name: sp.name, explanation });
  }, true);
  reg.list.forEach((s, i) => { s.centroid.set(snap[i].c); s.count = snap[i].n; s.trophic = snap[i].t; });
  return out.sort((a, b) => b.n - a.n);
}

// ------------------------------------------------------------------ extinções
export interface ExtinctionRecord {
  id: number;
  name: string;
  bornTick: number;
  extinctTick: number;
  peak: number;
  lifespan: number;
  /** causa predominante entre as mortes recentes (provável, não provada) */
  probableCause: string;
  shares: Record<string, number>;
}

export function extinctionReport(sim: Simulation): ExtinctionRecord[] {
  return sim.species.list
    .filter((s) => s.extinctTick >= 0)
    .map((s) => ({ id: s.id, name: s.name, bornTick: s.bornTick, extinctTick: s.extinctTick, peak: s.peak, lifespan: s.extinctTick - s.bornTick, probableCause: s.cause, shares: s.causeShares ?? {} }))
    .sort((a, b) => b.extinctTick - a.extinctTick);
}

// ------------------------------------------------------------------ sobrevivência e reprodução por característica
export interface TraitBin {
  /** faixa do gene (0..1) */
  lo: number;
  hi: number;
  /** organismo-ticks vividos (exposição) */
  exposure: number;
  /** filhos gerados por pais nesta faixa */
  births: number;
  deaths: Record<DeathCause, number>;
  /** reprodução e mortalidade por organismo-tick (taxas comparáveis entre faixas) */
  birthRate: number;
  deathRate: number;
  /** taxa líquida de crescimento por organismo-tick (nascimentos − mortes) */
  netRate: number;
}

/**
 * Rastreador opcional: para alguns genes, acumula exposição, nascimentos e mortes por faixa do gene.
 * Mostra, com dados, quais valores de uma característica estão sendo favorecidos ou penalizados.
 * É só observação: não altera a simulação (nem consome números aleatórios).
 */
export class FitnessTracker implements Tracker {
  private exposure: Float64Array[];
  private births: Float64Array[];
  private deaths: Float64Array[][];
  constructor(private sim: Simulation, public genes: number[] = [G.TOPT, G.SIZE, G.PHOTO, G.PRED, G.DEFENSE, G.MOTIL], public bins = 5) {
    this.exposure = genes.map(() => new Float64Array(bins));
    this.births = genes.map(() => new Float64Array(bins));
    this.deaths = genes.map(() => Array.from({ length: 5 }, () => new Float64Array(bins)));
  }
  private bin(i: number, g: number): number {
    return Math.min(this.bins - 1, Math.floor(this.sim.pool.genes[i * GENE_COUNT + g] * this.bins));
  }
  expose(i: number): void {
    for (let k = 0; k < this.genes.length; k++) this.exposure[k][this.bin(i, this.genes[k])]++;
  }
  birth(parent: number): void {
    for (let k = 0; k < this.genes.length; k++) this.births[k][this.bin(parent, this.genes[k])]++;
  }
  death(i: number, cause: DeathCause): void {
    const ci = ['starve', 'age', 'predation', 'thermal', 'impact'].indexOf(cause);
    for (let k = 0; k < this.genes.length; k++) this.deaths[k][ci][this.bin(i, this.genes[k])]++;
  }
  reset(): void {
    for (const a of [...this.exposure, ...this.births]) a.fill(0);
    for (const g of this.deaths) for (const a of g) a.fill(0);
  }
  summary(): Record<string, TraitBin[]> {
    const out: Record<string, TraitBin[]> = {};
    this.genes.forEach((g, k) => {
      out[GENE_INFO[g].key] = Array.from({ length: this.bins }, (_, b) => {
        const exp = this.exposure[k][b];
        const d = { starve: this.deaths[k][0][b], age: this.deaths[k][1][b], predation: this.deaths[k][2][b], thermal: this.deaths[k][3][b], impact: this.deaths[k][4][b] };
        const dt = d.starve + d.age + d.predation + d.thermal + d.impact;
        const birthRate = exp ? this.births[k][b] / exp : 0, deathRate = exp ? dt / exp : 0;
        return { lo: b / this.bins, hi: (b + 1) / this.bins, exposure: exp, births: this.births[k][b], deaths: d, birthRate, deathRate, netRate: birthRate - deathRate };
      });
    });
    return out;
  }
}

// ------------------------------------------------------------------ colonização de habitats
export interface HabitatReport {
  landFraction: number;
  /** organismos (animais/protistas) em células de terra */
  animalsOnLand: number;
  /** células de terra com ao menos um animal */
  landCellsWithAnimals: number;
  plants: number;
  /** células de terra com plantas / total de células de terra */
  plantCoverage: number;
  /** estruturas necessárias para a vida terrestre presentes na população (fração) */
  landCapable: number;
}

export function habitatReport(sim: Simulation): HabitatReport {
  const pl = sim.planet, pool = sim.pool;
  const cells = new Set<number>();
  let on = 0, capable = 0, n = 0;
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    n++;
    if (pool.tr[i * TR + T.TERR] > 0 && pool.tr[i * TR + T.LSPEED] > 0) capable++;
    if (sim.stage3 && pl.land[pool.cell[i]]) { on++; cells.add(pool.cell[i]); }
  }
  let covered = 0;
  if (sim.flora) for (const i of pl.landCells) if (sim.flora.cellCount[i] > 0) covered++;
  return {
    landFraction: pl.n ? pl.landCells.length / pl.n : 0,
    animalsOnLand: on,
    landCellsWithAnimals: cells.size,
    plants: sim.flora ? sim.flora.pool.count : 0,
    plantCoverage: pl.landCells.length ? covered / pl.landCells.length : 0,
    landCapable: n ? capable / n : 0,
  };
}

// ------------------------------------------------------------------ resumo único (UI / IA)
export interface DiagnosticsReport {
  genetic: GeneticSnapshot;
  traits: TraitFrequencies;
  pressure: PressureReport;
  speciation: SpeciationDiagnosis[];
  extinctions: ExtinctionRecord[];
  habitat: HabitatReport;
}

export function diagnosticsReport(sim: Simulation): DiagnosticsReport {
  return {
    genetic: geneticSnapshot(sim),
    traits: traitFrequencies(sim),
    pressure: pressureReport(sim),
    speciation: speciationReport(sim).slice(0, 6),
    extinctions: extinctionReport(sim).slice(0, 8),
    habitat: habitatReport(sim),
  };
}
