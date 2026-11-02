// Proxy local da IA: a chave de API fica SOMENTE aqui (variável de ambiente), nunca no navegador.
//   ANTHROPIC_API_KEY=... npm run ai-proxy      (porta 8787; o Vite encaminha /api -> 8787)
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { SYSTEM, buildPrompt } from './prompts.mjs';

export function createHandler({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map();
  const calls = [];
  const model = env.EVOLVERE_AI_MODEL || 'claude-sonnet-5-5';
  const TTL = 30 * 60 * 1000;
  const MAX_PER_MIN = Number(env.EVOLVERE_AI_RPM || 12);

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/ai/status') {
      return json(res, 200, { configured: !!env.ANTHROPIC_API_KEY, model });
    }
    if (req.method !== 'POST' || url.pathname !== '/api/ai') return json(res, 404, { error: 'não encontrado' });
    if (!env.ANTHROPIC_API_KEY) return json(res, 503, { error: 'IA não configurada (defina ANTHROPIC_API_KEY no backend).' });

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
    if (!['chronicle', 'ask', 'hypotheses'].includes(mode) || typeof digest !== 'object' || digest === null) return json(res, 400, { error: 'requisição inválida' });

    const key = createHash('sha256').update(JSON.stringify([mode, digest, question ?? ''])).digest('hex');
    const hit = cache.get(key);
    if (hit && now() - hit.t < TTL) return json(res, 200, { text: hit.text, cached: true });

    const t = now();
    while (calls.length && t - calls[0] > 60_000) calls.shift();
    if (calls.length >= MAX_PER_MIN) return json(res, 429, { error: 'limite de chamadas por minuto atingido' });
    calls.push(t);

    try {
      const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM, messages: [{ role: 'user', content: buildPrompt(mode, digest, question) }] }),
      });
      if (!r.ok) return json(res, 502, { error: `falha no provedor de IA (${r.status})` });
      const j = await r.json();
      const text = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      cache.set(key, { t: now(), text });
      return json(res, 200, { text });
    } catch {
      return json(res, 502, { error: 'IA indisponível' });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  createServer(createHandler()).listen(port, '127.0.0.1', () => {
    console.log(`EVOLVERE AI proxy em http://127.0.0.1:${port}  (chave ${process.env.ANTHROPIC_API_KEY ? 'configurada' : 'AUSENTE — a IA ficará desligada'})`);
  });
}
