// Auditoria da Etapa 5 — invariantes com a ecologia LIGADA (somente leitura). Uso: npx tsx scripts/audit-invariants.ts
import { exportSave } from '../src/core/serialize';
import { forkSimulation } from '../src/core/experiment';
import { removalExperiment, topSpeciesGroups } from '../src/core/ecology';
import { Simulation } from '../src/core/simulation';
import { stateHash } from '../tests/helpers';

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
function fullHash(sim: Simulation): string {
  const save = exportSave(sim);
  let h = fnv(JSON.stringify(save.meta));
  for (const [k, v] of Object.entries(save.arrays as Record<string, ArrayLike<number>>)) {
    let a = 2166136261;
    for (let i = 0; i < v.length; i++) { a ^= Math.floor((v[i] as number) * 1e6) | 0; a = Math.imul(a, 16777619); }
    h += `|${k}:${(a >>> 0).toString(16)}`;
  }
  return fnv(h);
}
function scan(sim: Simulation): string[] {
  const bad: string[] = [];
  const chk = (name: string, a: ArrayLike<number>, lo = -Infinity) => { for (let i = 0; i < a.length; i++) { const v = a[i]; if (!Number.isFinite(v) || v < lo) { bad.push(`${name}[${i}]=${v}`); return; } } };
  const pl = sim.planet;
  chk('nutrient', pl.nutrient, 0); chk('detritus', pl.detritus, 0); chk('temp', pl.temp); chk('light', pl.light, 0);
  if (!(pl.reservoir >= 0)) bad.push('reservoir<0');
  const p = sim.pool;
  for (let i = 0; i < p.used; i++) if (p.alive[i]) {
    if (!(p.mass[i] > 0) || !Number.isFinite(p.mass[i])) bad.push(`mass[${i}]=${p.mass[i]}`);
    if (!Number.isFinite(p.energy[i]) || p.energy[i] < 0) bad.push(`energy[${i}]=${p.energy[i]}`);
    if (!(p.x[i] >= 0 && p.x[i] < pl.w && p.y[i] >= 0 && p.y[i] < pl.h)) bad.push(`pos[${i}]`);
    if (bad.length > 5) break;
  }
  chk('ecoFlow', sim.ecoFlow, 0);
  if (sim.flora) { const f = sim.flora; for (let i = 0; i < f.pool.used; i++) if (f.pool.alive[i] && !(f.pool.mass[i] > 0)) { bad.push(`plant mass[${i}]`); break; } }
  return bad;
}
const out: string[] = [];
for (const [name, cfg] of [['padrão', { seed: 2 }], ['continentes', { seed: 3, stage3: true, width: 64, height: 40, maxPlants: 4000 }]] as [string, any][]) {
  const sim = new Simulation({ ecology: true, maxOrganisms: 40000, ...cfg });
  const m0 = sim.totalMass();
  let maxPop = 0, bad = 0;
  for (let t = 0; t < 6000; t++) { sim.step(); maxPop = Math.max(maxPop, sim.pool.count); if (t % 1000 === 0) bad += scan(sim).length; }
  const fin = scan(sim);
  out.push(`[${name}] 6000 ticks: pop=${sim.pool.count} máx=${maxPop}/${sim.cfg.maxOrganisms} deriva de massa=${((sim.totalMass() - m0) / m0).toExponential(1)} violações(amostragens)=${bad} violações(final)=${fin.length} ${fin.slice(0, 3).join(' ')}`);
  // isolamento: a análise não pode alterar nada do mundo observado
  const before = fullHash(sim), rngB = sim.rng.state;
  const g = topSpeciesGroups(sim, 3);
  if (g.length >= 2) removalExperiment(sim, g, { horizon: 120, replicates: 3 });
  out.push(`[${name}] isolamento: serialização completa antes=${before} depois=${fullHash(sim)} rng antes=${rngB} depois=${sim.rng.state} ⇒ ${before === fullHash(sim) && rngB === sim.rng.state ? 'IDÊNTICO' : 'ALTERADO'}`);
  // bifurcação ≡ original
  const f = forkSimulation(sim);
  sim.run(300); f.run(300);
  out.push(`[${name}] bifurcação: hash original=${stateHash(sim)} bifurcado=${stateHash(f)} rng ${sim.rng.state}/${f.rng.state} mrng ${(sim as any).mrng.state}/${(f as any).mrng.state} flora.rng ${sim.flora?.rng.state}/${f.flora?.rng.state} ⇒ ${stateHash(sim) === stateHash(f) && sim.rng.state === f.rng.state ? 'IDÊNTICA' : 'DIVERGE'}`);
  // réplicas por deslocamento de RNG: distintas entre si? (flora/mrng NÃO são deslocados)
  const hs: string[] = [];
  for (let r = 0; r < 3; r++) { const x = forkSimulation(sim); for (let q = 0; q < r + 1; q++) x.rng.next(); x.run(150); hs.push(stateHash(x)); }
  out.push(`[${name}] réplicas (deslocamento 1,2,3): hashes ${hs.join(' ')} ⇒ ${new Set(hs).size === 3 ? 'trajetórias distintas' : 'COLAPSARAM'}`);
}
console.log(out.join('\n'));
