import { describe, expect, it } from 'vitest';
import {
  FitnessTracker, extinctionReport, geneticSnapshot, habitatReport, pressureReport, regionDivergence, speciationReport, traitFrequencies,
} from '../src/core/diagnostics';
import { DEFAULT_MUTATION, G, GENE_COUNT } from '../src/core/genome';
import { Simulation } from '../src/core/simulation';
import { cells, emptyWorld, ensureSpecies, genome, smallSim, stage3Sim, stateHash } from './helpers';

const NO_MUT = { ...DEFAULT_MUTATION, baseRate: 0, rateRange: 0 };

describe('diversidade genética e frequência de características', () => {
  it('clones têm variância zero; misturar genótipos aumenta a variância de nicho', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.2);
    const a = genome({ SIZE: 0.1, TOPT: 0.5 }, 1);
    ensureSpecies(sim, a);
    for (let k = 0; k < 40; k++) sim.addOrganism(a, 0, 2 + (k % 10), 2 + ((k / 10) | 0), 0.5, 1);
    expect(geneticSnapshot(sim).nicheVariance).toBeCloseTo(0, 10);
    const b = genome({ SIZE: 0.6, TOPT: 0.2 }, 2);
    for (let k = 0; k < 40; k++) sim.addOrganism(b, 0, 2 + (k % 10), 8 + ((k / 10) | 0), 0.5, 1);
    const g = geneticSnapshot(sim);
    expect(g.nicheVariance).toBeGreaterThan(0.01);
    expect(g.geneMean[G.SIZE]).toBeCloseTo((0.1 + 0.6) / 2, 1);
    expect(g.pop).toBe(80);
  });

  it('a frequência de estruturas bate com o fenótipo expresso da população (Etapa 3)', () => {
    const sim = stage3Sim({ initialPopulation: 0, mutation: NO_MUT });
    const { water, w } = cells(sim);
    sim.planet.nutrient[water] += 200;
    sim.planet.reservoir -= 200;
    const plain = genome({ MOTIL: 0.1, SIZE: 0.1 }, 3);
    const finned = genome({ MOTIL: 0.5, SIZE: 0.3, FINS: 0.8 }, 4);
    ensureSpecies(sim, plain);
    const x = (water % w) + 0.5, y = ((water / w) | 0) + 0.5;
    for (let k = 0; k < 30; k++) sim.addOrganism(plain, 0, x, y, 0.5, 2);
    for (let k = 0; k < 10; k++) sim.addOrganism(finned, 0, x, y, 1, 3);
    const f = traitFrequencies(sim);
    expect(f.pop).toBe(40);
    expect(f.structures['nadadeiras']).toBeCloseTo(0.25, 2);
    expect(f.structures['membros'] ?? 0).toBe(0);
  });
});

describe('pressões ambientais atuantes (indicadores medidos)', () => {
  it('o desajuste térmico é alto quando a população está fora do ótimo e baixo quando está ajustada', () => {
    const level = (offset: number) => {
      const sim = emptyWorld({ mutation: NO_MUT }, 0.2);
      const T = sim.planet.temp[8 * sim.planet.w + 8];
      const g = genome({ TOPT: (T + 5) / 50 + offset, TTOL: 0.2, PHOTO: 0.7 }, 5);
      ensureSpecies(sim, g);
      // longe das fontes hidrotermais: a temperatura é a mesma em toda a área usada
      const near = (k: number) => [8 + (k % 5) * 0.5, 8 + ((k / 5) | 0) * 0.5] as const;
      for (let k = 0; k < 30; k++) sim.addOrganism(g, 0, near(k)[0], near(k)[1], 0.5, 3);
      return pressureReport(sim).items.find((i) => i.key === 'thermal')!.level;
    };
    expect(level(0)).toBeLessThan(0.1);
    expect(level(0.4)).toBeGreaterThan(0.8);
  });

  it('registra as alterações ambientais em curso, sem inventar nenhuma quando não há', () => {
    const sim = smallSim({ seed: 3 });
    sim.run(100);
    expect(pressureReport(sim).environment).toEqual([]);
    sim.setClimate(6);
    sim.scheduleChange({ tick: sim.tick + 500, kind: 'light', value: 0.6 });
    const env = pressureReport(sim).environment.join(' | ');
    expect(env).toMatch(/clima/);
    expect(env).toMatch(/programada/);
  });

  it('a pressão por fome/predação reflete as mortes recentes reais', () => {
    const sim = smallSim({ seed: 4 });
    sim.run(1500);
    const rec = sim.deathsRecent;
    const tot = Object.values(rec).reduce((a, b) => a + b, 0);
    expect(tot).toBeGreaterThan(0);
    const p = pressureReport(sim);
    expect(p.items.find((i) => i.key === 'food')!.level).toBeCloseTo(rec.starve / tot, 6);
    expect(p.items.find((i) => i.key === 'predation')!.level).toBeCloseTo(rec.predation / tot, 6);
  });
});

