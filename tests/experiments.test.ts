import { describe, expect, it } from 'vitest';
import { Comparison, ForkResult, compareRuns, runFork } from '../src/core/experiment';
import type { EnvChange } from '../src/core/envchange';

/**
 * Experimento reproduzível: mesmo estado (semente + ambiente estável) bifurcado em A (nada muda) e B (mudança
 * ambiental documentada). Os resultados de TODAS as sementes são impressos; as asserções descrevem
 * regularidades que a física implica — não exigem adaptação, especiação nem sobrevivência em cada semente.
 */
const SEEDS = [1, 2, 3, 4];
const CFG = { width: 40, height: 24, maxOrganisms: 12000 };
const AT = 2500, TOTAL = 6000;

const cache = new Map<string, { res: ForkResult; cmp: Comparison }[]>();
function scenario(key: string, change: Omit<EnvChange, 'tick' | 'applied'> | undefined, deltaT = 0) {
  if (!cache.has(key)) {
    const out = SEEDS.map((seed) => {
      const res = runFork({ seed, cfg: CFG, changeAt: AT, totalTicks: TOTAL, sampleEvery: 250, change, track: true });
      return { res, cmp: compareRuns(res, AT, deltaT) };
    });
    cache.set(key, out);
    // registra os números de todas as sementes (inclusive as que não se adaptaram)
    console.log(`[experimento ${key}] ` + JSON.stringify(out.map(({ cmp: c }) => ({ seed: c.seed, minPopA: +c.minPopRatioA.toFixed(2), minPopB: +c.minPopRatioB.toFixed(2), finalPopA: +c.finalPopRatioA.toFixed(2), finalPopB: +c.finalPopRatioB.toFixed(2), toptA: c.toptShiftA === null ? null : +c.toptShiftA.toFixed(3), toptB: c.toptShiftB === null ? null : +c.toptShiftB.toFixed(3), resposta: c.responseTicks, recuperacao: c.recoveryTicks, extinta: c.totalExtinctionB, especiesA: c.speciesAliveA, especiesB: c.speciesAliveB, massa: c.massDriftMax }))));
  }
  return cache.get(key)!;
}

describe('cenário A — ambiente estável', () => {
  const A = () => scenario('aquecimento-abrupto-8', { kind: 'climate', value: 8, abrupt: true }, 8);

  it('a linhagem bem adaptada persiste sem nenhuma mudança obrigatória: população não cai e a vida continua', () => {
    for (const { res, cmp } of A()) {
      expect(cmp.minPopRatioA, `semente ${cmp.seed}`).toBeGreaterThan(0.9);
      expect(cmp.totalExtinctionA).toBe(false);
      expect(res.stable.samples.at(-1)!.pop).toBeGreaterThan(0);
      expect(res.stable.samples.at(-1)!.founderShare).toBeGreaterThan(0); // a linhagem simples fundadora ainda existe
    }
  });

  it('o ambiente estável não tem estações: o clima da linha A permanece constante', () => {
    for (const { res } of A()) for (const s of res.stable.samples) { expect(s.climateOffset).toBe(0); expect(s.aridity).toBe(1); expect(s.light).toBe(1); }
  });

  it('a população continua variando geneticamente (variação neutra e mutações) mesmo sem mudança ambiental', () => {
    for (const { res } of A()) {
      const end = res.stable.samples.at(-1)!;
      expect(end.nicheVariance).toBeGreaterThan(0.01);
      expect(end.dominantSpread).toBeGreaterThan(0.01);
    }
  });

  it('o ajuste térmico é alto: sem desajuste não há pressão térmica forçando mudança', () => {
    for (const { res } of A()) expect(Math.min(...res.stable.samples.map((s) => s.tfMean))).toBeGreaterThan(0.85);
  });
});

