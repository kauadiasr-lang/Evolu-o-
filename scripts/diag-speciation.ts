// Diagnóstico de especiação: imprime, a cada 2000 ticks, as métricas do critério (separação D, dispersão interna, razão).
// Uso: npx tsx scripts/diag-speciation.ts <semente> [off]   (off = física das Etapas 1-2)
// Roda o critério numa cópia do registro e desfaz o resultado: não altera a simulação.
import { Simulation } from '../src/core/simulation';
import { updateSpecies } from '../src/core/species';
import { Rng } from '../src/core/rng';
const stage3 = process.argv[3] !== 'off';
const sim = new Simulation({ seed: Number(process.argv[2] ?? 1), stage3 });
for (let t = 1; t <= 16000; t++) {
  sim.step();
  if (t % 2000 === 0) {
    // roda o critério numa CÓPIA do registro (não altera o jogo): usa Rng separado e descarta o resultado
    const rows: string[] = [];
    const reg = sim.species, pool = sim.pool;
    const saved = reg.list.map((s) => ({ c: s.centroid.slice(), n: s.count }));
    const sp = new Int32Array(pool.species.slice(0, pool.used));
    updateSpecies(reg, pool, t, new Rng(1), undefined, undefined, (d) => rows.push(`sp${d.id} n=${d.n} small=${d.nSmall} D=${d.D.toFixed(3)} wA=${d.wA.toFixed(3)} wB=${d.wB.toFixed(3)} ratio=${(d.D / Math.max(d.wA, d.wB)).toFixed(2)}`));
    // desfaz qualquer divisão aplicada pela chamada de diagnóstico
    pool.species.set(sp.subarray(0, pool.used));
    reg.list.length = saved.length;
    reg.list.forEach((s, i) => { s.centroid.set(saved[i].c); s.count = saved[i].n; });
    console.log(`t=${t} pop=${pool.count} species=${reg.aliveCount()}/${reg.size} | ${rows.join(' | ') || '(sem candidato: homogênea ou cluster pequeno)'}`);
  }
}
