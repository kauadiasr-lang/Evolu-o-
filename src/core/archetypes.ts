import { G, GENE_COUNT, protocellGenome } from './genome';
import { Rng } from './rng';

/**
 * Arquétipos para o modo "sandbox": genomas de partida com planos corporais diferentes.
 * São apenas SEMENTES; depois de introduzidos, competem sob as mesmas regras (custos, ambiente, predação).
 * Nada garante que sobrevivam.
 */
export type ArchetypeKind = 'swimmer' | 'amphibian' | 'climber' | 'camouflaged' | 'armored' | 'radial';

export const ARCHETYPES: Record<ArchetypeKind, { label: string; desc: string; set: Partial<Record<keyof typeof G, number>> }> = {
  swimmer: {
    label: 'Nadador segmentado',
    desc: 'Corpo alongado e segmentado, cauda e nadadeiras, olhos e cabeça: caçador pelágico.',
    set: { SIZE: 0.3, ELONG: 0.55, SEGM: 0.65, TAIL: 0.6, FINS: 0.5, MOTIL: 0.6, SENSE: 0.45, EYES: 0.5, HEAD: 0.5, PHOTO: 0.5, OSMO: 0.5, PRED: 0.35, META: 0.2, TTOL: 0.5, HUE: 0.55 },
  },
  amphibian: {
    label: 'Anfíbio com membros',
    desc: 'Membros e integumento que retém água: pode sair do mar e pastar plantas rasteiras.',
    set: { SIZE: 0.36, ELONG: 0.3, SEGM: 0.35, LIMBS: 0.5, LIMBLEN: 0.5, TERR: 0.6, MOTIL: 0.5, SENSE: 0.4, EYES: 0.4, HEAD: 0.3, DEFENSE: 0.3, PHOTO: 0.45, OSMO: 0.6, PRED: 0.3, META: 0.2, TTOL: 0.5, HUE: 0.3 },
  },
  climber: {
    label: 'Escalador herbívoro',
    desc: 'Três pares de membros longos com garras: alcança folhas altas que outros não alcançam.',
    set: { SIZE: 0.38, ELONG: 0.25, SEGM: 0.5, LIMBS: 0.75, LIMBLEN: 0.75, CLIMB: 0.8, TERR: 0.6, MOTIL: 0.55, PRED: 0.5, PHOTO: 0.3, OSMO: 0.5, META: 0.2, TTOL: 0.5, EYES: 0.6, HEAD: 0.5, ANTENNA: 0.5, SENSE: 0.45, HUE: 0.08 },
  },
  camouflaged: {
    label: 'Camuflado de fundo',
    desc: 'Pigmento ajustado ao azul-esverdeado da água: difícil de detectar sobre o oceano, caro de manter.',
    set: { SIZE: 0.22, CAMO: 0.9, PATTERN: 0.6, HUE: 0.55, PHOTO: 0.45, OSMO: 0.6, MOTIL: 0.3, SENSE: 0.4, META: 0.2, TTOL: 0.5 },
  },
  armored: {
    label: 'Blindado',
    desc: 'Carapaça segmentada e espinhos: resistente à predação, pesado e lento.',
    set: { SIZE: 0.45, DEFENSE: 0.85, SPIKE: 0.6, MOTIL: 0.15, PHOTO: 0.5, OSMO: 0.4, ELONG: 0.2, SEGM: 0.55, META: 0.2, TTOL: 0.5, HUE: 0.1 },
  },
  radial: {
    label: 'Radial (estrela)',
    desc: 'Simetria radial com braços articulados: sem cabeça nem direção preferencial.',
    set: { SYMM: 0.85, SIZE: 0.3, LIMBS: 0.75, LIMBLEN: 0.5, MOTIL: 0.3, PHOTO: 0.45, OSMO: 0.6, PRED: 0.3, META: 0.2, TTOL: 0.5, HUE: 0.9 },
  },
};

/** Gera um genoma do arquétipo com pequena variação individual (σ=0,02) e o escreve em out[o..]. */
export function archetypeGenome(kind: ArchetypeKind, rng: Rng, mrng: Rng, out: Float32Array, o = 0): void {
  protocellGenome(rng, out, o, 0.01);
  for (const [k, v] of Object.entries(ARCHETYPES[kind].set)) out[o + G[k as keyof typeof G]] = v as number;
  for (let i = 0; i < GENE_COUNT; i++) {
    if (i === G.MUT) continue;
    const v = out[o + i] + mrng.gauss() * 0.02;
    out[o + i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
}
