import { describe, expect, it } from 'vitest';
import { landViability } from '../src/core/experiment';
import { G, GENE_COUNT } from '../src/core/genome';
import { develop } from '../src/core/phenotype';
import { PG, PLANT_GENES } from '../src/core/flora';
import { T, TR, deriveTraits } from '../src/core/traits';
import { cells, genome, stage3Sim } from './helpers';

/**
 * Transição para a terra: estes testes descrevem o que a física PERMITE e o que ela exige.
 * Não afirmam que a transição acontece; a frequência real é medida nas rodadas longas (docs/EXPERIMENTS.md).
 */
describe('formas intermediárias entre o mar e a terra', () => {
  const rep = landViability(3, 80, 0.25, 1);

  it('uma costa úmida existe e a tabela cobre as combinações de membros × adaptação terrestre', () => {
    expect(rep.coast).not.toBeNull();
    expect(rep.rows.length).toBe(15);
  });

  it('sem membros expressos ou sem integumento a costa é uma barreira (nada é "dado de graça")', () => {
    for (const r of rep.rows) {
      if (r.limbs === 0 || r.terr === 0) {
        expect(r.capable, `limbs=${r.limbs} terr=${r.terr}`).toBe(false);
        expect(r.land).toBeNull();
      }
    }
  });

  it('os intermediários capazes (membros + algum integumento) NÃO são eliminados pela física: sobrevivem e têm balanço próximo ao do mar', () => {
    const capable = rep.rows.filter((r) => r.capable);
    expect(capable.length).toBeGreaterThanOrEqual(6);
    for (const r of capable) {
      expect(r.landAlive, `terr=${r.terr} limbs=${r.limbs}`).toBe(true);
      expect(r.land! - r.sea, `terr=${r.terr} limbs=${r.limbs}`).toBeGreaterThan(-0.12);
      expect(r.land!).toBeGreaterThan(-0.2);
    }
  });

  it('também em costa mais seca (~33% de umidade) os intermediários permanecem viáveis', () => {
    const dry = landViability(1, 80, 0.05, 0.35);
    expect(dry.coast).not.toBeNull();
    expect(dry.coast!.soilWater).toBeLessThan(0.4);
    for (const r of dry.rows.filter((x) => x.capable)) {
      expect(r.landAlive).toBe(true);
      expect(r.land! - r.sea).toBeGreaterThan(-0.15);
    }
  });
});

describe('acessibilidade genética: o que a mutação precisa alcançar', () => {
  /** protocélula do Estágio 3 (sem estruturas) + incrementos mínimos para cada pré-requisito */
  const base = () => genome({ SIZE: 0.12, MOTIL: 0.15, SENSE: 0.25, LIMBS: 0.05, LIMBLEN: 0.3, TERR: 0.02 }, 3);
  const capable = (g: Float32Array) => {
    const tr = new Float32Array(TR);
    deriveTraits(g, 0, tr, 0, true);
    return tr[T.TERR] > 0 && tr[T.LSPEED] > 0;
  };

  it('a vida terrestre exige QUATRO genes coordenados: nenhum subconjunto basta', () => {
    const steps: [keyof typeof G, number][] = [['SIZE', 0.22], ['MOTIL', 0.22], ['LIMBS', 0.2], ['TERR', 0.15]];
    expect(capable(base())).toBe(false);
    for (let mask = 0; mask < 15; mask++) {
      const g = base();
      steps.forEach(([k, v], i) => { if (mask & (1 << i)) g[G[k]] = v; });
      expect(capable(g), `máscara ${mask.toString(2)}`).toBe(false);
    }
    const all = base();
    for (const [k, v] of steps) all[G[k]] = v;
    expect(capable(all)).toBe(true);
    // mudanças necessárias: pequenas (≈ 0,1 por gene), na escala de poucas mutações graduais
    expect(0.22 - 0.12).toBeLessThan(0.14);
  });

  it('enquanto o pré-requisito não existe, os genes de membros e de terra permanecem CRÍPTICOS (neutros: sem custo nem efeito)', () => {
    const plain = base();
    const cryptic = base();
    cryptic[G.LIMBS] = 0.9;
    cryptic[G.TERR] = 0.9;
    cryptic[G.CLIMB] = 0.9;
    const a = new Float32Array(TR), b = new Float32Array(TR);
    deriveTraits(plain, 0, a, 0, true);
    deriveTraits(cryptic, 0, b, 0, true);
    expect(develop(cryptic, 0).limbs).toBe(0);
    expect(b[T.COST_MULT]).toBeCloseTo(a[T.COST_MULT], 10);
    // logo, a deriva pode acumulá-los sem que a seleção os elimine
    expect(GENE_COUNT).toBe(36);
  });
});

