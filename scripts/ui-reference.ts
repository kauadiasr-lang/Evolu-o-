// Referência para scripts/ui-truth.mjs: roda o MESMO motor em Node (sem interface) com a configuração que a interface usa
// e imprime o estado observável nos ticks pedidos. Uso: npx tsx scripts/ui-reference.ts '<cfg json>' 0,500,1200
import { Simulation } from '../src/core/simulation';

const cfg = JSON.parse(process.argv[2]);
const ticks = process.argv[3].split(',').map(Number).sort((a, b) => a - b);
const sim = new Simulation(cfg);
const out: Record<number, unknown> = {};
for (const t of ticks) {
  while (sim.tick < t) sim.step();
  const orgs: [number, number, number, number, number, number, number, number, string][] = [];
  const p = sim.pool;
  for (let i = 0; i < p.used; i++) if (p.alive[i]) orgs.push([p.x[i], p.y[i], p.species[i], p.id[i], p.mass[i], p.energy[i], p.age[i], p.gen[i], sim.species.get(p.species[i]).name]);
  out[t] = {
    tick: sim.tick,
    pop: p.count,
    speciesAlive: sim.species.aliveCount(),
    speciesTotal: sim.species.size,
    massOrganisms: sim.massBreakdown().organisms,
    totalMass: sim.totalMass(),
    counts: sim.species.list.map((s) => [s.id, s.count]),
    orgs,
  };
}
console.log(JSON.stringify(out));
