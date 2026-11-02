// Validação em execução REAL da IA: npm run ai-smoke
// Requer a chave do provedor no ambiente (ANTHROPIC_API_KEY, ou EVOLVERE_AI_PROVIDER=openai + OPENAI_API_KEY).
// Nada aqui é simulado: se não houver chave, o script informa o bloqueio e sai com código 2.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AIDirector } from '../src/ai/director';
import { EcoEventManager } from '../src/core/events';
import { Simulation } from '../src/core/simulation';
import { createHandler } from '../server/ai-proxy.mjs';
import { resolveConfig } from '../server/providers.mjs';
import { statsOf } from '../tests/helpers';

const cfg = resolveConfig(process.env);
if (!cfg.apiKey && !cfg.keyOptional) {
  console.log(JSON.stringify({ status: 'BLOQUEADO', motivo: `sem chave para o provedor "${cfg.provider}"`, como: 'exporte ANTHROPIC_API_KEY (ou EVOLVERE_AI_PROVIDER=openai e OPENAI_API_KEY) e rode novamente' }, null, 2));
  process.exit(2);
}
const srv = createServer(createHandler());
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/ai`;

const sim = new Simulation({ seed: 12 });
sim.run(1500);
const m0 = sim.totalMass();
const d = new AIDirector();
d.endpoint = url;
d.enabled = true;
await d.checkStatus();
const report: any = { provider: d.status.provider, modelo: d.status.model, tickInicial: sim.tick, populacaoInicial: sim.pool.count };

let t = performance.now();
const chron = await d.chronicle(statsOf(sim));
report.cronica = { origem: chron.source, ms: Math.round(performance.now() - t), titulo: chron.title, texto: chron.text, numerosNaoAncorados: chron.warnings ?? [] };
if (chron.source !== 'ai') { console.log(JSON.stringify({ ...report, status: 'FALHOU', motivo: 'a chamada real não retornou (chave inválida, rede ou provedor)' }, null, 2)); srv.close(); process.exit(1); }

await new Promise((r) => setTimeout(r, 2100));
t = performance.now();
const items = await d.events(statsOf(sim));
report.eventos = { ms: Math.round(performance.now() - t), propostos: items.length, itens: [] as any[] };
const mgr = new EcoEventManager({ minGap: 0, maxPerWindow: 10 });
for (const it of items) {
  const v = mgr.submit(sim, it.suggestion);
  report.eventos.itens.push({ proposta: it.suggestion, validacaoDoMotor: v });
}
const popAntes = sim.pool.count;
sim.run(700);
mgr.tick(sim);
report.impacto = sim.events.items.filter((e) => e.type === 'ai_impact').map((e) => e.text);
report.populacao = { antes: popAntes, depois: sim.pool.count };
report.massaConservada = Math.abs(sim.totalMass() - m0) / m0 < 1e-9;
report.status = 'EXECUTADO';
console.log(JSON.stringify(report, null, 2));
srv.close();
