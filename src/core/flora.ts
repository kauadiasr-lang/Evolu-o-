import { Rng } from './rng';
import type { Planet } from './world';

/**
 * Flora procedural (Etapa 3). Plantas são indivíduos (SoA) com genoma próprio, hereditário e mutável.
 * Competem por LUZ (as altas sombreiam as baixas), ÁGUA (solo compartilhado) e NUTRIENTES (a mesma
 * reserva de massa conservada do oceano). Toda característica tem custo: altura, raízes, folhas largas,
 * tolerância à seca e à sombra cobram manutenção ou desempenho.
 */
export const PG = { HEIGHT: 0, LEAF: 1, DENSITY: 2, ROOT: 3, PIGMENT: 4, SHADE: 5, DROUGHT: 6, TOPT: 7, TTOL: 8, REPRO: 9, MUT: 10 } as const;
export const PLANT_GENES = 11;
export const MAX_PER_CELL = 5;
/** altura realizada = min(altura genética, HK·√massa): plantas jovens ainda não atingiram o porte final */
export const HK = 0.85;

export const PLANT_GENE_INFO: { key: keyof typeof PG; label: string; weight: number }[] = [
  { key: 'HEIGHT', label: 'Altura', weight: 1 },
  { key: 'LEAF', label: 'Largura da folha', weight: 0.7 },
  { key: 'DENSITY', label: 'Densidade foliar', weight: 0.7 },
  { key: 'ROOT', label: 'Profundidade das raízes', weight: 0.8 },
  { key: 'PIGMENT', label: 'Pigmentação (verde ↔ vermelho/ocre)', weight: 0.5 },
  { key: 'SHADE', label: 'Tolerância à sombra', weight: 0.8 },
  { key: 'DROUGHT', label: 'Tolerância à seca', weight: 0.8 },
  { key: 'TOPT', label: 'Temperatura ótima', weight: 1 },
  { key: 'TTOL', label: 'Tolerância térmica', weight: 0.7 },
  { key: 'REPRO', label: 'Investimento em sementes', weight: 0.5 },
  { key: 'MUT', label: 'Taxa de mutação', weight: 0.2 },
];
const PW = Float64Array.from(PLANT_GENE_INFO.map((g) => g.weight));
const PWSUM = PW.reduce((a, b) => a + b, 0);

export function plantDistance(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number): number {
  let s = 0;
  for (let i = 0; i < PLANT_GENES; i++) {
    const d = a[ao + i] - b[bo + i];
    s += PW[i] * d * d;
  }
  return Math.sqrt(s / PWSUM);
}

/** Parâmetros de balanço da flora (unidades abstratas, como no restante do motor). */
export const FP = {
  PHOTO: 2.4,
  UPKEEP: 0.062,
  GROW: 0.055,
  BUILD: 2.0,
  NUT_SHARE: 0.3,
  WATER_USE: 0.004,
  LIGHT_K: 0.9, // atenuação do dossel (Beer–Lambert)
  RESERVE: 0.8,
  REPRO_COST: 1.2,
  MIN_AGE: 12,
  LINEAGE_DIST: 0.2,
} as const;

export type GrowthForm = 'musgo' | 'erva' | 'gramínea' | 'arbusto' | 'árvore' | 'suculenta';
export const FORM_INDEX: Record<GrowthForm, number> = { musgo: 0, erva: 1, gramínea: 2, arbusto: 3, árvore: 4, suculenta: 5 };
export const FORMS: GrowthForm[] = ['musgo', 'erva', 'gramínea', 'arbusto', 'árvore', 'suculenta'];

/** Forma de crescimento: depende só do genoma (aparência herdável). */
export function plantForm(g: ArrayLike<number>, o = 0): GrowthForm {
  const h = g[o + PG.HEIGHT];
  if (h < 0.1) return 'musgo';
  if (g[o + PG.DROUGHT] > 0.62 && g[o + PG.LEAF] < 0.45) return 'suculenta';
  if (h > 0.55) return 'árvore';
  if (h > 0.28) return 'arbusto';
  if (g[o + PG.LEAF] < 0.5) return 'gramínea';
  return 'erva';
}

/** Altura máxima (unidades de altura do mundo) determinada pelo genoma. */
export const maxHeight = (g: ArrayLike<number>, o: number) => 0.15 + 5 * g[o + PG.HEIGHT];
/** Matiz do pigmento em graus (ocre/vermelho → verde). */
export const pigmentHue = (v: number) => 24 + 112 * v;

