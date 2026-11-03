import { GENE_COUNT } from './genome';
import { Simulation } from './simulation';

/**
 * A IA nunca altera o mundo diretamente: suas sugestões passam por este validador
 * e só viram ação se o motor considerar o pedido permitido e coerente com o estado real.
 */
/** Metadados narrativos opcionais: nunca influenciam a física. */
export interface SuggestionMeta {
  title?: string;
  narrative?: string;
  rationale?: string;
}
export type Suggestion = (
  | { type: 'climate_shift'; deltaT: number }
  | { type: 'eruption'; x: number; y: number; amount: number }
  | { type: 'nutrient_upwelling'; x: number; y: number; radius?: number; amount: number }
  | { type: 'hypothesis'; speciesId?: number; text: string }
) &
  SuggestionMeta;

export interface Verdict {
  ok: boolean;
  reason: string;
}

export function validateSuggestion(sim: Simulation, s: Suggestion): Verdict {
  const pl = sim.planet;
  switch (s.type) {
    case 'climate_shift': {
      if (!Number.isFinite(s.deltaT)) return { ok: false, reason: 'Variação inválida.' };
      if (Math.abs(s.deltaT) > 6) return { ok: false, reason: 'O motor limita mudanças climáticas sugeridas a ±6 °C.' };
      if (Math.abs(pl.climateTarget + s.deltaT) > 12) return { ok: false, reason: 'O clima já está distante da linha de base.' };
      return { ok: true, reason: 'Mudança climática gradual permitida.' };
    }
    case 'eruption': {
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.y < 0 || s.x >= pl.w || s.y >= pl.h) return { ok: false, reason: 'Coordenadas fora do planeta.' };
      const c = Math.floor(s.y) * pl.w + Math.floor(s.x);
      if (pl.depth[c] < 0.4) return { ok: false, reason: 'Erupções só ocorrem em águas profundas (fendas oceânicas).' };
      if (pl.pressure < 0.5 * 260) return { ok: false, reason: 'A pressão geológica acumulada ainda é insuficiente (sedimentos enterrados).' };
      if (s.amount > pl.reservoir * 0.5) return { ok: false, reason: 'Não há massa mineral suficiente no reservatório.' };
      return { ok: true, reason: 'Pressão geológica e profundidade compatíveis com uma erupção.' };
    }
    case 'nutrient_upwelling': {
      if (![s.x, s.y, s.amount].every(Number.isFinite)) return { ok: false, reason: 'Parâmetros inválidos.' };
      if (s.x < 0 || s.y < 0 || s.x >= pl.w || s.y >= pl.h) return { ok: false, reason: 'Coordenadas fora do planeta.' };
      const r = s.radius ?? 4;
      if (r < 1 || r > 8) return { ok: false, reason: 'O raio da ressurgência deve estar entre 1 e 8.' };
      if (s.amount <= 0 || s.amount > 150) return { ok: false, reason: 'A quantidade deve estar entre 0 e 150.' };
      if (s.amount > pl.reservoir * 0.3) return { ok: false, reason: 'O sedimento disponível não sustenta essa liberação (máx. 30% do reservatório).' };
      return { ok: true, reason: 'Redistribuição de nutrientes a partir do sedimento (massa conservada).' };
    }
    case 'hypothesis':
      return { ok: false, reason: 'Hipóteses sobre adaptações são apenas texto: a IA não altera genomas. O motor evolutivo decide quais características surgem.' };
  }
  return { ok: false, reason: 'Tipo de sugestão desconhecido.' };
}

/** Aplica uma sugestão já validada. A variante de adaptação compete normalmente; nada é garantido. */
export function applySuggestion(sim: Simulation, s: Suggestion): Verdict {
  const v = validateSuggestion(sim, s);
  if (!v.ok) return v;
  if (s.type === 'climate_shift') sim.setClimate(sim.planet.climateTarget + s.deltaT);
  else if (s.type === 'eruption') sim.eruption(s.x, s.y, 4, s.amount);
  else if (s.type === 'nutrient_upwelling') sim.upwelling(s.x, s.y, Math.round(s.radius ?? 4), s.amount);
  return v;
}
export { GENE_COUNT };
