import type { LayerKind } from '../core/layers';
import type { SaveData } from '../core/serialize';
import type { PaintMode, SimConfig } from '../core/simulation';
import type { SimEvent } from '../core/stats';
import type { Suggestion } from '../core/validate';

export type ToWorker =
  | { t: 'init'; cfg: Partial<SimConfig> }
  | { t: 'load'; save: SaveData }
  | { t: 'speed'; speed: number }
  | { t: 'step'; n: number }
  | { t: 'layer'; layer: LayerKind; species: number }
  | { t: 'paint'; mode: PaintMode; x: number; y: number; r: number }
  | { t: 'climate'; dT: number }
  | { t: 'massExt'; f: number }
  | { t: 'seed' }
  | { t: 'inspect'; x: number; y: number; r?: number }
  | { t: 'cell'; x: number; y: number }
  | { t: 'save'; reqId: number }
  | { t: 'suggest'; reqId: number; s: Suggestion; auto?: boolean }
  | { t: 'perf'; frameMs: number; statsMs: number; budgetMs: number }
  | { t: 'visible'; v: boolean }
  | { t: 'ack' };

export interface SpeciesInfo {
  id: number;
  name: string;
  parentId: number;
  bornTick: number;
  extinctTick: number;
  count: number;
  peak: number;
  trophic: string;
  cause: string;
  vis: number[];
  centroid: number[];
  src: [number, number, number];
}

export interface WebNode {
  id: number;
  count: number;
  src: [number, number, number];
}

export interface StatsPayload {
  tick: number;
  pop: number;
  mass: { organisms: number; nutrient: number; detritus: number; reservoir: number };
  speciesAlive: number;
  speciesTotal: number;
  maxGen: number;
  births: number;
  mutations: number;
  deaths: Record<string, number>;
  planet: { climateTarget: number; climateOffset: number; pressure: number; meanTemp: number; season: number };
  species: SpeciesInfo[];
  history: { ticks: number[]; series: Record<string, number[]> };
  events: SimEvent[];
  eventCount: number;
  web: { nodes: WebNode[]; edges: [number, number, number][] };
  extinct: boolean;
}

export interface InspectInfo {
  id: number;
  speciesId: number;
  speciesName: string;
  age: number;
  lifespan: number;
  gen: number;
  mass: number;
  energy: number;
  x: number;
  y: number;
  genes: number[];
  vis: number[];
  parent: number;
  tempHere: number;
  tempOpt: number;
  tf: number;
}

export interface CellInfo {
  x: number;
  y: number;
  temp: number;
  light: number;
  depth: number;
  nutrient: number;
  detritus: number;
  count: number;
  biomass: number;
  top: { name: string; n: number }[];
}

export type FromWorker =
  | { t: 'ready'; w: number; h: number }
  | {
      t: 'frame';
      tick: number;
      n: number;
      x: Float32Array;
      y: Float32Array;
      sp: Uint32Array;
      vis: Uint8Array;
      ang: Uint8Array;
      layer: Float32Array;
      lmin: number;
      lmax: number;
      layerKind: LayerKind;
      depth: Float32Array;
      vents: Int32Array;
      tps: number;
    }
  | ({ t: 'stats' } & StatsPayload)
  | { t: 'inspect'; info: InspectInfo | null }
  | { t: 'cell'; info: CellInfo }
  | { t: 'save'; reqId: number; save: SaveData }
  | { t: 'verdict'; reqId: number; ok: boolean; reason: string };
