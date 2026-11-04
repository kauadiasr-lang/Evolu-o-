import { GENE_INFO } from '../core/genome';
import type { SimEvent } from '../core/stats';
import type { SpeciesInfo, StatsPayload } from '../worker/protocol';
import { BIOME_INFO } from '../core/biomes';

/** 1 tick = 4.000 anos de tempo planetário (escala narrativa). */
export const YEARS_PER_TICK = 4000;

export function formatAge(tick: number): string {
  const y = tick * YEARS_PER_TICK;
  if (y >= 1e9) return (y / 1e9).toFixed(2) + ' bilhões de anos';
  if (y >= 1e6) return (y / 1e6).toFixed(1) + ' milhões de anos';
  return (y / 1e3).toFixed(0) + ' mil anos';
}

export interface Digest {
  tick: number;
  idade: string;
  populacao: number;
  biomassa: number;
  especiesVivas: number;
  especiesTotais: number;
  massa: { organismos: number; nutrientes: number; detritos: number; sedimento: number };
  planeta: { temperaturaMedia: number; ajusteClimatico: number; pressaoGeologica: number };
  tendencias: { populacaoVar: number | null; biomassaVar: number | null; especiesVar: number | null; janelaTicks: number };
  especiesPrincipais: {
    id: number; nome: string; tipo: string; individuos: number; percentualPopulacao: number; pico: number; origem: string | null; nascimento: number;
    tracos: Record<string, number>;
    /** estruturas realmente expressas pelo genoma médio, e plano corporal */
    anatomia?: { planoCorporal: string; estruturas: string[] };
  }[];
  nascimentosRecentes: { nome: string; tick: number; origem: string }[];
  extincoesRecentes: { nome: string; tick: number; pico: number; causa: string }[];
  eventos: { tick: number; tipo: string; titulo: string; texto: string }[];
  mortalidade: Record<string, number>;
  mortalidadePercentual: Record<string, number>;
  /** Etapa 4: indicadores MEDIDOS pelo motor (pressões, diversidade, veredito de especiação, extinções) */
  diagnostico?: {
    pressoes: { nome: string; indicadorPercentual: number; detalhe: string }[];
    ambienteEmCurso: string[];
    diversidadeGenetica: { varianciaNicho: number; dispersaoDominante: number; fracaoDominantePercentual: number; mutacoesPorNascimento: number };
    especiacao: { especie: string; individuos: number; veredito: string; explicacao: string }[];
    extincoesRecentes: { nome: string; tick: number; causaProvavel: string; composicaoMortesRecentes: Record<string, number> }[];
    habitat: { animaisEmTerra: number; aptosVidaTerrestrePercentual: number; coberturaVegetalPercentual: number };
  };
  /** Etapa 3: só presentes em mundos com continentes */
  biomas?: { nome: string; percentualSuperficie: number; variacaoRecente: number | null }[];
  terra?: { temperaturaMedia: number; umidadeSoloMedia: number; coberturaVegetalPercentual: number; areaTerrestrialPercentual: number };
  flora?: {
    plantas: number; biomassa: number; linhagensVivas: number; formas: Record<string, number>;
    principais: { id: number; nome: string; forma: string; individuos: number; tracos: Record<string, number> }[];
  };
  predacao: { predador: string; presa: string; fluxo: number }[];
}

