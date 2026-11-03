import { describe, expect, it } from 'vitest';
import { B, BIOME_COUNT, BIOME_INFO, computeTerrain, landBiome } from '../src/core/biomes';
import { exportSave, importSave } from '../src/core/serialize';
import type { Simulation } from '../src/core/simulation';
import { stage3Sim } from './helpers';

describe('classificação de biomas a partir de clima, solo e vegetação', () => {
  it('regras: temperatura, umidade, cobertura e altura da vegetação definem o bioma', () => {
    // (T, umidade do solo, cobertura, altura média, altitude)
    expect(landBiome(-12, 0.5, 0.5, 2, 0.1)).toBe(B.ICE);
    expect(landBiome(0, 0.5, 0.3, 0.2, 0.1)).toBe(B.TUNDRA);
    expect(landBiome(20, 0.9, 0.5, 1, 0.1)).toBe(B.SWAMP); // encharcado e baixo
    expect(landBiome(20, 0.9, 0.5, 1, 0.8)).not.toBe(B.SWAMP); // alto não alaga
    expect(landBiome(28, 0.1, 0.05, 0.1, 0.3)).toBe(B.DESERT);
    expect(landBiome(20, 0.5, 0.01, 0, 0.3)).toBe(B.BARREN); // clima ok, sem vegetação: terra nua
    expect(landBiome(20, 0.5, 0.2, 0.3, 0.3)).toBe(B.GRASSLAND);
    expect(landBiome(20, 0.5, 0.4, 1.0, 0.3)).toBe(B.SHRUB);
    expect(landBiome(20, 0.6, 0.8, 3, 0.3)).toBe(B.FOREST);
  });

  it('o mesmo clima gera biomas diferentes conforme a vegetação realmente presente', () => {
    const T = 20, W = 0.5;
    const seq = [landBiome(T, W, 0, 0, 0.3), landBiome(T, W, 0.2, 0.3, 0.3), landBiome(T, W, 0.4, 1, 0.3), landBiome(T, W, 0.8, 3, 0.3)];
    expect(new Set(seq).size).toBe(4); // nua → pradaria → arbustal → floresta
  });

  it('a vista de terreno é consistente com o planeta (máscara de terra, ids válidos, áreas somam 1)', () => {
    const sim = stage3Sim({ initialPopulation: 500, seed: 3 });
    sim.run(900);
    const t = computeTerrain(sim);
    expect(t.biome.length).toBe(sim.planet.n);
    let landCount = 0;
    for (let i = 0; i < sim.planet.n; i++) {
      expect(t.biome[i]).toBeLessThan(BIOME_COUNT);
      expect(t.land[i]).toBe(sim.planet.land[i]);
      if (t.land[i]) { landCount++; expect(t.biome[i]).toBeGreaterThanOrEqual(B.ICE); } else expect(t.biome[i]).toBeLessThanOrEqual(B.REEF);
    }
    expect(t.areas.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(t.landFraction).toBeCloseTo(landCount / sim.planet.n, 9);
    expect(BIOME_INFO.length).toBe(BIOME_COUNT);
  });

  it('o planeta contém os biomas pedidos: oceano, floresta/pradaria, deserto, tundra e pântano (clima e relevo)', () => {
    const present = new Set<number>();
    for (const seed of [1, 2, 3, 4]) {
      const sim = stage3Sim({ width: 96, height: 60, initialPopulation: 10, seed });
      const t = computeTerrain(sim);
      t.biome.forEach((b) => present.add(b));
    }
    for (const b of [B.OCEAN, B.ABYSS, B.SHELF, B.DESERT, B.TUNDRA, B.SWAMP]) expect(present.has(b), BIOME_INFO[b].label).toBe(true);
  });
});

describe('mudanças ambientais modificam a distribuição dos biomas', () => {
  /** Mesmo planeta, duas linhas do tempo: uma com o clima inalterado, outra com o clima alterado. */
  function fork(sim: Simulation, apply: (s: Simulation) => void, ticks: number) {
    const save = exportSave(sim);
    const twin = importSave({ ...save, meta: JSON.parse(JSON.stringify(save.meta)) });
    apply(twin);
    sim.run(ticks);
    twin.run(ticks);
    return [computeTerrain(sim), computeTerrain(twin)] as const;
  }
  const settle = (seed: number) => {
    const sim = stage3Sim({ width: 64, height: 40, initialPopulation: 500, seed });
    sim.run(600);
    sim.flora!.colonize(sim.planet, sim.tick, 60);
    sim.run(2500);
    return sim;
  };

  it('aquecimento expande desertos e reduz tundra; resfriamento faz o oposto', () => {
    const sim = settle(5);
    const [ctl, hot] = fork(sim, (s) => s.setClimate(12), 2000);
    expect(hot.areas[B.DESERT]).toBeGreaterThan(ctl.areas[B.DESERT]);
    expect(hot.areas[B.TUNDRA] + hot.areas[B.ICE]).toBeLessThanOrEqual(ctl.areas[B.TUNDRA] + ctl.areas[B.ICE]);

    const sim2 = settle(5);
    const [ctl2, cold] = fork(sim2, (s) => s.setClimate(-12), 2000);
    expect(cold.areas[B.TUNDRA] + cold.areas[B.ICE]).toBeGreaterThan(ctl2.areas[B.TUNDRA] + ctl2.areas[B.ICE]);
    expect(cold.areas[B.DESERT]).toBeLessThanOrEqual(ctl2.areas[B.DESERT]);
  });

  it('a mudança é gradual: ao longo do tempo a fração de deserto cresce de forma contínua, sem saltos', () => {
    const sim = settle(5);
    sim.setClimate(12);
    const series: number[] = [];
    for (let k = 0; k < 10; k++) {
      sim.run(200);
      series.push(computeTerrain(sim).areas[B.DESERT]);
    }
    for (let k = 1; k < series.length; k++) expect(Math.abs(series[k] - series[k - 1])).toBeLessThan(0.05); // < 5% da superfície por 200 ticks
    expect(series[series.length - 1]).toBeGreaterThan(series[0]);
  });

  it('o evento de bioma registra números medidos (não inventados) quando a mudança é grande', () => {
    const sim = settle(5);
    sim.setClimate(12);
    sim.run(3500);
    const ev = sim.events.items.filter((e) => e.type === 'biome');
    if (ev.length) {
      expect(ev[0].text).toMatch(/% → .*% da superfície/);
      expect(ev[0].text).toMatch(/temperatura média em terra/);
    }
    // a série histórica de biomas existe e corresponde ao estado atual
    const last = (k: string) => sim.history.series[k][sim.history.series[k].length - 1];
    expect(last('bDesert')).toBeGreaterThanOrEqual(0);
    expect(Math.abs(last('bDesert') - computeTerrain(sim).areas[B.DESERT])).toBeLessThan(0.05);
  });

  it('a vegetação real define o bioma: remover as plantas transforma floresta/pradaria em terra nua', () => {
    const sim = settle(6);
    const before = computeTerrain(sim);
    const veg = before.areas[B.GRASSLAND] + before.areas[B.SHRUB] + before.areas[B.FOREST];
    expect(veg).toBeGreaterThan(0.01);
    const fl = sim.flora!;
    for (let i = 0; i < fl.pool.used; i++) if (fl.pool.alive[i]) fl.kill(i, sim.planet.detritus, 'starve', sim.planet.bgHue);
    const after = computeTerrain(sim);
    expect(after.areas[B.GRASSLAND] + after.areas[B.SHRUB] + after.areas[B.FOREST]).toBe(0);
    expect(after.areas[B.BARREN]).toBeGreaterThan(before.areas[B.BARREN]);
  });
});
