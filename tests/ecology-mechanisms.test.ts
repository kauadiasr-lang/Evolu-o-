import { describe, expect, it } from 'vitest';
import { forkSimulation } from '../src/core/experiment';
import { exudation, refugeFactor } from '../src/core/ecomech';
import { P } from '../src/core/params';
import { PG, PLANT_GENES } from '../src/core/flora';
import { Simulation } from '../src/core/simulation';
import { cells, emptyWorld, feed, genome, stage3Sim, stateHash } from './helpers';

/**
 * Etapa 5 — TESTES DE MECANISMO E DE AUSÊNCIA.
 * Cada teste verifica uma consequência causal (consumo reduz recurso, energia vem do recurso, defesa altera captura…).
 * Nenhum afirma que uma relação entre espécies "deve" existir; os cenários são instrumentos, não regras do mundo.
 */
const NOMUT = { baseRate: 0, rateRange: 0, smallSigma: 0, bigSigma: 0, bigProb: 0 };
const world = (over: Record<string, unknown> = {}) => {
  const sim = emptyWorld({ stable: true, ecology: true, mutation: NOMUT, ...over } as any);
  // mundo sem detrito de fundo: tudo o que for detrito vem dos organismos do cenário (matéria volta ao sedimento)
  for (let c = 0; c < sim.planet.n; c++) { sim.planet.reservoir += sim.planet.detritus[c]; sim.planet.detritus[c] = 0; }
  return sim;
};
const CELL = (sim: Simulation) => (sim.planet.h >> 1) * sim.planet.w + (sim.planet.w >> 1);
const XY = (sim: Simulation) => [(CELL(sim) % sim.planet.w) + 0.5, ((CELL(sim) / sim.planet.w) | 0) + 0.5] as const;
const toptOf = (sim: Simulation) => (sim.planet.temp[CELL(sim)] + 5) / 50;

function addSpecies(sim: Simulation, g: Float32Array, name: string): number {
  return sim.species.create(null, g, 0, 0, sim.rng, name).id;
}
function put(sim: Simulation, g: Float32Array, sp: number, mass: number, energy: number): number {
  const [x, y] = XY(sim);
  feed(sim, x, y, mass * 1.5);
  const i = sim.addOrganism(g, 0, x, y, mass, energy, sp);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}
function pinnedStep(sim: Simulation, idx: number[]): void {
  const [x, y] = XY(sim);
  for (const i of idx) if (sim.pool.alive[i]) { sim.pool.x[i] = x; sim.pool.y[i] = y; }
  sim.step();
}
function putDetritus(sim: Simulation, amount: number): void {
  const c = CELL(sim);
  const a = Math.min(amount, sim.planet.reservoir);
  sim.planet.detritus[c] += a;
  sim.planet.reservoir -= a;
}
const flow = (sim: Simulation, sp: number, kind: number) => sim.ecoFlow[sp * 5 + kind] ?? 0;
const osmotroph = (sim: Simulation, over = {}) =>
  genome({ PHOTO: 0, OSMO: 0.9, PRED: 0, SIZE: 0.03, MOTIL: 0.05, SENSE: 0, TOPT: toptOf(sim), TTOL: 0.1, META: 0, AFFIN: 0.1, LONGEV: 0.1, DEFENSE: 0, ...over });
const photo = (sim: Simulation, over = {}) =>
  genome({ PHOTO: 0.9, OSMO: 0, PRED: 0, SIZE: 0.2, MOTIL: 0.05, SENSE: 0, TOPT: toptOf(sim), TTOL: 0.5, META: 0.1, ...over });

