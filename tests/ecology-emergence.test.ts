import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { Group, PairResult, descendantSet, groupBiomass, interpret, removalExperiment, topSpeciesGroups } from '../src/core/ecology';
import { Simulation } from '../src/core/simulation';
import { emptyWorld, feed, genome, stateHash } from './helpers';

/**
 * Etapa 5 — TESTES DE EMERGÊNCIA E DE CLASSIFICAÇÃO.
 * Os cenários sintéticos são INSTRUMENTOS: criam organismos com traços, deixam a física agir e perguntam ao analisador
 * o que foi MEDIDO (remoção causal com réplicas). Nenhum teste exige que uma relação específica apareça; os números de
 * todos os cenários são impressos, inclusive os resultados negativos (ex.: mutualismo não observado).
 */
const NOMUT = { baseRate: 0, rateRange: 0, smallSigma: 0, bigSigma: 0, bigProb: 0 };
const fmt = (r: PairResult) => `${r.a} × ${r.b}: A→B ${r.aOnB.sign}(${r.aOnB.diff.toFixed(2)}|${r.aOnB.diffSink.toFixed(2)}) B→A ${r.bOnA.sign}(${r.bOnA.diff.toFixed(2)}|${r.bOnA.diffSink.toFixed(2)}) consumo ${r.flowAeatsB.toFixed(0)}/${r.flowBeatsA.toFixed(0)} ⇒ ${r.label}`;

interface Def { name: string; g: Float32Array; n: number; mass?: number; xmin?: number; xmax?: number }
function build(defs: Def[], over: Record<string, unknown> = {}, warm = 500, setup?: (s: Simulation) => void) {
  const sim = emptyWorld({ stable: true, ecology: true, seed: 5, mutation: NOMUT, width: 16, height: 12, ...over } as any);
  setup?.(sim);
  const r = new Rng(99);
  const ids: number[] = [];
  for (const d of defs) {
    const id = sim.species.create(null, d.g, 0, 0, sim.rng, d.name).id;
    ids.push(id);
    let n = 0, guard = 0;
    const x0 = d.xmin ?? 0, x1 = d.xmax ?? sim.planet.w;
    while (n < d.n && guard++ < d.n * 30) {
      const x = x0 + r.next() * (x1 - x0), y = r.next() * sim.planet.h;
      if (sim.addOrganism(d.g, 0, x, y, d.mass ?? 2, 8, id) >= 0) n++;
    }
  }
  sim.run(warm);
  return { sim, ids };
}
const toptOf = (over: Record<string, unknown> = {}) => {
  const p = emptyWorld({ stable: true, ecology: true, seed: 5, ...over } as any);
  return (p.planet.temp[10] + 5) / 50;
};
const base = (t: number) => ({ TOPT: t, TTOL: 0.5, META: 0.1, SIZE: 0.2 });
const grp = (name: string, id: number): Group => ({ name, species: [id] });

