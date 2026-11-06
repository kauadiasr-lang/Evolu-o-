// Auditoria da Etapa 5 — executa o protocolo de docs/AUDITORIA_ETAPA_5.md §4 (somente leitura sobre o motor).
// Uso: npx tsx scripts/audit-ecology.ts <cenário> [opções]
//   A | B | C | D | N1 | N2 | N3 | N4 | E | S | G
// Constantes do motor só são alteradas EM MEMÓRIA, em knockouts/sensibilidade rotulados; nada é gravado.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Rng } from '../src/core/rng';
import { P } from '../src/core/params';
import { PG, PLANT_GENES } from '../src/core/flora';
import { T, TR, deriveTraits } from '../src/core/traits';
import { forkSimulation } from '../src/core/experiment';
import { removalExperiment, topSpeciesGroups } from '../src/core/ecology';
import { FLOW_KINDS, Simulation } from '../src/core/simulation';
import { cells, emptyWorld, feed, genome, stage3Sim } from '../tests/helpers';

const args = process.argv.slice(2);
const scen = args[0] ?? 'C';
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const NOMUT = { baseRate: 0, rateRange: 0, smallSigma: 0, bigSigma: 0, bigProb: 0 };
const WORLD_SEEDS = [5, 11, 23, 37, 41];
const CONTEXTS = [3, 7, 25];
const R = Number(opt('reps', '8'));
const HORIZON = 300, WARM = 500;
const Pm = P as unknown as Record<string, number>;

// ---------------------------------------------------------------- estatística
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const vari = (x: number[]) => { const m = mean(x); return x.length > 1 ? x.reduce((s, v) => s + (v - m) * (v - m), 0) / (x.length - 1) : 0; };
export function welch(a: number[], b: number[]) {
  const d = mean(a) - mean(b);
  const va = vari(a) / a.length, vb = vari(b) / b.length;
  const se = Math.sqrt(va + vb);
  const df = se > 0 ? Math.max(1, Math.floor((va + vb) ** 2 / ((va * va) / (a.length - 1) + (vb * vb) / (b.length - 1)))) : 1;
  const t = df <= 30 ? T975[df - 1] : 1.96;
  return { d, lo: d - t * se, hi: d + t * se, se };
}
const sign = (e: { d: number; lo: number; hi: number }, minAbs: number): '+' | '-' | '0' => (e.lo > 0 && Math.abs(e.d) >= minAbs ? '+' : e.hi < 0 && Math.abs(e.d) >= minAbs ? '-' : '0');

// ---------------------------------------------------------------- mundo sintético
interface Def { name: string; g: Float32Array; n: number; mass?: number }
interface Built { sim: Simulation; ids: number[]; names: string[] }
const topt = (over: Record<string, unknown>) => { const p = emptyWorld({ stable: true, ecology: true, seed: 5, ...over } as any); return (p.planet.temp[10] + 5) / 50; };
const base = (t: number) => ({ TOPT: t, TTOL: 0.5, META: 0.1, SIZE: 0.2 });
function genomes(over: Record<string, unknown>) {
  const t = topt(over);
  return {
    P: genome({ ...base(t), PHOTO: 0.9, OSMO: 0, PRED: 0, MOTIL: 0.1 }, 3),
    P2: genome({ ...base(t), PHOTO: 0.7, OSMO: 0, PRED: 0, MOTIL: 0.1, AFFIN: 0.8 }, 4),
    O: genome({ ...base(t), PHOTO: 0, OSMO: 0.9, PRED: 0, SIZE: 0.03, MOTIL: 0.3, SENSE: 0.6, TTOL: 0.1, META: 0, AFFIN: 0.1, LONGEV: 0.1, DEFENSE: 0 }, 5),
    Os: genome({ ...base(t), PHOTO: 0, OSMO: 0.9, PRED: 0, SIZE: 0.03, MOTIL: 0.05, SENSE: 0, TTOL: 0.1, META: 0, AFFIN: 0.1, LONGEV: 0.1, DEFENSE: 0 }, 5),
    // pós-hoc (declarado): O/Os tinham TTOL 0,1 (largura térmica 4,5 °C) num mundo-teste termicamente heterogêneo (24–40 °C) — confusão térmica
    Ow: genome({ ...base(t), PHOTO: 0, OSMO: 0.9, PRED: 0, SIZE: 0.03, MOTIL: 0.05, SENSE: 0, TTOL: 0.5, META: 0, AFFIN: 0.1, LONGEV: 0.1, DEFENSE: 0 }, 5),
    Ow2: genome({ ...base(t), PHOTO: 0, OSMO: 0.8, PRED: 0, SIZE: 0.03, MOTIL: 0.05, SENSE: 0, TTOL: 0.5, META: 0, AFFIN: 0.1, LONGEV: 0.1, DEFENSE: 0, HUE: 0.5 }, 6),
    O2: genome({ ...base(t), PHOTO: 0, OSMO: 0.8, PRED: 0, SIZE: 0.03, MOTIL: 0.3, SENSE: 0.6, TTOL: 0.1, META: 0, AFFIN: 0.1, LONGEV: 0.1, DEFENSE: 0, HUE: 0.5 }, 6),
    M: genome({ ...base(t), SIZE: 0.1, PHOTO: 0.45, OSMO: 0.8, PRED: 0, MOTIL: 0.2, SENSE: 0.3 }, 5),
  };
}
function build(wseed: number, nutrient: number, defs: Def[], opts: { warm?: number; detritus?: number; ecology?: boolean; width?: number; setup?: (s: Simulation) => void } = {}): Built {
  const over: Record<string, unknown> = { nutrientPerCell: nutrient, width: opts.width ?? 16, height: 12 };
  const sim = emptyWorld({ stable: true, ecology: opts.ecology ?? true, seed: wseed, mutation: NOMUT, ...over } as any);
  opts.setup?.(sim);
  // detrito inicial: a matéria vem do NUTRIENTE da própria célula (até 40%), pois o sedimento do mundo-teste é quase vazio
  // (a 1ª versão tirava do sedimento e entregava ≈0 — bug do script, corrigido antes de interpretar B/C/D com osmótrofos)
  if (opts.detritus) for (let c = 0; c < sim.planet.n; c++) { const a = Math.min(opts.detritus, 0.4 * sim.planet.nutrient[c]); sim.planet.detritus[c] += a; sim.planet.nutrient[c] -= a; }
  const r = new Rng(99 + wseed);
  const ids: number[] = [];
  for (const d of defs) {
    const id = sim.species.create(null, d.g, 0, 0, sim.rng, d.name).id;
    ids.push(id);
    let n = 0, guard = 0;
    while (n < d.n && guard++ < d.n * 30) if (sim.addOrganism(d.g, 0, r.next() * sim.planet.w, r.next() * sim.planet.h, d.mass ?? 2, 8, id) >= 0) n++;
  }
  sim.run(opts.warm ?? WARM);
  return { sim, ids, names: defs.map((d) => d.name) };
}
/** espécies descendentes (por parentId) das raízes, inclusive as raízes */
function desc(sim: Simulation, roots: number[]): Set<number> {
  const set = new Set(roots);
  let grew = true;
  while (grew) { grew = false; for (const s of sim.species.list) if (!set.has(s.id) && s.parentId && set.has(s.parentId)) { set.add(s.id); grew = true; } }
  return set;
}
interface Resp { bio: number; surv: number; recruit: number; n: number }
interface Cohort { set: Set<number>; ids: Set<number>; n0: number; m0: number }
function cohort(sim: Simulation, root: number): Cohort {
  const set = desc(sim, [root]);
  const ids = new Set<number>();
  let m0 = 0;
  for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i] && set.has(sim.pool.species[i])) { ids.add(sim.pool.id[i]); m0 += sim.pool.mass[i]; }
  return { set, ids, n0: ids.size, m0 };
}
function respOf(sim: Simulation, root: number, c: Cohort): Resp {
  const set = desc(sim, [root]);
  let m = 0, surv = 0, rec = 0, n = 0;
  for (let i = 0; i < sim.pool.used; i++) {
    if (!sim.pool.alive[i] || !set.has(sim.pool.species[i])) continue;
    m += sim.pool.mass[i]; n++;
    if (c.ids.has(sim.pool.id[i])) surv++; else rec++;
  }
  return { bio: Math.log((m + 1e-6) / (c.m0 + 1e-6)), surv: c.n0 ? surv / c.n0 : 0, recruit: c.n0 ? rec / c.n0 : 0, n };
}
interface RunOut { resp: Resp[]; flow: number[][]; det: number; nut: number; org: number; sed: number }
function runCond(b: Built, cohorts: Cohort[], remove: number[], sink: boolean, rep: number): RunOut {
  const f = forkSimulation(b.sim);
  for (let q = 0; q < rep + 1; q++) f.rng.next();
  if (remove.length) {
    const rm = new Set<number>();
    for (const k of remove) for (const s of cohorts[k].set) rm.add(s);
    f.removeWhere((i) => rm.has(f.pool.species[i]), sink);
  }
  f.run(HORIZON);
  const flow = b.ids.map((id, k) => {
    const set = desc(f, [id]);
    const o = FLOW_KINDS.map(() => 0);
    for (const s of set) FLOW_KINDS.forEach((_, j) => { o[j] += f.ecoFlow[s * FLOW_KINDS.length + j] ?? 0; });
    void k;
    return o;
  });
  const wm = f.planet.totalMass();
  let org = 0;
  for (let i = 0; i < f.pool.used; i++) if (f.pool.alive[i]) org += f.pool.mass[i];
  return { resp: b.ids.map((id, k) => respOf(f, id, cohorts[k])), flow, det: wm.detritus, nut: wm.nutrient, org, sed: wm.reservoir };
}

