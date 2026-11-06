import { forkSimulation } from './experiment';
import { FLOW_KINDS, FLOW_N, Simulation } from './simulation';

/**
 * ANÁLISE ECOLÓGICA (somente leitura sobre o estado; os experimentos usam bifurcações descartáveis).
 *
 * Nada aqui determina o comportamento de organismos: os rótulos (competição, mutualismo, predação…) são uma
 * INTERPRETAÇÃO de resultados medidos. O método é o de remoção causal: bifurca-se o mesmo estado, remove-se um grupo A
 * (nos DOIS destinos extremos da matéria: detrito local e sedimento) e compara-se a biomassa do grupo B com o controle (sem remoção),
 * em réplicas. O efeito de A sobre B tem o sinal oposto ao efeito da remoção de A. Se os dados não bastam, a relação é
 * "indeterminada"; se não há efeito além do ruído, "sem efeito detectável".
 */

export interface Group {
  name: string;
  /** espécies que compõem o grupo (no instante do experimento) */
  species: number[];
}

export type Sign = '+' | '-' | '0' | '?' | '~';

export interface EffectEstimate {
  /** diferença média do log da razão de biomassa (removido − controle), matéria dos removidos devolvida como detrito */
  diff: number;
  se: number;
  /** o mesmo, com a matéria dos removidos retirada ao sedimento (limite oposto do viés de matéria) */
  diffSink: number;
  seSink: number;
  /** sinal do efeito de A sobre B (oposto ao da remoção) */
  sign: Sign;
  nB: number;
}

export interface PairResult {
  a: string;
  b: string;
  aOnB: EffectEstimate;
  bOnA: EffectEstimate;
  /** consumo direto medido no controle (massa de presa de um grupo comida pelo outro) */
  flowAeatsB: number;
  flowBeatsA: number;
  label: string;
  evidence: string;
}

export interface RemovalOptions {
  horizon?: number;
  replicates?: number;
  /** abundância mínima (organismos) de um grupo para ser analisado */
  minN?: number;
  /** efeito mínimo (em log da razão de biomassa) para não ser considerado ruído */
  minEffect?: number;
  /** múltiplo do erro-padrão exigido */
  zCrit?: number;
}

const DEF = { horizon: 300, replicates: 4, minN: 15, minEffect: 0.1, zCrit: 2 };

/** Os n maiores grupos de espécies vivas (cada espécie é um grupo). */
export function topSpeciesGroups(sim: Simulation, n: number, minCount = 15): Group[] {
  const out: Group[] = [];
  for (const sp of sim.species.list) if (sp.extinctTick < 0 && sp.count >= minCount) out.push({ name: `${sp.name}#${sp.id}`, species: [sp.id] });
  out.sort((x, y) => count(sim, y) - count(sim, x));
  return out.slice(0, n);
}

function count(sim: Simulation, g: Group): number {
  const set = new Set(g.species);
  let n = 0;
  for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i] && set.has(sim.pool.species[i])) n++;
  return n;
}

/**
 * Espécies do grupo + as que DESCENDEM delas e surgiram DEPOIS do instante de referência (`afterId` = nº de espécies no instante 0).
 * A especiação reatribui organismos a espécies novas durante o horizonte; contar só os ids do instante 0 faz o grupo "perder"
 * biomassa por troca de rótulo, não por ecologia (erro comprovado na auditoria da Etapa 5: até 42% da biomassa de um grupo mudou
 * de id em 250 ticks). Filhas que já existiam no instante 0 NÃO entram: continuam sendo outros grupos (e não são removidas
 * quando o grupo é removido), de modo que medição e remoção usam a mesma definição.
 */
export function descendantSet(sim: Simulation, roots: Iterable<number>, afterId = 0): Set<number> {
  const set = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of sim.species.list) if (!set.has(s.id) && s.id > afterId && s.parentId && set.has(s.parentId)) { set.add(s.id); grew = true; }
  }
  return set;
}

export function groupBiomass(sim: Simulation, roots: Iterable<number>, afterId = 0): number {
  const set = descendantSet(sim, roots, afterId);
  let m = 0;
  for (let i = 0; i < sim.pool.used; i++) if (sim.pool.alive[i] && set.has(sim.pool.species[i])) m += sim.pool.mass[i];
  return m;
}

/** Fluxos de matéria por espécie × tipo, acumulados desde o início (diferença entre duas leituras = janela). */
export function flowSnapshot(sim: Simulation): Float64Array {
  return sim.ecoFlow.slice();
}

export interface Consumption {
  species: number;
  /** massa por tipo de fluxo (ordem de FLOW_KINDS) na janela */
  mass: number[];
}

