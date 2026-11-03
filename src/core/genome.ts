import { Rng } from './rng';

/**
 * Índices dos genes. Todos os genes são reais em [0,1].
 * Genes funcionais afetam fisiologia; genes visuais neutros só deixam marca
 * na aparência (e servem como "relógio" de linhagem por deriva genética).
 */
export const G = {
  SIZE: 0,
  PHOTO: 1,
  OSMO: 2,
  PRED: 3,
  MOTIL: 4,
  SENSE: 5,
  META: 6,
  REPRO: 7,
  INVEST: 8,
  TOPT: 9,
  TTOL: 10,
  DEFENSE: 11,
  MUT: 12,
  AFFIN: 13,
  LONGEV: 14,
  HUE: 15,
  SAT: 16,
  PATTERN: 17,
  ELONG: 18,
  FLAG: 19,
  SPIKE: 20,
  LOBES: 21,
  NUCLEUS: 22,
  SYMM: 23,
  // --- genes morfológicos (Etapa 3): só são expressos se os pré-requisitos existirem (ver phenotype.ts)
  SEGM: 24,
  LIMBS: 25,
  LIMBLEN: 26,
  FINS: 27,
  EYES: 28,
  CAMO: 29,
  CLIMB: 30,
  TERR: 31,
  ANTENNA: 32,
  TAIL: 33,
  HUE2: 34,
  HEAD: 35,
} as const;

/** Genes "clássicos" (Etapas 1-2). Os demais são morfológicos e usam um fluxo de RNG próprio. */
export const BASE_GENES = 24;
export const GENE_COUNT = 36;

export const GENE_INFO: { key: keyof typeof G; label: string; weight: number }[] = [
  { key: 'SIZE', label: 'Tamanho', weight: 1 },
  { key: 'PHOTO', label: 'Fotossíntese', weight: 1 },
  { key: 'OSMO', label: 'Absorção de detritos', weight: 1 },
  { key: 'PRED', label: 'Predação', weight: 1 },
  { key: 'MOTIL', label: 'Motilidade', weight: 1 },
  { key: 'SENSE', label: 'Quimiotaxia', weight: 0.8 },
  { key: 'META', label: 'Metabolismo', weight: 0.8 },
  { key: 'REPRO', label: 'Limiar reprodutivo', weight: 0.7 },
  { key: 'INVEST', label: 'Investimento na prole', weight: 0.7 },
  { key: 'TOPT', label: 'Temperatura ótima', weight: 1 },
  { key: 'TTOL', label: 'Tolerância térmica', weight: 0.8 },
  { key: 'DEFENSE', label: 'Defesa', weight: 1 },
  { key: 'MUT', label: 'Taxa de mutação', weight: 0.3 },
  { key: 'AFFIN', label: 'Afinidade por nutrientes', weight: 0.8 },
  { key: 'LONGEV', label: 'Longevidade', weight: 0.6 },
  { key: 'HUE', label: 'Matiz', weight: 0.5 },
  { key: 'SAT', label: 'Saturação', weight: 0.2 },
  { key: 'PATTERN', label: 'Padrão', weight: 0.25 },
  { key: 'ELONG', label: 'Alongamento', weight: 0.4 },
  { key: 'FLAG', label: 'Flagelos', weight: 0.3 },
  { key: 'SPIKE', label: 'Espinhos', weight: 0.3 },
  { key: 'LOBES', label: 'Lobos da membrana', weight: 0.25 },
  { key: 'NUCLEUS', label: 'Núcleo', weight: 0.15 },
  { key: 'SYMM', label: 'Simetria', weight: 0.2 },
  { key: 'SEGM', label: 'Segmentação', weight: 0.5 },
  { key: 'LIMBS', label: 'Pares de membros', weight: 0.5 },
  { key: 'LIMBLEN', label: 'Comprimento dos membros', weight: 0.3 },
  { key: 'FINS', label: 'Nadadeiras', weight: 0.4 },
  { key: 'EYES', label: 'Olhos', weight: 0.3 },
  { key: 'CAMO', label: 'Camuflagem', weight: 0.4 },
  { key: 'CLIMB', label: 'Escalada', weight: 0.4 },
  { key: 'TERR', label: 'Adaptação terrestre', weight: 0.6 },
  { key: 'ANTENNA', label: 'Antenas', weight: 0.2 },
  { key: 'TAIL', label: 'Cauda propulsora', weight: 0.3 },
  { key: 'HUE2', label: 'Pigmento secundário', weight: 0.2 },
  { key: 'HEAD', label: 'Cefalização', weight: 0.3 },
];

