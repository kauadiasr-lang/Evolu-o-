import { describe, expect, it } from 'vitest';
import { validateEnvChange } from '../src/core/envchange';
import { exportSave, importSave } from '../src/core/serialize';
import { Simulation } from '../src/core/simulation';
import { forkSimulation } from '../src/core/experiment';
import { cells, emptyWorld, smallSim, stage3Sim, stateHash } from './helpers';

const meanLand = (sim: Simulation, arr: Float32Array) => {
  let s = 0;
  for (const i of sim.planet.landCells) s += arr[i];
  return s / sim.planet.landCells.length;
};

describe('padrões neutros: o ambiente só muda quando alguém (ou um cenário) pede', () => {
  it('o planeta nasce sem estações zeradas, sem aridez, sem filtro de luz e sem zonas climáticas', () => {
    const sim = smallSim();
    const p = sim.planet;
    expect([p.seasonAmp, p.aridity, p.aridityTarget, p.lightFactor, p.lightTarget, p.climateRate]).toEqual([1, 1, 1, 1, 1, 0.01]);
    expect(p.regionActive).toBe(false);
    expect(sim.geologyOn).toBe(true);
    expect(sim.schedule).toEqual([]);
  });

  it('ambiente estável: sem sazonalidade (temperatura e luz idênticas ao longo do ano) e sem erupções naturais', () => {
    const normal = smallSim({ seed: 3 }), stable = smallSim({ seed: 3, stable: true });
    const i = 10 * normal.planet.w + 10;
    const tAt = (s: Simulation, tick: number) => { s.planet.updateEnvironment(tick); return [s.planet.temp[i], s.planet.light[i]]; };
    const [t0n, l0n] = tAt(normal, 0), [t1n, l1n] = tAt(normal, 450); // um quarto do período: pico sazonal
    expect(Math.abs(t1n - t0n) + Math.abs(l1n - l0n)).toBeGreaterThan(0.2);
    const [t0s, l0s] = tAt(stable, 0), [t1s, l1s] = tAt(stable, 450);
    expect(t1s).toBeCloseTo(t0s, 9);
    expect(l1s).toBeCloseTo(l0s, 9);
    // pressão geológica alta não dispara erupção no ambiente estável
    stable.planet.pressure = 1000;
    stable.run(5);
    expect(stable.events.items.some((e) => e.type === 'eruption')).toBe(false);
    normal.planet.pressure = 1000;
    normal.run(5);
    expect(normal.events.items.some((e) => e.type === 'eruption')).toBe(true);
  });
});

describe('pressões ambientais: gradual × abrupta, sempre com massa conservada', () => {
  it('aridez: o solo seca gradualmente (ou rápido, se abrupta) e as plantas sofrem a mudança', () => {
    const fin = (abrupt: boolean) => {
      const sim = stage3Sim({ initialPopulation: 400, seed: 6, stable: true });
      sim.run(300);
      const m0 = sim.totalMass();
      const w0 = meanLand(sim, sim.planet.soilWater);
      sim.setAridity(0.35, abrupt);
      sim.run(120);
      const wMid = meanLand(sim, sim.planet.soilWater);
      sim.run(1200);
      expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
      return { w0, wMid, wEnd: meanLand(sim, sim.planet.soilWater) };
    };
    const g = fin(false), a = fin(true);
    expect(g.wMid).toBeLessThan(g.w0); // já começou a secar
    expect(g.wEnd).toBeLessThan(g.w0 * 0.75);
    expect(a.wMid).toBeLessThan(g.wMid); // abrupta seca mais rápido que gradual
  });

  it('luz: o multiplicador reduz a luz na superfície e a energia fotossintética', () => {
    const sim = emptyWorld({}, 0.1);
    const before = sim.planet.light[5 * sim.planet.w + 5];
    sim.setLight(0.5, true);
    sim.run(200);
    expect(sim.planet.lightFactor).toBeLessThan(0.55);
    expect(sim.planet.light[5 * sim.planet.w + 5]).toBeLessThan(before * 0.6);
  });

  it('esgotamento de nutrientes: move a fração ao sedimento (massa total conservada)', () => {
    const sim = smallSim({ seed: 5 });
    sim.run(200);
    const m0 = sim.totalMass();
    const nut0 = sim.planet.nutrient.reduce((a, b) => a + b, 0), res0 = sim.planet.reservoir;
    const moved = sim.depleteNutrients(0.4);
    expect(moved).toBeCloseTo(nut0 * 0.4, 6);
    expect(sim.planet.reservoir).toBeCloseTo(res0 + moved, 6);
    expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-12);
  });

  it('zona climática regional é persistente (não decai) e uma faixa letal mata quem tenta atravessá-la', () => {
    const sim = emptyWorld({}, 0.2);
    const { w } = cells(sim);
    sim.setRegionTemp(10, 0, 12, sim.planet.h - 1, 30);
    const c = 8 * w + 11;
    sim.planet.updateEnvironment(0);
    const t0 = sim.planet.temp[c];
    for (let k = 0; k < 400; k++) sim.planet.updateEnvironment(k);
    expect(sim.planet.temp[c]).toBeCloseTo(t0, 6); // userTemp decai; regionTemp não
    expect(t0).toBeGreaterThan(sim.planet.baseTemp[8 * w + 4] + 20);
  });
});

