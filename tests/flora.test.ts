import { describe, expect, it } from 'vitest';
import { FP, Flora, HK, PG, PLANT_GENES, plantForm, FORMS } from '../src/core/flora';
import { Simulation } from '../src/core/simulation';
import { exportSave, importSave } from '../src/core/serialize';
import { plantVis } from '../src/worker/summary';
import { cells, stage3Sim } from './helpers';

/** Genoma de planta com valores explícitos (o restante é neutro). */
function pg(over: Partial<Record<keyof typeof PG, number>> = {}): Float32Array {
  const g = new Float32Array(PLANT_GENES);
  const base: Record<keyof typeof PG, number> = { HEIGHT: 0.2, LEAF: 0.5, DENSITY: 0.5, ROOT: 0.4, PIGMENT: 0.7, SHADE: 0.5, DROUGHT: 0.3, TOPT: 0.55, TTOL: 0.6, REPRO: 0.9, MUT: 0 };
  for (const k of Object.keys(base) as (keyof typeof PG)[]) g[PG[k]] = over[k] ?? base[k];
  return g;
}

/** Mundo sem animais, ambiente congelado em uma célula de terra úmida e quente, com nutrientes à vontade. */
function lab() {
  const sim = stage3Sim({ initialPopulation: 0, seed: 7 });
  const pl = sim.planet, fl = sim.flora!;
  const { land, w } = cells(sim);
  // três células vizinhas em linha: A, B, C (todas de terra)
  const idx = [land, land + 1, land - 1];
  for (const c of idx) {
    pl.temp[c] = 21;
    pl.light[c] = 1;
    pl.soilWater[c] = 0.8;
    const mv = Math.min(80, pl.reservoir);
    pl.nutrient[c] += mv;
    pl.reservoir -= mv;
  }
  const lin = fl.newLineage(null, pg(), 0, 0);
  const add = (c: number, g: Float32Array, mass: number) => {
    const i = fl.plant(pl.nutrient, c, g, 0, mass, 0, lin);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
  };
  /** avança só a flora, mantendo o ambiente fixo */
  const steps = (n: number, hold?: () => void) => {
    for (let t = 1; t <= n; t++) { hold?.(); fl.step(pl, t); }
  };
  return { sim, pl, fl, idx, add, steps, w };
}

describe('competição por luz: o dossel sombreia', () => {
  it('uma árvore alta reduz a luz que chega ao chão e às plantas baixas da mesma célula', () => {
    const { pl, fl, idx, add, steps } = lab();
    const [A, B] = idx;
    add(A, pg({ HEIGHT: 0.8, DENSITY: 0.8, LEAF: 0.7 }), 9);
    const short = add(A, pg({ HEIGHT: 0.05 }), 1);
    const control = add(B, pg({ HEIGHT: 0.05 }), 1);
    steps(1);
    expect(fl.understory[A]).toBeLessThan(0.55); // dossel denso
    expect(fl.understory[B]).toBeGreaterThan(fl.understory[A]);
    steps(25);
    // a baixa sombreada rende menos que a idêntica ao sol
    expect(fl.pool.alive[control]).toBe(1);
    expect(fl.pool.energy[short] / Math.max(1e-9, fl.pool.mass[short])).toBeLessThan(fl.pool.energy[control] / Math.max(1e-9, fl.pool.mass[control]));
    expect(pl.light[A]).toBe(1); // a luz de superfície em si não muda: o dossel é que atenua
  });

  it('altura tem custo: ao sol pleno e sem vizinhas, a planta alta paga mais manutenção por massa', () => {
    const { fl, idx, add, steps } = lab();
    const [A, B] = idx;
    const tall = add(A, pg({ HEIGHT: 0.9, REPRO: 1 }), 3);
    const low = add(B, pg({ HEIGHT: 0.1, REPRO: 1 }), 3);
    const e0t = fl.pool.energy[tall], e0l = fl.pool.energy[low];
    steps(8);
    expect(fl.pool.energy[low] - e0l).toBeGreaterThan(fl.pool.energy[tall] - e0t);
  });

  it('tolerância à sombra: sob o dossel a tolerante rende mais; ao sol pleno a intolerante rende mais (trade-off)', () => {
    const energyGain = (shadeGene: number, underCanopy: boolean) => {
      const { fl, idx, add, steps } = lab();
      const [A] = idx;
      if (underCanopy) add(A, pg({ HEIGHT: 0.9, DENSITY: 0.9, LEAF: 0.9 }), 12);
      const i = add(A, pg({ HEIGHT: 0.05, SHADE: shadeGene, REPRO: 1 }), 1.2);
      const e0 = fl.pool.energy[i];
      steps(5);
      return fl.pool.alive[i] ? fl.pool.energy[i] + fl.pool.mass[i] * FP.BUILD - (e0 + 1.2 * FP.BUILD) : -99;
    };
    expect(energyGain(0.95, true)).toBeGreaterThan(energyGain(0.05, true));
    expect(energyGain(0.05, false)).toBeGreaterThan(energyGain(0.95, false));
  });
});

