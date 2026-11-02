import { G, GENE_COUNT, geneDistance } from './genome';
import { OrganismPool } from './organisms';
import { P } from './params';
import { Rng } from './rng';

export type Trophic = 'photo' | 'mixo' | 'osmo' | 'pred' | 'none';

export const TROPHIC_LABEL: Record<Trophic, string> = {
  photo: 'Fotossintético',
  mixo: 'Mixotrófico',
  osmo: 'Decompositor / osmótrofo',
  pred: 'Predador',
  none: 'Oligotrófico',
};

export interface Species {
  id: number;
  name: string;
  parentId: number; // 0 = origem
  bornTick: number;
  extinctTick: number; // -1 enquanto viva
  anchor: Float32Array; // genoma de referência da identidade da espécie
  centroid: Float32Array; // média atual dos genes
  count: number;
  peak: number;
  peakTick: number;
  totalBorn: number;
  trophic: Trophic;
  cause: string; // causa registrada da extinção
}

export function classifyTrophic(g: ArrayLike<number>, o = 0): Trophic {
  const photo = g[o + G.PHOTO], osmo = g[o + G.OSMO], pred = g[o + G.PRED];
  if (pred > 0.3 && pred > photo * 0.8) return 'pred';
  if (photo > 0.3 && photo >= osmo * 0.9) return osmo > 0.35 ? 'mixo' : 'photo';
  if (osmo > 0.22) return 'osmo';
  if (photo > 0.2) return 'photo';
  return 'none';
}

const SYL_A = ['pro', 'ar', 'mic', 'ther', 'ox', 'cy', 'hal', 'neo', 'pa', 'syn', 'lum', 'vor', 'ur', 'ae', 'bio', 'cal', 'dro', 'eu', 'fer', 'gly'];
const SYL_B = ['to', 'ro', 'cho', 'mo', 'ne', 'li', 'ra', 'ta', 'ni', 'phy', 'ba', 'ce', 'do', 'ga', 'xi'];
const SYL_C = ['coccus', 'bacter', 'monas', 'spira', 'zoa', 'phyta', 'cella', 'plasma', 'nema', 'derma', 'ella', 'ina'];

function genusName(rng: Rng): string {
  const s = rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SYL_C);
  return s[0].toUpperCase() + s.slice(1);
}

function epithet(g: ArrayLike<number>): string {
  const tags: [number, string][] = [
    [g[G.PRED] * 1.2, 'praedator'],
    [g[G.PHOTO] * (1 - g[G.PRED]), 'viridis'],
    [g[G.OSMO] * (1 - g[G.PHOTO]) * 1.1, 'detritivorus'],
    [g[G.DEFENSE] * 1.1, 'armatus'],
    [g[G.SPIKE] * 1.05, 'spinosus'],
    [g[G.MOTIL] * 1.1, 'natans'],
    [g[G.SIZE] * 1.1, 'gigas'],
    [(1 - g[G.SIZE]) * 0.6, 'minutus'],
    [g[G.TOPT] > 0.7 ? g[G.TOPT] : 0, 'thermophilus'],
    [g[G.TOPT] < 0.3 ? 1 - g[G.TOPT] : 0, 'cryophilus'],
    [g[G.TTOL] * 0.9, 'versatilis'],
    [g[G.ELONG] * 1.0, 'longus'],
    [g[G.LOBES] * 0.9, 'lobatus'],
    [g[G.FLAG] * 0.8, 'flagellatus'],
  ];
  tags.sort((a, b) => b[0] - a[0]);
  return tags[0][1];
}

export class SpeciesRegistry {
  list: Species[] = []; // id = índice + 1
  get(id: number): Species {
    return this.list[id - 1];
  }
  get size(): number {
    return this.list.length;
  }
  aliveCount(): number {
    let n = 0;
    for (const s of this.list) if (s.extinctTick < 0) n++;
    return n;
  }

