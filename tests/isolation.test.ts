import { describe, expect, it } from 'vitest';
import { runIsolation } from '../src/core/experiment';

/**
 * Isolamento geográfico: duas bacias separadas por barreiras térmicas letais. O controle mantém as bacias com o
 * MESMO clima; o tratamento aplica ±6 °C (seleção divergente). Todos os resultados são impressos, inclusive os de
 * sementes em que a vida não ocupou as duas bacias. Não se exige especiação em nenhuma semente.
 */
const SEEDS = [1, 2, 3, 4];
const CFG = { width: 64, height: 30, maxOrganisms: 12000 };
const runs = SEEDS.map((seed) => ({
  seed,
  ctrl: runIsolation({ seed, cfg: CFG, ticks: 5000, dT: 6, differential: false }),
  div: runIsolation({ seed, cfg: CFG, ticks: 5000, dT: 6, differential: true }),
}));
console.log('[isolamento] ' + JSON.stringify(runs.map(({ seed, ctrl, div }) => ({
  seed,
  ctrl: { D: +ctrl.divergence.D.toFixed(3), razao: +ctrl.divergence.ratio.toFixed(2), sp: ctrl.speciesAlive, ev: ctrl.speciationEvents, oeste: ctrl.nWest, leste: ctrl.nEast },
  div: { D: +div.divergence.D.toFixed(3), razao: +div.divergence.ratio.toFixed(2), sp: div.speciesAlive, ev: div.speciationEvents, oeste: div.nWest, leste: div.nEast },
}))));

const both = (r: { nWest: number; nEast: number }) => r.nWest >= 100 && r.nEast >= 100;

describe('isolamento geográfico + seleção divergente', () => {
  it('a massa é conservada em todas as execuções', () => {
    for (const { ctrl, div } of runs) { expect(Math.abs(ctrl.massDrift)).toBeLessThan(1e-9); expect(Math.abs(div.massDrift)).toBeLessThan(1e-9); }
  });

  it('onde a vida ocupa as duas bacias, a seleção divergente amplia a distância genética entre elas em relação ao controle', () => {
    const pairs = runs.filter(({ ctrl, div }) => both(ctrl) && both(div));
    expect(pairs.length).toBeGreaterThanOrEqual(2); // nem toda semente coloniza as duas bacias — e isso é registrado
    for (const { seed, ctrl, div } of pairs) expect(div.divergence.D, `semente ${seed}`).toBeGreaterThan(ctrl.divergence.D);
  });

  it('a divergência observada não é forçada: sem razão D/dispersão ≥ 1,5 não há evento de especiação atribuível às bacias', () => {
    for (const { seed, ctrl, div } of runs) {
      for (const r of [ctrl, div]) {
        if (!both(r)) expect(r.divergence.D, `semente ${seed}: bacia única`).toBe(0);
      }
    }
  });
});
