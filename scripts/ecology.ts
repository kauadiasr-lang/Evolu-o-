// Análise ecológica de mundos naturais (ecologia ligada): remoção causal entre as espécies mais abundantes.
// Uso: npx tsx scripts/ecology.ts --seeds 1,2,3,4 --ticks 5000 [--stage3] [--size 64x40] [--horizon 250] [--reps 3]
// Escreve docs/experiments/ecology-<...>.json e imprime tabela em Markdown. Resultados "indeterminada" são esperados e válidos.
import { mkdirSync, writeFileSync } from 'node:fs';
import { removalExperiment, topSpeciesGroups, observedFoodWeb } from '../src/core/ecology';
import { FLOW_KINDS, Simulation } from '../src/core/simulation';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const seeds = opt('seeds', '1,2,3,4').split(',').map(Number);
const ticks = Number(opt('ticks', '5000'));
const [w, h] = opt('size', '64x40').split('x').map(Number);
const stage3 = args.includes('--stage3');
const horizon = Number(opt('horizon', '250'));
const reps = Number(opt('reps', '3'));
const out: unknown[] = [];
console.log(`# Ecologia emergente — ${w}×${h}, ${ticks} ticks${stage3 ? ', Etapa 3' : ''}, horizonte ${horizon}, ${reps} réplicas\n`);
console.log('| semente | espécies vivas | par | A→B (detrito/sedimento) | B→A (detrito/sedimento) | consumo A→B / B→A | leitura |');
console.log('|---|---|---|---|---|---|---|');
for (const seed of seeds) {
  const sim = new Simulation({ seed, ecology: true, width: w, height: h, stage3, maxOrganisms: w * h * 9, maxPlants: Math.round(w * h * 2.2) });
  const m0 = sim.totalMass();
  sim.run(ticks);
  const groups = topSpeciesGroups(sim, 3);
  const res = groups.length >= 2 ? removalExperiment(sim, groups, { horizon, replicates: reps }) : [];
  const flows = Object.fromEntries(FLOW_KINDS.map((k, j) => { let s = 0; for (let sp = 0; sp <= sim.species.size; sp++) s += sim.ecoFlow[sp * FLOW_KINDS.length + j] ?? 0; return [k, +s.toFixed(1)]; }));
  out.push({ seed, speciesAlive: sim.species.aliveCount(), groups: groups.map((g) => g.name), flows, foodWeb: observedFoodWeb(sim).slice(0, 8), massDrift: (sim.totalMass() - m0) / m0, pairs: res });
  if (!res.length) console.log(`| ${seed} | ${sim.species.aliveCount()} | — | — | — | — | menos de 2 espécies abundantes: nada a classificar |`);
  for (const r of res) console.log(`| ${seed} | ${sim.species.aliveCount()} | ${r.a} × ${r.b} | ${r.aOnB.sign} (${r.aOnB.diff.toFixed(2)}/${r.aOnB.diffSink.toFixed(2)}) | ${r.bOnA.sign} (${r.bOnA.diff.toFixed(2)}/${r.bOnA.diffSink.toFixed(2)}) | ${r.flowAeatsB.toFixed(0)} / ${r.flowBeatsA.toFixed(0)} | ${r.label} |`);
}
mkdirSync('docs/experiments', { recursive: true });
const file = `docs/experiments/ecology-${w}x${h}${stage3 ? '-s3' : ''}-t${ticks}.json`;
writeFileSync(file, JSON.stringify({ w, h, stage3, ticks, horizon, reps, seeds, results: out }, null, 1));
console.log(`\n_(gravado em ${file})_`);