describe('competição por água e adaptação à seca', () => {
  const gain = (drought: number, water: number) => {
    const { pl, fl, idx, add, steps } = lab();
    const [A] = idx;
    const i = add(A, pg({ DROUGHT: drought, LEAF: 0.8, ROOT: 0.2, REPRO: 1 }), 1.5);
    const e0 = fl.pool.energy[i] + fl.pool.mass[i] * FP.BUILD;
    steps(6, () => { pl.soilWater[A] = water; });
    return fl.pool.energy[i] + fl.pool.mass[i] * FP.BUILD - e0;
  };
  it('na seca a tolerante vai melhor; com água abundante a não tolerante vai melhor', () => {
    expect(gain(0.9, 0.15)).toBeGreaterThan(gain(0.05, 0.15)); // seca moderada
    expect(gain(0.05, 0.9)).toBeGreaterThan(gain(0.9, 0.9));
  });

  it('plantas disputam o mesmo solo: mais plantas na célula esgotam mais a água disponível', () => {
    const left = (n: number) => {
      const { pl, fl, idx, add, steps } = lab();
      const [A] = idx;
      for (let k = 0; k < n; k++) add(A, pg({ LEAF: 0.9, DENSITY: 0.9, ROOT: 0.1 }), 3);
      pl.soilWater[A] = 0.6;
      steps(12);
      void fl;
      return pl.soilWater[A];
    };
    expect(left(5)).toBeLessThan(left(1));
  });

  it('raízes profundas alcançam água que as rasas não alcançam', () => {
    const e = (root: number) => {
      const { pl, fl, idx, add, steps } = lab();
      const [A] = idx;
      const i = add(A, pg({ ROOT: root, LEAF: 0.8, REPRO: 1 }), 2);
      const e0 = fl.pool.energy[i] + fl.pool.mass[i] * FP.BUILD;
      steps(6, () => { pl.soilWater[A] = 0.12; });
      return fl.pool.energy[i] + fl.pool.mass[i] * FP.BUILD - e0;
    };
    expect(e(0.95)).toBeGreaterThan(e(0.05));
  });
});

