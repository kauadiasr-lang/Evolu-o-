import { describe, expect, it } from 'vitest';
import { G, GENE_COUNT } from '../src/core/genome';
import { exportSave, importSave } from '../src/core/serialize';
import { Simulation } from '../src/core/simulation';
import { computeLayer } from '../src/core/layers';
import { takeSnapshot, VIS } from '../src/core/snapshot';
import { stage3Sim, stateHash } from './helpers';

describe('salvamento e carregamento dos dados genéticos e da Etapa 3', () => {
  it('um save continua exatamente a mesma história (animais, genes morfológicos, flora, solo)', () => {
    const a = stage3Sim({ initialPopulation: 500, seed: 9 });
    a.run(700);
    a.flora!.colonize(a.planet, a.tick, 40);
    a.seedArchetype('amphibian', 10, 10, 12, 2);
    a.run(500);
    const save = exportSave(a);
    const meta = JSON.parse(JSON.stringify(save.meta)); // meta precisa sobreviver ao JSON
    const b = importSave({ ...save, meta });
    expect(stateHash(b)).toBe(stateHash(a));
    // genes morfológicos preservados byte a byte
    const used = a.pool.used;
    expect(Array.from(b.pool.genes.subarray(0, used * GENE_COUNT))).toEqual(Array.from(a.pool.genes.subarray(0, used * GENE_COUNT)));
    expect(b.flora!.pool.count).toBe(a.flora!.pool.count);
    expect(b.flora!.lineages.length).toBe(a.flora!.lineages.length);
    expect(Array.from(b.planet.soilWater)).toEqual(Array.from(a.planet.soilWater));
    a.run(400);
    b.run(400);
    expect(stateHash(b)).toBe(stateHash(a));
    expect(b.totalMass()).toBeCloseTo(a.totalMass(), 6);
    expect(Array.from(b.planet.land)).toEqual(Array.from(a.planet.land));
  });

  it('versões antigas de save são recusadas com mensagem clara (sem corrupção silenciosa)', () => {
    const s = exportSave(stage3Sim({ initialPopulation: 50 }));
    expect(() => importSave({ ...s, version: 1 })).toThrow(/incompat/i);
  });
});

describe('compatibilidade com a simulação existente', () => {
  it('stage3 desligado: sem continentes, sem flora e genes morfológicos nulos em toda a população', () => {
    const sim = new Simulation({ width: 40, height: 24, initialPopulation: 200, seed: 7 });
    sim.run(400);
    expect(sim.stage3).toBe(false);
    expect(sim.flora).toBeNull();
    for (let i = 0; i < sim.pool.used; i++) {
      if (!sim.pool.alive[i]) continue;
      for (let k = G.SEGM; k <= G.HEAD; k++) expect(sim.pool.genes[i * GENE_COUNT + k]).toBe(0);
    }
  });

  it('camadas e snapshot funcionam com a flora e com os novos mapas (umidade, vegetação, biomas)', () => {
    const sim = stage3Sim({ initialPopulation: 500, seed: 3 });
    sim.run(700);
    sim.flora!.colonize(sim.planet, sim.tick, 40);
    sim.run(300);
    const out = new Float32Array(sim.planet.n);
    for (const kind of ['moisture', 'vegetation', 'biome', 'biomass', 'density', 'temp'] as const) {
      const r = computeLayer(sim, kind, 0, out);
      expect(Number.isFinite(r.max)).toBe(true);
      for (const v of out) expect(Number.isFinite(v)).toBe(true);
    }
    computeLayer(sim, 'biomass', 0, out);
    let s = 0;
    for (const v of out) s += v;
    expect(s).toBeCloseTo(sim.massBreakdown().organisms + sim.flora!.cellMass.reduce((a, b) => a + b, 0), 2);
    const snap = takeSnapshot(sim);
    expect(snap.vis.length).toBe(snap.n * VIS);
    const fs = sim.flora!.snapshot(sim.planet.w);
    expect(fs.n).toBe(sim.flora!.pool.count);
  });
});

describe('estabilidade da Etapa 3 (mundo com continentes)', () => {
  for (const seed of [1, 2, 3]) {
    it(`semente ${seed}: 3500 ticks sem explosão, NaN ou recursos negativos; massa total (incl. plantas) conservada`, () => {
      const sim = stage3Sim({ seed, initialPopulation: 500 });
      const m0 = sim.totalMass();
      let maxPop = 0;
      for (let t = 0; t < 3500; t++) {
        sim.step();
        maxPop = Math.max(maxPop, sim.pool.count);
        if (t % 700 === 0 && t > 0) expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
      }
      expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
      expect(maxPop).toBeLessThan(sim.cfg.maxOrganisms);
      expect(sim.pool.count).toBeGreaterThan(20);
      expect(sim.flora!.pool.count).toBeLessThanOrEqual(sim.cfg.maxPlants);
      for (let i = 0; i < sim.planet.n; i++) {
        expect(Number.isFinite(sim.planet.nutrient[i]) && sim.planet.nutrient[i] >= -1e-9).toBe(true);
        expect(Number.isFinite(sim.planet.detritus[i]) && sim.planet.detritus[i] >= -1e-9).toBe(true);
        expect(Number.isFinite(sim.planet.temp[i])).toBe(true);
      }
      for (let i = 0; i < sim.pool.used; i++) {
        if (!sim.pool.alive[i]) continue;
        expect(sim.pool.mass[i]).toBeGreaterThan(0);
        expect(Number.isFinite(sim.pool.energy[i])).toBe(true);
        expect(sim.pool.x[i]).toBeGreaterThanOrEqual(0);
        expect(sim.pool.x[i]).toBeLessThan(sim.planet.w);
      }
    });
  }

  it('sem IA: o mundo inteiro (inclusive arquétipos) roda sem nenhum componente de IA', () => {
    const sim = stage3Sim({ initialPopulation: 400, seed: 11 });
    sim.run(500);
    sim.seedArchetype('climber', 12, 14, 10, 2);
    sim.seedArchetype('swimmer', 14, 14, 10, 2);
    sim.run(500);
    expect(sim.pool.count).toBeGreaterThan(0);
    expect(sim.events.items.length).toBeGreaterThan(0);
  });

  it('ao semear um arquétipo a massa é conservada (vem do nutriente/sedimento) e a linhagem é registrada', () => {
    const sim = stage3Sim({ initialPopulation: 300, seed: 5 });
    sim.run(1200); // mar já esgotado perto da costa
    const m0 = sim.totalMass();
    const n = sim.seedArchetype('armored', 12, 12, 15, 2);
    expect(n).toBeGreaterThan(0);
    expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-12);
    const sp = sim.species.list[sim.species.size - 1];
    expect(sp.parentId).toBe(1);
    expect(sim.events.items.some((e) => /Arquétipo semeado/.test(e.title))).toBe(true);
  });

  it('eventos evolutivos reais: surgem registros de adaptações e a colonização aparece na história', () => {
    const sim = stage3Sim({ initialPopulation: 700, seed: 3 });
    sim.run(1500);
    expect(sim.events.items.some((e) => e.type === 'adaptation')).toBe(true);
    expect(sim.events.items.some((e) => e.type === 'flora')).toBe(true);
  });
});
