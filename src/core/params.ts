/**
 * Constantes de balanço do simulador.
 * Unidades abstratas: massa (m), energia (e), tempo em ticks.
 * A massa é CONSERVADA; a energia vem da luz e é dissipada (não conservada).
 */
export const P = {
  // --- ambiente
  DECOMP_RATE: 0.012, // fração de detrito -> nutriente por tick (a 15°C)
  DIFFUSION: 0.06,
  BURIAL_RATE: 0.0006, // detrito em águas profundas -> reservatório (sedimento)
  VENT_FLUX: 0.012, // reservatório -> nutriente nas fontes hidrotermais
  SEASON_PERIOD: 1800,
  ENV_UPDATE_EVERY: 10,
  ERUPTION_PRESSURE: 260, // massa acumulada no reservatório para disparar erupção
  // --- fisiologia
  PHOTO_K: 1.1,
  SHADE_K: 0.045,
  OSMO_K: 0.11,
  OSMO_SHARE: 0.25,
  ASSIM_DETRITUS: 0.7,
  DET_EFF: 0.55,
  E_PER_MASS: 2.0, // energia contida em 1 de massa (= custo de construção: sem moto-perpétuo)
  BUILD_COST: 2.0,
  UP_K: 0.085,
  GROW_K: 0.07,
  NUT_SHARE: 0.35,
  RESERVE_PER_MASS: 0.8,
  ECAP_PER_MASS: 4.0,
  REPRO_COST: 1.2, // energia por unidade de massa da prole
  MIN_REPRO_AGE: 8,
  CROWD_SOFT: 10,
  // --- predação
  ATTACK_COST: 0.05,
  PREY_MASS_RATIO: 0.45, // a presa precisa ser bem menor que o predador
  PRED_MIN: 0.15, // abaixo disso não há aparato de captura
  PRED_ASSIM: 0.55,
  PRED_ENERGY_EFF: 0.35,
  PRED_ENERGY_STEAL: 0.4,
  // --- morte
  SENESCENCE: 0.03,
  THERMAL_STRESS: 0.9,
  DESICCATION: 0.25, // Etapa 3: custo de viver fora d'água sem integumento adaptado
  // --- movimento
  SPEED_K: 0.12,
  BROWN: 0.025,
  // --- especiação
  SPECIATION_EVERY: 100,
  SPECIATION_MIN_DIST: 0.07, // separação mínima entre os agrupamentos (RMS dos genes)
  SPECIATION_GAP: 1.5, // lacuna / dispersão interna (bimodalidade)
  SPECIATION_MIN_CLUSTER: 12,
  MIN_SPECIES_FOR_SPLIT: 40,
  // --- estatísticas
  HISTORY_EVERY: 25,
  HISTORY_MAX: 1600,
} as const;
