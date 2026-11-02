import type { Suggestion } from '../core/validate';
import { localChronicle, type Chronicle } from './chronicler';
import { buildDigest, ungroundedNumbers, type Digest } from './digest';
import type { StatsPayload } from '../worker/protocol';

export interface AIStatus {
  configured: boolean;
  model?: string;
  provider?: string;
  reachable: boolean;
}

export interface SuggestionItem {
  suggestion: Suggestion;
  rationale: string;
}

/**
 * Diretor do planeta: usa a IA (via proxy local, que guarda a chave) para narrar e
 * levantar hipóteses; sem rede/chave, cai no cronista local. Nunca é chamado por frame:
 * há intervalo mínimo, cache por digest e timeout.
 */
export class AIDirector {
  enabled = false;
  status: AIStatus = { configured: false, reachable: false };
  private cache = new Map<string, any>();
  private lastCall = 0;
  private lastTick = -1e9;
  minIntervalMs = 15000;
  minIntervalTicks = 400;
  chronicles: Chronicle[] = [];
  onChronicle: (c: Chronicle) => void = () => {};
  endpoint = '/api/ai';
  fetchImpl: typeof fetch = (...a) => fetch(...a);

  async checkStatus(): Promise<AIStatus> {
    try {
      const r = await this.fetchImpl(`${this.endpoint}/status`, { signal: AbortSignal.timeout(2500) });
      const j = await r.json();
      this.status = { configured: !!j.configured, model: j.model, provider: j.provider, reachable: true };
    } catch {
      this.status = { configured: false, reachable: false };
    }
    return this.status;
  }

  private key(mode: string, d: Digest, q = ''): string {
    // o cache ignora oscilações pequenas: arredonda tick e usa a lista de eventos
    return `${mode}|${Math.floor(d.tick / 200)}|${d.especiesVivas}|${d.especiesTotais}|${q}`;
  }

  private async call(mode: string, digest: Digest, question = ''): Promise<string | null> {
    if (!this.enabled || !this.status.configured) return null;
    const k = this.key(mode, digest, question);
    if (this.cache.has(k)) return this.cache.get(k);
    const now = Date.now();
    if (now - this.lastCall < 2000) return null;
    this.lastCall = now;
    try {
      const r = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, digest, question }),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const text = String(j.text ?? '');
      this.cache.set(k, text);
      return text;
    } catch {
      return null;
    }
  }

  /** Chamada periódica: só gera nova crônica se passou tempo e o planeta mudou. */
  shouldAuto(tick: number): boolean {
    return tick - this.lastTick >= this.minIntervalTicks && Date.now() - this.lastCall >= this.minIntervalMs;
  }

  async chronicle(st: StatsPayload): Promise<Chronicle> {
    const digest = buildDigest(st, this.lastTick > 0 ? this.lastTick : 0);
    this.lastTick = st.tick;
    const local = localChronicle(digest);
    const text = await this.call('chronicle', digest);
    let c = local;
    if (text) {
      const m = text.match(/^\s*(?:#+\s*)?(.{3,90}?)\n+([\s\S]+)$/);
      c = {
        title: m ? m[1].replace(/^\*+|\*+$/g, '').trim() : local.title,
        text: (m ? m[2] : text).trim(),
        source: 'ai',
        tick: st.tick,
      };
      const bad = ungroundedNumbers(c.text, digest);
      if (bad.length) c.warnings = bad;
    }
    this.chronicles.push(c);
    this.onChronicle(c);
    return c;
  }

  async ask(st: StatsPayload, question: string): Promise<Chronicle> {
    const digest = buildDigest(st, 0);
    const text = await this.call('ask', digest, question);
    if (!text) {
      return { title: 'IA indisponível', text: 'A IA está desligada ou sem conexão. Resposta local: ' + localChronicle(digest).text, source: 'local', tick: st.tick };
    }
    const c: Chronicle = { title: question.slice(0, 80), text: text.trim(), source: 'ai', tick: st.tick };
    const bad = ungroundedNumbers(c.text, digest);
    if (bad.length) c.warnings = bad;
    return c;
  }

  /** Pede acontecimentos ecológicos. Devolve propostas cruas: o motor as valida depois. */
  async events(st: StatsPayload): Promise<SuggestionItem[]> {
    const digest = buildDigest(st, 0);
    const text = await this.call('events', digest);
    return text ? parseSuggestions(text) : [];
  }

  async describe(st: StatsPayload, speciesName = ''): Promise<string | null> {
    return this.call('describe', buildDigest(st, 0), speciesName);
  }

  /** A IA propõe hipóteses; elas só viram ação depois da validação do motor. */
  async hypotheses(st: StatsPayload): Promise<{ items: SuggestionItem[]; text: string }> {
    const digest = buildDigest(st, 0);
    const text = await this.call('hypotheses', digest);
    if (!text) return { items: [], text: '' };
    return { items: parseSuggestions(text), text };
  }
}

/** Extrai o bloco JSON de sugestões da resposta; ignora qualquer item mal formado. */
export function parseSuggestions(text: string): SuggestionItem[] {
  const m = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\[\s*\{[\s\S]*\}\s*\])/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]);
    if (!Array.isArray(arr)) return [];
    const out: SuggestionItem[] = [];
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    for (const a of arr.slice(0, 5)) {
      if (!a || typeof a !== 'object') continue;
      const rationale = String(a.rationale ?? a.justificativa ?? '').slice(0, 300);
      const meta = { title: a.title ? String(a.title).slice(0, 80) : undefined, narrative: a.narrative ? String(a.narrative).slice(0, 400) : undefined, rationale };
      if (a.type === 'climate_shift' && num(a.deltaT)) out.push({ suggestion: { type: 'climate_shift', deltaT: a.deltaT, ...meta }, rationale });
      else if (a.type === 'eruption' && num(a.x) && num(a.y) && num(a.amount)) out.push({ suggestion: { type: 'eruption', x: a.x, y: a.y, amount: a.amount, ...meta }, rationale });
      else if (a.type === 'nutrient_upwelling' && num(a.x) && num(a.y) && num(a.amount)) out.push({ suggestion: { type: 'nutrient_upwelling', x: a.x, y: a.y, radius: num(a.radius) ? a.radius : 4, amount: a.amount, ...meta }, rationale });
      else if (a.type === 'adaptation' && num(a.speciesId) && typeof a.gene === 'string' && num(a.delta))
        out.push({ suggestion: { type: 'adaptation', speciesId: a.speciesId, gene: a.gene, delta: a.delta, individuals: num(a.individuals) ? a.individuals : 3, ...meta }, rationale });
    }
    return out;
  } catch {
    return [];
  }
}
