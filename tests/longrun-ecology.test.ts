import { describe, expect, it } from 'vitest';
import { removalExperiment, topSpeciesGroups } from '../src/core/ecology';
import { FLOW_KINDS, Simulation, SimConfig } from '../src/core/simulation';

/**
 * Etapa 5 — longa duração com a ecologia ligada (EVOLVERE_LONG=1). Exige apenas estabilidade (população limitada,
 * vida persistente, massa conservada); NÃO exige diversidade, especiação nem relações. Registra tudo que foi observado.
 */
const long = process.env.EVOLVERE_LONG ? describe : describe.skip;

function run(label: string, cfg: Partial<SimConfig>, seed: number) {
  const sim = new Simulation({ seed, ecology: true, ...cfg });
  const m0 = sim.totalMass();
  let minPop = Infinity, maxPop = 0;
  for (let t = 0; t < 30000; t++) {
    sim.step();
    if (t > 500) minPop = Math.min(minPop, sim.pool.count);
    maxPop = Math.max(maxPop, sim.pool.count);
    if (t % 2000 === 0) expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-8);
  }
  const flows = FLOW_KINDS.map((k, j) => {
    let s = 0;
    for (let sp = 0; sp <= sim.species.size; sp++) s += sim.ecoFlow[sp * FLOW_KINDS.length + j] ?? 0;
    return `${k}=${s.toFixed(0)}`;
  }).join(' ');
  const groups = topSpeciesGroups(sim, 3);
  const rel = groups.length >= 2
    ? removalExperiment(sim, groups, { horizon: 250, replicates: 3 }).map((r) => `${r.a}×${r.b}: ${r.label}`).join(' | ')
    : 'menos de 2 grupos abundantes';
  console.log(`[longrun-eco ${label}] seed=${seed} pop=${sim.pool.count} max=${maxPop} min=${minPop} species=${sim.species.aliveCount()}/${sim.species.size} mass=${sim.totalMass().toFixed(3)} fluxos(${flows}) predação=${sim.deathsTotal.predation} relações: ${rel}`);
  expect(maxPop).toBeLessThan(sim.cfg.maxOrganisms);
  expect(minPop).toBeGreaterThan(0);
  expect(sim.pool.count).toBeGreaterThan(0);
  expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-8);
}

long('longa duração — Etapa 5 (ecologia ligada, mundo padrão)', () => {
  for (const seed of [1, 2, 3]) it(`seed ${seed}: 30000 ticks estáveis`, () => run('etapa1', {}, seed));
});

long('longa duração — Etapa 5 (ecologia ligada, continentes e flora)', () => {
  for (const seed of [1, 2, 3]) it(`seed ${seed}: 30000 ticks estáveis`, () => {
    run('etapa3', { width: 96, height: 60, stage3: true, maxOrganisms: 96 * 60 * 9, maxPlants: Math.round(96 * 60 * 2.2) }, seed);
  });
});