// ---------------------------------------------------------------- fatorial par (X,Y)
interface PairCell { wseed: number; nutrient: number; effects: Record<string, { XonY: Eff; YonX: Eff }>; mech: { exudX: number; detIntakeY: number; exudY: number; detIntakeX: number }; N: [number, number] }
interface Eff { d: number; lo: number; hi: number; sign: string }
function factorial(wseed: number, nutrient: number, defs: [Def, Def], extra?: Parameters<typeof build>[3]): PairCell {
  const b = build(wseed, nutrient, defs, extra);
  const co = b.ids.map((id) => cohort(b.sim, id));
  const R_ = Array.from({ length: R }, (_, r) => r);
  const both = R_.map((r) => runCond(b, co, [], false, r));
  const out: Record<string, { XonY: Eff; YonX: Eff }> = {};
  for (const dest of ['detrito', 'sedimento']) {
    const sink = dest === 'sedimento';
    const noX = R_.map((r) => runCond(b, co, [0], sink, r));
    const noY = R_.map((r) => runCond(b, co, [1], sink, r));
    for (const metric of ['bio', 'surv', 'recruit'] as const) {
      const XonY = welch(both.map((o) => o.resp[1][metric]), noX.map((o) => o.resp[1][metric]));
      const YonX = welch(both.map((o) => o.resp[0][metric]), noY.map((o) => o.resp[0][metric]));
      const minAbs = metric === 'bio' ? 0.05 : 0.02;
      out[`${metric}|${dest}`] = { XonY: { ...XonY, sign: sign(XonY, minAbs) }, YonX: { ...YonX, sign: sign(YonX, minAbs) } };
    }
  }
  const m = (f: (o: RunOut) => number) => mean(both.map(f));
  return {
    wseed, nutrient, effects: out, N: [co[0].n0, co[1].n0],
    mech: { exudX: m((o) => o.flow[0][4]), detIntakeY: m((o) => o.flow[1][1]), exudY: m((o) => o.flow[1][4]), detIntakeX: m((o) => o.flow[0][1]) },
  };
}
function summarizePair(label: string, cellsOut: PairCell[]) {
  console.log(`\n### ${label}`);
  console.log('| contexto | métrica | direção | sementes + (detrito/sedimento) | sementes − (detrito/sedimento) | consistentes (+/−) | efeito médio±dp (detrito) | IC95% típico |');
  console.log('|---|---|---|---|---|---|---|---|');
  const rows: unknown[] = [];
  for (const nut of CONTEXTS) {
    const cs = cellsOut.filter((c) => c.nutrient === nut);
    for (const metric of ['bio', 'surv', 'recruit']) for (const dir of ['XonY', 'YonX'] as const) {
      const det = cs.map((c) => c.effects[`${metric}|detrito`][dir]), sed = cs.map((c) => c.effects[`${metric}|sedimento`][dir]);
      const pos = (a: Eff[]) => a.filter((e) => e.sign === '+').length, neg = (a: Eff[]) => a.filter((e) => e.sign === '-').length;
      const consP = cs.filter((_, i) => det[i].sign === '+' && sed[i].sign === '+').length, consN = cs.filter((_, i) => det[i].sign === '-' && sed[i].sign === '-').length;
      const ds = det.map((e) => e.d);
      const ci = det.map((e) => (e.hi - e.lo) / 2);
      console.log(`| ${nut} | ${metric} | ${dir === 'XonY' ? 'X→Y' : 'Y→X'} | ${pos(det)}/${pos(sed)} de ${cs.length} | ${neg(det)}/${neg(sed)} de ${cs.length} | ${consP}/${consN} | ${mean(ds).toFixed(3)}±${Math.sqrt(vari(ds)).toFixed(3)} | ±${mean(ci).toFixed(3)} |`);
      rows.push({ nut, metric, dir, posDet: pos(det), posSed: pos(sed), negDet: neg(det), negSed: neg(sed), consP, consN, mean: mean(ds), sd: Math.sqrt(vari(ds)), ci: mean(ci) });
    }
    const mech = cs.map((c) => c.mech);
    console.log(`| ${nut} | mecanismo (ambos presentes, média das sementes) | | exsudato X=${mean(mech.map((m) => m.exudX)).toFixed(1)} · detrito ingerido por Y=${mean(mech.map((m) => m.detIntakeY)).toFixed(1)} · exsudato Y=${mean(mech.map((m) => m.exudY)).toFixed(1)} · detrito ingerido por X=${mean(mech.map((m) => m.detIntakeX)).toFixed(1)} | | | | |`);
  }
  return rows;
}
const save = (name: string, data: unknown) => { mkdirSync('docs/experiments', { recursive: true }); writeFileSync(`docs/experiments/audit5-${name}.json`, JSON.stringify(data, null, 1)); console.log(`\n_(gravado em docs/experiments/audit5-${name}.json)_`); };
const G0 = (nut: number) => genomes({ nutrientPerCell: nutrient0(nut), width: 16, height: 12 });
const nutrient0 = (n: number) => n;