const W = Float64Array.from(GENE_INFO.map((g) => g.weight));
/** Normalização fixa nos genes clássicos: preserva exatamente as distâncias da Etapa 1. */
const WNORM = W.slice(0, BASE_GENES).reduce((a, b) => a + b, 0);

/**
 * Distância genética ponderada (raiz da média quadrática), em [0,1].
 * RMS dá peso a diferenças concentradas em poucos genes (adaptação a um nicho) sem
 * que mutações pequenas e difusas somem rapidamente.
 */
export function geneDistance(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number): number {
  let s = 0;
  for (let i = 0; i < GENE_COUNT; i++) {
    const d = a[ao + i] - b[bo + i];
    s += W[i] * d * d;
  }
  return Math.sqrt(s / WNORM);
}

export interface MutationParams {
  /** Probabilidade base de mutação por gene, multiplicada pelo gene MUT. */
  baseRate: number;
  rateRange: number;
  smallSigma: number;
  bigSigma: number;
  bigProb: number;
}

export const DEFAULT_MUTATION: MutationParams = {
  baseRate: 0.012,
  rateRange: 0.06,
  smallSigma: 0.035,
  bigSigma: 0.14,
  bigProb: 0.06,
};

export function mutationRate(mutGene: number, mp: MutationParams = DEFAULT_MUTATION): number {
  return mp.baseRate + mp.rateRange * mutGene;
}

/**
 * Copia o genoma do pai para o filho aplicando mutações pontuais graduais.
 * Retorna o número de genes alterados.
 */
export function inherit(
  src: Float32Array,
  so: number,
  dst: Float32Array,
  d0: number,
  rng: Rng,
  mp: MutationParams = DEFAULT_MUTATION,
  mrng?: Rng,
): number {
  const p = mutationRate(src[so + G.MUT], mp);
  let n = 0;
  for (let i = 0; i < BASE_GENES; i++) {
    let v = src[so + i];
    if (rng.next() < p) {
      const sigma = rng.next() < mp.bigProb ? mp.bigSigma : mp.smallSigma;
      v += rng.gauss() * sigma;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      n++;
    }
    dst[d0 + i] = v;
  }
  // genes morfológicos: fluxo de RNG separado (a física clássica não é perturbada)
  for (let i = BASE_GENES; i < GENE_COUNT; i++) {
    let v = src[so + i];
    if (mrng && mrng.next() < p) {
      const sigma = mrng.next() < mp.bigProb ? mp.bigSigma : mp.smallSigma;
      v += mrng.gauss() * sigma;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      n++;
    }
    dst[d0 + i] = v;
  }
  return n;
}

/** Genoma de uma protocélula primordial: generalista simples, com variação. */
export function protocellGenome(rng: Rng, out: Float32Array, o: number, variation = 0.08): void {
  const base: Partial<Record<keyof typeof G, number>> = {
    SIZE: 0.12, PHOTO: 0.55, OSMO: 0.45, PRED: 0.0, MOTIL: 0.15, SENSE: 0.25, META: 0.45,
    REPRO: 0.3, INVEST: 0.5, TOPT: 0.55, TTOL: 0.45, DEFENSE: 0.05, MUT: 0.35, AFFIN: 0.45,
    LONGEV: 0.4, HUE: 0.33, SAT: 0.5, PATTERN: 0.1, ELONG: 0.1, FLAG: 0.2, SPIKE: 0.05,
    LOBES: 0.1, NUCLEUS: 0.5, SYMM: 0.5,
  };
  (Object.keys(base) as (keyof typeof G)[]).forEach((k) => {
    let v = base[k]! + rng.gauss() * variation;
    out[o + G[k]] = v < 0 ? 0 : v > 1 ? 1 : v;
  });
  for (let i = BASE_GENES; i < GENE_COUNT; i++) out[o + i] = 0;
}

/** Genes morfológicos iniciais da protocélula (Etapa 3): quase nenhuma estrutura, com variação críptica. */
export function protocellMorph(rng: Rng, out: Float32Array, o: number): void {
  const r = (a: number, b: number) => rng.range(a, b);
  out[o + G.SEGM] = r(0, 0.12);
  out[o + G.LIMBS] = r(0, 0.1);
  out[o + G.LIMBLEN] = r(0, 0.3);
  out[o + G.FINS] = r(0, 0.15);
  out[o + G.EYES] = r(0, 0.25);
  out[o + G.CAMO] = r(0, 0.1);
  out[o + G.CLIMB] = r(0, 0.05);
  out[o + G.TERR] = r(0, 0.05);
  out[o + G.ANTENNA] = r(0, 0.2);
  out[o + G.TAIL] = r(0, 0.12);
  out[o + G.HUE2] = r(0, 1);
  out[o + G.HEAD] = r(0, 0.1);
}
