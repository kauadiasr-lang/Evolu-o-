import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AIDirector } from '../src/ai/director';
import { EcoEventManager } from '../src/core/events';
import { createHandler } from '../server/ai-proxy.mjs';
import { smallSim, statsOf, stateHash } from './helpers';

/**
 * Integração de ponta a ponta SEM credenciais reais: provedores simulados por servidores HTTP locais
 * (formato Anthropic e OpenAI). Exercita proxy real, diretor, gerenciador de eventos e motor.
 * Prova a arquitetura; NÃO prova o comportamento de um modelo real (ver scripts/ai-smoke.mjs).
 */
const listen = (srv: Server) => new Promise<number>((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));
const readBody = (req: any) => new Promise<string>((res) => { let b = ''; req.on('data', (c: any) => (b += c)); req.on('end', () => res(b)); });

let provider: Server, proxy: Server, openaiProvider: Server, openaiProxy: Server;
let proxyUrl = '', openaiProxyUrl = '';
const seen: { headers: any; body: any; path: string }[] = [];
let nextReply = '';

beforeAll(async () => {
  provider = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    seen.push({ headers: req.headers, body, path: req.url! });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'mock-claude', content: [{ type: 'text', text: nextReply }] }));
  });
  const pp = await listen(provider);
  proxy = createServer(createHandler({ env: { ANTHROPIC_API_KEY: 'sk-mock-key', EVOLVERE_AI_BASE_URL: `http://127.0.0.1:${pp}`, EVOLVERE_AI_RPM: '100' } }));
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}/api/ai`;

  openaiProvider = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    seen.push({ headers: req.headers, body, path: req.url! });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'mock-gpt', choices: [{ message: { content: nextReply } }] }));
  });
  const op = await listen(openaiProvider);
  openaiProxy = createServer(createHandler({ env: { EVOLVERE_AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-mock', EVOLVERE_AI_BASE_URL: `http://127.0.0.1:${op}`, EVOLVERE_AI_RPM: '100' } }));
  openaiProxyUrl = `http://127.0.0.1:${await listen(openaiProxy)}/api/ai`;
});
afterAll(() => { for (const s of [provider, proxy, openaiProvider, openaiProxy]) s.close(); });

const director = async (url: string) => {
  const d = new AIDirector();
  d.endpoint = url;
  d.enabled = true;
  d.fetchImpl = fetch;
  const st = await d.checkStatus();
  if (!st.configured) throw new Error('proxy de teste deveria estar configurado');
  return d;
};

describe('IA → proxy → motor (HTTP real, provedor simulado)', () => {
  it('propõe acontecimentos; o motor aplica os válidos, recusa os inválidos e conserva a massa', async () => {
    const sim = smallSim({ seed: 12 });
    sim.run(900);
    const m0 = sim.totalMass();
    const sp = sim.species.list.find((s) => s.count > 40)!;
    nextReply = 'Hipótese.\n```json\n' + JSON.stringify([
      { type: 'nutrient_upwelling', x: 10, y: 10, radius: 3, amount: 40, title: 'Ressurgência costeira', narrative: 'Águas profundas sobem.', rationale: 'nutrientes baixos' },
      { type: 'climate_shift', deltaT: 40, title: 'Inferno', narrative: 'x' },
      { type: 'eruption', x: 5, y: 5, amount: 80, title: 'Erupção sem pressão' },
      { type: 'adaptation', speciesId: sp.id, gene: 'GENE_FALSO', delta: 0.05 },
      { type: 'adaptation', speciesId: sp.id, gene: 'DEFENSE', delta: 0.06, individuals: 3, title: 'Parede mais espessa' },
    ]) + '\n```';
    const d = await director(proxyUrl);
    const items = await d.events(statsOf(sim));
    expect(items.length).toBe(5);

    const mgr = new EcoEventManager({ minGap: 0, maxPerWindow: 10 });
    const verdicts = items.map((it) => mgr.submit(sim, it.suggestion));
    expect(verdicts.map((v) => v.ok)).toEqual([true, false, false, false, true]);
    expect(verdicts[1].reason).toMatch(/±6/);
    expect(verdicts[2].reason).toMatch(/pressão/i);
    expect(verdicts[3].reason).toMatch(/Gene desconhecido/);
    expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
    const evs = sim.events.items.filter((e) => e.type === 'ai_event');
    expect(evs.length).toBe(2);
    expect(evs[0].title).toContain('Ressurgência costeira');

    // impacto OBSERVADO, medido pelo motor (não narrado pela IA)
    sim.run(700);
    mgr.tick(sim);
    const impacts = sim.events.items.filter((e) => e.type === 'ai_impact');
    expect(impacts.length).toBe(2);
    expect(impacts[0].text).toMatch(/população \d+ → \d+/);
    expect(impacts[0].text).toMatch(/decidido pela simulação/);
    expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-9);
  });

  it('a chave vai ao provedor só pelo backend; o payload é um resumo, não os organismos', async () => {
    const sim = smallSim({ seed: 12 });
    sim.run(500);
    nextReply = 'Título\n\nTexto.';
    seen.length = 0;
    await (await director(proxyUrl)).chronicle(statsOf(sim));
    expect(seen.length).toBe(1);
    expect(seen[0].headers['x-api-key']).toBe('sk-mock-key');
    expect(seen[0].path).toBe('/v1/messages');
    const sent = JSON.stringify(seen[0].body);
    expect(sent.length).toBeLessThan(15000); // resumo, não milhares de organismos
    expect(sent).not.toContain('"genes"');
    expect(sent).toContain('populacao');
  });

  it('é independente de fornecedor: o adaptador OpenAI-compatível também funciona', async () => {
    const sim = smallSim({ seed: 12 });
    sim.run(500);
    nextReply = 'Era OpenAI\n\nCrônica via chat/completions.';
    seen.length = 0;
    const d = await director(openaiProxyUrl);
    expect(d.status.provider).toBe('openai');
    const c = await d.chronicle(statsOf(sim));
    expect(c.source).toBe('ai');
    expect(c.title).toBe('Era OpenAI');
    expect(seen[0].path).toBe('/chat/completions');
    expect(seen[0].headers.authorization).toBe('Bearer sk-openai-mock');
  });
});