export function consumptionBetween(sim: Simulation, before: Float64Array): Consumption[] {
  const out: Consumption[] = [];
  const n = Math.floor(sim.ecoFlow.length / FLOW_N);
  for (let s = 0; s < n; s++) {
    const mass: number[] = [];
    let tot = 0;
    for (let k = 0; k < FLOW_N; k++) {
      const v = sim.ecoFlow[s * FLOW_N + k] - (before[s * FLOW_N + k] ?? 0);
      mass.push(v);
      tot += v;
    }
    if (tot > 1e-9) out.push({ species: s, mass });
  }
  return out;
}

/** Rede alimentar OBSERVADA: arestas consumidor → consumido a partir da massa efetivamente transferida (janela recente). */
export function observedFoodWeb(sim: Simulation): { consumer: number; prey: number; mass: number }[] {
  const out: { consumer: number; prey: number; mass: number }[] = [];
  for (const [k, v] of sim.predFlow) out.push({ consumer: Math.floor(k / 1e6), prey: k % 1e6, mass: v });
  out.sort((a, b) => b.mass - a.mass);
  return out;
}

/** Sobreposição de uso de recursos (Pianka) entre dois perfis de consumo; 0 = nenhum recurso em comum. */
export function resourceOverlap(a: number[], b: number[]): number {
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0)), nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (na < 1e-12 || nb < 1e-12) return 0;
  let dot = 0;
  for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
  return dot / (na * nb);
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const vr = (x: number[]) => { const m = mean(x); return x.reduce((s, v) => s + (v - m) * (v - m), 0) / (x.length - 1); };

/**
 * Retirar um grupo muda também o orçamento de matéria do mundo (a matéria dos removidos precisa ir a algum lugar):
 * devolvê-la como detrito tende a fazer a remoção parecer BENÉFICA aos demais (pulso de nutrientes); retirá-la ao
 * sedimento tende a fazê-la parecer PREJUDICIAL. O efeito só é aceito se tiver o MESMO sinal nos dois limites;
 * se o sinal depende do destino da matéria, é "ambíguo" (~) — nunca um rótulo.
 */
function estimate(rem: number[], remSink: number[], ctl: number[], nB: number, o: Required<RemovalOptions>): EffectEstimate {
  const empty = { diff: 0, se: 0, diffSink: 0, seSink: 0, nB };
  if (nB < o.minN || rem.length < 3 || ctl.length < 3) return { ...empty, sign: '?' };
  const d1 = mean(rem) - mean(ctl), s1 = Math.sqrt(vr(rem) / rem.length + vr(ctl) / ctl.length);
  const d2 = mean(remSink) - mean(ctl), s2 = Math.sqrt(vr(remSink) / remSink.length + vr(ctl) / ctl.length);
  const cls = (d: number, se: number): Sign => (Math.abs(d) > o.minEffect && Math.abs(d) > o.zCrit * se ? (d < 0 ? '+' : '-') : '0');
  const a = cls(d1, s1), b = cls(d2, s2);
  // efeito de A sobre B = oposto ao efeito de remover A
  const sign: Sign = a === b ? a : '~';
  return { diff: d1, se: s1, diffSink: d2, seSink: s2, sign, nB };
}

/**
 * Interpretação dos dois sinais (A→B, B→A) com a evidência mecanística disponível.
 * `+` em X→Y significa que X melhora Y. Nunca é usada para decidir comportamento.
 */
export function interpret(sAB: Sign, sBA: Sign, aEatsB: number, bEatsA: number): { label: string; evidence: string } {
  if (sAB === '~' || sBA === '~') return { label: 'indeterminada', evidence: 'o sinal do efeito depende do destino da matéria removida (viés de matéria); não é possível separar interação de realocação de matéria' };
  if (sAB === '?' || sBA === '?') return { label: 'indeterminada', evidence: 'dados insuficientes (grupo pequeno demais ou poucas réplicas)' };
  const eat = (x: number) => x > 0.5;
  if (sAB === '0' && sBA === '0') return { label: 'sem efeito detectável', evidence: 'nenhuma remoção alterou o outro grupo além do ruído' };
  if (sAB === '+' && sBA === '+') return { label: 'mutualismo (efeito líquido)', evidence: 'a remoção de qualquer um prejudica o outro' };
  if (sAB === '-' && sBA === '-') return { label: 'competição (efeito líquido)', evidence: 'a remoção de qualquer um beneficia o outro' };
  if (sAB === '+' && sBA === '0') return { label: 'comensalismo (efeito líquido)', evidence: 'B depende de A; A não é afetado além do ruído' };
  if (sAB === '0' && sBA === '+') return { label: 'comensalismo (efeito líquido)', evidence: 'A depende de B; B não é afetado além do ruído' };
  if (sAB === '-' && sBA === '0' && eat(aEatsB)) return { label: 'consumo sem benefício líquido detectável (A consome B)', evidence: 'consumo direto registrado e B é prejudicado; o ganho de A não aparece no efeito da remoção de B (hipótese: ganho pequeno ou diluído)' };
  if (sAB === '0' && sBA === '-' && eat(bEatsA)) return { label: 'consumo sem benefício líquido detectável (B consome A)', evidence: 'consumo direto registrado e A é prejudicado; o ganho de B não aparece no efeito da remoção de A (hipótese: ganho pequeno ou diluído)' };
  if (sAB === '-' && sBA === '0') return { label: 'amensalismo (efeito líquido)', evidence: 'A prejudica B; B não afeta A além do ruído' };
  if (sAB === '0' && sBA === '-') return { label: 'amensalismo (efeito líquido)', evidence: 'B prejudica A; A não afeta B além do ruído' };
  // sinais opostos: exploração
  const exploiter = sAB === '+' && sBA === '-' ? 'B' : 'A'; // quem é beneficiado à custa do outro
  const ate = exploiter === 'B' ? eat(bEatsA) : eat(aEatsB);
  return ate
    ? { label: `predação/herbivoria (${exploiter} consome o outro)`, evidence: 'consumo direto registrado + efeito líquido (+,−)' }
    : { label: 'exploração sem consumo direto registrado', evidence: 'efeito líquido (+,−) sem fluxo de consumo; causa indireta (hipótese)' };
}

