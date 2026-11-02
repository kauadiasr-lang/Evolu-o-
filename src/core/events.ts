import { Simulation } from './simulation';
import { Suggestion, validateSuggestion, applySuggestion } from './validate';

export interface EventLimits {
  /** intervalo mínimo (ticks) entre dois eventos de origem externa (IA) */
  minGap: number;
  /** máximo de eventos externos dentro da janela */
  maxPerWindow: number;
  window: number;
  /** ticks de observação antes de medir o impacto */
  impactAfter: number;
}

export const DEFAULT_LIMITS: EventLimits = { minGap: 300, maxPerWindow: 4, window: 3000, impactAfter: 600 };

export interface Outcome {
  ok: boolean;
  reason: string;
}

interface Pending {
  due: number;
  title: string;
  before: { pop: number; biomass: number; species: number; nutrient: number; temp: number };
}

/**
 * Gerenciador de acontecimentos: ÚNICO caminho pelo qual uma proposta externa (IA) chega ao mundo.
 * Valida de forma determinística, limita a frequência, aplica como ENTRADA AMBIENTAL (sem garantir
 * resultado evolutivo) e depois registra o impacto realmente observado. Não depende de IA nem de rede.
 */
export class EcoEventManager {
  limits: EventLimits;
  private applied: number[] = [];
  private pending: Pending[] = [];
  history: { tick: number; title: string; type: string }[] = [];

  constructor(limits: Partial<EventLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  private snapshot(sim: Simulation) {
    const m = sim.massBreakdown();
    return { pop: sim.pool.count, biomass: m.organisms, species: sim.species.aliveCount(), nutrient: m.nutrient, temp: sim.planet.climateOffset };
  }

  /** Propõe um acontecimento. Retorna se foi aceito e o motivo (determinístico). */
  submit(sim: Simulation, s: Suggestion, opts: { bypassRate?: boolean } = {}): Outcome {
    const verdict = validateSuggestion(sim, s);
    if (!verdict.ok) return verdict;
    if (!opts.bypassRate) {
      const t = sim.tick;
      this.applied = this.applied.filter((x) => t - x < this.limits.window);
      const last = this.applied[this.applied.length - 1];
      if (last !== undefined && t - last < this.limits.minGap) return { ok: false, reason: `Intervalo mínimo entre eventos externos: ${this.limits.minGap} ticks.` };
      if (this.applied.length >= this.limits.maxPerWindow) return { ok: false, reason: `Limite de ${this.limits.maxPerWindow} eventos externos por ${this.limits.window} ticks atingido.` };
    }
    const before = this.snapshot(sim);
    const r = applySuggestion(sim, s);
    if (!r.ok) return r;
    if (!opts.bypassRate) this.applied.push(sim.tick); // ações manuais do jogador não consomem a cota da IA
    const title = s.title || LABEL[s.type];
    this.history.push({ tick: sim.tick, title, type: s.type });
    sim.events.add({
      tick: sim.tick,
      type: 'ai_event',
      title: `Acontecimento: ${title}`,
      text: `${s.narrative ? s.narrative + ' ' : ''}[${describe(s)}] Validado pelo motor: ${r.reason}`,
    });
    this.pending.push({ due: sim.tick + this.limits.impactAfter, title, before });
    return r;
  }

  /** Chamado periodicamente: mede o efeito real de eventos aplicados (não é narrativa inventada). */
  tick(sim: Simulation): void {
    while (this.pending.length && this.pending[0].due <= sim.tick) {
      const p = this.pending.shift()!;
      const now = this.snapshot(sim);
      const pct = (a: number, b: number) => (a > 0 ? `${(((b - a) / a) * 100).toFixed(0)}%` : 'n/d');
      sim.events.add({
        tick: sim.tick,
        type: 'ai_impact',
        title: `Impacto observado: ${p.title}`,
        text: `Após ${this.limits.impactAfter} ticks: população ${p.before.pop} → ${now.pop} (${pct(p.before.pop, now.pop)}), biomassa ${p.before.biomass.toFixed(0)} → ${now.biomass.toFixed(0)} (${pct(p.before.biomass, now.biomass)}), espécies vivas ${p.before.species} → ${now.species}. O desfecho foi decidido pela simulação.`,
      });
    }
  }
}

const LABEL: Record<Suggestion['type'], string> = {
  climate_shift: 'Variação climática',
  eruption: 'Erupção',
  nutrient_upwelling: 'Ressurgência de nutrientes',
  adaptation: 'Variante genética',
};

function describe(s: Suggestion): string {
  switch (s.type) {
    case 'climate_shift': return `clima ${s.deltaT >= 0 ? '+' : ''}${s.deltaT} °C`;
    case 'eruption': return `erupção em (${s.x.toFixed(0)}, ${s.y.toFixed(0)}), massa ${s.amount.toFixed(0)}`;
    case 'nutrient_upwelling': return `ressurgência em (${s.x.toFixed(0)}, ${s.y.toFixed(0)}), massa ${s.amount.toFixed(0)}`;
    case 'adaptation': return `variante de ${s.gene} (${s.delta >= 0 ? '+' : ''}${s.delta}) na espécie #${s.speciesId}`;
  }
}
