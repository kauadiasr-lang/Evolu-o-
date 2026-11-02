import { describe, expect, it } from 'vitest';
import { buildDigest, ungroundedNumbers } from '../src/ai/digest';
import { localChronicle } from '../src/ai/chronicler';
import { AIDirector, parseSuggestions } from '../src/ai/director';
import { applySuggestion, validateSuggestion } from '../src/core/validate';
import { createHandler } from '../server/ai-proxy.mjs';
import { smallSim } from './helpers';
import { GENE_COUNT } from '../src/core/genome';
import { visFromGenes, VIS } from '../src/core/snapshot';
import type { StatsPayload } from '../src/worker/protocol';
import type { Simulation } from '../src/core/simulation';

/** Reproduz o que o worker envia, para testar o digest sobre dados reais do motor. */
function statsOf(s: Simulation): StatsPayload {
  const species = s.species.list.map((sp) => {
    const vis = new Uint8Array(VIS);
    visFromGenes(sp.centroid, 0, vis, 0);
    return { id: sp.id, name: sp.name, parentId: sp.parentId, bornTick: sp.bornTick, extinctTick: sp.extinctTick, count: sp.count, peak: sp.peak, trophic: sp.trophic, cause: sp.cause, vis: Array.from(vis), centroid: Array.from(sp.centroid), src: [0, 0, 0] as [number, number, number] };
  });
  return {
    tick: s.tick, pop: s.pool.count, mass: s.massBreakdown(), speciesAlive: s.species.aliveCount(), speciesTotal: s.species.size, maxGen: s.maxGeneration,
    births: s.birthsTotal, mutations: s.mutationsTotal, deaths: { ...s.deathsTotal },
    planet: { climateTarget: 0, climateOffset: 0, pressure: s.planet.pressure, meanTemp: 20, season: 0 },
    species, history: { ticks: s.history.ticks, series: s.history.series }, events: s.events.items.slice(-50), eventCount: s.events.items.length,
    web: { nodes: [], edges: [] }, extinct: false,
  };
}

describe('digest e narrativa ancorada nos dados', () => {
  const sim = smallSim({ seed: 12 });
  sim.run(1500);
  const st = statsOf(sim);
  const d = buildDigest(st);

  it('o digest contém apenas números reais do planeta', () => {
    expect(d.populacao).toBe(sim.pool.count);
    expect(d.especiesVivas).toBe(sim.species.aliveCount());
    expect(d.massa.organismos).toBeCloseTo(sim.massBreakdown().organisms, 1);
    for (const e of d.especiesPrincipais) expect(sim.species.get(e.id).count).toBe(e.individuos);
    expect(GENE_COUNT).toBe(24);
  });

  it('o cronista local usa somente fatos do digest', () => {
    const c = localChronicle(d);
    expect(c.source).toBe('local');
    expect(c.text).toContain(String(d.populacao));
    expect(ungroundedNumbers(c.text, d)).toEqual([]);
  });

  it('detecta números inventados pela IA', () => {
    expect(ungroundedNumbers(`Havia ${d.populacao} organismos.`, d)).toEqual([]);
    expect(ungroundedNumbers('A população chegou a 987654 indivíduos.', d)).toContain('987654');
  });

  it('planeta sem vida gera crônica sem inventar estatísticas', () => {
    const empty = smallSim({ seed: 3, initialPopulation: 0 });
    empty.run(60);
    const c = localChronicle(buildDigest(statsOf(empty)));
    expect(c.title).toBe('O silêncio');
  });
});

describe('a IA não altera o mundo sem validação do motor', () => {
  it('sugestões inválidas ou incoerentes são recusadas', () => {
    const sim = smallSim({ seed: 5 });
    sim.run(200);
    const T0 = sim.planet.climateTarget;
    expect(validateSuggestion(sim, { type: 'climate_shift', deltaT: 40 }).ok).toBe(false);
    expect(validateSuggestion(sim, { type: 'eruption', x: 3, y: 3, amount: 50 }).ok).toBe(false); // pressão insuficiente
    expect(validateSuggestion(sim, { type: 'adaptation', speciesId: 1, gene: 'NAO_EXISTE', delta: 0.05 }).ok).toBe(false);
    expect(validateSuggestion(sim, { type: 'adaptation', speciesId: 1, gene: 'DEFENSE', delta: 0.9 }).ok).toBe(false);
    expect(validateSuggestion(sim, { type: 'adaptation', speciesId: 999, gene: 'DEFENSE', delta: 0.05 }).ok).toBe(false);
    expect(applySuggestion(sim, { type: 'climate_shift', deltaT: 40 }).ok).toBe(false);
    expect(sim.planet.climateTarget).toBe(T0);
  });

  it('adaptação sugerida vira apenas uma variante rara sujeita à seleção natural', () => {
    const sim = smallSim({ seed: 8 });
    sim.run(600);
    const sp = sim.species.list.find((s) => s.count > 40)!;
    const before = [...Array(sim.pool.used).keys()].filter((i) => sim.pool.alive[i] && sim.pool.species[i] === sp.id).map((i) => sim.pool.genes[i * 24 + 11]);
    const v = applySuggestion(sim, { type: 'adaptation', speciesId: sp.id, gene: 'DEFENSE', delta: 0.1, individuals: 3 });
    expect(v.ok).toBe(true);
    const after = [...Array(sim.pool.used).keys()].filter((i) => sim.pool.alive[i] && sim.pool.species[i] === sp.id).map((i) => sim.pool.genes[i * 24 + 11]);
    const changed = after.filter((x, i) => Math.abs(x - before[i]) > 1e-6).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(3); // nunca vira a espécie inteira
  });

  it('o parser aceita JSON válido e descarta lixo', () => {
    const text = 'Hipótese...\n```json\n[{"type":"climate_shift","deltaT":-2,"rationale":"x"},{"type":"hack","x":1},{"type":"adaptation","speciesId":2,"gene":"DEFENSE","delta":0.05}]\n```';
    const items = parseSuggestions(text);
    expect(items.map((i) => i.suggestion.type)).toEqual(['climate_shift', 'adaptation']);
    expect(parseSuggestions('sem json')).toEqual([]);
  });
});