describe('hereditariedade e mutação das plantas', () => {
  it('descendentes herdam o genoma; mutações são graduais e alteram a aparência quando ocorrem', () => {
    const { fl, idx, add } = lab();
    const parent = add(idx[0], pg({ MUT: 1, HEIGHT: 0.4 }), 4);
    const kid = add(idx[1], pg(), 1);
    let identical = 0, changedVisual = 0, jumps = 0, mutated = 0;
    const g = fl.pool.genes;
    const pv = plantVis(Array.from(g.subarray(parent * PLANT_GENES, (parent + 1) * PLANT_GENES)), 1);
    for (let n = 0; n < 500; n++) {
      fl.inheritPlant(parent, kid);
      let same = true;
      for (let k = 0; k < PLANT_GENES; k++) {
        const d = Math.abs(g[kid * PLANT_GENES + k] - g[parent * PLANT_GENES + k]);
        if (d > 0) { same = false; mutated++; if (d > 0.3) jumps++; }
        expect(g[kid * PLANT_GENES + k]).toBeGreaterThanOrEqual(0);
        expect(g[kid * PLANT_GENES + k]).toBeLessThanOrEqual(1);
      }
      if (same) identical++;
      const kv = plantVis(Array.from(g.subarray(kid * PLANT_GENES, (kid + 1) * PLANT_GENES)), 1);
      if (kv.slice(0, 7).some((b, i) => Math.abs(b - pv[i]) > 2)) changedVisual++;
    }
    expect(identical).toBeGreaterThan(20); // há cópias exatas
    expect(mutated).toBeGreaterThan(200);
    expect(changedVisual).toBeGreaterThan(100); // a mutação muda o visual
    expect(jumps / mutated).toBeLessThan(0.08); // mudanças bruscas são raras
  });

  it('a forma de crescimento e o desenho dependem dos genes', () => {
    expect(plantForm(pg({ HEIGHT: 0.05 }))).toBe('musgo');
    expect(plantForm(pg({ HEIGHT: 0.8 }))).toBe('árvore');
    expect(plantForm(pg({ HEIGHT: 0.4 }))).toBe('arbusto');
    expect(plantForm(pg({ HEIGHT: 0.2, LEAF: 0.2 }))).toBe('gramínea');
    expect(plantForm(pg({ HEIGHT: 0.2, LEAF: 0.8 }))).toBe('erva');
    expect(plantForm(pg({ HEIGHT: 0.2, DROUGHT: 0.9, LEAF: 0.2 }))).toBe('suculenta');
    const a = plantVis(Array.from(pg({ HEIGHT: 0.8 })), 1), b = plantVis(Array.from(pg({ HEIGHT: 0.05 })), 1);
    expect(a[0]).toBeGreaterThan(b[0]);
    expect(a[8]).not.toBe(b[8]);
    expect(FORMS.length).toBe(6);
    expect(HK).toBeGreaterThan(0);
  });
});

