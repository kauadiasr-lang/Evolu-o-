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
  /** genoma médio ao longo do tempo (para acompanhar mudanças entre gerações) */
  trail: { tick: number; genes: number[] }[];
  /** composição (0..1) das mortes recentes da espécie no momento da extinção — contexto, não prova */
  causeShares?: Record<string, number>;
  /** população no último registro antes da extinção */
  lastPop?: number;
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
      trail: [],
    };
    this.list.push(sp);
    return sp;
  }

  toJSON() {
    return this.list.map((s) => ({ ...s, anchor: Array.from(s.anchor), centroid: Array.from(s.centroid) }));
  }
  static fromJSON(data: any[]): SpeciesRegistry {
    const r = new SpeciesRegistry();
    r.list = data.map((s) => ({ ...s, trail: s.trail ?? [], anchor: Float32Array.from(s.anchor), centroid: Float32Array.from(s.centroid) }));
    return r;
  }
}

/** Resultado da avaliação de divisão de uma espécie (diagnóstico: explica por que ela se dividiu ou não). */
export type SplitVerdict = 'too_small' | 'homogeneous' | 'small_cluster' | 'no_gap' | 'no_isolation' | 'split';
export interface SplitInfo {
  id: number;
  n: number;
  verdict: SplitVerdict;
  nSmall?: number;
  /** separação entre os dois agrupamentos (RMS dos genes) */
  D?: number;
  /** dispersão interna de cada agrupamento */
  wA?: number;
  wB?: number;
  /** D / max(dispersão): precisa passar de SPECIATION_GAP para haver bimodalidade */
  ratio?: number;
  geographic?: boolean;
  niche?: number;
  /** maior distância de um indivíduo ao centroide (espécies homogêneas) */
  spread?: number;
}

export const VERDICT_TEXT: Record<SplitVerdict, string> = {
  too_small: 'população pequena demais para avaliar divisão',
  homogeneous: 'genoma homogêneo: ninguém se afastou do centroide o bastante',
  small_cluster: 'o menor agrupamento é pequeno demais para formar espécie',
  no_gap: 'sem lacuna: a variação é contínua (os agrupamentos não são distintos)',
  no_isolation: 'agrupamentos distintos, mas sem isolamento geográfico nem ecológico',
  split: 'divisão aceita: agrupamentos distintos e isolados',
};

export interface SpeciationEvent {
  kind: 'speciation' | 'anagenesis';
  species: Species;
  parent: Species;
  size: number;
  reason: string;
}

const NICHE_GENES = [G.SIZE, G.PHOTO, G.OSMO, G.PRED, G.TOPT, G.MOTIL, G.DEFENSE, G.TTOL];

/**
 * Especiação por agrupamentos: cada espécie grande é dividida em dois grupos (2-means).
 * Se os grupos estão separados por uma LACUNA genética grande em relação à variação
 * interna (população bimodal) e isolados (geograficamente ou por nicho ecológico),
 * o grupo menor torna-se uma nova espécie. Variação contínua não especia.
 * A IA não participa: a decisão é puramente genética/ecológica.
 */
