import type { Simulation } from './simulation';

/**
 * Biomas emergentes: não há mapa fixo. Cada célula é classificada a partir do CLIMA (temperatura,
 * umidade do solo), do RELEVO e da VEGETAÇÃO REAL (cobertura, altura) — e a aparência no renderer
 * mistura esses mesmos campos contínuos, de modo que as transições são graduais.
 */
export const B = { ABYSS: 0, OCEAN: 1, SHELF: 2, REEF: 3, ICE: 4, TUNDRA: 5, DESERT: 6, BARREN: 7, GRASSLAND: 8, SHRUB: 9, FOREST: 10, SWAMP: 11 } as const;
export const BIOME_COUNT = 12;
export const BIOME_INFO: { id: number; key: string; label: string; color: [number, number, number] }[] = [
  { id: B.ABYSS, key: 'abyss', label: 'Abismo', color: [4, 12, 38] },
  { id: B.OCEAN, key: 'ocean', label: 'Oceano aberto', color: [20, 70, 130] },
  { id: B.SHELF, key: 'shelf', label: 'Plataforma costeira', color: [50, 140, 175] },
  { id: B.REEF, key: 'reef', label: 'Recife / águas rasas ricas', color: [70, 190, 170] },
  { id: B.ICE, key: 'ice', label: 'Gelo', color: [225, 235, 245] },
  { id: B.TUNDRA, key: 'tundra', label: 'Tundra', color: [150, 165, 150] },
  { id: B.DESERT, key: 'desert', label: 'Deserto', color: [214, 184, 120] },
  { id: B.BARREN, key: 'barren', label: 'Terra nua', color: [140, 112, 86] },
  { id: B.GRASSLAND, key: 'grassland', label: 'Pradaria', color: [160, 190, 90] },
  { id: B.SHRUB, key: 'shrub', label: 'Arbustal', color: [110, 150, 80] },
  { id: B.FOREST, key: 'forest', label: 'Floresta', color: [36, 110, 56] },
  { id: B.SWAMP, key: 'swamp', label: 'Pântano', color: [70, 110, 90] },
];

export interface TerrainView {
  w: number;
  h: number;
  biome: Uint8Array;
  land: Uint8Array;
  /** cobertura vegetal 0..255 */
  cover: Uint8Array;
  /** matiz da vegetação em graus/360 -> 0..255 */
  hue: Uint8Array;
  /** altura média da vegetação 0..255 (0..5 unidades) */
  height: Uint8Array;
  /** umidade do solo 0..255 */
  moist: Uint8Array;
  /** temperatura °C (-30..+60 -> clampada) */
  temp: Int8Array;
  /** fração da superfície por bioma (id -> 0..1) */
  areas: number[];
  landFraction: number;
}

/** Classificação de uma célula de terra a partir dos campos reais. */
export function landBiome(T: number, W: number, cover: number, hMean: number, elev: number): number {
  if (T < -6) return B.ICE;
  if (T < 4) return cover < 0.04 && T < -2 ? B.ICE : B.TUNDRA;
  if (W > 0.7 && elev < 0.4 && T >= 8) return B.SWAMP;
  if (W < 0.2) return B.DESERT;
  if (cover < 0.06) return B.BARREN;
  if (cover > 0.45 && hMean > 1.6) return B.FOREST;
  if (cover > 0.15 && hMean > 0.7) return B.SHRUB;
  return B.GRASSLAND;
}

export function computeTerrain(sim: Simulation): TerrainView {
  const pl = sim.planet, fl = sim.flora;
  const n = pl.n;
  const biome = new Uint8Array(n), cover = new Uint8Array(n), hue = new Uint8Array(n), height = new Uint8Array(n), moist = new Uint8Array(n);
  const temp = new Int8Array(n);
  // densidade de biomassa marinha (para recifes)
  const wb = new Float32Array(n);
  const pool = sim.pool;
  for (let i = 0; i < pool.used; i++) if (pool.alive[i]) wb[pool.cell[i]] += pool.mass[i];
  const counts = new Float64Array(BIOME_COUNT);
  let landN = 0;
  for (let i = 0; i < n; i++) {
    const T = pl.temp[i];
    temp[i] = Math.max(-30, Math.min(60, Math.round(T)));
    if (pl.land[i]) {
      landN++;
      const cv = fl ? fl.cover[i] : 0, hm = fl ? fl.meanHeight[i] : 0;
      biome[i] = landBiome(T, pl.soilWater[i], cv, hm, pl.elev[i]);
      cover[i] = Math.round(cv * 255);
      hue[i] = fl ? Math.round((fl.vegHue[i] / 360) * 255) : 0;
      height[i] = Math.round(Math.min(1, hm / 5) * 255);
      moist[i] = Math.round(pl.soilWater[i] * 255);
    } else {
      const d = pl.depth[i];
      biome[i] = d > 0.7 ? B.ABYSS : d < 0.2 && T > 20 && wb[i] > 1.2 ? B.REEF : d < 0.28 ? B.SHELF : B.OCEAN;
      moist[i] = 255;
    }
    counts[biome[i]]++;
  }
  const areas = Array.from(counts, (c) => c / n);
  return { w: pl.w, h: pl.h, biome, land: pl.land.slice(), cover, hue, height, moist, temp, areas, landFraction: landN / n };
}

/** Média de uma grandeza sobre as células de terra (para tendências e narrativa). */
export function landMean(sim: Simulation, kind: 'temp' | 'water' | 'cover' | 'lai'): number {
  const pl = sim.planet, fl = sim.flora;
  const lc = pl.landCells;
  if (!lc.length) return 0;
  let s = 0;
  for (let k = 0; k < lc.length; k++) {
    const i = lc[k];
    s += kind === 'temp' ? pl.temp[i] : kind === 'water' ? pl.soilWater[i] : kind === 'cover' ? (fl ? fl.cover[i] : 0) : fl ? fl.lai[i] : 0;
  }
  return s / lc.length;
}
