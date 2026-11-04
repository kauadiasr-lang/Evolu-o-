// Experimentos reproduzíveis: mundo estável (A) × mundo alterado (B), a partir do MESMO estado.
// Uso:
//   npx tsx scripts/experiment.ts temperature --seeds 1,2,3 --value 6 [--abrupt] [--stage3] [--size 96x60] [--at 8000] [--total 20000]
//   npx tsx scripts/experiment.ts aridity     --seeds 1,2,3 --value 0.35 --stage3
//   npx tsx scripts/experiment.ts light       --seeds 1,2,3 --value 0.5
//   npx tsx scripts/experiment.ts nutrients   --seeds 1,2,3 --value 0.6
//   npx tsx scripts/experiment.ts isolation   --seeds 1,2,3 --value 5 [--total 12000]
// Escreve docs/experiments/<nome>.json e imprime uma tabela em Markdown.
import { mkdirSync, writeFileSync } from 'node:fs';
import { compareRuns, runFork, runIsolation } from '../src/core/experiment';
import type { EnvChangeKind } from '../src/core/envchange';

const args = process.argv.slice(2);
const name = args[0] ?? 'temperature';
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k: string) => args.includes(`--${k}`);
const seeds = (opt('seeds', '1,2,3') as string).split(',').map(Number);
const value = Number(opt('value', name === 'aridity' ? '0.35' : name === 'light' ? '0.5' : name === 'nutrients' ? '0.6' : '6'));
const [w, h] = (opt('size', '96x60') as string).split('x').map(Number);
const stage3 = flag('stage3') || name === 'aridity';
const changeAt = Number(opt('at', '8000'));
const total = Number(opt('total', '20000'));
const abrupt = flag('abrupt');
const cfg = { width: w, height: h, stage3, maxOrganisms: w * h * 9, maxPlants: Math.round(w * h * 2.2) };
const kind: Record<string, EnvChangeKind> = { temperature: 'climate', aridity: 'aridity', light: 'light', nutrients: 'nutrient_depletion' };
const fmt = (x: number | null, d = 2) => (x === null ? '—' : x.toFixed(d));
const out: any[] = [];
const aridRows: string[] = [];
const t0 = Date.now();

if (name === 'isolation') {
  console.log(`# Isolamento — ΔT=±${value} °C, ${total} ticks, mundo ${w}×${h}\n`);
  console.log('| semente | seleção | espécies vivas | eventos de especiação | D entre bacias | dispersão interna | razão D/disp. | nOeste/nLeste | genes que mais divergem |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const seed of seeds) {
    for (const differential of [false, true]) {
      const r = runIsolation({ seed, cfg, ticks: total, dT: value, differential });
      out.push({ seed, ...r });
      const d = r.divergence;
      console.log(`| ${seed} | ${differential ? `divergente ±${value}°C` : 'controle (igual)'} | ${r.speciesAlive} | ${r.speciationEvents} | ${d.D.toFixed(3)} | ${Math.max(d.withinA, d.withinB).toFixed(3)} | ${d.ratio.toFixed(2)} | ${r.nWest}/${r.nEast} | ${d.topGenes.slice(0, 3).map((g) => `${g.label} ${g.delta >= 0 ? '+' : ''}${g.delta.toFixed(2)}`).join(', ')} |`);
    }
  }
} else {
  console.log(`# Experimento "${name}" — A estável × B ${kind[name]} ${value}${abrupt ? ' (abrupta)' : ' (gradual)'}; mudança no tick ${changeAt}; total ${total}; mundo ${w}×${h}${stage3 ? ' (Etapa 3)' : ''}\n`);
  console.log('| semente | pop antes | pop mín. A | pop mín. B | pop final A | pop final B | desemp. térmico mín. A | mín. B | ΔT_ótima A | ΔT_ótima B (esperado) | resposta (ticks) | recuperação (ticks) | extinções A/B | espécies vivas A/B | var. nicho A/B | massa (máx. desvio) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const seed of seeds) {
    const res = runFork({ seed, cfg, changeAt, totalTicks: total, sampleEvery: 250, track: true, change: { kind: kind[name], value: name === 'temperature' ? value : value, abrupt } });
    const c = compareRuns(res, changeAt, name === 'temperature' ? value : 0);
    out.push({ seed, comparison: c, stable: res.stable, altered: res.altered, warmup: res.warmup });
    if (name === 'aridity') aridRows.push(`| ${seed} | ${(c.coverA * 100).toFixed(0)}% / ${(c.coverB * 100).toFixed(0)}% | ${(c.landWaterA * 100).toFixed(0)}% / ${(c.landWaterB * 100).toFixed(0)}% | ${(c.desertA * 100).toFixed(1)}% / ${(c.desertB * 100).toFixed(1)}% | ${c.plantsA} / ${c.plantsB} | ${fmt(c.droughtShiftA, 3)} / ${fmt(c.droughtShiftB, 3)} |`);
    console.log(`| ${seed} | ${c.popBefore.toFixed(0)} | ${fmt(c.minPopRatioA)} | ${fmt(c.minPopRatioB)} | ${fmt(c.finalPopRatioA)} | ${fmt(c.finalPopRatioB)} | ${fmt(c.minTfA)} | ${fmt(c.minTfB)} | ${fmt(c.toptShiftA, 3)} | ${c.totalExtinctionB ? `EXTINTA (tick ${c.extinctionTickB})` : fmt(c.toptShiftB, 3)} (${fmt(c.expectedToptShift, 3)}) | ${c.responseTicks ?? 'sem resposta'} | ${c.recoveryTicks ?? 'não voltou'} | ${c.extinctA}/${c.extinctB} | ${c.speciesAliveA}/${c.speciesAliveB} | ${c.nicheVarA.toFixed(3)}/${c.nicheVarB.toFixed(3)} | ${c.massDriftMax.toExponential(1)} |`);
  }
}
if (aridRows.length) {
  console.log('\n### Vegetação e biomas (A estável / B alterado, ao final)\n');
  console.log('| semente | cobertura vegetal | umidade do solo | deserto (superfície) | plantas | Δ gene de tolerância à seca |\n|---|---|---|---|---|---|');
  aridRows.forEach((r) => console.log(r));
}
mkdirSync('docs/experiments', { recursive: true });
const file = `docs/experiments/${name}${stage3 ? '-s3' : ''}-${w}x${h}-${abrupt ? 'abrupta' : 'gradual'}-v${value}-t${total}.json`;
writeFileSync(file, JSON.stringify({ name, value, abrupt, changeAt, total, cfg, seeds, results: out }, null, 1));
console.log(`\n_(gravado em ${file}; ${((Date.now() - t0) / 1000).toFixed(0)} s)_`);
