/**
 * Mudanças ambientais programadas: entradas documentadas e reproduzíveis (mesma semente → mesma história).
 * Elas alteram APENAS o ambiente; quem sobrevive, se reproduz e evolui continua sendo decidido pelo motor.
 */
export type EnvChangeKind =
  | 'climate' // alvo de temperatura global (°C relativos à linha de base)
  | 'aridity' // multiplicador de precipitação (<1 seca, >1 umedece) — requer terra (stage3)
  | 'light' // multiplicador global de luz (turbidez, poeira)
  | 'nutrient_depletion'; // fração do nutriente dissolvido sequestrada para o sedimento (massa conservada)

export interface EnvChange {
  tick: number;
  kind: EnvChangeKind;
  /** climate: ΔT (°C) · aridity/light: fator-alvo · nutrient_depletion: fração (0..0.9) */
  value: number;
  /** true = mudança abrupta (relaxação rápida); false = gradual (escala de ~1000 ticks) */
  abrupt?: boolean;
  label?: string;
  applied?: boolean;
}

export const ENV_LABEL: Record<EnvChangeKind, string> = {
  climate: 'Mudança climática',
  aridity: 'Mudança no regime de chuvas',
  light: 'Mudança na luminosidade',
  nutrient_depletion: 'Esgotamento de nutrientes',
};

/** Limites aceitos para as mudanças (coerência física do simulador). */
export function validateEnvChange(c: EnvChange): string | null {
  if (!Number.isFinite(c.tick) || c.tick < 0) return 'tick inválido';
  if (!Number.isFinite(c.value)) return 'valor inválido';
  if (c.kind === 'climate' && Math.abs(c.value) > 30) return 'ΔT fora de ±30 °C';
  if ((c.kind === 'aridity' || c.kind === 'light') && (c.value < 0.1 || c.value > 2)) return 'fator fora de 0,1–2';
  if (c.kind === 'nutrient_depletion' && (c.value <= 0 || c.value > 0.9)) return 'fração fora de 0–0,9';
  return null;
}