export function updateSpecies(
  reg: SpeciesRegistry,
  pool: OrganismPool,
  tick: number,
  rng: Rng,
  minDist: number = P.SPECIATION_MIN_DIST,
  gap: number = P.SPECIATION_GAP,
  /** diagnóstico opcional (testes/ferramentas): recebe as métricas de cada candidato à divisão */
  diag?: (info: SplitInfo) => void,
  /** dry-run: só avalia e relata; não cria espécies nem reatribui indivíduos */
  dry = false,
): SpeciationEvent[] {
  const S = reg.size + 1;
  const members: number[][] = Array.from({ length: S }, () => []);
  const { alive, species, genes, x, y } = pool;
  for (let i = 0; i < pool.used; i++) if (alive[i]) members[species[i]].push(i);

  const out: SpeciationEvent[] = [];
  const G_ = GENE_COUNT;
  for (let id = 1; id < S; id++) {
    const sp = reg.get(id);
    const m = members[id];
    sp.count = m.length;
    if (m.length > 0) {
      for (let k = 0; k < G_; k++) {
        let a = 0;
        for (const i of m) a += genes[i * G_ + k];
        sp.centroid[k] = a / m.length;
      }
      sp.trophic = classifyTrophic(sp.centroid);
    }
    if (sp.extinctTick >= 0) continue;
    if (m.length < P.MIN_SPECIES_FOR_SPLIT) {
      if (m.length > 0) diag?.({ id, n: m.length, verdict: 'too_small' });
      continue;
    }

    // 2-means: sementes = organismo mais distante do centroide e o mais distante dele
    let f1 = m[0], bd = -1;
    for (const i of m) {
      const d = geneDistance(genes, i * G_, sp.centroid, 0);
      if (d > bd) { bd = d; f1 = i; }
    }
    if (bd < minDist * 0.5) {
      diag?.({ id, n: m.length, verdict: 'homogeneous', spread: bd });
      continue;
    } // espécie homogênea
    let f2 = f1;
    bd = -1;
    for (const i of m) {
      const d = geneDistance(genes, i * G_, genes, f1 * G_);
      if (d > bd) { bd = d; f2 = i; }
    }
    const cA = new Float64Array(G_), cB = new Float64Array(G_);
    for (let k = 0; k < G_; k++) { cA[k] = genes[f1 * G_ + k]; cB[k] = genes[f2 * G_ + k]; }
    const assign = new Uint8Array(m.length);
    let nA = 0, nB = 0;
    for (let it = 0; it < 5; it++) {
      const sA = new Float64Array(G_), sB = new Float64Array(G_);
      nA = 0; nB = 0;
      for (let q = 0; q < m.length; q++) {
        const o = m[q] * G_;
        let dA = 0, dB = 0;
        for (let k = 0; k < G_; k++) {
          const a = genes[o + k] - cA[k], b = genes[o + k] - cB[k];
          dA += a * a; dB += b * b;
        }
        if (dA <= dB) { assign[q] = 0; nA++; for (let k = 0; k < G_; k++) sA[k] += genes[o + k]; }
        else { assign[q] = 1; nB++; for (let k = 0; k < G_; k++) sB[k] += genes[o + k]; }
      }
      if (nA === 0 || nB === 0) break;
      for (let k = 0; k < G_; k++) { cA[k] = sA[k] / nA; cB[k] = sB[k] / nB; }
    }
    if (nA === 0 || nB === 0) continue;
    const small = nA <= nB ? 0 : 1;
    const nSmall = small === 0 ? nA : nB;
    if (nSmall < P.SPECIATION_MIN_CLUSTER) {
      diag?.({ id, n: m.length, verdict: 'small_cluster', nSmall });
      continue;
    }
    // dispersão interna e separação entre os grupos
    let wA = 0, wB = 0;
    for (let q = 0; q < m.length; q++) {
      const d = geneDistance(genes, m[q] * G_, assign[q] === 0 ? cA : cB, 0);
      if (assign[q] === 0) wA += d; else wB += d;
    }
    wA /= nA; wB /= nB;
    const D = geneDistance(cA, 0, cB, 0);
    const ratio = D / Math.max(1e-9, Math.max(wA, wB));
    if (D < minDist || D < gap * Math.max(wA, wB)) {
      diag?.({ id, n: m.length, verdict: 'no_gap', nSmall, D, wA, wB, ratio });
      continue;
    }

    // isolamento: geográfico e/ou ecológico
    let mx = 0, my = 0, rx = 0, ry = 0, sxx = 0, syy = 0;
    const nRest = m.length - nSmall;
    for (let q = 0; q < m.length; q++) {
      const i = m[q];
      sxx += x[i] * x[i]; syy += y[i] * y[i];
      if (assign[q] === small) { mx += x[i]; my += y[i]; } else { rx += x[i]; ry += y[i]; }
    }
    mx /= nSmall; my /= nSmall; rx /= nRest; ry /= nRest;
    const ax = (mx * nSmall + rx * nRest) / m.length, ay = (my * nSmall + ry * nRest) / m.length;
    const sd = Math.sqrt(Math.max(0, sxx / m.length - ax * ax) + Math.max(0, syy / m.length - ay * ay));
    const geographic = Math.hypot(mx - rx, my - ry) > Math.max(4, 1.1 * sd);
    const cs = small === 0 ? cA : cB, cr = small === 0 ? cB : cA;
    let niche = 0;
    for (const k of NICHE_GENES) niche += Math.abs(cs[k] - cr[k]);
    niche /= NICHE_GENES.length;
    const ecological = niche > 0.08;
    if (!geographic && !ecological) {
      diag?.({ id, n: m.length, verdict: 'no_isolation', nSmall, D, wA, wB, ratio, geographic, niche });
      continue;
    }
    diag?.({ id, n: m.length, verdict: 'split', nSmall, D, wA, wB, ratio, geographic, niche });
    if (dry) continue;

    const gArr = Float32Array.from(cs);
    const child = reg.create(sp, gArr, 0, tick, rng);
    child.count = nSmall;
    child.peak = nSmall;
    child.centroid.set(gArr);
    for (let q = 0; q < m.length; q++) if (assign[q] === small) species[m[q]] = child.id;
    sp.count -= nSmall;
    out.push({
      kind: 'speciation',
      species: child,
      parent: sp,
      size: nSmall,
      reason: geographic && ecological ? 'isolamento geográfico e ecológico' : geographic ? 'isolamento geográfico' : 'divergência de nicho ecológico',
    });
  }
  return out;
}