describe('divergência entre populações', () => {
  it('populações com genomas diferentes divergem; iguais não', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.2);
    const a = genome({ TOPT: 0.3, SIZE: 0.1 }, 6), b = genome({ TOPT: 0.7, SIZE: 0.5 }, 6);
    ensureSpecies(sim, a);
    for (let k = 0; k < 30; k++) { sim.addOrganism(a, 0, 2 + (k % 6), 2 + ((k / 6) | 0), 0.5, 1); sim.addOrganism(k < 15 ? a : b, 0, 14 + (k % 6), 2 + ((k / 6) | 0), 0.5, 1); }
    const w = sim.planet.w;
    const lab = (c: number) => ((c % w) < 10 ? 0 : 1);
    const mixed = regionDivergence(sim, lab);
    expect(mixed.D).toBeGreaterThan(0.02);
    expect(mixed.topGenes.map((g) => g.key)).toEqual(expect.arrayContaining(['TOPT']));
    const sim2 = emptyWorld({ mutation: NO_MUT }, 0.2);
    ensureSpecies(sim2, a);
    for (let k = 0; k < 30; k++) { sim2.addOrganism(a, 0, 2 + (k % 6), 2 + ((k / 6) | 0), 0.5, 1); sim2.addOrganism(a, 0, 14 + (k % 6), 2 + ((k / 6) | 0), 0.5, 1); }
    expect(regionDivergence(sim2, lab).D).toBeCloseTo(0, 10);
  });
});

describe('especiação: veredito explicado, sem alterar a simulação', () => {
  it('população homogênea: nunca "split"; o relatório é puro (não muda espécies nem consome o RNG)', () => {
    const sim = emptyWorld({ mutation: NO_MUT, maxOrganisms: 4000 }, 0.2);
    const g = genome({}, 2);
    ensureSpecies(sim, g);
    for (let k = 0; k < 80; k++) sim.addOrganism(g, 0, 2 + (k % 10), 2 + ((k / 10) | 0), 0.5, 1);
    const rng0 = sim.rng.state, n0 = sim.species.size, hash0 = stateHash(sim);
    const rep = speciationReport(sim);
    expect(rep.length).toBe(1);
    expect(rep[0].verdict).toBe('homogeneous');
    expect(rep[0].explanation).toMatch(/homogêneo/);
    expect(sim.rng.state).toBe(rng0);
    expect(sim.species.size).toBe(n0);
    expect(stateHash(sim)).toBe(hash0);
  });

  it('dois agrupamentos distintos e isolados: veredito "split" (dry-run, sem dividir de fato)', () => {
    const sim = emptyWorld({ mutation: NO_MUT, maxOrganisms: 4000 }, 0.2);
    const a = genome({}, 2), b = genome({ PRED: 0.7, SIZE: 0.6, DEFENSE: 0.6, TOPT: 0.15, MOTIL: 0.7 }, 2);
    ensureSpecies(sim, a);
    for (let k = 0; k < 60; k++) sim.addOrganism(a, 0, 2 + (k % 10), 2 + ((k / 10) | 0), 0.5, 1);
    for (let k = 0; k < 30; k++) sim.addOrganism(b, 0, 14 + (k % 6), 10 + ((k / 6) | 0), 0.5, 1);
    const rep = speciationReport(sim);
    expect(rep[0].verdict).toBe('split');
    expect(rep[0].ratio!).toBeGreaterThan(1.5);
    expect(sim.species.size).toBe(1); // nada foi dividido
  });

  it('variação contínua (sem lacuna) é explicada como "no_gap" e não especia', () => {
    const sim = emptyWorld({ mutation: NO_MUT, maxOrganisms: 4000 }, 0.2);
    const base = genome({}, 2);
    ensureSpecies(sim, base);
    // nuvem contínua: cada indivíduo desloca alguns genes em pequenas quantidades aleatórias
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5);
    for (let k = 0; k < 120; k++) {
      const g = new Float32Array(base);
      for (const key of ['SIZE', 'PHOTO', 'OSMO', 'MOTIL', 'TOPT', 'TTOL', 'DEFENSE', 'META']) g[G[key as keyof typeof G]] = Math.min(1, Math.max(0, g[G[key as keyof typeof G]] + rnd() * 0.3));
      sim.addOrganism(g, 0, 2 + (k % 12), 2 + ((k / 12) | 0), 0.5, 1);
    }
    const rep = speciationReport(sim);
    expect(['no_gap', 'homogeneous', 'no_isolation']).toContain(rep[0].verdict);
    expect(rep[0].verdict).not.toBe('split');
  });
});

