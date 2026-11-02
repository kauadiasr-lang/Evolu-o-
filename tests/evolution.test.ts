import { describe, expect, it } from 'vitest';
import { DEFAULT_MUTATION, G, GENE_COUNT, protocellGenome } from '../src/core/genome';
import { updateSpecies } from '../src/core/species';
import { Rng } from '../src/core/rng';
import { emptyWorld, ensureSpecies, feed, genome } from './helpers';
import { Simulation } from '../src/core/simulation';

const NO_MUT = { ...DEFAULT_MUTATION, baseRate: 0, rateRange: 0 };

function count(sim: Simulation, pred: (i: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i] && pred(i)) n++;
  return n;
}

describe('seleção natural', () => {
  it('em ambiente quente, o genótipo adaptado ao calor supera o adaptado ao frio (sem mutação)', () => {
    const sim = emptyWorld({ mutation: NO_MUT, maxOrganisms: 6000 }, 0.15);
    const T = sim.planet.temp[8 * sim.planet.w + 8];
    const hot = (T + 5) / 50;
    const base = { PHOTO: 0.85, OSMO: 0.2, PRED: 0, TTOL: 0.25, MOTIL: 0.1, REPRO: 0.2, SIZE: 0.1 };
    const gHot = genome({ ...base, TOPT: hot }, 4);
    const gCold = genome({ ...base, TOPT: Math.max(0, hot - 0.4) }, 4);
    ensureSpecies(sim, gHot);
    for (let k = 0; k < 60; k++) {
      sim.addOrganism(gHot, 0, 2 + (k % 20), 2 + ((k / 20) | 0) * 4, 1.5, 6);
      sim.addOrganism(gCold, 0, 2.5 + (k % 20), 2.5 + ((k / 20) | 0) * 4, 1.5, 6);
    }
    sim.run(900);
    const nHot = count(sim, (i) => Math.abs(sim.pool.genes[i * GENE_COUNT + G.TOPT] - hot) < 0.01);
    const nCold = count(sim, (i) => Math.abs(sim.pool.genes[i * GENE_COUNT + G.TOPT] - (hot - 0.4)) < 0.01);
    expect(nHot).toBeGreaterThan(20);
    expect(nHot).toBeGreaterThan(nCold * 3);
  });

  it('com mutação, a população desajustada evolui em direção ao ótimo térmico (adaptação gradual)', () => {
    const sim = emptyWorld({ maxOrganisms: 15000, seed: 21 }, 0.15);
    const T = sim.planet.temp[8 * sim.planet.w + 8];
    const hot = (T + 5) / 50;
    const start = Math.max(0, hot - 0.06);
    const rng = new Rng(9);
    const g = new Float32Array(GENE_COUNT);
    protocellGenome(rng, g, 0, 0.02);
    g[G.TOPT] = start;
    g[G.TTOL] = 0.35;
    g[G.MUT] = 0.8;
    g[G.PHOTO] = 0.85;
    ensureSpecies(sim, g);
    for (let k = 0; k < 150; k++) sim.addOrganism(g, 0, 2 + (k % 20), 2 + ((k / 20) | 0) * 1.5, 1.5, 6);
    const mean = () => {
      let s = 0, n = 0;
      for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i]) { s += sim.pool.genes[i * GENE_COUNT + G.TOPT]; n++; }
      return n ? s / n : NaN;
    };
    const m0 = mean();
    sim.run(5000);
    const m1 = mean();
    expect(sim.pool.count).toBeGreaterThan(30);
    expect(m1).toBeGreaterThan(m0 + 0.04); // moveu-se na direção do ótimo
    expect(m1).toBeLessThan(hot + 0.15); // sem "saltos perfeitos"
    expect(sim.maxGeneration).toBeGreaterThan(20);
  });
});