export interface PlantLineage {
  id: number;
  name: string;
  parentId: number;
  bornTick: number;
  extinctTick: number;
  anchor: Float32Array;
  centroid: Float32Array;
  count: number;
  peak: number;
  form: GrowthForm;
}

export class PlantPool {
  used = 0;
  count = 0;
  nextId = 1;
  alive: Uint8Array;
  id: Uint32Array;
  lineage: Uint32Array;
  gen: Uint32Array;
  age: Uint32Array;
  cell: Int32Array;
  genes: Float32Array;
  mass: Float64Array;
  energy: Float64Array;
  private free: Int32Array;
  private freeTop = 0;
  constructor(readonly cap: number) {
    this.alive = new Uint8Array(cap);
    this.id = new Uint32Array(cap);
    this.lineage = new Uint32Array(cap);
    this.gen = new Uint32Array(cap);
    this.age = new Uint32Array(cap);
    this.cell = new Int32Array(cap);
    this.genes = new Float32Array(cap * PLANT_GENES);
    this.mass = new Float64Array(cap);
    this.energy = new Float64Array(cap);
    this.free = new Int32Array(cap);
  }
  alloc(): number {
    let i: number;
    if (this.freeTop > 0) i = this.free[--this.freeTop];
    else if (this.used < this.cap) i = this.used++;
    else return -1;
    this.alive[i] = 1;
    this.id[i] = this.nextId++;
    this.count++;
    return i;
  }
  release(i: number): void {
    this.alive[i] = 0;
    this.count--;
    this.free[this.freeTop++] = i;
  }
  exportFree(): Int32Array {
    return this.free.slice(0, this.freeTop);
  }
  importFree(f: ArrayLike<number>): void {
    this.freeTop = f.length;
    for (let i = 0; i < f.length; i++) this.free[i] = f[i];
    this.count = 0;
    for (let i = 0; i < this.used; i++) if (this.alive[i]) this.count++;
  }
}

const SYL_A = ['flo', 'ver', 'arb', 'sil', 'her', 'mus', 'fol', 'ram', 'cor', 'lig', 'xer', 'hel'];
const SYL_B = ['ra', 'di', 'ne', 'to', 'ca', 'li', 'mo', 'pha'];
const SYL_C = ['phyta', 'dendron', 'folia', 'caulis', 'radix', 'ella', 'ia', 'ium'];
const EPI: Record<GrowthForm, string> = { musgo: 'muscoides', erva: 'herbacea', gramínea: 'graminea', arbusto: 'frutescens', árvore: 'arborea', suculenta: 'succulenta' };

export interface FloraSnapshot {
  n: number;
  x: Float32Array;
  y: Float32Array;
  /** por planta: [altura, folha, densidade, raiz, pigmento, sombra, seca, maturidade, forma] */
  vis: Uint8Array;
}
export const PVIS = 9;
const DEATH_KEYS = ['drought', 'starve', 'thermal', 'age'] as const;

export class Flora {
  readonly pool: PlantPool;
  readonly rng: Rng;
  lineages: PlantLineage[] = [];
  colonized = false;
  now = 0;
  births = 0;
  deathsTotal = { drought: 0, starve: 0, age: 0, grazed: 0, thermal: 0 };
  /** agregados por célula (atualizados a cada passo) */
  lai: Float32Array;
  understory: Float32Array;
  cover: Float32Array;
  vegHue: Float32Array;
  meanHeight: Float32Array;
  cellMass: Float32Array;
  cellCount: Uint8Array;
  slots: Int32Array;

  constructor(readonly nCells: number, cap: number, seed: number) {
    this.pool = new PlantPool(cap);
    this.rng = new Rng(seed);
    this.lai = new Float32Array(nCells);
    this.understory = new Float32Array(nCells).fill(1);
    this.cover = new Float32Array(nCells);
    this.vegHue = new Float32Array(nCells);
    this.meanHeight = new Float32Array(nCells);
    this.cellMass = new Float32Array(nCells);
    this.cellCount = new Uint8Array(nCells);
    this.slots = new Int32Array(nCells * MAX_PER_CELL).fill(-1);
  }