describe('extinções: causa provável pela composição das mortes recentes', () => {
  it('uma espécie sem fonte de energia se extingue por fome, e o registro mostra a composição', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.2);
    const g = genome({ PHOTO: 0, OSMO: 0, MOTIL: 0 });
    ensureSpecies(sim, g);
    for (let k = 0; k < 30; k++) sim.addOrganism(g, 0, 3 + (k % 5), 3 + ((k / 5) | 0), 1, 1.2);
    sim.species.get(1).peak = 30;
    sim.run(150);
    const ex = extinctionReport(sim);
    expect(ex.length).toBe(1);
    const sum = Object.values(ex[0].shares).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    const top = Object.entries(ex[0].shares).sort((a, b) => b[1] - a[1])[0][0];
    expect(['starve', 'thermal']).toContain(top);
    expect(ex[0].probableCause).toMatch(/Fome|Estresse/);
    const ev = sim.events.items.find((e) => e.type === 'extinction')!;
    expect(ev.text).toMatch(/Causa provável/);
  });
});

describe('rastreador de sobrevivência e reprodução por característica', () => {
  it('mostra, com dados, que genótipos mal ajustados à temperatura morrem mais e se reproduzem menos', () => {
    const sim = emptyWorld({ mutation: NO_MUT, maxOrganisms: 6000, seed: 9 }, 0.15);
    const T = sim.planet.temp[8 * sim.planet.w + 8];
    const hot = (T + 5) / 50;
    const base = { PHOTO: 0.85, OSMO: 0.2, PRED: 0, TTOL: 0.2, MOTIL: 0.1, REPRO: 0.2, SIZE: 0.1 };
    const good = genome({ ...base, TOPT: hot }, 4), bad = genome({ ...base, TOPT: Math.max(0, hot - 0.3) }, 4);
    ensureSpecies(sim, good);
    const tr = new FitnessTracker(sim, [G.TOPT]);
    sim.tracker = tr;
    for (let k = 0; k < 60; k++) { sim.addOrganism(good, 0, 2 + (k % 20), 2 + ((k / 20) | 0) * 4, 1.5, 6); sim.addOrganism(bad, 0, 2.5 + (k % 20), 2.5 + ((k / 20) | 0) * 4, 1.5, 6); }
    sim.run(250);
    const bins = tr.summary().TOPT;
    const gb = bins[Math.min(4, Math.floor(hot * 5))], bb = bins[Math.floor(Math.max(0, hot - 0.3) * 5)];
    expect(gb.exposure).toBeGreaterThan(0);
    expect(bb.exposure).toBeGreaterThan(0);
    expect(gb.netRate).toBeGreaterThan(bb.netRate); // o ajustado cresce mais (ou morre menos)
  });

  it('observar não altera a simulação: o estado é idêntico com e sem rastreador', () => {
    const a = smallSim({ seed: 21 }), b = smallSim({ seed: 21 });
    b.tracker = new FitnessTracker(b);
    a.run(400);
    b.run(400);
    expect(stateHash(b)).toBe(stateHash(a));
  });
});

describe('habitats', () => {
  it('descreve a colonização: animais em terra, aptos à vida terrestre e cobertura de plantas', () => {
    const sim = stage3Sim({ initialPopulation: 600, seed: 3 });
    sim.run(800);
    sim.flora!.colonize(sim.planet, sim.tick, 40);
    sim.run(400);
    const h = habitatReport(sim);
    expect(h.landFraction).toBeGreaterThan(0.2);
    expect(h.plants).toBe(sim.flora!.pool.count);
    expect(h.plantCoverage).toBeGreaterThan(0);
    expect(h.animalsOnLand).toBe(0); // nenhum foi introduzido; nada surge "de graça"
    expect(h.landCapable).toBeLessThan(0.01);
    expect(GENE_COUNT).toBe(36);
    expect(new Simulation({ initialPopulation: 5 }).stage3).toBe(false);
  });
});
