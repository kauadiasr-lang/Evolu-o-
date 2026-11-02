import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/simulation';
import { stateHash } from './helpers';

/**
 * Trava da física: impressão digital do estado após 1500 ticks no mundo padrão, registrada na
 * validação da Etapa 1. Qualquer alteração em fórmulas, reprodução, mortalidade, evolução,
 * conservação ou no uso do RNG muda estes valores e falha o teste.
 */
const STAGE1: Record<number, string> = {
  1: '31ad4524:1:3|pop=6483|mass=50400.000000',
  2: '733eb221:1:3|pop=7617|mass=50400.000000',
  3: '31656e2c:1:3|pop=8141|mass=50400.000000',
};

describe('física da Etapa 1 preservada', () => {
  for (const seed of [1, 2, 3]) {
    it(`semente ${seed}: estado idêntico à Etapa 1 após 1500 ticks`, () => {
      const sim = new Simulation({ seed });
      sim.run(1500);
      expect(`${stateHash(sim)}|pop=${sim.pool.count}|mass=${sim.totalMass().toFixed(6)}`).toBe(STAGE1[seed]);
    });
  }
});
