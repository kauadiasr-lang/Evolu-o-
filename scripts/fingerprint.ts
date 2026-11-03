import { Simulation } from '../src/core/simulation';
import { stateHash } from '../tests/helpers';
const ticks = Number(process.argv[2] ?? 1500);
const stage3 = process.argv[3] === 'stage3';
const out: Record<string, string> = {};
for (const seed of [1, 2, 3]) {
  const sim = new Simulation({ seed, stage3 });
  let maxPop = 0, minPop = Infinity;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    maxPop = Math.max(maxPop, sim.pool.count);
    if (t > 500) minPop = Math.min(minPop, sim.pool.count);
  }
  out[seed] = `${stateHash(sim)}|pop=${sim.pool.count}|species=${sim.species.aliveCount()}/${sim.species.size}|max=${maxPop}|min=${minPop}|mass=${sim.totalMass().toFixed(6)}`;
}
console.log(JSON.stringify(out, null, 1));
