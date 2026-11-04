// Estudo: formas intermediárias entre vida marinha e terrestre são viáveis?
// Mede o balanço líquido de energia (energia + 2·massa) de um mesmo genótipo, no mar e em terra de uma costa,
// para combinações de membros (LIMBS) e adaptação terrestre (TERR). Só observa.
// Uso: npx tsx scripts/land-viability.ts [semente] [ticks] [umidadeMin] [umidadeMax]   (umidade do solo da costa, 0..1)
import { landViability } from '../src/core/experiment';

const [seed, ticks, wMin, wMax] = [Number(process.argv[2] ?? 3), Number(process.argv[3] ?? 80), Number(process.argv[4] ?? 0.25), Number(process.argv[5] ?? 1)];
const r = landViability(seed, ticks, wMin, wMax);
if (!r.coast) { console.log('sem costa adequada nesta semente'); process.exit(1); }
console.log(`# Viabilidade de intermediários terrestres — semente ${seed}, ${ticks} ticks`);
console.log(`Costa: terra T=${r.coast.landTemp.toFixed(1)}°C, água do solo=${(r.coast.soilWater * 100).toFixed(0)}%; mar adjacente T=${r.coast.seaTemp.toFixed(1)}°C\n`);
console.log('Balanço líquido (energia por tick; † = morreu antes do fim). "bloqueada" = sem membros/adaptação expressa: não entra em terra.\n');
console.log('| TERR \\ LIMBS | 0 | 0,4 | 0,8 |\n|---|---|---|---|');
for (const terr of [0, 0.15, 0.3, 0.6, 0.9]) {
  const cells = r.rows.filter((x) => x.terr === terr).map((x) => `mar ${x.sea.toFixed(2)}${x.seaAlive ? '' : '†'} / terra ${x.land === null ? 'bloqueada' : x.land.toFixed(2) + (x.landAlive ? '' : '†')} [${x.limbsExpressed ? x.limbsExpressed + ' pares' : 'sem membros'}${x.terrExpressed ? ', terr ' + x.terrExpressed.toFixed(2) : ''}]`);
  console.log(`| ${terr} | ${cells.join(' | ')} |`);
}