describe('flora no mundo completo', () => {
  it('a colonização depende do estado real do mar: sem vida fotossintética a terra permanece estéril', () => {
    const empty = stage3Sim({ initialPopulation: 0 });
    empty.run(1200);
    expect(empty.flora!.colonized).toBe(false);
    expect(empty.flora!.pool.count).toBe(0);
    const alive = stage3Sim({ initialPopulation: 700 });
    alive.run(1500);
    expect(alive.flora!.colonized).toBe(true);
    expect(alive.flora!.pool.count).toBeGreaterThan(20);
    expect(alive.events.items.some((e) => e.type === 'flora' && /Colonização/.test(e.title))).toBe(true);
  });

  it('as plantas conservam a massa (nutriente → planta → detrito → nutriente) e nada fica negativo ou NaN', () => {
    const sim = stage3Sim({ initialPopulation: 600, seed: 3 });
    const m0 = sim.totalMass();
    sim.run(600);
    sim.flora!.colonize(sim.planet, sim.tick, 40);
    for (let t = 0; t < 8; t++) {
      sim.run(300);
      expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
    }
    const p = sim.flora!.pool;
    expect(p.count).toBeGreaterThan(30);
    for (let i = 0; i < p.used; i++) {
      if (!p.alive[i]) continue;
      expect(p.mass[i]).toBeGreaterThan(0);
      expect(Number.isFinite(p.energy[i])).toBe(true);
    }
    for (let i = 0; i < sim.planet.n; i++) {
      expect(sim.planet.soilWater[i]).toBeGreaterThanOrEqual(-1e-9);
      expect(sim.planet.soilWater[i]).toBeLessThanOrEqual(1 + 1e-9);
      expect(sim.planet.nutrient[i]).toBeGreaterThanOrEqual(-1e-9);
    }
    // contagens por célula batem com o pool
    let n = 0;
    for (let c = 0; c < sim.planet.n; c++) n += sim.flora!.cellCount[c];
    expect(n).toBe(p.count);
  });

  it('as plantas evoluem: surgem linhagens novas com genomas divergentes e diferentes formas de crescimento', () => {
    const sim = stage3Sim({ initialPopulation: 700, seed: 4 });
    sim.run(600);
    sim.flora!.colonize(sim.planet, sim.tick, 50);
    sim.run(3500);
    const fl = sim.flora!;
    expect(fl.pool.count).toBeGreaterThan(100);
    expect(fl.lineages.length).toBeGreaterThanOrEqual(2);
    expect(fl.lineages.some((l) => l.parentId > 0)).toBe(true); // houve ramificação
    // diversidade de genes e de formas
    const forms = new Set<string>();
    const h: number[] = [];
    const p = fl.pool;
    for (let i = 0; i < p.used; i++) if (p.alive[i]) { forms.add(plantForm(p.genes, i * PLANT_GENES)); h.push(p.genes[i * PLANT_GENES + PG.HEIGHT]); }
    expect(forms.size).toBeGreaterThanOrEqual(3);
    const mean = h.reduce((a, b) => a + b, 0) / h.length;
    const variance = h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length;
    expect(variance).toBeGreaterThan(0.001);
  });

  it('o ambiente decide a vegetação: o mesmo mundo, aquecido, perde água no solo e cobertura vegetal', () => {
    const base = stage3Sim({ initialPopulation: 700, seed: 6 });
    base.run(600);
    base.flora!.colonize(base.planet, base.tick, 50);
    base.run(1500);
    const save = exportSave(base);
    const twin = importSave({ ...save, meta: JSON.parse(JSON.stringify(save.meta)) });
    twin.setClimate(10);
    base.run(1500);
    twin.run(1500);
    const meanOf = (sim: Simulation, key: 'soilWater' | 'cover') => {
      const pl = sim.planet;
      let s = 0;
      for (const i of pl.landCells) s += key === 'soilWater' ? pl.soilWater[i] : sim.flora!.cover[i];
      return s / pl.landCells.length;
    };
    expect(meanOf(twin, 'soilWater')).toBeLessThan(meanOf(base, 'soilWater'));
    expect(meanOf(twin, 'cover')).not.toBeCloseTo(meanOf(base, 'cover'), 3);
  });

  it('herbívoros só alcançam plantas baixas; escaladores comem as altas (e a planta perde massa)', () => {
    const { pl, fl, idx, add } = lab();
    const A = idx[0];
    const treeI = add(A, pg({ HEIGHT: 0.9, REPRO: 1 }), 20);
    const hTree = Math.min(0.15 + 5 * 0.9, HK * Math.sqrt(20));
    expect(hTree).toBeGreaterThan(2.5);
    const m0 = fl.pool.mass[treeI];
    // alcance baixo: não consegue morder
    let eaten = 0;
    for (let k = 0; k < 20; k++) eaten += fl.graze(pl, A, 0.6, 1);
    expect(eaten).toBe(0);
    expect(fl.pool.mass[treeI]).toBe(m0);
    // alcance alto (escalada): morde e a massa sai da planta
    for (let k = 0; k < 20; k++) eaten += fl.graze(pl, A, 6, 1);
    expect(eaten).toBeGreaterThan(0);
    expect(fl.pool.mass[treeI]).toBeCloseTo(m0 - eaten, 9);
  });

  it('Flora é independente do restante: um planeta sem stage3 não tem flora', () => {
    const sim = new Simulation({ width: 30, height: 20, initialPopulation: 50, seed: 2 });
    expect(sim.flora).toBeNull();
    expect(sim.planet.landCells.length).toBe(0);
    void Flora;
  });
});
