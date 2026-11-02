import { Simulation } from './simulation';

export type LayerKind = 'ocean' | 'temp' | 'light' | 'nutrient' | 'detritus' | 'biomass' | 'biodiversity' | 'density' | 'species';

export const LAYER_INFO: Record<LayerKind, { label: string; unit: string }> = {
  ocean: { label: 'Oceano (profundidade)', unit: '' },
  temp: { label: 'Temperatura', unit: '°C' },
  light: { label: 'Luminosidade', unit: '' },
  nutrient: { label: 'Nutrientes dissolvidos', unit: 'm' },
  detritus: { label: 'Detritos / matéria orgânica morta', unit: 'm' },
  biomass: { label: 'Biomassa', unit: 'm' },
  biodiversity: { label: 'Biodiversidade (espécies/célula)', unit: '' },
  density: { label: 'Densidade populacional', unit: '' },
  species: { label: 'Distribuição da espécie', unit: '' },
};

export interface LayerResult {
  min: number;
  max: number;
}

/** Calcula um campo escalar por célula para visualização. Escreve em `out` (w*h). */
export function computeLayer(sim: Simulation, kind: LayerKind, speciesId: number, out: Float32Array): LayerResult {
  const pl = sim.planet;
  const n = pl.n;
  let min = 0, max = 1;
  const stat = (arr: ArrayLike<number>) => {
    min = Infinity; max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      out[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  };
  switch (kind) {
    case 'ocean': stat(pl.depth); return { min: 0, max: 1 };
    case 'temp': stat(pl.temp); return { min, max };
    case 'light': stat(pl.light); return { min: 0, max: Math.max(max, 0.01) };
    case 'nutrient': stat(pl.nutrient); return { min: 0, max: Math.max(max, 0.01) };
    case 'detritus': stat(pl.detritus); return { min: 0, max: Math.max(max, 0.01) };
  }
  out.fill(0);
  const pool = sim.pool;
  const slots = kind === 'biodiversity' ? new Int32Array(n * 6) : null;
  for (let i = 0; i < pool.used; i++) {
    if (!pool.alive[i]) continue;
    const c = (pool.y[i] | 0) * pl.w + (pool.x[i] | 0);
    if (kind === 'biomass') out[c] += pool.mass[i];
    else if (kind === 'density') out[c] += 1;
    else if (kind === 'species') {
      if (pool.species[i] === speciesId) out[c] += 1;
    } else if (slots) {
      const sp = pool.species[i];
      const b = c * 6;
      for (let k = 0; k < 6; k++) {
        if (slots[b + k] === sp) break;
        if (slots[b + k] === 0) {
          slots[b + k] = sp;
          out[c] += 1;
          break;
        }
      }
    }
  }
  max = 0;
  for (let i = 0; i < n; i++) if (out[i] > max) max = out[i];
  return { min: 0, max: Math.max(max, kind === 'biodiversity' ? 3 : 1) };
}
