import { G, GENE_COUNT } from './genome';
import { Simulation } from './simulation';

import { develop } from './phenotype';
import { T, TR } from './traits';

/**
 * Bytes enviados ao renderer: genes visuais clássicos + FENÓTIPO EXPRESSO (estruturas só aparecem
 * se os pré-requisitos existem — ver phenotype.ts) + maturidade.
 */
export const V = {
  SIZE: 0, HUE: 1, SAT: 2, PHOTO: 3, OSMO: 4, PRED: 5, MOTIL: 6, DEF: 7, ELONG: 8, FLAG: 9, SPIKE: 10, LOBES: 11,
  PATTERN: 12, NUCLEUS: 13, SYMM: 14, TTOL: 15, SEGM: 16, LIMBS: 17, LIMBLEN: 18, FINS: 19, EYES: 20, CAMO: 21,
  CLIMB: 22, TERR: 23, ANT: 24, TAIL: 25, HUE2: 26, HEAD: 27, MATURE: 28,
} as const;
export const VIS = 29;
const CLASSIC = [G.SIZE, G.HUE, G.SAT, G.PHOTO, G.OSMO, G.PRED, G.MOTIL, G.DEFENSE, G.ELONG, G.FLAG, G.SPIKE, G.LOBES, G.PATTERN, G.NUCLEUS, G.SYMM, G.TTOL];

export interface FrameSnapshot {
  tick: number;
  n: number;
  x: Float32Array;
  y: Float32Array;
  sp: Uint32Array;
  vis: Uint8Array;
  /** direção do movimento, 0..255 -> -π..π */
  ang: Uint8Array;
}

const q8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function visFromGenes(genes: ArrayLike<number>, go: number, out: Uint8Array, oo: number, maturity = 1): void {
  for (let k = 0; k < CLASSIC.length; k++) out[oo + k] = q8(genes[go + CLASSIC[k]]);
  const ph = develop(genes, go);
  out[oo + V.SEGM] = q8(ph.segments / 8);
  out[oo + V.LIMBS] = q8(ph.limbs / 4);
  out[oo + V.LIMBLEN] = q8(ph.limbLen);
  out[oo + V.FINS] = q8(ph.fins);
  out[oo + V.EYES] = q8(ph.eyes / 3);
  out[oo + V.CAMO] = q8(ph.camo);
  out[oo + V.CLIMB] = q8(ph.climb);
  out[oo + V.TERR] = q8(ph.terr);
  out[oo + V.ANT] = q8(ph.antennae);
  out[oo + V.TAIL] = q8(ph.tail);
  out[oo + V.HUE2] = q8(genes[go + G.HUE2]);
  out[oo + V.HEAD] = q8(ph.head);
  out[oo + V.MATURE] = q8(maturity);
}

/** Instantâneo compacto para renderização (sem objetos por indivíduo). */
export function takeSnapshot(sim: Simulation): FrameSnapshot {
  const pool = sim.pool;
  const n = pool.count;
  const x = new Float32Array(n), y = new Float32Array(n), sp = new Uint32Array(n), vis = new Uint8Array(n * VIS), ang = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    x[k] = pool.x[i];
    y[k] = pool.y[i];
    sp[k] = pool.species[i];
    visFromGenes(pool.genes, i * GENE_COUNT, vis, k * VIS, Math.min(1, pool.mass[i] / pool.tr[i * TR + T.MASS_REPRO]));
    ang[k] = ((Math.atan2(pool.vy[i], pool.vx[i]) / (2 * Math.PI) + 0.5) * 255) | 0;
    k++;
  }
  return { tick: sim.tick, n, x, y, sp, vis, ang };
}