describe('cenário B — aquecimento de +8 °C, abrupto (mesmas condições iniciais)', () => {
  const B = () => scenario('aquecimento-abrupto-8', { kind: 'climate', value: 8, abrupt: true }, 8);

  it('a população sofre um gargalo claro, muito maior que na linha estável', () => {
    for (const { cmp } of B()) {
      expect(cmp.minPopRatioB, `semente ${cmp.seed}`).toBeLessThan(0.5);
      expect(cmp.minPopRatioB).toBeLessThan(cmp.minPopRatioA);
    }
  });

  it('a seleção natural desloca a temperatura ótima na direção da mudança (sem nenhuma alteração de genes)', () => {
    let moved = 0;
    for (const { cmp } of B()) {
      expect(cmp.toptShiftB).not.toBeNull();
      if (cmp.toptShiftB! - cmp.toptShiftA! > 0.05) moved++;
    }
    expect(moved).toBeGreaterThanOrEqual(3); // na maioria das sementes — não exigimos todas
  });

  it('a resposta evolutiva leva tempo (centenas a milhares de ticks) e, quando ocorre, é registrada', () => {
    const times = B().map(({ cmp }) => cmp.responseTicks).filter((t): t is number => t !== null);
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (const t of times) expect(t).toBeGreaterThan(200);
  });

  it('o gargalo reduz a diversidade genética de nicho', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(B().map(({ cmp }) => cmp.nicheVarB))).toBeLessThan(mean(B().map(({ cmp }) => cmp.nicheVarA)));
  });

  it('o rastreador mostra seleção em ação: depois da mudança, genótipos de T ótima baixa morrem mais por unidade de tempo', () => {
    // faixa 0-2 (T ótima baixa) × 3-4 (alta): taxa de morte por organismo-tick na linha alterada
    const rates = B().map(({ res }) => {
      const bins = res.altered.trackerSummary!.TOPT;
      const rate = (idx: number[]) => { const e = idx.reduce((a, i) => a + bins[i].exposure, 0); const d = idx.reduce((a, i) => a + Object.values(bins[i].deaths).reduce((x, y) => x + y, 0), 0); return e ? d / e : NaN; };
      return { low: rate([0, 1, 2]), high: rate([3, 4]) };
    });
    // contexto: em mundo quente, genótipos de T ótima mais alta devem ter mortalidade menor ou igual na maioria das sementes
    const ok = rates.filter((r) => Number.isFinite(r.low) && Number.isFinite(r.high) && r.high <= r.low * 1.05).length;
    expect(ok).toBeGreaterThanOrEqual(2);
  });

  it('a massa é conservada em ambas as linhas do tempo', () => {
    for (const { cmp } of B()) expect(cmp.massDriftMax).toBeLessThan(1e-9);
  });
});

describe('gradual × abrupto: a velocidade da mudança importa', () => {
  const G = () => scenario('aquecimento-gradual-8', { kind: 'climate', value: 8, abrupt: false }, 8);
  const B = () => scenario('aquecimento-abrupto-8', { kind: 'climate', value: 8, abrupt: true }, 8);

  it('a mesma mudança aplicada gradualmente causa gargalo bem menor que a abrupta', () => {
    const g = G(), b = B();
    for (let i = 0; i < g.length; i++) expect(g[i].cmp.minPopRatioB, `semente ${g[i].cmp.seed}`).toBeGreaterThan(b[i].cmp.minPopRatioB);
  });

  it('há resposta evolutiva na mudança gradual em parte das sementes (e em outras não: não é garantida)', () => {
    const shifts = G().map(({ cmp }) => (cmp.toptShiftB ?? 0) - (cmp.toptShiftA ?? 0));
    expect(shifts.filter((s) => s > 0.04).length).toBeGreaterThanOrEqual(2);
  });
});

describe('extinção: quando a mudança é rápida e grande demais, a linhagem pode desaparecer', () => {
  const X = () => scenario('aquecimento-abrupto-25', { kind: 'climate', value: 25, abrupt: true }, 25);

  it('+25 °C abrupto extingue a vida na maioria das sementes, enquanto a linha estável segue normal', () => {
    const ext = X().filter(({ cmp }) => cmp.totalExtinctionB).length;
    expect(ext).toBeGreaterThanOrEqual(3);
    for (const { cmp } of X()) {
      expect(cmp.totalExtinctionA).toBe(false);
      if (cmp.totalExtinctionB) expect(cmp.extinctionTickB).toBeGreaterThan(AT);
    }
  });

  it('o registro de extinção indica a causa provável a partir das mortes recentes', () => {
    const { res } = X()[0];
    expect(res.altered.speciesExtinctAfter.length).toBeGreaterThan(0);
  });
});

describe('outras pressões: luz e nutrientes', () => {
  const L = () => scenario('luz-0.5-abrupta', { kind: 'light', value: 0.5, abrupt: true });

  it('escurecer a superfície derruba a população (menos energia) sem mover a temperatura ótima: nada é inventado', () => {
    for (const { cmp } of L()) {
      expect(cmp.minPopRatioB, `semente ${cmp.seed}`).toBeLessThan(0.4);
      expect(Math.abs((cmp.toptShiftB ?? 0) - (cmp.toptShiftA ?? 0))).toBeLessThan(0.08);
      expect(cmp.massDriftMax).toBeLessThan(1e-9);
    }
  });
});

describe('reprodutibilidade', () => {
  it('a mesma semente e a mesma mudança produzem exatamente os mesmos resultados', () => {
    const a = runFork({ seed: 2, cfg: CFG, changeAt: 1500, totalTicks: 2500, sampleEvery: 250, change: { kind: 'climate', value: 6, abrupt: true } });
    const b = runFork({ seed: 2, cfg: CFG, changeAt: 1500, totalTicks: 2500, sampleEvery: 250, change: { kind: 'climate', value: 6, abrupt: true } });
    expect(JSON.stringify(a.altered.samples)).toBe(JSON.stringify(b.altered.samples));
    expect(JSON.stringify(a.stable.samples)).toBe(JSON.stringify(b.stable.samples));
  });
});