  create(parent: Species | null, genes: Float32Array, go: number, tick: number, rng: Rng, name?: string): Species {
    const id = this.list.length + 1;
    const g = new Float32Array(GENE_COUNT);
    for (let i = 0; i < GENE_COUNT; i++) g[i] = genes[go + i];
    let nm = name;
    if (!nm) {
      const genus = parent && rng.next() < 0.7 ? parent.name.split(' ')[0] : genusName(rng);
      let candidate = `${genus} ${epithet(g)}`;
      // nomes únicos
      let k = 2;
      while (this.list.some((s) => s.name === candidate)) candidate = `${genus} ${epithet(g)} ${['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][k++ - 2] ?? k}`;
      nm = candidate;
    }
    const sp: Species = {
      id,
      name: nm,
      parentId: parent ? parent.id : 0,
      bornTick: tick,
      extinctTick: -1,
      anchor: g,
      centroid: new Float32Array(g),
      count: 0,
      peak: 0,
      peakTick: tick,
      totalBorn: 0,
      trophic: classifyTrophic(g),
      cause: '',
    };
    this.list.push(sp);
    return sp;
  }

  toJSON() {
    return this.list.map((s) => ({ ...s, anchor: Array.from(s.anchor), centroid: Array.from(s.centroid) }));
  }
  static fromJSON(data: any[]): SpeciesRegistry {
    const r = new SpeciesRegistry();
    r.list = data.map((s) => ({ ...s, anchor: Float32Array.from(s.anchor), centroid: Float32Array.from(s.centroid) }));
    return r;
  }
}

export interface SpeciationEvent {
  kind: 'speciation' | 'anagenesis';
  species: Species;
  parent: Species;
  size: number;
  reason: string;
}

const NICHE_GENES = [G.SIZE, G.PHOTO, G.OSMO, G.PRED, G.TOPT, G.MOTIL, G.DEFENSE, G.TTOL];

/**
 * Especiação: agrupamentos geneticamente coerentes que se afastaram do genoma-âncora
 * da espécie E que estão isolados (geograficamente ou por nicho ecológico) tornam-se
 * uma nova espécie. Quando a espécie inteira deriva, a âncora é atualizada (anagênese).
 * A IA não participa: a decisão é puramente genética/ecológica.
 */
