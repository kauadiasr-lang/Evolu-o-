import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/simulation';
import { smallSim, stateHash } from './helpers';
import { exportSave, importSave } from '../src/core/serialize';
import { computeLayer } from '../src/core/layers';
import { takeSnapshot, VIS } from '../src/core/snapshot';

function audit(sim: Simulation) {
  const pl = sim.planet, p = sim.pool;
  for (let i = 0; i < pl.n; i++) {
    expect(Number.isFinite(pl.nutrient[i])).toBe(true);
    if (pl.nutrient[i] < -1e-9 || pl.detritus[i] < -1e-9) throw new Error(`recurso negativo na célula ${i}: ${pl.nutrient[i]} ${pl.detritus[i]}`);
    if (!Number.isFinite(pl.temp[i])) throw new Error('temperatura não finita');
  }
  expect(pl.reservoir).toBeGreaterThanOrEqual(-1e-9);
  let n = 0;
  for (let i = 0; i < p.used; i++) {
    if (!p.alive[i]) continue;
    n++;
    if (!(p.mass[i] > 0) || !Number.isFinite(p.mass[i])) throw new Error(`massa inválida em ${i}: ${p.mass[i]}`);
    if (!Number.isFinite(p.energy[i])) throw new Error(`energia inválida em ${i}`);
    if (!(p.x[i] >= 0 && p.x[i] < pl.w && p.y[i] >= 0 && p.y[i] < pl.h)) throw new Error(`posição fora do mundo em ${i}: ${p.x[i]},${p.y[i]}`);
  }
  expect(n).toBe(p.count);
  // espécies: contagens batem com o pool
  const c = new Map<number, number>();
  for (let i = 0; i < p.used; i++) if (p.alive[i]) c.set(p.species[i], (c.get(p.species[i]) ?? 0) + 1);
  for (const s of sim.species.list) expect(s.count).toBe(c.get(s.id) ?? 0);
}

describe('estabilidade numérica e ecológica', () => {
  for (const seed of [1, 2, 3]) {
    it(`mundo seed=${seed}: 3500 ticks sem explosão, sem NaN, sem recursos negativos e com massa conservada`, () => {
      const sim = smallSim({ seed });
      const m0 = sim.totalMass();
      let maxPop = 0;
      for (let t = 0; t < 3500; t++) {
        sim.step();
        maxPop = Math.max(maxPop, sim.pool.count);
        if (t % 500 === 0) audit(sim);
      }
      audit(sim);
      expect(sim.pool.count).toBeGreaterThan(20); // sem extinção universal inesperada
      expect(maxPop).toBeLessThan(sim.cfg.maxOrganisms); // sem explosão
      expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
      // todo organismo vivo tem energia limitada
      for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i]) expect(sim.pool.energy[i]).toBeLessThanOrEqual(4 * sim.pool.mass[i] + 1e-6);
    });
  }

  it('ciclo de nutrientes: matéria dos mortos retorna ao nutriente (decomposição)', () => {
    const sim = smallSim({ seed: 4 });
    sim.run(1500);
    sim.massExtinction(1);
    const b = sim.massBreakdown();
    expect(b.organisms).toBeLessThan(1e-9);
    const nut0 = b.nutrient, det0 = b.detritus;
    expect(det0).toBeGreaterThan(50);
    sim.planet.updateEnvironment(sim.tick);
    for (let i = 0; i < 400; i++) sim.planet.stepChemistry();
    const b2 = sim.massBreakdown();
    expect(b2.nutrient).toBeGreaterThan(nut0);
    expect(b2.detritus).toBeLessThan(det0 * 0.5);
  });
});

describe('salvamento e carregamento', () => {
  it('um save carregado continua exatamente a mesma história (determinismo)', () => {
    const a = smallSim({ seed: 9 });
    a.run(700);
    a.paint('warm', 10, 10, 3);
    const save = exportSave(a);
    const copy = JSON.parse(JSON.stringify(save.meta)); // meta deve ser serializável em JSON
    expect(copy.tick).toBe(700);
    const b = importSave({ ...save, meta: copy });
    expect(stateHash(b)).toBe(stateHash(a));
    a.run(400);
    b.run(400);
    expect(stateHash(b)).toBe(stateHash(a));
    expect(b.species.size).toBe(a.species.size);
    expect(b.totalMass()).toBeCloseTo(a.totalMass(), 6);
  });
});

describe('camadas e snapshot', () => {
  it('camadas de mapa refletem o estado real do motor', () => {
    const sim = smallSim({ seed: 6 });
    sim.run(300);
    const out = new Float32Array(sim.planet.n);
    const d = computeLayer(sim, 'density', 0, out);
    let s = 0;
    for (const v of out) s += v;
    expect(s).toBe(sim.pool.count);
    expect(d.max).toBeGreaterThanOrEqual(1);
    computeLayer(sim, 'biomass', 0, out);
    s = 0;
    for (const v of out) s += v;
    expect(s).toBeCloseTo(sim.massBreakdown().organisms, 3);
    computeLayer(sim, 'species', 1, out);
    s = 0;
    for (const v of out) s += v;
    expect(s).toBe(sim.species.get(1).count);
    const snap = takeSnapshot(sim);
    expect(snap.n).toBe(sim.pool.count);
    expect(snap.vis.length).toBe(snap.n * VIS);
  });
});