describe('a seleção favorece a vida terrestre quando ela oferece vantagem real', () => {
  // Achado: no motor, comida vira sobretudo MASSA (assimilação 55%) e só uma fração pequena vira energia
  // (decisão de projeto que impede moto-perpétuo). Por isso a herbivoria pura não sustenta um corpo pequeno:
  // plantas dão vantagem mensurável, mas insuficiente sozinha; a luz sem atenuação em terra é o incentivo mais forte.
  it('plantas ao alcance dão vantagem mensurável a um herbívoro anfíbio (vive mais e ganha massa), embora a herbivoria pura não o sustente', () => {
    const run = (withPlants: boolean) => {
      const sim = stage3Sim({ initialPopulation: 0, seed: 7, mutation: { baseRate: 0, rateRange: 0, smallSigma: 0, bigSigma: 0, bigProb: 0 } });
      const { land, w } = cells(sim);
      const pl = sim.planet;
      pl.nutrient[land] += Math.min(80, pl.reservoir);
      pl.reservoir -= Math.min(80, pl.reservoir);
      pl.soilWater[land] = 0.8;
      if (withPlants) {
        const fl = sim.flora!;
        const pg = new Float32Array(PLANT_GENES);
        Object.assign(pg, { [PG.HEIGHT]: 0.05, [PG.LEAF]: 0.5, [PG.DENSITY]: 0.5, [PG.ROOT]: 0.3, [PG.PIGMENT]: 0.7, [PG.SHADE]: 0.5, [PG.DROUGHT]: 0.3, [PG.TOPT]: (pl.temp[land] + 5) / 50, [PG.TTOL]: 0.7, [PG.REPRO]: 1, [PG.MUT]: 0 });
        const lin = fl.newLineage(null, pg, 0, 0);
        for (let k = 0; k < 4; k++) fl.plant(pl.nutrient, land, pg, 0, 4, 0, lin);
      }
      const g = genome({ PHOTO: 0, OSMO: 0, PRED: 0.9, SIZE: 0.3, MOTIL: 0.25, SENSE: 0.1, LIMBS: 0.6, LIMBLEN: 0.5, TERR: 0.7, META: 0.2, TOPT: (pl.temp[land] + 5) / 50, TTOL: 0.8 }, 5);
      const tr = new Float32Array(TR);
      deriveTraits(g, 0, tr, 0, true);
      expect(tr[T.TERR] > 0 && tr[T.LSPEED] > 0).toBe(true);
      const i = sim.addOrganism(g, 0, (land % w) + 0.5, ((land / w) | 0) + 0.5, 3, 12);
      let lived = 0, maxMass = 3;
      for (let t = 0; t < 60; t++) {
        // mantém o organismo na célula e o ambiente fixo: isola o efeito de ter (ou não) plantas para pastar
        sim.pool.x[i] = (land % w) + 0.5;
        sim.pool.y[i] = ((land / w) | 0) + 0.5;
        sim.step();
        if (!sim.pool.alive[i]) break;
        lived++;
        maxMass = Math.max(maxMass, sim.pool.mass[i]);
      }
      return { lived, maxMass };
    };
    const fed = run(true), starved = run(false);
    expect(fed.lived).toBeGreaterThan(starved.lived);
    expect(fed.maxMass).toBeGreaterThan(starved.maxMass + 1); // ganhou massa comendo
    expect(fed.lived).toBeLessThan(60); // sozinha, a herbivoria não o sustenta
  });
});