  plantAt(c: number, k: number): number {
    return this.slots[c * MAX_PER_CELL + k];
  }
  addToCell(c: number, i: number): boolean {
    const k = this.cellCount[c];
    if (k >= MAX_PER_CELL) return false;
    this.slots[c * MAX_PER_CELL + k] = i;
    this.cellCount[c] = k + 1;
    this.pool.cell[i] = c;
    return true;
  }
  removeFromCell(c: number, i: number): void {
    const k = this.cellCount[c];
    const base = c * MAX_PER_CELL;
    for (let q = 0; q < k; q++) {
      if (this.slots[base + q] === i) {
        this.slots[base + q] = this.slots[base + k - 1];
        this.slots[base + k - 1] = -1;
        this.cellCount[c] = k - 1;
        return;
      }
    }
  }

  // ------------------------------------------------------------------ linhagens
  newLineage(parent: PlantLineage | null, genes: Float32Array, go: number, tick: number): PlantLineage {
    const g = new Float32Array(PLANT_GENES);
    for (let k = 0; k < PLANT_GENES; k++) g[k] = genes[go + k];
    const form = plantForm(g);
    const genus = parent && this.rng.next() < 0.7 ? parent.name.split(' ')[0] : (SYL_A[this.rng.int(SYL_A.length)] + SYL_B[this.rng.int(SYL_B.length)] + SYL_C[this.rng.int(SYL_C.length)]).replace(/^./, (c) => c.toUpperCase());
    let name = `${genus} ${EPI[form]}`;
    let n = 2;
    while (this.lineages.some((l) => l.name === name)) name = `${genus} ${EPI[form]} ${['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n++ - 2] ?? n}`;
    const l: PlantLineage = { id: this.lineages.length + 1, name, parentId: parent ? parent.id : 0, bornTick: tick, extinctTick: -1, anchor: g, centroid: new Float32Array(g), count: 0, peak: 0, form };
    this.lineages.push(l);
    return l;
  }

  /** Cria uma planta retirando `mass` do nutriente da célula (conserva a massa). */
  plant(planetNutrient: Float64Array, c: number, genes: Float32Array, go: number, mass: number, tick: number, lineage?: PlantLineage): number {
    if (this.cellCount[c] >= MAX_PER_CELL || planetNutrient[c] < mass * 0.8) return -1;
    const i = this.pool.alloc();
    if (i < 0) return -1;
    const take = Math.min(mass, planetNutrient[c]);
    planetNutrient[c] -= take;
    for (let k = 0; k < PLANT_GENES; k++) this.pool.genes[i * PLANT_GENES + k] = genes[go + k];
    this.addToCell(c, i);
    this.pool.mass[i] = take;
    this.pool.energy[i] = take * 3;
    this.pool.age[i] = 0;
    this.pool.gen[i] = 0;
    const lin = lineage ?? this.newLineage(null, genes, go, tick);
    this.pool.lineage[i] = lin.id;
    lin.count++;
    if (lin.count > lin.peak) lin.peak = lin.count;
    return i;
  }

  /** Genoma pioneiro: musgo/erva rasteira de tolerância moderada (colonizadora das margens). */
  static pioneerGenes(rng: Rng, out: Float32Array, o: number): void {
    const v = (m: number, s: number) => Math.min(1, Math.max(0, m + rng.gauss() * s));
    out[o + PG.HEIGHT] = v(0.07, 0.025);
    out[o + PG.LEAF] = v(0.5, 0.1);
    out[o + PG.DENSITY] = v(0.5, 0.1);
    out[o + PG.ROOT] = v(0.2, 0.07);
    out[o + PG.PIGMENT] = v(0.7, 0.1);
    out[o + PG.SHADE] = v(0.6, 0.1);
    out[o + PG.DROUGHT] = v(0.3, 0.1);
    out[o + PG.TOPT] = v(0.5, 0.1);
    out[o + PG.TTOL] = v(0.5, 0.1);
    out[o + PG.REPRO] = v(0.3, 0.1);
    out[o + PG.MUT] = v(0.35, 0.05);
  }

