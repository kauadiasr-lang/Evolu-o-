// Proxy local da IA: a chave de API fica SOMENTE aqui (variável de ambiente), nunca no navegador.
//   ANTHROPIC_API_KEY=... npm run ai-proxy      (porta 8787; o Vite encaminha /api -> 8787)
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { SYSTEM, buildPrompt, MODES } from './prompts.mjs';
import { complete, resolveConfig } from './providers.mjs';

export function createHandler({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map();
  const calls = [];
  const cfg = resolveConfig(env);
  const configured = () => !!cfg.apiKey || cfg.keyOptional;
  const TTL = 30 * 60 * 1000;
  const MAX_PER_MIN = Number(env.EVOLVERE_AI_RPM || 12);

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/ai/status') {
      return json(res, 200, { configured: configured(), provider: cfg.provider, model: cfg.model });
    }
    if (req.method !== 'POST' || url.pathname !== '/api/ai') return json(res, 404, { error: 'não encontrado' });
    if (!configured()) return json(res, 503, { error: 'IA não configurada (defina a chave do provedor no backend).' });

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 200_000) return json(res, 413, { error: 'payload grande demais' });
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'JSON inválido' });
    }
    const { mode, digest, question } = data;
    if (!MODES.includes(mode) || typeof digest !== 'object' || digest === null) return json(res, 400, { error: 'requisição inválida' });

    const key = createHash('sha256').update(JSON.stringify([mode, digest, question ?? ''])).digest('hex');
    const hit = cache.get(key);
    if (hit && now() - hit.t < TTL) return json(res, 200, { text: hit.text, cached: true });

    const t = now();
    while (calls.length && t - calls[0] > 60_000) calls.shift();
    if (calls.length >= MAX_PER_MIN) return json(res, 429, { error: 'limite de chamadas por minuto atingido' });
    calls.push(t);

    try {
      const t0 = now();
      const out = await complete(cfg, { system: SYSTEM, user: buildPrompt(mode, digest, question), maxTokens: mode === 'events' ? 1100 : 900 }, fetchImpl);
      cache.set(key, { t: now(), text: out.text });
      return json(res, 200, { text: out.text, provider: cfg.provider, model: out.model, ms: now() - t0 });
    } catch (e) {
      return json(res, 502, { error: e?.status ? `falha no provedor de IA (${e.status})` : 'IA indisponível' });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  createServer(createHandler()).listen(port, '127.0.0.1', () => {
    console.log(`EVOLVERE AI proxy em http://127.0.0.1:${port}  (${(() => { const c = resolveConfig(process.env); return `${c.provider}/${c.model}, chave ${c.apiKey || c.keyOptional ? 'configurada' : 'AUSENTE — a IA ficará desligada'}`; })()})`);
  });
}