async function pairScenario(name: string, mk: (g: ReturnType<typeof G0>) => [Def, Def], extraFor?: () => Parameters<typeof build>[3]) {
  const all: PairCell[] = [];
  for (const nut of CONTEXTS) for (const w of WORLD_SEEDS) { const g = G0(nut); all.push(factorial(w, nut, mk(g), extraFor?.())); }
  const rows = summarizePair(name, all);
  save(name.replace(/[^a-zA-Z0-9]+/g, '-'), { name, R, worlds: WORLD_SEEDS, contexts: CONTEXTS, horizon: HORIZON, warm: WARM, cells: all, rows });
}

// ---------------------------------------------------------------- cenários
async function main() {
  const t0 = Date.now();
  if (scen === 'A') {
    console.log('### A — exsudador isolado (P sozinho), ecologia ligada × desligada na mesma semente');
    console.log('| contexto | semente | biomassa P (lig./deslig.) | exsudato total | exsudato por biomassa·tick | detrito final (lig./deslig.) | nutriente final (lig./deslig.) | deriva de massa |');
    console.log('|---|---|---|---|---|---|---|---|');
    const rows: unknown[] = [];
    for (const nut of CONTEXTS) for (const w of WORLD_SEEDS) {
      const res: Record<string, { bio: number; det: number; nut: number; exud: number; drift: number }> = {};
      for (const eco of [true, false]) {
        const g = G0(nut);
        const b = build(w, nut, [{ name: 'P', g: g.P, n: 40 }], { ecology: eco, warm: 0 });
        const m0 = b.sim.totalMass();
        b.sim.run(800);
        let bio = 0;
        for (let i = 0; i < b.sim.pool.used; i++) if (b.sim.pool.alive[i]) bio += b.sim.pool.mass[i];
        const wm = b.sim.planet.totalMass();
        const exud = b.sim.ecoFlow[b.ids[0] * 5 + 4] ?? 0;
        res[eco ? 'on' : 'off'] = { bio, det: wm.detritus, nut: wm.nutrient, exud, drift: (b.sim.totalMass() - m0) / m0 };
      }
      console.log(`| ${nut} | ${w} | ${res.on.bio.toFixed(0)} / ${res.off.bio.toFixed(0)} | ${res.on.exud.toFixed(0)} | ${(res.on.exud / (res.on.bio * 800)).toExponential(2)} | ${res.on.det.toFixed(0)} / ${res.off.det.toFixed(0)} | ${res.on.nut.toFixed(0)} / ${res.off.nut.toFixed(0)} | ${res.on.drift.toExponential(1)} |`);
      rows.push({ nut, w, ...res });
    }
    save('A', rows);
  } else if (scen === 'B') {
    console.log('### B — consumidor isolado (sobrevivência da coorte em 300 ticks; nascimentos/recrutas)');
    console.log('| tipo | contexto | detrito inicial/célula | sobrevivência (média sementes) | recrutas/organismo inicial | biomassa final/inicial |');
    console.log('|---|---|---|---|---|---|');
    const rows: unknown[] = [];
    for (const kind of ['O', 'Ow', 'M'] as const) for (const nut of CONTEXTS) for (const det of [0, 20]) {
      const sv: number[] = [], rc: number[] = [], bm: number[] = [], dReal: number[] = [];
      for (const w of WORLD_SEEDS) {
        const g = G0(nut);
        const b = build(w, nut, [{ name: kind, g: g[kind], n: 20, mass: kind === 'M' ? 2 : 1 }], { warm: 0, detritus: det });
        const co = cohort(b.sim, b.ids[0]);
        const dMean = b.sim.planet.detritus.reduce((x, y) => x + y, 0) / b.sim.planet.n;
        dReal.push(dMean);
        const o = runCond(b, [co], [], false, 0);
        sv.push(o.resp[0].surv); rc.push(o.resp[0].recruit); bm.push(Math.exp(o.resp[0].bio));
      }
      console.log(`| ${kind} | ${nut} | ${det} (real ${mean(dReal).toFixed(1)}) | ${mean(sv).toFixed(2)} | ${mean(rc).toFixed(2)} | ${mean(bm).toFixed(2)} |`);
      rows.push({ kind, nut, det, surv: mean(sv), recruit: mean(rc), bio: mean(bm) });
    }
    save('B', rows);
  } else if (scen === 'C') {
    const which = opt('consumer', 'O') as 'O' | 'Os' | 'Ow' | 'M';
    const ko = args.includes('--knockout');
    if (ko) Pm.EXUDE_K = 0;
    await pairScenario(`C — exsudador P × consumidor ${which}${ko ? ' [KNOCKOUT EXUDE_K=0]' : ''}`, (g) => [{ name: 'P', g: g.P, n: 40 }, { name: which, g: g[which], n: 20, mass: which === 'M' ? 2 : 1 }]);
  } else if (scen === 'D') {
    const kind = opt('kind', 'phot');
    if (args.includes('--knockout')) Pm.EXUDE_K = 0;
    if (kind === 'phot') await pairScenario(`D — P × P2 (luz/nutriente)${args.includes('--knockout') ? ' [KNOCKOUT EXUDE_K=0]' : ''}`, (g) => [{ name: 'P', g: g.P, n: 40 }, { name: 'P2', g: g.P2, n: 40 }]);
    else {
      const all: PairCell[] = [];
      for (const nut of CONTEXTS) for (const w of WORLD_SEEDS) { const g = G0(nut); all.push(factorial(w, nut, [{ name: 'Ow', g: g.Ow, n: 20, mass: 1 }, { name: 'Ow2', g: g.Ow2, n: 20, mass: 1 }], { detritus: 20 })); }
      const rows = summarizePair('D — O × O2 (detrito abundante compartilhado)', all);
      save('D-osmo', { R, cells: all, rows });
    }
  } else if (scen === 'N1') {
    console.log('### N1 — falso positivo do estimador (controle × controle, 8 vs 8 réplicas disjuntas)');
    let tests = 0, fp = 0;
    const rows: unknown[] = [];
    for (const nut of CONTEXTS) for (const w of WORLD_SEEDS) {
      const g = G0(nut);
      const b = build(w, nut, [{ name: 'P', g: g.P, n: 40 }, { name: 'M', g: g.M, n: 20 }]);
      const co = b.ids.map((id) => cohort(b.sim, id));
      const A = Array.from({ length: R }, (_, r) => runCond(b, co, [], false, r));
      const B = Array.from({ length: R }, (_, r) => runCond(b, co, [], false, r + R));
      for (let k = 0; k < 2; k++) for (const metric of ['bio', 'surv', 'recruit'] as const) {
        const e = welch(A.map((o) => o.resp[k][metric]), B.map((o) => o.resp[k][metric]));
        const s = sign(e, metric === 'bio' ? 0.05 : 0.02);
        tests++; if (s !== '0') fp++;
        rows.push({ nut, w, group: k, metric, d: e.d, lo: e.lo, hi: e.hi, sign: s });
      }
    }
    console.log(`testes=${tests} detecções espúrias=${fp} (${((100 * fp) / tests).toFixed(1)}%)`);
    save('N1', { tests, fp, rows });
  } else if (scen === 'N1b') {
    console.log('### N1b (acrescentado após ver N1) — falso positivo da REGRA DE PRODUÇÃO (|d|>0,1 e >2·EP, 4 vs 4 réplicas de controle)');
    let tests = 0, fp = 0;
    for (const nut of CONTEXTS) for (const w of WORLD_SEEDS) {
      const g = G0(nut);
      const b = build(w, nut, [{ name: 'P', g: g.P, n: 40 }, { name: 'M', g: g.M, n: 20 }]);
      const co = b.ids.map((id) => cohort(b.sim, id));
      const A = Array.from({ length: 4 }, (_, r) => runCond(b, co, [], false, r));
      const B = Array.from({ length: 4 }, (_, r) => runCond(b, co, [], false, r + 4));
      for (let k = 0; k < 2; k++) {
        const a = A.map((o) => o.resp[k].bio), c = B.map((o) => o.resp[k].bio);
        const d = mean(a) - mean(c), se = Math.sqrt(vari(a) / 4 + vari(c) / 4);
        tests++; if (Math.abs(d) > 0.1 && Math.abs(d) > 2 * se) fp++;
      }
    }
    console.log(`testes=${tests} detecções espúrias=${fp} (${((100 * fp) / tests).toFixed(1)}%)`);
    save('N1b', { tests, fp });
  } else if (scen === 'H') {
    // PÓS-HOC (declarado): C mostrou que a remoção após o aquecimento só vê o estado atual, que já carrega o efeito da facilitação.
    // H compara COLONIZAÇÃO desde t=0: M com P × M sozinho × M com P e exsudação desligada; e P com/sem M.
    console.log('### H (pós-hoc, exploratório) — colonização desde t=0, 800 ticks, R=8: quem se estabelece melhor?');
    console.log('| contexto | condição | biomassa de M no fim (média±dp entre sementes) | M extinto (sementes) | biomassa de P no fim | efeito de P sobre M (IC95% médio) |');
    console.log('|---|---|---|---|---|---|');
    const rows: unknown[] = [];
    const T_END = 800;
    for (const nut of CONTEXTS) {
      const res: Record<string, { M: number[]; P: number[]; ext: number }> = {};
      for (const [cond, withP, withM, ko] of [['P+M', true, true, false], ['M sozinho', false, true, false], ['P+M [exsudação desligada]', true, true, true], ['P sozinho', true, false, false]] as [string, boolean, boolean, boolean][]) {
        const orig = P.EXUDE_K;
        if (ko) Pm.EXUDE_K = 0;
        const Ms: number[] = [], Ps: number[] = [];
        let ext = 0;
        for (const w of WORLD_SEEDS) {
          const g = G0(nut);
          const defs: Def[] = [];
          if (withP) defs.push({ name: 'P', g: g.P, n: 40 });
          if (withM) defs.push({ name: 'M', g: g.M, n: 20, mass: 2 });
          const b = build(w, nut, defs, { warm: 0 });
          const iP = withP ? 0 : -1, iM = withM ? (withP ? 1 : 0) : -1;
          const mM: number[] = [], mP: number[] = [];
          for (let r = 0; r < R; r++) {
            const f = forkSimulation(b.sim);
            for (let q = 0; q < r + 1; q++) f.rng.next();
            f.run(T_END);
            const bio = (id: number) => { const set = desc(f, [id]); let m = 0; for (let i = 0; i < f.pool.used; i++) if (f.pool.alive[i] && set.has(f.pool.species[i])) m += f.pool.mass[i]; return m; };
            if (iM >= 0) mM.push(bio(b.ids[iM]));
            if (iP >= 0) mP.push(bio(b.ids[iP]));
          }
          if (iM >= 0) { Ms.push(mean(mM)); if (mean(mM) < 1) ext++; }
          if (iP >= 0) Ps.push(mean(mP));
        }
        Pm.EXUDE_K = orig;
        res[cond] = { M: Ms, P: Ps, ext };
      }
      const fmt = (a: number[]) => a.length ? `${mean(a).toFixed(0)} ± ${Math.sqrt(vari(a)).toFixed(0)}` : '—';
      const eff = welch(res['P+M'].M, res['M sozinho'].M);
      for (const [cond, v] of Object.entries(res)) console.log(`| ${nut} | ${cond} | ${fmt(v.M)} | ${v.M.length ? v.ext + '/' + v.M.length : '—'} | ${fmt(v.P)} | ${cond === 'P+M' ? `${eff.d.toFixed(0)} [${eff.lo.toFixed(0)}, ${eff.hi.toFixed(0)}]` : ''} |`);
      rows.push({ nut, res, eff });
    }
    save('H', rows);
  } else if (scen === 'N5') {
    console.log('### N5 — distribuição do enchimento energético (energia/capacidade) e do vazamento por estratégia, mundos naturais (64×40, 6000 ticks, ecologia ligada)');
    console.log('| semente | classe | organismos | enchimento médio | frac. > 0,6 | frac. > 0,9 | exsudato/(biomassa·tick) estimado |');
    console.log('|---|---|---|---|---|---|---|');
    const rows: unknown[] = [];
    for (const w of [1, 2, 3, 4]) {
      const sim = new Simulation({ seed: w, ecology: true, width: 64, height: 40, maxOrganisms: 64 * 40 * 9 });
      sim.run(6000);
      const cls: Record<string, { n: number; fill: number; a: number; b: number; leakM: number; m: number }> = {};
      for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i]) {
        const sp = sim.species.get(sim.pool.species[i]);
        const c = (cls[sp.trophic] ??= { n: 0, fill: 0, a: 0, b: 0, leakM: 0, m: 0 });
        const f = sim.pool.energy[i] / (P.ECAP_PER_MASS * sim.pool.mass[i]);
        c.n++; c.fill += f; if (f > P.EXUDE_FROM) c.a++; if (f > 0.9) c.b++;
        c.leakM += sim.pool.mass[i] * Math.max(0, f - P.EXUDE_FROM) / (1 - P.EXUDE_FROM) * P.EXUDE_K; c.m += sim.pool.mass[i];
      }
      for (const [k, c] of Object.entries(cls)) { console.log(`| ${w} | ${k} | ${c.n} | ${(c.fill / c.n).toFixed(2)} | ${(c.a / c.n).toFixed(2)} | ${(c.b / c.n).toFixed(2)} | ${(c.leakM / c.m).toExponential(2)} |`); rows.push({ w, k, ...c }); }
    }
    save('N5', rows);
  } else if (scen === 'N2') {
    console.log('### N2 — viés de matéria: grupos separados por barreira letal (sem interação possível)');
    const all: PairCell[] = [];
    for (const nut of CONTEXTS) for (const w of WORLD_SEEDS) {
      const g = G0(nut);
      const gg = genomes({ nutrientPerCell: nut, width: 24, height: 12 });
      void g;
      // A à esquerda, B à direita: reposiciona após construir (build semeia no mundo todo, então usa setup + semeadura própria)
      const sim = emptyWorld({ stable: true, ecology: true, seed: w, mutation: NOMUT, nutrientPerCell: nut, width: 24, height: 12 } as any);
      sim.setRegionTemp(10, 0, 13, 11, 28);
      const r = new Rng(99 + w);
      const ids: number[] = [];
      for (const [nm, gen, x0, x1] of [['A', gg.P, 1, 8], ['B', { ...gg.P } as Float32Array, 16, 23]] as const) {
        const id = sim.species.create(null, gen as Float32Array, 0, 0, sim.rng, nm).id;
        ids.push(id);
        let n = 0, guard = 0;
        while (n < 30 && guard++ < 900) if (sim.addOrganism(gen as Float32Array, 0, x0 + r.next() * (x1 - x0), r.next() * 12, 2, 8, id) >= 0) n++;
      }
      sim.run(300);
      const b: Built = { sim, ids, names: ['A', 'B'] };
      const co = ids.map((id) => cohort(sim, id));
      const both = Array.from({ length: R }, (_, k) => runCond(b, co, [], false, k));
      const out: Record<string, { XonY: Eff; YonX: Eff }> = {};
      for (const dest of ['detrito', 'sedimento']) {
        const sink = dest === 'sedimento';
        const noX = Array.from({ length: R }, (_, k) => runCond(b, co, [0], sink, k));
        const noY = Array.from({ length: R }, (_, k) => runCond(b, co, [1], sink, k));
        for (const metric of ['bio', 'surv', 'recruit'] as const) {
          const a = welch(both.map((o) => o.resp[1][metric]), noX.map((o) => o.resp[1][metric]));
          const c = welch(both.map((o) => o.resp[0][metric]), noY.map((o) => o.resp[0][metric]));
          const mn = metric === 'bio' ? 0.05 : 0.02;
          out[`${metric}|${dest}`] = { XonY: { ...a, sign: sign(a, mn) }, YonX: { ...c, sign: sign(c, mn) } };
        }
      }
      all.push({ wseed: w, nutrient: nut, effects: out, N: [co[0].n0, co[1].n0], mech: { exudX: 0, detIntakeY: 0, exudY: 0, detIntakeX: 0 } });
    }
    const rows = summarizePair('N2 — barreira letal', all);
    save('N2', { R, cells: all, rows });
  } else if (scen === 'N3') {
    console.log('### N3 — ciclo fútil da osmotrofia (herdado da Etapa 1): osmótrofo em MASS_MAX, com gêmeo SEM organismo para descontar a decomposição');
    const g = G0(7).O;
    const tr = new Float32Array(TR);
    deriveTraits(g, 0, tr, 0, false);
    const massMax = tr[T.MASS_MAX];
    const mk = (withOrg: boolean) => {
      const sim = emptyWorld({ stable: true, ecology: true, seed: 5, mutation: NOMUT } as any);
      for (let c = 0; c < sim.planet.n; c++) { sim.planet.reservoir += sim.planet.detritus[c]; sim.planet.detritus[c] = 0; }
      const cc = (sim.planet.h >> 1) * sim.planet.w + (sim.planet.w >> 1);
      const x = (cc % sim.planet.w) + 0.5, y = ((cc / sim.planet.w) | 0) + 0.5;
      const sp = sim.species.create(null, g, 0, 0, sim.rng, 'O').id;
      sim.planet.detritus[cc] = 50; sim.planet.reservoir -= 50;
      let i = -1;
      if (withOrg) { feed(sim, x, y, massMax * 1.5); i = sim.addOrganism(g, 0, x, y, massMax, 1, sp); }
      return { sim, cc, x, y, sp, i };
    };
    const w = mk(true), c = mk(false);
    // o gêmeo sem organismo recebe a mesma massa de nutriente que o organismo retirou ao nascer, para equiparar o orçamento
    c.sim.planet.nutrient[c.cc] = w.sim.planet.nutrient[w.cc] + massMax;
    c.sim.planet.reservoir = w.sim.planet.reservoir + 0; // mesma contabilidade abaixo via massa total
    let energyGain = 0, eaten = 0;
    const N = 20;
    const m0w = w.sim.totalMass(), m0c = c.sim.totalMass();
    for (let t = 0; t < N; t++) {
      w.sim.pool.x[w.i] = w.x; w.sim.pool.y[w.i] = w.y;
      const f0 = w.sim.ecoFlow[w.sp * 5 + 1] ?? 0;
      w.sim.step(); c.sim.step();
      const a = (w.sim.ecoFlow[w.sp * 5 + 1] ?? 0) - f0;
      eaten += a; energyGain += a * P.E_PER_MASS * P.DET_EFF;
    }
    const attributable = c.sim.planet.detritus[c.cc] - w.sim.planet.detritus[w.cc]; // detrito a menos por causa do organismo
    const dMass = w.sim.pool.mass[w.i] - massMax;
    console.log(`MASS_MAX=${massMax.toFixed(2)}; ${N} ticks: detrito ingerido (bruto)=${eaten.toFixed(3)}; energia obtida=${energyGain.toFixed(3)}; detrito a menos atribuível ao organismo (gêmeo − real)=${attributable.toFixed(3)}; variação da massa do organismo=${dMass.toFixed(3)}`);
    console.log(`energia obtida por massa de detrito efetivamente removida = ${(energyGain / Math.max(attributable, 1e-9)).toFixed(2)} (energia embutida por massa de corpo = ${P.E_PER_MASS}); massa total (real/gêmeo) deriva ${((w.sim.totalMass() - m0w) / m0w).toExponential(1)} / ${((c.sim.totalMass() - m0c) / m0c).toExponential(1)}`);
    save('N3', { massMax, eaten, energyGain, attributable, dMass, ratio: energyGain / attributable, embodied: P.E_PER_MASS });
  } else if (scen === 'N4') {
    console.log('### N4 — viés de estratégia em mundos naturais (64×40, 10 000 ticks, ecologia ligada × desligada)');
    console.log('| semente | ecologia | PHOTO (média por biomassa) | OSMO | PRED | espécies vivas | pop | exsudato por classe trófica (fração) |');
    console.log('|---|---|---|---|---|---|---|---|');
    const rows: unknown[] = [];
    const seeds = (opt('seeds', '1,2,3,4')).split(',').map(Number);
    for (const w of seeds) for (const eco of [false, true]) {
      const sim = new Simulation({ seed: w, ecology: eco, width: 64, height: 40, maxOrganisms: 64 * 40 * 9 });
      sim.run(10000);
      let M = 0, ph = 0, os = 0, pr = 0;
      for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i]) { const m = sim.pool.mass[i]; M += m; ph += m * sim.pool.tr[i * TR + T.PHOTO]; os += m * sim.pool.tr[i * TR + T.OSMO]; pr += m * sim.pool.tr[i * TR + T.PRED]; }
      const byClass: Record<string, number> = {};
      let tot = 0;
      for (const s of sim.species.list) { const e = sim.ecoFlow[s.id * 5 + 4] ?? 0; byClass[s.trophic] = (byClass[s.trophic] ?? 0) + e; tot += e; }
      const cls = Object.entries(byClass).map(([k, v]) => `${k}=${tot ? (v / tot).toFixed(2) : '0'}`).join(' ');
      console.log(`| ${w} | ${eco ? 'ligada' : 'desligada'} | ${(ph / M).toFixed(3)} | ${(os / M).toFixed(3)} | ${(pr / M).toFixed(3)} | ${sim.species.aliveCount()} | ${sim.pool.count} | ${eco ? cls : '—'} |`);
      rows.push({ w, eco, photo: ph / M, osmo: os / M, pred: pr / M, alive: sim.species.aliveCount(), pop: sim.pool.count, byClass });
    }
    save('N4', rows);
  } else if (scen === 'E') {
    const mk = (s: number, small: boolean, def: number) => {
      const sim = stage3Sim({ initialPopulation: 0, seed: 40 + s, ecology: true, mutation: NOMUT });
      const { land, w } = cells(sim);
      const pl = sim.planet;
      pl.nutrient[land] += Math.min(120, pl.reservoir); pl.reservoir -= Math.min(120, pl.reservoir);
      pl.soilWater[land] = 0.8;
      const fl = sim.flora!;
      const pg = new Float32Array(PLANT_GENES);
      Object.assign(pg, { [PG.HEIGHT]: 0.3, [PG.LEAF]: 0.7, [PG.DENSITY]: 0.8, [PG.ROOT]: 0.3, [PG.PIGMENT]: 0.7, [PG.SHADE]: 0.5, [PG.DROUGHT]: 0.3, [PG.TOPT]: (pl.temp[land] + 5) / 50, [PG.TTOL]: 0.7, [PG.REPRO]: 1, [PG.MUT]: 0 });
      const lin = fl.newLineage(null, pg, 0, 0);
      for (let k = 0; k < 8; k++) fl.plant(pl.nutrient, land, pg, 0, 6, 0, lin);
      const tp = (pl.temp[land] + 5) / 50;
      const gp = genome({ PHOTO: 0, OSMO: 0, PRED: 0.9, SIZE: 0.5, MOTIL: 0.25, LIMBS: 0.6, LIMBLEN: 0.5, TERR: 0.7, META: 0.05, TOPT: tp, TTOL: 0.8 }, 5);
      const gy = genome({ PHOTO: 0.3, OSMO: 0, PRED: 0, SIZE: small ? 0.05 : 0.3, MOTIL: 0.15, LIMBS: 0.6, LIMBLEN: 0.5, TERR: 0.7, META: 0.1, TOPT: tp, TTOL: 0.8, DEFENSE: def }, 6);
      const sp = sim.species.create(null, gp, 0, 0, sim.rng, 'H').id, sy = sim.species.create(null, gy, 0, 0, sim.rng, 'Y').id;
      const x = (land % w) + 0.5, y = ((land / w) | 0) + 0.5;
      for (let t = 0; t < 3; t++) sim.step(); // constrói a cobertura ANTES de existir qualquer animal (correção de contabilidade de exposição)
      const h = sim.addOrganism(gp, 0, x, y, 8, 40, sp), a = sim.addOrganism(gy, 0, x, y, small ? 1 : 3, 8, sy);
      return { sim, h, a, x, y, land };
    };
    console.log('### E1 — captura por tentativa com o termo de abrigo ligado × desligado (mesmo estado, 200 ensaios por condição)');
    console.log('| presa | defesa | cobertura média | capturas (abrigo ligado) | capturas (abrigo desligado) | redução relativa | tick-exposição (ligado/desligado) |');
    console.log('|---|---|---|---|---|---|---|');
    const rows: unknown[] = [];
    for (const small of [true, false]) for (const def of [0, 0.8]) {
      let capOn = 0, capOff = 0, expOn = 0, expOff = 0, cov = 0;
      const NT = 200;
      for (let s = 0; s < NT; s++) {
        for (const refuge of [true, false]) {
          const e = mk(s, small, def);
          (e.sim as any).ecology = refuge;
          cov += e.sim.flora!.cover[e.land];
          let ticks = 0;
          for (let t = 0; t < 12 && e.sim.pool.alive[e.a]; t++) { e.sim.pool.x[e.h] = e.sim.pool.x[e.a] = e.x; e.sim.pool.y[e.h] = e.sim.pool.y[e.a] = e.y; e.sim.step(); ticks++; }
          const eaten = !e.sim.pool.alive[e.a];
          if (refuge) { capOn += eaten ? 1 : 0; expOn += ticks; } else { capOff += eaten ? 1 : 0; expOff += ticks; }
        }
      }
      console.log(`| ${small ? 'pequena (raio≈0,72)' : 'grande'} | ${def} | ${(cov / (2 * NT)).toFixed(2)} | ${capOn}/${NT} (taxa/tick ${(capOn / expOn).toFixed(3)}) | ${capOff}/${NT} (${(capOff / expOff).toFixed(3)}) | ${(1 - capOn / expOn / (capOff / expOff)).toFixed(2)} | ${expOn}/${expOff} |`);
      rows.push({ small, def, capOn, capOff, expOn, expOff });
    }
    console.log('\n### E2 — retalho terrestre: predadores + presas pequenas, 20 réplicas, abrigo ligado × desligado (40 ticks; 150 do protocolo matou todos os organismos nos dois braços: desvio declarado)');
    console.log('| abrigo | presas vivas (média±dp) | predadores vivos | mortes por predação | recrutas de predador | recrutas de presa |');
    console.log('|---|---|---|---|---|---|');
    const arms: Record<string, number[][]> = { true: [], false: [] };
    for (let s = 0; s < 20; s++) {
      const base = mk(s, true, 0);
      const { sim, x, y } = base;
      const gp = Array.from(sim.species.list);
      void gp;
      // adiciona mais indivíduos para ter população
      const [spH, spY] = [1, 2];
      const gH = new Float32Array(sim.pool.genes.subarray(base.h * 36, base.h * 36 + 36)), gY = new Float32Array(sim.pool.genes.subarray(base.a * 36, base.a * 36 + 36));
      for (let k = 0; k < 3; k++) { feed(sim, x, y, 8); sim.addOrganism(gH, 0, x, y, 8, 40, spH); }
      for (let k = 0; k < 14; k++) { feed(sim, x, y, 2); sim.addOrganism(gY, 0, x, y, 1, 8, spY); }
      for (const refuge of [true, false]) {
        const f = forkSimulation(sim);
        (f as any).ecology = refuge;
        const idsH = new Set<number>(), idsY = new Set<number>();
        for (let i = 0; i < f.pool.used; i++) if (f.pool.alive[i]) (f.pool.species[i] === spH ? idsH : idsY).add(f.pool.id[i]);
        f.run(40);
        let h = 0, y2 = 0, rh = 0, ry = 0;
        for (let i = 0; i < f.pool.used; i++) if (f.pool.alive[i]) {
          if (f.pool.species[i] === spH) { if (idsH.has(f.pool.id[i])) h++; else rh++; } else if (f.pool.species[i] === spY) { if (idsY.has(f.pool.id[i])) y2++; else ry++; }
        }
        arms[String(refuge)].push([y2, h, f.deathsTotal.predation, rh, ry]);
      }
    }
    for (const refuge of ['true', 'false']) {
      const a = arms[refuge];
      const col = (k: number) => a.map((r) => r[k]);
      console.log(`| ${refuge === 'true' ? 'ligado' : 'desligado'} | ${mean(col(0)).toFixed(1)}±${Math.sqrt(vari(col(0))).toFixed(1)} | ${mean(col(1)).toFixed(2)} | ${mean(col(2)).toFixed(1)} | ${mean(col(3)).toFixed(2)} | ${mean(col(4)).toFixed(2)} |`);
    }
    const diff = welch(arms.true.map((r) => r[0]), arms.false.map((r) => r[0]));
    console.log(`\nefeito do abrigo sobre presas vivas (ligado − desligado): ${diff.d.toFixed(2)} (IC95% ${diff.lo.toFixed(2)}…${diff.hi.toFixed(2)}), n=20 por braço`);
    save('E', { rows, arms, diff });
  } else if (scen === 'S') {
    console.log('### S — sensibilidade (NÃO é calibração): P × M, contexto 7, 3 sementes');
    const sets: [string, Record<string, number>][] = [['padrão', {}], ['EXUDE_K ×0,5', { EXUDE_K: P.EXUDE_K * 0.5 }], ['EXUDE_K ×2', { EXUDE_K: P.EXUDE_K * 2 }], ['EXUDE_FROM 0,5', { EXUDE_FROM: 0.5 }], ['EXUDE_FROM 0,8', { EXUDE_FROM: 0.8 }]];
    const orig = { EXUDE_K: P.EXUDE_K, EXUDE_FROM: P.EXUDE_FROM };
    const rows: unknown[] = [];
    console.log('| configuração | semente | P→M biomassa (detrito/sedimento) | M→P biomassa (detrito/sedimento) |');
    console.log('|---|---|---|---|');
    for (const [nm, ov] of sets) {
      Object.assign(Pm, orig, ov);
      for (const w of [5, 11, 23]) {
        const g = G0(7);
        const c = factorial(w, 7, [{ name: 'P', g: g.P, n: 40 }, { name: 'M', g: g.M, n: 20 }]);
        const e1 = c.effects['bio|detrito'], e2 = c.effects['bio|sedimento'];
        console.log(`| ${nm} | ${w} | ${e1.XonY.sign} ${e1.XonY.d.toFixed(2)} [${e1.XonY.lo.toFixed(2)},${e1.XonY.hi.toFixed(2)}] / ${e2.XonY.sign} ${e2.XonY.d.toFixed(2)} | ${e1.YonX.sign} ${e1.YonX.d.toFixed(2)} [${e1.YonX.lo.toFixed(2)},${e1.YonX.hi.toFixed(2)}] / ${e2.YonX.sign} ${e2.YonX.d.toFixed(2)} |`);
        rows.push({ nm, w, e1, e2 });
      }
    }
    Object.assign(Pm, orig);
    save('S', rows);
  } else if (scen === 'G') {
    const stage3 = args.includes('--stage3');
    const seeds = opt('seeds', '1,2,3,4,5,6').split(',').map(Number);
    console.log(`### G — mundos naturais (${stage3 ? 'continentes' : 'padrão'}), 64×40, ${opt('ticks', '15000')} ticks, produção removalExperiment R=6`);
    console.log('| semente | espécies vivas | par | A→B (detrito/sedimento) | B→A | consumo A→B/B→A | leitura | novas espécies no horizonte (controle) | viés de associação (biomassa do grupo em espécies novas) |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    const rows: unknown[] = [];
    for (const w of seeds) {
      const sim = new Simulation({ seed: w, ecology: true, width: 64, height: 40, stage3, maxOrganisms: 64 * 40 * 9, maxPlants: Math.round(64 * 40 * 2.2) });
      sim.run(Number(opt('ticks', '15000')));
      const groups = topSpeciesGroups(sim, 3);
      if (groups.length < 2) { console.log(`| ${w} | ${sim.species.aliveCount()} | — | — | — | — | menos de 2 espécies abundantes | — | — |`); rows.push({ w, alive: sim.species.aliveCount(), pairs: [] }); continue; }
      const res = removalExperiment(sim, groups, { horizon: 250, replicates: 6 });
      // viés: espécies novas durante o horizonte (controle)
      const f = forkSimulation(sim);
      const s0 = f.species.size;
      f.run(250);
      const newSp = f.species.size - s0;
      const lost = groups.map((g) => { // fração da biomassa do grupo (própria + descendentes NOVOS) que passou a espécies criadas no horizonte
        const set = new Set(g.species);
        let own = 0, neu = 0;
        for (let i = 0; i < f.pool.used; i++) if (f.pool.alive[i]) {
          const sp = f.pool.species[i];
          if (set.has(sp)) own += f.pool.mass[i];
          else if (sp > s0) { let a = f.species.get(sp); while (a && a.parentId && a.id > s0) a = f.species.get(a.parentId); if (a && set.has(a.id)) neu += f.pool.mass[i]; }
        }
        return neu / Math.max(own + neu, 1e-9);
      });
      for (const r of res) console.log(`| ${w} | ${sim.species.aliveCount()} | ${r.a} × ${r.b} | ${r.aOnB.sign} (${r.aOnB.diff.toFixed(2)}/${r.aOnB.diffSink.toFixed(2)}) | ${r.bOnA.sign} (${r.bOnA.diff.toFixed(2)}/${r.bOnA.diffSink.toFixed(2)}) | ${r.flowAeatsB.toFixed(0)}/${r.flowBeatsA.toFixed(0)} | ${r.label} | ${newSp} | ${lost.map((v) => v.toFixed(2)).join('/')} |`);
      rows.push({ w, alive: sim.species.aliveCount(), pairs: res, newSp, lost });
    }
    save(`G${stage3 ? '-s3' : ''}`, rows);
  }
  console.error(`(${scen} concluído em ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
main();