/**
 * Experimento de remoção. Para cada grupo A, remove-o e mede o efeito sobre os demais; compara com réplicas de controle.
 * O estado original não é modificado.
 */
export function removalExperiment(sim: Simulation, groups: Group[], opts: RemovalOptions = {}): PairResult[] {
  const o = { ...DEF, ...opts } as Required<RemovalOptions>;
  const sets = groups.map((g) => new Set(g.species));
  const n0 = groups.map((g) => count(sim, g));
  const s0 = sim.species.size; // espécies existentes no instante 0
  const m0 = groups.map((g) => groupBiomass(sim, g.species));
  const logR = (m: number, k: number) => Math.log((m + 1e-6) / (m0[k] + 1e-6));

  // controle (réplicas diferem só no deslocamento do RNG, de modo determinístico)
  const ctl: number[][] = groups.map(() => []);
  const flowCtl = groups.map(() => groups.map(() => 0));
  const speciesToGroup = new Map<number, number>();
  groups.forEach((g, k) => g.species.forEach((s) => speciesToGroup.set(s, k)));
  for (let r = 0; r < o.replicates; r++) {
    const f = forkSimulation(sim);
    for (let q = 0; q < r + 1; q++) f.rng.next();
    f.predFlow.clear();
    f.run(o.horizon);
    // fluxo de consumo da janela (predFlow decai pouco; é lido ao fim)
    if (r === 0) {
      for (const [key, v] of f.predFlow) {
        const cons = speciesToGroup.get(Math.floor(key / 1e6)), prey = speciesToGroup.get(key % 1e6);
        if (cons !== undefined && prey !== undefined && cons !== prey) flowCtl[cons][prey] += v;
      }
    }
    groups.forEach((g, k) => ctl[k].push(logR(groupBiomass(f, g.species, s0), k)));
  }

  const effect: EffectEstimate[][] = groups.map(() => groups.map(() => ({ diff: 0, se: 0, diffSink: 0, seSink: 0, sign: '?' as Sign, nB: 0 })));
  for (let a = 0; a < groups.length; a++) {
    const rem: number[][] = groups.map(() => []);
    const remSink: number[][] = groups.map(() => []);
    for (let r = 0; r < o.replicates; r++) {
      for (const sink of [false, true]) {
        const f = forkSimulation(sim);
        for (let q = 0; q < r + 1; q++) f.rng.next();
        f.removeWhere((i) => sets[a].has(f.pool.species[i]), sink);
        f.run(o.horizon);
        groups.forEach((g, k) => { if (k !== a) (sink ? remSink : rem)[k].push(logR(groupBiomass(f, g.species, s0), k)); });
      }
    }
    for (let b = 0; b < groups.length; b++) if (b !== a) effect[a][b] = estimate(rem[b], remSink[b], ctl[b], n0[b], o);
  }

  const out: PairResult[] = [];
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      const aOnB = effect[a][b], bOnA = effect[b][a];
      const { label, evidence } = interpret(aOnB.sign, bOnA.sign, flowCtl[a][b], flowCtl[b][a]);
      out.push({ a: groups[a].name, b: groups[b].name, aOnB, bOnA, flowAeatsB: flowCtl[a][b], flowBeatsA: flowCtl[b][a], label, evidence });
    }
  }
  return out;
}

export const FLOW_LABELS = FLOW_KINDS;