describe('emergência: a classificação reflete o que foi medido', () => {
  it('tabela de interpretação: sinais e consumo → rótulo; dados insuficientes → indeterminada (nunca um rótulo inventado)', () => {
    expect(interpret('?', '-', 0, 0).label).toBe('indeterminada');
    expect(interpret('~', '-', 0, 0).evidence).toMatch(/destino da matéria/); // viés de matéria: não rotula
    expect(interpret('0', '0', 0, 0).label).toBe('sem efeito detectável');
    expect(interpret('+', '+', 0, 0).label).toMatch(/mutualismo/);
    expect(interpret('-', '-', 0, 0).label).toMatch(/competição/);
    expect(interpret('+', '0', 0, 0).label).toMatch(/comensalismo/);
    expect(interpret('0', '-', 0, 0).label).toMatch(/amensalismo/);
    expect(interpret('-', '0', 100, 0).label).toMatch(/consumo sem benefício/); // prejuízo + consumo registrado: não é chamado de amensalismo
    // (+,−) só vira predação se houve consumo direto registrado; sem consumo fica como exploração indireta
    expect(interpret('+', '-', 0, 10).label).toMatch(/predação/);
    expect(interpret('+', '-', 0, 0).label).toMatch(/sem consumo direto/);
  });

  it('correção da auditoria: uma espécie NOVA surgida de um grupo continua contando como parte do grupo; filhas que já existiam não (troca de rótulo ≠ efeito ecológico)', () => {
    const t = toptOf({ width: 16, height: 12 });
    const P1 = genome({ ...base(t), PHOTO: 0.9, OSMO: 0, PRED: 0, MOTIL: 0.1 }, 3);
    const { sim, ids } = build([{ name: 'P1', g: P1, n: 30 }], {}, 50);
    const total = groupBiomass(sim, [ids[0]]);
    const s0 = sim.species.size; // instante de referência
    const child = sim.species.create(sim.species.get(ids[0]), P1, 0, sim.tick, sim.rng, 'filha nova');
    let moved = 0;
    for (let i = 0; i < sim.pool.used && moved < 10; i++) if (sim.pool.alive[i]) { sim.pool.species[i] = child.id; moved++; }
    expect(descendantSet(sim, [ids[0]], s0).has(child.id)).toBe(true);
    expect(groupBiomass(sim, [ids[0]], s0)).toBeCloseTo(total, 9); // nada "some" do grupo
    expect(groupBiomass(sim, [child.id], s0)).toBeLessThan(total); // a filha sozinha não inclui a mãe
    // uma filha que já existia no instante de referência (id ≤ s0) NÃO é absorvida pelo grupo
    expect(descendantSet(sim, [ids[0]], child.id).has(child.id)).toBe(false);
    expect(groupBiomass(sim, [ids[0]], child.id)).toBeLessThan(total);
  });

  it('competição emerge entre duas espécies fotossintéticas que dividem nutriente e luz (nenhuma regra de competição existe)', () => {
    const t = toptOf({ width: 16, height: 12 });
    const P1 = genome({ ...base(t), PHOTO: 0.9, OSMO: 0, PRED: 0, MOTIL: 0.1 }, 3);
    const P2 = genome({ ...base(t), PHOTO: 0.7, OSMO: 0, PRED: 0, MOTIL: 0.1, AFFIN: 0.8 }, 4);
    const { sim, ids } = build([{ name: 'P1', g: P1, n: 40 }, { name: 'P2', g: P2, n: 40 }]);
    const res = removalExperiment(sim, [grp('P1', ids[0]), grp('P2', ids[1])], { horizon: 300, replicates: 4 });
    console.log('[competição] ' + res.map(fmt).join(' | '));
    expect(res[0].aOnB.sign).toBe('-');
    expect(res[0].bOnA.sign).toBe('-');
    expect(res[0].label).toMatch(/competição/);
  });

  it('o mesmo par pode mudar de natureza conforme o contexto (disponibilidade de nutrientes): o rótulo NÃO é uma propriedade das espécies', () => {
    const labels: string[] = [];
    for (const npc of [3, 25]) {
      const over = { nutrientPerCell: npc };
      const t = toptOf({ width: 16, height: 12, ...over });
      const P1 = genome({ ...base(t), PHOTO: 0.9, OSMO: 0, PRED: 0, MOTIL: 0.1 }, 3);
      const M = genome({ ...base(t), SIZE: 0.1, PHOTO: 0.45, OSMO: 0.8, PRED: 0, MOTIL: 0.2, SENSE: 0.3 }, 5);
      const { sim, ids } = build([{ name: 'exsudador', g: P1, n: 40 }, { name: 'misotrófico', g: M, n: 20 }], over);
      const res = removalExperiment(sim, [grp('exsudador', ids[0]), grp('misotrófico', ids[1])], { horizon: 300, replicates: 4, minN: 5 });
      console.log(`[contexto nutrientes=${npc}] ` + res.map(fmt).join(' | '));
      labels.push(res[0].label);
    }
    expect(new Set(labels).size).toBeGreaterThan(1);
    // nenhum dos contextos testados produziu mutualismo: resultado negativo registrado, não escondido
    expect(labels.some((l) => /mutualismo/.test(l))).toBe(false);
  });

  it('coexistir não é interagir: grupos separados por uma barreira letal não recebem rótulo de relação', () => {
    const t = toptOf({ width: 24, height: 12 });
    const A = genome({ ...base(t), PHOTO: 0.9, OSMO: 0, PRED: 0, MOTIL: 0.05 }, 3);
    const B = genome({ ...base(t), PHOTO: 0.9, OSMO: 0, PRED: 0, MOTIL: 0.05, HUE: 0.5 }, 4);
    const { sim, ids } = build(
      [{ name: 'A', g: A, n: 30, xmin: 1, xmax: 8 }, { name: 'B', g: B, n: 30, xmin: 16, xmax: 23 }],
      { width: 24 }, 300,
      (s) => s.setRegionTemp(10, 0, 13, 11, 28),
    );
    const res = removalExperiment(sim, [grp('A', ids[0]), grp('B', ids[1])], { horizon: 300, replicates: 4, minN: 5 });
    console.log('[separados] ' + res.map(fmt).join(' | '));
    expect(res[0].label).toMatch(/indeterminada|sem efeito detectável/); // nenhuma relação é afirmada sem evidência robusta
  });

  it('dados insuficientes: um grupo minúsculo fica indeterminado em vez de ganhar um rótulo', () => {
    const t = toptOf({ width: 16, height: 12 });
    const P1 = genome({ ...base(t), PHOTO: 0.9, OSMO: 0, PRED: 0, MOTIL: 0.1 }, 3);
    const P2 = genome({ ...base(t), PHOTO: 0.7, OSMO: 0, PRED: 0, MOTIL: 0.1 }, 4);
    const { sim, ids } = build([{ name: 'P1', g: P1, n: 40 }, { name: 'P2', g: P2, n: 3 }], {}, 50);
    const res = removalExperiment(sim, [grp('P1', ids[0]), grp('P2', ids[1])], { horizon: 100, replicates: 3, minN: 15 });
    expect(res[0].label).toBe('indeterminada');
  });

  it('consumo direto é registrado quando ocorre (evidência mecanística separada do efeito líquido)', () => {
    const t = toptOf({ width: 16, height: 12 });
    const P1 = genome({ ...base(t), PHOTO: 0.9, OSMO: 0, PRED: 0, MOTIL: 0.1 }, 3);
    const H = genome({ ...base(t), SIZE: 0.5, PHOTO: 0.3, OSMO: 0, PRED: 0.9, MOTIL: 0.4, SENSE: 0.5, META: 0.05 }, 6);
    const { sim, ids } = build([{ name: 'presa', g: P1, n: 60 }], {}, 600);
    const hid = sim.species.create(null, H, 0, 0, sim.rng, 'caçador').id;
    const rr = new Rng(5);
    let nn = 0;
    for (let k = 0; k < 400 && nn < 30; k++) { const x = rr.next() * 16, y = rr.next() * 12; feed(sim, x, y, 6); if (sim.addOrganism(H, 0, x, y, 6, 30, hid) >= 0) nn++; }
    const res = removalExperiment(sim, [grp('presa', ids[0]), grp('caçador', hid)], { horizon: 300, replicates: 3, minN: 5 });
    console.log('[predação] ' + res.map(fmt).join(' | '));
    expect(res[0].flowBeatsA).toBeGreaterThan(0); // o caçador consumiu massa da presa (registrado)
    expect(res[0].flowAeatsB).toBe(0); // e a presa não consumiu o caçador
  });
});

