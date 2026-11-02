import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/simulation';
import { takeSnapshot } from '../src/core/snapshot';
import { computeLayer } from '../src/core/layers';
import { exportSave } from '../src/core/serialize';

describe('desempenho do motor', () => {
  it('mantém taxa de ticks adequada com milhares de organismos e snapshots baratos', () => {
    const sim = new Simulation({ seed: 1 });
    sim.run(800); // aquecimento
    const t0 = performance.now();
    sim.run(400);
    const tps = (400 * 1000) / (performance.now() - t0);
    console.log(`[perf] pop=${sim.pool.count} ticks/s=${tps.toFixed(0)}`);
    expect(sim.pool.count).toBeGreaterThan(2000);
    expect(tps).toBeGreaterThan(60);

    const s0 = performance.now();
    for (let i = 0; i < 10; i++) takeSnapshot(sim);
    const snapMs = (performance.now() - s0) / 10;
    const out = new Float32Array(sim.planet.n);
    const l0 = performance.now();
    for (let i = 0; i < 10; i++) computeLayer(sim, 'biodiversity', 0, out);
    const layerMs = (performance.now() - l0) / 10;
    const v0 = performance.now();
    exportSave(sim);
    const saveMs = performance.now() - v0;
    console.log(`[perf] snapshot=${snapMs.toFixed(2)}ms camada=${layerMs.toFixed(2)}ms save=${saveMs.toFixed(1)}ms`);
    expect(snapMs).toBeLessThan(20);
    expect(layerMs).toBeLessThan(20);
    expect(saveMs).toBeLessThan(500);
  });
});