const TRACE = ['SIZE', 'PHOTO', 'OSMO', 'PRED', 'MOTIL', 'DEFENSE', 'TOPT', 'TTOL'];
const TRACE_LABEL: Record<string, string> = {
  SIZE: 'tamanho', PHOTO: 'fotossintese', OSMO: 'absorcao_detritos', PRED: 'predacao', MOTIL: 'motilidade',
  DEFENSE: 'defesa', TOPT: 'temperatura_otima', TTOL: 'tolerancia_termica',
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function trend(arr: number[] | undefined, win: number): number | null {
  if (!arr || arr.length < 3) return null;
  const a = arr[Math.max(0, arr.length - 1 - win)];
  const b = arr[arr.length - 1];
  return a > 0 ? r2((b - a) / a) : null;
}

/** Resumo estruturado, apenas com dados reais da simulação. A IA recebe SOMENTE isto. */
export function buildDigest(st: StatsPayload, sinceTick = 0): Digest {
  const byId = new Map(st.species.map((s) => [s.id, s]));
  const win = 20;
  const alive = st.species.filter((s) => s.extinctTick < 0 && s.count > 0).sort((a, b) => b.count - a.count);
  const traits = (s: SpeciesInfo) => {
    const o: Record<string, number> = {};
    for (const k of TRACE) {
      const idx = GENE_INFO.findIndex((g) => g.key === k);
      o[TRACE_LABEL[k]] = r2(s.centroid[idx]);
    }
    return o;
  };
  const evs = st.events.filter((e) => e.tick > sinceTick);
  const recentWindow = Math.max(sinceTick, st.tick - 1500);
  const stage3Part: Partial<Digest> = {};
  if (st.diag) {
    const d = st.diag;
    stage3Part.diagnostico = {
      pressoes: d.pressure.items.map((p) => ({ nome: p.label, indicadorPercentual: Math.round(p.level * 100), detalhe: p.detail })),
      ambienteEmCurso: d.pressure.environment,
      diversidadeGenetica: { varianciaNicho: Math.round(d.genetic.nicheVariance * 1000) / 1000, dispersaoDominante: Math.round(d.genetic.dominantSpread * 1000) / 1000, fracaoDominantePercentual: Math.round(d.genetic.dominantShare * 100), mutacoesPorNascimento: Math.round(d.genetic.mutationsPerBirth * 100) / 100 },
      especiacao: d.speciation.slice(0, 4).map((x) => ({ especie: x.name, individuos: x.n, veredito: x.verdict, explicacao: x.explanation })),
      extincoesRecentes: d.extinctions.slice(0, 4).map((e) => ({ nome: e.name, tick: e.extinctTick, causaProvavel: e.probableCause, composicaoMortesRecentes: Object.fromEntries(Object.entries(e.shares).map(([k, v]) => [k, Math.round(v * 100)])) })),
      habitat: { animaisEmTerra: d.habitat.animalsOnLand, aptosVidaTerrestrePercentual: Math.round(d.habitat.landCapable * 10000) / 100, coberturaVegetalPercentual: Math.round(d.habitat.plantCoverage * 100) },
    };
  }
  if (st.stage3 && st.biomes.length) {
    const ser = st.history.series;
    const keyOf: Record<string, string> = { Floresta: 'bForest', Pradaria: 'bGrass', Arbustal: 'bShrub', Deserto: 'bDesert', Tundra: 'bTundra', 'Pântano': 'bSwamp' };
    stage3Part.biomas = BIOME_INFO.map((b) => ({ nome: b.label, a: st.biomes[b.id] ?? 0 }))
      .filter((b) => b.a > 0.003)
      .sort((a, b) => b.a - a.a)
      .map((b) => ({ nome: b.nome, percentualSuperficie: Math.round(b.a * 1000) / 10, variacaoRecente: keyOf[b.nome] ? trend(ser[keyOf[b.nome]], 60) : null }));
    stage3Part.terra = {
      temperaturaMedia: r2(ser.landTemp?.[ser.landTemp.length - 1] ?? 0), umidadeSoloMedia: r2(ser.landWater?.[ser.landWater.length - 1] ?? 0),
      coberturaVegetalPercentual: Math.round((st.flora?.cover ?? 0) * 100), areaTerrestrialPercentual: Math.round(st.landFraction * 100),
    };
    if (st.flora && st.flora.colonized) {
      const gi = (g: number[], k: number) => r2(g[k]);
      stage3Part.flora = {
        plantas: st.flora.plants, biomassa: r2(st.flora.mass), linhagensVivas: st.flora.lineagesAlive, formas: st.flora.forms,
        principais: st.flora.lineages.filter((l) => l.extinctTick < 0).slice(0, 5).map((l) => ({
          id: l.id, nome: l.name, forma: l.form, individuos: l.count,
          tracos: { altura: gi(l.genes, 0), larguraFolha: gi(l.genes, 1), densidadeFoliar: gi(l.genes, 2), raizes: gi(l.genes, 3), tolerânciaSombra: gi(l.genes, 5), toleranciaSeca: gi(l.genes, 6) },
        })),
      };
    }
  }
  return {
    ...stage3Part,
    tick: st.tick,
    idade: formatAge(st.tick),
    populacao: st.pop,
    biomassa: r2(st.mass.organisms),
    especiesVivas: st.speciesAlive,
    especiesTotais: st.speciesTotal,
    massa: { organismos: r2(st.mass.organisms), nutrientes: r2(st.mass.nutrient), detritos: r2(st.mass.detritus), sedimento: r2(st.mass.reservoir) },
    planeta: { temperaturaMedia: r2(st.planet.meanTemp), ajusteClimatico: r2(st.planet.climateOffset), pressaoGeologica: r2(st.planet.pressure) },
    tendencias: {
      populacaoVar: trend(st.history.series.pop, win),
      biomassaVar: trend(st.history.series.biomass, win),
      especiesVar: trend(st.history.series.species, win),
      janelaTicks: win * 25,
    },
    especiesPrincipais: alive.slice(0, 6).map((s) => ({
      id: s.id, nome: s.name, tipo: s.trophic, individuos: s.count, percentualPopulacao: Math.round((s.count / Math.max(1, st.pop)) * 100), pico: s.peak,
      origem: s.parentId ? byId.get(s.parentId)?.name ?? null : null, nascimento: s.bornTick, tracos: traits(s),
      ...(st.stage3 ? { anatomia: { planoCorporal: s.plan, estruturas: s.structures } } : {}),
    })),
    nascimentosRecentes: st.species.filter((s) => s.bornTick > recentWindow && s.parentId).slice(-6).map((s) => ({ nome: s.name, tick: s.bornTick, origem: byId.get(s.parentId)?.name ?? '?' })),
    extincoesRecentes: st.species.filter((s) => s.extinctTick > recentWindow).slice(-6).map((s) => ({ nome: s.name, tick: s.extinctTick, pico: s.peak, causa: s.cause })),
    eventos: evs.slice(-10).map((e: SimEvent) => ({ tick: e.tick, tipo: e.type, titulo: e.title, texto: e.text })),
    mortalidade: Object.fromEntries(Object.entries(st.deaths).map(([k, v]) => [k, v])),
    mortalidadePercentual: Object.fromEntries(
      Object.entries(st.deaths).map(([k, v]) => [k, Math.round((v / Math.max(1, Object.values(st.deaths).reduce((a, b) => a + b, 0))) * 100)]),
    ),
    predacao: st.web.edges
      .slice()
      .sort((a, b) => b[2] - a[2])
      .slice(0, 5)
      .map(([p, q, f]) => ({ predador: byId.get(p)?.name ?? '?', presa: byId.get(q)?.name ?? '?', fluxo: r2(f) })),
  };
}

/**
 * Verificação de ancoragem: todo número citado pela narrativa precisa existir no digest
 * (a menos de arredondamento, percentual ou conversão de tempo). Os demais são devolvidos
 * para que a interface alerte o jogador de possível invenção.
 */
export function ungroundedNumbers(text: string, digest: Digest): string[] {
  const nums = new Set<number>();
  for (const m of JSON.stringify(digest).matchAll(/-?\d+(?:\.\d+)?/g)) nums.add(Math.abs(Number(m[0])));
  const forms = (n: number) => [n, n * 100, n / 1000, (n * YEARS_PER_TICK) / 1e6, (n * YEARS_PER_TICK) / 1e3, (n * YEARS_PER_TICK) / 1e9];
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.006) || Math.abs(Math.round(b) - a) < 0.5;
  const out: string[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const v = Number(m[0].replace(',', '.'));
    if (Number.isInteger(v) && v < 10) continue; // contagens pequenas ("três espécies")
    let ok = false;
    for (const n of nums) {
      if (forms(n).some((f) => near(v, f))) { ok = true; break; }
    }
    if (!ok) out.push(m[0]);
  }
  return [...new Set(out)];
}