export function updateSpecies(
  reg: SpeciesRegistry,
  pool: OrganismPool,
  tick: number,
  rng: Rng,
  threshold: number = P.SPECIATION_THRESHOLD,
): SpeciationEvent[] {
  const S = reg.size + 1;
  const cnt = new Int32Array(S);
  const sum = new Float64Array(S * GENE_COUNT);
  const sx = new Float64Array(S), sy = new Float64Array(S), sxx = new Float64Array(S), syy = new Float64Array(S);
  const { alive, species, genes, x, y } = pool;
  for (let i = 0; i < pool.used; i++) {
    if (!alive[i]) continue;
    const s = species[i];
    cnt[s]++;
    const o = i * GENE_COUNT;
    for (let k = 0; k < GENE_COUNT; k++) sum[s * GENE_COUNT + k] += genes[o + k];
    sx[s] += x[i]; sy[s] += y[i]; sxx[s] += x[i] * x[i]; syy[s] += y[i] * y[i];
  }
  for (let id = 1; id < S; id++) {
    const sp = reg.get(id);
    if (cnt[id] > 0) {
      for (let k = 0; k < GENE_COUNT; k++) sp.centroid[k] = sum[id * GENE_COUNT + k] / cnt[id];
      sp.trophic = classifyTrophic(sp.centroid);
    }
    sp.count = cnt[id];
  }

  // passo 2: divergentes da âncora
  const divCnt = new Int32Array(S);
  const divSum = new Float64Array(S * GENE_COUNT);
  const eligible = new Uint8Array(S);
  for (let id = 1; id < S; id++) eligible[id] = cnt[id] >= P.MIN_SPECIES_FOR_SPLIT && reg.get(id).extinctTick < 0 ? 1 : 0;
  for (let i = 0; i < pool.used; i++) {
    if (!alive[i]) continue;
    const s = species[i];
    if (!eligible[s]) continue;
    const o = i * GENE_COUNT;
    if (geneDistance(genes, o, reg.get(s).anchor, 0) > threshold) {
      divCnt[s]++;
      for (let k = 0; k < GENE_COUNT; k++) divSum[s * GENE_COUNT + k] += genes[o + k];
    }
  }

  const out: SpeciationEvent[] = [];
  const candidates: { id: number; k: Float32Array }[] = [];
  for (let id = 1; id < S; id++) {
    if (!eligible[id] || divCnt[id] === 0) continue;
    const sp = reg.get(id);
    if (divCnt[id] / cnt[id] > 0.85) {
      // a espécie inteira derivou: anagênese
      sp.anchor.set(sp.centroid);
      continue;
    }
    if (divCnt[id] < P.SPECIATION_MIN_CLUSTER) continue;
    const k = new Float32Array(GENE_COUNT);
    for (let j = 0; j < GENE_COUNT; j++) k[j] = divSum[id * GENE_COUNT + j] / divCnt[id];
    candidates.push({ id, k });
  }
  if (candidates.length === 0) return out;

  // passo 3: membros coerentes do agrupamento
  const byS = new Map<number, number[]>();
  const kOf = new Map<number, Float32Array>();
  for (const c of candidates) {
    byS.set(c.id, []);
    kOf.set(c.id, c.k);
  }
  for (let i = 0; i < pool.used; i++) {
    if (!alive[i]) continue;
    const s = species[i];
    const k = kOf.get(s);
    if (!k) continue;
    const o = i * GENE_COUNT;
    if (geneDistance(genes, o, k, 0) < threshold * 0.75 && geneDistance(genes, o, reg.get(s).anchor, 0) > threshold * 0.8) byS.get(s)!.push(i);
  }
  for (const c of candidates) {
    const members = byS.get(c.id)!;
    if (members.length < P.SPECIATION_MIN_CLUSTER) continue;
    const sp = reg.get(c.id);
    // estatísticas do agrupamento vs o resto
    const m = members.length;
    const rest = cnt[c.id] - m;
    if (rest < 1) continue;
    const mg = new Float64Array(GENE_COUNT);
    let mx = 0, my = 0;
    for (const i of members) {
      for (let k = 0; k < GENE_COUNT; k++) mg[k] += genes[i * GENE_COUNT + k];
      mx += x[i]; my += y[i];
    }
    for (let k = 0; k < GENE_COUNT; k++) mg[k] /= m;
    mx /= m; my /= m;
    const rx = (sx[c.id] - mx * m) / rest, ry = (sy[c.id] - my * m) / rest;
    const varx = Math.max(0, sxx[c.id] / cnt[c.id] - (sx[c.id] / cnt[c.id]) ** 2);
    const vary = Math.max(0, syy[c.id] / cnt[c.id] - (sy[c.id] / cnt[c.id]) ** 2);
    const sd = Math.sqrt(varx + vary);
    const sep = Math.hypot(mx - rx, my - ry);
    const geographic = sep > Math.max(4, 1.1 * sd);
    let niche = 0;
    for (const k of NICHE_GENES) {
      const restMean = (sum[c.id * GENE_COUNT + k] - mg[k] * m) / rest;
      niche += Math.abs(mg[k] - restMean);
    }
    niche /= NICHE_GENES.length;
    const ecological = niche > 0.1;
    if (!geographic && !ecological) continue;

    const gArr = Float32Array.from(mg);
    const child = reg.create(sp, gArr, 0, tick, rng);
    child.count = m;
    child.peak = m;
    child.centroid.set(gArr);
    for (const i of members) species[i] = child.id;
    sp.count -= m;
    out.push({
      kind: 'speciation',
      species: child,
      parent: sp,
      size: m,
      reason: geographic && ecological ? 'isolamento geográfico e ecológico' : geographic ? 'isolamento geográfico' : 'divergência de nicho ecológico',
    });
  }
  return out;
}
