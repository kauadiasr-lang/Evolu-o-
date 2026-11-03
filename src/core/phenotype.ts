import { G } from './genome';

/**
 * Fenótipo: o que o genoma REALMENTE expressa. Estruturas só se desenvolvem quando os pré-requisitos
 * (outros genes/tamanho/forma do corpo) existem — um gene de membros num organismo minúsculo e imóvel
 * permanece críptico (herdado, mas sem efeito visual nem custo). Isso impede estruturas "sem recursos".
 */
export interface Phenotype {
  /** nº de segmentos (0 = corpo contínuo) */
  segments: number;
  /** pares de membros */
  limbs: number;
  limbLen: number;
  fins: number;
  /** 0..3 */
  eyes: number;
  camo: number;
  climb: number;
  terr: number;
  antennae: number;
  tail: number;
  head: number;
  plan: BodyPlan;
}

export type BodyPlan = 'unicelular' | 'bilateral' | 'segmentado' | 'radial' | 'assimétrico';

export function develop(g: ArrayLike<number>, go: number): Phenotype {
  const size = g[go + G.SIZE], motil = g[go + G.MOTIL], sense = g[go + G.SENSE], elong = g[go + G.ELONG];
  const symm = g[go + G.SYMM];
  const radial = symm > 0.66;

  // segmentação: exige corpo alongado e tamanho mínimo; radiais não se segmentam
  const segments = !radial && g[go + G.SEGM] > 0.18 && elong > 0.12 && size > 0.12 ? Math.max(2, Math.round(g[go + G.SEGM] * 8)) : 0;
  // membros: exigem motilidade e tamanho mínimos
  const limbs = motil > 0.2 && size > 0.2 && g[go + G.LIMBS] > 0.15 ? Math.max(1, Math.round(g[go + G.LIMBS] * 4)) : 0;
  const limbLen = limbs > 0 ? g[go + G.LIMBLEN] : 0;
  const fins = motil > 0.15 && g[go + G.FINS] > 0.1 ? g[go + G.FINS] : 0;
  const eyes = sense > 0.2 && g[go + G.EYES] > 0.15 ? Math.max(1, Math.round(g[go + G.EYES] * 3)) : 0;
  const camo = g[go + G.CAMO] > 0.1 ? g[go + G.CAMO] : 0;
  // escalada e vida terrestre exigem membros
  const climb = limbs >= 1 && limbLen > 0.2 && g[go + G.CLIMB] > 0.1 ? g[go + G.CLIMB] : 0;
  const terr = limbs >= 1 && g[go + G.TERR] > 0.1 ? g[go + G.TERR] : 0;
  const antennae = sense > 0.15 && g[go + G.ANTENNA] > 0.12 ? g[go + G.ANTENNA] : 0;
  const tail = !radial && motil > 0.15 && elong > 0.08 && g[go + G.TAIL] > 0.1 ? g[go + G.TAIL] : 0;
  const head = !radial && (eyes > 0 || antennae > 0) && g[go + G.HEAD] > 0.1 ? g[go + G.HEAD] : 0;

  const complex = segments > 0 || limbs > 0 || fins > 0 || tail > 0;
  const plan: BodyPlan = radial ? (complex ? 'radial' : 'unicelular') : segments > 0 ? 'segmentado' : symm < 0.33 && complex ? 'assimétrico' : complex ? 'bilateral' : 'unicelular';
  return { segments, limbs, limbLen, fins, eyes, camo, climb, terr, antennae, tail, head, plan };
}

export function mixAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

/** Matiz (graus) do corpo: pigmento + clorofila + sangue de predador. Usado no motor (camuflagem) e no desenho. */
export function bodyHueDeg(hue: number, photo: number, pred: number, osmo: number): number {
  let h = hue * 360;
  h = mixAngle(h, 128, Math.min(1, photo * 0.45));
  h = mixAngle(h, 352, Math.min(1, pred * 0.8));
  h = mixAngle(h, 38, Math.min(1, osmo * (1 - photo) * 0.4));
  return h;
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Quão bem o corpo se confunde com o substrato (0..1), pela proximidade de matiz. */
export function camoMatch(bodyHue: number, bgHue: number): number {
  return Math.max(0, 1 - hueDistance(bodyHue, bgHue) / 60);
}