describe('especiação e extinção', () => {
  function populated(): Simulation {
    const sim = emptyWorld({ mutation: NO_MUT, maxOrganisms: 4000 }, 0.2);
    const g = genome({}, 2);
    ensureSpecies(sim, g);
    return sim;
  }

  it('população homogênea não gera novas espécies', () => {
    const sim = populated();
    const g = genome({}, 2);
    for (let k = 0; k < 80; k++) sim.addOrganism(g, 0, 2 + (k % 10), 2 + ((k / 10) | 0), 0.5, 1);
    const ev = updateSpecies(sim.species, sim.pool, 100, sim.rng);
    expect(ev.length).toBe(0);
    expect(sim.species.size).toBe(1);
  });

  it('um agrupamento divergente e isolado vira nova espécie (com ancestral registrado)', () => {
    const sim = populated();
    const a = genome({}, 2);
    const b = genome({ PRED: 0.7, SIZE: 0.6, DEFENSE: 0.6, TOPT: 0.15, MOTIL: 0.7 }, 2);
    for (let k = 0; k < 60; k++) sim.addOrganism(a, 0, 2 + (k % 10), 2 + ((k / 10) | 0), 0.5, 1);
    const idx: number[] = [];
    for (let k = 0; k < 30; k++) idx.push(sim.addOrganism(b, 0, 14 + (k % 6), 10 + ((k / 6) | 0), 0.5, 1));
    expect(idx.every((i) => i >= 0)).toBe(true);
    const ev = updateSpecies(sim.species, sim.pool, 100, sim.rng);
    expect(ev.length).toBe(1);
    const child = ev[0].species;
    expect(child.parentId).toBe(1);
    expect(child.id).toBe(2);
    expect(count(sim, (i) => sim.pool.species[i] === 2)).toBe(30);
    expect(sim.species.get(1).count).toBe(60);
    expect(child.name.length).toBeGreaterThan(3);
  });

  it('divergência sem isolamento (misturados no espaço e no nicho) não especia', () => {
    const sim = populated();
    const a = genome({}, 2);
    // apenas genes neutros mudam de forma moderada, e as populações compartilham o mesmo local
    const b = genome({ HUE: 0.9, PATTERN: 0.8, NUCLEUS: 0.1, SYMM: 0.9, SAT: 0.9 }, 2);
    for (let k = 0; k < 60; k++) sim.addOrganism(a, 0, 2 + (k % 10), 2 + ((k / 10) | 0), 0.5, 1);
    for (let k = 0; k < 30; k++) sim.addOrganism(b, 0, 2 + (k % 10), 2 + ((k / 10) | 0), 0.5, 1);
    const ev = updateSpecies(sim.species, sim.pool, 100, sim.rng);
    expect(ev.length).toBe(0);
  });

  it('quando o último indivíduo morre, a espécie é extinta e o evento é registrado', () => {
    const sim = emptyWorld({ mutation: NO_MUT }, 0.2);
    const g = genome({ PHOTO: 0, OSMO: 0, MOTIL: 0 });
    ensureSpecies(sim, g);
    for (let k = 0; k < 30; k++) sim.addOrganism(g, 0, 3 + (k % 5), 3 + ((k / 5) | 0), 1, 1.2);
    sim.species.get(1).peak = 30;
    sim.run(120);
    const sp = sim.species.get(1);
    expect(sp.extinctTick).toBeGreaterThan(0);
    expect(sp.count).toBe(0);
    expect(sim.events.items.some((e) => e.type === 'extinction' && e.speciesId === 1)).toBe(true);
    expect(sim.events.items.some((e) => e.type === 'total_extinction')).toBe(true);
  });
});

describe('teias alimentares e cascatas', () => {
  it('predadores consomem presas e o fluxo trófico é registrado; sem presas, predadores declinam', () => {
    const sim = emptyWorld({ mutation: NO_MUT, maxOrganisms: 6000 }, 0.15);
    const T = sim.planet.temp[8 * sim.planet.w + 8];
    const topt = (T + 5) / 50;
    const prey = genome({ PHOTO: 0.9, OSMO: 0, PRED: 0, SIZE: 0.05, TOPT: topt, TTOL: 0.4, REPRO: 0.1, MOTIL: 0 }, 5);
    const pred = genome({ PHOTO: 0, OSMO: 0.1, PRED: 0.9, SIZE: 0.3, TOPT: topt, TTOL: 0.4, MOTIL: 0.2, DEFENSE: 0 }, 6);
    ensureSpecies(sim, prey);
    const sp2 = sim.species.create(sim.species.get(1), pred, 0, 0, sim.rng, 'Praedator testus').id;
    for (let k = 0; k < 80; k++) sim.addOrganism(prey, 0, 2 + (k % 20), 2 + ((k / 20) | 0) * 3, 1.2, 5, 1);
    for (let k = 0; k < 10; k++) sim.addOrganism(pred, 0, 3 + k * 2, 5, 2.5, 10, sp2);
    sim.run(250);
    expect(sim.deathsTotal.predation).toBeGreaterThan(5);
    const key = sp2 * 1e6 + 1;
    expect(sim.predFlow.has(key)).toBe(true);
    // cascata: extermina as presas -> predadores sofrem escassez
    const predBefore = sim.species.get(sp2).count;
    for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i] && sim.pool.species[i] === 1) (sim as any).kill(i, 'impact');
    sim.run(200);
    expect(sim.species.get(sp2).count).toBeLessThan(Math.max(predBefore, 1));
  });
});

describe('intervenções do jogador respeitam a conservação de massa', () => {
  it('erupção, impacto, extinção em massa, pincéis e semeadura conservam a massa total', () => {
    const sim = new Simulation({ width: 40, height: 24, maxOrganisms: 12000, initialPopulation: 300, seed: 5 });
    const m0 = sim.totalMass();
    sim.run(300);
    sim.paint('nutrients', 10, 10, 3);
    sim.paint('erupt', 20, 12, 3);
    sim.run(50);
    sim.paint('impact', 15, 8, 3);
    sim.paint('warm', 5, 5, 4);
    sim.paint('deepen', 5, 5, 4);
    sim.paint('seed', 12, 12, 3);
    sim.run(50);
    sim.massExtinction(0.5);
    sim.setClimate(-4);
    sim.run(300);
    expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
    expect(sim.events.items.some((e) => e.type === 'eruption')).toBe(true);
    expect(sim.events.items.some((e) => e.type === 'mass_extinction')).toBe(true);
  });

  it('erupções naturais só ocorrem quando a pressão geológica acumulada permite', () => {
    const sim = emptyWorld({}, 0.8);
    sim.planet.pressure = 10;
    sim.run(50);
    expect(sim.events.items.some((e) => e.type === 'eruption')).toBe(false);
    sim.planet.pressure = 400;
    sim.run(2);
    expect(sim.events.items.some((e) => e.type === 'eruption')).toBe(true);
    expect(sim.planet.pressure).toBeLessThan(400);
    feed(sim, 1, 1, 0);
  });
});
