import { Simulation } from '../src/core/simulation';
import { G } from '../src/core/genome';

const seed = Number(process.argv[2] ?? 1);
const ticks = Number(process.argv[3] ?? 5000);
const sim = new Simulation({ seed });
const m0 = sim.totalMass();
const t0 = Date.now();
for (let t = 0; t < ticks; t++) {
  sim.step();
  if (sim.tick % 500 === 0) {
    const h = sim.history;
    const sp = sim.species.list.filter((s) => s.extinctTick < 0).sort((a, b) => b.count - a.count).slice(0, 4);
    console.log(
      `t=${sim.tick} pop=${sim.pool.count} sp=${sim.species.aliveCount()}/${sim.species.size} bio=${h.last('biomass').toFixed(0)} nut=${h.last('nutrient').toFixed(0)} det=${h.last('detritus').toFixed(0)} res=${h.last('reservoir').toFixed(0)}` +
        ` photo=${h.last('mPhoto').toFixed(2)} osmo=${h.last('mOsmo').toFixed(2)} pred=${h.last('mPred').toFixed(2)} size=${h.last('mSize').toFixed(2)} mot=${h.last('mMotil').toFixed(2)} def=${h.last('mDef').toFixed(2)} topt=${h.last('mTopt').toFixed(2)} gen=${sim.maxGeneration} drift=${((sim.totalMass() - m0) / m0).toExponential(1)} | ` +
        sp.map((s) => `${s.name}:${s.count}`).join(' ')
    );
  }
  if (sim.pool.count === 0) { console.log('EXTINCT at', sim.tick); break; }
}
console.log('elapsed ms', Date.now() - t0, 'ticks/s', ((sim.tick * 1000) / (Date.now() - t0)).toFixed(0));
for (const e of sim.events.items.slice(-12)) console.log(e.tick, e.type, e.title);