describe('diretor: funciona offline, com cache e sem chamadas a cada frame', () => {
  const sim = smallSim({ seed: 12 });
  sim.run(800);
  const st = statsOf(sim);

  it('sem IA ligada usa o cronista local', async () => {
    const dir = new AIDirector();
    const c = await dir.chronicle(st);
    expect(c.source).toBe('local');
  });

  it('com IA: usa o proxy, respeita cache e cai no local em caso de falha', async () => {
    let calls = 0;
    const dir = new AIDirector();
    dir.enabled = true;
    dir.status = { configured: true, reachable: true };
    dir.fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ text: 'Título da era\n\nO planeta tem ' + st.pop + ' organismos.' }), { status: 200 });
    }) as typeof fetch;
    const c1 = await dir.chronicle(st);
    expect(c1.source).toBe('ai');
    expect(c1.title).toBe('Título da era');
    expect(c1.warnings).toBeUndefined();
    await new Promise((r) => setTimeout(r, 2100));
    await dir.chronicle(st);
    expect(calls).toBe(1); // segunda chamada veio do cache
    dir.fetchImpl = (async () => { throw new Error('offline'); }) as typeof fetch;
    const d2 = new AIDirector();
    d2.enabled = true;
    d2.status = { configured: true, reachable: true };
    d2.fetchImpl = dir.fetchImpl;
    expect((await d2.chronicle(st)).source).toBe('local');
  }, 10000);

  it('marca números inventados pela IA', async () => {
    const dir = new AIDirector();
    dir.enabled = true;
    dir.status = { configured: true, reachable: true };
    dir.fetchImpl = (async () => new Response(JSON.stringify({ text: 'Era\n\nHavia 123456 criaturas.' }), { status: 200 })) as typeof fetch;
    const c = await dir.chronicle(st);
    expect(c.warnings).toContain('123456');
  });

  it('throttle: não pede nova crônica automática antes do intervalo', () => {
    const dir = new AIDirector();
    expect(dir.shouldAuto(1000)).toBe(true);
    (dir as any).lastTick = 900;
    expect(dir.shouldAuto(1000)).toBe(false);
  });
});

describe('proxy da IA no backend', () => {
  const fakeRes = () => {
    const r: any = { code: 0, body: '', writeHead(c: number) { r.code = c; }, end(b: string) { r.body = b; } };
    return r;
  };
  const req = (method: string, url: string, body?: any) => {
    const chunks = body === undefined ? [] : [JSON.stringify(body)];
    return Object.assign((async function* () { for (const c of chunks) yield c; })(), { method, url });
  };

  it('sem chave: IA desligada (503) e status informa configured=false', async () => {
    const h = createHandler({ env: {} });
    const r1 = fakeRes();
    await h(req('GET', '/api/ai/status') as any, r1);
    expect(JSON.parse(r1.body).configured).toBe(false);
    const r2 = fakeRes();
    await h(req('POST', '/api/ai', { mode: 'chronicle', digest: {} }) as any, r2);
    expect(r2.code).toBe(503);
  });

  it('com chave: chama o provedor uma única vez (cache) e nunca devolve a chave', async () => {
    let n = 0;
    const SECRET = 'sk-test-secret-123';
    const fetchImpl = (async (_u: string, init: any) => {
      n++;
      expect(init.headers['x-api-key']).toBe(SECRET);
      expect(init.body).toContain('Diretora do Planeta');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
    }) as any;
    const h = createHandler({ env: { ANTHROPIC_API_KEY: SECRET }, fetchImpl });
    const a = fakeRes(), b = fakeRes(), s = fakeRes();
    await h(req('POST', '/api/ai', { mode: 'chronicle', digest: { tick: 1 } }) as any, a);
    await h(req('POST', '/api/ai', { mode: 'chronicle', digest: { tick: 1 } }) as any, b);
    await h(req('GET', '/api/ai/status') as any, s);
    expect(n).toBe(1);
    expect(JSON.parse(a.body).text).toBe('ok');
    expect(JSON.parse(b.body).cached).toBe(true);
    expect(a.body + b.body + s.body).not.toContain(SECRET);
  });

  it('limita chamadas por minuto e rejeita requisições inválidas', async () => {
    const h = createHandler({ env: { ANTHROPIC_API_KEY: 'k', EVOLVERE_AI_RPM: '2' }, fetchImpl: (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'x' }] }))) as any });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = fakeRes();
      await h(req('POST', '/api/ai', { mode: 'ask', digest: { i }, question: 'q' }) as any, r);
      codes.push(r.code);
    }
    expect(codes).toEqual([200, 200, 429, 429]);
    const bad = fakeRes();
    await h(req('POST', '/api/ai', { mode: 'rm -rf', digest: {} }) as any, bad);
    expect(bad.code).toBe(400);
  });
});
