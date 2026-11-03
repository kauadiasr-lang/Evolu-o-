import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/simulation';

/** Simulação de longa duração (ative com EVOLVERE_LONG=1 / npm run test:long). */
const long = process.env.EVOLVERE_LONG ? describe : describe.skip;

long('longa duração (mundo padrão)', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: 30000 ticks estáveis`, () => {
      const sim = new Simulation({ seed });
      const m0 = sim.totalMass();
      let minPop = Infinity;
      let maxPop = 0;
      for (let t = 0; t < 30000; t++) {
        sim.step();
        if (t > 500) minPop = Math.min(minPop, sim.pool.count);
        maxPop = Math.max(maxPop, sim.pool.count);
        if (t % 2000 === 0) expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-8);
      }
      console.log(`[longrun] seed=${seed} pop=${sim.pool.count} max=${maxPop} min=${minPop} species=${sim.species.aliveCount()}/${sim.species.size} mass=${sim.totalMass().toFixed(3)}`);
      expect(maxPop).toBeLessThan(sim.cfg.maxOrganisms);
      expect(minPop).toBeGreaterThan(0);
      expect(sim.pool.count).toBeGreaterThan(0);
      expect(sim.species.size).toBeGreaterThan(1);
    });
  }
});

/** Etapa 3 (continentes, flora, morfologia, biomas): mesma exigência de estabilidade. */
long('longa duração — Etapa 3 (mundo padrão com continentes)', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: 30000 ticks estáveis, massa (incl. plantas) conservada`, () => {
      const sim = new Simulation({ seed, stage3: true });
      const m0 = sim.totalMass();
      let minPop = Infinity, maxPop = 0, maxPlants = 0;
      for (let t = 0; t < 30000; t++) {
        sim.step();
        if (t > 500) minPop = Math.min(minPop, sim.pool.count);
        maxPop = Math.max(maxPop, sim.pool.count);
        maxPlants = Math.max(maxPlants, sim.flora!.pool.count);
        if (t % 2000 === 0) expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-8);
      }
      const fl = sim.flora!;
      console.log(`[longrun-s3] seed=${seed} pop=${sim.pool.count} max=${maxPop} min=${minPop} species=${sim.species.aliveCount()}/${sim.species.size} plants=${fl.pool.count} maxPlants=${maxPlants} lineages=${fl.lineages.filter((l) => l.extinctTick < 0).length}/${fl.lineages.length} mass=${sim.totalMass().toFixed(3)}`);
      expect(maxPop).toBeLessThan(sim.cfg.maxOrganisms);
      expect(minPop).toBeGreaterThan(0);
      expect(fl.colonized).toBe(true);
      expect(fl.pool.count).toBeGreaterThan(0);
      expect(maxPlants).toBeLessThanOrEqual(sim.cfg.maxPlants);
      expect(sim.species.size).toBeGreaterThan(1);
    });
  }
});
