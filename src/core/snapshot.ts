import { G, GENE_COUNT } from './genome';
import { Simulation } from './simulation';

/** Genes enviados ao renderer (quantizados em bytes) para desenhar a morfologia. */
export const VIS_GENES = [G.SIZE, G.HUE, G.SAT, G.PHOTO, G.OSMO, G.PRED, G.MOTIL, G.DEFENSE, G.ELONG, G.FLAG, G.SPIKE, G.LOBES, G.PATTERN, G.NUCLEUS, G.SYMM, G.TTOL];
export const VIS = VIS_GENES.length;
export const V = { SIZE: 0, HUE: 1, SAT: 2, PHOTO: 3, OSMO: 4, PRED: 5, MOTIL: 6, DEF: 7, ELONG: 8, FLAG: 9, SPIKE: 10, LOBES: 11, PATTERN: 12, NUCLEUS: 13, SYMM: 14, TTOL: 15 } as const;

export interface FrameSnapshot {
  tick: number;
  n: number;
  x: Float32Array;
  y: Float32Array;
  sp: Uint32Array;
  vis: Uint8Array;
}

export function visFromGenes(genes: ArrayLike<number>, go: number, out: Uint8Array, oo: number): void {
  for (let k = 0; k < VIS; k++) out[oo + k] = Math.max(0, Math.min(255, Math.round(genes[go + VIS_GENES[k]] * 255)));
}

/** Instantâneo compacto para renderização (sem objetos por indivíduo). */
export function takeSnapshot(sim: Simulation): FrameSnapshot {
  const pool = sim.pool;
  const n = pool.count;
  const x = new Float32Array(n), y = new Float32Array(n), sp = new Uint32Array(n), vis = new Uint8Array(n * VIS);
  let k = 0;
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    x[k] = pool.x[i];
    y[k] = pool.y[i];
    sp[k] = pool.species[i];
    visFromGenes(pool.genes, i * GENE_COUNT, vis, k * VIS);
    k++;
  }
  return { tick: sim.tick, n, x, y, sp, vis };
}
