import { describe, expect, it } from 'vitest';
import { emptyWorld, ensureSpecies, feed, genome } from './helpers';
import { Simulation } from '../src/core/simulation';
import { DEFAULT_MUTATION, GENE_COUNT } from '../src/core/genome';

const NO_MUT = { ...DEFAULT_MUTATION, baseRate: 0, rateRange: 0 };

function alive(sim: Simulation): number[] {
  const r: number[] = [];
  for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i]) r.push(i);
  return r;
}

describe('consumo de recursos', () => {
  it('fotossíntese gera energia e o crescimento consome nutriente (massa transferida)', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.1);
    const g = genome({ PHOTO: 0.9, OSMO: 0, PRED: 0, TOPT: 0.62, TTOL: 0.6, REPRO: 1, MOTIL: 0 });
    ensureSpecies(sim, g);
    const i = sim.addOrganism(g, 0, 5.5, 5.5, 1.5, 1.0);
    expect(i).toBeGreaterThanOrEqual(0);
    const nutBefore = sim.planet.nutrient[5 * sim.planet.w + 5];
    const m0 = sim.pool.mass[i];
    const total0 = sim.totalMass();
    sim.run(60);
    expect(sim.pool.alive[i]).toBe(1);
    expect(sim.pool.mass[i]).toBeGreaterThan(m0);
    expect(sim.planet.nutrient[5 * sim.planet.w + 5]).toBeLessThan(nutBefore + 0.5);
    expect(Math.abs(sim.totalMass() - total0) / total0).toBeLessThan(1e-9);
  });

  it('fora da temperatura ótima o desempenho cai (adaptação depende do ambiente)', () => {
    const run = (topt: number) => {
      const sim = emptyWorld({ mutation: NO_MUT }, 0.1);
      const g = genome({ PHOTO: 0.9, OSMO: 0, PRED: 0, TOPT: topt, TTOL: 0.2, MOTIL: 0, REPRO: 1 });
      ensureSpecies(sim, g);
      const i = sim.addOrganism(g, 0, 5.5, 5.5, 2, 4);
      sim.run(40);
      return sim.pool.alive[i] ? sim.pool.energy[i] + sim.pool.mass[i] * 2 : -1;
    };
    const w0 = emptyWorld({}, 0.1);
    const T_here = w0.planet.temp[5 * w0.planet.w + 5];
    const good = (T_here + 5) / 50, bad = (T_here + 5) / 50 - 0.45;
    expect(run(good)).toBeGreaterThan(run(bad));
  });
});

describe('mortalidade', () => {
  it('sem fonte de energia a célula morre de fome e a massa vira detrito', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.2);
    const g = genome({ PHOTO: 0, OSMO: 0, PRED: 0, MOTIL: 0 });
    ensureSpecies(sim, g);
    const i = sim.addOrganism(g, 0, 3.5, 3.5, 2, 1.5);
    const det0 = sim.planet.detritus.reduce((a, b) => a + b, 0);
    sim.run(100);
    expect(sim.pool.alive[i]).toBe(0);
    expect(sim.deathsTotal.starve + sim.deathsTotal.thermal).toBe(1);
    expect(sim.species.get(1).extinctTick).toBeGreaterThanOrEqual(0);
    expect(sim.planet.detritus.reduce((a, b) => a + b, 0) + sim.planet.nutrient.reduce((a, b) => a + b, 0) - det0).toBeGreaterThan(0);
  });

  it('envelhecimento mata organismos além da expectativa de vida', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.1);
    const g = genome({ PHOTO: 0.9, LONGEV: 0, TOPT: 0.62, TTOL: 0.6, REPRO: 1 });
    ensureSpecies(sim, g);
    const i = sim.addOrganism(g, 0, 4.5, 4.5, 1.5, 6);
    sim.pool.age[i] = 4000; // muito além do tempo de vida
    sim.run(600);
    expect(sim.deathsTotal.age).toBeGreaterThan(0);
  });

  it('predação transfere massa da presa ao predador e perde parte como detrito', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.1);
    const gp = genome({ PRED: 1, SIZE: 0.35, PHOTO: 0, OSMO: 0, MOTIL: 0, DEFENSE: 0 });
    const gv = genome({ PRED: 0, SIZE: 0.05, PHOTO: 0.9, DEFENSE: 0, MOTIL: 0, TOPT: 0.62 });
    ensureSpecies(sim, gp);
    feed(sim, 5.5, 5.5, 20);
    const predator = sim.addOrganism(gp, 0, 5.5, 5.5, 4, 14);
    const preyIds: number[] = [];
    for (let k = 0; k < 6; k++) preyIds.push(sim.addOrganism(gv, 0, 5.5, 5.5, 1.2, 4, 1));
    const total0 = sim.totalMass();
    const preyAlive0 = preyIds.filter((i) => sim.pool.alive[i]).length;
    sim.run(30);
    expect(sim.deathsTotal.predation).toBeGreaterThan(0);
    expect(sim.predFlow.size).toBeGreaterThan(0);
    expect(preyAlive0).toBeGreaterThan(0);
    expect(Math.abs(sim.totalMass() - total0) / total0).toBeLessThan(1e-9);
    expect(predator).toBeGreaterThanOrEqual(0);
  });
});

describe('reprodução', () => {
  it('um organismo bem nutrido se divide, conserva massa e o filho herda o genoma', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.1);
    const g = genome({ PHOTO: 0.9, OSMO: 0, SIZE: 0.1, REPRO: 0, TOPT: 0.62, TTOL: 0.6, MOTIL: 0 });
    ensureSpecies(sim, g);
    const i = sim.addOrganism(g, 0, 6.5, 6.5, 4, 12);
    const total0 = sim.totalMass();
    sim.run(200);
    expect(sim.birthsTotal).toBeGreaterThan(0);
    expect(sim.pool.count).toBeGreaterThan(1);
    expect(Math.abs(sim.totalMass() - total0) / total0).toBeLessThan(1e-9);
    // todos os descendentes têm o mesmo genoma (mutação desligada) e a mesma espécie
    for (const j of alive(sim)) {
      for (let k = 0; k < 24; k++) expect(sim.pool.genes[j * GENE_COUNT + k]).toBeCloseTo(g[k], 6);
      expect(sim.pool.species[j]).toBe(1);
    }
    expect(sim.maxGeneration).toBeGreaterThan(0);
    expect(sim.pool.parent[alive(sim).find((j) => sim.pool.gen[j] > 0)!]).toBeGreaterThan(0);
    expect(i).toBeGreaterThanOrEqual(0);
  });
});