describe('limites do gerenciador de acontecimentos', () => {
  it('eventos automáticos obedecem intervalo mínimo e teto por janela; decisões manuais não', () => {
    const sim = smallSim({ seed: 12 });
    sim.run(400);
    const mgr = new EcoEventManager({ minGap: 300, maxPerWindow: 2, window: 3000 });
    const ev = { type: 'climate_shift' as const, deltaT: -1 };
    expect(mgr.submit(sim, ev).ok).toBe(true);
    const tooSoon = mgr.submit(sim, ev);
    expect(tooSoon.ok).toBe(false);
    expect(tooSoon.reason).toMatch(/Intervalo mínimo/);
    expect(mgr.submit(sim, ev, { bypassRate: true }).ok).toBe(true); // jogador decide
    sim.run(310);
    expect(mgr.submit(sim, ev).ok).toBe(true);
    sim.run(310);
    const capped = mgr.submit(sim, ev);
    expect(capped.ok).toBe(false);
    expect(capped.reason).toMatch(/Limite/);
  });

  it('um acontecimento é entrada ambiental: não garante o resultado (a seleção decide)', () => {
    const sim = smallSim({ seed: 12 });
    sim.run(600);
    const before = sim.pool.count;
    const mgr = new EcoEventManager({ minGap: 0 });
    expect(mgr.submit(sim, { type: 'climate_shift', deltaT: -5, title: 'Resfriamento' }).ok).toBe(true);
    // a população NÃO é alterada diretamente pelo evento
    expect(sim.pool.count).toBe(before);
    sim.run(50);
    expect(sim.pool.count).toBeGreaterThan(0);
    expect(sim.planet.climateTarget).toBe(-5);
  });
});

describe('funcionamento sem IA / sem conexão', () => {
  it('com o proxy fora do ar o diretor cai no cronista local e nada trava', async () => {
    const sim = smallSim({ seed: 12 });
    sim.run(500);
    const d = new AIDirector();
    d.enabled = true;
    d.endpoint = 'http://127.0.0.1:1/api/ai'; // porta fechada
    d.fetchImpl = fetch;
    expect((await d.checkStatus()).reachable).toBe(false);
    const c = await d.chronicle(statsOf(sim));
    expect(c.source).toBe('local');
    expect(await d.events(statsOf(sim))).toEqual([]);
  });

  it('a história da simulação é idêntica com e sem tentativas de IA (sem dependência)', async () => {
    const a = smallSim({ seed: 21 }), b = smallSim({ seed: 21 });
    a.run(300);
    b.run(300);
    const d = new AIDirector();
    d.enabled = true;
    d.endpoint = 'http://127.0.0.1:1/api/ai';
    d.fetchImpl = fetch;
    await d.chronicle(statsOf(a)); // falha de rede, não toca o estado
    await d.events(statsOf(a));
    a.run(300);
    b.run(300);
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('chamadas ao modelo são limitadas: throttle e cache impedem uma chamada por tick', async () => {
    const sim = smallSim({ seed: 12 });
    sim.run(500);
    nextReply = 'T\n\nx';
    seen.length = 0;
    const d = await director(proxyUrl);
    d.minIntervalMs = 15000;
    for (let t = 0; t < 400; t++) {
      sim.step();
      if (d.shouldAuto(sim.tick)) await d.chronicle(statsOf(sim));
    }
    expect(seen.length).toBe(1); // 400 ticks => exatamente 1 chamada (a segunda é barrada pelo intervalo)
  });
});