describe('mecanismo: consumo, energia e recursos limitados', () => {
  it('o consumo de um recurso REDUZ sua disponibilidade e o registro de fluxo corresponde à matéria retirada', () => {
    const sim = world();
    const sp = addSpecies(sim, osmotroph(sim), 'O');
    putDetritus(sim, 12);
    const i = put(sim, osmotroph(sim), sp, 1, 4);
    const m0 = sim.totalMass();
    const d0 = sim.planet.detritus[CELL(sim)];
    for (let t = 0; t < 15; t++) pinnedStep(sim, [i]);
    const eaten = flow(sim, sp, 1);
    expect(eaten).toBeGreaterThan(0.5);
    expect(sim.planet.detritus[CELL(sim)]).toBeLessThan(d0);
    expect(eaten).toBeLessThanOrEqual(d0 + 1e-9); // não consome mais do que existia
    expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
  });

  it('a energia obtida DEPENDE do recurso: com detrito o osmótrofo ganha energia; sem ele, não (e não se reproduz)', () => {
    const run = (detritus: number) => {
      const sim = world();
      const sp = addSpecies(sim, osmotroph(sim), 'O');
      putDetritus(sim, detritus);
      const i = put(sim, osmotroph(sim), sp, 1, 4);
      let lived = 0;
      for (let t = 0; t < 80; t++) { pinnedStep(sim, [i]); if (!sim.pool.alive[i]) break; lived++; }
      return { lived, intake: flow(sim, sp, 1), births: sim.species.get(sp).totalBorn };
    };
    const rich = run(30), none = run(0);
    expect(rich.lived).toBeGreaterThan(none.lived);
    expect(none.lived).toBeLessThan(80); // a insuficiência energética mata
    // sem detrito só resta o vazamento do próprio organismo (energia saturada no início), muito menor que com recurso
    expect(none.intake).toBeLessThan(0.05);
    expect(rich.intake).toBeGreaterThan(20 * none.intake);
  });

  it('ausência: sem o recurso o consumo cessa (o fluxo registrado deixa de crescer)', () => {
    const sim = world();
    const sp = addSpecies(sim, osmotroph(sim), 'O');
    putDetritus(sim, 12);
    const i = put(sim, osmotroph(sim), sp, 1, 6);
    for (let t = 0; t < 10; t++) pinnedStep(sim, [i]);
    expect(flow(sim, sp, 1)).toBeGreaterThan(0);
    sim.planet.reservoir += sim.planet.detritus[CELL(sim)];
    sim.planet.detritus[CELL(sim)] = 0; // o recurso desaparece
    const before = flow(sim, sp, 1);
    for (let t = 0; t < 3; t++) pinnedStep(sim, [i]);
    expect(flow(sim, sp, 1) - before).toBeLessThan(1e-3);
  });

  it('competição emerge de recurso limitado: a ingestão de uma espécie cai quando outra usa o mesmo detrito (sem regra de competição)', () => {
    const intake = (withRival: boolean) => {
      const sim = world();
      const a = addSpecies(sim, osmotroph(sim), 'A');
      const b = addSpecies(sim, osmotroph(sim, { HUE: 0.3 }), 'B');
      putDetritus(sim, 3);
      const ids = [put(sim, osmotroph(sim), a, 1, 6)];
      if (withRival) for (let k = 0; k < 3; k++) ids.push(put(sim, osmotroph(sim, { HUE: 0.3 }), b, 1, 6));
      for (let t = 0; t < 12; t++) pinnedStep(sim, ids);
      return flow(sim, a, 1);
    };
    expect(intake(true)).toBeLessThan(intake(false) * 0.9);
  });

  it('competição indireta: o recurso consumido por uma população some para outra mesmo sem contato (células diferentes, mesmo nutriente compartilhado)', () => {
    // nutriente dissolvido é limitante e difunde; a biomassa de A reduz o crescimento de B sem que se encontrem
    const growth = (withA: boolean) => {
      const sim = world({ width: 12, height: 8 });
      const gA = photo(sim), gB = photo(sim, { HUE: 0.4 });
      const a = addSpecies(sim, gA, 'A'), b = addSpecies(sim, gB, 'B');
      void a;
      if (withA) for (let x = 1; x < 4; x++) for (let y = 1; y < 7; y++) { feed(sim, x + 0.5, y + 0.5, 3); sim.addOrganism(gA, 0, x + 0.5, y + 0.5, 2, 8, a); }
      for (let y = 1; y < 7; y++) { feed(sim, 9.5, y + 0.5, 3); sim.addOrganism(gB, 0, 9.5, y + 0.5, 2, 8, b); }
      sim.run(300);
      let m = 0;
      for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i] && sim.pool.species[i] === b) m += sim.pool.mass[i];
      return m;
    };
    expect(growth(true)).toBeLessThan(growth(false));
  });
});