  inheritPlant(src: number, dst: number): void {
    const g = this.pool.genes, rng = this.rng;
    const p = 0.02 + 0.08 * g[src * PLANT_GENES + PG.MUT];
    for (let k = 0; k < PLANT_GENES; k++) {
      let v = g[src * PLANT_GENES + k];
      if (rng.next() < p) {
        v += rng.gauss() * (rng.next() < 0.1 ? 0.14 : 0.05);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      g[dst * PLANT_GENES + k] = v;
    }
  }

  /** Massa total de plantas (para o balanço de matéria). */
  totalMass(): number {
    let m = 0;
    for (let i = 0; i < this.pool.used; i++) if (this.pool.alive[i]) m += this.pool.mass[i];
    return m;
  }

  /** Remove uma planta devolvendo sua massa ao solo como detrito. */
  kill(i: number, detritus: Float64Array, cause: keyof Flora['deathsTotal'], bgHue: Float32Array): void {
    const c = this.pool.cell[i];
    detritus[c] += this.pool.mass[i];
    const lin = this.lineages[this.pool.lineage[i] - 1];
    lin.count--;
    if (lin.count <= 0 && lin.extinctTick < 0) lin.extinctTick = this.now;
    this.removeFromCell(c, i);
    this.pool.release(i);
    this.deathsTotal[cause]++;
    if (this.cellCount[c] === 0) {
      bgHue[c] = 34;
      this.lai[c] = 0;
      this.understory[c] = 1;
      this.cover[c] = 0;
      this.cellMass[c] = 0;
      this.meanHeight[c] = 0;
    }
  }

  /** Colonização pioneira das margens: sementes de musgo/erva tolerante, com massa vinda do solo. */
  colonize(planet: Planet, tick: number, count = 24): number {
    this.now = tick;
    const w = planet.w, h = planet.h;
    const coast: number[] = [];
    for (let k = 0; k < planet.landCells.length; k++) {
      const c = planet.landCells[k];
      const x = c % w, y = (c / w) | 0;
      const nb = [y > 0 ? c - w : -1, y + 1 < h ? c + w : -1, y * w + ((x + 1) % w), y * w + ((x - 1 + w) % w)];
      if (nb.some((q) => q >= 0 && !planet.land[q]) && planet.soilWater[c] > 0.12 && planet.temp[c] > -2 && planet.temp[c] < 38) coast.push(c);
    }
    for (let i = coast.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [coast[i], coast[j]] = [coast[j], coast[i]];
    }
    const tmp = new Float32Array(PLANT_GENES);
    let founder: PlantLineage | undefined;
    let n = 0;
    for (const c of coast) {
      if (n >= count) break;
      Flora.pioneerGenes(this.rng, tmp, 0);
      // população fundadora diversa (vários tipos de algas/briófitas já adaptadas à margem)
      const r = this.rng.next();
      if (r < 0.3) {
        tmp[PG.HEIGHT] = 0.12 + 0.4 * this.rng.next();
        tmp[PG.ROOT] = 0.3 + 0.4 * this.rng.next();
        tmp[PG.SHADE] = 0.2 + 0.4 * this.rng.next();
      } else if (r < 0.5) {
        tmp[PG.DROUGHT] = 0.55 + 0.4 * this.rng.next();
        tmp[PG.LEAF] = 0.15 + 0.25 * this.rng.next();
      }
      if (!founder) founder = this.newLineage(null, tmp, 0, tick);
      if (this.plant(planet.nutrient, c, tmp, 0, 0.8, tick, founder) >= 0) n++;
    }
    if (n > 0) this.colonized = true;
    return n;
  }

  /** Herbívoro morde uma planta ao alcance. Devolve a massa retirada (o chamador a distribui). */
  graze(planet: Planet, c: number, reach: number, want: number): number {
    const k = this.cellCount[c];
    if (!k) return 0;
    const p = this.pool;
    const start = this.rng.int(k);
    for (let q = 0; q < k; q++) {
      const i = this.slots[c * MAX_PER_CELL + ((start + q) % k)];
      const hmax = maxHeight(p.genes, i * PLANT_GENES);
      const hh = Math.min(hmax, HK * Math.sqrt(p.mass[i]));
      if (hh > reach) continue; // fora do alcance: árvores altas escapam de quem não escala
      const eat = Math.min(want, p.mass[i] * 0.2);
      p.mass[i] -= eat;
      if (p.mass[i] < 0.15) this.kill(i, planet.detritus, 'grazed', planet.bgHue);
      return eat;
    }
    return 0;
  }

  /** Um tick da flora: luz (com sombreamento), água, nutrientes, crescimento, reprodução e morte. */
  step(planet: Planet, tick: number): void {
    this.now = tick;
    const p = this.pool, g = p.genes, rng = this.rng;
    const lc = planet.landCells;
    const w = planet.w, h = planet.h;
    const ids = this.idsBuf, hts = this.hBuf, areas = this.aBuf, order = this.oBuf;
    const dead: number[] = [];
    for (let kk = 0; kk < lc.length; kk++) {
      const c = lc[kk];
      const cnt = this.cellCount[c];
      if (cnt === 0) continue;
      const base = c * MAX_PER_CELL;
      const T = planet.temp[c], L0 = planet.light[c];
      let W = planet.soilWater[c];
      for (let q = 0; q < cnt; q++) {
        const i = this.slots[base + q];
        const o = i * PLANT_GENES, m = p.mass[i];
        ids[q] = i;
        hts[q] = Math.min(maxHeight(g, o), HK * Math.sqrt(m));
        areas[q] = (0.25 + 1.2 * g[o + PG.DENSITY]) * (0.5 + 0.9 * g[o + PG.LEAF]) * Math.cbrt(m * m) * 0.35;
        order[q] = q;
      }
      for (let a = 1; a < cnt; a++) {
        const v = order[a];
        let b = a - 1;
        while (b >= 0 && hts[order[b]] < hts[v]) { order[b + 1] = order[b]; b--; }
        order[b + 1] = v;
      }
      let cum = 0, hw = 0, mw = 0, hueW = 0;
      dead.length = 0;
      for (let r = 0; r < cnt; r++) {
        const q = order[r];
        const i = ids[q], o = i * PLANT_GENES;
        let m = p.mass[i], energy = p.energy[i];
        const A = areas[q];
        // luz: as plantas mais altas sombreiam as de baixo (Beer–Lambert)
        const light = L0 * Math.exp(-FP.LIGHT_K * cum);
        const shadeT = g[o + PG.SHADE], pig = g[o + PG.PIGMENT];
        const Pmax = FP.PHOTO * (1 - 0.35 * shadeT) * (0.8 + 0.4 * pig);
        const eff = light / (light + 0.12 + 0.5 * (1 - shadeT));
        const d = (T - (-5 + 50 * g[o + PG.TOPT])) / (3 + 14 * g[o + PG.TTOL] + 4 * (1 - pig));
        const tf = Math.exp(-d * d);
        // água compartilhada do solo: raízes profundas alcançam mais; folhas largas transpiram mais
        const demand = A * (1.1 - 0.7 * g[o + PG.DROUGHT]);
        const ws = demand > 1e-6 ? Math.min(1, (W * (0.4 + 1.2 * g[o + PG.ROOT])) / demand) : 1;
        W = Math.max(0, W - demand * FP.WATER_USE * ws);
        const gain = Pmax * A * eff * tf * ws * (1 - 0.25 * g[o + PG.DROUGHT]);
        const hmaxN = maxHeight(g, o) / 5.15;
        const q10 = Math.min(2.5, Math.max(0.3, Math.exp(0.05 * (T - 15))));
        const upkeep = FP.UPKEEP * Math.pow(m, 0.75) * (1 + 0.5 * hmaxN * Math.sqrt(hmaxN) + 0.2 * g[o + PG.ROOT] + 0.35 * g[o + PG.DROUGHT] + 0.25 * g[o + PG.DENSITY]) * q10 * (1 + 0.9 * (1 - tf));
        energy += gain - upkeep;
        // crescimento: nutrientes da mesma reserva conservada do planeta
        const hGene = g[o + PG.HEIGHT];
        const mrepro = 1.2 + 14 * Math.pow(hGene, 1.2) * (0.7 + 0.8 * g[o + PG.REPRO]);
        const mmax = mrepro * 1.5;
        const reserve = FP.RESERVE * m;
        if (energy > reserve && m < mmax) {
          const nut = planet.nutrient[c];
          if (nut > 0.001) {
            const grow = Math.min(FP.GROW * Math.pow(m, 0.75) * tf * ws, nut * FP.NUT_SHARE * (0.4 + g[o + PG.ROOT]), (energy - reserve) / FP.BUILD, mmax - m);
            if (grow > 0) {
              m += grow;
              energy -= grow * FP.BUILD;
              planet.nutrient[c] = nut - grow;
            }
          }
        }
        if (energy > 4 * m) energy = 4 * m;
        // reprodução: semente dispersa pelo vento (plantas altas dispersam mais longe)
        const age = p.age[i];
        if (m >= mrepro && age >= FP.MIN_AGE) {
          const cf = 0.12 + 0.18 * g[o + PG.REPRO];
          const childMass = m * cf, cost = FP.REPRO_COST * childMass;
          if (energy > cost + reserve * 0.5) {
            const rad = 1 + 3 * hGene;
            const cx = c % w, cy = (c / w) | 0;
            const tx = (((cx + Math.round((rng.next() * 2 - 1) * rad)) % w) + w) % w;
            const ty = Math.min(h - 1, Math.max(0, cy + Math.round((rng.next() * 2 - 1) * rad)));
            const tc = ty * w + tx;
            if (planet.land[tc] && this.cellCount[tc] < MAX_PER_CELL) {
              const j = p.alloc();
              if (j >= 0) {
                this.inheritPlant(i, j);
                p.mass[j] = childMass;
                p.energy[j] = (energy - cost) * cf;
                p.age[j] = 0;
                p.gen[j] = p.gen[i] + 1;
                this.addToCell(tc, j);
                let lin = this.lineages[p.lineage[i] - 1];
                if (lin.count >= 4 && plantDistance(g, j * PLANT_GENES, lin.anchor, 0) > FP.LINEAGE_DIST) lin = this.newLineage(lin, g, j * PLANT_GENES, tick);
                p.lineage[j] = lin.id;
                lin.count++;
                if (lin.count > lin.peak) lin.peak = lin.count;
                m -= childMass;
                energy = (energy - cost) * (1 - cf);
                this.births++;
              }
            }
          }
        }
        p.mass[i] = m;
        p.energy[i] = energy;
        const life = 500 + 4000 * hGene;
        if (energy <= 0) dead.push(i, ws < 0.35 ? 0 : tf < 0.3 ? 2 : 1);
        else if (age > life && rng.next() < ((age - life) / life) * 0.03) dead.push(i, 3);
        else p.age[i] = age + 1;
        cum += A;
        const mm = p.mass[i];
        mw += mm;
        hw += mm * hts[q];
        hueW += mm * pigmentHue(pig);
      }
      planet.soilWater[c] = W;
      for (let k = 0; k < dead.length; k += 2) this.kill(dead[k], planet.detritus, DEATH_KEYS[dead[k + 1]], planet.bgHue);
      if (this.cellCount[c] > 0 && mw > 0) {
        this.lai[c] = cum;
        this.understory[c] = Math.exp(-FP.LIGHT_K * cum);
        this.cover[c] = Math.min(1, cum / 1.1);
        this.cellMass[c] = mw;
        this.meanHeight[c] = hw / mw;
        this.vegHue[c] = hueW / mw;
        planet.bgHue[c] = this.cover[c] > 0.3 ? this.vegHue[c] : 34;
      }
    }
  }
  private idsBuf = new Int32Array(MAX_PER_CELL);
  private hBuf = new Float32Array(MAX_PER_CELL);
  private aBuf = new Float32Array(MAX_PER_CELL);
  private oBuf = new Int32Array(MAX_PER_CELL);

  snapshot(w: number): FloraSnapshot {
    const p = this.pool;
    const n = p.count;
    const x = new Float32Array(n), y = new Float32Array(n), vis = new Uint8Array(n * PVIS);
    let k = 0;
    for (let i = 0; i < p.used; i++) {
      if (!p.alive[i]) continue;
      const c = p.cell[i];
      const jx = ((p.id[i] * 0.6180339) % 1) * 0.7 + 0.15, jy = ((p.id[i] * 0.7548776) % 1) * 0.7 + 0.15;
      x[k] = (c % w) + jx;
      y[k] = ((c / w) | 0) + jy;
      const o = i * PLANT_GENES, v = k * PVIS;
      const q = (t: number) => Math.max(0, Math.min(255, Math.round(t * 255)));
      vis[v] = q(p.genes[o + PG.HEIGHT]);
      vis[v + 1] = q(p.genes[o + PG.LEAF]);
      vis[v + 2] = q(p.genes[o + PG.DENSITY]);
      vis[v + 3] = q(p.genes[o + PG.ROOT]);
      vis[v + 4] = q(p.genes[o + PG.PIGMENT]);
      vis[v + 5] = q(p.genes[o + PG.SHADE]);
      vis[v + 6] = q(p.genes[o + PG.DROUGHT]);
      const hmax = maxHeight(p.genes, o);
      vis[v + 7] = q(Math.min(1, Math.sqrt(p.mass[i]) * HK / hmax));
      vis[v + 8] = FORM_INDEX[plantForm(p.genes, o)];
      k++;
    }
    return { n, x, y, vis };
  }
}
