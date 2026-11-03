import { describe, expect, it } from 'vitest';
import { buildDigest, ungroundedNumbers } from '../src/ai/digest';
import { localChronicle } from '../src/ai/chronicler';
import { AIDirector, parseSuggestions } from '../src/ai/director';
import { applySuggestion, validateSuggestion } from '../src/core/validate';
import { createHandler } from '../server/ai-proxy.mjs';
import { smallSim, stage3Sim, statsOf } from './helpers';
import { BASE_GENES, GENE_COUNT } from '../src/core/genome';

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
    expect(BASE_GENES).toBe(24);
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
    expect(validateSuggestion(sim, { type: 'nutrient_upwelling', x: 5, y: 5, amount: 9999 }).ok).toBe(false);
    expect(applySuggestion(sim, { type: 'climate_shift', deltaT: 40 }).ok).toBe(false);
    expect(sim.planet.climateTarget).toBe(T0);
  });

  it('a IA NUNCA altera genomas: hipóteses sobre adaptações são só texto e o motor as recusa como ação', () => {
    const sim = smallSim({ seed: 8 });
    sim.run(600);
    const genes0 = Array.from(sim.pool.genes.subarray(0, sim.pool.used * GENE_COUNT));
    const sp = sim.species.list.find((s) => s.count > 40)!;
    const v = applySuggestion(sim, { type: 'hypothesis', speciesId: sp.id, text: 'Uma carapaça mais espessa poderia compensar a predação.' });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/não altera genomas/);
    expect(Array.from(sim.pool.genes.subarray(0, sim.pool.used * GENE_COUNT))).toEqual(genes0);
    expect((sim as any).introduceVariant).toBeUndefined(); // o caminho de edição de genes não existe mais
  });

  it('o parser aceita JSON válido e descarta lixo', () => {
    const text = 'Hipótese...\n```json\n[{"type":"climate_shift","deltaT":-2,"rationale":"x"},{"type":"hack","x":1},{"type":"adaptation","speciesId":2,"gene":"DEFENSE","delta":0.05,"text":"carapaça"}]\n```';
    const items = parseSuggestions(text);
    // propostas de "adaptação" viram hipóteses (texto): nunca comandos sobre genes
    expect(items.map((i) => i.suggestion.type)).toEqual(['climate_shift', 'hypothesis']);
    expect(JSON.stringify(items[1].suggestion)).not.toContain('DEFENSE');
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


describe('Fase 6: a IA analisa espécies e biomas com dados reais (e funciona sem IA)', () => {
  const sim = stage3Sim({ initialPopulation: 700, seed: 3 });
  sim.run(1200);
  sim.flora!.colonize(sim.planet, sim.tick, 40);
  sim.seedArchetype('amphibian', 20, 12, 12, 2);
  sim.run(800);
  const st = statsOf(sim);
  const d = buildDigest(st);

  it('o digest inclui anatomia real, flora e biomas calculados pelo motor', () => {
    expect(d.biomas && d.biomas.length).toBeGreaterThan(2);
    expect(d.terra?.areaTerrestrialPercentual).toBeGreaterThan(20);
    expect(d.flora?.plantas).toBe(sim.flora!.pool.count);
    for (const e of d.especiesPrincipais) {
      const sp = sim.species.get(e.id);
      expect(e.individuos).toBe(sp.count);
      expect(e.anatomia).toBeDefined();
    }
    // as áreas de bioma do digest vêm do estado: somam ≤ 100%
    expect(d.biomas!.reduce((a, b) => a + b.percentualSuperficie, 0)).toBeLessThanOrEqual(100.5);
  });

  it('o cronista local (sem IA) descreve biomas e flora usando só números do digest', () => {
    const c = localChronicle(d);
    expect(c.text).toMatch(/flora soma/);
    expect(ungroundedNumbers(c.text, d)).toEqual([]);
  });

  it('com IA: análise de espécie e narrativa de biomas usam o proxy e marcam números inventados', async () => {
    const dir = new AIDirector();
    dir.enabled = true;
    dir.status = { configured: true, reachable: true };
    const sent: any[] = [];
    dir.fetchImpl = (async (_u: any, init: any) => {
      const body = JSON.parse(init.body);
      sent.push(body);
      const text = body.mode === 'species' ? `Esta espécie tem ${d.especiesPrincipais[0].individuos} indivíduos.` : 'Os biomas mudaram em 987654 células.';
      return new Response(JSON.stringify({ text }), { status: 200 });
    }) as typeof fetch;
    const a = await dir.analyzeSpecies(st, d.especiesPrincipais[0].nome);
    expect(a.source).toBe('ai');
    expect(a.warnings).toBeUndefined();
    await new Promise((r) => setTimeout(r, 2100));
    const b = await dir.narrateBiomes(st);
    expect(b.warnings).toContain('987654');
    expect(sent.map((x) => x.mode)).toEqual(['species', 'biomes']);
    expect(JSON.stringify(sent[0].digest)).toContain('anatomia');
    expect(JSON.stringify(sent[1].digest)).toContain('biomas');
  }, 10000);

  it('offline: análise e narração caem no texto local, sem erro', async () => {
    const dir = new AIDirector();
    const a = await dir.analyzeSpecies(st, '');
    const b = await dir.narrateBiomes(st);
    expect(a.source).toBe('local');
    expect(b.source).toBe('local');
  });

  it('os prompts proíbem alterar genomas e não oferecem comandos de gene', async () => {
    const { buildPrompt, SYSTEM, MODES } = await import('../server/prompts.mjs');
    expect(SYSTEM).toMatch(/NUNCA altera genomas/);
    for (const m of MODES) {
      const p = buildPrompt(m, { x: 1 }, 'q');
      expect(p).not.toMatch(/"gene"\s*:/);
      expect(p).not.toMatch(/"delta"\s*:\s*0\.\d+.*"gene"/);
    }
    expect(MODES).toEqual(expect.arrayContaining(['species', 'biomes']));
  });
});