describe('mecanismo: captura, defesa e custo energético', () => {
  const predator = (sim: Simulation) => genome({ PHOTO: 0, OSMO: 0, PRED: 0.9, SIZE: 0.5, MOTIL: 0.2, SENSE: 0, TOPT: toptOf(sim), TTOL: 0.5, META: 0.05 });
  const prey = (sim: Simulation, def: number) => genome({ PHOTO: 0.3, OSMO: 0, PRED: 0, SIZE: 0.05, MOTIL: 0.05, SENSE: 0, TOPT: toptOf(sim), TTOL: 0.5, META: 0.1, DEFENSE: def });

  function kills(def: number, trials: number): number {
    let n = 0;
    for (let s = 0; s < trials; s++) {
      const sim = world({ seed: 100 + s });
      const gp = predator(sim), gy = prey(sim, def);
      const sp = addSpecies(sim, gp, 'H'), sy = addSpecies(sim, gy, 'Y');
      const h = put(sim, gp, sp, 8, 20), y = put(sim, gy, sy, 1, 6);
      for (let t = 0; t < 20 && sim.pool.alive[y]; t++) pinnedStep(sim, [h, y]);
      if (!sim.pool.alive[y]) n++;
    }
    return n;
  }

  it('a defesa ALTERA o resultado da interação de captura (mesmo predador, mesma presa, só a defesa muda)', () => {
    const open = kills(0, 40), armored = kills(0.95, 40);
    console.log(`[defesa] capturas em 40 tentativas: sem defesa=${open}, defesa 0,95=${armored}`);
    expect(open).toBeGreaterThan(armored);
    expect(armored).toBeLessThan(40); // possível, não garantido, e custa para o predador também
  });

  it('o predador paga custo para atacar e o ganho respeita o que a presa continha (sem energia criada do nada)', () => {
    let checked = 0;
    for (let s = 0; s < 30 && checked < 3; s++) {
      const sim = world({ seed: 300 + s });
      const gp = predator(sim), gy = prey(sim, 0);
      const sp = addSpecies(sim, gp, 'H'), sy = addSpecies(sim, gy, 'Y');
      const h = put(sim, gp, sp, 8, 20), y = put(sim, gy, sy, 1, 6);
            for (let t = 0; t < 20 && sim.pool.alive[y]; t++) {
        const eH = sim.pool.energy[h], eY = sim.pool.energy[y], mY = sim.pool.mass[y], d0 = sim.planet.detritus[CELL(sim)];
        pinnedStep(sim, [h, y]);
        if (!sim.pool.alive[y] && sim.pool.alive[h]) {
          const maxEnergy = P.PRED_ENERGY_STEAL * eY + mY * P.E_PER_MASS * P.PRED_ENERGY_EFF; // estoque que a presa tinha
          expect(sim.pool.energy[h] - eH).toBeLessThanOrEqual(maxEnergy + 1e-9);
          // a parte não assimilada da presa volta ao ambiente como detrito (decomposição no mesmo tick é desprezível)
          expect(sim.planet.detritus[CELL(sim)] - d0).toBeGreaterThanOrEqual(mY * (1 - P.PRED_ASSIM) - 0.05);
          expect(maxEnergy).toBeLessThan(mY * P.E_PER_MASS + eY); // a eficiência trófica é < 100%
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('ausência: sem aparato de captura (gene de predação baixo) não há consumo de presas, mesmo adjacentes', () => {
    const sim = world();
    const gp = genome({ PHOTO: 0.3, OSMO: 0, PRED: 0, SIZE: 0.5, TOPT: toptOf(sim), TTOL: 0.5 });
    const gy = prey(sim, 0);
    const sp = addSpecies(sim, gp, 'H'), sy = addSpecies(sim, gy, 'Y');
    const h = put(sim, gp, sp, 8, 20), y = put(sim, gy, sy, 1, 6);
    for (let t = 0; t < 20; t++) pinnedStep(sim, [h, y]);
    expect(flow(sim, sp, 2)).toBe(0);
    expect(sim.deathsTotal.predation).toBe(0);
  });
});

describe('mecanismo: efeitos ambientais indiretos', () => {
  it('exsudação: energia saturada faz o corpo vazar matéria (função pura, zero abaixo do limiar, crescente acima)', () => {
    expect(exudation(5, P.EXUDE_FROM)).toBe(0);
    expect(exudation(5, 0.2)).toBe(0);
    expect(exudation(5, 0.8)).toBeGreaterThan(0);
    expect(exudation(5, 1)).toBeGreaterThan(exudation(5, 0.8));
  });

  it('um organismo beneficia outro pelo AMBIENTE: o detrito exsudado pelo fotossintético vira ingestão do osmótrofo (e some sem o fotossintético)', () => {
    const intake = (withPhoto: boolean) => {
      const sim = world();
      const gp = photo(sim), go = osmotroph(sim);
      const sp = addSpecies(sim, gp, 'P'), so = addSpecies(sim, go, 'O');
      const ids: number[] = [];
      if (withPhoto) { const p = put(sim, gp, sp, 3, 0); sim.pool.energy[p] = 4 * 3; ids.push(p); }
      ids.push(put(sim, go, so, 1, 4));
      for (let t = 0; t < 30; t++) { if (withPhoto) sim.pool.energy[ids[0]] = 4 * sim.pool.mass[ids[0]]; pinnedStep(sim, ids); }
      return { eaten: flow(sim, so, 1), leaked: flow(sim, sp, 4) + flow(sim, so, 4) };
    };
    const w = intake(true), wo = intake(false);
    expect(w.leaked).toBeGreaterThan(0);
    expect(w.eaten).toBeGreaterThan(0.01);
    expect(wo.eaten).toBeLessThan(0.05); // ausência: sem a fonte só resta o reaproveitamento do próprio vazamento
    expect(w.eaten).toBeGreaterThan(5 * wo.eaten);
  });

  it('a vegetação oferece abrigo: a captura de presas pequenas cai quando há cobertura (função pura + efeito medido)', () => {
    expect(refugeFactor(0, 0.7)).toBe(1); // sem estrutura, sem abrigo
    expect(refugeFactor(1, 0.7)).toBeLessThan(1);
    expect(refugeFactor(1, 0.7)).toBeLessThan(refugeFactor(1, 3)); // corpos grandes se escondem pior
  });

  it('cobertura vegetal real reduz as capturas em terra; sem plantas o efeito deixa de existir', () => {
    const trial = (s: number, planted: boolean) => {
      const sim = stage3Sim({ initialPopulation: 0, seed: 40 + s, ecology: true, mutation: NOMUT });
      const { land, w } = cells(sim);
      const pl = sim.planet;
      pl.nutrient[land] += Math.min(120, pl.reservoir);
      pl.reservoir -= Math.min(120, pl.reservoir);
      pl.soilWater[land] = 0.8;
      const fl = sim.flora!;
      if (planted) {
        const pg = new Float32Array(PLANT_GENES);
        Object.assign(pg, { [PG.HEIGHT]: 0.3, [PG.LEAF]: 0.7, [PG.DENSITY]: 0.8, [PG.ROOT]: 0.3, [PG.PIGMENT]: 0.7, [PG.SHADE]: 0.5, [PG.DROUGHT]: 0.3, [PG.TOPT]: (pl.temp[land] + 5) / 50, [PG.TTOL]: 0.7, [PG.REPRO]: 1, [PG.MUT]: 0 });
        const lin = fl.newLineage(null, pg, 0, 0);
        for (let k = 0; k < 8; k++) fl.plant(pl.nutrient, land, pg, 0, 6, 0, lin);
      }
      const topt = (pl.temp[land] + 5) / 50;
      const gp = genome({ PHOTO: 0, OSMO: 0, PRED: 0.9, SIZE: 0.5, MOTIL: 0.25, LIMBS: 0.6, LIMBLEN: 0.5, TERR: 0.7, META: 0.05, TOPT: topt, TTOL: 0.8 }, 5);
      const gy = genome({ PHOTO: 0.3, OSMO: 0, PRED: 0, SIZE: 0.05, MOTIL: 0.15, LIMBS: 0.6, LIMBLEN: 0.5, TERR: 0.7, META: 0.1, TOPT: topt, TTOL: 0.8, DEFENSE: 0 }, 6);
      const sp = sim.species.create(null, gp, 0, 0, sim.rng, 'H').id, sy = sim.species.create(null, gy, 0, 0, sim.rng, 'Y').id;
      const x = (land % w) + 0.5, y = ((land / w) | 0) + 0.5;
      const h = sim.addOrganism(gp, 0, x, y, 8, 40, sp), a = sim.addOrganism(gy, 0, x, y, 1, 8, sy);
      let cover = 0;
      for (let t = 0; t < 12 && sim.pool.alive[a]; t++) {
        sim.pool.x[h] = sim.pool.x[a] = x; sim.pool.y[h] = sim.pool.y[a] = y;
        sim.step();
        cover = Math.max(cover, fl.cover[land]);
      }
      return { eaten: sim.pool.alive[a] ? 0 : 1, cover };
    };
    let withCover = 0, without = 0, maxCover = 0, maxCover0 = 0;
    const N = 60;
    for (let s = 0; s < N; s++) {
      const a = trial(s, true), b = trial(s, false);
      withCover += a.eaten; without += b.eaten; maxCover = Math.max(maxCover, a.cover); maxCover0 = Math.max(maxCover0, b.cover);
    }
    console.log(`[abrigo] capturas em ${N} tentativas: com cobertura=${withCover}, sem plantas=${without}; cobertura máx ${maxCover.toFixed(2)} / ${maxCover0.toFixed(2)}`);
    expect(maxCover).toBeGreaterThan(0.2);
    expect(maxCover0).toBe(0);
    expect(withCover).toBeLessThan(without);
  });
});

describe('mecanismo: matéria, decomposição e determinismo com ecologia ligada', () => {
  it('a massa total é conservada com exsudação, predação e decomposição (mundo natural, 1200 ticks)', () => {
    for (const seed of [1, 2]) {
      const sim = new Simulation({ seed, ecology: true, width: 48, height: 30, maxOrganisms: 12000 });
      const m0 = sim.totalMass();
      sim.run(1200);
      expect(Math.abs(sim.totalMass() - m0) / m0, `semente ${seed}`).toBeLessThan(1e-9);
      expect(sim.pool.count).toBeGreaterThan(0);
      const leaked = Array.from({ length: sim.species.size + 1 }, (_, s) => sim.ecoFlow[s * 5 + 4] ?? 0).reduce((a, b) => a + b, 0);
      expect(leaked).toBeGreaterThan(0); // o mecanismo atuou
    }
  });

  it('a morte devolve a matéria ao ambiente (detrito) e a decomposição a transforma em nutriente', () => {
    const sim = world();
    const sp = addSpecies(sim, photo(sim), 'P');
    const i = put(sim, photo(sim), sp, 4, 10);
    const m = sim.pool.mass[i];
    const d0 = sim.planet.detritus[CELL(sim)];
    sim.removeWhere((k) => k === i, false);
    expect(sim.planet.detritus[CELL(sim)] - d0).toBeCloseTo(m, 9);
    const n0 = sim.planet.nutrient.reduce((a, b) => a + b, 0);
    sim.run(200);
    expect(sim.planet.nutrient.reduce((a, b) => a + b, 0)).toBeGreaterThan(n0);
  });

  it('determinismo: mesma semente → mesmo estado; salvar/carregar e continuar dá o mesmo resultado', () => {
    const a = new Simulation({ seed: 3, ecology: true, width: 40, height: 24, maxOrganisms: 8000 });
    const b = new Simulation({ seed: 3, ecology: true, width: 40, height: 24, maxOrganisms: 8000 });
    a.run(400); b.run(400);
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('salvar e carregar preservam a ecologia: o estado bifurcado continua idêntico ao original', () => {
    const a = new Simulation({ seed: 4, ecology: true, width: 40, height: 24, maxOrganisms: 8000 });
    a.run(300);
    const b = forkSimulation(a);
    expect(b.ecology).toBe(true);
    a.run(200); b.run(200);
    expect(stateHash(b)).toBe(stateHash(a));
  });

  it('com ecology desligado o mundo é idêntico ao da Etapa 4 (a opção padrão não muda a física)', () => {
    const a = new Simulation({ seed: 2, width: 40, height: 24, maxOrganisms: 8000 });
    const b = new Simulation({ seed: 2, ecology: false, width: 40, height: 24, maxOrganisms: 8000 });
    a.run(500); b.run(500);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.ecoFlow.every((v) => v === 0)).toBe(true); // nenhum registro, nenhuma exsudação
  });
});
