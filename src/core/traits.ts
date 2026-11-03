import { G } from './genome';
import { P } from './params';
import { bodyHueDeg, develop } from './phenotype';

/** Índices do cache de traços derivados (calculado uma vez, no nascimento). */
export const T = {
  RADIUS: 0,
  MASS_REPRO: 1,
  MASS_MAX: 2,
  COST_MULT: 3,
  TOPT: 4,
  TWIDTH: 5,
  LIFESPAN: 6,
  CHILD_FRAC: 7,
  SPEED: 8,
  META: 9,
  PHOTO: 10,
  OSMO: 11,
  PRED: 12,
  DEF: 13,
  SENSE: 14,
  AFFIN: 15,
  MOTIL: 16,
  // --- Etapa 3 (zeros quando stage3 está desligado)
  SEG: 17,
  LIMBS: 18,
  LIMBLEN: 19,
  FINS: 20,
  EYES: 21,
  CAMO: 22,
  CLIMB: 23,
  TERR: 24,
  ANT: 25,
  TAIL: 26,
  HEAD: 27,
  /** velocidade em terra (0 sem membros) */
  LSPEED: 28,
  /** matiz do corpo (graus) para camuflagem */
  BODYHUE: 29,
  /** altura máxima de planta que consegue alcançar ao pastar */
  REACH: 30,
} as const;
export const TR = 31;

export const TEMP_MIN = -5;
export const TEMP_MAX = 45;

/**
 * Deriva traços fisiológicos a partir do genoma, aplicando os CUSTOS de cada adaptação.
 * Nenhum gene é "grátis": todo benefício paga um custo de manutenção (COST_MULT)
 * ou uma restrição de desempenho.
 */
export function deriveTraits(g: ArrayLike<number>, go: number, out: Float32Array, to: number, stage3 = false): void {
  const size = g[go + G.SIZE];
  const photo = g[go + G.PHOTO];
  const osmo = g[go + G.OSMO];
  const pred = g[go + G.PRED];
  const motil = g[go + G.MOTIL];
  const sense = g[go + G.SENSE];
  const ttol = g[go + G.TTOL];
  const def = g[go + G.DEFENSE];
  const affin = g[go + G.AFFIN];
  const longev = g[go + G.LONGEV];
  const elong = g[go + G.ELONG];
  const spike = g[go + G.SPIKE];
  const flag = g[go + G.FLAG];
  const lobes = g[go + G.LOBES];

  const radius = 0.6 + 2.4 * size;
  const massRepro = (1.6 + 13 * Math.pow(size, 1.4)) * (0.7 + 0.8 * g[go + G.REPRO]);

  // Custo de manutenção: soma dos custos das adaptações.
  let cost =
    0.55 * photo + // aparato fotossintético (pigmentos, tilacoides)
    0.3 * osmo +
    0.55 * pred + // maquinário de captura
    0.5 * motil + // flagelos
    0.25 * sense +
    0.55 * ttol + // generalistas térmicos pagam por enzimas versáteis
    0.5 * def + // parede/espinhos
    0.3 * affin +
    0.35 * longev +
    0.1 * spike + 0.08 * flag + 0.06 * lobes + 0.08 * elong;

  // Defesa efetiva: parede (def) + espinhos, mas ambas pesam.
  const defEff = Math.min(1, def * 0.8 + spike * 0.25);
  // Velocidade: flagelos, forma alongada ajuda; células grandes são mais lentas.
  let speed = (P.SPEED_K * (motil + 0.25 * flag) * (1 + 0.5 * elong)) / (1 + 0.5 * (radius - 0.6) * (1 + def));

  // --- Etapa 3: estruturas expressas pagam manutenção e dão benefícios específicos
  let eyesN = 0, ph = null as ReturnType<typeof develop> | null;
  if (stage3) {
    ph = develop(g, go);
    const segN = ph.segments / 8;
    eyesN = ph.eyes / 3;
    cost +=
      0.05 * ph.segments + 0.1 * ph.limbs * (0.5 + ph.limbLen) + 0.22 * ph.fins + 0.12 * ph.eyes + 0.1 * ph.antennae +
      0.18 * ph.camo + 0.15 * ph.climb + 0.35 * ph.terr + 0.12 * ph.tail + 0.1 * ph.head;
    // natação: nadadeiras, cauda e ondulação de corpos segmentados e alongados
    speed *= 1 + 0.55 * ph.fins + 0.35 * ph.tail * elong + 0.5 * segN * elong;
  }

  out[to + T.RADIUS] = radius;
  out[to + T.MASS_REPRO] = massRepro;
  out[to + T.MASS_MAX] = massRepro * 1.5;
  out[to + T.COST_MULT] = 1 + cost;
  out[to + T.TOPT] = TEMP_MIN + (TEMP_MAX - TEMP_MIN) * g[go + G.TOPT];
  out[to + T.TWIDTH] = 3 + 15 * ttol;
  out[to + T.LIFESPAN] = 500 + 3500 * longev;
  out[to + T.CHILD_FRAC] = 0.25 + 0.25 * g[go + G.INVEST];
  out[to + T.SPEED] = speed;
  out[to + T.META] = 0.5 + g[go + G.META];
  out[to + T.PHOTO] = photo;
  out[to + T.OSMO] = osmo;
  out[to + T.PRED] = pred;
  out[to + T.DEF] = defEff;
  out[to + T.SENSE] = sense;
  out[to + T.AFFIN] = 0.4 + affin;
  out[to + T.MOTIL] = motil;
  if (stage3 && ph) {
    out[to + T.SEG] = ph.segments;
    out[to + T.LIMBS] = ph.limbs;
    out[to + T.LIMBLEN] = ph.limbLen;
    out[to + T.FINS] = ph.fins;
    out[to + T.EYES] = ph.eyes;
    out[to + T.CAMO] = ph.camo;
    out[to + T.CLIMB] = ph.climb;
    out[to + T.TERR] = ph.terr;
    out[to + T.ANT] = ph.antennae;
    out[to + T.TAIL] = ph.tail;
    out[to + T.HEAD] = ph.head;
    out[to + T.LSPEED] = ph.limbs > 0 ? (P.SPEED_K * (0.25 + 0.3 * ph.limbs * (0.5 + ph.limbLen))) / (1 + 0.5 * (radius - 0.6) * (1 + def)) : 0;
    out[to + T.BODYHUE] = bodyHueDeg(g[go + G.HUE], photo, pred, osmo);
    out[to + T.REACH] = radius * 0.5 + (ph.limbs > 0 ? 1.2 * ph.climb * (0.5 + ph.limbLen) : 0);
    // olhos e cefalização afinam a quimiotaxia; segmentos permitem corpos um pouco maiores
    out[to + T.SENSE] = sense * (1 + 0.3 * eyesN * (1 + 0.3 * ph.head));
    out[to + T.MASS_MAX] *= 1 + 0.03 * ph.segments;
  } else {
    for (let k = T.SEG; k <= T.REACH; k++) out[to + k] = 0;
  }
}
