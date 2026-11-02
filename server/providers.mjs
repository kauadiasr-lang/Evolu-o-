// Adaptadores de provedor de LLM (independentes de fornecedor). Cada um recebe
// { system, user, maxTokens } e devolve { text, model }. A chave nunca sai deste processo.

export function resolveConfig(env) {
  const provider = (env.EVOLVERE_AI_PROVIDER || (env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY ? 'openai' : 'anthropic')).toLowerCase();
  if (provider === 'openai') {
    return {
      provider,
      apiKey: env.EVOLVERE_AI_API_KEY || env.OPENAI_API_KEY || '',
      // compatível com OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio...
      baseUrl: (env.EVOLVERE_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.EVOLVERE_AI_MODEL || 'gpt-4o-mini',
      keyOptional: /^https?:\/\/(localhost|127\.0\.0\.1)/.test(env.EVOLVERE_AI_BASE_URL || ''),
    };
  }
  return {
    provider: 'anthropic',
    apiKey: env.EVOLVERE_AI_API_KEY || env.ANTHROPIC_API_KEY || '',
    // propositalmente NÃO lê ANTHROPIC_BASE_URL: o endpoint só muda por EVOLVERE_AI_BASE_URL
    baseUrl: (env.EVOLVERE_AI_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
    model: env.EVOLVERE_AI_MODEL || 'claude-sonnet-5-5',
    keyOptional: false,
  };
}

export async function complete(cfg, { system, user, maxTokens = 900 }, fetchImpl = fetch) {
  if (cfg.provider === 'openai') {
    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
    const r = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) throw Object.assign(new Error(`provedor respondeu ${r.status}`), { status: r.status });
    const j = await r.json();
    return { text: String(j.choices?.[0]?.message?.content ?? '').trim(), model: j.model || cfg.model };
  }
  const r = await fetchImpl(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw Object.assign(new Error(`provedor respondeu ${r.status}`), { status: r.status });
  const j = await r.json();
  return { text: (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim(), model: j.model || cfg.model };
}