describe('mudanças programadas: reprodutíveis e documentadas', () => {
  it('são aplicadas exatamente no tick pedido, registradas como evento, e validadas', () => {
    const sim = smallSim({ seed: 7 });
    sim.scheduleChange({ tick: 150, kind: 'climate', value: 5, abrupt: true, label: 'Aquecimento de teste' });
    sim.run(149);
    expect(sim.planet.climateTarget).toBe(0);
    sim.run(2);
    expect(sim.planet.climateTarget).toBe(5);
    expect(sim.events.items.some((e) => e.type === 'env_change' && /Aquecimento de teste/.test(e.title))).toBe(true);
    expect(() => sim.scheduleChange({ tick: 10, kind: 'climate', value: 99 })).toThrow(/inválida/);
    expect(validateEnvChange({ tick: 1, kind: 'aridity', value: 5 })).toMatch(/fator/);
    expect(validateEnvChange({ tick: 1, kind: 'nutrient_depletion', value: 0.5 })).toBeNull();
  });

  it('bifurcação determinística: duas cópias idênticas seguem a mesma história; só a alterada diverge', () => {
    const a = smallSim({ seed: 9, stable: true });
    a.run(600);
    const b = forkSimulation(a), c = forkSimulation(a);
    expect(stateHash(b)).toBe(stateHash(a));
    c.scheduleChange({ tick: a.tick, kind: 'climate', value: 6, abrupt: true });
    a.run(300);
    b.run(300);
    c.run(300);
    expect(stateHash(b)).toBe(stateHash(a)); // sem mudança: idêntica
    expect(stateHash(c)).not.toBe(stateHash(a)); // com mudança: histórias diferentes
  });

  it('salvar/carregar preserva ambiente estável, pressões, zonas e agenda', () => {
    const a = stage3Sim({ initialPopulation: 300, seed: 3, stable: true });
    a.run(300);
    a.setAridity(0.6);
    a.setLight(0.8);
    a.setRegionTemp(5, 0, 6, 5, 8);
    a.scheduleChange({ tick: a.tick + 400, kind: 'nutrient_depletion', value: 0.3 });
    const s = exportSave(a);
    const b = importSave({ ...s, meta: JSON.parse(JSON.stringify(s.meta)) });
    expect(b.planet.seasonAmp).toBe(0);
    expect(b.geologyOn).toBe(false);
    expect([b.planet.aridityTarget, b.planet.lightTarget]).toEqual([0.6, 0.8]);
    expect(b.planet.regionActive).toBe(true);
    expect(b.schedule.length).toBe(1);
    a.run(600);
    b.run(600);
    expect(stateHash(b)).toBe(stateHash(a));
    expect(b.schedule[0].applied).toBe(true);
  });
});