describe('emergência em mundos naturais (ecology ligada): análise sem alterar o estado', () => {
  const SEEDS = [1, 2, 3, 4];
  const ALLOWED = /indeterminada|sem efeito detectável|mutualismo|competição|comensalismo|amensalismo|predação|exploração/;
  const results: Record<number, PairResult[]> = {};
  const hashes: Record<number, [string, string]> = {};
  for (const seed of SEEDS) {
    const sim = new Simulation({ seed, ecology: true, width: 40, height: 24, maxOrganisms: 12000 });
    sim.run(2500);
    const before = stateHash(sim);
    const groups = topSpeciesGroups(sim, 3);
    results[seed] = groups.length >= 2 ? removalExperiment(sim, groups, { horizon: 250, replicates: 3 }) : [];
    hashes[seed] = [before, stateHash(sim)];
    console.log(`[natural semente ${seed}] espécies vivas=${sim.species.aliveCount()} analisadas=${groups.length}; ` + (results[seed].map(fmt).join(' | ') || 'menos de 2 grupos com abundância suficiente: nada a classificar'));
  }

  it('a análise não altera o mundo observado e produz apenas rótulos permitidos (inclusive "indeterminada")', () => {
    for (const seed of SEEDS) {
      expect(hashes[seed][1], `semente ${seed}`).toBe(hashes[seed][0]);
      for (const r of results[seed]) expect(r.label).toMatch(ALLOWED);
    }
  });

  it('é reproduzível: repetir a análise na mesma semente dá exatamente os mesmos números', () => {
    const sim = new Simulation({ seed: 1, ecology: true, width: 40, height: 24, maxOrganisms: 12000 });
    sim.run(2500);
    const g = topSpeciesGroups(sim, 3);
    if (g.length < 2) return;
    const again = removalExperiment(sim, g, { horizon: 250, replicates: 3 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(results[1]));
  });
});
